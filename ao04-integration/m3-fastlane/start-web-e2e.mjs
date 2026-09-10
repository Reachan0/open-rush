import { readFileSync, writeFileSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, 'web-e2e-current.json')));
const { runtime, output, database } = cfg;
const databaseUrl = `postgresql://${process.env.USER}@127.0.0.1:5432/${database}`;
const pgConnection = ['-h', '127.0.0.1', '-p', '5432'];
if (!process.argv.includes('--resume')) {
  execFileSync('createdb', [...pgConnection, database]);
  execFileSync('psql', [...pgConnection, '-d', database, '-c', 'CREATE EXTENSION IF NOT EXISTS vector']);
  const migrations = JSON.parse(readFileSync(join(runtime, 'packages/db/drizzle/meta/_journal.json'))).entries;
  for (const entry of migrations)
    execFileSync('psql', [...pgConnection, '-v', 'ON_ERROR_STOP=1', '-d', database, '-f',
      join(runtime, 'packages/db/drizzle', `${entry.tag}.sql`)]);
}
const workspace = join(output, 'workspace');
mkdirSync(join(workspace, 'm3'), { recursive: true });
writeFileSync(join(workspace, 'm3/pre.txt'), 'AO-04 E2E 输入资料：本次任务测试受保护本地依赖。\n');
writeFileSync(join(workspace, 'm3/post.txt'), 'AO-04 E2E 后续资料：依赖成功后继续汇总。\n');
writeFileSync(join(workspace, 'm3/project-delivery-input.json'),
  '{"task":"project_delivery_check","project":"AO-04 快车道融合演示","unitTestsPassed":64,"unitTestsFailed":0,"e2ePassed":2,"build":"passed","blockingIssues":0}\n');
writeFileSync(join(workspace, 'm3/delivery-policy.txt'),
  '交付规则：构建必须通过，单元测试失败数必须为 0，端到端验证至少通过 1 项，阻断问题必须为 0；全部满足时建议交付。\n');
const env = {
  ...process.env, NODE_ENV: 'development', DATABASE_URL: databaseUrl, LOG_PRETTY: 'false',
  AUTH_SKIP_LOGIN: 'true', AUTH_TRUST_HOST: 'true', AUTH_SECRET: randomUUID(),
  NEXTAUTH_URL: 'http://127.0.0.1:3100', AUTH_URL: 'http://127.0.0.1:3100',
  DEV_AGENT_WORKER_URL: 'http://127.0.0.1:18787',
  AO04_DEMO: '1', AO04_SERVICE_DEMO: '1', AO04_CONTROL_URL: 'http://127.0.0.1:18081',
  AO04_CONTROL_TOKEN: randomUUID(), AO04_DATA_ROOT: join(output, 'controller-data'),
  AO04_BIND_DIR: join(output, 'bindings'), AO04_CONTROL_PORT: '18081',
  AO04_DEP_TIMEOUT_S: '4',
  DSH_ROOT: resolve(cfg.source, '../../../deepseek-harness'),
  WORKSPACE_PATH: workspace,
  OPENRUSH_ROOT: runtime, AGENT_RUNTIME: 'dsh',
  DSH_CORDIS_CONFIG: join(runtime, 'apps/agent-worker/dsh/cordis-ao04-fastlane.yml'),
  DSH_MAX_TOKENS_AS_SUCCESS: 'false', DSH_MAX_TOKENS: '4096', DSH_SNAPSHOT: 'none',
  WORKFLOW_LLM_REASONING_EFFORT: 'low',
  TMPDIR: join(output, 'tmp'), NO_PROXY: 'localhost,127.0.0.1', no_proxy: 'localhost,127.0.0.1',
};
if (process.argv.includes('--resume')) {
  env.AO04_CONTROL_TOKEN = JSON.parse(readFileSync(join(output, 'private-control.json'))).token;
}
mkdirSync(env.TMPDIR, { recursive: true });
// Private local harness configuration. Never include this file in deliverables.
writeFileSync(join(output, 'private-control.json'),
  JSON.stringify({ token: env.AO04_CONTROL_TOKEN, databaseUrl }), { mode: 0o600 });
const children = [];
function start(name, command, args, cwd, extra = {}) {
  if (process.argv.includes('--web-only') && name !== 'web') return;
  if (process.argv.includes('--workers-only') && !['agent-worker', 'control-worker'].includes(name)) return;
  if (
    process.argv.includes('--backend-only') &&
    !['controller', 'agent-worker', 'control-worker'].includes(name)
  ) return;
  const log = openSync(join(output, `${name}.log`), 'a');
  const child = spawn(command, args, { cwd, env: { ...env, ...extra },
    stdio: ['ignore', log, log] });
  children.push({ name, pid: child.pid });
  child.on('exit', (code) => console.log(`${name} exited ${code}`));
}
const nodeArgs = ['--import', join(runtime, 'node_modules/tsx/dist/loader.mjs')];
start('controller', resolve(cfg.source, '../../../ao04-experiment/.venv/bin/python'),
  [join(here, 'run-control-service.py')], cfg.controller, { PYTHONPATH: cfg.controller });
start('agent-worker', process.execPath, [
  `--env-file-if-exists=${resolve(cfg.source, '../../apps/agent-worker/.env.local')}`,
  ...nodeArgs, join(runtime, 'apps/agent-worker/src/server.ts'),
], workspace, { PORT: '18787' });
start('control-worker', process.execPath, [...nodeArgs, join(runtime, 'apps/control-worker/src/worker.ts')], runtime);
start('web', process.execPath, [join(runtime, 'apps/web/node_modules/next/dist/bin/next'), 'dev',
  '--webpack', '--hostname', '127.0.0.1', '--port', '3100'], join(runtime, 'apps/web'));
const prior = process.argv.includes('--web-only') || process.argv.includes('--workers-only') || process.argv.includes('--backend-only')
  ? JSON.parse(readFileSync(join(output, 'services.json'))).children
      .filter((s) => !children.some((c) => c.name === s.name)) : [];
writeFileSync(join(output, 'services.json'), JSON.stringify({ children: [...prior, ...children], workspace, databaseUrl }, null, 2));
console.log(JSON.stringify({ output, children, url: 'http://127.0.0.1:3100' }));
