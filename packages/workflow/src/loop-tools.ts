// AIGC START
import { isEligibleLoopTool } from './loop-tool-policy.js';
import type { JsonValue, ToolDescriptor, ToolInvoker } from './types.js';
import { jsonValue, WorkflowError } from './types.js';

export {
  deniedLoopTools,
  eligibleLoopTools,
  formatDeniedLoopToolList,
  formatEligibleLoopToolList,
  isDeniedLoopTool,
  isEligibleLoopTool,
  LOOP_TOOL_DENYLIST,
  LOOP_TOOL_POLICY,
  loopToolDenyReason,
} from './loop-tool-policy.js';

export interface LoopToolSchema {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface LoopExecuteInput {
  name: string;
  arguments: unknown;
  signal?: AbortSignal;
  callId?: string;
  parent?: unknown;
  agent?: unknown;
}

export interface LoopExecuteResult {
  isError?: boolean;
  value?: unknown;
  content?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
  error?: { message?: string };
}

export interface LoopToolsLike {
  schemas(scope?: unknown): LoopToolSchema[];
  execute(input: LoopExecuteInput): Promise<LoopExecuteResult>;
}

function contentText(
  content: Array<{ type?: string; text?: string; [key: string]: unknown }> | undefined
): string {
  if (!content?.length) return '';
  return content
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('\n')
    .trim();
}

function asJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function parseJsonText(text: string): JsonValue | undefined {
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return undefined;
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    return undefined;
  }
}

/** Flatten a Loop/MCP execute payload so {{nodes.x.output.*}} sees real fields. */
export function flattenLoopToolValue(
  value: unknown,
  content?: LoopExecuteResult['content']
): JsonValue {
  const rec = asJsonObject(value);
  if (rec && 'structuredContent' in rec && rec.structuredContent != null) {
    const structured = rec.structuredContent;
    if (structured && typeof structured === 'object') return jsonValue(structured);
    if (typeof structured === 'string') {
      return parseJsonText(structured) ?? { text: structured };
    }
    return jsonValue(structured);
  }
  if (rec && Array.isArray(rec.content) && rec.structuredContent == null) {
    const fromBlocks = contentText(rec.content as LoopExecuteResult['content']);
    const parsed = parseJsonText(fromBlocks);
    if (parsed !== undefined) return parsed;
    if (fromBlocks) return { text: fromBlocks };
  }
  if (typeof value === 'string') {
    return parseJsonText(value) ?? { text: value };
  }
  if (value != null && typeof value === 'object') {
    return jsonValue(value);
  }
  const fromContent = contentText(content);
  if (fromContent) {
    return parseJsonText(fromContent) ?? { text: fromContent };
  }
  if (value == null) return { text: '' };
  return { text: String(value) };
}

export function flattenLoopExecuteResult(result: LoopExecuteResult): JsonValue {
  if (result.isError) {
    throw new WorkflowError(
      'node_failed',
      result.error?.message ?? (contentText(result.content) || 'tool failed')
    );
  }
  return flattenLoopToolValue(result.value, result.content);
}

export function schemasToToolDescriptors(schemas: LoopToolSchema[]): ToolDescriptor[] {
  return schemas
    .filter((schema) => isEligibleLoopTool(schema.name))
    .map((schema) => ({
      name: schema.name,
      description: schema.description ?? schema.name,
      inputSchema: schema.parameters,
    }));
}

const EXECUTE_LOG_MAX = 400;

function clipExecuteLog(value: unknown, max = EXECUTE_LOG_MAX): string {
  let raw: string;
  try {
    raw = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    raw = String(value);
  }
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max)}…[truncated]`;
}

function logLoopExecute(message: string): void {
  process.stderr.write(`[workflow_run] ${message}\n`);
}

export function createLoopToolInvoker(options: {
  tools: LoopToolsLike;
  agent?: unknown;
  parent?: unknown;
  signal?: AbortSignal;
  callIdPrefix?: string;
}): ToolInvoker {
  let seq = 0;
  return {
    listTools() {
      return schemasToToolDescriptors(options.tools.schemas(options.agent));
    },
    async invoke(name, args, signal) {
      seq += 1;
      logLoopExecute(`execute DSH tool: ${name} args=${clipExecuteLog(args)}`);
      let result: LoopExecuteResult;
      try {
        result = await options.tools.execute({
          name,
          arguments: args,
          signal: signal ?? options.signal,
          callId: `${options.callIdPrefix ?? 'wf'}:${seq}`,
          parent: options.parent,
          agent: options.agent,
        });
      } catch (err) {
        logLoopExecute(
          `DSH tool failed: ${name} error=${clipExecuteLog(err instanceof Error ? err.message : err)}`
        );
        throw err;
      }
      if (result.isError) {
        const err =
          result.error?.message ?? clipExecuteLog(result.content ?? result.value ?? 'tool failed');
        logLoopExecute(`DSH tool failed: ${name} error=${clipExecuteLog(err)}`);
      } else {
        logLoopExecute(`DSH tool ok: ${name}`);
      }
      return flattenLoopExecuteResult(result);
    },
  };
}
// AIGC END
