/**
 * Lot L1a RED — foreground-facet contract, part 1: filtered live-agent sessions.
 *
 * A session filtered to a live agent tool (or "all agents", which implies a live
 * filter) MUST NOT be treated as an inert attach target: when the central
 * registry reports the expected CLI row as absent (or the row exists but the
 * host process is gone), restore records a blocked ledger entry whose remedy
 * names the attach command, and launches nothing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveSessionFacet } from "../../h2a-runtime/dist/launch-layout.js";

function row(partial) {
  return {
    session: "s1",
    tool: "claude",
    kind: "local-native",
    tmuxLive: false,
    pidAlive: false,
    transcriptPath: undefined,
    ...partial,
  };
}

test("L1a RED: agent CLI + live + transcript is a live-agent-cli facet", () => {
  assert.equal(
    deriveSessionFacet(row({ tool: "claude", tmuxLive: true, transcriptPath: "/tmp/s1.jsonl" })),
    "live-agent-cli",
  );
});

test("L1a RED: dead CLI + transcript still offers a consumable-transcript anchor", () => {
  assert.equal(
    deriveSessionFacet(row({ tool: "codex", pidAlive: false, transcriptPath: "/tmp/s2.jsonl" })),
    "consumable-transcript",
  );
});

test("L1a RED: dead CLI without transcript is not a live agent", () => {
  assert.equal(deriveSessionFacet(row({ tool: "agy" })), "unknown");
});

test("L1a RED: plain shell rows never become live-agent-cli", () => {
  assert.equal(
    deriveSessionFacet(row({ session: "sh1", tool: "sh", tmuxLive: true })),
    "shell",
  );
});
