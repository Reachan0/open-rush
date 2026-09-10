// AIGC START

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bindSessionRun,
  getSessionLease,
  shouldAbortSession,
  unbindSessionRun,
} from '../ao04-bind.js';

describe('ao04 session bind', () => {
  it('rejects a second parallel run on the same session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao04-bind-'));
    bindSessionRun({ bindDir: dir, sessionId: 's1', runId: 'r1', experimentId: 'e1', now: 1000 });
    expect(() =>
      bindSessionRun({ bindDir: dir, sessionId: 's1', runId: 'r2', experimentId: 'e1', now: 1001 })
    ).toThrow(/session_busy/);
  });

  it('unbinds only the matching generation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao04-bind-'));
    const first = bindSessionRun({
      bindDir: dir,
      sessionId: 's2',
      runId: 'r1',
      experimentId: 'e1',
      now: 1000,
    });
    expect(unbindSessionRun('s2', first.bindingGeneration - 1, dir)).toBe(false);
    expect(unbindSessionRun('s2', first.bindingGeneration, dir)).toBe(true);
  });

  it('unbinds with a tombstone so the next run increments generation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao04-bind-'));
    const first = bindSessionRun({
      bindDir: dir,
      sessionId: 's3',
      runId: 'r1',
      experimentId: 'e1',
      now: 1000,
    });
    expect(unbindSessionRun('s3', first.bindingGeneration, dir)).toBe(true);
    const second = bindSessionRun({
      bindDir: dir,
      sessionId: 's3',
      runId: 'r2',
      experimentId: 'e1',
      now: 1002,
    });
    expect(second.bindingGeneration).toBe(2);
    expect(second.runId).toBe('r2');
    expect(unbindSessionRun('s3', first.bindingGeneration, dir)).toBe(false);
  });

  it('does not expose a tombstoned lease as active', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ao04-bind-'));
    const lease = bindSessionRun({
      bindDir: dir,
      sessionId: 's4',
      runId: 'r1',
      experimentId: 'e1',
      now: 1000,
    });
    expect(getSessionLease('s4', 1000)).toEqual(lease);
    expect(unbindSessionRun('s4', lease.bindingGeneration, dir)).toBe(true);
    expect(getSessionLease('s4', 1001)).toBeUndefined();
  });

  it('does not abort a newer run when the requested runId is stale', () => {
    expect(
      shouldAbortSession({ requestedRunId: 'run-a', leaseRunId: 'run-b', sessionRunId: 'run-b' })
    ).toBe(false);
    expect(
      shouldAbortSession({ requestedRunId: 'run-a', leaseRunId: 'run-a', sessionRunId: 'run-b' })
    ).toBe(false);
    expect(
      shouldAbortSession({ requestedRunId: 'run-b', leaseRunId: 'run-b', sessionRunId: 'run-b' })
    ).toBe(true);
  });
});
// AIGC END
