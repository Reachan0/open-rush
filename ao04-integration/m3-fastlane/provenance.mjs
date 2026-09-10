import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
function collect(root, selected) {
  const files = [];
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (['node_modules', 'dist', '__pycache__', 'results', '.git'].includes(entry.name)) continue;
      const next = join(path, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile() && /\.(ts|mjs|py|json|yml|sh)$/.test(entry.name))
        files.push({ path: relative(root, next), sha256: digest(next) });
    }
  }
  for (const path of selected) {
    const full = join(root, path);
    if (path.endsWith('/')) walk(full);
    else files.push({ path, sha256: digest(full) });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export function captureProvenance({ target, controller, runtime, binding, readStatus, workflow, composition }) {
  const packages = ['workflow', 'dsh-tool-workflow-run', 'dsh-tool-ao04'];
  for (const name of packages) {
    const originals = collect(join(target, 'packages', name), ['src/', 'package.json']);
    for (const file of originals) {
      const builtSource = join(runtime, 'packages', name, file.path);
      if (!existsSync(builtSource) || digest(builtSource) !== file.sha256)
        throw new Error(`runtime source differs from review checkout: ${name}/${file.path}`);
    }
  }
  const expected = [
    [binding, join(target, 'apps/agent-worker/src/ao04-bind.ts')],
    [readStatus, join(runtime, 'packages/dsh-tool-ao04/dist/index.js')],
    [workflow, join(runtime, 'packages/dsh-tool-workflow-run/dist/index.js')],
  ];
  for (const [actual, wanted] of expected)
    if (realpathSync(actual) !== realpathSync(wanted)) throw new Error('M3 acceptance module override is outside the audited build');
  for (const [envName, wanted] of [
    ['AO04_READ_STATUS_PLUGIN', readStatus], ['AO04_WORKFLOW_RUN_PLUGIN', workflow],
  ]) if (process.env[envName] && realpathSync(process.env[envName]) !== realpathSync(wanted))
    throw new Error(`M3 acceptance rejects ${envName} override`);
  const group = (root, selected) => ({
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    files: collect(root, selected),
  });
  return {
    schemaVersion: 1,
    note: 'Local runner provenance, not a signed attestation. Offline hashes do not prove source execution.',
    openrush: group(target, [
      ...packages.map((name) => `packages/${name}/`),
      'apps/agent-worker/src/ao04-bind.ts', 'apps/agent-worker/dsh/launch.mjs',
      relative(target, composition), 'ao04-integration/m3-fastlane/',
    ]),
    controller: group(controller, ['src/', 'tests/']),
    modules: expected.map(([path]) => ({ path, sha256: digest(path) })),
  };
}
export function compareCurrentSources(provenance, roots) {
  const failures = [];
  for (const name of ['openrush', 'controller']) {
    const entries = provenance?.[name]?.files;
    if (!Array.isArray(entries) || !entries.length) { failures.push(`missing ${name} source hashes`); continue; }
    for (const entry of entries) {
      if (entry.path.startsWith('/') || entry.path.split('/').includes('..')) {
        failures.push('unsafe provenance path'); continue;
      }
      const path = join(roots[name], entry.path);
      if (!existsSync(path) || digest(path) !== entry.sha256)
        failures.push(`source changed: ${name}/${entry.path}`);
    }
  }
  return failures;
}
