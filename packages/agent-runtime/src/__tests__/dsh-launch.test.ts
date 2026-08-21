// AIGC START
import { describe, expect, it } from 'vitest';
import { resolveAgentRuntime } from '../dsh-launch.js';

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
    expect(resolveAgentRuntime({ AGENT_RUNTIME: 'deepseek' })).toBe('dsh');
  });
});
// AIGC END
