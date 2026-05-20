import assert from "node:assert/strict";
import test from "node:test";

import {
  H2A_MULTI_HUMAN_MODE_IDS,
  H2A_MULTI_HUMAN_MODES,
  getMultiHumanMode,
  selectMultiHumanMode
} from "../dist/index.js";

test("H2A_MULTI_HUMAN_MODES exposes the V1 multi-human framing taxonomy", () => {
  assert.deepEqual([...H2A_MULTI_HUMAN_MODE_IDS], [
    "PEER_DIALOGUE",
    "DELEGATED_COORDINATION",
    "SHARED_ENGAGEMENT",
    "FEDERATED_EXECUTIF",
    "CONSORTIUM_QUORUM",
    "PUBLIC_AUTHORITY"
  ]);

  assert.equal(H2A_MULTI_HUMAN_MODES.PEER_DIALOGUE.primaryChannel, "principal-principal");
  assert.equal(
    H2A_MULTI_HUMAN_MODES.DELEGATED_COORDINATION.primaryChannel,
    "conductor-conductor"
  );
  assert.equal(
    H2A_MULTI_HUMAN_MODES.SHARED_ENGAGEMENT.primaryChannel,
    "shared-engagement"
  );
  assert.equal(
    H2A_MULTI_HUMAN_MODES.FEDERATED_EXECUTIF.primaryAuthorityKind,
    "EXECUTIF"
  );
});

test("getMultiHumanMode returns only known multi-human modes", () => {
  assert.equal(getMultiHumanMode("PEER_DIALOGUE").id, "PEER_DIALOGUE");
  assert.equal(getMultiHumanMode("PUBLIC_AUTHORITY").id, "PUBLIC_AUTHORITY");
  assert.equal(getMultiHumanMode("LOCAL_ONLY"), undefined);
});

test("selectMultiHumanMode keeps informal dialogue at PRINCIPAL to PRINCIPAL", () => {
  assert.deepEqual(selectMultiHumanMode({ principalCount: 2 }), {
    ok: true,
    modeId: "PEER_DIALOGUE",
    primaryChannel: "principal-principal",
    primaryAuthorityKind: "PRINCIPAL",
    issues: []
  });
});

test("selectMultiHumanMode escalates repeated operational work to conductor coordination", () => {
  assert.equal(
    selectMultiHumanMode({
      principalCount: 3,
      repeatedOperationalCoordination: true
    }).modeId,
    "DELEGATED_COORDINATION"
  );
});

test("selectMultiHumanMode promotes obligations or deliverables to shared engagement", () => {
  const result = selectMultiHumanMode({
    principalCount: 2,
    sharedCommitments: true
  });

  assert.equal(result.modeId, "SHARED_ENGAGEMENT");
  assert.equal(result.primaryChannel, "shared-engagement");
});

test("selectMultiHumanMode prefers structured authority over lower-ceremony modes", () => {
  assert.equal(
    selectMultiHumanMode({
      principalCount: 4,
      sharedCommitments: true,
      executiveScope: true
    }).modeId,
    "FEDERATED_EXECUTIF"
  );
  assert.equal(
    selectMultiHumanMode({
      principalCount: 4,
      sharedCommitments: true,
      quorumGovernance: true
    }).modeId,
    "CONSORTIUM_QUORUM"
  );
  assert.equal(
    selectMultiHumanMode({
      principalCount: 2,
      sharedCommitments: true,
      externalAuthority: true
    }).modeId,
    "PUBLIC_AUTHORITY"
  );
});

test("selectMultiHumanMode rejects non multi-human inputs", () => {
  assert.deepEqual(selectMultiHumanMode({ principalCount: 1 }), {
    ok: false,
    issues: ["multi-human mode requires at least 2 PRINCIPAL scopes"]
  });
});
