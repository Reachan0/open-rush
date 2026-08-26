// AIGC START
import { describe, expect, it } from 'vitest';
import { WorkflowUiMapper } from '../workflow-ui-stream.js';

describe('WorkflowUiMapper', () => {
  it('maps planning onto workflow.plan tool cards', () => {
    const mapper = new WorkflowUiMapper('msg-1');
    const chunks = [
      ...mapper.begin(),
      ...mapper.push({
        eventType: 'workflow-planning',
        payload: { intent: '总结两篇文档', via: 'llm' },
      }),
    ];
    expect(chunks).toEqual(
      expect.arrayContaining([
        { type: 'start', messageId: 'msg-1' },
        { type: 'start-step' },
        { type: 'tool-input-start', toolCallId: 'workflow-plan', toolName: 'workflow.plan' },
        expect.objectContaining({
          type: 'tool-input-available',
          toolCallId: 'workflow-plan',
          toolName: 'workflow.plan',
        }),
      ])
    );
  });

  it('maps node success and failure onto tool output chunks', () => {
    const mapper = new WorkflowUiMapper();
    mapper.begin();
    mapper.push({
      eventType: 'workflow-node-start',
      payload: { nodeId: 'geo', tool: 'amap-maps__maps_geo', input: { address: '外滩' } },
    });
    const ok = mapper.push({
      eventType: 'workflow-node-end',
      payload: { nodeId: 'geo', status: 'completed', output: { location: '121,31' } },
    });
    expect(ok).toEqual([
      { type: 'tool-output-available', toolCallId: 'geo', output: { location: '121,31' } },
    ]);

    mapper.push({
      eventType: 'workflow-node-start',
      payload: { nodeId: 'walk', tool: 'amap-maps__maps_direction_walking' },
    });
    const failed = mapper.push({
      eventType: 'workflow-node-end',
      payload: { nodeId: 'walk', status: 'failed', error: 'QPS' },
    });
    expect(failed).toEqual([{ type: 'tool-output-error', toolCallId: 'walk', errorText: 'QPS' }]);
  });

  it('turns the compose node into assistant text and still tracks it for the DAG', () => {
    const mapper = new WorkflowUiMapper('msg-2');
    mapper.begin();
    const graphChunks = mapper.push({
      eventType: 'workflow-graph',
      payload: {
        name: 'trip',
        nodes: [
          { id: 'geo', tool: 'amap-maps__maps_geo', dependsOn: [] },
          { id: 'write', tool: 'text.compose', dependsOn: ['geo'] },
        ],
        edges: [{ from: 'geo', to: 'write' }],
        waves: [['geo'], ['write']],
      },
    });
    expect(graphChunks[0]).toMatchObject({
      type: 'tool-output-available',
      toolCallId: 'workflow-plan',
      output: expect.objectContaining({
        name: 'trip',
        waves: [['geo'], ['write']],
        edges: [{ from: 'geo', to: 'write' }],
      }),
    });
    expect(
      mapper.push({
        eventType: 'workflow-node-start',
        payload: { nodeId: 'write', tool: 'text.compose' },
      })
    ).toEqual(
      expect.arrayContaining([
        { type: 'tool-input-start', toolCallId: 'write', toolName: 'text.compose' },
      ])
    );
    const textChunks = mapper.push({
      eventType: 'workflow-node-end',
      payload: { nodeId: 'write', status: 'completed', output: '周六先去外滩走走。' },
    });
    expect(textChunks.map((chunk) => chunk.type)).toEqual([
      'tool-output-available',
      'text-start',
      'text-delta',
      'text-end',
    ]);
    expect(textChunks[2]).toMatchObject({ type: 'text-delta', delta: '周六先去外滩走走。' });
    const rest = mapper.complete({
      ok: true,
      degraded: false,
      output: '周六先去外滩走走。',
      rounds: 1,
      durationMs: 10,
      events: [],
      dsl: { version: '1', nodes: [] },
      nodes: [],
      usage: { promptChars: 0, completionChars: 0, estimatedTokens: 0 },
    });
    expect(rest.map((chunk) => chunk.type)).toEqual(['finish-step', 'finish']);
  });
});
// AIGC END
