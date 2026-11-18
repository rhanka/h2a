import { defineConfig } from '@playwright/test';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createWorld, registerRecipient, RECIPIENT } from './e2e/real-backend.mjs';

// Acceptance against the REAL artifact review backend (FOCUS_ARTIFACT_REVIEW routes of
// apps/focus) instead of the in-page fake. Needs the backend routes in this checkout and
// a built h2a CLI (npm run build at the repo root). Run: npm run test:e2e:real.
// The world (h2a root, HOME, XDG dirs) is created once by the runner process and inherited
// by the workers through the environment; it is removed when the runner exits.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp', 'pw-browsers');
if (!process.env.FOCUS_REVIEW_REAL_WORLD) {
  const world = createWorld();
  await registerRecipient(world, process.pid);
  process.env.FOCUS_REVIEW_REAL_WORLD = JSON.stringify(world);
  process.on('exit', () => rmSync(world.base, { recursive: true, force: true }));
}
const world = JSON.parse(process.env.FOCUS_REVIEW_REAL_WORLD);

export default defineConfig({
  testDir: './e2e',
  testMatch: /review\.real\.spec\.ts$/,
  timeout: 120_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5198',
    viewport: { width: 1440, height: 900 }
  },
  webServer: {
    command: 'npm run dev -- --port 5198 --strictPort',
    url: 'http://127.0.0.1:5198/artifact/boot',
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      PATH: process.env.PATH ?? '',
      TMPDIR: process.env.TMPDIR ?? '',
      HOME: world.home,
      XDG_RUNTIME_DIR: world.run,
      XDG_CONFIG_HOME: world.config,
      XDG_STATE_HOME: world.state,
      FOCUS_H2A_ROOT: world.root,
      FOCUS_H2A_TARGET: RECIPIENT,
      FOCUS_ARTIFACT_REVIEW: '1',
      PUBLIC_FOCUS_ARTIFACT_REVIEW: '1',
      FOCUS_REVIEW_OWNER_ID: 'owner',
      FOCUS_REVIEW_OWNER_LABEL: 'Owner'
    }
  }
});
