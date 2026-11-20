import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Browsers live in the lane .tmp (never /tmp). Honour an externally set path.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp', 'pw-browsers');

export default defineConfig({
  testDir: './e2e',
  // The real-backend acceptance has its own config (playwright.real.config.ts).
  testIgnore: /review\.real\.spec\.ts$/,
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:5199',
    viewport: { width: 1440, height: 900 }
  },
  webServer: {
    command: 'npm run dev -- --port 5199 --strictPort',
    url: 'http://127.0.0.1:5199/artifact/boot',
    timeout: 180_000,
    reuseExistingServer: false,
    env: { PUBLIC_FOCUS_ARTIFACT_REVIEW: '1' }
  }
});
