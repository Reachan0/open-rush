// AIGC START
import { llmCompleteFromEnv } from './complete-llm.js';
import { executeWorkflow } from './engine.js';
import { estimateTokens } from './events.js';
import { generateWorkflowDsl, type LlmComplete } from './generate.js';
import { runTravelAgentLoop } from './loop-simulator.js';
import type {
  FallbackReason,
  JsonValue,
  ToolInvoker,
  WorkflowDsl,
  WorkflowEvent,
  WorkflowEventSink,
  WorkflowGuards,
  WorkflowRunResult,
} from './types.js';
import { WorkflowError } from './types.js';

export interface WorkflowRunInput {
  intent?: string;
  dsl?: unknown;
  tools: ToolInvoker;
  complete?: LlmComplete;
  allowHeuristic?: boolean;
  sink?: WorkflowEventSink;
  guards?: Partial<WorkflowGuards>;
  signal?: AbortSignal;
  fallback?: (
    reason: FallbackReason,
    error: string,
    nodeId?: string
  ) => Promise<JsonValue | undefined>;
  disableFallback?: boolean;
}

function reasonFromError(err: unknown): { reason: FallbackReason; nodeId?: string; error: string } {
  const error = err instanceof Error ? err.message : String(err);
  if (err instanceof WorkflowError) {
    if (err.code === 'generate_failed')
      return { reason: 'generate_failed', error, nodeId: err.nodeId };
    if (err.code === 'guard_max_steps')
      return { reason: 'guard_max_steps', error, nodeId: err.nodeId };
    if (err.code === 'guard_max_loop')
      return { reason: 'guard_max_loop', error, nodeId: err.nodeId };
    if (err.code === 'guard_timeout') return { reason: 'guard_timeout', error, nodeId: err.nodeId };
    if (
      err.code === 'duplicate_id' ||
      err.code === 'missing_dep' ||
      err.code === 'cycle' ||
      err.code === 'unknown_tool' ||
      err.code === 'validate_failed'
    ) {
      return { reason: 'validate_failed', error, nodeId: err.nodeId };
    }
    return { reason: 'node_failed', error, nodeId: err.nodeId };
  }
  return { reason: 'node_failed', error };
}

export async function workflowRun(input: WorkflowRunInput): Promise<WorkflowRunResult> {
  const started = Date.now();
  const events: WorkflowEvent[] = [];
  const sink: WorkflowEventSink = {
    async emit(event) {
      events.push(event);
      if (input.sink) {
        try {
          await input.sink.emit(event);
        } catch {
          // B8
        }
      }
    },
  };

  const defaultFallback = async () => {
    if (!input.intent) return undefined;
    const looped = await runTravelAgentLoop(input.intent, input.tools);
    return looped.output;
  };

  const runFallback = async (
    reason: FallbackReason,
    error: string,
    extra?: {
      dsl?: WorkflowDsl;
      nodeId?: string;
      rounds?: number;
      usage?: WorkflowRunResult['usage'];
    }
  ): Promise<WorkflowRunResult> => {
    if (input.disableFallback) {
      return {
        ok: false,
        degraded: false,
        reason,
        error,
        nodeId: extra?.nodeId,
        dsl: extra?.dsl,
        events,
        rounds: extra?.rounds ?? 0,
        durationMs: Date.now() - started,
        usage: extra?.usage ?? { promptChars: 0, completionChars: 0, estimatedTokens: 0 },
      };
    }
    try {
      const fb = input.fallback ?? defaultFallback;
      const output = await fb(reason, error, extra?.nodeId);
      return {
        ok: true,
        degraded: true,
        reason,
        error,
        nodeId: extra?.nodeId,
        dsl: extra?.dsl,
        output,
        events,
        rounds: (extra?.rounds ?? 0) + 7,
        durationMs: Date.now() - started,
        usage: extra?.usage ?? { promptChars: 0, completionChars: 0, estimatedTokens: 0 },
      };
    } catch (fbErr) {
      return {
        ok: false,
        degraded: false,
        reason,
        error: `${error}; fallback failed: ${fbErr instanceof Error ? fbErr.message : String(fbErr)}`,
        nodeId: extra?.nodeId,
        dsl: extra?.dsl,
        events,
        rounds: extra?.rounds ?? 0,
        durationMs: Date.now() - started,
        usage: extra?.usage ?? { promptChars: 0, completionChars: 0, estimatedTokens: 0 },
      };
    }
  };

  let dsl: WorkflowDsl | undefined;
  let rounds = 0;
  let usage = { promptChars: 0, completionChars: 0, estimatedTokens: 0 };

  try {
    if (input.dsl) {
      dsl = input.dsl as WorkflowDsl;
    } else {
      if (!input.intent) {
        throw new WorkflowError('generate_failed', 'intent or dsl is required');
      }
      const complete = input.complete ?? llmCompleteFromEnv();
      await sink.emit({
        eventType: 'workflow-planning',
        payload: { intent: input.intent, via: complete ? 'llm' : 'heuristic' },
      });
      const generated = await generateWorkflowDsl({
        intent: input.intent,
        tools: await input.tools.listTools(),
        complete,
        allowHeuristic: input.allowHeuristic ?? !complete,
      });
      dsl = generated.dsl;
      rounds = generated.attempts;
      usage = generated.usage;
    }
  } catch (err) {
    const mapped = reasonFromError(err);
    await sink.emit({ eventType: 'workflow-fallback', payload: mapped });
    return runFallback(mapped.reason, mapped.error, { nodeId: mapped.nodeId, rounds, usage });
  }

  try {
    const intentFields: Record<string, JsonValue> = input.intent ? { text: input.intent } : {};
    const executed = await executeWorkflow(dsl, {
      intent: intentFields,
      tools: input.tools,
      guards: input.guards,
      sink,
      signal: input.signal,
    });
    const article = executed.output;
    if (typeof article === 'string' && article.trim().length === 0) {
      return runFallback('unsatisfactory', 'empty workflow output', { dsl, rounds, usage });
    }
    await sink.emit({
      eventType: 'workflow-usage',
      payload: { estimatedTokens: usage.estimatedTokens, scope: 'generate' },
    });
    return {
      ok: true,
      degraded: false,
      dsl,
      nodes: executed.nodes,
      output: executed.output,
      events,
      rounds: rounds || 1,
      durationMs: Date.now() - started,
      usage: {
        ...usage,
        estimatedTokens:
          usage.estimatedTokens + estimateTokens(JSON.stringify(executed.output ?? '')),
      },
    };
  } catch (err) {
    const mapped = reasonFromError(err);
    await sink.emit({ eventType: 'workflow-fallback', payload: mapped });
    return runFallback(mapped.reason, mapped.error, { dsl, nodeId: mapped.nodeId, rounds, usage });
  }
}
// AIGC END
