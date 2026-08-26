// AIGC START
import { createMcpClient, type IMcpClient } from '@open-rush/mcp';
import { createMcpToolInvoker, type ToolInvoker } from '@open-rush/workflow';

const AMAP_PREFIX = 'amap-maps';

const LNG_LAT = /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/;

function amapBareName(toolName: string): string {
  return toolName.replace(/^amap-maps__/i, '');
}

export function extractAmapLocation(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (LNG_LAT.test(trimmed)) return trimmed.replace(/\s+/g, '');
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length < 20_000) {
      try {
        return extractAmapLocation(JSON.parse(trimmed) as unknown);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return undefined;
  if (Array.isArray(value)) {
    if (
      value.length >= 2 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'number' &&
      Number.isFinite(value[0]) &&
      Number.isFinite(value[1])
    ) {
      return `${value[0]},${value[1]}`;
    }
    for (const item of value) {
      const hit = extractAmapLocation(item);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const rec = value as Record<string, unknown>;
  for (const key of ['location', 'results', 'return', 'geocodes', 'pois']) {
    if (key in rec) {
      const hit = extractAmapLocation(rec[key]);
      if (hit) return hit;
    }
  }
  const lng = rec.lng ?? rec.longitude;
  const lat = rec.lat ?? rec.latitude;
  if (typeof lng === 'number' && typeof lat === 'number') return `${lng},${lat}`;
  if (typeof lng === 'string' && typeof lat === 'string' && LNG_LAT.test(`${lng},${lat}`)) {
    return `${lng},${lat}`;
  }
  return undefined;
}

export function flattenAmapToolResult(toolName: string, result: unknown): unknown {
  const name = amapBareName(toolName);
  if (name !== 'maps_geo' && name !== 'maps_regeocode') return result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const rec = result as Record<string, unknown>;
  const list = rec.results ?? rec.return ?? rec.geocodes;
  const first = Array.isArray(list) ? list[0] : list;
  if (!first || typeof first !== 'object' || Array.isArray(first)) return result;
  return { ...(first as Record<string, unknown>), results: list };
}

export function normalizeAmapInvokeArgs(
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  const name = amapBareName(toolName);
  const next = { ...args };
  const locKeys =
    name === 'maps_around_search' || name === 'maps_regeocode'
      ? ['location']
      : name.includes('direction') || name === 'maps_distance'
        ? ['origin', 'destination', 'origins']
        : [];
  for (const key of locKeys) {
    if (!(key in next)) continue;
    const hit = extractAmapLocation(next[key]);
    if (hit) next[key] = hit;
  }
  if (name === 'maps_around_search') {
    const hit = extractAmapLocation(next.location) ?? extractAmapLocation(next);
    if (hit) next.location = hit;
    if (next.radius != null && typeof next.radius !== 'string') next.radius = String(next.radius);
    const keywords = next.keywords ?? next.keyword ?? next.query ?? next.types;
    if (keywords != null && keywords !== '') next.keywords = String(keywords);
  }
  return next;
}

function wrapAmapInvoker(tools: ToolInvoker): ToolInvoker {
  const queued = createQueuedInvoker(
    {
      listTools() {
        return tools.listTools();
      },
      invoke(name, args, signal) {
        return tools.invoke(name, normalizeAmapInvokeArgs(name, args), signal);
      },
    },
    { minIntervalMs: 350, retries: 3, retryDelayMs: 400 }
  );
  return {
    listTools() {
      return queued.listTools();
    },
    async invoke(name, args, signal) {
      const out = await queued.invoke(name, args, signal);
      return flattenAmapToolResult(name, out) as Awaited<ReturnType<ToolInvoker['invoke']>>;
    },
  };
}

export function isTransientAmapError(err: unknown): boolean {
  const parts: string[] = [];
  if (err instanceof Error) {
    parts.push(err.message, err.name);
    if (err.cause instanceof Error) parts.push(err.cause.message, err.cause.name);
    else if (err.cause != null) parts.push(String(err.cause));
  } else {
    parts.push(String(err));
  }
  const msg = parts.join(' ');
  return /fetch failed|ECONNRESET|UND_ERR|ETIMEDOUT|ENOTFOUND|CUQPS|EXCEEDED_THE_LIMIT|429|socket|network/i.test(
    msg
  );
}

export function createQueuedInvoker(
  inner: ToolInvoker,
  options?: { minIntervalMs?: number; retries?: number; retryDelayMs?: number }
): ToolInvoker {
  const minIntervalMs = options?.minIntervalMs ?? 350;
  const retries = options?.retries ?? 3;
  const retryDelayMs = options?.retryDelayMs ?? 400;
  let chain: Promise<unknown> = Promise.resolve();
  let lastAt = 0;

  const invokeOne = async (name: string, args: Record<string, unknown>, signal?: AbortSignal) => {
    const wait = Math.max(0, minIntervalMs - (Date.now() - lastAt));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const out = await inner.invoke(name, args, signal);
        lastAt = Date.now();
        return out;
      } catch (err) {
        lastErr = err;
        lastAt = Date.now();
        if (attempt === retries || !isTransientAmapError(err)) throw err;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * 2 ** attempt));
      }
    }
    throw lastErr;
  };

  return {
    listTools() {
      return inner.listTools();
    },
    invoke(name, args, signal) {
      const run = () => invokeOne(name, args, signal);
      const next = chain.then(run, run);
      chain = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    },
  };
}

export function amapMcpUrl(apiKey: string): string {
  const key = apiKey.trim();
  return `https://mcp.amap.com/mcp?key=${encodeURIComponent(key)}`;
}

export async function connectAmapMcpInvoker(
  apiKey: string
): Promise<{ tools: ToolInvoker; disconnect: () => Promise<void> }> {
  const key = apiKey.trim();
  const attempts: Array<{ label: string; client: IMcpClient }> = [
    {
      label: 'streamable-http',
      client: createMcpClient(
        {
          id: AMAP_PREFIX,
          name: AMAP_PREFIX,
          transport: 'streamable-http',
          url: amapMcpUrl(key),
          enabled: true,
          scope: 'global',
        },
        { timeout: 20_000 }
      ),
    },
    {
      label: 'stdio',
      client: createMcpClient(
        {
          id: AMAP_PREFIX,
          name: AMAP_PREFIX,
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@amap/amap-maps-mcp-server'],
          env: { AMAP_MAPS_API_KEY: key },
          enabled: true,
          scope: 'global',
        },
        { timeout: 45_000 }
      ),
    },
  ];
  const errors: string[] = [];
  for (const attempt of attempts) {
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
        { prefix: AMAP_PREFIX }
      );
      return {
        tools: wrapAmapInvoker(tools),
        disconnect: () => attempt.client.disconnect(),
      };
    } catch (err) {
      await attempt.client.disconnect().catch(() => undefined);
      errors.push(`${attempt.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(errors.join('; '));
}

export async function tryConnectAmapFromEnv(): Promise<ToolInvoker | null> {
  const apiKey = (process.env.AMAP_MAPS_API_KEY ?? '').trim();
  if (!apiKey) return null;
  try {
    const { tools } = await connectAmapMcpInvoker(apiKey);
    const names = (await tools.listTools()).map((tool) => tool.name);
    console.log(`[Workflow] Amap MCP connected · ${names.length} tools`);
    return tools;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Workflow] Amap MCP unavailable, keeping travel mocks: ${message}`);
    return null;
  }
}
// AIGC END
