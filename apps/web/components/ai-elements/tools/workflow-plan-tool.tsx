// AIGC START
'use client';

import { ChevronDown, GitBranch, PanelRightOpen } from 'lucide-react';
import { useMemo, useState } from 'react';
import { WorkflowDag } from '@/components/chat/workflow-dag';
import { useWorkflowDagPanel } from '@/components/chat/workflow-dag-context';
import {
  collectNodeStatuses,
  countDagProgress,
  parseWorkflowGraph,
} from '@/lib/workflow-dag-model';
import type { ToolRendererProps } from '../tool-registry';

export function WorkflowPlanTool({ part, message }: ToolRendererProps) {
  const graph = parseWorkflowGraph(part.output);
  const statuses = useMemo(
    () => (graph ? collectNodeStatuses(message, graph) : {}),
    [graph, message]
  );
  const progress = countDagProgress(statuses);
  const planning = !graph && (part.state === 'input-available' || part.state === 'input-streaming');
  const [expanded, setExpanded] = useState(false);
  const { openPanel } = useWorkflowDagPanel();

  const subtitle = planning
    ? '模型正在规划 DAG…'
    : progress.failed
      ? '执行失败'
      : progress.running
        ? `执行中 · ${progress.done}/${progress.total}`
        : graph
          ? `${progress.done}/${progress.total} 个节点已完成`
          : '等待执行图';

  return (
    <div className="or-dag-wrap mb-3 w-full overflow-hidden rounded-2xl border border-white/10">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#7c8cff] to-[#22d3ee] text-[#08111f]">
          <GitBranch className="size-4" />
        </div>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setExpanded((value) => !value)}
        >
          <div className="truncate text-[13px] font-semibold text-[#eef4fb]">
            执行图 · {graph?.name ?? 'workflow'}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-[#8fa3b8]">{subtitle}</div>
        </button>
        <button
          type="button"
          onClick={openPanel}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 text-[11px] text-[#c7d2fe] hover:bg-white/10"
        >
          <PanelRightOpen className="size-3.5" />
          侧栏
        </button>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-[#8fa3b8] hover:bg-white/5"
          aria-expanded={expanded}
          aria-label={expanded ? '收起执行图' : '展开执行图'}
        >
          <ChevronDown className={`size-4 transition ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {part.errorText && <div className="px-4 pb-3 text-[12px] text-[#f87171]">{part.errorText}</div>}
      {expanded && (
        <div className="max-h-[280px] overflow-auto border-t border-white/10">
          {planning && <div className="px-4 py-3 text-[12px] text-[#8fa3b8]">等待工作流图…</div>}
          {graph && (
            <WorkflowDag graph={graph} statuses={statuses} selectedId={null} onSelect={() => openPanel()} />
          )}
        </div>
      )}
    </div>
  );
}
// AIGC END
