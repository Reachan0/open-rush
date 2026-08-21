// AIGC START
import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

import type { WorkspaceNode } from '@/lib/workspace-types';

const SKIP_NAMES = new Set(['node_modules', '.git', '.sessions', '.next', 'dist', '.DS_Store']);

const MAX_ENTRIES = 400;
const MAX_DEPTH = 8;
const MAX_FILE_BYTES = 256 * 1024;

const TEXT_EXT = new Set([
  '.txt',
  '.md',
  '.json',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.css',
  '.html',
  '.yml',
  '.yaml',
  '.toml',
  '.xml',
  '.svg',
  '.py',
  '.sh',
  '.env',
  '.gitignore',
]);

export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspacePathError';
  }
}

export function resolveSafeWorkspacePath(projectRoot: string, relativePath: string): string {
  const root = resolve(projectRoot);
  const trimmed = relativePath.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!trimmed || trimmed.includes('\0')) {
    throw new WorkspacePathError('Invalid path');
  }
  const target = resolve(root, trimmed);
  const rel = relative(root, target);
  if (rel.startsWith('..') || (rel === '' && trimmed.includes('..'))) {
    throw new WorkspacePathError('Path escapes workspace');
  }
  if (rel.split(sep).some((part) => part === '..')) {
    throw new WorkspacePathError('Path escapes workspace');
  }
  if (!target.startsWith(root + sep) && target !== root) {
    throw new WorkspacePathError('Path escapes workspace');
  }
  return target;
}

export function listWorkspaceTree(projectRoot: string): WorkspaceNode[] {
  const root = resolve(projectRoot);
  if (!existsSync(root)) return [];
  let remaining = MAX_ENTRIES;
  return walk(root, root, 0, () => {
    remaining -= 1;
    return remaining >= 0;
  });
}

function walk(root: string, dir: string, depth: number, take: () => boolean): WorkspaceNode[] {
  if (depth > MAX_DEPTH) return [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const nodes: WorkspaceNode[] = [];
  for (const entry of entries) {
    if (SKIP_NAMES.has(entry.name) || entry.name.startsWith('.')) continue;
    if (!take()) break;
    const abs = join(dir, entry.name);
    const rel = relative(root, abs).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      nodes.push({
        type: 'dir',
        name: entry.name,
        path: rel,
        children: walk(root, abs, depth + 1, take),
      });
    } else if (entry.isFile()) {
      nodes.push({ type: 'file', name: entry.name, path: rel });
    }
  }
  return nodes;
}

export function readWorkspaceFile(
  projectRoot: string,
  relativePath: string
): { path: string; content: string; truncated: boolean; binary: boolean } {
  const abs = resolveSafeWorkspacePath(projectRoot, relativePath);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    throw new WorkspacePathError('File not found');
  }
  const stat = statSync(abs);
  const buf = readFileSync(abs).subarray(0, MAX_FILE_BYTES + 1);
  const truncated = stat.size > MAX_FILE_BYTES || buf.length > MAX_FILE_BYTES;
  const slice = truncated ? buf.subarray(0, MAX_FILE_BYTES) : buf;
  if (isBinary(slice, relativePath)) {
    return { path: relativePath, content: '', truncated: false, binary: true };
  }
  return {
    path: relativePath,
    content: slice.toString('utf8'),
    truncated,
    binary: false,
  };
}

function isBinary(buf: Buffer, relativePath: string): boolean {
  const ext = extname(relativePath).toLowerCase();
  if (TEXT_EXT.has(ext)) return false;
  return buf.includes(0);
}

const PREVIEW_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

export function previewMimeType(relativePath: string): string {
  const ext = extname(relativePath).toLowerCase();
  return PREVIEW_MIME[ext] ?? 'application/octet-stream';
}

export function readWorkspacePreviewBytes(
  projectRoot: string,
  relativePath: string
): { path: string; body: Buffer; contentType: string } {
  let abs = resolveSafeWorkspacePath(projectRoot, relativePath);
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    abs = resolveSafeWorkspacePath(projectRoot, `${relativePath.replace(/\/$/, '')}/index.html`);
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    throw new WorkspacePathError('File not found');
  }
  const stat = statSync(abs);
  if (stat.size > MAX_PREVIEW_BYTES) {
    throw new WorkspacePathError('File too large to preview');
  }
  return {
    path: relative(resolve(projectRoot), abs).replaceAll('\\', '/'),
    body: readFileSync(abs),
    contentType: previewMimeType(abs),
  };
}
// AIGC END
