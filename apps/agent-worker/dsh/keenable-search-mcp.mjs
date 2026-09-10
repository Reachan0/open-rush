#!/usr/bin/env node
// AIGC START
/**
 * Stdio MCP server: Keenable web search for the OpenRush DSH Loop.
 * Registered as mcp__keenable-search__web_search. Does not use DEEPSEEK_API_KEY
 * or DSH native web_search (Anthropic /messages).
 */
const PROTOCOL = '2024-11-05';
const TOOL_NAME = 'web_search';
export const DEFAULT_KEENABLE_BASE_URL = 'https://api.keenable.ai';

/** Empty / relative values become the absolute default. fetch('/v1/search') throws. */
export function resolveKeenableBaseUrl(env = process.env) {
  const raw = String(env.KEENABLE_BASE_URL || env.KEENABLE_API_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (/^https?:\/\//i.test(raw)) return raw;
  return DEFAULT_KEENABLE_BASE_URL;
}

export function keenableConfig(env = process.env) {
  const base = resolveKeenableBaseUrl(env);
  const apiKey = (env.KEENABLE_API_KEY ?? '').trim();
  const title = (env.KEENABLE_TITLE ?? 'OpenRush').slice(0, 256);
  return {
    base,
    apiKey,
    title,
    url: apiKey ? `${base}/v1/search` : `${base}/v1/search/public`,
  };
}

export function searchQueryFromArgs(args) {
  if (!args || typeof args !== 'object') return '';
  const rec = args;
  if (typeof rec.query === 'string') return rec.query.trim();
  if (Array.isArray(rec.queries) && typeof rec.queries[0] === 'string') {
    return rec.queries[0].trim();
  }
  return '';
}

export async function runKeenableSearch(args, options = {}) {
  const query = searchQueryFromArgs(args);
  if (!query) {
    throw new Error('query is required');
  }
  let limit = Number(args?.limit ?? 5);
  if (!Number.isFinite(limit)) limit = 5;
  limit = Math.min(10, Math.max(1, Math.round(limit)));
  const cfg = keenableConfig(options.env ?? process.env);
  const headers = {
    'Content-Type': 'application/json',
    'X-Keenable-Title': cfg.title,
  };
  if (cfg.apiKey) headers['X-API-Key'] = cfg.apiKey;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(cfg.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, max_results: limit }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`keenable search ${response.status}: ${body.slice(0, 300)}`);
  }
  const payload = await response.json();
  const rawResults = Array.isArray(payload.results) ? payload.results : [];
  const results = rawResults.slice(0, limit).map((item) => {
    const rec = item && typeof item === 'object' ? item : {};
    return {
      title: String(rec.title ?? ''),
      url: String(rec.url ?? ''),
      description: String(rec.description ?? ''),
      snippet: String(rec.snippet ?? ''),
    };
  });
  return {
    query: typeof payload.query === 'string' ? payload.query : query,
    results,
  };
}

export const SEARCH_TOOL = {
  name: TOOL_NAME,
  description:
    'Live web search via Keenable MCP. Input { query, limit? }. Output { query, results: [{ title, url, description, snippet }] }. Use for open-web facts; do not use DSH native web_search.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Short search query, not the whole user sentence.' },
      limit: { type: 'integer', description: 'Max results, 1-10.', minimum: 1, maximum: 10 },
    },
    required: ['query'],
  },
};

export async function handleMcpMessage(message, options = {}) {
  if (!message || typeof message !== 'object') return null;
  const { id, method, params } = message;
  if (typeof method !== 'string') return null;
  if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
    return null;
  }
  const reply = (result) => (id === undefined ? null : { jsonrpc: '2.0', id, result });
  const fail = (code, errMessage) =>
    id === undefined ? null : { jsonrpc: '2.0', id, error: { code, message: errMessage } };
  try {
    if (method === 'initialize') {
      const requested =
        params && typeof params === 'object' && typeof params.protocolVersion === 'string'
          ? params.protocolVersion
          : PROTOCOL;
      return reply({
        protocolVersion: requested || PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'keenable-search', version: '1.0.0' },
      });
    }
    if (method === 'ping' || method === 'tools/listChanged') {
      return reply({});
    }
    if (method === 'tools/list') {
      return reply({ tools: [SEARCH_TOOL] });
    }
    if (method === 'tools/call') {
      const name = params && typeof params === 'object' ? String(params.name ?? '') : '';
      const args =
        params &&
        typeof params === 'object' &&
        params.arguments &&
        typeof params.arguments === 'object'
          ? params.arguments
          : {};
      if (name !== TOOL_NAME) {
        return reply({
          content: [{ type: 'text', text: `unknown tool: ${name}` }],
          isError: true,
        });
      }
      const payload = await runKeenableSearch(args, options);
      const text = JSON.stringify(payload);
      return reply({
        content: [{ type: 'text', text }],
        structuredContent: payload,
        isError: false,
      });
    }
    return fail(-32601, `Method not found: ${method}`);
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    if (method === 'tools/call') {
      return reply({
        content: [{ type: 'text', text: errMessage }],
        isError: true,
      });
    }
    return fail(-32603, errMessage);
  }
}

function sendFramed(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

export function attachStdio(options = {}) {
  let buffer = '';
  let chain = Promise.resolve();
  const consume = async () => {
    for (;;) {
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      const line = buffer.slice(0, nl).replace(/\r$/, '').trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        process.stderr.write(`[keenable-search-mcp] bad json: ${line.slice(0, 120)}\n`);
        continue;
      }
      const method = parsed && typeof parsed === 'object' ? String(parsed.method ?? '') : '';
      if (method) process.stderr.write(`[keenable-search-mcp] ${method}\n`);
      const reply = await handleMcpMessage(parsed, options);
      if (reply) sendFramed(reply);
    }
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += String(chunk);
    chain = chain.then(consume).catch((err) => {
      process.stderr.write(
        `[keenable-search-mcp] consume error: ${err instanceof Error ? err.message : String(err)}\n`
      );
    });
  });
  process.stderr.write('[keenable-search-mcp] listening on stdio (ndjson)\n');
}

const launchedAsServer = Boolean(
  process.argv[1] && /keenable-search-mcp\.mjs$/.test(process.argv[1])
);
if (launchedAsServer) {
  attachStdio();
}
// AIGC END
