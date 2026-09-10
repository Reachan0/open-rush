// AIGC START
import { describe, expect, it } from 'vitest';
import { parseAgentRuntimeKind, resolveAgentRuntime } from '../dsh-launch.js';

describe('resolveAgentRuntime', () => {
  it('defaults to dsh', () => {
    expect(resolveAgentRuntime({})).toBe('dsh');
  });

  it('accepts claude-code aliases', () => {
    expect(resolveAgentRuntime({ AGENT_RUNTIME: 'claude-code' })).toBe('claude-code');
    expect(resolveAgentRuntime({ AGENT_RUNTIME: 'CC' })).toBe('claude-code');
    expect(resolveAgentRuntime({ AGENT_RUNTIME: 'claude' })).toBe('claude-code');
  });

  it('treats unknown values as dsh', () => {
    expect(resolveAgentRuntime({ AGENT_RUNTIME: 'unknown-engine' })).toBe('dsh');
  });
});

describe('buildDshChildEnv workflow tool', () => {
  it('points the native tool at the local workflow-run HTTP entry', async () => {
    const { buildDshChildEnv } = await import('../dsh-launch.js');
    const env = buildDshChildEnv({
      env: { PORT: '8799', OPENRUSH_WORKFLOW_RUN_URL: '' },
      cwd: '/tmp/proj',
      repoRoot: '/tmp/dsh',
    });
    expect(env.OPENRUSH_WORKFLOW_RUN_URL).toBe('http://127.0.0.1:8799/workflow-run');
    expect(env.DSH_CWD).toBe('/tmp/proj');
    expect(env.WORKFLOW_WORKSPACE).toBe('/tmp/proj');
  });

  it('keeps an explicit WORKFLOW_WORKSPACE when spawning the DSH child', async () => {
    const { buildDshChildEnv } = await import('../dsh-launch.js');
    const env = buildDshChildEnv({
      env: { WORKFLOW_WORKSPACE: '/explicit/repo' },
      cwd: '/tmp/proj',
    });
    expect(env.DSH_CWD).toBe('/tmp/proj');
    expect(env.WORKFLOW_WORKSPACE).toBe('/explicit/repo');
  });
});

describe('parseAgentRuntimeKind', () => {
  it('parses explicit request values', () => {
    expect(parseAgentRuntimeKind('dsh')).toBe('dsh');
    expect(parseAgentRuntimeKind('deepseek')).toBe('dsh');
    expect(parseAgentRuntimeKind('claude-code')).toBe('claude-code');
    expect(parseAgentRuntimeKind('nope')).toBeUndefined();
    expect(parseAgentRuntimeKind(1)).toBeUndefined();
  });
});
// AIGC END
