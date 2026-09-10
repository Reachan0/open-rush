// AIGC START
import { describe, expect, it } from 'vitest';
import {
  consumeOuterRepair,
  filterOuterLoopCatalog,
  isOuterLoopTool,
  markOuterRepair,
} from '../filter-outer-catalog.js';

describe('filterOuterLoopCatalog', () => {
  it('keeps workflow_run and denied tools, hides graph-eligible ones', () => {
    const out = filterOuterLoopCatalog({
      tools: [
        { name: 'workflow_run' },
        { name: 'web_fetch' },
        { name: 'bash' },
        { name: 'read' },
        { name: 'mcp__amap-maps__maps_geo' },
        { name: 'todo_write' },
      ],
      sections: [
        { name: 'tool:web_fetch', text: 'Use the web_fetch tool to retrieve a URL.' },
        { name: 'tool:bash', text: 'Use bash.' },
        { name: 'tool:workflow_run', text: '快车道' },
      ],
    });
    expect(out.tools.map((tool) => tool.name).sort()).toEqual([
      'bash',
      'todo_write',
      'workflow_run',
    ]);
    expect(out.sections.find((s) => s.name === 'tool:web_fetch')?.text).toMatch(/不要直接调用/);
    expect(out.sections.find((s) => s.name === 'tool:bash')?.text).toBe('Use bash.');
    expect(out.sections.find((s) => s.name === 'tool:workflow_run')?.text).toBe('快车道');
  });

  it('treats workflow_run as outer-visible even though it cannot enter the graph', () => {
    expect(isOuterLoopTool('workflow_run')).toBe(true);
    expect(isOuterLoopTool('web_fetch')).toBe(false);
    expect(isOuterLoopTool('bash')).toBe(true);
  });

  it('keeps graph-eligible tools visible while a repair token is active', () => {
    const scope = { id: 'repair-agent' };
    markOuterRepair(scope);
    expect(consumeOuterRepair(scope)).toBe(true);
    const out = filterOuterLoopCatalog(
      {
        tools: [{ name: 'workflow_run' }, { name: 'web_fetch' }, { name: 'bash' }],
        sections: [{ name: 'tool:web_fetch', text: 'Use web_fetch' }],
      },
      { repair: true }
    );
    expect(out.tools.map((tool) => tool.name)).toContain('web_fetch');
    expect(out.sections.find((s) => s.name === 'tool:web_fetch')?.text).toBe('Use web_fetch');
    expect(consumeOuterRepair(scope)).toBe(true);
    expect(consumeOuterRepair(scope)).toBe(false);
  });
});
// AIGC END
