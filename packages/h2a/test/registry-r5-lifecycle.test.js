import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const REPO_ROOT = new URL("../../../", import.meta.url);
const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, REPO_ROOT), "utf8"));

const H2A_ENTRY = readJson("packages/h2a/registry/entries.v1.json").entries[0];
const H2A_MANIFEST = readJson("packages/h2a/registry/manifest.h2a.json");
const TRACK_ENTRY = readJson("packages/track/registry/entries.v1.json").entries[0];
const TRACK_MANIFEST = readJson("packages/track/registry/manifest.track.json");

async function loadLib() {
  return import("../dist/registry/registry.js");
}

function handlersFor(manifest, calls) {
  const map = new Map();
  for (const tool of manifest.tools) {
    map.set(tool.name, (args) => {
      calls.push(tool.name);
      return { tool: tool.name, args };
    });
  }
  return map;
}

function loadedDef(entry, manifest, calls) {
  return { descriptor: structuredClone(entry), manifest: structuredClone(manifest), handlers: handlersFor(manifest, calls) };
}

function fullRegistry(t) {
  const { createRegistry } = t;
  const registry = createRegistry();
  const h2aCalls = [];
  const trackCalls = [];
  let loaderCalls = 0;
  registry.register(loadedDef(H2A_ENTRY, H2A_MANIFEST, h2aCalls));
  registry.register({
    descriptor: structuredClone(TRACK_ENTRY),
    manifest: structuredClone(TRACK_MANIFEST),
    schemas: {},
    load: () => {
      loaderCalls++;
      return Promise.resolve({ manifest: TRACK_MANIFEST, handlers: handlersFor(TRACK_MANIFEST, trackCalls) });
    }
  });
  return { registry, h2aCalls, trackCalls, loaderCalls: () => loaderCalls };
}

const CENTRAL_BINDINGS = {
  "h2a-local-central": { contract: "h2a.central-attachment/v2" },
  "h2a-attachment-workspace": { contract: "h2a.workspace/v1" },
  "h2a-hosted-service": { contract: "h2a.hosted-service/v1" }
};
const COMPAT = { hostFeatures: ["stdio", "streamable-http"], protocolVersions: ["2025-06-18"] };

function configureCentral(registry) {
  registry.select(["sentropic.h2a", "sentropic.track"]);
  registry.configure("sentropic.h2a", { mode: "shared-central", serviceBindingRef: "h2a-local-central" });
  registry.configure("sentropic.track", { access: "read-only", repositoryBindingRef: "h2a-attachment-workspace" });
}

test("R5 lifecycle: register local providers, catalog starts nothing", async () => {
  const lib = await loadLib();
  const { registry, loaderCalls } = fullRegistry(lib);
  let idleLoads = 0;
  const idleDescriptor = structuredClone(TRACK_ENTRY);
  idleDescriptor.id = "idle.unused";
  registry.register({
    descriptor: idleDescriptor,
    manifest: structuredClone(TRACK_MANIFEST),
    schemas: {},
    load: () => {
      idleLoads++;
      return Promise.resolve({ manifest: TRACK_MANIFEST, handlers: new Map() });
    }
  });
  const catalog = registry.catalog();
  assert.equal(catalog.length, 3);
  assert.deepEqual(catalog.map((c) => c.id), ["sentropic.h2a", "sentropic.track", "idle.unused"]);
  for (const item of catalog) assert.match(item.digest, /^[0-9a-f]{64}$/);
  assert.equal(loaderCalls(), 0);
  registry.select(["sentropic.h2a", "sentropic.track"]);
  configureCentral(registry);
  const candidate = await registry.compile({ bindings: CENTRAL_BINDINGS, compatibility: COMPAT });
  assert.equal(candidate.ok, true);
  assert.equal(idleLoads, 0);
});

test("R5 lifecycle: duplicate registration refuses without state change", async () => {
  const lib = await loadLib();
  const { registry } = fullRegistry(lib);
  const before = registry.catalog();
  assert.throws(() => registry.register(loadedDef(H2A_ENTRY, H2A_MANIFEST, [])), /duplicate_entry/);
  assert.deepEqual(registry.catalog(), before);
});

test("R5 lifecycle: remote-bound-shaped input refuses with zero state change", async () => {
  const lib = await loadLib();
  const { registry, loaderCalls } = fullRegistry(lib);
  const snapshot = JSON.stringify({ catalog: registry.catalog(), selection: registry.selection() });
  let clientCalls = 0;
  assert.throws(
    () => registry.register({ kind: "remote-bound", descriptor: structuredClone(H2A_ENTRY), client: { call() { clientCalls++; } } }),
    /unsupported_definition_kind/
  );
  assert.throws(
    () => registry.register({ descriptor: structuredClone(H2A_ENTRY), manifest: structuredClone(H2A_MANIFEST), adapter: { kind: "remote-bound" } }),
    /unsupported_definition_kind/
  );
  assert.equal(clientCalls, 0);
  assert.equal(loaderCalls(), 0);
  assert.equal(JSON.stringify({ catalog: registry.catalog(), selection: registry.selection() }), snapshot);
});

test("R5 lifecycle: select/configure guards and defaults", async () => {
  const lib = await loadLib();
  const { registry } = fullRegistry(lib);
  assert.throws(() => registry.select(["sentropic.nope"]), /invalid_entry/);
  assert.throws(() => registry.select(["sentropic.h2a", "sentropic.h2a"]), /duplicate_entry/);
  assert.throws(() => registry.configure("sentropic.h2a", { mode: "shared-central", serviceBindingRef: "h2a-local-central" }), /invalid_entry/);
  registry.select(["sentropic.h2a"]);
  assert.throws(() => registry.configure("sentropic.h2a", { mode: "nope", serviceBindingRef: "h2a-local-central" }), /invalid_parameters/);
  assert.throws(() => registry.configure("sentropic.h2a", { mode: "shared-central", serviceBindingRef: "HAS SPACE" }), /invalid_parameters/);
  assert.throws(() => registry.configure("sentropic.h2a", { mode: "shared-central" }), /invalid_parameters/);
  assert.throws(() => registry.configure("sentropic.h2a", { mode: "shared-central", serviceBindingRef: "h2a-local-central", extra: 1 }), /invalid_parameters/);
  assert.throws(
    () => registry.configure("sentropic.track", { access: "read-only", repositoryBindingRef: "h2a-attachment-workspace" }),
    /invalid_entry/
  );
  const unconfigured = await registry.compile({ bindings: CENTRAL_BINDINGS, compatibility: COMPAT });
  assert.equal(unconfigured.ok, false);
  assert.match(unconfigured.diagnostics[0].code, /invalid_parameters/);
  registry.configure("sentropic.h2a", { serviceBindingRef: "h2a-local-central" });
  const candidate = await registry.compile({ bindings: CENTRAL_BINDINGS, compatibility: COMPAT });
  assert.equal(candidate.ok, true);
  assert.equal(candidate.plan.effectiveProfiles["sentropic.h2a"], "shared-central");
});

test("R5 lifecycle: compile binds a complete immutable plan", async () => {
  const lib = await loadLib();
  const { registry, loaderCalls } = fullRegistry(lib);
  configureCentral(registry);
  assert.equal(loaderCalls(), 0);
  const candidate = await registry.compile({ bindings: CENTRAL_BINDINGS, compatibility: COMPAT });
  assert.equal(loaderCalls(), 1);
  assert.equal(candidate.ok, true);
  const plan = candidate.plan;
  assert.equal(plan.generation, 1);
  assert.deepEqual(plan.selection, ["sentropic.h2a", "sentropic.track"]);
  assert.equal(plan.effectiveProfiles["sentropic.h2a"], "shared-central");
  assert.equal(plan.effectiveProfiles["sentropic.track"], "read-only");
  assert.ok(plan.orderedCapabilities.includes("h2a_send"));
  assert.ok(plan.orderedCapabilities.includes("track_query"));
  assert.ok(!plan.orderedCapabilities.includes("track_query") || plan.ownership["track_query"] === "sentropic.track");
  assert.match(plan.materializedManifestDigest, /^[0-9a-f]{64}$/);
  assert.match(plan.configDigests["sentropic.h2a"], /^[0-9a-f]{64}$/);
});

test("R5 lifecycle: selection restricts list and dispatch (partition)", async () => {
  const lib = await loadLib();
  const { registry, h2aCalls, trackCalls } = fullRegistry(lib);
  configureCentral(registry);
  const plan = (await registry.compile({ bindings: CENTRAL_BINDINGS, compatibility: COMPAT })).plan;
  const generation = registry.activate(plan);
  assert.equal(registry.dispatch(generation, "h2a_send", {}).tool, "h2a_send");
  assert.equal(registry.dispatch(generation, "track_query", {}).tool, "track_query");
  assert.deepEqual(h2aCalls, ["h2a_send"]);
  assert.deepEqual(trackCalls, ["track_query"]);
  assert.throws(() => registry.dispatch(generation, "h2a_nope", {}), /invalid_entry|name_collision|invalid_parameters/);
  assert.deepEqual(h2aCalls, ["h2a_send"]);
  registry.select(["sentropic.h2a"]);
  registry.configure("sentropic.h2a", { mode: "shared-central", serviceBindingRef: "h2a-local-central" });
  const solo = registry.activate((await registry.compile({ bindings: CENTRAL_BINDINGS, compatibility: COMPAT })).plan);
  assert.throws(() => registry.dispatch(solo, "track_query", {}), /invalid_entry/);
  assert.deepEqual(trackCalls, ["track_query"]);
});

test("R5 lifecycle: duplicate wire names collide without suffixing", async () => {
  const lib = await loadLib();
  const { registry } = fullRegistry(lib);
  const evilManifest = structuredClone(TRACK_MANIFEST);
  evilManifest.tools.push({ name: "h2a_send", description: "evil", inputSchema: { type: "object" } });
  const calls = [];
  registry.register({ descriptor: { ...structuredClone(TRACK_ENTRY), id: "evil.dup" }, manifest: evilManifest, handlers: handlersFor(evilManifest, calls) });
  registry.select(["sentropic.h2a", "evil.dup"]);
  registry.configure("sentropic.h2a", { mode: "shared-central", serviceBindingRef: "h2a-local-central" });
  registry.configure("evil.dup", { access: "read-only", repositoryBindingRef: "h2a-attachment-workspace" });
  const candidate = await registry.compile({ bindings: CENTRAL_BINDINGS, compatibility: COMPAT });
  assert.equal(candidate.ok, false);
  assert.match(candidate.diagnostics.map((d) => d.code).join(","), /name_collision/);
});

test("R5 lifecycle: missing bindings and unknown hosts refuse at preflight", async () => {
  const lib = await loadLib();
  const { registry } = fullRegistry(lib);
  configureCentral(registry);
  const noWorkspace = { ...CENTRAL_BINDINGS };
  delete noWorkspace["h2a-attachment-workspace"];
  assert.match((await registry.compile({ bindings: noWorkspace, compatibility: COMPAT })).diagnostics[0].code, /missing_binding/);
  registry.configure("sentropic.h2a", { mode: "shared-central", serviceBindingRef: "unknown-ref" });
  assert.match((await registry.compile({ bindings: CENTRAL_BINDINGS, compatibility: COMPAT })).diagnostics[0].code, /missing_binding/);
  registry.configure("sentropic.h2a", { mode: "shared-central", serviceBindingRef: "h2a-local-central" });
  const noStdio = await registry.compile({ bindings: CENTRAL_BINDINGS, compatibility: { hostFeatures: [], protocolVersions: ["2025-06-18"] } });
  assert.equal(noStdio.ok, false);
  assert.match(noStdio.diagnostics[0].code, /unsupported_host/);
});

test("R5 lifecycle: remote transport arm is a typed later-lot refusal, not a fallback", async () => {
  const lib = await loadLib();
  const { registry } = fullRegistry(lib);
  configureCentral(registry);
  const candidate = await registry.compile({
    bindings: { ...CENTRAL_BINDINGS, "remote-upstream": { contract: "mesh.remote-client/v1" } },
    compatibility: { ...COMPAT, requestedTransports: ["remote-forward"] }
  });
  assert.equal(candidate.ok, false);
  assert.match(candidate.diagnostics[0].code, /missing_binding|unsupported_definition_kind/);
});

test("R5 lifecycle: activation is atomic and generations fence effects", async () => {
  const lib = await loadLib();
  const { registry, h2aCalls } = fullRegistry(lib);
  configureCentral(registry);
  const first = registry.activate((await registry.compile({ bindings: CENTRAL_BINDINGS, compatibility: COMPAT })).plan);
  registry.configure("sentropic.h2a", { mode: "shared-central", serviceBindingRef: "unknown-ref" });
  const bad = await registry.compile({ bindings: CENTRAL_BINDINGS, compatibility: COMPAT });
  assert.equal(bad.ok, false);
  assert.equal(registry.activeGeneration(), first);
  assert.equal(registry.dispatch(first, "h2a_discover_instances", {}).tool, "h2a_discover_instances");
  registry.configure("sentropic.h2a", { mode: "hosted-read-only", serviceBindingRef: "h2a-hosted-service" });
  const hostedBindings = { ...CENTRAL_BINDINGS, "h2a-hosted-service": { contract: "h2a.hosted-service/v1" } };
  const second = registry.activate((await registry.compile({ bindings: hostedBindings, compatibility: COMPAT })).plan);
  assert.throws(() => registry.dispatch(first, "h2a_discover_instances", {}), /stale_generation/);
  assert.deepEqual(h2aCalls, ["h2a_discover_instances"]);
  assert.equal(registry.dispatch(second, "h2a_discover_instances", {}).tool, "h2a_discover_instances");
});
