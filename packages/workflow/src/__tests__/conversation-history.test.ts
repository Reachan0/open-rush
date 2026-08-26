// AIGC START
import { describe, expect, it } from 'vitest';
import {
  buildEnginePrompt,
  CONVERSATION_HISTORY_HEADER,
  formatConversationHistory,
  type HistoryTurn,
  routingIntent,
} from '../conversation-history.js';
import { chooseLane } from '../router.js';

describe('formatConversationHistory', () => {
  it('formats user and assistant turns', () => {
    const turns: HistoryTurn[] = [
      { role: 'user', content: '我叫小明' },
      { role: 'assistant', content: '你好，小明' },
    ];
    expect(formatConversationHistory(turns)).toBe('User: 我叫小明\n\nAssistant: 你好，小明');
  });

  it('skips empty turns and trims whitespace', () => {
    const turns: HistoryTurn[] = [
      { role: 'user', content: '  hi  ' },
      { role: 'assistant', content: '   ' },
      { role: 'assistant', content: 'ok' },
    ];
    expect(formatConversationHistory(turns)).toBe('User: hi\n\nAssistant: ok');
  });

  it('keeps the most recent tail when over the char budget', () => {
    const turns: HistoryTurn[] = [
      { role: 'user', content: 'AAAAAAAAAA' },
      { role: 'assistant', content: 'BBBBBBBBBB' },
      { role: 'user', content: 'CCCCCCCCCC' },
    ];
    const formatted = formatConversationHistory(turns, 24);
    expect(formatted.length).toBeLessThanOrEqual(24);
    expect(formatted).toContain('CCCCCCCCCC');
    expect(formatted).not.toContain('AAAAAAAAAA');
  });
});

describe('buildEnginePrompt', () => {
  it('returns the current user text when history is empty', () => {
    expect(buildEnginePrompt('', '下一句')).toBe('下一句');
  });

  it('wraps history so the current turn stays identifiable', () => {
    const prompt = buildEnginePrompt('User: 我叫小明\n\nAssistant: 你好', '我叫什么？');
    expect(prompt.startsWith(CONVERSATION_HISTORY_HEADER)).toBe(true);
    expect(prompt).toContain('User: 我叫小明');
    expect(prompt.endsWith('User: 我叫什么？')).toBe(true);
  });
});

describe('routingIntent', () => {
  it('returns the original prompt when there is no history wrapper', () => {
    expect(routingIntent('搜一下杭州周末')).toBe('搜一下杭州周末');
  });

  it('uses only the current user turn for lane routing', () => {
    const prompt = buildEnginePrompt(
      'User: 帮我搜一下杭州周末去处',
      '帮我看看这段 TypeScript 报错'
    );
    expect(routingIntent(prompt)).toBe('帮我看看这段 TypeScript 报错');
    expect(chooseLane(prompt)).toBe('workflow');
    expect(chooseLane(routingIntent(prompt))).toBe('loop');
  });
});
// AIGC END
