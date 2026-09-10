// AIGC START
import { describe, expect, it } from 'vitest';
import {
  completeFromDshLlm,
  type DshLlmLike,
  resolveDshPlannerRoute,
} from '../complete-from-dsh.js';

describe('completeFromDshLlm', () => {
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
