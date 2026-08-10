/**
 * Vitest config picked up when a run starts INSIDE packages/h2a-runtime.
 * Its only job is determinism of dependency resolution: pin every first-party
 * `@sentropic/llm-mesh` import to the copy this package's package.json
 * declares (see vitest.llm-mesh-pin.mjs). The repo-root vitest.config.mjs
 * applies the SAME pin, so both starting directories resolve identically.
 */
import { defineConfig } from "vitest/config";
import { llmMeshPinPlugin } from "./vitest.llm-mesh-pin.mjs";

export default defineConfig({
  plugins: [llmMeshPinPlugin()],
});
