import { serve } from '@hono/node-server';
import {
  ensureProjectDir,
  getWorkspacePathWithSlash,
  type PromptAgentConfig,
  resolveSystemPrompt,
  validateProjectId,
} from '@lux/prompts';
import {
  parseAgentRuntimeKind,
  resolveAgentRuntime,
  runDshToUIMessageStream,
} from '@open-rush/agent-runtime';
import {
  chooseLane,
  createPlatformToolInvoker,
  createTravelToolInvoker,
  type LlmComplete,
  llmCompleteFromEnv,
  mergeToolInvokers,
  routingIntent,
  type ToolInvoker,
  WEEKEND_TRIP_INTENT,
  weekendTripDsl,
  workflowGraph,
  workflowRun,
} from '@open-rush/workflow';
import { streamText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { Hono } from 'hono';
import { tryConnectAmapFromEnv } from './amap-mcp.js';
import {
  type Ao04Lease,
  bindSessionRun,
  getSessionLease,
  shouldAbortSession,
  unbindSessionRun,
} from './ao04-bind.js';
import { cancelAo04Experiment, ensureAo04Experiment } from './ao04-experiment.js';
import { resolveWorkflowWorkspace, tryConnectCodingTools } from './coding-mcp.js';
import { WORKFLOW_LIVE_HTML } from './workflow-live-page.js';
import { workflowRunToSseResponse } from './workflow-ui-stream.js';

const app = new Hono();

// Track active sessions for abort support
// AIGC START
const activeSessions = new Map<string, { controller: AbortController; runId: string }>();
// AIGC END

// AIGC START
function withStreamCleanup(response: Response, onDone: () => void): Response {
  if (!response.body) {
    onDone();
    return response;
  }
  const body = response.body.pipeThrough(
    new TransformStream({
      flush() {
        onDone();
      },
    })
  );
  return new Response(body, {
    status: response.status,
    headers: response.headers,
  });
}
// AIGC END

// AIGC START
let amapToolsPromise: Promise<ToolInvoker | null> | undefined;
const codingToolsByRoot = new Map<string, Promise<ToolInvoker | null>>();

function getAmapTools(): Promise<ToolInvoker | null> {
  amapToolsPromise ??= tryConnectAmapFromEnv();
  return amapToolsPromise;
}

function getCodingTools(workspace: string): Promise<ToolInvoker | null> {
  const root = resolveWorkflowWorkspace(workspace);
  const cached = codingToolsByRoot.get(root);
  if (cached) return cached;
  const pending = tryConnectCodingTools(root);
  codingToolsByRoot.set(root, pending);
  return pending;
}

async function workflowCatalog(options: {
  root: string;
  complete?: LlmComplete;
  userIntent?: string;
  delayMs?: number;
}): Promise<ToolInvoker> {
  const workspace = resolveWorkflowWorkspace(options.root);
  const platform = createPlatformToolInvoker({
    root: workspace,
    complete: options.complete,
    userIntent: options.userIntent,
  });
  const [amap, coding] = await Promise.all([getAmapTools(), getCodingTools(workspace)]);
  const extras: ToolInvoker[] = [];
  if (amap) extras.push(amap);
  else extras.push(createTravelToolInvoker({ delayMs: options.delayMs }));
  if (coding) extras.push(coding);
  return mergeToolInvokers([platform, ...extras]);
}
// AIGC END

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'agent-worker',
    runtime: resolveAgentRuntime(),
    activeRuns: activeSessions.size,
    timestamp: new Date().toISOString(),
  })
);

app.get('/status', (c) => c.json({ ready: true, activeRuns: activeSessions.size }));

app.post('/prompt', async (c) => {
  const body = await c.req.json();
  const {
    prompt,
    sessionId,
    messages,
    env,
    systemPrompt,
    modelId,
    allowedTools,
    maxTurns,
    projectId,
    agentConfig,
    // AIGC START
    runtime: requestedRuntime,
    // AIGC END
  } = body as {
    prompt?: string;
    sessionId?: string;
    messages?: Array<{ role: string; content: string }>;
    env?: Record<string, string>;
    systemPrompt?: string;
    modelId?: string;
    allowedTools?: string[];
    maxTurns?: number;
    projectId?: string;
    agentConfig?: PromptAgentConfig;
    // AIGC START
    runtime?: string;
    // AIGC END
  };

  // Support both prompt (direct) and messages (AI SDK useChat) formats
  const userPrompt = prompt ?? messages?.filter((m) => m.role === 'user').pop()?.content;
  if (!userPrompt) {
    return c.json({ error: 'prompt is required' }, 400);
  }

  const abortController = new AbortController();
  const sid = sessionId ?? crypto.randomUUID();
  const ao04BindDir = process.env.AO04_BIND_DIR ?? '/tmp/ao04-bind';
  let ao04Lease: Ao04Lease | undefined;
  // AIGC START
  const promptRunId = String(env?.OPENRUSH_RUN_ID ?? sid);
  // AIGC END

  const releaseAo04 = () => {
    const rec = activeSessions.get(sid);
    if (rec?.controller === abortController) {
      activeSessions.delete(sid);
    }
    if (ao04Lease) {
      unbindSessionRun(ao04Lease.sessionId, ao04Lease.bindingGeneration, ao04BindDir);
    }
  };

  // AIGC START
  if (process.env.AO04_DEMO === '1') {
    try {
      const runId = promptRunId;
      const experimentId = env?.AO04_EXPERIMENT_ID ?? `ao04-${runId}`;
      await ensureAo04Experiment({
        experimentId,
        mode: env?.AO04_MODE ?? 'auto',
        controlUrl: process.env.AO04_CONTROL_URL ?? env?.AO04_CONTROL_URL,
        token: process.env.AO04_CONTROL_TOKEN ?? env?.AO04_CONTROL_TOKEN,
      });
      ao04Lease = bindSessionRun({
        bindDir: ao04BindDir,
        sessionId: sid,
        runId,
        experimentId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        { error: message },
        message === 'session_busy' || message.includes('setup_failed') ? 409 : 400
      );
    }
  }
  activeSessions.set(sid, { controller: abortController, runId: promptRunId });
  // AIGC END

  // Validate projectId before entering the try block so it returns 400, not 500
  if (projectId) {
    try {
      validateProjectId(projectId);
    } catch (err: unknown) {
      releaseAo04();
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  }

  try {
    // --- Workspace setup ---
    // If projectId is provided, ensure the project directory exists
    // and resolve the system prompt using the prompt resolver
    let effectiveSystemPrompt = systemPrompt;
    let projectPath: string | undefined;

    if (projectId) {
      projectPath = ensureProjectDir(projectId);
      console.log(`[Workspace] Project directory ready: ${projectPath}`);

      // If agentConfig is provided, resolve system prompt via prompt-resolver
      // Otherwise fall back to the raw systemPrompt from the request
      if (agentConfig) {
        const workspacePath = getWorkspacePathWithSlash();
        effectiveSystemPrompt = resolveSystemPrompt(agentConfig, {
          projectId,
          workspacePath,
        });
        console.log(
          `[Prompt] Resolved system prompt for agent: ${agentConfig.name} (${effectiveSystemPrompt.length} chars)`
        );
      }
    }

    // Model from env: DSH_MODEL / CLAUDE_MODEL / ANTHROPIC_MODEL (Bedrock ARN) or fallback
    // AIGC START
    const runtime = parseAgentRuntimeKind(requestedRuntime) ?? resolveAgentRuntime();
    const effectiveModelId =
      modelId ??
      (runtime === 'dsh'
        ? (process.env.DSH_MODEL ?? 'DeepSeek-V4-Flash-INT8')
        : (process.env.CLAUDE_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'sonnet'));
    // AIGC END
    const providerEnv: Record<string, string> = {
      ...(env ?? {}),
      ...(process.env.ANTHROPIC_BASE_URL && { ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL }),
      ...(process.env.ANTHROPIC_API_KEY && { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }),
      // AIGC START
      ...(process.env.DEEPSEEK_API_KEY && { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY }),
      ...(process.env.DEEPSEEK_BASE_URL && { DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL }),
      ...(process.env.NODE_TLS_REJECT_UNAUTHORIZED && {
        NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
      }),
      ...(process.env.AO04_DEMO === '1'
        ? {
            AO04_DEMO: '1',
            AO04_BIND_DIR: process.env.AO04_BIND_DIR ?? '/tmp/ao04-bind',
            AO04_CONTROL_URL: process.env.AO04_CONTROL_URL ?? 'http://127.0.0.1:18080',
            ...(process.env.AO04_CONTROL_TOKEN
              ? { AO04_CONTROL_TOKEN: process.env.AO04_CONTROL_TOKEN }
              : {}),
            DSH_SESSION_ID: sid,
          }
        : {}),
      // AIGC END
    };

    // AIGC START
    const workspaceCwd = projectPath ?? process.cwd();
    const complete = llmCompleteFromEnv();

    const laneIntent = routingIntent(userPrompt);
    if (process.env.AO04_DEMO !== '1' && chooseLane(laneIntent) === 'workflow') {
      try {
        const tools = await workflowCatalog({
          root: workspaceCwd,
          complete,
          userIntent: laneIntent,
        });
        return withStreamCleanup(
          workflowRunToSseResponse((sink) =>
            workflowRun({
              intent: laneIntent,
              tools,
              complete,
              allowHeuristic: !complete,
              disableFallback: true,
              signal: abortController.signal,
              sink,
            })
          ),
          () => releaseAo04()
        );
      } catch (err) {
        console.warn(
          `[Workflow] falling back to ${runtime}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    if (runtime === 'dsh') {
      const response = runDshToUIMessageStream({
        prompt: userPrompt,
        sessionId: sid,
        systemPrompt: effectiveSystemPrompt,
        modelId: effectiveModelId,
        cwd: workspaceCwd,
        abortSignal: abortController.signal,
        env: providerEnv,
      });
      return withStreamCleanup(response, () => releaseAo04());
    }
    // AIGC END

    const result = streamText({
      model: claudeCode(effectiveModelId, {
        permissionMode: 'bypassPermissions',
        maxTurns: maxTurns ?? 30,
        sessionId: sid,
        ...(allowedTools?.length ? { allowedTools } : {}),
        ...(Object.keys(providerEnv).length > 0 ? { env: providerEnv } : {}),
        cwd: workspaceCwd,
      }),
      ...(effectiveSystemPrompt ? { system: effectiveSystemPrompt } : {}),
      prompt: userPrompt,
      abortSignal: abortController.signal,
    });

    // UI message stream (SSE + JSON chunks) — persisted to run_events by control-worker
    const response = result.toUIMessageStreamResponse();

    // Cleanup after stream ends
    Promise.resolve(result.response).then(
      () => releaseAo04(),
      () => releaseAo04()
    );

    return response;
  } catch (err: unknown) {
    releaseAo04();
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

app.get('/workflow-live', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.html(WORKFLOW_LIVE_HTML);
});
// AIGC START
app.get('/workflow-catalog', async (c) => {
  const complete = llmCompleteFromEnv();
  const tools = await workflowCatalog({ root: process.cwd(), complete });
  const names = (await tools.listTools()).map((tool) => tool.name);
  return c.json({
    amap: names.some((name) => name.toLowerCase().startsWith('amap-maps__')),
    coding: names.some((name) => name.toLowerCase().startsWith('coding-tools__')),
    tools: names,
  });
});
// AIGC END
/** Fixture graph for debugging only. Live runs emit `workflow-graph` after planning. */
app.get('/workflow-graph', (c) => c.json(workflowGraph(weekendTripDsl())));

function sseStream(
  run: (send: (event: { eventType: string; payload: unknown }) => Promise<void>) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const send = async (event: { eventType: string; payload: unknown }) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      // client disconnected
    }
  };
  void (async () => {
    const ping = setInterval(() => {
      void writer.write(encoder.encode(`: ping ${Date.now()}\n\n`)).catch(() => undefined);
    }, 5000);
    try {
      await writer.write(encoder.encode(': connected\n\n'));
      await run(send);
    } catch (err) {
      await send({
        eventType: 'workflow-error',
        payload: { error: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      clearInterval(ping);
      try {
        await writer.close();
      } catch {
        // already closed
      }
    }
  })();
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

app.post('/workflow-run', async (c) => {
  // AIGC START
  const body = (await c.req.json()) as {
    prompt?: string;
    intent?: string;
    dsl?: unknown;
    disableFallback?: boolean;
    runId?: string;
    delayMs?: number;
  };
  const intent = body.intent ?? body.prompt;
  if (!intent && !body.dsl) {
    return c.json({ error: 'intent or dsl is required' }, 400);
  }
  const delayMs = Number.isFinite(body.delayMs) ? Number(body.delayMs) : 0;
  const complete = llmCompleteFromEnv();
  const tools = await workflowCatalog({
    root: process.cwd(),
    complete,
    userIntent: intent,
    delayMs,
  });
  const stream = c.req.query('stream') === '1';

  if (stream) {
    console.log(`[workflow-run] stream start intent=${JSON.stringify(intent ?? '').slice(0, 80)}`);
    return sseStream(async (send) => {
      if (body.dsl) {
        try {
          await send({
            eventType: 'workflow-graph',
            payload: workflowGraph(body.dsl as ReturnType<typeof weekendTripDsl>),
          });
        } catch {
          // engine will emit a graph after validation, or fallback
        }
      }
      const result = await workflowRun({
        intent: intent ?? WEEKEND_TRIP_INTENT,
        dsl: body.dsl,
        tools,
        complete,
        allowHeuristic: !complete,
        disableFallback: body.disableFallback,
        sink: { emit: send },
      });
      await send({
        eventType: 'workflow-result',
        payload: {
          output: result.ok ? result.output : undefined,
          ok: result.ok,
          degraded: result.degraded,
          error: 'error' in result ? result.error : undefined,
          rounds: result.rounds,
        },
      });
    });
  }

  const result = await workflowRun({
    intent,
    dsl: body.dsl,
    tools,
    complete,
    allowHeuristic: !complete,
    disableFallback: body.disableFallback,
  });
  return c.json({ ...result, runId: body.runId ?? null });
  // AIGC END
});

app.post('/abort', async (c) => {
  // AIGC START
  const { sessionId, runId } = (await c.req.json()) as { sessionId?: string; runId?: string };
  if (!sessionId) {
    return c.json({ error: 'sessionId is required' }, 400);
  }
  const rec = activeSessions.get(sessionId);
  const lease = getSessionLease(sessionId);
  if (!rec && !lease) {
    return c.json({ aborted: false, reason: 'session not found' }, 404);
  }
  if (
    !shouldAbortSession({
      requestedRunId: runId,
      leaseRunId: lease?.runId,
      sessionRunId: rec?.runId,
    })
  ) {
    return c.json({ aborted: false, reason: 'run mismatch' });
  }
  if (rec) {
    rec.controller.abort();
    if (activeSessions.get(sessionId) === rec) {
      activeSessions.delete(sessionId);
    }
  }
  const pythonCancel =
    lease && process.env.AO04_DEMO === '1'
      ? cancelAo04Experiment({
          experimentId: lease.experimentId,
          controlUrl: process.env.AO04_CONTROL_URL,
          token: process.env.AO04_CONTROL_TOKEN,
          runId: lease.runId,
          bindingGeneration: lease.bindingGeneration,
        }).catch((err) => {
          console.warn(
            `[AO04] cancel control service failed: ${err instanceof Error ? err.message : String(err)}`
          );
        })
      : Promise.resolve();
  if (lease) {
    unbindSessionRun(
      sessionId,
      lease.bindingGeneration,
      process.env.AO04_BIND_DIR ?? '/tmp/ao04-bind'
    );
  }
  await pythonCancel;
  return c.json({ aborted: true });
  // AIGC END
});

const port = Number.parseInt(process.env.PORT ?? '8787', 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Agent worker listening on http://localhost:${info.port}`);
});

export default app;
