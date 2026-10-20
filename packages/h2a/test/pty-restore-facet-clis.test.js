/**
 * Lot L1a RED — foreground-facet contract, part 2: side-window cohort facets,
 * attach-next affinity, and exact resume-candidate identity.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveSessionFacet,
  resolveAttachNextTarget,
  resolveOccupiedHumanRefusals,
  resolveResumeCandidate,
} from "../../h2a-runtime/dist/launch-layout.js";

function row(session, partial) {
  return {
    session,
    tool: "claude",
    kind: "local-tmux",
    tmuxLive: false,
    pidAlive: false,
    transcriptPath: undefined,
    ...partial,
  };
}

test("L1a RED: cohort rows across tools and hosting kinds get stable facets", () => {
  const cohort = [
    row("a1", { tool: "claude", tmuxLive: true, transcriptPath: "/tmp/a1.jsonl" }),
    row("a2", { tool: "codex", kind: "local-native", pidAlive: true }),
    row("h1", { tool: "sh", tmuxLive: true }),
    row("d1", { tool: "muse", transcriptPath: "/tmp/d1.jsonl" }),
    row("u1", { tool: "other" }),
  ];
  assert.deepEqual(cohort.map(deriveSessionFacet), [
    "live-agent-cli",
    "live-agent-cli",
    "shell",
    "consumable-transcript",
    "unknown",
  ]);
});

test("L1a RED: headless-unlisted CLI with a live pid stays a live-agent-cli", () => {
  assert.equal(
    deriveSessionFacet(row("h2", { tool: "vibe", kind: "local", pidAlive: true })),
    "live-agent-cli",
  );
});

test("L1a RED: attach-next prefers the window that already holds the session", () => {
  assert.equal(resolveAttachNextTarget("S", [{ sid: "S", windowName: "W1" }], ["W1", "W2"]), "W1");
  assert.equal(resolveAttachNextTarget("S", [], ["W1", "W2"]), "W1");
  assert.equal(resolveAttachNextTarget("S", [], []), undefined);
});

function snap(id, alive, startedAt) {
  return { snapshotId: id, session: "S", alive, startedAt };
}

test("L1a RED: duplicates collapse to one exact identity (live first, newest, id tiebreak)", () => {
  const only = resolveResumeCandidate([snap("a", false, "t1"), snap("b", true, "t0")]);
  assert.equal(only.snapshotId, "b");
  const newest = resolveResumeCandidate([snap("a", false, "t2"), snap("b", false, "t1")]);
  assert.equal(newest.snapshotId, "a");
  const tie = resolveResumeCandidate([snap("b", true, "t1"), snap("a", true, "t1")]);
  assert.equal(tie.snapshotId, "a");
});

test("L1a RED: resume with no usable snapshot throws", () => {
  assert.throws(() => resolveResumeCandidate([]), /no usable resume snapshot/i);
});

test("L1a RED: an occupied live-agent CLI is refused with a per-session attach remedy", () => {
  const live = new Set(["a1"]);
  const refusals = resolveOccupiedHumanRefusals(
    [
      { session: "a1", tool: "claude", tmuxLive: true },
      { session: "h1", tool: "sh", tmuxLive: true },
      { session: "d1", tool: "muse", transcriptPath: "/tmp/d1.jsonl" },
    ],
    (row) => live.has(row.session),
  );
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0].session, "a1");
  assert.match(refusals[0].remedy, /h2a attach a1/);
});
