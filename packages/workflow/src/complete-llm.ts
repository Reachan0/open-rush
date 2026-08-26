// AIGC START
import { WorkflowError } from './types.js';

type LlmComplete = (prompt: string) => Promise<string>;

export function chatCompletionsConfigured(
  env: Record<string, string | undefined> = process.env
): boolean {
  return Boolean(env.DEEPSEEK_API_KEY && env.DEEPSEEK_BASE_URL);
}

function completionsUrl(baseURL: string): string {
  const base = baseURL.replace(/\/$/, '');
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

/**
 * One-shot planner call against an OpenAI-compatible chat completions gateway.
 * Reads DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DSH_MODEL from the environment.
 */
export async function completeWithChatCompletions(
  prompt: string,
  env: Record<string, string | undefined> = process.env,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<string> {
  const apiKey = env.DEEPSEEK_API_KEY;
  const baseURL = env.DEEPSEEK_BASE_URL;
  const model = env.DSH_MODEL ?? 'DeepSeek-V4-Flash-INT8';
  if (!apiKey || !baseURL) {
    throw new WorkflowError('generate_failed', 'DEEPSEEK_API_KEY or DEEPSEEK_BASE_URL is not set');
  }
  const timeoutMs = options?.timeoutMs ?? 45_000;
  const ac = new AbortController();
  const onParentAbort = () => ac.abort(options?.signal?.reason);
  if (options?.signal?.aborted) {
    throw new WorkflowError('generate_failed', 'chat completions aborted');
  }
  options?.signal?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const response = await fetch(completionsUrl(baseURL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: ac.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are a workflow planner. Reply with a single JSON object and nothing else.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new WorkflowError(
        'generate_failed',
        `chat completions ${response.status}: ${body.slice(0, 300)}`
      );
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new WorkflowError('generate_failed', 'chat completions returned empty content');
    }
    return content;
  } catch (err) {
    if (ac.signal.aborted) {
      throw new WorkflowError('generate_failed', `chat completions timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener('abort', onParentAbort);
  }
}

/** Used by agent-worker. Disabled under Vitest so unit tests stay offline. */
export function llmCompleteFromEnv(
  env: Record<string, string | undefined> = process.env
): LlmComplete | undefined {
  if (env.VITEST) return undefined;
  if (!chatCompletionsConfigured(env)) return undefined;
  return (prompt) => completeWithChatCompletions(prompt, env);
}
// AIGC END
