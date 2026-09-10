// AIGC START
'use client';

import type { DynamicToolUIPart, UIMessage } from 'ai';
import {
  type DagNodeStatus,
  extractWorkflowArticle,
  extractWorkflowNodeResults,
  findWorkflowPlanPart,
  prettyToolName,
  previewDagValue,
  type WorkflowDagGraph,
} from '@/lib/workflow-dag-model';

const STATUS_LABEL: Record<DagNodeStatus, string> = {
  pending: '等待',
  running: '执行中',
  completed: '完成',
  failed: '失败',
  skipped: '跳过',
};

function findNodePart(message: UIMessage, nodeId: string): DynamicToolUIPart | undefined {
  return message.parts.find(
    (item): item is DynamicToolUIPart => item.type === 'dynamic-tool' && item.toolCallId === nodeId
  );
}

function nodeInspectData(message: UIMessage, nodeId: string) {
  const part = findNodePart(message, nodeId);
  if (part?.output != null || part?.input != null || part?.errorText) {
    return { input: part.input, output: part.output, errorText: part.errorText };
  }
  const plan = findWorkflowPlanPart(message);
  const results = extractWorkflowNodeResults(plan?.output);
  return { input: undefined, output: results[nodeId], errorText: undefined };
}

export function WorkflowInspect({
  graph,
  message,
  selectedId,
  statuses,
}: {
  graph: WorkflowDagGraph;
  message: UIMessage;
  selectedId: string | null;
  statuses: Record<string, DagNodeStatus>;
}) {
  if (!selectedId || selectedId === '__start__') {
    return (
      <div className="or-wf-inspect placeholder">
        点 DAG 上的工具节点，查看参数和产出。开始节点对应本轮用户意图。
      </div>
    );
  }
  if (selectedId === '__end__') {
    const compose = graph.nodes.find((node) => /compose/i.test(node.tool));
    const part = compose ? findNodePart(message, compose.id) : undefined;
    const plan = findWorkflowPlanPart(message);
    const text =
      part?.errorText ||
      (part?.output != null ? previewDagValue(part.output) : '') ||
      extractWorkflowArticle(plan?.output);
    return (
      <div className="or-wf-inspect">
        <div className="k">结束 · 最终成文</div>
        <pre>{text || '尚无成文输出。'}</pre>
      </div>
    );
  }
  const node = graph.nodes.find((item) => item.id === selectedId);
  if (!node) {
    return <div className="or-wf-inspect placeholder">未找到该节点。</div>;
  }
  const part = nodeInspectData(message, node.id);
  const status = statuses[node.id] ?? 'pending';
  return (
    <div className="or-wf-inspect">
      <div className="k">
        {node.id} · {STATUS_LABEL[status]}
      </div>
      <div className="cmd">{prettyToolName(node.tool)}</div>
      {part.input != null && (
        <>
          <div className="k">输入</div>
          <pre>{previewDagValue(part.input)}</pre>
        </>
      )}
      {(part.output || part.errorText) && (
        <>
          <div className="k">输出</div>
          <pre>{part.errorText ?? previewDagValue(part.output)}</pre>
        </>
      )}
      {!part.output && !part.errorText && !part.input && (
        <div className="placeholder">该节点还没有执行记录。</div>
      )}
    </div>
  );
}
// AIGC END
