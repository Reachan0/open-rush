// AIGC START
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export type DefineToolFn = (...args: never[]) => unknown;

function toolsUrlFromRoot(root: string): string | undefined {
  const built = join(root, 'packages/core/tools/lib/index.js');
  if (existsSync(built)) return pathToFileURL(built).href;
  try {
    const requireFromTools = createRequire(join(root, 'packages/core/tools/package.json'));
    return pathToFileURL(requireFromTools.resolve('@deepseek-ai/dsh-tools')).href;
  } catch {
    return undefined;
  }
}

function toolsUrlFromRequire(from: string): string | undefined {
  try {
    const req = createRequire(from);
    return pathToFileURL(req.resolve('@deepseek-ai/dsh-tools')).href;
  } catch {
    return undefined;
  }
}

function toolsUrlWalking(start: string | undefined): string | undefined {
  if (!start) return undefined;
  let dir = start;
  for (let i = 0; i < 16; i++) {
    const pkg = join(dir, 'node_modules/@deepseek-ai/dsh-tools/package.json');
    if (existsSync(pkg)) return toolsUrlFromRequire(pkg);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Resolve DSH `defineTool` without baking OpenRush paths into the plugin.
 * Installed inside a DSH host: package import. OpenRush child: DSH_ROOT.
 * Official CLI loading this file by absolute path: require from argv/cwd.
 */
export async function importDefineTool(): Promise<DefineToolFn> {
  try {
    const spec = `${'@deepseek-ai'}/dsh-tools`;
    const mod = (await import(spec)) as { defineTool?: DefineToolFn };
    if (typeof mod.defineTool === 'function') return mod.defineTool;
  } catch {
    // Resolve from a DSH checkout next.
  }

  const urls: string[] = [];
  const root = process.env.DSH_ROOT?.trim();
  if (root) {
    const url = toolsUrlFromRoot(root);
    if (url) urls.push(url);
  }
  const profileTools = join(
    homedir(),
    '.dsh/profiles/node_modules/@deepseek-ai/dsh-tools/package.json'
  );
  if (existsSync(profileTools)) {
    const url = toolsUrlFromRequire(profileTools);
    if (url) urls.push(url);
  }
  if (process.argv[1]) {
    const url = toolsUrlFromRequire(process.argv[1]) ?? toolsUrlWalking(dirname(process.argv[1]));
    if (url) urls.push(url);
  }
  const cwdPkg = join(process.cwd(), 'package.json');
  if (existsSync(cwdPkg)) {
    const url = toolsUrlFromRequire(cwdPkg) ?? toolsUrlWalking(process.cwd());
    if (url) urls.push(url);
  }

  for (const url of urls) {
    try {
      const mod = (await import(url)) as { defineTool?: DefineToolFn };
      if (typeof mod.defineTool === 'function') return mod.defineTool;
    } catch {
      // try the next candidate
    }
  }

  throw new Error(
    'tool-workflow-run: cannot resolve @deepseek-ai/dsh-tools. Load this plugin from a DSH host, or set DSH_ROOT to a deepseek-harness checkout.'
  );
}
// AIGC END
