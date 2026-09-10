// AIGC START
import type { LlmComplete } from '@open-rush/workflow';

export type DshLlmLike = {
  listProviders?: () => Array<{ id?: string }>;
  listModels?: (provider: string) => Promise<Array<{ id?: string }>>;
  stream: (options: {
    provider: string;
    model: string;
    system?: string;
    messages: unknown[];
    temperature?: number;
    signal?: AbortSignal;
  }) => AsyncIterable<{
    type?: string;
    text?: string;
    reason?: { kind?: string; failure?: { message?: string } };
  }>;
};

function pluginUserMessage(text: string): unknown {
  return Object.freeze({
    id: crypto.randomUUID(),
    role: 'user',
    content: Object.freeze([{ type: 'text', text }]),
    source: Object.freeze({ kind: 'plugin', plugin: 'tool-workflow-run' }),
  });
}

export async function resolveDshPlannerRoute(
  llm: DshLlmLike,
  env: Record<string, string | undefined> = process.env
): Promise<{ provider: string; model: string }> {
  const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : [];
  const provider =
    env.DSH_LLM_PROVIDER?.trim() ||
    providers.find((item) => typeof item.id === 'string' && item.id.trim())?.id?.trim() ||
    'deepseek-official';
  const envModel = env.DSH_MODEL?.trim();
  if (envModel) return { provider, model: envModel };
  const models = typeof llm.listModels === 'function' ? await llm.listModels(provider) : [];
  const model = models.find((item) => typeof item.id === 'string' && item.id.trim())?.id?.trim();
  if (!model) {
    throw new Error(
      'workflow_run: ctx.llm has no model id. Set DSH_MODEL or pick a model in the DSH UI.'
    );
  }
  return { provider, model };
}

/** One-shot planner call through official DSH `ctx.llm` (settings key, not env). */
export function completeFromDshLlm(
  llm: DshLlmLike,
  env: Record<string, string | undefined> = process.env
): LlmComplete {
  return async (prompt) => {
    const route = await resolveDshPlannerRoute(llm, env);
    const parts: string[] = [];
    let finishKind = 'stop';
    let finishError = '';
    for await (const chunk of llm.stream({
      provider: route.provider,
      model: route.model,
      temperature: 0.2,
      system: 'You are a workflow planner. Reply with a single JSON object and nothing else.',
      messages: [pluginUserMessage(prompt)],
    })) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        parts.push(chunk.text);
      }
      if (chunk.type === 'finish') {
        finishKind = chunk.reason?.kind ?? 'stop';
        finishError = chunk.reason?.failure?.message ?? '';
      }
    }
    if (finishKind === 'error' || finishKind === 'aborted') {
      throw new Error(finishError || `workflow_run planner ${finishKind}`);
    }
    const text = parts.join('');
    if (!text.trim()) {
      throw new Error('workflow_run planner returned empty content');
    }
    return text;
  };
}
// AIGC END
