// AIGC START
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPlatformToolInvoker } from '../platform-tools.js';

describe('createPlatformToolInvoker', () => {
  it('fetches a public URL through the injected fetch', async () => {
    const tools = createPlatformToolInvoker({
      root: tmpdir(),
      fetchImpl: async () =>
        new Response('hello from the web', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
    });
    const out = await tools.invoke('http.fetch', { url: 'https://example.com/page' });
    expect(out).toMatchObject({ status: 200, content: 'hello from the web' });
  });

  it('rejects localhost fetches', async () => {
    const tools = createPlatformToolInvoker({ root: tmpdir() });
    await expect(tools.invoke('http.fetch', { url: 'http://127.0.0.1/secret' })).rejects.toThrow(
      /blocked host/
    );
  });

  it('reads a workspace file and refuses path escape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wf-plat-'));
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'note.md'), 'workspace note', 'utf8');
    const tools = createPlatformToolInvoker({ root });
    const out = await tools.invoke('fs.read', { path: 'docs/note.md' });
    expect(out).toMatchObject({ path: 'docs/note.md', content: 'workspace note' });
    await expect(tools.invoke('fs.read', { path: '../outside.txt' })).rejects.toThrow(/escapes/);
  });

  it('searches via Keenable /v1/search when an API key is set', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const tools = createPlatformToolInvoker({
      root: tmpdir(),
      keenable: { apiKey: 'keen_test', baseUrl: 'https://api.keenable.ai' },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return Response.json({
          query: 'typescript best practices',
          results: [
            {
              title: 'TypeScript Handbook',
              url: 'https://www.typescriptlang.org/docs/handbook',
              description: 'Official handbook',
              snippet: 'Use strict mode.',
            },
          ],
        });
      },
    });
    const out = await tools.invoke('web.search', { query: 'typescript best practices', limit: 3 });
    expect(calls[0]?.url).toBe('https://api.keenable.ai/v1/search');
    expect(calls[0]?.init.method).toBe('POST');
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('X-API-Key')).toBe('keen_test');
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      query: 'typescript best practices',
      max_results: 3,
    });
    expect(out).toMatchObject({
      query: 'typescript best practices',
      results: [
        {
          title: 'TypeScript Handbook',
          url: 'https://www.typescriptlang.org/docs/handbook',
        },
      ],
    });
  });

  it('falls back to the keyless /v1/search/public path', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const tools = createPlatformToolInvoker({
      root: tmpdir(),
      keenable: { apiKey: '', baseUrl: 'https://api.keenable.ai', appTitle: 'OpenRush' },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return Response.json({ query: 'q', results: [] });
      },
    });
    await tools.invoke('web.search', { query: 'q' });
    expect(calls[0]?.url).toBe('https://api.keenable.ai/v1/search/public');
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('X-API-Key')).toBeNull();
    expect(headers.get('X-Keenable-Title')).toBe('OpenRush');
  });

  it('rejects an empty search query and surfaces Keenable HTTP errors', async () => {
    const tools = createPlatformToolInvoker({
      root: tmpdir(),
      keenable: { apiKey: 'keen_test', baseUrl: 'https://api.keenable.ai' },
      fetchImpl: async () => new Response('rate limited', { status: 429 }),
    });
    await expect(tools.invoke('web.search', { query: '   ' })).rejects.toThrow(/query is required/);
    await expect(tools.invoke('web.search', { query: 'q' })).rejects.toThrow(/web.search 429/);
  });

  it('renders search-like parts as markdown instead of raw JSON', async () => {
    const tools = createPlatformToolInvoker({ root: tmpdir() });
    const out = await tools.invoke('text.compose', {
      title: '杭州周末亲子去处推荐',
      parts: {
        query: '杭州 周末 亲子',
        results: [
          {
            title: '杭州遛娃',
            url: 'http://example.com/a',
            snippet: '良渚遗址公园',
          },
        ],
      },
    });
    expect(out).not.toMatch(/^# /);
    expect(out).toContain('杭州遛娃');
    expect(out).toContain('http://example.com/a');
    expect(out).toContain('良渚遗址公园');
    expect(String(out)).not.toMatch(/\{"query"/);
  });

  it('strips HTML from fetched pages into readable text', async () => {
    const tools = createPlatformToolInvoker({
      root: tmpdir(),
      fetchImpl: async () =>
        new Response(
          '<!doctype html><html><head><style>body{color:red}</style><title>Example Domain</title></head><body><h1>Example Domain</h1><p>This domain is for use in documentation examples.</p></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        ),
    });
    const out = await tools.invoke('http.fetch', { url: 'https://example.com' });
    expect(out).toMatchObject({ status: 200 });
    expect(String((out as { content: string }).content)).toContain('Example Domain');
    expect(String((out as { content: string }).content)).toContain('documentation examples');
    expect(String((out as { content: string }).content)).not.toContain('<h1>');
    expect(String((out as { content: string }).content)).not.toContain('body{color:red}');
  });

  it('names the URL and cause when http.fetch throws fetch failed', async () => {
    const tools = createPlatformToolInvoker({
      root: tmpdir(),
      fetchImpl: async () => {
        const err = new TypeError('fetch failed');
        (err as Error & { cause?: { code: string } }).cause = { code: 'ECONNRESET' };
        throw err;
      },
    });
    await expect(tools.invoke('http.fetch', { url: 'https://example.com/page' })).rejects.toThrow(
      /http.fetch https:\/\/example.com\/page: fetch failed \(ECONNRESET\)/
    );
  });

  it('uses the injected complete() to write a chat reply instead of dumping materials', async () => {
    const tools = createPlatformToolInvoker({
      root: tmpdir(),
      userIntent: '这个站点是干什么的？',
      complete: async (prompt) => {
        expect(prompt).toContain('Example Domain');
        expect(prompt).toContain('用户问题');
        expect(prompt).toContain('这个站点是干什么的？');
        expect(prompt).not.toContain('<!doctype');
        expect(prompt).not.toContain('Markdown 摘要');
        expect(prompt).not.toContain('成文编辑');
        return '这个站点只用来做文档示例。';
      },
    });
    const out = await tools.invoke('text.compose', {
      title: '摘要',
      parts: {
        url: 'https://example.com',
        content:
          '<!doctype html><h1>Example Domain</h1><p>This domain is for use in documentation examples.</p>',
      },
    });
    expect(out).toBe('这个站点只用来做文档示例。');
  });

  it('unwraps a JSON brief from complete()', async () => {
    const tools = createPlatformToolInvoker({
      root: tmpdir(),
      complete: async () => JSON.stringify({ title: '摘要', content: '该站点仅用于文档示例。' }),
    });
    const out = await tools.invoke('text.compose', {
      title: '摘要',
      parts: { content: 'Example Domain is for documentation examples.' },
    });
    expect(out).toBe('该站点仅用于文档示例。');
  });

  it('unwraps a JSON reply field from complete()', async () => {
    const tools = createPlatformToolInvoker({
      root: tmpdir(),
      complete: async () => JSON.stringify({ reply: '周六上海可以先去博物馆。' }),
    });
    const out = await tools.invoke('text.compose', {
      parts: { content: '上海博物馆 免费' },
    });
    expect(out).toBe('周六上海可以先去博物馆。');
    expect(String(out)).not.toMatch(/\{/);
  });

  it('unwraps a JSON recommendations list from complete()', async () => {
    const tools = createPlatformToolInvoker({
      root: tmpdir(),
      complete: async () => JSON.stringify({ recommendations: ['上海博物馆', '静安雕塑公园'] }),
    });
    const out = await tools.invoke('text.compose', { parts: { content: 'poi' } });
    expect(out).toBe('- 上海博物馆\n- 静安雕塑公园');
  });

  it('unwraps route+weather JSON and git-status shaped JSON', async () => {
    const routeTools = createPlatformToolInvoker({
      root: tmpdir(),
      complete: async () =>
        JSON.stringify({
          route: '从外滩走到上海博物馆大约两公里。',
          weather: '今天多云，32℃。',
        }),
    });
    await expect(routeTools.invoke('text.compose', { parts: { content: 'walk' } })).resolves.toBe(
      '从外滩走到上海博物馆大约两公里。\n\n今天多云，32℃。'
    );

    const gitTools = createPlatformToolInvoker({
      root: tmpdir(),
      complete: async () =>
        JSON.stringify({
          repo: '@open-rush/root',
          clean: false,
          branch: 'main',
          modified: ['apps/agent-worker/src/server.ts'],
        }),
    });
    const gitOut = String(await gitTools.invoke('text.compose', { parts: { content: 'git' } }));
    expect(gitOut).toContain('仓库：@open-rush/root');
    expect(gitOut).toContain('工作区：不干净');
    expect(gitOut).not.toMatch(/^\s*\{/);
  });
});
// AIGC END
