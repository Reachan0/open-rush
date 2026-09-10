// AIGC START
import { describe, expect, it } from 'vitest';
import { WEEKEND_TRIP_INTENT } from '../fixtures.js';
import { formatCatalogTool, generateWorkflowDsl, looksLikeWorkspaceInspect } from '../generate.js';
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

  it('treats 西湖跑步 as travel so the Amap hint applies', async () => {
    const generated = await generateWorkflowDsl({
      intent: '明天去西湖跑步，帮我看看天气和一条轻松路线',
      tools: [
        { name: 'amap-maps__maps_geo', description: 'geocode' },
        { name: 'amap-maps__maps_weather', description: 'weather' },
        { name: 'text.compose', description: 'write' },
      ],
      complete: async () =>
        JSON.stringify({
          version: '1',
          name: 'run',
          nodes: [{ id: 'geo', tool: 'amap-maps__maps_geo' }],
        }),
    });
    expect(generated.prompt).toMatch(/amap-maps__/);
    expect(generated.prompt).toMatch(/Do NOT use travel.search/);
    expect(generated.prompt).toMatch(
      /Do not use DSH native web_search|Never call DSH native web_search/
    );
  });

  it('treats 晚饭 as travel so Amap restaurant search can apply', async () => {
    const generated = await generateWorkflowDsl({
      intent: '成都春熙路晚饭去哪',
      tools: [
        { name: 'mcp__amap-maps__maps_geo', description: 'geocode' },
        { name: 'mcp__amap-maps__maps_around_search', description: 'poi' },
        { name: 'text.compose', description: 'write' },
      ],
      complete: async () =>
        JSON.stringify({
          version: '1',
          name: 'dinner',
          nodes: [{ id: 'geo', tool: 'mcp__amap-maps__maps_geo' }],
        }),
    });
    expect(generated.prompt).toMatch(/amap-maps__/);
    expect(generated.prompt).toMatch(/Do NOT use travel.search/);
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
    expect(generated.prompt).toMatch(
      /MUST (http\.fetch each concrete URL|copy the fetch tool name from the catalog)/
    );
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

  it('tells the DSH planner to glob/read cwd-relative paths and not bash env', async () => {
    const generated = await generateWorkflowDsl({
      intent:
        '列出 apps/agent-worker/dsh/ 目录里有哪些文件，再 read tool-workflow-run.mjs 的前 80 行，说明 workflow_run 怎么挂上的。',
      tools: [
        { name: 'glob', description: 'glob files' },
        { name: 'read', description: 'read a file' },
        { name: 'grep', description: 'search' },
        { name: 'text.compose', description: 'write' },
      ],
      complete: async () =>
        JSON.stringify({
          version: '1',
          name: 'dsh-dir',
          nodes: [{ id: 'list', tool: 'glob' }],
        }),
    });
    expect(
      looksLikeWorkspaceInspect(
        '列出 apps/agent-worker/dsh/ 目录里有哪些文件，再 read tool-workflow-run.mjs 的前 80 行'
      )
    ).toBe(true);
    expect(generated.prompt).toMatch(/read \/ grep \/ glob/);
    expect(generated.prompt).toMatch(/relative to the current cwd/);
    expect(generated.prompt).toMatch(/PNPM_SCRIPT_SRC_DIR/);
    expect(generated.prompt).toMatch(/Do NOT bash/);
    expect(generated.prompt).toMatch(/Do NOT use web.search/);
  });

  it('does not treat a travel ask as workspace inspect', () => {
    expect(looksLikeWorkspaceInspect('我周六想带全家出去玩，帮我推荐附近好玩的地方')).toBe(false);
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

  it('truncates long catalog descriptions and keeps inputSchema on the next line', () => {
    const line = formatCatalogTool({
      name: 'maps_geo',
      description: `${'x'.repeat(200)} extra`,
      inputSchema: { type: 'object', properties: { address: { type: 'string' } } },
    });
    const [head, schemaLine] = line.split('\n');
    expect(head.startsWith('- maps_geo: ')).toBe(true);
    expect(head.length).toBeLessThan(140);
    expect(head.endsWith('…')).toBe(true);
    expect(schemaLine).toMatch(/inputSchema:/);
    expect(schemaLine).toContain('address');
  });

  it('lists catalog tools with JSON Schema when present', async () => {
    let prompt = '';
    const generated = await generateWorkflowDsl({
      intent: '读 README.md 再用口语讲',
      tools: [
        {
          name: 'read',
          description: 'Read a file',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
        { name: 'text.compose', description: 'write' },
      ],
      complete: async (text) => {
        prompt = text;
        return JSON.stringify({
          version: '1',
          name: 'read-readme',
          nodes: [{ id: 'a', tool: 'read', input: { path: 'README.md' } }],
        });
      },
    });
    expect(generated.prompt).toBe(prompt);
    expect(prompt).toContain('read: Read a file');
    expect(prompt).toContain('inputSchema:');
    expect(prompt).toContain('"type":"object"');
    expect(prompt).toContain('read');
  });

  it('tells the planner to copy Keenable MCP search instead of DSH web_search', async () => {
    const generated = await generateWorkflowDsl({
      intent: '网上搜一下杭州明天天气和湖边跑步攻略',
      tools: [
        { name: 'mcp__keenable-search__web_search', description: 'search' },
        { name: 'mcp__amap-maps__maps_weather', description: 'weather' },
        { name: 'text.compose', description: 'write' },
      ],
      complete: async () =>
        JSON.stringify({
          version: '1',
          name: 'search',
          nodes: [{ id: 'web', tool: 'mcp__keenable-search__web_search' }],
        }),
    });
    expect(generated.prompt).toMatch(/mcp__keenable-search__/);
    expect(generated.prompt).toMatch(
      /Never call DSH native web_search|Do not use DSH native web_search/
    );
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
