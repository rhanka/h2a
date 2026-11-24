import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startCentralMcpServer } from "../dist/runtime/mcp-central.js";

function isolated() {
  const dir = mkdtempSync(join(tmpdir(), "h2a-idle-cpu-"));
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

test("L5A-(b) idle central burns no steady CPU (own CPU time, not wall clock)", { timeout: 60_000 }, async () => {
  const iso = isolated();
  try {
    await withEnv({ HOME: iso.home, XDG_RUNTIME_DIR: iso.xdgRuntime, H2A_ROOT: iso.root, H2A_MCP_CENTRAL: "1" }, async () => {
      const central = await startCentralMcpServer({ root: iso.root, runtimeBase: iso.xdgRuntime, idleTimeoutMs: 60_000, sessionLeaseMs: 90_000 });
      try {
        // Let startup (migration, archive index) settle; then measure pure idle.
        await new Promise((r) => setTimeout(r, 2_000));
        const startCpu = process.cpuUsage();
        await new Promise((r) => setTimeout(r, 10_000));
        const diff = process.cpuUsage(startCpu);
        const cpuMs = (diff.user + diff.system) / 1000;
        // Hot path was acquireFlockFdAsync spawning flock every 500ms sweep
        // (mutation.js:168 + mcp-central.ts:369/399): ~255ms per 10s idle.
        // After the idle fast-path (skip locks when revision clean + no tx),
        // own CPU over 10s idle must stay well under the old floor.
        // CI ceiling 200ms (shared runner); strict < 150ms in the quiet bench.
        assert.ok(cpuMs < 200, `idle own CPU ${cpuMs.toFixed(1)}ms over 10s wall must be < 200ms CI ceiling (flock-per-tick hot path; strict < 150ms in bench)`);
      } finally {
        await central.stop();
      }
    });
  } finally { iso.cleanup(); }
});
