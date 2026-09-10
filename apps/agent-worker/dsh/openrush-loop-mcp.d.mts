export const name: string;
export const inject: string[];
export function codingToolsEnabled(env?: Record<string, string | undefined>): boolean;
export function apply(ctx: unknown): Promise<void>;
