/**
 * Resolution guard for `@sentropic/llm-mesh`.
 *
 * The repo can carry more than one physical copy of this package on disk (a
 * copy nested under this package's node_modules, and/or a copy hoisted at
 * the repo root for other dependents such as `@sentropic/llm-gateway`). A
 * copy whose version does not satisfy h2a-runtime's declared range
 * (packages/h2a-runtime/package.json, currently `^0.15.0`) may be missing an
 * export this package imports (e.g. `./facade`), so if it ever wins
 * resolution, every test file whose import chain reaches src/llm-mesh.ts
 * fails to COLLECT — vitest prints "Test Files 1 failed / Tests no tests",
 * an absence that never appears in a passed-count. The vitest configs pin
 * resolution (see vitest.llm-mesh-pin.mjs); THIS file is the test-level rung
 * of the same invariant: it turns any degraded resolution into a NAMED red
 * assertion carrying the resolved version and physical path.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pinnedLlmMeshDir, satisfiesDeclaredLlmMeshVersion } from "../vitest.llm-mesh-pin.mjs";

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
  // .resolve uses; it bypasses vite plugins). Anchored at THIS file, native
  // resolution walks up the same directory chain the pin plugin's own
  // walk-up (pinnedLlmMeshDir) does, so in a correct install both arrive at
  // the SAME physical copy regardless of whether it is nested under
  // packages/h2a-runtime or hoisted at the repo root. This goes red — with
  // the resolved version and physical path in the diff — whenever native
  // resolution and the pin guard disagree on the physical copy, or whenever
  // the resolved version does not SATISFY the declared range (the degraded
  // install that used to surface as a silent "no tests").
  it("RESOLVED_LLM_MESH_VERSION_SATISFIES_THE_DECLARED_RANGE_NOT_A_STALE_COPY", () => {
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
    // the range package.json declares. A copy outside the declared range
    // reds out HERE with its version and path, never as a fileless
    // "no tests".
    expect(
      satisfiesDeclaredLlmMeshVersion(resolvedVersion, declaredPin),
      `resolved ${resolvedVersion} at ${resolvedPath} does not satisfy declared ${declaredPin}`,
    ).toBe(true);
    // Native resolution and the pin guard's own walk-up must agree on which
    // physical copy this is — no silent divergence between what vite serves
    // and what a bare `import.meta.resolve` would find.
    expect(resolvedPath).toBe(join(pinnedLlmMeshDir(), "dist/service/facade.js"));
  });
});

// Counter-mutant: `pinnedLlmMeshDir` throws IFF `satisfiesDeclaredLlmMeshVersion`
// returns false for the (resolved version, declared range) pair it reads from
// disk — this is the ONLY thing the fix from exact-string equality to a
// range-satisfies check changed. A version comparison that silently accepts
// everything (the bug this replaces: `"0.15.0" !== "^0.15.0"` was always
// true, so exact-equality false-threw on every correct caret install; the
// opposite bug would be a comparison that never throws at all) must still be
// caught here. These fixture pairs are exactly the shapes read out of a real
// package.json: a caret range declaration and a plain release version.
describe("satisfiesDeclaredLlmMeshVersion discriminates a caret range", () => {
  it("REJECTS_A_RESOLVED_VERSION_BELOW_THE_DECLARED_CARET_FLOOR", () => {
    // The scenario CI actually hit: declared ^0.15.0, installed 0.13.2.
    expect(satisfiesDeclaredLlmMeshVersion("0.13.2", "^0.15.0")).toBe(false);
  });

  it("REJECTS_A_RESOLVED_VERSION_FROM_AN_OLDER_MAJOR", () => {
    expect(satisfiesDeclaredLlmMeshVersion("0.8.1", "^0.15.0")).toBe(false);
  });

  it("REJECTS_A_RESOLVED_VERSION_ABOVE_THE_CARET_CEILING", () => {
    // ^0.15.0 locks the minor (leading non-zero component): 0.16.0 is a
    // breaking bump under npm's 0.x caret semantics, not a floor bump.
    expect(satisfiesDeclaredLlmMeshVersion("0.16.0", "^0.15.0")).toBe(false);
  });

  it("ACCEPTS_THE_EXACT_DECLARED_FLOOR", () => {
    expect(satisfiesDeclaredLlmMeshVersion("0.15.0", "^0.15.0")).toBe(true);
  });

  it("ACCEPTS_A_PATCH_BUMP_WITHIN_THE_LOCKED_MINOR", () => {
    expect(satisfiesDeclaredLlmMeshVersion("0.15.7", "^0.15.0")).toBe(true);
  });

  it("REJECTS_A_MISMATCHED_EXACT_PIN", () => {
    // Non-caret declarations (a plain "X.Y.Z" pin) still compare by equality.
    expect(satisfiesDeclaredLlmMeshVersion("0.13.3", "0.13.2")).toBe(false);
  });

  it("ACCEPTS_A_MATCHING_EXACT_PIN", () => {
    expect(satisfiesDeclaredLlmMeshVersion("0.13.2", "0.13.2")).toBe(true);
  });
});
