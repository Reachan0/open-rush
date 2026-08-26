// AIGC START
import { EventEmitter } from 'node:events';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cloneGitRepoIntoDir,
  GitCloneError,
  repoNameFromGitUrl,
  validateGitHttpsUrl,
} from '../git-clone';

function makeRoot() {
  const root = join(
    process.env.TMPDIR ?? '/tmp',
    `or-clone-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  mkdirSync(root, { recursive: true });
  return root;
}

describe('git-clone', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  it('accepts public https git URLs', () => {
    expect(validateGitHttpsUrl('https://github.com/octocat/Hello-World.git')).toContain(
      'github.com'
    );
    expect(repoNameFromGitUrl('https://github.com/octocat/Hello-World.git')).toBe('Hello-World');
  });

  it('rejects unsafe URLs', () => {
    expect(() => validateGitHttpsUrl('file:///etc/passwd')).toThrow(GitCloneError);
    expect(() => validateGitHttpsUrl('git@github.com:x/y.git')).toThrow(GitCloneError);
    expect(() => validateGitHttpsUrl('http://github.com/x/y.git')).toThrow(GitCloneError);
    expect(() => validateGitHttpsUrl('https://user:pass@github.com/x/y.git')).toThrow(
      GitCloneError
    );
    expect(() => validateGitHttpsUrl('https://127.0.0.1/x/y.git')).toThrow(GitCloneError);
  });

  it('clones into empty project root', async () => {
    const root = makeRoot();
    roots.push(root);
    const fake = ((_cmd: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void };
      child.stderr = new EventEmitter();
      child.kill = () => undefined;
      queueMicrotask(() => child.emit('close', 0));
      expect(args).toEqual([
        'clone',
        '--depth',
        '1',
        '--',
        'https://github.com/octocat/Hello-World.git',
        '.',
      ]);
      return child;
    }) as unknown as typeof import('node:child_process').spawn;

    const result = await cloneGitRepoIntoDir({
      repoUrl: 'https://github.com/octocat/Hello-World.git',
      projectRoot: root,
      spawnGit: fake,
    });
    expect(result.mode).toBe('root');
  });

  it('clones into a subdirectory when the workspace is not empty', async () => {
    const root = makeRoot();
    roots.push(root);
    writeFileSync(join(root, 'keep.txt'), 'x');
    const fake = ((_cmd: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void };
      child.stderr = new EventEmitter();
      child.kill = () => undefined;
      queueMicrotask(() => child.emit('close', 0));
      expect(args.at(-1)).toBe('Hello-World');
      return child;
    }) as unknown as typeof import('node:child_process').spawn;

    const result = await cloneGitRepoIntoDir({
      repoUrl: 'https://github.com/octocat/Hello-World.git',
      projectRoot: root,
      spawnGit: fake,
    });
    expect(result.mode).toBe('subdir');
    expect(result.repoName).toBe('Hello-World');
  });
});
// AIGC END
