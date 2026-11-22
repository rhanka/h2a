import assert from "node:assert/strict";
import test from "node:test";

import * as remote from "../dist/runtime/remote-agent/index.js";
import * as peerHelpers from "./helpers/remote-trunk-peer.js";

function basePresence(overrides = {}) {
  return {
    sessionId: "pres-r11-1",
    instance: "claude:sentropic-harness:abcdef123456",
    host: "claude",
    name: "valid-name",
    startedAt: "2026-11-21T10:00:00.000Z",
    heartbeatAt: "2026-11-21T10:00:10.000Z",
    state: "live",
    interests: { scopes: [], negotiations: [] },
    subscribedTopics: [],
    workStatus: "working",
    launchContext: {
      cwd: "/secret/workspace",
      command: "claude --dangerously-skip-permissions",
      nativePty: { session: "h2a-r11-test" }
    },
    workspace: {
      id: "ws-1",
      host: "claude",
      label: "valid-ws",
      path: "/secret/workspace"
    },
    ...overrides
  };
}

function projectFromPresence(presenceOverrides = {}) {
  return remote.projectJoinedCatalogueRow({
    sessionId: remote.nativeCatalogueSid("h2a-r11-test"),
    hostKind: "native",
    operable: true,
    excluded: false,
    state: "live",
    presence: basePresence(presenceOverrides),
    presenceFresh: true
  });
}

test("R11 inc-3 label bounds: under bound (64 ASCII, 32 quotes)", () => {
  assert.equal(typeof remote.boundCatalogueLabel, "function");
  assert.equal(typeof remote.jcsEscapedLength, "function");
  const ascii64 = "a".repeat(64);
  assert.equal(remote.boundCatalogueLabel(ascii64), ascii64);
  const quotes32 = '"'.repeat(32);
  assert.equal(Buffer.byteLength(quotes32, "utf8"), 32);
  assert.equal(remote.jcsEscapedLength(quotes32), 64);
  assert.equal(remote.boundCatalogueLabel(quotes32), quotes32);
});

test("R11 inc-3 label bounds: UTF-8 overflow (65 ASCII -> 61 + ellipsis)", () => {
  const row = projectFromPresence({ name: "a".repeat(65) });
  assert.equal(row.name, "a".repeat(61) + "…");
  assert.equal(Buffer.byteLength(row.name, "utf8"), 64);
  assert.equal(typeof remote.boundCatalogueLabel, "function");
  assert.equal(remote.boundCatalogueLabel("a".repeat(65)), "a".repeat(61) + "…");
});

test("R11 inc-3 label bounds: JCS-escaped overflow (33 quotes -> 30 + ellipsis)", () => {
  assert.equal(typeof remote.boundCatalogueLabel, "function");
  assert.equal(typeof remote.jcsEscapedLength, "function");
  const quotes33 = '"'.repeat(33);
  const bounded = remote.boundCatalogueLabel(quotes33);
  assert.equal(bounded, '"'.repeat(30) + "…");
  assert.equal(remote.jcsEscapedLength(bounded), 63);
});

test("R11 inc-3 label bounds: whole Unicode scalar boundary (20 emoji -> 15 + ellipsis)", () => {
  assert.equal(typeof remote.boundCatalogueLabel, "function");
  const emojis20 = "😀".repeat(20);
  const bounded = remote.boundCatalogueLabel(emojis20);
  assert.equal(bounded, "😀".repeat(15) + "…");
  assert.equal(bounded.isWellFormed(), true);
  assert.equal(bounded.includes("\uFFFD"), false);
  assert.equal(Buffer.byteLength(bounded, "utf8"), 63);
});

test("R11 inc-3 label stripping: C0/DEL/lone-surrogate removed, C1 preserved and counted 2B", () => {
  const rowTab = projectFromPresence({ name: "a\tb\u007fc" });
  assert.equal(rowTab.name, "abc");
  assert.equal(typeof remote.stripCatalogueLabel, "function");
  assert.equal(typeof remote.jcsEscapedLength, "function");
  assert.equal(remote.stripCatalogueLabel("a\tb\u007fc"), "abc");
  assert.equal(remote.stripCatalogueLabel("a\uD800b"), "ab");
  assert.equal(remote.boundCatalogueLabel("\t\n\u007f"), undefined);
  assert.equal(remote.stripCatalogueLabel("a\u0085b"), "a\u0085b");
  const rowC1 = projectFromPresence({ name: "a\u0085b" });
  assert.equal(rowC1.name, "a\u0085b");
  assert.equal(Buffer.byteLength("\u0085", "utf8"), 2);
  assert.equal(remote.jcsEscapedLength("\u0085"), 2);
});

test("R11 inc-3 leak after stripping: local command/URI/abs path omitted even with C0", () => {
  const rowCmd = projectFromPresence({ name: "claude\t --dangerously-skip-permissions" });
  assert.equal(rowCmd.name, undefined);
  const rowUri = projectFromPresence({ name: "file:\x00//etc/passwd" });
  assert.equal(rowUri.name, undefined);
  const rowAbs = projectFromPresence({ workspace: { id: "w", host: "claude", label: "\x07/Users/alice/repo" } });
  assert.equal(rowAbs.workspaceLabel, undefined);
});

test("R11 inc-3 sibling fields: host regex, closed workStatus, strict 24B ISO timestamps", () => {
  const rowBadHost = projectFromPresence({ host: "BadHost!" });
  assert.equal(rowBadHost.host, undefined);
  const rowLongHost = projectFromPresence({ host: "a".repeat(17) });
  assert.equal(rowLongHost.host, undefined);
  const rowOkHost = projectFromPresence({ host: "my-cli_1.2" });
  assert.equal(rowOkHost.host, "my-cli_1.2");

  const rowBadWs = projectFromPresence({ workStatus: "custom-invalid-status" });
  assert.equal(rowBadWs.workStatus, "unknown");
  const rowOkWs = projectFromPresence({ workStatus: "out-of-tokens" });
  assert.equal(rowOkWs.workStatus, "out-of-tokens");

  const rowNormalizedIso = projectFromPresence({
    startedAt: "2026-11-21T10:00:00+00:00",
    heartbeatAt: "2026-11-21T10:00:10+00:00"
  });
  assert.match(rowNormalizedIso.startedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(Buffer.byteLength(rowNormalizedIso.startedAt, "utf8"), 24);

  const rowUnreadableTs = projectFromPresence({ startedAt: "not-a-timestamp" });
  assert.equal(rowUnreadableTs.startedAt, undefined);

  const rowHugeYear = projectFromPresence({ startedAt: "+010000-01-01T00:00:00.000Z" });
  assert.equal(rowHugeYear.startedAt, undefined);
});

test("R11 inc-3 provisional wire row fits within 480 JCS bytes with max fields", () => {
  assert.equal(typeof peerHelpers.provisionalWireRow, "function");
  const maxRow = {
    sessionId: "n-" + "a".repeat(32),
    instanceId: "i-" + "b".repeat(32),
    instanceStatus: "revoked",
    host: "a".repeat(16),
    name: "n".repeat(64),
    workspaceLabel: "w".repeat(64),
    startedAt: "2026-11-21T10:00:00.000Z",
    heartbeatAt: "2026-11-21T10:00:10.000Z",
    workStatus: "out-of-tokens",
    hostKind: "unknown",
    operable: false,
    excluded: true,
    state: "live",
    operabilityReason: "not-shared"
  };
  const wireRow = peerHelpers.provisionalWireRow(maxRow);
  const jcsBytes = Buffer.byteLength(remote.canonicalTrunkJson(wireRow), "utf8");
  assert.ok(jcsBytes <= 480, `expected <= 480 bytes, got ${jcsBytes}`);
  assert.equal("state" in wireRow, false);
  assert.equal("operabilityReason" in wireRow, false);
  assert.equal("instance" in wireRow, false);
});

function makeProjRow(index, overrides = {}) {
  const sid = `n-${String(index).padStart(32, "0")}`;
  return {
    sessionId: sid,
    instanceId: `i-${String(index).padStart(32, "0")}`,
    instanceStatus: "live",
    host: "claude",
    name: `sess-${index}`,
    state: "live",
    workStatus: "working",
    hostKind: "native",
    operable: true,
    ...overrides
  };
}

test("R11 inc-4 projection: 0, 1, 16, 17, 512, 513 rows + dedupe + ASCII sid sort", () => {
  assert.equal(typeof remote.projectBoundedCatalogue, "function");
  for (const [count, expectedRows, expectedTrunc] of [
    [0, 0, 0],
    [1, 1, 0],
    [16, 16, 0],
    [17, 17, 0],
    [512, 512, 0],
    [513, 512, 1]
  ]) {
    const input = Array.from({ length: count }, (_, i) => makeProjRow(count - i));
    const proj = remote.projectBoundedCatalogue(input);
    assert.equal(proj.rows.length, expectedRows);
    assert.equal(proj.truncatedRows, expectedTrunc);
    for (let i = 1; i < proj.rows.length; i++) {
      assert.ok(proj.rows[i - 1].sessionId < proj.rows[i].sessionId);
    }
  }
  const dup = remote.projectBoundedCatalogue([
    makeProjRow(1, { name: "first" }),
    makeProjRow(1, { name: "second" }),
    makeProjRow(2, { name: "two" })
  ]);
  assert.equal(dup.rows.length, 2);
  assert.equal(dup.truncatedRows, 0);
});

test("R11 inc-4 planCatalogueUpdate: all 10 transition cases", () => {
  assert.equal(typeof remote.planCatalogueUpdate, "function");

  // 1. Nothing delivered -> snapshot
  const p5 = remote.projectBoundedCatalogue(Array.from({ length: 5 }, (_, i) => makeProjRow(i)));
  assert.deepEqual(remote.planCatalogueUpdate(null, p5), { kind: "snapshot" });

  // 2. 100 rows: 1 added, 1 removed, 1 modified -> delta with sorted removes & upserts
  const rows100 = Array.from({ length: 100 }, (_, i) => makeProjRow((i + 1) * 2));
  const del100 = remote.projectBoundedCatalogue(rows100);
  const next100 = [
    ...rows100.slice(1).map((r) => (r.sessionId === makeProjRow(4).sessionId ? makeProjRow(4, { name: "modified-4" }) : r)),
    makeProjRow(201) // added index 201
  ];
  const lat100 = remote.projectBoundedCatalogue(next100);
  const plan100 = remote.planCatalogueUpdate(del100, lat100);
  assert.equal(plan100.kind, "delta");
  assert.deepEqual(plan100.removes, [makeProjRow(2).sessionId]);
  assert.deepEqual(
    plan100.upserts.map((r) => r.sessionId),
    [makeProjRow(4).sessionId, makeProjRow(201).sessionId]
  );

  // 3. Instance status only modified on 2 rows -> delta of 2 full rows
  const nextStatus = rows100.map((r, idx) =>
    idx < 2 ? { ...r, instanceStatus: "revoked" } : r
  );
  const planStatus = remote.planCatalogueUpdate(del100, remote.projectBoundedCatalogue(nextStatus));
  assert.equal(planStatus.kind, "delta");
  assert.deepEqual(planStatus.removes, []);
  assert.equal(planStatus.upserts.length, 2);
  assert.equal(planStatus.upserts[0].instanceStatus, "revoked");
  assert.equal(planStatus.upserts[0].host, "claude");

  // 4. No change -> none
  assert.deepEqual(
    remote.planCatalogueUpdate(del100, remote.projectBoundedCatalogue([...rows100])),
    { kind: "none" }
  );

  // 5..9: 513/514 boundary cases
  const base513 = Array.from({ length: 513 }, (_, i) => makeProjRow((i + 1) * 10));
  const del513 = remote.projectBoundedCatalogue(base513); // truncatedRows = 1
  assert.equal(del513.truncatedRows, 1);

  // 5. Insert before frontier -> truncatedRows 1 -> 2 -> snapshot
  const insBefore = remote.projectBoundedCatalogue([makeProjRow(5), ...base513]);
  assert.equal(insBefore.truncatedRows, 2);
  assert.deepEqual(remote.planCatalogueUpdate(del513, insBefore), { kind: "snapshot" });

  // 6. Remove a visible row from 513 -> truncatedRows 1 -> 0 -> snapshot
  const remVis513 = remote.projectBoundedCatalogue(base513.slice(1));
  assert.equal(remVis513.truncatedRows, 0);
  assert.deepEqual(remote.planCatalogueUpdate(del513, remVis513), { kind: "snapshot" });

  // 7. Add after the 513th -> truncatedRows 1 -> 2, visible rows identical -> snapshot
  const addOmitted = remote.projectBoundedCatalogue([...base513, makeProjRow(99999)]);
  assert.equal(addOmitted.truncatedRows, 2);
  assert.deepEqual(remote.planCatalogueUpdate(del513, addOmitted), { kind: "snapshot" });

  // 8. 514 rows: remove 1 visible + add 1 omitted -> truncatedRows stays 2, visible sid set changes -> snapshot
  const base514 = [...base513, makeProjRow(90000)];
  const del514 = remote.projectBoundedCatalogue(base514);
  assert.equal(del514.truncatedRows, 2);
  const shifted514 = [...base514.slice(1), makeProjRow(99999)];
  const lat514 = remote.projectBoundedCatalogue(shifted514);
  assert.equal(lat514.truncatedRows, 2);
  assert.deepEqual(remote.planCatalogueUpdate(del514, lat514), { kind: "snapshot" });

  // 9. 513 rows: modify 1 visible row without changing sid set -> delta
  const modVis513 = base513.map((r, i) => (i === 0 ? { ...r, name: "updated-0" } : r));
  const planMod513 = remote.planCatalogueUpdate(del513, remote.projectBoundedCatalogue(modVis513));
  assert.equal(planMod513.kind, "delta");
  assert.equal(planMod513.upserts.length, 1);
  assert.equal(planMod513.removes.length, 0);

  // 10. 17 changes below cap -> delta of 17 entries (no splitting at 16)
  const base50 = Array.from({ length: 50 }, (_, i) => makeProjRow(i));
  const del50 = remote.projectBoundedCatalogue(base50);
  const mod50 = base50.map((r, i) => (i < 17 ? { ...r, name: `chg-${i}` } : r));
  const plan17 = remote.planCatalogueUpdate(del50, remote.projectBoundedCatalogue(mod50));
  assert.equal(plan17.kind, "delta");
  assert.equal(plan17.upserts.length, 17);
});
