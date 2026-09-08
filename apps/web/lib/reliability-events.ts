// AIGC START
export interface ReliabilityTimelineEvent {
  eventId?: string;
  type: string;
  sourceSeq?: number;
  experimentId?: string;
  payload?: unknown;
}

export function collectReliabilityEvents(
  messages: Array<{ parts?: Array<{ type?: string; data?: unknown }> }>
): ReliabilityTimelineEvent[] {
  const out: ReliabilityTimelineEvent[] = [];
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type !== 'data-openrush-reliability') continue;
      const data = part.data as
        | { data?: ReliabilityTimelineEvent }
        | ReliabilityTimelineEvent
        | undefined;
      if (!data) continue;
      if ('data' in data && data.data) out.push(data.data);
      else out.push(data as ReliabilityTimelineEvent);
    }
  }
  return out;
}

export function reliabilitySummary(events: ReliabilityTimelineEvent[]): {
  enabled: boolean;
  kind: 'idle' | 'waiting' | 'error' | 'live';
  label: string;
} {
  const last = events[events.length - 1];
  const lastPayload = (last?.payload ?? {}) as { state?: string };
  const timeline = events.filter((event) => event.type !== 'reliability.sync');
  if (timeline.length === 0) {
    if (last?.type === 'reliability.sync' && lastPayload.state === 'error') {
      return { enabled: false, kind: 'error', label: '同步异常' };
    }
    if (last?.type === 'reliability.sync' && lastPayload.state === 'waiting') {
      return { enabled: false, kind: 'waiting', label: '等待事件' };
    }
    return { enabled: false, kind: 'idle', label: '未启用' };
  }
  const lastSync = [...events].reverse().find((event) => event.type === 'reliability.sync');
  const syncPayload = (lastSync?.payload ?? {}) as { state?: string };
  if (lastSync && syncPayload.state === 'error') {
    return { enabled: true, kind: 'error', label: '同步异常' };
  }
  return {
    enabled: true,
    kind: 'live',
    label:
      last?.type === 'reliability.sync'
        ? (timeline.at(-1)?.type ?? 'running')
        : (last?.type ?? 'running'),
  };
}
// AIGC END
