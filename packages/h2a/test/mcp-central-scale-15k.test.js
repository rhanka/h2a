import assert from "node:assert/strict";
import fs, { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalBytes, digest, sign } from "../dist/runtime/handover/wire.js";
import * as admission from "../dist/runtime/handover/admission.js";
import { authenticatedHttpRequest } from "../dist/runtime/handover/authenticated-http.js";
import { startCentralMcpServer } from "../dist/runtime/mcp-central.js";
import { randomUUID } from "node:crypto";

function mkFixture(prefix = "h2a-l5a-") {
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
    dir, home, runtimeBase, root, workspace, stateDir,
    markerPath: join(stateDir, "marker.json"),
    env: {
      ...process.env, HOME: home, XDG_RUNTIME_DIR: runtimeBase,
      XDG_CONFIG_HOME: join(home, ".config"), XDG_STATE_HOME: join(home, ".local", "state"),
      XDG_DATA_HOME: join(home, ".local", "share"), XDG_CACHE_HOME: join(home, ".cache"),
      H2A_ROOT: root, H2A_MCP_CENTRAL: "1", TMPDIR: tmpdir(), TMP: tmpdir(), TEMP: tmpdir(),
    },
    cleanup() { rmSync(dir, { recursive: true, force: true }); },
  };
}

function seedL5A(f, { ops = 15500, effects = 15500, gens = 1450 } = {}) {
  const execOwner = { ...admission.currentIdentity(), pid: 999991, startTime: 1 };
  const oldGen = "11111111-1111-4111-8111-111111111111";
  for (let i = 0; i < ops; i++) {
    const operationId = `l5a-op-${i}`;
    const doc = {
      schemaVersion: 1, revision: 2, operationId,
      attachmentId: `l5a-att-${i % 16}`, ownerGeneration: oldGen,
      executionOwner: execOwner, kind: "call", state: "completed", result: { completed: true, idx: i },
    };
    writeFileSync(join(f.stateDir, `operation-${digest(operationId).slice(7)}.json`), Buffer.concat([canonicalBytes(doc), Buffer.from("\n")]), { mode: 0o600 });
  }
  for (let i = 0; i < 3; i++) {
    const operationId = `l5a-pending-${i}`;
    const doc = {
      schemaVersion: 1, revision: 1, operationId, attachmentId: "l5a-pending-att",
      ownerGeneration: oldGen, executionOwner: execOwner, kind: "call", state: "pending", result: null,
    };
    writeFileSync(join(f.stateDir, `operation-${digest(operationId).slice(7)}.json`), Buffer.concat([canonicalBytes(doc), Buffer.from("\n")]), { mode: 0o600 });
  }
  for (let i = 0; i < effects; i++) {
    const operationId = `l5a-op-${i}`;
    const result = { completed: true, idx: i };
    const eff = { schemaVersion: 1, operationId, attachmentId: `l5a-att-${i % 16}`, destination: "current-owner", result };
    writeFileSync(join(f.stateDir, `effect-${digest({ operationId, result }).slice(7)}.json`), Buffer.concat([canonicalBytes(eff), Buffer.from("\n")]), { mode: 0o600 });
  }
  const key = Buffer.alloc(32, 7);
  for (let i = 0; i < gens; i++) {
    const gen = randomUUID();
    const sourceMarker = {
      schemaVersion: 2, service: "h2a-mcp-central", namespaceId: "ns-l5a",
      prefixId: `sha256:${"a".repeat(64)}`, uid: typeof process.getuid === "function" ? process.getuid() : 1000,
      stateDirectory: f.stateDir, endpoint: "http://127.0.0.1:43210/mcp", endpointMode: "discovered",
      generation: gen, publicationEpoch: { bootId: "l5a-seed-boot", counter: i + 1 }, predecessorGeneration: null,
      root: f.root, pid: 999999, startedAt: "2026-11-21T00:00:00.000Z",
      processIdentity: { ...admission.currentIdentity(), pid: 999991, startTime: 1 },
      packageVersion: "0.98.11", buildId: "seed", manifestDigest: `sha256:${"b".repeat(64)}`,
      protocol: 2, handoverProtocol: 1,
      handoverCapabilities: { managedImage: false, endpointPinned: false, restrictions: [], primitives: [], attachTransfer: false, liveCoordinator: false },
      mcpProtocolVersions: ["2025-06-18"], descriptorDigest: `sha256:${"c".repeat(64)}`, contractDigest: `sha256:${"d".repeat(64)}`,
      state: "ready", token: randomUUID(), authKeyReference: "authentication-key.json",
    };
    const value = {
      schemaVersion: 1, purpose: "generation-ended", generation: gen,
      source: sourceMarker, markerDigest: digest(sourceMarker), endedAt: 1700000000000 + i,
    };
    const proof = {
      ...value,
      mac: sign(key, "compatibility", { service: sourceMarker.service, namespaceId: sourceMarker.namespaceId, generation: gen }, value),
    };
    writeFileSync(join(f.stateDir, `generation-end-${gen}.json`), Buffer.concat([canonicalBytes(proof), Buffer.from("\n")]), { mode: 0o600 });
  }
  const regDir = join(f.root, "registry");
  mkdirSync(regDir, { recursive: true, mode: 0o700 });
  const lines = [];
  for (let i = 0; i < 27000; i++) lines.push(JSON.stringify({ instance: `l5a-inst-${i % 100}`, type: "added", at: "now" }));
  writeFileSync(join(regDir, "instances.jsonl"), `${lines.join("\n")}\n`, { mode: 0o600 });
  writeFileSync(join(regDir, "keys.jsonl"), `${lines.join("\n")}\n`, { mode: 0o600 });
  const negDir = join(f.root, "negotiations");
  mkdirSync(negDir, { recursive: true, mode: 0o700 });
  for (let i = 0; i < 1000; i++) mkdirSync(join(negDir, `drive-consent__pair-${i}`), { recursive: true, mode: 0o700 });
  const dirFd = fs.openSync(f.stateDir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
}

test("L5A scale: 15 500+ operations C5.1-C5.6 (preparation budget separate)", { timeout: 90_000 }, async (t) => {
  const f = mkFixture();
  t.after(() => f.cleanup());
  const prepStart = Date.now();
  seedL5A(f);
  const prepMs = Date.now() - prepStart;
  assert.ok(prepMs < 15_000, `preparation < 15s (took ${prepMs}ms)`);
  const saved = { HOME: process.env.HOME, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, H2A_ROOT: process.env.H2A_ROOT };
  for (const [k, v] of Object.entries(f.env)) process.env[k] = v;
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  let rssPeak = process.memoryUsage().rss;
  const rssTimer = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > rssPeak) rssPeak = rss;
  }, 50);
  rssTimer.unref();
  const cpuStart = process.cpuUsage();
  const listenStart = Date.now();
  const server = await startCentralMcpServer({ root: f.root, runtimeBase: f.runtimeBase, physicalPrefix: f.dir, env: f.env });
  const listenMs = Date.now() - listenStart;
  t.after(async () => { clearInterval(rssTimer); await server.stop().catch(() => {}); });
  assert.equal(server.kind, "started");
  assert.ok(listenMs < 500, `C5.1 start < 500ms (took ${listenMs}ms)`);
  const healthRes = await fetch(new URL("/_h2a-central/health", server.endpoint));
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.ledgerMigrationComplete, false, "C5.2 migration running at start");
  const pingRes = await fetch(new URL("/_h2a-central/ping", server.endpoint));
  assert.equal(pingRes.status, 200);
  const marker = JSON.parse(readFileSync(server.markerPath, "utf8"));
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "x-h2a-workspace": encodeURIComponent(f.workspace) };
  const initRes = await authenticatedHttpRequest(server.markerPath, marker, server.endpoint, {
    method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "l5a", version: "1" } } }),
  });
  assert.equal(initRes.status, 200);
  const sessionId = initRes.headers.get("mcp-session-id");
  assert.ok(sessionId);
  await initRes.text();
  const notifRes = await authenticatedHttpRequest(server.markerPath, marker, server.endpoint, {
    method: "POST", headers: { ...headers, "mcp-session-id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  assert.ok(notifRes.ok);
  const listRes = await authenticatedHttpRequest(server.markerPath, marker, server.endpoint, {
    method: "POST", headers: { ...headers, "mcp-session-id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  assert.equal(listRes.status, 200);
  const midHealth = await (await fetch(new URL("/_h2a-central/health", server.endpoint))).json();
  const statusMidRes = await authenticatedHttpRequest(server.markerPath, marker, new URL("/_h2a-central/status", server.endpoint));
  assert.equal(statusMidRes.status, 200);
  const statusMid = await statusMidRes.json();
  // CI ceiling < 180ms (T3.2 precedent); strict p99 < 75ms moves to the quiet
  // L5 bench on the real machine (ci-wallclock-report §3 moved from CI).
  assert.ok(statusMid.eventLoopLagMs.p99 < 180, `C5.3 lag p99 < 180ms CI ceiling (got ${statusMid.eventLoopLagMs?.p99}); strict < 75ms in bench`);
  // CI ceiling 30s (shared runner); strict < 10s moves to the quiet L5 bench.
  const deadline = Date.now() + 30_000;
  let finalHealth = midHealth;
  while (Date.now() < deadline) {
    const r = await fetch(new URL("/_h2a-central/health", server.endpoint));
    finalHealth = await r.json();
    if (finalHealth.ledgerMigrationComplete === true) break;
    await new Promise((r2) => setTimeout(r2, 100));
  }
  assert.equal(finalHealth.ledgerMigrationComplete, true, "C5.3 migration < 30s CI ceiling (strict < 10s in bench)");
  const opsLeft = fs.readdirSync(f.stateDir).filter((n) => n.startsWith("operation-")).length;
  assert.ok(opsLeft <= 67, `C5.4 <= 67 ops at root (got ${opsLeft})`);
  const gensLeft = fs.readdirSync(f.stateDir).filter((n) => n.startsWith("generation-end-")).length;
  assert.ok(gensLeft <= 64, `C5.4 <= 64 gens at root (got ${gensLeft})`);
  const cpuDiff = process.cpuUsage(cpuStart);
  const cpuMs = (cpuDiff.user + cpuDiff.system) / 1000;
  assert.ok(cpuMs < 15_000, `C5.5 CPU sanity (got ${cpuMs.toFixed(0)}ms)`);
  const rssMB = rssPeak / (1024 * 1024);
  assert.ok(rssMB < 256, `C5.6 RSS < 256MiB (got ${rssMB.toFixed(1)}MiB)`);
});
