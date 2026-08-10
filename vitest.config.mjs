/**
 * Repo-root vitest config, picked up by every vitest run that STARTS at the
 * repo root without an explicit --config (e.g. the CI native-terminal step and
 * ad-hoc `npx vitest run packages/h2a-runtime/src/...`). It deliberately
 * changes NOTHING except dependency-resolution determinism: first-party
 * imports of `@sentropic/llm-mesh` are pinned to the copy h2a-runtime's
 * package.json declares, so a test file can never silently fail to COLLECT
 * because the root-hoisted older copy won the walk-up (see
 * packages/h2a-runtime/vitest.llm-mesh-pin.mjs for the full mechanism).
 *
 * Suites that pass their own --config (packages/track via scripts/run-tests.mjs)
 * are not affected.
 */
import { defineConfig } from "vitest/config";
import { llmMeshPinPlugin } from "./packages/h2a-runtime/vitest.llm-mesh-pin.mjs";

export default defineConfig({
  plugins: [llmMeshPinPlugin()],
});
