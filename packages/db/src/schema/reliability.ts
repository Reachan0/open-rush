// AIGC START
import { bigint, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

/** Persistent eventId set so control-worker restarts cannot double-ingest. */
export const reliabilityEventIds = pgTable('reliability_event_ids', {
  eventId: varchar('event_id', { length: 128 }).primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Python sourceSeq cursor per experiment. Advance only after a successful append. */
export const reliabilityCursors = pgTable('reliability_cursors', {
  experimentId: varchar('experiment_id', { length: 255 }).primaryKey(),
  sourceSeq: bigint('source_seq', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
// AIGC END
