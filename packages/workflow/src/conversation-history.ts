// AIGC START
export const CONVERSATION_HISTORY_HEADER = '此前对话：';

export type HistoryTurn = {
  role: 'user' | 'assistant' | string;
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

export function routingIntent(prompt: string): string {
  if (!prompt.startsWith(CONVERSATION_HISTORY_HEADER)) return prompt;
  const marker = '\n\nUser: ';
  const index = prompt.lastIndexOf(marker);
  if (index < 0) return prompt;
  return prompt.slice(index + marker.length);
}
// AIGC END
