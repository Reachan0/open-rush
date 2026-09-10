// AIGC START
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DshEventMapper } from './dsh-event-mapper.js';
import { DshJsonRpcClient, DshRequestTimeoutError } from './dsh-jsonrpc-client.js';
import { buildDshChildEnv, resolveDshLaunch } from './dsh-launch.js';
import { type DshPooledClient, DshSessionPool } from './dsh-session-pool.js';
import type { DshNotification, DshRunInput, UIMessageChunk } from './dsh-types.js';

export interface DshRuntimeOptions {
  pool?: DshSessionPool;
  notificationTimeoutMs?: number;
  toolNotificationTimeoutMs?: number;
}

const DEFAULT_NOTIFICATION_TIMEOUT_MS = 90_000;
const DEFAULT_TOOL_NOTIFICATION_TIMEOUT_MS = 240_000;

class DshNotificationTimeoutError extends Error {
  constructor(sessionId: string, timeoutMs: number, waitingForTool: boolean) {
    super(
      `DeepSeek Harness notification timeout: no ${
        waitingForTool ? 'tool result or other activity' : 'activity'
      } for ${timeoutMs}ms in session ${sessionId}`
    );
    this.name = 'DshNotificationTimeoutError';
  }
}

function encodeSse(chunk: UIMessageChunk | '[DONE]'): Uint8Array {
  const payload = chunk === '[DONE]' ? '[DONE]' : JSON.stringify(chunk);
  return new TextEncoder().encode(`data: ${payload}\n\n`);
}

function isInboxReceipt(event: unknown, messageId: string): boolean {
  if (!event || typeof event !== 'object') return false;
  const envelope = event as Record<string, unknown>;
  if (envelope.type !== 'agent/inbox/spliced') return false;
  const data = envelope.data;
  if (!data || typeof data !== 'object') return false;
  const inserted = (data as { inserted?: unknown }).inserted;
  return (
    Array.isArray(inserted) &&
    inserted.some(
      (item) => item && typeof item === 'object' && (item as { id?: string }).id === messageId
    )
  );
}

function createDshClient(input: DshRunInput): DshPooledClient {
  const launch = resolveDshLaunch();
  const sessionRoot = mkdtempSync(join(tmpdir(), `openrush-dsh-${input.sessionId}-`));
  const configuredRequestTimeoutMs = Number(
    input.env?.DSH_REQUEST_TIMEOUT_MS ?? process.env.DSH_REQUEST_TIMEOUT_MS
  );
  const requestTimeoutMs =
    Number.isSafeInteger(configuredRequestTimeoutMs) && configuredRequestTimeoutMs > 0
      ? configuredRequestTimeoutMs
      : undefined;
  return new DshJsonRpcClient(
    launch,
    buildDshChildEnv({
      env: input.env,
      cwd: input.cwd,
      systemPrompt: input.systemPrompt,
      sessionRoot,
      repoRoot: launch.repoRoot,
    }),
    { requestTimeoutMs }
  );
}

const sharedPool = new DshSessionPool(createDshClient);

/**
 * Drive a DeepSeek Harness JSON-RPC runtime and expose the turn as an AI SDK
 * UIMessageChunk SSE response. The DSH process is kept alive per sessionId so
 * later turns resume the same engine session instead of starting a new one.
 */
function toolCallId(
  notification: DshNotification
): { callId: string; isResult: boolean } | undefined {
  if (notification.method !== 'session.event') return undefined;
  const event = notification.params.event;
  if (!event || typeof event !== 'object' || Array.isArray(event)) return undefined;
  const { type, data } = event as Record<string, unknown>;
  if ((type !== 'tool/call' && type !== 'tool/result') || !data || typeof data !== 'object') {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  const directCallId = record.callId;
  if (typeof directCallId === 'string') {
    return { callId: directCallId, isResult: type === 'tool/result' };
  }
  if (type !== 'tool/result') return undefined;
  const message = record.message;
  if (!message || typeof message !== 'object') return undefined;
  const source = (message as Record<string, unknown>).source;
  if (!source || typeof source !== 'object') return undefined;
  const sourceCallId = (source as Record<string, unknown>).callId;
  return typeof sourceCallId === 'string' ? { callId: sourceCallId, isResult: true } : undefined;
}

function waitForSessionNotification(
  client: DshPooledClient,
  sessionId: string,
  timeoutMs: number,
  waitingForTool: boolean
): Promise<DshNotification> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new DshNotificationTimeoutError(sessionId, timeoutMs, waitingForTool));
    }, timeoutMs);
    timer.unref?.();

    const readNext = async (): Promise<void> => {
      try {
        while (!settled) {
          const notification = await client.nextNotification();
          if (notification.params.sessionId === sessionId) {
            settled = true;
            clearTimeout(timer);
            resolve(notification);
            return;
          }
        }
      } catch (error: unknown) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    };
    void readNext();
  });
}

export function runDshToUIMessageStream(
  input: DshRunInput,
  options: DshRuntimeOptions = {}
): Response {
  const pool = options.pool ?? sharedPool;
  const notificationTimeoutMs = options.notificationTimeoutMs ?? DEFAULT_NOTIFICATION_TIMEOUT_MS;
  const toolNotificationTimeoutMs =
    options.toolNotificationTimeoutMs ?? DEFAULT_TOOL_NOTIFICATION_TIMEOUT_MS;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const mapper = new DshEventMapper();
      let client: DshPooledClient | undefined;
      const enqueue = (chunks: UIMessageChunk[]) => {
        for (const chunk of chunks) controller.enqueue(encodeSse(chunk));
      };
      const onAbort = () => {
        void pool.drop(input.sessionId);
      };
      input.abortSignal?.addEventListener('abort', onAbort, { once: true });

      try {
        client = await pool.acquire(input);
        if (input.abortSignal?.aborted) {
          await pool.drop(input.sessionId);
          client = undefined;
          enqueue(mapper.error('aborted'));
          controller.enqueue(encodeSse('[DONE]'));
          controller.close();
          return;
        }
        const messageId = await client.prompt(input.sessionId, input.prompt);
        const pendingToolCalls = new Set<string>();
        let received = false;
        let lastActivityAt = Date.now();
        while (!input.abortSignal?.aborted) {
          const timeoutMs = pendingToolCalls.size
            ? toolNotificationTimeoutMs
            : notificationTimeoutMs;
          const remainingMs = timeoutMs - (Date.now() - lastActivityAt);
          if (remainingMs <= 0) {
            throw new DshNotificationTimeoutError(
              input.sessionId,
              timeoutMs,
              pendingToolCalls.size > 0
            );
          }
          const notification = await waitForSessionNotification(
            client,
            input.sessionId,
            remainingMs,
            pendingToolCalls.size > 0
          );
          if (!received) {
            if (
              notification.method !== 'session.event' ||
              !isInboxReceipt(notification.params.event, messageId)
            ) {
              continue;
            }
            received = true;
          }
          lastActivityAt = Date.now();
          const tool = toolCallId(notification);
          if (tool) {
            if (tool.isResult) pendingToolCalls.delete(tool.callId);
            else pendingToolCalls.add(tool.callId);
          }
          enqueue(mapper.pushNotification(notification));
          if (notification.method === 'session.status' && notification.params.status === 'idle') {
            break;
          }
        }
        if (input.abortSignal?.aborted) {
          enqueue(mapper.error('aborted'));
        } else {
          enqueue(mapper.flush());
          pool.release(input.sessionId);
        }
        controller.enqueue(encodeSse('[DONE]'));
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        enqueue(mapper.error(message));
        if (
          error instanceof DshNotificationTimeoutError ||
          error instanceof DshRequestTimeoutError
        ) {
          await pool.drop(input.sessionId);
        } else if (!client?.isAlive()) await pool.drop(input.sessionId);
        controller.enqueue(encodeSse('[DONE]'));
        controller.close();
      } finally {
        input.abortSignal?.removeEventListener('abort', onAbort);
        if (input.abortSignal?.aborted) await pool.drop(input.sessionId);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'x-openrush-runtime': 'dsh',
    },
  });
}
// AIGC END
