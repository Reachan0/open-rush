// AIGC START
import { isEligibleLoopTool, type LoopToolPolicyOptions } from './loop-tool-policy.js';
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

export interface LoopToolResultAdapter {
  success?: (value: unknown, result: LoopExecuteResult) => JsonValue;
  failure?: (input: { error?: unknown; result?: LoopExecuteResult }) => Error;
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

export function schemasToToolDescriptors(
  schemas: LoopToolSchema[],
  options?: LoopToolPolicyOptions
): ToolDescriptor[] {
  return schemas
    .filter((schema) => isEligibleLoopTool(schema.name, options))
    .map((schema) => ({
      name: schema.name,
      description: schema.description ?? schema.name,
      inputSchema: schema.parameters,
    }));
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
  eligibleToolNames?: readonly string[];
  resultAdapters?: Readonly<Record<string, LoopToolResultAdapter>>;
}): ToolInvoker {
  let seq = 0;
  return {
    listTools() {
      return schemasToToolDescriptors(options.tools.schemas(options.agent), {
        additionalEligibleTools: options.eligibleToolNames,
      });
    },
    async invoke(name, args, signal) {
      seq += 1;
      const callId = `${options.callIdPrefix ?? 'wf'}:${seq}`;
      const startedAt = Date.now();
      logLoopExecute(`execute DSH tool: ${name} callId=${callId}`);
      let result: LoopExecuteResult;
      const adapter = options.resultAdapters?.[name];
      try {
        result = await options.tools.execute({
          name,
          arguments: args,
          signal: signal ?? options.signal,
          callId,
          parent: options.parent,
          agent: options.agent,
        });
      } catch (err) {
        logLoopExecute(
          `DSH tool failed: ${name} callId=${callId} durationMs=${Date.now() - startedAt}`
        );
        throw adapter?.failure?.({ error: err }) ?? err;
      }
      if (result.isError) {
        logLoopExecute(
          `DSH tool failed: ${name} callId=${callId} durationMs=${Date.now() - startedAt}`
        );
      } else {
        logLoopExecute(
          `DSH tool ok: ${name} callId=${callId} durationMs=${Date.now() - startedAt}`
        );
      }
      if (result.isError) {
        const adapted = adapter?.failure?.({ result });
        if (adapted) throw adapted;
      }
      const value = flattenLoopExecuteResult(result);
      return adapter?.success ? adapter.success(value, result) : value;
    },
  };
}
// AIGC END
