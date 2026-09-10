#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { inspectDshProof } from './dsh-proof.mjs';
import { compareCurrentSources } from './provenance.mjs';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? '');
const failures = [];

function readJson(relativePath) {
  const path = resolve(root, relativePath);
  if (!existsSync(path)) {
    failures.push(`missing ${relativePath}`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    failures.push(
      `invalid JSON ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }
}

function requireCondition(condition, message) {
  if (!condition) failures.push(message);
}

function incidentIdOf(event) {
  return event?.incidentId ?? event?.payload?.incidentId;
}

function longestRecoveryStreak(events, incidentId) {
  let current = 0;
  let longest = 0;
  for (const event of events) {
    if (event.type !== 'incident.verify' || incidentIdOf(event) !== incidentId) continue;
    const passed =
      event.payload?.healthOk === true &&
      event.payload?.businessOk === true &&
      event.payload?.owned === true;
    current = passed ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function verifyManifest() {
  const manifest = readJson('manifest.json');
  requireCondition(manifest?.algorithm === 'sha256', 'manifest algorithm must be sha256');
  requireCondition(
    Array.isArray(manifest?.files) && manifest.files.length > 0,
    'manifest must list evidence files'
  );
  const listed = new Set();
  for (const entry of manifest?.files ?? []) {
    const path = resolve(root, entry.path);
    const rel = relative(root, path);
    if (isAbsolute(entry.path) || rel.startsWith('..') || listed.has(entry.path)) {
      failures.push(`unsafe or duplicate manifest path: ${entry.path}`);
      continue;
    }
    listed.add(entry.path);
    if (!existsSync(path)) {
      failures.push(`manifest file missing: ${entry.path}`);
      continue;
    }
    const bytes = statSync(path).size;
    const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
    requireCondition(bytes === entry.bytes, `size mismatch: ${entry.path}`);
    requireCondition(sha256 === entry.sha256, `sha256 mismatch: ${entry.path}`);
  }
  function walk(dir) {
    for (const file of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, file.name);
      if (file.isDirectory()) walk(path);
      else if (file.isFile() && relative(root, path) !== 'manifest.json')
        requireCondition(listed.has(relative(root, path)), `unhashed evidence: ${relative(root, path)}`);
      else if (file.isSymbolicLink()) failures.push(`symlink in evidence: ${relative(root, path)}`);
    }
  }
  walk(root);
}

function scenario(name) {
  const prefix = `scenarios/${name}`;
  const entry = {
    assertions: readJson(`${prefix}/assertions.json`),
    graph: readJson(`${prefix}/graph-result.json`),
    calls: readJson(`${prefix}/runtime-tool-calls.json`) ?? [],
    events: readJson(`${prefix}/controller-events.json`) ?? [],
    state: readJson(`${prefix}/tool-state.json`) ?? {},
  };
  requireCondition(entry.assertions?.pass === true, `${name} assertions failed`);
  if (name !== 'concurrent-cancel') {
    requireCondition(isDeepStrictEqual(entry.graph, entry.assertions?.graph), `${name} graph evidence disagrees`);
    const success = ['healthy', 'exit-auto'].includes(name);
    requireCondition(entry.graph?.ok === success, `${name} graph has wrong terminal result`);
    requireCondition(Boolean(entry.graph?.dag) &&
      Boolean(entry.graph?.dag?.error) === !success, `${name} DAG terminal evidence missing`);
  }
  return entry;
}

function protectedResults(entry) {
  return entry.calls
    .filter((call) => call.name === 'ao04_read_status')
    .map((call) => {
      if (call.result?.isError === true) return undefined;
      try {
        const parsed = JSON.parse(call.result?.value?.text);
        requireCondition(isDeepStrictEqual(parsed, call.result?.parsed), 'parsed protected result disagrees with raw envelope');
        requireCondition(typeof call.callId === 'string' && call.callId.length > 0 &&
          parsed.operationId === call.callId, 'protected result lost operation identity');
        return parsed;
      } catch { failures.push('invalid protected result envelope'); return undefined; }
    })
    .filter(Boolean);
}

function verifyScenarios() {
  const healthy = scenario('healthy');
  requireCondition(healthy.assertions?.graph?.ok === true, 'healthy graph did not complete');
  requireCondition(
    healthy.calls.map((call) => call.name).join(',') === 'read,ao04_read_status,read',
    'healthy graph call order/count is wrong'
  );

  const exited = scenario('exit-auto');
  const deployPid = exited.events.find((event) => event.payload?.reason === 'deploy')?.payload?.pid;
  const repairPid = exited.events.find((event) => event.payload?.reason === 'repair')?.payload?.pid;
  const terminal = exited.events.find(
    (event) => event.type === 'incident.terminal' && event.payload?.status === 'ok'
  );
  requireCondition(
    Number.isInteger(deployPid) && Number.isInteger(repairPid) && deployPid !== repairPid,
    'exit-auto lacks distinct deploy/repair PIDs'
  );
  requireCondition(
    longestRecoveryStreak(exited.events, incidentIdOf(terminal)) >= 3,
    'exit-auto lacks three consecutive verifies for its terminal incident'
  );
  requireCondition(
    exited.calls.filter((call) => call.name === 'read').length === 2,
    'exit-auto replayed a read node'
  );
  requireCondition(protectedResults(exited)[0]?.dependencyRecovered === true, 'exit-auto result lacks recovery');

  const alert = scenario('timeout-alert');
  const alertResult = protectedResults(alert)[0];
  requireCondition(
    alertResult?.status === 'failed' && alertResult?.attempts === 1,
    'timeout-alert is not a one-attempt failure'
  );
  requireCondition(
    !alert.events.some((event) => event.payload?.reason === 'repair'),
    'timeout-alert restarted the dependency'
  );
  requireCondition(
    !alert.calls.some((call) => call.arguments?.path === 'm3/post.txt'),
    'timeout-alert ran its post node'
  );

  const auto = scenario('timeout-auto');
  const autoResults = protectedResults(auto);
  requireCondition(
    autoResults[0]?.status === 'degraded' && autoResults[0]?.attempts === 3,
    'timeout-auto did not exhaust exactly three attempts'
  );
  requireCondition(
    autoResults[1]?.status === 'degraded' && autoResults[1]?.skippedDependency === true,
    'timeout-auto follow-up did not skip the locked dependency'
  );
  requireCondition(
    auto.events.some(
      (event) =>
        event.type === 'incident.terminal' &&
        event.payload?.status === 'degraded' &&
        event.payload?.attempts === 3
    ),
    'timeout-auto controller events lack the three-attempt terminal record'
  );
  requireCondition(
    auto.state.toolCalls === 6,
    `timeout-auto expected 6 total /work calls including 3 baseline calls, got ${String(auto.state.toolCalls)}`
  );
  requireCondition(autoResults[0]?.data?.locked === true &&
    !auto.calls.some((call) => call.arguments?.path === 'm3/post.txt'),
  'timeout-auto did not lock or executed downstream work');

  const missing = scenario('missing-artifact');
  const missingResult = protectedResults(missing)[0];
  requireCondition(
    missingResult?.status === 'human_required' && missingResult?.errorClass === 'artifact_missing',
    'missing-artifact did not require a human'
  );
  requireCondition(
    typeof missingResult?.data?.handoff === 'string',
    'missing-artifact lacks a handoff path'
  );
  const handoff = resolve(root, 'control-data', missing.assertions?.experimentId ?? '',
    'handoffs', `${missingResult?.operationId}.md`);
  const handoffText = existsSync(handoff) ? readFileSync(handoff, 'utf8') : '';
  requireCondition(handoffText.includes('reason: artifact_missing') &&
    handoffText.includes(`task_id: ${missingResult?.operationId}`) &&
    handoffText.includes('status: human_required'), 'missing-artifact handoff content is missing or invalid');
  requireCondition(
    missing.events.some(
      (event) =>
        event.type === 'incident.terminal' &&
        event.payload?.status === 'human_required' &&
        event.payload?.reason === 'artifact_missing'
    ),
    'missing-artifact controller events lack the handoff terminal record'
  );
  requireCondition(
    !missing.calls.some((call) => call.arguments?.path === 'm3/post.txt'),
    'missing-artifact ran its post node'
  );

  const cancelled = scenario('concurrent-cancel');
  const callIds = cancelled.calls
    .filter((call) => call.name === 'ao04_read_status')
    .map((call) => call.callId)
    .sort();
  requireCondition(
    callIds.join(',') === 'concurrent-1,concurrent-2,concurrent-after-cancel',
    'concurrent-cancel lost operation identities'
  );
  requireCondition(
    protectedResults(cancelled).length === 3 &&
      protectedResults(cancelled).every((result) => result.status === 'cancelled'),
    'concurrent-cancel lacks controller cancellation for every operation'
  );
  requireCondition(cancelled.state.toolCalls === 4,
    'concurrent-cancel performed work beyond baseline and its one in-flight call');
  requireCondition(
    cancelled.state.experiment?.cancelled === true,
    'concurrent-cancel did not leave the controller cancelled'
  );
}

function verifyRealDsh(run) {
  if (!['all', 'real-dsh'].includes(run?.mode)) return;
  const status = readJson('dsh-real-attempt/status.json');
  const messages = readJson('dsh-real-attempt/protocol-messages.json') ?? [];
  const controllerEvents = readJson('dsh-real-attempt/controller-events.json') ?? [];
  requireCondition(
    status?.status === 'passed' && status?.success === true,
    'real DSH status failed'
  );
  requireCondition(
    status?.received === true && status?.idle === true,
    'real DSH turn did not settle'
  );
  const proof = inspectDshProof({
    messages, controllerEvents, sessionId: status?.sessionId,
    experimentId: status?.experimentId, runId: status?.runId,
    requestedDsl: readJson('dsh-real-attempt/requested-dsl.json'),
  });
  failures.push(...proof.failures.map((message) => `real DSH: ${message}`));
  const chunks = readJson('dsh-real-attempt/stdout-chunks.json') ?? [];
  try {
    const rawMessages = chunks.map((c) => c.text).join('').split('\n').filter(Boolean)
      .flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
    requireCondition(isDeepStrictEqual(rawMessages, messages), 'DSH raw stdout disagrees with parsed protocol');
  } catch { failures.push('invalid raw DSH stdout'); }
}

if (!process.argv[2]) {
  process.stderr.write('usage: node verify-m3.mjs <results-directory>\n');
  process.exit(2);
}

const run = readJson('run.json');
requireCondition(run?.status === 'passed', `run status is ${String(run?.status)}`);
requireCondition(['all', 'real-dsh', 'deterministic'].includes(run?.mode), 'unsupported run mode');
if (process.argv.includes('--require-real-dsh'))
  requireCondition(run?.mode === 'all', 'full M3 acceptance requires mode=all');
verifyManifest();
const provenance = readJson('provenance.json');
requireCondition(provenance?.schemaVersion === 1, 'missing execution provenance');
if (process.argv.includes('--current-source')) {
  const target = fileURLToPath(new URL('../../', import.meta.url));
  failures.push(...compareCurrentSources(provenance, {
    openrush: target,
    controller: resolve(target, '../../../ao04-fastlane-controller'),
  }));
}
if (['all', 'deterministic'].includes(run?.mode)) verifyScenarios();
verifyRealDsh(run);

if (failures.length > 0) {
  process.stderr.write(`VERIFY FAIL\n${failures.map((failure) => `- ${failure}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`VERIFY PASS (${run.mode}; ${run.mode === 'all' ? 'runtime M3 acceptance' : 'partial coverage'})\n`);
