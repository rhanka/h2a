import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../dist/index.js";
import { cmdRegistryBridge, verifyPackedManifestSurface } from "../dist/registry/cli-registry.js";
import { canonicalJson, sha256Hex } from "../dist/registry/descriptors.js";

// Round 2 (reviews Astra+Sol): admission bounds lost by H2a must refuse
// before delegation — exit 2, delegate 0 — exactly as before H2a.

function streams() {
  let stdout = "";
  let stderr = "";
  return {
    stdout: { write(text) { stdout += text; } },
    stderr: { write(text) { stderr += text; } },
    text: () => ({ stdout, stderr })
  };
}

async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-r2-admission-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function provisionedLock(dir) {
  const config = join(dir, "host.json");
  const lockPath = join(dir, "lock.json");
  const io = streams();
  assert.equal(
    await runCli(["registry", "bootstrap", "install", "--host", "claude", "--config", config, "--lock", lockPath], io, {}),
    0,
    io.text().stderr
  );
  return lockPath;
}

function recalcConfigDigests(lock) {
  for (const record of Object.values(lock.entries)) {
    record.configDigest = sha256Hex(canonicalJson(record.config));
  }
}

async function serve(dir, lockPath, mutate) {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  if (mutate) {
    mutate(lock);
    recalcConfigDigests(lock);
    writeFileSync(lockPath, JSON.stringify(lock));
  }
  const io = streams();
  let delegated = 0;
  const code = await cmdRegistryBridge(
    ["serve", "--host", "claude", "--lock", lockPath, "--instance", "claude:review"],
    io,
    { delegateServe: async () => { delegated++; return 0; } }
  );
  let refusal = "";
  try {
    refusal = JSON.parse(io.text().stdout).error.message;
  } catch {
    refusal = io.text().stderr;
  }
  return { code, delegated, refusal };
}

test("R2 admission: valid lock still delegates once", async () => {
  await withTempDir(async (dir) => {
    const lockPath = await provisionedLock(dir);
    const result = await serve(dir, lockPath, null);
    assert.equal(result.code, 0, result.refusal);
    assert.equal(result.delegated, 1);
  });
});

test("R2 admission: unresolved serviceBindingRef refuses missing_binding", async () => {
  await withTempDir(async (dir) => {
    const lockPath = await provisionedLock(dir);
    const result = await serve(dir, lockPath, (lock) => {
      lock.entries["sentropic.h2a"].config.serviceBindingRef = "nonexistent";
    });
    assert.equal(result.code, 2, result.refusal);
    assert.equal(result.delegated, 0);
    assert.match(result.refusal, /missing_binding/);
  });
});

test("R2 admission: h2a-hosted-service ref in shared-central mode refuses", async () => {
  await withTempDir(async (dir) => {
    const lockPath = await provisionedLock(dir);
    const result = await serve(dir, lockPath, (lock) => {
      lock.entries["sentropic.h2a"].config.serviceBindingRef = "h2a-hosted-service";
    });
    assert.equal(result.code, 2, result.refusal);
    assert.equal(result.delegated, 0);
    assert.match(result.refusal, /missing_binding/);
  });
});

test("R2 admission: unresolved repositoryBindingRef refuses missing_binding", async () => {
  await withTempDir(async (dir) => {
    const lockPath = await provisionedLock(dir);
    const result = await serve(dir, lockPath, (lock) => {
      lock.entries["sentropic.track"].config.repositoryBindingRef = "nonexistent";
    });
    assert.equal(result.code, 2, result.refusal);
    assert.equal(result.delegated, 0);
    assert.match(result.refusal, /missing_binding/);
  });
});

test("R2 admission: empty hostFeatures refuses unsupported_host", async () => {
  await withTempDir(async (dir) => {
    const lockPath = await provisionedLock(dir);
    const result = await serve(dir, lockPath, (lock) => {
      lock.compatibility.hostFeatures = [];
    });
    assert.equal(result.code, 2, result.refusal);
    assert.equal(result.delegated, 0);
    assert.match(result.refusal, /unsupported_host/);
  });
});

test("R2 admission: incompatible protocolVersions refuses incompatible_version", async () => {
  await withTempDir(async (dir) => {
    const lockPath = await provisionedLock(dir);
    const result = await serve(dir, lockPath, (lock) => {
      lock.compatibility.protocolVersions = ["1900-01-01"];
    });
    assert.equal(result.code, 2, result.refusal);
    assert.equal(result.delegated, 0);
    assert.match(result.refusal, /incompatible_version/);
  });
});

test("R2 admission: shipped manifest surface must match declared definitions", async () => {
  const h2aManifest = JSON.parse(readFileSync(new URL("../registry/manifest.h2a.json", import.meta.url), "utf8"));
  const trackManifest = JSON.parse(
    readFileSync(new URL("../../track/registry/manifest.track.json", import.meta.url), "utf8")
  );
  const { H2A_CLI_MCP_TOOL_DESCRIPTORS } = await import("../dist/runtime/mcp/tools.js");
  const { TRACK_READ_TOOL_DESCRIPTORS } = await import("@sentropic/track/mcp");
  const trackNames = new Set(TRACK_READ_TOOL_DESCRIPTORS.map((tool) => tool.name));
  const declaredH2a = H2A_CLI_MCP_TOOL_DESCRIPTORS.map((tool) => tool.name).filter((name) => !trackNames.has(name));
  const declaredTrack = [...trackNames];
  // Shipped pair verifies clean.
  verifyPackedManifestSurface(h2aManifest, trackManifest, declaredH2a, declaredTrack);
  // Empty / shape-less manifests refuse as invalid_entry, delegate 0 at the
  // bridge because the surface check runs before delegation.
  assert.throws(() => verifyPackedManifestSurface({}, trackManifest, declaredH2a, declaredTrack), /invalid_entry/);
  assert.throws(
    () => verifyPackedManifestSurface({ tools: [], resources: [], prompts: [] }, trackManifest, declaredH2a, declaredTrack),
    /invalid_entry/
  );
  assert.throws(
    () => verifyPackedManifestSurface(h2aManifest, { tools: [], resources: [], prompts: [] }, declaredH2a, declaredTrack),
    /invalid_entry/
  );
});
