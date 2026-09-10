// AIGC START
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export function jsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

export interface WorkflowNode {
  id: string;
  tool: string;
  input?: Record<string, JsonValue>;
  dependsOn?: string[];
  /** Skip the node when the interpolated condition is false. */
  if?: string;
  /** Interpolated path that must resolve to an array; runs the tool once per item. */
  foreach?: string;
}

export interface WorkflowDsl {
  version: '1';
  name?: string;
  nodes: WorkflowNode[];
}

export type NodeStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed';

export interface NodeResult {
  id: string;
  tool: string;
  status: NodeStatus;
  output?: JsonValue;
  error?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  iterations?: number;
}

export interface WorkflowGuards {
  maxSteps: number;
  maxLoop: number;
  nodeTimeoutMs: number;
}

export const DEFAULT_GUARDS: WorkflowGuards = {
  maxSteps: 50,
  maxLoop: 20,
  nodeTimeoutMs: 60_000,
};

export class WorkflowError extends Error {
  readonly code: string;
  readonly nodeId?: string;
  readonly nodes?: NodeResult[];

  constructor(code: string, message: string, nodeId?: string, nodes?: NodeResult[]) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
    this.nodeId = nodeId;
    this.nodes = nodes;
  }
}

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema?: unknown;
}

export interface ToolInvoker {
  listTools(): ToolDescriptor[] | Promise<ToolDescriptor[]>;
  invoke(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<JsonValue>;
}

export interface WorkflowEvent {
  eventType: string;
  payload: unknown;
}

export interface WorkflowEventSink {
  emit(event: WorkflowEvent): Promise<void> | void;
}

export interface TokenUsage {
  promptChars: number;
  completionChars: number;
  estimatedTokens: number;
}

export type FallbackReason =
  | 'generate_failed'
  | 'validate_failed'
  | 'guard_max_steps'
  | 'guard_max_loop'
  | 'guard_timeout'
  | 'node_failed'
  | 'unsatisfactory';

export interface WorkflowRunSuccess {
  ok: true;
  degraded: false;
  dsl: WorkflowDsl;
  nodes: NodeResult[];
  output: JsonValue | undefined;
  events: WorkflowEvent[];
  rounds: number;
  durationMs: number;
  usage: TokenUsage;
}

export interface WorkflowRunDegraded {
  ok: true;
  degraded: true;
  reason: FallbackReason;
  nodeId?: string;
  error: string;
  dsl?: WorkflowDsl;
  nodes?: NodeResult[];
  output: JsonValue | undefined;
  events: WorkflowEvent[];
  rounds: number;
  durationMs: number;
  usage: TokenUsage;
}

export interface WorkflowRunFailure {
  ok: false;
  degraded: false;
  reason: FallbackReason;
  nodeId?: string;
  error: string;
  dsl?: WorkflowDsl;
  nodes?: NodeResult[];
  events: WorkflowEvent[];
  rounds: number;
  durationMs: number;
  usage: TokenUsage;
}

export type WorkflowRunResult = WorkflowRunSuccess | WorkflowRunDegraded | WorkflowRunFailure;

export const WORKFLOW_RUN_TOOL = {
  name: 'workflow-run',
  description:
    'Generate (optional) and execute a JSON DAG workflow against registered tools. Use for deterministic multi-tool tasks instead of a multi-round agent loop.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      intent: {
        type: 'string',
        description: 'User intent used to generate a DSL when dsl is omitted',
      },
      dsl: { type: 'object', description: 'Already-validated or candidate WorkflowDsl' },
    },
  },
} as const;
// AIGC END
