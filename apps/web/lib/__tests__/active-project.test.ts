import { beforeEach, describe, expect, it } from 'vitest';
import { resolveActiveProjectId } from '../active-project';

describe('resolveActiveProjectId', () => {
  const projects = [{ id: 'a' }, { id: 'b' }];

  beforeEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
  });

  it('prefers the requested project when it exists', () => {
    expect(resolveActiveProjectId(projects, 'b')).toBe('b');
  });

  it('falls back to the first project', () => {
    expect(resolveActiveProjectId(projects, 'missing')).toBe('a');
  });

  it('returns null when there are no projects', () => {
    expect(resolveActiveProjectId([], 'a')).toBeNull();
  });
});
