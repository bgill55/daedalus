import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    isolate: true,
    poolOptions: {
      forks: {
        maxForks: 1,
        minForks: 1,
        isolateWorkers: true,
      },
    },
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 15000,
  },
});
