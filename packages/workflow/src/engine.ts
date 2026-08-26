// AIGC START

import { workflowGraph } from './graph.js';
import { evalCondition, type InterpContext, interpolateValue, lookup } from './interpolate.js';
import type {
  JsonValue,
  NodeResult,
  ToolInvoker,
  WorkflowEventSink,
  WorkflowGuards,
  WorkflowNode,
} from './types.js';
import { DEFAULT_GUARDS, jsonValue, WorkflowError } from './types.js';
import { validateWorkflowDsl } from './validate.js';

export interface ExecuteOptions {
  intent?: Record<string, JsonValue>;
  tools: ToolInvoker;
  guards?: Partial<WorkflowGuards>;
  sink?: WorkflowEventSink;
  signal?: AbortSignal;
}

export interface ExecuteResult {
  nodes: NodeResult[];
  output: JsonValue | undefined;
  steps: number;
}

function asArgs(value: JsonValue | undefined): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function normalizeToolName(name: string): string {
  return name.toLowerCase();
}

async function emitSafe(sink: WorkflowEventSink | undefined, eventType: string, payload: unknown) {
  if (!sink) return;
  try {
    await sink.emit({ eventType, payload });
  } catch {
    // B8: metering failure must not block execution
  }
}

function resolveTool(name: string, catalog: { name: string }[]): string {
  const hit = catalog.find((t) => normalizeToolName(t.name) === normalizeToolName(name));
  return hit?.name ?? name;
}

async function invokeWithTimeout(
  tools: ToolInvoker,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs: number,
  parentSignal?: AbortSignal
): Promise<JsonValue> {
  const ac = new AbortController();
  const timeoutError = new WorkflowError('guard_timeout', `tool ${toolName} timed out`);
  const onParentAbort = () => ac.abort(parentSignal?.reason ?? timeoutError);
  if (parentSignal?.aborted) {
    throw parentSignal.reason instanceof Error
      ? parentSignal.reason
      : new WorkflowError('aborted', 'workflow aborted');
  }
  parentSignal?.addEventListener('abort', onParentAbort);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    return await Promise.race([tools.invoke(toolName, args, ac.signal), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

export async function executeWorkflow(
  input: unknown,
  options: ExecuteOptions
): Promise<ExecuteResult> {
  const guards: WorkflowGuards = { ...DEFAULT_GUARDS, ...options.guards };
  const catalog = await options.tools.listTools();
  const { dsl } = validateWorkflowDsl(input, { tools: catalog });
  await emitSafe(options.sink, 'workflow-graph', workflowGraph(dsl));

  const results = new Map<string, NodeResult>();
  for (const node of dsl.nodes) {
    results.set(node.id, { id: node.id, tool: node.tool, status: 'pending' });
  }

  let steps = 0;
  const byId = new Map(dsl.nodes.map((n) => [n.id, n]));
  const remaining = new Set(dsl.nodes.map((n) => n.id));

  const ctxOf = (): InterpContext => ({
    intent: options.intent ?? {},
    nodes: Object.fromEntries([...results.entries()].map(([id, r]) => [id, { output: r.output }])),
  });

  const runNode = async (node: WorkflowNode): Promise<void> => {
    const started = Date.now();
    const base: NodeResult = {
      id: node.id,
      tool: node.tool,
      status: 'running',
      startedAt: new Date(started).toISOString(),
    };
    results.set(node.id, base);
    await emitSafe(options.sink, 'workflow-node-start', {
      nodeId: node.id,
      tool: node.tool,
      input: interpolateValue(node.input as JsonValue | undefined, ctxOf()),
    });

    try {
      if (options.signal?.aborted) {
        throw new WorkflowError('aborted', 'workflow aborted', node.id);
      }

      const ctx = ctxOf();
      if (node.if && !evalCondition(node.if, ctx)) {
        results.set(node.id, {
          ...base,
          status: 'skipped',
          endedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
        });
        await emitSafe(options.sink, 'workflow-node-end', {
          nodeId: node.id,
          status: 'skipped',
          durationMs: Date.now() - started,
        });
        return;
      }

      const toolName = resolveTool(node.tool, catalog);

      if (node.foreach) {
        const listRaw = lookup(node.foreach.replace(/^\{\{\s*|\s*\}\}$/g, ''), ctx);
        if (!Array.isArray(listRaw)) {
          throw new WorkflowError(
            'foreach',
            `node ${node.id} foreach did not resolve to an array`,
            node.id
          );
        }
        if (listRaw.length > guards.maxLoop) {
          throw new WorkflowError(
            'guard_max_loop',
            `node ${node.id} foreach length ${listRaw.length} exceeds maxLoop ${guards.maxLoop}`,
            node.id
          );
        }
        steps += listRaw.length;
        if (steps > guards.maxSteps) {
          throw new WorkflowError(
            'guard_max_steps',
            `maxSteps ${guards.maxSteps} exceeded at node ${node.id}`,
            node.id
          );
        }
        const parentCtx = ctxOf();
        await emitSafe(options.sink, 'workflow-foreach', {
          nodeId: node.id,
          total: listRaw.length,
        });
        const collected = await Promise.all(
          listRaw.map(async (item, index) => {
            const itemCtx: InterpContext = { ...parentCtx, item: item as JsonValue };
            const args = asArgs(interpolateValue(node.input as JsonValue | undefined, itemCtx));
            await emitSafe(options.sink, 'workflow-foreach-item', {
              nodeId: node.id,
              index,
              total: listRaw.length,
              status: 'running',
              ...(typeof args.url === 'string' ? { url: args.url } : {}),
            });
            try {
              const value = await invokeWithTimeout(
                options.tools,
                toolName,
                args,
                guards.nodeTimeoutMs,
                options.signal
              );
              await emitSafe(options.sink, 'workflow-foreach-item', {
                nodeId: node.id,
                index,
                total: listRaw.length,
                status: 'completed',
                ...(typeof args.url === 'string' ? { url: args.url } : {}),
              });
              return value;
            } catch (itemErr) {
              const message = itemErr instanceof Error ? itemErr.message : String(itemErr);
              await emitSafe(options.sink, 'workflow-foreach-item', {
                nodeId: node.id,
                index,
                total: listRaw.length,
                status: 'failed',
                error: message,
                ...(typeof args.url === 'string' ? { url: args.url } : {}),
              });
              return jsonValue({
                skipped: true,
                error: message,
                ...(typeof args.url === 'string' ? { url: args.url } : {}),
              });
            }
          })
        );
        const itemFailures = collected.filter(
          (row) => row && typeof row === 'object' && !Array.isArray(row) && 'skipped' in row
        ).length;
        if (itemFailures === listRaw.length) {
          const first = collected.find((row) => row && typeof row === 'object' && 'error' in row) as
            | { error?: string }
            | undefined;
          throw new WorkflowError(
            'node_failed',
            first?.error ?? `node ${node.id} foreach failed for every item`,
            node.id
          );
        }
        results.set(node.id, {
          ...base,
          status: 'completed',
          output: collected,
          iterations: listRaw.length,
          endedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
        });
      } else {
        steps += 1;
        if (steps > guards.maxSteps) {
          throw new WorkflowError(
            'guard_max_steps',
            `maxSteps ${guards.maxSteps} exceeded at node ${node.id}`,
            node.id
          );
        }
        const args = asArgs(interpolateValue(node.input as JsonValue | undefined, ctxOf()));
        const output = await invokeWithTimeout(
          options.tools,
          toolName,
          args,
          guards.nodeTimeoutMs,
          options.signal
        );
        results.set(node.id, {
          ...base,
          status: 'completed',
          output,
          endedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
        });
      }

      const done = results.get(node.id);
      await emitSafe(options.sink, 'workflow-node-end', {
        nodeId: node.id,
        status: done?.status,
        durationMs: done?.durationMs,
        iterations: done?.iterations,
        output: done?.output,
      });
      await emitSafe(options.sink, 'workflow-usage', {
        nodeId: node.id,
        durationMs: done?.durationMs,
        estimatedTokens: 0,
      });
    } catch (err) {
      const nodeId = err instanceof WorkflowError ? (err.nodeId ?? node.id) : node.id;
      const code = err instanceof WorkflowError ? err.code : 'node_failed';
      const message = err instanceof Error ? err.message : String(err);
      results.set(node.id, {
        ...base,
        status: 'failed',
        error: message,
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
      });
      await emitSafe(options.sink, 'workflow-node-end', {
        nodeId,
        status: 'failed',
        error: message,
        durationMs: Date.now() - started,
      });
      throw new WorkflowError(code, message, nodeId);
    }
  };

  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => {
      const deps = byId.get(id)?.dependsOn ?? [];
      return deps.every((dep) => {
        const status = results.get(dep)?.status;
        return status === 'completed' || status === 'skipped';
      });
    });

    if (ready.length === 0) {
      const failed = [...results.values()].find((r) => r.status === 'failed');
      if (failed) {
        throw new WorkflowError('node_failed', failed.error ?? 'upstream failed', failed.id);
      }
      throw new WorkflowError('cycle', `no runnable nodes among: ${[...remaining].join(', ')}`);
    }

    const wave = ready.map((id) => byId.get(id)).filter((n): n is WorkflowNode => Boolean(n));
    const settled = await Promise.allSettled(wave.map((node) => runNode(node)));
    for (const id of ready) remaining.delete(id);

    const firstReject = settled.find((s) => s.status === 'rejected');
    if (firstReject && firstReject.status === 'rejected') {
      const reason = firstReject.reason;
      if (reason instanceof WorkflowError) throw reason;
      throw new WorkflowError(
        'node_failed',
        reason instanceof Error ? reason.message : String(reason)
      );
    }
  }

  const nodes = dsl.nodes.map((n) => results.get(n.id) as NodeResult);
  const last = [...nodes].reverse().find((n) => n.status === 'completed');
  await emitSafe(options.sink, 'workflow-done', {
    nodeCount: nodes.length,
    steps,
  });
  return { nodes, output: last?.output, steps };
}
// AIGC END
