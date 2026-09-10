// AIGC START
import { describe, expect, it, vi } from 'vitest';
import { DshRequestTimeoutError } from '../dsh-jsonrpc-client.js';
import { runDshToUIMessageStream } from '../dsh-runtime.js';
import { type DshPooledClient, DshSessionPool } from '../dsh-session-pool.js';
import type { DshInitializeParams, DshNotification, DshRunInput } from '../dsh-types.js';

type FakeClient = DshPooledClient & {
  closed: boolean;
  notificationCalls: number;
};

function inboxReceipt(sessionId: string, messageId = 'message-1'): DshNotification {
  return {
    method: 'session.event',
    params: {
      sessionId,
      event: {
        type: 'agent/inbox/spliced',
        data: { inserted: [{ id: messageId }] },
      },
    },
  };
}

function idle(sessionId: string): DshNotification {
  return { method: 'session.status', params: { sessionId, status: 'idle' } };
}

function fakeClient(notifications: Array<DshNotification | Promise<DshNotification>>): FakeClient {
  const client = {
    closed: false,
    notificationCalls: 0,
    isAlive() {
      return !client.closed;
    },
    start() {},
    async initialize(_params: DshInitializeParams) {},
    async prompt() {
      return 'message-1';
    },
    nextNotification(): Promise<DshNotification> {
      client.notificationCalls += 1;
      return Promise.resolve(notifications.shift() ?? new Promise<DshNotification>(() => {}));
    },
    async close() {
      client.closed = true;
    },
  };
  return client;
}

function input(sessionId: string): DshRunInput {
  return { prompt: 'hello', sessionId };
}

async function readStream(response: Response): Promise<string> {
  return response.text();
}

describe('runDshToUIMessageStream cancellation', () => {
  it('does not prompt when the signal aborts after acquire resolves', async () => {
    const controller = new AbortController();
    const client = fakeClient([]);
    const prompt = vi.spyOn(client, 'prompt');
    const drop = vi.fn(async () => {});
    const pool = {
      acquire: async () => {
        controller.abort();
        return client;
      },
      drop,
      release: vi.fn(),
    } as unknown as DshSessionPool;

    const body = await readStream(
      runDshToUIMessageStream({ ...input('cancelled'), abortSignal: controller.signal }, { pool })
    );

    expect(prompt).not.toHaveBeenCalled();
    expect(drop).toHaveBeenCalledWith('cancelled');
    expect(body).toContain('"errorText":"aborted"');
  });
});

describe('runDshToUIMessageStream notification timeout', () => {
  it('drops a live session when the prompt request itself times out', async () => {
    const client = fakeClient([]);
    vi.spyOn(client, 'prompt').mockRejectedValue(new DshRequestTimeoutError('session/prompt', 100));
    const drop = vi.fn(async () => {
      client.closed = true;
    });
    const pool = {
      acquire: async () => client,
      drop,
      release: vi.fn(),
    } as unknown as DshSessionPool;

    const body = await readStream(runDshToUIMessageStream(input('request-timeout'), { pool }));

    expect(body).toContain('request timed out: session/prompt');
    expect(drop).toHaveBeenCalledWith('request-timeout');
    expect(client.closed).toBe(true);
  });

  it('emits a clear error and drops a session when notifications never arrive', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient([]);
      const pool = new DshSessionPool(() => client);
      const body = readStream(
        runDshToUIMessageStream(input('timed-out'), { pool, notificationTimeoutMs: 100 })
      );

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      await expect(body).resolves.toContain('DeepSeek Harness notification timeout');
      expect(client.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops only the timed-out session so its next turn acquires a fresh client', async () => {
    vi.useFakeTimers();
    try {
      const first = fakeClient([]);
      const second = fakeClient([inboxReceipt('retry'), idle('retry')]);
      const created = [first, second];
      const pool = new DshSessionPool(() => {
        const client = created.shift();
        if (!client) throw new Error('unexpected client creation');
        return client;
      });
      const timedOut = readStream(
        runDshToUIMessageStream(input('retry'), { pool, notificationTimeoutMs: 100 })
      );

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      await timedOut;
      const retry = await readStream(
        runDshToUIMessageStream(input('retry'), { pool, notificationTimeoutMs: 100 })
      );

      expect(first.closed).toBe(true);
      expect(retry).toContain('"type":"finish"');
      expect(retry).not.toContain('"type":"error"');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let notifications for another session extend this session timeout', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient([
        inboxReceipt('another-session'),
        new Promise<DshNotification>(() => {}),
      ]);
      const pool = new DshSessionPool(() => client);
      const body = readStream(
        runDshToUIMessageStream(input('current-session'), { pool, notificationTimeoutMs: 100 })
      );

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      await expect(body).resolves.toContain('session current-session');
      expect(client.notificationCalls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns to the normal timeout after the matching tool result arrives', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient([
        inboxReceipt('tool-result-session'),
        {
          method: 'session.event',
          params: {
            sessionId: 'tool-result-session',
            event: { type: 'tool/call', data: { callId: 'call-1', name: 'bash' } },
          },
        },
        {
          method: 'session.event',
          params: {
            sessionId: 'tool-result-session',
            event: {
              type: 'tool/result',
              data: { message: { source: { callId: 'call-1' } } },
            },
          },
        },
      ]);
      const pool = new DshSessionPool(() => client);
      const body = readStream(
        runDshToUIMessageStream(input('tool-result-session'), {
          pool,
          notificationTimeoutMs: 100,
          toolNotificationTimeoutMs: 300,
        })
      );

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      await expect(body).resolves.toContain('for 100ms in session tool-result-session');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the longer timeout only while a current-session tool call is pending', async () => {
    vi.useFakeTimers();
    try {
      const client = fakeClient([
        inboxReceipt('tool-session'),
        {
          method: 'session.event',
          params: {
            sessionId: 'tool-session',
            event: { type: 'tool/call', data: { callId: 'call-1', name: 'bash' } },
          },
        },
      ]);
      const pool = new DshSessionPool(() => client);
      const body = readStream(
        runDshToUIMessageStream(input('tool-session'), {
          pool,
          notificationTimeoutMs: 100,
          toolNotificationTimeoutMs: 300,
        })
      );

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(client.closed).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      await expect(body).resolves.toContain('for 300ms in session tool-session');
    } finally {
      vi.useRealTimers();
    }
  });
});
// AIGC END
