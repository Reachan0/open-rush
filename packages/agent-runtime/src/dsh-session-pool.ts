// AIGC START
import type { DshInitializeParams, DshNotification, DshRunInput } from './dsh-types.js';

export interface DshPooledClient {
  isAlive(): boolean;
  start(): void;
  initialize(params: DshInitializeParams): Promise<void>;
  prompt(sessionId: string, text: string): Promise<string>;
  nextNotification(): Promise<DshNotification>;
  close(): Promise<void>;
}

export type DshClientFactory = (input: DshRunInput) => DshPooledClient;

export interface DshSessionPoolOptions {
  idleMs?: number;
}

type Slot = {
  client: DshPooledClient;
  timer?: ReturnType<typeof setTimeout>;
};

const DEFAULT_IDLE_MS = 30 * 60 * 1000;

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('DeepSeek Harness request aborted');
}

export class DshSessionPool {
  private readonly slots = new Map<string, Slot>();
  private readonly idleMs: number;

  constructor(
    private readonly factory: DshClientFactory,
    options: DshSessionPoolOptions = {}
  ) {
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  }

  async acquire(input: DshRunInput): Promise<DshPooledClient> {
    throwIfAborted(input.abortSignal);
    const existing = this.slots.get(input.sessionId);
    if (existing?.client.isAlive()) {
      this.markBusy(existing);
      return existing.client;
    }
    if (existing) await this.drop(input.sessionId);

    const client = this.create(input);
    try {
      client.start();
      const configuredMax = Number(input.env?.DSH_MAX_TOKENS ?? process.env.DSH_MAX_TOKENS);
      const maxTokens =
        input.maxTokens ??
        (Number.isSafeInteger(configuredMax) && configuredMax > 0 ? configuredMax : undefined);
      await client.initialize({
        cwd: input.cwd ?? process.cwd(),
        provider: input.provider ?? process.env.DSH_PROVIDER ?? 'deepseek-official',
        model: input.modelId ?? process.env.DSH_MODEL ?? 'DeepSeek-V4-Flash-INT8',
        ...(maxTokens ? { maxTokens } : {}),
      });
      throwIfAborted(input.abortSignal);
    } catch (error) {
      await client.close().catch(() => {});
      throw error;
    }
    const slot: Slot = { client };
    this.slots.set(input.sessionId, slot);
    this.markBusy(slot);
    return client;
  }

  release(sessionId: string): void {
    const slot = this.slots.get(sessionId);
    if (slot?.client.isAlive()) this.touch(sessionId, slot);
  }

  async drop(sessionId: string): Promise<void> {
    const slot = this.slots.get(sessionId);
    if (!slot) return;
    this.slots.delete(sessionId);
    if (slot.timer) clearTimeout(slot.timer);
    await slot.client.close().catch(() => {});
  }

  async closeAll(): Promise<void> {
    const ids = [...this.slots.keys()];
    await Promise.all(ids.map((id) => this.drop(id)));
  }

  private create(input: DshRunInput): DshPooledClient {
    return this.factory(input);
  }

  private markBusy(slot: Slot): void {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = undefined;
  }

  private touch(sessionId: string, slot: Slot): void {
    if (slot.timer) clearTimeout(slot.timer);
    if (this.idleMs <= 0) return;
    slot.timer = setTimeout(() => {
      void this.drop(sessionId);
    }, this.idleMs);
    slot.timer.unref?.();
  }
}
// AIGC END
