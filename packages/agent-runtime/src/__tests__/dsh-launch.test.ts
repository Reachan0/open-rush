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
