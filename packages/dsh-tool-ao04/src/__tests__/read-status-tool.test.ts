// AIGC START
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readActiveLease } from '../lease.js';
import { executeReadStatus } from '../read-status-tool.js';

describe('ao04_read_status', () => {
  it('fails closed when the control service is unreachable', async () => {
    const dir = join('/tmp', `ao04-bind-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'sess-1.json'),
      JSON.stringify({
        runId: 'run-1',
        sessionId: 'sess-1',
        experimentId: 'exp-1',
        bindingGeneration: 1,
        leaseUntil: Date.now() + 60_000,
      })
    );
    await expect(
      executeReadStatus(
        { query: 'status' },
        { agent: { sessionId: 'sess-1' }, callId: 'c1' },
        {
          env: {
            AO04_CONTROL_TOKEN: 'secret',
            AO04_CONTROL_URL: 'http://127.0.0.1:9',
            AO04_BIND_DIR: dir,
          },
          fetchImpl: async () => {
            throw new Error('ECONNREFUSED');
          },
        }
      )
    ).rejects.toThrow(/control service unreachable/);
  });

  it('does not call fetch when no lease is bound', async () => {
    const fetchImpl = vi.fn();
    await expect(
      executeReadStatus(
        {},
        { agent: { sessionId: 'none' } },
        {
          env: { AO04_CONTROL_TOKEN: 'secret', AO04_BIND_DIR: '/tmp/missing-ao04-bind' },
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }
      )
    ).rejects.toThrow(/no active Run lease/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('expires a stale lease', () => {
    const dir = join('/tmp', `ao04-bind-exp-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'sess-2.json'),
      JSON.stringify({
        runId: 'run-old',
        sessionId: 'sess-2',
        experimentId: 'exp-1',
        bindingGeneration: 1,
        leaseUntil: 1,
      })
    );
    expect(readActiveLease('sess-2', dir, Date.now())).toBeNull();
  });
});
// AIGC END
