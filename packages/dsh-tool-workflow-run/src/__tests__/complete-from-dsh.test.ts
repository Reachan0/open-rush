// AIGC START
import { describe, expect, it, vi } from 'vitest';
import {
  completeFromDshLlm,
  type DshLlmLike,
  resolveDshPlannerRoute,
} from '../complete-from-dsh.js';

describe('completeFromDshLlm', () => {
  it('uses prose instructions for compose and propagates cancellation to the model', async () => {
    const abort = new AbortController();
    let seen: Parameters<DshLlmLike['stream']>[0] | undefined;
    const llm: DshLlmLike = {
      stream: async function* (options) {
        seen = options;
        yield { type: 'text-delta', text: 'A concise answer' };
      },
    };
    const complete = completeFromDshLlm(llm, { DSH_MODEL: 'm' });
    await complete('write', { purpose: 'compose', signal: abort.signal });
    expect(seen?.system).not.toContain('single JSON');
    expect(seen?.signal).toBeDefined();
    abort.abort();
    expect(seen?.signal?.aborted).toBe(true);
  });

  it('bounds a model stream that never yields even when it ignores abort', async () => {
    vi.useFakeTimers();
    try {
      const llm: DshLlmLike = {
        stream: () => ({
          [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
        }),
      };
      const complete = completeFromDshLlm(llm, { DSH_MODEL: 'm', WORKFLOW_LLM_TIMEOUT_MS: '50' });
      const pending = expect(complete('plan')).rejects.toThrow(/timeout/i);
      await vi.advanceTimersByTimeAsync(51);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it('picks env model over catalog', async () => {
    const llm: DshLlmLike = {
      listProviders: () => [{ id: 'deepseek-official' }],
      listModels: async () => [{ id: 'ignored' }],
      stream: async function* () {},
    };
    await expect(
      resolveDshPlannerRoute(llm, { DSH_MODEL: 'DeepSeek-V4-Flash-INT8' })
    ).resolves.toEqual({
      provider: 'deepseek-official',
      model: 'DeepSeek-V4-Flash-INT8',
    });
  });

  it('collects text-delta chunks from ctx.llm.stream', async () => {
    const llm: DshLlmLike = {
      listProviders: () => [{ id: 'deepseek-official' }],
      listModels: async () => [{ id: 'm1' }],
      stream: async function* () {
        yield { type: 'text-delta', text: '{"version":"1"' };
        yield { type: 'text-delta', text: '}' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    };
    const complete = completeFromDshLlm(llm);
    await expect(complete('plan')).resolves.toBe('{"version":"1"}');
  });

  it('surfaces a stream error finish', async () => {
    const llm: DshLlmLike = {
      listProviders: () => [{ id: 'deepseek-official' }],
      listModels: async () => [{ id: 'm1' }],
      stream: async function* () {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'no key' } } };
      },
    };
    const complete = completeFromDshLlm(llm);
    await expect(complete('plan')).rejects.toThrow(/no key/);
  });
});
// AIGC END
