// AIGC START
import { describe, expect, it } from 'vitest';
import { shouldApplyLoadedMessages } from '../chat-loaded-messages';

describe('shouldApplyLoadedMessages', () => {
  it('does not clobber an in-flight first prompt when the server has no rows yet', () => {
    expect(
      shouldApplyLoadedMessages({
        loadedCount: 0,
        localCount: 2,
        hasInitialPrompt: true,
      })
    ).toBe(false);
  });

  it('does not clobber local messages even without an initial prompt', () => {
    expect(
      shouldApplyLoadedMessages({
        loadedCount: 0,
        localCount: 1,
        hasInitialPrompt: false,
      })
    ).toBe(false);
  });

  it('applies stored history when opening an existing conversation', () => {
    expect(
      shouldApplyLoadedMessages({
        loadedCount: 4,
        localCount: 0,
        hasInitialPrompt: false,
      })
    ).toBe(true);
  });

  it('applies an empty load when the thread is still empty', () => {
    expect(
      shouldApplyLoadedMessages({
        loadedCount: 0,
        localCount: 0,
        hasInitialPrompt: false,
      })
    ).toBe(true);
  });
});
// AIGC END
