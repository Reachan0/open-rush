// AIGC START
export async function abortAgentSession(input: {
  sessionId: string;
  runId?: string;
  fetchImpl?: typeof fetch;
  workerUrl?: string;
}): Promise<void> {
  const configured = input.workerUrl ?? process.env.DEV_AGENT_WORKER_URL?.trim();
  const base = configured || (process.env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:8787');
  if (!base || !input.sessionId) return;
  const fetchImpl = input.fetchImpl ?? fetch;
  await fetchImpl(`${base.replace(/\/$/, '')}/abort`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: input.sessionId, runId: input.runId }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => undefined);
}
// AIGC END
