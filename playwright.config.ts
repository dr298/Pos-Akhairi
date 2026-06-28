import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://pos-uat.akhairi.com',
    headless: true,
  },
  reporter: [['list']],
});
