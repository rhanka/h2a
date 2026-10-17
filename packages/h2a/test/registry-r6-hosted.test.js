import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function loadLib() {
  return import("../dist/registry/hosted.js");
}

const { H2A_HOSTED_READONLY_TOOLS } = await import("../dist/runtime/mcp-http/readonly-allowlist.js");

async function loadManifests() {
  const { readFileSync } = await import("node:fs");
  const root = new URL("../../../", import.meta.url);
  const read = (rel) => JSON.parse(readFileSync(new URL(rel, root), "utf8"));
  return {
    h2aEntry: read("packages/h2a/registry/entries.v1.json").entries[0],
    h2aManifest: read("packages/h2a/registry/manifest.h2a.json"),
    trackEntry: read("packages/track/registry/entries.v1.json").entries[0],
    trackManifest: read("packages/track/registry/manifest.track.json")
  };
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "h2a-r6-hosted-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("R6 hosted: composed surface is the exact ordered allowlist intersection", async () => {
  const { composeHostedTools } = await loadLib();
  const { h2aManifest, trackManifest } = await loadManifests();
  const composed = composeHostedTools({ coordinationManifest: h2aManifest, trackManifest });
  assert.deepEqual(composed.map((t) => t.name), [...H2A_HOSTED_READONLY_TOOLS]);
  assert.ok(!composed.some((t) => t.name === "h2a_send"));
  assert.ok(!composed.some((t) => t.name === "h2a_run"));
});

test("R6 hosted: stale allowlist members and private-key tools fail composition", async () => {
  const { composeHostedTools } = await loadLib();
  const { h2aManifest, trackManifest } = await loadManifests();
  assert.throws(
    () => composeHostedTools({ coordinationManifest: h2aManifest, trackManifest, allowlist: [...H2A_HOSTED_READONLY_TOOLS, "h2a_stale_tool"] }),
    /unknown.*stale|stale.*unknown|no declared base capability/
  );
  // h2a_sign is a real private-key signing tool, excluded from the allowlist:
  // allowlisting it must fail composition instead of exposing the key path.
  const leakyAllowlist = [...H2A_HOSTED_READONLY_TOOLS, "h2a_sign"];
  assert.throws(() => composeHostedTools({ coordinationManifest: h2aManifest, trackManifest, allowlist: leakyAllowlist }), /private-key/);
});

test("R6 hosted: mutating coordination tools are never routable", async () => {
  const { assertHostedRoutable } = await loadLib();
  assertHostedRoutable("h2a_discover_instances");
  assertHostedRoutable("track_query");
  assert.throws(() => assertHostedRoutable("h2a_send"), /refused|not.*routable|allowlist/);
  assert.throws(() => assertHostedRoutable("h2a_run"), /refused|not.*routable|allowlist/);
  assert.throws(() => assertHostedRoutable("track_write"), /refused|not.*routable|allowlist/);
});

test("R6 hosted: results disclose no server filesystem paths", async () => {
  const { redactHostedResult } = await loadLib();
  const redacted = redactHostedResult({
    state: "identity_ready",
    root: "/srv/h2a/tenant-a",
    workspaceRoot: "/srv/h2a/tenant-a/ws",
    nested: { root: "/srv/secret", ok: true },
    list: [{ workspaceRoot: "/x" }, "plain"
    ]
  });
  const text = JSON.stringify(redacted);
  assert.ok(!text.includes("/srv/h2a"));
  assert.ok(!text.includes("/srv/secret"));
  assert.ok(!text.includes("workspaceRoot"));
  assert.equal(redacted.nested.ok, true);
  assert.equal(redacted.list[1], "plain");
});

test("R6 hosted: deployment lock drafts, verifies and activates atomically", async () => {
  const { draftHostedLock, verifyHostedLock, activateHostedLock, isTenantBound } = await loadLib();
  const { h2aEntry, trackEntry } = await loadManifests();
  await withTempDir((dir) => {
    const draftPath = join(dir, "hosted-lock.draft.json");
    const activePath = join(dir, "hosted-lock.json");
    const lock = draftHostedLock({
      lockPath: draftPath,
      serviceBindingRef: "h2a-hosted-service",
      entries: [h2aEntry, trackEntry],
      tenant: { id: "tenant-a", repositoryBindingRef: "tenant-a-workspace" }
    });
    assert.equal(lock.format, "h2a.hosted-deployment-lock/v1");
    assert.ok(!JSON.stringify(lock).includes("/srv"));
    const bindings = {
      "h2a-hosted-service": { contract: "h2a.hosted-service/v1" },
      "tenant-a-workspace": { contract: "h2a.workspace/v1" }
    };
    const verified = verifyHostedLock({ lockPath: draftPath, bindings });
    assert.equal(verified.ok, true);
    const receipt = activateHostedLock({ lockPath: draftPath, activePath });
    assert.equal(receipt.action, "activated");
    assert.equal(isTenantBound(receipt.lock, "tenant-a"), true);
    assert.equal(isTenantBound(receipt.lock, "tenant-b"), false);
  });
});

test("R6 hosted: unbound tenant refuses at preflight with zero handler runs", async () => {
  const { draftHostedLock, verifyHostedLock, isTenantBound } = await loadLib();
  const { h2aEntry } = await loadManifests();
  await withTempDir((dir) => {
    const draftPath = join(dir, "hosted-lock.draft.json");
    draftHostedLock({ lockPath: draftPath, serviceBindingRef: "h2a-hosted-service", entries: [h2aEntry] });
    const result = verifyHostedLock({ lockPath: draftPath, bindings: { "h2a-hosted-service": { contract: "h2a.hosted-service/v1" } } });
    assert.equal(result.ok, false);
    assert.match(result.diagnostics[0].code, /missing_binding/);
    assert.equal(isTenantBound({ tenants: {} }, "anyone"), false);
  });
});
