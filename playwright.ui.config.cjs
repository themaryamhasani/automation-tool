const path = require('node:path');
const { defineConfig, devices } = require('@playwright/test');

const chrome = process.env.CHROMIUM_EXECUTABLE_PATH;

module.exports = defineConfig({
  testDir: path.resolve(__dirname, 'scripts'),
  testMatch: 'ui-check.spec.cjs',
  timeout: 60_000,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: process.env.UI_BASE_URL || 'http://127.0.0.1:5180',
    headless: true,
    ...(chrome ? { launchOptions: { executablePath: chrome } } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], browserName: 'chromium' } }],
});
