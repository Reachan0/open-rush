#!/usr/bin/env node
// AIGC START
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const NAME = 'dsh-jsonrpc-agent';
const repoRoot = process.env.DSH_ROOT;
if (!repoRoot) {
  process.stderr.write(
    `${NAME}: DSH_ROOT is required so plugins resolve from the harness checkout\n`
  );
  process.exit(1);
}

const { boot, installFailLoud, loadEnv, resolveConfigPath } = await import(
  pathToFileURL(resolve(repoRoot, 'packages/boot/app-boot/lib/index.js')).href
);

installFailLoud(NAME);
loadEnv(NAME);

const fromEnv = process.env.DSH_CORDIS_CONFIG;
const fromArgv = process.argv[2];
const requested =
  fromEnv !== undefined && fromEnv !== ''
    ? fromEnv
    : fromArgv !== undefined && fromArgv !== ''
      ? fromArgv
      : undefined;
const configPath = requested === undefined ? undefined : resolveConfigPath(requested, undefined);
if (configPath === undefined || !existsSync(configPath)) {
  process.stderr.write(
    `usage: ${NAME} <path/to/cordis.yml> (or set DSH_CORDIS_CONFIG); DSH_ROOT must point at deepseek-harness\n`
  );
  process.exit(1);
}

const hostUrl = pathToFileURL(resolve(repoRoot, 'python/sdk-runtime/package.json')).href;
const ctx = await boot(NAME, configPath, undefined, undefined, hostUrl);

let exiting = false;
async function disposeAndExit(code) {
  if (exiting) return;
  exiting = true;
  try {
    await ctx.fiber.dispose();
  } finally {
    process.exit(code);
  }
}

process.stdin.on('end', () => {
  void disposeAndExit(0);
});
process.on('SIGTERM', () => {
  void disposeAndExit(0);
});
process.on('SIGINT', () => {
  void disposeAndExit(130);
});
// AIGC END
