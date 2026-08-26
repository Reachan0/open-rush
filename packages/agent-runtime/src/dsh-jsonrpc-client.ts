// AIGC START
import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';
import type { DshInitializeParams, DshLaunchSpec, DshNotification } from './dsh-types.js';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class DshJsonRpcClient {
  private child: ChildProcess | undefined;
  private buffer = '';
  private closed = false;
  private readonly pending = new Map<string, Pending>();
  private readonly waiters: Array<{
    resolve: (value: DshNotification) => void;
    reject: (error: Error) => void;
  }> = [];
  private readonly queue: DshNotification[] = [];
  private failure: Error | undefined;

  constructor(
    private readonly launch: DshLaunchSpec,
    private readonly env: NodeJS.ProcessEnv
  ) {}

  isAlive(): boolean {
    const child = this.child;
    return child != null && !this.closed && !this.failure && child.exitCode === null;
  }

  start(): void {
    if (this.child || this.closed) return;
    const child = spawn(this.launch.command, this.launch.args, {
      cwd: this.launch.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdin?.on('error', () => {});
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) console.error(`[dsh-runtime] ${line}`);
      }
    });
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    child.once('exit', (code) => {
      this.failAll(new Error(`DeepSeek Harness runtime exited with code ${code ?? 'null'}`));
    });
  }

  async initialize(params: DshInitializeParams): Promise<void> {
    await this.request('initialize', params);
  }

  async prompt(sessionId: string, text: string): Promise<string> {
    const result = (await this.request('session/prompt', {
      sessionId,
      contentBlocks: [{ type: 'text', text }],
    })) as { messageId?: string };
    if (!result?.messageId) {
      throw new Error('DeepSeek Harness session/prompt returned no messageId');
    }
    return result.messageId;
  }

  nextNotification(): Promise<DshNotification> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await Promise.race([this.request('shutdown', {}), sleep(1000)]);
    } catch {
      // shutdown is best-effort; the process is reaped below
    }
    const child = this.child;
    this.child = undefined;
    if (!child) {
      this.failAll(new Error('DeepSeek Harness runtime closed'));
      return;
    }
    child.stdin?.end();
    await waitForExit(child, 2000);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await waitForExit(child, 2000);
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
    this.failAll(new Error('DeepSeek Harness runtime closed'));
  }

  private request(method: string, params: object): Promise<unknown> {
    const id = `req_${randomUUID().replaceAll('-', '')}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private write(message: Record<string, unknown>): void {
    const stdin = this.child?.stdin as Writable | null | undefined;
    if (!stdin) throw new Error('DeepSeek Harness runtime is not started');
    stdin.write(`${JSON.stringify(message)}\n`);
  }

  private drain(): void {
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let frame: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      frame = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    const id = frame.id;
    const method = frame.method;
    if ((typeof id === 'string' || typeof id === 'number') && typeof method !== 'string') {
      const pending = this.pending.get(String(id));
      if (!pending) return;
      this.pending.delete(String(id));
      if (frame.error && typeof frame.error === 'object') {
        const error = frame.error as { message?: string };
        pending.reject(new Error(error.message ?? 'JSON-RPC error'));
        return;
      }
      pending.resolve(frame.result);
      return;
    }
    if (typeof method === 'string' && id === undefined) {
      const params =
        frame.params && typeof frame.params === 'object' && !Array.isArray(frame.params)
          ? (frame.params as Record<string, unknown>)
          : {};
      this.pushNotification({ method, params });
    }
  }

  private pushNotification(notification: DshNotification): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(notification);
    else this.queue.push(notification);
  }

  private failAll(error: Error): void {
    this.failure ??= error;
    for (const pending of this.pending.values()) pending.reject(this.failure);
    this.pending.clear();
    for (const waiter of this.waiters.splice(0)) waiter.reject(this.failure);
    (this.child?.stdout as Readable | undefined)?.removeAllListeners('data');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child: ChildProcess, ms: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
// AIGC END
