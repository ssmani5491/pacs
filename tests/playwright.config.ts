import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  timeout: 90000,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: process.env.BASE_URL || 'http://localhost', headless: true },
});
