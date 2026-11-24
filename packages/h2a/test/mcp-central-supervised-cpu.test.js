import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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
