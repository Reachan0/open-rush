#!/usr/bin/env node

/*
 * AO-04 M3 acceptance driver.
 *
 * The deterministic mode is intentionally model-free.  It drives the real
 * controller HTTP API, the real tool_app subprocess, the built AO-04 tool, and
 * the built workflow_run adapter with a small runtime-tools host.  --mode all
 * additionally attempts one model-driven DSH JSON-RPC turn and records raw
 * protocol evidence without treating a failed attempt as acceptance.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectDshProof } from './dsh-proof.mjs';
import { captureProvenance } from './provenance.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET_ROOT = resolve(HERE, '../..');
const RUNTIME_ROOT = resolve(process.env.M3_RUNTIME_ROOT ?? TARGET_ROOT);
const CONTROLLER_ROOT = resolve(
  process.env.AO04_CONTROLLER_ROOT ?? resolve(TARGET_ROOT, '../../..', 'ao04-fastlane-controller')
);
const MODE = parseMode(process.argv);
const RUN_STAMP = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\.\d{3}Z$/, 'Z');
const RESULTS_ROOT = resolve(
  process.env.M3_RESULTS_DIR ?? join(HERE, 'results', `run-${RUN_STAMP}`)
);
const CONTROL_TOKEN = `m3-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const state = {
  resultRoot: RESULTS_ROOT,
  controller: undefined,
  controlDataRoot: undefined,
  controlUrl: undefined,
  scenarios: [],
  dsh: undefined,
  failures: [],
};

function parseMode(argv) {
  const index = argv.indexOf('--mode');
  const mode = index >= 0 ? argv[index + 1] : (process.env.M3_MODE ?? 'deterministic');
  if (!['deterministic', 'real-dsh', 'all'].includes(mode)) {
    throw new Error(`unsupported mode ${String(mode)}; use deterministic, real-dsh, or all`);
  }
  return mode;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function evidenceFiles(root, relative = '') {
  const directory = join(root, relative);
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) return evidenceFiles(root, path);
      return path === 'manifest.json' ? [] : [path];
    })
    .sort();
}

function writeManifest(root) {
  const files = evidenceFiles(root).map((relativePath) => {
    const path = join(root, relativePath);
    return {
      path: relativePath,
      bytes: statSync(path).size,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    };
  });
  writeJson(join(root, 'manifest.json'), {
    algorithm: 'sha256',
    generatedAt: new Date().toISOString(),
    files,
  });
}

function errorText(error) {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

function extractDag(text) {
  if (typeof text !== 'string') return undefined;
  const marker = 'OPENRUSH_WORKFLOW_DAG:';
  const index = text.lastIndexOf(marker);
  if (index < 0) return undefined;
  try {
    return JSON.parse(text.slice(index + marker.length).trim());
  } catch {
    return { parseError: true, rawTail: text.slice(index + marker.length).trim() };
  }
}

function yamlSingleQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function writeResolvedComposition(sourcePath, destinationPath) {
  const readStatusPlugin =
    process.env.AO04_READ_STATUS_PLUGIN ??
    join(RUNTIME_ROOT, 'packages/dsh-tool-ao04/dist/index.js');
  const workflowPlugin =
    process.env.AO04_WORKFLOW_RUN_PLUGIN ??
    join(RUNTIME_ROOT, 'packages/dsh-tool-workflow-run/dist/index.js');
  const resolved = readFileSync(sourcePath, 'utf8')
    .replace(
      'name: ../../../packages/dsh-tool-ao04/dist/index.js',
      `name: ${yamlSingleQuote(readStatusPlugin)}`
    )
    .replace(
      'name: ../../../packages/dsh-tool-workflow-run/dist/index.js',
      `name: ${yamlSingleQuote(workflowPlugin)}`
    );
  writeFileSync(destinationPath, resolved, 'utf8');
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('could not reserve a local port');
  }
  const port = address.port;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}

async function requestJson(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const { timeoutMs: _ignored, ...fetchOptions } = options;
  const signal = fetchOptions.signal ?? AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, { ...fetchOptions, signal });
  const raw = await response.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { raw };
  }
  return { status: response.status, ok: response.ok, body };
}

function controlHeaders() {
  return { 'Content-Type': 'application/json', 'X-AO04-Token': CONTROL_TOKEN };
}

async function waitForControl(url) {
  let last;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await requestJson(`${url}/experiments/__m3_ready_probe__`, {
        headers: controlHeaders(),
        timeoutMs: 500,
      });
      if (response.status === 404 || response.status === 401) {
        if (response.status === 401) throw new Error('control token was not accepted');
        return;
      }
      last = new Error(`unexpected control readiness status ${response.status}`);
    } catch (error) {
      last = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`control service did not start: ${errorText(last)}`);
}

async function startControl() {
  const port = await freePort();
  const dataRoot = join(RESULTS_ROOT, 'control-data');
  mkdirSync(dataRoot, { recursive: true });
  const pythonCandidates = [
    process.env.AO04_PYTHON,
    join(CONTROLLER_ROOT, '.venv/bin/python'),
    resolve(TARGET_ROOT, '../../..', 'ao04-experiment/.venv/bin/python'),
  ].filter(Boolean);
  const python = pythonCandidates.find((candidate) => existsSync(candidate)) ?? 'python3';
  const stdoutPath = join(RESULTS_ROOT, 'controller.stdout.log');
  const stderrPath = join(RESULTS_ROOT, 'controller.stderr.log');
  const child = spawn(python, [join(HERE, 'run-control-service.py')], {
    cwd: CONTROLLER_ROOT,
    env: {
      ...process.env,
      PYTHONPATH: CONTROLLER_ROOT,
      AO04_CONTROL_PORT: String(port),
      AO04_CONTROL_TOKEN: CONTROL_TOKEN,
      AO04_DATA_ROOT: dataRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = child.stdout;
  const stderr = child.stderr;
  stdout?.on('data', (chunk) => appendFileSync(stdoutPath, chunk));
  stderr?.on('data', (chunk) => appendFileSync(stderrPath, chunk));
  child.once('error', (error) => {
    appendFileSync(stderrPath, `${errorText(error)}\n`);
  });
  const control = { child, port, url: `http://127.0.0.1:${port}`, dataRoot };
  state.controller = control;
  state.controlDataRoot = dataRoot;
  state.controlUrl = control.url;
  try {
    await waitForControl(control.url);
  } catch (error) {
    await stopChild(child);
    throw error;
  }
  return control;
}

async function stopChild(child, graceMs = 1500) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, graceMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function stopControl() {
  if (!state.controller) return;
  await stopChild(state.controller.child, 4000);
}

async function importModules() {
  const bindModulePath = resolve(
    process.env.AO04_BIND_MODULE ?? join(TARGET_ROOT, 'apps/agent-worker/src/ao04-bind.ts')
  );
  const readStatusPath = resolve(
    process.env.AO04_READ_STATUS_MODULE ??
      join(RUNTIME_ROOT, 'packages/dsh-tool-ao04/dist/index.js')
  );
  const workflowPath = resolve(
    process.env.AO04_WORKFLOW_MODULE ??
      join(RUNTIME_ROOT, 'packages/dsh-tool-workflow-run/dist/index.js')
  );
  writeJson(join(RESULTS_ROOT, 'provenance.json'), captureProvenance({
    target: TARGET_ROOT, controller: CONTROLLER_ROOT, runtime: RUNTIME_ROOT,
    binding: bindModulePath, readStatus: readStatusPath, workflow: workflowPath,
    composition: join(TARGET_ROOT, 'apps/agent-worker/dsh/cordis-ao04-fastlane.yml'),
  }));
  const binding = await import(pathToFileURL(bindModulePath).href);
  const readStatus = await import(pathToFileURL(readStatusPath).href);
  const workflow = await import(pathToFileURL(workflowPath).href);
  if (
    typeof binding.bindSessionRun !== 'function' ||
    typeof binding.unbindSessionRun !== 'function'
  ) {
    throw new Error(
      `binding module does not export bindSessionRun/unbindSessionRun: ${bindModulePath}`
    );
  }
  if (typeof readStatus.executeReadStatus !== 'function') {
    throw new Error(`AO04 tool module does not export executeReadStatus: ${readStatusPath}`);
  }
  if (typeof workflow.runWorkflowFromLoop !== 'function') {
    throw new Error(`workflow plugin does not export runWorkflowFromLoop: ${workflowPath}`);
  }
  return { binding, readStatus, workflow, paths: { bindModulePath, readStatusPath, workflowPath } };
}

async function createExperiment(control, experimentId, mode, taskId) {
  const response = await requestJson(`${control.url}/experiments`, {
    method: 'POST',
    headers: controlHeaders(),
    body: JSON.stringify({ experimentId, mode, taskId }),
    timeoutMs: 15_000,
  });
  if (response.status !== 201) {
    throw new Error(
      `experiment ${experimentId} setup failed: HTTP ${response.status} ${JSON.stringify(response.body)}`
    );
  }
  return response.body;
}

async function inject(control, experimentId, kind) {
  const response = await requestJson(
    `${control.url}/experiments/${encodeURIComponent(experimentId)}/inject`,
    {
      method: 'POST',
      headers: controlHeaders(),
      body: JSON.stringify({ kind }),
    }
  );
  if (!response.ok) throw new Error(`inject ${kind} failed: HTTP ${response.status}`);
  return response.body;
}

async function cancelExperiment(control, experimentId, lease) {
  const headers = {
    ...controlHeaders(),
    'X-AO04-Run-Id': lease.runId,
    'X-AO04-Binding-Generation': String(lease.bindingGeneration),
  };
  return requestJson(`${control.url}/experiments/${encodeURIComponent(experimentId)}/cancel`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
}

async function readEvents(control, experimentId) {
  const response = await requestJson(
    `${control.url}/experiments/${encodeURIComponent(experimentId)}/events?after=0`,
    {
      headers: controlHeaders(),
    }
  );
  return response.body?.events ?? [];
}

async function readExperiment(control, experimentId) {
  const response = await requestJson(
    `${control.url}/experiments/${encodeURIComponent(experimentId)}`,
    { headers: controlHeaders() }
  );
  return response.ok ? response.body : undefined;
}

function stateCount(dataRoot, experimentId, name) {
  const path = join(dataRoot, experimentId, name);
  if (!existsSync(path)) return undefined;
  const value = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
  return Number.isFinite(value) ? value : undefined;
}

function copyIfPresent(source, destination) {
  if (existsSync(source)) copyFileSync(source, destination);
}

function check(assertions, name, condition, detail = undefined) {
  const entry = { name, pass: Boolean(condition) };
  if (detail !== undefined) entry.detail = detail;
  assertions.push(entry);
  return Boolean(condition);
}

function assertionSummary(assertions) {
  return {
    pass: assertions.every((entry) => entry.pass),
    assertions,
    failed: assertions.filter((entry) => !entry.pass).map((entry) => entry.name),
  };
}

function parseAo04Envelope(value) {
  if (!value || typeof value !== 'object' || typeof value.text !== 'string') return undefined;
  try {
    return JSON.parse(value.text);
  } catch {
    return undefined;
  }
}

function incidentIdOf(event) {
  return event?.incidentId ?? event?.payload?.incidentId;
}

function consecutiveSuccessfulVerifies(events, incidentId) {
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

function createRuntimeTools({ readStatus, toolEnv, sessionId, calls, label }) {
  const schemas = [
    {
      name: 'read',
      description: 'Read one deterministic fixture path.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    {
      name: 'ao04_read_status',
      description: 'Read the protected AO-04 local status through the controller.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  ];

  return {
    schemas(scope) {
      return schemas.map((schema) => ({
        ...schema,
        scope: scope === undefined ? undefined : 'scoped',
      }));
    },
    async execute(input) {
      const name = String(input?.name ?? '');
      const args = input?.arguments && typeof input.arguments === 'object' ? input.arguments : {};
      const call = {
        at: new Date().toISOString(),
        label,
        name,
        arguments: args,
        callId: input?.callId ?? null,
        hasParentToken: input?.parent !== undefined,
        agentId: input?.agent && typeof input.agent === 'object' ? (input.agent.id ?? null) : null,
        sessionId,
      };
      calls.push(call);
      if (name === 'read') {
        const result = {
          isError: false,
          value: {
            path: String(args.path ?? ''),
            lines: [{ number: 1, text: `${label}:${String(args.path ?? '')}` }],
          },
        };
        call.result = result;
        return result;
      }
      if (name === 'ao04_read_status') {
        try {
          const value = await readStatus.executeReadStatus(
            { query: String(args.query ?? '') },
            {
              signal: input?.signal,
              token: input?.parent,
              agent: input?.agent,
              callId: input?.callId,
            },
            { env: toolEnv }
          );
          const result = { isError: false, value };
          call.result = { ...result, parsed: parseAo04Envelope(value) };
          return result;
        } catch (error) {
          const result = {
            isError: true,
            error: { message: error instanceof Error ? error.message : String(error) },
          };
          call.result = result;
          return result;
        }
      }
      const result = { isError: true, error: { message: `unknown runtime tool ${name}` } };
      call.result = result;
      return result;
    },
  };
}

function graphDsl(name) {
  return {
    version: '1',
    name,
    nodes: [
      { id: 'pre', tool: 'read', input: { path: 'm3/pre.txt' } },
      {
        id: 'protected',
        tool: 'ao04_read_status',
        dependsOn: ['pre'],
        input: { query: 'M3 protected status for the current run' },
      },
      { id: 'post', tool: 'read', dependsOn: ['protected'], input: { path: 'm3/post.txt' } },
    ],
  };
}

async function runGraph({ workflow, runtimeTools, sessionId, runId, label }) {
  const dsl = graphDsl(`m3_${label}`);
  try {
    const result = await workflow.runWorkflowFromLoop({
      intent: 'Run the M3 protected status graph once.',
      dsl,
      loopTools: runtimeTools,
      eligibleToolNames: ['ao04_read_status'],
      exec: {
        agent: { id: `agent-${label}`, sessionId },
        token: `parent-${runId}`,
        callId: `graph-${label}`,
      },
    });
    return { ok: true, text: result.text, dag: extractDag(result.text), dsl };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return { ok: false, error: text, dag: extractDag(text), dsl };
  }
}

async function directProtected({ runtimeTools, sessionId, callId, signal, query }) {
  try {
    const result = await runtimeTools.execute({
      name: 'ao04_read_status',
      arguments: { query },
      signal,
      agent: { id: `agent-${sessionId}`, sessionId },
      parent: `direct-${sessionId}`,
      callId,
    });
    if (result.isError) return { ok: false, error: result.error?.message ?? 'tool failed', result };
    return { ok: true, value: result.value, parsed: parseAo04Envelope(result.value), result };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

async function bindLease(modules, scenarioDir, sessionId, runId, experimentId) {
  const bindDir = join(scenarioDir, 'bind');
  mkdirSync(bindDir, { recursive: true });
  const lease = modules.binding.bindSessionRun({
    bindDir,
    sessionId,
    runId,
    experimentId,
    ttlMs: 30 * 60_000,
  });
  const leasePath = join(bindDir, `${sessionId}.json`);
  const raw = JSON.parse(readFileSync(leasePath, 'utf8'));
  writeJson(join(scenarioDir, 'lease.json'), raw);
  return { lease, bindDir };
}

function eventPids(events) {
  return events
    .map((event) => ({
      type: event.type,
      generation: event.processGeneration,
      pid: event.payload?.pid,
      reason: event.payload?.reason,
      processStartCount: event.payload?.processStartCount,
    }))
    .filter((entry) => Number.isInteger(entry.pid));
}

async function scenario(name, mode, modules, body) {
  const scenarioDir = join(RESULTS_ROOT, 'scenarios', name);
  mkdirSync(scenarioDir, { recursive: true });
  const experimentId = `m3-${name}-${Date.now().toString(36)}`;
  const sessionId = `session-${name}-${Math.random().toString(16).slice(2, 8)}`;
  const runId = `run-${name}-${Date.now().toString(36)}`;
  const calls = [];
  const assertions = [];
  let leaseInfo;
  let events = [];
  let experiment;
  let graph;
  let toolState = {};
  let setup;
  try {
    setup = await createExperiment(state.controller, experimentId, mode, `m3-${name}`);
    leaseInfo = await bindLease(modules, scenarioDir, sessionId, runId, experimentId);
    const toolEnv = {
      ...process.env,
      AO04_CONTROL_URL: state.controlUrl,
      AO04_CONTROL_TOKEN: CONTROL_TOKEN,
      AO04_BIND_DIR: leaseInfo.bindDir,
      DSH_SESSION_ID: sessionId,
    };
    const runtimeTools = createRuntimeTools({
      readStatus: modules.readStatus,
      toolEnv,
      sessionId,
      calls,
      label: name,
    });
    const context = {
      name,
      mode,
      experimentId,
      sessionId,
      runId,
      scenarioDir,
      lease: leaseInfo.lease,
      toolEnv,
      runtimeTools,
      calls,
      assertions,
      setup,
      modules,
      graph: async () => {
        graph = await runGraph({
          workflow: modules.workflow,
          runtimeTools,
          sessionId,
          runId,
          label: name,
        });
        return graph;
      },
      direct: (input = {}) =>
        directProtected({
          runtimeTools,
          sessionId,
          callId: input.callId ?? `${name}-direct`,
          signal: input.signal,
          query: input.query ?? `M3 ${name}`,
        }),
      inject: (kind) => inject(state.controller, experimentId, kind),
      cancel: () => cancelExperiment(state.controller, experimentId, leaseInfo.lease),
    };
    await body(context);
  } catch (error) {
    state.failures.push(`${name}: ${errorText(error)}`);
    assertions.push({ name: 'scenario did not throw', pass: false, detail: errorText(error) });
  } finally {
    try {
      events = await readEvents(state.controller, experimentId);
      experiment = await readExperiment(state.controller, experimentId);
    } catch (error) {
      state.failures.push(`${name}: event snapshot failed: ${errorText(error)}`);
    }
    toolState = {
      healthCalls: stateCount(state.controlDataRoot, experimentId, 'health_calls'),
      toolCalls: stateCount(state.controlDataRoot, experimentId, 'tool_calls'),
      healthOkRemaining: stateCount(state.controlDataRoot, experimentId, 'health_ok_remaining'),
      eventPids: eventPids(events),
      experiment,
    };
    writeJson(join(scenarioDir, 'graph-result.json'), graph ?? { absent: true });
    writeJson(join(scenarioDir, 'runtime-tool-calls.json'), calls);
    writeJson(join(scenarioDir, 'controller-events.json'), events);
    writeJson(join(scenarioDir, 'tool-state.json'), toolState);
    const summary = assertionSummary(assertions);
    writeJson(join(scenarioDir, 'assertions.json'), {
      scenario: name,
      experimentId,
      setup,
      graph,
      ...summary,
    });
    copyIfPresent(
      join(state.controlDataRoot, experimentId, 'tool_app.stderr.log'),
      join(scenarioDir, 'tool_app.stderr.log')
    );
    if (leaseInfo) {
      try {
        modules.binding.unbindSessionRun(
          sessionId,
          leaseInfo.lease.bindingGeneration,
          leaseInfo.bindDir
        );
      } catch (error) {
        state.failures.push(`${name}: lease cleanup failed: ${errorText(error)}`);
      }
    }
    state.scenarios.push({ name, experimentId, ...summary });
  }
}

async function runDeterministic(modules) {
  await scenario('healthy', 'auto', modules, async (ctx) => {
    const graph = await ctx.graph();
    check(ctx.assertions, 'graph completes', graph.ok, graph.error);
    check(ctx.assertions, 'DAG marker is preserved', Boolean(graph.dag));
    check(
      ctx.assertions,
      'prefix/protected/post execute once',
      ctx.calls.map((call) => call.name).join(',') === 'read,ao04_read_status,read',
      ctx.calls.map((call) => call.name)
    );
    check(ctx.assertions, 'post fact is present', graph.text?.includes('healthy:m3/post.txt'));
  });

  await scenario('exit-auto', 'auto', modules, async (ctx) => {
    await ctx.inject('exit');
    const graph = await ctx.graph();
    const events = await readEvents(state.controller, ctx.experimentId);
    const pids = eventPids(events);
    const initial = pids.find((entry) => entry.reason === 'deploy')?.pid;
    const replacement = pids.find((entry) => entry.reason === 'repair')?.pid;
    const terminal = events.find(
      (event) => event.type === 'incident.terminal' && event.payload?.status === 'ok'
    );
    const recoveryStreak = consecutiveSuccessfulVerifies(events, incidentIdOf(terminal));
    check(ctx.assertions, 'graph recovers after exit', graph.ok, graph.error);
    check(
      ctx.assertions,
      'old/new PID evidence exists',
      Number.isInteger(initial) && Number.isInteger(replacement) && initial !== replacement,
      pids
    );
    check(
      ctx.assertions,
      'three consecutive recovery verifications share the terminal incident',
      recoveryStreak >= 3,
      {
        incidentId: incidentIdOf(terminal),
        recoveryStreak,
      }
    );
    check(
      ctx.assertions,
      'graph prefix is not replayed',
      ctx.calls.filter((call) => call.name === 'read').length === 2,
      ctx.calls
    );
    check(
      ctx.assertions,
      'post node runs once',
      ctx.calls.filter((call) => call.name === 'read').at(-1)?.arguments?.path === 'm3/post.txt'
    );
  });

  await scenario('timeout-alert', 'alert_only', modules, async (ctx) => {
    await ctx.inject('timeout');
    const before = stateCount(state.controlDataRoot, ctx.experimentId, 'tool_calls');
    const graph = await ctx.graph();
    const after = stateCount(state.controlDataRoot, ctx.experimentId, 'tool_calls');
    const events = await readEvents(state.controller, ctx.experimentId);
    const directFailure = graph.error ?? '';
    const protectedCall = ctx.calls.find((call) => call.name === 'ao04_read_status');
    check(
      ctx.assertions,
      'graph fails at protected node',
      !graph.ok && /protected|ao04|timeout/i.test(directFailure),
      directFailure
    );
    check(
      ctx.assertions,
      'completed prefix is retained',
      graph.error?.includes('pre') ?? false,
      graph.error
    );
    check(
      ctx.assertions,
      'post node does not execute',
      !ctx.calls.some((call) => call.arguments?.path === 'm3/post.txt')
    );
    check(
      ctx.assertions,
      'timeout budget is one dependency attempt',
      after - before === 1 && protectedCall?.result?.parsed?.attempts === 1,
      {
        before,
        after,
        result: protectedCall?.result?.parsed,
      }
    );
    check(
      ctx.assertions,
      'no repair restart is emitted',
      !events.some(
        (event) => event.type === 'incident.action' && event.payload?.reason === 'repair'
      )
    );
  });

  await scenario('timeout-auto', 'auto', modules, async (ctx) => {
    await ctx.inject('timeout');
    const beforeGraph = stateCount(state.controlDataRoot, ctx.experimentId, 'tool_calls');
    const graph = await ctx.graph();
    const beforeFollowup = stateCount(state.controlDataRoot, ctx.experimentId, 'tool_calls');
    const followup = await ctx.direct({ callId: 'timeout-auto-followup' });
    const afterFollowup = stateCount(state.controlDataRoot, ctx.experimentId, 'tool_calls');
    const protectedCall = ctx.calls.find((call) => call.name === 'ao04_read_status');
    check(
      ctx.assertions,
      'graph fails after timeout budget',
      !graph.ok && /timeout|degraded|circuit/i.test(graph.error ?? ''),
      graph.error
    );
    check(
      ctx.assertions,
      'three timeout attempts are reported by the controller',
      beforeFollowup - beforeGraph === 3 && protectedCall?.result?.parsed?.attempts === 3,
      {
        beforeGraph,
        beforeFollowup,
        result: protectedCall?.result?.parsed,
      }
    );
    check(
      ctx.assertions,
      'follow-up is circuit-locked',
      followup.parsed?.status === 'degraded' && followup.parsed?.skippedDependency === true,
      followup
    );
    check(
      ctx.assertions,
      'locked follow-up does not call tool_app',
      beforeFollowup === afterFollowup,
      { beforeFollowup, afterFollowup }
    );
  });

  await scenario('missing-artifact', 'auto', modules, async (ctx) => {
    await ctx.inject('artifact_missing');
    const graph = await ctx.graph();
    const protectedResult = ctx.calls.find((call) => call.name === 'ao04_read_status')?.result
      ?.parsed;
    check(
      ctx.assertions,
      'claimed completion is blocked',
      !graph.ok && /artifact_missing|human_required|handoff/i.test(graph.error ?? ''),
      graph.error
    );
    check(
      ctx.assertions,
      'post node is blocked',
      !ctx.calls.some((call) => call.arguments?.path === 'm3/post.txt')
    );
    check(
      ctx.assertions,
      'handoff evidence is present',
      protectedResult?.status === 'human_required' &&
        protectedResult?.errorClass === 'artifact_missing' &&
        typeof protectedResult?.data?.handoff === 'string',
      protectedResult
    );
  });

  await scenario('concurrent-cancel', 'auto', modules, async (ctx) => {
    await ctx.inject('timeout');
    const first = ctx.direct({ callId: 'concurrent-1' });
    const second = ctx.direct({ callId: 'concurrent-2' });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 80));
    const cancelled = await ctx.cancel();
    const [one, two] = await Promise.all([first, second]);
    check(ctx.assertions, 'cancel endpoint accepts bound lease', cancelled.ok, cancelled);
    check(
      ctx.assertions,
      'both protected calls return controller cancellation',
      [one, two].every((result) => result.parsed?.status === 'cancelled'),
      [one, two]
    );
    const before = await readExperiment(state.controller, ctx.experimentId);
    const third = await ctx.direct({ callId: 'concurrent-after-cancel' });
    check(ctx.assertions, 'later invocation remains cancelled',
      third.parsed?.status === 'cancelled' && before.cancelled === true, third);
    check(
      ctx.assertions,
      'both calls preserve their operation identity',
      ctx.calls
        .filter((call) => call.name === 'ao04_read_status')
        .filter((call) => call.callId !== 'concurrent-after-cancel')
        .map((call) => call.callId)
        .sort()
        .join(',') === 'concurrent-1,concurrent-2',
      ctx.calls
    );
  });
}

function protocolClient(child, rawStdout, rawStderr) {
  let buffer = '';
  let nextId = 1;
  const queue = [];
  const waiters = [];
  const pending = new Map();
  const messages = [];
  const push = (value) => {
    const waiter = waiters.shift();
    if (waiter) waiter(value);
    else queue.push(value);
  };
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    rawStdout.push({ at: new Date().toISOString(), text });
    buffer += text;
    for (;;) {
      const index = buffer.indexOf('\n');
      if (index < 0) break;
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        push({ raw: line });
        continue;
      }
      messages.push(value);
      if (value && value.id !== undefined && value.method === undefined) {
        const pendingRequest = pending.get(String(value.id));
        if (pendingRequest) {
          pending.delete(String(value.id));
          pendingRequest(value);
          continue;
        }
      }
      push(value);
    }
  });
  child.stderr.on('data', (chunk) =>
    rawStderr.push({ at: new Date().toISOString(), text: chunk.toString('utf8') })
  );
  const next = (timeoutMs = 120_000) => {
    if (queue.length > 0) return Promise.resolve(queue.shift());
    return new Promise((resolvePromise, reject) => {
      const waiter = (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      };
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`DSH JSON-RPC notification timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      waiters.push(waiter);
    });
  };
  const request = (method, params = {}, timeoutMs = 120_000) => {
    const id = String(nextId++);
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`DSH request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, (value) => {
        clearTimeout(timer);
        if (value.error) reject(new Error(value.error.message ?? `DSH ${method} failed`));
        else resolvePromise(value);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  };
  return { next, request, messages };
}

async function runRealDsh(modules) {
  const evidenceDir = join(RESULTS_ROOT, 'dsh-real-attempt');
  mkdirSync(evidenceDir, { recursive: true });
  const status = { mode: 'real-dsh', attempted: false, success: false };
  const dshRoot = resolve(
    process.env.DSH_ROOT ?? resolve(TARGET_ROOT, '../../..', 'deepseek-harness')
  );
  const experimentId = `m3-real-dsh-${Date.now().toString(36)}`;
  const sessionId = `real-dsh-session-${Date.now().toString(36)}`;
  const runId = `real-dsh-run-${Date.now().toString(36)}`;
  const scenarioDir = join(evidenceDir, 'scenario');
  mkdirSync(scenarioDir, { recursive: true });
  const setup = await createExperiment(state.controller, experimentId, 'auto', 'm3-real-dsh');
  const leaseInfo = await bindLease(modules, scenarioDir, sessionId, runId, experimentId);
  const workspace = join(evidenceDir, 'workspace');
  mkdirSync(join(workspace, 'm3'), { recursive: true });
  writeFileSync(join(workspace, 'm3/pre.txt'), 'M3 prefix fact\n');
  writeFileSync(join(workspace, 'm3/post.txt'), 'M3 post-recovery fact\n');
  const requestedDsl = graphDsl('m3_real_dsh');
  for (const node of requestedDsl.nodes) {
    if (node.tool === 'read') node.input = { file_path: node.input.path };
  }
  writeJson(join(evidenceDir, 'requested-dsl.json'), requestedDsl);
  await inject(state.controller, experimentId, 'exit');
  const rawStdout = [];
  const rawStderr = [];
  const compositionSource = join(TARGET_ROOT, 'apps/agent-worker/dsh/cordis-ao04-fastlane.yml');
  const composition = join(evidenceDir, 'cordis-resolved.yml');
  writeResolvedComposition(compositionSource, composition);
  const launch = join(TARGET_ROOT, 'apps/agent-worker/dsh/launch.mjs');
  status.attempted = true;
  status.experimentId = experimentId;
  status.sessionId = sessionId;
  status.runId = runId;
  status.setup = setup;
  status.composition = composition;
  status.compositionSource = compositionSource;
  status.dshRoot = dshRoot;
  const child = spawn(process.execPath, [launch, composition], {
    cwd: dshRoot,
    env: {
      ...process.env,
      DSH_ROOT: dshRoot,
      DSH_CORDIS_CONFIG: composition,
      DSH_CWD: workspace,
      DSH_SESSION_ROOT: join(evidenceDir, 'sessions'),
      DSH_MAX_TOKENS_AS_SUCCESS: 'false',
      DSH_SESSION_ID: sessionId,
      DSH_SNAPSHOT: 'none',
      AO04_DEMO: '1',
      AO04_BIND_DIR: leaseInfo.bindDir,
      AO04_CONTROL_URL: state.controlUrl,
      AO04_CONTROL_TOKEN: CONTROL_TOKEN,
      AO04_READ_STATUS_PLUGIN:
        process.env.AO04_READ_STATUS_PLUGIN ??
        join(RUNTIME_ROOT, 'packages/dsh-tool-ao04/dist/index.js'),
      AO04_WORKFLOW_RUN_PLUGIN:
        process.env.AO04_WORKFLOW_RUN_PLUGIN ??
        join(RUNTIME_ROOT, 'packages/dsh-tool-workflow-run/dist/index.js'),
      ...(process.env.DEEPSEEK_API_KEY ? { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY } : {}),
      ...(process.env.DEEPSEEK_BASE_URL
        ? { DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL }
        : {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const rpc = protocolClient(child, rawStdout, rawStderr);
  try {
    status.initialize = await rpc.request('initialize', {
      cwd: workspace,
      provider: process.env.DSH_PROVIDER ?? 'deepseek-official',
      model: process.env.DSH_MODEL ?? 'deepseek-v4-flash',
      maxTokens: Number.parseInt(process.env.DSH_MAX_TOKENS ?? '2048', 10),
    });
    status.prompt = await rpc.request('session/prompt', {
      sessionId,
      contentBlocks: [
        {
          type: 'text',
          text: `Call workflow_run exactly once. Set intent to "M3 recovery check". Set dsl to the JSON string encoding this object: ${JSON.stringify(
            requestedDsl
          )}. The test files already exist. Do not call other tools, edit files, run commands or contact dependency URLs. After its result, give a brief status summary.`,
        },
      ],
    });
    const messageId = status.prompt?.result?.messageId;
    const deadline = Date.now() + Number(process.env.M3_DSH_TIMEOUT_MS ?? 240_000);
    let received = false;
    let idle = false;
    while (!idle && Date.now() < deadline) {
      const notification = await rpc.next(Math.max(1, deadline - Date.now()));
      if (!received) {
        const event =
          notification?.method === 'session.event' ? notification.params?.event : undefined;
        const inserted = event?.type === 'agent/inbox/spliced' ? event.data?.inserted : undefined;
        received =
          typeof messageId === 'string' &&
          Array.isArray(inserted) &&
          inserted.some((message) => message?.id === messageId);
        if (!received) continue;
      }
      if (
        notification?.method === 'session.status' &&
        notification.params?.sessionId === sessionId &&
        notification.params?.status === 'idle'
      ) {
        idle = true;
      }
    }
    status.received = received;
    status.idle = idle;
    const controllerEvents = await readEvents(state.controller, experimentId);
    status.proof = inspectDshProof({
      messages: rpc.messages, controllerEvents, sessionId, experimentId, runId, requestedDsl,
    });
    status.success = Boolean(
      status.initialize?.result &&
        status.prompt?.result &&
        received &&
        idle &&
        status.proof.pass
    );
    status.status = status.success ? 'passed' : 'failed';
    if (!status.success)
      status.reason =
        'DSH protocol did not correlate the exact workflow_run DSL with one result and a nested AO-04 controller operation';
  } catch (error) {
    status.status = 'failed';
    status.reason = errorText(error);
  } finally {
    try {
      await rpc.request('shutdown', {}, 5_000);
    } catch {
      // Shutdown is best effort; the child is reaped below.
    }
    await stopChild(child);
    writeJson(join(evidenceDir, 'stdout-chunks.json'), rawStdout);
    writeJson(join(evidenceDir, 'stderr-chunks.json'), rawStderr);
    writeJson(join(evidenceDir, 'protocol-messages.json'), rpc.messages);
    try {
      const events = await readEvents(state.controller, experimentId);
      writeJson(join(evidenceDir, 'controller-events.json'), events);
    } catch {
      // Keep the DSH evidence even when the controller has already failed.
    }
    try {
      modules.binding.unbindSessionRun(
        sessionId,
        leaseInfo.lease.bindingGeneration,
        leaseInfo.bindDir
      );
    } catch {
      // Evidence already contains the active lease.
    }
  }
  writeJson(join(evidenceDir, 'status.json'), status);
  return status;
}

async function main() {
  mkdirSync(dirname(RESULTS_ROOT), { recursive: true });
  mkdirSync(RESULTS_ROOT, { recursive: false });
  writeJson(join(RESULTS_ROOT, 'run.json'), {
    status: 'running',
    mode: MODE,
    startedAt: new Date().toISOString(),
    targetRoot: TARGET_ROOT,
    runtimeRoot: RUNTIME_ROOT,
    controllerRoot: CONTROLLER_ROOT,
    deterministicRuntimeToolsSubstitute: true,
    realDshModelRun: MODE === 'real-dsh' || MODE === 'all',
  });
  const modules = await importModules();
  state.modulePaths = modules.paths;
  await startControl();
  try {
    if (MODE === 'deterministic' || MODE === 'all') await runDeterministic(modules);
    if (MODE === 'real-dsh' || MODE === 'all') {
      state.dsh = await runRealDsh(modules);
    }
    const failedScenarios = state.scenarios.filter((scenarioEntry) => !scenarioEntry.pass);
    if (failedScenarios.length > 0) {
      state.failures.push(...failedScenarios.map((entry) => `${entry.name}: assertion failure`));
    }
  } finally {
    await stopControl();
  }
  const dshRequired = MODE === 'real-dsh' || MODE === 'all';
  if (dshRequired && state.dsh?.status !== 'passed') {
    state.failures.push(`real DSH acceptance: ${state.dsh?.status ?? 'not attempted'}`);
  }
  const status =
    state.failures.length === 0 &&
    state.scenarios.every((entry) => entry.pass) &&
    (!dshRequired || state.dsh?.status === 'passed')
      ? 'passed'
      : 'failed';
  const summary = {
    status,
    mode: MODE,
    finishedAt: new Date().toISOString(),
    scenarios: state.scenarios,
    dsh: state.dsh,
    failures: state.failures,
    deterministicRuntimeToolsSubstitute: true,
    modulePaths: state.modulePaths,
  };
  writeJson(join(RESULTS_ROOT, 'run.json'), summary);
  writeManifest(RESULTS_ROOT);
  process.stdout.write(
    `${JSON.stringify({ status, results: RESULTS_ROOT, scenarios: state.scenarios, dsh: state.dsh?.status ?? null })}\n`
  );
  if (status !== 'passed') process.exitCode = 1;
}

main().catch((error) => {
  const failure = {
    status: 'failed',
    mode: MODE,
    error: errorText(error),
    finishedAt: new Date().toISOString(),
  };
  try {
    mkdirSync(RESULTS_ROOT, { recursive: true });
    writeJson(join(RESULTS_ROOT, 'run.json'), failure);
    writeManifest(RESULTS_ROOT);
  } catch {
    // Preserve the original failure on stderr if the evidence root cannot be written.
  }
  process.stderr.write(`${failure.error}\n`);
  process.exitCode = 1;
});
