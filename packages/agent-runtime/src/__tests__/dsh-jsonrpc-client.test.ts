// AIGC START
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { DshJsonRpcClient, DshRequestTimeoutError } from '../dsh-jsonrpc-client.js';
import type { DshLaunchSpec } from '../dsh-types.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

function launch(): DshLaunchSpec {
  return {
    command: 'unused',
    args: [],
    cwd: process.cwd(),
    binPath: 'unused',
    cordisPath: 'unused',
    repoRoot: process.cwd(),
  };
}

type FakeChild = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill: ReturnType<typeof vi.fn>;
};

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn(() => true);
  return child;
}

describe('DshJsonRpcClient request lifecycle', () => {
  it('rejects a request after the configured timeout and ignores a late response', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    try {
      const client = new DshJsonRpcClient(launch(), process.env, { requestTimeoutMs: 100 });
      client.start();
      const pending = client.initialize({ cwd: process.cwd(), provider: 'test', model: 'test' });
      const rejected = expect(pending).rejects.toBeInstanceOf(DshRequestTimeoutError);
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      child.stdout.write('{"jsonrpc":"2.0","id":"unknown","result":{}}\n');
      const closing = client.close();
      await vi.advanceTimersByTimeAsync(1_000);
      child.exitCode = 0;
      child.signalCode = null;
      child.emit('exit', 0);
      await closing;
    } finally {
      vi.mocked(spawn).mockReset();
      vi.useRealTimers();
    }
  });

  it('rejects business requests after close while allowing shutdown internally', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    try {
      const client = new DshJsonRpcClient(launch(), process.env, { requestTimeoutMs: 100 });
      client.start();
      const closing = client.close();
      await expect(
        client.initialize({ cwd: process.cwd(), provider: 'test', model: 'test' })
      ).rejects.toThrow('runtime closed');
      await vi.advanceTimersByTimeAsync(1_000);
      child.exitCode = 0;
      child.signalCode = null;
      child.emit('exit', 0);
      await closing;
    } finally {
      vi.mocked(spawn).mockReset();
      vi.useRealTimers();
    }
  });
});
// AIGC END
