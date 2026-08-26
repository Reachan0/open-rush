// AIGC START
import type { WorkflowEvent, WorkflowEventSink } from './types.js';

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function accumulateUsage(parts: string[]): {
  promptChars: number;
  completionChars: number;
  estimatedTokens: number;
} {
  const joined = parts.join('');
  return {
    promptChars: joined.length,
    completionChars: 0,
    estimatedTokens: estimateTokens(joined),
  };
}

export function createMemorySink(): { sink: WorkflowEventSink; events: WorkflowEvent[] } {
  const events: WorkflowEvent[] = [];
  return {
    events,
    sink: {
      emit(event) {
        events.push(event);
      },
    },
  };
}

export interface RunEventLike {
  runId: string;
  eventType: string;
  payload: unknown;
  schemaVersion: string;
}

/** Map engine events onto the control-plane EventStore shape (seq assigned later). */
export function toRunEvents(runId: string, events: WorkflowEvent[]): RunEventLike[] {
  return events.map((event) => ({
    runId,
    eventType: event.eventType,
    payload: event.payload,
    schemaVersion: '1',
  }));
}

export function createEventStoreSink(
  append: (event: RunEventLike) => Promise<unknown> | unknown,
  runId: string
): WorkflowEventSink {
  return {
    async emit(event) {
      await append({
        runId,
        eventType: event.eventType,
        payload: event.payload,
        schemaVersion: '1',
      });
    },
  };
}

export function createSwallowingSink(inner: WorkflowEventSink): WorkflowEventSink {
  return {
    async emit(event) {
      try {
        await inner.emit(event);
      } catch {
        // B8
      }
    },
  };
}
// AIGC END
