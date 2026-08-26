// AIGC START
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chatCompletionsConfigured,
  completeWithChatCompletions,
  llmCompleteFromEnv,
} from '../complete-llm.js';

describe('complete-llm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects a configured chat-completions gateway', () => {
    expect(chatCompletionsConfigured({})).toBe(false);
    expect(
      chatCompletionsConfigured({
        DEEPSEEK_API_KEY: 'k',
        DEEPSEEK_BASE_URL: 'https://example.test/aigw/v1',
      })
    ).toBe(true);
  });

  it('stays offline under Vitest even when keys are present', () => {
    expect(
      llmCompleteFromEnv({
        VITEST: 'true',
        DEEPSEEK_API_KEY: 'k',
        DEEPSEEK_BASE_URL: 'https://example.test/aigw/v1',
      })
    ).toBeUndefined();
  });

  it('returns a complete fn when configured outside Vitest', () => {
    const complete = llmCompleteFromEnv({
      DEEPSEEK_API_KEY: 'k',
      DEEPSEEK_BASE_URL: 'https://example.test/aigw/v1',
    });
    expect(complete).toBeTypeOf('function');
  });

  it('posts the planner prompt to /chat/completions', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        ({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"version":"1","nodes":[]}' } }],
          }),
        }) as Response
    );
    vi.stubGlobal('fetch', fetchMock);

    const text = await completeWithChatCompletions('plan this', {
      DEEPSEEK_API_KEY: 'k',
      DEEPSEEK_BASE_URL: 'https://example.test/aigw/v1',
      DSH_MODEL: 'DeepSeek-V4-Flash-INT8',
    });
    expect(text).toContain('"version"');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/aigw/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );
    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('DeepSeek-V4-Flash-INT8');
    expect(body.messages[1].content).toBe('plan this');
  });

  it('times out a hung completions call', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          })
      )
    );
    const pending = completeWithChatCompletions(
      'plan this',
      {
        DEEPSEEK_API_KEY: 'k',
        DEEPSEEK_BASE_URL: 'https://example.test/aigw/v1',
      },
      { timeoutMs: 40 }
    );
    const expectReject = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(50);
    await expectReject;
    vi.useRealTimers();
  });
});
// AIGC END
