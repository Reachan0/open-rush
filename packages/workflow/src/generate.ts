// AIGC START
import { estimateTokens } from './events.js';
import { weekendTripDsl } from './fixtures.js';
import { safeParseWorkflowDsl } from './schema.js';
import type { TokenUsage, ToolDescriptor, WorkflowDsl } from './types.js';
import { WorkflowError } from './types.js';
import { validateWorkflowDsl } from './validate.js';

export type LlmComplete = (prompt: string) => Promise<string>;

export const GENERATE_SYSTEM_PROMPT = `You are a workflow planner for OpenRush.
Given a user intent and a tool catalog, PLAN a JSON DAG yourself. Do not follow any fixed recipe.
Return ONLY a JSON object:
{ "version": "1", "name": string, "nodes": [{ "id", "tool", "input?", "dependsOn?", "if?", "foreach?" }] }
Rules:
- You choose node ids (e.g. locate, foods). They are labels, not tools.
- "tool" MUST be copied exactly from the catalog (including mcp__<server>__<raw> and DSH names like read / web_fetch / grep / glob). Never invent a tool name. Do not use DSH native web_search. Prefer mcp__keenable-search__web_search / keenable-search__* / web.search when those exact names are in the catalog.
- Each catalog entry is the exact tool name, a short description, and inputSchema JSON when present. Interpolate using those field names. DSH read returns { path, lines: [{ number, text }] }, not { content }.
- Each node is exactly one tool call.
- Independent nodes should omit shared dependsOn so they run in parallel.
- Pass data with {{intent.text}} and {{nodes.<id>.output}} / {{nodes.<id>.output.*}}.
- Prefer a shared setup node, then fan-out, then join / compose.
- article.compose / text.compose are optional. Prefer gathering facts and stopping; the outer agent will write the user-facing reply. If you do compose, pass previous outputs as parts — same tone as OpenRush/DSH, not a standalone markdown article.
- Skip catalog tools that are irrelevant to this intent.
- If the catalog has mcp__keenable-search__* / keenable-search__* / web.search, Input.query must be a short search string, never the whole user sentence. After search, pass {{nodes.<id>.output}} into text.compose. Do NOT http.fetch search hits unless the user pasted a concrete URL. Never call DSH native web_search. If no Keenable/web.search tool is in the catalog, use Amap maps_* for place/weather/route and web_fetch / http.fetch for a known URL.
- If you must fetch a search hit, dependsOn the search node and use foreach "{{nodes.<id>.output.results}}" with input { "url": "{{item.url}}" }. Foreach items run in parallel.
- http.fetch / fs.read are real I/O for known URLs / workspace files.
- If the user pasted http(s) URLs, http.fetch those exact URLs (parallel when independent), then text.compose. Do NOT web.search.
- If the user named workspace files or a repo-relative path (package.json, README.md, .env.example, .md, .mjs, apps/…), glob / read / grep (or fs.read / fs.search) those cwd-relative paths (parallel when multiple), then text.compose. Do NOT web.search. To list a folder, glob that directory (or fs.read it — { type: "directory", entries }); do not treat EISDIR as a planner failure. Paths are relative to the current cwd (repo root). Do NOT bash, ls, printenv, or read PNPM_SCRIPT_SRC_DIR / TURBO_INVOCATION_DIR to hunt the host repo. If the catalog has coding-tools__* MCP tools, prefer those for repo inspect (read_file / list_dir / search_text / git_status) instead of fs.read; then text.compose. Paths MUST keep extensions: README.md not README. Do NOT apply_patch or exec_command unless the user asked to change files.
- Weekend-trip / 出游 / 出去玩 / 怎么走 (no explicit open-web「搜索」): if the catalog has Amap/maps tools (names like amap-maps__*), use those for geocode, POI, transit/walking, weather; then text.compose. Otherwise use travel mocks — geo.locate, then fan-out travel.search / food.search / hotel.search / transit.search, then memory.filter and article.compose. Do not collapse this into web.search.
- mcp__keenable-search__web_search / web.search is live web search. Use it when the user asked to 搜索/搜一下 the open web, or for non-workspace gather that Amap cannot answer. If the user 搜一下 inside 工作区 / a repo, that is local search: coding-tools__search_text if present, otherwise fs.search { query }. NOT web.search. Input.query must be a short search string.`;

const CATALOG_DESC_MAX = 120;
const CATALOG_SCHEMA_MAX = 1500;

export function formatCatalogTool(tool: ToolDescriptor): string {
  const raw = String(tool.description ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const description =
    raw.length > CATALOG_DESC_MAX ? `${raw.slice(0, CATALOG_DESC_MAX - 1)}…` : raw;
  const head = description ? `- ${tool.name}: ${description}` : `- ${tool.name}`;
  if (tool.inputSchema == null) return head;
  let schema = '';
  try {
    schema = JSON.stringify(tool.inputSchema);
  } catch {
    return head;
  }
  if (!schema) return head;
  if (schema.length > CATALOG_SCHEMA_MAX) {
    schema = `${schema.slice(0, CATALOG_SCHEMA_MAX - 1)}…`;
  }
  return `${head}\n  inputSchema: ${schema}`;
}

export function buildGeneratePrompt(intent: string, tools: ToolDescriptor[]): string {
  const catalog = tools.map((t) => formatCatalogTool(t)).join('\n');
  const noSearch = !/搜索|搜一下|网上搜|web\s*search|检索/.test(intent);
  const workspaceInspect = looksLikeWorkspaceInspect(intent);
  let hint = '';
  if (/https?:\/\//i.test(intent) && noSearch) {
    hint = catalogHasWebFetch(tools)
      ? `\nPlanning hint: pasted URL(s). MUST copy the fetch tool name from the catalog (web_fetch or http.fetch). Omit shared dependsOn so independent fetches run in parallel, then text.compose. Do NOT use web.search.\n`
      : `\nPlanning hint: pasted URL(s). MUST http.fetch each concrete URL (omit shared dependsOn so independent fetches run in parallel), then text.compose. Do NOT use web.search.\n`;
  } else if (workspaceInspect) {
    hint = catalogHasCoding(tools)
      ? `\nPlanning hint: live coding-tools MCP is in the catalog. Copy the exact coding-tools / mcp__coding-tools__* names. Use read_file with exact relative paths that include extensions (package.json, README.md — never bare README). To find a symbol, search_text with { query: "symbol" } — it yields output.path as the first useful hit. Then read_file with { path: "{{nodes.<search>.output.path}}" }. Never pass the whole search dump or a missing path. list_dir uses { path: "packages" }. text.compose parts MUST include the real path ({{nodes.<search>.output.path}}) plus file content. Do NOT invent paths. Do NOT use apply_patch or exec_command unless the user asked to change files. Do NOT use web.search.\n`
      : catalogHasDshRead(tools)
        ? `\nPlanning hint: workspace inspect. Copy exact names from the catalog (read / grep / glob). Paths are relative to the current cwd (repo root) — glob a directory to list it, read a named file. Do NOT bash / ls / printenv, and do NOT read PNPM_SCRIPT_SRC_DIR or TURBO_INVOCATION_DIR to escape an empty sandbox. DSH read returns { path, lines: [{ number, text }] } — interpolate those fields, not .content. Named files: read each path (package.json, README.md). To find a symbol, grep then read {{nodes.<search>.output.path}}. Do NOT invent fs.read. Do NOT use web.search.\n`
        : `\nPlanning hint: workspace inspect. To find a symbol, fs.search with { query: "symbol" } — it yields output.path as the first useful hit. Then fs.read with { path: "{{nodes.<search>.output.path}}" }. Named files: MUST fs.read each named path (package.json, .env.example, README.md, etc; parallel if multiple). Do NOT use web.search.\n`;
  } else if (looksLikeTravelIntent(intent) && noSearch) {
    hint = catalogHasAmap(tools)
      ? `\nPlanning hint: live Amap MCP is in the catalog. Copy the exact tool names (mcp__amap-maps__maps_geo or amap-maps__maps_geo). First maps_geo (address/city) which yields output.location as "longitude,latitude". Then ONE maps_around_search using that string ({{nodes.<geo>.output.location}}) plus a combined keywords string (e.g. 公园|博物馆|亲子). Do not fan-out multiple around_search nodes — Amap QPS will fail them. If the user asked 怎么走/步行 between two named places: maps_geo each place with address=the place (外滩 / 上海博物馆) and city=上海 — not address=上海. Then ONE maps_direction_walking with origin/destination = those output.location strings. Optional maps_weather. Then text.compose. Never pass a city name or the whole geo object as location. Do NOT use travel.search mock tools.\n`
      : `\nPlanning hint: weekend-trip fixture. MUST use geo.locate then fan-out travel.search, food.search, hotel.search, transit.search, then memory.filter and article.compose. Do NOT use web.search.\n`;
  }
  return `${GENERATE_SYSTEM_PROMPT}\n\nTool catalog:\n${catalog}\n${hint}\nUser intent:\n${intent}\n`;
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new WorkflowError('generate_failed', 'LLM output did not contain a JSON object');
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    throw new WorkflowError(
      'generate_failed',
      `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export function catalogHasAmap(tools: ToolDescriptor[]): boolean {
  return tools.some((tool) =>
    /amap|maps_geo|maps_textsearch|maps_aroundsearch|maps_direction/i.test(tool.name)
  );
}

export function catalogHasCoding(tools: ToolDescriptor[]): boolean {
  return tools.some((tool) => tool.name.toLowerCase().includes('coding-tools'));
}

export function catalogHasDshRead(tools: ToolDescriptor[]): boolean {
  return tools.some((tool) => /^(read|grep|glob)$/i.test(tool.name));
}

export function catalogHasWebFetch(tools: ToolDescriptor[]): boolean {
  return tools.some((tool) => /^(web_fetch|http\.fetch)$/i.test(tool.name));
}

export function catalogHasKeenableSearch(tools: ToolDescriptor[]): boolean {
  return tools.some((tool) => /keenable-search|mcp__keenable-search__/i.test(tool.name));
}

export function looksLikeTravelIntent(intent: string): boolean {
  return /出游|出去玩|景点|旅游|周末|周六|周日|怎么走|步行|天气怎样|跑步|骑行|晚饭|吃饭|美食|餐厅/.test(
    intent
  );
}

/** Planning-hint trigger only — does not decide whether to call workflow_run. */
export function looksLikeWorkspaceInspect(intent: string): boolean {
  return /package\.json|readme|\.env\.example|\.md\b|工作区|git_status|列出.{0,80}(目录|文件)|有哪些文件|apps\/|packages\/|\.mjs\b/i.test(
    intent
  );
}

export interface GenerateResult {
  dsl: WorkflowDsl;
  attempts: number;
  prompt: string;
  usage: TokenUsage;
  source: 'llm' | 'heuristic';
}

export async function generateWorkflowDsl(options: {
  intent: string;
  tools: ToolDescriptor[];
  complete?: LlmComplete;
  maxRetries?: number;
  allowHeuristic?: boolean;
}): Promise<GenerateResult> {
  const maxRetries = options.maxRetries ?? 1;
  const prompt = buildGeneratePrompt(options.intent, options.tools);
  const promptChars = prompt.length;

  if (!options.complete) {
    if (
      options.allowHeuristic !== false &&
      looksLikeTravelIntent(options.intent) &&
      !catalogHasAmap(options.tools)
    ) {
      const dsl = weekendTripDsl();
      validateWorkflowDsl(dsl, { tools: options.tools });
      return {
        dsl,
        attempts: 1,
        prompt,
        source: 'heuristic',
        usage: {
          promptChars,
          completionChars: JSON.stringify(dsl).length,
          estimatedTokens: estimateTokens(prompt + JSON.stringify(dsl)),
        },
      };
    }
    throw new WorkflowError(
      'generate_failed',
      'no LLM complete() provided and intent is not heuristic-eligible'
    );
  }

  let lastError = 'unknown';
  let completionChars = 0;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const retryHint =
      attempt === 1
        ? prompt
        : `${prompt}\nPrevious output failed validation: ${lastError}\nReturn corrected JSON only.\n`;
    const text = await options.complete(retryHint);
    completionChars += text.length;
    try {
      const parsed = extractJson(text);
      const shape = safeParseWorkflowDsl(parsed);
      if (!shape.success) {
        lastError = shape.error.message;
        continue;
      }
      const { dsl } = validateWorkflowDsl(shape.data, { tools: options.tools });
      return {
        dsl,
        attempts: attempt,
        prompt,
        source: 'llm',
        usage: {
          promptChars: retryHint.length,
          completionChars,
          estimatedTokens: estimateTokens(retryHint + text),
        },
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new WorkflowError('generate_failed', `DSL generation failed after retries: ${lastError}`);
}
// AIGC END
