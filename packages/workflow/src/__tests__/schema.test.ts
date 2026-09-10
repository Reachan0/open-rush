// AIGC START
import { describe, expect, it } from 'vitest';
import { interpolateString, interpolateValue, lookup } from '../interpolate.js';
import { parseWorkflowDsl, WORKFLOW_JSON_SCHEMA } from '../schema.js';
import { WorkflowError } from '../types.js';
import { topoWaves, validateWorkflowDsl } from '../validate.js';

describe('DSL schema and validation (F1)', () => {
  it('accepts a linear DAG and rejects unknown dependsOn', () => {
    const dsl = parseWorkflowDsl({
      version: '1',
      nodes: [
        { id: 'a', tool: 'echo' },
        { id: 'b', tool: 'echo', dependsOn: ['a'] },
      ],
    });
    expect(topoWaves(dsl)).toEqual([['a'], ['b']]);
    expect(() =>
      validateWorkflowDsl({
        version: '1',
        nodes: [{ id: 'a', tool: 'echo', dependsOn: ['missing'] }],
      })
    ).toThrow(WorkflowError);
  });

  it('adds dependsOn when a node interpolates another node without declaring it', () => {
    const { waves } = validateWorkflowDsl({
      version: '1',
      nodes: [
        { id: 'search', tool: 'echo' },
        {
          id: 'read',
          tool: 'echo',
          input: { path: '{{nodes.search.output.path}}' },
        },
      ],
    });
    expect(waves).toEqual([['search'], ['read']]);
  });

  it('detects cycles and duplicate ids', () => {
    expect(() =>
      validateWorkflowDsl({
        version: '1',
        nodes: [
          { id: 'a', tool: 'echo', dependsOn: ['b'] },
          { id: 'b', tool: 'echo', dependsOn: ['a'] },
        ],
      })
    ).toThrow(/cycle/);
    expect(() =>
      validateWorkflowDsl({
        version: '1',
        nodes: [
          { id: 'a', tool: 'echo' },
          { id: 'a', tool: 'echo' },
        ],
      })
    ).toThrow(/duplicate/);
  });

  it.each([
    { dependsOn: ['self'] },
    { input: { query: '{{nodes.self.output.query}}' } },
    { if: '{{nodes.self.output.ready}}' },
    { foreach: '{{nodes.self.output.items}}' },
  ])('rejects explicit or inferred self-dependency: %j', (extra) => {
    expect(() =>
      validateWorkflowDsl({
        version: '1',
        name: 'self-reference',
        nodes: [{ id: 'self', tool: 'read', input: { file_path: 'test.txt' }, ...extra }],
      })
    ).toThrow(/itself|cycle/);
  });

  it('exports a JSON Schema object', () => {
    expect(WORKFLOW_JSON_SCHEMA.required).toContain('nodes');
  });
});

describe('interpolation', () => {
  it('reads node output paths and substitutes in objects', () => {
    const ctx = {
      intent: { text: 'hello' },
      nodes: { locate: { output: { city: '上海' } } },
    };
    expect(lookup('nodes.locate.output.city', ctx)).toBe('上海');
    expect(interpolateString('go {{nodes.locate.output.city}}', ctx)).toBe('go 上海');
    expect(interpolateValue({ q: '{{intent.text}}' }, ctx)).toEqual({ q: 'hello' });
  });
});
// AIGC END
