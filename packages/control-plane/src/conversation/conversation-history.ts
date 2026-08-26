// AIGC START
import { conversations, type DbClient, messages as messagesTable, runs } from '@open-rush/db';
import { and, eq, ne } from 'drizzle-orm';
import type { EventStore } from '../event-store.js';
import { reconstructMessages } from './reconstruct-messages.js';

/** Must match `@open-rush/workflow` CONVERSATION_HISTORY_HEADER / routingIntent. */
export const CONVERSATION_HISTORY_HEADER = '此前对话：';

export type HistoryTurn = {
  role: 'user' | 'assistant';
  content: string;
};

export function formatConversationHistory(turns: HistoryTurn[], maxChars = 12000): string {
  const lines = turns
    .map((turn) => {
      const text = turn.content.trim();
      if (!text) return '';
      const role = turn.role === 'assistant' ? 'Assistant' : 'User';
      return `${role}: ${text}`;
    })
    .filter(Boolean);
  let history = lines.join('\n\n');
  if (history.length <= maxChars) return history;
  history = history.slice(history.length - maxChars);
  const cut = history.indexOf('\n');
  if (cut >= 0) history = history.slice(cut + 1);
  return history.trim();
}

export function buildEnginePrompt(history: string, currentUserText: string): string {
  const trimmedHistory = history.trim();
  if (!trimmedHistory) return currentUserText;
  return `${CONVERSATION_HISTORY_HEADER}\n\n${trimmedHistory}\n\nUser: ${currentUserText}`;
}

export function createTaskHistoryLoader(db: DbClient, eventStore: EventStore) {
  return async (input: { taskId: string; currentRunId: string }): Promise<HistoryTurn[]> => {
    const prior = await db
      .select({ id: runs.id, prompt: runs.prompt })
      .from(runs)
      .where(and(eq(runs.taskId, input.taskId), ne(runs.id, input.currentRunId)))
      .orderBy(runs.createdAt);
    const fromRuns = await collectTurnsFromPriorRuns(prior, eventStore);
    if (fromRuns.length > 0) return fromRuns;

    const [conv] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.taskId, input.taskId))
      .limit(1);
    if (!conv) return [];

    const rows = await db
      .select({ role: messagesTable.role, content: messagesTable.content })
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conv.id))
      .orderBy(messagesTable.createdAt);

    const turns: HistoryTurn[] = [];
    for (const row of rows) {
      const content = extractUiMessageText(row.content).trim();
      if (!content) continue;
      turns.push({
        role: row.role === 'assistant' ? 'assistant' : 'user',
        content,
      });
    }
    return turns;
  };
}

function extractUiMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object') return '';
  const message = content as { parts?: Array<{ type?: string; text?: string }>; content?: unknown };
  if (Array.isArray(message.parts)) {
    return message.parts
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
  }
  if (typeof message.content === 'string') return message.content;
  return '';
}

export async function collectTurnsFromPriorRuns(
  prior: Array<{ id: string; prompt: string }>,
  eventStore: EventStore
): Promise<HistoryTurn[]> {
  const turns: HistoryTurn[] = [];
  for (const run of prior) {
    const events = await eventStore.getEvents(run.id);
    const messages = reconstructMessages(run.prompt, events);
    for (const message of messages) {
      const content = message.content.trim();
      if (!content) continue;
      turns.push({ role: message.role, content });
    }
  }
  return turns;
}
// AIGC END
