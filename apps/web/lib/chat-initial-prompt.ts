// AIGC START
const SENT_PREFIX = 'openrush:initial-prompt-sent:';

export function initialPromptStorageKey(conversationId: string): string {
  return `${SENT_PREFIX}${conversationId}`;
}

export function hasSentInitialPrompt(
  conversationId: string,
  storage: Pick<Storage, 'getItem'>
): boolean {
  return storage.getItem(initialPromptStorageKey(conversationId)) === '1';
}

export function markInitialPromptSent(
  conversationId: string,
  storage: Pick<Storage, 'setItem'>
): void {
  storage.setItem(initialPromptStorageKey(conversationId), '1');
}

/** First URL prompt is a one-shot bootstrap, never a refresh replay. */
export function shouldSendUrlPrompt(opts: {
  prompt: string;
  alreadySent: boolean;
  messageCount: number;
  historyHydrated: boolean;
}): boolean {
  if (!opts.prompt.trim()) return false;
  if (!opts.historyHydrated) return false;
  if (opts.alreadySent) return false;
  if (opts.messageCount > 0) return false;
  return true;
}

export function stripQueryParam(search: string, key: string): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  params.delete(key);
  return params.toString();
}
// AIGC END
