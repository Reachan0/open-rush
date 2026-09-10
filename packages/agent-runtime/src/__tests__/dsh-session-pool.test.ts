// AIGC START
import { describe, expect, it, vi } from 'vitest';
import { type DshPooledClient, DshSessionPool } from '../dsh-session-pool.js';
import type { DshInitializeParams, DshNotification, DshRunInput } from '../dsh-types.js';

function input(sessionId: string): DshRunInput {
  return { prompt: 'hi', sessionId };
}

function fakeClient(): DshPooledClient & { initializeCalls: number; closed: boolean } {
  const client = {
    initializeCalls: 0,
    closed: false,
    isAlive() {
      return !client.closed;
    },
    start() {},
    async initialize(_params: DshInitializeParams) {
      client.initializeCalls += 1;
    },
    async prompt() {
      return 'msg-1';
    },
    nextNotification(): Promise<DshNotification> {
      return Promise.resolve({ method: 'session.status', params: { status: 'idle' } });
    },
    async close() {
      client.closed = true;
    },
  };
  return client;
}

describe('DshSessionPool', () => {
  it('passes the configured output budget to DSH initialize', async () => {
    vi.stubEnv('DSH_MAX_TOKENS', '4096');
    try {
      const client = fakeClient();
      const initialize = vi.spyOn(client, 'initialize');
      const pool = new DshSessionPool(() => client);
      await pool.acquire(input('budget'));
      expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 4096 }));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('reuses a live client for the same sessionId and initializes once', async () => {
    const created: DshPooledClient[] = [];
    const pool = new DshSessionPool(() => {
      const client = fakeClient();
      created.push(client);
      return client;
    });

    const first = await pool.acquire(input('task-1'));
    const second = await pool.acquire(input('task-1'));

    expect(second).toBe(first);
    expect(created).toHaveLength(1);
    expect((first as ReturnType<typeof fakeClient>).initializeCalls).toBe(1);
  });

  it('closes a client whose initialization fails and does not retain it', async () => {
    const failed = fakeClient();
    failed.initialize = async () => {
      throw new Error('initialize failed');
    };
    const healthy = fakeClient();
    const clients = [failed, healthy];
    const pool = new DshSessionPool(() => {
      const client = clients.shift();
      if (!client) throw new Error('unexpected client creation');
      return client;
    });

    await expect(pool.acquire(input('task-1'))).rejects.toThrow('initialize failed');
    expect(failed.closed).toBe(true);

    await expect(pool.acquire(input('task-1'))).resolves.toBe(healthy);
  });

  it('closes and does not retain a client when cancellation occurs during initialization', async () => {
    let finishInitialize: (() => void) | undefined;
    const cancelled = fakeClient();
    cancelled.initialize = async () => {
      await new Promise<void>((resolve) => {
        finishInitialize = resolve;
      });
    };
    const healthy = fakeClient();
    const clients = [cancelled, healthy];
    const pool = new DshSessionPool(() => {
      const client = clients.shift();
      if (!client) throw new Error('unexpected client creation');
      return client;
    });
    const controller = new AbortController();
    const acquire = pool.acquire({ ...input('task-1'), abortSignal: controller.signal });

    controller.abort();
    finishInitialize?.();

    await expect(acquire).rejects.toThrow('aborted');
    expect(cancelled.closed).toBe(true);
    await expect(pool.acquire(input('task-1'))).resolves.toBe(healthy);
  });

  it('rejects an acquire already cancelled before creating a client', async () => {
    const factory = vi.fn(() => fakeClient());
    const pool = new DshSessionPool(factory);
    const controller = new AbortController();
    controller.abort();

    await expect(
      pool.acquire({ ...input('task-1'), abortSignal: controller.signal })
    ).rejects.toThrow('aborted');
    expect(factory).not.toHaveBeenCalled();
  });

  it('starts a new client after the previous process dies', async () => {
    const created: DshPooledClient[] = [];
    const pool = new DshSessionPool(() => {
      const client = fakeClient();
      created.push(client);
      return client;
    });

    const first = await pool.acquire(input('task-1'));
    await first.close();
    const second = await pool.acquire(input('task-1'));

    expect(second).not.toBe(first);
    expect(created).toHaveLength(2);
    expect(second.isAlive()).toBe(true);
  });

  it('keeps different conversations on different engine processes', async () => {
    const pool = new DshSessionPool(() => fakeClient());
    const a = await pool.acquire(input('task-a'));
    const b = await pool.acquire(input('task-b'));
    expect(a).not.toBe(b);
  });

  it('drops a session so the next acquire creates a fresh client', async () => {
    const created: DshPooledClient[] = [];
    const pool = new DshSessionPool(() => {
      const client = fakeClient();
      created.push(client);
      return client;
    });
    const first = await pool.acquire(input('task-1'));
    await pool.drop('task-1');
    expect(first.isAlive()).toBe(false);
    const second = await pool.acquire(input('task-1'));
    expect(second).not.toBe(first);
    expect(created).toHaveLength(2);
  });
});

describe('DshSessionPool idle eviction', () => {
  it('does not evict while a turn holds the session, then closes after release ttl', async () => {
    vi.useFakeTimers();
    const pool = new DshSessionPool(() => fakeClient(), { idleMs: 1_000 });
    const client = await pool.acquire(input('task-idle'));
    await vi.advanceTimersByTimeAsync(1_001);
    expect(client.isAlive()).toBe(true);
    pool.release('task-idle');
    await vi.advanceTimersByTimeAsync(1_001);
    expect(client.isAlive()).toBe(false);
    vi.useRealTimers();
  });
});
// AIGC END
