#!/usr/bin/env node
// AIGC START
/**
 * Load the plugin with DSH's real defineTool (no OpenRush worker).
 * Usage: DSH_ROOT=/path/to/deepseek-harness node scripts/smoke-mount.mjs
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '../dist/index.js');
const dshRoot = process.env.DSH_ROOT?.trim();

if (!dshRoot) {
  process.stderr.write('smoke-mount: set DSH_ROOT to a deepseek-harness checkout\n');
  process.exit(1);
}
if (!existsSync(dist)) {
  process.stderr.write(`smoke-mount: missing ${dist}; run pnpm --filter @open-rush/dsh-tool-workflow-run build\n`);
  process.exit(1);
}

const plugin = await import(pathToFileURL(dist).href);
const registered = [];
let prompt = '';
const ctx = {
  tools: {
    register(tool) {
      registered.push(tool);
    },
    schemas() {
      return [
        { name: 'read', description: 'Read a file' },
        { name: 'bash', description: 'Run a command' },
        { name: plugin.WORKFLOW_RUN_TOOL_NAME, description: 'fast lane' },
      ];
    },
    execute: async () => ({ isError: false, value: null }),
  },
  systemPrompt: {
    section(input) {
      prompt = input.text({});
    },
  },
};

await plugin.apply(ctx, {});
const names = registered.map((tool) => tool?.name);
process.stdout.write(
  JSON.stringify(
    {
      pluginName: plugin.name,
      inject: plugin.inject,
      registered: names,
      promptHasFastLane: prompt.includes('workflow_run'),
      promptHasRead: prompt.includes('- read:'),
      promptDeniesBash: /bash/.test(prompt),
    },
    null,
    2
  ) + '\n'
);

if (plugin.name !== 'tool-workflow-run' || names[0] !== 'workflow_run') {
  process.stderr.write('smoke-mount: plugin did not register workflow_run\n');
  process.exit(1);
}
// AIGC END
