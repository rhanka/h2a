/**
 * H2A-REG-H2-H4 — H5: read-only conductor/loop reference surface (r2 §8.1 H5).
 * Stable ids for conductor claims and objective loops so audit/escalation
 * records can reference collaboration context without owning it. Pure and
 * read-only: no store, no writes, frozen refs.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_CONDUCTOR_LOOP_REF_FORMAT,
  buildConductorLoopRef,
  conductorClaimRef,
  isConductorLoopRef,
  objectiveLoopRef
} from "../dist/index.js";

const FIXED_AT = "2026-10-30T00:00:00.000Z";

test("generic builder stamps the frozen format and validates the kind union", () => {
  const ref = buildConductorLoopRef({
    kind: "objective-loop",
    refId: "loop-42",
    workspaceId: "ws:11111111-2222-3333-4444-555555555555",
    recordedAt: FIXED_AT
  });

  assert.equal(H2A_CONDUCTOR_LOOP_REF_FORMAT, "h2a.conductor-loop-ref/v1");
  assert.equal(ref.format, "h2a.conductor-loop-ref/v1");
  assert.equal(ref.kind, "objective-loop");
  assert.equal(ref.ref, "loop-42");
  assert.equal(ref.workspaceId, "ws:11111111-2222-3333-4444-555555555555");
  assert.equal(ref.recordedAt, FIXED_AT);
  assert.ok(isConductorLoopRef(ref));
  assert.ok(Object.isFrozen(ref), "the reference surface is read-only");

  assert.throws(() =>
    buildConductorLoopRef({ kind: "sidequest", refId: "x", recordedAt: FIXED_AT })
  );
  assert.throws(() => buildConductorLoopRef({ kind: "objective-loop", refId: "", recordedAt: FIXED_AT }));
  assert.throws(() => buildConductorLoopRef({ kind: "objective-loop", refId: "x", recordedAt: "" }));
});

test("conductor-claim refs derive from claim events without owning them", () => {
  const event = {
    type: "claim",
    workspaceId: "ws:11111111-2222-3333-4444-555555555555",
    instance: "claude:alpha:aaaaaaaaaaaa",
    at: FIXED_AT
  };
  const ref = conductorClaimRef(event);

  assert.equal(ref.kind, "conductor-claim");
  assert.equal(ref.workspaceId, "ws:11111111-2222-3333-4444-555555555555");
  assert.equal(ref.recordedAt, FIXED_AT);
  assert.ok(ref.ref.includes("claude:alpha:aaaaaaaaaaaa"), "the claim id must identify the claiming instance");
  assert.ok(isConductorLoopRef(ref));
});

test("objective-loop refs carry the loop id and optional h2a workspace id", () => {
  const ref = objectiveLoopRef("loop-42", { workspaceId: "ws:11111111-2222-3333-4444-555555555555", recordedAt: FIXED_AT });
  assert.equal(ref.kind, "objective-loop");
  assert.equal(ref.ref, "loop-42");

  const bare = objectiveLoopRef("loop-43", { recordedAt: FIXED_AT });
  assert.equal(bare.workspaceId, undefined);
  assert.ok(isConductorLoopRef(bare));
});

test("guard refuses unknown format, kind, and missing identity", () => {
  const ref = objectiveLoopRef("loop-42", { recordedAt: FIXED_AT });
  assert.equal(isConductorLoopRef({ ...ref, format: "h2a.other/v1" }), false);
  assert.equal(isConductorLoopRef({ ...ref, kind: "drumbeat" }), false);
  assert.equal(isConductorLoopRef({ ...ref, ref: "" }), false);
  assert.equal(isConductorLoopRef({ ...ref, workspaceId: 7 }), false);
  assert.equal(isConductorLoopRef(null), false);
  assert.equal(isConductorLoopRef({}), false);
});
