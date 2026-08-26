// AIGC START
import { describe, expect, it, vi } from 'vitest';
import { createMcpToolInvoker } from '../tools.js';

describe('createMcpToolInvoker', () => {
  it('exposes prefixed names and strips the prefix on invoke', async () => {
    const callTool = vi.fn(async (name: string, args: Record<string, unknown>) => ({
      content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }],
    }));
    const tools = createMcpToolInvoker(
      [
        {
          name: 'maps_geo',
          description: 'Geocode an address',
          inputSchema: { type: 'object' },
        },
      ],
      callTool,
      { prefix: 'amap-maps' }
    );
    const listed = await tools.listTools();
    expect(listed).toEqual([
      {
        name: 'amap-maps__maps_geo',
        description: 'Geocode an address',
        inputSchema: { type: 'object' },
      },
    ]);
    const out = await tools.invoke('amap-maps__maps_geo', { address: '外滩' });
    expect(callTool).toHaveBeenCalledWith('maps_geo', { address: '外滩' });
    expect(out).toEqual({ tool: 'maps_geo', args: { address: '外滩' } });
  });

  it('prefers structuredContent over summary text', async () => {
    const tools = createMcpToolInvoker(
      [{ name: 'search_text', description: 'search', inputSchema: { type: 'object' } }],
      async () => ({
        content: [{ type: 'text', text: 'summary only' }],
        structuredContent: { path: 'src/router.ts', matches: [{ path: 'src/router.ts' }] },
      }),
      { prefix: 'coding-tools' }
    );
    await expect(
      tools.invoke('coding-tools__search_text', { query: 'chooseLane' })
    ).resolves.toEqual({
      path: 'src/router.ts',
      matches: [{ path: 'src/router.ts' }],
    });
  });
});
// AIGC END
