// AIGC START
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  listWorkspaceTree,
  previewMimeType,
  readWorkspaceFile,
  readWorkspacePreviewBytes,
  resolveSafeWorkspacePath,
  WorkspacePathError,
} from '../workspace-files';
import { validateProjectId } from '../workspace-root';
import { findPreviewHtmlPath } from '../workspace-types';

function makeRoot() {
  const root = join(
    process.env.TMPDIR ?? '/tmp',
    `or-ws-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  mkdirSync(root, { recursive: true });
  return root;
}

describe('workspace-files', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots) {
      rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it('rejects path traversal', () => {
    const root = makeRoot();
    roots.push(root);
    expect(() => resolveSafeWorkspacePath(root, '../secret')).toThrow(WorkspacePathError);
    expect(() => resolveSafeWorkspacePath(root, 'a/../../secret')).toThrow(WorkspacePathError);
  });

  it('lists nested files and skips ignored dirs', () => {
    const root = makeRoot();
    roots.push(root);
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'src', 'main.ts'), 'export {}');
    writeFileSync(join(root, 'README.md'), 'hi');
    writeFileSync(join(root, 'node_modules', 'x.js'), 'nope');
    const tree = listWorkspaceTree(root);
    const names = tree.map((n) => n.name).sort();
    expect(names).toEqual(['README.md', 'src']);
    const src = tree.find((n) => n.name === 'src');
    expect(src?.children?.map((c) => c.name)).toEqual(['main.ts']);
  });

  it('reads a text file', () => {
    const root = makeRoot();
    roots.push(root);
    writeFileSync(join(root, 'hello.txt'), 'hello');
    const file = readWorkspaceFile(root, 'hello.txt');
    expect(file.content).toBe('hello');
    expect(file.binary).toBe(false);
  });

  it('picks root index.html for preview', () => {
    const root = makeRoot();
    roots.push(root);
    writeFileSync(join(root, 'about.html'), '<h1>about</h1>');
    writeFileSync(join(root, 'index.html'), '<h1>home</h1>');
    expect(findPreviewHtmlPath(listWorkspaceTree(root))).toBe('index.html');
    expect(previewMimeType('index.html')).toContain('text/html');
    const preview = readWorkspacePreviewBytes(root, 'index.html');
    expect(preview.body.toString('utf8')).toContain('home');
  });
});

describe('workspace-root', () => {
  it('rejects path-traversal project ids', () => {
    expect(() => validateProjectId('../hack')).toThrow('Invalid projectId');
    expect(() => validateProjectId('ok-id_1')).not.toThrow();
  });
});
// AIGC END
