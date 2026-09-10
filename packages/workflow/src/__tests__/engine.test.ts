// AIGC START
import { describe, expect, it } from 'vitest';
import { executeWorkflow } from '../engine.js';
import { createMemorySink } from '../events.js';
import { createToolInvoker } from '../tools.js';
import type { JsonValue } from '../types.js';
import { WorkflowError } from '../types.js';

function echoTools() {
  return createToolInvoker([
    {
      name: 'echo',
      description: 'echo args.value',
      execute: (args) => args.value as JsonValue,
    },
    {
      name: 'list.make',
      description: 'return a fixed list',
      execute: () => ['x', 'y'],
    },
    {
      name: 'wrap',
      description: 'wrap item',
      execute: (args) => ({ wrapped: args.value as JsonValue }),
    },
    {
      name: 'slow',
      description: 'sleep then return',
      execute: async (_args, signal) => {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 200);
          signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(signal.reason ?? new Error('aborted'));
          });
        });
        return 'done';
      },
    },
  ]);
}

describe('engine expression coverage (B5)', () => {
  it('runs a linear chain', async () => {
    const { sink, events } = createMemorySink();
    const result = await executeWorkflow(
      {
        version: '1',
        nodes: [
          { id: 'a', tool: 'echo', input: { value: 'one' } },
          { id: 'b', tool: 'echo', input: { value: '{{nodes.a.output}}' }, dependsOn: ['a'] },
        ],
      },
      { tools: echoTools(), sink }
    );
    expect(result.nodes.map((n) => n.status)).toEqual(['completed', 'completed']);
    expect(result.output).toBe('one');
    expect(events.some((e) => e.eventType === 'workflow-graph')).toBe(true);
    const startA = events.find((e) => e.eventType === 'workflow-node-start');
    expect(startA?.payload).toMatchObject({ nodeId: 'a', tool: 'echo', input: { value: 'one' } });
  });

  it('inherits a file path from the search node when read_file omits it', async () => {
    const tools = createToolInvoker([
      {
        name: 'coding-tools__search_text',
        description: 'search',
        execute: () => ({ query: 'chooseLane', path: 'src/router.ts', matches: [] }),
      },
      {
        name: 'coding-tools__read_file',
        description: 'read',
        execute: (args) => ({ path: String(args.path), content: 'ok' }),
      },
    ]);
    const result = await executeWorkflow(
      {
        version: '1',
        nodes: [
          { id: 'search', tool: 'coding-tools__search_text', input: { query: 'chooseLane' } },
          { id: 'read', tool: 'coding-tools__read_file', dependsOn: ['search'] },
        ],
      },
      { tools }
    );
    expect(result.nodes.map((n) => n.status)).toEqual(['completed', 'completed']);
    expect(result.output).toMatchObject({ path: 'src/router.ts', content: 'ok' });
  });

  it('inherits a file path for the DSH native read tool', async () => {
    const tools = createToolInvoker([
      {
        name: 'grep',
        description: 'search',
        execute: () => ({ path: 'src/router.ts', matches: [] }),
      },
      {
        name: 'read',
        description: 'read',
        execute: (args) => ({ path: String(args.path), lines: [{ number: 1, text: 'ok' }] }),
      },
    ]);
    const result = await executeWorkflow(
      {
        version: '1',
        nodes: [
          { id: 'search', tool: 'grep', input: { pattern: 'chooseLane' } },
          { id: 'doc', tool: 'read', dependsOn: ['search'] },
        ],
      },
      { tools }
    );
    expect(result.output).toMatchObject({ path: 'src/router.ts' });
  });

  it('runs independent nodes in one wave (parallel)', async () => {
    let inflight = 0;
    let maxInflight = 0;
    const tools = createToolInvoker([
      {
        name: 'tick',
        description: 'record overlap',
        execute: async (args) => {
          inflight += 1;
          maxInflight = Math.max(maxInflight, inflight);
          await new Promise((r) => setTimeout(r, 40));
          inflight -= 1;
          return args.id as JsonValue;
        },
      },
    ]);
    const result = await executeWorkflow(
      {
        version: '1',
        nodes: [
          { id: 'a', tool: 'tick', input: { id: 'a' } },
          { id: 'b', tool: 'tick', input: { id: 'b' } },
        ],
      },
      { tools }
    );
    expect(result.nodes.every((n) => n.status === 'completed')).toBe(true);
    expect(maxInflight).toBe(2);
  });

  it('skips a node when if is false and still finishes dependents', async () => {
    const result = await executeWorkflow(
      {
        version: '1',
        nodes: [
          { id: 'seed', tool: 'echo', input: { value: 0 } },
          {
            id: 'maybe',
            tool: 'echo',
            input: { value: 'nope' },
            dependsOn: ['seed'],
            if: '{{nodes.seed.output}} > 0',
          },
          {
            id: 'after',
            tool: 'echo',
            input: { value: 'ok' },
            dependsOn: ['maybe'],
          },
        ],
      },
      { tools: echoTools() }
    );
    expect(result.nodes.find((n) => n.id === 'maybe')?.status).toBe('skipped');
    expect(result.nodes.find((n) => n.id === 'after')?.status).toBe('completed');
  });

  it('expands foreach and passes item into input', async () => {
    const result = await executeWorkflow(
      {
        version: '1',
        nodes: [
          { id: 'seed', tool: 'list.make' },
          {
            id: 'each',
            tool: 'wrap',
            foreach: '{{nodes.seed.output}}',
            input: { value: '{{item}}' },
            dependsOn: ['seed'],
          },
        ],
      },
      { tools: echoTools() }
    );
    expect(result.output).toEqual([{ wrapped: 'x' }, { wrapped: 'y' }]);
    expect(result.nodes.find((n) => n.id === 'each')?.iterations).toBe(2);
  });

  it('emits foreach iterations on workflow-node-end', async () => {
    const { sink, events } = createMemorySink();
    await executeWorkflow(
      {
        version: '1',
        nodes: [
          { id: 'seed', tool: 'list.make' },
          {
            id: 'each',
            tool: 'wrap',
            foreach: '{{nodes.seed.output}}',
            input: { value: '{{item}}' },
            dependsOn: ['seed'],
          },
        ],
      },
      { tools: echoTools(), sink }
    );
    const end = events.find(
      (event) =>
        event.eventType === 'workflow-node-end' &&
        event.payload &&
        typeof event.payload === 'object' &&
        'nodeId' in event.payload &&
        (event.payload as { nodeId?: string }).nodeId === 'each'
    );
    expect(end?.payload).toMatchObject({ nodeId: 'each', status: 'completed', iterations: 2 });
    expect(events.some((event) => event.eventType === 'workflow-foreach')).toBe(true);
    expect(
      events.filter(
        (event) =>
          event.eventType === 'workflow-foreach-item' &&
          event.payload &&
          (event.payload as { status?: string }).status === 'running'
      )
    ).toHaveLength(2);
  });

  it('runs foreach items in parallel and keeps input order', async () => {
    let inflight = 0;
    let maxInflight = 0;
    const tools = createToolInvoker([
      {
        name: 'list.make',
        description: 'three items',
        execute: () => ['a', 'b', 'c'],
      },
      {
        name: 'tick',
        description: 'record overlap',
        execute: async (args) => {
          inflight += 1;
          maxInflight = Math.max(maxInflight, inflight);
          await new Promise((r) => setTimeout(r, 40));
          inflight -= 1;
          return args.value as JsonValue;
        },
      },
    ]);
    const result = await executeWorkflow(
      {
        version: '1',
        nodes: [
          { id: 'seed', tool: 'list.make' },
          {
            id: 'each',
            tool: 'tick',
            foreach: '{{nodes.seed.output}}',
            input: { value: '{{item}}' },
            dependsOn: ['seed'],
          },
        ],
      },
      { tools }
    );
    expect(maxInflight).toBe(3);
    expect(result.output).toEqual(['a', 'b', 'c']);
  });

  it('keeps successful foreach items when one iteration fails', async () => {
    const tools = createToolInvoker([
      {
        name: 'list.make',
        description: 'urls',
        execute: () => [
          { url: 'https://ok.example/a' },
          { url: 'https://bad.example/b' },
          { url: 'https://ok.example/c' },
        ],
      },
      {
        name: 'http.fetch',
        description: 'fetch or throw',
        execute: (args) => {
          const url = String(args.url ?? '');
          if (url.includes('bad.example')) {
            throw new TypeError('fetch failed');
          }
          return { url, status: 200, content: 'ok' };
        },
      },
    ]);
    const result = await executeWorkflow(
      {
        version: '1',
        nodes: [
          { id: 'seed', tool: 'list.make' },
          {
            id: 'fetch',
            tool: 'http.fetch',
            foreach: '{{nodes.seed.output}}',
            input: { url: '{{item.url}}' },
            dependsOn: ['seed'],
          },
        ],
      },
      { tools }
    );
    expect(result.nodes.find((n) => n.id === 'fetch')?.status).toBe('completed');
    expect(result.output).toEqual([
      { url: 'https://ok.example/a', status: 200, content: 'ok' },
      { url: 'https://bad.example/b', error: 'fetch failed', skipped: true },
      { url: 'https://ok.example/c', status: 200, content: 'ok' },
    ]);
  });

  it('fails a foreach node on a fatal item while retaining partial output and blocking dependents', async () => {
    let downstreamCalls = 0;
    const tools = createToolInvoker([
      {
        name: 'list.make',
        description: 'protected inputs',
        execute: () => ['ok', 'degraded'],
      },
      {
        name: 'ao04_read_status',
        description: 'protected status',
        execute: (args) => {
          if (args.value === 'degraded') {
            throw new WorkflowError(
              'protected_tool_failed',
              'status degraded',
              undefined,
              undefined,
              {
                fatal: true,
                details: { status: 'degraded', evidenceRefs: ['incident-1'] },
              }
            );
          }
          return { status: 'ok', data: { ready: true } };
        },
      },
      {
        name: 'downstream',
        description: 'must not run',
        execute: () => {
          downstreamCalls += 1;
          return 'should not run';
        },
      },
    ]);

    await expect(
      executeWorkflow(
        {
          version: '1',
          nodes: [
            { id: 'seed', tool: 'list.make' },
            {
              id: 'protected',
              tool: 'ao04_read_status',
              foreach: '{{nodes.seed.output}}',
              input: { value: '{{item}}' },
              dependsOn: ['seed'],
            },
            { id: 'after', tool: 'downstream', dependsOn: ['protected'] },
          ],
        },
        { tools }
      )
    ).rejects.toMatchObject({
      code: 'protected_tool_failed',
      fatal: true,
      nodeId: 'protected',
    });

    expect(downstreamCalls).toBe(0);
    const events: Array<{ eventType: string; payload: unknown }> = [];
    try {
      await executeWorkflow(
        {
          version: '1',
          nodes: [
            { id: 'seed', tool: 'list.make' },
            {
              id: 'protected',
              tool: 'ao04_read_status',
              foreach: '{{nodes.seed.output}}',
              input: { value: '{{item}}' },
              dependsOn: ['seed'],
            },
            { id: 'after', tool: 'downstream', dependsOn: ['protected'] },
          ],
        },
        {
          tools,
          sink: {
            emit: (event) => {
              events.push(event);
            },
          },
        }
      );
    } catch (err) {
      const error = err as WorkflowError;
      const protectedNode = error.nodes?.find((node) => node.id === 'protected');
      expect(protectedNode?.status).toBe('failed');
      expect(protectedNode?.output).toEqual([
        { status: 'ok', data: { ready: true } },
        { skipped: true, error: 'status degraded' },
      ]);
      expect(error.details).toMatchObject({ status: 'degraded' });
      expect(error.nodes?.find((node) => node.id === 'after')?.status).toBe('skipped');
      expect(events).toContainEqual({
        eventType: 'workflow-node-end',
        payload: expect.objectContaining({
          nodeId: 'after',
          status: 'skipped',
          reason: 'upstream_failed',
        }),
      });
    }
  });
});

describe('guards and failure isolation (B6)', () => {
  it('fails with nodeId when maxSteps is exceeded', async () => {
    await expect(
      executeWorkflow(
        {
          version: '1',
          nodes: [
            { id: 'a', tool: 'echo', input: { value: 1 } },
            { id: 'b', tool: 'echo', input: { value: 2 }, dependsOn: ['a'] },
          ],
        },
        { tools: echoTools(), guards: { maxSteps: 1 } }
      )
    ).rejects.toMatchObject({ code: 'guard_max_steps', nodeId: 'b' });
  });

  it('fails with nodeId when foreach exceeds maxLoop', async () => {
    await expect(
      executeWorkflow(
        {
          version: '1',
          nodes: [
            { id: 'seed', tool: 'list.make' },
            {
              id: 'each',
              tool: 'wrap',
              foreach: '{{nodes.seed.output}}',
              input: { value: '{{item}}' },
              dependsOn: ['seed'],
            },
          ],
        },
        { tools: echoTools(), guards: { maxLoop: 1 } }
      )
    ).rejects.toMatchObject({ code: 'guard_max_loop', nodeId: 'each' });
  });

  it('times out a slow node without throwing an uncaught error', async () => {
    await expect(
      executeWorkflow(
        { version: '1', nodes: [{ id: 'slowNode', tool: 'slow' }] },
        { tools: echoTools(), guards: { nodeTimeoutMs: 20 } }
      )
    ).rejects.toBeInstanceOf(WorkflowError);
    try {
      await executeWorkflow(
        { version: '1', nodes: [{ id: 'slowNode', tool: 'slow' }] },
        { tools: echoTools(), guards: { nodeTimeoutMs: 20 } }
      );
    } catch (err) {
      expect(err).toMatchObject({ code: 'guard_timeout', nodeId: 'slowNode' });
    }
  });

  it('keeps completed sibling nodes on the error when one parallel node fails', async () => {
    const tools = createToolInvoker([
      {
        name: 'ok',
        description: 'ok',
        execute: (args) => ({ url: args.url as string, body: 'ok' }),
      },
      {
        name: 'boom',
        description: 'fail',
        execute: () => {
          throw new Error('fetch timeout');
        },
      },
    ]);
    try {
      await executeWorkflow(
        {
          version: '1',
          name: 'three_pages',
          nodes: [
            { id: 'a', tool: 'ok', input: { url: 'https://a.example' } },
            { id: 'b', tool: 'ok', input: { url: 'https://b.example' } },
            { id: 'c', tool: 'boom', input: { url: 'https://c.example' } },
          ],
        },
        { tools }
      );
      throw new Error('expected failure');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowError);
      const nodes = (err as WorkflowError).nodes ?? [];
      expect(nodes.filter((node) => node.status === 'completed')).toHaveLength(2);
      expect(nodes.find((node) => node.id === 'c')?.status).toBe('failed');
      expect(nodes.find((node) => node.id === 'c')?.error).toMatch(/timeout/);
    }
  });
});
// AIGC END
