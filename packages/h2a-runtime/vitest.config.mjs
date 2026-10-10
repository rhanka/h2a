/**
 * Vitest config picked up when a run starts INSIDE packages/h2a-runtime.
 * It installs the native test isolation boundary that
 * packages/h2a/test/native-spawn-guard.test.js requires from every default
 * test runner.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { setupFiles: ["./vitest.native-isolation.mjs"] },
});
