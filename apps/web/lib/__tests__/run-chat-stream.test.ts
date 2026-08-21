// AIGC START
import { describe, expect, it } from 'vitest';
import { applyAssistantParts, applyAssistantTextChunk, isStreamComplete } from '../run-chat-stream';

describe('applyAssistantTextChunk', () => {
  it('appends text-delta only', () => {
    expect(applyAssistantTextChunk('hi', { type: 'text-delta', delta: '!' })).toBe('hi!');
  });

  it('does not fold reasoning into text', () => {
    expect(applyAssistantTextChunk('hi', { type: 'reasoning-delta', delta: 'think' })).toBe('hi');
  });
});

describe('applyAssistantParts', () => {
  it('keeps reasoning and text as separate parts', () => {
    let parts = applyAssistantParts([], { type: 'reasoning-delta', delta: 'think' });
    parts = applyAssistantParts(parts, { type: 'text-delta', delta: 'pong' });
    expect(parts).toEqual([
      { type: 'reasoning', text: 'think' },
      { type: 'text', text: 'pong' },
    ]);
  });

  it('replaces the empty pending text part with reasoning', () => {
    const parts = applyAssistantParts([{ type: 'text', text: '' }], {
      type: 'reasoning-delta',
      delta: 'hello',
    });
    expect(parts).toEqual([{ type: 'reasoning', text: 'hello' }]);
  });

  it('starts a new text part after a tool instead of merging into earlier text', () => {
    let parts = applyAssistantParts([], { type: 'text-delta', delta: 'before' });
    parts = applyAssistantParts(parts, {
      type: 'tool-input-start',
      toolCallId: 'c1',
      toolName: 'write',
    });
    parts = applyAssistantParts(parts, { type: 'text-delta', delta: 'after' });
    expect(parts.map((p) => p.type)).toEqual(['text', 'dynamic-tool', 'text']);
    expect(parts[0]).toMatchObject({ text: 'before' });
    expect(parts[2]).toMatchObject({ text: 'after' });
  });

  it('builds a dynamic-tool part through input and output chunks', () => {
    let parts = applyAssistantParts([], {
      type: 'tool-input-start',
      toolCallId: 'c1',
      toolName: 'write',
    });
    expect(parts[0]).toMatchObject({
      type: 'dynamic-tool',
      toolCallId: 'c1',
      toolName: 'write',
      state: 'input-streaming',
    });

    parts = applyAssistantParts(parts, {
      type: 'tool-input-available',
      toolCallId: 'c1',
      toolName: 'write',
      input: { file_path: 'a.txt', content: 'hi' },
    });
    expect(parts[0]).toMatchObject({
      state: 'input-available',
      input: { file_path: 'a.txt', content: 'hi' },
    });

    parts = applyAssistantParts(parts, {
      type: 'tool-output-available',
      toolCallId: 'c1',
      output: 'Wrote a.txt',
    });
    expect(parts[0]).toMatchObject({
      state: 'output-available',
      output: 'Wrote a.txt',
    });
  });

  it('marks tool-output-error on the matching tool call', () => {
    let parts = applyAssistantParts([], {
      type: 'tool-input-available',
      toolCallId: 'c2',
      toolName: 'bash',
      input: { command: 'false' },
    });
    parts = applyAssistantParts(parts, {
      type: 'tool-output-error',
      toolCallId: 'c2',
      errorText: 'exit 1',
    });
    expect(parts[0]).toMatchObject({
      type: 'dynamic-tool',
      state: 'output-error',
      errorText: 'exit 1',
    });
  });
});

describe('isStreamComplete', () => {
  it('treats finish and run-done as complete', () => {
    expect(isStreamComplete({ type: 'finish' })).toBe(true);
    expect(isStreamComplete({ type: 'data-openrush-run-done' })).toBe(true);
    expect(isStreamComplete({ type: 'text-delta', delta: 'x' })).toBe(false);
  });
});
// AIGC END
