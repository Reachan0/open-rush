// AIGC START
'use client';

import type { UIMessage } from 'ai';
import { collectReliabilityEvents, reliabilitySummary } from '@/lib/reliability-events';

export function ReliabilityPanel({ messages }: { messages: UIMessage[] }) {
  const events = collectReliabilityEvents(messages);
  const summary = reliabilitySummary(events);
  if (!summary.enabled) {
    const copy =
      summary.kind === 'error'
        ? '可靠性同步异常。时间线暂时不可用，不是“健康”。'
        : summary.kind === 'waiting'
          ? '可靠性等待事件。尚未收到控制面时间线。'
          : '可靠性未启用。普通任务不会显示为“健康”。';
    return (
      <div className="p-4 text-sm text-muted-foreground" data-testid="reliability-idle">
        {copy}
      </div>
    );
  }
  return (
    <div
      className="flex h-full flex-col gap-3 overflow-auto p-4"
      data-testid="reliability-timeline"
    >
      <div className="text-sm font-medium">可靠性 · {summary.label}</div>
      {summary.kind === 'error' ? (
        <div
          className="rounded border border-destructive/40 p-2 text-xs text-destructive"
          data-testid="reliability-sync-error"
        >
          同步异常。历史时间线仍保留，当前状态不是“健康”。
        </div>
      ) : null}
      <ol className="space-y-2 text-xs">
        {events.map((event, index) => (
          <li key={event.eventId ?? `${event.type}-${index}`} className="rounded border p-2">
            <div className="font-mono">{event.type}</div>
            {event.payload != null ? (
              <pre className="mt-1 whitespace-pre-wrap break-all text-muted-foreground">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
// AIGC END
