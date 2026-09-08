// AIGC START
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RunLease {
  runId: string;
  sessionId: string;
  experimentId: string;
  bindingGeneration: number;
  leaseUntil: number;
}

export function readActiveLease(
  sessionId: string,
  bindDir = process.env.AO04_BIND_DIR,
  now = Date.now()
): RunLease | null {
  if (!bindDir || !sessionId) return null;
  const path = join(bindDir, `${sessionId}.json`);
  if (!existsSync(path)) return null;
  const lease = JSON.parse(readFileSync(path, 'utf8')) as RunLease;
  if (lease.leaseUntil <= now) return null;
  if (lease.sessionId !== sessionId) return null;
  return lease;
}

export function assertSameGeneration(lease: RunLease, generation: number): void {
  if (lease.bindingGeneration !== generation) {
    throw new Error('stale_binding_generation');
  }
}
// AIGC END
