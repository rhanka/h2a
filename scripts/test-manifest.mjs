/**
 * The single declaration of what the root `npm test` gate covers.
 *
 * It lives apart from `run-tests.mjs` because two readers need it and only one
 * of them may execute the suites: the runner runs them, and the structural
 * coverage test (packages/h2a/test/test-gate-coverage.test.js) checks that no
 * workspace package carrying test files sits outside this manifest.
 *
 * WHY THIS FILE EXISTS. Until 2026-07-29 the gate silently covered two trees out
 * of eight. `packages/h2a-runtime` alone — the session launcher, the gateway
 * proxy, the model catalogue — carried 1141 tests that had never guarded a
 * single pull request, and it is the required check on `main` under
 * `enforce_admins`. Adding the missing suites fixes the state; the structural
 * test is what fixes the cause, so the next package added cannot fall into the
 * same hole in silence.
 */

/** Trees whose top-level `*.test.js` files run under `node --test`. */
export const NODE_TEST_DIRS = [
  // A1: la suite vit dans packages/h2a/test (h2a-cli est un stub deprecie, sans tests).
  "packages/h2a/test",
  "packages/focus-interactive/test",
];

/**
 * Packages whose `.test.ts`/`.spec.ts` sources run under Vitest. `dir` is the
 * package root; `testDir` defaults to `src`; `config` is optional.
 */
export const VITEST_SUITES = [
  { name: "Track", dir: "packages/track", config: "vitest.config.ts" },
  { name: "Runtime", dir: "packages/h2a-runtime" },
  { name: "Remote protocol", dir: "packages/remote-protocol" },
  { name: "Remote k8s orchestrator", dir: "packages/remote-k8s-orchestrator" },
  { name: "Control plane", dir: "apps/control-plane" },
  { name: "LLM gateway", dir: "apps/llm-gateway" },
  // Its specs live in `tests/`, not `src/`, and the package declares no `test`
  // script — so nothing ran them, anywhere, until the structural test named it.
  { name: "Focus", dir: "packages/focus", testDir: "tests" },
];

/**
 * Packages deliberately left OUT of the gate, each with the reason and the
 * track item that will remove it. The structural test fails on a stale entry
 * (one that carries no tests, or that is in fact covered), so an exemption
 * cannot quietly outlive its reason.
 *
 * Empty is the target state, and the current state. Do not add to this list to
 * make a red suite go away: a quarantine that nobody has to justify is how the
 * previous blind spot lasted.
 */
export const UNCOVERED_PACKAGES = [
  // { dir: "packages/x", reason: "...", trackItem: "01..." },
];

/** File suffixes that make a package a test-carrying package. */
export const TEST_FILE_SUFFIXES = [".test.ts", ".spec.ts", ".test.js", ".spec.js"];

/** Directories never scanned when looking for test files. */
export const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".test-scratch",
  ".svelte-kit",
  "focus-app",
]);
