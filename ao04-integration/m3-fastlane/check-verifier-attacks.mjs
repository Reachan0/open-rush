#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(process.argv[2] ?? '');
assert(process.argv[2], 'provide a passing evidence directory');
const output = mkdtempSync(join(here, 'results/verifier-attacks-'));
const verifier = join(here, 'verify-m3.mjs');
const run = (root) => spawnSync(process.execPath, [verifier, root, '--require-real-dsh', '--current-source'], { encoding: 'utf8' });
assert.equal(run(source).status, 0, 'reference evidence must pass first');
function update(root, path, fn) {
  const target = join(root, path);
  const data = JSON.parse(readFileSync(target, 'utf8'));
  writeFileSync(target, `${JSON.stringify(fn(data) ?? data, null, 2)}\n`);
}
function rehash(root) {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (relative(root, path) !== 'manifest.json') {
        const bytes = readFileSync(path);
        files.push({ path: relative(root, path), bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
  }
  walk(root);
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({ algorithm: 'sha256', files }));
}
const cases = [
  ['missing-events', 'dsh-real-attempt/controller-events.json', null],
  ['missing-graph', 'scenarios/exit-auto/graph-result.json', null],
  ['empty-events-rehashed', null, (root) => update(root, 'dsh-real-attempt/controller-events.json', () => [])],
  ['fake-summary-rehashed', null, (root) => update(root, 'dsh-real-attempt/protocol-messages.json', () => [])],
  ['failed-business-rehashed', null, (root) => update(root, 'dsh-real-attempt/controller-events.json',
    (events) => events.map((e) => e.type === 'incident.verify' ? { ...e, payload: { ...e.payload, businessOk: false } } : e))],
  ['empty-handoff-rehashed', null, (root) => {
    const runData = JSON.parse(readFileSync(join(root, 'scenarios/missing-artifact/assertions.json')));
    writeFileSync(join(root, 'control-data', runData.experimentId, 'handoffs/graph-missing-artifact:wf:2.md'), '');
  }],
  ['downgraded-mode-rehashed', null, (root) => update(root, 'run.json', (r) => ({ ...r, mode: 'deterministic' }))],
  ['stale-source-rehashed', null, (root) => update(root, 'provenance.json', (p) => {
    p.openrush.files[0].sha256 = '0'.repeat(64);
  })],
  ['bad-hash', null, (root) => update(root, 'run.json', (r) => ({ ...r, fake: true }))],
];
const report = [];
for (const [name, omitted, mutate] of cases) {
  const root = join(output, name);
  cpSync(source, root, { recursive: true, filter: (path) => !omitted || relative(source, path) !== omitted });
  if (mutate) mutate(root);
  if (name.endsWith('rehashed')) rehash(root);
  const result = run(root);
  assert.equal(result.status, 1, `${name} incorrectly passed: ${result.stdout}`);
  report.push({ name, rejected: true, output: result.stderr.trim() });
}
writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(`${cases.length}/${cases.length} verifier attacks rejected; retained copies: ${output}`);
