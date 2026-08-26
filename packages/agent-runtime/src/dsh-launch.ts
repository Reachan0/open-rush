// AIGC START
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentRuntimeKind, DshLaunchSpec } from './dsh-types.js';

export function parseAgentRuntimeKind(raw: unknown): AgentRuntimeKind | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLowerCase();
  if (value === 'claude-code' || value === 'claude' || value === 'cc') return 'claude-code';
  if (value === 'dsh' || value === 'deepseek' || value === 'deepseek-harness') return 'dsh';
  return undefined;
}

export function resolveAgentRuntime(
  env: Record<string, string | undefined> = process.env
): AgentRuntimeKind {
  return parseAgentRuntimeKind(env.AGENT_RUNTIME) ?? 'dsh';
}

function findWorkspaceRoot(startDir: string): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const workspaceFile = join(dir, 'pnpm-workspace.yaml');
    const pkgFile = join(dir, 'package.json');
    if (existsSync(workspaceFile) && existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as { name?: string };
        if (pkg.name === 'open-rush' || existsSync(join(dir, 'apps', 'agent-worker'))) {
          return dir;
        }
      } catch {
        // keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function resolveExisting(pathValue: string | undefined): string | undefined {
  if (!pathValue) return undefined;
  const resolved = isAbsolute(pathValue) ? pathValue : resolve(process.cwd(), pathValue);
  return existsSync(resolved) ? resolved : undefined;
}

export function resolveDshLaunch(
  env: Record<string, string | undefined> = process.env
): DshLaunchSpec {
  const here = dirname(fileURLToPath(import.meta.url));
  const openRushRoot =
    resolveExisting(env.OPENRUSH_ROOT) ??
    findWorkspaceRoot(process.cwd()) ??
    findWorkspaceRoot(here);

  const siblingRepo = openRushRoot ? resolve(openRushRoot, '..', 'deepseek-harness') : undefined;
  const repoRoot =
    resolveExisting(env.DSH_ROOT) ??
    (siblingRepo && existsSync(siblingRepo) ? siblingRepo : undefined);

  const launchJs = openRushRoot
    ? resolveExisting(join(openRushRoot, 'apps/agent-worker/dsh/launch.mjs'))
    : undefined;

  const binPath =
    resolveExisting(env.DSH_RUNTIME_BIN) ??
    launchJs ??
    (repoRoot
      ? (resolveExisting(join(repoRoot, 'packages/examples/jsonrpc-demo/lib/packaged-bin.js')) ??
        resolveExisting(join(repoRoot, 'packages/examples/jsonrpc-demo/lib/bin.js')))
      : undefined);

  const cordisPath =
    resolveExisting(env.DSH_CORDIS_CONFIG) ??
    (openRushRoot
      ? resolveExisting(join(openRushRoot, 'apps/agent-worker/dsh/cordis.yml'))
      : undefined) ??
    (repoRoot ? resolveExisting(join(repoRoot, 'examples/jsonrpc-agent/cordis.yml')) : undefined);

  if (!repoRoot || !binPath || !cordisPath) {
    throw new Error(
      [
        'DeepSeek Harness runtime is not ready.',
        'Set DSH_ROOT to the cloned deepseek-harness repo, then run `pnpm install && pnpm run build` there.',
        `DSH_ROOT=${env.DSH_ROOT ?? repoRoot ?? '(missing)'}`,
        `DSH_RUNTIME_BIN=${env.DSH_RUNTIME_BIN ?? binPath ?? '(missing packaged-bin.js)'}`,
        `DSH_CORDIS_CONFIG=${env.DSH_CORDIS_CONFIG ?? cordisPath ?? '(missing cordis.yml)'}`,
      ].join(' ')
    );
  }

  return {
    command: env.DSH_RUNTIME_COMMAND ?? process.execPath,
    args: [binPath, cordisPath],
    cwd: repoRoot,
    binPath,
    cordisPath,
    repoRoot,
  };
}

export function buildDshChildEnv(input: {
  env?: Record<string, string>;
  cwd?: string;
  systemPrompt?: string;
  sessionRoot?: string;
  repoRoot?: string;
}): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(input.env ?? {}),
  };
  if (input.cwd) childEnv.DSH_CWD = input.cwd;
  if (input.systemPrompt) childEnv.DSH_SYSTEM_PROMPT = input.systemPrompt;
  if (input.sessionRoot) childEnv.DSH_SESSION_ROOT = input.sessionRoot;
  if (input.repoRoot) childEnv.DSH_ROOT = childEnv.DSH_ROOT ?? input.repoRoot;
  childEnv.DSH_SNAPSHOT = childEnv.DSH_SNAPSHOT ?? '1';
  return childEnv;
}
// AIGC END
