import { defineConfig } from '@playwright/test';
import base from '../playwright.config';
export default defineConfig({
  ...base,
  testDir: '.', testMatch: 'pro-navigation.spec.ts',
  outputDir: '/tmp/worldmonitor-navigation-results',
  expect: { timeout: 10000 },
  use: { ...base.use, video: 'off' },
  projects: [{ name: 'chrome', use: { channel: 'chrome', launchOptions: { args: ['--use-angle=swiftshader'] } } }],
});
