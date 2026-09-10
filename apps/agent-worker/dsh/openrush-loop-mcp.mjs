#!/usr/bin/env node
// AIGC START
/**
 * Opt-in Loop MCP servers for the OpenRush DSH child.
 * Does not change deepseek-harness source. Skips a server when its env/command
 * is missing so DSH startup does not wait on a 60s MCP connect timeout.
 *
 * Search is Keenable MCP (`mcp__keenable-search__web_search`), not DSH native
 * `web_search`. Native search hits Anthropic /messages with DEEPSEEK_API_KEY
 * (not DEEPSEEK_BASE_URL); a private-gateway key fails at execute.
 *
 * apply() connects Amap and Keenable in parallel so ctx.tools.schemas() already
 * contains them before the first Loop turn and workflow_run. coding-tools is
 * off unless CODING_TOOLS_MCP=1 (avoids a cold `npx coding-tools-mcp` on every
 * new chat).
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveKeenableBaseUrl } from './keenable-search-mcp.mjs';

export const name = 'openrush-loop-mcp';
export const inject = ['tools', 'systemPrompt'];

function commandOnPath(bin) {
  const pathEnv = process.env.PATH ?? '';
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const suffixes = process.platform === 'win32' ? ['', '.cmd', '.exe'] : [''];
  return pathEnv
    .split(delimiter)
    .some((dir) => suffixes.some((suffix) => existsSync(join(dir, `${bin}${suffix}`))));
}

/** Explicit opt-in only. Unset / 0 / false skips npx coding-tools. */
export function codingToolsEnabled(env = process.env) {
  const flag = (env.CODING_TOOLS_MCP ?? '').trim().toLowerCase();
  return ['1', 'true', 'on', 'yes'].includes(flag);
}

function mcpClientUrl(root) {
  const built = join(root, 'packages/mcp/mcp-client/lib/index.js');
  if (existsSync(built)) return pathToFileURL(built).href;
  throw new Error(`openrush-loop-mcp: missing ${built}`);
}

async function connectMcp(ctx, mcp, config) {
  const started = Date.now();
  process.stderr.write(`[openrush-loop-mcp] connecting ${config.serverName} (${config.transport})\n`);
  try {
    await ctx.plugin(mcp, config);
    const elapsed = Date.now() - started;
    const names = ctx.tools
      .schemas()
      .map((schema) => schema.name)
      .filter((name) => name.includes(config.serverName));
    process.stderr.write(
      `[openrush-loop-mcp] ready ${config.serverName} · ${elapsed}ms · ${names.join(', ') || '(no tools)'}\n`
    );
  } catch (err) {
    const elapsed = Date.now() - started;
    process.stderr.write(
      `[openrush-loop-mcp] ${config.serverName} failed after ${elapsed}ms: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }
}

export async function apply(ctx) {
  const root = process.env.DSH_ROOT;
  if (!root) {
    process.stderr.write('[openrush-loop-mcp] skip: DSH_ROOT is not set\n');
    return;
  }
  let mcp;
  try {
    mcp = await import(mcpClientUrl(root));
  } catch (err) {
    process.stderr.write(
      `[openrush-loop-mcp] skip: cannot load dsh-mcp-client (${err instanceof Error ? err.message : String(err)})\n`
    );
    return;
  }

  const started = Date.now();
  const jobs = [];

  const amapKey = (process.env.AMAP_MAPS_API_KEY ?? '').trim();
  if (amapKey) {
    jobs.push(
      connectMcp(ctx, mcp, {
        serverName: 'amap-maps',
        transport: 'streamable-http',
        url: `https://mcp.amap.com/mcp?key=${encodeURIComponent(amapKey)}`,
        failOnStartupError: false,
        toolCallTimeoutMs: 60_000,
      })
    );
  } else {
    process.stderr.write('[openrush-loop-mcp] skip amap-maps: AMAP_MAPS_API_KEY is empty\n');
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const searchServer = join(here, 'keenable-search-mcp.mjs');
  if (existsSync(searchServer)) {
    const keenableBase = resolveKeenableBaseUrl(process.env);
    jobs.push(
      connectMcp(ctx, mcp, {
        serverName: 'keenable-search',
        transport: 'stdio',
        command: process.execPath,
        args: [searchServer],
        cwd: here,
        env: {
          KEENABLE_API_KEY: (process.env.KEENABLE_API_KEY ?? '').trim(),
          KEENABLE_API_URL: keenableBase,
          KEENABLE_BASE_URL: keenableBase,
          KEENABLE_TITLE: (process.env.KEENABLE_TITLE ?? 'OpenRush').trim() || 'OpenRush',
        },
        failOnStartupError: false,
        toolCallTimeoutMs: 60_000,
      })
    );
  } else {
    process.stderr.write(`[openrush-loop-mcp] skip keenable-search: missing ${searchServer}\n`);
  }

  const codingOn = codingToolsEnabled();
  if (codingOn) {
    const cwd = process.env.DSH_CWD || process.env.WORKFLOW_WORKSPACE || process.cwd();
    const mode = (process.env.CODING_TOOLS_MCP_PERMISSION_MODE ?? 'safe').trim() || 'safe';
    const command = commandOnPath('npx') ? 'npx' : commandOnPath('uvx') ? 'uvx' : '';
    if (!command) {
      process.stderr.write('[openrush-loop-mcp] skip coding-tools: npx/uvx not on PATH\n');
    } else {
      const args =
        command === 'npx'
          ? ['-y', 'coding-tools-mcp', '--stdio', '--workspace', cwd, '--permission-mode', mode]
          : ['coding-tools-mcp', '--stdio', '--workspace', cwd, '--permission-mode', mode];
      jobs.push(
        connectMcp(ctx, mcp, {
          serverName: 'coding-tools',
          transport: 'stdio',
          command,
          args,
          env: {
            CODING_TOOLS_MCP_TELEMETRY: 'off',
            DO_NOT_TRACK: '1',
          },
          cwd,
          failOnStartupError: false,
          toolCallTimeoutMs: 60_000,
        })
      );
    }
  } else {
    process.stderr.write(
      '[openrush-loop-mcp] skip coding-tools: CODING_TOOLS_MCP is unset or off (set CODING_TOOLS_MCP=1 to enable npx)\n'
    );
  }

  if (jobs.length > 0) {
    await Promise.all(jobs);
  }
  process.stderr.write(`[openrush-loop-mcp] startup ${Date.now() - started}ms (${jobs.length} servers)\n`);

  ctx.systemPrompt.section({
    name: 'openrush-loop-mcp',
    order: 107,
    text: [
      '不要调用 DSH 原生 web_search：当前网关 key 不能走 DeepSeek Anthropic 搜索口，会 Authentication Fails。',
      '网页搜索（mcp__keenable-search__web_search）、地点/天气/路线（mcp__amap-maps__*）、已知 URL（web_fetch）、工作区只读检索（read / grep / glob）已并入快车道：调用 workflow_run，不要自己连调这些工具。',
      codingOn ? '改文件、跑命令仍用外层 write / edit / bash；coding-tools 只读能力同样走 workflow_run。' : '改文件、跑命令仍用外层 write / edit / bash。',
    ].join(' '),
  });
}
// AIGC END
