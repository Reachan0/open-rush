import { WorkflowError } from '@open-rush/workflow';
import { describe, expect, it } from 'vitest';
import { createProtectedToolResultAdapter, parseProtectedToolResult } from '../protected-tool.js';

const okPayload = {
  status: 'ok',
  degraded: false,
  errorClass: null,
  evidenceRefs: ['evidence-1'],
  data: { ready: true, value: 'healthy' },
};

describe('protected tool result adapter', () => {
  it('parses the DSH {text: JSON} envelope only for the protected adapter', () => {
    expect(
      parseProtectedToolResult({ text: JSON.stringify(okPayload) }, 'ao04_read_status')
    ).toEqual(okPayload);
  });

  it.each([
    ['degraded status', { ...okPayload, status: 'degraded', degraded: true }],
    ['failed status', { ...okPayload, status: 'failed' }],
    ['human required status', { ...okPayload, status: 'human_required' }],
    ['cancelled status', { ...okPayload, status: 'cancelled' }],
    ['pending status', { ...okPayload, status: 'pending' }],
    ['unknown status', { ...okPayload, status: 'unknown' }],
    ['ok but degraded flag', { ...okPayload, degraded: true }],
    ['not ready data', { ...okPayload, data: { ready: false } }],
    ['conflicting error class', { ...okPayload, errorClass: 'dependency_timeout' }],
  ])('rejects %s as a fatal typed error while retaining evidence', (_label, payload) => {
    expect(() =>
      parseProtectedToolResult({ text: JSON.stringify(payload) }, 'ao04_read_status')
    ).toThrow(WorkflowError);
    try {
      parseProtectedToolResult({ text: JSON.stringify(payload) }, 'ao04_read_status');
    } catch (err) {
      expect(err).toMatchObject({
        code: 'protected_tool_failed',
        fatal: true,
        details: expect.objectContaining({ evidenceRefs: ['evidence-1'] }),
      });
    }
  });

  it.each([
    ['missing text envelope', { status: 'ok', data: { ready: true } }],
    ['malformed json', { text: '{not-json' }],
    ['array payload', { text: '[1,2,3]' }],
  ])('rejects %s as a fatal malformed result', (_label, value) => {
    expect(() => parseProtectedToolResult(value, 'ao04_read_status')).toThrowError(
      /protected_tool_failed/
    );
  });

  it('turns DSH transport errors into the same fatal error contract', () => {
    const adapter = createProtectedToolResultAdapter('ao04_read_status');
    const error = adapter.failure?.({
      error: new Error('control service unavailable'),
      result: { isError: true, error: { message: 'HTTP 503' } },
    });
    expect(error).toMatchObject({ code: 'protected_tool_failed', fatal: true });
    expect(error?.details).toMatchObject({ error: expect.stringContaining('HTTP 503') });
  });
});
