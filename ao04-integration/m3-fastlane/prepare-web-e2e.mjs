import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../..');
const installed = resolve(source, '../..');
const stamp = new Date().toISOString().replace(/[-:.]/g, '');
const output = join(here, 'results', `web-e2e-${stamp}`);
const runtime = join(output, 'runtime');
mkdirSync(runtime, { recursive: true });
const copy = (from, to) => {
  mkdirSync(to, { recursive: true });
  execFileSync('rsync', ['-a', '--exclude=node_modules', '--exclude=dist', '--exclude=.next',
    '--exclude=.env*', '--exclude=.git', '--exclude=coverage', `${from}/`, `${to}/`]);
};
copy(join(source, 'packages'), join(runtime, 'packages'));
copy(join(source, 'apps'), join(runtime, 'apps'));
for (const name of ['package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'biome.json', 'turbo.json'])
  if (existsSync(join(source, name))) writeFileSync(join(runtime, name), readFileSync(join(source, name)));
const units = ['', ...['packages', 'apps'].flatMap((group) =>
  readdirSync(join(runtime, group)).filter((name) => existsSync(join(runtime, group, name, 'package.json')))
    .map((name) => `${group}/${name}`))];
const byName = new Map(units.map((unit) => [
  JSON.parse(readFileSync(join(runtime, unit, 'package.json'))).name, join(runtime, unit),
]));
function link(to, from) {
  if (existsSync(to)) return;
  mkdirSync(dirname(to), { recursive: true });
  symlinkSync(from, to);
}
for (const unit of units) {
  const pkg = JSON.parse(readFileSync(join(runtime, unit, 'package.json')));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of Object.keys(deps)) {
    const original = [join(installed, unit, 'node_modules', name),
      join(installed, 'node_modules', name),
      join(installed, 'packages/workflow/node_modules', name)].find(existsSync);
    const target = byName.get(name) ?? (original && realpathSync(original));
    if (!target) throw new Error(`installed dependency unavailable: ${unit} ${name}`);
    link(join(runtime, unit, 'node_modules', name), target);
  }
  for (const bin of [join(installed, unit, 'node_modules/.bin'), join(installed, 'packages/workflow/node_modules/.bin')]) {
    if (!existsSync(bin)) continue;
    for (const name of readdirSync(bin)) link(join(runtime, unit, 'node_modules/.bin', name), join(bin, name));
  }
}
const info = { source, runtime, output, database: `ao04_m3_e2e_${Date.now()}`,
  ports: { web: 3100, worker: 18787, controller: 18081 },
  controller: resolve(source, '../../../ao04-fastlane-controller') };
writeFileSync(join(output, 'environment.json'), JSON.stringify(info, null, 2));
writeFileSync(join(here, 'web-e2e-current.json'), JSON.stringify(info, null, 2));
console.log(`E2E environment: ${output}`);
// pnpm orders workspace builds; outputs stay inside this new runtime.
const child = spawn('pnpm', ['-r', '--filter', './packages/**', 'build'], {
  cwd: runtime, stdio: 'inherit',
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
