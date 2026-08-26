// AIGC START
import { parseWorkflowDsl } from './schema.js';
import type { ToolDescriptor, WorkflowDsl } from './types.js';
import { WorkflowError } from './types.js';

export interface ValidateOptions {
  tools?: ToolDescriptor[];
}

export interface ValidateResult {
  dsl: WorkflowDsl;
  waves: string[][];
}

const NODE_REF_RE = /\{\{\s*nodes\.([A-Za-z0-9_-]+)/g;

export function collectNodeRefs(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\{\{\s*nodes\.([A-Za-z0-9_-]+)/g)) {
      into.add(match[1]);
    }
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNodeRefs(item, into);
    return into;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectNodeRefs(item, into);
    }
  }
  return into;
}

export function detectCycle(dsl: WorkflowDsl): string[] | null {
  const byId = new Map(dsl.nodes.map((n) => [n.id, n]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const dfs = (id: string): boolean => {
    if (visited.has(id)) return false;
    if (visiting.has(id)) {
      stack.push(id);
      return true;
    }
    visiting.add(id);
    stack.push(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (dfs(dep)) return true;
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  for (const node of dsl.nodes) {
    if (dfs(node.id)) {
      const start = stack.indexOf(stack[stack.length - 1]);
      return stack.slice(start);
    }
  }
  return null;
}

export function topoWaves(dsl: WorkflowDsl): string[][] {
  const byId = new Map(dsl.nodes.map((n) => [n.id, n]));
  const remaining = new Set(dsl.nodes.map((n) => n.id));
  const waves: string[][] = [];

  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) =>
      (byId.get(id)?.dependsOn ?? []).every((dep) => !remaining.has(dep))
    );
    if (ready.length === 0) {
      throw new WorkflowError(
        'cycle',
        `cycle or missing dependency among: ${[...remaining].join(', ')}`
      );
    }
    waves.push(ready.sort());
    for (const id of ready) remaining.delete(id);
  }
  return waves;
}

export function validateWorkflowDsl(input: unknown, options: ValidateOptions = {}): ValidateResult {
  let dsl: WorkflowDsl;
  try {
    dsl = parseWorkflowDsl(input);
  } catch (err) {
    throw new WorkflowError('validate_failed', err instanceof Error ? err.message : String(err));
  }
  const ids = dsl.nodes.map((n) => n.id);
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    throw new WorkflowError('duplicate_id', `duplicate node id: ${dup}`);
  }

  dsl = {
    ...dsl,
    nodes: dsl.nodes.map((node) => {
      const deps = new Set(node.dependsOn ?? []);
      collectNodeRefs(node.input, deps);
      collectNodeRefs(node.if, deps);
      collectNodeRefs(node.foreach, deps);
      deps.delete(node.id);
      const dependsOn = [...deps];
      return dependsOn.length > 0 ? { ...node, dependsOn } : { ...node, dependsOn: undefined };
    }),
  };

  for (const node of dsl.nodes) {
    for (const dep of node.dependsOn ?? []) {
      if (!unique.has(dep)) {
        throw new WorkflowError(
          'missing_dep',
          `node ${node.id} depends on unknown node ${dep}`,
          node.id
        );
      }
      if (dep === node.id) {
        throw new WorkflowError('cycle', `node ${node.id} depends on itself`, node.id);
      }
    }
  }

  const cycle = detectCycle(dsl);
  if (cycle) {
    throw new WorkflowError('cycle', `cycle detected: ${cycle.join(' -> ')}`);
  }

  if (options.tools) {
    const names = new Set(options.tools.map((t) => t.name.toLowerCase()));
    for (const node of dsl.nodes) {
      if (!names.has(node.tool.toLowerCase())) {
        throw new WorkflowError(
          'unknown_tool',
          `node ${node.id} references unknown tool ${node.tool}`,
          node.id
        );
      }
    }
  }

  return { dsl, waves: topoWaves(dsl) };
}
// AIGC END
