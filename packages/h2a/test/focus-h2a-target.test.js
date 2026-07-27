// Resolving WHO receives an injection from the Focus dossier.
//
// These tests exist because the "inject into the CLI via h2a" button could not deliver. It inferred its
// recipient from the SERVED DIRECTORY'S BASENAME — `instance.includes(":" + basename(root) + ":")` — so
// from a worktree, a copy, a renamed folder or a container it matched nothing and returned
// `delivered:false` with a polite "no live h2a session". The message was honest; the path was dead.
// A button that reliably says no is not a feature.
//
// The fixture below is shaped from the REAL live bus: several sessions in one checkout carry different
// labels (`architect`, `canevas`, `llm-mesh`), and worktrees live under paths whose basename matches no
// project. That is precisely the shape basename-matching cannot handle.

import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseLiveTarget,
  explainNoTarget,
  labelOfInstance,
  liveCliSessions
} from "../../../apps/focus/src/lib/server/h2a-target.js";

const MAIN = "/home/antoinefa/src/a2a-cli";
const WORKTREE = "/home/antoinefa/.cache-tmp/scratchpad/dossier-fix-wt";

const sessions = [
  {
    instance: "claude:a2a-cli:5236a0213b83",
    name: "a2a-cli",
    state: "live",
    heartbeatAt: "2026-07-25T23:33:00.292Z",
    workspace: { path: MAIN, label: "a2a-cli" }
  },
  {
    instance: "claude:architect:4f23dcc39369",
    name: "architect",
    state: "live",
    heartbeatAt: "2026-07-25T23:33:02.087Z",
    workspace: { path: "/home/antoinefa/src/sentropic", label: "sentropic" }
  },
  {
    instance: "claude:canevas:542ac6caeb78",
    name: "canevas",
    state: "live",
    heartbeatAt: "2026-07-25T23:33:02.082Z",
    workspace: { path: "/home/antoinefa/src/sentropic", label: "sentropic" }
  },
  {
    instance: "claude:dead-one:000000000000",
    name: "dead-one",
    state: "closed",
    heartbeatAt: "2026-07-25T20:00:00.000Z",
    workspace: { path: MAIN, label: "a2a-cli" }
  },
  {
    instance: "focus:local-human:aaaaaaaaaaaa",
    name: "not-a-cli",
    state: "live",
    heartbeatAt: "2026-07-25T23:34:00.000Z",
    workspace: { path: MAIN }
  }
];

/** A Focus served from a worktree: the directory basename matches no h2a session anywhere. */
const worktreeCtx = {
  repoPaths: [WORKTREE, MAIN],
  nameCandidates: ["dossier-fix-wt", "a2a-cli"]
};

test("liveCliSessions drops closed sessions and non-CLI hosts, freshest first", () => {
  const live = liveCliSessions(sessions);
  assert.deepEqual(
    live.map((s) => s.instance),
    [
      "claude:architect:4f23dcc39369",
      "claude:canevas:542ac6caeb78",
      "claude:a2a-cli:5236a0213b83"
    ]
  );
});

test("opening and draining sessions can still receive — they are live presences", () => {
  // `h2a sessions` has already applied the 90s heartbeat TTL. Re-filtering on state === "live" in the
  // consumer additionally discarded legitimately reachable sessions.
  const live = liveCliSessions([
    { instance: "claude:x:1", state: "opening", heartbeatAt: "2026-07-25T23:00:00Z" },
    { instance: "claude:y:2", state: "draining", heartbeatAt: "2026-07-25T22:00:00Z" },
    { instance: "claude:z:3", state: "expired", heartbeatAt: "2026-07-25T21:00:00Z" }
  ]);
  assert.deepEqual(
    live.map((s) => s.instance),
    ["claude:x:1", "claude:y:2"]
  );
});

test("THE FIX: served from a worktree whose basename matches nothing, delivery still resolves", () => {
  const resolution = chooseLiveTarget(sessions, worktreeCtx);
  assert.equal(resolution.target, "claude:a2a-cli:5236a0213b83");
  assert.equal(resolution.reason, "workspace", "resolved on the checkout path, not on a directory name");
});

test("the old basename rule would have found nothing — the regression this locks down", () => {
  // Exactly what the previous implementation computed: basename(servedDir) inside the instance id.
  const project = "dossier-fix-wt";
  const matched = sessions.filter((s) => s.instance.includes(`:${project}:`));
  assert.deepEqual(matched, [], "hence delivered:false, every single time");
});

test("a session whose LABEL differs from its checkout is still resolved by path", () => {
  // `claude:architect:…` works in /home/antoinefa/src/sentropic. Nothing in its id says "sentropic".
  const resolution = chooseLiveTarget(sessions, {
    repoPaths: ["/home/antoinefa/src/sentropic"],
    nameCandidates: ["sentropic"]
  });
  assert.equal(resolution.reason, "workspace");
  assert.equal(resolution.target, "claude:architect:4f23dcc39369", "freshest heartbeat wins");
  assert.equal(resolution.candidates.length, 2, "both sentropic sessions offered as candidates");
});

test("an explicit human choice beats every inference", () => {
  const resolution = chooseLiveTarget(sessions, {
    ...worktreeCtx,
    requested: "claude:canevas:542ac6caeb78"
  });
  assert.equal(resolution.target, "claude:canevas:542ac6caeb78");
  assert.equal(resolution.reason, "requested");
});

test("an explicit choice that is NOT live is refused, never quietly redirected", () => {
  const resolution = chooseLiveTarget(sessions, { ...worktreeCtx, requested: "claude:gone:999999999999" });
  assert.equal(resolution.target, undefined);
  assert.equal(resolution.reason, "requested-not-live");
  // Silently substituting another recipient is how a decision lands in a stranger's inbox while the UI
  // reports success.
});

test("a pinned FOCUS_H2A_TARGET that is not live is reported, not bypassed", () => {
  const resolution = chooseLiveTarget(sessions, { ...worktreeCtx, configured: "claude:gone:999999999999" });
  assert.equal(resolution.target, undefined);
  assert.equal(resolution.reason, "configured-not-live");
});

test("the emitter of this Focus wins over a path match, but only while it is live", () => {
  const live = chooseLiveTarget(sessions, { ...worktreeCtx, emitter: "claude:canevas:542ac6caeb78" });
  assert.equal(live.reason, "emitter");
  assert.equal(live.target, "claude:canevas:542ac6caeb78");

  const dead = chooseLiveTarget(sessions, { ...worktreeCtx, emitter: "claude:gone:999999999999" });
  assert.equal(dead.reason, "workspace", "a dead emitter falls back to the repo, it does not block");
  assert.equal(dead.target, "claude:a2a-cli:5236a0213b83");
});

test("label matching is a fallback for records with no workspace block", () => {
  const legacy = [
    { instance: "claude:a2a-cli:aaaaaaaaaaaa", state: "live", heartbeatAt: "2026-07-25T23:00:00Z" }
  ];
  const resolution = chooseLiveTarget(legacy, worktreeCtx);
  assert.equal(resolution.reason, "name");
  assert.equal(resolution.target, "claude:a2a-cli:aaaaaaaaaaaa");
});

test("a single live session anywhere is offered, and labelled as such", () => {
  const only = [
    {
      instance: "claude:elsewhere:bbbbbbbbbbbb",
      state: "live",
      heartbeatAt: "2026-07-25T23:00:00Z",
      workspace: { path: "/somewhere/else" }
    }
  ];
  const resolution = chooseLiveTarget(only, worktreeCtx);
  assert.equal(resolution.reason, "sole");
  assert.equal(resolution.target, "claude:elsewhere:bbbbbbbbbbbb");
});

test("an empty bus resolves to nothing at all", () => {
  const resolution = chooseLiveTarget([], worktreeCtx);
  assert.equal(resolution.target, undefined);
  assert.equal(resolution.reason, "none");
});

test("labelOfInstance reads the middle segment and is documented as a label, not a project", () => {
  assert.equal(labelOfInstance("claude:architect:4f23dcc39369"), "architect");
  assert.equal(labelOfInstance("garbage"), "");
});

test("failure states WHAT WOULD MAKE IT WORK, not just that it failed", () => {
  const resolution = chooseLiveTarget([], worktreeCtx);
  const remedy = explainNoTarget(resolution, {
    repoPaths: worktreeCtx.repoPaths,
    nameCandidates: worktreeCtx.nameCandidates
  });
  assert.match(remedy, /Aucune session h2a live/);
  assert.match(remedy, /FOCUS_H2A_TARGET/, "names the pin an operator can set");
  assert.match(remedy, /worktree/, "explains why the directory name is not used");
  assert.match(remedy, new RegExp(MAIN.replace(/\//g, "\\/")), "shows what we matched on");
});

test("a missing binary is reported as a different failure from an empty bus", () => {
  const remedy = explainNoTarget(chooseLiveTarget([], worktreeCtx), {
    binMissing: true,
    binPath: "/nope/bin.js",
    repoPaths: worktreeCtx.repoPaths,
    nameCandidates: worktreeCtx.nameCandidates
  });
  assert.match(remedy, /binaire h2a est introuvable/);
  assert.match(remedy, /build:h2a|FOCUS_H2A_BIN/);
  assert.doesNotMatch(remedy, /Aucune session h2a live n'est visible/);
});

// ── The root is half of the address ───────────────────────────────────────────────────────────────────
//
// Observed on the real host: two live h2a roots that do not see each other. `~/h2a-workspace/.h2a` (the
// default) holds `claude:a2a-cli:d36d7390005e`; the checkout `/home/antoinefa/src/a2a-cli`, used directly
// as a root by a session launched with `--root`, holds `claude:a2a-cli:5236a0213b83`. BOTH are live and
// both work in the same checkout. Depositing into the wrong one succeeds, reports `recipientLive`, fires a
// wake — and the recipient never sees it. A delivery that is unreadable is not a delivery.

const GLOBAL_ROOT = "/home/antoinefa/h2a-workspace/.h2a";
const REPO_ROOT_AS_ROOT = "/home/antoinefa/src/a2a-cli";

const twoRoots = [
  {
    instance: "claude:a2a-cli:d36d7390005e",
    name: "a2a-cli",
    state: "live",
    heartbeatAt: "2026-07-25T23:50:00.000Z",
    workspace: { path: MAIN },
    root: GLOBAL_ROOT
  },
  {
    instance: "claude:a2a-cli:5236a0213b83",
    name: "a2a-cli",
    state: "live",
    heartbeatAt: "2026-07-25T23:49:00.000Z",
    workspace: { path: MAIN },
    root: REPO_ROOT_AS_ROOT
  }
];

test("the chosen target carries the ROOT it reads from — delivery must not default elsewhere", () => {
  const resolution = chooseLiveTarget(twoRoots, worktreeCtx);
  assert.equal(resolution.target, "claude:a2a-cli:d36d7390005e");
  assert.equal(resolution.targetRoot, GLOBAL_ROOT, "the deposit root travels with the recipient");
});

test("choosing the session on the OTHER root delivers to that other root", () => {
  const resolution = chooseLiveTarget(twoRoots, {
    ...worktreeCtx,
    requested: "claude:a2a-cli:5236a0213b83"
  });
  assert.equal(resolution.reason, "requested");
  assert.equal(resolution.targetRoot, REPO_ROOT_AS_ROOT);
});

test("two live sessions for one repo is reported as AMBIGUOUS, never silently coin-flipped", () => {
  const resolution = chooseLiveTarget(twoRoots, worktreeCtx);
  assert.equal(resolution.ambiguous, true);
  assert.equal(resolution.candidates.length, 2);
  // This is the case that cost a delivery: the sender picked one of two of the owner's own sessions and
  // said nothing, so "delivered" looked complete while the human's session saw nothing.
});

test("a single match is not flagged ambiguous", () => {
  const resolution = chooseLiveTarget([twoRoots[0]], worktreeCtx);
  assert.equal(resolution.ambiguous, false);
  assert.equal(resolution.targetRoot, GLOBAL_ROOT);
});

test("the remedy names the roots searched, so an invisible bus is not mistaken for an empty one", () => {
  const remedy = explainNoTarget(chooseLiveTarget([], worktreeCtx), {
    repoPaths: worktreeCtx.repoPaths,
    nameCandidates: worktreeCtx.nameCandidates,
    roots: [GLOBAL_ROOT, REPO_ROOT_AS_ROOT]
  });
  assert.match(remedy, /Racines h2a interrogées/);
  assert.ok(remedy.includes(GLOBAL_ROOT) && remedy.includes(REPO_ROOT_AS_ROOT));
});

test("live sessions are listed with their root, so a human can tell two same-named sessions apart", () => {
  const resolution = chooseLiveTarget(twoRoots, { repoPaths: ["/nope"], nameCandidates: ["nope"] });
  assert.deepEqual(
    resolution.live.map((s) => s.root),
    [GLOBAL_ROOT, REPO_ROOT_AS_ROOT]
  );
});

test("live sessions are surfaced even when none match, so a human can pick one", () => {
  const resolution = chooseLiveTarget(sessions, {
    repoPaths: ["/no/such/repo"],
    nameCandidates: ["no-such-repo"]
  });
  assert.equal(resolution.target, undefined);
  assert.equal(resolution.reason, "none");
  assert.equal(resolution.live.length, 3, "the choice is offered rather than a dead end");
});
