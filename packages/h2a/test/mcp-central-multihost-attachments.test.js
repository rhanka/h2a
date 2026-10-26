// H1 transport fixture: ONE shared central service with isolated
// attachments from several CLI attachments (claude, codex, agy).
// Distinct hosts, sessions and workspaces share a single server, store
// and generation; detachment closes only its own attachment.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { createServer } from "node:net";
import { once } from "node:events";
import test from "node:test";
import { runCli as runTrackCli } from "@sentropic/track";
import { startCentralMcpServer } from "../dist/runtime/mcp-central.js";
import { bridgeCentralMcpStdio } from "../dist/runtime/mcp-central-client.js";
import { captureCentralAttachment } from "../dist/runtime/mcp-central-context.js";
import { centralOperator } from "../dist/runtime/mcp-central-operator.js";
import { qualificationRoot } from "./helpers/qual-env.js";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture() {
  // h2a_run refuses agent workspaces under the OS temporary directory, so
  // this fixture owns a mkdtemp directory beneath the repo qualification
  // root, exactly like the two-repo attachment test.
  mkdirSync(qualificationRoot, { recursive: true });
  const dir = mkdtempSync(join(qualificationRoot, "h1-multihost-"));
  for (const name of ["home", "runtime", "config", "repo-a", "repo-b", "repo-c"]) mkdirSync(join(dir, name), { mode: 0o700 });
  const root = join(dir, "state");
  const runtimeBase = join(dir, "runtime");
  const env = {
    PATH: process.env.PATH, LANG: "C.UTF-8",
    HOME: join(dir, "home"), XDG_RUNTIME_DIR: runtimeBase,
    XDG_CONFIG_HOME: join(dir, "config"), XDG_STATE_HOME: join(dir, "state-home"),
    XDG_DATA_HOME: join(dir, "data"), XDG_CACHE_HOME: join(dir, "cache"),
    H2A_ROOT: root, H2A_MCP_CENTRAL: "1"
  };
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

function sessionEnv(host, id) {
  return host === "claude" ? { CLAUDE_CODE_SESSION_ID: id } : {};
}

function connect(f, url, host, repo, session) {
  const input = new PassThrough();
  const output = new PassThrough();
  const controller = new AbortController();
  const flags = { host, "auto-open": "true" };
  const channel = rpcChannel(input, output);
  const running = bridgeCentralMcpStdio({ endpoint: url, runtimeBase: f.runtimeBase, stdin: input, stdout: output, signal: controller.signal,
    attachment: captureCentralAttachment(f.root, repo, flags, { ...sessionEnv(host, session) }) });
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

test("H1: one shared service carries isolated attachments from three native CLIs", { timeout: 90_000 }, async () => {
  const f = fixture();
  const channels = [];
  let server;
  try {
    const url = await endpoint();
    server = await startCentralMcpServer({ root: f.root, runtimeBase: f.runtimeBase,
      env: { H2A_MCP_CENTRAL_ENDPOINT: url }, runExecutor: request => ({ workspace: request.workspace }) });
    const marker = JSON.parse(readFileSync(server.markerPath, "utf8"));
    const plan = [
      { host: "claude", repo: "repo-a", session: "h1-claude-session" },
      { host: "codex", repo: "repo-b", session: "h1-codex-session" },
      { host: "agy", repo: "repo-c", session: "h1-agy-session" }
    ];
    const attached = [];
    for (const { host, repo, session } of plan) {
      const dir = join(f.dir, repo);
      const io = { cwd: dir, out() {}, err() {} };
      assert.equal(runTrackCli(["init"], io), 0);
      writeFileSync(join(dir, "BRANCH.md"), `# Feature: ${repo} — ${repo} only\n\n## Plan / Todo (lot-based)\n- [ ] **Lot 1 — ${repo} only**\n`);
      assert.equal(runTrackCli(["branch", "import", "BRANCH.md", "--commit", "fixture"], io), 0);
      const channel = connect(f, url, host, dir, session);
      channels.push(channel);
      assert.ok((await channel.call("initialize", { protocolVersion: "2025-06-18", capabilities: {},
        clientInfo: { name: `${host}-fixture`, version: "1" } })).result, `${host} attaches`);
      const status = await ready(channel);
      attached.push({ host, repo: dir, status });
    }
    // One service: a single marker/generation serves every attachment.
    assert.ok(marker.generation, "the shared service publishes one generation");
    assert.equal(JSON.parse(readFileSync(server.markerPath, "utf8")).generation, marker.generation);
    assert.equal((await centralOperator("status", { runtimeBase: f.runtimeBase })).attachments, 3);
    // Isolation: distinct identities, own workspace each, no cross-reads.
    const instances = attached.map(entry => entry.status.instance);
    assert.equal(new Set(instances).size, 3, "each CLI attachment owns its identity");
    assert.equal(bindings(f.root).length, 3);
    for (const { host, repo, status } of attached) {
      const track = await channels[attached.findIndex(entry => entry.host === host)]
        .call("tools/call", { name: "track_query", arguments: { baselineCommit: "fixture" } });
      assert.match(JSON.stringify(track), new RegExp(`${repo.split("/").pop()} only`), `${host} reads its own repo`);
      for (const other of attached.filter(entry => entry.host !== host)) {
        assert.doesNotMatch(JSON.stringify(track), new RegExp(`${other.repo.split("/").pop()} only`), `${host} never reads ${other.host} content`);
      }
      const run = await channels[attached.findIndex(entry => entry.host === host)]
        .call("tools/call", { name: "h2a_run", arguments: { profile: "claude", name: `h1-${host}`, workspace: repo, prompt: "fixture", background: true } });
      assert.equal(JSON.parse(run.result.content[0].text).workspace, repo, `${host} runs in its own workspace`);
      const wrong = await channels[attached.findIndex(entry => entry.host === host)]
        .call("tools/call", { name: "h2a_run", arguments: { profile: "claude", name: "h1-cross", workspace: attached.find(entry => entry.host !== host).repo, prompt: "fixture", background: true } });
      assert.match(JSON.stringify(wrong), /startup workspace/, `${host} cannot run in another attachment's root`);
      assert.equal(status.instance, instances[attached.findIndex(entry => entry.host === host)]);
    }
    // Detachment closes one attachment, never the shared daemon or the others.
    // The three worker attachments above hold admitted background runs, which
    // the server must drain before release; a fourth attachment with only
    // read-only calls detaches promptly.
    const clean = connect(f, url, "Muse", join(f.dir, "repo-a"), "h1-gemini-clean");
    channels.push(clean);
    assert.ok((await clean.call("initialize", { protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "gemini-fixture", version: "1" } })).result, "Muse attaches");
    await ready(clean);
    assert.equal((await centralOperator("status", { runtimeBase: f.runtimeBase })).attachments, 4);
    await clean.close();
    channels.pop();
    const detached = Date.now() + 10_000;
    let remaining = 4;
    while (remaining !== 3 && Date.now() < detached) {
      await delay(100);
      remaining = (await centralOperator("status", { runtimeBase: f.runtimeBase })).attachments;
    }
    assert.equal(remaining, 3, "a clean detachment must release exactly the closed attachment");
    const survivor = await ready(channels[0]);
    assert.ok(survivor.instance, "a surviving attachment keeps serving after a peer detaches");
  } finally {
    await Promise.all(channels.map(channel => channel.close()));
    await server?.stop();
    f.cleanup();
  }
});
