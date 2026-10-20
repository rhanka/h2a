import assert from "node:assert/strict";
import test from "node:test";

// Lot L6a RED: the catalog is consumed from BUILT artifacts, never sources.
// The runtime exposes it as a public subpath export; h2a consumes it through
// its lazy loader seam (no hard dependency, no copied strings).
test("should load the catalog from the built runtime subpath export", async () => {
  const runtime = await import("@sentropic/h2a-runtime/human-output");
  const catalog = runtime.getHumanOutputCatalog("fr");
  assert.equal(catalog.locale, "fr");
  assert.ok(Object.keys(catalog.strings).length > 0);
  assert.deepEqual(
    Object.keys(catalog.strings).sort(),
    Object.keys(runtime.getHumanOutputCatalog("en").strings).sort(),
  );
});

test("should consume the same catalog from the built h2a package through its lazy loader", async () => {
  const { loadHumanOutputCatalog } = await import("../dist/runtime/human-output-loader.js");
  const runtime = await import("@sentropic/h2a-runtime/human-output");
  const loaded = await loadHumanOutputCatalog(undefined, "fr");
  assert.equal(loaded.ok, true);
  assert.deepEqual(
    loaded.ok ? loaded.catalog.strings : undefined,
    runtime.getHumanOutputCatalog("fr").strings,
  );
});

test("should degrade to machine output plus a named diagnostic when the runtime catalog cannot load", async () => {
  const { loadHumanOutputCatalog } = await import("../dist/runtime/human-output-loader.js");
  const loaded = await loadHumanOutputCatalog(async () => {
    throw new Error("fixture: runtime catalog unavailable");
  }, "fr");
  assert.equal(loaded.ok, false);
  assert.equal(loaded.ok ? undefined : loaded.reason, "human-output-unavailable");
});
