// AIGC START
/**
 * Whether GET /messages should replace the in-memory transcript.
 *
 * New chats send the first user turn from `?prompt=` before the DB row exists.
 * Applying an empty load would wipe that optimistic user message, leaving only
 * the assistant reply that streams in afterwards.
 */
export function shouldApplyLoadedMessages(opts: {
  loadedCount: number;
  localCount: number;
  hasInitialPrompt: boolean;
}): boolean {
  if (opts.loadedCount === 0 && (opts.hasInitialPrompt || opts.localCount > 0)) {
    return false;
  }
  return true;
}
// AIGC END
