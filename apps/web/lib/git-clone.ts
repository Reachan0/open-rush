// AIGC START
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { basename } from 'node:path';

export class GitCloneError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'GitCloneError';
    this.code = code;
  }
}

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export function validateGitHttpsUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 500) {
    throw new GitCloneError('VALIDATION_ERROR', 'Git 地址无效');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new GitCloneError('VALIDATION_ERROR', 'Git 地址不是合法 URL');
  }
  if (url.protocol !== 'https:') {
    throw new GitCloneError('VALIDATION_ERROR', '只允许 https:// 的 Git 仓库地址');
  }
  if (url.username || url.password) {
    throw new GitCloneError('VALIDATION_ERROR', 'Git 地址不能包含用户名或密码');
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.local')) {
    throw new GitCloneError('VALIDATION_ERROR', '不允许克隆本地地址');
  }
  if (!host.includes('.')) {
    throw new GitCloneError('VALIDATION_ERROR', 'Git 主机名无效');
  }
  if (!url.pathname || url.pathname === '/') {
    throw new GitCloneError('VALIDATION_ERROR', 'Git 地址缺少仓库路径');
  }
  url.hash = '';
  return url.toString();
}

export function repoNameFromGitUrl(url: string): string {
  const pathName = new URL(url).pathname.replace(/\/+$/, '');
  const name = basename(pathName).replace(/\.git$/i, '');
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new GitCloneError('VALIDATION_ERROR', '无法从地址解析安全的仓库目录名');
  }
  return name;
}

export function isProjectDirEmpty(dir: string): boolean {
  const entries = readdirSync(dir).filter((name) => name !== '.DS_Store');
  return entries.length === 0;
}

type SpawnFn = typeof spawn;

export async function cloneGitRepoIntoDir(options: {
  repoUrl: string;
  projectRoot: string;
  timeoutMs?: number;
  spawnGit?: SpawnFn;
}): Promise<{ target: string; mode: 'root' | 'subdir'; repoName: string }> {
  const url = validateGitHttpsUrl(options.repoUrl);
  const repoName = repoNameFromGitUrl(url);
  const empty = isProjectDirEmpty(options.projectRoot);
  const mode: 'root' | 'subdir' = empty ? 'root' : 'subdir';
  const target = empty ? '.' : repoName;
  if (!empty) {
    const existing = readdirSync(options.projectRoot);
    if (existing.includes(repoName)) {
      throw new GitCloneError('CONFLICT', `目录 ${repoName} 已存在`);
    }
  }

  const spawnGit = options.spawnGit ?? spawn;
  const timeoutMs = options.timeoutMs ?? 90_000;
  await new Promise<void>((resolve, reject) => {
    const child = spawnGit('git', ['clone', '--depth', '1', '--', url, target], {
      cwd: options.projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new GitCloneError('TIMEOUT', '克隆超时'));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new GitCloneError('CLONE_FAILED', err.message || '无法启动 git'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim().split('\n').at(-1) ?? `git clone 失败 (${code})`;
      reject(new GitCloneError('CLONE_FAILED', detail));
    });
  });

  return { target: empty ? '.' : repoName, mode, repoName };
}
// AIGC END
