// AIGC START
import type { EventStore } from '../event-store.js';
import {
  ingestReliabilityEvents,
  type ReliabilityDedupe,
  type ReliabilityEvent,
} from './ingest.js';

export async function pullReliabilityTail(input: {
  eventStore: EventStore;
  dedupe: ReliabilityDedupe;
  runId: string;
  experimentId: string;
  fetchEvents: (after: number) => Promise<ReliabilityEvent[]>;
}): Promise<{ ingested: number; duplicates: number }> {
  const after = await input.dedupe.getCursor(input.experimentId);
  const events = await input.fetchEvents(after);
  return ingestReliabilityEvents({
    eventStore: input.eventStore,
    dedupe: input.dedupe,
    runId: input.runId,
    events,
  });
}
// AIGC END
