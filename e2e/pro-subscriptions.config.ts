import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'pro-subscriptions.spec.ts', workers: 1,
  use: { baseURL: 'http://127.0.0.1:4180', ...devices['Desktop Chrome'], channel: 'chrome' },
  webServer: { command: 'npm --prefix ../pro-test run dev -- --host 127.0.0.1 --port 4180', url: 'http://127.0.0.1:4180/pro/', reuseExistingServer: true },
});
