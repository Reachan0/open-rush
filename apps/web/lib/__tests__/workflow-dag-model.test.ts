// AIGC START

import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import {
  collectNodeStatuses,
  countDagProgress,
  extractWorkflowArticle,
  findLatestWorkflowPlan,
  findWorkflowPlans,
  inferWaves,
  isWorkflowHiddenToolPart,
  layoutWorkflowDag,
  parseWorkflowGraph,
  parseWorkflowGraphFromPart,
  prettyToolName,
  waveRowLabel,
  workflowErrorHeadline,
} from '../workflow-dag-model';

describe('workflow-dag-model', () => {
  it('retains node evidence and reads complete legacy facts without using model prose', () => {
    const output = { status: 'ok', dependencyRecovered: true, restartAttempts: 1 };
    const node = { id: 'protected', tool: 'ao04_read_status', dependsOn: [], status: 'completed' };
    expect(
      parseWorkflowGraph({ nodes: [{ ...node, input: { query: 'health' }, output }] })?.nodes[0]
    ).toMatchObject({ input: { query: 'health' }, output });
    const legacy = `### protected (ao04_read_status)\n${JSON.stringify(output)}\n\nOPENRUSH_WORKFLOW_DAG:${JSON.stringify({ nodes: [node] })}`;
    expect(parseWorkflowGraph(legacy)?.nodes[0].output).toEqual(output);
    expect(
      parseWorkflowGraph(legacy.replace(JSON.stringify(output), '{"status":…[truncated]'))?.nodes[0]
        .output
    ).toBeUndefined();
    expect(parseWorkflowGraph('模型说已经恢复')).toBeNull();
  });

  it('parses workflow_run error evidence and markdown plans from the inherited renderer', () => {
    const failed = parseWorkflowGraphFromPart({
      errorText:
        'protected tool failed\nOPENRUSH_WORKFLOW_DAG:{"name":"failed","nodes":[{"id":"protected","tool":"ao04_read_status","status":"failed"}]}',
    });
    expect(failed?.name).toBe('failed');
    expect(failed?.nodes[0].status).toBe('failed');
    expect(workflowErrorHeadline('protected tool failed\nOPENRUSH_WORKFLOW_DAG:{}')).toBe(
      'protected tool failed'
    );
    expect(
      parseWorkflowGraph('快车道已执行「demo」\n- pre (read)\n- post (read) ← pre')?.edges
    ).toEqual([{ from: 'pre', to: 'post' }]);
  });

  it('recovers a missing result name from the submitted workflow DSL', () => {
    const graph = parseWorkflowGraphFromPart({
      input: {
        dsl: JSON.stringify({
          version: '1',
          name: 'AO04固定演示',
          nodes: [{ id: 'protected', tool: 'ao04_read_status', input: { query: 'health' } }],
        }),
      },
      output: {
        nodes: [
          {
            id: 'protected',
            tool: 'ao04_read_status',
            status: 'completed',
            output: { status: 'ok' },
          },
        ],
      },
    });

    expect(graph?.name).toBe('AO04固定演示');
    expect(graph?.nodes[0]?.status).toBe('completed');
  });
  it('tries error evidence separately and never treats planned input as completion', () => {
    const part = {
      type: 'dynamic-tool',
      toolName: 'workflow_run',
      toolCallId: 'c',
      state: 'output-error',
      output: 'not a graph',
      errorText:
        'OPENRUSH_WORKFLOW_DAG:{"nodes":[{"id":"error-node","tool":"read","status":"failed"}]}',
      input: { dsl: { nodes: [{ id: 'planned', tool: 'read', status: 'completed' }] } },
    };
    expect(
      findLatestWorkflowPlan([{ id: 'm', role: 'assistant', parts: [part] } as UIMessage])?.graph
        ?.nodes[0].id
    ).toBe('error-node');
    const planned = findLatestWorkflowPlan([
      { id: 'm', role: 'assistant', parts: [{ ...part, errorText: '' }] } as UIMessage,
    ]);
    expect(planned?.graph?.nodes[0].status).toBe('pending');
  });

  it.each([
    'output-available',
    'output-error',
  ] as const)('reads workflow_run %s marker and observed states', (state) => {
    const output = `tool result\nOPENRUSH_WORKFLOW_DAG:${JSON.stringify({
      name: 'protected-flow',
      nodes: [
        { id: 'pre', tool: 'read', dependsOn: [], status: 'completed' },
        {
          id: 'protected',
          tool: 'ao04_read_status',
          dependsOn: ['pre'],
          status: state === 'output-error' ? 'failed' : 'completed',
        },
        {
          id: 'post',
          tool: 'read',
          dependsOn: ['protected'],
          status: state === 'output-error' ? 'pending' : 'completed',
        },
      ],
    })}`;
    const message = {
      id: 'm',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'run-1',
          toolName: 'workflow_run',
          state,
          ...(state === 'output-error' ? { errorText: output } : { output }),
        },
        { type: 'text', text: '任务已完成。' },
      ],
    } as UIMessage;
    const latest = findLatestWorkflowPlan([message]);
    expect(latest?.graph?.nodes).toHaveLength(3);
    if (!latest?.graph) throw new Error('expected workflow graph');
    expect(collectNodeStatuses(message, latest.graph)).toEqual({
      pre: 'completed',
      protected: state === 'output-error' ? 'failed' : 'completed',
      post: state === 'output-error' ? 'pending' : 'completed',
    });
  });

  it('does not infer completion from assistant prose or invent edges between independent nodes', () => {
    const graph = parseWorkflowGraph({
      nodes: [
        { id: 'a', tool: 'read', dependsOn: [] },
        { id: 'b', tool: 'text.compose', dependsOn: [] },
      ],
    });
    if (!graph) throw new Error('expected workflow graph');
    const message = {
      id: 'm',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'workflow_run',
          toolCallId: 'c',
          state: 'output-available',
          output: graph,
        },
        { type: 'text', text: 'Done' },
      ],
    } as UIMessage;
    expect(graph.edges).toEqual([]);
    expect(collectNodeStatuses(message, graph)).toEqual({ a: 'pending', b: 'pending' });
    expect(parseWorkflowGraph('Model says node a completed')).toBeNull();
    expect(parseWorkflowGraph('OPENRUSH_WORKFLOW_DAG:{broken')).toBeNull();
  });

  it('keeps versioned DSL nodes parallel when dependsOn is omitted', () => {
    const graph = parseWorkflowGraph({
      version: '1',
      name: 'parallel reads',
      nodes: [
        { id: 'a', tool: 'read' },
        { id: 'b', tool: 'read' },
      ],
    });
    expect(graph?.edges).toEqual([]);
    expect(graph?.waves).toEqual([['a', 'b']]);
  });

  it('extracts the final article from an embedded compose node', () => {
    const output = {
      text: `done\nOPENRUSH_WORKFLOW_DAG:${JSON.stringify({
        nodes: [
          { id: 'read', tool: 'read', status: 'completed', output: { ok: true } },
          { id: 'compose', tool: 'text.compose', status: 'completed', output: 'finished article' },
        ],
      })}`,
    };
    expect(extractWorkflowArticle(output)).toBe('finished article');
  });

  it('uses the last workflow call in a message', () => {
    const parts = ['old', 'new'].map((id) => ({
      type: 'dynamic-tool',
      toolName: 'workflow_run',
      toolCallId: id,
      state: 'output-available',
      output: { nodes: [{ id, tool: 'read' }] },
    }));
    const latest = findLatestWorkflowPlan([{ id: 'm', role: 'assistant', parts } as UIMessage]);
    expect(latest?.part.toolCallId).toBe('new');
    expect(latest?.graph?.nodes[0].id).toBe('new');
  });

  it('keeps every workflow run in conversation order', () => {
    const workflowPart = (id: string) => ({
      type: 'dynamic-tool',
      toolName: 'workflow_run',
      toolCallId: id,
      state: 'output-available',
      output: { name: id, nodes: [{ id: `${id}-node`, tool: 'read', status: 'completed' }] },
    });
    const messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [workflowPart('first'), { type: 'text', text: 'done' }, workflowPart('second')],
      },
      { id: 'm2', role: 'assistant', parts: [workflowPart('third')] },
    ] as UIMessage[];

    const runs = findWorkflowPlans(messages);
    expect(runs.map((run) => run.part.toolCallId)).toEqual(['first', 'second', 'third']);
    expect(runs.map((run) => run.graph?.name)).toEqual(['first', 'second', 'third']);
    expect(new Set(runs.map((run) => run.key)).size).toBe(3);
  });

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
    expect(prettyToolName('ao04_read_status')).toBe('项目质量检查 · AO-04');
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
