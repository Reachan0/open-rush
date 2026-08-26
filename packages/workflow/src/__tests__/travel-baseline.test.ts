// AIGC START
import { describe, expect, it } from 'vitest';
import { WEEKEND_TRIP_INTENT, weekendTripDsl } from '../fixtures.js';
import { generateWorkflowDsl } from '../generate.js';
import { runTravelAgentLoop } from '../loop-simulator.js';
import { createTravelToolInvoker, TRAVEL_EXCLUDED } from '../travel-tools.js';
import { workflowRun } from '../workflow-run.js';

const TOOL_DELAY_MS = 25;

describe('weekend trip baseline (B1–B4)', () => {
  it('reduces model rounds from 7 to 1 (B1)', async () => {
    const loop = await runTravelAgentLoop(WEEKEND_TRIP_INTENT, createTravelToolInvoker());
    const wf = await workflowRun({
      intent: WEEKEND_TRIP_INTENT,
      tools: createTravelToolInvoker(),
    });
    expect(loop.rounds).toBe(7);
    expect(wf.ok).toBe(true);
    if (!wf.ok) throw new Error('expected ok');
    expect(wf.degraded).toBe(false);
    expect(wf.rounds).toBe(1);
  });

  it('is faster than the serial loop on the same mock tools (B2)', async () => {
    const loop = await runTravelAgentLoop(
      WEEKEND_TRIP_INTENT,
      createTravelToolInvoker({ delayMs: TOOL_DELAY_MS }),
      {
        thinkDelayMs: 0,
      }
    );
    const wf = await workflowRun({
      intent: WEEKEND_TRIP_INTENT,
      tools: createTravelToolInvoker({ delayMs: TOOL_DELAY_MS }),
    });
    expect(wf.ok).toBe(true);
    expect(wf.durationMs).toBeLessThan(loop.durationMs);
    expect(loop.durationMs).toBeGreaterThan(TOOL_DELAY_MS * 6);
  });

  it('uses fewer estimated tokens than the 7-round loop (B3)', async () => {
    const loop = await runTravelAgentLoop(WEEKEND_TRIP_INTENT, createTravelToolInvoker());
    const wf = await workflowRun({
      intent: WEEKEND_TRIP_INTENT,
      tools: createTravelToolInvoker(),
    });
    expect(wf.ok).toBe(true);
    if (!wf.ok) throw new Error('expected ok');
    expect(wf.usage.estimatedTokens).toBeLessThan(loop.usage.estimatedTokens);
  });

  it('matches loop article assertions (B4)', async () => {
    const tools = createTravelToolInvoker();
    const loop = await runTravelAgentLoop(WEEKEND_TRIP_INTENT, tools);
    const wf = await workflowRun({
      intent: WEEKEND_TRIP_INTENT,
      dsl: weekendTripDsl(),
      tools: createTravelToolInvoker(),
    });
    expect(wf.ok).toBe(true);
    if (!wf.ok) throw new Error('expected ok');
    const loopText = String(loop.output);
    const wfText = String(wf.output);
    expect(loopText).toBe(wfText);
    expect(wfText).toContain('上海');
    expect(wfText).toContain('外滩步道');
    expect(wfText).toContain('本帮菜');
    expect(wfText).toContain('家庭酒店');
    expect(wfText).not.toContain(TRAVEL_EXCLUDED);
  });

  it('composes an article from either wrapped search output or bare arrays', async () => {
    const tools = createTravelToolInvoker();
    const wrapped = await tools.invoke('article.compose', {
      city: '上海',
      sights: [{ name: '上海外滩步道', kind: 'sight' }],
      foods: { places: [{ name: '上海本帮菜', kind: 'food' }] },
      hotels: { places: [{ name: '上海家庭酒店', kind: 'hotel' }] },
      transit: { options: [{ name: '上海地铁+步行' }] },
    });
    const bare = await tools.invoke('article.compose', {
      city: '上海',
      sights: { places: [{ name: '上海外滩步道', kind: 'sight' }] },
      foods: [{ name: '上海本帮菜', kind: 'food' }],
      hotels: [{ name: '上海家庭酒店', kind: 'hotel' }],
      transit: [{ name: '上海地铁+步行' }],
    });
    expect(String(wrapped)).toContain('上海外滩步道');
    expect(String(wrapped)).toContain('上海本帮菜');
    expect(String(bare)).toBe(String(wrapped));
  });

  it('retries invalid LLM JSON once then succeeds', async () => {
    let calls = 0;
    const generated = await generateWorkflowDsl({
      intent: WEEKEND_TRIP_INTENT,
      tools: await createTravelToolInvoker().listTools(),
      complete: async () => {
        calls += 1;
        if (calls === 1) return 'not json';
        return JSON.stringify(weekendTripDsl());
      },
      allowHeuristic: false,
    });
    expect(calls).toBe(2);
    expect(generated.attempts).toBe(2);
    expect(generated.dsl.nodes).toHaveLength(7);
  });
});
// AIGC END
