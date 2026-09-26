import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:3001',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev --hostname 127.0.0.1 --port 3001',
    reuseExistingServer: !process.env.CI,
    url: 'http://127.0.0.1:3001/login',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
