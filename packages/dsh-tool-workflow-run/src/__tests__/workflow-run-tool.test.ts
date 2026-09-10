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
  it('includes the observed node output in the DAG detail protocol', () => {
    const output = { status: 'ok', dependencyRecovered: true, restartAttempts: 1 };
    const result = formatWorkflowToolResult({
      dsl: { nodes: [{ id: 'protected', tool: 'ao04_read_status' }] },
      nodes: [{ id: 'protected', status: 'completed', output }],
    });
    const graph = JSON.parse(result.split('OPENRUSH_WORKFLOW_DAG:')[1]);
    expect(graph.nodes[0]).toMatchObject({ id: 'protected', status: 'completed', output });
  });
  it('omits required=false because the DSH schema compiler rejects it', () => {
    const tool = workflowRunToolDefinition(defineTool);
    expect(tool.parameters.intent).not.toHaveProperty('required');
    expect(tool.parameters.dsl).not.toHaveProperty('required');
  });

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

  it('rejects a degraded HTTP workflow result instead of treating it as success', async () => {
    await expect(
      invokeWorkflowRunHttp({
        intent: 'x',
        endpoint: 'http://127.0.0.1:8787/workflow-run',
        fetchImpl: async () =>
          ({
            ok: true,
            json: async () => ({ ok: true, degraded: true, error: 'timeout' }),
          }) as Response,
      })
    ).rejects.toThrow(/timeout/);
  });

  it('keeps protected payload evidence in the final workflow error', async () => {
    const payload = {
      status: 'human_required',
      degraded: false,
      errorClass: 'artifact_missing',
      evidenceRefs: ['incident-42', 'artifact-log-7'],
      data: { ready: false },
    };
    const tool = workflowRunToolDefinition(defineTool, {
      loopTools: {
        schemas: () => [{ name: 'ao04_read_status', description: 'status' }],
        execute: async () => ({ isError: false, value: { text: JSON.stringify(payload) } }),
      },
      eligibleToolNames: ['ao04_read_status'],
    });
    await expect(
      tool.execute({
        dsl: JSON.stringify({
          version: '1',
          name: 'protected-failure',
          nodes: [{ id: 'status', tool: 'ao04_read_status', input: { query: 'x' } }],
        }),
      })
    ).rejects.toThrow(/incident-42[\s\S]*artifact-log-7/);
  });

  it('turns a protected DSH HTTP error into a fatal workflow failure', async () => {
    const tool = workflowRunToolDefinition(defineTool, {
      loopTools: {
        schemas: () => [{ name: 'ao04_read_status', description: 'status' }],
        execute: async () => ({
          isError: true,
          error: { message: 'control service HTTP 503' },
        }),
      },
      eligibleToolNames: ['ao04_read_status'],
    });
    await expect(
      tool.execute({
        dsl: JSON.stringify({
          version: '1',
          nodes: [{ id: 'status', tool: 'ao04_read_status', input: { query: 'x' } }],
        }),
      })
    ).rejects.toThrow(/control service HTTP 503/);
  });

  it('generates a unique nested call prefix when the outer call has no callId', async () => {
    const callIds: string[] = [];
    const tool = workflowRunToolDefinition(defineTool, {
      loopTools: {
        schemas: () => [{ name: 'read', description: 'read' }],
        execute: async ({ callId }) => {
          callIds.push(String(callId));
          return { isError: false, value: { ok: true } };
        },
      },
      complete: async () =>
        JSON.stringify({ version: '1', nodes: [{ id: 'read', tool: 'read', input: {} }] }),
    });
    await tool.execute({ intent: 'one' }, {});
    await tool.execute({ intent: 'two' }, {});
    expect(callIds).toHaveLength(2);
    expect(callIds[0]).not.toBe(callIds[1]);
  });

  it('does not apply the protected protocol to an ordinary runtime-eligible tool', async () => {
    const tool = workflowRunToolDefinition(defineTool, {
      loopTools: {
        schemas: () => [{ name: 'runtime_status', description: 'ordinary status' }],
        execute: async () => ({
          isError: false,
          value: { status: 'degraded', data: { ready: false } },
        }),
      },
      eligibleToolNames: ['runtime_status'],
    });
    const result = await tool.execute({
      dsl: JSON.stringify({
        version: '1',
        nodes: [{ id: 'status', tool: 'runtime_status', input: {} }],
      }),
    });
    expect(result.text).toContain('"status": "degraded"');
  });
});

describe('formatWorkflowToolResult', () => {
  it('includes observed node states in the DAG without inventing completion for unexecuted nodes', () => {
    const dsl = {
      nodes: [
        { id: 'pre', tool: 'read' },
        { id: 'protected', tool: 'ao04_read_status', dependsOn: ['pre'] },
        { id: 'post', tool: 'read', dependsOn: ['protected'] },
      ],
    };
    const text = formatWorkflowToolError({
      dsl,
      error: 'dependency timeout',
      nodes: [
        { id: 'pre', status: 'completed' },
        { id: 'protected', status: 'failed' },
      ],
    });
    const graphText = text.split('OPENRUSH_WORKFLOW_DAG:').at(-1);
    if (!graphText) throw new Error('expected DAG marker');
    const graph = JSON.parse(graphText);
    expect(graph.nodes.map((n: { status: string }) => n.status)).toEqual([
      'completed',
      'failed',
      'pending',
    ]);
    const unknown = formatWorkflowToolResult({ ok: true, dsl });
    const unknownGraphText = unknown.split('OPENRUSH_WORKFLOW_DAG:').at(-1);
    if (!unknownGraphText) throw new Error('expected DAG marker');
    expect(JSON.parse(unknownGraphText).nodes[0].status).toBe('pending');
  });

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
        {
          id: 'c',
          tool: 'web_fetch',
          status: 'failed',
          error: 'fetch timeout',
          output: [{ url: 'https://c.example/first', body: '已取得的第一页' }],
        },
      ],
    });
    expect(text).toContain('天气页');
    expect(text).toContain('路线页');
    expect(text).toContain('已取得的第一页');
    expect(text).toMatch(/失败节点已产生的部分事实/);
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

  it('allows outer repair when ordinary workflow planning times out before a graph exists', () => {
    const text = formatWorkflowToolError({
      ok: false,
      error: 'workflow_run model timeout',
    });
    expect(text).toContain('本轮可直接用 web_fetch / read');
    expect(text).not.toContain('不要换工具或读取后续材料绕过它');
  });

  it('keeps a known AO-04 graph closed when transport fails', () => {
    const text = formatWorkflowToolError({
      ok: false,
      error: 'transport timeout',
      dsl: {
        nodes: [
          { id: 'protected', tool: 'ao04_read_status' },
          { id: 'post', tool: 'read', dependsOn: ['protected'] },
        ],
      },
    });
    expect(text).toContain('不要换工具或读取后续材料绕过它');
    expect(text).not.toContain('本轮可直接用 web_fetch / read');
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
