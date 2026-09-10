// AIGC START
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  buildWorkflowRunPromptSection,
  formatWorkflowToolError,
  formatWorkflowToolResult,
  invokeWorkflowRunHttp,
  WORKFLOW_RUN_PROMPT_SECTION,
  WORKFLOW_RUN_TOOL_NAME,
  workflowRunToolDefinition,
} from '../index.js';

function defineTool<T>(options: T): T {
  return options;
}

describe('native workflow_run tool', () => {
  it('is named workflow_run and asks for the user intent', () => {
    const tool = workflowRunToolDefinition(defineTool, { fetchImpl: vi.fn() });
    expect(tool.name).toBe('workflow_run');
    expect(WORKFLOW_RUN_TOOL_NAME).toBe('workflow_run');
    expect(tool.description).toMatch(/快车道/);
    expect(tool.description).toMatch(/允许共享的只读|未知 MCP 默认不进图/);
    expect(tool.description).not.toMatch(/web\.search/);
    expect(tool.description).not.toMatch(/常见会有/);
    expect(tool.description).toMatch(/由你判断/);
    expect(tool.description).toMatch(/已经查完/);
    expect(tool.description).toMatch(/每发一句都重新判断/);
    expect(tool.description).toMatch(/已从外层目录拿掉/);
    expect(tool.description).toMatch(/必须调用本工具/);
    expect(tool.description).not.toMatch(/不要再调 workflow_run/);
    expect(tool.description).not.toMatch(/已点明城市|写代码、修 bug/);
    expect(tool.parameters.intent).toMatchObject({ type: 'string' });
    expect(tool.parameters.dsl).toMatchObject({ type: 'string' });
    expect(WORKFLOW_RUN_PROMPT_SECTION).toMatch(/不要按关键词清单决定/);
    expect(WORKFLOW_RUN_PROMPT_SECTION).toMatch(/不进图|不能进图/);
    expect(WORKFLOW_RUN_PROMPT_SECTION).toMatch(/每发一句都重新判断/);
    expect(WORKFLOW_RUN_PROMPT_SECTION).toMatch(/必须调 workflow_run/);
    expect(WORKFLOW_RUN_PROMPT_SECTION).not.toMatch(/不要再调 workflow_run 重跑同一句/);
    const live = buildWorkflowRunPromptSection([
      { name: 'read', description: 'Read a file' },
      { name: 'bash', description: 'Run a command' },
      { name: 'mcp__amap-maps__maps_geo', description: 'geocode' },
    ]);
    expect(live).toContain('- read: Read a file');
    expect(live).toContain('mcp__amap-maps__maps_geo');
    expect(live).toMatch(/- bash: /);
    expect(live).not.toMatch(/- bash: Run a command/);
  });

  it('runs the engine against Loop tools instead of HTTP POST /workflow-run', async () => {
    const fetchImpl = vi.fn();
    const execute = vi.fn(async () => ({
      isError: false,
      value: { path: 'README.md', lines: [{ number: 1, text: '# OpenRush' }] },
    }));
    const tool = workflowRunToolDefinition(defineTool, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      loopTools: {
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
        ],
        execute,
      },
      complete: async () =>
        JSON.stringify({
          version: '1',
          name: 'readme',
          nodes: [{ id: 'doc', tool: 'read', input: { path: 'README.md' } }],
        }),
    });
    const result = await tool.execute(
      { intent: '读 README.md' },
      {
        signal: AbortSignal.timeout(30_000),
        token: 'exec-token',
        agent: { id: 'a1' },
        callId: 'root-1',
      }
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'read',
        arguments: { path: 'README.md' },
        parent: 'exec-token',
        agent: { id: 'a1' },
      })
    );
    const loopCalls = execute.mock.calls as Array<[{ name?: string }]>;
    expect(loopCalls.some((call) => call[0]?.name === 'workflow_run')).toBe(false);
    expect(String(result.text)).toContain('README.md');
    expect(String(result.text)).toContain('OPENRUSH_WORKFLOW_DAG:');
    expect(String(result.text)).toMatch(/已执行/);
  });

  it('surfaces a Loop fast-lane node failure as a tool error that still carries the DAG', async () => {
    const tool = workflowRunToolDefinition(defineTool, {
      loopTools: {
        schemas: () => [
          { name: 'maps_weather', description: 'weather', parameters: { type: 'object' } },
        ],
        execute: async () => ({
          isError: true,
          error: { message: 'Authentication Fails, Your api key: ****yaff is invalid' },
        }),
      },
      complete: async () =>
        JSON.stringify({
          version: '1',
          name: 'westlake_run',
          nodes: [{ id: 'weather', tool: 'maps_weather', input: { city: '杭州' } }],
        }),
    });
    await expect(
      tool.execute({ intent: '明天去西湖跑步' }, { callId: 'root-fail' })
    ).rejects.toThrow(/快车道失败：Authentication Fails[\s\S]*OPENRUSH_WORKFLOW_DAG:/);
  });

  it('executes a provided dsl without calling the planner', async () => {
    const complete = vi.fn(async () => {
      throw new Error('planner should not run');
    });
    const execute = vi.fn(async () => ({
      isError: false,
      value: { url: 'https://a.example', body: 'page-a' },
    }));
    const tool = workflowRunToolDefinition(defineTool, {
      loopTools: {
        schemas: () => [
          { name: 'web_fetch', description: 'fetch', parameters: { type: 'object' } },
        ],
        execute,
      },
      complete,
    });
    const result = await tool.execute({
      intent: '对照这一页',
      dsl: JSON.stringify({
        version: '1',
        name: 'given',
        nodes: [{ id: 'a', tool: 'web_fetch', input: { url: 'https://a.example' } }],
      }),
    });
    expect(complete).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'web_fetch' }));
    expect(String(result.text)).toContain('page-a');
    expect(String(result.text)).toMatch(/已执行/);
  });

  it('surfaces a failed fast-lane run as a tool error', async () => {
    await expect(
      invokeWorkflowRunHttp({
        intent: 'x',
        endpoint: 'http://127.0.0.1:9/workflow-run',
        fetchImpl: async () =>
          ({
            ok: true,
            json: async () => ({ ok: false, error: 'generate_failed' }),
          }) as Response,
      })
    ).rejects.toThrow(/generate_failed/);
  });
});

describe('formatWorkflowToolResult', () => {
  it('keeps the article, executed node facts, and tells the agent not to re-fetch', () => {
    const text = formatWorkflowToolResult({
      ok: true,
      output: '周六先去外滩。',
      dsl: {
        name: 'trip',
        nodes: [
          { id: 'geo', tool: 'geo.locate' },
          { id: 'write', tool: 'text.compose', dependsOn: ['geo'] },
        ],
      },
      nodes: [
        { id: 'geo', tool: 'geo.locate', output: { city: '上海', temp: 28 } },
        { id: 'write', tool: 'text.compose', output: '周六先去外滩。' },
      ],
    });
    expect(text).toContain('周六先去外滩');
    expect(text).toContain('geo');
    expect(text).toContain('上海');
    expect(text).toContain('28');
    expect(text).toMatch(/已执行/);
    expect(text).not.toMatch(/快车道方案/);
    expect(text).toMatch(/刚才那一句/);
    expect(text).toMatch(/又发新的一句/);
    expect(text).not.toMatch(/### write/);
    expect(text).toContain('OPENRUSH_WORKFLOW_DAG:');
    expect(text).toContain('"name":"trip"');
    expect(text).not.toMatch(/"nodeResults":\{"geo":/);
  });

  it('keeps completed facts on a partial failure and tells the outer loop to finish the missing node', () => {
    const text = formatWorkflowToolError({
      ok: false,
      error: 'fetch timeout',
      nodeId: 'c',
      dsl: {
        name: 'three_pages',
        nodes: [
          { id: 'a', tool: 'web_fetch' },
          { id: 'b', tool: 'web_fetch' },
          { id: 'c', tool: 'web_fetch' },
        ],
      },
      nodes: [
        {
          id: 'a',
          tool: 'web_fetch',
          status: 'completed',
          output: { url: 'https://a.example', body: '天气页' },
        },
        {
          id: 'b',
          tool: 'web_fetch',
          status: 'completed',
          output: { url: 'https://b.example', body: '路线页' },
        },
        { id: 'c', tool: 'web_fetch', status: 'failed', error: 'fetch timeout' },
      ],
    });
    expect(text).toContain('天气页');
    expect(text).toContain('路线页');
    expect(text).toMatch(/未完成|失败节点/);
    expect(text).toContain('c');
    expect(text).toMatch(/不要用同一句 intent 再调一次 workflow_run/);
    expect(text).toMatch(/web_fetch|只补/);
    expect(text).not.toMatch(/"nodeResults":\{"a":/);
  });

  it('puts the planned DAG into a failed fast-lane tool error', () => {
    const text = formatWorkflowToolError({
      ok: false,
      error: 'Authentication Fails, Your api key: ****yaff is invalid',
      dsl: {
        name: 'westlake_run',
        nodes: [
          { id: 'search', tool: 'web_search' },
          { id: 'write', tool: 'text.compose', dependsOn: ['search'] },
        ],
      },
    });
    expect(text).toMatch(/^快车道失败：Authentication Fails/);
    expect(text).toContain('westlake_run');
    expect(text).toContain('web_search');
    expect(text).toMatch(/没能交付这一句/);
    expect(text).toMatch(/又发新的一句/);
    expect(text).toContain('OPENRUSH_WORKFLOW_DAG:');
    expect(text).toContain('"name":"westlake_run"');
  });
});

describe('bundled plugin dist', () => {
  it('inlines @open-rush/workflow so a DSH host does not need the OpenRush workspace', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const dist = readFileSync(join(here, '../../dist/index.js'), 'utf8');
    expect(dist).not.toMatch(/from ["']@open-rush\/workflow["']/);
    expect(dist).toMatch(/createLoopToolInvoker|runWorkflowFromLoop|workflowRun/);
  });
});
// AIGC END
