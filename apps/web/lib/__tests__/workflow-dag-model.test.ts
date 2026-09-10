// AIGC START

import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import {
  collectNodeStatuses,
  countDagProgress,
  extractWorkflowArticle,
  extractWorkflowNodeResults,
  findLatestWorkflowPlan,
  inferWaves,
  isWorkflowHiddenToolPart,
  layoutWorkflowDag,
  parseWorkflowGraph,
  prettyToolName,
  waveRowLabel,
  workflowErrorHeadline,
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
    expect(prettyToolName('mcp__amap-maps__maps_weather')).toContain('高德');
    expect(prettyToolName('mcp__keenable-search__web_search')).toContain('网页搜索');
    expect(prettyToolName('http.fetch')).toBe('抓取网页');
    expect(prettyToolName('workflow_run')).toBe('快车道');
  });

  it('labels sequential waves as steps instead of repeating 串行 · 1', () => {
    expect(waveRowLabel([{ id: '__start__', terminal: 'start' }], 0)).toBe('入口');
    expect(waveRowLabel([{ id: 'a' }], 1)).toBe('步骤 1');
    expect(waveRowLabel([{ id: 'b' }], 2)).toBe('步骤 2');
    expect(waveRowLabel([{ id: 'x' }, { id: 'y' }], 1)).toBe('并行 · 2');
    expect(waveRowLabel([{ id: '__end__', terminal: 'end' }], 0)).toBe('出口');
  });

  it('unwraps planner output nested under dsl', () => {
    const graph = parseWorkflowGraph({
      source: 'llm',
      dsl: {
        name: 'trip',
        nodes: [
          { id: 'geo', tool: 'geo.locate', dependsOn: [] },
          { id: 'write', tool: 'text.compose', dependsOn: ['geo'] },
        ],
      },
    });
    expect(graph?.name).toBe('trip');
    expect(graph?.nodes.map((node) => node.id)).toEqual(['geo', 'write']);
    expect(graph?.edges).toEqual([{ from: 'geo', to: 'write' }]);
  });

  it('parses a native workflow_run tool card from the DAG marker', () => {
    const payload = {
      name: 'hangzhou_westlake_run_plan',
      nodes: [
        { id: 'weather_today', tool: 'amap-maps__maps_weather', dependsOn: [] },
        { id: 'compose', tool: 'text.compose', dependsOn: ['weather_today'] },
      ],
      nodeResults: { weather_today: { temp: 28 } },
      article: '断桥出发。',
    };
    const output = `快车道已执行「hangzhou_westlake_run_plan」· 2 个节点
- weather_today (amap-maps__maps_weather)
- compose (text.compose) ← weather_today

断桥出发。

OPENRUSH_WORKFLOW_DAG:${JSON.stringify(payload)}`;
    const graph = parseWorkflowGraph(output);
    expect(graph?.name).toBe('hangzhou_westlake_run_plan');
    expect(graph?.waves[0]).toEqual(['weather_today']);
    expect(extractWorkflowNodeResults(output)).toEqual({ weather_today: { temp: 28 } });
    expect(extractWorkflowArticle(output)).toBe('断桥出发。');
  });

  it('reads node facts from markdown when the DAG marker is missing', () => {
    const output = `快车道已执行「trip」· 2 个节点
- geo (geo.locate)
- write (text.compose) ← geo

周六先去外滩。

各节点查到的事实：
### geo (geo.locate)
{"city":"上海","temp":28}

以上材料已经由引擎查完。`;
    expect(parseWorkflowGraph(output)?.name).toBe('trip');
    expect(extractWorkflowNodeResults(output)).toEqual({ geo: { city: '上海', temp: 28 } });
  });

  it('parses workflow_run markdown when the DAG marker is missing', () => {
    const graph = parseWorkflowGraph(`快车道已执行「trip」· 2 个节点
- geo (geo.locate)
- write (text.compose) ← geo

周六先去外滩。`);
    expect(graph?.name).toBe('trip');
    expect(graph?.nodes).toEqual([
      { id: 'geo', tool: 'geo.locate', dependsOn: [] },
      { id: 'write', tool: 'text.compose', dependsOn: ['geo'] },
    ]);
  });

  it('finds the latest workflow_run card and marks nodes complete', () => {
    const output = `OPENRUSH_WORKFLOW_DAG:${JSON.stringify({
      name: 'trip',
      nodes: [{ id: 'geo', tool: 'geo.locate', dependsOn: [] }],
      nodeResults: { geo: { city: '上海' } },
    })}`;
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolCallId: 'call-1',
            toolName: 'workflow_run',
            state: 'output-available',
            input: { intent: '上海周末' },
            output,
          },
        ],
      },
    ] as UIMessage[];
    const latest = findLatestWorkflowPlan(messages);
    expect(latest?.graph?.name).toBe('trip');
    expect(collectNodeStatuses(latest!.message, latest!.graph!)).toEqual({ geo: 'completed' });
    expect(isWorkflowHiddenToolPart(messages[0].parts[0], messages[0])).toBe(false);
  });

  it('draws the DAG from output-error errorText when success output is missing', () => {
    const errorText = `快车道失败：Authentication Fails, Your api key: ****yaff is invalid
快车道失败「westlake_run」· 已规划 2 个节点（图未跑完）
- search (web_search)
- write (text.compose) ← search

OPENRUSH_WORKFLOW_DAG:${JSON.stringify({
      name: 'westlake_run',
      nodes: [
        { id: 'search', tool: 'web_search', dependsOn: [] },
        { id: 'write', tool: 'text.compose', dependsOn: ['search'] },
      ],
    })}`;
    expect(workflowErrorHeadline(errorText)).toMatch(/^快车道失败：Authentication Fails/);
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolCallId: 'call-err',
            toolName: 'workflow_run',
            state: 'output-error',
            input: { intent: '西湖跑步' },
            errorText,
          },
        ],
      },
    ] as UIMessage[];
    const latest = findLatestWorkflowPlan(messages);
    expect(latest?.graph?.name).toBe('westlake_run');
    expect(latest?.graph?.nodes.map((node) => node.id)).toEqual(['search', 'write']);
    expect(collectNodeStatuses(latest!.message, latest!.graph!)).toEqual({
      search: 'failed',
      write: 'failed',
    });
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
