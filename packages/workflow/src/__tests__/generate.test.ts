// AIGC START
import { describe, expect, it } from 'vitest';
import { WEEKEND_TRIP_INTENT } from '../fixtures.js';
import { generateWorkflowDsl } from '../generate.js';
import { createTravelToolInvoker } from '../travel-tools.js';
import { WorkflowError } from '../types.js';

describe('generateWorkflowDsl', () => {
  it('uses the LLM plan even when a travel heuristic would apply', async () => {
    const generated = await generateWorkflowDsl({
      intent: WEEKEND_TRIP_INTENT,
      tools: await createTravelToolInvoker().listTools(),
      allowHeuristic: true,
      complete: async () =>
        JSON.stringify({
          version: '1',
          name: 'llm-planned',
          nodes: [
            { id: 'here', tool: 'geo.locate', input: { query: '{{intent.text}}' } },
            {
              id: 'write',
              tool: 'article.compose',
              dependsOn: ['here'],
              input: { city: '{{nodes.here.output.city}}' },
            },
          ],
        }),
    });
    expect(generated.source).toBe('llm');
    expect(generated.dsl.name).toBe('llm-planned');
    expect(generated.dsl.nodes.map((n) => n.id)).toEqual(['here', 'write']);
  });

  it('tells the planner not to collapse named-city trips into web.search', async () => {
    const generated = await generateWorkflowDsl({
      intent: '我周六在上海，想带全家出去玩，推荐附近好玩的地方',
      tools: await createTravelToolInvoker().listTools(),
      complete: async () =>
        JSON.stringify({
          version: '1',
          name: 'trip',
          nodes: [{ id: 'here', tool: 'geo.locate' }],
        }),
    });
    expect(generated.prompt).toMatch(/Do NOT use web.search/);
  });

  it('tells the planner to use Amap MCP instead of travel mocks', async () => {
    const generated = await generateWorkflowDsl({
      intent: '我周六在上海，想带全家出去玩，推荐附近好玩的地方',
      tools: [
        { name: 'amap-maps__maps_geo', description: 'geocode' },
        { name: 'text.compose', description: 'write' },
      ],
      complete: async () =>
        JSON.stringify({
          version: '1',
          name: 'trip',
          nodes: [{ id: 'geo', tool: 'amap-maps__maps_geo' }],
        }),
    });
    expect(generated.prompt).toMatch(/amap-maps__/);
    expect(generated.prompt).toMatch(/Do NOT use travel.search/);
    expect(generated.prompt).toMatch(/longitude,latitude|lng,lat|output\.location/);
    expect(generated.prompt).toMatch(/one maps_around_search|QPS/i);
    expect(generated.prompt).toMatch(/maps_direction_walking/);
  });

  it('does not apply weekend-trip heuristic when Amap tools are present', async () => {
    await expect(
      generateWorkflowDsl({
        intent: WEEKEND_TRIP_INTENT,
        tools: [
          { name: 'amap-maps__maps_geo', description: 'geocode' },
          { name: 'text.compose', description: 'write' },
        ],
        allowHeuristic: true,
      })
    ).rejects.toBeInstanceOf(WorkflowError);
  });

  it('tells the planner to http.fetch pasted URLs instead of web.search', async () => {
    const generated = await generateWorkflowDsl({
      intent: '把 https://example.com 和 https://example.net 汇总成一篇中文对比简介',
      tools: await createTravelToolInvoker().listTools(),
      complete: async () =>
        JSON.stringify({
          version: '1',
          name: 'urls',
          nodes: [{ id: 'a', tool: 'geo.locate' }],
        }),
    });
    expect(generated.prompt).toMatch(/MUST http\.fetch each concrete URL/);
    expect(generated.prompt).toMatch(/Do NOT use web.search/);
  });

  it('tells the planner to fs.read workspace files instead of web.search', async () => {
    const generated = await generateWorkflowDsl({
      intent: '把工作区 package.json 和 .env.example 汇总成一份配置简介',
      tools: await createTravelToolInvoker().listTools(),
      complete: async () =>
        JSON.stringify({
          version: '1',
          name: 'files',
          nodes: [{ id: 'a', tool: 'geo.locate' }],
        }),
    });
    expect(generated.prompt).toMatch(/MUST fs\.read each named path/);
    expect(generated.prompt).toMatch(/Do NOT use web.search/);
  });

  it('tells the planner to use coding-tools MCP for workspace inspect', async () => {
    const generated = await generateWorkflowDsl({
      intent: '把工作区 package.json 和 README 汇总成一份配置简介',
      tools: [
        { name: 'coding-tools__read_file', description: 'read a file' },
        { name: 'coding-tools__search_text', description: 'search' },
        { name: 'text.compose', description: 'write' },
      ],
      complete: async () =>
        JSON.stringify({
          version: '1',
          name: 'files',
          nodes: [{ id: 'read', tool: 'coding-tools__read_file' }],
        }),
    });
    expect(generated.prompt).toMatch(/coding-tools__/);
    expect(generated.prompt).toMatch(/Do NOT use apply_patch/);
    expect(generated.prompt).toMatch(/Do NOT use web.search/);
    expect(generated.prompt).toMatch(/README\.md/);
    expect(generated.prompt).toMatch(/search_text with \{ query/);
  });

  it('keeps workspace 搜一下 on fs.search when coding-tools is absent', async () => {
    const generated = await generateWorkflowDsl({
      intent: '在工作区里搜一下 chooseLane 这个函数在哪定义，读那个文件，用口语讲它怎么分流',
      tools: [
        { name: 'web.search', description: 'web' },
        { name: 'fs.read', description: 'read' },
        { name: 'fs.search', description: 'search workspace' },
        { name: 'text.compose', description: 'write' },
      ],
      complete: async () =>
        JSON.stringify({
          version: '1',
          name: 'symbol',
          nodes: [{ id: 'find', tool: 'fs.search' }],
        }),
    });
    expect(generated.prompt).toMatch(/fs\.search/);
    expect(generated.prompt).toMatch(/Do NOT use web.search/);
    expect(generated.prompt).not.toMatch(/live coding-tools MCP/);
  });

  it('keeps workspace 搜一下 on coding-tools search_text, not web.search', async () => {
    const generated = await generateWorkflowDsl({
      intent: '在工作区里搜一下 chooseLane 这个函数在哪定义，读那个文件，用口语讲它怎么分流',
      tools: [
        { name: 'coding-tools__search_text', description: 'search' },
        { name: 'coding-tools__read_file', description: 'read' },
        { name: 'web.search', description: 'web' },
        { name: 'text.compose', description: 'write' },
      ],
      complete: async () =>
        JSON.stringify({
          version: '1',
          name: 'symbol',
          nodes: [{ id: 'find', tool: 'coding-tools__search_text' }],
        }),
    });
    expect(generated.prompt).toMatch(/live coding-tools MCP/);
    expect(generated.prompt).toMatch(/Do NOT use web.search/);
    expect(generated.prompt).toMatch(/search_text with \{ query/);
    expect(generated.prompt).toMatch(/output\.path/);
  });

  it('rejects invented tool names after retries', async () => {
    await expect(
      generateWorkflowDsl({
        intent: WEEKEND_TRIP_INTENT,
        tools: await createTravelToolInvoker().listTools(),
        allowHeuristic: false,
        complete: async () =>
          JSON.stringify({
            version: '1',
            name: 'invented',
            nodes: [{ id: 'x', tool: 'made.up.tool' }],
          }),
      })
    ).rejects.toBeInstanceOf(WorkflowError);
  });
});
// AIGC END
