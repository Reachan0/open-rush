// AIGC START
import { describe, expect, it } from 'vitest';
import { createMemorySink, toRunEvents } from '../events.js';
import { WEEKEND_TRIP_INTENT } from '../fixtures.js';
import { createTravelToolInvoker, TRAVEL_EXCLUDED } from '../travel-tools.js';
import { workflowRun } from '../workflow-run.js';

describe('fallback (B7)', () => {
  it('falls back to agent-loop when DSL generation fails', async () => {
    const result = await workflowRun({
      intent: 'not a travel request and no dsl',
      tools: createTravelToolInvoker(),
      allowHeuristic: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.degraded).toBe(true);
    if (!result.degraded) throw new Error('expected degraded');
    expect(result.reason).toBe('generate_failed');
    expect(String(result.output)).toContain('上海外滩步道');
    expect(String(result.output)).not.toContain(TRAVEL_EXCLUDED);
  });

  it('falls back when provided DSL is invalid', async () => {
    const result = await workflowRun({
      intent: WEEKEND_TRIP_INTENT,
      dsl: { version: '1', nodes: [] },
      tools: createTravelToolInvoker(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.degraded).toBe(true);
    expect(String(result.output)).toContain('上海');
  });

  it('does not fallback when disableFallback is set', async () => {
    const result = await workflowRun({
      intent: 'nope',
      tools: createTravelToolInvoker(),
      allowHeuristic: false,
      disableFallback: true,
    });
    expect(result.ok).toBe(false);
  });
});

describe('metering (B8)', () => {
  it('emits per-node events and maps them to run_events shape', async () => {
    const { sink, events } = createMemorySink();
    const result = await workflowRun({
      intent: WEEKEND_TRIP_INTENT,
      tools: createTravelToolInvoker(),
      sink,
    });
    expect(result.ok).toBe(true);
    const types = events.map((e) => e.eventType);
    expect(types).toContain('workflow-planning');
    expect(types).toContain('workflow-graph');
    expect(types.filter((t) => t === 'workflow-node-start').length).toBeGreaterThanOrEqual(7);
    expect(types).toContain('workflow-node-end');
    expect(types).toContain('workflow-usage');
    const asRun = toRunEvents('00000000-0000-4000-8000-000000000001', events);
    expect(asRun[0]).toMatchObject({
      runId: '00000000-0000-4000-8000-000000000001',
      schemaVersion: '1',
    });
  });

  it('continues when the sink throws', async () => {
    const result = await workflowRun({
      intent: WEEKEND_TRIP_INTENT,
      tools: createTravelToolInvoker(),
      sink: {
        emit() {
          throw new Error('metering down');
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.degraded).toBe(false);
    expect(String(result.output)).toContain('上海');
  });
});
// AIGC END
