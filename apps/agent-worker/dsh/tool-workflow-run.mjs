#!/usr/bin/env node
// AIGC START
/** Cordis shim: DSH child cwd is the harness repo, so load the workspace plugin via agent-worker. */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../package.json'));
const spec = require.resolve('@open-rush/dsh-tool-workflow-run');
const plugin = await import(pathToFileURL(spec).href);

export const name = plugin.name;
export const inject = plugin.inject;
export const apply = plugin.apply;
// AIGC END
