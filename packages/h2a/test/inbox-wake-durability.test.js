import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  chainDriver,
  createInboxWakeHandler,
  headlessDriver,
  localTmuxDriver
} from "../dist/index.js";

const INSTANCE = "claude:proj:bbbbbbbbbbbb";
let CLOCK = Date.parse("2026-10-19T12:00:00.000Z");
const now = () => CLOCK;

function envelope(id) {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id,
    type: "event",
    actor: { instance: "claude:lead", role: "AGENTS", scope: "scope:default" },
    body: { kind: "message", topic: "t", text: "ping" },
    createdAt: "2026-10-19T11:59:00.000Z"
  };
}

function fileStore() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-l3-red-"));
  let ids = [];
  return {
    dir,
    store: {
      load: () => [...ids],
      save: (next) => {
        ids = [...next];
      }
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

const PRIV = generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString();

// Lot L3 RED-1: a wake that the driver could not deliver must survive a
// sidecar restart. Today the pending set lives only in the handler closure:
// after a restart the seed marks the undelivered envelope seen and it is
// never retried.
test("a wake deferred by its driver is retried after a sidecar restart", async (t) => {
  const fs = fileStore();
  t.after(fs.cleanup);
  // The envelope arrives AFTER the first handler is constructed (boot
  // backlog must not wake). It then fails to drive and goes pending.
  const inbox = [];
  let drives = 0;
  const failing = { drive: () => { drives += 1; return false; } };
  const first = createInboxWakeHandler({
    instance: INSTANCE,
    readInbox: () => inbox,
    privateKeyPem: PRIV,
    driver: failing,
    pendingStore: fs.store,
    now
  });
  inbox.push(envelope("env-restart-1"));
  assert.equal(await first(), false);
  assert.equal(drives, 1);
  // Restart: a fresh handler over the same inbox and the same pending store.
  const second = createInboxWakeHandler({
    instance: INSTANCE,
    readInbox: () => inbox,
    privateKeyPem: PRIV,
    driver: failing,
    pendingStore: fs.store,
    now
  });
  assert.equal(await second(), false);
  assert.equal(drives, 2);
});

// Lot L3 RED-2: a tmux-side DEFER (human active in the pane) must never fall
// through to a headless spawn — a boolean false cannot distinguish
// "not applicable" from "deferred". Today it falls through and spawns.
test("a deferred tmux wake never falls through to a headless spawn", async () => {
  const spawned = [];
  const runtime = {
    capture(file, args) {
      if (args.includes("display-message")) return "mysess\n";
      if (args.includes("list-clients")) return `${Math.floor(Date.now() / 1000) - 2}\n`;
      return undefined;
    },
    run() { return true; },
    spawnDetached(command, options) {
      spawned.push(command);
      return true;
    }
  };
  const chain = chainDriver(
    { drive: () => false },
    localTmuxDriver({ runtime }),
    headlessDriver({ runtime })
  );
  const result = await chain.drive({
    to: INSTANCE,
    instructionLine: "line",
    launchContext: { tmux: { session: "mysess", pane: "%1" }, command: "do-it" }
  });
  // The deferral surfaces typed (never "driven") and the chain stops:
  // no headless spawn happens behind the human's back.
  assert.equal(result.outcome, "deferred");
  assert.equal(result.reason, "deferred-tmux-human-active");
  assert.equal(spawned.length, 0);
});

// Lot L3 RED-3: a typed deferred outcome must stop the chain — and must
// never be read as "driven". Today any truthy driver value returns true.
test("a typed deferred outcome stops the chain instead of reading as driven", async () => {
  let secondCalled = 0;
  const chain = chainDriver(
    { drive: () => ({ outcome: "deferred", reason: "deferred-recent-human", retryAfterMs: 1200 }) },
    { drive: () => { secondCalled += 1; return true; } }
  );
  const result = await chain.drive({ to: INSTANCE, instructionLine: "line" });
  assert.notEqual(result, true);
  assert.equal(secondCalled, 0);
});
