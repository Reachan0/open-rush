// AIGC START
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createMcpClient } from '@open-rush/mcp';
import { createMcpToolInvoker, type ToolInvoker } from '@open-rush/workflow';

export const CODING_TOOLS_PREFIX = 'coding-tools';

export type CodingToolsPermissionMode = 'safe' | 'trusted' | 'dangerous';

export function codingToolsEnabled(): boolean {
  const flag = (process.env.CODING_TOOLS_MCP ?? '1').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(flag);
}

export function codingToolsPermissionMode(): CodingToolsPermissionMode {
  const raw = (process.env.CODING_TOOLS_MCP_PERMISSION_MODE ?? 'safe').trim().toLowerCase();
  if (raw === 'trusted' || raw === 'dangerous') return raw;
  return 'safe';
}

export function codingToolsStdioAttempts(workspace: string): Array<{
  label: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}> {
  const root = resolve(workspace);
  const mode = codingToolsPermissionMode();
  const env = {
    CODING_TOOLS_MCP_TELEMETRY: 'off',
    DO_NOT_TRACK: '1',
  };
  const flags = ['--stdio', '--workspace', root, '--permission-mode', mode];
  return [
    { label: 'npx', command: 'npx', args: ['-y', 'coding-tools-mcp', ...flags], env },
    { label: 'uvx', command: 'uvx', args: ['coding-tools-mcp', ...flags], env },
  ];
}

function commandOnPath(bin: string): boolean {
  const pathEnv = process.env.PATH ?? '';
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const suffixes = process.platform === 'win32' ? ['', '.cmd', '.exe'] : [''];
  return pathEnv
    .split(delimiter)
    .some((dir) => suffixes.some((suffix) => existsSync(join(dir, `${bin}${suffix}`))));
}

export function resolveWorkflowWorkspace(start: string): string {
  const override = (
    process.env.WORKFLOW_WORKSPACE ??
    process.env.CODING_TOOLS_MCP_WORKSPACE ??
    ''
  ).trim();
  if (override) return resolve(override);
  let dir = resolve(start);
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml')) || existsSync(join(dir, '.git'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}

export function codingReadPathCandidates(path: unknown): string[] {
  const extracted = extractCodingHitPath(path);
  const raw = String(extracted ?? path ?? '')
    .trim()
    .replace(/^\.\//, '');
  if (!raw || raw.includes('\n') || raw === '[object Object]') return [];
  const aliases = [raw];
  if (/^readme$/i.test(raw)) aliases.push('README.md');
  if (/^readme\.zh(-cn)?$/i.test(raw)) aliases.push('README.zh-CN.md');
  if (!raw.includes('.')) aliases.push(`${raw}.md`);
  return [...new Set(aliases)];
}

const RG_LINE = /^(\.?\/?[\w./@-]+\.[A-Za-z0-9]+):\d+/;
const SKIP_HIT = /workflow-live-page|__tests__|\/tests\/|\.test\.|\.spec\./i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseRipgrepHits(text: string): Array<{ path: string; line: string }> {
  const hits: Array<{ path: string; line: string }> = [];
  for (const line of text.split('\n')) {
    const match = line.match(RG_LINE);
    if (match) hits.push({ path: match[1].replace(/^\.\//, ''), line });
  }
  return hits;
}

function definitionRe(query: string): RegExp {
  return new RegExp(
    `(export\\s+)?(async\\s+)?function\\s+${escapeRegExp(query)}\\b|const\\s+${escapeRegExp(query)}\\s*=`
  );
}

function hitBlob(item: unknown): string {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  const rec = item as Record<string, unknown>;
  return [rec.preview, rec.line, rec.content, rec.text, rec.snippet]
    .map((part) => (typeof part === 'string' ? part : ''))
    .join('\n');
}

function hitPath(item: unknown): string | undefined {
  if (typeof item === 'string') {
    const trimmed = item.trim().replace(/^\.\//, '');
    if (/^[\w./@-]+\.[A-Za-z0-9]+$/.test(trimmed)) return trimmed;
    return undefined;
  }
  if (!item || typeof item !== 'object') return undefined;
  const rec = item as Record<string, unknown>;
  for (const key of ['path', 'file', 'filepath', 'filename', 'relative_path']) {
    if (typeof rec[key] === 'string' && rec[key].trim()) {
      return rec[key].trim().replace(/^\.\//, '');
    }
  }
  return undefined;
}

function pickPreferredHitPath(items: unknown[], query = ''): string | undefined {
  const parsed = items
    .map((item) => ({ path: hitPath(item), blob: hitBlob(item) }))
    .filter((item): item is { path: string; blob: string } => Boolean(item.path));
  const q = query.trim();
  if (q) {
    const def = definitionRe(q);
    const defHit = parsed.find((item) => def.test(item.blob) && !SKIP_HIT.test(item.path));
    if (defHit) return defHit.path;
  }
  return parsed.find((item) => !SKIP_HIT.test(item.path))?.path ?? parsed[0]?.path;
}

export function extractCodingHitPath(value: unknown, query = ''): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const rgHits = parseRipgrepHits(trimmed);
    if (rgHits.length > 0) {
      return pickPreferredHitPath(
        rgHits.map((hit) => ({ path: hit.path, preview: hit.line })),
        query
      );
    }
    if (!trimmed.includes('\n') && /^[\w./@-]+\.[A-Za-z0-9]+$/.test(trimmed)) {
      return trimmed.replace(/^\.\//, '');
    }
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length < 50_000) {
      try {
        return extractCodingHitPath(JSON.parse(trimmed) as unknown, query);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    return (
      pickPreferredHitPath(value, query) ??
      value.map((item) => extractCodingHitPath(item, query)).find(Boolean)
    );
  }
  if (!value || typeof value !== 'object') return undefined;
  const rec = value as Record<string, unknown>;
  for (const key of ['matches', 'results', 'hits', 'files', 'entries']) {
    if (Array.isArray(rec[key])) {
      const hit = pickPreferredHitPath(rec[key] as unknown[], query);
      if (hit) return hit;
    }
  }
  return hitPath(rec);
}

export function flattenCodingSearchResult(result: unknown, query = ''): unknown {
  const path = extractCodingHitPath(result, query);
  if (typeof result === 'string') {
    const matches = parseRipgrepHits(result);
    return {
      path: path ?? matches[0]?.path,
      matches,
      preview: result.slice(0, 4000),
    };
  }
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const rec = result as Record<string, unknown>;
    if (path) return { ...rec, path };
    return result;
  }
  return result;
}

export function normalizeCodingReadResult(result: unknown, path: string): Record<string, unknown> {
  if (typeof result === 'string') return { path, content: result };
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const rec = result as Record<string, unknown>;
    const content = rec.content ?? rec.text ?? rec.preview;
    return {
      ...rec,
      path: typeof rec.path === 'string' && rec.path.trim() ? rec.path : path,
      ...(typeof content === 'string' ? { content } : {}),
    };
  }
  return { path, content: result };
}

export function isCodingNotFound(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /NOT_FOUND|Path not found/i.test(msg);
}

export function wrapCodingInvoker(tools: ToolInvoker): ToolInvoker {
  return {
    listTools() {
      return tools.listTools();
    },
    async invoke(name, args, signal) {
      const bare = name.replace(/^coding-tools__/i, '');
      const next = { ...args };
      if (/^search_text$/i.test(bare)) {
        const query = next.query ?? next.pattern ?? next.text ?? next.search;
        if (query != null && (next.query == null || next.query === '')) {
          next.query = String(query);
        }
        const out = await tools.invoke(name, next, signal);
        return flattenCodingSearchResult(out, String(next.query ?? '')) as Awaited<
          ReturnType<ToolInvoker['invoke']>
        >;
      }
      if (!/^read_file$/i.test(bare)) {
        return tools.invoke(name, next, signal);
      }
      const rawPath = next.path ?? next.file ?? next.filepath ?? next.filename ?? next.target;
      const extracted = extractCodingHitPath(rawPath, String(next.query ?? ''));
      if (extracted) next.path = extracted;
      const pathText = typeof next.path === 'string' ? next.path.trim() : '';
      if (!pathText) {
        throw new Error(
          'read_file needs a relative file path. Search first and pass {{nodes.<search>.output.path}}.'
        );
      }
      const candidates = codingReadPathCandidates(next.path ?? rawPath);
      if (candidates.length === 0) {
        return normalizeCodingReadResult(
          await tools.invoke(name, next, signal),
          String(extracted ?? next.path ?? '')
        ) as Awaited<ReturnType<ToolInvoker['invoke']>>;
      }
      let last: unknown;
      for (const candidate of candidates) {
        try {
          const out = await tools.invoke(name, { ...next, path: candidate }, signal);
          return normalizeCodingReadResult(out, candidate) as Awaited<
            ReturnType<ToolInvoker['invoke']>
          >;
        } catch (err) {
          last = err;
          if (!isCodingNotFound(err)) throw err;
        }
      }
      throw last;
    },
  };
}

export async function connectCodingToolsInvoker(
  workspace: string
): Promise<{ tools: ToolInvoker; disconnect: () => Promise<void> }> {
  const attempts = codingToolsStdioAttempts(workspace).map((attempt) => ({
    ...attempt,
    client: createMcpClient(
      {
        id: CODING_TOOLS_PREFIX,
        name: CODING_TOOLS_PREFIX,
        transport: 'stdio',
        command: attempt.command,
        args: attempt.args,
        env: attempt.env,
        enabled: true,
        scope: 'project',
      },
      { timeout: 90_000 }
    ),
  }));
  const errors: string[] = [];
  for (const attempt of attempts) {
    if (!commandOnPath(attempt.command)) {
      errors.push(`${attempt.label}: command not found`);
      continue;
    }
    try {
      await attempt.client.connect();
      const listed = await attempt.client.listTools();
      if (listed.length === 0) {
        await attempt.client.disconnect();
        errors.push(`${attempt.label}: zero tools`);
        continue;
      }
      const tools = createMcpToolInvoker(
        listed.map((tool) => ({
          name: tool.name,
          description: tool.description || tool.name,
          inputSchema: tool.inputSchema,
        })),
        (name, args) => attempt.client.callTool(name, args),
        { prefix: CODING_TOOLS_PREFIX }
      );
      return {
        tools: wrapCodingInvoker(tools),
        disconnect: () => attempt.client.disconnect(),
      };
    } catch (err) {
      await attempt.client.disconnect().catch(() => undefined);
      errors.push(`${attempt.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(errors.join('; '));
}

export async function tryConnectCodingTools(workspace: string): Promise<ToolInvoker | null> {
  if (!codingToolsEnabled()) return null;
  try {
    const { tools } = await connectCodingToolsInvoker(workspace);
    const names = (await tools.listTools()).map((tool) => tool.name);
    console.log(`[Workflow] coding-tools MCP connected · ${names.length} tools · ${workspace}`);
    return tools;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Workflow] coding-tools MCP unavailable: ${message}`);
    return null;
  }
}
// AIGC END
