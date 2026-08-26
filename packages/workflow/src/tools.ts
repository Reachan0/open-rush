// AIGC START
import type { JsonValue, ToolDescriptor, ToolInvoker } from './types.js';
import { WorkflowError } from './types.js';

export type ToolHandler = (
  args: Record<string, unknown>,
  signal?: AbortSignal
) => Promise<JsonValue> | JsonValue;

export interface RegisteredTool extends ToolDescriptor {
  execute: ToolHandler;
}

export function createToolInvoker(tools: RegisteredTool[]): ToolInvoker {
  const byName = new Map(tools.map((t) => [t.name.toLowerCase(), t]));
  return {
    listTools() {
      return tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      }));
    },
    async invoke(name, args, signal) {
      const tool = byName.get(name.toLowerCase());
      if (!tool) {
        throw new WorkflowError('unknown_tool', `tool not registered: ${name}`);
      }
      if (signal?.aborted) {
        throw new WorkflowError('aborted', `tool ${name} aborted`);
      }
      return await tool.execute(args, signal);
    },
  };
}

export function mergeToolInvokers(parts: ToolInvoker[]): ToolInvoker {
  return {
    async listTools() {
      const lists = await Promise.all(parts.map((part) => Promise.resolve(part.listTools())));
      return lists.flat();
    },
    async invoke(name, args, signal) {
      const lists = await Promise.all(parts.map((part) => Promise.resolve(part.listTools())));
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i];
        const found = lists[i]?.some((tool) => tool.name.toLowerCase() === name.toLowerCase());
        if (part && found) return part.invoke(name, args, signal);
      }
      throw new WorkflowError('unknown_tool', `tool not registered: ${name}`);
    },
  };
}

export type McpCallTool = (
  name: string,
  args: Record<string, unknown>
) => Promise<{
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}>;

export function createMcpToolInvoker(
  tools: ToolDescriptor[],
  callTool: McpCallTool,
  options?: { prefix?: string }
): ToolInvoker {
  const prefix = options?.prefix?.replace(/_+$/, '');
  const listed = tools.map((tool) => ({
    ...tool,
    name:
      prefix && !tool.name.toLowerCase().startsWith(`${prefix.toLowerCase()}__`)
        ? `${prefix}__${tool.name}`
        : tool.name,
  }));
  const originalName = new Map(
    listed.map((tool, index) => [tool.name.toLowerCase(), tools[index]?.name ?? tool.name])
  );
  return {
    listTools() {
      return listed;
    },
    async invoke(name, args) {
      const raw = originalName.get(name.toLowerCase()) ?? name;
      const result = await callTool(raw, args);
      if (result.isError) {
        const text = result.content?.map((c) => c.text ?? '').join('') ?? 'MCP error';
        throw new WorkflowError('node_failed', text);
      }
      if (result.structuredContent != null && typeof result.structuredContent === 'object') {
        return result.structuredContent as JsonValue;
      }
      const text = result.content?.map((c) => c.text ?? '').join('') ?? '';
      try {
        return JSON.parse(text) as JsonValue;
      } catch {
        return text;
      }
    },
  };
}
// AIGC END
