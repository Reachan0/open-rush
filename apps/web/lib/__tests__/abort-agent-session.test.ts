// AIGC START
import { describe, expect, it, vi } from 'vitest';
import { abortAgentSession } from '../abort-agent-session';

describe('abortAgentSession', () => {
  it('posts /abort with the worker session id', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ aborted: true }), { status: 200 })
    );
    await abortAgentSession({
      sessionId: 'task-1',
      runId: 'run-1',
      workerUrl: 'http://127.0.0.1:8787',
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8787/abort');
    expect(JSON.parse(String(init?.body))).toEqual({ sessionId: 'task-1', runId: 'run-1' });
  });
});
// AIGC END
