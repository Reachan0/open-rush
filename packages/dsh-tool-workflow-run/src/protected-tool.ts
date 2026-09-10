// AIGC START
import { type JsonValue, type LoopToolResultAdapter, WorkflowError } from '@open-rush/workflow';

export const AO04_PROTECTED_TOOL_NAME = 'ao04_read_status';

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function protectedFailure(toolName: string, details: unknown): WorkflowError {
  const safeDetails = record(details) ?? { error: String(details) };
  return new WorkflowError(
    'protected_tool_failed',
    `protected_tool_failed ${toolName}: ${JSON.stringify(safeDetails)}`,
    undefined,
    undefined,
    { fatal: true, details: safeDetails as JsonValue }
  );
}

export function parseProtectedToolResult(value: unknown, toolName: string): JsonValue {
  const envelope = record(value);
  if (!envelope || typeof envelope.text !== 'string') {
    throw protectedFailure(toolName, { error: 'missing text result envelope', value });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope.text);
  } catch (error) {
    throw protectedFailure(toolName, {
      error: `malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
      text: envelope.text,
    });
  }
  const payload = record(parsed);
  if (!payload)
    throw protectedFailure(toolName, { error: 'result payload must be an object', value: parsed });
  const data = record(payload.data);
  const valid =
    payload.status === 'ok' &&
    payload.degraded !== true &&
    (payload.errorClass === null ||
      payload.errorClass === undefined ||
      payload.errorClass === '') &&
    data?.ready === true;
  if (!valid) throw protectedFailure(toolName, payload);
  return payload as JsonValue;
}

export function createProtectedToolResultAdapter(toolName: string): LoopToolResultAdapter {
  return {
    success: (value) => parseProtectedToolResult(value, toolName),
    failure: ({ error, result }) =>
      protectedFailure(toolName, {
        error:
          result?.error?.message ??
          (error instanceof Error
            ? error.message
            : error === undefined
              ? 'tool failed'
              : String(error)),
      }),
  };
}
// AIGC END
