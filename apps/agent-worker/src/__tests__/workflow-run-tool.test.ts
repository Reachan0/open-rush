// AIGC START
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WORKFLOW_RUN_PROMPT_SECTION, WORKFLOW_RUN_TOOL_NAME } from '../workflow-run-tool.js';

describe('native workflow_run re-export', () => {
  it('keeps the public tool name and prompt contract', () => {
    expect(WORKFLOW_RUN_TOOL_NAME).toBe('workflow_run');
    expect(WORKFLOW_RUN_PROMPT_SECTION).toMatch(/不要按关键词清单决定/);
    expect(WORKFLOW_RUN_PROMPT_SECTION).toMatch(/每发一句都重新判断/);
  });
});

describe('DSH wiring', () => {
  it('registers the native plugin in cordis.yml', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const yaml = readFileSync(join(here, '../../dsh/cordis.yml'), 'utf8');
    expect(yaml).toContain('./tool-workflow-run.mjs');
    expect(yaml).toContain('./openrush-loop-mcp.mjs');
    expect(yaml.indexOf('./openrush-loop-mcp.mjs')).toBeLessThan(
      yaml.indexOf('./tool-workflow-run.mjs')
    );
    expect(yaml.indexOf('\n- id: tool-fs\n')).toBeLessThan(
      yaml.indexOf('\n- id: tool-workflow-run\n')
    );
    expect(yaml).toContain('@deepseek-ai/dsh-tool-web');
    expect(yaml).toContain('@deepseek-ai/dsh-tool-fs-search');
    expect(yaml).toContain('@deepseek-ai/dsh-mcp-client');
  });

  it('hangs Keenable search MCP next to Amap in the Loop plugin', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const plugin = readFileSync(join(here, '../../dsh/openrush-loop-mcp.mjs'), 'utf8');
    expect(plugin).toContain('keenable-search-mcp.mjs');
    expect(plugin).toContain("serverName: 'keenable-search'");
    expect(plugin).toContain('await ctx.plugin');
    expect(plugin).toContain('resolveKeenableBaseUrl');
    expect(plugin).toContain('await Promise.all(jobs)');
  });

  it('does not pin DeepSeek thinking to reasoningEffort max', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const yaml = readFileSync(join(here, '../../dsh/cordis.yml'), 'utf8');
    expect(yaml).not.toMatch(/reasoningEffort:\s*max\b/);
    expect(yaml).toMatch(/DSH_REASONING_EFFORT/);
    expect(yaml).toMatch(/'high'/);
    expect(yaml).toMatch(/reasoningEffort: !!js "/);
  });

  it('loads the workspace Cordis plugin instead of bundling workflow-run-tool into agent-worker', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const plugin = readFileSync(join(here, '../../dsh/tool-workflow-run.mjs'), 'utf8');
    expect(plugin).toContain('@open-rush/dsh-tool-workflow-run');
    expect(plugin).toContain('createRequire');
    expect(plugin).toContain('export const apply');
    expect(plugin).not.toContain('packages/core/tools');
    expect(plugin).not.toContain('../dist/workflow-run-tool.js');
  });
});
// AIGC END
