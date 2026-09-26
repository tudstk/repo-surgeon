import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:3001',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node e2e/proxy-api-server.mjs',
      reuseExistingServer: !process.env.CI,
      url: 'http://127.0.0.1:8010/health',
      env: { PROXY_API_PORT: '8010', PROXY_FRONTEND_ORIGIN: 'http://127.0.0.1:3001' },
    },
    {
      command: 'pnpm dev --hostname 127.0.0.1 --port 3001',
      reuseExistingServer: !process.env.CI,
      url: 'http://127.0.0.1:3001/login',
      env: { REPO_SURGEON_API_ORIGIN: 'http://127.0.0.1:8010' },
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
