import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  external: [/^@deepseek-ai\//],
  noExternal: [/@open-rush\//, 'zod'],
});
