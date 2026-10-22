import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Integration tests share one database, so they must not interleave.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    setupFiles: ['./tests/setup-env.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
