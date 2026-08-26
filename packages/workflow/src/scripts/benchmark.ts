// AIGC START

import { WEEKEND_TRIP_INTENT } from '../fixtures.js';
import { runTravelAgentLoop } from '../loop-simulator.js';
import { createTravelToolInvoker } from '../travel-tools.js';
import { workflowRun } from '../workflow-run.js';

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

async function once(delayMs: number) {
  const loop = await runTravelAgentLoop(WEEKEND_TRIP_INTENT, createTravelToolInvoker({ delayMs }), {
    thinkDelayMs: 0,
  });
  const wf = await workflowRun({
    intent: WEEKEND_TRIP_INTENT,
    tools: createTravelToolInvoker({ delayMs }),
  });
  if (!wf.ok || wf.degraded) {
    throw new Error(`workflow failed: ${'error' in wf ? wf.error : 'unknown'}`);
  }
  return { loop, wf };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

const runs = Number(process.env.WF_BENCH_RUNS ?? 5);
const delayMs = Number(process.env.WF_BENCH_DELAY_MS ?? 30);

const loopDurations: number[] = [];
const wfDurations: number[] = [];
let last = await once(delayMs);

for (let i = 0; i < runs; i += 1) {
  last = await once(delayMs);
  loopDurations.push(last.loop.durationMs);
  wfDurations.push(last.wf.durationMs);
}

const report = {
  intent: WEEKEND_TRIP_INTENT,
  runs,
  delayMs,
  loop: {
    rounds: last.loop.rounds,
    p50Ms: percentile(loopDurations, 50),
    p95Ms: percentile(loopDurations, 95),
    estimatedTokens: last.loop.usage.estimatedTokens,
  },
  workflow: {
    rounds: last.wf.rounds,
    p50Ms: percentile(wfDurations, 50),
    p95Ms: percentile(wfDurations, 95),
    estimatedTokens: last.wf.usage.estimatedTokens,
  },
  improvement: {
    rounds: `${last.loop.rounds} -> ${last.wf.rounds}`,
    latencyP50: pct(1 - percentile(wfDurations, 50) / percentile(loopDurations, 50)),
    tokens: pct(1 - last.wf.usage.estimatedTokens / last.loop.usage.estimatedTokens),
  },
};

console.log(JSON.stringify(report, null, 2));
// AIGC END
