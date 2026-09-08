// AIGC START

import { ao04ReadStatusToolDefinition } from './read-status-tool.js';
import { importDefineTool } from './resolve-dsh-tools.js';

export const name = 'tool-ao04-read-status';
export const inject = ['tools', 'systemPrompt'];

export interface Config {
  timeoutMs?: number;
  promptOrder?: number;
}

type PluginCtx = {
  tools: { register: (tool: unknown) => void };
  systemPrompt: {
    section: (input: { name: string; order: number; text: () => string }) => void;
  };
};

export async function apply(ctx: PluginCtx, config: Config = {}): Promise<void> {
  try {
    const defineTool = (await importDefineTool()) as Parameters<
      typeof ao04ReadStatusToolDefinition
    >[0];
    const tool = ao04ReadStatusToolDefinition(defineTool);
    ctx.tools.register(tool);
    ctx.systemPrompt.section({
      name: 'tool:ao04_read_status',
      order: config.promptOrder ?? 109,
      text: () =>
        '已接入 ao04_read_status。读取受保护本地测试状态。控制服务不可用时该工具失败，不要直连依赖或猜测 PID。',
    });
    process.stderr.write('[ao04_read_status] registered\n');
  } catch (err) {
    process.stderr.write(
      `[ao04_read_status] apply failed (preset still mounts): ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`
    );
  }
}
// AIGC END
