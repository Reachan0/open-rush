import { agents, conversations, type DbClient } from '@open-rush/db';
import { desc, eq } from 'drizzle-orm';

import type {
  Conversation,
  ConversationDb,
  CreateConversationInput,
} from './conversation-service.js';

type ConversationRow = typeof conversations.$inferSelect;

function mapRow(row: ConversationRow, agentName?: string | null): Conversation {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    agentId: row.agentId,
    // AIGC START
    agentName: agentName ?? null,
    // AIGC END
    userId: row.userId,
    title: row.title,
    summary: row.summary,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleConversationDb implements ConversationDb {
  constructor(private db: DbClient) {}

  async create(input: CreateConversationInput): Promise<Conversation> {
    const [row] = await this.db
      .insert(conversations)
      .values({
        projectId: input.projectId,
        taskId: input.taskId ?? null,
        userId: input.userId,
        agentId: input.agentId ?? null,
        title: input.title ?? null,
        metadata: input.metadata ?? null,
      })
      .returning();
    return mapRow(row);
  }

  async findById(id: string): Promise<Conversation | null> {
    const [row] = await this.db
      .select({
        conversation: conversations,
        agentName: agents.name,
      })
      .from(conversations)
      .leftJoin(agents, eq(conversations.agentId, agents.id))
      .where(eq(conversations.id, id))
      .limit(1);
    return row ? mapRow(row.conversation, row.agentName) : null;
  }

  async listByProject(projectId: string, limit = 50): Promise<Conversation[]> {
    const rows = await this.db
      .select({
        conversation: conversations,
        agentName: agents.name,
      })
      .from(conversations)
      .leftJoin(agents, eq(conversations.agentId, agents.id))
      .where(eq(conversations.projectId, projectId))
      .orderBy(desc(conversations.updatedAt))
      .limit(limit);
    return rows.map((row) => mapRow(row.conversation, row.agentName));
  }

  async updateTitle(id: string, title: string): Promise<Conversation | null> {
    const [row] = await this.db
      .update(conversations)
      .set({ title, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    return row ? mapRow(row) : null;
  }

  async updateSummary(id: string, summary: string): Promise<Conversation | null> {
    const [row] = await this.db
      .update(conversations)
      .set({ summary, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    return row ? mapRow(row) : null;
  }

  async remove(id: string): Promise<boolean> {
    const [row] = await this.db.delete(conversations).where(eq(conversations.id, id)).returning();
    return !!row;
  }
}
