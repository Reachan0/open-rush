// AIGC START
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DshEventMapper } from './dsh-event-mapper.js';
import { DshJsonRpcClient } from './dsh-jsonrpc-client.js';
import { buildDshChildEnv, resolveDshLaunch } from './dsh-launch.js';
import type { DshRunInput, UIMessageChunk } from './dsh-types.js';

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

/**
 * Drive a DeepSeek Harness JSON-RPC runtime subprocess and expose the turn as
 * an AI SDK UIMessageChunk SSE response (SSE① for control-worker).
 */
export function runDshToUIMessageStream(input: DshRunInput): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const mapper = new DshEventMapper();
      let client: DshJsonRpcClient | undefined;
      const enqueue = (chunks: UIMessageChunk[]) => {
        for (const chunk of chunks) controller.enqueue(encodeSse(chunk));
      };
      const onAbort = () => {
        void client?.close();
      };
      input.abortSignal?.addEventListener('abort', onAbort, { once: true });

      try {
        const launch = resolveDshLaunch();
        const sessionRoot = mkdtempSync(join(tmpdir(), `openrush-dsh-${input.sessionId}-`));
        client = new DshJsonRpcClient(
          launch,
          buildDshChildEnv({
            env: input.env,
            cwd: input.cwd,
            systemPrompt: input.systemPrompt,
            sessionRoot,
            repoRoot: launch.repoRoot,
          })
        );
        client.start();
        await client.initialize({
          cwd: input.cwd ?? process.cwd(),
          provider: input.provider ?? process.env.DSH_PROVIDER ?? 'deepseek-official',
          model: input.modelId ?? process.env.DSH_MODEL ?? 'DeepSeek-V4-Flash-INT8',
          ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
        });

        const messageId = await client.prompt(input.sessionId, input.prompt);
        let received = false;
        while (!input.abortSignal?.aborted) {
          const notification = await client.nextNotification();
          if (!received) {
            if (
              notification.method !== 'session.event' ||
              notification.params.sessionId !== input.sessionId ||
              !isInboxReceipt(notification.params.event, messageId)
            ) {
              continue;
            }
            received = true;
          }
          enqueue(mapper.pushNotification(notification));
          if (
            notification.method === 'session.status' &&
            notification.params.sessionId === input.sessionId &&
            notification.params.status === 'idle'
          ) {
            break;
          }
        }
        if (input.abortSignal?.aborted) {
          enqueue(mapper.error('aborted'));
        } else {
          enqueue(mapper.flush());
        }
        controller.enqueue(encodeSse('[DONE]'));
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        enqueue(mapper.error(message));
        controller.enqueue(encodeSse('[DONE]'));
        controller.close();
      } finally {
        input.abortSignal?.removeEventListener('abort', onAbort);
        await client?.close();
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
