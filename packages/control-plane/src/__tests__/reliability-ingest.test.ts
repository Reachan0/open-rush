// AIGC START
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '../event-store.js';
import { InMemoryReliabilityDedupe, ingestReliabilityEvents } from '../reliability/ingest.js';

describe('ingestReliabilityEvents', () => {
  it('dedups by eventId and does not double-append', async () => {
    const store = new InMemoryEventStore();
    const dedupe = new InMemoryReliabilityDedupe();
    const event = {
      eventId: 'e1',
      sourceSeq: 1,
      experimentId: 'exp',
      runId: 'run-1',
      type: 'baseline.ready',
    };
    const first = await ingestReliabilityEvents({
      eventStore: store,
      dedupe,
      runId: 'run-1',
      events: [event],
    });
    const second = await ingestReliabilityEvents({
      eventStore: store,
      dedupe,
      runId: 'run-1',
      events: [event],
    });
    expect(first.ingested).toBe(1);
    expect(second.duplicates).toBe(1);
    const all = await store.getEvents('run-1');
    expect(all.filter((item) => item.eventType === 'data-openrush-reliability')).toHaveLength(1);
  });

  it('does not record eventId when append fails', async () => {
    const store = new InMemoryEventStore();
    store.appendAssignSeq = async () => {
      throw new Error('boom');
    };
    const dedupe = new InMemoryReliabilityDedupe();
    const event = {
      eventId: 'e-fail',
      sourceSeq: 1,
      experimentId: 'exp',
      runId: 'run-fail',
      type: 'incident.action',
    };
    await expect(
      ingestReliabilityEvents({
        eventStore: store,
        dedupe,
        runId: 'run-fail',
        events: [event],
      })
    ).rejects.toThrow(/boom/);
    expect(await dedupe.has('e-fail')).toBe(false);
    expect(await store.getEvents('run-fail')).toHaveLength(0);
  });
});
// AIGC END
