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
- "tool" MUST be copied exactly from the catalog. Never invent a tool name.
- Each node is exactly one tool call.
- Independent nodes should omit shared dependsOn so they run in parallel.
- Pass data with {{intent.text}} and {{nodes.<id>.output}} / {{nodes.<id>.output.*}}.
- Prefer a shared setup node, then fan-out, then join / compose.
- When wiring article.compose or text.compose, pass whole previous outputs. text.compose is the final assistant chat reply after gather tools — same tone as OpenRush/DSH, not a standalone markdown article. Prefer input { "intent": "{{intent.text}}", "parts": ... }.
- Skip catalog tools that are irrelevant to this intent.
- web.search is live web search. Input.query must be a short search string, never the whole user sentence. Prefer it for open-web facts and recommendations.
- After web.search, pass {{nodes.<id>.output}} into text.compose. Do NOT http.fetch search hits unless the user pasted a concrete URL.
- If you must fetch a search hit, dependsOn the search node and use foreach "{{nodes.<id>.output.results}}" with input { "url": "{{item.url}}" }. Foreach items run in parallel.
- http.fetch / fs.read are real I/O for known URLs / workspace files.
- If the user pasted http(s) URLs, http.fetch those exact URLs (parallel when independent), then text.compose. Do NOT web.search.
- If the user named workspace files (package.json, README.md, .env.example, .md), fs.read those paths (parallel when multiple), then text.compose. Do NOT web.search. To list a folder, fs.read that directory path (it returns { type: "directory", entries }) — do not treat EISDIR as a planner failure. If the catalog has coding-tools__* MCP tools, prefer those for repo inspect (read_file / list_dir / search_text / git_status) instead of fs.read; then text.compose. Paths MUST keep extensions: README.md not README. Do NOT apply_patch or exec_command unless the user asked to change files.
- Weekend-trip / 出游 / 出去玩 / 怎么走 (no explicit open-web「搜索」): if the catalog has Amap/maps tools (names like amap-maps__*), use those for geocode, POI, transit/walking, weather; then text.compose. Otherwise use travel mocks — geo.locate, then fan-out travel.search / food.search / hotel.search / transit.search, then memory.filter and article.compose. Do not collapse this into web.search.
- web.search is live web search. Use it only when the user asked to 搜索/搜一下 the open web, or for non-workspace gather. If the user 搜一下 inside 工作区 / a repo, that is local search: coding-tools__search_text if present, otherwise fs.search { query }. NOT web.search. Input.query must be a short search string.`;

export function buildGeneratePrompt(intent: string, tools: ToolDescriptor[]): string {
  const catalog = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');
  const noSearch = !/搜索|搜一下|网上搜|web\s*search|检索/.test(intent);
  const workspaceInspect = /package\.json|readme|\.env\.example|\.md\b|工作区|git_status/i.test(
    intent
  );
  let hint = '';
  if (/https?:\/\//i.test(intent) && noSearch) {
    hint = `\nPlanning hint: pasted URL(s). MUST http.fetch each concrete URL (omit shared dependsOn so independent fetches run in parallel), then text.compose. Do NOT use web.search.\n`;
  } else if (workspaceInspect) {
    hint = catalogHasCoding(tools)
      ? `\nPlanning hint: live coding-tools MCP is in the catalog. Use coding-tools__read_file with exact relative paths that include extensions (package.json, README.md — never bare README). To find a symbol, coding-tools__search_text with { query: "symbol" } — it yields output.path as the first useful hit. Then coding-tools__read_file with { path: "{{nodes.<search>.output.path}}" }. Never pass the whole search dump or a missing path. list_dir uses { path: "packages" }. text.compose parts MUST include the real path ({{nodes.<search>.output.path}}) plus file content. Do NOT invent paths. Do NOT use apply_patch or exec_command unless the user asked to change files. Do NOT use web.search.\n`
      : `\nPlanning hint: workspace inspect. To find a symbol, fs.search with { query: "symbol" } — it yields output.path as the first useful hit. Then fs.read with { path: "{{nodes.<search>.output.path}}" }. Named files: MUST fs.read each named path (package.json, .env.example, README.md, etc; parallel if multiple). Do NOT use web.search.\n`;
  } else if (looksLikeTravelIntent(intent) && noSearch) {
    hint = catalogHasAmap(tools)
      ? `\nPlanning hint: live Amap MCP is in the catalog. First amap-maps__maps_geo (address/city) which yields output.location as "longitude,latitude". Then ONE maps_around_search using that string ({{nodes.<geo>.output.location}}) plus a combined keywords string (e.g. 公园|博物馆|亲子). Do not fan-out multiple around_search nodes — Amap QPS will fail them. If the user asked 怎么走/步行 between two named places: maps_geo each place with address=the place (外滩 / 上海博物馆) and city=上海 — not address=上海. Then ONE maps_direction_walking with origin/destination = those output.location strings. Optional maps_weather. Then text.compose. Never pass a city name or the whole geo object as location. Do NOT use travel.search mock tools.\n`
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

export function looksLikeTravelIntent(intent: string): boolean {
  return /出游|出去玩|景点|旅游|周末|周六|周日|怎么走|步行|天气怎样/.test(intent);
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
