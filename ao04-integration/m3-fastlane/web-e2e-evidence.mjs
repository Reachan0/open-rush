import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, 'web-e2e-current.json')));
const secret = JSON.parse(readFileSync(join(cfg.output, 'private-control.json')));
const sql = (query) => execFileSync('psql', ['-h', '127.0.0.1', '-p', '5432', '-d', cfg.database, '-Atc', query], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const latest = () => JSON.parse(sql("select coalesce(json_agg(r),'[]') from (select id,task_id,status,error_message,created_at from runs order by created_at desc limit 1) r"))[0];
const [mode, name = 'snapshot', fault] = process.argv.slice(2);
const dir = join(cfg.output, 'evidence', name);
mkdirSync(dir, { recursive: true });
const save = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2));
const control = async (id, path = '', options = {}) => {
  const r = await fetch(`http://127.0.0.1:18081/experiments/${id}${path}`, {
    ...options, headers: { 'X-AO04-Token': secret.token, 'Content-Type': 'application/json',
      ...options.headers },
  });
  return { status: r.status, body: await r.json() };
};
if (mode === 'watch') {
  const previous = latest()?.id;
  console.log(`Watching next page Run for ${name}; fault=${fault ?? 'none'}`);
  const deadline = Date.now() + 180_000;
  let done = false;
  while (Date.now() < deadline) {
    const run = latest();
    if (run && run.id !== previous) {
      const id = `ao04-${run.id}`;
      const state = await control(id);
      if (state.status === 200 && state.body.status === 'ready') {
        const injected = fault && fault !== 'none' ? await control(id, '/inject', {
          method: 'POST', body: JSON.stringify({ kind: fault }),
        }) : null;
        save('start.json', { run, state, injected, at: new Date().toISOString() });
        console.log(JSON.stringify({ name, runId: run.id, experimentId: id, injected: injected?.status ?? null }));
        done = true; break;
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!done) throw new Error('No ready Run appeared before watch deadline');
} else if (mode === 'snapshot') {
  const start = existsSync(join(dir, 'start.json')) ? JSON.parse(readFileSync(join(dir, 'start.json'))) : null;
  const runId = start?.run?.id ?? latest()?.id;
  if (!/^[0-9a-f-]+$/.test(runId)) throw new Error('invalid Run identity');
  const run = JSON.parse(sql(`select row_to_json(r) from runs r where id='${runId}'`));
  const events = JSON.parse(sql(`select coalesce(json_agg(e order by seq),'[]') from run_events e where run_id='${runId}'`));
  save('run.json', run);
  save('run-events.json', events);
  save('controller.json', await control(`ao04-${runId}`));
  save('controller-events.json', await control(`ao04-${runId}`, '/events'));
  const leases = readdirSync(join(cfg.output, 'bindings')).filter((n) => n.endsWith('.json'))
    .map((n) => JSON.parse(readFileSync(join(cfg.output, 'bindings', n))));
  save('leases.json', leases.filter((l) => l.runId === runId || l.sessionId === run.taskId || l.sessionId === run.task_id));
  console.log(JSON.stringify({ name, runId, status: run.status, eventCount: events.length,
    tools: events.filter((e) => ['tool-input-available','tool-output-available','tool-output-error'].includes(e.event_type))
      .map((e) => ({ type: e.event_type, name: e.payload?.toolName, id: e.payload?.toolCallId,
        error: e.payload?.errorText?.slice(0,100) })) }));
}
