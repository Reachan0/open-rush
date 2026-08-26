// AIGC START
import { estimateTokens } from './events.js';
import { AGENT_LOOP_TRAVEL_STEPS } from './fixtures.js';
import type { JsonValue, ToolInvoker } from './types.js';

export interface LoopRunResult {
  rounds: number;
  output: JsonValue | undefined;
  outputs: Record<string, JsonValue>;
  durationMs: number;
  usage: { promptChars: number; completionChars: number; estimatedTokens: number };
}

const LOOP_KEYS = ['locate', 'sights', 'foods', 'hotels', 'transit', 'filter', 'article'] as const;

/**
 * Reproducible stand-in for skill + agent-loop on the weekend-trip baseline.
 * Each tool call is one model round (the current OpenRush cost model).
 */
export async function runTravelAgentLoop(
  intent: string,
  tools: ToolInvoker,
  options?: { thinkDelayMs?: number; promptOverheadChars?: number }
): Promise<LoopRunResult> {
  const started = Date.now();
  const thinkDelayMs = options?.thinkDelayMs ?? 0;
  const outputs: Record<string, JsonValue> = {};
  let promptChars = 0;
  const overhead = options?.promptOverheadChars ?? 800;

  for (let i = 0; i < AGENT_LOOP_TRAVEL_STEPS.length; i += 1) {
    const step = AGENT_LOOP_TRAVEL_STEPS[i];
    if (thinkDelayMs > 0) {
      await new Promise((r) => setTimeout(r, thinkDelayMs));
    }
    promptChars += overhead + intent.length + JSON.stringify(outputs).length;
    const args = step.args(intent, outputs as Record<string, unknown>);
    const output = await tools.invoke(step.tool, args);
    outputs[LOOP_KEYS[i]] = output;
  }

  return {
    rounds: AGENT_LOOP_TRAVEL_STEPS.length,
    output: outputs.article,
    outputs,
    durationMs: Date.now() - started,
    usage: {
      promptChars,
      completionChars: JSON.stringify(outputs).length,
      estimatedTokens: Math.ceil(promptChars / 4) + estimateTokens(JSON.stringify(outputs)),
    },
  };
}
// AIGC END
