/**
 * H2A-REG-H2-H4 — H2: typed `RegistryReaderV1` read port over the local h2a
 * registry store (r2 §2.8 / §8.1 H2), plus the frozen hosted refusal posture
 * for `h2a_register_instance` (one writer per placement; W-P1-6: named
 * refusal, never silent absence).
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  HostedRegistryRefusalError,
  RegistryRevisionError,
  createLocalStore,
  createRegistryReader
} from "../dist/index.js";

function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-reg-reader-"));
  return { dir, root: join(dir, ".h2a") };
}

function registration(instance, agentUuid, extra = {}) {
  return {
    id: instance,
    instance,
    roles: ["AGENTS"],
    scopes: ["scope:default"],
    capabilities: [],
    endpoints: [{ kind: "local-files", uri: `file://${instance}` }],
    publicKeys: [`-----BEGIN PUBLIC KEY-----\n${instance}\n-----END PUBLIC KEY-----`],
    acceptedPolicies: [],
    createdAt: "2026-10-30T00:00:00.000Z",
    ...(agentUuid !== undefined ? { agentUuid } : {}),
    ...(extra.name !== undefined ? { name: extra.name } : {}),
    ...extra
  };
}

function cursorBump(revision, stream, by = 1) {
  const parts = revision.split("/").map(Number);
  parts[["instances", "keys", "grants", "offboards"].indexOf(stream)] += by;
  return parts.join("/");
}

test("currentRevision is monotonic across registry appends", async () => {
  const { dir, root } = freshRoot();
  try {
    const store = createLocalStore({ root });
    const reader = createRegistryReader(store);
    assert.equal(await reader.currentRevision(), "0/0/0/0");

    store.registerInstance(registration("claude:alpha:aaaaaaaaaaaa", "uuid-a", { name: "alpha" }));
    assert.equal(await reader.currentRevision(), "1/0/0/0");

    store.registerInstance(registration("claude:beta:bbbbbbbbbbbb", "uuid-b", { name: "beta" }));
    assert.equal(await reader.currentRevision(), "2/0/0/0");

    store.addInstanceKey("claude:beta:bbbbbbbbbbbb", "-----BEGIN PUBLIC KEY-----\nrotated\n-----END PUBLIC KEY-----");
    const rev = await reader.currentRevision();
    assert.equal(rev, "2/1/0/0");
    assert.ok(rev > "2/0/0/0", "the cursor must advance monotonically per stream");
    assert.ok(rev.startsWith("2/1/"), "the key-stream cursor must be the component that grew");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getInstance by agentUuid returns the frozen H2 view shape", async () => {
  const { dir, root } = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(registration("claude:alpha:aaaaaaaaaaaa", "uuid-a", { name: "alpha" }));
    const reader = createRegistryReader(store);

    const view = await reader.getInstance("uuid-a");
    assert.ok(view, "view must exist for a registered perennial agent");
    assert.equal(view.format, "h2a.registry-instance/v1");
    assert.equal(view.agentUuid, "uuid-a");
    assert.equal(view.launchName, "alpha");
    assert.deepEqual([...view.instances], ["claude:alpha:aaaaaaaaaaaa"]);
    assert.equal(view.registryRevision, await reader.currentRevision());
    assert.equal(view.offboardTombstone, undefined);

    // One active key baked into the registration.
    assert.equal(view.keys.length, 1);
    const key = view.keys[0];
    assert.equal(key.state, "active");
    assert.equal(key.validFrom, "2026-10-30T00:00:00.000Z");
    assert.equal(key.revokedAt, undefined);
    assert.match(key.keyId, /^sha256:[0-9a-f]{64}$/);
    assert.match(key.fingerprint, /^[0-9a-f]{16}$/);

    // roleScopeBindings: registration roles × scopes, keyed by the H1 policy key.
    assert.deepEqual(
      [...view.roleScopeBindings],
      [{ actorLaunchName: "alpha", scope: "scope:default", governanceRoles: ["AGENTS"] }]
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getInstance accepts an instance id as correlation and returns null when unknown or unanchored", async () => {
  const { dir, root } = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(registration("claude:alpha:aaaaaaaaaaaa", "uuid-a", { name: "alpha" }));
    // Legacy pre-DEC-114 row: no perennial agentUuid anchor.
    store.registerInstance(registration("codex:legacy:cccccccccccc", undefined, { name: "legacy" }));
    const reader = createRegistryReader(store);

    const byInstance = await reader.getInstance("claude:alpha:aaaaaaaaaaaa");
    assert.ok(byInstance);
    assert.equal(byInstance.agentUuid, "uuid-a");

    assert.equal(await reader.getInstance("no-such-agent"), null);
    // A registration without a perennial anchor has no level-1 view (§2.4:
    // owner resolution queue, never auto-merged into a level-1 record).
    assert.equal(await reader.getInstance("codex:legacy:cccccccccccc"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("key rotation and revocation project into key states", async () => {
  const { dir, root } = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(registration("claude:alpha:aaaaaaaaaaaa", "uuid-a", { name: "alpha" }));
    const rotated = "-----BEGIN PUBLIC KEY-----\nrotated\n-----END PUBLIC KEY-----";
    store.addInstanceKey("claude:alpha:aaaaaaaaaaaa", rotated);
    const reader = createRegistryReader(store);

    let view = await reader.getInstance("uuid-a");
    assert.equal(view.keys.length, 2);

    store.revokeInstanceKey("claude:alpha:aaaaaaaaaaaa", rotated);
    view = await reader.getInstance("uuid-a");
    assert.equal(view.keys.length, 2);
    const revoked = view.keys.find((k) => k.state === "revoked");
    assert.ok(revoked, "the revoked key must be visible in state 'revoked'");
    assert.ok(revoked.revokedAt, "revokedAt must be carried from the keyring event");
    assert.equal(view.keys.filter((k) => k.state === "active").length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("org membership grants and offboard tombstones surface in the view", async () => {
  const { dir, root } = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(registration("claude:alpha:aaaaaaaaaaaa", "uuid-a", { name: "alpha" }));
    store.grantOrgMembership({
      instance: "claude:alpha:aaaaaaaaaaaa",
      role: "PRINCIPAL",
      scope: "scope:org",
      at: "2026-10-30T01:00:00.000Z"
    });
    let reader = createRegistryReader(store);
    let view = await reader.getInstance("uuid-a");
    const grantBinding = view.roleScopeBindings.find((b) => b.scope === "scope:org");
    assert.deepEqual(grantBinding, {
      actorLaunchName: "alpha",
      scope: "scope:org",
      governanceRoles: ["PRINCIPAL"]
    });

    store.offboardInstance("claude:alpha:aaaaaaaaaaaa", "superseded");
    // New reader over the same store: the view is read fresh per call.
    reader = createRegistryReader(store);
    view = await reader.getInstance("uuid-a");
    assert.deepEqual(view.offboardTombstone, { offboardedAt: view.offboardTombstone.offboardedAt, reason: "superseded" });
    assert.ok(view.offboardTombstone.offboardedAt >= "2026-10-30T01:00:00.000Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listChangesSince replays per-agent diffs since a revision", async () => {
  const { dir, root } = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(registration("claude:alpha:aaaaaaaaaaaa", "uuid-a", { name: "alpha" }));
    store.registerInstance(registration("claude:beta:bbbbbbbbbbbb", "uuid-b", { name: "beta" }));
    const reader = createRegistryReader(store);

    const revAfterBoth = await reader.currentRevision();
    const all = await reader.listChangesSince("0/0/0/0");
    assert.equal(all.length, 2);
    assert.deepEqual(all.map((v) => v.agentUuid).sort(), ["uuid-a", "uuid-b"]);

    // Only beta changes: alpha must not be replayed.
    store.addInstanceKey("claude:beta:bbbbbbbbbbbb", "-----BEGIN PUBLIC KEY-----\nb2\n-----END PUBLIC KEY-----");
    const changes = await reader.listChangesSince(revAfterBoth);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].agentUuid, "uuid-b");
    assert.equal(changes[0].registryRevision, await reader.currentRevision());
    assert.equal(changes[0].keys.length, 2);

    // Nothing changed since the current revision.
    const revNow = await reader.currentRevision();
    assert.deepEqual(await reader.listChangesSince(revNow), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listChangesSince refuses invalid and ahead-of-registry revisions by name", async () => {
  const { dir, root } = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(registration("claude:alpha:aaaaaaaaaaaa", "uuid-a", { name: "alpha" }));
    const reader = createRegistryReader(store);
    const rev = await reader.currentRevision();

    const ahead = reader.listChangesSince(cursorBump(rev, "keys"));
    await assert.rejects(ahead, (err) => {
      assert.ok(err instanceof RegistryRevisionError);
      assert.equal(err.code, "registry_revision_ahead");
      return true;
    });

    for (const bad of ["bogus", "-1/0/0/0", "1.5/0/0/0", "1/0/0", "1/0/0/0/9", "3"]) {
      await assert.rejects(
        reader.listChangesSince(bad),
        (err) => {
          assert.ok(err instanceof RegistryRevisionError);
          assert.equal(err.code, "registry_revision_invalid");
          return true;
        },
        `revision ${bad} must be refused`
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hosted placement: h2a_register_instance refuses by name, reads still work", async () => {
  const { dir, root } = freshRoot();
  try {
    const store = createLocalStore({ root, placement: "hosted" });
    let refusal;
    try {
      store.registerInstance(registration("claude:alpha:aaaaaaaaaaaa", "uuid-a", { name: "alpha" }));
      assert.fail("expected h2a_register_instance to refuse under hosted placement");
    } catch (error) {
      refusal = error;
    }
    assert.ok(refusal instanceof HostedRegistryRefusalError);
    assert.equal(refusal.code, "registry_hosted_refusal");
    assert.match(refusal.message, /h2a_register_instance/);
    assert.match(refusal.message, /hosted/);
    assert.match(refusal.message, /cluster-mesh/);

    // The hosted surface is the H2 read contract, not a silent absence.
    assert.deepEqual(store.listInstances(), []);
    const reader = createRegistryReader(store);
    assert.equal(await reader.currentRevision(), "0/0/0/0");
    assert.equal(await reader.getInstance("uuid-a"), null);

    // Default placement stays the local writer (§2.8: sole writer locally).
    const local = createLocalStore({ root, placement: "local" });
    local.registerInstance(registration("claude:alpha:aaaaaaaaaaaa", "uuid-a", { name: "alpha" }));
    assert.ok(local.findInstance("claude:alpha:aaaaaaaaaaaa"));

    const plain = createLocalStore({ root });
    plain.registerInstance(registration("claude:beta:bbbbbbbbbbbb", "uuid-b", { name: "beta" }));
    assert.ok(plain.findInstance("claude:beta:bbbbbbbbbbbb"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listChangesSince never loses a registration appended after a key event", async () => {
  const { dir, root } = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(registration("claude:alpha:aaaaaaaaaaaa", "uuid-a", { name: "alpha" }));
    store.addInstanceKey(
      "claude:alpha:aaaaaaaaaaaa",
      "-----BEGIN PUBLIC KEY-----\nka\n-----END PUBLIC KEY-----"
    );
    const reader = createRegistryReader(store);
    const revAfterKey = await reader.currentRevision();

    // The registration stream grows AFTER the key stream is non-empty: the
    // diff replay must surface beta, never silently replay alpha instead.
    store.registerInstance(registration("claude:beta:bbbbbbbbbbbb", "uuid-b", { name: "beta" }));
    const changes = await reader.listChangesSince(revAfterKey);
    assert.deepEqual(changes.map((view) => view.agentUuid), ["uuid-b"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listChangesSince replays diffs from every registry stream independently", async () => {
  const { dir, root } = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(registration("claude:alpha:aaaaaaaaaaaa", "uuid-a", { name: "alpha" }));
    store.addInstanceKey(
      "claude:alpha:aaaaaaaaaaaa",
      "-----BEGIN PUBLIC KEY-----\nka\n-----END PUBLIC KEY-----"
    );
    store.grantOrgMembership({
      instance: "claude:alpha:aaaaaaaaaaaa",
      role: "PRINCIPAL",
      scope: "scope:org",
      at: "2026-10-30T01:00:00.000Z"
    });
    const reader = createRegistryReader(store);
    const revAfterGrant = await reader.currentRevision();

    // Registration appended after the grant stream is non-empty.
    store.registerInstance(registration("claude:beta:bbbbbbbbbbbb", "uuid-b", { name: "beta" }));
    assert.deepEqual(
      (await reader.listChangesSince(revAfterGrant)).map((view) => view.agentUuid),
      ["uuid-b"]
    );

    // Offboard tombstone stream: the diff carries the current view (tombstone).
    const revAfterBeta = await reader.currentRevision();
    store.offboardInstance("claude:beta:bbbbbbbbbbbb", "rotated-out");
    const afterOffboard = await reader.listChangesSince(revAfterBeta);
    assert.deepEqual(afterOffboard.map((view) => view.agentUuid), ["uuid-b"]);
    assert.ok(afterOffboard[0].offboardTombstone, "the replayed view must carry the tombstone");

    // Nothing changed since the current revision.
    assert.deepEqual(await reader.listChangesSince(await reader.currentRevision()), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hosted placement: every registry lifecycle writer refuses, never dual-writes", async () => {
  const { dir, root } = freshRoot();
  try {
    const local = createLocalStore({ root });
    const alpha = registration("claude:alpha:aaaaaaaaaaaa", "uuid-a", { name: "alpha" });
    local.registerInstance(alpha);
    const rotated = "-----BEGIN PUBLIC KEY-----\nrotated\n-----END PUBLIC KEY-----";
    local.addInstanceKey("claude:alpha:aaaaaaaaaaaa", rotated);
    local.grantOrgMembership({
      instance: "claude:alpha:aaaaaaaaaaaa",
      role: "PRINCIPAL",
      scope: "scope:org",
      at: "2026-10-30T01:00:00.000Z"
    });

    const hosted = createLocalStore({ root, placement: "hosted" });
    const refusesHosted = (operation, fn) =>
      assert.throws(
        fn,
        (error) => {
          assert.ok(
            error instanceof HostedRegistryRefusalError,
            `${operation} must refuse with HostedRegistryRefusalError on a hosted root`
          );
          assert.equal(error.code, "registry_hosted_refusal");
          return true;
        },
        `${operation} must refuse on a hosted registry root`
      );
    refusesHosted("registerInstance", () =>
      hosted.registerInstance(registration("claude:gamma:cccccccccccc", "uuid-g", { name: "gamma" }))
    );
    refusesHosted("addInstanceKey", () =>
      hosted.addInstanceKey("claude:alpha:aaaaaaaaaaaa", "-----BEGIN PUBLIC KEY-----\nhk\n-----END PUBLIC KEY-----")
    );
    refusesHosted("revokeInstanceKey", () =>
      hosted.revokeInstanceKey("claude:alpha:aaaaaaaaaaaa", rotated)
    );
    refusesHosted("grantOrgMembership", () =>
      hosted.grantOrgMembership({
        instance: "claude:alpha:aaaaaaaaaaaa",
        role: "AGENTS",
        scope: "scope:other",
        at: "2026-10-30T02:00:00.000Z"
      })
    );
    refusesHosted("offboardInstance", () =>
      hosted.offboardInstance("claude:alpha:aaaaaaaaaaaa", "hosted-decommission")
    );

    // No dual write happened: the local store's rows are untouched.
    assert.equal(local.listInstances().length, 1);
    const reader = createRegistryReader(local);
    const view = await reader.getInstance("uuid-a");
    assert.deepEqual(
      view.roleScopeBindings.map((binding) => binding.scope),
      ["scope:default", "scope:org"]
    );
    assert.equal(view.offboardTombstone, undefined);
    assert.equal(view.keys.filter((key) => key.state === "active").length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hosted placement bootstraps no local registry files on a fresh root", async () => {
  const { dir, root } = freshRoot();
  try {
    const hosted = createLocalStore({ root, placement: "hosted" });
    assert.equal(existsSync(hosted.paths.root), false, "a hosted open must not create the store root");
    assert.equal(existsSync(join(root, ".h2a-schema.json")), false);
    assert.equal(existsSync(hosted.paths.instances), false);
    assert.equal(existsSync(hosted.paths.keys), false);

    // Reads still answer through the H2 contract (empty, never throwing).
    const reader = createRegistryReader(hosted);
    assert.deepEqual(await reader.listChangesSince(await reader.currentRevision()), []);
    assert.equal(await reader.getInstance("uuid-a"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
