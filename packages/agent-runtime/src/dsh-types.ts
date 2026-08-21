// AIGC START
export type AgentRuntimeKind = 'dsh' | 'claude-code';

export interface UIMessageChunk {
  type: string;
  [key: string]: unknown;
}

export interface DshLaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  binPath: string;
  cordisPath: string;
  repoRoot: string;
}

export interface DshInitializeParams {
  cwd: string;
  provider: string;
  model: string;
  maxTokens?: number;
}

export interface DshRunInput {
  prompt: string;
  sessionId: string;
  systemPrompt?: string;
  modelId?: string;
  provider?: string;
  cwd?: string;
  abortSignal?: AbortSignal;
  env?: Record<string, string>;
  maxTokens?: number;
}

export interface DshNotification {
  method: string;
  params: Record<string, unknown>;
}
// AIGC END
