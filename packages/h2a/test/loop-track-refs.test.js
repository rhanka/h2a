import test from "node:test";
import assert from "node:assert/strict";

// Pure mapping: track item (bucket/realization/acceptance) → loop RefStatus.
import { mapTrackAggregateToRefStatus } from "../dist/runtime/loop/engine/adapters.js";

test("DONE + acceptance accepted/pass → accepted", () => {
  assert.equal(mapTrackAggregateToRefStatus({ bucket: "DONE", acceptance: "accepted" }), "accepted");
  assert.equal(mapTrackAggregateToRefStatus({ bucket: "DONE", acceptance: "pass" }), "accepted");
});

test("DONE sans acceptance passée → done", () => {
  assert.equal(mapTrackAggregateToRefStatus({ bucket: "DONE", acceptance: "unknown" }), "done");
  assert.equal(mapTrackAggregateToRefStatus({ bucket: "DONE" }), "done");
});

test("DROPPED ou realization cancelled → rejected", () => {
  assert.equal(mapTrackAggregateToRefStatus({ bucket: "DROPPED" }), "rejected");
  assert.equal(mapTrackAggregateToRefStatus({ bucket: "TO-DO", realization: "cancelled" }), "rejected");
});

test("AWAITED / TO-DO → pending", () => {
  assert.equal(mapTrackAggregateToRefStatus({ bucket: "AWAITED", realization: "done" }), "pending");
  assert.equal(mapTrackAggregateToRefStatus({ bucket: "TO-DO" }), "pending");
});

test("bucket inconnu / item absent → unknown", () => {
  assert.equal(mapTrackAggregateToRefStatus({ bucket: "WHAT" }), "unknown");
  assert.equal(mapTrackAggregateToRefStatus({}), "unknown");
  assert.equal(mapTrackAggregateToRefStatus(undefined), "unknown");
});

test("casse insensible sur bucket/acceptance", () => {
  assert.equal(mapTrackAggregateToRefStatus({ bucket: "done", acceptance: "ACCEPTED" }), "accepted");
  assert.equal(mapTrackAggregateToRefStatus({ bucket: "awaited" }), "pending");
});
