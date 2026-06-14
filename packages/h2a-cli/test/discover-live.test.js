import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createLocalStore, runCli, writePresence } from "../dist/index.js";

// `h2a discover --live` is the "which of these can I reach RIGHT NOW?" tool.
// It must be PRESENCE-FIRST (a live agent registered on a forked bus still
// surfaces), annotate connection-confidence, and sort most-reachable first.

function reg(instance, name) {
  return {
    id: instance,
    instance,
    ...(name ? { name } : {}),
    roles: ["AGENTS"],
    scopes: ["scope:default"],
    capabilities: [],
    endpoints: [],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: new Date().toISOString()
  };
}

function presence(instance, sessionId, lastMcpActivityAt) {
  const now = new Date().toISOString();
  return {
    sessionId,
    instance,
    host: "claude",
    startedAt: now,
    heartbeatAt: now, // always heartbeat-fresh → liveness is NOT the discriminator
    state: "live",
    interests: { scopes: ["scope:default"], negotiations: [] },
    subscribedTopics: [],
    ...(lastMcpActivityAt ? { lastMcpActivityAt } : {})
  };
}

function runLive(root, extraArgs = []) {
  let out = "";
  const streams = {
    stdout: { write: (c) => void (out += c) },
    stderr: { write: () => {} }
  };
  const rc = runCli(["discover", "--root", root, "--live", ...extraArgs], streams);
  return { rc, json: JSON.parse(out) };
}

test("discover --live: presence-first, confidence-annotated, most-reachable first", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-disclive-"));
  const root = join(dir, ".h2a");
  try {
    const store = createLocalStore({ root });
    // Registered + ACTIVE (recent MCP traffic).
    store.registerInstance(reg("claude:alpha:aaaaaaaaaaaa", "alpha"));
    writePresence(root, presence("claude:alpha:aaaaaaaaaaaa", "sess:a", new Date().toISOString()));
    // Registered + IDLE-UNCERTAIN (MCP silent 30 min, heartbeat still fresh = false-live).
    store.registerInstance(reg("claude:beta:bbbbbbbbbbbb", "beta"));
    writePresence(
      root,
      presence("claude:beta:bbbbbbbbbbbb", "sess:b", new Date(Date.now() - 30 * 60_000).toISOString())
    );
    // UNREGISTERED live presence (registered on a fork) → must still surface.
    writePresence(root, presence("claude:gamma:cccccccccccc", "sess:c", new Date().toISOString()));

    const { rc, json } = runLive(root);
    assert.equal(rc, 0);
    const ids = json.map((r) => r.instance);

    // presence-first: the unregistered gamma appears.
    assert.ok(ids.includes("claude:gamma:cccccccccccc"), "unregistered live presence must surface");
    assert.equal(json.find((r) => r.instance === "claude:gamma:cccccccccccc").registered, false);
    assert.equal(json.find((r) => r.instance === "claude:alpha:aaaaaaaaaaaa").registered, true);

    // confidence is correct.
    assert.equal(json.find((r) => r.instance === "claude:alpha:aaaaaaaaaaaa").connectionConfidence, "active");
    assert.equal(json.find((r) => r.instance === "claude:beta:bbbbbbbbbbbb").connectionConfidence, "idle-uncertain");

    // sorted most-reachable first: an `active` precedes the `idle-uncertain` beta.
    const idxActive = ids.indexOf("claude:alpha:aaaaaaaaaaaa");
    const idxIdle = ids.indexOf("claude:beta:bbbbbbbbbbbb");
    assert.ok(idxActive < idxIdle, "active must sort before idle-uncertain");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discover --live: --scope filter still applies to the live set", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-disclive-scope-"));
  const root = join(dir, ".h2a");
  try {
    const store = createLocalStore({ root });
    const r = reg("claude:s1:aaaaaaaaaaaa", "s1");
    r.scopes = ["scope:team"];
    store.registerInstance(r);
    writePresence(root, presence("claude:s1:aaaaaaaaaaaa", "sess:s1", new Date().toISOString()));
    store.registerInstance(reg("claude:s2:bbbbbbbbbbbb", "s2")); // scope:default
    writePresence(root, presence("claude:s2:bbbbbbbbbbbb", "sess:s2", new Date().toISOString()));

    const { json } = runLive(root, ["--scope", "scope:team"]);
    assert.deepEqual(json.map((x) => x.instance), ["claude:s1:aaaaaaaaaaaa"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discover --live: empty when no live presence", () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-disclive-empty-"));
  const root = join(dir, ".h2a");
  try {
    const store = createLocalStore({ root });
    store.registerInstance(reg("claude:dormant:aaaaaaaaaaaa", "dormant")); // registered, no presence
    const { rc, json } = runLive(root);
    assert.equal(rc, 0);
    assert.deepEqual(json, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
