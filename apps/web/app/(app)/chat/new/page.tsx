// AIGC START
'use client';

import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { writeActiveProjectId } from '@/lib/active-project';

function NewChatRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const projectId = searchParams.get('projectId');
    const agentId = searchParams.get('agentId');
    const agent = searchParams.get('agent');
    const agentWelcome = searchParams.get('agentWelcome');
    const prompt = searchParams.get('prompt');

    void (async () => {
      try {
        const res = await fetch('/api/chat/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(projectId ? { projectId } : {}),
            ...(agentId ? { agentId } : {}),
          }),
        });
        const json = await res.json();
        if (!json.success || !json.data) {
          throw new Error(json.error ?? 'Failed to start chat');
        }
        const nextProjectId = json.data.projectId as string;
        writeActiveProjectId(nextProjectId);
        const params = new URLSearchParams({
          projectId: nextProjectId,
          taskId: json.data.taskId,
        });
        if (agent) params.set('agent', agent);
        if (agentId) params.set('agentId', agentId);
        if (agentWelcome) params.set('agentWelcome', agentWelcome);
        if (prompt?.trim()) params.set('prompt', prompt.trim());
        router.replace(`/chat/${json.data.conversationId}?${params.toString()}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start chat');
      }
    })();
  }, [router, searchParams]);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Starting chat...
    </div>
  );
}

export default function NewChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Starting chat...
        </div>
      }
    >
      <NewChatRedirect />
    </Suspense>
  );
}
// AIGC END
