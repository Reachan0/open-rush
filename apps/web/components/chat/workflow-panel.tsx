// AIGC START
'use client';

import type { UIMessage } from 'ai';
import { useMemo, useState } from 'react';
import { WorkflowDag } from '@/components/chat/workflow-dag';
import { WorkflowInspect } from '@/components/chat/workflow-inspect';
import { collectNodeStatuses, countDagProgress, findWorkflowPlans } from '@/lib/workflow-dag-model';

export function WorkflowPanel({ messages }: { messages: UIMessage[] }) {
  const runs = useMemo(() => findWorkflowPlans(messages), [messages]);
  const [selectedRunKey, setSelectedRunKey] = useState<string | null>(null);
  const latest = runs.at(-1) ?? null;
  const current = runs.find((run) => run.key === selectedRunKey) ?? latest;
  const currentIndex = current ? runs.findIndex((run) => run.key === current.key) : -1;
  const graph = current?.graph ?? null;
  const statuses = useMemo(
    () => (graph && current ? collectNodeStatuses(current.message, graph) : {}),
    [graph, current]
  );
  const progress = countDagProgress(statuses);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const planningFailed = current?.part.state === 'output-error' && !graph;
  const planning = Boolean(
    current?.part && !graph && !planningFailed && current.part.state !== 'output-available'
  );

  return (
    <div className="or-wf-panel flex min-h-0 flex-1 flex-col">
      <div className="or-wf-head">
        <div>
          <h3>
            实时 DAG
            {runs.length > 1 && currentIndex >= 0
              ? ` · 第 ${currentIndex + 1}/${runs.length} 次`
              : ''}
          </h3>
          <p>
            {planningFailed
              ? '规划未完成。本轮已结束，请查看工具错误；依赖检查未通过前不会继续后续步骤。'
              : planning
                ? '模型正在根据意图生成执行图。'
                : graph
                  ? `图有「开始 / 结束」。点任意节点查看参数和产出。当前 ${progress.done}/${progress.total} 个节点已完成。`
                  : '对话里还没有快车道执行图。发一条需要多步工具的问题后，图会显示在这里。'}
          </p>
          {runs.length > 1 && (
            <div className="or-wf-runs" aria-label="快车道运行记录">
              {[...runs].reverse().map((run, reverseIndex) => {
                const index = runs.length - reverseIndex - 1;
                const name =
                  run.graph?.name && run.graph.name !== 'workflow' ? run.graph.name : '快车道';
                const active = run.key === current?.key;
                return (
                  <button
                    key={run.key}
                    type="button"
                    aria-pressed={active}
                    className={active ? 'active' : undefined}
                    onClick={() => {
                      setSelectedRunKey(run.key);
                      setSelectedId(null);
                    }}
                  >
                    <span>第 {index + 1} 次</span>
                    <strong>{name}</strong>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="or-wf-legend">
          <span>
            <i style={{ background: '#65788d' }} />
            等待
          </span>
          <span>
            <i style={{ background: '#7c8cff' }} />
            执行中
          </span>
          <span>
            <i style={{ background: '#34d399' }} />
            完成
          </span>
          <span>
            <i style={{ background: '#a78bfa' }} />
            跳过
          </span>
          <span>
            <i style={{ background: '#f87171' }} />
            失败
          </span>
        </div>
      </div>
      <div className="or-wf-body">
        <section className="or-wf-board">
          {graph && current ? (
            <WorkflowDag
              graph={graph}
              statuses={statuses}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : (
            <div className="or-wf-empty">
              <div className="hero-orb" />
              <strong>{planningFailed ? '规划失败' : planning ? '规划中…' : '等待一次运行'}</strong>
              <div>
                {planningFailed
                  ? '没有可执行图，不能显示为完成。'
                  : planning
                    ? '模型正在生成 DAG。'
                    : '适合演示的场景：搜上海周末带孩子去哪，或把一篇文档总结成中文要点。'}
              </div>
            </div>
          )}
        </section>
        <aside className="or-wf-side">
          <div className="or-wf-section-title">
            <span>节点详情</span>
            <span className="badge">{selectedId ? selectedId : '点击节点'}</span>
          </div>
          {graph && current ? (
            <WorkflowInspect
              graph={graph}
              message={current.message}
              planPart={current.part}
              selectedId={selectedId}
              statuses={statuses}
            />
          ) : (
            <div className="or-wf-inspect placeholder">
              运行后点 DAG 上的工具节点，查看具体命令和产出。
            </div>
          )}
          <div className="or-wf-stats">
            <div>
              <div className="label">节点数</div>
              <div className="value">{progress.total}</div>
            </div>
            <div>
              <div className="label">已完成</div>
              <div className="value">{progress.done}</div>
            </div>
            <div>
              <div className="label">状态</div>
              <div className="value">
                {progress.failed || planningFailed
                  ? '失败'
                  : progress.running
                    ? '执行中'
                    : graph
                      ? progress.done === progress.total
                        ? '已完成'
                        : '未完成'
                      : 'Idle'}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
// AIGC END
