// AIGC START

export {
  extractAmapLocation,
  flattenAmapToolResult,
  normalizeAmapInvokeArgs,
} from './amap-flatten.js';
export {
  chatCompletionsConfigured,
  completeWithChatCompletions,
  llmCompleteFromEnv,
} from './complete-llm.js';
export {
  buildEnginePrompt,
  CONVERSATION_HISTORY_HEADER,
  formatConversationHistory,
  type HistoryTurn,
  routingIntent,
} from './conversation-history.js';
export { type ExecuteOptions, type ExecuteResult, executeWorkflow } from './engine.js';
export {
  accumulateUsage,
  createEventStoreSink,
  createMemorySink,
  createSwallowingSink,
  estimateTokens,
  toRunEvents,
} from './events.js';
export { WEEKEND_TRIP_INTENT, weekendTripDsl } from './fixtures.js';
export {
  buildGeneratePrompt,
  catalogHasAmap,
  catalogHasCoding,
  catalogHasDshRead,
  catalogHasKeenableSearch,
  catalogHasWebFetch,
  extractJson,
  type GenerateResult,
  generateWorkflowDsl,
  type LlmComplete,
  looksLikeTravelIntent,
  looksLikeWorkspaceInspect,
} from './generate.js';
export { type WorkflowGraph, type WorkflowGraphNode, workflowGraph } from './graph.js';
export { evalCondition, interpolateString, interpolateValue, lookup } from './interpolate.js';
export { runTravelAgentLoop } from './loop-simulator.js';
export {
  createLoopToolInvoker,
  deniedLoopTools,
  eligibleLoopTools,
  flattenLoopExecuteResult,
  flattenLoopToolValue,
  formatDeniedLoopToolList,
  formatEligibleLoopToolList,
  isDeniedLoopTool,
  isEligibleLoopTool,
  LOOP_TOOL_DENYLIST,
  LOOP_TOOL_POLICY,
  type LoopExecuteInput,
  type LoopExecuteResult,
  type LoopToolSchema,
  type LoopToolsLike,
  loopToolDenyReason,
  schemasToToolDescriptors,
} from './loop-tools.js';
export { workflowToMermaid } from './mermaid.js';
export { createComposeToolInvoker, createPlatformToolInvoker } from './platform-tools.js';
export {
  type AgentLane,
  chooseLane,
  extractHttpUrls,
  needsPlaceClarification,
} from './router.js';
export {
  parseWorkflowDsl,
  safeParseWorkflowDsl,
  WORKFLOW_JSON_SCHEMA,
  WorkflowDslSchema,
} from './schema.js';
export {
  createMcpToolInvoker,
  createToolInvoker,
  type McpCallTool,
  mergeToolInvokers,
  type RegisteredTool,
} from './tools.js';
export {
  createTravelToolInvoker,
  extractIntentFields,
  TRAVEL_EXCLUDED,
  travelToolDefs,
} from './travel-tools.js';
export type {
  FallbackReason,
  JsonValue,
  NodeResult,
  TokenUsage,
  ToolDescriptor,
  ToolInvoker,
  WorkflowDsl,
  WorkflowEvent,
  WorkflowEventSink,
  WorkflowGuards,
  WorkflowNode,
  WorkflowRunResult,
} from './types.js';
export { DEFAULT_GUARDS, WORKFLOW_RUN_TOOL, WorkflowError } from './types.js';
export { collectNodeRefs, detectCycle, topoWaves, validateWorkflowDsl } from './validate.js';
export { type WorkflowRunInput, workflowRun } from './workflow-run.js';
// AIGC END
