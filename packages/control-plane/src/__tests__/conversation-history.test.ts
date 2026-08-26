// AIGC START
import { describe, expect, it } from 'vitest';
import { collectTurnsFromPriorRuns } from '../conversation/conversation-history.js';
import { InMemoryEventStore } from '../event-store.js';

describe('collectTurnsFromPriorRuns', () => {
  it('rebuilds user and assistant turns from prior run prompts and events', async () => {
    const eventStore = new InMemoryEventStore();
    await eventStore.append({
      runId: 'run-1',
      eventType: 'text-delta',
      payload: { type: 'text-delta', delta: '你好，小明' },
      seq: 0,
    });

    const turns = await collectTurnsFromPriorRuns(
      [{ id: 'run-1', prompt: '我叫小明' }],
      eventStore
    );

    expect(turns).toEqual([
      { role: 'user', content: '我叫小明' },
      { role: 'assistant', content: '你好，小明' },
    ]);
  });

  it('skips prior runs that have no usable text', async () => {
    const eventStore = new InMemoryEventStore();
    const turns = await collectTurnsFromPriorRuns([{ id: 'run-empty', prompt: '   ' }], eventStore);
    expect(turns).toEqual([]);
  });
});
// AIGC END
