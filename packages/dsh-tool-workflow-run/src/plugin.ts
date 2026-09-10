// AIGC START
import { type LoopToolsLike, llmCompleteFromEnv } from '@open-rush/workflow';
import { completeFromDshLlm, type DshLlmLike } from './complete-from-dsh.js';
import {
  consumeOuterRepair,
  filterOuterLoopCatalog,
  type OuterCatalogAssembly,
} from './filter-outer-catalog.js';
import { importDefineTool } from './resolve-dsh-tools.js';
import {
  buildWorkflowRunPromptSection,
  type WorkflowRunExec,
  workflowRunToolDefinition,
} from './workflow-run-tool.js';

export const name = 'tool-workflow-run';
export const inject = ['tools', 'systemPrompt'];

export interface Config {
  timeoutMs?: number;
  promptOrder?: number;
  normalizeAmap?: boolean;
  /** 默认 true：可进图工具从外层目录拿掉，模型只能走 workflow_run。 */
  hideEligibleFromOuter?: boolean;
}

type LoopToolsHost = {
  register: (tool: unknown) => void;
  schemas: (scope?: unknown) => Array<{ name: string; description?: string; parameters?: unknown }>;
  execute?: (input: unknown) => Promise<unknown>;
};

type PluginCtx = {
  tools: LoopToolsHost;
  llm?: DshLlmLike;
  systemPrompt: {
    section: (input: {
      name: string;
      order: number;
      text: (assemble?: { scope?: unknown }) => string;
    }) => void;
  };
  on?: (
    event: string,
    listener: (
      assembly: OuterCatalogAssembly,
      context: unknown,
      next: () => Promise<OuterCatalogAssembly>
    ) => Promise<OuterCatalogAssembly>
  ) => void;
};

function plannerComplete(ctx: PluginCtx) {
  if (ctx.llm && typeof ctx.llm.stream === 'function') {
    process.stderr.write('[workflow_run] planner: ctx.llm\n');
    return completeFromDshLlm(ctx.llm);
  }
  const fromEnv = llmCompleteFromEnv();
  process.stderr.write(`[workflow_run] planner: ${fromEnv ? 'env' : 'none'}\n`);
  return fromEnv;
}

function collectLoopSchemas(
  tools: LoopToolsHost,
  assemble?: { scope?: unknown }
): Array<{ name: string; description?: string; parameters?: unknown }> {
  const trySchemas = (scope?: unknown) => {
    try {
      return tools.schemas(scope) ?? [];
    } catch (err) {
      process.stderr.write(
        `[workflow_run] loop schemas unavailable at assemble: ${err instanceof Error ? err.message : String(err)}\n`
      );
      return [];
    }
  };
  if (assemble?.scope !== undefined) {
    const scoped = trySchemas(assemble.scope);
    if (scoped.length > 0) return scoped;
  }
  return trySchemas();
}

export async function apply(ctx: PluginCtx, config: Config = {}): Promise<void> {
  try {
    const defineTool = (await importDefineTool()) as Parameters<
      typeof workflowRunToolDefinition
    >[0];
    const tool = workflowRunToolDefinition(defineTool, {
      loopTools: ctx.tools as LoopToolsLike,
      timeoutMs: config.timeoutMs,
      normalizeAmap: config.normalizeAmap,
      complete: plannerComplete(ctx),
    });
    ctx.tools.register(tool);
    ctx.systemPrompt.section({
      name: 'tool:workflow_run',
      order: config.promptOrder ?? 108,
      text: (assemble) => buildWorkflowRunPromptSection(collectLoopSchemas(ctx.tools, assemble)),
    });
    const hideEligible = config.hideEligibleFromOuter !== false;
    if (hideEligible && typeof ctx.on === 'function') {
      ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
        const assembled = await next();
        const scope =
          context && typeof context === 'object' && 'scope' in context
            ? (context as { scope?: unknown }).scope
            : undefined;
        const repair = consumeOuterRepair(scope);
        return filterOuterLoopCatalog(assembled, { repair });
      });
    }
    process.stderr.write(
      `[workflow_run] registered${hideEligible ? '; outer catalog hides graph-eligible tools' : ''}\n`
    );
  } catch (err) {
    process.stderr.write(
      `[workflow_run] apply failed (preset still mounts): ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`
    );
  }
}

export type { WorkflowRunExec };
// AIGC END
