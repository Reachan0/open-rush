// AIGC START
import { describe, expect, it, vi } from 'vitest';
import {
  createLoopToolInvoker,
  flattenLoopExecuteResult,
  formatDeniedLoopToolList,
  formatEligibleLoopToolList,
  isDeniedLoopTool,
  isEligibleLoopTool,
} from '../loop-tools.js';
import { WorkflowError } from '../types.js';

describe('isDeniedLoopTool', () => {
  it('keeps orchestration, mutation, and bash off the planner catalog', () => {
    expect(isDeniedLoopTool('workflow_run')).toBe(true);
    expect(isDeniedLoopTool('todo_write')).toBe(true);
    expect(isDeniedLoopTool('ask_user_question')).toBe(true);
    expect(isDeniedLoopTool('subagent')).toBe(true);
    expect(isDeniedLoopTool('write')).toBe(true);
    expect(isDeniedLoopTool('edit')).toBe(true);
    expect(isDeniedLoopTool('bash')).toBe(true);
    expect(isDeniedLoopTool('workflow')).toBe(true);
    expect(isDeniedLoopTool('ralph')).toBe(true);
    expect(isDeniedLoopTool('read')).toBe(false);
    expect(isDeniedLoopTool('web_search')).toBe(true);
    expect(isDeniedLoopTool('web_fetch')).toBe(false);
    expect(isDeniedLoopTool('mcp__amap-maps__maps_geo')).toBe(false);
    expect(isDeniedLoopTool('mcp__keenable-search__web_search')).toBe(false);
  });

  it('does not let unknown or mutating MCP into the graph', () => {
    expect(isEligibleLoopTool('read')).toBe(true);
    expect(isEligibleLoopTool('web_fetch')).toBe(true);
    expect(isEligibleLoopTool('mcp__amap-maps__maps_geo')).toBe(true);
    expect(isEligibleLoopTool('mcp__keenable-search__web_search')).toBe(true);
    expect(isEligibleLoopTool('mcp__coding-tools__read_file')).toBe(true);
    expect(isEligibleLoopTool('mcp__coding-tools__apply_patch')).toBe(false);
    expect(isEligibleLoopTool('mcp__coding-tools__exec_command')).toBe(false);
    expect(isEligibleLoopTool('mcp__slack__send_message')).toBe(false);
    expect(isEligibleLoopTool('mcp__unknown__lookup')).toBe(false);
    expect(isEligibleLoopTool('maps_weather')).toBe(true);
  });

  it('lists shareable Loop tools and keeps denylist reasons for the outer prompt', () => {
    const schemas = [
      { name: 'read', description: 'Read a file' },
      { name: 'bash', description: 'Run a command' },
      { name: 'mcp__amap-maps__maps_geo', description: 'geocode' },
    ];
    const eligible = formatEligibleLoopToolList(schemas);
    expect(eligible).toContain('- read: Read a file');
    expect(eligible).toContain('mcp__amap-maps__maps_geo');
    expect(eligible).not.toContain('bash');
    const denied = formatDeniedLoopToolList(schemas);
    expect(denied).toMatch(/- bash: /);
    expect(denied).toContain('web_search');
    expect(denied).not.toMatch(/- bash: Run a command/);
  });
});

describe('flattenLoopExecuteResult', () => {
  it('prefers structuredContent on MCP-shaped values', () => {
    expect(
      flattenLoopExecuteResult({
        isError: false,
        value: {
          content: [{ type: 'text', text: 'summary only' }],
          structuredContent: { location: '121.49,31.24' },
        },
      })
    ).toEqual({ location: '121.49,31.24' });
  });

  it('parses JSON text when structuredContent is missing', () => {
    expect(
      flattenLoopExecuteResult({
        isError: false,
        value: { content: [{ type: 'text', text: '{"city":"上海"}' }] },
      })
    ).toEqual({ city: '上海' });
  });

  it('falls back to { text } for unstructured strings', () => {
    expect(flattenLoopExecuteResult({ isError: false, value: 'plain reply' })).toEqual({
      text: 'plain reply',
    });
  });

  it('throws when the Loop execute result is an error', () => {
    expect(() =>
      flattenLoopExecuteResult({
        isError: true,
        error: { message: 'denied' },
        content: [{ type: 'text', text: 'denied' }],
      })
    ).toThrow(WorkflowError);
  });
});

describe('createLoopToolInvoker', () => {
  it('lists schemas minus the denylist and forwards execute arguments as-is', async () => {
    const execute = vi.fn(async (input: { name: string; arguments: unknown }) => ({
      isError: false,
      value: { path: 'README.md', lines: [{ number: 1, text: '# hi' }] },
    }));
    const tools = createLoopToolInvoker({
      tools: {
        schemas: () => [
          {
            name: 'read',
            description: 'Read a file',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
          { name: 'workflow_run', description: 'self', parameters: { type: 'object' } },
          { name: 'bash', description: 'shell', parameters: { type: 'object' } },
          { name: 'write', description: 'mutate', parameters: { type: 'object' } },
        ],
        execute,
      },
      parent: 'parent-token',
      agent: { id: 'agent-1' },
      callIdPrefix: 'call-root:wf',
    });
    const listed = await tools.listTools();
    expect(listed.map((item) => item.name)).toEqual(['read']);
    expect(listed[0]?.inputSchema).toMatchObject({
      type: 'object',
      properties: { path: { type: 'string' } },
    });

    const out = await tools.invoke('read', { path: 'README.md' }, AbortSignal.timeout(5_000));
    expect(out).toEqual({ path: 'README.md', lines: [{ number: 1, text: '# hi' }] });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'read',
        arguments: { path: 'README.md' },
        parent: 'parent-token',
        agent: { id: 'agent-1' },
        callId: 'call-root:wf:1',
      })
    );
    expect(execute.mock.calls[0]?.[0]).toHaveProperty('signal');
    expect(execute).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'workflow_run' }));
  });

  it('logs execute DSH tool before and after ctx.tools.execute', async () => {
    const writes: string[] = [];
    const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      const tools = createLoopToolInvoker({
        tools: {
          schemas: () => [{ name: 'glob', description: 'glob files' }],
          execute: async () => ({ isError: false, value: { matches: ['README.md'] } }),
        },
      });
      await tools.invoke('glob', { glob_pattern: 'README.md' });
      const joined = writes.join('');
      expect(joined).toMatch(/\[workflow_run\] execute DSH tool: glob args=/);
      expect(joined).toMatch(/\[workflow_run\] DSH tool ok: glob/);
    } finally {
      write.mockRestore();
    }
  });
});
// AIGC END
