import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testMatch: '**/*.spec.ts', workers: 1, fullyParallel: false,
  reporter: 'list', timeout: 20000,
  use: { baseURL: 'http://127.0.0.1:4175', headless: true, channel: 'chrome', trace: 'retain-on-failure' },
  webServer: { command: 'npm run test:harness', url: 'http://127.0.0.1:4175', reuseExistingServer: false, timeout: 30000 }
});
