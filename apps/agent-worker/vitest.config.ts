import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    env: {
      AGENT_RUNTIME: 'claude-code',
    },
  },
});
