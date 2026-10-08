import { defineConfig } from '@playwright/test'

/** E2E: SC-E2E-001 через UI (AT-E2E-001). Сервер поднимается на тестовой БД. */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3300',
    viewport: { width: 1280, height: 900 },
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'npx tsx tests/e2e/server.ts',
    url: 'http://localhost:3300/health',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PORT: '3300' },
  },
})
