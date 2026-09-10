import { randomUUID } from 'node:crypto';
import { DrizzleAgentConfigStore, ProjectAgentService } from '@open-rush/control-plane';
import type { DbClient } from '@open-rush/db';

// AIGC START
const DEFAULT_AGENT = {
  name: 'OpenRush',
  description:
    '通用工作 Agent：问答检索、工作流、代码与文件、文档、数据分析，以及 Skills / MCP 工具。',
  systemPrompt: `你是 OpenRush，部署在用户自有基础设施上的托管 Agent 助手，不是「只会做网页」的开发机器人。

你能帮用户做的日常工作包括：
- 问答、检索、总结网页/文档，查路线、天气、地点等（有工具时优先调用）
- 快车道工具 workflow_run：看系统提示里当时那份可进图工具名单。多路一次查完再成文就调用，不要因为这些工具 Loop 里也能点、或本对话已经用过快车道，就把新问题改成逐步调工具。不要按关键词或预设场景决定。某一次返回后只检查那一句能不能交付；够了据此回复，不够或失败用其它工具补那一句。新 MCP 挂进 Loop 后自动共享，不必再给快车道单独注册。
- 读改项目工作区里的代码和文件、跑命令
- 写文档、整理材料、做数据与表格分析
- 使用已安装的 Skills 与 MCP 服务器扩展能力

自我介绍时请说明上述广度，不要把自己说成「Web 开发助手」。对用户不要报宿主机绝对路径（不要出现 /Users/...、本机仓库或 workspace 物理目录），只说「当前项目空间」或相对路径。用户用什么语言，你就用什么语言回复。能动手完成的事先用工具做，再给结论。`,
  maxSteps: 30,
  deliveryMode: 'workspace' as const,
};
// AIGC END

export async function resolveAgentIdForProject(options: {
  db: DbClient;
  projectId: string;
  userId: string;
  requestedAgentId?: string | null;
}): Promise<string> {
  const { db, projectId, userId, requestedAgentId } = options;
  const agentStore = new DrizzleAgentConfigStore(db);
  const projectAgentService = new ProjectAgentService(db);

  if (requestedAgentId) {
    const existingAgent = await agentStore.getById(requestedAgentId);
    if (
      !existingAgent ||
      existingAgent.projectId !== projectId ||
      existingAgent.status !== 'active'
    ) {
      throw new Error('Agent does not belong to this project');
    }
    await projectAgentService.setCurrentAgent(projectId, requestedAgentId);
    return requestedAgentId;
  }

  const current = await projectAgentService.getCurrentAgent(projectId);
  if (current) {
    return current.agentId;
  }

  const projectAgents = await agentStore.getProjectAgents(projectId);
  if (projectAgents.length > 0) {
    const fallbackAgentId = projectAgents[0].id;
    await projectAgentService.setCurrentAgent(projectId, fallbackAgentId);
    return fallbackAgentId;
  }

  const createdAgent = await agentStore.create({
    id: randomUUID(),
    projectId,
    scope: 'project',
    status: 'active',
    name: DEFAULT_AGENT.name,
    description: DEFAULT_AGENT.description,
    systemPrompt: DEFAULT_AGENT.systemPrompt,
    maxSteps: DEFAULT_AGENT.maxSteps,
    deliveryMode: DEFAULT_AGENT.deliveryMode,
    createdBy: userId,
  });

  await projectAgentService.setCurrentAgent(projectId, createdAgent.id);
  return createdAgent.id;
}
