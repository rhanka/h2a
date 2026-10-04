import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { createServer } from "node:net";
import test from "node:test";
import { runCli as runTrackCli } from "@sentropic/track";
import { startCentralMcpServer } from "../dist/runtime/mcp-central.js";
import { bridgeCentralMcpStdio } from "../dist/runtime/mcp-central-client.js";
import { captureCentralAttachment } from "../dist/runtime/mcp-central-context.js";
import { centralOperator, centralResidueReport } from "../dist/runtime/mcp-central-operator.js";

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
    const report = centralResidueReport(repo, join(f.env.HOME, "missing-agy.json"));
    assert.equal(report.reportOnly, true);
    assert.equal(report.findings.length, 2);
    assert.equal(report.findings.find(row => row.kind === "v1-central-config").tracked, true);
    assert.deepEqual(readdirSync(repo), before);
    assert.equal(readFileSync(join(repo, ".mcp.json"), "utf8"), config);
  } finally { await channel?.close(); await server?.stop(); f.cleanup(); }
});
