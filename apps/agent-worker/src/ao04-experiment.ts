// AIGC START
export interface EnsureAo04ExperimentInput {
  experimentId: string;
  mode?: string;
  taskId?: string;
  controlUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  createIfMissing?: boolean;
}

export async function ensureAo04Experiment(input: EnsureAo04ExperimentInput): Promise<{
  experimentId: string;
  status: string;
}> {
  const token = input.token?.trim();
  if (!token) {
    throw new Error('AO04_CONTROL_TOKEN missing (control service not configured)');
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = (input.controlUrl ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
  const headers = {
    'Content-Type': 'application/json',
    'X-AO04-Token': token,
  };
  const getUrl = `${base}/experiments/${encodeURIComponent(input.experimentId)}`;
  const existing = await fetchImpl(getUrl, { headers });
  if (existing.ok) {
    return (await existing.json()) as { experimentId: string; status: string };
  }
  if (existing.status !== 404 || input.createIfMissing === false) {
    throw new Error(`ao04 experiment lookup failed: HTTP ${existing.status}`);
  }
  const created = await fetchImpl(`${base}/experiments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      experimentId: input.experimentId,
      mode: input.mode ?? 'auto',
      taskId: input.taskId ?? 'baseline',
    }),
  });
  const body = (await created.json().catch(() => ({}))) as {
    error?: string;
    status?: string;
    experimentId?: string;
    baseline?: string;
  };
  if (created.status === 409 && body.error === 'experiment exists') {
    const retry = await fetchImpl(getUrl, { headers });
    if (!retry.ok) throw new Error(`ao04 experiment exists but GET failed: HTTP ${retry.status}`);
    return (await retry.json()) as { experimentId: string; status: string };
  }
  if (!created.ok) {
    throw new Error(
      `ao04 experiment setup_failed: ${body.error ?? body.baseline ?? `HTTP ${created.status}`}`
    );
  }
  return {
    experimentId: body.experimentId ?? input.experimentId,
    status: body.status ?? 'ready',
  };
}

export interface ReleaseAo04ExperimentInput {
  experimentId: string;
  controlUrl?: string;
  token?: string;
  runId: string;
  bindingGeneration: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function releaseAo04Experiment(input: ReleaseAo04ExperimentInput): Promise<void> {
  const token = input.token?.trim();
  if (!token) throw new Error('AO04_CONTROL_TOKEN missing (control service not configured)');
  const base = (input.controlUrl ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${base}/experiments/${encodeURIComponent(input.experimentId)}/release`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AO04-Token': token,
        'X-AO04-Run-Id': input.runId,
        'X-AO04-Binding-Generation': String(input.bindingGeneration),
      },
      signal: AbortSignal.timeout(input.timeoutMs ?? 1500),
    }
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`ao04 release failed: HTTP ${response.status}`);
  }
}

export interface CancelAo04ExperimentInput {
  experimentId: string;
  controlUrl?: string;
  token?: string;
  runId?: string;
  bindingGeneration?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function cancelAo04Experiment(input: CancelAo04ExperimentInput): Promise<void> {
  const token = input.token?.trim();
  if (!token) {
    throw new Error('AO04_CONTROL_TOKEN missing (control service not configured)');
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = (input.controlUrl ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-AO04-Token': token,
  };
  if (input.runId) headers['X-AO04-Run-Id'] = input.runId;
  if (input.bindingGeneration !== undefined) {
    headers['X-AO04-Binding-Generation'] = String(input.bindingGeneration);
  }
  const response = await fetchImpl(
    `${base}/experiments/${encodeURIComponent(input.experimentId)}/cancel`,
    {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(input.timeoutMs ?? 1500),
    }
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`ao04 cancel failed: HTTP ${response.status}`);
  }
}
// AIGC END
