import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

vi.mock('ai', () => ({
  streamText: vi.fn(),
}));
vi.mock('ai-sdk-provider-claude-code', () => ({
  claudeCode: vi.fn(() => 'mock-model'),
}));
vi.mock('@hono/node-server', () => ({
  serve: vi.fn(),
}));
vi.mock('@open-rush/agent-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@open-rush/agent-runtime')>();
  return {
    ...actual,
    runDshToUIMessageStream: vi.fn(
      () => new Response('dsh-ok', { headers: { 'x-openrush-runtime': 'dsh' } })
    ),
  };
});
vi.mock('../amap-mcp.js', () => ({
  tryConnectAmapFromEnv: vi.fn(async () => null),
  amapMcpUrl: (key: string) => `https://mcp.amap.com/mcp?key=${encodeURIComponent(key)}`,
}));
vi.mock('../coding-mcp.js', () => ({
  tryConnectCodingTools: vi.fn(async () => null),
  codingToolsEnabled: () => false,
  resolveWorkflowWorkspace: () => '/resolved/open-rush',
}));
vi.mock('../ao04-experiment.js', () => ({
  ensureAo04Experiment: vi.fn(async () => ({ experimentId: 'exp-1', status: 'ready' })),
  cancelAo04Experiment: vi.fn(async () => undefined),
  releaseAo04Experiment: vi.fn(async () => undefined),
}));
vi.mock('@open-rush/workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@open-rush/workflow')>();
  return {
    ...actual,
    llmCompleteFromEnv: vi.fn(() => undefined),
    workflowRun: vi.fn(
      async (input: { sink?: { emit: (event: unknown) => Promise<void> | void } }) => {
        const events: Array<{ eventType: string; payload: unknown }> = [];
        const emit = async (event: { eventType: string; payload: unknown }) => {
          events.push(event);
          await input?.sink?.emit(event);
        };
        await emit({
          eventType: 'workflow-planning',
          payload: { intent: 'demo', via: 'llm' },
        });
        await emit({
          eventType: 'workflow-graph',
          payload: {
            name: 'gather',
            nodes: [{ id: 'fetch_a', tool: 'http.fetch', dependsOn: [] }],
            edges: [],
            waves: [['fetch_a']],
          },
        });
        await emit({
          eventType: 'workflow-node-start',
          payload: { nodeId: 'fetch_a', tool: 'http.fetch' },
        });
        await emit({
          eventType: 'workflow-node-end',
          payload: { nodeId: 'fetch_a', status: 'completed', durationMs: 12 },
        });
        return {
          ok: true,
          degraded: false,
          output: '周末可以先去上海博物馆，常设展免费，建议提前预约。',
          rounds: 1,
          events,
        };
      }
    ),
  };
});

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDshToUIMessageStream } from '@open-rush/agent-runtime';
import { workflowRun } from '@open-rush/workflow';
import { streamText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { cancelAo04Experiment, releaseAo04Experiment } from '../ao04-experiment.js';
import app from '../server.js';

// Helper to parse JSON response body
async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

describe('agent-worker server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AO04_DEMO;
    delete process.env.AO04_SERVICE_DEMO;
  });

  // ---------------------------------------------------------------
  // GET /health
  // ---------------------------------------------------------------
  describe('GET /health', () => {
    it('returns 200 with status ok, service name, activeRuns count, and timestamp', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.status).toBe('ok');
      expect(body.service).toBe('agent-worker');
      expect(typeof body.activeRuns).toBe('number');
      expect(body.timestamp).toBeDefined();
      // timestamp should be a valid ISO string
      expect(Number.isNaN(Date.parse(body.timestamp as string))).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // GET /status
  // ---------------------------------------------------------------
  describe('GET /status', () => {
    it('returns 200 with ready true and activeRuns count', async () => {
      const res = await app.request('/status');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.ready).toBe(true);
      expect(typeof body.activeRuns).toBe('number');
    });
  });

  // ---------------------------------------------------------------
  // POST /prompt
  // ---------------------------------------------------------------
  describe('POST /prompt', () => {
    function postPrompt(payload: Record<string, unknown>) {
      return app.request('/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    function mockStreamTextSuccess() {
      const mockResult = {
        toUIMessageStreamResponse: vi.fn(() => new Response('streamed text')),
        response: Promise.resolve({}),
      };
      (streamText as Mock).mockReturnValue(mockResult);
      return mockResult;
    }

    it('returns 400 when neither prompt nor messages is provided', async () => {
      const res = await postPrompt({});
      expect(res.status).toBe(400);

      const body = await json(res);
      expect(body.error).toBe('prompt is required');
    });

    it('returns 400 when messages array has no user messages', async () => {
      const res = await postPrompt({
        messages: [
          { role: 'assistant', content: 'hello' },
          { role: 'system', content: 'you are helpful' },
        ],
      });
      expect(res.status).toBe(400);

      const body = await json(res);
      expect(body.error).toBe('prompt is required');
    });

    it('returns 400 when messages is an empty array', async () => {
      const res = await postPrompt({ messages: [] });
      expect(res.status).toBe(400);

      const body = await json(res);
      expect(body.error).toBe('prompt is required');
    });

    it('calls streamText with the correct prompt when prompt string is provided', async () => {
      const mockResult = mockStreamTextSuccess();

      const res = await postPrompt({ prompt: 'write hello world' });
      expect(res.status).toBe(200);

      expect(streamText).toHaveBeenCalledOnce();
      const callArgs = (streamText as Mock).mock.calls[0][0];
      expect(callArgs.prompt).toBe('write hello world');
      expect(callArgs.model).toBe('mock-model');
      expect(callArgs.abortSignal).toBeInstanceOf(AbortSignal);
      expect(mockResult.toUIMessageStreamResponse).toHaveBeenCalledOnce();
    });

    it('uses DeepSeek Harness when body.runtime is dsh', async () => {
      const res = await postPrompt({ prompt: 'hello', runtime: 'dsh' });
      expect(res.status).toBe(200);
      expect(runDshToUIMessageStream).toHaveBeenCalledOnce();
      expect(streamText).not.toHaveBeenCalled();
      expect((runDshToUIMessageStream as Mock).mock.calls[0][0]).toMatchObject({
        prompt: 'hello',
      });
    });

    it('extracts the last user message from messages array', async () => {
      mockStreamTextSuccess();

      const res = await postPrompt({
        messages: [
          { role: 'user', content: 'first question' },
          { role: 'assistant', content: 'answer' },
          { role: 'user', content: 'follow up' },
        ],
      });
      expect(res.status).toBe(200);

      const callArgs = (streamText as Mock).mock.calls[0][0];
      expect(callArgs.prompt).toBe('follow up');
    });

    it('prompt takes precedence over messages when both are provided', async () => {
      mockStreamTextSuccess();

      const res = await postPrompt({
        prompt: 'direct prompt',
        messages: [{ role: 'user', content: 'from messages' }],
      });
      expect(res.status).toBe(200);

      const callArgs = (streamText as Mock).mock.calls[0][0];
      expect(callArgs.prompt).toBe('direct prompt');
    });

    it('passes systemPrompt as system option to streamText', async () => {
      mockStreamTextSuccess();

      await postPrompt({
        prompt: 'hello',
        systemPrompt: 'you are a coding assistant',
      });

      const callArgs = (streamText as Mock).mock.calls[0][0];
      expect(callArgs.system).toBe('you are a coding assistant');
    });

    it('does not include system option when systemPrompt is not provided', async () => {
      mockStreamTextSuccess();

      await postPrompt({ prompt: 'hello' });

      const callArgs = (streamText as Mock).mock.calls[0][0];
      expect(callArgs.system).toBeUndefined();
    });

    it('passes custom modelId to claudeCode provider', async () => {
      mockStreamTextSuccess();

      await postPrompt({ prompt: 'hello', modelId: 'opus' });

      expect(claudeCode).toHaveBeenCalledWith(
        'opus',
        expect.objectContaining({ permissionMode: 'bypassPermissions' })
      );
    });

    it('defaults modelId to sonnet when ANTHROPIC_MODEL env is not set', async () => {
      mockStreamTextSuccess();
      const original = {
        ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
        CLAUDE_MODEL: process.env.CLAUDE_MODEL,
        DSH_MODEL: process.env.DSH_MODEL,
      };
      delete process.env.ANTHROPIC_MODEL;
      delete process.env.CLAUDE_MODEL;
      delete process.env.DSH_MODEL;

      await postPrompt({ prompt: 'hello', runtime: 'claude-code' });

      expect(claudeCode).toHaveBeenCalledWith(
        'sonnet',
        expect.objectContaining({ permissionMode: 'bypassPermissions' })
      );

      if (original.ANTHROPIC_MODEL !== undefined)
        process.env.ANTHROPIC_MODEL = original.ANTHROPIC_MODEL;
      if (original.CLAUDE_MODEL !== undefined) process.env.CLAUDE_MODEL = original.CLAUDE_MODEL;
      if (original.DSH_MODEL !== undefined) process.env.DSH_MODEL = original.DSH_MODEL;
    });

    it('does not send DSH_MODEL to Claude Code when runtime is claude-code', async () => {
      mockStreamTextSuccess();
      const original = process.env.DSH_MODEL;
      process.env.DSH_MODEL = 'DeepSeek-V4-Flash-INT8';

      await postPrompt({ prompt: 'hello', runtime: 'claude-code' });

      expect(claudeCode).toHaveBeenCalledWith(
        'sonnet',
        expect.objectContaining({ permissionMode: 'bypassPermissions' })
      );

      if (original !== undefined) process.env.DSH_MODEL = original;
      else delete process.env.DSH_MODEL;
    });

    it('passes maxTurns to claudeCode provider (defaults to 30)', async () => {
      mockStreamTextSuccess();

      await postPrompt({ prompt: 'hello' });
      expect(claudeCode).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxTurns: 30 })
      );
    });

    it('passes custom maxTurns to claudeCode provider', async () => {
      mockStreamTextSuccess();

      await postPrompt({ prompt: 'hello', maxTurns: 10 });
      expect(claudeCode).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ maxTurns: 10 })
      );
    });

    it('passes allowedTools to claudeCode when provided', async () => {
      mockStreamTextSuccess();

      await postPrompt({ prompt: 'hello', allowedTools: ['Bash', 'Read'] });
      expect(claudeCode).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ allowedTools: ['Bash', 'Read'] })
      );
    });

    it('passes custom sessionId to claudeCode provider', async () => {
      mockStreamTextSuccess();

      await postPrompt({ prompt: 'hello', sessionId: 'my-session-123' });
      expect(claudeCode).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ sessionId: 'my-session-123' })
      );
    });

    it('returns 500 with error message when streamText throws', async () => {
      (streamText as Mock).mockImplementation(() => {
        throw new Error('model unavailable');
      });

      const res = await postPrompt({ prompt: 'hello' });
      expect(res.status).toBe(500);

      const body = await json(res);
      expect(body.error).toBe('model unavailable');
    });

    it('returns 500 with stringified error when streamText throws a non-Error', async () => {
      (streamText as Mock).mockImplementation(() => {
        throw 'something went wrong';
      });

      const res = await postPrompt({ prompt: 'hello' });
      expect(res.status).toBe(500);

      const body = await json(res);
      expect(body.error).toBe('something went wrong');
    });

    it('keeps vague travel prompts on DSH so the model can ask the city', async () => {
      const res = await postPrompt({
        prompt: '我周六想带全家出去玩，帮我推荐附近好玩的地方',
        runtime: 'dsh',
      });
      expect(res.status).toBe(200);
      expect(workflowRun).not.toHaveBeenCalled();
      expect(runDshToUIMessageStream).toHaveBeenCalled();
    });

    it('keeps the current turn on DSH when history contains search hints', async () => {
      const res = await postPrompt({
        prompt:
          '此前对话：\n\nUser: 帮我搜一下杭州周末去处\n\nAssistant: 可以去西湖\n\nUser: 帮我看看这段 TypeScript 报错',
        runtime: 'dsh',
      });
      expect(res.status).toBe(200);
      expect(workflowRun).not.toHaveBeenCalled();
      expect(runDshToUIMessageStream).toHaveBeenCalled();
    });

    it('sends gather prompts to DSH so the model can call workflow_run', async () => {
      const res = await postPrompt({
        prompt: '总结 https://example.com/a 和 https://example.com/b 写成一篇摘要',
        runtime: 'dsh',
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('x-openrush-runtime')).toBe('dsh');
      expect(workflowRun).not.toHaveBeenCalled();
      expect(runDshToUIMessageStream).toHaveBeenCalled();
      expect((runDshToUIMessageStream as Mock).mock.calls.at(-1)?.[0]).toMatchObject({
        systemPrompt: expect.stringMatching(/workflow_run/),
        env: expect.objectContaining({
          OPENRUSH_WORKFLOW_RUN_URL: expect.stringContaining('/workflow-run'),
        }),
      });
    });

    it('keeps DSH tools inside the selected project workspace', async () => {
      const res = await postPrompt({
        prompt: '列出 apps/agent-worker/dsh/ 目录里有哪些文件',
        runtime: 'dsh',
        projectId: 'proj-sandbox',
      });
      expect(res.status).toBe(200);
      expect((runDshToUIMessageStream as Mock).mock.calls.at(-1)?.[0]).toMatchObject({
        cwd: expect.stringMatching(/workspace\/proj-sandbox$/),
        env: expect.objectContaining({
          WORKFLOW_WORKSPACE: expect.stringMatching(/workspace\/proj-sandbox$/),
        }),
      });
    });

    it('does not advertise workflow_run for a custom DSH composition without the plugin', async () => {
      const previous = process.env.DSH_CORDIS_CONFIG;
      process.env.DSH_CORDIS_CONFIG = '/tmp/custom-cordis.yml';
      try {
        const res = await postPrompt({
          prompt: 'hello',
          runtime: 'dsh',
          systemPrompt: 'custom runtime',
        });
        expect(res.status).toBe(200);
        expect((runDshToUIMessageStream as Mock).mock.calls.at(-1)?.[0]).toMatchObject({
          systemPrompt: 'custom runtime',
        });
      } finally {
        if (previous === undefined) delete process.env.DSH_CORDIS_CONFIG;
        else process.env.DSH_CORDIS_CONFIG = previous;
      }
    });

    it('forwards Amap and Keenable keys into the DSH child', async () => {
      const previous = {
        amap: process.env.AMAP_MAPS_API_KEY,
        keen: process.env.KEENABLE_API_KEY,
        keenUrl: process.env.KEENABLE_API_URL,
        keenBase: process.env.KEENABLE_BASE_URL,
      };
      process.env.AMAP_MAPS_API_KEY = 'amap_test_key';
      process.env.KEENABLE_API_KEY = 'keen_test_key';
      delete process.env.KEENABLE_API_URL;
      delete process.env.KEENABLE_BASE_URL;
      try {
        const res = await postPrompt({ prompt: 'hello', runtime: 'dsh' });
        expect(res.status).toBe(200);
        expect((runDshToUIMessageStream as Mock).mock.calls.at(-1)?.[0]).toMatchObject({
          env: expect.objectContaining({
            AMAP_MAPS_API_KEY: 'amap_test_key',
            KEENABLE_API_KEY: 'keen_test_key',
            KEENABLE_API_URL: 'https://api.keenable.ai',
            KEENABLE_BASE_URL: 'https://api.keenable.ai',
          }),
        });
      } finally {
        if (previous.amap === undefined) delete process.env.AMAP_MAPS_API_KEY;
        else process.env.AMAP_MAPS_API_KEY = previous.amap;
        if (previous.keen === undefined) delete process.env.KEENABLE_API_KEY;
        else process.env.KEENABLE_API_KEY = previous.keen;
        if (previous.keenUrl === undefined) delete process.env.KEENABLE_API_URL;
        else process.env.KEENABLE_API_URL = previous.keenUrl;
        if (previous.keenBase === undefined) delete process.env.KEENABLE_BASE_URL;
        else process.env.KEENABLE_BASE_URL = previous.keenBase;
      }
    });
  });

  // ---------------------------------------------------------------
  // POST /abort
  // ---------------------------------------------------------------
  describe('POST /abort', () => {
    function postAbort(payload: Record<string, unknown>) {
      return app.request('/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    function postPrompt(payload: Record<string, unknown>) {
      return app.request('/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    it('returns 400 when sessionId is missing', async () => {
      const res = await postAbort({});
      expect(res.status).toBe(400);

      const body = await json(res);
      expect(body.error).toBe('sessionId is required');
    });

    it('returns 404 when sessionId is not found in active sessions', async () => {
      const res = await postAbort({ sessionId: 'nonexistent-session' });
      expect(res.status).toBe(404);

      const body = await json(res);
      expect(body.aborted).toBe(false);
      expect(body.reason).toBe('session not found');
    });

    it('aborts an active session created by /prompt (round-trip)', async () => {
      // Mock streamText to return a result whose response never resolves,
      // keeping the session in activeSessions
      const mockResult = {
        toUIMessageStreamResponse: vi.fn(() => new Response('stream')),
        response: new Promise(() => {}), // never resolves
      };
      (streamText as Mock).mockReturnValue(mockResult);

      const sessionId = 'session-to-abort';

      // Create the session via /prompt
      const promptRes = await postPrompt({ prompt: 'hello', sessionId });
      expect(promptRes.status).toBe(200);

      // Verify the session is now tracked (activeRuns should be >= 1)
      const statusRes = await app.request('/health');
      const statusBody = await json(statusRes);
      expect(statusBody.activeRuns).toBeGreaterThanOrEqual(1);

      // Abort the session
      const abortRes = await postAbort({ sessionId });
      expect(abortRes.status).toBe(200);

      const abortBody = await json(abortRes);
      expect(abortBody.aborted).toBe(true);

      // After abort, the session should be removed — trying to abort again yields 404
      const abortAgainRes = await postAbort({ sessionId });
      expect(abortAgainRes.status).toBe(404);
    });

    it('keeps the first run abortable when a second run is rejected as session_busy', async () => {
      // AIGC START
      const prevDemo = process.env.AO04_DEMO;
      const prevBind = process.env.AO04_BIND_DIR;
      const prevToken = process.env.AO04_CONTROL_TOKEN;
      process.env.AO04_DEMO = '1';
      process.env.AO04_CONTROL_TOKEN = 'secret';
      process.env.AO04_BIND_DIR = mkdtempSync(join(tmpdir(), 'ao04-bind-'));
      try {
        const mockResult = {
          toUIMessageStreamResponse: vi.fn(() => new Response('stream')),
          response: new Promise(() => {}),
        };
        (streamText as Mock).mockReturnValue(mockResult);
        const sessionId = 'busy-session-keep-abort';
        const first = await postPrompt({
          prompt: 'hello',
          sessionId,
          env: { OPENRUSH_RUN_ID: 'run-1' },
        });
        expect(first.status).toBe(200);
        const second = await postPrompt({
          prompt: 'hello again',
          sessionId,
          env: { OPENRUSH_RUN_ID: 'run-2' },
        });
        expect(second.status).toBe(409);
        const abortRes = await postAbort({ sessionId });
        expect(abortRes.status).toBe(200);
        expect((await json(abortRes)).aborted).toBe(true);
        expect(cancelAo04Experiment).toHaveBeenCalled();
      } finally {
        if (prevDemo === undefined) delete process.env.AO04_DEMO;
        else process.env.AO04_DEMO = prevDemo;
        if (prevBind === undefined) delete process.env.AO04_BIND_DIR;
        else process.env.AO04_BIND_DIR = prevBind;
        if (prevToken === undefined) delete process.env.AO04_CONTROL_TOKEN;
        else process.env.AO04_CONTROL_TOKEN = prevToken;
      }
      // AIGC END
    });

    it('finishes a DSH response only after the fixed service lease is released', async () => {
      const prevDemo = process.env.AO04_DEMO;
      const prevServiceDemo = process.env.AO04_SERVICE_DEMO;
      const prevBind = process.env.AO04_BIND_DIR;
      const prevToken = process.env.AO04_CONTROL_TOKEN;
      const prevWorkspace = process.env.WORKSPACE_PATH;
      process.env.AO04_DEMO = '1';
      process.env.AO04_SERVICE_DEMO = '1';
      process.env.AO04_CONTROL_TOKEN = 'secret';
      process.env.AO04_BIND_DIR = mkdtempSync(join(tmpdir(), 'ao04-bind-release-'));
      const demoWorkspace = mkdtempSync(join(tmpdir(), 'ao04-workspace-'));
      process.env.WORKSPACE_PATH = demoWorkspace;
      let finishRelease: (() => void) | undefined;
      (releaseAo04Experiment as Mock).mockImplementation(
        () => new Promise<void>((resolve) => (finishRelease = resolve))
      );
      try {
        const response = await postPrompt({
          prompt: 'check protected service',
          runtime: 'dsh',
          sessionId: 'fixed-service-session',
          env: { OPENRUSH_RUN_ID: 'fixed-service-run' },
        });
        let bodyFinished = false;
        const body = response.text().then((value) => {
          bodyFinished = true;
          return value;
        });
        await vi.waitFor(() =>
          expect(releaseAo04Experiment).toHaveBeenCalledWith(
            expect.objectContaining({
              experimentId: 'ao04-demo-local',
              runId: 'fixed-service-run',
            })
          )
        );
        expect(bodyFinished).toBe(false);
        finishRelease?.();
        await expect(body).resolves.toBe('dsh-ok');
        expect(runDshToUIMessageStream).toHaveBeenCalledWith(
          expect.objectContaining({ cwd: demoWorkspace })
        );
      } finally {
        if (prevDemo === undefined) delete process.env.AO04_DEMO;
        else process.env.AO04_DEMO = prevDemo;
        if (prevServiceDemo === undefined) delete process.env.AO04_SERVICE_DEMO;
        else process.env.AO04_SERVICE_DEMO = prevServiceDemo;
        if (prevBind === undefined) delete process.env.AO04_BIND_DIR;
        else process.env.AO04_BIND_DIR = prevBind;
        if (prevToken === undefined) delete process.env.AO04_CONTROL_TOKEN;
        else process.env.AO04_CONTROL_TOKEN = prevToken;
        if (prevWorkspace === undefined) delete process.env.WORKSPACE_PATH;
        else process.env.WORKSPACE_PATH = prevWorkspace;
      }
    });
  });

  // ---------------------------------------------------------------
  // 404 for unknown routes
  // ---------------------------------------------------------------
  describe('unknown routes', () => {
    it('returns 404 for unregistered paths', async () => {
      const res = await app.request('/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------
  // task-10 single-writer contract: agent-worker must NOT persist
  // run_events directly. It forwards the AI SDK UIMessageChunk stream
  // via SSE①; control-worker owns seq allocation and DB writes (see
  // .claude/plans/managed-agents-p0-p1.md §7.3 and
  // specs/managed-agents-api.md §事件写入单写者模型).
  // -----------------------------------------------------------------
  describe('single-writer contract (task-10)', () => {
    it('delegates stream emission to AI SDK toUIMessageStreamResponse', async () => {
      const mockResult = {
        toUIMessageStreamResponse: vi.fn(
          () =>
            new Response('data: {"type":"start","messageId":"m1"}\n\n', {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            })
        ),
        response: Promise.resolve({}),
      };
      (streamText as Mock).mockReturnValue(mockResult);

      const res = await app.request('/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'hello' }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      // Must be the SDK response (identity), not re-framed.
      expect(mockResult.toUIMessageStreamResponse).toHaveBeenCalledOnce();
    });

    it('exposes the Hono app without importing the control-plane EventStore', async () => {
      // Guard against regressions: the agent-worker package depends only on
      // '@open-rush/contracts' and '@open-rush/agent-runtime' — importing
      // the control-plane EventStore here would violate the single-writer
      // contract. The dependency is enforced at package.json level; this
      // test documents the intent and smoke-checks the module loads.
      const moduleSpec = await import('../server.js');
      expect(moduleSpec.default).toBeDefined();
    });
  });

  // -----------------------------------------------------------------
  // AI SDK 6 UIMessageChunk coverage — the contracts layer defines
  // the canonical list in `packages/contracts/src/enums.ts`
  // (`UIMessageChunkType`). The worker emits whatever the SDK produces,
  // so we only assert that representative chunks of each family survive
  // the pipeline when written to the response body.
  // -----------------------------------------------------------------
  describe('UIMessageChunk family coverage (task-10)', () => {
    // The 16 canonical chunk types defined in
    // `packages/contracts/src/enums.ts::UIMessageChunkType`. If this list
    // drifts from enums.ts, contracts tests will flag it separately.
    const CANONICAL_CHUNK_TYPES = [
      'text-start',
      'text-delta',
      'text-end',
      'reasoning-start',
      'reasoning-delta',
      'reasoning-end',
      'tool-input-start',
      'tool-input-delta',
      'tool-input-available',
      'tool-output-available',
      'tool-output-error',
      'start',
      'finish',
      'error',
      'start-step',
      'finish-step',
    ] as const;

    it('passes through every canonical UIMessageChunkType without mutation', async () => {
      const chunks: Array<Record<string, unknown>> = [
        { type: 'start', messageId: 'm1' },
        { type: 'start-step' },
        { type: 'text-start', id: 'm1' },
        { type: 'text-delta', id: 'm1', delta: 'Hi' },
        { type: 'text-end', id: 'm1' },
        { type: 'reasoning-start', id: 'r1' },
        { type: 'reasoning-delta', id: 'r1', delta: 'think...' },
        { type: 'reasoning-end', id: 'r1' },
        { type: 'tool-input-start', toolCallId: 'c1', toolName: 'Read' },
        { type: 'tool-input-delta', toolCallId: 'c1', delta: '{"path":' },
        {
          type: 'tool-input-available',
          toolCallId: 'c1',
          toolName: 'Read',
          input: { path: '/a' },
        },
        { type: 'tool-output-available', toolCallId: 'c1', output: 'content' },
        { type: 'tool-output-error', toolCallId: 'c2', errorText: 'boom' },
        { type: 'error', errorText: 'stream aborted' },
        { type: 'finish-step', reason: 'stop' },
        { type: 'finish', reason: 'stop' },
      ];
      const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('');

      const mockResult = {
        toUIMessageStreamResponse: vi.fn(
          () =>
            new Response(body, {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            })
        ),
        response: Promise.resolve({}),
      };
      (streamText as Mock).mockReturnValue(mockResult);

      const res = await app.request('/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'hello' }),
      });
      const text = await res.text();
      // Every canonical chunk type must survive the pass-through.
      for (const type of CANONICAL_CHUNK_TYPES) {
        expect(text).toContain(`"type":"${type}"`);
      }
    });
  });

  describe('POST /workflow-run', () => {
    it('returns 400 when neither intent nor dsl is provided', async () => {
      const res = await app.request('/workflow-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('executes a travel intent via workflowRun', async () => {
      const res = await app.request('/workflow-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: '我周六想带全家出去玩' }),
      });
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.ok).toBe(true);
      expect(workflowRun).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: '我周六想带全家出去玩',
          allowHeuristic: true,
        })
      );
    });

    it('streams node events when stream=1', async () => {
      const res = await app.request('/workflow-run?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ intent: '我周六想带全家出去玩' }),
      });
      expect(res.headers.get('content-type') ?? '').toContain('text/event-stream');
      const text = await res.text();
      expect(text).toContain('workflow-planning');
      expect(text).toContain('workflow-graph');
      expect(text).toContain('workflow-node-start');
      expect(text).toContain('workflow-result');
    });
  });

  describe('GET /workflow-live', () => {
    it('returns the live DAG page', async () => {
      const res = await app.request('/workflow-live');
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('OpenRush 快车道');
      expect(text).toContain('workflow-graph');
      expect(text).toContain('/workflow-run?stream=1');
      expect(text).toContain('id="intent"');
      expect(text).toContain('disableFallback: true');
      expect(text).toContain('workflow-foreach-item');
      expect(text).toContain('FOREACH_W');
      expect(text).toContain('真实搜索 · 上海亲子攻略');
      expect(text).toContain('官方文档 · TS 5.7 notes');
      expect(text).toContain('双官方文档 · 并行抓取');
      expect(text).toContain('https://pnpm.io/catalogs');
      expect(text).toContain('coding MCP · 介绍仓库');
      expect(text).toContain('coding MCP · 查函数');
      expect(text).toContain('coding MCP · 看 workflow 包');
      expect(text).toContain('coding MCP · git 状态');
      expect(text).toContain('高德 · 步行+天气');
      expect(text).toContain('/workflow-catalog');
      expect(text).toContain('节点详情');
      expect(text).toContain('__start__');
      expect(text).toContain('__end__');
      expect(text).toContain('data-node');
      expect(text).toContain('id="inspect"');
      expect(text).toContain('node-box.terminal.selected');
      expect(text).toContain('followNode("__end__"');
      expect(text).not.toContain('loadGraph');
      const start = text.indexOf('<script>');
      const end = text.indexOf('</script>', start);
      const script = text.slice(start + 8, end);
      expect(start).toBeGreaterThan(0);
      expect(() => new Function(script)).not.toThrow();
    });
  });

  describe('GET /workflow-catalog', () => {
    it('lists platform plus travel mocks when Amap is unavailable', async () => {
      const res = await app.request('/workflow-catalog');
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.amap).toBe(false);
      expect(body.coding).toBe(false);
      expect(body.tools).toEqual(expect.arrayContaining(['web.search', 'geo.locate']));
    });
  });
});
