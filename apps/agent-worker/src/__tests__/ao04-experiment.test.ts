// AIGC START
import { describe, expect, it, vi } from 'vitest';
import { ensureAo04Experiment } from '../ao04-experiment.js';

describe('ensureAo04Experiment', () => {
  it('reuses an existing experiment instead of creating a second one', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/experiments/exp-1') && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ experimentId: 'exp-1', status: 'ready' }), {
          status: 200,
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    const out = await ensureAo04Experiment({
      experimentId: 'exp-1',
      token: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.status).toBe('ready');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('creates when lookup is 404', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(
          JSON.stringify({ experimentId: 'exp-2', status: 'ready', baseline: 'ready' }),
          {
            status: 201,
          }
        );
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    });
    const out = await ensureAo04Experiment({
      experimentId: 'exp-2',
      token: 'secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out.experimentId).toBe('exp-2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('posts release with run and generation headers', async () => {
    const { releaseAo04Experiment } = await import('../ao04-experiment.js');
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
    await releaseAo04Experiment({
      experimentId: 'exp-release',
      token: 'secret',
      runId: 'run-release',
      bindingGeneration: 4,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, init] = fetchImpl.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers['X-AO04-Run-Id']).toBe('run-release');
    expect(headers['X-AO04-Binding-Generation']).toBe('4');
  });

  it('posts cancel with run and generation headers', async () => {
    const { cancelAo04Experiment } = await import('../ao04-experiment.js');
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ status: 'cancelled' }), { status: 200 })
    );
    await cancelAo04Experiment({
      experimentId: 'exp-9',
      token: 'secret',
      runId: 'run-9',
      bindingGeneration: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers['X-AO04-Run-Id']).toBe('run-9');
    expect(headers['X-AO04-Binding-Generation']).toBe('2');
  });

  it('aborts hanging cancel instead of waiting forever', async () => {
    const { cancelAo04Experiment } = await import('../ao04-experiment.js');
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      await new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
      return new Response('{}', { status: 200 });
    });
    await expect(
      cancelAo04Experiment({
        experimentId: 'exp-hang',
        token: 'secret',
        timeoutMs: 30,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).rejects.toThrow();
  });
});
// AIGC END
