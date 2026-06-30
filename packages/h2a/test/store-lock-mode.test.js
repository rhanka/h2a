import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalStore } from "../dist/index.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-lockmode-"));
}

const registration = (id) => ({
  id,
  instance: id,
  roles: ["CONDUCTOR"],
  scopes: ["scope:lock"],
  capabilities: ["negotiate"],
  endpoints: [],
  publicKeys: [],
  acceptedPolicies: [],
  createdAt: "2026-05-25T00:00:00.000Z"
});

test("createLocalStore({lockMode:'lease'}) registers + reads back through the lease lock (DEC-066)", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root, lockMode: "lease", leaseMs: 30000 });
    store.registerInstance(registration("conductor:lease-1"));
    const found = store.findInstance("conductor:lease-1");
    assert.ok(found);
    assert.equal(found.id, "conductor:lease-1");
    // dup guard still works under the lease lock
    assert.throws(
      () => store.registerInstance(registration("conductor:lease-1")),
      /already registered/
    );
    // the lease lock file is released after each section
    assert.equal(existsSync(join(root, "registry", ".lock")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("createLocalStore default lockMode is 'pid' (unchanged behaviour)", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.registerInstance(registration("conductor:pid-1"));
    assert.ok(store.findInstance("conductor:pid-1"));
    assert.equal(existsSync(join(root, "registry", ".lock")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("H2A_LOCK_MODE=lease env enables the lease lock without an explicit option (DEC-067)", () => {
  const root = freshRoot();
  const prev = process.env.H2A_LOCK_MODE;
  process.env.H2A_LOCK_MODE = "lease";
  try {
    // no lockMode option — the env fallback must kick in
    const store = createLocalStore({ root });
    store.registerInstance(registration("conductor:env-1"));
    assert.ok(store.findInstance("conductor:env-1"));
    assert.equal(existsSync(join(root, "registry", ".lock")), false);
  } finally {
    if (prev === undefined) delete process.env.H2A_LOCK_MODE;
    else process.env.H2A_LOCK_MODE = prev;
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit lockMode option wins over H2A_LOCK_MODE env", () => {
  const root = freshRoot();
  const prev = process.env.H2A_LOCK_MODE;
  process.env.H2A_LOCK_MODE = "lease";
  try {
    // explicit "pid" must override the env's "lease"
    const store = createLocalStore({ root, lockMode: "pid" });
    store.registerInstance(registration("conductor:env-2"));
    assert.ok(store.findInstance("conductor:env-2"));
  } finally {
    if (prev === undefined) delete process.env.H2A_LOCK_MODE;
    else process.env.H2A_LOCK_MODE = prev;
    rmSync(root, { recursive: true, force: true });
  }
});

test("lease lockMode drives a full negotiation lifecycle (open + event + journal)", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root, lockMode: "lease" });
    store.registerInstance(registration("conductor:n1"));
    store.openNegotiation({
      id: "nego:lease",
      scope: "scope:lock",
      parties: ["conductor:n1"],
      subject: "engagement",
      status: "draft",
      requiredSigners: ["conductor:n1"]
    });
    store.appendNegotiationEvent("nego:lease", {
      id: "evt-1",
      type: "event",
      actor: { instance: "conductor:n1", role: "CONDUCTOR", scope: "scope:lock" },
      body: { kind: "tick" },
      createdAt: "2026-05-25T00:00:01.000Z"
    });
    const journal = store.readNegotiationJournal("nego:lease");
    assert.ok(journal.length >= 1);
    // negotiation dir lock released
    assert.equal(
      existsSync(join(root, "negotiations", "nego__lease", ".lock")),
      false
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
