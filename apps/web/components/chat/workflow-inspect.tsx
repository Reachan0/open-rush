// AIGC START
'use client';

import type { DynamicToolUIPart, UIMessage } from 'ai';
import {
  type DagNodeStatus,
  extractWorkflowArticle,
  extractWorkflowNodeResults,
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

function nodeInspectData(
  message: UIMessage,
  planPart: DynamicToolUIPart,
  node: WorkflowDagGraph['nodes'][number]
) {
  const part = findNodePart(message, node.id);
  if (part?.output != null || part?.input != null || part?.errorText) {
    return { input: part.input, output: part.output, error: part.errorText };
  }
  if (node.output != null || node.input != null || node.error) {
    return { input: node.input, output: node.output, error: node.error };
  }
  const results = extractWorkflowNodeResults(planPart.output);
  return { input: node.input, output: results[node.id], error: node.error };
}

export function WorkflowInspect({
  graph,
  message,
  planPart,
  selectedId,
  statuses,
}: {
  graph: WorkflowDagGraph;
  message: UIMessage;
  planPart: DynamicToolUIPart;
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
    const text =
      part?.errorText ||
      (part?.output != null ? previewDagValue(part.output) : '') ||
      (compose?.output != null ? previewDagValue(compose.output) : '') ||
      extractWorkflowArticle(planPart.output);
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
  const part = nodeInspectData(message, planPart, node);
  const status = statuses[node.id] ?? 'pending';
  const { input, output, error } = part;
  let value = output;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      /* Keep unstructured output visible. */
    }
  }
  const recovery =
    node.tool === 'ao04_read_status' && value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : null;
  const data =
    recovery?.data && typeof recovery.data === 'object'
      ? (recovery.data as Record<string, unknown>)
      : null;
  return (
    <div className="or-wf-inspect">
      <div className="k">
        {node.id} · {STATUS_LABEL[status]}
      </div>
      <div className="cmd">{prettyToolName(node.tool)}</div>
      {recovery && (
        <dl style={{ overflowWrap: 'anywhere' }}>
          <dt className="k">业务结果</dt>
          <dd>
            {recovery.status === 'ok'
              ? recovery.dependencyRecovered === true
                ? '故障后恢复成功'
                : '业务调用成功'
              : recovery.degraded === true
                ? '已降级，未恢复'
                : `未成功：${String(recovery.status ?? '未知')}`}
          </dd>
          {typeof recovery.restartAttempts === 'number' && (
            <>
              <dt className="k">重启尝试</dt>
              <dd>{recovery.restartAttempts} 次</dd>
            </>
          )}
          {typeof recovery.attempts === 'number' && recovery.attempts > 0 && (
            <>
              <dt className="k">业务尝试</dt>
              <dd>{recovery.attempts} 次</dd>
            </>
          )}
          {data?.generation != null && (
            <>
              <dt className="k">进程代次</dt>
              <dd>
                {data.previousGeneration != null ? `${String(data.previousGeneration)} → ` : ''}
                {String(data.generation)}
              </dd>
            </>
          )}
          {graph.nodes
            .filter((item) => item.dependsOn.includes(node.id))
            .map((item) => (
              <div key={item.id}>
                <dt className="k">后续节点 {item.id}</dt>
                <dd>{STATUS_LABEL[statuses[item.id] ?? item.status ?? 'pending']}</dd>
              </div>
            ))}
        </dl>
      )}
      {input != null && (
        <>
          <div className="k">输入</div>
          <pre>{previewDagValue(input)}</pre>
        </>
      )}
      {(output != null || error) && (
        <details open={!recovery}>
          <summary className="k">原始工具结果</summary>
          <pre>{error ?? previewDagValue(output)}</pre>
        </details>
      )}
      {output == null && !error && input == null && (
        <div className="placeholder">该节点还没有执行记录。</div>
      )}
    </div>
  );
}
// AIGC END
