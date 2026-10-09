import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/perf/**', 'node_modules/**'],
    globalSetup: ['tests/support/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    env: { LOG_LEVEL: 'silent' },
    hookTimeout: 30000,
  },
})
