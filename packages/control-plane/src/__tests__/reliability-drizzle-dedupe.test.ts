// AIGC START

import type { PGlite } from '@electric-sql/pglite';
import type { DbClient } from '@open-rush/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestDb, createTestDb, type TestDb } from '../../../db/test/pglite-helpers.js';
import { InMemoryEventStore } from '../event-store.js';
import { DrizzleReliabilityDedupe } from '../reliability/drizzle-dedupe.js';
import { ingestReliabilityEvents } from '../reliability/ingest.js';

describe('DrizzleReliabilityDedupe', () => {
  let db: TestDb;
  let pglite: PGlite;

  beforeAll(async () => {
    const created = await createTestDb();
    db = created.db;
    pglite = created.pglite;
  }, 30000);

  afterAll(async () => {
    await closeTestDb(pglite);
  });

  it('survives a second instance on the same database', async () => {
    const store = new InMemoryEventStore();
    const first = new DrizzleReliabilityDedupe(db as unknown as DbClient);
    const event = {
      eventId: 'persist-1',
      sourceSeq: 3,
      experimentId: 'exp-db',
      runId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      type: 'baseline.ready',
    };
    await ingestReliabilityEvents({
      eventStore: store,
      dedupe: first,
      runId: event.runId,
      events: [event],
    });
    const second = new DrizzleReliabilityDedupe(db as unknown as DbClient);
    expect(await second.has('persist-1')).toBe(true);
    expect(await second.getCursor('exp-db')).toBe(3);
    const again = await ingestReliabilityEvents({
      eventStore: store,
      dedupe: second,
      runId: event.runId,
      events: [event],
    });
    expect(again.duplicates).toBe(1);
    expect(again.ingested).toBe(0);
  });
});
// AIGC END
