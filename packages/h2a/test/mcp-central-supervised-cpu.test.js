import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
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

test("L5B item 1: supervised central with 5 real bridgeCentralMcpStdio shims keeps own CPU < 2% (process.cpuUsage + threadCpuUsage)", { timeout: 60_000 }, async (t) => {
  const iso = isolated();
  let central = null;
  const children = [];
  try {
    await withEnv({ HOME: iso.home, XDG_RUNTIME_DIR: iso.xdgRuntime, H2A_ROOT: iso.root, H2A_MCP_CENTRAL: "1" }, async () => {
      const workspace = join(iso.dir, "workspace");
      mkdirSync(workspace, { recursive: true, mode: 0o700 });
      chmodSync(workspace, 0o700);
      central = await startCentralMcpServer({ root: iso.root, runtimeBase: iso.xdgRuntime, idleTimeoutMs: 0, sessionLeaseMs: 90_000 });
      const marker = JSON.parse(readFileSync(central.markerPath, "utf8"));
      const bridgeUrl = new URL("../dist/runtime/handover/shim-bridge.js", import.meta.url).href;
      const contextUrl = new URL("../dist/runtime/mcp-central-context.js", import.meta.url).href;
      const childScript = [
        `import { bridgeCentralMcpStdio } from ${JSON.stringify(bridgeUrl)};`,
        `import { captureCentralAttachment } from ${JSON.stringify(contextUrl)};`,
        `const attachment = captureCentralAttachment(process.env.H2A_ROOT, process.env.H2A_WORKSPACE, { host: "claude", "auto-open": "true" }, process.env);`,
        `await bridgeCentralMcpStdio({ runtimeBase: process.env.XDG_RUNTIME_DIR, stdin: process.stdin, stdout: process.stdout, attachment });`
      ].join("\n");
      const N = 5;
      try {
        for (let i = 0; i < N; i++) {
          const child = spawn(process.execPath, ["--input-type=module", "-e", childScript], {
            env: {
              ...process.env,
              HOME: iso.home,
              XDG_RUNTIME_DIR: iso.xdgRuntime,
              H2A_ROOT: iso.root,
              H2A_WORKSPACE: workspace,
              H2A_MCP_CENTRAL: "1",
              CLAUDE_CODE_SESSION_ID: `l5b-shim-${i}`
            },
            stdio: ["pipe", "pipe", "pipe"]
          });
          const pending = new Map();
          const rl = createInterface({ input: child.stdout });
          rl.on("line", (line) => {
            try {
              const msg = JSON.parse(line);
              if (msg.id !== undefined && pending.has(msg.id)) {
                const resolve = pending.get(msg.id);
                pending.delete(msg.id);
                resolve(msg);
              }
            } catch { /* ignore non-json noise */ }
          });
          let stderr = "";
          child.stderr.on("data", (d) => { stderr += String(d); });
          const request = (id, method, params) => new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              pending.delete(id);
              reject(new Error(`shim ${i} timeout waiting for ${method} (${id}); stderr=${stderr}`));
            }, 15_000);
            pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
            child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
          });
          children.push({ child, rl, request, getStderr: () => stderr });
        }

        // Complete MCP handshake + wait until every shim's presence identity is ready.
        await Promise.all(children.map(async (c, i) => {
          const init = await c.request(1, "initialize", {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "supervised-real-shim", version: "1" }
          });
          assert.ok(init.result?.protocolVersion, `shim ${i} initialize succeeded: ${JSON.stringify(init)}`);
          c.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
          for (let attempt = 0; attempt < 40; attempt++) {
            const res = await c.request(100 + attempt, "tools/call", { name: "h2a_identity_status", arguments: {} });
            const status = JSON.parse(res.result?.content?.[0]?.text ?? "{}");
            if (status.state === "identity_ready") return;
            await new Promise((r) => setTimeout(r, 100));
          }
          assert.fail(`shim ${i} failed to reach identity_ready; stderr=${c.getStderr()}`);
        }));

        const statusBefore = await (await authenticatedHttpRequest(central.markerPath, marker, new URL("/_h2a-central/status", central.endpoint))).json();
        assert.equal(statusBefore.attachments, N, `all ${N} real shims attached before measuring`);

        // Let initial registration/first supervision poll settle into steady state.
        await new Promise((r) => setTimeout(r, 1_500));

        const startProc = process.cpuUsage();
        const startThread = typeof process.threadCpuUsage === "function" ? process.threadCpuUsage() : null;
        await new Promise((r) => setTimeout(r, 10_000));
        const procDiff = process.cpuUsage(startProc);
        const threadDiff = startThread ? process.threadCpuUsage(startThread) : null;
        const procCpuMs = (procDiff.user + procDiff.system) / 1000;
        const threadCpuMs = threadDiff ? (threadDiff.user + threadDiff.system) / 1000 : undefined;

        for (let i = 0; i < children.length; i++) {
          assert.equal(children[i].child.exitCode, null, `shim ${i} remained alive; stderr=${children[i].getStderr()}`);
        }
        const statusAfter = await (await authenticatedHttpRequest(central.markerPath, marker, new URL("/_h2a-central/status", central.endpoint))).json();
        assert.equal(statusAfter.attachments, N, `all ${N} real shims still attached after measuring`);

        t.diagnostic(
          `supervised with ${N} real shims own procCPU=${procCpuMs.toFixed(1)}ms` +
          (threadCpuMs !== undefined ? ` threadCPU=${threadCpuMs.toFixed(1)}ms` : "") +
          ` over 10s wall (< 200ms gate = 2%)`
        );
        assert.ok(procCpuMs < 200, `supervised with ${N} real shims own procCPU ${procCpuMs.toFixed(1)}ms over 10s must be < 200ms (< 2% gate)`);
        if (threadCpuMs !== undefined) {
          assert.ok(threadCpuMs < 200, `supervised with ${N} real shims own threadCPU ${threadCpuMs.toFixed(1)}ms over 10s must be < 200ms (< 2% gate)`);
        }
      } finally {
        await Promise.all(children.map(async ({ child, rl }) => {
          rl.close();
          if (child.exitCode === null) {
            child.stdin.end();
            const exited = new Promise((r) => child.once("exit", r));
            const killTimer = setTimeout(() => {
              if (child.exitCode === null) child.kill("SIGTERM");
            }, 1_000);
            await Promise.race([exited, new Promise((r) => setTimeout(r, 2_000))]);
            clearTimeout(killTimer);
            if (child.exitCode === null) child.kill("SIGKILL");
          }
        }));
        await central.stop();
      }
    });
  } finally { iso.cleanup(); }
});
