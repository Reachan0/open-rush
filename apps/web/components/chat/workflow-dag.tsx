// AIGC START
'use client';

import { useId, useMemo } from 'react';
import {
  DAG_GAP_Y,
  DAG_NODE_H,
  DAG_PAD,
  type DagNodeStatus,
  layoutWorkflowDag,
  prettyToolName,
  truncateDagLabel,
  type WorkflowDagGraph,
  waveRowLabel,
} from '@/lib/workflow-dag-model';

const STATUS_LABEL: Record<DagNodeStatus, string> = {
  pending: '等待',
  running: '执行中',
  completed: '完成',
  failed: '失败',
  skipped: '跳过',
};

const BOX: Record<DagNodeStatus, { fill: string; stroke: string }> = {
  pending: { fill: '#121826', stroke: 'rgba(140, 166, 191, 0.38)' },
  running: { fill: '#182040', stroke: '#7c8cff' },
  completed: { fill: '#0e2e22', stroke: '#34d399' },
  failed: { fill: '#461818', stroke: '#f87171' },
  skipped: { fill: '#24183a', stroke: '#a78bfa' },
};

const FONT =
  'ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif';

function boxPaint(status: DagNodeStatus, terminal: boolean, selected: boolean) {
  const paint = BOX[status];
  return {
    fill: paint.fill,
    stroke: selected
      ? '#ffffff'
      : terminal && status === 'pending'
        ? 'rgba(124, 140, 255, 0.55)'
        : paint.stroke,
    strokeWidth: selected ? 2.2 : 1.4,
  };
}

function dotFill(status: DagNodeStatus): string {
  if (status === 'running') return '#7c8cff';
  if (status === 'completed') return '#34d399';
  if (status === 'failed') return '#f87171';
  if (status === 'skipped') return '#a78bfa';
  return '#65788d';
}

export function WorkflowDag({
  graph,
  statuses,
  selectedId,
  onSelect,
}: {
  graph: WorkflowDagGraph;
  statuses: Record<string, DagNodeStatus>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const rawId = useId().replace(/:/g, '');
  const gradId = `or-dag-edge-${rawId}`;
  const arrowId = `or-dag-arrow-${rawId}`;
  const layout = useMemo(() => layoutWorkflowDag(graph), [graph]);

  const endStatus = (): DagNodeStatus => {
    const values = graph.nodes.map((node) => statuses[node.id] ?? 'pending');
    if (values.some((status) => status === 'failed')) return 'failed';
    if (
      values.length > 0 &&
      values.every((status) => status === 'completed' || status === 'skipped')
    ) {
      return 'completed';
    }
    if (values.some((status) => status === 'running')) return 'running';
    return 'pending';
  };

  const allEdges = [...graph.edges, ...layout.extraEdges];
  let dataStep = 0;

  return (
    <div className="or-dag-board">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        role="img"
        aria-label={`工作流 ${graph.name}`}
        fill="none"
        className="or-dag-svg"
        onClick={(event) => {
          const target = (event.target as SVGElement).closest('[data-node]');
          const id = target?.getAttribute('data-node');
          onSelect(id ?? null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onSelect(null);
        }}
      >
        <defs>
          <linearGradient
            id={gradId}
            x1="0"
            x2="0"
            y1="0"
            y2={layout.height}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#7c8cff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.95" />
          </linearGradient>
          <marker id={arrowId} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M 0 0 L 8 4 L 0 8 Z" fill="#7c8cff" />
          </marker>
        </defs>

        {layout.visWaves.map((wave, row) => {
          if (!wave[0]?.terminal) dataStep += 1;
          const y = DAG_PAD + 18 + row * (DAG_NODE_H + DAG_GAP_Y);
          return (
            <text
              key={wave.map((node) => node.id).join('|')}
              x={DAG_PAD}
              y={y - 10}
              fill="#8fa3b8"
              fontSize={11}
              fontFamily={FONT}
            >
              {waveRowLabel(wave, dataStep)}
            </text>
          );
        })}

        {allEdges.map((edge) => {
          const a = layout.pos[edge.from];
          const b = layout.pos[edge.to];
          if (!a || !b) return null;
          const hot = statuses[edge.from] === 'running' || statuses[edge.to] === 'running';
          const x1 = a.x + a.w / 2;
          const y1 = a.y + DAG_NODE_H;
          const x2 = b.x + b.w / 2;
          const y2 = b.y;
          const mid = (y1 + y2) / 2;
          return (
            <path
              key={`${edge.from}->${edge.to}`}
              d={`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`}
              fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth={hot ? 2.2 : 1.8}
              strokeLinecap="round"
              markerEnd={`url(#${arrowId})`}
              opacity={hot ? 1 : 0.85}
            />
          );
        })}

        {(() => {
          const id = '__start__';
          const p = layout.pos[id];
          if (!p) return null;
          const selected = selectedId === id;
          const paint = boxPaint('completed', true, selected);
          return (
            <g data-node={id} style={{ cursor: 'pointer' }}>
              <rect x={p.x} y={p.y} width={p.w} height={DAG_NODE_H} rx="16" {...paint} />
              <text
                x={p.x + 16}
                y={p.y + 24}
                fill="#eef4fb"
                fontSize={12}
                fontWeight={650}
                fontFamily={FONT}
              >
                开始
              </text>
              <text x={p.x + 16} y={p.y + 42} fill="#8fa3b8" fontSize={10} fontFamily={FONT}>
                用户意图
              </text>
            </g>
          );
        })()}

        {graph.nodes.map((node) => {
          const p = layout.pos[node.id];
          if (!p) return null;
          const st = statuses[node.id] ?? 'pending';
          const selected = selectedId === node.id;
          const paint = boxPaint(st, false, selected);
          const sub = prettyToolName(node.tool);
          return (
            <g
              key={node.id}
              data-node={node.id}
              style={{ cursor: 'pointer', opacity: st === 'running' ? 0.92 : 1 }}
            >
              <rect x={p.x} y={p.y} width={p.w} height={DAG_NODE_H} rx="12" {...paint} />
              <circle cx={p.x + 14} cy={p.y + 16} r="3.5" fill={dotFill(st)} />
              <text
                x={p.x + 26}
                y={p.y + 20}
                fill="#eef4fb"
                fontSize={12}
                fontWeight={650}
                fontFamily={FONT}
              >
                {truncateDagLabel(node.id, 18)}
              </text>
              <text x={p.x + 26} y={p.y + 38} fill="#8fa3b8" fontSize={10} fontFamily={FONT}>
                {truncateDagLabel(sub, 20)}
              </text>
              <text
                x={p.x + p.w - 12}
                y={p.y + 20}
                textAnchor="end"
                fill="#9fb3c8"
                fontSize={10}
                fontFamily={FONT}
              >
                {STATUS_LABEL[st]}
              </text>
            </g>
          );
        })}

        {(() => {
          const id = '__end__';
          const p = layout.pos[id];
          if (!p) return null;
          const st = endStatus();
          const selected = selectedId === id;
          const paint = boxPaint(st, true, selected);
          return (
            <g data-node={id} style={{ cursor: 'pointer' }}>
              <rect x={p.x} y={p.y} width={p.w} height={DAG_NODE_H} rx="16" {...paint} />
              <text
                x={p.x + 16}
                y={p.y + 24}
                fill="#eef4fb"
                fontSize={12}
                fontWeight={650}
                fontFamily={FONT}
              >
                结束
              </text>
              <text x={p.x + 16} y={p.y + 42} fill="#8fa3b8" fontSize={10} fontFamily={FONT}>
                最终成文
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
// AIGC END
