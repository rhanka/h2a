#!/usr/bin/env node
// L5B bench: measure candidate (and optional local --witness-bin or npm rc10 witness)
// on isolated copies of generated/source state.
// Implements REVIEW-553-opus-r2.md §6 + NB-17 (bounded C5.1 probe + firstMs),
// NB-18 (migrationLagSeries), NB-19 (shim cleanup on attach error),
// NB-20 (state fingerprint), NB-21 (--witness-bin, calibration & validity checks).
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { authenticatedHttpRequest } from "../packages/h2a/dist/runtime/handover/authenticated-http.js";
import { computeStateFingerprint } from "./generate-l5b-bench-state.mjs";

const HERE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE_DIR, "..");

function usage() {
  console.log(
    "Usage: bench-central-real-copy.mjs --source-state <dir> --source-root <dir> --out <dir> " +
    "[--run-base <dir>] [--rc10 <version>] [--witness-bin <dist/bin.js>] [--witness-timeout-ms <n>] " +
    "[--measure-ms <n>] [--c51-trials <n>] [--c55] [--supervised] [--sessions <n>] " +
    "[--skip-witness] [--no-cpu-prof] [--allow-stale-dist] [--max-loadavg <n>] " +
    "[--min-disk-gb <n>] [--strict-conditions] [--require-l5b-shape]"
  );
  console.log("  --run-base defaults to $TMPDIR (must be set, never /tmp); --source-state/--source-root/--out are required.");
  console.log("  --witness-bin <path> measures a local pre-fix dist/bin.js in the same run (mutually exclusive with --skip-witness).");
  console.log("  --max-loadavg defaults to 3.5 (loadavg 1m validity ceiling); --min-disk-gb defaults to 48.");
}

function parseCliOpts(argv) {
  const opt = (name, def) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
  };
  const requiredOpt = (name) => {
    const v = opt(name, "");
    if (!v) {
      console.error(`bench: ${name} is required`);
      usage();
      process.exit(2);
    }
    return v;
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    usage();
    process.exit(0);
  }
  const sourceState = resolve(requiredOpt("--source-state"));
  const sourceRoot = resolve(requiredOpt("--source-root"));
  const outDir = resolve(requiredOpt("--out"));
  const rc10ver = opt("--rc10", "0.98.11-rc.10");
  const witnessBinOpt = opt("--witness-bin", "");
  const witnessTimeoutMs = Number(opt("--witness-timeout-ms", "15000"));
  const measureMs = Number(opt("--measure-ms", "30000"));
  const c51TrialsCount = Math.max(0, Number.parseInt(opt("--c51-trials", "3"), 10) || 0);
  const measureC55 = argv.includes("--c55");
  const supervised = argv.includes("--supervised");
  const skipWitness = argv.includes("--skip-witness");
  const noCpuProf = argv.includes("--no-cpu-prof");
  const allowStaleDist = argv.includes("--allow-stale-dist");
  const strictConditions = argv.includes("--strict-conditions");
  const requireL5bShape = argv.includes("--require-l5b-shape");
  const maxLoadavg = Number(opt("--max-loadavg", "3.5"));
  const minDiskGiB = Number(opt("--min-disk-gb", "48"));
  const sessionsCount = Math.max(0, Number.parseInt(opt("--sessions", "0"), 10) || 0);
  const explicitRunBase = opt("--run-base", "");
  return {
    sourceState, sourceRoot, outDir, rc10ver, witnessBinOpt, witnessTimeoutMs,
    measureMs, c51TrialsCount, measureC55, supervised, skipWitness, noCpuProf,
    allowStaleDist, strictConditions, requireL5bShape, maxLoadavg, minDiskGiB,
    sessionsCount, explicitRunBase,
  };
}

const LISTEN_TIMEOUT_MS = 30_000;

function diskFreeGiB(path) {
  try {
    const st = statfsSync(path);
    return (Number(st.bavail) * Number(st.bsize)) / (1024 ** 3);
  } catch {
    return NaN;
  }
}

function diskOk(path, needGiB = 48) {
  const free = diskFreeGiB(path);
  return Number.isFinite(free) && free >= needGiB;
}

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
  const rootSubdirs = ["registry", "keys", "negotiations", "inbox"];
  const copiedSubdirs = {};
  if (srcRoot && existsSync(srcRoot)) {
    for (const sub of rootSubdirs) {
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
    for (const sub of rootSubdirs) {
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
  // NB-19: define closeAll before spawning so any spawn/handshake failure closes all started shims & pipes.
  const closeAll = async () => {
    await Promise.all(shims.map(async ({ cp, rl }) => {
      try { rl.close(); } catch { /* ignore */ }
      if (cp.exitCode === null && cp.signalCode === null) {
        try { cp.stdin.end(); } catch { /* ignore */ }
        const exited = new Promise((r) => cp.once("exit", r));
        await Promise.race([exited, new Promise((r) => setTimeout(r, 1500))]);
        if (cp.exitCode === null && cp.signalCode === null) {
          try { cp.kill("SIGKILL"); } catch { /* ignore */ }
          await Promise.race([exited, new Promise((r) => setTimeout(r, 500))]);
        }
      }
      try { cp.stdout?.destroy(); } catch { /* ignore */ }
      try { cp.stderr?.destroy(); } catch { /* ignore */ }
    }));
  };

  try {
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
            const resolvePending = pending.get(msg.id);
            pending.delete(msg.id);
            resolvePending(msg);
          }
        } catch { /* ignore non-json */ }
      });
      let stderr = "";
      cp.stderr.on("data", (d) => { stderr += String(d); });
      const request = (id, method, params) => new Promise((resolveReq, rejectReq) => {
        const timer = setTimeout(() => { pending.delete(id); rejectReq(new Error(`shim ${i} ${method} timeout`)); }, 15_000);
        pending.set(id, (msg) => { clearTimeout(timer); resolveReq(msg); });
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
  } catch (error) {
    await closeAll().catch(() => {});
    throw error;
  }

  return {
    shims,
    countAlive() {
      return shims.filter((s) => s.cp.exitCode === null && s.cp.signalCode === null).length;
    },
    closeAll,
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

// NB-17: poll /health until state === "ready" (200) and /ping === 200 within a bounded timeout.
export async function probeC51Endpoints(endpoint, timeoutMs = 5_000) {
  const healthUrl = new URL("/_h2a-central/health", endpoint);
  const pingUrl = new URL("/_h2a-central/ping", endpoint);
  const deadline = performance.now() + timeoutMs;
  let probesCount = 0;
  let last = { healthStatus: null, pingStatus: null, healthOk: false, pingOk: false, probesCount: 0 };
  while (performance.now() < deadline) {
    probesCount++;
    const remainingMs = Math.max(100, Math.floor(deadline - performance.now()));
    try {
      const [healthRes, pingRes] = await Promise.all([
        fetch(healthUrl, { signal: AbortSignal.timeout(remainingMs) }),
        fetch(pingUrl, { signal: AbortSignal.timeout(remainingMs) }),
      ]);
      const healthBody = await healthRes.json().catch(() => null);
      await pingRes.text().catch(() => {});
      const healthOk = healthRes.status === 200 && healthBody?.state === "ready";
      const pingOk = pingRes.status === 200;
      last = {
        healthStatus: healthRes.status,
        pingStatus: pingRes.status,
        healthOk,
        pingOk,
        probesCount,
      };
      if (healthOk && pingOk) return last;
    } catch {
      last = { ...last, probesCount };
    }
    if (performance.now() + 10 < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    } else {
      break;
    }
  }
  return last;
}

export function summarizeC51Trials(trials) {
  const okTrials = trials.filter((t) => t.ok && typeof t.c51Ms === "number");
  const c51Vals = okTrials.map((t) => t.c51Ms).sort((a, b) => a - b);
  const mid = c51Vals.length > 0 ? c51Vals[Math.floor(c51Vals.length / 2)] : null;
  const firstTrial = trials[0];
  const firstMs = firstTrial?.ok && typeof firstTrial.c51Ms === "number" ? firstTrial.c51Ms : null;
  return {
    definition: "spawn -> listening on + GET /_h2a-central/health 200 (ready, polled) + GET /_h2a-central/ping 200",
    trials,
    firstMs,
    medianMs: mid,
    minMs: c51Vals[0] ?? null,
    maxMs: c51Vals.at(-1) ?? null,
    okCount: okTrials.length,
    allOk: trials.length > 0 && trials.every((t) => t.ok),
  };
}

async function stopChildCleanly(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return { exitCode: child?.exitCode ?? null, exitSignal: child?.signalCode ?? null };
  }
  const exit = await new Promise((resolveExit) => {
    child.kill("SIGINT");
    const timer = setTimeout(() => resolveExit({ exitCode: child.exitCode, exitSignal: child.signalCode ?? "SIGINT-timeout" }), 3_000);
    child.once("exit", () => { clearTimeout(timer); resolveExit({ exitCode: child.exitCode, exitSignal: child.signalCode }); });
  });
  if (exit.exitCode === null && (exit.exitSignal === "SIGINT" || exit.exitSignal === "SIGINT-timeout")) {
    try { process.kill(child.pid, "SIGKILL"); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 1000));
    return { exitCode: child.exitCode, exitSignal: child.signalCode };
  }
  return exit;
}

async function measureC51Trial(runDir, label, trialIndex, entryBin, copyMeta, trialOpts) {
  const { sourceState, sourceRoot, supervised } = trialOpts;
  const trialDir = join(runDir, `c51-${label}-trial-${trialIndex}`);
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
    await new Promise((resolveListen, rejectListen) => {
      const timer = setTimeout(() => rejectListen(new Error(`c51 ${label} trial ${trialIndex} listen timeout`)), LISTEN_TIMEOUT_MS);
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
          resolveListen();
        }
      };
      child.stdout.on("data", onChunk);
      child.stderr.on("data", onChunk);
      child.once("exit", (code, sig) => {
        clearTimeout(timer);
        if (!endpoint) rejectListen(new Error(`c51 ${label} trial ${trialIndex} exited early code=${code} sig=${sig}: ${output.slice(0, 500)}`));
      });
    });
    const probe = await probeC51Endpoints(endpoint, 5_000);
    const c51Perf = performance.now();
    const exit = await stopChildCleanly(child);
    const ok = probe.healthOk && probe.pingOk && exit.exitCode === 0;
    return {
      trial: trialIndex,
      hasKeys: copied.hasKeys,
      rootFiles: copied.count,
      archiveFiles: copied.archiveFiles,
      listenMs: Math.round((listenPerf - startPerf) * 10) / 10,
      c51Ms: probe.healthOk && probe.pingOk ? Math.round((c51Perf - startPerf) * 10) / 10 : null,
      probesCount: probe.probesCount,
      healthStatus: probe.healthStatus,
      pingStatus: probe.pingStatus,
      ok,
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

async function runC51Trials(runDir, label, count, entryBin, copyMeta, trialOpts) {
  const trials = [];
  for (let i = 1; i <= count; i++) {
    trials.push(await measureC51Trial(runDir, label, i, entryBin, copyMeta, trialOpts));
  }
  return summarizeC51Trials(trials);
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
  const listen = await new Promise((resolveListenWait) => {
    resolveListen = resolveListenWait;
    listenTimer = setTimeout(() => {
      resolveListen = null;
      resolveListenWait({ ms: performance.now() - startPerf, endpoint: null, timeout: true });
    }, LISTEN_TIMEOUT_MS);
    checkListen();
  });

  let c51Ms = null;
  let c51HealthOk = false;
  let c51PingOk = false;
  if (!listen.timeout && listen.endpoint) {
    try {
      const probe = await probeC51Endpoints(listen.endpoint, 5_000);
      if (probe.healthOk && probe.pingOk) {
        c51Ms = Math.round((performance.now() - startPerf) * 10) / 10;
      }
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
  const migrationLagSeries = [];
  let steadyCpuTicks = null;
  let steadyCpuMs = null;
  let steadyCpuPct = null;
  let steadyWallMs = null;
  let shimsAliveBefore = null;
  let shimsAliveAfter = null;
  let steadyAttachmentsBefore = null;
  let steadyAttachmentsAfter = null;
  let steadyLagP99BeforeMs = null;
  let steadyLagMaxBeforeMs = null;
  let steadyLagP99Ms = null;
  let steadyLagMaxAfterMs = null;
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
      const attachPromise = marker && (caseOpts.sessions ?? 0) > 0
        ? attachRealShims(entryBin, caseOpts.sessions, runtimeBase, root, join(profDir, "shims"))
        : Promise.resolve(null);
      const migrationPromise = (async () => {
        if (!marker) return;
        const migDeadline = Date.now() + Math.max(30_000, caseMeasureMs);
        while (Date.now() < migDeadline && child.exitCode === null && child.signalCode === null) {
          const st = await pollStatus(marker);
          const tMs = Math.round((performance.now() - startPerf) * 10) / 10;
          if (st?.eventLoopLagMs) {
            const p99 = Number(st.eventLoopLagMs.p99 ?? 0);
            const max = Number(st.eventLoopLagMs.max ?? 0);
            const complete = Boolean(st.ledgerMigrationComplete);
            // NB-18: preserve per-sample migration lag series for attribution.
            migrationLagSeries.push({
              tMs,
              p99Ms: Math.round(p99 * 100) / 100,
              maxMs: Math.round(max * 100) / 100,
              complete,
              attachments: st.attachments ?? null,
            });
            peakMigrationP99Ms = Math.max(peakMigrationP99Ms ?? 0, p99);
            peakMigrationMaxMs = Math.max(peakMigrationMaxMs ?? 0, max);
            if (complete) {
              finalMigrationP99Ms = p99;
              migrationDoneMs = Date.now() - startWall;
              break;
            }
          } else if (st?.ledgerMigrationComplete === true) {
            migrationLagSeries.push({
              tMs,
              p99Ms: null,
              maxMs: null,
              complete: true,
              attachments: st.attachments ?? null,
            });
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
          steadyLagP99BeforeMs = stBefore?.eventLoopLagMs?.p99 !== undefined ? Math.round(stBefore.eventLoopLagMs.p99 * 100) / 100 : null;
          steadyLagMaxBeforeMs = stBefore?.eventLoopLagMs?.max !== undefined ? Math.round(stBefore.eventLoopLagMs.max * 100) / 100 : null;
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
          steadyLagP99Ms = stAfter?.eventLoopLagMs?.p99 !== undefined ? Math.round(stAfter.eventLoopLagMs.p99 * 100) / 100 : null;
          steadyLagMaxAfterMs = stAfter?.eventLoopLagMs?.max !== undefined ? Math.round(stAfter.eventLoopLagMs.max * 100) / 100 : null;
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
    migrationLagSeries,
    steadyLagP99BeforeMs,
    steadyLagMaxBeforeMs,
    steadyLagP99Ms,
    steadyLagMaxAfterMs,
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
  const repoBin = join(REPO_ROOT, "packages", "h2a", "dist", "bin.js");
  if (existsSync(repoBin)) return repoBin;
  return null;
}

function resolveBuildProvenance(mainBin, baseRepoRoot) {
  let sha = null;
  let dirty = null;
  let untrackedHarnessFiles = [];
  let packageVersion = null;
  if (baseRepoRoot && existsSync(join(baseRepoRoot, ".git"))) {
    try {
      sha = execFileSync("git", ["-C", baseRepoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const porcelain = execFileSync("git", ["-C", baseRepoRoot, "status", "--porcelain"], { encoding: "utf8" })
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
  }
  const distDir = mainBin ? dirname(mainBin) : null;
  const distPkgRoot = distDir ? dirname(distDir) : null;
  try {
    if (distPkgRoot) {
      packageVersion = JSON.parse(readFileSync(join(distPkgRoot, "package.json"), "utf8")).version ?? null;
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
  const srcRoot = baseRepoRoot ?? (distPkgRoot ? dirname(dirname(distPkgRoot)) : null);
  const maxSrcMtimeMs = srcRoot ? Math.max(
    maxMtimeRecursive(join(srcRoot, "packages", "h2a", "src")),
    maxMtimeRecursive(join(srcRoot, "packages", "h2a-runtime", "src"))
  ) : 0;
  const distUpToDate = Number.isFinite(minDistMtimeMs) && minDistMtimeMs > 0 && minDistMtimeMs >= maxSrcMtimeMs;
  return {
    head: sha ? { sha, dirty, ...(untrackedHarnessFiles.length > 0 ? { untrackedHarnessFiles } : {}) } : null,
    version: packageVersion,
    dist: {
      binPath: mainBin,
      version: packageVersion,
      digests: distDigests,
      maxSrcMtimeMs: Math.round(maxSrcMtimeMs),
      minDistMtimeMs: Number.isFinite(minDistMtimeMs) ? Math.round(minDistMtimeMs) : 0,
      distUpToDate,
    },
  };
}

function resolveCandidateProvenance(mainBin) {
  const p = resolveBuildProvenance(mainBin, REPO_ROOT);
  return {
    candidateHead: p.head,
    candidateVersion: p.version,
    candidateDist: {
      binPath: p.dist.binPath,
      candidateVersion: p.version,
      digests: p.dist.digests,
      maxSrcMtimeMs: p.dist.maxSrcMtimeMs,
      minDistMtimeMs: p.dist.minDistMtimeMs,
      distUpToDate: p.dist.distUpToDate,
    },
  };
}

function findRepoRootForBin(binPath) {
  let cursor = dirname(resolve(binPath));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(cursor, ".git")) && existsSync(join(cursor, "packages", "h2a"))) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

// NB-21: Evaluate whether the pre-fix witness reproduced the "before" order of magnitude (§6.2.b).
export function evaluateWitnessCalibration(witnessCase, witnessC51Trials, requestedC51Trials, requestedSessions = 5) {
  const expectedPresteps = {
    steadyCpuPctApprox: 4.3,
    migrationDoneMsRange: [4700, 11600],
    peakMigrationP99MsMin: 74,
    c51MsRange: [430, 775],
  };
  const calibrationThresholds = {
    steadyCpuPctMin: 2.0,
    steadyCpuPctMax: 15.0,
    migrationDoneMsMin: 2500,
    migrationDoneMsMax: 25000,
    peakMigrationP99MsMin: 50,
    c51MsMin: 250,
    c51MsMax: 2000,
  };
  const observed = {
    status: witnessCase?.status ?? null,
    steadyCpuPct: witnessCase?.steadyCpuPct ?? null,
    migrationDoneMs: witnessCase?.migrationDoneMs ?? null,
    peakMigrationP99Ms: witnessCase?.peakMigrationP99Ms ?? null,
    c51CaseMs: witnessCase?.c51Ms ?? null,
    c51FirstMs: witnessC51Trials?.firstMs ?? null,
    c51MedianMs: witnessC51Trials?.medianMs ?? null,
    c51MaxMs: witnessC51Trials?.maxMs ?? null,
    c51AllOk: witnessC51Trials?.allOk ?? null,
  };
  const failures = [];
  if (!witnessCase || witnessCase.status !== "ok") {
    failures.push(`witness status is ${witnessCase?.status ?? "missing"}`);
  }
  if (requestedSessions > 0) {
    if (typeof observed.steadyCpuPct !== "number" || observed.steadyCpuPct < calibrationThresholds.steadyCpuPctMin || observed.steadyCpuPct > calibrationThresholds.steadyCpuPctMax) {
      failures.push(`witness steadyCpuPct=${observed.steadyCpuPct} outside [${calibrationThresholds.steadyCpuPctMin}, ${calibrationThresholds.steadyCpuPctMax}]% (ref ~4.3%)`);
    }
  }
  if (typeof observed.migrationDoneMs !== "number" || observed.migrationDoneMs < calibrationThresholds.migrationDoneMsMin || observed.migrationDoneMs > calibrationThresholds.migrationDoneMsMax) {
    failures.push(`witness migrationDoneMs=${observed.migrationDoneMs} outside [${calibrationThresholds.migrationDoneMsMin}, ${calibrationThresholds.migrationDoneMsMax}]ms (ref 4.7-11.6s)`);
  }
  if (typeof observed.peakMigrationP99Ms !== "number" || observed.peakMigrationP99Ms < calibrationThresholds.peakMigrationP99MsMin) {
    failures.push(`witness peakMigrationP99Ms=${observed.peakMigrationP99Ms} < ${calibrationThresholds.peakMigrationP99MsMin}ms (ref >= 74ms)`);
  }
  if (requestedC51Trials > 0) {
    if (!witnessC51Trials?.allOk || typeof observed.c51FirstMs !== "number") {
      failures.push("witness C5.1 trials did not all pass");
    } else if (observed.c51MaxMs < calibrationThresholds.c51MsMin || observed.c51FirstMs > calibrationThresholds.c51MsMax) {
      failures.push(`witness C5.1 firstMs=${observed.c51FirstMs}/maxMs=${observed.c51MaxMs} outside [${calibrationThresholds.c51MsMin}, ${calibrationThresholds.c51MsMax}]ms (ref 430-775ms)`);
    }
  } else if (typeof observed.c51CaseMs !== "number" || observed.c51CaseMs < calibrationThresholds.c51MsMin || observed.c51CaseMs > calibrationThresholds.c51MsMax) {
    failures.push(`witness c51Ms=${observed.c51CaseMs} outside [${calibrationThresholds.c51MsMin}, ${calibrationThresholds.c51MsMax}]ms`);
  }

  return {
    calibrated: failures.length === 0,
    expectedPresteps,
    calibrationThresholds,
    observed,
    failures,
  };
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

async function main() {
  const {
    sourceState, sourceRoot, outDir, rc10ver, witnessBinOpt, witnessTimeoutMs,
    measureMs, c51TrialsCount, measureC55, supervised, skipWitness, noCpuProf,
    allowStaleDist, strictConditions, requireL5bShape, maxLoadavg, minDiskGiB,
    sessionsCount, explicitRunBase,
  } = parseCliOpts(process.argv.slice(2));

  if (skipWitness && witnessBinOpt) {
    console.error("bench: --skip-witness and --witness-bin are mutually exclusive");
    process.exit(2);
  }
  if (!Number.isFinite(measureMs) || measureMs <= 0) {
    console.error(`bench: invalid --measure-ms: ${measureMs}`);
    process.exit(2);
  }
  if (!Number.isFinite(witnessTimeoutMs) || witnessTimeoutMs <= 0) {
    console.error(`bench: invalid --witness-timeout-ms: ${witnessTimeoutMs}`);
    process.exit(2);
  }
  if (!Number.isFinite(maxLoadavg) || maxLoadavg <= 0) {
    console.error(`bench: invalid --max-loadavg: ${maxLoadavg}`);
    process.exit(2);
  }
  if (!Number.isFinite(minDiskGiB) || minDiskGiB <= 0) {
    console.error(`bench: invalid --min-disk-gb: ${minDiskGiB}`);
    process.exit(2);
  }

  for (const [label, val] of [
    ["--source-state", sourceState],
    ["--source-root", sourceRoot],
    ["--out", outDir],
    ...(witnessBinOpt ? [["--witness-bin", resolve(witnessBinOpt)]] : []),
  ]) {
    if (val === "/tmp" || val.startsWith("/tmp/")) {
      console.error(`bench: refusing ${label} under /tmp: ${val}`);
      process.exit(2);
    }
  }

  if (!existsSync(sourceState) || !statSync(sourceState).isDirectory()) {
    console.error(`bench: --source-state directory does not exist: ${sourceState}`);
    process.exit(2);
  }
  if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
    console.error(`bench: --source-root directory does not exist: ${sourceRoot}`);
    process.exit(2);
  }
  if (witnessBinOpt) {
    const resolvedWitness = resolve(witnessBinOpt);
    if (!existsSync(resolvedWitness) || !statSync(resolvedWitness).isFile()) {
      console.error(`bench: --witness-bin does not exist or is not a file: ${resolvedWitness}`);
      process.exit(2);
    }
  }

  const tmpdirEnv = process.env.TMPDIR ?? "";
  if (!explicitRunBase && !tmpdirEnv) {
    console.error("bench: refusing to start: set TMPDIR (lane .tmp) or pass --run-base <dir>; never /tmp");
    process.exit(2);
  }
  const runBase = resolve(explicitRunBase || tmpdirEnv);
  if (runBase === "/tmp" || runBase.startsWith("/tmp/")) {
    console.error(`bench: refusing to start: run base ${runBase} is /tmp; use the lane .tmp dir`);
    process.exit(2);
  }
  mkdirSync(runBase, { recursive: true, mode: 0o700 });

  const diskStartGiB = diskFreeGiB(runBase);
  if (!diskOk(runBase, minDiskGiB)) {
    console.error(`bench: refusing to start, free space ${Number.isFinite(diskStartGiB) ? diskStartGiB.toFixed(2) : "NaN"} GiB < ${minDiskGiB} GiB under ${runBase}`);
    process.exit(2);
  }

  const CLK_TCK = readClkTck();
  const mainBin = candidateEntry();
  const provenance = resolveCandidateProvenance(mainBin);
  if (mainBin && !provenance.candidateDist.distUpToDate && !allowStaleDist) {
    console.error("bench: refusing to measure stale dist (packages/h2a/src or packages/h2a-runtime/src is newer than dist; run npm run build first or pass --allow-stale-dist)");
    process.exit(2);
  }

  const sourceFingerprint = computeStateFingerprint(sourceState, sourceRoot);
  const loadavgStart = os.loadavg().map((n) => Math.round(n * 100) / 100);
  if (loadavgStart[0] > maxLoadavg) {
    console.error(`bench: WARNING loadavg[0]=${loadavgStart[0]} > ${maxLoadavg}; startup/IO timings may reflect host load`);
  }

  if (strictConditions) {
    const preflightFailures = [];
    if (loadavgStart[0] > maxLoadavg) {
      preflightFailures.push(`loadavgStart[0]=${loadavgStart[0]} > ${maxLoadavg}`);
    }
    if (!diskOk(runBase, minDiskGiB)) {
      preflightFailures.push(`diskFreeGiB=${diskStartGiB.toFixed(2)} < ${minDiskGiB}`);
    }
    if (provenance.candidateHead?.dirty) {
      preflightFailures.push("candidateHead.dirty === true");
    }
    if (!provenance.candidateDist?.distUpToDate && !allowStaleDist) {
      preflightFailures.push("candidateDist.distUpToDate === false");
    }
    if (requireL5bShape && !sourceFingerprint.shapeMatchesL5b) {
      preflightFailures.push(`sourceFingerprint shape mismatch: ${sourceFingerprint.shapeMismatches.join("; ")}`);
    }
    if (preflightFailures.length > 0) {
      console.error(`bench: refusing to start (--strict-conditions): ${preflightFailures.join(" | ")}`);
      process.exit(2);
    }
  }

  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const runDir = join(runBase, `h2a-l5-bench-${Date.now()}`);
  mkdirSync(runDir, { recursive: true, mode: 0o700 });

  const witnessCaseName = witnessBinOpt ? "witness" : "rc10";
  const caseWitness = join(runDir, `case-${witnessCaseName}`);
  const caseMain = join(runDir, "case-main");
  const witnessPrefix = join(runDir, "witness");
  const npmCache = join(runDir, "npm-cache");

  let counts = { ops: 0, effects: 0, archiveFiles: 0 };
  const results = {
    tool: "bench-central-real-copy.mjs",
    command: [process.execPath, ...process.argv.slice(1)],
    startedAt: new Date().toISOString(),
    sourceState,
    sourceRoot,
    sourceFingerprint,
    generatorSha256: sha256File(join(HERE_DIR, "generate-l5b-bench-state.mjs")),
    benchSha256: sha256File(fileURLToPath(import.meta.url)),
    witnessMode: skipWitness ? "skipped" : witnessBinOpt ? "local-bin" : "npm-rc10",
    witnessVersion: witnessBinOpt ? null : rc10ver,
    ...(witnessBinOpt ? { witnessBinRequested: resolve(witnessBinOpt) } : {}),
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
      loadavgLimit: maxLoadavg,
      loadavgStart,
      loadavgEnd: null,
      loadavgHigh: loadavgStart[0] > maxLoadavg,
      diskMinGiB: minDiskGiB,
      diskStartGiB: Number.isFinite(diskStartGiB) ? Math.round(diskStartGiB * 100) / 100 : null,
      diskEndGiB: null,
    },
    notMeasured: measureC55 ? [] : ["C5.5-drive-consent-CPU"],
    witnessC51Trials: null,
    witnessCalibration: null,
    c51Trials: null,
    cases: {},
    valid: null,
    invalidReasons: [],
  };

  function resolveWitnessEntry() {
    if (witnessBinOpt) {
      const resolvedBin = realpathSync(resolve(witnessBinOpt));
      const pkgDistDir = dirname(resolvedBin);
      const needed = [
        join(pkgDistDir, "runtime", "handover", "shim-bridge.js"),
        join(pkgDistDir, "runtime", "mcp-central-context.js"),
      ];
      for (const reqFile of needed) {
        if (!existsSync(reqFile)) {
          return { bin: null, isLocalBin: true, reason: `witness-dist-incomplete: missing ${reqFile}` };
        }
      }
      const witnessRepo = findRepoRootForBin(resolvedBin);
      const witnessProv = resolveBuildProvenance(resolvedBin, witnessRepo);
      return {
        bin: resolvedBin,
        isLocalBin: true,
        reason: null,
        installedVersion: witnessProv.version,
        witnessProvenance: witnessProv,
      };
    }

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
      return { bin: null, isLocalBin: false, reason: `npm-install-failed: ${String(error?.message ?? error).slice(0, 300)}` };
    }
    try {
      execFileSync("chmod", ["-R", "go-w", witnessPrefix]);
    } catch (error) {
      return { bin: null, isLocalBin: false, reason: `witness-chmod-failed: ${String(error?.message ?? error).slice(0, 200)}` };
    }
    const bin = join(witnessPrefix, "node_modules", "@sentropic", "h2a", "dist", "bin.js");
    if (!existsSync(bin)) return { bin: null, isLocalBin: false, reason: `witness-bin-missing: ${bin}` };
    let installedVersion = null;
    try {
      installedVersion = JSON.parse(readFileSync(join(witnessPrefix, "node_modules", "@sentropic", "h2a", "package.json"), "utf8")).version ?? null;
    } catch { /* ignore */ }
    return { bin, isLocalBin: false, reason: null, installedVersion };
  }

  function finalizeValidityAndWriteResults() {
    const loadavgEnd = os.loadavg().map((n) => Math.round(n * 100) / 100);
    const diskEndGiB = diskFreeGiB(runBase);
    results.system.loadavgEnd = loadavgEnd;
    results.system.loadavgHigh = Boolean(loadavgStart[0] > maxLoadavg || loadavgEnd[0] > maxLoadavg);
    results.system.diskEndGiB = Number.isFinite(diskEndGiB) ? Math.round(diskEndGiB * 100) / 100 : null;

    const reasons = [];
    if (loadavgStart[0] > maxLoadavg) reasons.push(`loadavgStart[0]=${loadavgStart[0]} > ${maxLoadavg}`);
    if (loadavgEnd[0] > maxLoadavg) reasons.push(`loadavgEnd[0]=${loadavgEnd[0]} > ${maxLoadavg}`);
    if (!Number.isFinite(diskEndGiB) || diskEndGiB < minDiskGiB) {
      reasons.push(`diskEndGiB=${Number.isFinite(diskEndGiB) ? diskEndGiB.toFixed(2) : "NaN"} < ${minDiskGiB}`);
    }
    if (results.candidateHead?.dirty !== false) reasons.push("candidateHead.dirty !== false");
    if (!results.candidateDist?.distUpToDate && !allowStaleDist) reasons.push("candidateDist.distUpToDate !== true");
    if (requireL5bShape && !results.sourceFingerprint?.shapeMatchesL5b) {
      reasons.push("sourceFingerprint.shapeMatchesL5b !== true");
    }
    if (results.candidateUnavailable) reasons.push("candidateUnavailable");
    if (results.cases.main?.status !== "ok") reasons.push(`candidate status=${results.cases.main?.status ?? "missing"}`);
    if (c51TrialsCount > 0 && !results.c51Trials?.allOk) reasons.push("candidate c51Trials.allOk !== true");
    if (!skipWitness) {
      if (results.witnessCalibration && !results.witnessCalibration.calibrated) {
        for (const f of results.witnessCalibration.failures) reasons.push(`witnessCalibration: ${f}`);
      } else if (results.cases[witnessCaseName]?.status !== "ok") {
        reasons.push(`witness status=${results.cases[witnessCaseName]?.status ?? "missing"}`);
      }
    }

    results.invalidReasons = reasons;
    results.valid = reasons.length === 0;
    results.finishedAt = new Date().toISOString();
    try {
      writeFileSync(join(outDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`, { mode: 0o600 });
    } catch { /* out dir kept best-effort */ }
  }

  const trialOpts = { sourceState, sourceRoot, supervised };
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
    console.log(JSON.stringify({ event: "l5-bench-start", sourceState, sourceRoot, counts, runDir, outDir, cpuProf: !noCpuProf, measureMs, c51TrialsCount, measureC55, witnessMode: results.witnessMode, sortedListSha256: sourceFingerprint.sortedListSha256 }));
    const witnessInfo = skipWitness
      ? { bin: null, isLocalBin: false, reason: "--skip-witness", installedVersion: undefined }
      : resolveWitnessEntry();
    const { bin: witnessBin, isLocalBin, reason: witnessReason, installedVersion: witnessInstalled, witnessProvenance } = witnessInfo;
    if (witnessInstalled) results.witnessInstalledVersion = witnessInstalled;
    if (witnessProvenance) results.witnessProvenance = witnessProvenance;
    if (!mainBin) {
      console.error(JSON.stringify({ event: "candidate-unavailable", hint: "run npm run build:h2a first" }));
      results.candidateUnavailable = true;
      process.exitCode = 2;
    } else {
      if (skipWitness) {
        results.cases[witnessCaseName] = { name: witnessCaseName, status: "skipped", reason: "--skip-witness", listenMs: null, timeout: null, exitCode: null, exitSignal: null, rssPeakMB: null };
        console.log(JSON.stringify({ event: `case-${witnessCaseName}-skipped` }));
      } else if (witnessBin) {
        if (c51TrialsCount > 0) {
          results.witnessC51Trials = await runC51Trials(runDir, witnessCaseName, c51TrialsCount, witnessBin, counts, trialOpts);
          console.log(JSON.stringify({ event: `c51-${witnessCaseName}-trials-done`, firstMs: results.witnessC51Trials.firstMs, medianMs: results.witnessC51Trials.medianMs, maxMs: results.witnessC51Trials.maxMs, allOk: results.witnessC51Trials.allOk }));
        }
        copyLedgerSubset(sourceState, sourceRoot, join(caseWitness, "runtime"), join(caseWitness, "root"));
        console.log(JSON.stringify({ event: `case-${witnessCaseName}-ready`, runDir }));
        const profWitness = join(runDir, `prof-${witnessCaseName}`);
        const w = await runCase(witnessCaseName, witnessBin, join(caseWitness, "root"), join(caseWitness, "runtime"), profWitness, join(caseWitness, "home"), witnessTimeoutMs, {
          supervised, sessions: sessionsCount, cpuProf: !noCpuProf, c55: false,
        });
        w.status = isCaseFailed(w) ? "witness-failed" : "ok";
        delete w.expectedStop;
        results.cases[witnessCaseName] = w;
        if (!noCpuProf) {
          const prof = newestProfile(profWitness);
          if (prof) {
            try {
              const outProf = join(outDir, "witness.cpuprofile");
              cpSync(join(profWitness, prof), outProf);
              results.cases[witnessCaseName].profile = "witness.cpuprofile";
              results.cases[witnessCaseName].cpuSummary = summarizeCpuProfile(outProf);
            } catch { /* ignore */ }
          }
        }
        results.witnessCalibration = evaluateWitnessCalibration(w, results.witnessC51Trials, c51TrialsCount, sessionsCount);
        console.log(JSON.stringify({
          event: `case-${witnessCaseName}-done`,
          status: w.status,
          calibrated: results.witnessCalibration.calibrated,
          listenMs: w.listenMs,
          c51Ms: w.c51Ms,
          rssPeakMB: w.rssPeakMB,
          steadyCpuPct: w.steadyCpuPct,
          migrationDoneMs: w.migrationDoneMs,
          peakMigrationP99Ms: w.peakMigrationP99Ms,
        }));
        rmSync(caseWitness, { recursive: true, force: true });
        if (!isLocalBin) {
          rmSync(witnessPrefix, { recursive: true, force: true });
          rmSync(npmCache, { recursive: true, force: true });
        }
        console.log(JSON.stringify({ event: `case-${witnessCaseName}-cleaned` }));
      } else {
        results.cases[witnessCaseName] = { name: witnessCaseName, status: "witness-failed", reason: witnessReason, listenMs: null, timeout: null, exitCode: null, exitSignal: null, rssPeakMB: null };
        results.witnessCalibration = evaluateWitnessCalibration(results.cases[witnessCaseName], null, c51TrialsCount, sessionsCount);
        console.log(JSON.stringify({ event: `case-${witnessCaseName}-failed`, status: "witness-failed", reason: witnessReason }));
        if (!isLocalBin) {
          try { rmSync(witnessPrefix, { recursive: true, force: true }); } catch { /* ignore */ }
          try { rmSync(npmCache, { recursive: true, force: true }); } catch { /* ignore */ }
        }
      }

      if (c51TrialsCount > 0) {
        results.c51Trials = await runC51Trials(runDir, "main", c51TrialsCount, mainBin, counts, trialOpts);
        console.log(JSON.stringify({ event: "c51-trials-done", firstMs: results.c51Trials.firstMs, medianMs: results.c51Trials.medianMs, maxMs: results.c51Trials.maxMs, allOk: results.c51Trials.allOk }));
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
      console.log(JSON.stringify({
        event: "case-main-done", status: m.status, listenMs: m.listenMs, c51Ms: m.c51Ms, timeout: m.timeout, exitCode: m.exitCode, exitSignal: m.exitSignal, rssPeakMB: m.rssPeakMB, steadyCpuPct: m.steadyCpuPct, migrationDoneMs: m.migrationDoneMs, peakMigrationP99Ms: m.peakMigrationP99Ms, c55CpuMs: m.c55?.cpuMs ?? null,
      }));
    }
    finalizeValidityAndWriteResults();
    if (!results.valid && !process.exitCode) process.exitCode = 1;
    console.log(JSON.stringify({ event: "l5-bench-results", outDir, results: join(outDir, "results.json"), valid: results.valid, invalidReasons: results.invalidReasons }));
  } finally {
    if (results.valid === null) {
      finalizeValidityAndWriteResults();
    }
    try { rmSync(caseWitness, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(caseMain, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(witnessPrefix, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(npmCache, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(runDir, { recursive: true, force: true }); } catch { /* ignore */ }
    console.log(JSON.stringify({ event: "l5-bench-cleaned", runDir, outDir }));
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
