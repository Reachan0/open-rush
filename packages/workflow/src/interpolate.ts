// AIGC START
import type { JsonValue } from './types.js';
import { WorkflowError } from './types.js';

export interface InterpContext {
  intent: Record<string, JsonValue>;
  nodes: Record<string, { output?: JsonValue }>;
  item?: JsonValue;
}

const TEMPLATE_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

export function getPath(root: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = root;
  for (const part of parts) {
    if (cur == null) return undefined;
    const index = Number(part);
    if (Array.isArray(cur) && Number.isInteger(index) && String(index) === part) {
      cur = cur[index];
      continue;
    }
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function lookup(expr: string, ctx: InterpContext): unknown {
  const path = expr.trim();
  if (path === 'item') return ctx.item;
  if (path.startsWith('item.')) return getPath({ item: ctx.item }, path);
  if (path.startsWith('intent.')) return getPath({ intent: ctx.intent }, path);
  if (path === 'intent') return ctx.intent;
  if (path.startsWith('nodes.')) return getPath({ nodes: ctx.nodes }, path);
  throw new WorkflowError('interpolate', `unknown interpolation root: ${path}`);
}

export function interpolateString(template: string, ctx: InterpContext): JsonValue {
  const trimmed = template.trim();
  const whole = trimmed.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  if (whole) {
    return lookup(whole[1], ctx) as JsonValue;
  }
  return template.replace(TEMPLATE_RE, (_m, expr: string) => {
    const value = lookup(expr, ctx);
    if (value == null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  });
}

export function interpolateValue(
  value: JsonValue | undefined,
  ctx: InterpContext
): JsonValue | undefined {
  if (value == null) return value;
  if (typeof value === 'string') return interpolateString(value, ctx);
  if (Array.isArray(value)) {
    return value.map((item) => interpolateValue(item, ctx) as JsonValue);
  }
  if (typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = interpolateValue(v, ctx) as JsonValue;
    }
    return out;
  }
  return value;
}

function toComparable(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (value.trim() !== '' && Number.isFinite(n) && String(n) === value.trim()) return n;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }
  if (Array.isArray(value)) return value.length;
  return JSON.stringify(value);
}

function isTruthy(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0 && value !== 'false';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

const COMPARE_RE = /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/;

export function evalCondition(expr: string, ctx: InterpContext): boolean {
  const interpolated = interpolateString(expr, ctx);
  const text =
    typeof interpolated === 'string' ? interpolated.trim() : JSON.stringify(interpolated);
  const cmp = text.match(COMPARE_RE);
  if (!cmp) {
    if (typeof interpolated === 'string' && /\{\{/.test(expr)) {
      return isTruthy(lookup(expr.replace(/^\{\{|\}\}$/g, ''), ctx));
    }
    return isTruthy(interpolated);
  }
  const left = toComparable(cmp[1].trim());
  const op = cmp[2];
  const right = toComparable(cmp[3].trim().replace(/^["']|["']$/g, ''));
  switch (op) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return Number(left) > Number(right);
    case '>=':
      return Number(left) >= Number(right);
    case '<':
      return Number(left) < Number(right);
    case '<=':
      return Number(left) <= Number(right);
    default:
      return false;
  }
}
// AIGC END
