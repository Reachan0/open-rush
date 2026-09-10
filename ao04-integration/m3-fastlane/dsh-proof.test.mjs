import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectDshProof } from './dsh-proof.mjs';

function fixture() {
  const requestedDsl = { version: '1', name: 'm3_real_dsh', nodes: [
    { id: 'pre', tool: 'read', input: { file_path: 'm3/pre.txt' } },
    { id: 'protected', tool: 'ao04_read_status', dependsOn: ['pre'], input: { query: 'check' } },
    { id: 'post', tool: 'read', dependsOn: ['protected'], input: { file_path: 'm3/post.txt' } },
  ] };
  const fact = { status: 'ok', degraded: false, dependencyRecovered: true,
    data: { ready: true, service: 'ao04-local' }, runId: 'run-1',
    operationId: 'call-1:wf:2', incidentId: 'incident-1' };
  const dag = { name: requestedDsl.name, nodes: requestedDsl.nodes.map(
    (n) => ({ id: n.id, tool: n.tool, dependsOn: n.dependsOn ?? [] })) };
  const ev = (type, data) => ({ method: 'session.event', params: {
    sessionId: 'session-1', event: { type, data },
  } });
  const messages = [
    ev('tool/call', { name: 'workflow_run', callId: 'call-1',
      arguments: JSON.stringify({ dsl: JSON.stringify(requestedDsl) }) }),
    ev('tool/result', { message: { source: { callId: 'call-1' }, content: [
      { type: 'tool-result', isError: false, content: [{ type: 'text', text:
        `### protected (ao04_read_status)\n${JSON.stringify(fact)}\nOPENRUSH_WORKFLOW_DAG:${JSON.stringify(dag)}` }] },
    ] } }),
    ev('turn/end', { reason: { kind: 'completed' } }),
  ];
  const controllerEvents = [
    { type: 'baseline.sample', payload: { reason: 'deploy', pid: 123 } },
    { type: 'incident.detected', payload: { errorClass: 'process_exit' } },
    { type: 'incident.action', payload: { reason: 'repair', pid: 124 } },
    ...Array.from({ length: 3 }, () => ({ type: 'incident.verify',
      payload: { healthOk: true, businessOk: true, owned: true } })),
    { type: 'incident.terminal', payload: { status: 'ok' } },
  ].map((e, i) => ({ ...e, experimentId: 'exp-1', eventId: `event-${i}`,
    sourceSeq: i + 1, ...(i ? { incidentId: 'incident-1', operationId: 'call-1:wf:2' } : {}) }));
  return { messages, controllerEvents, requestedDsl, sessionId: 'session-1',
    experimentId: 'exp-1', runId: 'run-1' };
}

test('raw correlated recovery evidence passes', () => {
  assert.equal(inspectDshProof(fixture()).pass, true);
});

for (const [name, mutate] of [
  ['missing independent events', (f) => { f.controllerEvents = []; }],
  ['wrong experiment', (f) => { f.controllerEvents[1].experimentId = 'other'; }],
  ['missing call IDs', (f) => {
    delete f.messages[0].params.event.data.callId;
    delete f.messages[1].params.event.data.message.source.callId;
  }],
  ['duplicate call', (f) => { f.messages.push(structuredClone(f.messages[0])); }],
  ['wrong session', (f) => { f.messages[0].params.sessionId = 'other'; }],
  ['wrong DSL', (f) => { f.requestedDsl.nodes[0].input.file_path = 'different'; }],
  ['failed business probe', (f) => { f.controllerEvents[4].payload.businessOk = false; }],
  ['same PID', (f) => { f.controllerEvents[2].payload.pid = 123; }],
  ['unrelated operation', (f) => { f.controllerEvents[1].operationId = 'another:wf:2'; }],
  ['substring masquerading as fact', (f) => {
    f.messages[1].params.event.data.message.content[0].content[0].text =
      'ao04-local "status" OPENRUSH_WORKFLOW_DAG:';
  }],
  ['tool error', (f) => { f.messages[1].params.event.data.message.content[0].isError = true; }],
  ['max token stop', (f) => { f.messages[2].params.event.data.reason.kind = 'max_tokens'; }],
]) {
  test(`rejects ${name}`, () => {
    const f = fixture(); mutate(f);
    assert.equal(inspectDshProof(f).pass, false);
  });
}
