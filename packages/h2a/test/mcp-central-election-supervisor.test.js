import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import fs, {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  centralMcpPing,
  startCentralMcpServer
} from "../dist/runtime/mcp-central.js";
import { bridgeCentralMcpStdio } from "../dist/runtime/mcp-central-client.js";
import { captureCentralAttachment } from "../dist/runtime/mcp-central-context.js";
import { embeddedTools } from "../dist/runtime/mcp-central-descriptor.js";
import { centralOperator } from "../dist/runtime/mcp-central-operator.js";
import { ensureCentralForRoot } from "../dist/runtime/mcp-central-start.js";
import { runCentralMcpServe } from "../dist/cli.js";
import * as admission from "../dist/runtime/handover/admission.js";
import { acquirePreclaim } from "../dist/runtime/handover/authority.js";
import { authenticatedHttpRequest } from "../dist/runtime/handover/authenticated-http.js";
import {
  establishWriterControl,
  updateWriterControl,
  writerDirectory
} from "../dist/runtime/handover/mutation.js";
import { OperationLedger, OwnershipRegistry } from "../dist/runtime/handover/ownership.js";
import { classifyDurableProcFrame } from "../dist/runtime/handover/proc-identity.js";
import { publishState, readState, replaceState } from "../dist/runtime/handover/state.js";
import { canonicalBytes, digest } from "../dist/runtime/handover/wire.js";
import { centralMcpPing as runtimeCentralMcpPing } from "../../h2a-runtime/dist/central-mcp.js";

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SYSTEMD_UNIT_PATH = join(REPO_ROOT, "contrib", "systemd", "h2a-mcp-central.service");

const linux = process.platform === "linux" ? {} : { skip: "central MCP requires Linux /proc semantics" };

function mkFixture(prefix = "h2a-l3-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  chmodSync(dir, 0o700);
  const home = join(dir, "home");
  const runtimeBase = join(dir, "runtime");
  const root = join(dir, "store");
  const workspace = join(dir, "workspace");
  for (const d of [home, runtimeBase, root, workspace]) {
    mkdirSync(d, { recursive: true, mode: 0o700 });
    chmodSync(d, 0o700);
  }
  const stateDir = join(runtimeBase, "h2a-mcp-central");
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  chmodSync(stateDir, 0o700);
  return {
    dir,
    home,
    runtimeBase,
    root,
    workspace,
    stateDir,
    markerPath: join(stateDir, "marker.json"),
    env: {
      ...process.env,
      HOME: home,
      XDG_RUNTIME_DIR: runtimeBase,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_STATE_HOME: join(home, ".local", "state"),
      XDG_DATA_HOME: join(home, ".local", "share"),
      XDG_CACHE_HOME: join(home, ".cache"),
      H2A_ROOT: root,
      H2A_MCP_CENTRAL: "1",
      TMPDIR: tmpdir(),
      TMP: tmpdir(),
      TEMP: tmpdir()
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function seedCompletedOperations(stateDir, count, oldGeneration = "11111111-1111-4111-8111-111111111111") {
  const execOwner = {
    ...admission.currentIdentity(),
    pid: 999_991,
    startTime: 1
  };
  for (let i = 0; i < count; i++) {
    const operationId = `hist-op-${i}`;
    const filename = `operation-${digest(operationId).slice(7)}.json`;
    const doc = {
      schemaVersion: 1,
      revision: 2,
      operationId,
      attachmentId: `hist-att-${i % 16}`,
      ownerGeneration: oldGeneration,
      executionOwner: execOwner,
      kind: "call",
      state: "completed",
      result: { completed: true }
    };
    writeFileSync(join(stateDir, filename), Buffer.concat([canonicalBytes(doc), Buffer.from("\n")]), { mode: 0o600 });
  }
  const dirFd = fs.openSync(stateDir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
}

async function waitForMarker(markerPath, timeoutMs = 15_000, predicate = () => true) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(markerPath)) {
      try {
        const parsed = JSON.parse(readFileSync(markerPath, "utf8"));
        if (parsed?.endpoint && parsed?.generation && predicate(parsed)) return parsed;
      } catch { /* mid-write */ }
    }
    await delay(25);
  }
  throw new Error(`timeout waiting for marker at ${markerPath}`);
}

async function killSpawnedPid(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) return;
  try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const proc = admission.observeProcess(pid);
    if (proc.absent) return;
    await delay(25);
  }
}

function makeShimClient(bridgeOptions) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const ac = new AbortController();
  let buf = "";
  const pending = new Map();
  stdout.on("data", (chunk) => {
    buf += String(chunk);
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const frame = JSON.parse(line);
      if (frame.id !== undefined && pending.has(frame.id)) {
        const { resolve, timer } = pending.get(frame.id);
        pending.delete(frame.id);
        clearTimeout(timer);
        resolve(frame);
      }
    }
  });
  const running = bridgeCentralMcpStdio({
    ...bridgeOptions,
    stdin,
    stdout,
    signal: ac.signal
  });
  let seq = 0;
  return {
    running,
    call(method, params, timeoutMs = 15_000) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`shim timeout waiting for ${method} (id=${id})`));
        }, timeoutMs);
        timer.unref?.();
        pending.set(id, { resolve, timer });
        stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) })}\n`);
      });
    },
    notify(method, params) {
      stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) })}\n`);
    },
    async close() {
      ac.abort();
      stdin.end();
      await running.catch(() => {});
    }
  };
}

test("T3.1a: SIGSTOP central with 1 pending op and 15,500 files is evicted (< 7s, 0 operation reads by launcher) and successor settles pending op to unknown", { ...linux, timeout: 90_000 }, async (t) => {
  const f = mkFixture("h2a-l3-t31a-");
  const spawnedPids = new Set();
  let child1;
  let shim;
  try {
    // Seed 15,500 historical operation-*.json files before starting central #1
    seedCompletedOperations(f.stateDir, 15_500);

    child1 = spawn(
      process.execPath,
      [BIN, "mcp-central-serve", "--root", f.root, "--runtime-base", f.runtimeBase],
      { cwd: f.workspace, env: f.env, stdio: ["ignore", "pipe", "pipe"] }
    );
    spawnedPids.add(child1.pid);

    const marker1 = await waitForMarker(f.markerPath, 15_000, (m) => m.pid === child1.pid);
    const ping1 = await centralMcpPing(marker1.endpoint, 1_000);
    assert.deepEqual(ping1, { kind: "generation", generation: marker1.generation });

    // Confirm /_h2a-central/health reports ledgerMigrationComplete === false while migrating 15.5k files
    const health1Res = await fetch(new URL("/_h2a-central/health", marker1.endpoint));
    assert.equal(health1Res.status, 200, "central #1 must expose unauthenticated /_h2a-central/health");
    const health1 = await health1Res.json();
    assert.equal(health1.ok, true);
    assert.equal(health1.generation, marker1.generation);
    assert.equal(health1.ledgerMigrationComplete, false, "migration of 15,500 files must still be running");

    // Record 1 pending operation owned by central #1
    const pendingOpId = `in-flight-${randomUUID()}`;
    const pendingOpName = `operation-${digest(pendingOpId).slice(7)}.json`;
    const pendingOpDoc = {
      schemaVersion: 1,
      revision: 1,
      operationId: pendingOpId,
      attachmentId: "att-inflight",
      ownerGeneration: marker1.generation,
      executionOwner: marker1.processIdentity,
      kind: "call",
      state: "pending",
      result: null
    };
    writeFileSync(join(f.stateDir, pendingOpName), Buffer.concat([canonicalBytes(pendingOpDoc), Buffer.from("\n")]), { mode: 0o600 });

    // Wait briefly (>= 600ms after marker1.startedAt) so startupGraceMs (5000ms) is naturally elapsed
    // by the end of the 1.5s + 0.5s + 2.7s shim+launcher probe sequence, well before 15.5k migration finishes.
    const elapsedSinceStart = Date.now() - Date.parse(marker1.startedAt);
    if (elapsedSinceStart < 650) await delay(650 - elapsedSinceStart);

    // Freeze central #1 with SIGSTOP (SIGCONT forbidden)
    process.kill(child1.pid, "SIGSTOP");

    // Spy on fs.readFileSync and fs.openSync during launcher ensure() to prove 0 operation-*.json reads
    let launcherOperationReads = 0;
    let inLauncher = false;
    const origReadFileSync = fs.readFileSync;
    const origOpenSync = fs.openSync;
    t.mock.method(fs, "readFileSync", function (...args) {
      if (inLauncher && typeof args[0] === "string" && args[0].includes("operation-")) {
        launcherOperationReads++;
      }
      return origReadFileSync.apply(this, args);
    });
    t.mock.method(fs, "openSync", function (...args) {
      if (inLauncher && typeof args[0] === "string" && args[0].includes("operation-")) {
        launcherOperationReads++;
      }
      return origOpenSync.apply(this, args);
    });

    const t0 = performance.now();
    shim = makeShimClient({
      runtimeBase: f.runtimeBase,
      workspaceRoot: f.workspace,
      registryTools: embeddedTools,
      attachment: captureCentralAttachment(
        f.root,
        f.workspace,
        { host: "claude", "runtime-base": f.runtimeBase },
        { ...f.env, CLAUDE_CODE_SESSION_ID: "t31a-session" }
      ),
      ensure: async () => {
        inLauncher = true;
        try {
          const m = await ensureCentralForRoot(f.root, {
            runtimeBase: f.runtimeBase,
            onSpawn: (child) => { if (child.pid) spawnedPids.add(child.pid); }
          });
          if (m?.pid) spawnedPids.add(m.pid);
        } finally {
          inLauncher = false;
        }
      }
    });

    const initReply = await shim.call("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "t31a-client", version: "1.0.0" }
    }, 10_000);
    const failoverMs = performance.now() - t0;

    // Print measured acceptance metrics for evidence capture
    console.error(`[L3 T3.1a] failoverMs=${failoverMs.toFixed(1)} launcherOperationReads=${launcherOperationReads}`);
    assert.ok(initReply.result?.protocolVersion, `expected successful initialize, got ${JSON.stringify(initReply)}`);
    assert.ok(failoverMs < 7_000, `shim failover + initialize took ${failoverMs.toFixed(1)}ms, expected < 7000ms`);
    assert.equal(launcherOperationReads, 0, `launcher must perform 0 reads of operation-*.json (observed ${launcherOperationReads})`);

    // Old frozen child must be dead (evicted via SIGTERM -> SIGKILL)
    assert.equal(
      admission.ownerLiveness(marker1, admission.currentIdentity()),
      "dead",
      "SIGSTOP central #1 must be proven dead after eviction"
    );

    const marker2 = JSON.parse(readFileSync(f.markerPath, "utf8"));
    spawnedPids.add(marker2.pid);
    assert.notEqual(marker2.generation, marker1.generation, "successor must have a new generation");
    assert.notEqual(marker2.pid, child1.pid, "successor must be a new process");

    // Verify drain().complete === false while ledgerMigrationComplete === false
    const partialRegistry = new OwnershipRegistry({
      directory: f.stateDir,
      generation: marker2.generation,
      processIdentity: marker2.processIdentity,
      lockDirectory: writerDirectory(f.root),
      readOnly: true
    });
    const partialLedger = new OperationLedger(partialRegistry, { skipAutoMigration: true });
    partialLedger.ledgerMigrationComplete = false;
    assert.equal(partialLedger.drain().complete, false, "drain().complete must stay false while ledgerMigrationComplete === false");

    // Wait for successor's background migration to reach ledgerMigrationComplete === true on /_h2a-central/health
    const migDeadline = Date.now() + 45_000;
    let health2;
    while (Date.now() < migDeadline) {
      const r = await fetch(new URL("/_h2a-central/health", marker2.endpoint));
      assert.equal(r.status, 200);
      health2 = await r.json();
      if (health2.ledgerMigrationComplete === true) break;
      await delay(100);
    }
    assert.equal(health2?.ledgerMigrationComplete, true, "successor must reach ledgerMigrationComplete === true");

    // Now run successor OperationLedger.drain() and verify the dead owner's pending op is settled to 'unknown'
    // and drain().complete === true
    const succRegistry = new OwnershipRegistry({
      directory: f.stateDir,
      generation: marker2.generation,
      processIdentity: marker2.processIdentity,
      lockDirectory: writerDirectory(f.root)
    });
    const succLedger = new OperationLedger(succRegistry);
    try {
      const waitMig = Date.now() + 10_000;
      while (!succLedger.ledgerMigrationComplete && Date.now() < waitMig) await delay(25);
      assert.equal(succLedger.ledgerMigrationComplete, true);
      const drainResult = succLedger.drain();
      assert.equal(drainResult.complete, true, `successor drain().complete must be true, got ${JSON.stringify(drainResult)}`);
      const settledOp = readState(join(f.stateDir, pendingOpName), "admittedOperation")?.value;
      assert.equal(settledOp?.state, "unknown", "pending op from dead owner must be settled to state: 'unknown'");
      assert.equal(settledOp?.result?.reason, "execution_owner_dead");
      assert.equal(succLedger.activeById.has(pendingOpId), false, "settled dead-owner op must exit activeById");
    } finally {
      succLedger.stopMigration();
    }

    await shim.close();
    shim = undefined;
    await centralOperator("stop", { runtimeBase: f.runtimeBase }).catch(() => {});
  } finally {
    t.mock.restoreAll();
    if (shim) await shim.close().catch(() => {});
    for (const pid of spawnedPids) await killSpawnedPid(pid);
    f.cleanup();
  }
});

test("T3.1b: eviction guards refuse active transactions (BARRIER/FROZEN/SUCCESSOR_FAILED) and closed writer gate without signaling, and healthy alternate generation is reused", { ...linux, timeout: 30_000 }, async () => {
  const f = mkFixture("h2a-l3-t31b-");
  const spawnedPids = new Set();
  try {
    assert.equal(typeof admission.probeOwnerHealth, "function", "probeOwnerHealth must be exported from admission.js");
    assert.equal(typeof admission.evictUnresponsiveOwnerLocked, "function", "evictUnresponsiveOwnerLocked must be exported from admission.js");

    // Spawn a real frozen child so we can prove 0 signals are sent when guards refuse
    const victim = spawn(process.execPath, ["-e", "setInterval(() => {}, 10000);"], { stdio: "ignore" });
    spawnedPids.add(victim.pid);
    const victimProc = admission.observeProcess(victim.pid);
    assert.ok(Number.isSafeInteger(victimProc.startTime));
    const frame = admission.currentIdentity();
    const victimIdentity = { ...frame, pid: victim.pid, startTime: victimProc.startTime };

    const authority = await admission.prepareAuthority({
      directory: f.stateDir,
      root: f.root,
      physicalPrefix: f.dir,
      frame
    });
    establishWriterControl(f.root, authority.stateDirectory);

    // Pick a closed loopback port so ping returns dead/unresponsive
    const srv = createNetServer();
    srv.listen(0, "127.0.0.1");
    await once(srv, "listening");
    const closedPort = srv.address().port;
    await new Promise((r) => srv.close(r));

    const victimGen = randomUUID();
    const victimMarkerDoc = {
      schemaVersion: 2,
      service: "h2a-mcp-central",
      namespaceId: authority.domain.namespaceId,
      stateDirectory: authority.stateDirectory,
      prefixId: authority.domain.prefixId,
      endpoint: `http://127.0.0.1:${closedPort}/mcp`,
      endpointMode: "discovered",
      generation: victimGen,
      publicationEpoch: { bootId: frame.bootId, counter: 1 },
      processIdentity: victimIdentity,
      predecessorGeneration: null,
      root: authority.domain.canonicalRoot,
      uid: process.getuid(),
      pid: victim.pid,
      startedAt: new Date(Date.now() - 30_000).toISOString(),
      packageVersion: "0.98.11",
      buildId: "test-build",
      manifestDigest: digest({ test: 1 }),
      protocol: 2,
      handoverProtocol: 1,
      handoverCapabilities: {
        managedImage: false,
        endpointPinned: false,
        restrictions: [],
        primitives: [],
        attachTransfer: false,
        liveCoordinator: false
      },
      mcpProtocolVersions: ["2025-06-18"],
      descriptorDigest: digest({ tools: [] }),
      contractDigest: digest({ tools: [] }),
      state: "ready",
      token: randomUUID(),
      authKeyReference: authority.authKeyReference
    };
    const oldMarker = publishState(f.markerPath, victimMarkerDoc, "marker");

    const lock = await acquirePreclaim(authority.domain, frame, authority.lockKey, classifyDurableProcFrame);
    try {
      // 1. Active transactions in BARRIER, FROZEN, SUCCESSOR_FAILED must refuse without signaling
      for (const txState of ["BARRIER", "FROZEN", "SUCCESSOR_FAILED"]) {
        const txFile = `transaction-${txState.toLowerCase()}.json`;
        const txDoc = {
          schemaVersion: 1,
          revision: 1,
          component: "mcp",
          upgradeId: "upg-1",
          handoverId: "h-1",
          transactionEpoch: 1,
          mode: "cold-stop",
          source: {
            generation: victimGen,
            publicationEpoch: { bootId: frame.bootId, counter: 1 },
            processIdentity: victimIdentity,
            packageVersion: "0.98.11",
            buildId: "test-build",
            manifestDigest: digest({ test: 1 })
          },
          target: {
            packageVersion: "0.98.11",
            buildId: "test-build-2",
            manifestDigest: digest({ test: 2 }),
            entrypoint: BIN
          },
          coordinator: frame,
          controllerEpoch: 1,
          inventoryRevision: 1,
          state: txState,
          barrierDeadline: null,
          precheckEvidenceDigest: null,
          checkpointReferences: [],
          stepResults: {},
          successorReservation: null
        };
        const txPath = join(authority.stateDirectory, txFile);
        const existingTx = readState(txPath, "componentTransaction");
        if (existingTx) replaceState(txPath, { ...txDoc, revision: existingTx.value.revision + 1 }, "componentTransaction", existingTx);
        else publishState(txPath, txDoc, "componentTransaction");

        const controlPath = join(authority.stateDirectory, "component-control.json");
        const existingControl = readState(controlPath, "componentControl");
        const controlDoc = {
          schemaVersion: 1,
          revision: (existingControl?.value.revision ?? 0) + 1,
          activeTransaction: txFile,
          sourceGeneration: victimGen,
          ownerIdentity: victimIdentity,
          ownerState: "ACTIVE",
          transactionEpoch: 1,
          operatorStopCommitted: false,
          operatorStopped: false
        };
        if (existingControl) replaceState(controlPath, controlDoc, "componentControl", existingControl);
        else publishState(controlPath, controlDoc, "componentControl");

        await assert.rejects(
          () => admission.evictUnresponsiveOwnerLocked(authority, oldMarker, { finalPingTimeoutMs: 100 }),
          /eviction_refused_active_transaction/,
          `tx state ${txState} must refuse eviction`
        );
        assert.equal(admission.ownerLiveness(victimMarkerDoc, frame), "alive", `victim must remain alive on ${txState}`);
      }

      // Clear active transaction, set writerControl.gate = 'BARRIER' -> must refuse without signaling
      const controlPath = join(authority.stateDirectory, "component-control.json");
      const curControl = readState(controlPath, "componentControl");
      replaceState(controlPath, { ...curControl.value, revision: curControl.value.revision + 1, activeTransaction: null }, "componentControl", curControl);
      updateWriterControl(f.root, { gate: "BARRIER", handoverId: "h-gate" });

      await assert.rejects(
        () => admission.evictUnresponsiveOwnerLocked(authority, oldMarker, { finalPingTimeoutMs: 100 }),
        /eviction_refused_writer_gate_closed/
      );
      assert.equal(admission.ownerLiveness(victimMarkerDoc, frame), "alive", "victim must remain alive when writer gate is BARRIER");
      updateWriterControl(f.root, { gate: "OPEN", handoverId: null });
    } finally {
      await lock.release();
    }

    // 2. Alternate healthy generation answering ping must reuse without signaling (B-08)
    const altGen = randomUUID();
    const pingSrv = createHttpServer((req, res) => {
      if (req.url === "/_h2a-central/ping") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ generation: altGen }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    pingSrv.listen(0, "127.0.0.1");
    await once(pingSrv, "listening");
    try {
      const altEndpoint = `http://127.0.0.1:${pingSrv.address().port}/mcp`;
      const altMarkerDoc = {
        ...victimMarkerDoc,
        generation: altGen,
        publicationEpoch: { bootId: frame.bootId, counter: 2 },
        endpoint: altEndpoint,
        startedAt: new Date().toISOString()
      };
      const curMarker = admission.readMarkerObservation(f.markerPath);
      replaceState(f.markerPath, altMarkerDoc, "marker", curMarker);

      // Probe using stale observedMarker pointing at altEndpoint with old generation
      const staleObserved = { ...oldMarker, value: { ...victimMarkerDoc, endpoint: altEndpoint } };
      const probe = await admission.probeOwnerHealth(f.markerPath, staleObserved, authority, {
        pingTimeoutMs: 500,
        pingAttempts: 2,
        pingBackoffMs: 50
      });
      assert.equal(probe.status, "healthy", "healthy alternate generation must be reused");
      assert.equal(probe.marker.generation, altGen);
      assert.equal(admission.ownerLiveness(victimMarkerDoc, frame), "alive", "zero signal sent when reusing healthy alternate generation");
    } finally {
      await new Promise((r) => pingSrv.close(r));
    }
  } finally {
    for (const pid of spawnedPids) await killSpawnedPid(pid);
    f.cleanup();
  }
});

test("T3.2: /_h2a-central/health responds < 50ms and initialize + tools/list respond < 200ms while ledgerMigrationComplete === false (3,000 ops)", { ...linux, timeout: 45_000 }, async (t) => {
  const f = mkFixture("h2a-l3-t32-");
  let server;
  try {
    seedCompletedOperations(f.stateDir, 3_000);
    // Match L1 T1.1: mock fsyncSync so the latency bound measures event-loop
    // responsiveness during background migration without host disk-flush jitter.
    t.mock.method(fs, "fsyncSync", () => {});
    syncBuiltinESMExports();
    server = await startCentralMcpServer({
      root: f.root,
      runtimeBase: f.runtimeBase,
      physicalPrefix: f.dir,
      env: f.env
    });
    assert.equal(server.kind, "started");

    // 1. /_h2a-central/health clear loopback < 50ms immediately on listen
    const h0 = performance.now();
    const healthRes = await fetch(new URL("/_h2a-central/health", server.endpoint));
    const healthMs = performance.now() - h0;
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ok, true);
    assert.equal(health.generation, server.generation);
    assert.equal(health.pid, process.pid);
    assert.equal(health.state, "ready");
    assert.equal(health.ledgerMigrationComplete, false, "3,000-op migration must still be in background");
    assert.ok(healthMs < 50, `/_h2a-central/health took ${healthMs.toFixed(1)}ms, expected < 50ms`);

    // 2. initialize + notifications/initialized + tools/list in < 200ms BEFORE ledgerMigrationComplete === true
    const marker = JSON.parse(readFileSync(server.markerPath, "utf8"));
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-h2a-workspace": encodeURIComponent(f.workspace)
    };
    const i0 = performance.now();
    const initRes = await authenticatedHttpRequest(server.markerPath, marker, server.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "t32-client", version: "1.0.0" }
        }
      })
    });
    const initMs = performance.now() - i0;
    assert.equal(initRes.status, 200);
    const sessionId = initRes.headers.get("mcp-session-id");
    assert.ok(sessionId);
    await initRes.text();

    const notifRes = await authenticatedHttpRequest(server.markerPath, marker, server.endpoint, {
      method: "POST",
      headers: { ...headers, "mcp-session-id": sessionId },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    });
    assert.ok(notifRes.ok);

    const l0 = performance.now();
    const listRes = await authenticatedHttpRequest(server.markerPath, marker, server.endpoint, {
      method: "POST",
      headers: { ...headers, "mcp-session-id": sessionId },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    });
    const listMs = performance.now() - l0;
    const initAndListMs = initMs + listMs;
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.ok(Array.isArray(listBody.result?.tools) && listBody.result.tools.length > 0);
    // Verify migration is STILL incomplete right after initialize + tools/list
    const midHealth = await (await fetch(new URL("/_h2a-central/health", server.endpoint))).json();
    assert.equal(midHealth.ledgerMigrationComplete, false, "initialize + tools/list must complete before ledgerMigrationComplete === true");
    console.error(`[L3 T3.2] healthMs=${healthMs.toFixed(1)} initMs=${initMs.toFixed(1)} listMs=${listMs.toFixed(1)} initAndListMs=${initAndListMs.toFixed(1)}`);
    assert.ok(initMs < 200, `initialize took ${initMs.toFixed(1)}ms, expected < 200ms`);
    assert.ok(initAndListMs < 200, `initialize + tools/list took ${initAndListMs.toFixed(1)}ms (init=${initMs.toFixed(1)}ms, list=${listMs.toFixed(1)}ms), expected < 200ms`);

    // Confirm migration finishes and health + status both flip to ledgerMigrationComplete: true
    const deadline = Date.now() + 30_000;
    let finalHealth;
    while (Date.now() < deadline) {
      const r = await fetch(new URL("/_h2a-central/health", server.endpoint));
      finalHealth = await r.json();
      if (finalHealth.ledgerMigrationComplete === true) break;
      await delay(50);
    }
    assert.equal(finalHealth?.ledgerMigrationComplete, true);

    const statusRes = await authenticatedHttpRequest(server.markerPath, marker, new URL("/_h2a-central/status", server.endpoint));
    assert.equal(statusRes.status, 200);
    const status = await statusRes.json();
    assert.equal(status.ledgerMigrationComplete, true);
  } finally {
    if (server?.kind === "started") await server.stop();
    t.mock.restoreAll();
    syncBuiltinESMExports();
    f.cleanup();
  }
});

test("T3.3a: --supervised state machine enters STANDBY on healthy central, takes over SERVING after SIGSTOP, and exits 0 cleanly on SIGTERM", { ...linux, timeout: 45_000 }, async () => {
  const f = mkFixture("h2a-l3-t33a-");
  const spawnedPids = new Set();
  const ac = new AbortController();
  let supPromise;
  try {
    // 1. Start central #1
    const child1 = spawn(
      process.execPath,
      [BIN, "mcp-central-serve", "--root", f.root, "--runtime-base", f.runtimeBase],
      { cwd: f.workspace, env: f.env, stdio: ["ignore", "pipe", "pipe"] }
    );
    spawnedPids.add(child1.pid);
    const marker1 = await waitForMarker(f.markerPath, 15_000, (m) => m.pid === child1.pid);

    // 2. Launch runCentralMcpServe --supervised facing healthy central #1
    let stderr = "";
    const states = [];
    let supExited = false;
    supPromise = runCentralMcpServe(
      { supervised: "true", root: f.root, "runtime-base": f.runtimeBase },
      {
        stderr: { write(chunk) { stderr += String(chunk); return true; } },
        env: f.env,
        signal: ac.signal,
        standbyPollMs: 250,
        probeOptions: { startupGraceMs: 200, pingTimeoutMs: 400, pingAttempts: 2, pingBackoffMs: 50 },
        onStateChange: (s) => states.push(s)
      }
    ).then((code) => { supExited = true; return code; });

    // Wait for STANDBY and confirm it stays alive (0 exit / 0 restart loop)
    const sbDeadline = Date.now() + 5_000;
    while (!states.includes("STANDBY") && Date.now() < sbDeadline) await delay(25);
    assert.ok(states.includes("STANDBY"), `expected STANDBY state, got ${JSON.stringify(states)} stderr=${stderr}`);
    await delay(400);
    assert.equal(supExited, false, "supervised process must stay in STANDBY without exiting while central #1 is healthy");

    // 3. Freeze central #1 via SIGSTOP -> supervised must transition STANDBY -> ACQUIRING -> evict -> SERVING
    process.kill(child1.pid, "SIGSTOP");

    const srvDeadline = Date.now() + 10_000;
    while (!states.includes("SERVING") && Date.now() < srvDeadline) await delay(50);
    assert.ok(states.includes("SERVING"), `expected SERVING takeover after SIGSTOP, states=${JSON.stringify(states)} stderr=${stderr}`);
    assert.equal(admission.ownerLiveness(marker1, admission.currentIdentity()), "dead", "old SIGSTOP central must be evicted");

    const marker2 = JSON.parse(readFileSync(f.markerPath, "utf8"));
    assert.notEqual(marker2.generation, marker1.generation);
    assert.equal(marker2.pid, process.pid);

    // 4. Send abort (SIGTERM) -> clean STOPPING + marker removed + exit 0
    ac.abort();
    const exitCode = await supPromise;
    assert.equal(exitCode, 0, `expected clean exit 0 on SIGTERM, got ${exitCode} stderr=${stderr}`);
    assert.ok(states.includes("STOPPING"));
    assert.equal(existsSync(f.markerPath), false, "marker.json must be removed on clean STOPPING");
  } finally {
    ac.abort();
    if (supPromise) await supPromise.catch(() => {});
    for (const pid of spawnedPids) await killSpawnedPid(pid);
    f.cleanup();
  }
});

test("T3.3b: --supervised Worker watchdog detects Atomics.wait freeze of main thread with 0 clients and terminates in < 7s", { ...linux, timeout: 30_000 }, async () => {
  const f = mkFixture("h2a-l3-t33b-");
  const spawnedPids = new Set();
  try {
    const cliUrl = new URL("../dist/cli.js", import.meta.url).href;
    // Child script starts runCentralMcpServe --supervised, waits until SERVING, then freezes main thread with Atomics.wait(30s)
    const script = `
      import { runCentralMcpServe } from ${JSON.stringify(cliUrl)};
      const sab = new Int32Array(new SharedArrayBuffer(4));
      const code = await runCentralMcpServe(
        { supervised: "true", root: process.env.H2A_ROOT, "runtime-base": process.env.XDG_RUNTIME_DIR },
        {
          stderr: process.stderr,
          env: process.env,
          onStateChange(state) {
            if (state === "SERVING") {
              process.stdout.write("SERVING\\n");
              setTimeout(() => {
                process.stdout.write("FREEZING\\n");
                Atomics.wait(sab, 0, 0, 30_000);
              }, 100);
            }
          }
        }
      );
      process.exit(code);
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      cwd: f.workspace,
      env: f.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    spawnedPids.add(child.pid);

    let stdout = "";
    let stderr = "";
    let freezeAt = 0;
    const freezingReady = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`child never reached FREEZING: stdout=${stdout} stderr=${stderr}`)), 10_000);
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
        if (stdout.includes("FREEZING") && freezeAt === 0) {
          freezeAt = performance.now();
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", (code, sig) => {
        if (freezeAt === 0) {
          clearTimeout(timer);
          reject(new Error(`child exited before FREEZING: code=${code} sig=${sig} stderr=${stderr}`));
        }
      });
    });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });

    await freezingReady;
    const [code, signal] = await once(child, "close");
    const elapsedMs = performance.now() - freezeAt;

    console.error(`[L3 T3.3b] watchdogMs=${elapsedMs.toFixed(1)} code=${code} signal=${signal}`);
    assert.match(stderr, /event_loop_unresponsive \(watchdog\)/, `expected watchdog stderr message, got: ${stderr}`);
    assert.ok(elapsedMs < 7_000, `watchdog took ${elapsedMs.toFixed(1)}ms, expected < 7000ms`);
    assert.ok(
      code === 1 || signal === "SIGKILL",
      `expected failure exit (code=1 or SIGKILL for systemd Restart=on-failure), got code=${code} signal=${signal}`
    );

    // Also verify clean exit code 1 via parentPort when ping fails 3 times on an unblocked main thread
    const watchdogUrl = new URL("../dist/runtime/handover/supervisor-watchdog.js", import.meta.url).href;
    const unblockedScript = `
      import { startSupervisorWatchdog } from ${JSON.stringify(watchdogUrl)};
      startSupervisorWatchdog({ endpoint: "http://127.0.0.1:9/mcp", intervalMs: 100, timeoutMs: 100, maxFailures: 3 });
      setInterval(() => {}, 10_000);
    `;
    const child2 = spawn(process.execPath, ["--input-type=module", "-e", unblockedScript], {
      cwd: f.workspace,
      env: f.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    spawnedPids.add(child2.pid);
    let stderr2 = "";
    child2.stderr.on("data", (chunk) => { stderr2 += String(chunk); });
    const [code2, signal2] = await once(child2, "close");
    assert.equal(code2, 1, `unblocked main thread must exit with exact code 1, got code=${code2} signal=${signal2} stderr=${stderr2}`);
    assert.match(stderr2, /event_loop_unresponsive \(watchdog\)/);
  } finally {
    for (const pid of spawnedPids) await killSpawnedPid(pid);
    f.cleanup();
  }
});

test("T3.4: systemd unit contract and closed exit-code table (0 / 1 / 2 / 3)", { ...linux, timeout: 30_000 }, async () => {
  // 1. Validate contrib/systemd/h2a-mcp-central.service directives
  assert.equal(existsSync(SYSTEMD_UNIT_PATH), true, `missing systemd unit at ${SYSTEMD_UNIT_PATH}`);
  const unit = readFileSync(SYSTEMD_UNIT_PATH, "utf8");
  for (const directive of [
    "Type=simple",
    "Environment=H2A_MCP_CENTRAL=1",
    "Environment=NODE_OPTIONS=--max-old-space-size=384",
    "EnvironmentFile=-%h/.config/sentropic/h2a/central.env",
    "ExecStart=%h/.npm-global/bin/h2a mcp-central-serve --supervised",
    "Restart=on-failure",
    "RestartSec=2",
    "RestartPreventExitStatus=2 3",
    "TimeoutStopSec=15",
    "MemoryMax=512M",
    "StartLimitIntervalSec=60",
    "StartLimitBurst=5"
  ]) {
    assert.ok(unit.includes(directive), `systemd unit missing required directive: ${directive}`);
  }
  const execLine = unit.split("\n").find((l) => l.startsWith("ExecStart=")) ?? "";
  assert.equal(execLine.includes("--root"), false, "ExecStart must not hardcode --root");

  // 2. Unit-test every row of classifyCentralServeExitCode
  const { classifyCentralServeExitCode } = await import("../dist/cli.js");
  assert.equal(typeof classifyCentralServeExitCode, "function", "classifyCentralServeExitCode must be exported from cli.js");

  // Code 0: pause / normal stop
  assert.equal(classifyCentralServeExitCode(new Error("deferred_paused")), 0);

  // Code 2: permanent config / qualification errors
  for (const msg of [
    "prefix_owner_mismatch: /foo has mode 0777",
    "foreign_installation_authority",
    "authority_profile_unqualified",
    "authority_reference_invalid",
    "authority_reference_required",
    "authority_namespace_mismatch",
    "selected_entry_required",
    "legacy_prefix_mismatch",
    "successor_failed",
    'central MCP root must be an absolute path (received "relative/path")',
    "H2A_MCP_CENTRAL_ENDPOINT must be an absolute http URL with an explicit port"
  ]) {
    assert.equal(classifyCentralServeExitCode(new Error(msg)), 2, `expected exit 2 for: ${msg}`);
  }

  // Code 3: permanent disk / permissions errors
  for (const errno of ["EACCES", "EPERM", "EROFS", "ENOSPC", "EDQUOT", "EIO"]) {
    assert.equal(classifyCentralServeExitCode(Object.assign(new Error(`fs fail ${errno}`), { code: errno })), 3, `expected exit 3 for errno ${errno}`);
    assert.equal(classifyCentralServeExitCode(new Error("wrapped", { cause: Object.assign(new Error("inner"), { code: errno }) })), 3, `expected exit 3 for cause errno ${errno}`);
  }
  for (const msg of ["private_directory_required", "private_state_required", "private_lock_required"]) {
    assert.equal(classifyCentralServeExitCode(new Error(msg)), 3, `expected exit 3 for: ${msg}`);
  }

  // Code 1: transient / crash / freeze
  for (const msg of [
    "event_loop_unresponsive",
    "authority_lock_unavailable",
    "startup_reserved",
    "mutation_lock_unavailable",
    "owner_liveness_unknown",
    "eviction_refused_active_transaction",
    "eviction_refused_writer_gate_closed",
    "some_transient_error"
  ]) {
    assert.equal(classifyCentralServeExitCode(new Error(msg)), 1, `expected exit 1 for: ${msg}`);
  }

  // 3. End-to-end runCentralMcpServe exit-code checks
  const f = mkFixture("h2a-l3-t34-");
  try {
    // (a) Relative --root -> exit 2
    let errBuf = "";
    const relCode = await runCentralMcpServe(
      { supervised: "true", root: "relative/store", "runtime-base": f.runtimeBase },
      { stderr: { write(c) { errBuf += String(c); return true; } }, env: f.env }
    );
    assert.equal(relCode, 2, `relative --root must exit 2, got ${relCode} (${errBuf})`);

    // (b) operator-stop.json paused === true -> exit 0
    publishState(join(f.stateDir, "operator-stop.json"), {
      schemaVersion: 1,
      revision: 1,
      paused: true,
      requestedAt: Date.now(),
      generation: null
    }, "pause");
    errBuf = "";
    const pausedCode = await runCentralMcpServe(
      { supervised: "true", root: f.root, "runtime-base": f.runtimeBase },
      { stderr: { write(c) { errBuf += String(c); return true; } }, env: f.env }
    );
    assert.equal(pausedCode, 0, `paused === true must exit 0, got ${pausedCode} (${errBuf})`);

    // (c) private_directory_required (0755 state dir) -> exit 3
    rmSync(join(f.stateDir, "operator-stop.json"), { force: true });
    chmodSync(f.stateDir, 0o755);
    errBuf = "";
    const permCode = await runCentralMcpServe(
      { supervised: "true", root: f.root, "runtime-base": f.runtimeBase },
      { stderr: { write(c) { errBuf += String(c); return true; } }, env: f.env }
    );
    assert.equal(permCode, 3, `private_directory_required must exit 3, got ${permCode} (${errBuf})`);
    chmodSync(f.stateDir, 0o700);
  } finally {
    f.cleanup();
  }
});

test("T3.5: npm install -g under umask 0002 (0775 UPG prefix) starts mcp-central-serve without chmod go-w", { ...linux, timeout: 45_000 }, async () => {
  const f = mkFixture("h2a-l3-t35-");
  let server;
  try {
    const upg = await import("../dist/runtime/handover/upg-trust.js");
    assert.equal(typeof upg.isExclusiveUserPrivateGroup, "function");
    assert.equal(typeof upg.assertTrustedPrefixDirectory, "function");

    // Pack a lightweight @sentropic/h2a wrapper tarball and install -g under umask 0002
    const pkgSrc = join(f.dir, "pkg-src");
    const pkgDist = join(pkgSrc, "dist");
    mkdirSync(pkgDist, { recursive: true, mode: 0o755 });
    writeFileSync(
      join(pkgSrc, "package.json"),
      JSON.stringify({ name: "@sentropic/h2a", version: "0.98.11", bin: { h2a: "dist/bin.js" } }, null, 2) + "\n",
      { mode: 0o644 }
    );
    writeFileSync(join(pkgDist, "bin.js"), `#!/usr/bin/env node\nimport ${JSON.stringify(new URL("../dist/bin.js", import.meta.url).href)};\n`, { mode: 0o755 });

    const npmCache = join(f.dir, "npm-cache");
    const userConfig = join(f.dir, "npmrc");
    const globalConfig = join(f.dir, "global-npmrc");
    mkdirSync(npmCache, { recursive: true, mode: 0o700 });
    writeFileSync(userConfig, "");
    writeFileSync(globalConfig, "");
    const npmEnv = {
      ...f.env,
      npm_config_cache: npmCache,
      npm_config_userconfig: userConfig,
      npm_config_globalconfig: globalConfig,
      npm_config_update_notifier: "false"
    };
    for (const k of Object.keys(npmEnv)) {
      if (/^npm_config_(?:umask|prefix)$/i.test(k)) delete npmEnv[k];
    }

    const prevMask1 = process.umask(0o022);
    let tarballPath;
    try {
      const packRes = spawnSync("npm", ["pack", "--offline", "--json", "--pack-destination", f.dir], {
        cwd: pkgSrc,
        env: npmEnv,
        encoding: "utf8",
        timeout: 30_000
      });
      assert.equal(packRes.status, 0, `npm pack failed: ${packRes.stderr}`);
      tarballPath = join(f.dir, JSON.parse(packRes.stdout)[0].filename);
    } finally {
      process.umask(prevMask1);
    }

    const prefix = join(f.home, ".npm-global");
    const prevMask2 = process.umask(0o002);
    try {
      mkdirSync(prefix, { recursive: true, mode: 0o777 });
      const installRes = spawnSync(
        "npm",
        ["install", "-g", "--prefix", prefix, "--offline", "--no-audit", "--no-fund", tarballPath],
        { cwd: f.dir, env: npmEnv, encoding: "utf8", timeout: 30_000 }
      );
      assert.equal(installRes.status, 0, `npm install -g failed: ${installRes.stderr}`);
    } finally {
      process.umask(prevMask2);
    }

    const prefixSt = statSync(prefix);
    assert.equal(prefixSt.mode & 0o777, 0o775, "prefix created under umask 0002 has mode 0775");

    if (upg.isExclusiveUserPrivateGroup(prefixSt)) {
      server = await startCentralMcpServer({
        root: f.root,
        runtimeBase: f.runtimeBase,
        physicalPrefix: prefix,
        env: f.env
      });
      assert.equal(server.kind, "started", "mcp-central-serve must start under 0775 UPG prefix without chmod go-w");
      const ping = await centralMcpPing(server.endpoint, 1_000);
      assert.deepEqual(ping, { kind: "generation", generation: server.generation });
    } else {
      await assert.rejects(
        () => startCentralMcpServer({ root: f.root, runtimeBase: f.runtimeBase, physicalPrefix: prefix, env: f.env }),
        /prefix_owner_mismatch/
      );
    }
  } finally {
    if (server?.kind === "started") await server.stop();
    f.cleanup();
  }
});

test("T3.6: centralMcpPing parity between packages/h2a and packages/h2a-runtime", { timeout: 15_000 }, async () => {
  // 1. Valid HTTP 200 -> generation
  const okSrv = createHttpServer((req, res) => {
    if (req.url === "/_h2a-central/ping") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ generation: "gen-parity-1" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  okSrv.listen(0, "127.0.0.1");
  await once(okSrv, "listening");
  const okUrl = `http://127.0.0.1:${okSrv.address().port}/mcp`;

  // 2. Closed port -> ECONNREFUSED -> dead
  const deadSrv = createNetServer();
  deadSrv.listen(0, "127.0.0.1");
  await once(deadSrv, "listening");
  const deadUrl = `http://127.0.0.1:${deadSrv.address().port}/mcp`;
  await new Promise((r) => deadSrv.close(r));

  // 3. Stalled TCP listener -> timeout -> ambiguous
  const stalledSockets = new Set();
  const stallSrv = createNetServer((s) => { stalledSockets.add(s); });
  stallSrv.listen(0, "127.0.0.1");
  await once(stallSrv, "listening");
  const stallUrl = `http://127.0.0.1:${stallSrv.address().port}/mcp`;

  // 4. Non-200 HTTP 503 -> intentional divergence documented in L3.md §3.1
  const errSrv = createHttpServer((_req, res) => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "busy" }));
  });
  errSrv.listen(0, "127.0.0.1");
  await once(errSrv, "listening");
  const errUrl = `http://127.0.0.1:${errSrv.address().port}/mcp`;

  try {
    assert.deepEqual(await centralMcpPing(okUrl, 1_000), { kind: "generation", generation: "gen-parity-1" });
    assert.deepEqual(await runtimeCentralMcpPing(okUrl, 1_000), { kind: "generation", generation: "gen-parity-1" });

    assert.deepEqual(await centralMcpPing(deadUrl, 500), { kind: "dead" });
    assert.deepEqual(await runtimeCentralMcpPing(deadUrl, 500), { kind: "dead" });

    assert.deepEqual(await centralMcpPing(stallUrl, 200), { kind: "ambiguous" });
    assert.deepEqual(await runtimeCentralMcpPing(stallUrl, 200), { kind: "ambiguous" });

    await assert.rejects(() => centralMcpPing("http://10.0.0.1:1/mcp"), /absolute http URL/);
    await assert.rejects(() => runtimeCentralMcpPing("http://10.0.0.1:1/mcp"), /absolute http URL/);

    // Documented v2 vs v1 divergence on HTTP non-200
    assert.deepEqual(await centralMcpPing(errUrl, 500), { kind: "ambiguous" });
    assert.deepEqual(await runtimeCentralMcpPing(errUrl, 500), { kind: "dead" });
  } finally {
    for (const s of stalledSockets) s.destroy();
    await Promise.all([
      new Promise((r) => okSrv.close(r)),
      new Promise((r) => stallSrv.close(r)),
      new Promise((r) => errSrv.close(r))
    ]);
  }
});
