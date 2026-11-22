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
