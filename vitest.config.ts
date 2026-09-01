import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 1,
        minForks: 1,
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 15000,
  },
});
