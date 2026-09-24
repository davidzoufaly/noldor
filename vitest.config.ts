import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/__tests__/**/*.test.ts'],
    globalSetup: ['./src/testing/suite-lock.ts'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 10_000,
  },
});
