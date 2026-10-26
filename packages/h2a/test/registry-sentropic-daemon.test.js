import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// H2a RED: daemon-side local composition MUST go through the published
// Sentropic facade (`createMcpRegistry` from
// `@sentropic/cluster-mesh/mcp/registry`), with REAL coordination/Track
// handlers — not the private preparation compiler in
// `dist/registry/registry.js` whose lazy definitions throw
// "compile-time presence only".
async function loadDaemon() {
  return import("../dist/registry/sentropic-daemon.js");
}

function withTempRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), "h2a-sentropic-daemon-"));
  return Promise.resolve()
    .then(() => fn(root))
    .finally(() => rmSync(root, { recursive: true, force: true }));
}

test("H2a daemon: coordination-only view executes real handlers, denies Track", async () => {
  const daemon = await loadDaemon();
  await withTempRoot(async (root) => {
    const composed = await daemon.composeDaemonRegistry({ view: "coordination", root });
    const ids = composed.catalog().map((entry) => entry.providerId ?? entry.id);
    assert.ok(ids.includes("sentropic.h2a"), `catalog exposes sentropic.h2a, got ${JSON.stringify(ids)}`);
    // Real coordination handler: identity status answers from memory, never a stub throw.
    const status = await composed.dispatch("h2a_identity_status", {});
    assert.equal(status.ok, true);
    const parsed = JSON.parse(status.output.text);
    assert.ok(
      ["identity_disabled", "identity_pending", "identity_ready", "identity_failed"].includes(parsed.state),
      `real identity status state, got ${status.output.text.slice(0, 200)}`
    );
    // Excluded Track call is denied before any handler runs.
    await assert.rejects(() => composed.dispatch("track_query", { baselineCommit: "abc1234" }), /unknown_tool/);
  });
});

test("H2a daemon: Track-only view executes real Track reads, denies coordination", async () => {
  const daemon = await loadDaemon();
  await withTempRoot(async (root) => {
    const composed = await daemon.composeDaemonRegistry({ view: "track", root });
    const ids = composed.catalog().map((entry) => entry.providerId ?? entry.id);
    assert.ok(ids.includes("sentropic.track"), `catalog exposes sentropic.track, got ${JSON.stringify(ids)}`);
    const read = await composed.dispatch("track_query", { baselineCommit: "abc1234" });
    assert.equal(read.ok, true);
    assert.equal(typeof read.output.text, "string");
    assert.ok(read.output.text.length > 0, "real Track handler returns a payload");
    await assert.rejects(() => composed.dispatch("h2a_identity_status", {}), /unknown_tool/);
  });
});

test("H2a daemon: combined view executes both, denies unknown tools", async () => {
  const daemon = await loadDaemon();
  await withTempRoot(async (root) => {
    const composed = await daemon.composeDaemonRegistry({ view: "combined", root });
    const status = await composed.dispatch("h2a_identity_status", {});
    assert.equal(status.ok, true);
    const read = await composed.dispatch("track_query", { baselineCommit: "abc1234" });
    assert.equal(read.ok, true);
    await assert.rejects(() => composed.dispatch("h2a_does_not_exist", {}), /unknown_tool/);
  });
});

test("H2a daemon: composition uses the published Sentropic facade, not the private compiler", async () => {
  const daemon = await loadDaemon();
  assert.equal(
    daemon.USES_SENTROPIC_FACADE,
    true,
    "daemon composition is pinned to createMcpRegistry (@sentropic/cluster-mesh/mcp/registry)"
  );
  await withTempRoot(async (root) => {
    const composed = await daemon.composeDaemonRegistry({ view: "combined", root });
    assert.ok(composed.compiled, "compile produces a published CompiledMcpRegistry");
    assert.equal(typeof composed.compiled.resolveTool, "function");
  });
});
