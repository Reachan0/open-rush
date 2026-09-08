// AIGC START
import type { EventStore } from '../event-store.js';

export interface ReliabilityEvent {
  eventId: string;
  sourceSeq: number;
  experimentId: string;
  runId: string;
  sessionId?: string;
  bindingGeneration?: number;
  type: string;
  payload?: unknown;
}

export interface ReliabilityIngestEventInput {
  eventStore: EventStore;
  runId: string;
  event: ReliabilityEvent;
}

export interface ReliabilityDedupe {
  has(eventId: string): Promise<boolean>;
  record(eventId: string): Promise<void>;
  getCursor(experimentId: string): Promise<number>;
  setCursor(experimentId: string, sourceSeq: number): Promise<void>;
  ingestEvent(input: ReliabilityIngestEventInput): Promise<'inserted' | 'duplicate'>;
}

export function reliabilityEventPayload(event: ReliabilityEvent) {
  return {
    type: 'data-openrush-reliability' as const,
    data: event,
  };
}

export class InMemoryReliabilityDedupe implements ReliabilityDedupe {
  private ids = new Set<string>();
  private cursors = new Map<string, number>();

  async has(eventId: string): Promise<boolean> {
    return this.ids.has(eventId);
  }
  async record(eventId: string): Promise<void> {
    this.ids.add(eventId);
  }
  async getCursor(experimentId: string): Promise<number> {
    return this.cursors.get(experimentId) ?? 0;
  }
  async setCursor(experimentId: string, sourceSeq: number): Promise<void> {
    const current = this.cursors.get(experimentId) ?? 0;
    if (sourceSeq > current) this.cursors.set(experimentId, sourceSeq);
  }
  async ingestEvent(input: ReliabilityIngestEventInput): Promise<'inserted' | 'duplicate'> {
    if (this.ids.has(input.event.eventId)) return 'duplicate';
    await input.eventStore.appendAssignSeq({
      runId: input.runId,
      eventType: 'data-openrush-reliability',
      payload: reliabilityEventPayload(input.event),
    });
    this.ids.add(input.event.eventId);
    await this.setCursor(input.event.experimentId, input.event.sourceSeq);
    return 'inserted';
  }
}

/**
 * Pull Python events into EventStore. Dedup by eventId, then assign platform seq.
 * Cursor/eventId advance only after a successful append. Implementations that share
 * a database must do append + dedupe + cursor in one transaction.
 */
export async function ingestReliabilityEvents(input: {
  eventStore: EventStore;
  dedupe: ReliabilityDedupe;
  runId: string;
  events: ReliabilityEvent[];
}): Promise<{ ingested: number; duplicates: number }> {
  let ingested = 0;
  let duplicates = 0;
  const ordered = [...input.events].sort((a, b) => a.sourceSeq - b.sourceSeq);
  for (const event of ordered) {
    const result = await input.dedupe.ingestEvent({
      eventStore: input.eventStore,
      runId: input.runId,
      event,
    });
    if (result === 'duplicate') duplicates += 1;
    else ingested += 1;
  }
  return { ingested, duplicates };
}
// AIGC END
