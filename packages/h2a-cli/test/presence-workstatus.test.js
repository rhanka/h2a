import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inferStall } from "@sentropic/h2a";
import { writePresence, readPresence, updatePresence } from "../dist/index.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-workstatus-"));
}

const baseSession = (over = {}) => ({
  sessionId: "sess-ws",
  instance: "codex:proj",
  startedAt: "2026-05-26T11:59:00.000Z",
  heartbeatAt: "2026-05-26T12:00:00.000Z",
  state: "live",
  interests: { scopes: ["scope:default"], negotiations: [] },
  subscribedTopics: [],
  ...over
});

test("updatePresence persists workStatus + launchContext (DEC-084 D1)", () => {
  const root = freshRoot();
  try {
    writePresence(root, baseSession());
    const updated = updatePresence(root, "sess-ws", {
      workStatus: "out-of-tokens",
      launchContext: {
        cwd: "/home/u/proj",
        command: "codex",
        resumeCommand: "codex resume",
        tmux: { session: "main", pane: "%2" }
      }
    });
    assert.equal(updated.workStatus, "out-of-tokens");
    assert.equal(updated.launchContext.resumeCommand, "codex resume");
    // round-trips through disk (and passes the isH2ASession guard on read)
    const onDisk = readPresence(root, "sess-ws");
    assert.equal(onDisk.workStatus, "out-of-tokens");
    assert.equal(onDisk.launchContext.tmux.pane, "%2");
    // and the stored status feeds stall detection
    assert.deepEqual(inferStall(onDisk, { now: Date.parse("2026-05-26T12:00:05.000Z") }), {
      stalled: true,
      reason: "out-of-tokens"
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("updatePresence rejects an unknown workStatus", () => {
  const root = freshRoot();
  try {
    writePresence(root, baseSession());
    assert.throws(
      () => updatePresence(root, "sess-ws", { workStatus: "spinning" }),
      /unknown work status/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
