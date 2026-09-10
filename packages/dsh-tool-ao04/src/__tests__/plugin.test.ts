// AIGC START
import { describe, expect, it, vi } from 'vitest';

vi.mock('../resolve-dsh-tools.js', () => ({
  importDefineTool: async () => (options: unknown) => options,
}));

import { apply } from '../plugin.js';

describe('AO-04 Cordis plugin', () => {
  it('fails plugin application when ao04_read_status cannot be registered', async () => {
    const ctx = {
      tools: {
        register() {
          throw new Error('AO-04 registration rejected');
        },
      },
      systemPrompt: { section() {} },
    };

    await expect(apply(ctx)).rejects.toThrow('AO-04 registration rejected');
  });
});
// AIGC END
