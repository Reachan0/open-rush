// AIGC START

import { randomUUID } from 'node:crypto';
import {
  createComposeToolInvoker,
  createLoopToolInvoker,
  eligibleLoopTools,
  flattenAmapToolResult,
  formatDeniedLoopToolList,
  formatEligibleLoopToolList,
  type LlmComplete,
  type LoopToolSchema,
  type LoopToolsLike,
  llmCompleteFromEnv,
  mergeToolInvokers,
  normalizeAmapInvokeArgs,
  type WorkflowDsl,
  workflowRun,
} from '@open-rush/workflow';
import { markOuterRepair } from './filter-outer-catalog.js';
import { AO04_PROTECTED_TOOL_NAME, createProtectedToolResultAdapter } from './protected-tool.js';

export const WORKFLOW_RUN_TOOL_NAME = 'workflow_run';

export const WORKFLOW_RUN_TOOL_DESCRIPTION = `快车道：把用户这句 intent 编成一张 JSON 图，引擎按图把允许共享的只读 Loop 工具跑完（无依赖的并行），返回已经查完的事实，不是待执行方案。

可进图的工具（web_fetch、read、glob、已声明只读的 MCP）已从外层目录拿掉。抓页、检索、多路对照：必须调用本工具。已有 JSON 图时把 dsl 一并传入，只执行、不再规划。
普通自然语言请求只传 intent，由本工具的规划器生成图；不要自行编造 dsl。只有用户明确提供完整可执行 DSL 时才传 dsl。OPENRUSH_WORKFLOW_DAG 是展示结果，不能作为下一次执行的 DSL。

未知 MCP 默认不进图。问人、改文件、跑 bash：由你判断，用其它外层工具。intent 填用户原话（含全部 URL）。

用户每发一句都重新判断。不要因为本对话里已经调用过 workflow_run，就把后面的新问题改成逐步调其它工具。失败时本轮可直接用 web_fetch / read 补缺，不要用同一句 intent 再调一次本工具。`;

export function resolveWorkflowRunUrl(
  env: Record<string, string | undefined> = process.env
): string {
  const explicit = env.OPENRUSH_WORKFLOW_RUN_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const port = env.PORT?.trim() || '8787';
  return `http://127.0.0.1:${port}/workflow-run`;
}

const COMPOSE_TOOLS = new Set(['text.compose', 'article.compose']);
const NODE_FACT_MAX = 1200;
export const WORKFLOW_DAG_MARKER = 'OPENRUSH_WORKFLOW_DAG:';

function clipNodeFact(value: unknown, max = NODE_FACT_MAX): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max)}…[truncated]`;
}

function slimDagPayload(result: {
  dsl?: {
    name?: string;
    nodes?: Array<{ id?: string; tool?: string; dependsOn?: string[]; input?: unknown }>;
  };
  nodes?: Array<{ id?: string; status?: string; output?: unknown; error?: unknown }>;
  error?: unknown;
}): Record<string, unknown> {
  const graphNodes = result.dsl?.nodes ?? [];
  const states = new Map((result.nodes ?? []).map((node) => [node.id, node.status]));
  const records = new Map((result.nodes ?? []).map((node) => [node.id, node]));
  const validStates = new Set(['pending', 'running', 'completed', 'failed', 'skipped']);
  return {
    name: result.dsl?.name ?? 'workflow',
    nodes: graphNodes.map((node) => ({
      id: node.id ?? '?',
      tool: node.tool ?? 'tool',
      dependsOn: node.dependsOn ?? [],
      status: validStates.has(states.get(node.id) ?? '') ? states.get(node.id) : 'pending',
      ...(node.input !== undefined ? { input: node.input } : {}),
      ...(records.get(node.id)?.output !== undefined
        ? { output: records.get(node.id)?.output }
        : {}),
      ...(records.get(node.id)?.error != null
        ? { error: String(records.get(node.id)?.error) }
        : {}),
    })),
    ...(result.error != null ? { error: String(result.error) } : {}),
  };
}

export function formatWorkflowToolResult(result: {
  ok?: boolean;
  output?: unknown;
  error?: unknown;
  dsl?: { name?: string; nodes?: Array<{ id?: string; tool?: string; dependsOn?: string[] }> };
  nodes?: Array<{ id?: string; tool?: string; status?: string; output?: unknown }>;
}): string {
  const article =
    typeof result.output === 'string'
      ? result.output
      : result.output != null
        ? JSON.stringify(result.output, null, 2)
        : '';
  const graphNodes = result.dsl?.nodes ?? [];
  const plan = graphNodes
    .map((node) => {
      const deps = node.dependsOn?.length ? ` ← ${node.dependsOn.join(', ')}` : '';
      return `- ${node.id ?? '?'} (${node.tool ?? 'tool'})${deps}`;
    })
    .join('\n');
  const header = result.dsl?.name
    ? `快车道已执行「${result.dsl.name}」· ${graphNodes.length} 个节点（图已跑完，不是待执行方案）`
    : `快车道已执行 · ${graphNodes.length} 个节点（图已跑完，不是待执行方案）`;
  const facts = (result.nodes ?? [])
    .filter((node) => node.output != null && !COMPOSE_TOOLS.has(String(node.tool ?? '')))
    .map((node) => `### ${node.id ?? '?'} (${node.tool ?? 'tool'})\n${clipNodeFact(node.output)}`)
    .join('\n\n');
  const footer =
    '这些材料只服务用户刚才那一句。对照那一句检查能不能交付：够了就据此回复，不要把同一批事实再查一遍，也不要用同一句 intent 再调一次 workflow_run。不够或失败：用其它 Loop 工具补完这一句，用户只看到一份回复。用户接下来又发新的一句时，重新判断要不要走快车道，不要沿用这次的结论。';
  return [
    header,
    plan,
    '',
    facts ? `各节点查到的事实：\n${facts}` : '',
    article && article !== facts ? `\n${article}` : '',
    '',
    footer,
    '',
    `${WORKFLOW_DAG_MARKER}${JSON.stringify(slimDagPayload(result))}`,
  ]
    .filter((part) => part !== undefined)
    .join('\n')
    .trim();
}

// A failure is protected only when the graph contains the AO-04 tool or the
// protected adapter produced its explicit failure marker. A planner timeout
// before any graph exists is an ordinary fast-lane failure and remains repairable.
function requiresProtectedStop(result: {
  error?: unknown;
  dsl?: { nodes?: Array<{ tool?: string }> };
}): boolean {
  return (
    /protected_tool_failed/.test(String(result.error)) ||
    (result.dsl?.nodes ?? []).some((node) => node.tool === AO04_PROTECTED_TOOL_NAME)
  );
}

/** Tool-error text: keep the planned DAG so the sidebar can still draw it. */
export function formatWorkflowToolError(result: {
  ok?: boolean;
  output?: unknown;
  error?: unknown;
  nodeId?: string;
  dsl?: { name?: string; nodes?: Array<{ id?: string; tool?: string; dependsOn?: string[] }> };
  nodes?: Array<{ id?: string; tool?: string; status?: string; output?: unknown; error?: string }>;
  details?: unknown;
}): string {
  const err = String(result.error ?? 'workflow_run failed');
  const graphNodes = result.dsl?.nodes ?? [];
  const done = (result.nodes ?? []).filter(
    (node) =>
      node.status === 'completed' &&
      node.output != null &&
      !COMPOSE_TOOLS.has(String(node.tool ?? ''))
  );
  const failed = (result.nodes ?? []).filter((node) => node.status === 'failed');
  const pending = (result.nodes ?? []).filter(
    (node) => node.status === 'pending' || node.status === 'running'
  );
  const facts = done
    .map((node) => `### ${node.id ?? '?'} (${node.tool ?? 'tool'})\n${clipNodeFact(node.output)}`)
    .join('\n\n');
  const failedLine = failed
    .map(
      (node) =>
        `- ${node.id ?? result.nodeId ?? '?'} (${node.tool ?? 'tool'}): ${node.error ?? err}`
    )
    .join('\n');
  const failedFacts = failed
    .filter((node) => node.output != null)
    .map(
      (node) =>
        `### ${node.id ?? result.nodeId ?? '?'} (${node.tool ?? 'tool'})\n${clipNodeFact(node.output)}`
    )
    .join('\n\n');
  const pendingLine = pending
    .map((node) => `- ${node.id ?? '?'} (${node.tool ?? 'tool'})`)
    .join('\n');
  const header = result.dsl?.name
    ? `快车道失败「${result.dsl.name}」· 已规划 ${graphNodes.length} 个节点（图未跑完）`
    : `快车道失败 · 已规划 ${graphNodes.length} 个节点（图未跑完）`;
  const plan = graphNodes
    .map((node) => {
      const deps = node.dependsOn?.length ? ` ← ${node.dependsOn.join(', ')}` : '';
      return `- ${node.id ?? '?'} (${node.tool ?? 'tool'})${deps}`;
    })
    .join('\n');
  return [
    `快车道失败：${err}`,
    header,
    plan,
    facts ? `\n已完成节点的事实（请保留，不要重查）：\n${facts}` : '',
    failedFacts ? `\n失败节点已产生的部分事实（请保留，不要重查）：\n${failedFacts}` : '',
    failedLine
      ? `\n失败节点：\n${failedLine}`
      : result.nodeId
        ? `\n失败节点：\n- ${result.nodeId}`
        : '',
    pendingLine ? `\n未完成步骤：\n${pendingLine}` : '',
    result.details != null ? `\n可核验的故障证据：\n${clipNodeFact(result.details)}` : '',
    '',
    requiresProtectedStop(result)
      ? '本次未能完成。保留已查到的事实，直接向用户简短报告失败原因和未执行步骤，不要反复规划。未完成的依赖检查不算通过；不要换工具或读取后续材料绕过它，也不要重复调用 workflow_run。新的用户请求可以重试。'
      : '快车道没能交付这一句。本轮可直接用 web_fetch / read 等只读工具只补失败的那一步，最后只给用户一个答案（可注明缺失）。不要用同一句 intent 再调一次 workflow_run。用户接下来又发新的一句时，重新判断要不要走快车道。',
    '',
    graphNodes.length > 0 ? `${WORKFLOW_DAG_MARKER}${JSON.stringify(slimDagPayload(result))}` : '',
  ]
    .filter((part) => part !== undefined)
    .join('\n')
    .trim();
}

export async function invokeWorkflowRunHttp(input: {
  intent: string;
  endpoint?: string;
  workspace?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ text: string }> {
  const intent = input.intent.trim();
  if (!intent) {
    throw new Error('intent is required');
  }
  const endpoint = (input.endpoint ?? resolveWorkflowRunUrl()).replace(/\/$/, '');
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent,
      root: input.workspace,
      disableFallback: true,
    }),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    degraded?: boolean;
    output?: unknown;
    error?: unknown;
    details?: unknown;
    dsl?: { name?: string; nodes?: Array<{ id?: string; tool?: string; dependsOn?: string[] }> };
    nodes?: Array<{
      id?: string;
      tool?: string;
      status?: string;
      output?: unknown;
      error?: string;
    }>;
  };
  if (!response.ok || payload.ok === false || payload.degraded === true) {
    throw new Error(
      formatWorkflowToolError({
        ...payload,
        error: payload.error ?? `workflow-run HTTP ${response.status}`,
      })
    );
  }
  return { text: formatWorkflowToolResult(payload) };
}

export type WorkflowRunExec = {
  /** DSH ToolRunContext.signal — fused with node timeout AbortSignal. */
  signal?: AbortSignal;
  /** DSH ToolRunContext.token — passed as parent so nested execute is a sub-call. */
  token?: unknown;
  /** DSH ToolRunContext.agent — schemas(agent) and execute({ agent }). There is no exec.ctx. */
  agent?: unknown;
  callId?: string;
};

function wrapLoopAmap(
  tools: ReturnType<typeof createLoopToolInvoker>
): ReturnType<typeof createLoopToolInvoker> {
  return {
    listTools() {
      return tools.listTools();
    },
    async invoke(name, args, signal) {
      const isAmap = /amap|maps_geo|maps_around|maps_direction|maps_weather|maps_regeocode/i.test(
        name
      );
      const next = isAmap ? normalizeAmapInvokeArgs(name, args) : args;
      const out = await tools.invoke(name, next, signal);
      return (isAmap ? flattenAmapToolResult(name, out) : out) as Awaited<
        ReturnType<typeof tools.invoke>
      >;
    },
  };
}

function parseToolDsl(raw: unknown): WorkflowDsl | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'object') return raw as WorkflowDsl;
  if (typeof raw !== 'string') return undefined;
  const parsed = JSON.parse(raw) as unknown;
  return parsed as WorkflowDsl;
}

export async function runWorkflowFromLoop(input: {
  intent?: string;
  dsl?: unknown;
  loopTools: LoopToolsLike;
  exec?: WorkflowRunExec;
  complete?: LlmComplete;
  normalizeAmap?: boolean;
  eligibleToolNames?: readonly string[];
}): Promise<{ text: string }> {
  const intent = (input.intent ?? '').trim();
  const dsl = parseToolDsl(input.dsl);
  if (!intent && !dsl) {
    throw new Error('intent or dsl is required');
  }
  const names = input.loopTools.schemas(input.exec?.agent).map((schema) => schema.name);
  process.stderr.write(`[workflow_run] loop tools: ${names.join(', ') || '(none)'}\n`);
  const complete = dsl ? undefined : (input.complete ?? llmCompleteFromEnv());
  const callRoot = input.exec?.callId ?? `wf-${randomUUID()}`;
  const resultAdapters = input.eligibleToolNames?.includes(AO04_PROTECTED_TOOL_NAME)
    ? { [AO04_PROTECTED_TOOL_NAME]: createProtectedToolResultAdapter(AO04_PROTECTED_TOOL_NAME) }
    : undefined;
  const rawLoop = createLoopToolInvoker({
    tools: input.loopTools,
    agent: input.exec?.agent,
    parent: input.exec?.token,
    signal: input.exec?.signal,
    callIdPrefix: `${String(callRoot)}:wf`,
    eligibleToolNames: input.eligibleToolNames,
    resultAdapters,
  });
  const loopInvoker = input.normalizeAmap === false ? rawLoop : wrapLoopAmap(rawLoop);
  const tools = mergeToolInvokers([
    loopInvoker,
    createComposeToolInvoker({ complete, userIntent: intent }),
  ]);
  const result = await workflowRun({
    intent: intent || undefined,
    dsl,
    tools,
    complete,
    disableFallback: true,
    signal: input.exec?.signal,
  });
  if (!result.ok || result.degraded) {
    if (!requiresProtectedStop(result)) {
      markOuterRepair(input.exec?.agent);
    }
    throw new Error(formatWorkflowToolError(result));
  }
  return { text: formatWorkflowToolResult(result) };
}

export function workflowRunToolDefinition<T>(
  defineTool: (options: {
    name: string;
    description: string;
    timeoutMs: number;
    parameters: {
      intent: { type: 'string'; required?: boolean; description: string };
      dsl: { type: 'string'; required?: boolean; description: string };
    };
    output: {
      schema: {
        type: 'object';
        additionalProperties: false;
        properties: { text: { type: 'string'; required: true } };
      };
      render: (
        args: { intent: string },
        value: { text: string }
      ) => Array<{ type: 'text'; text: string }>;
    };
    execute: (
      args: { intent?: string; dsl?: string },
      exec: WorkflowRunExec
    ) => Promise<{ text: string }>;
  }) => T,
  options?: {
    fetchImpl?: typeof fetch;
    endpoint?: string;
    workspace?: string;
    loopTools?: LoopToolsLike;
    complete?: LlmComplete;
    timeoutMs?: number;
    normalizeAmap?: boolean;
    eligibleToolNames?: readonly string[];
  }
): T {
  return defineTool({
    name: WORKFLOW_RUN_TOOL_NAME,
    description: WORKFLOW_RUN_TOOL_DESCRIPTION,
    timeoutMs: options?.timeoutMs ?? 180_000,
    parameters: {
      intent: {
        type: 'string',
        description: '用户这句需求，原样传入。没有现成 dsl 时必填。',
      },
      dsl: {
        type: 'string',
        description:
          '仅用户提供完整可执行 DSL 时传入 JSON 字符串；否则省略，只传 intent。格式 {"version":"1","nodes":[{"id":"...","tool":"...","input":{},"dependsOn":[]}]}。展示用 OPENRUSH_WORKFLOW_DAG 缺少输入，不可执行。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    execute: (args, exec) => {
      if (options?.loopTools) {
        return runWorkflowFromLoop({
          intent: args.intent,
          dsl: args.dsl,
          loopTools: options.loopTools,
          exec,
          complete: options.complete,
          normalizeAmap: options.normalizeAmap,
          eligibleToolNames: options.eligibleToolNames,
        });
      }
      return invokeWorkflowRunHttp({
        intent: args.intent ?? '',
        endpoint: options?.endpoint,
        workspace: options?.workspace,
        fetchImpl: options?.fetchImpl,
        signal: exec?.signal,
      });
    },
  });
}

export function buildWorkflowRunPromptSection(
  schemas: LoopToolSchema[] = [],
  options?: { eligibleToolNames?: readonly string[] }
): string {
  const policy = { additionalEligibleTools: options?.eligibleToolNames };
  const eligible = formatEligibleLoopToolList(schemas, policy);
  const denied = formatDeniedLoopToolList(schemas, policy);
  const live =
    eligibleLoopTools(schemas, policy).length > 0
      ? `这些工具已从外层目录拿掉，由引擎在图里调用（运行时 schemas，不是场景清单）：\n${eligible}`
      : '可进图的只读/抓取工具和 MCP（例如 web_fetch、read、glob）已从外层目录拿掉，由引擎在图里调用。';
  return [
    `已接入工具 ${WORKFLOW_RUN_TOOL_NAME}（快车道）。用途：一张图把允许共享的 Loop 工具跑完，返回已经查完的材料和成文，不是待执行方案。`,
    '只有已知只读工具能进图。未知 MCP 默认不进图，仍留在外层。维护的是进图资格，不是场景白名单。',
    live,
    '另有引擎本地成文 text.compose（不注册进 Loop）。',
    `不进图（仍留在外层）：\n${denied}`,
    '抓页、检索、多路对照、一次查完再成文：必须调 workflow_run，intent 带上用户原话和全部链接。',
    '问人、改文件、跑 bash：由你判断，用其它外层工具。不要按关键词清单决定。',
    '用户每发一句都重新判断。不要因为本对话里已经调用过 workflow_run，就把后面的新问题改成逐步调其它工具。先前快车道的材料只覆盖当时那一句。',
    '某一次调用返回后：只对那一句检查能不能交付；够了就据此回复。失败时本轮可直接用只读工具只补缺的那一步，不要用同一句 intent 再调一次。也可传入 dsl 只执行。工作区路径相对当前 cwd。',
  ].join('\n\n');
}

export const WORKFLOW_RUN_PROMPT_SECTION = buildWorkflowRunPromptSection();
// AIGC END
