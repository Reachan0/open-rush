// AIGC START
import { describe, expect, it } from 'vitest';
import {
  amapMcpUrl,
  createQueuedInvoker,
  extractAmapLocation,
  flattenAmapToolResult,
  normalizeAmapInvokeArgs,
} from '../amap-mcp.js';

describe('amapMcpUrl', () => {
  it('points at the official streamable HTTP endpoint', () => {
    expect(amapMcpUrl('test-key')).toBe('https://mcp.amap.com/mcp?key=test-key');
  });
});

describe('extractAmapLocation', () => {
  it('pulls lng,lat out of official maps_geo results', () => {
    expect(
      extractAmapLocation({
        results: [{ location: '121.497442,31.240105', city: '上海市' }],
      })
    ).toBe('121.497442,31.240105');
  });
});

describe('flattenAmapToolResult', () => {
  it('exposes maps_geo location at the top level for interpolation', () => {
    const flat = flattenAmapToolResult('amap-maps__maps_geo', {
      results: [{ location: '121.497442,31.240105', city: '上海市' }],
    });
    expect(flat).toMatchObject({ location: '121.497442,31.240105', city: '上海市' });
  });

  it('recognizes DSH MCP public names mcp__amap-maps__*', () => {
    const flat = flattenAmapToolResult('mcp__amap-maps__maps_geo', {
      results: [{ location: '121.497442,31.240105', city: '上海市' }],
    });
    expect(flat).toMatchObject({ location: '121.497442,31.240105' });
  });
});

describe('normalizeAmapInvokeArgs', () => {
  it('turns a nested geo blob into around_search location', () => {
    const args = normalizeAmapInvokeArgs('amap-maps__maps_around_search', {
      location: { results: [{ location: '121.497442,31.240105' }] },
      keywords: '公园',
    });
    expect(args.location).toBe('121.497442,31.240105');
    expect(args.keywords).toBe('公园');
  });
});

describe('createQueuedInvoker', () => {
  it('never overlaps in-flight Amap calls', async () => {
    let inflight = 0;
    let maxInflight = 0;
    const inner = {
      listTools: () => [],
      async invoke() {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((r) => setTimeout(r, 20));
        inflight -= 1;
        return { ok: true };
      },
    };
    const queued = createQueuedInvoker(inner, { minIntervalMs: 0, retries: 0 });
    await Promise.all([queued.invoke('a', {}), queued.invoke('b', {}), queued.invoke('c', {})]);
    expect(maxInflight).toBe(1);
  });

  it('retries CUQPS and fetch failed then succeeds', async () => {
    let n = 0;
    const inner = {
      listTools: () => [],
      async invoke() {
        n += 1;
        if (n === 1) throw new Error('fetch failed');
        if (n === 2) throw new Error('API 调用失败：CUQPS_HAS_EXCEEDED_THE_LIMIT');
        return { pois: [1] };
      },
    };
    const queued = createQueuedInvoker(inner, { minIntervalMs: 0, retries: 2, retryDelayMs: 1 });
    await expect(queued.invoke('amap-maps__maps_around_search', {})).resolves.toEqual({
      pois: [1],
    });
    expect(n).toBe(3);
  });
});
// AIGC END
