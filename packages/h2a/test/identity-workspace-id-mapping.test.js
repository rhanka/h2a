/**
 * H2A-REG-H2-H4 — WorkspaceIdMapping durable-id hints (r2 §2.3): the h2a
 * durable workspace id `ws:<sha256hex>` and the realpath are PROPOSAL INPUTS
 * for a cluster-mesh-owned mapping, never proof and never the presence ref.
 * Pure emission from `identity.ts` (the mapping itself is owned by
 * cluster-mesh; one (machine, h2a id) maps to at most one cluster-mesh
 * workspace, conflicts require owner recording).
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_WORKSPACE_ID_MAPPING_HINT_FORMAT,
  buildWorkspaceIdMappingHint,
  computeDurableWorkspaceId,
  deriveWorkspaceId,
  isWorkspaceIdMappingHint
} from "../dist/index.js";

const FIXED_AT = "2026-10-30T00:00:00.000Z";
const h2aId = deriveWorkspaceId({ machineId: "machine-1", path: "/repo/alpha" });
const durableId = computeDurableWorkspaceId("4c9f2f5f4a", "");

test("hint carries the frozen shape over both workspace ids", () => {
  assert.match(h2aId, /^ws:[0-9a-f-]{36}$/);
  assert.match(durableId, /^ws:[0-9a-f]{64}$/);

  const hint = buildWorkspaceIdMappingHint({
    h2aWorkspaceId: h2aId,
    durableWorkspaceId: durableId,
    realpath: "/repo/alpha",
    recordedAt: FIXED_AT
  });

  assert.equal(H2A_WORKSPACE_ID_MAPPING_HINT_FORMAT, "h2a.workspace-id-mapping-hint/v1");
  assert.equal(hint.format, "h2a.workspace-id-mapping-hint/v1");
  assert.equal(hint.h2aWorkspaceId, h2aId);
  assert.equal(hint.durableWorkspaceId, durableId);
  assert.equal(hint.realpath, "/repo/alpha");
  assert.equal(hint.recordedAt, FIXED_AT);
  assert.ok(isWorkspaceIdMappingHint(hint));
});

test("hint is a proposal input: realpath optional, no authority field", () => {
  const hint = buildWorkspaceIdMappingHint({
    h2aWorkspaceId: h2aId,
    durableWorkspaceId: durableId,
    recordedAt: FIXED_AT
  });
  assert.equal(hint.realpath, undefined);
  assert.ok(isWorkspaceIdMappingHint(hint));
  assert.deepEqual(Object.keys(hint).sort(), [
    "durableWorkspaceId",
    "format",
    "h2aWorkspaceId",
    "recordedAt"
  ]);
});

test("builder refuses malformed ids and timestamps", () => {
  assert.throws(() =>
    buildWorkspaceIdMappingHint({
      h2aWorkspaceId: "ws:not-a-uuid",
      durableWorkspaceId: durableId,
      recordedAt: FIXED_AT
    })
  );
  assert.throws(() =>
    buildWorkspaceIdMappingHint({
      h2aWorkspaceId: h2aId,
      durableWorkspaceId: "ws:short",
      recordedAt: FIXED_AT
    })
  );
  assert.throws(() =>
    buildWorkspaceIdMappingHint({
      h2aWorkspaceId: h2aId,
      durableWorkspaceId: durableId,
      recordedAt: "yesterday"
    })
  );
});

test("guard refuses unknown formats and unknown fields", () => {
  const hint = buildWorkspaceIdMappingHint({
    h2aWorkspaceId: h2aId,
    durableWorkspaceId: durableId,
    recordedAt: FIXED_AT
  });
  assert.equal(isWorkspaceIdMappingHint({ ...hint, format: "h2a.other/v1" }), false);
  assert.equal(isWorkspaceIdMappingHint({ ...hint, extra: true }), false);
  assert.equal(isWorkspaceIdMappingHint({ ...hint, h2aWorkspaceId: "" }), false);
  assert.equal(isWorkspaceIdMappingHint(null), false);
  assert.equal(isWorkspaceIdMappingHint("ws:x"), false);
});
