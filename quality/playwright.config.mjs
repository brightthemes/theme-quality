import { defineConfig, devices } from '@playwright/test';
import { join } from 'path';
import { results } from '../lib/config.mjs';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  outputDir: join(results, 'playwright'),
  reporter: [['list'], ['html', { outputFolder: join(results, 'report'), open: 'never' }]],
  fullyParallel: true,
  globalSetup: './member-setup.mjs',
  use: {
    baseURL: process.env.BASE_URL,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined }
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } }
  ]
});
