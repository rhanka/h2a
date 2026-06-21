import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createMcpServer,
  localTmuxDriver,
  paneHasRecentHumanActivity
} from "../dist/index.js";

// ── paneHasRecentHumanActivity (pure-ish, injected capture) ──────────────────

function captureRuntime(sessionName, activityEpochSec) {
  return {
    capture(file, args) {
      if (args.includes("display-message")) return sessionName == null ? undefined : `${sessionName}\n`;
      if (args.includes("list-clients")) return activityEpochSec == null ? "" : `${activityEpochSec}\n`;
      return undefined;
    }
  };
}

const NOW = Date.parse("2026-06-21T12:00:00.000Z");
const nowSec = Math.floor(NOW / 1000);

test("paneHasRecentHumanActivity: true when a client was active within the window", () => {
  const rt = captureRuntime("sess", nowSec - 2); // 2s ago
  assert.equal(paneHasRecentHumanActivity(rt, "%1", { now: NOW }), true);
});

test("paneHasRecentHumanActivity: false when activity is stale (past the window)", () => {
  const rt = captureRuntime("sess", nowSec - 60); // 60s ago
  assert.equal(paneHasRecentHumanActivity(rt, "%1", { now: NOW }), false);
});

test("paneHasRecentHumanActivity: false (fail-open) when no client / no capture / window=0", () => {
  assert.equal(paneHasRecentHumanActivity(captureRuntime("sess", null), "%1", { now: NOW }), false); // no client
  assert.equal(paneHasRecentHumanActivity({}, "%1", { now: NOW }), false); // no capture
  assert.equal(
    paneHasRecentHumanActivity(captureRuntime("sess", nowSec - 1), "%1", { now: NOW, windowMs: 0 }),
    false // disabled
  );
});

// ── localTmuxDriver defers a wake while a human is active in the pane ─────────

function driverRuntime(activeSecAgo) {
  const calls = [];
  return {
    calls,
    run(file, args) {
      calls.push([file, ...args]);
      return true;
    },
    capture(file, args) {
      if (args.includes("display-message")) return "mysess\n";
      if (args.includes("list-clients")) return `${Math.floor(Date.now() / 1000) - activeSecAgo}\n`;
      return undefined;
    }
  };
}

const REQ = {
  to: "claude:proj:aaaaaaaaaaaa",
  instructionLine: "[h2a-wake] go",
  launchContext: { cwd: "/x", command: "claude", tmux: { session: "mysess", pane: "%1" } }
};

test("localTmuxDriver: DEFERS (no send-keys) when a human was just active in the pane", () => {
  const rt = driverRuntime(1); // active 1s ago → within the 4s window
  const ok = localTmuxDriver({ runtime: rt }).drive(REQ);
  assert.equal(ok, false, "deferred → reports failure so the dispatcher retries");
  assert.equal(
    rt.calls.some((c) => c.includes("send-keys")),
    false,
    "must NOT type into the pane while the human is active"
  );
});

test("localTmuxDriver: sends normally when the pane has no recent human activity", () => {
  const rt = driverRuntime(120); // last activity 2min ago → past the window
  const ok = localTmuxDriver({ runtime: rt }).drive(REQ);
  assert.equal(ok, true);
  assert.ok(
    rt.calls.some((c) => c[0] === "tmux" && c.includes("send-keys") && c.includes("-l")),
    "the literal instruction is typed when the pane is idle"
  );
});

// ── dispatcher re-fires the wake each tick while the inbox is non-empty ───────

function envelope(id) {
  return {
    protocol: "sentropic.h2a",
    version: "0.1",
    id,
    type: "event",
    actor: { instance: "codex:peer:bbbbbbbbbbbb", role: "AGENTS", scope: "scope:default" },
    body: { kind: "message", text: "hi" },
    createdAt: "2026-06-21T12:00:00.000Z"
  };
}

test("NotificationDispatcher: re-fires onInboxArrival every tick while inbox non-empty (retry a deferred wake)", () => {
  const root = mkdtempSync(join(tmpdir(), "h2a-wake-retry-"));
  try {
    const server = createMcpServer({ root, notifications: { sink: () => {} } });
    server.callTool("h2a_session_open", {
      instance: "claude:proj-1",
      sessionId: "sess:p1",
      subscribedTopics: ["inbox.envelope_arrived"]
    });
    let wakeCalls = 0;
    server.notifications.setOnInboxArrival((inst) => {
      if (inst === "claude:proj-1") wakeCalls++;
    });

    server.notifications.tick(); // baseline, inbox empty → no wake
    assert.equal(wakeCalls, 0);

    server.callTool("h2a_inbox", {
      action: "put",
      instance: "claude:proj-1",
      envelope: envelope("env:1")
    });
    server.notifications.tick(); // arrival → wake #1
    server.notifications.tick(); // NO new envelope, but inbox still non-empty → wake #2 (the retry)
    server.notifications.tick(); // → wake #3

    assert.equal(wakeCalls, 3, "a still-pending inbox re-triggers the wake each tick (so a deferral retries)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
