// AIGC START
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

describe('AO04 demo composition', () => {
  it('ships an isolated cordis-ao04.yml next to the default composition', () => {
    const here = fileURLToPath(new URL('.', import.meta.url));
    const yaml = join(here, '../../../../apps/agent-worker/dsh/cordis-ao04.yml');
    expect(existsSync(yaml)).toBe(true);
    const text = readFileSync(yaml, 'utf8');
    expect(text).toContain('tool-ao04-read-status');
    expect(text).not.toContain('workflow_run');
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
