'use client';

import {
  FolderKanban,
  Layers,
  LogOut,
  MessageSquare,
  Plus,
  Rss,
  Settings,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { resolveActiveProjectId, writeActiveProjectId } from '@/lib/active-project';
import { cn } from '@/lib/utils';

interface SidebarUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

interface ConversationItem {
  id: string;
  title: string | null;
  projectId: string;
  taskId: string | null;
  agentId: string | null;
  agentName: string | null;
  updatedAt: string;
}

interface SidebarProps {
  user: SidebarUser;
  projects?: Array<{ id: string; name: string }>;
}

const navBuild = [
  { href: '/dashboard', icon: FolderKanban, label: 'Projects', match: ['/dashboard', '/projects'] },
  { href: '/studio', icon: Layers, label: 'Agent Studio', match: ['/studio'] },
  { href: '/skills', icon: Wrench, label: 'Skills', match: ['/skills'] },
  { href: '/mcps', icon: Rss, label: 'MCP Servers', match: ['/mcps'] },
];

export function Sidebar({ user, projects = [] }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const initials = (user.name ?? user.email ?? '?').slice(0, 2).toUpperCase();
  const pathProjectId = pathname.startsWith('/projects/') ? (pathname.split('/')[2] ?? null) : null;

  const [activeProjectId, setActiveProjectId] = useState<string | null>(projects[0]?.id ?? null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: chat routes keep the same path but change ?projectId=
  useEffect(() => {
    const urlProjectId =
      pathProjectId ?? new URLSearchParams(window.location.search).get('projectId');
    const nextId = resolveActiveProjectId(projects, urlProjectId);
    setActiveProjectId(nextId);
    if (nextId) writeActiveProjectId(nextId);
  }, [projects, pathProjectId, pathname]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-fetch when route changes (new chat created)
  useEffect(() => {
    if (!activeProjectId) {
      setConversations([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    fetch(`/api/conversations?projectId=${activeProjectId}`)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled || !res?.success) return;
        setConversations(
          (res.data ?? []).map((c: Record<string, unknown>) => ({
            id: c.id as string,
            title: c.title as string | null,
            projectId: c.projectId as string,
            taskId: (c.taskId as string | null) ?? null,
            agentId: (c.agentId as string | null) ?? null,
            agentName: (c.agentName as string | null) ?? null,
            updatedAt: c.updatedAt as string,
          }))
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, pathname]);

  const activeConvId = pathname.startsWith('/chat/') ? pathname.split('/')[2] : undefined;
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;

  const handleProjectChange = useCallback(
    (projectId: string) => {
      writeActiveProjectId(projectId);
      setActiveProjectId(projectId);
      if (pathname === '/') {
        router.push(`/?projectId=${projectId}`);
        return;
      }
      if (pathname.startsWith('/dashboard') || pathname.startsWith('/projects/')) {
        router.push(`/projects/${projectId}`);
      }
    },
    [pathname, router]
  );

  const handleNewChat = useCallback(() => {
    const href = activeProjectId ? `/?projectId=${activeProjectId}` : '/';
    router.push(href);
  }, [activeProjectId, router]);

  const handleConvClick = useCallback(
    (conv: ConversationItem) => {
      writeActiveProjectId(conv.projectId);
      const params = new URLSearchParams({ projectId: conv.projectId });
      if (conv.taskId) {
        params.set('taskId', conv.taskId);
      }
      if (conv.agentId) {
        params.set('agentId', conv.agentId);
      }
      if (conv.agentName) {
        params.set('agent', conv.agentName);
      }
      router.push(`/chat/${conv.id}?${params.toString()}`);
    },
    [router]
  );

  return (
    <aside className="sidebar-wrap w-[256px] shrink-0 bg-card rounded-xl shadow-[0_0_0_1px_rgba(0,0,0,0.06)] flex flex-col p-3 gap-0.5 overflow-hidden max-md:hidden">
      <Link
        href="/"
        className="flex items-center gap-2.5 px-2 py-2 mb-2 rounded-lg hover:bg-accent/50 transition-all"
      >
        <div className="size-7 bg-primary rounded-lg flex items-center justify-center text-primary-foreground text-xs font-bold">
          R
        </div>
        <span className="text-[15px] font-semibold tracking-tight">OpenRush</span>
        <span className="ml-auto text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          v0.3
        </span>
      </Link>

      {/* AIGC START */}
      <div className="flex items-center gap-1 mb-1">
        {projects.length > 0 ? (
          <label className="flex-1 min-w-0">
            <span className="sr-only">Current project</span>
            <select
              value={activeProjectId ?? ''}
              onChange={(e) => handleProjectChange(e.target.value)}
              className="h-8 w-full rounded-lg border border-border bg-background px-2 text-[12px] text-foreground"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <Link
            href="/projects/new"
            className="flex-1 h-8 inline-flex items-center justify-center rounded-lg border border-dashed border-border text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent/30"
          >
            Create a project
          </Link>
        )}
        <Link
          href="/projects/new"
          className="size-8 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          aria-label="New project"
          title="New project"
        >
          <Plus className="size-4" />
        </Link>
      </div>
      <Link
        href={activeProject ? `/projects/${activeProject.id}` : '/dashboard'}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] text-muted-foreground hover:bg-accent/50 hover:text-foreground mb-1"
      >
        <FolderKanban className="size-3.5 shrink-0" />
        <span className="truncate">{activeProject ? 'Open project' : 'All projects'}</span>
      </Link>
      {/* AIGC END */}

      <button
        type="button"
        onClick={handleNewChat}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border text-muted-foreground text-[13px] font-medium hover:border-foreground/20 hover:text-foreground hover:bg-accent/30 transition-all w-full mb-1 cursor-pointer"
      >
        <Plus className="size-4" />
        New Chat
      </button>

      <div className="h-px bg-border mx-1 my-1" />

      <div className="flex-1 overflow-y-auto custom-scrollbar mt-1">
        {isLoading ? (
          <div className="px-3 py-4 text-[12px] text-muted-foreground text-center">Loading...</div>
        ) : conversations.length === 0 ? (
          <div className="px-3 py-4 text-[12px] text-muted-foreground text-center">
            No conversations yet
          </div>
        ) : (
          <div className="space-y-0.5">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => handleConvClick(conv)}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] transition-all w-full text-left cursor-pointer',
                  activeConvId === conv.id
                    ? 'bg-accent font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
              >
                <MessageSquare className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{conv.title || 'New Chat'}</span>
                  {conv.agentName ? (
                    <span className="block truncate text-[11px] font-normal text-muted-foreground">
                      {conv.agentName}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 pt-3 pb-1">
        Build
      </div>
      {navBuild.map((item) => {
        const isActive = item.match.some((prefix) => pathname.startsWith(prefix));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] transition-all',
              isActive
                ? 'bg-accent font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            )}
          >
            <item.icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}

      <div className="h-px bg-border mx-1 my-1" />
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <div className="size-7 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-[11px] font-semibold text-white shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium truncate">{user.name ?? 'User'}</div>
          <div className="text-[11px] text-muted-foreground">Admin</div>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={activeProject ? `/projects/${activeProject.id}/settings` : '/dashboard'}
            className="size-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent/50 transition"
            aria-label="Project settings"
          >
            <Settings className="size-4" />
          </Link>
          <form action="/api/auth/signout" method="POST">
            <button
              type="submit"
              className="size-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent/50 transition cursor-pointer"
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
