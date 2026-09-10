// AIGC START
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchImpl = vi.fn<typeof fetch>();

vi.mock('@hono/node-server', () => ({
  serve: vi.fn(),
}));
vi.mock('../amap-mcp.js', () => ({
  tryConnectAmapFromEnv: vi.fn(async () => null),
  amapMcpUrl: (key: string) => `https://mcp.amap.com/mcp?key=${encodeURIComponent(key)}`,
}));
vi.mock('../coding-mcp.js', () => ({
  tryConnectCodingTools: vi.fn(async () => null),
  codingToolsEnabled: () => false,
  resolveWorkflowWorkspace: (root?: string) => root ?? '/resolved/open-rush',
}));
vi.mock('@open-rush/workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@open-rush/workflow')>();
  return {
    ...actual,
    llmCompleteFromEnv: () => undefined,
    createPlatformToolInvoker: (opts: Parameters<typeof actual.createPlatformToolInvoker>[0]) =>
      actual.createPlatformToolInvoker({
        ...opts,
        fetchImpl: ((url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
          fetchImpl(url, init)) as typeof fetch,
      }),
  };
});

import app from '../server.js';

const PAGE_A = 'https://a.example/weather';
const PAGE_B = 'https://b.example/route';
const PAGE_C = 'https://c.example/ticket';

const THREE_PAGE_DSL = {
  version: '1',
  name: 'three_pages',
  nodes: [
    { id: 'weather', tool: 'http.fetch', input: { url: PAGE_A } },
    { id: 'route', tool: 'http.fetch', input: { url: PAGE_B } },
    { id: 'ticket', tool: 'http.fetch', input: { url: PAGE_C } },
  ],
};

function mockPages() {
  fetchImpl.mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('c.example')) {
      throw new Error('fetch timeout');
    }
    const body = url.includes('a.example') ? '天气页：周六晴 26°C' : '路线页：地铁2号线';
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  });
}

function parseSseEvents(
  text: string
): Array<{ eventType: string; payload: Record<string, unknown> }> {
  return text
    .split('\n\n')
    .map((block) => block.replace(/^data:\s*/, '').trim())
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as { eventType: string; payload: Record<string, unknown> });
}

describe('e2e: POST /workflow-run uses the real engine', () => {
  beforeEach(() => {
    fetchImpl.mockReset();
    mockPages();
  });

  it('returns completed node facts when one parallel http.fetch fails', async () => {
    const res = await app.request('/workflow-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: '对照天气、路线、门票这三页',
        dsl: THREE_PAGE_DSL,
        disableFallback: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok?: boolean;
      error?: string;
      nodes?: Array<{
        id?: string;
        status?: string;
        output?: { content?: string };
        error?: string;
      }>;
    };
    expect(body.ok).toBe(false);
    expect(String(body.error ?? '')).toMatch(/timeout|ticket|http\.fetch/);
    const done = body.nodes?.filter((node) => node.status === 'completed') ?? [];
    const failed = body.nodes?.filter((node) => node.status === 'failed') ?? [];
    expect(done).toHaveLength(2);
    expect(failed.map((node) => node.id)).toContain('ticket');
    expect(JSON.stringify(done.find((node) => node.id === 'weather')?.output)).toContain('天气页');
    expect(JSON.stringify(done.find((node) => node.id === 'route')?.output)).toContain('路线页');
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('streams node events and puts completed facts on workflow-result', async () => {
    const res = await app.request('/workflow-run?stream=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        intent: '对照天气、路线、门票这三页',
        dsl: THREE_PAGE_DSL,
        disableFallback: true,
      }),
    });
    expect(res.headers.get('content-type') ?? '').toContain('text/event-stream');
    const events = parseSseEvents(await res.text());
    const types = events.map((event) => event.eventType);
    expect(types).toContain('workflow-plan');
    expect(types).toContain('workflow-node-start');
    expect(types).toContain('workflow-node-end');
    expect(types).toContain('workflow-result');

    const ended = events.filter((event) => event.eventType === 'workflow-node-end');
    expect(ended.filter((event) => event.payload.status === 'completed')).toHaveLength(2);
    expect(
      ended.some((event) => event.payload.nodeId === 'ticket' && event.payload.status === 'failed')
    ).toBe(true);

    const result = events.find((event) => event.eventType === 'workflow-result');
    expect(result?.payload.ok).toBe(false);
    const nodes = result?.payload.nodes as
      | Array<{ id?: string; status?: string; output?: unknown }>
      | undefined;
    expect(nodes?.filter((node) => node.status === 'completed')).toHaveLength(2);
    expect(JSON.stringify(nodes)).toContain('天气页');
    expect(JSON.stringify(nodes)).toContain('路线页');
  });

  it('executes a successful dsl without calling the planner', async () => {
    fetchImpl.mockImplementation(async (input) => {
      const url = String(input);
      const body = url.includes('a.example') ? '天气页：周六晴 26°C' : '路线页：地铁2号线';
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    });
    const res = await app.request('/workflow-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: '只要天气和路线',
        dsl: {
          version: '1',
          name: 'two_ok',
          nodes: [
            { id: 'weather', tool: 'http.fetch', input: { url: PAGE_A } },
            { id: 'route', tool: 'http.fetch', input: { url: PAGE_B } },
          ],
        },
        disableFallback: true,
      }),
    });
    const body = (await res.json()) as {
      ok?: boolean;
      nodes?: Array<{ id?: string; status?: string; output?: unknown }>;
      output?: unknown;
    };
    expect(body.ok).toBe(true);
    expect(body.nodes?.every((node) => node.status === 'completed')).toBe(true);
    expect(JSON.stringify(body.nodes)).toContain('天气页');
    expect(JSON.stringify(body.nodes)).toContain('路线页');
  });
});
// AIGC END
