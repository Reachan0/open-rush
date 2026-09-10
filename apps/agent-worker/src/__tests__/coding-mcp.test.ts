// AIGC START
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  codingReadPathCandidates,
  codingToolsEnabled,
  codingToolsStdioAttempts,
  extractCodingHitPath,
  flattenCodingSearchResult,
  resolveWorkflowWorkspace,
  wrapCodingInvoker,
} from '../coding-mcp.js';

describe('codingToolsStdioAttempts', () => {
  it('launches the official stdio server against the workspace', () => {
    const attempts = codingToolsStdioAttempts('/tmp/open-rush-demo');
    const npx = attempts.find((item) => item.label === 'npx');
    expect(npx?.command).toBe('npx');
    expect(npx?.args).toEqual([
      '-y',
      'coding-tools-mcp',
      '--stdio',
      '--workspace',
      '/tmp/open-rush-demo',
      '--permission-mode',
      'safe',
    ]);
    expect(npx?.env.CODING_TOOLS_MCP_TELEMETRY).toBe('off');
    expect(attempts.some((item) => item.label === 'uvx')).toBe(true);
  });
});

describe('codingToolsEnabled', () => {
  const previous = process.env.CODING_TOOLS_MCP;
  afterEach(() => {
    if (previous === undefined) delete process.env.CODING_TOOLS_MCP;
    else process.env.CODING_TOOLS_MCP = previous;
  });

  it('is off when CODING_TOOLS_MCP is unset', () => {
    delete process.env.CODING_TOOLS_MCP;
    expect(codingToolsEnabled()).toBe(false);
  });

  it('can be turned off with CODING_TOOLS_MCP=0', () => {
    process.env.CODING_TOOLS_MCP = '0';
    expect(codingToolsEnabled()).toBe(false);
  });

  it('is on only with an explicit CODING_TOOLS_MCP=1', () => {
    process.env.CODING_TOOLS_MCP = '1';
    expect(codingToolsEnabled()).toBe(true);
  });
});

describe('codingReadPathCandidates', () => {
  it('maps README to README.md', () => {
    expect(codingReadPathCandidates('README')).toEqual(['README', 'README.md']);
  });
});

describe('resolveWorkflowWorkspace', () => {
  const previous = process.env.WORKFLOW_WORKSPACE;
  const previousOpenRush = process.env.OPENRUSH_ROOT;
  const previousCoding = process.env.CODING_TOOLS_MCP_WORKSPACE;
  afterEach(() => {
    if (previous === undefined) delete process.env.WORKFLOW_WORKSPACE;
    else process.env.WORKFLOW_WORKSPACE = previous;
    if (previousOpenRush === undefined) delete process.env.OPENRUSH_ROOT;
    else process.env.OPENRUSH_ROOT = previousOpenRush;
    if (previousCoding === undefined) delete process.env.CODING_TOOLS_MCP_WORKSPACE;
    else process.env.CODING_TOOLS_MCP_WORKSPACE = previousCoding;
  });

  it('walks up from apps/agent-worker to the pnpm workspace root', () => {
    delete process.env.WORKFLOW_WORKSPACE;
    delete process.env.CODING_TOOLS_MCP_WORKSPACE;
    delete process.env.OPENRUSH_ROOT;
    const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    expect(resolveWorkflowWorkspace(workerRoot)).toBe(resolve(workerRoot, '../..'));
  });

  it('prefers OPENRUSH_ROOT over walking from an empty sandbox', () => {
    delete process.env.WORKFLOW_WORKSPACE;
    delete process.env.CODING_TOOLS_MCP_WORKSPACE;
    process.env.OPENRUSH_ROOT = '/tmp/open-rush-checkout';
    expect(resolveWorkflowWorkspace('/tmp/empty-lux-sandbox/proj')).toBe('/tmp/open-rush-checkout');
  });
});

describe('wrapCodingInvoker', () => {
  it('retries README.md when README is missing', async () => {
    const seen: string[] = [];
    const inner = {
      listTools: () => [],
      async invoke(_name: string, args: Record<string, unknown>) {
        seen.push(String(args.path));
        if (args.path === 'README') throw new Error('NOT_FOUND: Path not found: README');
        return { path: args.path, content: '# hi' };
      },
    };
    const wrapped = wrapCodingInvoker(inner);
    await expect(wrapped.invoke('coding-tools__read_file', { path: 'README' })).resolves.toEqual({
      path: 'README.md',
      content: '# hi',
    });
    expect(seen).toEqual(['README', 'README.md']);
  });

  it('maps search_text pattern onto query', async () => {
    const seen: Record<string, unknown>[] = [];
    const inner = {
      listTools: () => [],
      async invoke(_name: string, args: Record<string, unknown>) {
        seen.push(args);
        return { hits: 1 };
      },
    };
    const wrapped = wrapCodingInvoker(inner);
    await expect(
      wrapped.invoke('coding-tools__search_text', { pattern: 'chooseLane' })
    ).resolves.toEqual({ hits: 1 });
    expect(seen).toEqual([{ pattern: 'chooseLane', query: 'chooseLane' }]);
  });

  it('flattens ripgrep search dumps onto output.path', async () => {
    const dump = [
      'apps/agent-worker/src/workflow-live-page.ts:674:85: chooseLane chip',
      'packages/workflow/src/router.ts:24:17: export function chooseLane(intent: string): AgentLane {',
      'packages/workflow/src/__tests__/router.test.ts:6:11: describe chooseLane',
    ].join('\n');
    const inner = {
      listTools: () => [],
      async invoke() {
        return dump;
      },
    };
    const wrapped = wrapCodingInvoker(inner);
    await expect(
      wrapped.invoke('coding-tools__search_text', { query: 'chooseLane' })
    ).resolves.toMatchObject({
      path: 'packages/workflow/src/router.ts',
    });
  });

  it('extracts a file path when read_file is given the search dump', async () => {
    const seen: string[] = [];
    const dump = [
      'apps/agent-worker/src/workflow-live-page.ts:1:1: chip',
      'packages/workflow/src/router.ts:24:17: export function chooseLane(intent: string): AgentLane {',
    ].join('\n');
    const inner = {
      listTools: () => [],
      async invoke(_name: string, args: Record<string, unknown>) {
        seen.push(String(args.path));
        return { content: 'ok' };
      },
    };
    const wrapped = wrapCodingInvoker(inner);
    await wrapped.invoke('coding-tools__read_file', { path: dump });
    expect(seen).toEqual(['packages/workflow/src/router.ts']);
  });

  it('does not call MCP read_file when path is missing', async () => {
    const inner = {
      listTools: () => [],
      async invoke() {
        throw new Error('should not call MCP');
      },
    };
    const wrapped = wrapCodingInvoker(inner);
    await expect(wrapped.invoke('coding-tools__read_file', {})).rejects.toThrow(
      /needs a relative file path/
    );
  });
});

describe('extractCodingHitPath', () => {
  it('prefers an exported function over a live-page chip', () => {
    const dump = [
      'apps/agent-worker/src/workflow-live-page.ts:674:85: chooseLane',
      'packages/workflow/src/router.ts:24:17: export function chooseLane(intent: string): AgentLane {',
    ].join('\n');
    expect(extractCodingHitPath(dump, 'chooseLane')).toBe('packages/workflow/src/router.ts');
    expect(flattenCodingSearchResult(dump, 'chooseLane')).toMatchObject({
      path: 'packages/workflow/src/router.ts',
    });
  });

  it('prefers the exported function when MCP returns structured matches', () => {
    const structured = {
      query: 'chooseLane',
      path: 'apps/agent-worker/src/workflow-live-page.ts',
      matches: [
        {
          path: 'apps/agent-worker/src/workflow-live-page.ts',
          preview: 'data-example="...chooseLane..."',
        },
        {
          path: 'packages/workflow/src/router.ts',
          preview: 'export function chooseLane(intent: string): AgentLane {',
        },
      ],
    };
    expect(extractCodingHitPath(structured, 'chooseLane')).toBe('packages/workflow/src/router.ts');
    expect(flattenCodingSearchResult(structured, 'chooseLane')).toMatchObject({
      path: 'packages/workflow/src/router.ts',
    });
  });
});
// AIGC END
