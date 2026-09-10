import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkflowDag } from '../workflow-dag';

describe('WorkflowDag', () => {
  it('renders visible strokes for zero-width vertical edges', () => {
    const markup = renderToStaticMarkup(
      createElement(WorkflowDag, {
        graph: {
          name: 'vertical',
          nodes: [
            { id: 'first', tool: 'read', dependsOn: [] },
            { id: 'second', tool: 'read', dependsOn: ['first'] },
          ],
          edges: [{ from: 'first', to: 'second' }],
          waves: [['first'], ['second']],
        },
        statuses: { first: 'completed', second: 'completed' },
        selectedId: null,
        onSelect: () => undefined,
      })
    );

    expect(markup).toContain('gradientUnits="userSpaceOnUse"');
    expect(markup).toContain('marker-end="url(#or-dag-arrow-');
  });
});
