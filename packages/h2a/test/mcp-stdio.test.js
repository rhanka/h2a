import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  mkdirSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { waitForIdentity } from "./helpers/identity-readiness.js";

import {
  currentCliVersion,
  H2A_CLI_MCP_TOOL_NAMES,
  runMcpServe,
  runMcpStdio
} from "../dist/index.js";

import { publishState } from "../dist/runtime/handover/state.js";
import { prefixLayout } from "../dist/runtime/handover/authority.js";
import { createManifest } from "../src/runtime/handover/image.js";
import { digest } from "../src/runtime/handover/wire.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "h2a-mcp-stdio-"));
}

function registration(overrides = {}) {
  return {
    id: "conductor:01",
    instance: "conductor:01",
    roles: ["CONDUCTOR"],
    scopes: ["scope:principal/antoine"],
    capabilities: ["negotiate"],
    endpoints: [{ kind: "local-files", uri: "file:///tmp/h2a" }],
    publicKeys: [],
    acceptedPolicies: [],
    createdAt: "2026-05-18T00:00:00.000Z",
    ...overrides
  };
}

test("runMcpStdio: structured readiness ACK is correlated and emitted after auto-open", async () => {
  const root = freshRoot();
  const readyFile = join(root, "ready.json");
  const nonce = "11111111-1111-4111-8111-111111111111";
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  try {
    const done = runMcpStdio({
      root,
      stdin,
      stdout,
      stderr,
      autoOpen: { instance: "claude:ready", host: "claude" },
      readiness: { file: readyFile, nonce }
    });

    const ack = JSON.parse(readFileSync(readyFile, "utf8"));
    assert.equal(ack.kind, "h2a.mcp.ready");
    assert.equal(ack.version, 1);
    assert.equal(ack.nonce, nonce);
    assert.match(ack.sessionId, /^sess:/);
    assert.ok(Number.isInteger(ack.pid) && ack.pid > 0);
    assert.equal(existsSync(readyFile), true);
    assert.doesNotThrow(() => readFileSync(readyFile, "utf8"));
    if (process.platform !== "win32") {
      assert.equal(statSync(readyFile).mode & 0o777, 0o600);
    }

    stdin.end();
    await done;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: structured auto-open failure emits no ACK and fails closed", () => {
  const root = freshRoot();
  const readyFile = join(root, "ready.json");
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  try {
    assert.throws(
      () =>
        runMcpStdio({
          root,
          stdin,
          stdout,
          stderr,
          autoOpen: { instance: "" },
          readiness: {
            file: readyFile,
            nonce: "22222222-2222-4222-8222-222222222222"
          }
        }),
      /structured auto-open failed/i
    );
    assert.equal(existsSync(readyFile), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: legacy auto-open remains best-effort without readiness", async () => {
  const root = freshRoot();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let diagnostics = "";
  stderr.on("data", (chunk) => {
    diagnostics += chunk.toString("utf8");
  });
  try {
    const done = runMcpStdio({
      root,
      stdin,
      stdout,
      stderr,
      autoOpen: { instance: "" }
    });
    stdin.end();
    await done;
    assert.match(diagnostics, /auto-open failed/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpServe: internal readiness without auto-open exits nonzero and emits no ACK", async () => {
  const root = freshRoot();
  const readyFile = join(root, "ready.json");
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  try {
    const rc = await runMcpServe(
      { root },
      {
        stdin,
        stdout,
        stderr,
        cwd: () => root,
        env: {
          H2A_MCP_READY_FILE: readyFile,
          H2A_MCP_READY_NONCE:
            "33333333-3333-4333-8333-333333333333"
        }
      }
    );
    assert.equal(rc, 1);
    assert.equal(existsSync(readyFile), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Fixture managed installation for the H4 boot seam: a fake npm prefix the
// bootstrap session can verify, plus a managed root with a prepared image
// for the stub registry's latest. Self-contained (no helper file) to stay
// inside the lot's exact-files index.
function h4Fixture() {
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "h4seam-")));
  const prefix = join(root, "prefix");
  const pkg = join(prefix, "lib", "node_modules", "@sentropic", "h2a");
  mkdirSync(join(pkg, "dist"), { recursive: true, mode: 0o755 });
  mkdirSync(join(prefix, "bin"), { mode: 0o755 });
  const entry = join(pkg, "dist", "bin.js");
  writeFileSync(entry, "#!/usr/bin/env node\nprocess.stdout.write(\"fixture-legacy-entry\");\n", { mode: 0o755 });
  writeFileSync(join(pkg, "package.json"),
    JSON.stringify({ name: "@sentropic/h2a", version: "0.98.6", bin: { h2a: "dist/bin.js" } }), { mode: 0o644 });
  const command = join(prefix, "bin", "h2a");
  symlinkSync("../lib/node_modules/@sentropic/h2a/dist/bin.js", command);
  const layout = prefixLayout(prefix, prefix, process.getuid());
  for (const path of ["state", "state/upgrade", "state/upgrade/transactions", "state/upgrade/private",
    "state/upgrade/receipts", "state/selection-history", "state/pins", "images"]) {
    mkdirSync(join(layout.managedRoot, path), { recursive: true, mode: 0o700 });
  }
  publishState(join(layout.managedRoot, "installation.json"), {
    schemaVersion: 1,
    prefixId: layout.prefixId,
    canonicalPrefix: prefix,
    uid: process.getuid(),
    managedRoot: layout.managedRoot
  }, "installation");
  const managedDir = join(layout.managedRoot, "managed");
  mkdirSync(managedDir, { mode: 0o700 });
  writeFileSync(join(layout.managedRoot, "launcher-source.mjs"), "export const launcher = true;\n");
  writeFileSync(join(layout.managedRoot, "exclusion-evidence.json"), JSON.stringify({
    workersTerminated: { established: true, detail: "no legacy worker alive" },
    relaunchSourcesClosed: { established: true, detail: "autostart entries removed" },
    futureStartsRouted: { established: true, detail: "managed launcher primary" },
    installerReintroductionBarred: { established: true, detail: "installer path unreachable" }
  }));
  // Prepared image for the stub latest below.
  const profile = { platform: "linux", arch: process.arch, libc: "glibc",
    nodeMajor: Number(process.versions.node.split(".")[0]), nodeAbi: process.versions.modules };
  const stage = mkdtempSync(join(root, "stage-"));
  writeFileSync(join(stage, "entry.mjs"), "process.stdout.write(\"seam\\n\");\n");
  writeFileSync(join(stage, "controller.json"),
    JSON.stringify({ schemaVersion: 1, protocolVersion: 1, entrypoint: "entry.mjs" }));
  const manifest = createManifest(stage, {
    packageVersion: "0.98.7",
    buildId: "build-seam",
    profile,
    entrypoints: { controller: "entry.mjs", shim: "entry.mjs" },
    startupWaitBudgetMs: 10000,
    maxAttachments: 64,
    nativeArtifacts: []
  });
  writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest));
  const imageRoot = join(layout.managedRoot, "images", digest(manifest).slice(7));
  renameSync(stage, imageRoot);
  return { root, managedRoot: layout.managedRoot };
}

// Stub npm registry in a SEPARATE process: the H4 pass spawns a real
// `npm view` (spawnSync blocks this event loop), so an in-process server
// could never answer. Hits append to a JSONL log.
const H4_STUB_SOURCE = `
const http = require("node:http");
const fs = require("node:fs");
const [logFile, latest] = process.argv.slice(1);
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    fs.appendFileSync(logFile, JSON.stringify({ method: req.method, url: req.url }) + "\\n");
    const path = req.url.toLowerCase();
    if (path === "/@sentropic%2fh2a" || path === "/@sentropic/h2a") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ name: "@sentropic/h2a", "dist-tags": { latest },
        versions: { [latest]: { name: "@sentropic/h2a", version: latest, dist: { tarball: "http://127.0.0.1/x/y.tgz" } } } }));
    } else {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  });
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write("PORT=" + server.address().port + "\\n");
});
`;

async function h4StubRegistry(t, root, latest) {
  const logFile = join(root, "h4reg-hits.jsonl");
  writeFileSync(logFile, "");
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["--eval", H4_STUB_SOURCE, logFile, latest], {
    stdio: ["ignore", "pipe", "ignore"]
  });
  t.after(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already exited.
    }
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("stub registry did not report a port")), 15000);
    let text = "";
    child.stdout.on("data", (chunk) => {
      text += String(chunk);
      const match = /PORT=(\d+)/.exec(text);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.on("error", reject);
  });
  const readLog = () =>
    readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { url: `http://127.0.0.1:${port}`,
    tarballHits: () => readLog().filter((entry) => /\.tgz(\?|$)/.test(entry.url) || entry.url.includes("/-/")) };
}

test("runMcpServe: auto-upgrade cannot block initialize or reexec the live stdio session", { timeout: 120_000 }, async (t) => {
  const root = freshRoot();
  const readyFile = join(root, "ready.json");
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const events = [];
  const originalExecve = Object.getOwnPropertyDescriptor(process, "execve");
  const originalGuard = process.env.H2A_UPGRADE_REEXECED;
  const savedEnv = {};
  for (const key of ["npm_config_registry", "npm_config_prefix", "npm_config_cache"]) {
    savedEnv[key] = process.env[key];
  }
  let execveCalls = 0;
  let stdoutBuffer = "";
  let diagnostics = "";
  let serving;
  let resolveInitialize;
  const initialized = new Promise((resolve) => {
    resolveInitialize = resolve;
  });
  let resolveIdentityStatus;

  // H4 seam fixture: prepared image build-seam for stub latest 0.98.7.
  const h4 = h4Fixture();
  const h4Registry = await h4StubRegistry(t, root, "0.98.7");
  process.env.npm_config_registry = h4Registry.url;
  process.env.npm_config_prefix = join(h4.root, "npmprefix");
  process.env.npm_config_cache = join(h4.root, "npm-cache");
  const h4Finished = () => {
    try {
      return JSON.parse(readFileSync(join(h4.managedRoot, "state", "selected-build.json"), "utf8")).buildId === "build-seam";
    } catch {
      return false;
    }
  };

  stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      const response = JSON.parse(line);
      if (response.id === 41) {
        events.push(h4Finished() ? "initialize-after-h4" : "initialize-before-h4");
        resolveInitialize(response);
      }
      if (response.id === 42) resolveIdentityStatus(response);
    }
  });
  stderr.on("data", (chunk) => {
    diagnostics += chunk.toString("utf8");
  });

  Object.defineProperty(process, "execve", {
    configurable: true,
    writable: true,
    value: () => {
      execveCalls++;
      return undefined;
    }
  });
  delete process.env.H2A_UPGRADE_REEXECED;

  try {
    serving = runMcpServe(
      {
        root,
        "auto-open": "true",
        "auto-upgrade": "true",
        host: "claude",
        instance: "claude:ready-order"
      },
      {
        stdin,
        stdout,
        stderr,
        cwd: () => root,
        env: {
          H2A_MCP_READY_FILE: readyFile,
          H2A_MCP_READY_NONCE:
            "44444444-4444-4444-8444-444444444444"
        },
        // Since LOT-1 the boot seam enters the single H4 automatic pass
        // (explicit: false) against a fixture managed installation. The
        // legacy staged engine is unreachable here.
        upgradeManagedRoot: h4.managedRoot
      }
    );

    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 41, method: "initialize" })}\n`);
    const response = await initialized;

    assert.equal(response.result.serverInfo.name, "@sentropic/h2a");
    assert.equal(events.includes("initialize-before-h4"), true);
    // L2: initialize must not wait for the H4 pass — checked at the moment
    // it returned. (The readiness ACK is now published only AFTER identity
    // is bound, which happens asynchronously in the identity worker, so it
    // is polled below.)
    assert.equal(h4Finished(), false, "readiness and initialize must not wait for the H4 pass");
    await waitForIdentity(async () => {
      const answered = new Promise((resolve) => { resolveIdentityStatus = resolve; });
      stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: "h2a_identity_status", arguments: {} } })}\n`);
      const statusResponse = await answered;
      assert.equal(statusResponse.error, undefined);
      return JSON.parse(statusResponse.result.content[0].text);
    });
    const ack = JSON.parse(readFileSync(readyFile, "utf8"));
    assert.equal(ack.nonce, "44444444-4444-4444-8444-444444444444");

    // The scheduled H4 pass must not be dropped merely to make startup fast:
    // poll the fixture journal for the completed selection.
    const deadline = Date.now() + 60000;
    while (!h4Finished() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(h4Finished(), true, "the H4 automatic pass must converge while serving");
    events.push("h4-selected");
    assert.deepEqual(events, [
      "initialize-before-h4",
      "h4-selected"
    ]);
    assert.match(diagnostics, /auto-selected h2a .* \(applies on next launch\)/);
    assert.equal(h4Registry.tarballHits().length, 0, "the H4 pass fetches no tarball");
    assert.equal(execveCalls, 0, "mcp-serve must never execve while stdio is live");

    stdin.end();
    assert.equal(await serving, 0);
  } finally {
    stdin.end();
    if (serving) await serving;
    if (originalExecve) {
      Object.defineProperty(process, "execve", originalExecve);
    } else {
      delete process.execve;
    }
    if (originalGuard === undefined) {
      delete process.env.H2A_UPGRADE_REEXECED;
    } else {
      process.env.H2A_UPGRADE_REEXECED = originalGuard;
    }
    for (const key of ["npm_config_registry", "npm_config_prefix", "npm_config_cache"]) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    rmSync(h4.root, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Drive runMcpStdio with a scripted sequence of newline-delimited JSON-RPC
 * messages. Resolves with the array of parsed JSON-RPC responses.
 */
async function runScenario(root, lines) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  let buffered = "";
  stdout.on("data", (chunk) => {
    buffered += chunk.toString("utf8");
  });

  const done = runMcpStdio({ root, stdin, stdout, stderr });

  for (const line of lines) {
    stdin.write(`${line}\n`);
  }
  stdin.end();

  await done;

  return buffered
    .split("\n")
    .filter((s) => s.length > 0)
    .map((s) => JSON.parse(s));
}

test("runMcpStdio: initialize returns the expected serverInfo", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })
    ]);
    assert.equal(responses.length, 1);
    const [res] = responses;
    assert.equal(res.jsonrpc, "2.0");
    assert.equal(res.id, 1);
    assert.equal(res.result.protocolVersion, "2025-06-18");
    assert.equal(res.result.serverInfo.name, "@sentropic/h2a");
    // L0: the MCP serverInfo.version is the REAL package version (via
    // currentCliVersion), no longer a frozen "0.1.1" that drifted from the
    // plugin manifest and `h2a --version` (#275 diagnosis).
    assert.equal(res.result.serverInfo.version, currentCliVersion());
    assert.deepEqual(res.result.capabilities, { tools: {} });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: a notification (no id) draws NO response — never id:null (DEC-115)", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      // notification (no id): the standard post-init signal — MUST get no reply
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      // an unknown notification (no id): still no reply, not a -32601 error
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/something-unknown" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    ]);
    // exactly the two REQUESTS get responses; the two notifications get none
    assert.equal(responses.length, 2);
    assert.deepEqual(
      responses.map((r) => r.id).sort((a, b) => a - b),
      [1, 2]
    );
    // crucially: no id:null line (that is what broke codex's rmcp at startup)
    assert.equal(
      responses.some((r) => r.id === null),
      false
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: tools/list returns all canonical tool names (DEC-051 added 3)", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    ]);
    assert.equal(responses.length, 1);
    const [res] = responses;
    assert.equal(res.id, 2);
    assert.ok(Array.isArray(res.result.tools));
    assert.equal(res.result.tools.length, H2A_CLI_MCP_TOOL_NAMES.length);
    const names = res.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [...H2A_CLI_MCP_TOOL_NAMES].sort());
    for (const tool of res.result.tools) {
      assert.equal(typeof tool.name, "string");
      assert.equal(typeof tool.description, "string");
      assert.equal(tool.inputSchema?.type, "object");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: tools/call h2a_register_instance round-trips via the store", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "h2a_register_instance",
          arguments: { registration: registration() }
        }
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "h2a_discover_instances", arguments: {} }
      })
    ]);
    assert.equal(responses.length, 2);

    const [regRes, discoverRes] = responses;
    assert.equal(regRes.id, 3);
    assert.equal(regRes.result.isError, false);
    assert.equal(regRes.result.content[0].type, "text");
    const regPayload = JSON.parse(regRes.result.content[0].text);
    assert.equal(regPayload.ok, true);
    assert.equal(regPayload.instance, "conductor:01");

    assert.equal(discoverRes.id, 4);
    assert.equal(discoverRes.result.isError, false);
    const discoverPayload = JSON.parse(discoverRes.result.content[0].text);
    assert.equal(discoverPayload.instances.length, 1);
    assert.equal(discoverPayload.instances[0].id, "conductor:01");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: tools/call duplicate registration returns isError:true content", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "h2a_register_instance",
          arguments: { registration: registration() }
        }
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "h2a_register_instance",
          arguments: { registration: registration() }
        }
      })
    ]);
    assert.equal(responses.length, 2);
    const [, dup] = responses;
    assert.equal(dup.id, 6);
    assert.equal(dup.result.isError, true);
    const payload = JSON.parse(dup.result.content[0].text);
    assert.ok(typeof payload.error === "string");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: tools/call unknown tool returns isError:true", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "h2a_does_not_exist", arguments: {} }
      })
    ]);
    assert.equal(responses.length, 1);
    const [res] = responses;
    assert.equal(res.id, 7);
    assert.equal(res.result.isError, true);
    const payload = JSON.parse(res.result.content[0].text);
    assert.match(payload.error, /unknown tool/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: unknown method returns -32601", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify({ jsonrpc: "2.0", id: 8, method: "no/such/method" })
    ]);
    assert.equal(responses.length, 1);
    const [res] = responses;
    assert.equal(res.id, 8);
    assert.equal(res.error.code, -32601);
    assert.match(res.error.message, /method not found/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: malformed JSON returns -32700 with id:null", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, ["{ not valid json"]);
    assert.equal(responses.length, 1);
    const [res] = responses;
    assert.equal(res.id, null);
    assert.equal(res.error.code, -32700);
    assert.match(res.error.message, /parse error/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runMcpStdio: missing jsonrpc field returns -32600 Invalid Request", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify({ id: 9, method: "initialize" })
    ]);
    assert.equal(responses.length, 1);
    const [res] = responses;
    assert.equal(res.error.code, -32600);
    assert.match(res.error.message, /invalid request/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("L1: tools/list advertises h2a_read_payload and discover returns a bounded page shape", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "h2a_discover_instances", arguments: {} } })
    ]);
    const list = responses.find((r) => r.id === 2);
    const names = list.result.tools.map((t) => t.name);
    assert.ok(names.includes("h2a_read_payload"), "h2a_read_payload is advertised");
    const discoverDesc = list.result.tools.find((t) => t.name === "h2a_discover_instances");
    assert.equal(discoverDesc.inputSchema.properties.limit.default, 200, "discover default limit is 200");
    assert.equal(discoverDesc.inputSchema.additionalProperties, false);

    const disc = responses.find((r) => r.id === 3);
    assert.notEqual(disc.result.isError, true);
    const page = JSON.parse(disc.result.content[0].text);
    assert.equal(page.total, 0);
    assert.equal(page.hasMore, false);
    assert.equal(page.nextCursor, null);
    assert.equal(page.returned, 0);
    assert.deepEqual(page.instances, []);
    assert.equal(typeof page.generation, "string");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("L1: a request id that is a huge string is refused with -32600 id:null before execution", async () => {
  const root = freshRoot();
  try {
    const responses = await runScenario(root, [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      JSON.stringify({ jsonrpc: "2.0", id: "z".repeat(4096), method: "tools/list" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    ]);
    const nullErr = responses.find((r) => r.id === null && r.error && r.error.code === -32600);
    assert.ok(nullErr, "the oversize id is refused with id:null");
    const ok = responses.find((r) => r.id === 2);
    assert.ok(Array.isArray(ok.result.tools), "the connection survives and still serves requests");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
