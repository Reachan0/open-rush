// AIGC START
import { describe, expect, it } from 'vitest';
import {
  hasSentInitialPrompt,
  markInitialPromptSent,
  shouldSendUrlPrompt,
  stripQueryParam,
} from '../chat-initial-prompt';

describe('shouldSendUrlPrompt', () => {
  it('does not resend after a refresh when the prompt was already consumed', () => {
    expect(
      shouldSendUrlPrompt({
        prompt: '你好',
        alreadySent: true,
        messageCount: 0,
        historyHydrated: true,
      })
    ).toBe(false);
  });

  it('does not send until conversation history has been fetched', () => {
    expect(
      shouldSendUrlPrompt({
        prompt: '你好',
        alreadySent: false,
        messageCount: 0,
        historyHydrated: false,
      })
    ).toBe(false);
  });

  it('does not send when history already has messages', () => {
    expect(
      shouldSendUrlPrompt({
        prompt: '你好',
        alreadySent: false,
        messageCount: 2,
        historyHydrated: true,
      })
    ).toBe(false);
  });

  it('sends once after hydrate when the thread is still empty', () => {
    expect(
      shouldSendUrlPrompt({
        prompt: '你好',
        alreadySent: false,
        messageCount: 0,
        historyHydrated: true,
      })
    ).toBe(true);
  });
});

describe('stripQueryParam', () => {
  it('removes prompt and keeps the rest of the query', () => {
    expect(stripQueryParam('projectId=p1&taskId=t1&prompt=hello&agent=OpenRush', 'prompt')).toBe(
      'projectId=p1&taskId=t1&agent=OpenRush'
    );
  });
});

describe('initial prompt sent marker', () => {
  it('round-trips through storage', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    expect(hasSentInitialPrompt('conv-1', storage)).toBe(false);
    markInitialPromptSent('conv-1', storage);
    expect(hasSentInitialPrompt('conv-1', storage)).toBe(true);
    expect(hasSentInitialPrompt('conv-2', storage)).toBe(false);
  });
});
// AIGC END
