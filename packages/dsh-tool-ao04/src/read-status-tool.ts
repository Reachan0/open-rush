// AIGC START
import { readActiveLease } from './lease.js';

export const AO04_READ_STATUS_NAME = 'ao04_read_status';

export const AO04_READ_STATUS_DESCRIPTION =
  '读取本实验受保护的本地测试状态。只传业务参数。不要猜测 PID、管理地址或注入命令。控制服务不可用时本工具失败，不要改去直连依赖。';

export interface WorkflowRunExec {
  signal?: AbortSignal;
  token?: unknown;
  agent?: { id?: string; sessionId?: string };
  callId?: string;
}

export function controlBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.AO04_CONTROL_URL ?? 'http://127.0.0.1:18080').replace(/\/$/, '');
}

export async function executeReadStatus(
  args: { query?: string },
  exec: WorkflowRunExec,
  options?: {
    fetchImpl?: typeof fetch;
    env?: Record<string, string | undefined>;
    now?: number;
  }
): Promise<{ text: string }> {
  const env = options?.env ?? process.env;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const token = env.AO04_CONTROL_TOKEN?.trim();
  if (!token) {
    throw new Error(
      'ao04_read_status unavailable: AO04_CONTROL_TOKEN missing (control service not configured)'
    );
  }
  const sessionId =
    (exec.agent && typeof exec.agent === 'object' && 'sessionId' in exec.agent
      ? String((exec.agent as { sessionId?: string }).sessionId ?? '')
      : '') ||
    env.DSH_SESSION_ID ||
    '';
  const lease = readActiveLease(sessionId, env.AO04_BIND_DIR, options?.now);
  if (!lease) {
    throw new Error('ao04_read_status unavailable: no active Run lease for this session');
  }
  const url = `${controlBaseUrl(env)}/experiments/${encodeURIComponent(lease.experimentId)}/read_status`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AO04-Token': token,
        'X-AO04-Binding-Generation': String(lease.bindingGeneration),
        'X-AO04-Run-Id': lease.runId,
      },
      body: JSON.stringify({
        operationId: exec.callId ?? 'op',
        query: args.query ?? '',
      }),
      signal: exec.signal,
    });
  } catch (err) {
    throw new Error(
      `ao04_read_status unavailable: control service unreachable (${err instanceof Error ? err.message : String(err)})`
    );
  }
  if (!response.ok) {
    throw new Error(`ao04_read_status failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  return {
    text: JSON.stringify({
      ...payload,
      runId: lease.runId,
      bindingGeneration: lease.bindingGeneration,
    }),
  };
}

export function ao04ReadStatusToolDefinition<T>(
  defineTool: (options: {
    name: string;
    description: string;
    timeoutMs: number;
    parameters: { query: { type: 'string'; required: boolean; description: string } };
    output: {
      schema: {
        type: 'object';
        additionalProperties: false;
        properties: { text: { type: 'string'; required: true } };
      };
      render: (
        args: { query?: string },
        value: { text: string }
      ) => Array<{ type: 'text'; text: string }>;
    };
    execute: (args: { query?: string }, exec: WorkflowRunExec) => Promise<{ text: string }>;
  }) => T,
  options?: { fetchImpl?: typeof fetch; env?: Record<string, string | undefined> }
): T {
  return defineTool({
    name: AO04_READ_STATUS_NAME,
    description: AO04_READ_STATUS_DESCRIPTION,
    timeoutMs: 120_000,
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: '本地状态查询说明，不要填 runId 或 PID。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    execute: (args, exec) => executeReadStatus(args, exec, options),
  });
}
// AIGC END
