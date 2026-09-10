// AIGC START
import { describe, expect, it } from 'vitest';
import { DshEventMapper } from '../dsh-event-mapper.js';

function event(type: string, data: Record<string, unknown> = {}) {
  return {
    method: 'session.event',
    params: { sessionId: 's1', event: { type, seq: 1, time: 1, data } },
  };
}

describe('DshEventMapper', () => {
  it('ends only unfinished tool cards when a model stream fails', () => {
    const mapper = new DshEventMapper('m');
    mapper.pushNotification(event('tool/call', { callId: 'done', name: 'read', arguments: '{}' }));
    mapper.pushNotification(
      event('tool/result', {
        callId: 'done',
        message: { content: [{ type: 'text', text: 'ok' }] },
      })
    );
    mapper.pushNotification(
      event('assistant/chunk', {
        chunk: {
          type: 'tool-call-delta',
          id: 'partial',
          name: 'workflow_run',
          argumentsDelta: '{',
        },
      })
    );
    const outputs = mapper
      .error('notification timeout')
      .filter((x) => x.type === 'tool-output-error');
    expect(outputs).toEqual([
      { type: 'tool-output-error', toolCallId: 'partial', errorText: 'notification timeout' },
    ]);
  });

  it('maps text deltas into UIMessageChunk text family', () => {
    const mapper = new DshEventMapper('msg-1');
    const chunks = [
      ...mapper.pushNotification({
        method: 'session.status',
        params: { sessionId: 's1', status: 'running' },
      }),
      ...mapper.pushNotification(
        event('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'text-delta', index: 0, text: 'Hi' },
        })
      ),
      ...mapper.pushNotification(
        event('assistant/chunk', {
          turn: 1,
          step: 1,
          chunk: { type: 'text-delta', index: 0, text: '!' },
        })
      ),
      ...mapper.pushNotification({
        method: 'session.status',
        params: { sessionId: 's1', status: 'idle' },
      }),
    ];

    expect(chunks.map((c) => c.type)).toEqual([
      'start',
      'text-start',
      'text-delta',
      'text-delta',
      'text-end',
      'finish',
    ]);
    expect(chunks[2]).toMatchObject({ type: 'text-delta', delta: 'Hi' });
    expect(chunks[3]).toMatchObject({ type: 'text-delta', delta: '!' });
  });

  it('maps reasoning deltas', () => {
    const mapper = new DshEventMapper('msg-1');
    const chunks = mapper.pushNotification(
      event('assistant/chunk', {
        chunk: { type: 'reasoning-delta', index: 0, text: 'think' },
      })
    );
    expect(chunks.map((c) => c.type)).toEqual(['start', 'reasoning-start', 'reasoning-delta']);
    expect(chunks[2]).toMatchObject({ delta: 'think' });
  });

  it('maps tool call + result into UIMessageChunk tool family', () => {
    const mapper = new DshEventMapper('msg-1');
    const chunks = [
      ...mapper.pushNotification(
        event('tool/call', {
          callId: 'c1',
          name: 'bash',
          arguments: '{"command":"ls"}',
        })
      ),
      ...mapper.pushNotification(
        event('tool/result', {
          message: {
            source: { kind: 'tool', callId: 'c1' },
            content: [
              {
                type: 'tool-result',
                toolCallId: 'c1',
                content: [{ type: 'text', text: 'README.md' }],
              },
            ],
          },
        })
      ),
    ];

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool-input-start', toolCallId: 'c1', toolName: 'bash' }),
        expect.objectContaining({
          type: 'tool-input-available',
          toolCallId: 'c1',
          input: { command: 'ls' },
        }),
        expect.objectContaining({
          type: 'tool-output-available',
          toolCallId: 'c1',
          output: 'README.md',
        }),
      ])
    );
  });

  it('emits tool-output-error when the tool result is marked as error', () => {
    const mapper = new DshEventMapper('msg-1');
    const chunks = mapper.pushNotification(
      event('tool/result', {
        error: { name: 'BashError', code: 'EXECUTION_FAILED' },
        message: {
          source: { callId: 'c2' },
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c2',
              isError: true,
              content: [{ type: 'text', text: 'boom' }],
            },
          ],
        },
      })
    );
    expect(chunks[chunks.length - 1]).toMatchObject({
      type: 'tool-output-error',
      toolCallId: 'c2',
      errorText: 'boom',
    });
  });

  it('falls back to assembled assistant text when no chunks were streamed', () => {
    const mapper = new DshEventMapper('msg-1');
    const chunks = mapper.pushNotification(
      event('assistant/message', {
        message: { content: [{ type: 'text', text: 'done' }] },
      })
    );
    expect(chunks.map((c) => c.type)).toEqual(['start', 'text-start', 'text-delta', 'text-end']);
    expect(chunks[2]).toMatchObject({ delta: 'done' });
  });

  it('does not duplicate assistant text after streamed chunks', () => {
    const mapper = new DshEventMapper('msg-1');
    mapper.pushNotification(
      event('assistant/chunk', { chunk: { type: 'text-delta', index: 0, text: 'Hi' } })
    );
    const after = mapper.pushNotification(
      event('assistant/message', { message: { content: [{ type: 'text', text: 'Hi' }] } })
    );
    expect(after.some((c) => c.type === 'text-delta' && c.delta === 'Hi')).toBe(false);
  });
});
// AIGC END
