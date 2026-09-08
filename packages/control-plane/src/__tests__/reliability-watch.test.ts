// AIGC START
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '../event-store.js';
import { InMemoryReliabilityDedupe } from '../reliability/ingest.js';
import { mapControlEvents, watchReliabilityUntil } from '../reliability/watch.js';

describe('reliability watch', () => {
  it('maps python events and ignores malformed rows', () => {
    const mapped = mapControlEvents(
      [
        { eventId: 'e1', sourceSeq: 1, type: 'baseline.ready', payload: { ok: true } },
        { eventId: '', sourceSeq: 2, type: 'bad' },
        null,
      ],
      'run-1',
      'exp-1'
    );
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({ eventId: 'e1', runId: 'run-1', experimentId: 'exp-1' });
  });

  it('polls until abort then drains the tail', async () => {
    const store = new InMemoryEventStore();
    const dedupe = new InMemoryReliabilityDedupe();
    let calls = 0;
    const ac = new AbortController();
    const pulling = watchReliabilityUntil({
      eventStore: store,
      dedupe,
      runId: 'run-1',
      experimentId: 'exp-1',
      intervalMs: 20,
      signal: ac.signal,
      fetchEvents: async (after) => {
        calls += 1;
        if (calls === 1) {
          queueMicrotask(() => ac.abort());
          return [
            {
              eventId: 'e1',
              sourceSeq: 1,
              experimentId: 'exp-1',
              runId: 'run-1',
              type: 'baseline.ready',
            },
          ];
        }
        if (after >= 1) {
          return [
            {
              eventId: 'e2',
              sourceSeq: 2,
              experimentId: 'exp-1',
              runId: 'run-1',
              type: 'incident.terminal',
            },
          ];
        }
        return [];
      },
    });
    const result = await pulling;
    expect(result.ingested).toBe(2);
    const events = await store.getEvents('run-1');
    expect(events.filter((item) => item.eventType === 'data-openrush-reliability')).toHaveLength(2);
  });

  it('appends waiting and error sync markers', async () => {
    const { appendReliabilitySync } = await import('../reliability/watch.js');
    const store = new InMemoryEventStore();
    await appendReliabilitySync(store, 'run-sync', 'waiting');
    await appendReliabilitySync(store, 'run-sync', 'error', 'missing table');
    const events = await store.getEvents('run-sync');
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events[1]?.payload)).toContain('error');
  });

  it('throws on HTTP 500 so the worker cannot swallow it as empty events', async () => {
    const { fetchControlReliabilityEvents } = await import('../reliability/watch.js');
    await expect(
      fetchControlReliabilityEvents({
        controlUrl: 'http://control',
        token: 't',
        experimentId: 'exp-1',
        after: 0,
        fetchImpl: (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch,
      })
    ).rejects.toThrow(/HTTP 500/);
  });
});
// AIGC END
