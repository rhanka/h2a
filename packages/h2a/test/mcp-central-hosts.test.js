// H1 admission adapters: every supported native CLI (claude, codex, agy,
// Muse, vibe) routes through its own qualified adapter with a per-attachment
// context. The shipped production manifest stays empty; H6 populates it from
// measured native-client evidence. These tests use fixture manifests only.
import assert from "node:assert/strict";
import test from "node:test";
import {
  claudeQualificationManifest,
  qualifiedClaudeInitialize,
  qualifiedHostInitialize
} from "../dist/runtime/mcp-central-qualification.js";
import { shouldUseCentralMcp } from "../dist/runtime/mcp-central-policy.js";
import {
  captureCentralAttachment,
  parseCentralAttachment
} from "../dist/runtime/mcp-central-context.js";

const NODE_MAJOR = Number(process.versions.node.split(".")[0]);
const HOSTS = ["claude", "codex", "agy", "Muse", "vibe"];

function entry(host, name, version) {
  return {
    host,
    name,
    version,
    platform: process.platform,
    nodeMajors: [NODE_MAJOR],
    protocolVersions: ["2025-06-18"],
    initialization: true,
    recovery: true,
    dynamicCatalog: { protocol: true, usage: true },
    usability: true,
    evidence: "h1-fixture-only"
  };
}

function manifest(...clients) {
  return { schemaVersion: 1, clients };
}

function initRequest(name, version) {
  return {
    jsonrpc: "2.0",
    method: "initialize",
    params: { clientInfo: { name, version }, protocolVersion: "2025-06-18" }
  };
}

function sessionEnv(host, id) {
  return host === "claude" ? { CLAUDE_CODE_SESSION_ID: id } : {};
}

// The shipped production manifest admits nothing, on every host.
test("H1: shipped manifest stays empty for all native CLIs", () => {
  assert.deepEqual(claudeQualificationManifest.clients, []);
  for (const host of HOSTS) {
    assert.equal(
      qualifiedHostInitialize(host, initRequest(`${host}-client`, "0.0.0")),
      false,
      `${host} must stay on stdio without measured H6 evidence`
    );
  }
});

// Each host qualifies against its own manifest entry, never another host's.
test("H1: per-host adapters qualify their own fixture entries only", () => {
  for (const host of HOSTS) {
    const good = manifest(entry(host, `${host}-client`, "1.0.0"));
    assert.equal(
      qualifiedHostInitialize(host, initRequest(`${host}-client`, "1.0.0"), good),
      true,
      `${host} fixture entry must qualify`
    );
    const other = HOSTS.find((name) => name !== host);
    assert.equal(
      qualifiedHostInitialize(host, initRequest(`${other}-client`, "1.0.0"), manifest(entry(other, `${other}-client`, "1.0.0"))),
      false,
      `${host} must refuse another host's entry`
    );
  }
});

// Entries without a host field keep their historical Claude meaning, so the
// existing LOT-2A gate and fixture manifests are unchanged.
test("H1: host-less entries still mean Claude", () => {
  const { host, ...legacy } = entry("claude", "legacy-client", "1.0.0");
  assert.equal(qualifiedClaudeInitialize(initRequest("legacy-client", "1.0.0"), manifest(legacy)), true);
  assert.equal(qualifiedHostInitialize("claude", initRequest("legacy-client", "1.0.0"), manifest(legacy)), true);
  assert.equal(qualifiedHostInitialize("codex", initRequest("legacy-client", "1.0.0"), manifest(legacy)), false);
});

// Routing selects central per host under a fixture manifest, and stays on
// stdio without qualification. Mesh-backend and sidecar exclusions hold.
test("H1: routing admits each qualified host and refuses the rest", () => {
  for (const host of HOSTS) {
    const good = manifest(entry(host, `${host}-client`, "1.0.0"));
    const request = initRequest(`${host}-client`, "1.0.0");
    const baseEnv = { ...sessionEnv(host, `session-${host}`), H2A_MCP_CENTRAL: "1", H2A_ROOT: "/abs/root" };
    const flags = { host, root: "/abs/root" };
    assert.equal(shouldUseCentralMcp(flags, baseEnv, true, request, good), true, `${host} must route central`);
    assert.equal(shouldUseCentralMcp(flags, baseEnv, true, request), false, `${host} must refuse without a manifest entry`);
    assert.equal(
      shouldUseCentralMcp({ ...flags, backend: "cluster-mesh" }, baseEnv, true, request, good),
      false,
      `${host} mesh backend stays excluded (H1m owns it)`
    );
    assert.equal(
      shouldUseCentralMcp(flags, { ...baseEnv, H2A_MCP_READY_NONCE: "nonce" }, true, request, good),
      false,
      `${host} sidecar challenge stays on stdio`
    );
  }
  assert.equal(
    shouldUseCentralMcp({ host: "hermes" }, { H2A_MCP_CENTRAL: "1" }, true,
      initRequest("hermes-client", "1.0.0"), manifest(entry("hermes", "hermes-client", "1.0.0"))),
    false,
    "hosts outside the five native CLIs are not admitted"
  );
});

// Per-attachment contexts round-trip per host with isolated identities.
test("H1: attachment contexts round-trip per host with isolated sessions", () => {
  for (const host of HOSTS) {
    const flags = { host, "auto-open": "true" };
    const env = { ...sessionEnv(host, `session-${host}`), TMUX_PANE: `%${host}` };
    const context = captureCentralAttachment("/abs/root", `/repo/${host}`, flags, env);
    assert.equal(context.host, host);
    assert.equal(context.workspace, `/repo/${host}`);
    const parsed = parseCentralAttachment(Buffer.from(JSON.stringify(context), "utf8").toString("base64url"), "/abs/root");
    assert.equal(parsed.host, host);
    assert.equal(parsed.workspace, `/repo/${host}`);
    assert.equal(parsed.flags.host, host);
  }
});

// Claude keeps its native conversation binding; other hosts bind their
// routed host tag until H6 measures real native session signals.
test("H1: Claude requires its native session id, foreign flags are refused", () => {
  const claudeFlags = { host: "claude" };
  const context = captureCentralAttachment("/abs/root", "/repo/claude", claudeFlags, { CLAUDE_CODE_SESSION_ID: "s1" });
  assert.throws(
    () => parseCentralAttachment(Buffer.from(JSON.stringify({ ...context, host: "codex" }), "utf8").toString("base64url"), "/abs/root"),
    /central attachment host|unsupported central attachment/
  );
  const noSession = captureCentralAttachment("/abs/root", "/repo/claude", claudeFlags, {});
  assert.throws(
    () => parseCentralAttachment(Buffer.from(JSON.stringify(noSession), "utf8").toString("base64url"), "/abs/root"),
    /native conversation id/
  );
});
