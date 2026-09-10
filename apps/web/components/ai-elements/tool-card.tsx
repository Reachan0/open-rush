'use client';

import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClipboardListIcon,
  ClockIcon,
  CodeIcon,
  FileTextIcon,
  GlobeIcon,
  PencilIcon,
  TerminalIcon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { CodeBlock } from './inline-code-block';

// --- Performance render strategy (from rush-app) ---

type RenderStrategy = 'full' | 'plain' | 'summary';

function getCodeRenderStrategy(code: string): RenderStrategy {
  const lines = code ? code.split('\n').length : 0;
  if (lines <= 500) return 'full';
  if (lines <= 2000) return 'plain';
  return 'summary';
}

// --- Tool icon mapping (from rush-app) ---

function getToolIcon(toolName: string) {
  const iconClass = 'size-4 text-muted-foreground';
  switch (toolName) {
    case 'Bash':
    case 'Grep':
      return <TerminalIcon className={iconClass} />;
    case 'WebFetch':
      return <GlobeIcon className={iconClass} />;
    case 'Read':
    case 'Glob':
      return <FileTextIcon className={iconClass} />;
    case 'Write':
      return <CodeIcon className={iconClass} />;
    case 'Edit':
      return <PencilIcon className={iconClass} />;
    case 'TodoWrite':
      return <ClipboardListIcon className={iconClass} />;
    default:
      return <WrenchIcon className={iconClass} />;
  }
}

// --- Status badge (from rush-app) ---

type ToolState = 'partial-call' | 'call' | 'result' | 'error';

function getStatusBadge(state: ToolState) {
  const config: Record<ToolState, { icon: React.ReactNode; label: string }> = {
    'partial-call': {
      icon: <CircleIcon className="size-3.5 animate-pulse" />,
      label: 'Pending',
    },
    call: {
      icon: <ClockIcon className="size-3.5 animate-pulse" />,
      label: 'Running',
    },
    result: {
      icon: <CheckCircleIcon className="size-3.5 text-green-600" />,
      label: 'Done',
    },
    error: {
      icon: <XCircleIcon className="size-3.5 text-red-600" />,
      label: 'Error',
    },
  };

  const { icon, label } = config[state];
  return (
    <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
      {icon}
      {label}
    </span>
  );
}

// --- Tool output with render strategy (from rush-app) ---

const ToolOutput = memo(
  function ToolOutput({ output, isError }: { output: unknown; isError: boolean }) {
    if (output == null) return null;

    const outputStr =
      typeof output === 'string'
        ? output
        : typeof output === 'object'
          ? JSON.stringify(output, null, 2)
          : String(output);

    const strategy = getCodeRenderStrategy(outputStr);

    if (strategy === 'summary') {
      const lineCount = outputStr.split('\n').length;
      return (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          Output collapsed ({lineCount} lines)
        </div>
      );
    }

    if (strategy === 'plain') {
      return (
        <pre
          className={cn(
            'm-0 overflow-auto bg-transparent px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap',
            isError ? 'text-destructive' : 'text-foreground'
          )}
        >
          {outputStr}
        </pre>
      );
    }

    return <CodeBlock code={outputStr} language={typeof output === 'object' ? 'json' : 'text'} />;
  },
  (prev, next) => prev.output === next.output && prev.isError === next.isError
);

// --- Main ToolCard component ---

interface ToolCardProps {
  toolName: string;
  state: ToolState;
  args?: Record<string, unknown>;
  result?: unknown;
}

export function ToolCard({ toolName, state, args, result }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const isError = state === 'error';

  // Format input display
  const inputStr = args ? (typeof args === 'string' ? args : JSON.stringify(args, null, 2)) : null;

  return (
    <div className="my-3 w-full overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full cursor-pointer items-center gap-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {getToolIcon(toolName)}
        <span className="truncate">{toolName}</span>
        {getStatusBadge(state)}
        <ChevronDownIcon
          className={cn(
            'size-4 text-muted-foreground transition-transform',
            expanded && 'rotate-180'
          )}
        />
      </button>

      {expanded && (
        <div className="ml-2 mt-2 space-y-2 border-l border-border/60 pl-4">
          {inputStr && (
            <div className="overflow-hidden rounded-md">
              <CodeBlock code={inputStr} language={typeof args === 'string' ? 'text' : 'json'} />
            </div>
          )}
          {result !== undefined && (
            <div
              className={cn(
                'overflow-x-auto rounded-md text-xs',
                isError ? 'bg-destructive/10 text-destructive' : 'text-foreground'
              )}
            >
              <ToolOutput output={result} isError={isError} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
