import { isDeepStrictEqual } from 'node:util';

export function toolResultText(event) {
  const blocks = [
    ...(event?.data?.content ?? []),
    ...(event?.data?.message?.content ?? []),
  ];
  return blocks.flatMap((block) => block?.type === 'text' ? [block.text] :
    block?.type === 'tool-result' ? (block.content ?? []).filter(
      (item) => item.type === 'text').map((item) => item.text) : []).join('\n');
}

export function inspectDshProof({ messages, controllerEvents, sessionId, experimentId, runId, requestedDsl }) {
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
  check(nonempty(sessionId) && nonempty(experimentId) && nonempty(runId), 'missing session/experiment/run identity');
  const events = messages.filter((m) =>
    m.method === 'session.event' && m.params?.sessionId === sessionId
  ).map((m) => m.params.event);
  const calls = events.filter((e) => e.type === 'tool/call');
  const inputs = calls.filter((e) => e.data?.name === 'workflow_run');
  check(inputs.length === 1 && calls.length === 1, 'expected exactly one outer workflow_run call');
  const id = inputs[0]?.data?.callId;
  check(nonempty(id), 'missing workflow call ID');
  const outputs = events.filter((e) => nonempty(id) && e.type === 'tool/result' &&
    (e.data?.callId ?? e.data?.message?.source?.callId) === id);
  check(outputs.length === 1, 'expected exactly one matching workflow result');
  let calledDsl;
  try {
    const args = typeof inputs[0]?.data?.arguments === 'string'
      ? JSON.parse(inputs[0].data.arguments) : inputs[0]?.data?.arguments;
    calledDsl = typeof args?.dsl === 'string' ? JSON.parse(args.dsl) : args?.dsl;
  } catch { /* Missing/invalid DSL fails below. */ }
  check(Boolean(requestedDsl) && isDeepStrictEqual(calledDsl, requestedDsl), 'requested DSL differs from actual tool call');
  const output = outputs[0];
  const blocks = output?.data?.message?.content ?? output?.data?.content ?? [];
  check(Boolean(output) && output.data?.isError !== true &&
    !blocks.some((b) => b.isError === true), 'workflow returned a tool error');
  const text = toolResultText(output);
  let dag, fact;
  try {
    dag = JSON.parse(text.split('\n').find((s) => s.startsWith('OPENRUSH_WORKFLOW_DAG:'))
      ?.slice('OPENRUSH_WORKFLOW_DAG:'.length) ?? '');
  } catch { /* Fail closed below. */ }
  try {
    fact = JSON.parse(text.split('### protected (ao04_read_status)\n')[1]?.split('\n')[0] ?? '');
  } catch { /* A string containing "status" is not evidence. */ }
  const expectedDag = requestedDsl && {
    name: requestedDsl.name,
    nodes: requestedDsl.nodes.map((n) => ({ id: n.id, tool: n.tool, dependsOn: n.dependsOn ?? [] })),
  };
  check(Boolean(dag) && isDeepStrictEqual(dag, expectedDag), 'missing or failed DAG');
  check(fact?.status === 'ok' && fact?.data?.ready === true &&
    fact?.data?.service === 'ao04-local' && fact?.degraded === false &&
    fact?.dependencyRecovered === true && fact?.runId === runId &&
    fact?.operationId === `${id}:wf:2` && nonempty(fact?.incidentId),
  'missing successful protected recovery fact with matching operation/run');
  check(controllerEvents.length > 0, 'missing independent controller events');
  let seq = 0;
  const eventIds = new Set();
  for (const event of controllerEvents) {
    check(event.experimentId === experimentId && Number.isInteger(event.sourceSeq) &&
      event.sourceSeq > seq && nonempty(event.eventId) && !eventIds.has(event.eventId),
    'invalid controller event identity/order');
    seq = event.sourceSeq;
    eventIds.add(event.eventId);
  }
  const incidentId = fact?.incidentId;
  const incident = controllerEvents.filter((e) => nonempty(incidentId) && e.incidentId === incidentId);
  check(incident.some((e) => e.type === 'incident.detected' &&
    e.operationId === fact?.operationId && e.payload?.errorClass === 'process_exit'),
  'missing correlated process-exit detection');
  check(incident.some((e) => e.type === 'incident.terminal' &&
    e.operationId === fact?.operationId && e.payload?.status === 'ok'),
  'missing correlated recovery terminal');
  const oldPid = controllerEvents.find((e) => e.payload?.reason === 'deploy')?.payload?.pid;
  const newPid = incident.find((e) => e.type === 'incident.action' && e.payload?.reason === 'repair')?.payload?.pid;
  check(Number.isInteger(oldPid) && Number.isInteger(newPid) && oldPid !== newPid, 'missing replacement PID');
  let streak = 0, longest = 0;
  for (const event of incident) {
    if (event.type !== 'incident.verify') continue;
    streak = event.payload?.healthOk === true && event.payload?.businessOk === true &&
      event.payload?.owned === true ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  check(longest >= 3, 'missing three consecutive recovery verifications');
  check(events.some((e) => e.type === 'turn/end' && e.data?.reason?.kind === 'completed'),
    'DSH turn did not complete');
  return { pass: failures.length === 0, failures, workflowCallId: id,
    nestedProtectedOperationId: fact?.operationId, oldPid, newPid, recoveryStreak: longest };
}
