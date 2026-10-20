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

// Round-1 P1 (code-review astra-1 / sol-2): two distinct envelope batches
// must carry distinct stable idempotency keys and two writes. Today both
// requests interpolate the envelope object (`wake:[object Object]`), so a
// deduping transport applies only the first write while the handler still
// marks the second batch seen.
test("two successive batches drive twice under distinct idempotency keys", async (t) => {
  const fs = fileStore();
  t.after(fs.cleanup);
  const inbox = [];
  const requests = [];
  const driver = {
    drive: (req) => {
      requests.push(req);
      return true;
    }
  };
  const wake = createInboxWakeHandler({
    instance: INSTANCE,
    readInbox: () => inbox,
    privateKeyPem: PRIV,
    driver,
    pendingStore: fs.store,
    now
  });
  inbox.push(envelope("env-batch-1"));
  assert.equal(await wake(), true);
  inbox.push(envelope("env-batch-2"));
  assert.equal(await wake(), true);
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0].requestId, requests[1].requestId);
  for (const req of requests) {
    assert.match(req.requestId, /^wake:[0-9a-f]{16,64}$/);
    assert.doesNotMatch(String(req.requestId), /object Object/);
  }
});

// Round-2 P2 (code-review sol-6): a failing pending store must neither bury
// a deferred wake on restart nor fail silently. Today store errors collapse
// to an empty state: the restart seed marks the undelivered envelope seen
// and it is never retried.
test("a failing pending store never buries a deferred wake on restart", async (t) => {
  const inbox = [];
  let drives = 0;
  const deferring = { drive: () => { drives += 1; return { outcome: "deferred", reason: "deferred-recent-human", retryAfterMs: 50 }; } };
  const throwing = {
    load: () => { throw new Error("simulated disk failure"); },
    save: () => { throw new Error("simulated disk failure"); }
  };
  const logs = [];
  const deps = () => ({
    instance: INSTANCE,
    readInbox: () => inbox,
    privateKeyPem: PRIV,
    driver: deferring,
    pendingStore: throwing,
    log: (line) => logs.push(line),
    now
  });
  const first = createInboxWakeHandler(deps());
  inbox.push(envelope("env-buried-1"));
  assert.equal(await first(), false);
  assert.equal(drives, 1);
  // Restart on the same non-empty inbox with the store still failing: the
  // undelivered envelope must be retried, not seeded as seen.
  const second = createInboxWakeHandler(deps());
  assert.equal(await second(), false);
  assert.equal(drives, 2);
  assert.ok(logs.some((line) => /pending store/i.test(line)), `failure surfaced, got ${JSON.stringify(logs)}`);
});

// Round-2 P1: a recent-human deferral asks the sidecar for one coalesced
// retry after the typed window; final outcomes never schedule.
test("a recent-human deferral schedules one sidecar retry, final outcomes do not", async (t) => {
  const inbox = [];
  const scheduled = [];
  const driver = {
    drive: () => ({ outcome: "deferred", reason: "deferred-recent-human", retryAfterMs: 50 })
  };
  const handler = createInboxWakeHandler({
    instance: INSTANCE,
    readInbox: () => inbox,
    privateKeyPem: PRIV,
    driver,
    scheduleRetry: (ms) => scheduled.push(ms),
    now
  });
  inbox.push(envelope("env-retry-1"));
  assert.equal(await handler(), false);
  assert.deepEqual(scheduled, [50]);

  const refused = [];
  let refusals = 0;
  const refusing = { drive: () => { refusals += 1; return { outcome: "refused", reason: "refused-no-capability" }; } };
  const handler2 = createInboxWakeHandler({
    instance: INSTANCE,
    readInbox: () => inbox,
    privateKeyPem: PRIV,
    driver: refusing,
    scheduleRetry: (ms) => refused.push(ms),
    now
  });
  inbox.push(envelope("env-retry-2"));
  assert.equal(await handler2(), false);
  assert.equal(refusals, 1);
  assert.deepEqual(refused, []);
});
