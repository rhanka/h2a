/**
 * M0-L1 packed-tuple probe: the published tuple
 * `@sentropic/cluster-mesh` 0.25.0 / `@sentropic/mcp-platform` 0.4.1 /
 * `@sentropic/artifacts` 0.2.6 packs and resolves through the mesh loader.
 *
 * Modelled on sentropic `packages/artifacts/probe/packed-consumer.mjs`,
 * restricted to the h2a M0 surface: static catalog metadata, module
 * resolution, the builtin manifest-digest recheck, and atomic refusal when
 * the optional artifacts peer is absent. No artifact is served, stored or
 * dispatched here: `load()` runs against a shape-only app stub carrying
 * only the eagerly-checked `{profileDigest, selectedCapabilities}` pair,
 * and no tool is ever invoked. Real dispatch waits for the U2 factory
 * (M1-L4). The stub is a load-path double, never acceptance evidence for
 * dispatch (same labelling rule as the M1-L2 registration double).
 *
 * No `@sentropic/artifacts` server entrypoint (`./http`, `./server/*`,
 * `./adapters/*`, `./content/*`) is imported anywhere in this file: only
 * the public manifest/profile surface `@sentropic/artifacts/mcp`, which
 * M0-L2 explicitly allowlists.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const REPO = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const H2A_PKG = join(REPO, "packages", "h2a", "package.json");

/** M0 acceptance tuple (plan §2 M0-L1; re-check §1.1 on npm). */
const TUPLE = Object.freeze({
  clusterMesh: "0.25.0",
  mcpPlatform: "0.4.1",
  artifacts: "0.2.6",
});

function readPins() {
  const pkg = JSON.parse(readFileSync(H2A_PKG, "utf8"));
  return {
    clusterMesh: pkg.dependencies?.["@sentropic/cluster-mesh"],
    mcpPlatform: pkg.dependencies?.["@sentropic/mcp-platform"],
    artifacts: pkg.peerDependencies?.["@sentropic/artifacts"],
    artifactsOptional: pkg.peerDependenciesMeta?.["@sentropic/artifacts"]?.optional,
  };
}

test("M0-L1 pins the published tuple as deployment-side wiring", () => {
  const pins = readPins();
  assert.equal(pins.clusterMesh, TUPLE.clusterMesh, "cluster-mesh pin");
  assert.equal(pins.mcpPlatform, TUPLE.mcpPlatform, "mcp-platform pin");
  assert.equal(pins.artifacts, TUPLE.artifacts, "artifacts optional-peer pin");
  assert.equal(pins.artifactsOptional, true, "artifacts peer stays optional");
});

const PROBE_WITH = /* js */ `
import assert from "node:assert/strict";
import { createClusterMeshModules } from "@sentropic/cluster-mesh";
import { createMcpRegistry } from "@sentropic/cluster-mesh/mcp/registry";
import { createArtifactsBuiltin } from "@sentropic/cluster-mesh/mcp/artifacts";
import { computeManifestDigest } from "@sentropic/mcp-platform/tool-configuration";
import {
  ARTIFACTS_PROVIDER_ID,
  ARTIFACTS_PROVIDER_VERSION,
  compileArtifactsProfile,
  createArtifactsManifest,
  RADAR_ARTIFACTS_PROFILE,
} from "@sentropic/artifacts/mcp";

const modules = createClusterMeshModules();
const leaf = await modules.load("mcp/artifacts");
assert.equal(leaf.ARTIFACTS_PROVIDER_ID, "sentropic.artifacts");
assert.equal(leaf.ARTIFACTS_PROVIDER_VERSION, "0.2.6");

const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
// Shape-only double for the load path (see file header): satisfies the
// eager app/profile coherence check, never serves a tool.
const definition = {
  profile,
  app: {
    profileDigest: profile.profileDigest,
    selectedCapabilities: profile.selectedCapabilities,
  },
  createInvocation: async () => {
    throw new Error("no dispatch in the M0-L1 pack probe");
  },
};
const builtin = createArtifactsBuiltin({ modules, definition });
assert.equal(builtin.providerId, ARTIFACTS_PROVIDER_ID);
assert.equal(builtin.version, ARTIFACTS_PROVIDER_VERSION);

const facade = createMcpRegistry({ modules, builtins: [builtin] });
const row = facade.catalog().find((entry) => entry.providerId === "sentropic.artifacts");
assert.ok(row, "catalog lists sentropic.artifacts metadata");
assert.equal(row.version, "0.2.6");
assert.equal(row.availability, "not-selected");

// The catalog digest recomputes equal at load through the real loader.
const loaded = await builtin.load();
assert.equal(
  computeManifestDigest(loaded.manifest),
  computeManifestDigest(createArtifactsManifest(definition)),
  "loader digest matches the catalog manifest digest",
);

// The loader's own recheck guard: a definition that drifts after catalog
// construction refuses instead of publishing.
definition.displayName = "tampered-after-catalog";
await assert.rejects(builtin.load(), /artifacts definition changed after catalog construction/u);
console.log("PACKED_TUPLE_WITH_PEER_OK");
`;

const PROBE_PEER_ABSENT = /* js */ `
import assert from "node:assert/strict";
import { createClusterMeshModules } from "@sentropic/cluster-mesh";

const modules = createClusterMeshModules();
const error = await modules.load("mcp/artifacts").then(
  () => null,
  (cause) => cause,
);
assert.ok(error, "peer removal refuses");
assert.equal(error.code, "cluster_mesh_module_unavailable", "loader diagnostic code");
console.log("PACKED_TUPLE_PEER_ABSENT_OK " + error.reason);
`;

const PROBE_SELECTION_REFUSAL = /* js */ `
import assert from "node:assert/strict";
import { createClusterMeshModules } from "@sentropic/cluster-mesh";
import { createMcpRegistry } from "@sentropic/cluster-mesh/mcp/registry";
import { createArtifactsBuiltin } from "@sentropic/cluster-mesh/mcp/artifacts";
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from "@sentropic/artifacts/mcp";

// 'disabled' stands in for 'absent' at the resolution layer only: the
// facade sees the same rejected loader promise either way, so the
// atomicity property is identical. Genuine filesystem absence is proven
// separately by PROBE_PEER_ABSENT after rm -rf of the peer.
const modules = createClusterMeshModules({ disabled: ["mcp/artifacts"] });
const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
const builtin = createArtifactsBuiltin({
  modules,
  definition: {
    profile,
    app: {
      profileDigest: profile.profileDigest,
      selectedCapabilities: profile.selectedCapabilities,
    },
    createInvocation: async () => {
      throw new Error("no dispatch in the M0-L1 pack probe");
    },
  },
});
const facade = createMcpRegistry({ modules, builtins: [builtin] });
facade.select(["sentropic.artifacts"]);
facade.configure("sentropic.artifacts", {});
const result = await facade.compile({ bindings: {}, compatibility: {} });
assert.equal(result.ok, false, "selection refuses atomically");
assert.match(
  JSON.stringify(result.diagnostics),
  /providers\\["sentropic\\.artifacts"\\]\\.loader/u,
  "diagnostic names the artifacts loader",
);
assert.equal(facade.compiled(), undefined, "no plan publishes on refusal");

// A clean facade advertises zero artifacts tools.
const bare = createMcpRegistry({ modules });
const compiled = await bare.compile({ bindings: {}, compatibility: {} });
assert.equal(compiled.ok, true);
assert.equal(compiled.registry.resolveTool("artifacts_list"), undefined);
console.log("PACKED_TUPLE_SELECTION_REFUSAL_OK");
`;

function cleanEnv(home) {
  const env = { ...process.env };
  env.HOME = home;
  for (const name of ["XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "TMPDIR"]) {
    env[name] = join(home, name);
    mkdirSync(env[name], { recursive: true, mode: 0o700 });
  }
  for (const name of ["CLAUDE_CODE_SESSION_ID", "H2A_MCP_AUTHORITY", "H2A_ROOT", "H2A_MCP_CENTRAL"]) {
    delete env[name];
  }
  return env;
}

test("M0-L1 packed consumer proves the tuple", { timeout: 300_000 }, async () => {
  const pins = readPins();
  assert.equal(pins.clusterMesh, TUPLE.clusterMesh, "consumer installs the pinned mesh");
  assert.equal(pins.mcpPlatform, TUPLE.mcpPlatform, "consumer installs the pinned platform");
  assert.equal(pins.artifacts, TUPLE.artifacts, "consumer installs the pinned artifacts peer");

  const lab = mkdtempSync(join(tmpdir(), "h2a-artifacts-tuple-"));
  try {
    const home = join(lab, "home");
    mkdirSync(home, { recursive: true });
    const env = cleanEnv(home);
    const consumer = join(lab, "consumer");
    mkdirSync(consumer, { recursive: true });
    await exec(
      "npm",
      ["install", "--prefix", consumer, "--no-save", "--no-audit", "--no-fund",
        "--cache", join(lab, "npm-cache"),
        `@sentropic/cluster-mesh@${TUPLE.clusterMesh}`,
        `@sentropic/mcp-platform@${TUPLE.mcpPlatform}`,
        `@sentropic/artifacts@${TUPLE.artifacts}`],
      { cwd: consumer, env, timeout: 240_000, maxBuffer: 8 * 1024 * 1024 },
    ).catch((error) => {
      error.message = `packed-consumer install failed: ${error.message}`;
      throw error;
    });
    writeFileSync(join(consumer, "probe-with.mjs"), PROBE_WITH);
    const withPeer = await exec(process.execPath, [join(consumer, "probe-with.mjs")],
      { cwd: consumer, env, timeout: 120_000 });
    assert.match(withPeer.stdout, /PACKED_TUPLE_WITH_PEER_OK/u);
    // Genuine filesystem absence: the peer directory is really removed.
    rmSync(join(consumer, "node_modules", "@sentropic", "artifacts"), { recursive: true, force: true });
    writeFileSync(join(consumer, "probe-absent.mjs"), PROBE_PEER_ABSENT);
    const absent = await exec(process.execPath, [join(consumer, "probe-absent.mjs")],
      { cwd: consumer, env, timeout: 120_000 });
    assert.match(absent.stdout, /PACKED_TUPLE_PEER_ABSENT_OK not_installed/u);
    // Selection atomicity through the same rejected loader (disabled stands
    // in for absent at the resolution layer; see probe header).
    writeFileSync(join(consumer, "probe-refusal.mjs"), PROBE_SELECTION_REFUSAL);
    const refusal = await exec(process.execPath, [join(consumer, "probe-refusal.mjs")],
      { cwd: consumer, env, timeout: 120_000 });
    assert.match(refusal.stdout, /PACKED_TUPLE_SELECTION_REFUSAL_OK/u);
  } finally {
    rmSync(lab, { recursive: true, force: true });
  }
});
