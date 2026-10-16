/**
 * Vitest config for the TypeScript suites of @sentropic/h2a-runtime.
 *
 * SPEC 0.98.5 R8.1 pins this file at EXACTLY `packages/h2a-runtime/vitest.config.ts`
 * and the gate command at EXACTLY
 *   `node_modules/.bin/vitest run --config packages/h2a-runtime/vitest.config.ts`
 * (executed from the repository root). Until this config existed, no npm script
 * or release gate ever executed the runtime's TypeScript suites: `npm test`
 * discovered only `packages/h2a/test` and `packages/focus-interactive/test`
 * (`.test.js`, via node --test) plus the Track vitest suite, while every
 * `*.test.ts` under `packages/h2a-runtime/src` ran nowhere between a green CI
 * and an npm publish. Four released versions shipped that way.
 *
 * `root` is anchored to THIS directory on purpose: the pinned gate command runs
 * vitest from the repository root, and vitest resolves `include` and
 * `setupFiles` relative to the project root, which would otherwise be the
 * caller's cwd and match nothing.
 *
 * The separate `vitest.config.mjs` next to this file is unchanged: it is picked
 * up when a run starts INSIDE this package and only installs the isolation
 * boundary. This config is the one the release gate invokes by exact path.
 */
import { fileURLToPath } from "node:url";
import { defineConfig as vitestConfig } from "vitest/config";
import { assertTestConfig } from "../../scripts/test-config-contract.mjs";

function defineConfig(config) {
  return vitestConfig(assertTestConfig(config, "runtime"));
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.native-isolation.mjs"],
    environment: "node",
    // SPEC 0.98.5 R8 (round-7 review finding P1): the gate command is pinned
    // EXACTLY, so the execution proof cannot ride on extra CLI arguments —
    // the report is wired HERE. The gate runner reads it after the run and
    // refuses a green unless every required suite EXECUTED (round 7:
    // `testNamePattern: "^C7_NO_TEST_HAS_THIS_NAME$"` in this config left the
    // runner green at exit 0 while 14 native tests silently never ran).
    // Filters that remove tests are structurally banned from this file by
    // the trust root (testNamePattern/exclude/skip/only/todo/grep/
    // passWithNoTests), so a run that writes no report or a report full of
    // skipped tests fails the gate instead of grading discovery as
    // execution. Output path is pinned by name in both this config and
    // scripts/run-test-gates.mjs; tmp/ is gitignored.
    reporters: [
      "default",
      ["json", { outputFile: process.env.H2A_TEST_REPORT_PATH ?? fileURLToPath(new URL("../../tmp/h2a-runtime-vitest-report.json", import.meta.url)) }],
    ],
  },
});
