import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalStore, localStorePaths } from "../dist/index.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-store-"));
}

test("localStorePaths derives the canonical layout from a root", () => {
  // DEC-062: use join() rather than literal slashes so the assertion works on
  // both POSIX (`/`) and Windows (`\\`) separators.
  const root = join("srv", ".h2a");
  const paths = localStorePaths(root);
  assert.equal(paths.root, root);
  assert.equal(paths.registry, join(root, "registry"));
  assert.equal(paths.instances, join(root, "registry", "instances.jsonl"));
  assert.equal(paths.contracts, join(root, "contracts"));
  assert.equal(paths.policies, join(root, "policies"));
  assert.equal(paths.engagements, join(root, "engagements"));
  assert.equal(paths.negotiations, join(root, "negotiations"));
  assert.equal(paths.inbox, join(root, "inbox"));
  assert.equal(paths.outbox, join(root, "outbox"));
});

test("createLocalStore initializes the directory layout idempotently", () => {
  const root = freshRoot();
  try {
    const a = createLocalStore({ root });
    const b = createLocalStore({ root });
    assert.equal(a.paths.root, root);
    assert.equal(b.paths.root, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registerInstance appends to registry/instances.jsonl and rejects duplicates", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    const reg = {
      id: "conductor:01",
      instance: "conductor:01",
      roles: ["CONDUCTOR"],
      scopes: ["scope:principal/antoine"],
      capabilities: ["negotiate"],
      endpoints: [{ kind: "local-files", uri: `file://${root}` }],
      publicKeys: [],
      acceptedPolicies: [],
      createdAt: "2026-05-18T00:00:00.000Z"
    };

    store.registerInstance(reg);
    const content = readFileSync(store.paths.instances, "utf8");
    assert.match(content, /"id":"conductor:01"/);

    assert.throws(() => store.registerInstance(reg), /already registered/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("listInstances and findInstance read the registry", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    const a = {
      id: "conductor:01",
      instance: "conductor:01",
      roles: ["CONDUCTOR"],
      scopes: ["scope:s1"],
      capabilities: [],
      endpoints: [],
      publicKeys: [],
      acceptedPolicies: [],
      createdAt: "2026-05-18T00:00:00.000Z"
    };
    const b = { ...a, id: "conductor:02", instance: "conductor:02" };

    store.registerInstance(a);
    store.registerInstance(b);

    const all = store.listInstances();
    assert.equal(all.length, 2);
    assert.deepEqual(
      all.map((r) => r.id).sort(),
      ["conductor:01", "conductor:02"]
    );

    assert.equal(store.findInstance("conductor:02").id, "conductor:02");
    assert.equal(store.findInstance("missing"), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("appendNegotiationEvent chains entries and grows the journal", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });

    const first = store.appendNegotiationEvent("nego-001", {
      id: "evt-001",
      type: "register",
      actor: { instance: "conductor:01", role: "CONDUCTOR", scope: "scope:s" },
      body: { ok: true },
      createdAt: "2026-05-18T00:00:00.000Z"
    });
    assert.equal(first.sequence, 0);
    assert.equal(first.prevHash, undefined);
    assert.match(first.contentHash, /^sha256:[0-9a-f]{64}$/);

    const second = store.appendNegotiationEvent("nego-001", {
      id: "evt-002",
      type: "propose",
      actor: { instance: "conductor:01", role: "CONDUCTOR", scope: "scope:s" },
      body: { offer: 1 },
      createdAt: "2026-05-18T00:01:00.000Z"
    });
    assert.equal(second.sequence, 1);
    assert.equal(second.prevHash, first.contentHash);

    const chain = store.readNegotiationJournal("nego-001");
    assert.equal(chain.length, 2);
    assert.equal(chain[0].id, "evt-001");
    assert.equal(chain[1].id, "evt-002");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readNegotiationJournal returns [] for an unknown negotiation", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    assert.deepEqual(store.readNegotiationJournal("missing"), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readNegotiationJournal throws on a tampered file", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    const validPayload = {
      id: "evt-001",
      type: "register",
      actor: { instance: "x", role: "CONDUCTOR", scope: "scope:s" },
      body: {},
      createdAt: "2026-05-18T00:00:00.000Z"
    };
    store.appendNegotiationEvent("nego-002", validPayload);

    appendFileSync(
      `${store.paths.negotiations}/nego-002/journal.jsonl`,
      JSON.stringify({
        protocol: "sentropic.h2a",
        version: "0.1",
        sequence: 5,
        contentHash: "sha256:bad",
        ...validPayload,
        id: "evt-fake"
      }) + "\n"
    );

    assert.throws(() => store.readNegotiationJournal("nego-002"), /chain/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
