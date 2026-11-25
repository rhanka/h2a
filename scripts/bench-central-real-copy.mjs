#!/usr/bin/env node
// L5B real-copy bench: measure candidate (and optional witness rc.10) on isolated copies of live state.
// Follows L5B-presteps-report.md & REVIEW-L5-opus-r3.md §7: disk guard, single active copy,
// optional --no-cpu-prof, >= 30s steady CPU window, C5.1 (spawn -> listening + /health + /ping 200),
// C5.5 (10 ticks enclosing drive-consent.full-verification), peak RSS from VmHWM, lag p99, migrationTotalMs.
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, cpSync, writeFileSync, statfsSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { authenticatedHttpRequest } from "../packages/h2a/dist/runtime/handover/authenticated-http.js";

function usage() {
  console.log("Usage: bench-central-real-copy.mjs --source-state <dir> --source-root <dir> --out <dir> [--run-base <dir>] [--rc10 <version>] [--witness-timeout-ms <n>] [--measure-ms <n>] [--c51-trials <n>] [--c55] [--supervised] [--sessions <n>] [--skip-witness] [--no-cpu-prof] [--allow-stale-dist]");
  console.log("  --run-base defaults to $TMPDIR (must be set, never /tmp); --source-state/--source-root/--out are required.");
  console.log("  --supervised starts mcp-central-serve with --supervised; --sessions <N> attaches N real bridgeCentralMcpStdio shims.");
  console.log("  --measure-ms defaults to 30000 (>= 30s heartbeat period); --c51-trials defaults to 3; --c55 measures 10 ticks around t=60s.");
  console.log("  --no-cpu-prof disables V8 --cpu-prof during the benchmark; --out is kept after cleanup.");
}

const args = process.argv.slice(2);
function opt(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}
function requiredOpt(name) {
  const v = opt(name, "");
  if (!v) { console.error(`bench: ${name} is required`); usage(); process.exit(2); }
  return v;
}
if (args.includes("--help") || args.includes("-h")) { usage(); process.exit(0); }

const sourceState = requiredOpt("--source-state");
const sourceRoot = requiredOpt("--source-root");
const outDir = requiredOpt("--out");
const rc10ver = opt("--rc10", "0.98.11-rc.10");
const witnessTimeoutMs = Number(opt("--witness-timeout-ms", "15000"));
const measureMs = Number(opt("--measure-ms", "30000"));
const c51TrialsCount = Math.max(0, Number.parseInt(opt("--c51-trials", "3"), 10) || 0);
const measureC55 = args.includes("--c55");
const supervised = args.includes("--supervised");
const skipWitness = args.includes("--skip-witness");
const noCpuProf = args.includes("--no-cpu-prof");
const allowStaleDist = args.includes("--allow-stale-dist");
const sessionsCount = Math.max(0, Number.parseInt(opt("--sessions", "0"), 10) || 0);
const LISTEN_TIMEOUT_MS = 30_000;

if (!Number.isFinite(measureMs) || measureMs <= 0) {
  console.error(`bench: invalid --measure-ms: ${measureMs}`);
  process.exit(2);
}

if (!existsSync(sourceState) || !statSync(sourceState).isDirectory()) {
  console.error(`bench: --source-state directory does not exist: ${sourceState}`);
  process.exit(2);
}
if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
  console.error(`bench: --source-root directory does not exist: ${sourceRoot}`);
  process.exit(2);
}

const explicitRunBase = opt("--run-base", "");
const tmpdirEnv = process.env.TMPDIR ?? "";
if (!explicitRunBase && !tmpdirEnv) {
  console.error("bench: refusing to start: set TMPDIR (lane .tmp) or pass --run-base <dir>; never /tmp");
  process.exit(2);
}
const runBase = explicitRunBase || tmpdirEnv;
if (runBase === "/tmp" || runBase.startsWith("/tmp/")) {
  console.error(`bench: refusing to start: run base ${runBase} is /tmp; use the lane .tmp dir`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true, mode: 0o700 });
const runDir = join(runBase, `h2a-l5-bench-${Date.now()}`);
mkdirSync(runDir, { recursive: true, mode: 0o700 });

function diskOk(path, needGB = 48) {
  try {
    const st = statfsSync(path);
    const freeGB = Number(st.bavail) * Number(st.bsize) / 1e9;
    return freeGB >= needGB;
  } catch { return false; }
}

function guardDiskOrExit() {
  if (!diskOk(runBase, 48)) {
    console.error(`bench: refusing to start, free space < 48G under ${runBase}`);
    try { rmSync(runDir, { recursive: true, force: true }); } catch { /* ignore */ }
    process.exit(2);
  }
}
guardDiskOrExit();

function readClkTck() {
  try {
    const raw = execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim();
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  } catch { /* fallback */ }
  return 100;
}
const CLK_TCK = readClkTck();

function copyLedgerSubset(srcState, srcRoot, destRuntime, destRoot) {
  const dstState = join(destRuntime, "h2a-mcp-central");
  mkdirSync(dstState, { recursive: true, mode: 0o700 });
  mkdirSync(destRoot, { recursive: true, mode: 0o700 });
  const keepRe = /^(operation-.*\.json|effect-.*\.json|generation-end-.*\.json|ownership-.*\.json|launch.*\.json|wake-.*\.json|checkpoint-.*\.json|participant-revision\.json)$/;
  const dirStats = (dir) => {
    let bytes = 0;
    let files = 0;
    try {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name);
        try {
          if (name.isDirectory()) {
            const sub = dirStats(p);
            bytes += sub.bytes;
            files += sub.files;
          } else if (name.isFile()) {
            bytes += Number(statSync(p).size);
            files++;
          }
        } catch { /* ignore */ }
      }
    } catch { /* absent */ }
    return { bytes, files };
  };
  let bytes = 0;
  let count = 0;
  let archiveFiles = 0;
  if (existsSync(srcState)) {
    for (const name of readdirSync(srcState)) {
      if (!keepRe.test(name)) continue;
      const src = join(srcState, name);
      try {
        const st = statSync(src);
        if (!st.isFile()) continue;
        bytes += Number(st.size);
        count++;
      } catch { continue; }
    }
    const arch = dirStats(join(srcState, "archive"));
    bytes += arch.bytes;
    archiveFiles = arch.files;
  }
  const copiedSubdirs = {};
  if (srcRoot && existsSync(srcRoot)) {
    for (const sub of ["registry", "keys", "negotiations"]) {
      const s = join(srcRoot, sub);
      const present = existsSync(s);
      copiedSubdirs[sub] = present;
      if (present) bytes += dirStats(s).bytes;
    }
    try { bytes += Number(statSync(join(srcRoot, ".h2a-schema.json")).size); } catch { /* ignore */ }
  }
  if (bytes > 512 * 1024 * 1024) {
    console.error(`bench: refusing copy, need ${(bytes / 1048576).toFixed(0)}MiB > 512MiB cap (ledger + archive + root subsets)`);
    process.exit(2);
  }
  if (existsSync(srcState)) {
    for (const name of readdirSync(srcState)) {
      if (!keepRe.test(name)) continue;
      const src = join(srcState, name);
      try { cpSync(src, join(dstState, name)); } catch { /* ignore */ }
    }
    try { cpSync(join(srcState, "archive"), join(dstState, "archive"), { recursive: true }); } catch { /* no archive */ }
  }
  const privatizeCopiedTree = (dirPath) => {
    try {
      const st = lstatSync(dirPath);
      if (st.isSymbolicLink()) return;
      if (st.isDirectory()) {
        chmodSync(dirPath, 0o700);
        for (const name of readdirSync(dirPath)) {
          privatizeCopiedTree(join(dirPath, name));
        }
      } else if (st.isFile()) {
        chmodSync(dirPath, 0o600);
      }
    } catch { /* best effort on absent subtrees */ }
  };
  if (srcRoot && existsSync(srcRoot)) {
    for (const sub of ["registry", "keys", "negotiations"]) {
      const s = join(srcRoot, sub);
      if (existsSync(s)) {
        try { cpSync(s, join(destRoot, sub), { recursive: true }); } catch { /* ignore */ }
      }
    }
    const schema = join(srcRoot, ".h2a-schema.json");
    if (existsSync(schema)) {
      try { cpSync(schema, join(destRoot, ".h2a-schema.json")); } catch { /* ignore */ }
    }
  }
  privatizeCopiedTree(dstState);
  privatizeCopiedTree(destRoot);
  return { bytes, count, archiveFiles, dstState, copiedSubdirs, hasKeys: Boolean(copiedSubdirs.keys) };
}

function readProcCpuTicks(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const rparen = stat.lastIndexOf(")");
    const fields = stat.slice(rparen + 2).split(" ");
    const utime = Number(fields[11]);
    const stime = Number(fields[12]);
    return { utime, stime, total: utime + stime };
  } catch { return null; }
}

function summarizeCpuProfile(profilePath) {
  try {
    const prof = JSON.parse(readFileSync(profilePath, "utf8"));
    const nodes = new Map((prof.nodes ?? []).map((n) => [n.id, n]));
    const totals = new Map();
    let totalUs = 0;
    let activeUs = 0;
    const samples = prof.samples ?? [];
    const deltas = prof.timeDeltas ?? [];
    for (let i = 0; i < samples.length && i < deltas.length; i++) {
      const dt = Number(deltas[i]) || 0;
      totalUs += dt;
      const cf = nodes.get(samples[i])?.callFrame;
      const fn = cf?.functionName || "(anonymous)";
      if (fn === "(idle)") continue;
      activeUs += dt;
      const url = cf?.url ? String(cf.url).split("/").slice(-2).join("/") : "native";
      const key = `${fn} @ ${url}:${cf?.lineNumber ?? 0}`;
      totals.set(key, (totals.get(key) ?? 0) + dt);
    }
    const topFunctions = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([fn, us]) => ({ fn, ms: Math.round((us / 1000) * 10) / 10 }));
    const matchingMs = (pattern) => {
      let us = 0;
      for (const [k, v] of totals) if (pattern.test(k)) us += v;
      return Math.round((us / 1000) * 10) / 10;
    };
    return {
      totalMs: Math.round((totalUs / 1000) * 10) / 10,
      activeMs: Math.round((activeUs / 1000) * 10) / 10,
      fsyncSyncMs: matchingMs(/^fsyncSync\b/),
      spawnMs: matchingMs(/^(spawn|spawnSync)\b/),
      topFunctions,
    };
  } catch { return null; }
}

async function attachRealShims(entryBin, count, runtimeBase, root, workspaceBase) {
  const pkgDistDir = dirname(entryBin);
  const bridgeUrl = new URL(`file://${join(pkgDistDir, "runtime/handover/shim-bridge.js")}`).href;
  const contextUrl = new URL(`file://${join(pkgDistDir, "runtime/mcp-central-context.js")}`).href;
  const childScript = [
    `import { bridgeCentralMcpStdio } from ${JSON.stringify(bridgeUrl)};`,
    `import { captureCentralAttachment } from ${JSON.stringify(contextUrl)};`,
    `const attachment = captureCentralAttachment(process.env.H2A_ROOT, process.env.H2A_WORKSPACE, { host: "claude", "auto-open": "true" }, process.env);`,
    `await bridgeCentralMcpStdio({ runtimeBase: process.env.XDG_RUNTIME_DIR, stdin: process.stdin, stdout: process.stdout, attachment });`,
  ].join("\n");
  mkdirSync(workspaceBase, { recursive: true, mode: 0o700 });
  const shims = [];
  for (let i = 0; i < count; i++) {
    const shimHome = join(workspaceBase, `home-${i}`);
    const shimWs = join(workspaceBase, `ws-${i}`);
    mkdirSync(shimHome, { recursive: true, mode: 0o700 });
    mkdirSync(shimWs, { recursive: true, mode: 0o700 });
    const shimEnv = {
      ...process.env, HOME: shimHome, XDG_RUNTIME_DIR: runtimeBase,
      H2A_ROOT: root, H2A_WORKSPACE: shimWs, H2A_MCP_CENTRAL: "1",
      CLAUDE_CODE_SESSION_ID: `bench-shim-${i}`,
    };
    delete shimEnv.H2A_NOTIFY_INTERVAL_MS;
    delete shimEnv.H2A_HEARTBEAT_INTERVAL_MS;
    delete shimEnv.H2A_SESSION_EXPIRY_MS;
    const cp = spawn(process.execPath, ["--input-type=module", "-e", childScript], {
      env: shimEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const pending = new Map();
    const rl = createInterface({ input: cp.stdout });
    rl.on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          const resolve = pending.get(msg.id);
          pending.delete(msg.id);
          resolve(msg);
        }
      } catch { /* ignore non-json */ }
    });
    let stderr = "";
    cp.stderr.on("data", (d) => { stderr += String(d); });
    const request = (id, method, params) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`shim ${i} ${method} timeout`)); }, 15_000);
      pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      cp.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
    shims.push({ index: i, cp, rl, request, getStderr: () => stderr });
  }
  await Promise.all(shims.map(async (s) => {
    const initRes = await s.request(1, "initialize", {
      protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "bench-real-shim", version: "1" },
    });
    if (!initRes?.result?.protocolVersion) {
      throw new Error(`shim ${s.index} initialize failed: ${JSON.stringify(initRes)}; stderr=${s.getStderr()}`);
    }
    s.cp.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (s.cp.exitCode !== null || s.cp.signalCode !== null) {
        throw new Error(`shim ${s.index} exited before identity_ready (code=${s.cp.exitCode}, sig=${s.cp.signalCode}); stderr=${s.getStderr()}`);
      }
      const res = await s.request(100 + attempt, "tools/call", { name: "h2a_identity_status", arguments: {} });
      const status = JSON.parse(res.result?.content?.[0]?.text ?? "{}");
      if (status.state === "identity_ready") return;
      if (status.state === "identity_failed") {
        throw new Error(`shim ${s.index} identity_failed: ${JSON.stringify(status)}; stderr=${s.getStderr()}`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`shim ${s.index} did not reach identity_ready within 10s; stderr=${s.getStderr()}`);
  }));
  return {
    shims,
    countAlive() {
      return shims.filter((s) => s.cp.exitCode === null && s.cp.signalCode === null).length;
    },
    async closeAll() {
      await Promise.all(shims.map(async ({ cp, rl }) => {
        rl.close();
        if (cp.exitCode === null) {
          cp.stdin.end();
          const exited = new Promise((r) => cp.once("exit", r));
          await Promise.race([exited, new Promise((r) => setTimeout(r, 1500))]);
          if (cp.exitCode === null) cp.kill("SIGKILL");
        }
      }));
    },
  };
}

function readVmHwmMB(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const m = status.match(/^VmHWM:\s+(\d+)\s+kB$/m);
    if (m) return Number(m[1]) / 1024;
  } catch { /* process gone or no /proc */ }
  return NaN;
}

function readPsRssMB(pid) {
  try {
    const out = execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim();
    const kb = Number(out);
    return Number.isFinite(kb) && kb > 0 ? kb / 1024 : NaN;
  } catch { return NaN; }
}

async function probeC51Endpoints(endpoint) {
  const healthUrl = new URL("/_h2a-central/health", endpoint);
  const pingUrl = new URL("/_h2a-central/ping", endpoint);
  const [healthRes, pingRes] = await Promise.all([
    fetch(healthUrl, { signal: AbortSignal.timeout(5_000) }),
    fetch(pingUrl, { signal: AbortSignal.timeout(5_000) }),
  ]);
  const healthBody = await healthRes.json().catch(() => null);
  await pingRes.text().catch(() => {});
  return {
    healthStatus: healthRes.status,
    pingStatus: pingRes.status,
    healthOk: healthRes.status === 200 && healthBody?.state === "ready",
    pingOk: pingRes.status === 200,
  };
}

async function stopChildCleanly(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return { exitCode: child?.exitCode ?? null, exitSignal: child?.signalCode ?? null };
  }
  const exit = await new Promise((resolve) => {
    child.kill("SIGINT");
    const timer = setTimeout(() => resolve({ exitCode: child.exitCode, exitSignal: child.signalCode ?? "SIGINT-timeout" }), 3_000);
    child.once("exit", () => { clearTimeout(timer); resolve({ exitCode: child.exitCode, exitSignal: child.signalCode }); });
  });
  if (exit.exitCode === null && (exit.exitSignal === "SIGINT" || exit.exitSignal === "SIGINT-timeout")) {
    try { process.kill(child.pid, "SIGKILL"); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 1000));
    return { exitCode: child.exitCode, exitSignal: child.signalCode };
  }
  return exit;
}

async function measureC51Trial(trialIndex, entryBin, copyMeta) {
  const trialDir = join(runDir, `c51-trial-${trialIndex}`);
  const root = join(trialDir, "root");
  const runtimeBase = join(trialDir, "runtime");
  const home = join(trialDir, "home");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const copied = copyLedgerSubset(sourceState, sourceRoot, runtimeBase, root);
  const env = {
    ...process.env, HOME: home, XDG_RUNTIME_DIR: runtimeBase, H2A_ROOT: root,
  };
  delete env.H2A_MCP_AUTHORITY;
  delete env.H2A_MCP_CENTRAL_ENDPOINT;
  const serveArgs = [
    "--max-old-space-size=384",
    entryBin, "mcp-central-serve", "--root", root, "--runtime-base", runtimeBase,
    ...(supervised ? ["--supervised"] : []),
  ];
  const startPerf = performance.now();
  const child = spawn(process.execPath, serveArgs, { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let listenPerf = null;
  let endpoint = null;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`c51 trial ${trialIndex} listen timeout`)), LISTEN_TIMEOUT_MS);
      const onChunk = (chunk) => {
        output += String(chunk);
        if (endpoint) return;
        const m = output.match(/listening on (http:\/\/\S+)/);
        if (m) {
          clearTimeout(timer);
          listenPerf = performance.now();
          endpoint = m[1];
          child.stdout.off("data", onChunk);
          child.stderr.off("data", onChunk);
          resolve();
        }
      };
      child.stdout.on("data", onChunk);
      child.stderr.on("data", onChunk);
      child.once("exit", (code, sig) => {
        clearTimeout(timer);
        if (!endpoint) reject(new Error(`c51 trial ${trialIndex} exited early code=${code} sig=${sig}: ${output.slice(0, 500)}`));
      });
    });
    const probe = await probeC51Endpoints(endpoint);
    const c51Perf = performance.now();
    const exit = await stopChildCleanly(child);
    return {
      trial: trialIndex,
      hasKeys: copied.hasKeys,
      rootFiles: copied.count,
      archiveFiles: copied.archiveFiles,
      listenMs: Math.round((listenPerf - startPerf) * 10) / 10,
      c51Ms: Math.round((c51Perf - startPerf) * 10) / 10,
      healthStatus: probe.healthStatus,
      pingStatus: probe.pingStatus,
      ok: probe.healthOk && probe.pingOk && exit.exitCode === 0,
      exitCode: exit.exitCode,
      exitSignal: exit.exitSignal,
      copyOpsCount: copyMeta?.ops ?? copied.count,
    };
  } catch (error) {
    await stopChildCleanly(child);
    return {
      trial: trialIndex,
      hasKeys: copied.hasKeys,
      listenMs: listenPerf !== null ? Math.round((listenPerf - startPerf) * 10) / 10 : null,
      c51Ms: null,
      ok: false,
      error: String(error?.message ?? error),
    };
  } finally {
    try { rmSync(trialDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function parseDriveConsentEvents(stderrText) {
  const events = [];
  for (const line of stderrText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.event === "drive-consent.full-verification") events.push(parsed);
    } catch { /* ignore */ }
  }
  return events;
}

async function runCase(name, entryBin, root, runtimeBase, profDir, home, caseMeasureMs, caseOpts = {}) {
  mkdirSync(profDir, { recursive: true, mode: 0o700 });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const env = {
    ...process.env, HOME: home, XDG_RUNTIME_DIR: runtimeBase, H2A_ROOT: root,
  };
  delete env.H2A_MCP_AUTHORITY;
  delete env.H2A_MCP_CENTRAL_ENDPOINT;
  const serveArgs = [
    "--max-old-space-size=384",
    ...(caseOpts.cpuProf ? ["--cpu-prof", `--cpu-prof-dir=${profDir}`] : []),
    entryBin, "mcp-central-serve", "--root", root, "--runtime-base", runtimeBase,
    ...(caseOpts.supervised ? ["--supervised"] : []),
  ];
  let child;
  const startWall = Date.now();
  const startPerf = performance.now();
  try {
    child = spawn(process.execPath, serveArgs, { env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return {
      name, sessionsRequested: caseOpts.sessions ?? 0, cpuProf: Boolean(caseOpts.cpuProf),
      spawnFailed: String(error?.message ?? error).slice(0, 300),
      listenMs: null, c51Ms: null, c51HealthOk: false, c51PingOk: false,
      timeout: true, exitCode: null, exitSignal: null, expectedStop: false,
      rssPeakMB: NaN, stdout: "", stderr: "",
    };
  }
  let stdout = "";
  let stderr = "";
  let stderrLineBuf = "";
  const consentEvents = [];
  const checkConsentLines = (chunkStr, flush = false) => {
    stderrLineBuf += chunkStr;
    const lines = stderrLineBuf.split("\n");
    stderrLineBuf = flush ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      for (const ev of parseDriveConsentEvents(line)) {
        consentEvents.push({ ...ev, observedAtWallMs: Date.now(), observedAtElapsedMs: Math.round((performance.now() - startPerf) * 10) / 10 });
      }
    }
  };
  let resolveListen;
  let listenTimer;
  const checkListen = () => {
    const m = (stdout + stderr).match(/listening on (http:\/\/\S+)/);
    if (resolveListen && m) {
      clearTimeout(listenTimer);
      const done = resolveListen;
      resolveListen = null;
      done({ ms: performance.now() - startPerf, endpoint: m[1], timeout: false });
    }
  };
  child.stdout.on("data", (c) => { const s = String(c); stdout += s; checkListen(); });
  child.stderr.on("data", (c) => { const s = String(c); stderr += s; checkConsentLines(s); checkListen(); });
  child.stderr.on("end", () => { if (stderrLineBuf) checkConsentLines("", true); });
  const listen = await new Promise((resolve) => {
    resolveListen = resolve;
    listenTimer = setTimeout(() => {
      resolveListen = null;
      resolve({ ms: performance.now() - startPerf, endpoint: null, timeout: true });
    }, LISTEN_TIMEOUT_MS);
    checkListen();
  });

  let c51Ms = null;
  let c51HealthOk = false;
  let c51PingOk = false;
  if (!listen.timeout && listen.endpoint) {
    try {
      const probe = await probeC51Endpoints(listen.endpoint);
      c51Ms = Math.round((performance.now() - startPerf) * 10) / 10;
      c51HealthOk = probe.healthOk;
      c51PingOk = probe.pingOk;
    } catch { /* leave false */ }
  }

  let rssPeakMB = readVmHwmMB(child.pid);
  if (!Number.isFinite(rssPeakMB)) rssPeakMB = readPsRssMB(child.pid);
  const sampler = setInterval(() => {
    const v = readVmHwmMB(child.pid);
    const sample = Number.isFinite(v) ? v : readPsRssMB(child.pid);
    if (Number.isFinite(sample) && (!Number.isFinite(rssPeakMB) || sample > rssPeakMB)) rssPeakMB = sample;
  }, 100);

  let shimsHandle = null;
  let migrationDoneMs = null;
  let peakMigrationP99Ms = null;
  let peakMigrationMaxMs = null;
  let finalMigrationP99Ms = null;
  let steadyCpuTicks = null;
  let steadyCpuMs = null;
  let steadyCpuPct = null;
  let steadyWallMs = null;
  let shimsAliveBefore = null;
  let shimsAliveAfter = null;
  let steadyAttachmentsBefore = null;
  let steadyAttachmentsAfter = null;
  let steadyLagP99Ms = null;
  let c55Result = null;
  let measureError = null;
  const diedEarly = child.exitCode !== null || child.signalCode !== null;

  const markerPath = join(runtimeBase, "h2a-mcp-central", "marker.json");
  const readMarker = () => {
    try { return JSON.parse(readFileSync(markerPath, "utf8")); } catch { return null; }
  };
  const pollStatus = async (m) => {
    try {
      const r = await authenticatedHttpRequest(markerPath, m, new URL("/_h2a-central/status", m.endpoint));
      return r.ok ? await r.json() : null;
    } catch { return null; }
  };

  try {
    if (!listen.timeout && !diedEarly) {
      let marker = null;
      const markerDeadline = Date.now() + 5_000;
      while (Date.now() < markerDeadline && !(marker = readMarker())) {
        await new Promise((r) => setTimeout(r, 25));
      }
      // Poll migration status concurrently with shim attachment so migrationDoneMs and
      // peakMigrationP99Ms capture the full migration window without artificial delay.
      const attachPromise = marker && (caseOpts.sessions ?? 0) > 0
        ? attachRealShims(entryBin, caseOpts.sessions, runtimeBase, root, join(profDir, "shims"))
        : Promise.resolve(null);
      const migrationPromise = (async () => {
        if (!marker) return;
        const migDeadline = Date.now() + Math.max(30_000, caseMeasureMs);
        while (Date.now() < migDeadline && child.exitCode === null && child.signalCode === null) {
          const st = await pollStatus(marker);
          if (st?.eventLoopLagMs) {
            const p99 = Number(st.eventLoopLagMs.p99 ?? 0);
            const max = Number(st.eventLoopLagMs.max ?? 0);
            peakMigrationP99Ms = Math.max(peakMigrationP99Ms ?? 0, p99);
            peakMigrationMaxMs = Math.max(peakMigrationMaxMs ?? 0, max);
            if (st.ledgerMigrationComplete === true) {
              finalMigrationP99Ms = p99;
              migrationDoneMs = Date.now() - startWall;
              break;
            }
          } else if (st?.ledgerMigrationComplete === true) {
            migrationDoneMs = Date.now() - startWall;
            break;
          }
          await new Promise((r) => setTimeout(r, 100));
        }
      })();

      const [resolvedShims] = await Promise.all([attachPromise, migrationPromise]);
      shimsHandle = resolvedShims;

      if (child.exitCode === null && child.signalCode === null) {
        if ((caseOpts.sessions ?? 0) > 0 && shimsHandle) {
          await new Promise((r) => setTimeout(r, 1_500));
          shimsAliveBefore = shimsHandle.countAlive();
          const stBefore = marker ? await pollStatus(marker) : null;
          steadyAttachmentsBefore = stBefore?.attachments ?? null;
          const tBefore = readProcCpuTicks(child.pid);
          const wBefore = performance.now();
          await new Promise((r) => {
            if (child.exitCode !== null || child.signalCode !== null) return r();
            const onExit = () => r();
            child.once("exit", onExit);
            setTimeout(() => { child.removeListener("exit", onExit); r(); }, caseMeasureMs);
          });
          const wAfter = performance.now();
          const tAfter = readProcCpuTicks(child.pid);
          const stAfter = marker ? await pollStatus(marker) : null;
          steadyAttachmentsAfter = stAfter?.attachments ?? null;
          shimsAliveAfter = shimsHandle.countAlive();
          steadyLagP99Ms = stAfter?.eventLoopLagMs?.p99 ?? null;
          steadyWallMs = Math.round((wAfter - wBefore) * 10) / 10;
          if (tBefore && tAfter && steadyWallMs > 0) {
            steadyCpuTicks = tAfter.total - tBefore.total;
            steadyCpuMs = Math.round((steadyCpuTicks * (1000 / CLK_TCK)) * 10) / 10;
            steadyCpuPct = Math.round(((steadyCpuMs / steadyWallMs) * 100) * 100) / 100;
          }
        } else {
          const remainingWait = Math.max(0, caseMeasureMs - (Date.now() - startWall));
          if (remainingWait > 0) {
            await new Promise((r) => {
              if (child.exitCode !== null || child.signalCode !== null) return r();
              const onExit = () => r();
              child.once("exit", onExit);
              setTimeout(() => { child.removeListener("exit", onExit); r(); }, remainingWait);
            });
          }
        }

        // C5.5: 10 sweep ticks (10_000 ms in supervised 1s sweep, 5_000 ms in 500ms retirement sweep)
        // enclosing the 60s drive-consent.full-verification pass.
        if (caseOpts.c55 && child.exitCode === null && child.signalCode === null) {
          const sweepPeriodMs = caseOpts.supervised ? 1_000 : 500;
          const c55WindowMs = 10 * sweepPeriodMs;
          const targetStartElapsedMs = caseOpts.supervised ? 55_500 : 58_000;
          const waitUntilC55 = Math.max(0, targetStartElapsedMs - (performance.now() - startPerf));
          if (waitUntilC55 > 0) {
            await new Promise((r) => setTimeout(r, waitUntilC55));
          }
          const c55ShimsAliveBefore = shimsHandle ? shimsHandle.countAlive() : null;
          const c55StatusBefore = marker ? await pollStatus(marker) : null;
          const c55EventsBefore = consentEvents.length;
          const c55TicksBefore = readProcCpuTicks(child.pid);
          const c55StartPerf = performance.now();
          await new Promise((r) => {
            if (child.exitCode !== null || child.signalCode !== null) return r();
            const onExit = () => r();
            child.once("exit", onExit);
            setTimeout(() => { child.removeListener("exit", onExit); r(); }, c55WindowMs);
          });
          const c55EndPerf = performance.now();
          const c55TicksAfter = readProcCpuTicks(child.pid);
          const c55StatusAfter = marker ? await pollStatus(marker) : null;
          const c55ShimsAliveAfter = shimsHandle ? shimsHandle.countAlive() : null;
          const c55WallMs = Math.round((c55EndPerf - c55StartPerf) * 10) / 10;
          const c55CpuTicks = c55TicksBefore && c55TicksAfter ? c55TicksAfter.total - c55TicksBefore.total : null;
          const c55CpuMs = c55CpuTicks !== null ? Math.round((c55CpuTicks * (1000 / CLK_TCK)) * 10) / 10 : null;
          const windowEvents = consentEvents.slice(c55EventsBefore);
          const ev = windowEvents[0] ?? null;
          c55Result = {
            ticksExpected: 10,
            sweepPeriodMs,
            windowMs: c55WallMs,
            cpuTicks: c55CpuTicks,
            cpuMs: c55CpuMs,
            cpuPct: c55CpuMs !== null && c55WallMs > 0 ? Math.round(((c55CpuMs / c55WallMs) * 100) * 100) / 100 : null,
            lagP99BeforeMs: c55StatusBefore?.eventLoopLagMs?.p99 !== undefined ? Math.round(c55StatusBefore.eventLoopLagMs.p99 * 100) / 100 : null,
            lagP99AfterMs: c55StatusAfter?.eventLoopLagMs?.p99 !== undefined ? Math.round(c55StatusAfter.eventLoopLagMs.p99 * 100) / 100 : null,
            attachmentsBefore: c55StatusBefore?.attachments ?? null,
            attachmentsAfter: c55StatusAfter?.attachments ?? null,
            shimsAliveBefore: c55ShimsAliveBefore,
            shimsAliveAfter: c55ShimsAliveAfter,
            driveConsentObserved: Boolean(ev),
            driveConsentAtMs: ev?.observedAtElapsedMs ?? null,
            driveConsentDurationMs: ev?.durationMs ?? null,
            driveConsentDue: ev?.due ?? null,
          };
        }
      }
    } else if (listen.timeout) {
      await new Promise((r) => {
        if (child.exitCode !== null || child.signalCode !== null) return r();
        const onExit = () => r();
        child.once("exit", onExit);
        setTimeout(() => { child.removeListener("exit", onExit); r(); }, 1_000);
      });
    }
  } catch (error) {
    measureError = String(error?.message ?? error);
  } finally {
    if (shimsHandle) {
      try { await shimsHandle.closeAll(); } catch { /* ignore */ }
    }
  }
  const settled = child.exitCode !== null || child.signalCode !== null;
  clearInterval(sampler);
  if (!listen.timeout && !settled) {
    const last = readVmHwmMB(child.pid);
    if (Number.isFinite(last) && (!Number.isFinite(rssPeakMB) || last > rssPeakMB)) rssPeakMB = last;
  }
  const expectedStop = !settled;
  const finalExit = settled
    ? { exitCode: child.exitCode, exitSignal: child.signalCode }
    : await stopChildCleanly(child);

  const stopDrainErrors = stderr.split("\n").filter((l) => l.includes("stop_drain_error") || l.includes("private_directory_required"));

  return {
    name,
    sessionsRequested: caseOpts.sessions ?? 0,
    cpuProf: Boolean(caseOpts.cpuProf),
    listenMs: listen.timeout ? null : Math.round(listen.ms * 10) / 10,
    c51Ms,
    c51HealthOk,
    c51PingOk,
    timeout: listen.timeout,
    exitCode: finalExit.exitCode,
    exitSignal: finalExit.exitSignal,
    expectedStop,
    rssPeakMB: Number.isFinite(rssPeakMB) ? Math.round(rssPeakMB * 10) / 10 : null,
    migrationDoneMs,
    peakMigrationP99Ms: peakMigrationP99Ms !== null ? Math.round(peakMigrationP99Ms * 100) / 100 : null,
    peakMigrationMaxMs: peakMigrationMaxMs !== null ? Math.round(peakMigrationMaxMs * 100) / 100 : null,
    finalMigrationP99Ms: finalMigrationP99Ms !== null ? Math.round(finalMigrationP99Ms * 100) / 100 : null,
    steadyLagP99Ms: steadyLagP99Ms !== null ? Math.round(steadyLagP99Ms * 100) / 100 : null,
    steadyWallMs,
    steadyCpuTicks,
    steadyCpuMs,
    steadyCpuPct,
    shimsAliveBefore,
    shimsAliveAfter,
    steadyAttachmentsBefore,
    steadyAttachmentsAfter,
    ...(c55Result ? { c55: c55Result } : {}),
    stopDrainErrorCount: stopDrainErrors.length,
    ...(measureError ? { measureError } : {}),
    stdout: stdout.slice(0, 2000),
    stderr: stderr.slice(0, 4000),
  };
}

function newestProfile(profDir) {
  try {
    const files = readdirSync(profDir).filter((n) => n.endsWith(".cpuprofile"));
    if (files.length === 0) return null;
    let best = null;
    for (const f of files) {
      const st = statSync(join(profDir, f));
      if (!best || st.mtimeMs > best.mtimeMs) best = { file: f, mtimeMs: st.mtimeMs };
    }
    return best.file;
  } catch { return null; }
}

function sha256File(path) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch { return null; }
}

function maxMtimeRecursive(dir, extRe = /\.(ts|js|mjs|json)$/) {
  let max = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        max = Math.max(max, maxMtimeRecursive(p, extRe));
      } else if (entry.isFile() && extRe.test(entry.name)) {
        try { max = Math.max(max, statSync(p).mtimeMs); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return max;
}

function candidateEntry() {
  const here = new URL(import.meta.url);
  const repoBin = join(dirname(dirname(here.pathname)), "packages", "h2a", "dist", "bin.js");
  if (existsSync(repoBin)) return repoBin;
  return null;
}

function resolveCandidateProvenance(mainBin) {
  const repoRoot = dirname(dirname(new URL(import.meta.url).pathname));
  let sha = null;
  let dirty = null;
  let untrackedHarnessFiles = [];
  let candidateVersion = null;
  try {
    sha = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const porcelain = execFileSync("git", ["-C", repoRoot, "status", "--porcelain"], { encoding: "utf8" })
      .split("\n")
      .map((l) => l.trimEnd())
      .filter(Boolean);
    const nonHarness = porcelain.filter((line) => {
      if (!line.startsWith("?? ")) return true;
      const p = line.slice(3).trim();
      return p !== ".h2a-lane.json" && p !== ".tmp" && p !== ".tmp/";
    });
    untrackedHarnessFiles = porcelain.filter((line) => !nonHarness.includes(line)).map((line) => line.slice(3).trim());
    dirty = nonHarness.length > 0;
  } catch { /* non-git tree */ }
  const distDir = mainBin ? dirname(mainBin) : null;
  const distPkgRoot = distDir ? dirname(distDir) : null;
  try {
    if (distPkgRoot) {
      candidateVersion = JSON.parse(readFileSync(join(distPkgRoot, "package.json"), "utf8")).version ?? null;
    }
  } catch { /* ignore */ }
  const distTargets = distDir ? {
    "dist/bin.js": join(distDir, "bin.js"),
    "dist/runtime/mcp-central.js": join(distDir, "runtime", "mcp-central.js"),
    "dist/runtime/mcp/stdio.js": join(distDir, "runtime", "mcp", "stdio.js"),
    "dist/runtime/handover/ownership.js": join(distDir, "runtime", "handover", "ownership.js"),
  } : {};
  const distDigests = {};
  let minDistMtimeMs = Infinity;
  for (const [label, path] of Object.entries(distTargets)) {
    distDigests[label] = sha256File(path);
    try {
      const mt = statSync(path).mtimeMs;
      if (mt < minDistMtimeMs) minDistMtimeMs = mt;
    } catch { minDistMtimeMs = 0; }
  }
  const maxSrcMtimeMs = Math.max(
    maxMtimeRecursive(join(repoRoot, "packages", "h2a", "src")),
    maxMtimeRecursive(join(repoRoot, "packages", "h2a-runtime", "src"))
  );
  const distUpToDate = Number.isFinite(minDistMtimeMs) && minDistMtimeMs > 0 && minDistMtimeMs >= maxSrcMtimeMs;
  return {
    candidateHead: sha ? { sha, dirty, ...(untrackedHarnessFiles.length > 0 ? { untrackedHarnessFiles } : {}) } : null,
    candidateVersion,
    candidateDist: {
      binPath: mainBin,
      candidateVersion,
      digests: distDigests,
      maxSrcMtimeMs: Math.round(maxSrcMtimeMs),
      minDistMtimeMs: Number.isFinite(minDistMtimeMs) ? Math.round(minDistMtimeMs) : 0,
      distUpToDate,
    },
  };
}

const mainBin = candidateEntry();
const provenance = resolveCandidateProvenance(mainBin);
if (mainBin && !provenance.candidateDist.distUpToDate && !allowStaleDist) {
  console.error("bench: refusing to measure stale dist (packages/h2a/src or packages/h2a-runtime/src is newer than dist; run npm run build first or pass --allow-stale-dist)");
  try { rmSync(runDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(2);
}

const isCaseFailed = (c) => {
  const signalFailed = c.exitSignal !== null && !(c.expectedStop && (c.exitSignal === "SIGINT" || c.exitSignal === "SIGKILL"));
  const codeFailed = c.exitCode !== null && c.exitCode !== 0;
  const c51Failed = !c.c51HealthOk || !c.c51PingOk;
  const sessions = c.sessionsRequested ?? 0;
  const shimsFailed = sessions > 0 && (
    c.shimsAliveBefore !== sessions ||
    c.shimsAliveAfter !== sessions ||
    c.steadyAttachmentsBefore !== sessions ||
    c.steadyAttachmentsAfter !== sessions
  );
  const c55Failed = Boolean(c.c55) && (
    !c.c55.driveConsentObserved ||
    (sessions > 0 && (
      c.c55.shimsAliveBefore !== sessions ||
      c.c55.shimsAliveAfter !== sessions ||
      c.c55.attachmentsBefore !== sessions ||
      c.c55.attachmentsAfter !== sessions
    ))
  );
  return Boolean(c.timeout || c.spawnFailed || codeFailed || signalFailed || c.measureError || c51Failed || shimsFailed || c55Failed);
};

const caseRc10 = join(runDir, "case-rc10");
const caseMain = join(runDir, "case-main");
const witnessPrefix = join(runDir, "witness");
const npmCache = join(runDir, "npm-cache");
const loadavgStart = os.loadavg().map((n) => Math.round(n * 100) / 100);
if (loadavgStart[0] > 6) {
  console.error(`bench: WARNING loadavg[0]=${loadavgStart[0]} > 6; startup/IO timings may reflect host load`);
}

let counts = { ops: 0, effects: 0, archiveFiles: 0 };
const results = {
  tool: "bench-central-real-copy.mjs",
  startedAt: new Date().toISOString(),
  sourceState, sourceRoot, witnessVersion: rc10ver,
  ...provenance,
  node: process.version,
  mode: supervised ? "supervised" : "retirement",
  cpuProf: !noCpuProf,
  sessionsRequested: sessionsCount,
  measureMs,
  witnessTimeoutMs,
  c51TrialsRequested: c51TrialsCount,
  c55Requested: measureC55,
  system: {
    cpus: os.cpus().length,
    clkTck: CLK_TCK,
    loadavgStart,
    loadavgEnd: null,
    loadavgHigh: loadavgStart[0] > 6,
  },
  notMeasured: measureC55 ? [] : ["C5.5-drive-consent-CPU"],
  c51Trials: null,
  cases: {},
};

function resolveWitnessEntry() {
  const home = join(runDir, "npm-home");
  mkdirSync(witnessPrefix, { recursive: true, mode: 0o700 });
  mkdirSync(npmCache, { recursive: true, mode: 0o700 });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const npmEnv = {
    ...process.env, HOME: home, npm_config_cache: npmCache,
    TMPDIR: runBase, TMP: runBase, TEMP: runBase,
  };
  delete npmEnv.H2A_MCP_AUTHORITY;
  delete npmEnv.H2A_MCP_CENTRAL_ENDPOINT;
  try {
    execFileSync("npm", ["install", "--prefix", witnessPrefix, "--no-audit", "--no-fund", `@sentropic/h2a@${rc10ver}`], { encoding: "utf8", timeout: 300_000, env: npmEnv });
  } catch (error) {
    return { bin: null, reason: `npm-install-failed: ${String(error?.message ?? error).slice(0, 300)}` };
  }
  try {
    execFileSync("chmod", ["-R", "go-w", witnessPrefix]);
  } catch (error) {
    return { bin: null, reason: `witness-chmod-failed: ${String(error?.message ?? error).slice(0, 200)}` };
  }
  const bin = join(witnessPrefix, "node_modules", "@sentropic", "h2a", "dist", "bin.js");
  if (!existsSync(bin)) return { bin: null, reason: `witness-bin-missing: ${bin}` };
  let installedVersion = null;
  try {
    installedVersion = JSON.parse(readFileSync(join(witnessPrefix, "node_modules", "@sentropic", "h2a", "package.json"), "utf8")).version ?? null;
  } catch { /* ignore */ }
  return { bin, reason: null, installedVersion };
}

function writeResults() {
  results.system.loadavgEnd = os.loadavg().map((n) => Math.round(n * 100) / 100);
  results.system.loadavgHigh = Boolean(results.system.loadavgHigh || results.system.loadavgEnd[0] > 6);
  results.finishedAt = new Date().toISOString();
  try { writeFileSync(join(outDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`, { mode: 0o600 }); } catch { /* out dir kept best-effort */ }
}

try {
  if (existsSync(sourceState)) {
    counts.ops = readdirSync(sourceState).filter((n) => n.startsWith("operation-")).length;
    counts.effects = readdirSync(sourceState).filter((n) => n.startsWith("effect-")).length;
    try {
      const archDir = join(sourceState, "archive");
      for (const batch of readdirSync(archDir)) {
        if (batch.startsWith("batch-")) counts.archiveFiles += readdirSync(join(archDir, batch)).length;
      }
    } catch { /* no archive */ }
  }
  results.sourceCounts = counts;
  console.log(JSON.stringify({ event: "l5-bench-start", sourceState, sourceRoot, counts, runDir, outDir, cpuProf: !noCpuProf, measureMs, c51TrialsCount, measureC55 }));
  const { bin: witnessBin, reason: witnessReason, installedVersion: witnessInstalled } = skipWitness
    ? { bin: null, reason: "--skip-witness", installedVersion: undefined }
    : resolveWitnessEntry();
  if (witnessInstalled) results.witnessInstalledVersion = witnessInstalled;
  if (!mainBin) {
    console.error(JSON.stringify({ event: "candidate-unavailable", hint: "run npm run build:h2a first" }));
    results.candidateUnavailable = true;
    process.exitCode = 2;
  } else {
    if (skipWitness) {
      results.cases.rc10 = { name: "rc10", status: "skipped", reason: "--skip-witness", listenMs: null, timeout: null, exitCode: null, exitSignal: null, rssPeakMB: null };
      console.log(JSON.stringify({ event: "case-rc10-skipped" }));
    } else if (witnessBin) {
      copyLedgerSubset(sourceState, sourceRoot, join(caseRc10, "runtime"), join(caseRc10, "root"));
      console.log(JSON.stringify({ event: "case-rc10-ready", runDir }));
      const profRc10 = join(runDir, "prof-rc10");
      const w = await runCase("rc10", witnessBin, join(caseRc10, "root"), join(caseRc10, "runtime"), profRc10, join(caseRc10, "home"), witnessTimeoutMs, {
        supervised, sessions: sessionsCount, cpuProf: !noCpuProf, c55: false,
      });
      w.status = isCaseFailed(w) ? "witness-failed" : "ok";
      delete w.expectedStop;
      results.cases.rc10 = w;
      if (!noCpuProf) {
        const prof = newestProfile(profRc10);
        if (prof) {
          try {
            const outProf = join(outDir, "witness.cpuprofile");
            cpSync(join(profRc10, prof), outProf);
            results.cases.rc10.profile = "witness.cpuprofile";
            results.cases.rc10.cpuSummary = summarizeCpuProfile(outProf);
          } catch { /* ignore */ }
        }
      }
      console.log(JSON.stringify({ event: "case-rc10-done", status: w.status, listenMs: w.listenMs, c51Ms: w.c51Ms, timeout: w.timeout, exitCode: w.exitCode, exitSignal: w.exitSignal, rssPeakMB: w.rssPeakMB, steadyCpuPct: w.steadyCpuPct, migrationDoneMs: w.migrationDoneMs, peakMigrationP99Ms: w.peakMigrationP99Ms }));
      rmSync(caseRc10, { recursive: true, force: true });
      rmSync(witnessPrefix, { recursive: true, force: true });
      rmSync(npmCache, { recursive: true, force: true });
      console.log(JSON.stringify({ event: "case-rc10-cleaned" }));
    } else {
      results.cases.rc10 = { name: "rc10", status: "witness-failed", reason: witnessReason, listenMs: null, timeout: null, exitCode: null, exitSignal: null, rssPeakMB: null };
      console.log(JSON.stringify({ event: "case-rc10-failed", status: "witness-failed", reason: witnessReason }));
      try { rmSync(witnessPrefix, { recursive: true, force: true }); } catch { /* ignore */ }
      try { rmSync(npmCache, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    if (c51TrialsCount > 0) {
      const trials = [];
      for (let i = 1; i <= c51TrialsCount; i++) {
        trials.push(await measureC51Trial(i, mainBin, counts));
      }
      const c51Vals = trials.map((t) => t.c51Ms).filter((v) => typeof v === "number").sort((a, b) => a - b);
      const mid = c51Vals.length > 0 ? c51Vals[Math.floor(c51Vals.length / 2)] : null;
      results.c51Trials = {
        definition: "spawn -> listening on + GET /_h2a-central/health 200 (ready) + GET /_h2a-central/ping 200",
        trials,
        medianMs: mid,
        minMs: c51Vals[0] ?? null,
        maxMs: c51Vals.at(-1) ?? null,
        allOk: trials.every((t) => t.ok),
      };
      console.log(JSON.stringify({ event: "c51-trials-done", medianMs: results.c51Trials.medianMs, maxMs: results.c51Trials.maxMs, allOk: results.c51Trials.allOk }));
    }

    const copiedMain = copyLedgerSubset(sourceState, sourceRoot, join(caseMain, "runtime"), join(caseMain, "root"));
    results.sourceSubdirs = copiedMain.copiedSubdirs;
    console.log(JSON.stringify({ event: "case-main-ready" }));
    const profMain = join(runDir, "prof-main");
    const m = await runCase("main", mainBin, join(caseMain, "root"), join(caseMain, "runtime"), profMain, join(caseMain, "home"), measureMs, {
      supervised, sessions: sessionsCount, cpuProf: !noCpuProf, c55: measureC55,
    });
    m.status = isCaseFailed(m) ? "candidate-failed" : "ok";
    delete m.expectedStop;
    results.cases.main = m;
    if (!noCpuProf) {
      const prof = newestProfile(profMain);
      if (prof) {
        try {
          const outProf = join(outDir, "candidate.cpuprofile");
          cpSync(join(profMain, prof), outProf);
          results.cases.main.profile = "candidate.cpuprofile";
          results.cases.main.cpuSummary = summarizeCpuProfile(outProf);
        } catch { /* ignore */ }
      }
    }
    if (m.status !== "ok") process.exitCode = 1;
    console.log(JSON.stringify({
      event: "case-main-done", status: m.status, listenMs: m.listenMs, c51Ms: m.c51Ms, timeout: m.timeout, exitCode: m.exitCode, exitSignal: m.exitSignal, rssPeakMB: m.rssPeakMB, steadyCpuPct: m.steadyCpuPct, migrationDoneMs: m.migrationDoneMs, peakMigrationP99Ms: m.peakMigrationP99Ms, c55CpuMs: m.c55?.cpuMs ?? null,
    }));
  }
  writeResults();
  console.log(JSON.stringify({ event: "l5-bench-results", outDir, results: join(outDir, "results.json") }));
} finally {
  writeResults();
  try { rmSync(caseRc10, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(caseMain, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(witnessPrefix, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(npmCache, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(runDir, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log(JSON.stringify({ event: "l5-bench-cleaned", runDir, outDir }));
}
