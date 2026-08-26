// AIGC START
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { LlmComplete } from './generate.js';
import { createToolInvoker, type RegisteredTool } from './tools.js';
import { jsonValue, WorkflowError } from './types.js';

const MAX_CHARS = 24_000;
const COMPOSE_MATERIALS_MAX = 12_000;

function htmlToText(raw: string): string {
  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(raw) || /<!doctype/i.test(raw);
  if (!looksHtml) return raw;
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function networkErrorMessage(label: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const cause =
    err && typeof err === 'object' && 'cause' in err
      ? (err as { cause?: { code?: string; message?: string } }).cause
      : undefined;
  const extra = cause?.code || cause?.message;
  return extra ? `${label}: ${message} (${extra})` : `${label}: ${message}`;
}

function isRetryableNetworkError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === 'object' && 'cause' in err
      ? String((err as { cause?: { code?: string } }).cause?.code ?? '')
      : '';
  return /fetch failed|network|ECONNRESET|ETIMEDOUT|UND_ERR|ENOTFOUND/i.test(`${message} ${code}`);
}

async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await fetchImpl(url, init);
    } catch (err) {
      lastError = err;
      if (attempt === 2 || !isRetryableNetworkError(err)) throw err;
    }
  }
  throw lastError;
}

function formatComposePart(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === 'string') return [htmlToText(value)];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) {
    const items = value.flatMap((item, index) => {
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        if (
          typeof rec.title === 'string' ||
          typeof rec.url === 'string' ||
          typeof rec.name === 'string'
        ) {
          const title = String(rec.title ?? rec.name ?? `条目 ${index + 1}`);
          const url = typeof rec.url === 'string' ? rec.url : '';
          const body = String(rec.snippet ?? rec.description ?? rec.content ?? '');
          return [`${index + 1}. ${title}${url ? `\n   ${url}` : ''}${body ? `\n   ${body}` : ''}`];
        }
      }
      return formatComposePart(item);
    });
    return items;
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (Array.isArray(rec.results)) {
      const head = typeof rec.query === 'string' && rec.query ? [`检索：${rec.query}`, ''] : [];
      return [...head, ...formatComposePart(rec.results)];
    }
    if (typeof rec.error === 'string' && rec.skipped) {
      const src = typeof rec.url === 'string' ? rec.url : '';
      return [src ? `跳过抓取 ${src}：${rec.error}` : `跳过：${rec.error}`];
    }
    if (typeof rec.content === 'string') {
      const src =
        typeof rec.url === 'string' ? rec.url : typeof rec.path === 'string' ? rec.path : '';
      const content = htmlToText(rec.content);
      return src ? [`来源：${src}`, content] : [content];
    }
    if (Array.isArray(rec.places)) {
      const names = rec.places
        .map((place) =>
          place && typeof place === 'object' && 'name' in place
            ? String((place as { name: unknown }).name)
            : ''
        )
        .filter(Boolean);
      return names.length ? [names.join('、')] : formatComposePart(rec.places);
    }
    const lines = Object.entries(rec)
      .filter(([, v]) => v != null && v !== '')
      .map(([key, v]) => {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          return `${key}：${v}`;
        }
        const nested = formatComposePart(v).join('\n');
        return nested ? `${key}\n${nested}` : '';
      })
      .filter(Boolean);
    return lines;
  }
  return [];
}

function unwrapBrief(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'string') return parsed.trim();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>;
      for (const key of [
        'reply',
        'content',
        'markdown',
        'summary',
        'text',
        'article',
        'answer',
        'message',
      ]) {
        if (typeof rec[key] === 'string' && rec[key].trim()) return rec[key].trim();
      }
      const route = typeof rec.route === 'string' ? rec.route.trim() : '';
      const weather = typeof rec.weather === 'string' ? rec.weather.trim() : '';
      if (route && weather) return `${route}\n\n${weather}`;
      if (route) return route;
      if (weather) return weather;
      const recs = rec.recommendations;
      if (Array.isArray(recs) && recs.every((item) => typeof item === 'string')) {
        return recs.map((item) => `- ${item}`).join('\n');
      }
      const prose = objectToChatProse(rec);
      if (prose) return prose;
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

function objectToChatProse(rec: Record<string, unknown>): string | undefined {
  const labels: Record<string, string> = {
    repo: '仓库',
    name: '名称',
    branch: '分支',
    clean: '工作区',
    modified: '已改文件',
    staged: '已暂存',
    untracked: '未跟踪',
  };
  const lines: string[] = [];
  for (const [key, value] of Object.entries(rec)) {
    if (value == null) continue;
    const label = labels[key] ?? key;
    if (typeof value === 'boolean') {
      lines.push(
        key === 'clean'
          ? `${label}：${value ? '干净' : '不干净'}`
          : `${label}：${value ? '是' : '否'}`
      );
    } else if (typeof value === 'string' || typeof value === 'number') {
      if (String(value).trim()) lines.push(`${label}：${value}`);
    } else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      const shown = value.slice(0, 12);
      lines.push(`${label}：${shown.join('、')}${value.length > 12 ? '…' : ''}`);
    }
  }
  return lines.length >= 2 ? lines.join('\n') : undefined;
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function resolveUnderRoot(root: string, inputPath: string): string {
  const base = resolve(root);
  const candidate = resolve(base, inputPath);
  const rel = relative(base, candidate);
  if (isAbsolute(rel) || rel.split(sep).includes('..') || rel.startsWith('..')) {
    throw new WorkflowError('node_failed', `path escapes workspace: ${inputPath}`);
  }
  return candidate;
}

export function createPlatformToolInvoker(options: {
  root: string;
  fetchImpl?: typeof fetch;
  complete?: LlmComplete;
  userIntent?: string;
  keenable?: {
    apiKey?: string;
    baseUrl?: string;
    appTitle?: string;
  };
}): ReturnType<typeof createToolInvoker> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const tools: RegisteredTool[] = [
    {
      name: 'web.search',
      description:
        'Live web search via Keenable. Input { query, limit? }. Output { query, results: [{ title, url, description, snippet }] }. Prefer this for open-web facts and recommendations; then optionally http.fetch top URLs.',
      execute: async (args, signal) => {
        const query = String(args.query ?? '').trim();
        if (!query) {
          throw new WorkflowError('node_failed', 'query is required');
        }
        let limit = Number(args.limit ?? 5);
        if (!Number.isFinite(limit)) limit = 5;
        limit = Math.min(10, Math.max(1, Math.round(limit)));

        const base = (
          options.keenable?.baseUrl ??
          process.env.KEENABLE_API_URL ??
          'https://api.keenable.ai'
        ).replace(/\/$/, '');
        const apiKey = (options.keenable?.apiKey ?? process.env.KEENABLE_API_KEY ?? '').trim();
        const title = (
          options.keenable?.appTitle ??
          process.env.KEENABLE_TITLE ??
          'OpenRush'
        ).slice(0, 256);
        const keyed = apiKey.length > 0;
        const url = keyed ? `${base}/v1/search` : `${base}/v1/search/public`;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Keenable-Title': title,
        };
        if (keyed) headers['X-API-Key'] = apiKey;

        const response = await fetchWithRetry(fetchImpl, url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query, max_results: limit }),
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
            : AbortSignal.timeout(20_000),
        }).catch((err: unknown) => {
          throw new WorkflowError('node_failed', networkErrorMessage(`web.search ${url}`, err));
        });
        if (!response.ok) {
          const body = await response.text();
          throw new WorkflowError(
            'node_failed',
            `web.search ${response.status}: ${body.slice(0, 300)}`
          );
        }
        const payload = (await response.json()) as {
          query?: unknown;
          results?: unknown;
        };
        const rawResults = Array.isArray(payload.results) ? payload.results : [];
        const results = rawResults.slice(0, limit).map((item) => {
          const rec = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
          return {
            title: String(rec.title ?? ''),
            url: String(rec.url ?? ''),
            description: String(rec.description ?? ''),
            snippet: String(rec.snippet ?? ''),
          };
        });
        return jsonValue({
          query: typeof payload.query === 'string' ? payload.query : query,
          results,
        });
      },
    },
    {
      name: 'http.fetch',
      description:
        'HTTP GET a public URL. Input { url }. Output { url, status, content }. Use for gathering pages to summarize. No localhost/private IPs.',
      execute: async (args, signal) => {
        const urlText = String(args.url ?? '');
        let parsed: URL;
        try {
          parsed = new URL(urlText);
        } catch {
          throw new WorkflowError('node_failed', `invalid url: ${urlText}`);
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new WorkflowError('node_failed', `unsupported protocol: ${parsed.protocol}`);
        }
        if (isBlockedHost(parsed.hostname)) {
          throw new WorkflowError('node_failed', `blocked host: ${parsed.hostname}`);
        }
        const response = await fetchWithRetry(fetchImpl, parsed.toString(), {
          method: 'GET',
          redirect: 'follow',
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
            : AbortSignal.timeout(20_000),
          headers: { 'User-Agent': 'OpenRush-workflow/0.1' },
        }).catch((err: unknown) => {
          throw new WorkflowError(
            'node_failed',
            networkErrorMessage(`http.fetch ${parsed.toString()}`, err)
          );
        });
        const raw = await response.text();
        const truncated = raw.length > MAX_CHARS ? `${raw.slice(0, MAX_CHARS)}\n…[truncated]` : raw;
        const contentType = response.headers.get('content-type') ?? '';
        let content =
          /html/i.test(contentType) || /<\/?[a-z][\s\S]*>/i.test(truncated)
            ? htmlToText(truncated)
            : truncated;
        const FETCH_TEXT_MAX = 4_000;
        if (content.length > FETCH_TEXT_MAX) {
          content = `${content.slice(0, FETCH_TEXT_MAX)}\n…[truncated]`;
        }
        return jsonValue({
          url: parsed.toString(),
          status: response.status,
          content,
        });
      },
    },
    {
      name: 'fs.read',
      description:
        'Read a UTF-8 file relative to the workspace root. Input { path }. Output { path, content }. Path cannot escape the workspace.',
      execute: async (args) => {
        const pathText = String(args.path ?? '');
        if (!pathText.trim()) {
          throw new WorkflowError('node_failed', 'path is required');
        }
        const abs = resolveUnderRoot(options.root, pathText);
        const raw = await readFile(abs, 'utf8');
        const content = raw.length > MAX_CHARS ? `${raw.slice(0, MAX_CHARS)}\n…[truncated]` : raw;
        return jsonValue({ path: pathText, content });
      },
    },
    {
      name: 'text.compose',
      description:
        'Write the final assistant chat reply from gathered tool outputs. Input { intent?, parts }. Same tone as a normal OpenRush / Deepseek Harness message; not a standalone markdown article.',
      execute: async (args) => {
        const intent = String(
          options.userIntent ?? args.intent ?? args.question ?? args.prompt ?? ''
        ).trim();
        const materials = formatComposePart(args.parts).join('\n').trim();
        if (!options.complete) return materials;
        const clipped =
          materials.length > COMPOSE_MATERIALS_MAX
            ? `${materials.slice(0, COMPOSE_MATERIALS_MAX)}\n…[truncated]`
            : materials;
        try {
          const written = await options.complete(
            [
              '你是 OpenRush 聊天里的助手，回复风格与 Deepseek Harness 一致。',
              '下面是用户问题和工具已经查到的材料。请直接回答用户，不要写成独立的 Markdown 文档、攻略或摘要标题。',
              '可以用短段落、列表和加粗（聊天里常见排版）；不要使用一级标题（# ），不要写「以下是一篇…」「作为编辑…」这类套话。',
              '只根据材料里的事实，不要编造。材料里出现的 path / 文件路径必须原样写进回复，不要改成别的文件。不要复述 HTML / JSON / 原始标签。只输出给用户看的回复正文，不要包 JSON。',
              intent ? `用户问题：\n${intent}` : '',
              '',
              '材料：',
              clipped,
            ]
              .filter(Boolean)
              .join('\n')
          );
          const text = unwrapBrief(written);
          return text.length > 0 ? text : materials;
        } catch {
          return materials;
        }
      },
    },
  ];
  return createToolInvoker(tools);
}
// AIGC END
