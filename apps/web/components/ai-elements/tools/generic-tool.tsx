// @ts-nocheck
'use client';

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  useToolOpen,
} from '@/components/ai-elements/tool';
import { prettyToolName } from '@/lib/workflow-dag-model';
import type { ToolRendererProps } from '../tool-registry';

/**
 * Fallback renderer for unknown/custom tools.
 */
export function GenericTool({ part }: ToolRendererProps) {
  const toolOpen = useToolOpen(part.state);
  return (
    <Tool {...toolOpen}>
      <ToolHeader
        type={part.type}
        state={part.state}
        toolName={part.toolName}
        title={prettyToolName(part.toolName)}
      />
      <ToolContent>
        {part.input && <ToolInput input={part.input} />}
        {(part.output || part.errorText) && (
          <ToolOutput output={part.output} errorText={part.errorText} />
        )}
      </ToolContent>
    </Tool>
  );
}
