import { createLogger } from '@open-rush/observability';

const logger = createLogger({ service: 'web:health-api' });

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function getProviderBackend(): string {
  if (isTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)) return 'bedrock';
  if (process.env.ANTHROPIC_BASE_URL) return 'custom';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'unknown';
}

// AIGC START
function getAgentRuntime(): string {
  const raw = (process.env.AGENT_RUNTIME ?? 'dsh').trim().toLowerCase();
  if (raw === 'claude-code' || raw === 'claude' || raw === 'cc') return 'claude-code';
  return 'dsh';
}

async function resolveAgentRuntime(): Promise<string> {
  if (process.env.VITEST) return getAgentRuntime();
  const workerUrl = process.env.AGENT_WORKER_URL ?? 'http://127.0.0.1:8787';
  try {
    const res = await fetch(`${workerUrl}/health`, { signal: AbortSignal.timeout(800) });
    if (res.ok) {
      const json = (await res.json()) as { runtime?: string };
      if (json.runtime === 'claude-code' || json.runtime === 'dsh') return json.runtime;
    }
  } catch {
    // Fall back to local env when the worker is down.
  }
  return getAgentRuntime();
}
// AIGC END

export async function GET(request: Request) {
  const requestId = request.headers.get('x-request-id') || `health-${Date.now()}`;
  const provider = getProviderBackend();
  const runtime = await resolveAgentRuntime();

  logger.debug({ requestId, provider, runtime }, '❤️ Health check');

  return Response.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'lux-web',
    provider,
    runtime,
  });
}
