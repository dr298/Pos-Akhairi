import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/full-qa',
  timeout: 300000,
  fullyParallel: false,  // must run sequential — shared results
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://pos.akhairi.com',
    headless: true,
  },
  reporter: [['list']],
});
