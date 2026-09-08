// AIGC START
import { describe, expect, it } from 'vitest';
import { collectReliabilityEvents, reliabilitySummary } from '../reliability-events';

describe('reliability events', () => {
  it('does not call ordinary tasks healthy', () => {
    expect(reliabilitySummary([]).label).toBe('未启用');
    expect(reliabilitySummary([]).enabled).toBe(false);
    expect(reliabilitySummary([]).kind).toBe('idle');
  });

  it('distinguishes waiting and sync error from idle', () => {
    expect(
      reliabilitySummary([{ type: 'reliability.sync', payload: { state: 'waiting' } }])
    ).toMatchObject({ kind: 'waiting', label: '等待事件', enabled: false });
    expect(
      reliabilitySummary([{ type: 'reliability.sync', payload: { state: 'error' } }])
    ).toMatchObject({ kind: 'error', label: '同步异常', enabled: false });
  });

  it('keeps the timeline visible when a later sync error arrives', () => {
    expect(
      reliabilitySummary([
        { type: 'baseline.ready' },
        { type: 'reliability.sync', payload: { state: 'error', detail: 'HTTP 500' } },
      ])
    ).toMatchObject({ enabled: true, kind: 'error', label: '同步异常' });
  });

  it('collects data-openrush-reliability parts', () => {
    const events = collectReliabilityEvents([
      {
        parts: [
          {
            type: 'data-openrush-reliability',
            data: { data: { type: 'baseline.ready', eventId: '1' } },
          },
        ],
      },
    ]);
    expect(events).toEqual([{ type: 'baseline.ready', eventId: '1' }]);
  });
});
// AIGC END
