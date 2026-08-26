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
