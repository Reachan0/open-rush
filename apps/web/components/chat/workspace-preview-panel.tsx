// AIGC START
'use client';

import { ExternalLink, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { findPreviewHtmlPath, type WorkspaceNode } from '@/lib/workspace-types';

export function WorkspacePreviewPanel({
  projectId,
  refreshToken,
}: {
  projectId?: string;
  refreshToken: string;
}) {
  const [entry, setEntry] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);

  const loadEntry = useCallback(async () => {
    void refreshToken;
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/files`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to list files');
      const tree = (json.data?.tree ?? []) as WorkspaceNode[];
      setEntry(findPreviewHtmlPath(tree));
    } catch {
      setEntry(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, refreshToken]);

  useEffect(() => {
    void loadEntry();
  }, [loadEntry]);

  if (!projectId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        缺少项目上下文。
      </div>
    );
  }

  const src = entry
    ? `/api/projects/${projectId}/preview/${entry.split('/').map(encodeURIComponent).join('/')}?r=${reload}`
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <button
          type="button"
          onClick={() => {
            void loadEntry();
            setReload((n) => n + 1);
          }}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
          aria-label="Refresh preview"
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
          <span className="truncate font-mono text-[12px] text-muted-foreground">
            {entry ? `/${entry}` : '/'}
          </span>
        </div>
      </div>
      {src ? (
        <iframe
          key={src}
          title="Workspace preview"
          src={src}
          sandbox="allow-scripts allow-forms allow-modals"
          className="min-h-0 flex-1 border-0 bg-white"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <div className="text-center">
            <div className="mx-auto mb-3 flex size-16 items-center justify-center rounded-2xl bg-muted">
              <ExternalLink className="size-6" />
            </div>
            <p className="font-medium">Preview</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              工作区还没有 HTML。让 Agent 生成 index.html 后点刷新。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
// AIGC END
