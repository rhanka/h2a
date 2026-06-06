import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEnvelope } from "@sentropic/h2a";
import { canonicalAddress, createLocalStore } from "../dist/index.js";

// Addressing convergence (the claude:matchID footgun): deriveInstanceId slugifies
// + lowercases the label, but inbox dirs were keyed on the RAW string — so
// `claude:matchID` and `claude:matchid` were different inboxes and messages were
// silently lost. canonicalAddress folds case + slugifies the label so the two
// resolve to ONE inbox; reads also fall back to the legacy raw dir (no data loss).

function env(id, signer, recipient) {
  return createEnvelope({
    id,
    type: "event",
    actor: { instance: signer, role: "AGENTS", scope: "scope:default" },
    target: { instance: recipient },
    body: { kind: "message", text: "hello" },
    createdAt: new Date().toISOString()
  });
}

test("canonicalAddress: folds case + slugifies the label, idempotent on canonical ids", () => {
  assert.equal(canonicalAddress("claude:matchID"), "claude:matchid");
  assert.equal(canonicalAddress("claude:matchID:2EA2637107AB"), "claude:matchid:2ea2637107ab");
  // already-canonical perennial ids are unchanged (no accidental rewrite)
  assert.equal(canonicalAddress("claude:a2a-cli:07bcd1936752"), "claude:a2a-cli:07bcd1936752");
  assert.equal(canonicalAddress("codex:poc-k8s:801b21f51324"), "codex:poc-k8s:801b21f51324");
  // a non-instance bare token is left alone
  assert.equal(canonicalAddress("sentropic-chat"), "sentropic-chat");
});

test("canonicalAddress: subagent ~name is case-PRESERVED (no inbox collision between siblings)", () => {
  // the instance part is canonicalized; the ~name rides verbatim (case-sensitive).
  assert.equal(
    canonicalAddress("claude:proj-1:07bcd1936752~Researcher"),
    "claude:proj-1:07bcd1936752~Researcher"
  );
  // case-only-distinct siblings must NOT collapse to the same canonical handle
  assert.notEqual(
    canonicalAddress("claude:proj-1:07bcd1936752~Researcher"),
    canonicalAddress("claude:proj-1:07bcd1936752~researcher")
  );
  // but the instance part still folds (host caps), name still verbatim
  assert.equal(canonicalAddress("Claude:Proj:07bcd1936752~Bob"), "claude:proj:07bcd1936752~Bob");
});

test("two case-distinct subagents do NOT share an inbox (isolation)", () => {
  const root = join(mkdtempSync(join(tmpdir(), "h2a-subagent-")), ".h2a");
  try {
    const store = createLocalStore({ root });
    const R = "claude:proj:07bcd1936752~Researcher";
    const r = "claude:proj:07bcd1936752~researcher";
    store.putInboxMessage(R, env("to-R", "claude:a2a-cli:07bcd1936752", R));
    assert.equal(store.readInbox(R).length, 1, "Researcher gets its message");
    assert.equal(store.readInbox(r).length, 0, "researcher (lowercase sibling) must NOT see it");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inbox routing is case-insensitive: put with one case, read with another", () => {
  const root = join(mkdtempSync(join(tmpdir(), "h2a-casefold-")), ".h2a");
  try {
    const store = createLocalStore({ root });
    // sender used the WRONG case on the channel
    store.putInboxMessage("claude:matchID", env("env-1", "claude:a2a-cli:07bcd1936752", "claude:matchID"));
    // recipient reads its canonical (lowercase) channel → still finds it
    assert.equal(store.readInbox("claude:matchid").length, 1);

    // and the reverse: put lowercase, read with caps
    store.putInboxMessage("claude:matchid", env("env-2", "claude:a2a-cli:07bcd1936752", "claude:matchid"));
    const read = store.readInbox("claude:MATCHID");
    assert.equal(read.length, 2, "both envelopes land in the one canonical inbox");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("backward-compat: a pre-fix deposit in the raw dir is recovered via its handle", () => {
  const root = join(mkdtempSync(join(tmpdir(), "h2a-casefold-legacy-")), ".h2a");
  try {
    const store = createLocalStore({ root });
    // simulate a pre-fix deposit written straight into the raw dir claude__matchID
    // (this is exactly the orphaned state we observed for the matchID agent).
    const rawDir = join(root, "inbox", "claude__matchID");
    mkdirSync(rawDir, { recursive: true });
    const e = env("env-legacy", "claude:a2a-cli:07bcd1936752", "claude:matchID");
    writeFileSync(join(rawDir, "env__env-legacy.json"), JSON.stringify(e, null, 2), "utf8");

    // The matchID agent reads its legacy alias `claude:matchID` (the raw host:label
    // form, caps preserved) — reads include the raw fallback dir, so the orphan
    // surfaces. A NEW canonical send is also visible through the same handle.
    store.putInboxMessage("claude:matchID", env("env-new", "claude:a2a-cli:07bcd1936752", "claude:matchID"));
    const read = store.readInbox("claude:matchID");
    assert.equal(read.length, 2, "legacy raw-dir orphan + new canonical send both read");
    assert.ok(read.some((x) => x.id === "env-legacy"), "orphan recovered");
    assert.ok(read.some((x) => x.id === "env-new"), "new canonical send present");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
