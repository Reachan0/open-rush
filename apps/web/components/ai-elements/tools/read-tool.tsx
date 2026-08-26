// @ts-nocheck
'use client';

import { Tool, ToolContent, ToolHeader, ToolOutput, useToolOpen } from '@/components/ai-elements/tool';
import type { ToolRendererProps } from '../tool-registry';

export function ReadTool({ part }: ToolRendererProps) {
  const input = part.input as { file_path?: string; pattern?: string; path?: string } | undefined;
  const filePath = input?.file_path ?? input?.pattern ?? input?.path ?? '';
  const toolOpen = useToolOpen(part.state);

  return (
    <Tool {...toolOpen}>
      <ToolHeader
        type={part.type}
        state={part.state}
        toolName={part.toolName}
        title={filePath ? `${part.toolName} ${filePath}` : part.toolName}
      />
      <ToolContent>
        {(part.output || part.errorText) && (
          <ToolOutput output={part.output} errorText={part.errorText} />
        )}
      </ToolContent>
    </Tool>
  );
}
