import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalStore, runCli, writePresence } from "../dist/index.js";

const INSTANCE = "claude:proj:aaaaaaaaaaaa";

function envelope() {
  return JSON.stringify({
    protocol: "sentropic.h2a",
    version: "0.1",
    id: `env:${Date.now()}:dead`,
    type: "event",
    actor: { instance: "claude:sender:bbbbbbbbbbbb", role: "AGENTS", scope: "scope:default" },
    body: { kind: "message", text: "hi" },
    createdAt: new Date().toISOString()
  });
}

function put(root) {
  let stdout = "";
  const rc = runCli(["inbox", "put", "--root", root, "--instance", INSTANCE, "--json", envelope()], {
    stdout: { write: (c) => void (stdout += c) },
    stderr: { write: () => {} },
    cwd: () => root
  });
  assert.equal(rc, 0, stdout);
  return JSON.parse(stdout);
}

test("inbox put reports recipientLive=false when the target has no fresh session (bug 2 backstop)", () => {
  const root = join(mkdtempSync(join(tmpdir(), "h2a-bug2-")), ".h2a");
  try {
    createLocalStore({ root });
    const res = put(root);
    assert.equal(res.ok, true);
    assert.equal(res.recipientLive, false, "no presence → dormant, must not look live");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inbox put reports recipientLive=true once the target has a fresh session", () => {
  const root = join(mkdtempSync(join(tmpdir(), "h2a-bug2-")), ".h2a");
  try {
    createLocalStore({ root });
    writePresence(root, {
      sessionId: "sess:live1",
      instance: INSTANCE,
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      state: "live",
      interests: { scopes: ["scope:default"], negotiations: [] },
      subscribedTopics: []
    });
    const res = put(root);
    assert.equal(res.recipientLive, true, "fresh presence → live");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("liveness match is CANONICAL: a case/slug-variant presence still reads live (no false dormant)", () => {
  const root = join(mkdtempSync(join(tmpdir(), "h2a-bug2-")), ".h2a");
  try {
    createLocalStore({ root });
    // Presence recorded under a mixed-case form of the SAME instance. Addressing
    // the canonical form must still see it live — a raw === would miss it and
    // wrongly report dormant (the bug this guards).
    writePresence(root, {
      sessionId: "sess:case",
      instance: "claude:Proj:AAAAAAAAAAAA",
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      state: "live",
      interests: { scopes: ["scope:default"], negotiations: [] },
      subscribedTopics: []
    });
    const res = put(root); // addresses claude:proj:aaaaaaaaaaaa
    assert.equal(res.recipientLive, true, "case/slug variant of the same instance → live");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
