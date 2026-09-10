// AIGC START
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Ao04Lease {
  runId: string;
  sessionId: string;
  experimentId: string;
  bindingGeneration: number;
  leaseUntil: number;
}

const leases = new Map<string, Ao04Lease>();

function persist(bindDir: string | undefined, lease: Ao04Lease): void {
  if (!bindDir) return;
  mkdirSync(bindDir, { recursive: true });
  writeFileSync(join(bindDir, `${lease.sessionId}.json`), JSON.stringify(lease));
}

export function getSessionLease(sessionId: string, now = Date.now()): Ao04Lease | undefined {
  const lease = leases.get(sessionId);
  if (!lease || lease.leaseUntil <= now) return undefined;
  return lease;
}

export function shouldAbortSession(input: {
  requestedRunId?: string;
  leaseRunId?: string;
  sessionRunId?: string;
}): boolean {
  const current = input.sessionRunId ?? input.leaseRunId;
  if (!input.requestedRunId) return Boolean(current);
  if (!current) return false;
  return current === input.requestedRunId;
}

export function bindSessionRun(input: {
  bindDir: string;
  sessionId: string;
  runId: string;
  experimentId: string;
  ttlMs?: number;
  now?: number;
}): Ao04Lease {
  const now = input.now ?? Date.now();
  const current = leases.get(input.sessionId);
  if (current && current.leaseUntil > now && current.runId !== input.runId) {
    throw new Error('session_busy');
  }
  const generation = (current?.bindingGeneration ?? 0) + 1;
  const lease: Ao04Lease = {
    runId: input.runId,
    sessionId: input.sessionId,
    experimentId: input.experimentId,
    bindingGeneration: generation,
    leaseUntil: now + (input.ttlMs ?? 30 * 60_000),
  };
  leases.set(input.sessionId, lease);
  persist(input.bindDir, lease);
  return lease;
}

export function unbindSessionRun(sessionId: string, generation: number, bindDir?: string): boolean {
  const current = leases.get(sessionId);
  if (!current || current.bindingGeneration !== generation) return false;
  const tombstone: Ao04Lease = { ...current, leaseUntil: 0 };
  leases.set(sessionId, tombstone);
  persist(bindDir, tombstone);
  return true;
}
// AIGC END
