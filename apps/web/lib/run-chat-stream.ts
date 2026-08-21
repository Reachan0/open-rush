/**
 * Client helpers for GET /api/runs/[id]/stream (SSE: id + data lines).
 */

export interface RunStreamEvent {
  seq: number;
  /** Parsed JSON from `data:` line; literal [DONE] yields null with done true */
  payload: unknown;
  done: boolean;
}

function parseSseBlocks(buffer: string): { blocks: string[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  return { blocks: parts.filter(Boolean), rest };
}

/**
 * Incrementally parse an SSE body and yield structured events.
 */
export async function* readRunSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<RunStreamEvent> {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    const { blocks, rest } = parseSseBlocks(buffer);
    buffer = rest;

    for (const block of blocks) {
      let seq = 0;
      let dataLine: string | undefined;
      for (const line of block.split('\n')) {
        if (line.startsWith('id: ')) {
          seq = Number.parseInt(line.slice(4), 10);
        } else if (line.startsWith('data: ')) {
          dataLine = line.slice(6);
        }
      }
      if (dataLine === undefined) continue;
      if (dataLine === '[DONE]') {
        yield { seq, payload: null, done: true };
        continue;
      }
      try {
        const payload = JSON.parse(dataLine) as unknown;
        yield { seq, payload, done: false };
      } catch {
        /* skip malformed */
      }
    }
  }

  yield { seq: 0, payload: null, done: true };
}

/** Apply one UI message stream chunk to plain assistant text (MVP). */
export function applyAssistantTextChunk(prev: string, payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return prev;
  const p = payload as Record<string, unknown>;
  if (p.type === 'text-delta') {
    const piece = String(p.delta ?? p.textDelta ?? p.text ?? p.content ?? '');
    return prev + piece;
  }
  return prev;
}

// AIGC START
export type AssistantToolState =
  | 'input-streaming'
  | 'input-available'
  | 'output-available'
  | 'output-error';

export type AssistantToolPart = {
  type: 'dynamic-tool';
  toolCallId: string;
  toolName: string;
  state: AssistantToolState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export type AssistantStreamPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | AssistantToolPart;

function dropEmptyText(parts: AssistantStreamPart[]): AssistantStreamPart[] {
  return parts.filter((part) => !(part.type === 'text' && part.text.length === 0));
}

function appendTextLike(
  parts: AssistantStreamPart[],
  type: 'text' | 'reasoning',
  piece: string
): AssistantStreamPart[] {
  if (!piece) return parts;
  const next = dropEmptyText(parts);
  const last = next[next.length - 1];
  if (last && last.type === type) {
    return [...next.slice(0, -1), { type, text: last.text + piece }];
  }
  return [...next, { type, text: piece }];
}

function upsertTool(
  parts: AssistantStreamPart[],
  toolCallId: string,
  patch: Partial<AssistantToolPart> & { toolName?: string }
): AssistantStreamPart[] {
  const next = dropEmptyText(parts);
  const idx = next.findIndex(
    (part) => part.type === 'dynamic-tool' && part.toolCallId === toolCallId
  );
  if (idx >= 0) {
    const current = next[idx] as AssistantToolPart;
    const copy = [...next];
    copy[idx] = { ...current, ...patch, toolCallId, type: 'dynamic-tool' };
    return copy;
  }
  return [
    ...next,
    {
      type: 'dynamic-tool',
      toolCallId,
      toolName: patch.toolName ?? 'tool',
      state: patch.state ?? 'input-streaming',
      input: patch.input,
      output: patch.output,
      errorText: patch.errorText,
    },
  ];
}

/** Apply one UI message stream chunk to assistant parts, keeping reasoning separate. */
export function applyAssistantParts(
  parts: AssistantStreamPart[],
  payload: unknown
): AssistantStreamPart[] {
  if (payload === null || typeof payload !== 'object') return parts;
  const p = payload as Record<string, unknown>;
  if (p.type === 'reasoning-start') {
    const next = dropEmptyText(parts);
    const last = next[next.length - 1];
    if (last?.type === 'reasoning') return next;
    return [...next, { type: 'reasoning', text: '' }];
  }
  if (p.type === 'reasoning-delta') {
    const piece = String(p.delta ?? p.text ?? p.textDelta ?? '');
    return appendTextLike(parts, 'reasoning', piece);
  }
  if (p.type === 'text-delta') {
    const piece = String(p.delta ?? p.textDelta ?? p.text ?? p.content ?? '');
    return appendTextLike(parts, 'text', piece);
  }
  if (p.type === 'tool-input-start') {
    const toolCallId = String(p.toolCallId ?? '');
    if (!toolCallId) return parts;
    return upsertTool(parts, toolCallId, {
      toolName: String(p.toolName ?? 'tool'),
      state: 'input-streaming',
    });
  }
  if (p.type === 'tool-input-delta') {
    const toolCallId = String(p.toolCallId ?? '');
    if (!toolCallId) return parts;
    return upsertTool(parts, toolCallId, { state: 'input-streaming' });
  }
  if (p.type === 'tool-input-available') {
    const toolCallId = String(p.toolCallId ?? '');
    if (!toolCallId) return parts;
    return upsertTool(parts, toolCallId, {
      toolName: String(p.toolName ?? 'tool'),
      state: 'input-available',
      input: p.input,
    });
  }
  if (p.type === 'tool-output-available') {
    const toolCallId = String(p.toolCallId ?? '');
    if (!toolCallId) return parts;
    return upsertTool(parts, toolCallId, {
      state: 'output-available',
      output: p.output,
    });
  }
  if (p.type === 'tool-output-error') {
    const toolCallId = String(p.toolCallId ?? '');
    if (!toolCallId) return parts;
    return upsertTool(parts, toolCallId, {
      state: 'output-error',
      errorText: String(p.errorText ?? p.error ?? 'tool error'),
    });
  }
  return parts;
}
// AIGC END

/** Check if a stream event is an error event from a failed run. */
export function isStreamError(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (p.type === 'error' && typeof p.error === 'string') {
    return p.error;
  }
  return null;
}

// AIGC START
/** Model/run finished — UI should leave the streaming/thinking state. */
export function isStreamComplete(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  if (p.type === 'finish') return true;
  if (p.type === 'data-openrush-run-done') return true;
  return false;
}
// AIGC END
