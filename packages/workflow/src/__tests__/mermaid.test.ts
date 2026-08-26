// AIGC START
import { describe, expect, it } from 'vitest';
import { weekendTripDsl } from '../fixtures.js';
import { workflowToMermaid } from '../mermaid.js';

describe('workflowToMermaid', () => {
  it('emits a TD flowchart with locate fan-out and article join', () => {
    const mermaid = workflowToMermaid(weekendTripDsl());
    expect(mermaid.startsWith('flowchart TD')).toBe(true);
    expect(mermaid).toContain('locate["locate\\ngeo.locate"]');
    expect(mermaid).toContain('locate --> sights');
    expect(mermaid).toContain('locate --> foods');
    expect(mermaid).toContain('sights -->|"if"| filter');
    expect(mermaid).toContain('filter --> article');
    expect(mermaid).toContain('transit --> article');
  });
});
// AIGC END
