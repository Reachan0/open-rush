// AIGC START
import type { DshNotification, UIMessageChunk } from './dsh-types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function turnEndReason(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return isRecord(value) ? asString(value.kind) : undefined;
}

function parseToolInput(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw };
  }
}

function textFromBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((block): block is Record<string, unknown> => isRecord(block) && block.type === 'text')
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('');
}

function extractToolOutput(data: Record<string, unknown>): { output: string; isError: boolean } {
  const error = isRecord(data.error) ? data.error : undefined;
  const message = isRecord(data.message) ? data.message : undefined;
  const content = Array.isArray(message?.content) ? message.content : [];
  const first = isRecord(content[0]) ? content[0] : undefined;
  const nested = Array.isArray(first?.content) ? first.content : content;
  const output = textFromBlocks(nested) || (error ? JSON.stringify(error) : '');
  return {
    output,
    isError: Boolean(error) || Boolean(first?.isError),
  };
}

/**
 * Maps DeepSeek Harness JSON-RPC session notifications onto AI SDK
 * UIMessageChunk events so OpenRush control-plane SSE can stay unchanged.
 */
export class DshEventMapper {
  private readonly messageId: string;
  private started = false;
  private stepOpen = false;
  private finished = false;
  private textId: string | null = null;
  private reasoningId: string | null = null;
  private streamedAssistant = false;
  private readonly seenToolCalls = new Set<string>();
  private readonly finishedToolCalls = new Set<string>();
  private readonly toolNames = new Map<string, string>();

  constructor(messageId: string = crypto.randomUUID()) {
    this.messageId = messageId;
  }

  pushNotification(notification: DshNotification): UIMessageChunk[] {
    if (this.finished) return [];
    if (notification.method === 'session.status') {
      const status = asString(notification.params.status);
      if (status === 'running') return this.ensureStart();
      if (status === 'idle') {
        const unfinished = [...this.seenToolCalls].filter(
          (toolCallId) => !this.finishedToolCalls.has(toolCallId)
        );
        if (unfinished.length > 0) {
          return this.error(
            `DSH session ended before tool call completed: ${unfinished
              .map((toolCallId) => this.toolNames.get(toolCallId) ?? toolCallId)
              .join(', ')}`
          );
        }
        return this.finish('stop');
      }
      return [];
    }
    if (notification.method !== 'session.event') return [];
    const event = notification.params.event;
    if (!isRecord(event) || typeof event.type !== 'string') return [];
    return this.pushEvent(event);
  }

  flush(reason = 'stop'): UIMessageChunk[] {
    return this.finish(reason);
  }

  error(errorText: string): UIMessageChunk[] {
    const failed = [...this.seenToolCalls]
      .filter((id) => !this.finishedToolCalls.has(id))
      .map((toolCallId) => {
        this.finishedToolCalls.add(toolCallId);
        return { type: 'tool-output-error', toolCallId, errorText };
      });
    return [
      ...this.closeOpenParts(),
      ...failed,
      { type: 'error', errorText },
      ...this.finish('error'),
    ];
  }

  private pushEvent(event: Record<string, unknown>): UIMessageChunk[] {
    const chunks = this.ensureStart();
    const data = isRecord(event.data) ? event.data : {};

    switch (event.type) {
      case 'step/start':
        if (!this.stepOpen) {
          this.stepOpen = true;
          chunks.push({ type: 'start-step' });
        }
        return chunks;
      case 'step/end':
        chunks.push(...this.closeOpenParts());
        if (this.stepOpen) {
          this.stepOpen = false;
          chunks.push({ type: 'finish-step' });
        }
        return chunks;
      case 'assistant/chunk':
        this.streamedAssistant = true;
        chunks.push(...this.mapChunk(isRecord(data.chunk) ? data.chunk : {}));
        return chunks;
      case 'assistant/message':
        chunks.push(...this.mapAssistantMessage(data));
        return chunks;
      case 'tool/call':
        chunks.push(...this.mapToolCall(data));
        return chunks;
      case 'tool/result':
        chunks.push(...this.mapToolResult(data));
        return chunks;
      case 'turn/end': {
        const reason = turnEndReason(data.reason);
        if (reason === 'max-tokens') {
          return this.error('DSH output token limit reached before the response completed');
        }
        if (
          reason &&
          reason !== 'completed' &&
          reason !== 'success' &&
          reason !== 'stop' &&
          reason !== 'tool-calls'
        ) {
          return this.error(`DSH turn ended: ${reason}`);
        }
        return chunks;
      }
      default:
        return chunks;
    }
  }

  private mapChunk(chunk: Record<string, unknown>): UIMessageChunk[] {
    const type = asString(chunk.type);
    if (type === 'text-delta') {
      const text = asString(chunk.text) ?? '';
      if (!text) return [];
      return [...this.ensureText(), { type: 'text-delta', id: this.textId, delta: text }];
    }
    if (type === 'reasoning-delta') {
      const text = asString(chunk.text) ?? '';
      if (!text) return [];
      return [
        ...this.ensureReasoning(),
        { type: 'reasoning-delta', id: this.reasoningId, delta: text },
      ];
    }
    if (type === 'tool-call-delta') {
      const toolCallId = asString(chunk.id) ?? crypto.randomUUID();
      const toolName = asString(chunk.name) ?? this.toolNames.get(toolCallId) ?? 'tool';
      this.toolNames.set(toolCallId, toolName);
      const out: UIMessageChunk[] = [];
      if (!this.seenToolCalls.has(toolCallId)) {
        this.seenToolCalls.add(toolCallId);
        out.push({ type: 'tool-input-start', toolCallId, toolName });
      }
      const delta = asString(chunk.argumentsDelta) ?? '';
      if (delta) out.push({ type: 'tool-input-delta', toolCallId, delta });
      return out;
    }
    if (type === 'block-end') {
      return this.closeOpenParts();
    }
    return [];
  }

  private mapAssistantMessage(data: Record<string, unknown>): UIMessageChunk[] {
    const chunks = this.closeOpenParts();
    if (this.streamedAssistant) return chunks;
    const message = isRecord(data.message) ? data.message : {};
    const text = textFromBlocks(message.content);
    if (!text) return chunks;
    this.streamedAssistant = true;
    const id = `text-${this.messageId}`;
    chunks.push(
      { type: 'text-start', id },
      { type: 'text-delta', id, delta: text },
      { type: 'text-end', id }
    );
    return chunks;
  }

  private mapToolCall(data: Record<string, unknown>): UIMessageChunk[] {
    const toolCallId = asString(data.callId) ?? crypto.randomUUID();
    const toolName = asString(data.name) ?? 'tool';
    this.toolNames.set(toolCallId, toolName);
    const args = asString(data.arguments) ?? '{}';
    const chunks: UIMessageChunk[] = [];
    if (!this.seenToolCalls.has(toolCallId)) {
      this.seenToolCalls.add(toolCallId);
      chunks.push({ type: 'tool-input-start', toolCallId, toolName });
      if (args) chunks.push({ type: 'tool-input-delta', toolCallId, delta: args });
    }
    chunks.push({
      type: 'tool-input-available',
      toolCallId,
      toolName,
      input: parseToolInput(args),
    });
    return chunks;
  }

  private mapToolResult(data: Record<string, unknown>): UIMessageChunk[] {
    const message = isRecord(data.message) ? data.message : {};
    const source = isRecord(message.source) ? message.source : {};
    const toolCallId =
      asString(source.callId) ?? asString(data.callId) ?? this.inferToolCallId(message);
    const { output, isError } = extractToolOutput(data);
    this.finishedToolCalls.add(toolCallId);
    if (isError) {
      return [{ type: 'tool-output-error', toolCallId, errorText: output || 'tool error' }];
    }
    return [{ type: 'tool-output-available', toolCallId, output }];
  }

  private inferToolCallId(message: Record<string, unknown>): string {
    const content = Array.isArray(message.content) ? message.content[0] : undefined;
    if (isRecord(content)) {
      const id = asString(content.toolCallId) ?? asString(content.id);
      if (id) return id;
    }
    return crypto.randomUUID();
  }

  private ensureStart(): UIMessageChunk[] {
    if (this.started) return [];
    this.started = true;
    return [{ type: 'start', messageId: this.messageId }];
  }

  private ensureText(): UIMessageChunk[] {
    const closed = this.closeReasoning();
    if (this.textId) return closed;
    this.textId = `text-${this.messageId}`;
    return [...closed, { type: 'text-start', id: this.textId }];
  }

  private ensureReasoning(): UIMessageChunk[] {
    const closed = this.closeText();
    if (this.reasoningId) return closed;
    this.reasoningId = `reason-${this.messageId}`;
    return [...closed, { type: 'reasoning-start', id: this.reasoningId }];
  }

  private closeText(): UIMessageChunk[] {
    if (!this.textId) return [];
    const id = this.textId;
    this.textId = null;
    return [{ type: 'text-end', id }];
  }

  private closeReasoning(): UIMessageChunk[] {
    if (!this.reasoningId) return [];
    const id = this.reasoningId;
    this.reasoningId = null;
    return [{ type: 'reasoning-end', id }];
  }

  private closeOpenParts(): UIMessageChunk[] {
    return [...this.closeText(), ...this.closeReasoning()];
  }

  private finish(reason: string): UIMessageChunk[] {
    if (this.finished) return [];
    const chunks = this.closeOpenParts();
    if (this.stepOpen) {
      this.stepOpen = false;
      chunks.push({ type: 'finish-step' });
    }
    this.finished = true;
    if (!this.started) {
      this.started = true;
      chunks.unshift({ type: 'start', messageId: this.messageId });
    }
    chunks.push({ type: 'finish', reason });
    return chunks;
  }
}
// AIGC END
