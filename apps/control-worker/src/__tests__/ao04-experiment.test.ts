import { describe, expect, it } from 'vitest';
import { resolveAo04ExperimentId } from '../ao04-experiment.js';

describe('resolveAo04ExperimentId', () => {
  it('uses the fixed service identity in service demo mode', () => {
    expect(
      resolveAo04ExperimentId('run-123', {
        AO04_SERVICE_DEMO: '1',
        AO04_EXPERIMENT_ID: 'legacy-exp',
      })
    ).toBe('ao04-demo-local');
  });

  it('preserves the configured experiment outside service demo mode', () => {
    expect(resolveAo04ExperimentId('run-123', { AO04_EXPERIMENT_ID: 'configured-exp' })).toBe(
      'configured-exp'
    );
  });

  it('falls back to a run-scoped experiment outside service demo mode', () => {
    expect(resolveAo04ExperimentId('run-123', {})).toBe('ao04-run-123');
  });
});
