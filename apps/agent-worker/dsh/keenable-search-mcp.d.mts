export type KeenableEnvironment = Record<string, string | undefined>;

export type KeenableSearchResult = {
  title?: string;
  url?: string;
  snippet?: string;
  [key: string]: unknown;
};

export const DEFAULT_KEENABLE_BASE_URL: string;
export const SEARCH_TOOL: Record<string, unknown>;

export function resolveKeenableBaseUrl(env?: KeenableEnvironment): string;
export function keenableConfig(env?: KeenableEnvironment): {
  base: string;
  url: string;
  apiKey: string;
  title: string;
};
export function searchQueryFromArgs(args: Record<string, unknown>): string;
export function runKeenableSearch(
  args: Record<string, unknown>,
  options?: {
    env?: KeenableEnvironment;
    fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  }
): Promise<{ query?: string; results: KeenableSearchResult[]; [key: string]: unknown }>;
export function handleMcpMessage(
  message: Record<string, unknown>,
  options?: {
    env?: KeenableEnvironment;
    fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  }
): Promise<{
  result: {
    tools?: Array<Record<string, unknown>>;
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
} | null>;
export function attachStdio(options?: Record<string, unknown>): void;
