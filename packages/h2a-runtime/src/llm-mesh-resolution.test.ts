/**
 * Resolution guard for `@sentropic/llm-mesh`.
 *
 * The repo carries TWO physical copies of this package: the version pinned by
 * packages/h2a-runtime/package.json (nested under this package's
 * node_modules) and an older major hoisted at the repo root for
 * `@sentropic/llm-gateway`'s own range. The older copy has NO `./facade`
 * export, so if it ever wins resolution for h2a-runtime's imports, every test
 * file whose import chain reaches src/llm-mesh.ts fails to COLLECT — vitest
 * prints "Test Files 1 failed / Tests no tests", an absence that never
 * appears in a passed-count. The vitest configs pin resolution (see
 * vitest.llm-mesh-pin.mjs); THIS file is the test-level rung of the same
 * invariant: it turns any degraded resolution into a NAMED red assertion
 * carrying the resolved version and physical path.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

const declaredPin = (
  JSON.parse(readFileSync(join(RUNTIME_DIR, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  }
).dependencies["@sentropic/llm-mesh"];

describe("@sentropic/llm-mesh resolution is deterministic", () => {
  // Rung 1 — the LOADER (vite/vitest pipeline, where the pin plugin acts).
  // Loading `./facade` at all is version-discriminating: the root-hoisted
  // 0.8.x copy does not export it, so a successful load PROVES the pinned
  // copy served the import.
  it("LLM_MESH_FACADE_LOADS_INSTEAD_OF_SILENTLY_DROPPING_COLLECTION", async () => {
    const outcome = await import("@sentropic/llm-mesh/facade").then(
      () => "loaded",
      (err: unknown) => `load-failed: ${(err as Error).message}`,
    );
    expect(outcome).toBe("loaded");
  });

  // Rung 2 — the INSTALL STATE (native Node resolution, which import.meta
  // .resolve uses; it bypasses vite plugins). Anchored at THIS file, it walks
  // up exactly like the pin plugin's anchor does: it goes red — with the
  // resolved version and physical path in the diff — whenever the nested copy
  // is missing or drifts from the declared pin (the degraded install that
  // used to surface as a silent "no tests").
  it("RESOLVED_LLM_MESH_VERSION_IS_THE_DECLARED_PIN_NOT_A_HOISTED_COPY", () => {
    const resolvedPath = fileURLToPath(
      import.meta.resolve("@sentropic/llm-mesh/facade"),
    );
    const marker = "/node_modules/@sentropic/llm-mesh/";
    const idx = resolvedPath.lastIndexOf(marker);
    expect(idx, `resolved outside node_modules: ${resolvedPath}`).toBeGreaterThan(-1);
    const resolvedVersion = (
      JSON.parse(
        readFileSync(
          `${resolvedPath.slice(0, idx + marker.length)}package.json`,
          "utf8",
        ),
      ) as { version: string }
    ).version;
    // The assertion diff names both sides: the version actually loaded and
    // the version package.json declares. A hoisted/stale copy reds out HERE
    // with its version and path, never as a fileless "no tests".
    expect(`${resolvedVersion} at ${resolvedPath}`).toBe(
      `${declaredPin} at ${join(
        RUNTIME_DIR,
        "node_modules/@sentropic/llm-mesh/dist/service/facade.js",
      )}`,
    );
  });
});
