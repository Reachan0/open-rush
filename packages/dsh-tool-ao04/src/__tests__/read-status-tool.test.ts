// AIGC START
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readActiveLease } from '../lease.js';
import { executeReadStatus } from '../read-status-tool.js';

describe('ao04_read_status', () => {
  function fixture() {
    const dir = mkdtempSync('/tmp/ao04-lease-race-');
    const lease = {
      runId: 'run-1',
      sessionId: 'sess-race',
      experimentId: 'exp-1',
      bindingGeneration: 1,
      leaseUntil: Date.now() + 60_000,
    };
    const write = (value = lease) =>
      writeFileSync(join(dir, 'sess-race.json'), JSON.stringify(value));
    write();
    return {
      lease,
      write,
      env: { AO04_CONTROL_TOKEN: 'secret', AO04_BIND_DIR: dir },
      exec: { agent: { sessionId: 'sess-race' } },
    };
  }

  it.each(['expired', 'rebound'])('rejects an in-flight %s lease', async (kind) => {
    const f = fixture();
    await expect(
      executeReadStatus({ query: 'status' }, f.exec, {
        env: f.env,
        fetchImpl: async () => {
          f.write(
            kind === 'expired'
              ? { ...f.lease, leaseUntil: 1 }
              : { ...f.lease, runId: 'run-2', bindingGeneration: 2 }
          );
          return new Response(JSON.stringify({ status: 'ok', data: { ready: true } }));
        },
      })
    ).rejects.toThrow(/lease changed|no active Run lease/);
  });

  it('does not disguise a response from another operation', async () => {
    const f = fixture();
    await expect(
      executeReadStatus(
        { query: 'status' },
        { ...f.exec, callId: 'call-1' },
        {
          env: f.env,
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                status: 'ok',
                data: { ready: true },
                operationId: 'call-other',
              })
            ),
        }
      )
    ).rejects.toThrow(/response identity mismatch/);
  });

  it('assigns distinct operation IDs when runtime omitted callId', async () => {
    const f = fixture();
    const ids: string[] = [];
    const fetchImpl: typeof fetch = async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      ids.push(body.operationId);
      return new Response(JSON.stringify({ status: 'ok', operationId: body.operationId }));
    };
    await Promise.all(
      [1, 2].map(() => executeReadStatus({ query: 'status' }, f.exec, { env: f.env, fetchImpl }))
    );
    expect(new Set(ids).size).toBe(2);
  });
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
