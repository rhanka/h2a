import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import fs, { chmodSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import test from "node:test";
import { resolveMutationFlock, writerDirectory } from "../dist/runtime/handover/mutation.js";
import { Participants } from "../dist/runtime/handover/participants.js";
import { currentIdentity } from "../dist/runtime/handover/admission.js";
import { startCentralMcpServer } from "../dist/runtime/mcp-central.js";
import { publishState, readState, replaceState } from "../dist/runtime/handover/state.js";
import { createLocalStore } from "../dist/runtime/local-files/store.js";
import { readPresence, writePresence } from "../dist/runtime/local-files/presence.js";
import { runMcpStdio } from "../dist/runtime/mcp/stdio.js";
import { H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS } from "../dist/session.js";

function fixture(t) {
  const base = tmpdir();
  const dir = mkdtempSync(join(base, "b1-idle-poll-"));
  chmodSync(dir, 0o700);
  const root = join(dir, "store");
  const runtimeBase = join(dir, "run");
  mkdirSync(runtimeBase, { recursive: true, mode: 0o700 });
  let sweep;
  const clock = {
    now: () => Date.now(),
    setInterval(fn) { sweep = fn; return 1; },
    clearInterval() { sweep = undefined; },
  };
  let central;
  t.after(async () => {
    try { await central?.stop(); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir, root, runtimeBase,
    async tick() { if (sweep) await sweep(); },
    async start(override = {}) {
      central = await startCentralMcpServer({
        root, runtimeBase, physicalPrefix: dir, env: {}, clock,
        idleTimeoutMs: 200, sessionLeaseMs: 90_000, ...override,
      });
      assert.equal(central.kind, "started");
      return central;
    },
    get central() { return central; },
  };
}

test("B-1: operator pause on disk without /stop commits in <= 2 ticks on idle central", { timeout: 20_000 }, async (t) => {
  const f = fixture(t);
  const central = await f.start();
  const marker = readState(central.markerPath, "marker").value;
  const stateDir = marker.stateDirectory;
  // Operator pause written directly on disk (as `h2a central stop` does
  // before its HTTP call): no session, no transaction, revision clean.
  publishState(join(stateDir, "operator-stop.json"),
    { schemaVersion: 1, revision: 1, paused: true, requestedAt: Date.now(), generation: marker.generation }, "pause");
  await f.tick();
  await f.tick();
  // Give the async requestStop -> stopServer a turn.
  await new Promise((r) => setTimeout(r, 200));
  const control = readState(join(stateDir, "component-control.json"), "componentControl").value;
  assert.equal(control.operatorStopCommitted, true, "idle poll must commit operator stop (B-1)");
});

test("NB-5: supervised central resyncs an externally dirtied revision stamp", { timeout: 20_000 }, async (t) => {
  const f = fixture(t);
  const central = await f.start({ idleTimeoutMs: 0 });
  const owner = central.__test.participants();
  const marker = readState(central.markerPath, "marker").value;
  const revPath = join(marker.stateDirectory, "participant-revision.json");
  const prevRev = readState(revPath, "participantRevision");
  replaceState(revPath, { schemaVersion: 1, revision: prevRev.value.revision + 1 }, "participantRevision", prevRev);
  await f.tick();
  await f.tick();
  assert.equal(owner.registry.isRevisionClean(), true, "supervised sweep must resync an external revision write (NB-5)");
});

test("B-1: indeterminate on idle central reconciles in <= 2 ticks, admissions reopen", { timeout: 20_000 }, async (t) => {
  const f = fixture(t);
  const central = await f.start();
  const admin = central.__test.administration();
  const owner = central.__test.participants();
  assert.ok(admin, "test hook exposes administration");
  assert.ok(owner, "test hook exposes participants");
  // Raise indeterminate on an idle central (no session, revision clean):
  // admissions must close until poll reconciles.
  admin.indeterminate = true;
  owner.registry.indeterminate = true;
  await f.tick();
  await f.tick();
  assert.equal(admin.indeterminate, false, "idle poll must reconcile admin indeterminate (B-1)");
  assert.equal(owner.registry.indeterminate, false, "idle poll must reconcile registry indeterminate (B-1)");
  const open = await admin.admissionsOpenAsync({ nonBlocking: true });
  assert.equal(open, true, "admissions must reopen after reconcile (B-1)");
});

async function holdPresenceLockInChild(lockPath) {
  const flockTool = resolveMutationFlock();
  mkdirSync(join(lockPath, ".."), { recursive: true, mode: 0o700 });
  const fd = openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
  closeSync(fd);
  const child = spawn(flockTool, [
    "--exclusive", "--no-fork", lockPath, process.execPath, "-e",
    "process.stdout.write('locked'); process.stdin.resume();"
  ], { stdio: ["pipe", "pipe", "ignore"] });
  const exited = once(child, "exit");
  await Promise.race([
    once(child.stdout, "data"),
    exited.then(() => assert.fail(`flock holder exited before acquiring ${lockPath}`)),
  ]);
  return {
    child,
    async release() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.stdin.end();
      const killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 2_000);
      await Promise.race([once(child, "exit"), new Promise((r) => setTimeout(r, 2_500))]);
      clearTimeout(killTimer);
    },
  };
}

test("NB-4 option A: retirement final tick probes .presence.lock, resets quietTicks while held, and retires after release", { timeout: 20_000 }, async (t) => {
  const f = fixture(t);
  const central = await f.start({ idleTimeoutMs: 200, sessionLeaseMs: 90_000 });
  const wdir = writerDirectory(f.root);
  const presLock = join(wdir, ".presence.lock");
  const owner = central.__test.participants();
  const origWithLockAsync = owner.registry.withLockAsync.bind(owner.registry);
  const lockOptsSeen = [];
  owner.registry.withLockAsync = (fn, opts) => {
    lockOptsSeen.push(Boolean(opts?.bothLocks));
    return origWithLockAsync(fn, opts);
  };

  let closedResolved = false;
  void central.closed.then(() => { closedResolved = true; });

  const holder = await holdPresenceLockInChild(presLock);
  t.after(() => holder.release());
  try {
    // 1. Run 12 ticks (2+ full quiet cycles) while .presence.lock is held.
    // Early ticks only probe .mutation.lock (bothLocks=false); the 5th tick probes bothLocks=true,
    // sees .presence.lock held, resets quietTicks = 0, and keeps the server open.
    for (let i = 0; i < 12; i++) {
      await f.tick();
      assert.equal(closedResolved, false, `tick ${i + 1}: central must stay open while .presence.lock is held`);
    }
    assert.deepEqual(lockOptsSeen.slice(0, 10), [
      false, false, false, false, true,
      false, false, false, false, true,
    ], "only the final tick of each cycle may probe bothLocks (.presence.lock)");
    const ping = await fetch(new URL("/_h2a-central/ping", central.endpoint));
    assert.equal(ping.status, 200, "central still serves ping while .presence.lock contention prevents retirement");
  } finally {
    await holder.release();
  }

  // Wait a tick for OS fd release/exit settlement, then run one full cycle of 5 quiet ticks to retire.
  for (let i = 0; i < 4; i++) {
    await f.tick();
    assert.equal(closedResolved, false, `post-release early tick ${i + 1} must complete full cycle before retiring`);
  }
  await f.tick();
  await Promise.race([
    central.closed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("central failed to retire after .presence.lock release")), 3_000)),
  ]);
  assert.equal(closedResolved, true);
});

test("NB-4 option A: supervised mode (idleTimeoutMs 0) is unchanged by retirement .presence.lock probe", { timeout: 20_000 }, async (t) => {
  const f = fixture(t);
  const central = await f.start({ idleTimeoutMs: 0, sessionLeaseMs: 90_000 });
  const owner = central.__test.participants();
  const withLockAsync = owner.registry.withLockAsync.bind(owner.registry);
  let probeCalls = 0;
  owner.registry.withLockAsync = (fn, opts) => {
    probeCalls++;
    return withLockAsync(fn, opts);
  };
  for (let i = 0; i < 6; i++) await f.tick();
  assert.equal(probeCalls, 0, "supervised central must never run the retirement quiet probe");
});

test("B-1: centralAttachment decouples notify (5s default) from heartbeat (30s) without H2A_NOTIFY_INTERVAL_MS", { timeout: 45_000 }, async (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.root, { recursive: true, mode: 0o700 });
  const cleanEnv = { ...process.env };
  delete cleanEnv.H2A_NOTIFY_INTERVAL_MS;
  delete cleanEnv.H2A_HEARTBEAT_INTERVAL_MS;
  delete cleanEnv.H2A_SESSION_EXPIRY_MS;

  // 1. Direct runMcpStdio centralAttachment check: notify defaults to 5_000ms while heartbeat stretches to 30_000ms.
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let capturedServer;
  const serving = runMcpStdio({
    root: f.root,
    workspaceRoot: f.dir,
    stdin,
    stdout,
    stderr,
    centralAttachment: true,
    sessionEnv: cleanEnv,
    onServer(server) { capturedServer = server; }
  });
  try {
    assert.ok(capturedServer, "centralAttachment must expose McpServer");
    assert.equal(
      capturedServer.notifications.intervalMs,
      H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS,
      "central attachment notify interval must stay at 5 000 ms default without H2A_NOTIFY_INTERVAL_MS"
    );
    assert.ok(
      capturedServer.notifications.initialDelayMs <= H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS,
      `central attachment notify initialDelayMs (${capturedServer.notifications.initialDelayMs}) must not exceed 5 000 ms`
    );
    assert.equal(
      capturedServer.sessions.heartbeatIntervalMs,
      30_000,
      "central attachment presence heartbeat interval must stretch to 30 000 ms (3x in 90s expiry)"
    );
  } finally {
    stdin.end();
    await serving;
  }

  // 2. End-to-end central daemon + bridgeCentralMcpStdio shim without H2A_NOTIFY_INTERVAL_MS:
  // two consecutive inbox envelopes must be pushed at ~5s cadence (2nd arrival <= 8s after 1st).
  const central = await f.start({ idleTimeoutMs: 0, sessionLeaseMs: 90_000 });
  const bridgeUrl = new URL("../dist/runtime/handover/shim-bridge.js", import.meta.url).href;
  const contextUrl = new URL("../dist/runtime/mcp-central-context.js", import.meta.url).href;
  const childScript = [
    `import { bridgeCentralMcpStdio } from ${JSON.stringify(bridgeUrl)};`,
    `import { captureCentralAttachment } from ${JSON.stringify(contextUrl)};`,
    `const attachment = captureCentralAttachment(process.env.H2A_ROOT, process.env.H2A_WORKSPACE, { host: "claude", "auto-open": "true" }, process.env);`,
    `await bridgeCentralMcpStdio({ runtimeBase: process.env.XDG_RUNTIME_DIR, stdin: process.stdin, stdout: process.stdout, attachment });`
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", childScript], {
    env: {
      ...cleanEnv,
      HOME: f.dir,
      XDG_RUNTIME_DIR: f.runtimeBase,
      H2A_ROOT: f.root,
      H2A_WORKSPACE: f.dir,
      H2A_MCP_CENTRAL: "1",
      CLAUDE_CODE_SESSION_ID: "b1-default-notify-shim"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const pending = new Map();
  const arrivals = [];
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const res = pending.get(msg.id);
        pending.delete(msg.id);
        res(msg);
      } else if (msg.method === "notifications/h2a" && msg.params?.topic === "inbox.envelope_arrived") {
        arrivals.push({ at: Date.now(), envelopeId: msg.params?.data?.envelopeId });
      }
    } catch { /* ignore */ }
  });
  let childStderr = "";
  child.stderr.on("data", (d) => { childStderr += String(d); });
  const callShim = (id, method, params) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`shim ${method} timeout; stderr=${childStderr}`)); }, 10_000);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  try {
    const init = await callShim(1, "initialize", {
      protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "b1-notify-test", version: "1" }
    });
    assert.ok(init.result?.protocolVersion);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    let instance;
    for (let i = 0; i < 60; i++) {
      const st = await callShim(100 + i, "tools/call", { name: "h2a_identity_status", arguments: {} });
      const body = JSON.parse(st.result?.content?.[0]?.text ?? "{}");
      if (body.state === "identity_ready") { instance = body.instance; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(instance, `shim failed to reach identity_ready; stderr=${childStderr}`);

    const store = createLocalStore({ root: f.root, initialize: false });
    const putEnvelope = (id) => store.putInboxMessage(instance, {
      protocol: "sentropic.h2a",
      version: "0.1",
      id,
      type: "event",
      actor: { instance: "codex:sender", role: "AGENTS", scope: "scope:default" },
      body: { kind: "message", text: id },
      createdAt: new Date().toISOString()
    });

    putEnvelope("env-b1-1");
    const deadline1 = Date.now() + 12_000;
    while (!arrivals.some((a) => a.envelopeId === "env-b1-1") && Date.now() < deadline1) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const first = arrivals.find((a) => a.envelopeId === "env-b1-1");
    assert.ok(first, `first inbox notification never arrived within 12s (arrivals=${JSON.stringify(arrivals)})`);

    putEnvelope("env-b1-2");
    const deadline2 = first.at + 12_000;
    while (!arrivals.some((a) => a.envelopeId === "env-b1-2") && Date.now() < deadline2) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const second = arrivals.find((a) => a.envelopeId === "env-b1-2");
    assert.ok(second, `second inbox notification did not arrive within 12s of first tick (default notify cadence must be ~5s, not 30s)`);
    assert.ok(second.at - first.at < 12_000, `second arrival delta ${second.at - first.at}ms must stay on ~5s cadence`);
  } finally {
    rl.close();
    if (child.exitCode === null) {
      child.stdin.end();
      const exited = once(child, "exit");
      await Promise.race([exited, new Promise((r) => setTimeout(r, 1500))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }
});

test("NB-4: SessionRegistry.touchAsync reads disk presence row under .presence.lock to enforce fencing", { timeout: 15_000 }, async (t) => {
  const f = fixture(t);
  const stateDir = join(f.dir, "state");
  fs.mkdirSync(f.root, { recursive: true, mode: 0o700 });
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const marker = {
    generation: randomUUID(),
    processIdentity: currentIdentity(),
    endpointMode: "discovered",
    handoverCapabilities: { managedImage: false }
  };
  const participants = new Participants({ root: f.root, directory: stateDir, marker });
  const participant = participants.attach("att-nb4-fencing", { workspace: f.dir });
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let mcpServer;
  const serving = runMcpStdio({
    root: f.root,
    workspaceRoot: f.dir,
    stdin,
    stdout,
    stderr,
    participant,
    notifyIntervalMs: 60_000,
    heartbeatIntervalMs: 60_000,
    onServer(s) { mcpServer = s; }
  });
  try {
    const expectedInstance = "claude:nb4-expected:111111111111";
    const opened = await participant.runOwner(() => mcpServer.sessions.openAsync({
      instance: expectedInstance,
      host: "claude"
    }));
    const onDisk = readPresence(f.root, opened.sessionId);
    assert.ok(onDisk);
    // Replace the presence row on disk with a different instance: under-lock read must detect the mismatch.
    writePresence(f.root, { ...onDisk, instance: "claude:nb4-hijacked:222222222222" });
    await assert.rejects(
      () => participant.runOwner(() => mcpServer.sessions.touchAsync(opened.sessionId)),
      /presence_ownership_mismatch/,
      "touchAsync must read existing presence row under .presence.lock instead of trusting in-memory instance"
    );
  } finally {
    stdin.end();
    await serving;
  }
});
