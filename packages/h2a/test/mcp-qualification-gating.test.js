// LOT-2A: qualification mechanism validation (no surface change).
//
// The release gate is already fail-closed: an empty manifest admits nothing,
// and anything that is not a measured, fully evidenced client routes to
// stdio. This file pins that mechanism exhaustively so LOT-2B (real-Claude
// evidence) can extend the manifest without re-proving the gate:
//   - a forged candidate matching the running runtime is admitted;
//   - every single-field deviation refuses (admit/omit asymmetry per field);
//   - unknown clients, invalid protocols and malformed requests refuse;
//   - no flag/env combination routes an unqualified request to central,
//     through shouldUseCentralMcp AND through the real binary gate (bin.ts).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { qualifiedClaudeInitialize } = await import("../dist/runtime/mcp-central-qualification.js");
const { shouldUseCentralMcp } = await import("../dist/runtime/mcp-central-policy.js");

const NODE_MAJOR = Number(process.versions.node.split(".")[0]);

function candidateClient(overrides = {}) {
  return {
    name: "test-client",
    version: "1.0.0",
    platform: process.platform,
    nodeMajors: [NODE_MAJOR],
    protocolVersions: ["2025-06-18"],
    initialization: true,
    recovery: true,
    dynamicCatalog: { protocol: true, usage: true },
    usability: true,
    evidence: "test-evidence://local-fixture",
    ...overrides
  };
}

function manifestWith(client) {
  return { schemaVersion: 1, clients: [client] };
}

function initializeRequest(clientInfo, protocolVersion = "2025-06-18") {
  return { jsonrpc: "2.0", method: "initialize", params: { clientInfo, protocolVersion } };
}

const REQUEST = initializeRequest({ name: "test-client", version: "1.0.0" });

// The forged candidate matching this runtime is admitted.
test("LOT-2A: a fully evidenced candidate for this runtime qualifies", () => {
  assert.equal(qualifiedClaudeInitialize(REQUEST, manifestWith(candidateClient())), true);
});

// Admit/omit asymmetry on every field in turn: the same request refused by a
// manifest that differs in exactly one field.
test("LOT-2A: every single-field manifest deviation refuses", () => {
  const deviations = {
    name: candidateClient({ name: "other-client" }),
    version: candidateClient({ version: "9.9.9" }),
    platform: candidateClient({ platform: process.platform === "linux" ? "darwin" : "linux" }),
    nodeMajors: candidateClient({ nodeMajors: [NODE_MAJOR + 100] }),
    protocolVersions: candidateClient({ protocolVersions: ["1999-01-01"] }),
    initialization: candidateClient({ initialization: false }),
    recovery: candidateClient({ recovery: false }),
    usability: candidateClient({ usability: false }),
    "dynamicCatalog.protocol": candidateClient({ dynamicCatalog: { protocol: false, usage: true } }),
    "dynamicCatalog.usage": candidateClient({ dynamicCatalog: { protocol: true, usage: false } }),
    evidence: candidateClient({ evidence: "" })
  };
  for (const [field, client] of Object.entries(deviations)) {
    assert.equal(
      qualifiedClaudeInitialize(REQUEST, manifestWith(client)),
      false,
      `single-field deviation must refuse: ${field}`
    );
  }
  assert.equal(
    qualifiedClaudeInitialize(REQUEST, { schemaVersion: 2, clients: [candidateClient()] }),
    false,
    "single-field deviation must refuse: schemaVersion"
  );
});

// Fail-closed: empty/missing manifests, unknown clients, invalid protocols,
// malformed requests.
test("LOT-2A: unknown clients, invalid protocols and malformed requests refuse", () => {
  const good = manifestWith(candidateClient());
  assert.equal(qualifiedClaudeInitialize(REQUEST, { schemaVersion: 1, clients: [] }), false, "empty manifest");
  assert.equal(qualifiedClaudeInitialize(REQUEST), false, "shipped manifest admits nothing yet");
  assert.equal(
    qualifiedClaudeInitialize(initializeRequest({ name: "claude-unknown", version: "999.0.0" }), good),
    false,
    "unknown client"
  );
  assert.equal(
    qualifiedClaudeInitialize(initializeRequest({ name: "test-client", version: "1.0.0" }, "bogus-protocol"), good),
    false,
    "invalid protocol version"
  );
  assert.equal(
    qualifiedClaudeInitialize({ jsonrpc: "2.0", method: "initialize",
      params: { clientInfo: { name: "test-client", version: "1.0.0" } } }, good),
    false,
    "missing protocol version"
  );
  for (const bad of [undefined, null, 42, "initialize", [], { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", method: "initialize", params: {} },
    { jsonrpc: "2.0", method: "initialize", params: { clientInfo: { name: "test-client" } } }]) {
    assert.equal(qualifiedClaudeInitialize(bad, good), false, `malformed refuses: ${JSON.stringify(bad)}`);
  }
});

// No bypass through the routing policy: an unqualified request never selects
// central, under every flag/env combination that could plausibly route it.
test("LOT-2A: no flag/env combination routes an unqualified request to central", () => {
  const unqualified = initializeRequest({ name: "unqualified-client", version: "0.0.0" }, "2025-06-18");
  const baseFlags = { host: "claude" };
  const baseEnv = { CLAUDE_CODE_SESSION_ID: "test-session" };
  const flagVariants = [
    baseFlags,
    { host: "claude", instance: "claude:explicit" },
    { host: "codex" },
    { host: "claude", backend: "cluster-mesh" },
    { host: "claude", root: "/tmp/abs-root" }
  ];
  const envVariants = [
    baseEnv,
    { ...baseEnv, H2A_MCP_CENTRAL: "1" },
    { ...baseEnv, H2A_MCP_CENTRAL: "true" },
    { ...baseEnv, H2A_MCP_CENTRAL: "0" },
    { ...baseEnv, H2A_MCP_CENTRAL: "false" },
    { ...baseEnv, H2A_MCP_READY_FILE: "/tmp/ready.json" },
    { ...baseEnv, H2A_MCP_READY_NONCE: "nonce" },
    { ...baseEnv, H2A_MESSAGE_BACKEND: "cluster-mesh" },
    {}
  ];
  for (const flags of flagVariants) {
    for (const env of envVariants) {
      for (const defaultEnabled of [true, false]) {
        assert.equal(
          shouldUseCentralMcp({ ...flags }, { ...env }, defaultEnabled, unqualified),
          false,
          `must stay on stdio: flags=${JSON.stringify(flags)} env=${JSON.stringify(env)} default=${defaultEnabled}`
        );
      }
    }
  }
});

// No bypass through the real binary gate: an unqualified Claude-attachment
// initialize is met with the version notice and served over stdio.
test("LOT-2A: the real binary keeps unqualified Claude attachments on stdio", { timeout: 60000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "h2a-qual-"));
  const home = join(root, "home");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(home, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [
    join(import.meta.dirname, "..", "dist", "bin.js"), "mcp-serve", "--host", "claude", "--root", root
  ], {
    env: {
      ...process.env,
      CLAUDE_CODE_SESSION_ID: "test-session-unqualified",
      H2A_MCP_CENTRAL: "1",
      H2A_ROOT: root,
      HOME: home,
      XDG_RUNTIME_DIR: join(root, "run"),
      XDG_CONFIG_HOME: join(root, "config")
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  t.after(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already exited.
    }
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const request = { jsonrpc: "2.0", id: 7, method: "initialize",
    params: { clientInfo: { name: "unqualified-client", version: "0.0.0" }, protocolVersion: "2025-06-18" } };
  child.stdin.write(JSON.stringify(request) + "\n");
  const deadline = Date.now() + 30000;
  let answered = null;
  while (!answered && Date.now() < deadline) {
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (message.id === 7) {
          answered = message;
          break;
        }
      } catch {
        // Non-JSON progress lines are ignored.
      }
    }
    if (!answered) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.match(stderr, /claude_version_unqualified; using stdio/, `binary gate names the refusal (stderr: ${stderr.slice(-500)})`);
  assert.ok(answered, `unqualified attachment is still served over stdio (stdout: ${stdout.slice(-500)} stderr: ${stderr.slice(-500)})`);
  assert.equal(answered.result.serverInfo.name, "@sentropic/h2a");
});
