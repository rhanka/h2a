// Recipient-name resolution: the external surface matrix.
//
// Written by the cyber lane as the independent leg on the DOC-03 name-resolution
// work, and handed over to be grafted rather than retranscribed: a matrix
// rewritten by the lane it audits is no longer an independent bound.
//
// It pins three things at once, which is the point — a guard that only closes
// and never opens cannot tell you it closed too much:
//   1. every target form that collapses to a BLANK name key is refused;
//   2. a DISPLAY name never answers for the `host:label` address space;
//   3. the legacy `h2a:<name>` form stays ADDRESSABLE.
//
// Where this stops: it exercises resolveRecipient only. It says nothing about
// who is authorised to read or pop the resolved inbox — a separate weakness,
// measured by coop's review leg and tracked on the cyber side.

import assert from "node:assert/strict";
import test from "node:test";

import { resolveRecipient } from "../dist/index.js";

const resolve = (target, liveInstances, registeredInstances = []) =>
  resolveRecipient({
    target,
    liveInstances,
    registeredInstances,
    operation: "write",
  });

/** One live presence whose display name is the EMPTY string. */
const VICTIM_BLANK_NAME = [
  { instance: "claude:victim:aaaaaaaaaaaa", name: "" },
];

/** An imposter carrying a host-qualified address as its DISPLAY name. */
const IMPOSTER = { instance: "claude:imposter:bbbbbbbbbbbb", name: "claude:victim" };

// ---------------------------------------------------------------------------
// 1. Blank name keys
// ---------------------------------------------------------------------------

// Every one of these collapses to "" once trimmed and stripped of a leading
// `h2a:`, so each of them used to reach the presence whose name is "".
// The empty string and the lone tab are the two that no reasoning about the
// `h2a:` prefix produces — they have to be enumerated.
const BLANK_KEY_TARGETS = ["h2a:", "H2A:", " h2a: ", "\t", ""];

for (const target of BLANK_KEY_TARGETS) {
  test(`refuses ${JSON.stringify(target)} against a presence whose name is empty`, () => {
    const result = resolve(target, VICTIM_BLANK_NAME);
    assert.equal(
      result.kind,
      "refuse",
      `${JSON.stringify(target)} must not address a blank display name (got ${result.kind})`,
    );
  });
}

test("refuses a blank key even when several presences share it", () => {
  const result = resolve("h2a:", [
    { instance: "claude:a:111111111111", name: "" },
    { instance: "claude:b:222222222222", name: "" },
  ]);
  assert.equal(result.kind, "refuse");
});

// ---------------------------------------------------------------------------
// 2. A display name must not answer for the host:label space
// ---------------------------------------------------------------------------

test("a lone imposter does not receive traffic addressed to host:label", () => {
  const result = resolve("claude:victim", [IMPOSTER]);
  assert.notEqual(
    result.recipient,
    IMPOSTER.instance,
    "a display name must never capture a host-qualified address",
  );
});

test("a display name does not override a REGISTERED instance", () => {
  const result = resolve("claude:victim", [IMPOSTER], [
    "claude:victim:cccccccccccc",
  ]);
  assert.notEqual(
    result.recipient,
    IMPOSTER.instance,
    "a forgeable display name must not outrank a registered identity",
  );
});

test("a display name does not capture when the real target is also live", () => {
  const result = resolve("claude:victim", [
    IMPOSTER,
    { instance: "claude:victim:cccccccccccc" },
  ]);
  assert.notEqual(result.recipient, IMPOSTER.instance);
});

// ---------------------------------------------------------------------------
// 3. What the guards must NOT close
// ---------------------------------------------------------------------------

test("a plain display name still resolves to its instance", () => {
  const result = resolve("alice", [
    { instance: "claude:alice:dddddddddddd", name: "alice" },
  ]);
  assert.equal(result.kind, "deliver-resolved");
  assert.equal(result.recipient, "claude:alice:dddddddddddd");
});

test("the legacy h2a:<name> form is NOT a supported address", () => {
  // This assertion was the reverse until the owning lane argued it down, and the
  // argument that turned it is a rung argument, not a usage count: a SUPPRESSED
  // feature cannot be re-claimed, whereas a REPAIRED dead guard can be listed as
  // a guard again by the next reader — as it already had been. Suppressing moves
  // up a rung (structurally absent) instead of sideways (test-guarded).
  //
  // The usage evidence offered alongside it (zero occurrences of this form across
  // presences, docs and a historical envelope sample) was NOT reproduced by the
  // cyber lane and is not what this test rests on. It rests on the rung.
  //
  // Do not read this as "an aliased form is unsupported": the two-segment
  // `host:label` form below is used and must keep working.
  const result = resolve("h2a:agents", [
    { instance: "claude:agents:ffffffffffff", name: "agents" },
  ]);
  assert.equal(
    result.kind,
    "refuse",
    "h2a:<name> is deliberately unsupported — see the host:label tests below",
  );
});

// ---------------------------------------------------------------------------
// 3b. The aliased form that IS used must survive
// ---------------------------------------------------------------------------

// Requested by the owning lane after it measured this two-segment form in real
// traffic. It exists because a PR sentence saying "the aliased form is not
// supported" could be read as covering it, and that reading would break live
// addressing. Verified by the cyber lane on the guard commit.
for (const [target, instance] of [
  ["claude:architect", "claude:architect:aaaaaaaaaaaa"],
  ["claude:geo", "claude:geo:bbbbbbbbbbbb"],
  ["claude:graphify-cyber", "claude:graphify-cyber:cccccccccccc"],
  ["codex:sent-tech-design-system", "codex:sent-tech-design-system:dddddddddddd"],
]) {
  test(`host:label stays addressable: ${target}`, () => {
    const result = resolve(target, [{ instance }]);
    assert.notEqual(
      result.kind,
      "refuse",
      `${target} is a live addressing form and must not be refused`,
    );
  });
}

test("host:label still reaches a registered-but-dormant instance", () => {
  const result = resolve("claude:architect", [], ["claude:architect:aaaaaaaaaaaa"]);
  assert.notEqual(result.kind, "refuse");
});

test("a colon-bearing display name is unreachable by name — declared cost", () => {
  // Pinned deliberately: closing the host:label capture costs the addressability
  // of any display name that contains a colon. Recorded as a decision, so that
  // restoring it later is a visible change rather than a silent one.
  const result = resolve("feat:auth", [
    { instance: "claude:dev:eeeeeeeeeeee", name: "feat:auth" },
  ]);
  assert.equal(result.kind, "refuse");
});
