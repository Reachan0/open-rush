// AIGC START
import type { UIMessageChunk } from '@open-rush/agent-runtime';
import type { WorkflowEvent, WorkflowEventSink, WorkflowRunResult } from '@open-rush/workflow';

const PLAN_TOOL_ID = 'workflow-plan';
const PLAN_TOOL_NAME = 'workflow.plan';
const OUTPUT_MAX = 1500;
const COMPOSE_TOOL = /^(text|article)\.compose$/i;

function encodeSse(chunk: UIMessageChunk | '[DONE]'): string {
  const payload = chunk === '[DONE]' ? '[DONE]' : JSON.stringify(chunk);
  return `data: ${payload}\n\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clipOutput(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > OUTPUT_MAX ? `${value.slice(0, OUTPUT_MAX)}…` : value;
  }
  try {
    const json = JSON.stringify(value);
    if (json.length > OUTPUT_MAX) return { preview: `${json.slice(0, OUTPUT_MAX)}…` };
    return value;
  } catch {
    return String(value).slice(0, OUTPUT_MAX);
  }
}

function isComposeTool(name: unknown): boolean {
  return typeof name === 'string' && COMPOSE_TOOL.test(name);
}

export function buildWorkflowTranscript(result: WorkflowRunResult): string {
  if (result.ok && result.output != null) {
    return typeof result.output === 'string'
      ? result.output
      : JSON.stringify(result.output, null, 2);
  }
  if (!result.ok) {
    return String(result.error ?? '没有生成回复。');
  }
  return '没有生成回复。';
}

export class WorkflowUiMapper {
  private readonly messageId: string;
  private started = false;
  private stepOpen = false;
  private finished = false;
  private textId: string | null = null;
  private streamedText = false;
  private readonly composeIds = new Set<string>();
  private readonly toolNames = new Map<string, string>();
  private planOutputSent = false;

  constructor(messageId = crypto.randomUUID()) {
    this.messageId = messageId;
  }

  begin(): UIMessageChunk[] {
    if (this.started) return [];
    this.started = true;
    this.stepOpen = true;
    return [{ type: 'start', messageId: this.messageId }, { type: 'start-step' }];
  }

  push(event: WorkflowEvent): UIMessageChunk[] {
    if (this.finished) return [];
    const payload = isRecord(event.payload) ? event.payload : {};
    switch (event.eventType) {
      case 'workflow-planning':
        return this.mapPlanning(payload);
      case 'workflow-plan':
        return this.mapPlan(payload);
      case 'workflow-graph':
        return this.mapGraph(payload);
      case 'workflow-node-start':
        return this.mapNodeStart(payload);
      case 'workflow-node-end':
        return this.mapNodeEnd(payload);
      case 'workflow-fallback':
        return [
          {
            type: 'tool-output-error',
            toolCallId: PLAN_TOOL_ID,
            errorText: String(payload.error ?? payload.reason ?? 'workflow fallback'),
          },
        ];
      default:
        return [];
    }
  }

  complete(result: WorkflowRunResult): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = [];
    if (!this.streamedText) {
      chunks.push(...this.emitText(buildWorkflowTranscript(result)));
    }
    chunks.push(...this.finish(result.ok ? 'stop' : 'error'));
    return chunks;
  }

  error(errorText: string): UIMessageChunk[] {
    return [...this.emitText(errorText), { type: 'error', errorText }, ...this.finish('error')];
  }

  private mapPlanning(payload: Record<string, unknown>): UIMessageChunk[] {
    this.toolNames.set(PLAN_TOOL_ID, PLAN_TOOL_NAME);
    return [
      { type: 'tool-input-start', toolCallId: PLAN_TOOL_ID, toolName: PLAN_TOOL_NAME },
      {
        type: 'tool-input-available',
        toolCallId: PLAN_TOOL_ID,
        toolName: PLAN_TOOL_NAME,
        input: payload,
      },
    ];
  }

  private mapPlan(payload: Record<string, unknown>): UIMessageChunk[] {
    const dsl = isRecord(payload.dsl) ? payload.dsl : payload;
    this.rememberGraphNodes(dsl);
    this.planOutputSent = true;
    return [
      {
        type: 'tool-output-available',
        toolCallId: PLAN_TOOL_ID,
        output: {
          source: payload.source,
          attempts: payload.attempts,
          dsl,
        },
      },
    ];
  }

  private rememberGraphNodes(payload: Record<string, unknown>): void {
    const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    for (const node of nodes) {
      if (!isRecord(node) || typeof node.id !== 'string') continue;
      const tool = typeof node.tool === 'string' ? node.tool : 'tool';
      this.toolNames.set(node.id, tool);
      if (isComposeTool(tool)) this.composeIds.add(node.id);
    }
  }

  private mapGraph(payload: Record<string, unknown>): UIMessageChunk[] {
    this.rememberGraphNodes(payload);
    if (this.planOutputSent) return [];
    const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    const listed: Array<{ id: string; tool: string; dependsOn: string[] }> = [];
    for (const node of nodes) {
      if (!isRecord(node) || typeof node.id !== 'string') continue;
      const tool = typeof node.tool === 'string' ? node.tool : 'tool';
      const dependsOn = Array.isArray(node.dependsOn)
        ? node.dependsOn.filter((item): item is string => typeof item === 'string')
        : [];
      listed.push({ id: node.id, tool, dependsOn });
    }
    const edges = Array.isArray(payload.edges)
      ? payload.edges.filter(
          (edge): edge is { from: string; to: string } =>
            isRecord(edge) && typeof edge.from === 'string' && typeof edge.to === 'string'
        )
      : listed.flatMap((node) => node.dependsOn.map((from) => ({ from, to: node.id })));
    const waves = Array.isArray(payload.waves)
      ? payload.waves
          .filter((wave): wave is unknown[] => Array.isArray(wave))
          .map((wave) => wave.filter((id): id is string => typeof id === 'string'))
      : [];
    return [
      {
        type: 'tool-output-available',
        toolCallId: PLAN_TOOL_ID,
        output: { name: payload.name ?? 'workflow', nodes: listed, edges, waves },
      },
    ];
  }

  private mapNodeStart(payload: Record<string, unknown>): UIMessageChunk[] {
    const nodeId = String(payload.nodeId ?? '');
    if (!nodeId) return [];
    const toolName = String(payload.tool ?? this.toolNames.get(nodeId) ?? 'tool');
    this.toolNames.set(nodeId, toolName);
    if (isComposeTool(toolName)) this.composeIds.add(nodeId);
    return [
      { type: 'tool-input-start', toolCallId: nodeId, toolName },
      {
        type: 'tool-input-available',
        toolCallId: nodeId,
        toolName,
        input: payload.input ?? {},
      },
    ];
  }

  private mapNodeEnd(payload: Record<string, unknown>): UIMessageChunk[] {
    const nodeId = String(payload.nodeId ?? '');
    if (!nodeId) return [];
    const toolName = this.toolNames.get(nodeId) ?? 'tool';
    const failed = payload.status === 'failed';
    const toolChunks: UIMessageChunk[] = failed
      ? [
          {
            type: 'tool-output-error',
            toolCallId: nodeId,
            errorText: String(payload.error ?? 'node failed'),
          },
        ]
      : [
          {
            type: 'tool-output-available',
            toolCallId: nodeId,
            output: clipOutput(
              payload.status === 'skipped'
                ? { status: 'skipped' }
                : (payload.output ?? { status: payload.status })
            ),
          },
        ];
    if (this.composeIds.has(nodeId) || isComposeTool(toolName)) {
      if (failed) return toolChunks;
      const text =
        typeof payload.output === 'string'
          ? payload.output
          : payload.output != null
            ? JSON.stringify(payload.output)
            : '';
      if (!text.trim()) return toolChunks;
      return [...toolChunks, ...this.emitText(text)];
    }
    return toolChunks;
  }

  private emitText(text: string): UIMessageChunk[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    this.streamedText = true;
    if (!this.textId) this.textId = `text-${this.messageId}`;
    const id = this.textId;
    return [
      { type: 'text-start', id },
      { type: 'text-delta', id, delta: trimmed },
      { type: 'text-end', id },
    ];
  }

  private finish(reason: string): UIMessageChunk[] {
    if (this.finished) return [];
    this.finished = true;
    const chunks: UIMessageChunk[] = [];
    if (!this.started) {
      this.started = true;
      chunks.push({ type: 'start', messageId: this.messageId }, { type: 'start-step' });
      this.stepOpen = true;
    }
    if (this.stepOpen) {
      this.stepOpen = false;
      chunks.push({ type: 'finish-step' });
    }
    chunks.push({ type: 'finish', reason });
    return chunks;
  }
}

export function workflowRunToSseResponse(
  run: (sink: WorkflowEventSink) => Promise<WorkflowRunResult>
): Response {
  const mapper = new WorkflowUiMapper();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (chunks: UIMessageChunk[]) => {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(encodeSse(chunk)));
        }
      };
      try {
        enqueue(mapper.begin());
        const result = await run({
          emit: async (event) => {
            enqueue(mapper.push(event));
          },
        });
        enqueue(mapper.complete(result));
      } catch (err) {
        enqueue(mapper.error(err instanceof Error ? err.message : String(err)));
      } finally {
        controller.enqueue(encoder.encode(encodeSse('[DONE]')));
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'x-openrush-runtime': 'workflow',
      'x-openrush-lane': 'workflow',
    },
  });
}

export function workflowTranscriptToSseResponse(text: string): Response {
  const mapper = new WorkflowUiMapper();
  const chunks = [
    ...mapper.begin(),
    ...mapper.complete({
      ok: true,
      degraded: false,
      output: text,
      rounds: 0,
      durationMs: 0,
      events: [],
      dsl: { version: '1', nodes: [] },
      nodes: [],
      usage: { promptChars: 0, completionChars: 0, estimatedTokens: 0 },
    }),
  ];
  const body = `${chunks.map((chunk) => encodeSse(chunk)).join('')}${encodeSse('[DONE]')}`;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'x-openrush-runtime': 'workflow',
      'x-openrush-lane': 'workflow',
    },
  });
}
// AIGC END
