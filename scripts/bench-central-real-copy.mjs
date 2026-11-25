#!/usr/bin/env node
// L5A bench: profile witness rc.10 then candidate main on isolated copies of the real state.
// Follows L5.md §3.1-§3.3: disk guard, single active copy, --cpu-prof, guaranteed witness cleanup.
//
// B-4 residual (r2 review §2): the witness is a FULL package install
// (`npm install --prefix <runDir>/witness @sentropic/h2a@<rc10>`), never a
// two-file extract (dist/bin.js alone dies with ERR_MODULE_NOT_FOUND — the
// published entry imports sibling modules). runCase returns `timeout` plus
// the exit code and marks a dead witness `witness-failed`. Profiles and a
// results JSON are written to a kept `--out` dir; peak RSS comes from VmHWM
// in /proc/<pid>/status. Lag p99, migrationTotalMs and C5.5 are NOT MEASURED
// by this bench (see results.json `notMeasured` + L5-report §8, L5B pre-step).
import { spawn, execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, cpSync, writeFileSync } from "node:fs";
import { statfsSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { authenticatedHttpRequest } from "../packages/h2a/dist/runtime/handover/authenticated-http.js";

function usage() {
  console.log("Usage: bench-central-real-copy.mjs --source-state <dir> --source-root <dir> --out <dir> [--run-base <dir>] [--rc10 <version>] [--witness-timeout-ms <n>] [--supervised] [--sessions <n>] [--skip-witness]");
  console.log("  --run-base defaults to $TMPDIR (must be set, never /tmp); --source-state/--source-root/--out are required (no hardcoded owner paths).");
  console.log("  --supervised starts mcp-central-serve with --supervised; --sessions <N> attaches N real bridgeCentralMcpStdio shims.");
  console.log("  --out is kept after the run (profiles + results.json); the witness prefix and runDir are always deleted.");
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
// B-4/NB-6: no hardcoded owner paths; sources and out dir are required options.
const sourceState = requiredOpt("--source-state");
const sourceRoot = requiredOpt("--source-root");
const outDir = requiredOpt("--out");
const rc10ver = opt("--rc10", "0.98.11-rc.10");
const witnessMs = Number(opt("--witness-timeout-ms", "15000"));
const supervised = args.includes("--supervised");
const skipWitness = args.includes("--skip-witness");
const sessionsCount = Math.max(0, Number.parseInt(opt("--sessions", "0"), 10) || 0);
const LISTEN_TIMEOUT_MS = 30_000;

// B-4/NB-6: never fall back to os.tmpdir() (/tmp). TMPDIR (or --run-base)
// must point inside the lane worktree; refuse otherwise.
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

function diskOk(path, needGB = 40) {
  try {
    const st = statfsSync(path);
    const freeGB = Number(st.bavail) * Number(st.bsize) / 1e9;
    return freeGB >= needGB;
  } catch { return false; }
}

function guardDiskOrExit() {
  if (!diskOk(runBase, 40)) {
    console.error(`bench: refusing to start, free space < 40G under ${runBase}`);
    try { rmSync(runDir, { recursive: true, force: true }); } catch { /* ignore */ }
    process.exit(2);
  }
}
guardDiskOrExit();

function copyLedgerSubset(srcState, srcRoot, destRuntime, destRoot) {
  const dstState = join(destRuntime, "h2a-mcp-central");
  mkdirSync(dstState, { recursive: true, mode: 0o700 });
  mkdirSync(destRoot, { recursive: true, mode: 0o700 });
  const keepRe = /^(operation-.*\.json|effect-.*\.json|generation-end-.*\.json|ownership-.*\.json|launch.*\.json|wake-.*\.json|checkpoint-.*\.json|participant-revision\.json)$/;
  // B-4/NB-6: the 512MiB cap covers everything copied, including archive/
  // and the registry/keys/negotiations subsets (previously archive/ was
  // copied after the cap check).
  const dirSize = (dir) => {
    let total = 0;
    try {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name);
        try {
          if (name.isDirectory()) total += dirSize(p);
          else if (name.isFile()) total += Number(statSync(p).size);
        } catch { /* ignore */ }
      }
    } catch { /* absent */ }
    return total;
  };
  let bytes = 0;
  let count = 0;
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
    bytes += dirSize(join(srcState, "archive"));
  }
  if (srcRoot && existsSync(srcRoot)) {
    for (const sub of ["registry", "keys", "negotiations"]) bytes += dirSize(join(srcRoot, sub));
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
  return { bytes, count, dstState };
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
    const cp = spawn(process.execPath, ["--input-type=module", "-e", childScript], {
      env: {
        ...process.env, HOME: shimHome, XDG_RUNTIME_DIR: runtimeBase,
        H2A_ROOT: root, H2A_WORKSPACE: shimWs, H2A_MCP_CENTRAL: "1",
        CLAUDE_CODE_SESSION_ID: `bench-shim-${i}`,
      },
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
    shims.push({ cp, rl, request, getStderr: () => stderr });
  }
  await Promise.all(shims.map(async (s) => {
    await s.request(1, "initialize", {
      protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "bench-real-shim", version: "1" },
    });
    s.cp.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    for (let attempt = 0; attempt < 40; attempt++) {
      const res = await s.request(100 + attempt, "tools/call", { name: "h2a_identity_status", arguments: {} });
      const status = JSON.parse(res.result?.content?.[0]?.text ?? "{}");
      if (status.state === "identity_ready") return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }));
  return {
    shims,
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

// Peak RSS in MiB from VmHWM in /proc/<pid>/status (true peak, not a single
// post-run sample). Falls back to a one-shot ps reading when /proc is absent.
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

async function runCase(name, entryBin, root, runtimeBase, profDir, home, measureMs, caseOpts = {}) {
  mkdirSync(profDir, { recursive: true, mode: 0o700 });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const env = {
    ...process.env, HOME: home, XDG_RUNTIME_DIR: runtimeBase, H2A_ROOT: root,
    H2A_MCP_AUTHORITY: "", H2A_MCP_CENTRAL_ENDPOINT: "",
  };
  delete env.H2A_MCP_AUTHORITY;
  delete env.H2A_MCP_CENTRAL_ENDPOINT;
  const serveArgs = [
    "--max-old-space-size=384", "--cpu-prof", `--cpu-prof-dir=${profDir}`,
    entryBin, "mcp-central-serve", "--root", root, "--runtime-base", runtimeBase,
    ...(caseOpts.supervised ? ["--supervised"] : []),
  ];
  let child;
  try {
    child = spawn(process.execPath, serveArgs, { env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return { name, spawnFailed: String(error?.message ?? error).slice(0, 300), listenMs: null, timeout: true, exitCode: null, exitSignal: null, expectedStop: false, rssPeakMB: NaN, stdout: "", stderr: "" };
  }
  let stdout = "";
  let stderr = "";
  const start = Date.now();
  let resolveListen;
  let listenTimer;
  const checkListen = () => {
    if (resolveListen && /listening on/.test(stdout + stderr)) {
      clearTimeout(listenTimer);
      const done = resolveListen;
      resolveListen = null;
      done({ ms: Date.now() - start, timeout: false });
    }
  };
  child.stdout.on("data", (c) => { stdout += String(c); checkListen(); });
  child.stderr.on("data", (c) => { stderr += String(c); checkListen(); });
  const listen = await new Promise((resolve) => {
    resolveListen = resolve;
    listenTimer = setTimeout(() => {
      resolveListen = null;
      resolve({ ms: Date.now() - start, timeout: true });
    }, LISTEN_TIMEOUT_MS);
    checkListen();
  });
  // B-4: sample the VmHWM peak while the case runs (not one ps sample after).
  let rssPeakMB = readVmHwmMB(child.pid);
  if (!Number.isFinite(rssPeakMB)) rssPeakMB = readPsRssMB(child.pid);
  const sampler = setInterval(() => {
    const v = readVmHwmMB(child.pid);
    const sample = Number.isFinite(v) ? v : readPsRssMB(child.pid);
    if (Number.isFinite(sample) && (!Number.isFinite(rssPeakMB) || sample > rssPeakMB)) rssPeakMB = sample;
  }, 200);

  let shimsHandle = null;
  let migrationDoneMs = null;
  let peakMigrationP99Ms = null;
  let peakMigrationMaxMs = null;
  let steadyCpuTicks = null;
  let steadyCpuMs = null;
  let steadyCpuPct = null;
  let steadyAttachmentsBefore = null;
  let steadyAttachmentsAfter = null;
  let shimsAliveAfter = null;
  let steadyLagP99Ms = null;
  let measureError = null;
  let diedEarly = child.exitCode !== null || child.signalCode !== null;

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
      if (marker && (caseOpts.sessions ?? 0) > 0) {
        shimsHandle = await attachRealShims(entryBin, caseOpts.sessions, runtimeBase, root, join(profDir, "shims"));
      }
      if (marker) {
        const migDeadline = Date.now() + Math.max(30_000, measureMs);
        while (Date.now() < migDeadline && child.exitCode === null && child.signalCode === null) {
          const st = await pollStatus(marker);
          if (st?.eventLoopLagMs) {
            peakMigrationP99Ms = Math.max(peakMigrationP99Ms ?? 0, Number(st.eventLoopLagMs.p99 ?? 0));
            peakMigrationMaxMs = Math.max(peakMigrationMaxMs ?? 0, Number(st.eventLoopLagMs.max ?? 0));
          }
          if (st?.ledgerMigrationComplete === true) {
            migrationDoneMs = Date.now() - start;
            break;
          }
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      if (child.exitCode === null && child.signalCode === null) {
        if ((caseOpts.sessions ?? 0) > 0) {
          await new Promise((r) => setTimeout(r, 1_500));
          const stBefore = marker ? await pollStatus(marker) : null;
          steadyAttachmentsBefore = stBefore?.attachments ?? null;
          const tBefore = readProcCpuTicks(child.pid);
          await new Promise((r) => {
            if (child.exitCode !== null || child.signalCode !== null) return r();
            const onExit = () => r();
            child.once("exit", onExit);
            setTimeout(() => { child.removeListener("exit", onExit); r(); }, measureMs);
          });
          const tAfter = readProcCpuTicks(child.pid);
          const stAfter = marker ? await pollStatus(marker) : null;
          steadyAttachmentsAfter = stAfter?.attachments ?? null;
          steadyLagP99Ms = stAfter?.eventLoopLagMs?.p99 ?? null;
          if (tBefore && tAfter && measureMs > 0) {
            steadyCpuTicks = tAfter.total - tBefore.total;
            steadyCpuMs = steadyCpuTicks * 10;
            steadyCpuPct = Math.round(((steadyCpuMs / measureMs) * 100) * 100) / 100;
          }
          if (shimsHandle) {
            shimsAliveAfter = shimsHandle.shims.filter((s) => s.cp.exitCode === null && s.cp.signalCode === null).length;
          }
        } else {
          const remainingWait = Math.max(0, measureMs - (Date.now() - start));
          if (remainingWait > 0) {
            await new Promise((r) => {
              if (child.exitCode !== null || child.signalCode !== null) return r();
              const onExit = () => r();
              child.once("exit", onExit);
              setTimeout(() => { child.removeListener("exit", onExit); r(); }, remainingWait);
            });
          }
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
    // Case lived through the whole measure window: stop it cleanly.
    const last = readVmHwmMB(child.pid);
    if (Number.isFinite(last) && (!Number.isFinite(rssPeakMB) || last > rssPeakMB)) rssPeakMB = last;
  }
  const expectedStop = !settled;
  const exit = settled
    ? { exitCode: child.exitCode, exitSignal: child.signalCode }
    : await new Promise((resolve) => {
      child.kill("SIGINT");
      const timer = setTimeout(() => resolve({ exitCode: child.exitCode, exitSignal: child.signalCode ?? "SIGINT-timeout" }), 3_000);
      child.once("exit", () => { clearTimeout(timer); resolve({ exitCode: child.exitCode, exitSignal: child.signalCode }); });
    });
  let finalExit = exit;
  if (finalExit.exitCode === null && finalExit.exitSignal && finalExit.exitSignal !== "SIGINT" && finalExit.exitSignal !== "SIGINT-timeout") {
    // Unexpected signal death (crash): record as-is.
  } else if (finalExit.exitCode === null && (finalExit.exitSignal === "SIGINT" || finalExit.exitSignal === "SIGINT-timeout")) {
    try { process.kill(child.pid, "SIGKILL"); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 1000));
    finalExit = { exitCode: child.exitCode, exitSignal: child.signalCode };
  }
  return {
    name, listenMs: listen.timeout ? null : listen.ms, timeout: listen.timeout,
    exitCode: finalExit.exitCode, exitSignal: finalExit.exitSignal, expectedStop,
    rssPeakMB: Number.isFinite(rssPeakMB) ? Math.round(rssPeakMB * 10) / 10 : null,
    migrationDoneMs,
    peakMigrationP99Ms: peakMigrationP99Ms !== null ? Math.round(peakMigrationP99Ms * 100) / 100 : null,
    peakMigrationMaxMs: peakMigrationMaxMs !== null ? Math.round(peakMigrationMaxMs * 100) / 100 : null,
    steadyLagP99Ms: steadyLagP99Ms !== null ? Math.round(steadyLagP99Ms * 100) / 100 : null,
    steadyCpuTicks, steadyCpuMs, steadyCpuPct,
    steadyAttachmentsBefore, steadyAttachmentsAfter, shimsAliveAfter,
    ...(measureError ? { measureError } : {}),
    stdout: stdout.slice(0, 2000), stderr: stderr.slice(0, 2000),
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

const caseRc10 = join(runDir, "case-rc10");
const caseMain = join(runDir, "case-main");
const witnessPrefix = join(runDir, "witness");
const npmCache = join(runDir, "npm-cache");
function resolveCandidateProvenance() {
  const repoRoot = dirname(dirname(new URL(import.meta.url).pathname));
  let sha = null;
  let dirty = null;
  let candidateVersion = null;
  try {
    sha = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    dirty = execFileSync("git", ["-C", repoRoot, "status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
  } catch { /* non-git tree */ }
  try {
    candidateVersion = JSON.parse(readFileSync(join(repoRoot, "packages", "h2a", "package.json"), "utf8")).version ?? null;
  } catch { /* ignore */ }
  return { candidateHead: sha ? { sha, dirty } : null, candidateVersion };
}
const provenance = resolveCandidateProvenance();
const isCaseFailed = (c) => {
  const signalFailed = c.exitSignal !== null && !(c.expectedStop && (c.exitSignal === "SIGINT" || c.exitSignal === "SIGKILL"));
  const codeFailed = c.exitCode !== null && c.exitCode !== 0;
  return Boolean(c.timeout || c.spawnFailed || codeFailed || signalFailed || c.measureError);
};
let counts = { ops: 0, effects: 0 };
const results = {
  tool: "bench-central-real-copy.mjs",
  startedAt: new Date().toISOString(),
  sourceState, sourceRoot, witnessVersion: rc10ver,
  ...provenance,
  node: process.version,
  mode: supervised ? "supervised" : "retirement",
  sessionsRequested: sessionsCount,
  measureMs: witnessMs,
  system: { cpus: os.cpus().length, loadavg: os.loadavg().map((n) => Math.round(n * 100) / 100) },
  notMeasured: ["C5.5-drive-consent-CPU"],
  cases: {},
};
// B-4 residual (1): witness is the FULL published package installed with npm
// (the old two-file dist/bin.js + package.json extract died with
// ERR_MODULE_NOT_FOUND because dist/bin.js imports sibling modules).
// Returns the witness entry binary path, or null with the reason recorded.
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
  // rc.10 refuses a group/other-writable prefix (prefix_owner_mismatch);
  // npm creates 0775 dirs, so strip those bits (same chmod the L5B
  // procedure applies to the live prefix).
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
function candidateEntry() {
  // Candidate is the locally built package (this checkout).
  const here = new URL(import.meta.url);
  const repoBin = join(dirname(dirname(here.pathname)), "packages", "h2a", "dist", "bin.js");
  if (existsSync(repoBin)) return repoBin;
  return null;
}
function writeResults() {
  results.finishedAt = new Date().toISOString();
  try { writeFileSync(join(outDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`, { mode: 0o600 }); } catch { /* out dir kept best-effort */ }
}
try {
  if (existsSync(sourceState)) {
    counts.ops = readdirSync(sourceState).filter((n) => n.startsWith("operation-")).length;
    counts.effects = readdirSync(sourceState).filter((n) => n.startsWith("effect-")).length;
  }
  results.sourceCounts = counts;
  console.log(JSON.stringify({ event: "l5-bench-start", sourceState, sourceRoot, counts, runDir, outDir }));
  const { bin: witnessBin, reason: witnessReason, installedVersion: witnessInstalled } = skipWitness
    ? { bin: null, reason: "--skip-witness", installedVersion: undefined }
    : resolveWitnessEntry();
  if (witnessInstalled) results.witnessInstalledVersion = witnessInstalled;
  const mainBin = candidateEntry();
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
      const w = await runCase("rc10", witnessBin, join(caseRc10, "root"), join(caseRc10, "runtime"), profRc10, join(caseRc10, "home"), witnessMs, { supervised, sessions: sessionsCount });
      // B-4 residual (2) + NB-15: treat crash by signal (other than bench's own stop signal) as failed.
      w.status = isCaseFailed(w) ? "witness-failed" : "ok";
      delete w.expectedStop;
      results.cases.rc10 = w;
      const prof = newestProfile(profRc10);
      if (prof) {
        try {
          const outProf = join(outDir, "witness.cpuprofile");
          cpSync(join(profRc10, prof), outProf);
          results.cases.rc10.profile = "witness.cpuprofile";
          results.cases.rc10.cpuSummary = summarizeCpuProfile(outProf);
        } catch { /* ignore */ }
      }
      console.log(JSON.stringify({ event: "case-rc10-done", status: w.status, listenMs: w.listenMs, timeout: w.timeout, exitCode: w.exitCode, exitSignal: w.exitSignal, rssPeakMB: w.rssPeakMB, steadyCpuPct: w.steadyCpuPct, migrationDoneMs: w.migrationDoneMs, peakMigrationP99Ms: w.peakMigrationP99Ms }));
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
    copyLedgerSubset(sourceState, sourceRoot, join(caseMain, "runtime"), join(caseMain, "root"));
    console.log(JSON.stringify({ event: "case-main-ready" }));
    const profMain = join(runDir, "prof-main");
    const m = await runCase("main", mainBin, join(caseMain, "root"), join(caseMain, "runtime"), profMain, join(caseMain, "home"), witnessMs, { supervised, sessions: sessionsCount });
    m.status = isCaseFailed(m) ? "candidate-failed" : "ok";
    delete m.expectedStop;
    results.cases.main = m;
    const prof = newestProfile(profMain);
    if (prof) {
      try {
        const outProf = join(outDir, "candidate.cpuprofile");
        cpSync(join(profMain, prof), outProf);
        results.cases.main.profile = "candidate.cpuprofile";
        results.cases.main.cpuSummary = summarizeCpuProfile(outProf);
      } catch { /* ignore */ }
    }
    console.log(JSON.stringify({
      event: "case-main-done", status: m.status, listenMs: m.listenMs, timeout: m.timeout, exitCode: m.exitCode, exitSignal: m.exitSignal, rssPeakMB: m.rssPeakMB, steadyCpuPct: m.steadyCpuPct, migrationDoneMs: m.migrationDoneMs, peakMigrationP99Ms: m.peakMigrationP99Ms,
    }));
  }
  writeResults();
  console.log(JSON.stringify({ event: "l5-bench-results", outDir, results: join(outDir, "results.json") }));
} finally {
  writeResults();
  // B-4 residual (3): --out survives; runDir (cases, witness prefix, profiles
  // sources, npm cache) is always deleted.
  try { rmSync(caseRc10, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(caseMain, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(witnessPrefix, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(npmCache, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(runDir, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log(JSON.stringify({ event: "l5-bench-cleaned", runDir, outDir }));
}
