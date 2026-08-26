// AIGC START
'use client';

import { FileText, GitBranch, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { WorkspaceNode } from '@/lib/workspace-types';

type FileContent = {
  path: string;
  content: string;
  truncated: boolean;
  binary: boolean;
};

function FileTreeNodes({
  nodes,
  selectedPath,
  onSelect,
}: {
  nodes: WorkspaceNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) =>
        node.type === 'dir' ? (
          <li key={node.path}>
            <details open>
              <summary className="cursor-pointer select-none rounded px-1 py-0.5 text-[12px] text-muted-foreground hover:bg-muted/50">
                {node.name}/
              </summary>
              <div className="ml-3 border-l border-border pl-2">
                <FileTreeNodes
                  nodes={node.children ?? []}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                />
              </div>
            </details>
          </li>
        ) : (
          <li key={node.path}>
            <button
              type="button"
              onClick={() => onSelect(node.path)}
              className={cn(
                'w-full truncate rounded px-1 py-0.5 text-left text-[12px] hover:bg-muted/50',
                selectedPath === node.path && 'bg-muted font-medium text-foreground'
              )}
            >
              {node.name}
            </button>
          </li>
        )
      )}
    </ul>
  );
}

export function WorkspaceFilesPanel({
  projectId,
  refreshToken,
}: {
  projectId?: string;
  refreshToken: string;
}) {
  const [tree, setTree] = useState<WorkspaceNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [file, setFile] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [cloning, setCloning] = useState(false);

  const loadTree = useCallback(async () => {
    void refreshToken;
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/files`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to list files');
      setTree((json.data?.tree ?? []) as WorkspaceNode[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list files');
    } finally {
      setLoading(false);
    }
  }, [projectId, refreshToken]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  const openFile = useCallback(
    async (path: string) => {
      if (!projectId) return;
      setSelectedPath(path);
      setFile(null);
      try {
        const res = await fetch(
          `/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Failed to read file');
        setFile(json.data as FileContent);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to read file');
      }
    },
    [projectId]
  );

  const cloneRepo = useCallback(async () => {
    if (!projectId || !repoUrl.trim()) return;
    setCloning(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: repoUrl.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '克隆失败');
      setRepoUrl('');
      await loadTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : '克隆失败');
    } finally {
      setCloning(false);
    }
  }, [projectId, repoUrl, loadTree]);

  if (!projectId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        缺少项目上下文。
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <FileText className="size-4 text-muted-foreground" />
        <span className="flex-1 text-[12px] font-medium text-foreground">Workspace Files</span>
        <button
          type="button"
          onClick={() => void loadTree()}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
          aria-label="Refresh files"
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void cloneRepo();
          }}
          placeholder="https://github.com/org/repo.git"
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[11px] outline-none focus:border-ring"
        />
        <button
          type="button"
          onClick={() => void cloneRepo()}
          disabled={cloning || !repoUrl.trim()}
          className="h-7 shrink-0 rounded-md bg-foreground px-2.5 text-[11px] font-medium text-background disabled:opacity-50"
        >
          {cloning ? '克隆中…' : '克隆'}
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-[42%] overflow-y-auto border-r border-border p-3">
          {error && <p className="mb-2 text-[12px] text-destructive">{error}</p>}
          {tree.length === 0 && !loading ? (
            <p className="text-[12px] text-muted-foreground">
              工作区还是空的。可以在上方克隆 Git 仓库，或让 Agent 创建文件后点刷新。
            </p>
          ) : (
            <FileTreeNodes nodes={tree} selectedPath={selectedPath} onSelect={openFile} />
          )}
        </div>
        <div className="min-w-0 flex-1 overflow-auto p-3">
          {!file && <p className="text-[12px] text-muted-foreground">选择一个文件查看内容。</p>}
          {file?.binary && (
            <p className="text-[12px] text-muted-foreground">该文件为二进制，无法预览。</p>
          )}
          {file && !file.binary && (
            <>
              {file.truncated && (
                <p className="mb-2 text-[11px] text-muted-foreground">内容已截断（大于 256KB）。</p>
              )}
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed">
                {file.content}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
// AIGC END
