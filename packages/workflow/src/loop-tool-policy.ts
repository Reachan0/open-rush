// AIGC START
/**
 * Fast-lane share policy: only known-safe readonly tools enter the graph.
 * Unknown MCP defaults to stay out. Dangerous name stems are denied even
 * when they sit under an otherwise allowed server prefix.
 */
export const LOOP_TOOL_POLICY = [
  { name: 'workflow_run', reason: '递归，图里再开图' },
  { name: 'todo_write', reason: '外层记步骤，图节点没有事实产出' },
  { name: 'ask_user_question', reason: '要等人回答，图不能中途停下问人' },
  { name: 'subagent', reason: '节点里再开一轮代理，不是按图执行' },
  { name: 'write', reason: '会改文件，图里不好审批' },
  { name: 'edit', reason: '会改文件，图里不好审批' },
  { name: 'bash', reason: '既能查也能改，图里不好审批' },
  {
    name: 'web_search',
    reason: 'DSH 官方搜索口和当前网关 key 对不上，一个失败节点会把整张图炸掉',
  },
] as const;

export const LOOP_TOOL_DENYLIST = LOOP_TOOL_POLICY.map((item) => item.name);

const DENY_EXACT = new Set<string>(LOOP_TOOL_DENYLIST);
const DENY_REASON = new Map<string, string>(
  LOOP_TOOL_POLICY.map((item) => [item.name, item.reason])
);

export function isDeniedLoopTool(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  if (DENY_EXACT.has(n)) return true;
  if (n === 'workflow' || n === 'ralph') return true;
  if (n.startsWith('subagent_') || n.startsWith('subagent-')) return true;
  return false;
}

const SAFE_EXACT = new Set([
  'read',
  'read_image',
  'grep',
  'glob',
  'web_fetch',
  'http.fetch',
  'fs.read',
  'fs.search',
  'web.search',
]);

const SAFE_PREFIXES = [
  'mcp__amap-maps__',
  'amap-maps__',
  'maps_',
  'mcp__keenable-search__',
  'keenable-search__',
  'mcp__coding-tools__read',
  'mcp__coding-tools__list',
  'mcp__coding-tools__search',
  'mcp__coding-tools__git',
  'coding-tools__read',
  'coding-tools__list',
  'coding-tools__search',
  'coding-tools__git',
];

const DANGEROUS_STEM =
  /(^|_|__|\.|-)(write|edit|delete|unlink|remove|rm|send|email|exec|bash|patch|apply_patch|drop|payment)($|_|__|\.|-)/i;

export function loopToolDenyReason(name: string): string | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return '空工具名';
  const exact = DENY_REASON.get(n);
  if (exact) return exact;
  if (n === 'workflow' || n === 'ralph') return 'DSH 编排工具，会套娃';
  if (n.startsWith('subagent_') || n.startsWith('subagent-')) return '子代理，会套娃';
  if (DANGEROUS_STEM.test(n) || n.includes('apply_patch') || n.includes('exec_command')) {
    return '名称像会改环境或有副作用，默认不进图';
  }
  if (!isEligibleLoopTool(name)) return '未知工具默认不进图，由外层慢车道使用';
  return undefined;
}

export function isEligibleLoopTool(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n || isDeniedLoopTool(n)) return false;
  if (n.includes('apply_patch') || n.includes('exec_command') || DANGEROUS_STEM.test(n)) {
    return false;
  }
  if (SAFE_EXACT.has(n)) return true;
  return SAFE_PREFIXES.some((prefix) => n.startsWith(prefix));
}

export interface NamedLoopTool {
  name: string;
  description?: string;
}

const OUTER_DESC_MAX = 100;

function clipDesc(raw: string, max = OUTER_DESC_MAX): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function eligibleLoopTools<T extends NamedLoopTool>(schemas: T[]): T[] {
  return schemas.filter((schema) => isEligibleLoopTool(schema.name));
}

export function deniedLoopTools<T extends NamedLoopTool>(schemas: T[]): T[] {
  return schemas.filter((schema) => !isEligibleLoopTool(schema.name));
}

/** Name + short description for the outer Loop model (not the planner catalog). */
export function formatEligibleLoopToolList(schemas: NamedLoopTool[]): string {
  const eligible = eligibleLoopTools(schemas);
  if (eligible.length === 0) {
    return '（当前 schemas 里没有可进图的工具）';
  }
  return eligible
    .map((schema) => {
      const desc = clipDesc(schema.description ?? '');
      return desc ? `- ${schema.name}: ${desc}` : `- ${schema.name}`;
    })
    .join('\n');
}

export function formatDeniedLoopToolList(schemas: NamedLoopTool[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const schema of deniedLoopTools(schemas)) {
    const key = schema.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const reason = loopToolDenyReason(schema.name);
    lines.push(reason ? `- ${schema.name}: ${reason}` : `- ${schema.name}`);
  }
  for (const item of LOOP_TOOL_POLICY) {
    if (seen.has(item.name)) continue;
    lines.push(`- ${item.name}: ${item.reason}`);
  }
  return lines.join('\n');
}
// AIGC END
