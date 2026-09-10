// AIGC START
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  handleMcpMessage,
  keenableConfig,
  runKeenableSearch,
  SEARCH_TOOL,
} from '../../dsh/keenable-search-mcp.mjs';

describe('keenable-search MCP', () => {
  it('uses the keyed Keenable path when KEENABLE_API_KEY is set', () => {
    const cfg = keenableConfig({
      KEENABLE_API_KEY: 'keen_test',
      KEENABLE_API_URL: 'https://api.keenable.ai',
      KEENABLE_TITLE: 'OpenRush',
    });
    expect(cfg.url).toBe('https://api.keenable.ai/v1/search');
    expect(cfg.apiKey).toBe('keen_test');
  });

  it('falls back to /v1/search/public without a key', () => {
    const cfg = keenableConfig({
      KEENABLE_API_KEY: '',
      KEENABLE_API_URL: 'https://api.keenable.ai',
    });
    expect(cfg.url).toBe('https://api.keenable.ai/v1/search/public');
  });

  it('treats empty KEENABLE_API_URL as missing and still yields an absolute URL', () => {
    const cfg = keenableConfig({
      KEENABLE_API_KEY: 'keen_test',
      KEENABLE_API_URL: '',
    });
    expect(cfg.url).toBe('https://api.keenable.ai/v1/search');
    expect(cfg.base).toBe('https://api.keenable.ai');
  });

  it('accepts KEENABLE_BASE_URL as an alias', () => {
    const cfg = keenableConfig({
      KEENABLE_API_KEY: 'keen_test',
      KEENABLE_BASE_URL: 'https://api.keenable.ai',
    });
    expect(cfg.url).toBe('https://api.keenable.ai/v1/search');
  });

  it('relative /v1/search would explode in fetch; config must stay absolute', async () => {
    await expect(fetch('/v1/search')).rejects.toThrow(/Failed to parse URL/);
    const cfg = keenableConfig({
      KEENABLE_API_KEY: 'keen_test',
      KEENABLE_API_URL: '/v1/search',
    });
    expect(cfg.url).toMatch(/^https:\/\//);
    expect(cfg.url).not.toBe('/v1/search');
    expect(cfg.url).toBe('https://api.keenable.ai/v1/search');
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.keenable.ai/v1/search');
      expect(url).not.toBe('/v1/search');
      return Response.json({ query: 'q', results: [] });
    });
    await runKeenableSearch(
      { query: '西湖跑步' },
      { env: { KEENABLE_API_KEY: 'keen_test', KEENABLE_API_URL: '/v1/search' }, fetchImpl }
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('searches via Keenable and returns structured results', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.keenable.ai/v1/search');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        query: '西湖跑步路线',
        max_results: 3,
      });
      return Response.json({
        query: '西湖跑步路线',
        results: [
          {
            title: '西湖跑圈',
            url: 'https://example.com/westlake-run',
            snippet: '沿湖约 10 公里',
          },
        ],
      });
    });
    const out = await runKeenableSearch(
      { query: '西湖跑步路线', limit: 3 },
      { env: { KEENABLE_API_KEY: 'keen_test' }, fetchImpl }
    );
    expect(out.results[0]?.title).toBe('西湖跑圈');
  });

  it('lists web_search and returns structuredContent on tools/call', async () => {
    const listed = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(listed?.result.tools).toEqual([SEARCH_TOOL]);
    const fetchImpl = vi.fn(async () =>
      Response.json({ query: 'q', results: [{ title: 'A', url: 'https://a.test' }] })
    );
    const called = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'web_search', arguments: { query: 'q' } },
      },
      { env: { KEENABLE_API_KEY: 'keen_test' }, fetchImpl }
    );
    expect(called?.result.isError).toBe(false);
    expect(called?.result.structuredContent).toMatchObject({
      query: 'q',
      results: [{ title: 'A', url: 'https://a.test' }],
    });
  });
});

describe('openrush-loop-mcp wiring', () => {
  it('awaits Keenable and Amap MCP so Loop schemas are ready at startup', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const plugin = readFileSync(join(here, '../../dsh/openrush-loop-mcp.mjs'), 'utf8');
    expect(plugin).toContain('keenable-search-mcp.mjs');
    expect(plugin).toContain("serverName: 'keenable-search'");
    expect(plugin).toContain('await ctx.plugin(mcp, config)');
    expect(plugin).toContain("serverName: 'amap-maps'");
    expect(plugin).toContain('resolveKeenableBaseUrl');
    expect(plugin).toContain('await Promise.all(jobs)');
    expect(plugin).toMatch(/startup \$\{Date\.now\(\) - started\}ms/);
    expect(plugin).toMatch(/mcp__keenable-search__web_search/);
    expect(plugin).toMatch(/不要调用 DSH 原生 web_search/);
    expect(plugin).not.toMatch(
      /KEENABLE_API_URL:\s*\(process\.env\.KEENABLE_API_URL \?\? ''\)\.trim\(\)/
    );
  });

  it('skips coding-tools unless CODING_TOOLS_MCP is explicitly on', async () => {
    const { codingToolsEnabled } = await import('../../dsh/openrush-loop-mcp.mjs');
    expect(codingToolsEnabled({})).toBe(false);
    expect(codingToolsEnabled({ CODING_TOOLS_MCP: '' })).toBe(false);
    expect(codingToolsEnabled({ CODING_TOOLS_MCP: '0' })).toBe(false);
    expect(codingToolsEnabled({ CODING_TOOLS_MCP: '1' })).toBe(true);
    expect(codingToolsEnabled({ CODING_TOOLS_MCP: 'true' })).toBe(true);
  });
});
// AIGC END
