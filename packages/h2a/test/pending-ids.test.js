import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createInboxWakeHandler,
  readPendingIdsFile
} from "../dist/index.js";

const INSTANCE = "claude:proj:cccccccccccc";
let CLOCK = Date.parse("2026-10-20T12:00:00.000Z");
const now = () => CLOCK;

function envelope(id) {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id,
    type: "event",
    actor: { instance: "claude:lead", role: "AGENTS", scope: "scope:default" },
    body: { kind: "message", topic: "t", text: "ping" },
    createdAt: "2026-10-20T11:59:00.000Z"
  };
}

const PRIV = generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString();

// Round-3 P2 (reviews pr382-r3): the pending-wake reader distinguishes
// absent (no pending) from unreadable (pending state unknown).
test("an absent pending file reads as empty", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-r3-pending-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(readPendingIdsFile(join(dir, "missing.json")), []);
});

test("a valid pending file reads its string ids", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-r3-pending-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "pending.json");
  writeFileSync(path, JSON.stringify(["a", "b", 42, null]));
  assert.deepEqual(readPendingIdsFile(path), ["a", "b"]);
});

test("a truncated pending file throws instead of reading as empty", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-r3-pending-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "pending.json");
  writeFileSync(path, '["env-1", "env-');
  assert.throws(() => readPendingIdsFile(path), /pending store corrupt/);
});

test("a non-array pending document throws instead of reading as empty", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-r3-pending-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "pending.json");
  writeFileSync(path, '{"ids":[]}');
  assert.throws(() => readPendingIdsFile(path), /pending store corrupt/);
  writeFileSync(path, "");
  assert.throws(() => readPendingIdsFile(path), /pending store corrupt/);
});

test("a present-but-unreadable pending path throws", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-r3-pending-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sub = join(dir, "sub");
  mkdirSync(sub);
  assert.throws(() => readPendingIdsFile(sub), /pending store unreadable/);
});

// Round-3 P2 reviewer reproduction: a truncated pending JSON with an
// envelope in the inbox at restart must NOT bury the wake. Before the fix
// the real reader swallowed the error (pending=[], the inbox seeded as
// seen): drives=0, result=false, no log. After the fix the uncertainty
// propagates (pendingUnreadable): the inbox retries from scratch.
test("a truncated pending file retries the inbox from scratch instead of burying the wake", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-r3-pending-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "inbox-wake-pending.inst.json");
  writeFileSync(path, '["env-buried", "env-');
  const inbox = [envelope("env-live-1")];
  let drives = 0;
  const logs = [];
  const failing = { drive: () => { drives += 1; return false; } };
  const wake = createInboxWakeHandler({
    instance: INSTANCE,
    readInbox: () => inbox,
    privateKeyPem: PRIV,
    driver: failing,
    pendingStore: {
      load: () => readPendingIdsFile(path),
      save: (ids) => writeFileSync(path, JSON.stringify(ids))
    },
    log: (line) => logs.push(line),
    now
  });
  assert.equal(await wake(), false);
  assert.equal(drives, 1);
  assert.ok(logs.some((line) => /pending store (unreadable|corrupt)/i.test(line)), `uncertainty surfaced, got ${JSON.stringify(logs)}`);
});
