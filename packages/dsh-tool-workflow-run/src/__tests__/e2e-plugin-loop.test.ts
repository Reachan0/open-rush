// AIGC START
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../resolve-dsh-tools.js', () => ({
  importDefineTool: async () => (options: unknown) => options,
}));

import { apply } from '../plugin.js';

const PAGE_A = 'https://a.example/weather';
const PAGE_B = 'https://b.example/route';
const PAGE_C = 'https://c.example/ticket';

const THREE_PAGE_DSL = {
  version: '1',
  name: 'three_pages',
  nodes: [
    { id: 'weather', tool: 'web_fetch', input: { url: PAGE_A } },
    { id: 'route', tool: 'web_fetch', input: { url: PAGE_B } },
    { id: 'ticket', tool: 'web_fetch', input: { url: PAGE_C } },
  ],
};

type RegisteredTool = {
  name: string;
  description?: string;
  parameters?: unknown;
  execute: (
    args: { intent?: string; dsl?: string },
    exec: { agent?: unknown; token?: unknown; signal?: AbortSignal; callId?: string }
  ) => Promise<{ text: string }>;
};

type Assembly = {
  tools: Array<{ name: string; description?: string; parameters?: unknown }>;
  sections: Array<{ name: string; text: string }>;
};

function createLoopHost() {
  const registered = new Map<string, RegisteredTool>();
  const assembleListeners: Array<
    (assembly: Assembly, context: unknown, next: () => Promise<Assembly>) => Promise<Assembly>
  > = [];
  let fetchCAttempts = 0;

  const host = {
    register(tool: RegisteredTool) {
      registered.set(tool.name, tool);
    },
    schemas() {
      return [
        { name: 'web_fetch', description: 'Fetch a URL', parameters: { type: 'object' } },
        { name: 'bash', description: 'Run a command', parameters: { type: 'object' } },
        {
          name: 'mcp__acme-crm__list_deals',
          description: 'Unknown CRM MCP',
          parameters: { type: 'object' },
        },
        ...[...registered.values()].map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      ];
    },
    async execute(input: {
      name: string;
      arguments?: { intent?: string; dsl?: string; url?: string };
      agent?: unknown;
      parent?: unknown;
      signal?: AbortSignal;
      callId?: string;
    }) {
      if (input.name === 'workflow_run') {
        const tool = registered.get('workflow_run');
        if (!tool) return { isError: true, error: { message: 'workflow_run not registered' } };
        try {
          const value = await tool.execute(input.arguments ?? {}, {
            agent: input.agent,
            token: input.parent,
            signal: input.signal,
            callId: input.callId,
          });
          return { isError: false, value };
        } catch (err) {
          return {
            isError: true,
            error: { message: err instanceof Error ? err.message : String(err) },
          };
        }
      }
      if (input.name === 'web_fetch') {
        const url = String(input.arguments?.url ?? '');
        if (url.includes('c.example')) {
          fetchCAttempts += 1;
          if (fetchCAttempts === 1) {
            return { isError: true, error: { message: 'fetch timeout' } };
          }
          return { isError: false, value: { url, body: '门票页：成人120' } };
        }
        if (url.includes('a.example')) {
          return { isError: false, value: { url, body: '天气页：周六晴 26°C' } };
        }
        if (url.includes('b.example')) {
          return { isError: false, value: { url, body: '路线页：地铁2号线' } };
        }
        return { isError: true, error: { message: `unknown url ${url}` } };
      }
      if (input.name === 'bash') {
        return { isError: false, value: { stdout: 'bash should stay outer-only' } };
      }
      return { isError: true, error: { message: `unknown tool ${input.name}` } };
    },
  };

  const ctx = {
    tools: host,
    systemPrompt: { section() {} },
    on(
      event: string,
      listener: (
        assembly: Assembly,
        context: unknown,
        next: () => Promise<Assembly>
      ) => Promise<Assembly>
    ) {
      if (event === 'system-prompt/assemble') assembleListeners.push(listener);
    },
    async assemble(scope?: unknown): Promise<Assembly> {
      const raw: Assembly = {
        tools: host.schemas(),
        sections: host.schemas().map((tool) => ({
          name: `tool:${tool.name}`,
          text: tool.description ?? tool.name,
        })),
      };
      let current = raw;
      for (const listener of assembleListeners) {
        const snapshot = current;
        current = await listener(snapshot, { scope }, async () => snapshot);
      }
      return current;
    },
  };

  return { host, ctx, registered, getFetchCAttempts: () => fetchCAttempts };
}

describe('e2e: plugin loop hide → fail → repair', () => {
  it('declares every Cordis service it reads', async () => {
    const plugin = await import('../plugin.js');
    expect(plugin.inject).toEqual(expect.arrayContaining(['tools', 'systemPrompt', 'llm']));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fails plugin application when workflow_run cannot be registered', async () => {
    const ctx = {
      tools: {
        register() {
          throw new Error('workflow registration rejected');
        },
        schemas: () => [],
      },
      systemPrompt: { section() {} },
    };

    await expect(apply(ctx)).rejects.toThrow('workflow registration rejected');
  });

  it('hides web_fetch, fails the graph with completed facts, then lets the outer loop fetch the missing page', async () => {
    const { host, ctx, registered } = createLoopHost();
    await apply(ctx, { hideEligibleFromOuter: true });
    expect(registered.has('workflow_run')).toBe(true);

    const agent = { id: 'e2e-repair' };
    const before = await ctx.assemble(agent);
    expect(before.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['workflow_run', 'bash', 'mcp__acme-crm__list_deals'])
    );
    expect(before.tools.map((tool) => tool.name)).not.toContain('web_fetch');

    const graphCall = await host.execute({
      name: 'workflow_run',
      arguments: {
        intent: '对照天气、路线、门票这三页',
        dsl: JSON.stringify(THREE_PAGE_DSL),
      },
      agent,
      parent: 'outer-token',
      callId: 'outer-1',
    });
    expect(graphCall.isError).toBe(true);
    const errText = String(graphCall.error?.message ?? '');
    expect(errText).toContain('天气页：周六晴 26°C');
    expect(errText).toContain('路线页：地铁2号线');
    expect(errText).toMatch(/ticket|门票|失败节点/);
    expect(errText).toMatch(/不要用同一句 intent 再调一次 workflow_run/);
    expect(errText).not.toContain('门票页：成人120');
    expect(errText).toContain('OPENRUSH_WORKFLOW_DAG:');

    const afterFail = await ctx.assemble(agent);
    expect(afterFail.tools.map((tool) => tool.name)).toContain('web_fetch');
    expect(afterFail.tools.map((tool) => tool.name)).toContain('workflow_run');

    const repair = await host.execute({
      name: 'web_fetch',
      arguments: { url: PAGE_C },
      agent,
    });
    expect(repair.isError).toBe(false);
    expect(repair.value).toMatchObject({ url: PAGE_C, body: '门票页：成人120' });
  });

  it('executes a provided dsl through apply()+runWorkflowFromLoop and returns node facts', async () => {
    const { host, ctx } = createLoopHost();
    await apply(ctx, { hideEligibleFromOuter: true });
    const result = await host.execute({
      name: 'workflow_run',
      arguments: {
        intent: '只要天气和路线',
        dsl: JSON.stringify({
          version: '1',
          name: 'two_ok',
          nodes: [
            { id: 'weather', tool: 'web_fetch', input: { url: PAGE_A } },
            { id: 'route', tool: 'web_fetch', input: { url: PAGE_B } },
          ],
        }),
      },
      agent: { id: 'e2e-ok' },
    });
    expect(result.isError).toBe(false);
    expect(String((result.value as { text?: string } | undefined)?.text)).toContain(
      '天气页：周六晴 26°C'
    );
    expect(String((result.value as { text?: string } | undefined)?.text)).toContain(
      '路线页：地铁2号线'
    );
    expect(String((result.value as { text?: string } | undefined)?.text)).toMatch(/已执行/);
  });
});
// AIGC END
