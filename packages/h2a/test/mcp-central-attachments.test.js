import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";
import { runCli as runTrackCli } from "@sentropic/track";
import { startCentralMcpServer } from "../dist/runtime/mcp-central.js";
import { bridgeCentralMcpStdio } from "../dist/runtime/mcp-central-client.js";
import { captureCentralAttachment } from "../dist/runtime/mcp-central-context.js";
import { centralOperator, centralResidueReport, centralPausePath } from "../dist/runtime/mcp-central-operator.js";
import { runtimeBase } from "../dist/runtime/mcp-central-discovery.js";
import { identityKeyPaths } from "../dist/runtime/identity/live.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { shouldUseCentralMcp, canonicalCentralRoot } from "../dist/runtime/mcp-central-policy.js";
import { ensureCentralForShim } from "../dist/runtime/mcp-central-start.js";

const bin = resolve("packages/h2a/dist/bin.js");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture() {
  const base = resolve("tmp/mcp-attachment-tests");
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, "case-"));
  for (const name of ["home", "runtime", "config", "repo-a", "repo-b"]) mkdirSync(join(dir, name), { mode: 0o700 });
  const root = join(dir, "state");
  const runtimeBase = join(dir, "runtime");
  const env = { PATH: process.env.PATH, HOME: join(dir, "home"), XDG_RUNTIME_DIR: runtimeBase, REMOTE_CLI_CONFIG_HOME: join(dir, "config"), H2A_ROOT: root, H2A_MCP_CENTRAL: "1", NODE_OPTIONS: "--max-old-space-size=256" };
  return { dir, root, runtimeBase, env, cleanup() { rmSync(dir, { recursive: true, force: true }); } };
}
async function endpoint() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return `http://127.0.0.1:${port}/mcp`;
}
function rpcChannel(input, output) {
  const pending = new Map();
  let nextId = 0;
  const reader = createInterface({ input: output });
  const notifications = [];
  reader.on("line", line => {
    const frame = JSON.parse(line);
    const handler = pending.get(frame.id);
    if (handler) { pending.delete(frame.id); handler(frame); }
    else notifications.push(frame);
  });
  return { notifications, call(method, params, timeout = 12_000) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC ${method} timed out`)); }, timeout);
      pending.set(id, frame => { clearTimeout(timer); resolve(frame); });
      input.write(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }) + "\n");
    });
  }, close() { reader.close(); input.end(); } };
}
function connect(f, url, repo, conversation) {
  const input = new PassThrough();
  const output = new PassThrough();
  const controller = new AbortController();
  const flags = { host: "claude", "auto-open": "true" };
  const channel = rpcChannel(input, output);
  const running = bridgeCentralMcpStdio({ endpoint: url, runtimeBase: f.runtimeBase, stdin: input, stdout: output, signal: controller.signal,
    attachment: captureCentralAttachment(f.root, repo, flags, { CLAUDE_CODE_SESSION_ID: conversation }) });
  return { ...channel, async close() { controller.abort(); channel.close(); await running; output.end(); } };
}
async function ready(channel) {
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    const response = await channel.call("tools/call", { name: "h2a_identity_status", arguments: {} });
    if (!response.error) {
      const status = JSON.parse(response.result.content[0].text);
      if (status.state === "identity_ready") return status;
      if (status.state === "identity_failed") throw new Error(JSON.stringify(status));
    }
    await delay(100);
  }
  throw new Error("identity never became ready");
}
const bindings = root => readFileSync(join(root, "identity", "bindings.jsonl"), "utf8").trim().split("\n").filter(Boolean);

test("missing systemd runtime chooses a fixed UID fallback, with private namespaces for isolation", () => {
  assert.equal(runtimeBase({}, {}, () => false), `/tmp/h2a-mcp-runtime-${process.getuid()}`);
  assert.equal(runtimeBase({}, { XDG_RUNTIME_DIR: "/private/test/runtime" }, () => false), "/private/test/runtime");
});

test("an orphaned HTTP attachment is purged and the central exits idle", { timeout: 5000 }, async () => {
  const f = fixture();
  let server;
  try {
    server = await startCentralMcpServer({ root: f.root, runtimeBase: f.runtimeBase, env: {}, idleTimeoutMs: 100, sessionLeaseMs: 100 });
    const marker = JSON.parse(readFileSync(server.markerPath, "utf8"));
    const response = await fetch(server.endpoint, { method: "POST", headers: { authorization: `Bearer ${marker.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "orphan-fixture", version: "1" } } }) });
    assert.equal(response.status, 200);
    await response.text();
    assert.equal((await centralOperator("status", { runtimeBase: f.runtimeBase })).attachments, 1);
    await Promise.race([server.closed, delay(2500).then(() => { throw new Error("idle shutdown did not happen"); })]);
    assert.equal(existsSync(server.markerPath), false);
  } finally { await server?.stop(); f.cleanup(); }
});

test("two attached repos route Track and h2a_run to their own workspace, sharing only state", { timeout: 30_000 }, async () => {
  const f = fixture();
  let server;
  const channels = [];
  try {
    const url = await endpoint();
    server = await startCentralMcpServer({ root: f.root, runtimeBase: f.runtimeBase, env: { H2A_MCP_CENTRAL_ENDPOINT: url }, runExecutor: request => ({ workspace: request.workspace }) });
    for (const name of ["repo-a", "repo-b"]) {
      const repo = join(f.dir, name);
      const io = { cwd: repo, out() {}, err() {} };
      assert.equal(runTrackCli(["init"], io), 0);
      writeFileSync(join(repo, "BRANCH.md"), `# Feature: ${name} — ${name}\n\n## Plan / Todo (lot-based)\n- [ ] **Lot 1 — ${name} only**\n`);
      assert.equal(runTrackCli(["branch", "import", "BRANCH.md", "--commit", "fixture"], io), 0);
      const channel = connect(f, url, repo, `conversation-${name}`);
      channels.push(channel);
      assert.ok((await channel.call("initialize")).result);
      await ready(channel);
      const track = await channel.call("tools/call", { name: "track_query", arguments: { baselineCommit: "fixture" } });
      assert.match(JSON.stringify(track), new RegExp(`${name} only`));
      assert.doesNotMatch(JSON.stringify(track), new RegExp(`${name === "repo-a" ? "repo-b" : "repo-a"} only`));
      const run = await channel.call("tools/call", { name: "h2a_run", arguments: { profile: "claude", name: `fixture-${name}`, workspace: repo, prompt: "fixture", background: true } });
      assert.equal(JSON.parse(run.result.content[0].text).workspace, repo);
      const wrong = await channel.call("tools/call", { name: "h2a_run", arguments: { profile: "claude", name: "cross-root", workspace: join(f.dir, name === "repo-a" ? "repo-b" : "repo-a"), prompt: "fixture", background: true } });
      assert.match(JSON.stringify(wrong), /startup workspace/);
    }
    assert.equal(bindings(f.root).length, 2);
    assert.equal(existsSync(join(f.dir, "repo-a", ".mcp.json")), false);
    assert.equal(existsSync(join(f.dir, "repo-b", ".h2a-schema.json")), false);
  } finally { await Promise.all(channels.map(channel => channel.close())); await server?.stop(); f.cleanup(); }
});

test("a live shim survives central token rotation with the same identity and no added binding", { timeout: 30_000 }, async () => {
  const f = fixture();
  let first, second, channel;
  try {
    const url = await endpoint();
    first = await startCentralMcpServer({ root: f.root, runtimeBase: f.runtimeBase, env: { H2A_MCP_CENTRAL_ENDPOINT: url } });
    channel = connect(f, url, join(f.dir, "repo-a"), "stable-conversation");
    await channel.call("initialize");
    const before = await ready(channel);
    const count = bindings(f.root).length;
    await first.stop();
    first = undefined;
    second = await startCentralMcpServer({ root: f.root, runtimeBase: f.runtimeBase, env: { H2A_MCP_CENTRAL_ENDPOINT: url } });
    const after = await ready(channel);
    assert.equal(after.instance, before.instance);
    assert.equal(bindings(f.root).length, count);
  } finally { await channel?.close(); await second?.stop(); await first?.stop(); f.cleanup(); }
});

test("resume with a missing signing key fails closed without minting another binding", { timeout: 30_000 }, async () => {
  const f = fixture();
  let first, second, channel;
  try {
    const url = await endpoint();
    first = await startCentralMcpServer({ root: f.root, runtimeBase: f.runtimeBase, env: { H2A_MCP_CENTRAL_ENDPOINT: url } });
    channel = connect(f, url, join(f.dir, "repo-a"), "missing-resume-key");
    await channel.call("initialize");
    const before = await ready(channel);
    await first.stop();
    first = undefined;
    const key = identityKeyPaths(f.root, before.instance).privateKeyPath;
    rmSync(key);
    second = await startCentralMcpServer({ root: f.root, runtimeBase: f.runtimeBase, env: { H2A_MCP_CENTRAL_ENDPOINT: url } });
    await assert.rejects(ready(channel), /identity_failed/);
    assert.equal(bindings(f.root).length, 1);
    assert.equal(existsSync(key), false, "resume must not recreate the missing key");
  } finally { await channel?.close(); await second?.stop(); await first?.stop(); f.cleanup(); }
});

test("a lost mutation reply is outcome_unknown and is never replayed during recovery", { timeout: 10_000 }, async () => {
  const f = fixture();
  let channel;
  let mutationCount = 0;
  const server = createHttpServer(async (request, response) => {
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(": connected\n\n");
      return;
    }
    if (request.method === "DELETE") { response.writeHead(204).end(); return; }
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body);
    if (rpc.params?.name === "fixture_mutation") {
      mutationCount++;
      request.socket.destroy(); // The effect happened before its reply was lost.
      return;
    }
    response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "fixture-session" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { tools: [] } }));
  }).listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}/mcp`;
    const directory = join(f.runtimeBase, "h2a-mcp-central");
    mkdirSync(directory, { mode: 0o700 });
    writeFileSync(join(directory, "marker.json"), JSON.stringify({ endpoint: url, generation: "fixture", pid: process.pid, startedAt: new Date().toISOString(), token: "fixture-secret", root: f.root, protocol: 2 }), { mode: 0o600 });
    channel = connect(f, url, join(f.dir, "repo-a"), "lost-mutation-reply");
    await channel.call("initialize");
    const lost = await channel.call("tools/call", { name: "fixture_mutation", arguments: {} });
    assert.equal(lost.error.data.code, "outcome_unknown");
    assert.equal(lost.error.data.retrySafe, false);
    assert.ok((await channel.call("tools/list")).result);
    assert.equal(mutationCount, 1);
  } finally {
    await channel?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    f.cleanup();
  }
});

test("SIGTERM of the real central leaves host stdio open and resumes the same binding", { timeout: 30_000 }, async () => {
  const f = fixture();
  const children = [];
  let channel;
  let stderr = "";
  try {
    const url = await endpoint();
    const start = async () => {
      const child = spawn(process.execPath, [bin, "mcp-central-serve", "--root", f.root], { env: { ...f.env, H2A_MCP_CENTRAL_ENDPOINT: url }, cwd: f.env.HOME, stdio: ["ignore", "ignore", "pipe"] });
      children.push(child);
      child.stderr.on("data", data => { stderr += data; });
      for (let i = 0; i < 100; i++) {
        const path = join(f.runtimeBase, "h2a-mcp-central", "marker.json");
        if (existsSync(path) && JSON.parse(readFileSync(path, "utf8")).pid === child.pid) return child;
        if (child.exitCode !== null) throw new Error(stderr);
        await delay(50);
      }
      throw new Error(`central did not start: ${stderr}`);
    };
    const first = await start();
    const shim = spawn(process.execPath, [bin, "mcp-central-connect", "--endpoint", url, "--runtime-base", f.runtimeBase, "--root", f.root, "--host", "claude", "--auto-open"], { env: { ...f.env, CLAUDE_CODE_SESSION_ID: "real-stable-conversation" }, cwd: join(f.dir, "repo-a"), stdio: ["pipe", "pipe", "pipe"] });
    children.push(shim);
    shim.stderr.on("data", data => { stderr += data; });
    channel = rpcChannel(shim.stdin, shim.stdout);
    await channel.call("initialize");
    const before = await ready(channel);
    first.kill("SIGTERM");
    await once(first, "exit");
    assert.equal(shim.exitCode, null, "host stdio remains live after central SIGTERM");
    await start();
    const after = await ready(channel);
    assert.equal(after.instance, before.instance);
    assert.equal(bindings(f.root).length, 1);
    const configDir = join(f.env.REMOTE_CLI_CONFIG_HOME, ".config", "sentropic", "h2a");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), '{"h2a":{"central":{"enabled":false}}}\n');
    assert.equal((await ready(channel)).instance, before.instance, "enabled=false leaves a healthy live attachment intact");
    await centralOperator("stop", { runtimeBase: f.runtimeBase });
    await delay(100);
    const unavailable = await channel.call("tools/list");
    assert.equal(unavailable.error.data.code, "central_unavailable");
    assert.equal(shim.exitCode, null, "disabled live shim keeps stdio open without spawning a full runtime");
    assert.equal(bindings(f.root).length, 1);
  } finally {
    channel?.close();
    await Promise.all(children.map(async child => { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await once(child, "exit"); } }));
    f.cleanup();
  }
});

test("operator stop is authenticated, leaves shims open, and residue detection never changes files", { timeout: 20_000 }, async () => {
  const f = fixture();
  let server, channel;
  try {
    const url = await endpoint();
    server = await startCentralMcpServer({ root: f.root, runtimeBase: f.runtimeBase, env: { H2A_MCP_CENTRAL_ENDPOINT: url } });
    channel = connect(f, url, join(f.dir, "repo-a"), "operator-conversation");
    await channel.call("initialize");
    await ready(channel);
    const status = await centralOperator("status", { runtimeBase: f.runtimeBase });
    assert.equal(status.attachments, 1);
    const stopped = await centralOperator("stop", { runtimeBase: f.runtimeBase });
    assert.equal(stopped.paused, true);
    await server.closed;
    const unavailable = await channel.call("tools/list");
    assert.equal(unavailable.error.data.code, "central_unavailable");
    const repo = join(f.dir, "repo-a");
    execFileSync("git", ["init", "-q", repo]);
    const config = '{"mcpServers":{"h2a":{"args":["mcp-central-connect"]}}}\n';
    writeFileSync(join(repo, ".mcp.json"), config);
    writeFileSync(join(repo, ".h2a-schema.json"), "{}\n");
    execFileSync("git", ["-C", repo, "add", ".mcp.json"]);
    const before = readdirSync(repo);
    const report = centralResidueReport(repo, join(f.env.HOME, "missing-agy.json"), { codexConfig: join(f.env.HOME, "missing-codex.json") });
    assert.equal(report.reportOnly, true);
    assert.equal(report.findings.length, 2);
    assert.equal(report.findings.find(row => row.kind === "v1-central-config").tracked, true);
    assert.deepEqual(readdirSync(repo), before);
    assert.equal(readFileSync(join(repo, ".mcp.json"), "utf8"), config);
  } finally { await channel?.close(); await server?.stop(); f.cleanup(); }
});

test("mcp-serve defaults Claude to one ephemeral central without project writes; other hosts and opt-outs use stdio", { timeout: 30_000 }, async () => {
  const f = fixture();
  const children = [];
  const channels = [];
  const start = (host, repo, extra = {}) => {
    const env = { ...f.env, CLAUDE_CODE_SESSION_ID: `default-${host}-${children.length}`, ...extra };
    if (env.H2A_MCP_CENTRAL === undefined) delete env.H2A_MCP_CENTRAL;
    const child = spawn(process.execPath, [bin, "mcp-serve", "--host", host, "--auto-open"], { env, cwd: repo, stdio: ["pipe", "pipe", "pipe"] });
    children.push(child);
    child.stderr.on("data", () => {});
    const channel = rpcChannel(child.stdin, child.stdout);
    channels.push(channel);
    return channel;
  };
  try {
    let generation;
    for (const repo of [join(f.dir, "repo-a"), join(f.dir, "repo-b")]) {
      const channel = start("claude", repo, { H2A_MCP_CENTRAL: undefined });
      await channel.call("initialize");
      await ready(channel);
      const marker = JSON.parse(readFileSync(join(f.runtimeBase, "h2a-mcp-central", "marker.json"), "utf8"));
      assert.equal(marker.protocol, 2);
      assert.equal(marker.root, f.root);
      if (generation) assert.equal(marker.generation, generation);
      generation = marker.generation;
      assert.deepEqual(readdirSync(repo), [], "initial attachment writes no project files");
    }
    const status = await centralOperator("status", { runtimeBase: f.runtimeBase });
    assert.equal(status.attachments, 2);
    const stdout = start("claude", join(f.dir, "repo-a"), { H2A_MCP_CENTRAL: "0" });
    await stdout.call("initialize");
    await ready(stdout);
    for (const host of ["codex", "agy"]) {
      const channel = start(host, join(f.dir, "repo-a"));
      await channel.call("initialize");
      await ready(channel);
    }
    const configDir = join(f.env.REMOTE_CLI_CONFIG_HOME, ".config", "sentropic", "h2a");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), '{"h2a":{"central":{"enabled":false}}}\n');
    const disabled = start("claude", join(f.dir, "repo-a"));
    await disabled.call("initialize");
    await ready(disabled);
    assert.equal((await centralOperator("status", { runtimeBase: f.runtimeBase })).attachments, 2, "unqualified hosts/opt-outs never attach to the daemon");
  } finally {
    channels.forEach(channel => channel.close());
    await Promise.all(children.map(async child => { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await once(child, "exit"); } }));
    await centralOperator("stop", { runtimeBase: f.runtimeBase });
    f.cleanup();
  }
});

test("full MCP handshake through the shim consumes 202 without emitting invalid null frames", async () => {
  const f = fixture();
  let server;
  let client;
  let transport;
  try {
    server = await startCentralMcpServer({ root: f.root, runtimeBase: f.runtimeBase, env: {}, idleTimeoutMs: 60_000, sessionLeaseMs: 60_000 });
    const transportErrors = [];
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [bin, "mcp-serve", "--host", "claude", "--runtime-base", f.runtimeBase],
      env: {
        ...f.env,
        CLAUDE_CODE_SESSION_ID: "conv-handshake-real-sdk",
      }
    });
    transport.onerror = error => transportErrors.push(error);
    client = new Client({ name: "real-sdk-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.length > 0);
    assert.deepEqual(transportErrors, [], "real SDK transport must experience zero protocol errors");
  } finally {
    await client?.close();
    await server?.stop();
    f.cleanup();
  }
});

test("a network cutoff during initialize recovers cleanly and returns the handshake result without HTTP 400", async () => {
  const f = fixture();
  let channel;
  let initializeAttempts = 0;
  const initializedSessions = new Set();
  const server = createHttpServer(async (request, response) => {
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(": connected\n\n");
      return;
    }
    if (request.method === "DELETE") { response.writeHead(204).end(); return; }
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body);
    if (rpc.method === "initialize") {
      initializeAttempts++;
      if (initializeAttempts === 1) {
        request.socket.destroy();
        return;
      }
      const existingSession = request.headers["mcp-session-id"];
      if (existingSession && initializedSessions.has(existingSession)) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32600, message: "Server already initialized" } }));
        return;
      }
      const newSession = `session-${initializeAttempts}`;
      initializedSessions.add(newSession);
      response.writeHead(200, { "content-type": "application/json", "mcp-session-id": newSession });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "test-server", version: "1" } } }));
      return;
    }
    if (rpc.method === "notifications/initialized") {
      response.writeHead(202, { "content-type": "application/json" });
      response.end("null");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { tools: [] } }));
  }).listen(0, "127.0.0.1");

  try {
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}/mcp`;
    const directory = join(f.runtimeBase, "h2a-mcp-central");
    mkdirSync(directory, { mode: 0o700 });
    writeFileSync(join(directory, "marker.json"), JSON.stringify({ endpoint: url, generation: "fixture", pid: process.pid, startedAt: new Date().toISOString(), token: "fixture-secret", root: f.root, protocol: 2 }), { mode: 0o600 });
    channel = connect(f, url, join(f.dir, "repo-a"), "cutoff-initialize-test");
    const initResponse = await channel.call("initialize");
    assert.equal(initResponse.error, undefined, "initialize must not return error");
    assert.ok(initResponse.result, "initialize must return valid result");
    assert.equal(initResponse.result.serverInfo.name, "test-server");
  } finally {
    await channel?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    f.cleanup();
  }
});

test("v1 residual configurations without --host route to stdio on missing marker or opt-outs, and can be explicitly repaired", async () => {
  const f = fixture();
  const children = [];
  const startConnect = (args, extraEnv = {}) => {
    const env = { ...f.env, ...extraEnv };
    const child = spawn(process.execPath, [bin, "mcp-central-connect", ...args], { env, cwd: join(f.dir, "repo-a"), stdio: ["pipe", "pipe", "pipe"] });
    children.push(child);
    return rpcChannel(child.stdin, child.stdout);
  };
  try {
    // 1. Missing marker:
    // 1a. No --host and no Claude ID (legacy agy/Codex residual shape) -> falls back to stdio
    const legacyAgy = startConnect(["--endpoint", "http://127.0.0.1:49999/mcp"]);
    const initAgy = await legacyAgy.call("initialize");
    assert.ok(initAgy.result, "v1 connector without --host falls back to stdio when marker is missing");

    // 1b. No --host with CLAUDE_CODE_SESSION_ID present but marker is missing -> must not crash, routes to stdio
    const legacyClaudeMissingMarker = startConnect(
      ["--endpoint", "http://127.0.0.1:49999/mcp", "--runtime-base", f.runtimeBase],
      { CLAUDE_CODE_SESSION_ID: "conv-v1-missing-marker" }
    );
    const initClaudeMissing = await legacyClaudeMissingMarker.call("initialize");
    assert.ok(initClaudeMissing.result, "v1 connector with Claude session falls back to stdio when marker is missing");

    // 1c. Inherited CLAUDE_CODE_SESSION_ID does not qualify legacy connector with explicit non-claude host
    const legacyInheritedCodex = startConnect(
      ["--host", "codex", "--endpoint", "http://127.0.0.1:49999/mcp", "--runtime-base", f.runtimeBase],
      { CLAUDE_CODE_SESSION_ID: "conv-v1-inherited" }
    );
    const initInherited = await legacyInheritedCodex.call("initialize");
    assert.ok(initInherited.result, "inherited Claude session does not route codex connector to central");

    // 2. Opt-out H2A_MCP_CENTRAL=0 and non-claude hosts apply before marker discovery (R14)
    const optedOut = startConnect(["--endpoint", "http://127.0.0.1:49999/mcp"], { H2A_MCP_CENTRAL: "0" });
    const initOptedOut = await optedOut.call("initialize");
    assert.ok(initOptedOut.result, "H2A_MCP_CENTRAL=0 routes v1 connector to stdio");

    // 2b. Invalid/non-private marker (0644 mode or malformed) does not break opt-out or codex/agy (R14)
    const invalidMarkerDir = join(f.runtimeBase, "h2a-mcp-central");
    mkdirSync(invalidMarkerDir, { recursive: true });
    const invalidMarkerPath = join(invalidMarkerDir, "marker.json");
    writeFileSync(invalidMarkerPath, '{"broken":json}', { mode: 0o644 });
    try {
      const optOutWithBadMarker = startConnect(
        ["--endpoint", "http://127.0.0.1:49999/mcp", "--runtime-base", f.runtimeBase],
        { H2A_MCP_CENTRAL: "0" }
      );
      const initBadMarkerOptOut = await optOutWithBadMarker.call("initialize");
      assert.ok(initBadMarkerOptOut.result, "opt-out succeeds even with invalid/non-private marker");

      const codexWithBadMarker = startConnect(
        ["--host", "codex", "--endpoint", "http://127.0.0.1:49999/mcp", "--runtime-base", f.runtimeBase],
        { CLAUDE_CODE_SESSION_ID: "conv-v1-inherited" }
      );
      const initBadMarkerCodex = await codexWithBadMarker.call("initialize");
      assert.ok(initBadMarkerCodex.result, "codex host succeeds even with invalid/non-private marker");
    } finally {
      rmSync(invalidMarkerDir, { recursive: true, force: true });
    }

    // 3. Renewed endpoint: live central running on real URL (R3)
    const livePort = 47000 + (process.getuid() % 1000) + 50;
    const liveUrl = `http://127.0.0.1:${livePort}/mcp`;
    const liveServer = await startCentralMcpServer({
      root: f.root,
      runtimeBase: f.runtimeBase,
      env: { ...f.env, H2A_MCP_CENTRAL_ENDPOINT: liveUrl }
    });
    try {
      // 3a. v1 connector WITHOUT --host with inherited Claude ID and live central must stay in stdio (R3)
      const v1WithoutHost = startConnect(
        ["--endpoint", "http://127.0.0.1:49999/mcp", "--runtime-base", f.runtimeBase],
        { CLAUDE_CODE_SESSION_ID: "conv-v1-inherited-claude" }
      );
      const initWithoutHost = await v1WithoutHost.call("initialize");
      assert.ok(initWithoutHost.result, "unqualified v1 connector without --host falls back to stdio despite live central and Claude ID");

      // 3b. v1 connector WITH explicit --host claude routes to central and adapts to renewed endpoint
      const renewedConnect = startConnect(
        ["--host", "claude", "--endpoint", "http://127.0.0.1:49999/mcp", "--runtime-base", f.runtimeBase],
        { CLAUDE_CODE_SESSION_ID: "conv-v1-renewed" }
      );
      const initRenewed = await renewedConnect.call("initialize");
      assert.ok(initRenewed.result, "qualified Claude v1 connector adapts to renewed live central endpoint");
      assert.equal(initRenewed.result.serverInfo.name, "@sentropic/h2a", "connected to central server");
    } finally {
      await liveServer.stop();
    }

    // 4. Explicit repair of v1 residual configuration via central residues --repair
    const repo = join(f.dir, "repo-b");
    execFileSync("git", ["init", "-q", repo]);
    const originalConfig = '{\n  "mcpServers": {\n    "h2a": {\n      "command": "h2a",\n      "args": ["mcp-central-connect", "--endpoint", "http://127.0.0.1:47000/mcp"]\n    }\n  }\n}\n';
    const configPath = join(repo, ".mcp.json");
    writeFileSync(configPath, originalConfig);
    execFileSync("git", ["-C", repo, "add", ".mcp.json"]);

    // Repository with "codex" in path: must NOT deduce host as codex (R17)
    const repoCodexTools = join(f.dir, "repo-codex-tools");
    execFileSync("git", ["init", "-q", repoCodexTools]);
    const codexToolsConfigPath = join(repoCodexTools, ".mcp.json");
    writeFileSync(codexToolsConfigPath, originalConfig);
    execFileSync("git", ["-C", repoCodexTools, "add", ".mcp.json"]);

    // Real agy fixture
    const agyConfigDir = join(f.env.HOME, ".gemini", "config");
    mkdirSync(agyConfigDir, { recursive: true });
    const agyConfigPath = join(agyConfigDir, "mcp_config.json");
    writeFileSync(agyConfigPath, originalConfig);

    // Real codex fixture
    const codexConfigDir = join(f.env.HOME, ".codex");
    mkdirSync(codexConfigDir, { recursive: true });
    const codexConfigPath = join(codexConfigDir, "config.json");
    writeFileSync(codexConfigPath, originalConfig);

    // Without --allow-tracked, repair refuses git-tracked config
    const dryReport = centralResidueReport(repo, agyConfigPath, { repair: true, codexConfig: codexConfigPath });
    assert.equal(dryReport.repairedCount, 2, "untracked agy and codex configs are repaired while tracked config is refused");
    assert.equal(readFileSync(configPath, "utf8"), originalConfig);

    // Reset agy and codex fixtures to test all three repaired together under allowTracked
    writeFileSync(agyConfigPath, originalConfig);
    writeFileSync(codexConfigPath, originalConfig);

    // With --allow-tracked, repair rewrites Claude, agy and Codex configs to full coordination stdio
    const repairReport = centralResidueReport(repo, agyConfigPath, { repair: true, allowTracked: true, codexConfig: codexConfigPath });
    assert.equal(repairReport.repairedCount, 3);

    const updatedClaude = JSON.parse(readFileSync(configPath, "utf8"));
    const expectedClaudeArgs = ["mcp-serve", "--auto-open", "--host", "claude", "--auto-upgrade", "--wake", "auto"];
    assert.deepEqual(updatedClaude.mcpServers.h2a.args, expectedClaudeArgs, "Claude repair produces complete coordination arguments");

    // Verify repository containing "codex" in directory path receives Claude host args, not codex (R17)
    const repairCodexTools = centralResidueReport(repoCodexTools, agyConfigPath, { repair: true, allowTracked: true, codexConfig: codexConfigPath });
    assert.equal(repairCodexTools.repairedCount, 1);
    const updatedCodexTools = JSON.parse(readFileSync(codexToolsConfigPath, "utf8"));
    assert.deepEqual(updatedCodexTools.mcpServers.h2a.args, expectedClaudeArgs, "repo path containing 'codex' must be repaired as Claude, not Codex");

    const updatedAgy = JSON.parse(readFileSync(agyConfigPath, "utf8"));
    const expectedAgyArgs = ["mcp-serve", "--auto-open", "--host", "agy", "--auto-upgrade", "--wake", "auto"];
    assert.deepEqual(updatedAgy.mcpServers.h2a.args, expectedAgyArgs, "agy repair produces complete coordination arguments");

    const updatedCodex = JSON.parse(readFileSync(codexConfigPath, "utf8"));
    const expectedCodexArgs = ["mcp-serve", "--auto-open", "--host", "codex", "--auto-upgrade", "--wake", "auto"];
    assert.deepEqual(updatedCodex.mcpServers.h2a.args, expectedCodexArgs, "codex repair produces complete coordination arguments");

    // 5. Launch repaired Claude server and verify identity_ready, signing and wake
    let stderrText = "";
    const repairedChild = spawn(
      process.execPath,
      [bin, ...updatedClaude.mcpServers.h2a.args],
      { env: { ...f.env, H2A_MCP_CENTRAL: "0", CLAUDE_CODE_SESSION_ID: "repaired-claude" }, cwd: repo, stdio: ["pipe", "pipe", "pipe"] }
    );
    children.push(repairedChild);
    repairedChild.stderr.on("data", (chunk) => { stderrText += chunk.toString(); });
    const repairedChannel = rpcChannel(repairedChild.stdin, repairedChild.stdout);
    const initRepaired = await repairedChannel.call("initialize");
    assert.ok(initRepaired.result, "repaired server initializes successfully");
    const idStatus = await ready(repairedChannel);
    assert.equal(idStatus.state, "identity_ready", "repaired server achieves identity_ready");
    assert.equal(idStatus.signingAvailable, true, "repaired server enables signing");
    assert.match(stderrText, /inbox-wake armed for/, "repaired server enables wake");

    const sendRes = await repairedChannel.call("tools/call", { name: "h2a_send", arguments: { to: idStatus.instance, message: "ping" } });
    assert.ok(!sendRes.error, "h2a_send call succeeds with active signer");
    assert.equal(sendRes.result?.isError, false, "h2a_send business result has isError: false");
    const sendPayload = JSON.parse(sendRes.result.content[0].text);
    assert.equal(sendPayload.ok, true, "h2a_send payload indicates success (ok: true)");
    assert.ok(sendPayload.envelope?.signatures?.some(s => Boolean(s.value)), "h2a_send persisted signed envelope");
    assert.equal(sendPayload.envelope.signatures[0].alg, "ed25519");
    assert.equal(sendPayload.envelope.signatures[0].by, idStatus.instance);
  } finally {
    await Promise.all(children.map(async child => { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await once(child, "exit"); } }));
    f.cleanup();
  }
});

test("relative H2A_ROOT deterministically selects stdio and never derives central root from cwd", async () => {
  const f = fixture();
  const repoA = join(f.dir, "repo-a");
  const repoB = join(f.dir, "repo-b");
  mkdirSync(repoA, { recursive: true });
  mkdirSync(repoB, { recursive: true });
  const relativeEnv = { ...f.env, H2A_ROOT: ".h2a", CLAUDE_CODE_SESSION_ID: "conv-relative-root" };
  const flags = { host: "claude" };

  // 1. startCentralMcpServer refuses relative root before any mutation (inhibition preserved)
  const pauseFile = centralPausePath({ runtimeBase: f.runtimeBase });
  mkdirSync(dirname(pauseFile), { recursive: true, mode: 0o700 });
  writeFileSync(pauseFile, "{}");
  await assert.rejects(
    () => startCentralMcpServer({ root: ".h2a", runtimeBase: f.runtimeBase }),
    /central MCP root must be an absolute path/
  );
  assert.equal(existsSync(pauseFile), true, "pause file must remain untouched when relative root is rejected");
  unlinkSync(pauseFile);

  // 2. Direct CLI mcp-central-serve from two different cwds refuses relative root without mutation
  const runServe = (cwd, extraArgs = [], extraEnv = {}) => {
    try {
      execFileSync(process.execPath, [bin, "mcp-central-serve", ...extraArgs], {
        cwd,
        env: { ...f.env, ...extraEnv },
        stdio: ["ignore", "pipe", "pipe"]
      });
      return { code: 0, stderr: "" };
    } catch (err) {
      return { code: err.status, stderr: err.stderr.toString("utf8") };
    }
  };
  const resA = runServe(repoA, ["--root", ".h2a"]);
  assert.equal(resA.code, 1);
  assert.match(resA.stderr, /central MCP root must be an absolute path/);
  assert.equal(existsSync(join(repoA, ".h2a")), false, "repoA must not have .h2a created");

  const resB = runServe(repoB, [], { H2A_ROOT: ".h2a" });
  assert.equal(resB.code, 1);
  assert.match(resB.stderr, /central MCP root must be an absolute path/);
  assert.equal(existsSync(join(repoB, ".h2a")), false, "repoB must not have .h2a created");

  // 3. Testing two different cwds with the exact same relative variable in policy
  const origCwd = process.cwd();
  try {
    process.chdir(repoA);
    assert.equal(shouldUseCentralMcp(flags, relativeEnv, true), false, "repo-a with relative H2A_ROOT must select stdio");
    process.chdir(repoB);
    assert.equal(shouldUseCentralMcp(flags, relativeEnv, true), false, "repo-b with relative H2A_ROOT must select stdio");
  } finally {
    process.chdir(origCwd);
    f.cleanup();
  }
});

test("central stop when daemon is already absent writes the pause inhibition", async () => {
  const f = fixture();
  try {
    const pausePath = centralPausePath({ runtimeBase: f.runtimeBase });
    assert.equal(existsSync(pausePath), false, "initially not paused");
    const stopped = await centralOperator("stop", { runtimeBase: f.runtimeBase });
    assert.equal(stopped.running, false);
    assert.equal(stopped.paused, true, "stop must report paused=true even if daemon was absent");
    assert.equal(existsSync(pausePath), true, "inhibition file must be written even when daemon was absent");
  } finally {
    f.cleanup();
  }
});

test("runtime-base namespace is strictly isolated across discovery, auto-start, policy, operator and exercises reconnection in isolated child", async () => {
  const f = fixture();
  const nsA = join(f.dir, "ns-a");
  const nsB = join(f.dir, "ns-b");
  const defaultNs = join(f.dir, "default-ns");
  mkdirSync(nsA, { recursive: true, mode: 0o700 });
  mkdirSync(nsB, { recursive: true, mode: 0o700 });
  mkdirSync(defaultNs, { recursive: true, mode: 0o700 });

  const isolatedEnv = {
    PATH: process.env.PATH,
    HOME: join(f.dir, "isolated-home"),
    XDG_RUNTIME_DIR: defaultNs,
    XDG_CACHE_HOME: join(f.dir, "cache"),
    XDG_CONFIG_HOME: join(f.dir, "config"),
    REMOTE_CLI_CONFIG_HOME: join(f.dir, "remote-config"),
    H2A_ROOT: f.root,
    H2A_MCP_CENTRAL: "1",
    CLAUDE_CODE_SESSION_ID: "session-ns"
  };
  mkdirSync(isolatedEnv.HOME, { recursive: true, mode: 0o700 });
  mkdirSync(isolatedEnv.XDG_CACHE_HOME, { recursive: true, mode: 0o700 });
  mkdirSync(isolatedEnv.XDG_CONFIG_HOME, { recursive: true, mode: 0o700 });
  mkdirSync(isolatedEnv.REMOTE_CLI_CONFIG_HOME, { recursive: true, mode: 0o700 });
  mkdirSync(f.root, { recursive: true, mode: 0o700 });

  const childScript = `
import assert from "node:assert/strict";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { ensureCentralForShim } from "${resolve("packages/h2a/dist/runtime/mcp-central-start.js")}";
import { centralOperator, centralPausePath } from "${resolve("packages/h2a/dist/runtime/mcp-central-operator.js")}";
import { shouldUseCentralMcp } from "${resolve("packages/h2a/dist/runtime/mcp-central-policy.js")}";

const nsA = ${JSON.stringify(nsA)};
const nsB = ${JSON.stringify(nsB)};
const defaultNs = ${JSON.stringify(defaultNs)};

// 1. Policy checks marker in the specific namespace with isolated env
assert.equal(shouldUseCentralMcp({ host: "claude", "runtime-base": nsA }, process.env, true), true);

// 2. ensureCentralForShim with nsA starts central exclusively in nsA
const markerA1 = await ensureCentralForShim(true, { runtimeBase: nsA });
assert.ok(markerA1.endpoint, "nsA endpoint must exist");
assert.equal(existsSync(join(nsA, "h2a-mcp-central", "marker.json")), true, "marker must exist in nsA");
assert.equal(existsSync(join(nsB, "h2a-mcp-central")), false, "nsB must remain empty");
assert.equal(existsSync(join(defaultNs, "h2a-mcp-central")), false, "default namespace must remain empty");

// 3. Reconnection in nsA: re-running ensureCentralForShim reuses the running daemon without spawning a new one
const markerA2 = await ensureCentralForShim(true, { runtimeBase: nsA });
assert.equal(markerA2.generation, markerA1.generation, "reconnected marker must match existing daemon generation");
assert.equal(markerA2.endpoint, markerA1.endpoint, "reconnected endpoint must match existing daemon");

// 4. Operator status distinguishes the namespaces
const statusA = await centralOperator("status", { runtimeBase: nsA });
const statusB = await centralOperator("status", { runtimeBase: nsB });
const statusDef = await centralOperator("status", { runtimeBase: defaultNs });
assert.equal(statusA.running, true, "nsA is running");
assert.equal(statusB.running, false, "nsB is not running");
assert.equal(statusDef.running, false, "defaultNs is not running");

// 5. Operator stop in nsA only stops nsA and creates pause file exclusively in nsA
const stopped = await centralOperator("stop", { runtimeBase: nsA });
assert.equal(stopped.running, false, "nsA is stopped");
assert.equal(existsSync(join(nsA, "h2a-mcp-central", "operator-stop.json")), true, "pause file written in nsA");
assert.equal(existsSync(join(nsB, "h2a-mcp-central")), false, "nsB has no pause file or artifacts");
assert.equal(existsSync(join(defaultNs, "h2a-mcp-central")), false, "defaultNs has no pause file or artifacts");

// 6. Recovery: resume after operator stop by removing pause file and re-ensuring central
unlinkSync(centralPausePath({ runtimeBase: nsA }));
const recoveredMarker = await ensureCentralForShim(true, { runtimeBase: nsA });
assert.ok(recoveredMarker.endpoint, "recovered marker must have endpoint");
assert.notEqual(recoveredMarker.generation, markerA1.generation, "recovered daemon must have a new generation");

// Verify other namespaces still have no artifacts after recovery
assert.equal(existsSync(join(nsB, "h2a-mcp-central")), false, "nsB still has no artifacts after recovery");
assert.equal(existsSync(join(defaultNs, "h2a-mcp-central")), false, "defaultNs still has no artifacts after recovery");

// Clean shutdown
await centralOperator("stop", { runtimeBase: nsA });
`;

  try {
    execFileSync(process.execPath, ["--input-type=module", "-e", childScript], {
      env: isolatedEnv,
      stdio: ["ignore", "pipe", "pipe"]
    });

    // Parent assertions: verify namespaces outside nsA remained completely clean
    assert.equal(existsSync(join(nsB, "h2a-mcp-central")), false, "parent: nsB must remain completely empty");
    assert.equal(existsSync(join(defaultNs, "h2a-mcp-central")), false, "parent: default namespace must remain completely empty");
  } finally {
    try { await centralOperator("stop", { runtimeBase: nsA }); } catch {}
    f.cleanup();
  }
});

test("structured sidecar launches with readiness challenge stay on stdio and acknowledge without initial MCP request", async () => {
  const f = fixture();
  const readyFile = join(f.dir, "ready.json");
  const nonce = "01234567-89ab-4cde-8f01-23456789abcd";
  const env = {
    ...f.env,
    CLAUDE_CODE_SESSION_ID: "session-readiness-test",
    H2A_MCP_READY_FILE: readyFile,
    H2A_MCP_READY_NONCE: nonce,
  };
  const flags = { host: "claude", "auto-open": "true" };

  // 1. Policy check: must return false (selecting stdio)
  assert.equal(shouldUseCentralMcp(flags, env, true), false, "readiness challenge must route to stdio");

  // 2. Launching mcp-serve with readiness challenge produces ACK carrying sidecar's own PID and nonce, without any initial MCP frame
  const child = spawn(process.execPath, [bin, "mcp-serve", "--host", "claude", "--auto-open"], {
    env,
    cwd: join(f.dir, "repo-a"),
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(readyFile) && Date.now() < deadline) {
      await delay(50);
    }
    assert.equal(existsSync(readyFile), true, "readiness ack file must be created");
    const ack = JSON.parse(readFileSync(readyFile, "utf8"));
    assert.equal(ack.kind, "h2a.mcp.ready");
    assert.equal(ack.nonce, nonce);
    assert.equal(ack.pid, child.pid, "ACK must carry sidecar process PID, not daemon PID");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    f.cleanup();
  }
});

test("H2A_MCP_CENTRAL=0 acts as independent escape hatch before reading configuration, even with invalid JSON or unreadable file", () => {
  const f = fixture();
  try {
    const configDir = join(f.env.REMOTE_CLI_CONFIG_HOME, ".config", "sentropic", "h2a");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "config.json");

    // Case 1: Invalid JSON in configuration
    writeFileSync(configPath, "{ broken json content");
    assert.equal(
      shouldUseCentralMcp({ host: "claude" }, { ...f.env, H2A_MCP_CENTRAL: "0", CLAUDE_CODE_SESSION_ID: "session-r10" }, true),
      false,
      "H2A_MCP_CENTRAL=0 must return false without throwing when config is invalid JSON"
    );

    // Case 2: Unreadable config file (EACCES)
    writeFileSync(configPath, '{"h2a":{"central":{"enabled":true}}}', { mode: 0o000 });
    try {
      chmodSync(configPath, 0o000);
    } catch {}
    assert.equal(
      shouldUseCentralMcp({ host: "claude" }, { ...f.env, H2A_MCP_CENTRAL: "0", CLAUDE_CODE_SESSION_ID: "session-r10" }, true),
      false,
      "H2A_MCP_CENTRAL=0 must return false without throwing when config file is unreadable"
    );
  } finally {
    try { chmodSync(join(f.env.REMOTE_CLI_CONFIG_HOME, ".config", "sentropic", "h2a", "config.json"), 0o600); } catch {}
    f.cleanup();
  }
});


