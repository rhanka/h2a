import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { createInboxWakeHandler } from "../dist/index.js";

const INSTANCE = "claude:proj:aaaaaaaaaaaa";
let CLOCK = Date.parse("2026-06-03T10:00:00.000Z");
const now = () => CLOCK;

function priv() {
  return generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString();
}

function env(id, from, topic) {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id,
    type: "event",
    actor: { instance: from, role: "AGENTS", scope: "scope:default" },
    body: { kind: "message", topic, text: "hi" },
    createdAt: "2026-06-03T09:00:00.000Z"
  };
}

test("inbox-wake handler threads launchContext from resolveLaunchContext into the drive request", async () => {
  const inbox = [];
  const calls = [];
  const driver = {
    drive(req) {
      calls.push(req);
      return true;
    }
  };
  const tmuxContext = { cwd: "/work", command: "claude", tmux: { session: "s", pane: "%1" } };
  const handler = createInboxWakeHandler({
    instance: INSTANCE,
    readInbox: () => inbox,
    privateKeyPem: priv(),
    driver,
    resolveLaunchContext: () => tmuxContext,
    now
  });

  // No envelope yet — no wake, no drive call.
  assert.equal(await handler(), false);
  assert.equal(calls.length, 0);

  // New envelope arrives → wake with launchContext set.
  inbox.push(env("lc1", "codex:peer:2", "RELANCE"));
  assert.equal(await handler(), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].launchContext, tmuxContext, "drive request must carry launchContext");
});

test("inbox-wake handler injects a signed wake on a NEW envelope, dedups, and ignores boot backlog", async () => {
  const inbox = [env("boot1", "x:1:1", "old")]; // backlog present at construction
  const calls = [];
  const driver = {
    drive(req) {
      calls.push(req);
      return true;
    }
  };
  const handler = createInboxWakeHandler({
    instance: INSTANCE,
    readInbox: () => inbox,
    privateKeyPem: priv(),
    driver,
    now
  });

  // 1. Boot backlog must NOT wake.
  assert.equal(await handler(), false);
  assert.equal(calls.length, 0, "boot backlog must not trigger a wake");

  // 2. A new envelope arrives → wake injected, signed, carrying the wake tag.
  inbox.push(env("new1", "codex:peer:2", "RELANCE"));
  assert.equal(await handler(), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, INSTANCE);
  assert.match(calls[0].instructionLine, /^\[h2a from=claude:proj:aaaaaaaaaaaa to=claude:proj:aaaaaaaaaaaa nonce=\S+ at=\S+ sig=\S+\] /);
  assert.match(calls[0].instructionLine, /\[h2a-wake reason=inbox from=codex:peer:2 topic=RELANCE/);

  // 3. No new envelope → no second wake (seen dedup).
  assert.equal(await handler(), false);
  assert.equal(calls.length, 1, "must not re-wake on already-seen envelopes");
});
