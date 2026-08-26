// AIGC START
import type { DynamicToolUIPart, UIMessage } from 'ai';

export type DagNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type WorkflowDagNode = {
  id: string;
  tool: string;
  dependsOn: string[];
};

export type WorkflowDagGraph = {
  name: string;
  nodes: WorkflowDagNode[];
  edges: Array<{ from: string; to: string }>;
  waves: string[][];
};

export type LayoutPos = { x: number; y: number; w: number };

export const DAG_NODE_W = 176;
export const DAG_NODE_H = 52;
export const DAG_GATE_W = 132;
export const DAG_GAP_X = 18;
export const DAG_GAP_Y = 38;
export const DAG_PAD = 18;

export const WORKFLOW_PLAN_TOOL = 'workflow.plan';
const COMPOSE_TOOL = /^(text|article)\.compose$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isComposeToolName(name: string): boolean {
  return COMPOSE_TOOL.test(name);
}

export function prettyToolName(name: string): string {
  const stripped = name
    .replace(/^amap-maps__/i, '高德 · ')
    .replace(/^coding-tools__/i, '编码 · ')
    .replace(/^web\.search$/i, '网页搜索')
    .replace(/^http\.fetch$/i, '抓取网页')
    .replace(/^fs\.read$/i, '读取文件')
    .replace(/^text\.compose$/i, '成文')
    .replace(/^article\.compose$/i, '成文')
    .replace(/^workflow\.plan$/i, '执行计划');
  return stripped.replaceAll('_', ' ');
}

export function parseWorkflowGraph(output: unknown): WorkflowDagGraph | null {
  if (!isRecord(output)) return null;
  const rawNodes = Array.isArray(output.nodes) ? output.nodes : [];
  const nodes: WorkflowDagNode[] = [];
  for (const node of rawNodes) {
    if (!isRecord(node) || typeof node.id !== 'string') continue;
    const tool = typeof node.tool === 'string' ? node.tool : 'tool';
    const dependsOn = Array.isArray(node.dependsOn)
      ? node.dependsOn.filter((item): item is string => typeof item === 'string')
      : [];
    nodes.push({ id: node.id, tool, dependsOn });
  }
  if (nodes.length === 0) return null;
  const edges = Array.isArray(output.edges)
    ? output.edges.filter(
        (edge): edge is { from: string; to: string } =>
          isRecord(edge) && typeof edge.from === 'string' && typeof edge.to === 'string'
      )
    : nodes.flatMap((node) => node.dependsOn.map((from) => ({ from, to: node.id })));
  const effectiveEdges = edges.length > 0 ? edges : sequentialEdges(nodes);
  const waves = Array.isArray(output.waves)
    ? output.waves
        .filter((wave): wave is unknown[] => Array.isArray(wave))
        .map((wave) => wave.filter((id): id is string => typeof id === 'string'))
        .filter((wave) => wave.length > 0)
    : inferWaves(nodes, effectiveEdges);
  return {
    name: typeof output.name === 'string' && output.name ? output.name : 'workflow',
    nodes,
    edges: effectiveEdges,
    waves: waves.length > 0 ? waves : inferWaves(nodes, effectiveEdges),
  };
}

export function sequentialEdges(nodes: WorkflowDagNode[]): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (let i = 1; i < nodes.length; i += 1) {
    edges.push({ from: nodes[i - 1].id, to: nodes[i].id });
  }
  return edges;
}

export function inferWaves(
  nodes: WorkflowDagNode[],
  edges: Array<{ from: string; to: string }>
): string[][] {
  const ids = new Set(nodes.map((node) => node.id));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const id of ids) {
    incoming.set(id, 0);
    outgoing.set(id, []);
  }
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const remaining = new Set(ids);
  const waves: string[][] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => (incoming.get(id) ?? 0) === 0).sort();
    if (ready.length === 0) {
      waves.push([...remaining].sort());
      break;
    }
    waves.push(ready);
    for (const id of ready) {
      remaining.delete(id);
      for (const next of outgoing.get(id) ?? []) {
        incoming.set(next, Math.max(0, (incoming.get(next) ?? 1) - 1));
      }
    }
  }
  return waves;
}

export function findWorkflowPlanPart(message: UIMessage): DynamicToolUIPart | undefined {
  return message.parts.find(
    (part): part is DynamicToolUIPart =>
      part.type === 'dynamic-tool' && part.toolName === WORKFLOW_PLAN_TOOL
  );
}

export function workflowNodeIdSet(graph: WorkflowDagGraph): Set<string> {
  return new Set(graph.nodes.map((node) => node.id));
}

export function toolStateToDagStatus(state: DynamicToolUIPart['state'] | undefined): DagNodeStatus {
  switch (state) {
    case 'output-error':
      return 'failed';
    case 'output-available':
    case 'output-denied':
    case 'approval-responded':
      return 'completed';
    case 'input-available':
    case 'approval-requested':
      return 'running';
    default:
      return 'pending';
  }
}

export function collectNodeStatuses(
  message: UIMessage,
  graph: WorkflowDagGraph
): Record<string, DagNodeStatus> {
  const statuses: Record<string, DagNodeStatus> = {};
  for (const node of graph.nodes) statuses[node.id] = 'pending';
  for (const part of message.parts) {
    if (part.type !== 'dynamic-tool') continue;
    const toolPart = part as DynamicToolUIPart;
    const nodeId = statuses[toolPart.toolCallId]
      ? toolPart.toolCallId
      : graph.nodes.find(
          (node) => node.tool === toolPart.toolName && statuses[node.id] === 'pending'
        )?.id;
    if (!nodeId || statuses[nodeId] === undefined) continue;
    let status = toolStateToDagStatus(toolPart.state);
    if (
      status === 'completed' &&
      isRecord(toolPart.output) &&
      toolPart.output.status === 'skipped'
    ) {
      status = 'skipped';
    }
    statuses[nodeId] = status;
  }
  const hasReply = message.parts.some(
    (part) => part.type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0
  );
  if (hasReply) {
    for (const node of graph.nodes) {
      if (
        isComposeToolName(node.tool) &&
        (statuses[node.id] === 'pending' || statuses[node.id] === 'running')
      ) {
        statuses[node.id] = 'completed';
      }
    }
  }
  return statuses;
}

export type DagLayout = {
  pos: Record<string, LayoutPos>;
  visWaves: Array<Array<{ id: string; terminal?: 'start' | 'end' }>>;
  width: number;
  height: number;
  extraEdges: Array<{ from: string; to: string }>;
};

export function layoutWorkflowDag(graph: WorkflowDagGraph): DagLayout {
  const visWaves: Array<Array<{ id: string; terminal?: 'start' | 'end' }>> = [
    [{ id: '__start__', terminal: 'start' }],
    ...graph.waves.map((wave) => wave.map((id) => ({ id }))),
    [{ id: '__end__', terminal: 'end' }],
  ];
  const widths = visWaves.map((wave) => {
    const boxW = wave[0]?.terminal ? DAG_GATE_W : DAG_NODE_W;
    return wave.length * boxW + Math.max(0, wave.length - 1) * DAG_GAP_X;
  });
  const maxW = Math.max(...widths, DAG_NODE_W);
  const pos: Record<string, LayoutPos> = {};
  visWaves.forEach((wave, row) => {
    const rowW = widths[row] ?? DAG_NODE_W;
    const y = DAG_PAD + 18 + row * (DAG_NODE_H + DAG_GAP_Y);
    const boxW = wave[0]?.terminal ? DAG_GATE_W : DAG_NODE_W;
    wave.forEach((slot, col) => {
      const x = DAG_PAD + (maxW - rowW) / 2 + col * (boxW + DAG_GAP_X);
      pos[slot.id] = { x, y, w: boxW };
    });
  });
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const roots = graph.nodes
    .filter(
      (node) => node.dependsOn.length === 0 && !graph.edges.some((edge) => edge.to === node.id)
    )
    .map((node) => node.id);
  const sinks = graph.nodes
    .filter((node) => !graph.edges.some((edge) => edge.from === node.id))
    .map((node) => node.id);
  const extraEdges = [
    ...roots.map((id) => ({ from: '__start__', to: id })),
    ...sinks.map((id) => ({ from: id, to: '__end__' })),
  ];
  if (roots.length === 0 && nodeIds.size > 0) {
    extraEdges.push({ from: '__start__', to: graph.waves[0]?.[0] ?? [...nodeIds][0] });
  }
  if (sinks.length === 0 && nodeIds.size > 0) {
    const lastWave = graph.waves[graph.waves.length - 1];
    const fallbackSink = lastWave?.[lastWave.length - 1] ?? [...nodeIds].at(-1);
    if (fallbackSink) extraEdges.push({ from: fallbackSink, to: '__end__' });
  }
  return {
    pos,
    visWaves,
    width: maxW + DAG_PAD * 2,
    height: DAG_PAD + 18 + visWaves.length * (DAG_NODE_H + DAG_GAP_Y),
    extraEdges,
  };
}

export function waveRowLabel(
  wave: Array<{ id: string; terminal?: 'start' | 'end' }>,
  stepIndex: number
): string {
  const first = wave[0];
  if (first?.terminal === 'start') return '入口';
  if (first?.terminal === 'end') return '出口';
  if (wave.length > 1) return `并行 · ${wave.length}`;
  return `步骤 ${stepIndex}`;
}

export function truncateDagLabel(text: string, max = 22): string {
  const value = text.trim();
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1))}…`;
}

export function countDagProgress(statuses: Record<string, DagNodeStatus>): {
  total: number;
  done: number;
  running: boolean;
  failed: boolean;
} {
  const values = Object.values(statuses);
  return {
    total: values.length,
    done: values.filter((status) => status === 'completed' || status === 'skipped').length,
    running: values.some((status) => status === 'running'),
    failed: values.some((status) => status === 'failed'),
  };
}

export function findLatestWorkflowPlan(messages: UIMessage[]): {
  message: UIMessage;
  part: DynamicToolUIPart;
  graph: WorkflowDagGraph | null;
} | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const part = findWorkflowPlanPart(message);
    if (part) return { message, part, graph: parseWorkflowGraph(part.output) };
  }
  return null;
}

export function previewDagValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.length > 1200 ? `${value.slice(0, 1200)}…` : value;
  try {
    const json = JSON.stringify(value, null, 2);
    return json.length > 1200 ? `${json.slice(0, 1200)}…` : json;
  } catch {
    return String(value);
  }
}

export function isWorkflowHiddenToolPart(
  part: UIMessage['parts'][number],
  message: UIMessage
): boolean {
  if (part.type !== 'dynamic-tool') return false;
  const toolPart = part as DynamicToolUIPart;
  if (toolPart.toolName === WORKFLOW_PLAN_TOOL) return false;
  if (isComposeToolName(toolPart.toolName)) return true;
  const plan = findWorkflowPlanPart(message);
  const graph = parseWorkflowGraph(plan?.output);
  if (!graph) return false;
  return workflowNodeIdSet(graph).has(toolPart.toolCallId);
}
// AIGC END
