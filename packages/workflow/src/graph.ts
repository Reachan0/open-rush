// AIGC START
import type { WorkflowDsl } from './types.js';
import { validateWorkflowDsl } from './validate.js';

export interface WorkflowGraphNode {
  id: string;
  tool: string;
  dependsOn: string[];
  if?: string;
  foreach?: string;
  input?: Record<string, unknown>;
}

export interface WorkflowGraph {
  name?: string;
  nodes: WorkflowGraphNode[];
  edges: Array<{ from: string; to: string }>;
  waves: string[][];
}

export function workflowGraph(dsl: WorkflowDsl): WorkflowGraph {
  const { waves } = validateWorkflowDsl(dsl);
  return {
    name: dsl.name,
    nodes: dsl.nodes.map((node) => ({
      id: node.id,
      tool: node.tool,
      dependsOn: node.dependsOn ?? [],
      ...(node.if ? { if: node.if } : {}),
      ...(node.foreach ? { foreach: node.foreach } : {}),
      ...(node.input ? { input: node.input } : {}),
    })),
    edges: dsl.nodes.flatMap((node) =>
      (node.dependsOn ?? []).map((from) => ({ from, to: node.id }))
    ),
    waves,
  };
}
// AIGC END
