// AIGC START
import type { EventStore } from '../event-store.js';
import type { ReliabilityDedupe, ReliabilityEvent } from './ingest.js';
import { pullReliabilityTail } from './poll.js';

export function mapControlEvents(
  raw: unknown[],
  runId: string,
  experimentId: string
): ReliabilityEvent[] {
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const rec = item as Record<string, unknown>;
    const eventId = String(rec.eventId ?? '');
    const sourceSeq = Number(rec.sourceSeq ?? 0);
    if (!eventId || !Number.isFinite(sourceSeq) || sourceSeq <= 0) return [];
    return [
      {
        eventId,
        sourceSeq,
        experimentId: String(rec.experimentId ?? experimentId),
        runId: String(rec.runId ?? runId),
        sessionId: rec.sessionId ? String(rec.sessionId) : undefined,
        bindingGeneration:
          typeof rec.bindingGeneration === 'number' ? rec.bindingGeneration : undefined,
        type: String(rec.type ?? 'unknown'),
        payload: rec.payload,
      },
    ];
  });
}

export async function fetchControlReliabilityEvents(input: {
  controlUrl: string;
  token: string;
  experimentId: string;
  after: number;
  fetchImpl?: typeof fetch;
}): Promise<unknown[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = input.controlUrl.replace(/\/$/, '');
  const response = await fetchImpl(
    `${base}/experiments/${encodeURIComponent(input.experimentId)}/events?after=${input.after}`,
    { headers: { 'X-AO04-Token': input.token } }
  );
  if (response.status === 401) throw new Error('reliability poll unauthorized');
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`reliability poll HTTP ${response.status}`);
  }
  const body = (await response.json()) as { events?: unknown[] };
  return Array.isArray(body.events) ? body.events : [];
}

export async function appendReliabilitySync(
  eventStore: EventStore,
  runId: string,
  state: 'waiting' | 'error',
  detail?: string
): Promise<void> {
  await eventStore.appendAssignSeq({
    runId,
    eventType: 'data-openrush-reliability',
    payload: {
      type: 'data-openrush-reliability',
      data: {
        type: 'reliability.sync',
        payload: { state, ...(detail ? { detail } : {}) },
      },
    },
  });
}

export async function watchReliabilityUntil(input: {
  eventStore: EventStore;
  dedupe: ReliabilityDedupe;
  runId: string;
  experimentId: string;
  fetchEvents: (after: number) => Promise<ReliabilityEvent[]>;
  signal: AbortSignal;
  intervalMs?: number;
}): Promise<{ ingested: number; duplicates: number }> {
  let ingested = 0;
  let duplicates = 0;
  const intervalMs = input.intervalMs ?? 400;
  const pull = async () => {
    const result = await pullReliabilityTail({
      eventStore: input.eventStore,
      dedupe: input.dedupe,
      runId: input.runId,
      experimentId: input.experimentId,
      fetchEvents: input.fetchEvents,
    });
    ingested += result.ingested;
    duplicates += result.duplicates;
  };
  while (!input.signal.aborted) {
    await pull();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      input.signal.addEventListener('abort', onAbort, { once: true });
    });
  }
  await pull();
  return { ingested, duplicates };
}
// AIGC END
