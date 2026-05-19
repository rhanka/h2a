import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalStore } from "../dist/index.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-nego-"));
}

const baseNegotiation = (overrides = {}) => ({
  id: "nego-001",
  scope: "scope:engagement/ship-v1",
  parties: ["conductor:01", "conductor:02"],
  subject: "contract",
  status: "draft",
  requiredSigners: ["conductor:01", "conductor:02"],
  ...overrides
});

test("openNegotiation persists the record and rejects re-opening the same id", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    const opened = store.openNegotiation(baseNegotiation());
    assert.equal(opened.status, "draft");

    const found = store.readNegotiation("nego-001");
    assert.deepEqual(found, opened);

    assert.throws(
      () => store.openNegotiation(baseNegotiation()),
      /already open/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("openNegotiation rejects an unknown status", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    assert.throws(
      () => store.openNegotiation(baseNegotiation({ status: "pending" })),
      /Unknown negotiation state/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("updateNegotiationStatus rewrites state.json", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    store.openNegotiation(baseNegotiation());
    const updated = store.updateNegotiationStatus("nego-001", "proposed");
    assert.equal(updated.status, "proposed");
    assert.equal(store.readNegotiation("nego-001").status, "proposed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("updateNegotiationStatus rejects unknown id and unknown status", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    assert.throws(
      () => store.updateNegotiationStatus("missing", "proposed"),
      /not found/
    );
    store.openNegotiation(baseNegotiation());
    assert.throws(
      () => store.updateNegotiationStatus("nego-001", "pending"),
      /Unknown negotiation state/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readNegotiation returns undefined when missing", () => {
  const root = freshRoot();
  try {
    const store = createLocalStore({ root });
    assert.equal(store.readNegotiation("missing"), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
