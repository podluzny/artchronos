import { defineConfig } from 'vitest/config'

/** Нагрузочные тесты (T-083, NFR-PERF-001…005): `npm run test:perf`. Не входят в обычный прогон. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/perf/**/*.test.ts'],
    globalSetup: ['tests/perf/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 300000,
    hookTimeout: 600000,
    env: { LOG_LEVEL: 'silent' },
    reporters: ['default', 'json'],
    outputFile: { json: 'validation/perf-results.json' },
  },
})
