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
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, cpSync, writeFileSync } from "node:fs";
import { statfsSync } from "node:fs";
import { dirname, join } from "node:path";

function usage() {
  console.log("Usage: bench-central-real-copy.mjs --source-state <dir> --source-root <dir> --out <dir> [--run-base <dir>] [--rc10 <version>] [--witness-timeout-ms <n>]");
  console.log("  --run-base defaults to $TMPDIR (must be set, never /tmp); --source-state/--source-root/--out are required (no hardcoded owner paths).");
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
  } catch { return true; }
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
  return { bytes, count, dstState };
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

async function runCase(name, entryBin, root, runtimeBase, profDir, home, measureMs) {
  mkdirSync(profDir, { recursive: true, mode: 0o700 });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const env = {
    ...process.env, HOME: home, XDG_RUNTIME_DIR: runtimeBase, H2A_ROOT: root,
    H2A_MCP_AUTHORITY: "", H2A_MCP_CENTRAL_ENDPOINT: "",
  };
  delete env.H2A_MCP_AUTHORITY;
  delete env.H2A_MCP_CENTRAL_ENDPOINT;
  let child;
  try {
    child = spawn(process.execPath, ["--max-old-space-size=384", "--cpu-prof", `--cpu-prof-dir=${profDir}`, entryBin, "mcp-central-serve", "--root", root, "--runtime-base", runtimeBase], { env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return { name, spawnFailed: String(error?.message ?? error).slice(0, 300), listenMs: null, timeout: true, exitCode: null, exitSignal: null, rssPeakMB: NaN, stdout: "", stderr: "" };
  }
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c) => { stdout += String(c); });
  child.stderr.on("data", (c) => { stderr += String(c); });
  const start = Date.now();
  const listen = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ms: Date.now() - start, timeout: true }), LISTEN_TIMEOUT_MS);
    const onData = (chunk) => {
      const text = stdout + String(chunk);
      if (/listening on/.test(text)) {
        clearTimeout(timer);
        resolve({ ms: Date.now() - start, timeout: false });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
  });
  // B-4: sample the VmHWM peak while the case runs (not one ps sample after).
  let rssPeakMB = readVmHwmMB(child.pid);
  if (!Number.isFinite(rssPeakMB)) rssPeakMB = readPsRssMB(child.pid);
  const sampler = setInterval(() => {
    const v = readVmHwmMB(child.pid);
    const sample = Number.isFinite(v) ? v : readPsRssMB(child.pid);
    if (Number.isFinite(sample) && (!Number.isFinite(rssPeakMB) || sample > rssPeakMB)) rssPeakMB = sample;
  }, 200);
  const settled = await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
    const onExit = () => resolve(true);
    child.once("exit", onExit);
    setTimeout(() => { child.removeListener("exit", onExit); resolve(false); }, listen.timeout ? 1000 : measureMs);
  });
  clearInterval(sampler);
  if (!listen.timeout && !settled) {
    // Case lived through the whole measure window: stop it cleanly.
    const last = readVmHwmMB(child.pid);
    if (Number.isFinite(last) && (!Number.isFinite(rssPeakMB) || last > rssPeakMB)) rssPeakMB = last;
  }
  const exit = child.exitCode !== null || child.signalCode !== null
    ? { exitCode: child.exitCode, exitSignal: child.signalCode }
    : await new Promise((resolve) => {
      child.kill("SIGINT");
      const timer = setTimeout(() => resolve({ exitCode: child.exitCode, exitSignal: child.signalCode ?? "SIGINT-timeout" }), 2000);
      child.once("exit", () => { clearTimeout(timer); resolve({ exitCode: child.exitCode, exitSignal: child.signalCode }); });
    });
  let finalExit = exit;
  if (finalExit.exitCode === null && finalExit.exitSignal && finalExit.exitSignal !== "SIGINT") {
    // Unexpected death (crash): record as-is.
  } else if (finalExit.exitCode === null && (finalExit.exitSignal === "SIGINT" || finalExit.exitSignal === "SIGINT-timeout")) {
    try { process.kill(child.pid, "SIGKILL"); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 1000));
    finalExit = { exitCode: child.exitCode, exitSignal: child.signalCode };
  }
  return {
    name, listenMs: listen.timeout ? null : listen.ms, timeout: listen.timeout,
    exitCode: finalExit.exitCode, exitSignal: finalExit.exitSignal,
    rssPeakMB: Number.isFinite(rssPeakMB) ? Math.round(rssPeakMB * 10) / 10 : null,
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
let counts = { ops: 0, effects: 0 };
const results = {
  tool: "bench-central-real-copy.mjs",
  startedAt: new Date().toISOString(),
  sourceState, sourceRoot, witnessVersion: rc10ver,
  notMeasured: ["eventLoopLagMs.p99", "migrationTotalMs", "C5.5-drive-consent-CPU"],
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
  const { bin: witnessBin, reason: witnessReason, installedVersion: witnessInstalled } = resolveWitnessEntry();
  if (witnessInstalled) results.witnessInstalledVersion = witnessInstalled;
  const mainBin = candidateEntry();
  if (!mainBin) {
    console.error(JSON.stringify({ event: "candidate-unavailable", hint: "run npm run build:h2a first" }));
    results.candidateUnavailable = true;
    process.exitCode = 2;
  } else {
    if (witnessBin) {
      copyLedgerSubset(sourceState, sourceRoot, join(caseRc10, "runtime"), join(caseRc10, "root"));
      console.log(JSON.stringify({ event: "case-rc10-ready", runDir }));
      const profRc10 = join(runDir, "prof-rc10");
      const w = await runCase("rc10", witnessBin, join(caseRc10, "root"), join(caseRc10, "runtime"), profRc10, join(caseRc10, "home"), witnessMs);
      // B-4 residual (2): a dead witness is `witness-failed`, never a slow witness.
      const crashed = !w.timeout && w.exitCode !== null && w.exitCode !== 0;
      w.status = (w.timeout || crashed || w.spawnFailed) ? "witness-failed" : "ok";
      results.cases.rc10 = w;
      const prof = newestProfile(profRc10);
      if (prof) {
        try { cpSync(join(profRc10, prof), join(outDir, "witness.cpuprofile")); results.cases.rc10.profile = "witness.cpuprofile"; } catch { /* ignore */ }
      }
      console.log(JSON.stringify({ event: "case-rc10-done", status: w.status, listenMs: w.listenMs, timeout: w.timeout, exitCode: w.exitCode, exitSignal: w.exitSignal, rssPeakMB: w.rssPeakMB }));
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
    const m = await runCase("main", mainBin, join(caseMain, "root"), join(caseMain, "runtime"), profMain, join(caseMain, "home"), witnessMs);
    m.status = (m.timeout || (!m.timeout && m.exitCode !== null && m.exitCode !== 0) || m.spawnFailed) ? "candidate-failed" : "ok";
    results.cases.main = m;
    const prof = newestProfile(profMain);
    if (prof) {
      try { cpSync(join(profMain, prof), join(outDir, "candidate.cpuprofile")); results.cases.main.profile = "candidate.cpuprofile"; } catch { /* ignore */ }
    }
    console.log(JSON.stringify({
      event: "case-main-done", status: m.status, listenMs: m.listenMs, timeout: m.timeout, exitCode: m.exitCode, exitSignal: m.exitSignal, rssPeakMB: m.rssPeakMB,
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
