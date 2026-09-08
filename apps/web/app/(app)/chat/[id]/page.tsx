'use client';

import type { UIMessage } from 'ai';
import { ArrowUp, Code, ExternalLink, Maximize2, Paperclip, Square } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { PartRenderer } from '@/components/ai-elements/part-renderer';
import { ReliabilityPanel } from '@/components/chat/reliability/reliability-panel';
import { WorkflowDagProvider } from '@/components/chat/workflow-dag-context';
import { WorkflowPanel } from '@/components/chat/workflow-panel';
import { WorkspaceFilesPanel } from '@/components/chat/workspace-files-panel';
import { WorkspacePreviewPanel } from '@/components/chat/workspace-preview-panel';
import { LoadingDots } from '@/components/ui/loading-dots';
import { useChatAutoSave } from '@/hooks/use-chat-auto-save';
import { useStreamHeartbeat } from '@/hooks/use-stream-heartbeat';
import { useStreamRecovery } from '@/hooks/use-stream-recovery';
import {
  hasSentInitialPrompt,
  markInitialPromptSent,
  shouldSendUrlPrompt,
  stripQueryParam,
} from '@/lib/chat-initial-prompt';
import { shouldApplyLoadedMessages } from '@/lib/chat-loaded-messages';
import { randomUUID } from '@/lib/random-uuid';
import {
  type AssistantStreamPart,
  applyAssistantParts,
  isStreamComplete,
  isStreamError,
  readRunSseStream,
} from '@/lib/run-chat-stream';
import { cn } from '@/lib/utils';
import { findLatestWorkflowPlan } from '@/lib/workflow-dag-model';

type PreviewTab = 'preview' | 'code' | 'files' | 'workflow' | 'reliability';

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error';

// AIGC START
const RUNTIME_STORAGE_KEY = 'openrush:chat-runtime';
type ChatRuntime = 'dsh' | 'claude-code';
// AIGC END

function seqStorageKey(runId: string) {
  return `lux:lastEventSeq:${runId}`;
}

function getUserText(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

function buildRecoveryMessages(
  loaded: UIMessage[],
  run: { id: string; prompt: string }
): UIMessage[] {
  const out = [...loaded];
  while (out.length > 0 && out[out.length - 1].role === 'assistant') {
    out.pop();
  }
  const last = out[out.length - 1];
  const lastUserText = last?.role === 'user' ? getUserText(last) : '';
  if (lastUserText !== run.prompt) {
    out.push({
      id: `user-${run.id}`,
      role: 'user',
      parts: [{ type: 'text', text: run.prompt }],
    });
  }
  out.push({
    id: `asst-${run.id}`,
    role: 'assistant',
    parts: [{ type: 'text', text: '' }],
  });
  return out;
}

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const projectId = searchParams.get('projectId') ?? undefined;
  const taskId = searchParams.get('taskId') ?? undefined;
  const conversationId = params.id;
  // AIGC START
  const urlAgentName = searchParams.get('agent') || '';
  const initialPrompt = searchParams.get('prompt')?.trim() ?? '';
  const [boundAgentName, setBoundAgentName] = useState(urlAgentName);
  const agentName = boundAgentName || urlAgentName || 'OpenRush';
  // AIGC END

  const [providerLabel, setProviderLabel] = useState('DeepSeek Harness');
  const [runtime, setRuntime] = useState<ChatRuntime>('dsh');
  useEffect(() => {
    let cancelled = false;
    const stored = window.localStorage.getItem(RUNTIME_STORAGE_KEY);
    if (stored === 'dsh' || stored === 'claude-code') {
      setRuntime(stored);
      setProviderLabel(stored === 'claude-code' ? 'Claude Code' : 'DeepSeek Harness');
    }
    // AIGC START
    const runtimeLabels: Record<string, string> = {
      dsh: 'DeepSeek Harness',
      'claude-code': 'Claude Code',
      claude: 'Claude Code',
      cc: 'Claude Code',
    };
    const backendLabels: Record<string, string> = {
      bedrock: 'Bedrock',
      anthropic: 'Anthropic API',
      custom: 'Custom Endpoint',
    };

    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((healthJson) => {
        if (cancelled || !healthJson) return;
        const storedRuntime = window.localStorage.getItem(RUNTIME_STORAGE_KEY);
        if (storedRuntime === 'dsh' || storedRuntime === 'claude-code') return;
        const runtimeKey = String(healthJson.runtime ?? 'dsh');
        const nextRuntime: ChatRuntime = runtimeKey === 'claude-code' ? 'claude-code' : 'dsh';
        setRuntime(nextRuntime);
        const runtimeName = runtimeLabels[runtimeKey] ?? 'DeepSeek Harness';
        const backend =
          nextRuntime === 'claude-code' ? (backendLabels[healthJson.provider] ?? '') : '';
        setProviderLabel(backend ? `${runtimeName} · ${backend}` : runtimeName);
      })
      .catch(() => {});
    // AIGC END

    return () => {
      cancelled = true;
    };
  }, []);

  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('ready');
  const [error, setError] = useState<Error | null>(null);
  // AIGC START
  const [historyHydrated, setHistoryHydrated] = useState(false);
  // AIGC END

  const currentRunIdRef = useRef<string | null>(null);
  const lastEventSeqRef = useRef(-1);
  const streamAbortRef = useRef<AbortController | null>(null);
  // AIGC START
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // AIGC END

  const clearError = useCallback(() => setError(null), []);

  const consumeRunStream = useCallback(
    async (runId: string, afterSeq: number) => {
      // Always end any in-flight stream first. A previous run can hold the connection for minutes
      // (server polls run_events); without this, new sends / heartbeat resume no-op.
      streamAbortRef.current?.abort();
      const ac = new AbortController();
      streamAbortRef.current = ac;
      currentRunIdRef.current = runId;

      setStatus('streaming');
      const assistantId = `asst-${runId}`;

      try {
        const headers: Record<string, string> = {};
        if (afterSeq >= 0) {
          headers['Last-Event-ID'] = String(afterSeq);
        }

        // v1 SSE: /api/v1/agents/:agentId/runs/:runId/events
        // The `agentId` here = v1 Agent (legacy `taskId`); URL requires it as parent.
        const parentAgentId = taskId;
        if (!parentAgentId) throw new Error('Missing parent Agent (taskId) for SSE stream');
        const res = await fetch(
          `/api/v1/agents/${encodeURIComponent(parentAgentId)}/runs/${encodeURIComponent(runId)}/events`,
          {
            signal: ac.signal,
            headers,
          }
        );

        if (!res.ok) {
          throw new Error(`Stream failed: ${res.status}`);
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response body');

        for await (const ev of readRunSseStream(reader)) {
          if (ev.done) {
            sessionStorage.removeItem(seqStorageKey(runId));
            if (currentRunIdRef.current === runId) {
              setStatus('ready');
            }
            break;
          }

          // Check for run-level error events
          const streamErr = isStreamError(ev.payload);
          if (streamErr) {
            setError(new Error(streamErr));
            setMessages((prev) => prev.filter((m) => m.id !== assistantId));
            setStatus('error');
            continue;
          }

          // AIGC START
          if (isStreamComplete(ev.payload) && currentRunIdRef.current === runId) {
            sessionStorage.removeItem(seqStorageKey(runId));
            setStatus('ready');
          }
          // AIGC END

          lastEventSeqRef.current = ev.seq;
          sessionStorage.setItem(seqStorageKey(runId), String(ev.seq));
          setMessages((prev) => {
            // AIGC START
            const idx = prev.findIndex((m) => m.id === assistantId);
            const curParts = idx >= 0 ? prev[idx].parts : [];
            const nextParts = applyAssistantParts(curParts as AssistantStreamPart[], ev.payload);
            const nextMessage: UIMessage = {
              id: assistantId,
              role: 'assistant',
              parts: nextParts as UIMessage['parts'],
            };
            if (idx === -1) {
              return [...prev, nextMessage];
            }
            const next = [...prev];
            next[idx] = { ...prev[idx], ...nextMessage };
            return next;
            // AIGC END
          });
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          if (currentRunIdRef.current === runId) {
            setStatus('ready');
          }
        } else {
          setError(e instanceof Error ? e : new Error(String(e)));
          setStatus('error');
        }
      } finally {
        // AIGC START
        if (currentRunIdRef.current === runId && !ac.signal.aborted) {
          setStatus((prev) => (prev === 'streaming' || prev === 'submitted' ? 'ready' : prev));
        }
        // AIGC END
      }
    },
    [taskId]
  );

  const consumeRunStreamRef = useRef(consumeRunStream);
  consumeRunStreamRef.current = consumeRunStream;

  const { isDisconnect, resetDisconnect } = useStreamRecovery();

  const resumeAfterDisconnect = useCallback(() => {
    resetDisconnect();
    const rid = currentRunIdRef.current;
    if (!rid) return;
    const seq = lastEventSeqRef.current;
    void consumeRunStreamRef.current(rid, seq);
  }, [resetDisconnect]);

  useStreamHeartbeat(projectId, status, isDisconnect, resumeAfterDisconnect, {
    enabled: Boolean(taskId && projectId && messages.length > 0),
    interval: 1500,
    maxRetries: 5,
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  const startRun = useCallback(
    async (text: string) => {
      if (!projectId || !taskId) {
        setError(new Error('缺少 projectId 或 taskId，请从首页进入聊天。'));
        setStatus('error');
        return;
      }
      clearError();
      setStatus('submitted');

      const userMsgId = randomUUID();
      // AIGC START
      const priorMessages = messagesRef.current.filter((m) => m.id !== 'pending-asst');
      if (conversationId && priorMessages.length > 0) {
        await fetch(`/api/chat/${encodeURIComponent(conversationId)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: priorMessages, model: 'glm-4.7' }),
        }).catch(() => {});
      }
      // AIGC END
      setMessages((prev) => [
        ...prev,
        {
          id: userMsgId,
          role: 'user',
          parts: [{ type: 'text', text }],
        },
        {
          id: 'pending-asst',
          role: 'assistant',
          parts: [],
        },
      ]);

      try {
        // v1: POST /api/v1/agents/:agentId/runs (parent = v1 Agent, i.e. legacy taskId).
        // v1 allows concurrent runs on an Agent; the legacy "409 with activeRunId"
        // retry path is dropped. A terminal Agent (completed/cancelled) returns
        // 409 VERSION_CONFLICT — surfaced below.
        const res = await fetch(`/api/v1/agents/${encodeURIComponent(taskId)}/runs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Idempotency-Key: give the same send a 24h dedupe window so accidental
            // double-click doesn't spawn duplicate runs. See specs §幂等性.
            'Idempotency-Key': randomUUID(),
          },
          body: JSON.stringify({ input: text, runtime }),
        });

        const body = (await res.json()) as {
          data?: { id?: string };
          error?: { code?: string; message?: string };
        };

        if (!res.ok || !body.data?.id) {
          const msg = body.error?.message ?? `Failed to create run (HTTP ${res.status})`;
          setMessages((prev) => prev.filter((m) => m.id !== userMsgId && m.id !== 'pending-asst'));
          setStatus('error');
          setError(new Error(msg));
          return;
        }

        const runId = body.data.id;
        currentRunIdRef.current = runId;
        setMessages((prev) =>
          prev.map((m) => (m.id === 'pending-asst' ? { ...m, id: `asst-${runId}` } : m))
        );

        lastEventSeqRef.current = -1;
        await consumeRunStreamRef.current(runId, -1);
      } catch (e) {
        setMessages((prev) => prev.filter((m) => m.id !== userMsgId && m.id !== 'pending-asst'));
        setError(e instanceof Error ? e : new Error(String(e)));
        setStatus('error');
      }
    },
    [projectId, taskId, conversationId, clearError, runtime]
  );

  const stopRun = useCallback(async () => {
    streamAbortRef.current?.abort();
    const rid = currentRunIdRef.current;
    if (rid && taskId) {
      // v1: POST /api/v1/agents/:agentId/runs/:runId/cancel (parent = v1 Agent = taskId).
      await fetch(
        `/api/v1/agents/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(rid)}/cancel`,
        { method: 'POST' }
      ).catch(() => {});
    }
    setStatus('ready');
  }, [taskId]);

  const loadedConvRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId || conversationId === loadedConvRef.current) return;
    loadedConvRef.current = conversationId;
    setHistoryHydrated(false);

    // If there's an initialPrompt, the initialPrompt effect will handle
    // sending and stream consumption. Skip auto-attach here to avoid
    // racing with it (both call consumeRunStream which aborts the other).
    const hasInitialPrompt = Boolean(initialPrompt);

    let cancelled = false;

    void (async () => {
      try {
        const [msgRes, convRes] = await Promise.all([
          fetch(`/api/chat/${encodeURIComponent(conversationId)}/messages`).then((r) => r.json()),
          fetch(`/api/conversations/${encodeURIComponent(conversationId)}`).then((r) => r.json()),
        ]);
        const loaded = (
          msgRes.success && Array.isArray(msgRes.data) ? msgRes.data : []
        ) as UIMessage[];
        const convAgentName =
          typeof convRes?.data?.conversation?.agentName === 'string'
            ? convRes.data.conversation.agentName
            : '';
        if (convAgentName) setBoundAgentName(convAgentName);

        if (cancelled) return;

        // AIGC START
        const applyLoaded = shouldApplyLoadedMessages({
          loadedCount: loaded.length,
          localCount: messagesRef.current.length,
          hasInitialPrompt,
        });
        // AIGC END

        if (!taskId || !projectId) {
          if (applyLoaded) setMessages(loaded);
          return;
        }

        // When there's an initialPrompt, just load messages — don't attach to a stream.
        if (hasInitialPrompt && loaded.length === 0) {
          if (applyLoaded) setMessages(loaded);
          return;
        }

        // v1: GET /api/v1/agents/:id (task = v1 Agent). Envelope is `{ data }`.
        const tr = await fetch(`/api/v1/agents/${encodeURIComponent(taskId)}`).then((r) =>
          r.json()
        );
        // AIGC START
        const applyLoadedNow = () =>
          shouldApplyLoadedMessages({
            loadedCount: loaded.length,
            localCount: messagesRef.current.length,
            hasInitialPrompt,
          });
        // AIGC END
        if (cancelled || !tr.data?.activeRunId) {
          if (applyLoadedNow()) setMessages(loaded);
          return;
        }

        const activeRunId: string = tr.data.activeRunId;
        // v1: GET /api/v1/agents/:agentId/runs/:runId.
        const runRes = await fetch(
          `/api/v1/agents/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(activeRunId)}`
        ).then((r) => r.json());
        if (cancelled || !runRes.data?.id) {
          if (applyLoadedNow()) setMessages(loaded);
          return;
        }

        const run = runRes.data as { id: string; prompt: string };
        const raw = sessionStorage.getItem(seqStorageKey(run.id));
        const parsed = raw === null ? -1 : Number.parseInt(raw, 10);
        const afterSeq = Number.isNaN(parsed) ? -1 : parsed;
        // AIGC START
        if (!applyLoadedNow() && messagesRef.current.length > 0) {
          return;
        }
        // AIGC END
        const next = buildRecoveryMessages(loaded, run);
        setMessages(next);
        lastEventSeqRef.current = afterSeq;
        void consumeRunStreamRef.current(run.id, afterSeq);
      } finally {
        // AIGC START
        if (!cancelled) setHistoryHydrated(true);
        // AIGC END
      }
    })();

    return () => {
      cancelled = true;
      // AIGC START
      // React Strict Mode remounts in dev; clear the guard so history reloads.
      if (loadedConvRef.current === conversationId) {
        loadedConvRef.current = null;
      }
      // AIGC END
    };
  }, [conversationId, taskId, projectId, initialPrompt]);

  useChatAutoSave({ conversationId, messages, status, model: 'glm-4.7' });

  // AIGC START
  const stripPromptFromUrl = useCallback(() => {
    if (!searchParams.get('prompt')) return;
    const next = stripQueryParam(searchParams.toString(), 'prompt');
    router.replace(next ? `/chat/${conversationId}?${next}` : `/chat/${conversationId}`, {
      scroll: false,
    });
  }, [conversationId, router, searchParams]);

  useEffect(() => {
    if (!conversationId || status !== 'ready') return;
    if (!taskId || !projectId) return;
    const alreadySent = hasSentInitialPrompt(conversationId, sessionStorage);
    if (
      !shouldSendUrlPrompt({
        prompt: initialPrompt,
        alreadySent,
        messageCount: messages.length,
        historyHydrated,
      })
    ) {
      if (historyHydrated && initialPrompt) stripPromptFromUrl();
      return;
    }
    markInitialPromptSent(conversationId, sessionStorage);
    stripPromptFromUrl();
    void startRun(initialPrompt);
  }, [
    conversationId,
    historyHydrated,
    initialPrompt,
    messages.length,
    projectId,
    startRun,
    status,
    stripPromptFromUrl,
    taskId,
  ]);
  // AIGC END

  const [input, setInput] = useState('');
  const [activeTab, setActiveTab] = useState<PreviewTab | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoOpenedWorkflowRef = useRef(false);

  // AIGC START
  useEffect(() => {
    if (autoOpenedWorkflowRef.current) return;
    if (status !== 'streaming' && status !== 'submitted') return;
    if (!findLatestWorkflowPlan(messages)?.graph) return;
    autoOpenedWorkflowRef.current = true;
    setActiveTab('workflow');
  }, [messages, status]);
  // AIGC END

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || isLoading) return;
    if (!taskId || !projectId) {
      setError(new Error('缺少 projectId 或 taskId'));
      setStatus('error');
      return;
    }
    setInput('');
    clearError();
    void startRun(text);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, isLoading, startRun, clearError, taskId, projectId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  const chatStatusForUi = status;

  return (
    <WorkflowDagProvider openPanel={() => setActiveTab('workflow')}>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="size-7 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center text-[11px] font-bold text-blue-600 dark:text-blue-400">
              {agentName.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-[14px] font-semibold leading-none">{agentName}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{providerLabel}</div>
            </div>
            <select
              value={runtime}
              disabled={isLoading}
              onChange={(e) => {
                const next: ChatRuntime = e.target.value === 'claude-code' ? 'claude-code' : 'dsh';
                setRuntime(next);
                window.localStorage.setItem(RUNTIME_STORAGE_KEY, next);
                setProviderLabel(next === 'claude-code' ? 'Claude Code' : 'DeepSeek Harness');
              }}
              className="h-7 rounded-md border border-border bg-background px-2 text-[11px] text-foreground disabled:opacity-50"
              aria-label="选择运行时"
            >
              <option value="dsh">DeepSeek Harness</option>
              <option value="claude-code">Claude Code</option>
            </select>
            {isLoading && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950 text-[11px] font-medium text-blue-600 dark:text-blue-400 ml-2">
                <div className="size-1.5 rounded-full bg-blue-600 dark:bg-blue-400 animate-pulse" />
                Running
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            {/* AIGC START */}
            <div className="flex items-center bg-muted rounded-lg p-[2px] mr-2 max-w-full overflow-x-auto">
              {/* AIGC END */}
              {(['preview', 'code', 'files', 'workflow', 'reliability'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab((prev) => (prev === tab ? null : tab))}
                  className={cn(
                    'h-6 px-2.5 rounded-md text-[11px] font-medium cursor-pointer transition',
                    activeTab === tab
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {tab === 'workflow'
                    ? 'Workflow'
                    : tab === 'reliability'
                      ? '可靠性'
                      : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="size-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent/50 transition cursor-pointer"
              title="Open in new tab"
            >
              <ExternalLink className="size-3.5" />
            </button>
            <button
              type="button"
              className="size-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent/50 transition cursor-pointer"
              title="Fullscreen"
            >
              <Maximize2 className="size-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* AIGC START */}
          <div
            className={cn(
              'flex flex-col min-w-0',
              activeTab ? 'w-[42%] max-[480px]:hidden' : 'flex-1'
            )}
          >
            {/* AIGC END */}
            <div className="flex-1 overflow-y-auto px-5 py-5">
              {(!taskId || !projectId) && (
                <div className="mx-auto max-w-2xl mb-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                  缺少 task 或项目上下文。请从首页「开始聊天」进入，或从侧边栏打开会话。
                </div>
              )}

              {error && (
                <div className="mx-auto max-w-2xl mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  {error.message || 'An error occurred. Please try again.'}
                </div>
              )}

              <Conversation className="max-w-2xl mx-auto">
                <ConversationContent>
                  {messages.length === 0 && !isLoading && (
                    <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                      <p className="text-sm">
                        发一条消息开始工作。问答、工作流、代码、文档都可以。
                      </p>
                    </div>
                  )}

                  {messages.map((message, messageIndex) => (
                    <Message key={message.id} from={message.role}>
                      <MessageContent>
                        {message.parts.map((part, partIndex) => (
                          <PartRenderer
                            // biome-ignore lint/suspicious/noArrayIndexKey: stable message parts
                            key={`${message.id}-${partIndex}`}
                            part={part}
                            message={message}
                            index={partIndex}
                            status={chatStatusForUi}
                            isLastMessage={messageIndex === messages.length - 1}
                          />
                        ))}
                        {isLoading &&
                          messageIndex === messages.length - 1 &&
                          (message.role === 'user' ||
                            (message.role === 'assistant' &&
                              !message.parts.some((p) => p.type === 'text' && p.text))) && (
                            <div className="flex items-center gap-2 py-2 text-muted-foreground">
                              <LoadingDots size="md" label="Thinking" />
                            </div>
                          )}
                      </MessageContent>
                    </Message>
                  ))}
                </ConversationContent>
              </Conversation>
            </div>

            <div className="border-t border-border px-4 py-3 shrink-0">
              <div className="max-w-2xl mx-auto">
                <div className="flex items-end gap-2.5 border border-border rounded-xl p-2.5 bg-card focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/10 transition-all">
                  <button
                    type="button"
                    className="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent/50 transition cursor-pointer shrink-0"
                  >
                    <Paperclip className="size-[18px]" />
                  </button>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleInput}
                    onKeyDown={handleKeyDown}
                    placeholder="Continue the conversation..."
                    rows={1}
                    disabled={isLoading || !taskId || !projectId}
                    // AIGC START
                    className="flex-1 shrink-0 bg-transparent border-none outline-none text-[13px] resize-none min-h-[24px] max-h-[200px] placeholder:text-muted-foreground/50 leading-relaxed disabled:opacity-50"
                    // AIGC END
                  />
                  {isLoading ? (
                    <button
                      type="button"
                      aria-label="取消"
                      onClick={() => void stopRun()}
                      className="size-8 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center hover:bg-destructive/20 transition cursor-pointer shrink-0"
                    >
                      <Square className="size-[18px]" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSubmit}
                      className="size-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition cursor-pointer shrink-0"
                    >
                      <ArrowUp className="size-[18px]" />
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between mt-1.5 px-1">
                  <span className="text-[10px] text-muted-foreground">
                    <kbd className="font-mono text-[9px] bg-muted border border-border px-1 rounded">
                      Enter
                    </kbd>{' '}
                    send
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {providerLabel}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {activeTab && (
            <>
              <div className="w-[3px] shrink-0 relative cursor-col-resize group flex items-center justify-center hover:bg-primary/10 transition-colors">
                <div className="w-1 h-8 rounded-full bg-border group-hover:bg-muted-foreground transition-colors" />
              </div>
              <div
                className={cn(
                  'flex-1 flex flex-col min-w-0',
                  activeTab === 'workflow' ? '' : 'bg-muted/30'
                )}
              >
                {activeTab === 'preview' && (
                  <WorkspacePreviewPanel projectId={projectId} refreshToken={status} />
                )}
                {activeTab === 'code' && (
                  <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
                      <Code className="size-4 text-muted-foreground" />
                      <span className="text-[12px] font-mono text-muted-foreground">Code view</span>
                    </div>
                    <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                      Code changes will appear here during agent execution.
                    </div>
                  </div>
                )}
                {activeTab === 'files' && (
                  // AIGC START
                  <WorkspaceFilesPanel projectId={projectId} refreshToken={status} />
                  // AIGC END
                )}
                {activeTab === 'workflow' && <WorkflowPanel messages={messages} />}
                {activeTab === 'reliability' && <ReliabilityPanel messages={messages} />}
              </div>
            </>
          )}
        </div>
      </div>
    </WorkflowDagProvider>
  );
}
