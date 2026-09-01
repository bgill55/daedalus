import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});

