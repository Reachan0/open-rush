// AIGC START
import { isEligibleLoopTool } from '@open-rush/workflow';
import { WORKFLOW_RUN_TOOL_NAME } from './workflow-run-tool.js';

const repairTokens = new WeakMap<object, number>();
let anonymousRepair = 0;

export function markOuterRepair(scope?: unknown): void {
  if (scope && typeof scope === 'object') {
    repairTokens.set(scope, 2);
    return;
  }
  anonymousRepair = 2;
}

export function consumeOuterRepair(scope?: unknown): boolean {
  if (scope && typeof scope === 'object' && repairTokens.has(scope)) {
    const left = repairTokens.get(scope) ?? 0;
    if (left <= 0) {
      repairTokens.delete(scope);
      return false;
    }
    if (left === 1) repairTokens.delete(scope);
    else repairTokens.set(scope, left - 1);
    return true;
  }
  if (anonymousRepair > 0) {
    anonymousRepair -= 1;
    return true;
  }
  return false;
}

export interface OuterCatalogTool {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface OuterCatalogSection {
  name: string;
  text: string;
}

export interface OuterCatalogAssembly {
  tools: OuterCatalogTool[];
  sections: OuterCatalogSection[];
}

/** Tools the outer Loop model may still see: 快车道入口 + 不能进图的（改文件/bash/问人）。 */
export function isOuterLoopTool(name: string): boolean {
  return name === WORKFLOW_RUN_TOOL_NAME || !isEligibleLoopTool(name);
}

/**
 * 快车道挂上之后，可进图的工具从外层目录拿掉，只留 workflow_run 和不能进图的工具。
 * 引擎仍通过 ctx.tools.execute 调那些工具；这里只改模型看到的 catalog。
 */
export function filterOuterLoopCatalog<T extends OuterCatalogAssembly>(
  assembly: T,
  options?: { repair?: boolean }
): T {
  if (options?.repair) return assembly;
  const hidden = new Set(
    assembly.tools.filter((tool) => !isOuterLoopTool(tool.name)).map((tool) => tool.name)
  );
  assembly.sections = assembly.sections.map((section) => {
    const toolName = section.name.startsWith('tool:') ? section.name.slice('tool:'.length) : '';
    if (!toolName || !hidden.has(toolName)) return section;
    return {
      ...section,
      text: `${toolName} 已并入快车道，不要直接调用。需要抓取、检索或对照多路材料时调用 workflow_run。`,
    };
  });
  assembly.tools = assembly.tools.filter((tool) => isOuterLoopTool(tool.name));
  return assembly;
}
// AIGC END
