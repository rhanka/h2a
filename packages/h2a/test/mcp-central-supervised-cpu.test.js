import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authenticatedHttpRequest } from "../dist/runtime/handover/authenticated-http.js";
import { startCentralMcpServer } from "../dist/runtime/mcp-central.js";

function isolated() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-supervised-cpu-"));
  chmodSync(dir, 0o700);
  const home = join(dir, "home");
  const xdgRuntime = join(dir, "runtime");
  const root = join(dir, "root");
  for (const d of [home, xdgRuntime, root]) {
    mkdirSync(d, { recursive: true, mode: 0o700 });
    chmodSync(d, 0o700);
  }
  return { dir, home, xdgRuntime, root, cleanup() { rmSync(dir, { recursive: true, force: true }); } };
}

async function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { return await fn(); }
  finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("B-4: supervised central (idleTimeoutMs 0) burns no steady CPU (own CPU time)", { timeout: 60_000 }, async () => {
  const iso = isolated();
  try {
    await withEnv({ HOME: iso.home, XDG_RUNTIME_DIR: iso.xdgRuntime, H2A_ROOT: iso.root, H2A_MCP_CENTRAL: "1" }, async () => {
      // Supervised mode: idleTimeoutMs 0 disables quiet retirement, but the
      // B-1 idle fast-path still skips the flock spawn when revision is clean
      // and no poll is due — own CPU over 10s idle must stay well under the
      // old per-tick spawn floor. CI ceiling 200ms (shared runner).
      const central = await startCentralMcpServer({ root: iso.root, runtimeBase: iso.xdgRuntime, idleTimeoutMs: 0, sessionLeaseMs: 90_000 });
      try {
        await new Promise((r) => setTimeout(r, 2_000));
        const startCpu = process.cpuUsage();
        await new Promise((r) => setTimeout(r, 10_000));
        const diff = process.cpuUsage(startCpu);
        const cpuMs = (diff.user + diff.system) / 1000;
        assert.ok(cpuMs < 200, `supervised idle own CPU ${cpuMs.toFixed(1)}ms over 10s wall must be < 200ms CI ceiling`);
      } finally {
        await central.stop();
      }
    });
  } finally { iso.cleanup(); }
});

test("B-4 residual: supervised central with N attached sessions (usual on-duty posture)", { timeout: 60_000 }, async (t) => {
  const iso = isolated();
  // NB-10: one ordered teardown — stop the central first, delete the dir after.
  let central = null;
  try {
    await withEnv({ HOME: iso.home, XDG_RUNTIME_DIR: iso.xdgRuntime, H2A_ROOT: iso.root, H2A_MCP_CENTRAL: "1" }, async () => {
      const workspace = join(iso.dir, "workspace");
      mkdirSync(workspace, { recursive: true, mode: 0o700 });
      central = await startCentralMcpServer({ root: iso.root, runtimeBase: iso.xdgRuntime, idleTimeoutMs: 0, sessionLeaseMs: 90_000 });
      try {
        await new Promise((r) => setTimeout(r, 2_000));
        const marker = JSON.parse(readFileSync(central.markerPath, "utf8"));
        const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "x-h2a-workspace": encodeURIComponent(workspace) };
        // Attach 5 sessions (initialize + initialized); leases (90s) cover
        // the 10s measure window. With sessions present the B-1 idle
        // fast-path does not apply: every sweep takes the full flock-backed
        // lock path (2 flock spawns per tick), the usual on-duty posture.
        const N = 5;
        for (let i = 0; i < N; i++) {
          const initRes = await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
            method: "POST", headers,
            body: JSON.stringify({ jsonrpc: "2.0", id: 100 + i, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "supervised-n-sessions", version: "1" } } }),
          });
          assert.equal(initRes.status, 200, `session ${i}: initialize returns 200`);
          const sessionId = initRes.headers.get("mcp-session-id");
          assert.ok(sessionId, `session ${i}: got a session id`);
          await initRes.text();
          const notifRes = await authenticatedHttpRequest(central.markerPath, marker, central.endpoint, {
            method: "POST", headers: { ...headers, "mcp-session-id": sessionId },
            body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
          });
          assert.ok(notifRes.ok, `session ${i}: initialized accepted`);
          await notifRes.text();
        }
        const statusBefore = await (await authenticatedHttpRequest(central.markerPath, marker, new URL("/_h2a-central/status", central.endpoint))).json();
        assert.equal(statusBefore.attachments, N, `all ${N} sessions attached before measuring`);
        const startCpu = process.cpuUsage();
        await new Promise((r) => setTimeout(r, 10_000));
        const diff = process.cpuUsage(startCpu);
        const cpuMs = (diff.user + diff.system) / 1000;
        const statusAfter = await (await authenticatedHttpRequest(central.markerPath, marker, new URL("/_h2a-central/status", central.endpoint))).json();
        assert.equal(statusAfter.attachments, N, `all ${N} sessions still attached after measuring (measured path is the with-sessions full-lock path)`);
        // Regression tripwire for the on-duty posture (own CPU, not wall
        // clock). This does NOT prove the L5B `< 2 %` gate: the strict gate
        // is not measured (L5B pre-step, see L5-report §8).
        t.diagnostic(`supervised with ${N} sessions own CPU ${cpuMs.toFixed(1)}ms over 10s wall (tripwire < 600ms; L5B 2% gate not measured)`);
        assert.ok(cpuMs < 600, `supervised with ${N} sessions own CPU ${cpuMs.toFixed(1)}ms over 10s wall must be < 600ms (full flock-per-tick path, tripwire only)`);
      } finally {
        await central.stop();
      }
    });
  } finally { iso.cleanup(); }
});
