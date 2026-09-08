// AIGC START
import { type DbClient, reliabilityCursors, reliabilityEventIds } from '@open-rush/db';
import { eq } from 'drizzle-orm';
import { DrizzleEventStore } from '../drizzle-event-store.js';
import {
  type ReliabilityDedupe,
  type ReliabilityIngestEventInput,
  reliabilityEventPayload,
} from './ingest.js';

export class DrizzleReliabilityDedupe implements ReliabilityDedupe {
  constructor(private db: DbClient) {}

  async has(eventId: string): Promise<boolean> {
    const rows = await this.db
      .select({ eventId: reliabilityEventIds.eventId })
      .from(reliabilityEventIds)
      .where(eq(reliabilityEventIds.eventId, eventId))
      .limit(1);
    return rows.length > 0;
  }

  async record(eventId: string): Promise<void> {
    await this.db.insert(reliabilityEventIds).values({ eventId }).onConflictDoNothing();
  }

  async getCursor(experimentId: string): Promise<number> {
    const rows = await this.db
      .select({ sourceSeq: reliabilityCursors.sourceSeq })
      .from(reliabilityCursors)
      .where(eq(reliabilityCursors.experimentId, experimentId))
      .limit(1);
    return rows[0]?.sourceSeq ?? 0;
  }

  async setCursor(experimentId: string, sourceSeq: number): Promise<void> {
    const current = await this.getCursor(experimentId);
    if (sourceSeq <= current) return;
    await this.db
      .insert(reliabilityCursors)
      .values({ experimentId, sourceSeq, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: reliabilityCursors.experimentId,
        set: { sourceSeq, updatedAt: new Date() },
      });
  }

  async ingestEvent(input: ReliabilityIngestEventInput): Promise<'inserted' | 'duplicate'> {
    return this.db.transaction(async (tx) => {
      const reserved = await tx
        .insert(reliabilityEventIds)
        .values({ eventId: input.event.eventId })
        .onConflictDoNothing()
        .returning({ eventId: reliabilityEventIds.eventId });
      if (reserved.length === 0) return 'duplicate';

      if (input.eventStore instanceof DrizzleEventStore) {
        await input.eventStore.appendAssignSeq(
          {
            runId: input.runId,
            eventType: 'data-openrush-reliability',
            payload: reliabilityEventPayload(input.event),
          },
          { tx }
        );
      } else {
        await input.eventStore.appendAssignSeq({
          runId: input.runId,
          eventType: 'data-openrush-reliability',
          payload: reliabilityEventPayload(input.event),
        });
      }

      const cursorRows = await tx
        .select({ sourceSeq: reliabilityCursors.sourceSeq })
        .from(reliabilityCursors)
        .where(eq(reliabilityCursors.experimentId, input.event.experimentId))
        .limit(1);
      const current = cursorRows[0]?.sourceSeq ?? 0;
      if (input.event.sourceSeq > current) {
        await tx
          .insert(reliabilityCursors)
          .values({
            experimentId: input.event.experimentId,
            sourceSeq: input.event.sourceSeq,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: reliabilityCursors.experimentId,
            set: { sourceSeq: input.event.sourceSeq, updatedAt: new Date() },
          });
      }
      return 'inserted';
    });
  }
}
// AIGC END
