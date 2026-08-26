// AIGC START

import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import {
  collectNodeStatuses,
  countDagProgress,
  findLatestWorkflowPlan,
  inferWaves,
  isWorkflowHiddenToolPart,
  layoutWorkflowDag,
  parseWorkflowGraph,
  prettyToolName,
  waveRowLabel,
} from '../workflow-dag-model';

describe('workflow-dag-model', () => {
  it('parses graph output with edges and waves', () => {
    const graph = parseWorkflowGraph({
      name: 'trip',
      nodes: [
        { id: 'geo', tool: 'amap-maps__maps_geo', dependsOn: [] },
        { id: 'write', tool: 'text.compose', dependsOn: ['geo'] },
      ],
      edges: [{ from: 'geo', to: 'write' }],
      waves: [['geo'], ['write']],
    });
    expect(graph?.name).toBe('trip');
    expect(graph?.waves).toEqual([['geo'], ['write']]);
    expect(graph?.edges).toEqual([{ from: 'geo', to: 'write' }]);
  });

  it('infers waves when missing', () => {
    const waves = inferWaves(
      [
        { id: 'a', tool: 'http.fetch', dependsOn: [] },
        { id: 'b', tool: 'http.fetch', dependsOn: [] },
        { id: 'c', tool: 'text.compose', dependsOn: ['a', 'b'] },
      ],
      [
        { from: 'a', to: 'c' },
        { from: 'b', to: 'c' },
      ]
    );
    expect(waves[0]).toEqual(['a', 'b']);
    expect(waves[1]).toEqual(['c']);
  });

  it('lays out start / waves / end rows', () => {
    const graph = parseWorkflowGraph({
      nodes: [
        { id: 'a', tool: 'http.fetch', dependsOn: [] },
        { id: 'b', tool: 'text.compose', dependsOn: ['a'] },
      ],
      edges: [{ from: 'a', to: 'b' }],
      waves: [['a'], ['b']],
    });
    expect(graph).toBeTruthy();
    if (!graph) throw new Error('expected graph');
    const layout = layoutWorkflowDag(graph);
    expect(layout.visWaves).toHaveLength(4);
    expect(layout.pos.__start__).toBeTruthy();
    expect(layout.pos.a).toBeTruthy();
    expect(layout.pos.b.y).toBeGreaterThan(layout.pos.a.y);
    expect(layout.extraEdges.some((edge) => edge.from === '__start__' && edge.to === 'a')).toBe(
      true
    );
  });

  it('collects node status from sibling tool parts', () => {
    const graph = parseWorkflowGraph({
      nodes: [{ id: 'geo', tool: 'amap-maps__maps_geo', dependsOn: [] }],
      waves: [['geo']],
    });
    const message = {
      id: 'm1',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'workflow-plan',
          toolName: 'workflow.plan',
          state: 'output-available',
          input: {},
          output: graph,
        },
        {
          type: 'dynamic-tool',
          toolCallId: 'geo',
          toolName: 'amap-maps__maps_geo',
          state: 'input-available',
          input: { address: '外滩' },
        },
      ],
    } as UIMessage;
    if (!graph) throw new Error('expected graph');
    expect(collectNodeStatuses(message, graph)).toEqual({ geo: 'running' });
    expect(isWorkflowHiddenToolPart(message.parts[1], message)).toBe(true);
  });

  it('marks compose complete when the assistant already replied', () => {
    const graph = parseWorkflowGraph({
      nodes: [
        { id: 'walk', tool: 'amap-maps__maps_direction_walking' },
        { id: 'compose', tool: 'text.compose' },
      ],
    });
    const message = {
      id: 'm2',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'workflow-plan',
          toolName: 'workflow.plan',
          state: 'output-available',
          input: {},
          output: graph,
        },
        {
          type: 'dynamic-tool',
          toolCallId: 'walk',
          toolName: 'amap-maps__maps_direction_walking',
          state: 'output-available',
          input: {},
          output: { distance: 4000 },
        },
        { type: 'text', text: '全程约 4 公里，步行大约 54 分钟。' },
      ],
    } as UIMessage;
    if (!graph) throw new Error('expected graph');
    expect(collectNodeStatuses(message, graph)).toEqual({
      walk: 'completed',
      compose: 'completed',
    });
  });

  it('falls back to sequential waves when legacy graph has no edges', () => {
    const graph = parseWorkflowGraph({
      name: 'legacy',
      nodes: [
        { id: 'a', tool: 'http.fetch' },
        { id: 'b', tool: 'text.compose' },
      ],
    });
    expect(graph?.waves).toEqual([['a'], ['b']]);
    expect(graph?.edges).toEqual([{ from: 'a', to: 'b' }]);
  });

  it('pretty-prints MCP tool names', () => {
    expect(prettyToolName('amap-maps__maps_geo')).toContain('高德');
    expect(prettyToolName('http.fetch')).toBe('抓取网页');
  });

  it('labels sequential waves as steps instead of repeating 串行 · 1', () => {
    expect(waveRowLabel([{ id: '__start__', terminal: 'start' }], 0)).toBe('入口');
    expect(waveRowLabel([{ id: 'a' }], 1)).toBe('步骤 1');
    expect(waveRowLabel([{ id: 'b' }], 2)).toBe('步骤 2');
    expect(waveRowLabel([{ id: 'x' }, { id: 'y' }], 1)).toBe('并行 · 2');
    expect(waveRowLabel([{ id: '__end__', terminal: 'end' }], 0)).toBe('出口');
  });

  it('finds the latest workflow plan in a conversation', () => {
    const graph = parseWorkflowGraph({
      name: 'trip',
      nodes: [{ id: 'geo', tool: 'amap-maps__maps_geo' }],
    });
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolCallId: 'workflow-plan',
            toolName: 'workflow.plan',
            state: 'output-available',
            input: {},
            output: graph,
          },
        ],
      },
    ] as UIMessage[];
    const latest = findLatestWorkflowPlan(messages);
    expect(latest?.graph?.name).toBe('trip');
    expect(countDagProgress({ geo: 'completed', walk: 'pending' })).toEqual({
      total: 2,
      done: 1,
      running: false,
      failed: false,
    });
  });
});
// AIGC END
