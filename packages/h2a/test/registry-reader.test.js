/**
 * H2A-REG-H2-H4 — H2: typed `RegistryReaderV1` read port over the local h2a
 * registry store (r2 §2.8 / §8.1 H2), plus the frozen hosted refusal posture
 * for `h2a_register_instance` (one writer per placement; W-P1-6: named
 * refusal, never silent absence).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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

test("currentRevision is monotonic across registry appends", async () => {
  const { dir, root } = freshRoot();
  try {
    const store = createLocalStore({ root });
    const reader = createRegistryReader(store);
    assert.equal(await reader.currentRevision(), "0");

    store.registerInstance(registration("claude:alpha:aaaaaaaaaaaa", "uuid-a", { name: "alpha" }));
    assert.equal(await reader.currentRevision(), "1");

    store.registerInstance(registration("claude:beta:bbbbbbbbbbbb", "uuid-b", { name: "beta" }));
    assert.equal(await reader.currentRevision(), "2");

    store.addInstanceKey("claude:beta:bbbbbbbbbbbb", "-----BEGIN PUBLIC KEY-----\nrotated\n-----END PUBLIC KEY-----");
    const rev = await reader.currentRevision();
    assert.equal(rev, "3");
    assert.ok(Number(rev) > 2, "revision must be monotonically increasing");
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
    const all = await reader.listChangesSince("0");
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

    const ahead = reader.listChangesSince(String(Number(rev) + 1));
    await assert.rejects(ahead, (err) => {
      assert.ok(err instanceof RegistryRevisionError);
      assert.equal(err.code, "registry_revision_ahead");
      return true;
    });

    for (const bad of ["bogus", "-1", "1.5"]) {
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
    assert.equal(await reader.currentRevision(), "0");
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
