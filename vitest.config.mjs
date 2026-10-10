/**
 * Repo-root vitest config, picked up by every vitest run that STARTS at the
 * repo root without an explicit --config (e.g. ad-hoc
 * `npx vitest run packages/...`). It installs the native test isolation
 * boundary that packages/h2a/test/native-spawn-guard.test.js requires from
 * every default test runner.
 *
 * Suites that pass their own --config (packages/track via scripts/run-tests.mjs)
 * are not affected.
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    setupFiles: [fileURLToPath(new URL("./packages/h2a-runtime/vitest.native-isolation.mjs", import.meta.url))],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.qual-tmp/**"]
  },
});
