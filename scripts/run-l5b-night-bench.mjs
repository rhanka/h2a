#!/usr/bin/env node
// Single launch script for the L5B quiet-night measurement (§6 points 1 to 7).
// Checks preconditions at start AND at end (loadavg 1 min <= 3.5, disk >= 48 GiB,
// 32 CPUs, no concurrent bench/build/CI, clean build), generates the deterministic
// §6.2.a state under worktree .tmp, executes 3 runs with --witness-bin calibration,
// writes all artifacts under /home/antoinefa/src/h2a/tmp/h-cond/mcp-plan/bench-out-r3/,
// and exits non-zero with the explicit reason without measuring if a precondition fails.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateL5bBenchState } from "./generate-l5b-bench-state.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const DEFAULT_OUT_DIR = "/home/antoinefa/src/h2a/tmp/h-cond/mcp-plan/bench-out-r3";
const DEFAULT_WITNESS_BIN = join(REPO_ROOT, ".worktrees", "witness-b2a140195e", "packages", "h2a", "dist", "bin.js");
const BENCH_SCRIPT = join(HERE, "bench-central-real-copy.mjs");
const GENERATOR_SCRIPT = join(HERE, "generate-l5b-bench-state.mjs");

const CONCURRENT_CMD_RE = /(?:^|\/|\s)(?:bench-central-real-copy\.mjs|run-l5b-night-bench\.mjs|run-test-gates\.mjs|run-node-shard\.mjs|run-node-tests\.mjs|ci-m17-proof\.mjs|ci-bulk-proof\.mjs|package-release\.mjs|vitest(?:\.mjs)?|tsc(?:\.js)?)(?:\s|$)|mcp-central-serve.*(?:\.tmp|h2a-l5-bench)|npm\s+(?:run\s+build(?::h2a)?|test)(?:\s|$)/;

function usage() {
  console.log(
    "Usage: run-l5b-night-bench.mjs [--out <dir>] [--witness-bin <path>] [--runs <n>] " +
    "[--max-loadavg <n>] [--min-disk-gb <n>] [--min-cpus <n>] [--measure-ms <n>] " +
    "[--c51-trials <n>] [--sessions <n>] [--preflight-only]"
  );
}

const args = process.argv.slice(2);
function opt(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const outDir = resolve(opt("--out", DEFAULT_OUT_DIR));
const witnessBin = resolve(opt("--witness-bin", DEFAULT_WITNESS_BIN));
const runsCount = Number.parseInt(opt("--runs", "3"), 10);
const maxLoadavg = Number(opt("--max-loadavg", "3.5"));
const minDiskGiB = Number(opt("--min-disk-gb", "48"));
const minCpus = Number.parseInt(opt("--min-cpus", "32"), 10);
const measureMs = Number.parseInt(opt("--measure-ms", "30000"), 10);
const c51Trials = Number.parseInt(opt("--c51-trials", "3"), 10);
const sessions = Number.parseInt(opt("--sessions", "5"), 10);
const preflightOnly = args.includes("--preflight-only");

if (
  !Number.isSafeInteger(runsCount) || runsCount < 1 ||
  !Number.isFinite(maxLoadavg) || maxLoadavg <= 0 ||
  !Number.isFinite(minDiskGiB) || minDiskGiB <= 0 ||
  !Number.isSafeInteger(minCpus) || minCpus < 1 ||
  !Number.isSafeInteger(measureMs) || measureMs <= 0 ||
  !Number.isSafeInteger(c51Trials) || c51Trials < 1 ||
  !Number.isSafeInteger(sessions) || sessions < 1
) {
  console.error("night-bench: invalid numeric argument");
  process.exit(2);
}

for (const [label, p] of [["--out", outDir], ["--witness-bin", witnessBin]]) {
  if (p === "/tmp" || p.startsWith("/tmp/")) {
    console.error(`night-bench: refusing ${label} under /tmp: ${p}`);
    process.exit(2);
  }
}

export function collectAncestorPids(startPid = process.pid) {
  const ancestors = new Set([startPid]);
  let cur = startPid;
  for (let i = 0; i < 64; i++) {
    try {
      const raw = readFileSync(`/proc/${cur}/stat`, "utf8");
      const rparen = raw.lastIndexOf(")");
      if (rparen < 0) break;
      const fields = raw.slice(rparen + 2).split(" ");
      const ppid = Number(fields[1]);
      if (!Number.isSafeInteger(ppid) || ppid <= 1 || ancestors.has(ppid)) break;
      ancestors.add(ppid);
      cur = ppid;
    } catch {
      break;
    }
  }
  return ancestors;
}

export function findConcurrentProcesses(skipPids = collectAncestorPids()) {
  const matches = [];
  let entries = [];
  try {
    entries = readdirSync("/proc");
  } catch {
    return matches;
  }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (skipPids.has(pid)) continue;
    try {
      const cmdRaw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (!cmdRaw) continue;
      const cmdline = cmdRaw.replaceAll("\0", " ").trim();
      if (!cmdline) continue;
      if (CONCURRENT_CMD_RE.test(cmdline)) {
        matches.push({ pid, cmdline: cmdline.slice(0, 240) });
      }
    } catch { /* process exited or unreadable */ }
  }
  return matches;
}

function nearestExistingDir(targetPath) {
  let cursor = resolve(targetPath);
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return cursor;
}

function readDiskFreeGiB(path) {
  try {
    const st = statfsSync(nearestExistingDir(path));
    return (Number(st.bavail) * Number(st.bsize)) / (1024 ** 3);
  } catch {
    return NaN;
  }
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function checkConditions({
  loadavgLimit = maxLoadavg,
  diskLimitGiB = minDiskGiB,
  cpuFloor = minCpus,
  checkFiles = true,
} = {}) {
  const reasons = [];
  const loadavg = os.loadavg().map((n) => Math.round(n * 100) / 100);
  const cpus = os.cpus().length;
  const repoDiskGiB = readDiskFreeGiB(REPO_ROOT);
  const outDiskGiB = readDiskFreeGiB(outDir);
  const concurrent = findConcurrentProcesses();

  if (loadavg[0] > loadavgLimit) {
    reasons.push(`loadavg_1m=${loadavg[0]} > ${loadavgLimit}`);
  }
  if (!Number.isFinite(repoDiskGiB) || repoDiskGiB < diskLimitGiB) {
    reasons.push(`disk_worktree_GiB=${Number.isFinite(repoDiskGiB) ? repoDiskGiB.toFixed(2) : "NaN"} < ${diskLimitGiB}`);
  }
  if (!Number.isFinite(outDiskGiB) || outDiskGiB < diskLimitGiB) {
    reasons.push(`disk_out_GiB=${Number.isFinite(outDiskGiB) ? outDiskGiB.toFixed(2) : "NaN"} < ${diskLimitGiB}`);
  }
  if (cpus < cpuFloor) {
    reasons.push(`cpus=${cpus} < ${cpuFloor}`);
  }
  if (concurrent.length > 0) {
    reasons.push(`concurrent_bench_or_ci=[${concurrent.map((c) => `${c.pid}:${c.cmdline}`).join("; ")}]`);
  }

  let gitDirty = null;
  if (checkFiles) {
    const candidateBin = join(REPO_ROOT, "packages", "h2a", "dist", "bin.js");
    if (!existsSync(candidateBin)) {
      reasons.push(`candidate_bin_missing=${candidateBin}`);
    }
    if (!existsSync(witnessBin) || !statSync(witnessBin).isFile()) {
      reasons.push(`witness_bin_missing=${witnessBin}`);
    }
    if (!existsSync(BENCH_SCRIPT)) reasons.push(`bench_script_missing=${BENCH_SCRIPT}`);
    if (!existsSync(GENERATOR_SCRIPT)) reasons.push(`generator_script_missing=${GENERATOR_SCRIPT}`);

    try {
      const porcelain = execFileSync("git", ["-C", REPO_ROOT, "status", "--porcelain"], { encoding: "utf8" })
        .split("\n")
        .map((l) => l.trimEnd())
        .filter(Boolean);
      const nonHarness = porcelain.filter((line) => {
        if (!line.startsWith("?? ")) return true;
        const p = line.slice(3).trim();
        return p !== ".h2a-lane.json" && p !== ".tmp" && p !== ".tmp/";
      });
      gitDirty = nonHarness.length > 0;
      if (gitDirty) {
        reasons.push(`git_dirty=[${nonHarness.join(", ")}]`);
      }
    } catch (error) {
      reasons.push(`git_status_failed=${String(error?.message ?? error)}`);
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    loadavg,
    cpus,
    repoDiskGiB: Number.isFinite(repoDiskGiB) ? Math.round(repoDiskGiB * 100) / 100 : null,
    outDiskGiB: Number.isFinite(outDiskGiB) ? Math.round(outDiskGiB * 100) / 100 : null,
    concurrent,
    gitDirty,
  };
}

function evaluateNightVerdict(runResults) {
  const c51AllTrials = [];
  const runSummaries = runResults.map((r, idx) => {
    const m = r.cases?.main ?? {};
    const w = r.cases?.witness ?? r.cases?.rc10 ?? {};
    const c51 = r.c51Trials ?? {};
    const trialValues = (c51.trials ?? []).map((t) => ({ trial: t.trial, c51Ms: t.c51Ms, ok: t.ok }));
    for (const tv of trialValues) c51AllTrials.push({ run: idx + 1, ...tv });
    return {
      run: idx + 1,
      valid: Boolean(r.valid),
      invalidReasons: r.invalidReasons ?? [],
      witnessStatus: w.status ?? null,
      witnessCalibrated: Boolean(r.witnessCalibration?.calibrated),
      witnessSteadyCpuPct: w.steadyCpuPct ?? null,
      witnessMigrationDoneMs: w.migrationDoneMs ?? null,
      witnessPeakMigrationP99Ms: w.peakMigrationP99Ms ?? null,
      witnessC51FirstMs: r.witnessC51Trials?.firstMs ?? w.c51Ms ?? null,
      candidateStatus: m.status ?? null,
      shimsAliveBefore: m.shimsAliveBefore ?? null,
      shimsAliveAfter: m.shimsAliveAfter ?? null,
      steadyAttachmentsBefore: m.steadyAttachmentsBefore ?? null,
      steadyAttachmentsAfter: m.steadyAttachmentsAfter ?? null,
      item1SteadyCpuPct: m.steadyCpuPct ?? null,
      item2C51FirstMs: c51.firstMs ?? null,
      item2C51MaxMs: c51.maxMs ?? null,
      item2C51AllOk: Boolean(c51.allOk),
      item3PeakMigrationP99Ms: m.peakMigrationP99Ms ?? null,
      item4MigrationDoneMs: m.migrationDoneMs ?? null,
      item5C55CpuMs: m.c55?.cpuMs ?? null,
      item5C55DriveConsentObserved: Boolean(m.c55?.driveConsentObserved),
      rssPeakMB: m.rssPeakMB ?? null,
      stopDrainErrorCount: m.stopDrainErrorCount ?? null,
      lagSeriesSamples: Array.isArray(m.migrationLagSeries) ? m.migrationLagSeries.length : 0,
    };
  });

  const allValid = runSummaries.length === runsCount && runSummaries.every((s) => s.valid);
  const item1Pass = runSummaries.every((s) => typeof s.item1SteadyCpuPct === "number" && s.item1SteadyCpuPct <= 2.0);
  const item2Pass = runSummaries.every(
    (s) => s.item2C51AllOk && typeof s.item2C51FirstMs === "number" && typeof s.item2C51MaxMs === "number" && s.item2C51MaxMs <= 500
  );
  const worstPeakP99Ms = runSummaries.reduce(
    (max, s) => (typeof s.item3PeakMigrationP99Ms === "number" ? Math.max(max, s.item3PeakMigrationP99Ms) : Infinity),
    0
  );
  const item3Pass = Number.isFinite(worstPeakP99Ms) && worstPeakP99Ms <= 75;
  const worstMigrationMs = runSummaries.reduce(
    (max, s) => (typeof s.item4MigrationDoneMs === "number" ? Math.max(max, s.item4MigrationDoneMs) : Infinity),
    0
  );
  const item4Pass = Number.isFinite(worstMigrationMs) && worstMigrationMs <= 10_000;
  const item5Pass = runSummaries.every(
    (s) => s.item5C55DriveConsentObserved && typeof s.item5C55CpuMs === "number" && s.item5C55CpuMs < 150
  );

  return {
    runs: runSummaries,
    thresholds: {
      item1SteadyCpuPctMax: { limit: 2.0, rule: "each run <= 2%", pass: item1Pass },
      item2C51MaxMs: { limit: 500, rule: "each trial including firstMs <= 500ms and allOk", pass: item2Pass },
      item3PeakMigrationP99Ms: { limit: 75, rule: "worst run <= 75ms", worstMs: Number.isFinite(worstPeakP99Ms) ? worstPeakP99Ms : null, pass: item3Pass },
      item4MigrationDoneMs: { limit: 10_000, rule: "worst run <= 10000ms", worstMs: Number.isFinite(worstMigrationMs) ? worstMigrationMs : null, pass: item4Pass },
      item5C55CpuMs: { limit: 150, rule: "each run < 150ms", pass: item5Pass },
    },
    allRunsValid: allValid,
    overallPass: allValid && item1Pass && item2Pass && item3Pass && item4Pass && item5Pass,
  };
}

function main() {
  const startedAt = new Date().toISOString();
  const startCheck = checkConditions();
  if (!startCheck.ok) {
    console.error(`night-bench: REFUSED at start (no measurement performed): ${startCheck.reasons.join(" | ")}`);
    process.exit(2);
  }
  if (preflightOnly) {
    console.log(JSON.stringify({ event: "night-bench-preflight-ok", startCheck }, null, 2));
    process.exit(0);
  }

  const workTmpBase = join(REPO_ROOT, ".tmp");
  const sessionTmpDir = join(workTmpBase, `l5b-night-${Date.now()}`);
  const hadWorkTmpBefore = existsSync(workTmpBase);
  mkdirSync(sessionTmpDir, { recursive: true, mode: 0o700 });
  mkdirSync(outDir, { recursive: true, mode: 0o700 });

  const stateDir = join(sessionTmpDir, "synth-state");
  const rootDir = join(sessionTmpDir, "synth-root");
  const runScratch = join(sessionTmpDir, "bench-scratch");
  mkdirSync(runScratch, { recursive: true, mode: 0o700 });

  let generatorSha = null;
  let benchSha = null;
  let gitHead = null;
  let runResults = [];
  let abortedReason = null;

  try {
    generatorSha = execFileSync("git", ["-C", REPO_ROOT, "hash-object", "scripts/generate-l5b-bench-state.mjs"], { encoding: "utf8" }).trim();
    benchSha = execFileSync("git", ["-C", REPO_ROOT, "hash-object", "scripts/bench-central-real-copy.mjs"], { encoding: "utf8" }).trim();
    gitHead = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

    const fingerprint = generateL5bBenchState({ stateDir, rootDir, force: true });
    if (!fingerprint.shapeMatchesL5b) {
      throw new Error(`generated state shape mismatch: ${fingerprint.shapeMismatches.join("; ")}`);
    }

    const commandLines = [];
    for (let i = 1; i <= runsCount; i++) {
      if (i > 1) {
        const midCheck = checkConditions();
        if (!midCheck.ok) {
          abortedReason = `aborted before run ${i}: ${midCheck.reasons.join(" | ")}`;
          console.error(`night-bench: ${abortedReason}`);
          break;
        }
      }
      const runOutDir = join(outDir, `run-${i}`);
      mkdirSync(runOutDir, { recursive: true, mode: 0o700 });
      const benchArgs = [
        BENCH_SCRIPT,
        "--source-state", stateDir,
        "--source-root", rootDir,
        "--out", runOutDir,
        "--run-base", runScratch,
        "--witness-bin", witnessBin,
        "--witness-timeout-ms", String(measureMs),
        "--supervised",
        "--sessions", String(sessions),
        "--no-cpu-prof",
        "--measure-ms", String(measureMs),
        "--c51-trials", String(c51Trials),
        "--c55",
        "--require-l5b-shape",
        "--max-loadavg", String(maxLoadavg),
        "--strict-conditions",
      ];
      commandLines.push([process.execPath, ...benchArgs].join(" "));
      const env = {
        ...process.env,
        TMPDIR: runScratch,
        TMP: runScratch,
        TEMP: runScratch,
      };
      delete env.H2A_MCP_AUTHORITY;
      delete env.H2A_MCP_CENTRAL_ENDPOINT;

      console.log(JSON.stringify({ event: "night-bench-run-start", run: i, runsCount, outDir: runOutDir }));
      const proc = spawnSync(process.execPath, benchArgs, {
        cwd: REPO_ROOT,
        env,
        stdio: "inherit",
      });
      const resultsFile = join(runOutDir, "results.json");
      if (existsSync(resultsFile)) {
        runResults.push(JSON.parse(readFileSync(resultsFile, "utf8")));
      } else {
        abortedReason = `run ${i} produced no results.json (exit=${proc.status}, sig=${proc.signal})`;
        console.error(`night-bench: ${abortedReason}`);
        break;
      }
      if (proc.status !== 0) {
        abortedReason = `run ${i} exited with code ${proc.status ?? proc.signal}`;
        console.error(`night-bench: ${abortedReason}`);
        break;
      }
    }

    const endCheck = checkConditions();
    const verdict = evaluateNightVerdict(runResults);
    const allConditionsMet = startCheck.ok && endCheck.ok && !abortedReason && runResults.length === runsCount && verdict.allRunsValid;

    const summary = {
      tool: "run-l5b-night-bench.mjs",
      startedAt,
      finishedAt: new Date().toISOString(),
      candidateHead: gitHead,
      witnessBin,
      generator: {
        path: "scripts/generate-l5b-bench-state.mjs",
        gitBlobSha: generatorSha,
        fileSha256: sha256File(GENERATOR_SCRIPT),
      },
      bench: {
        path: "scripts/bench-central-real-copy.mjs",
        gitBlobSha: benchSha,
        fileSha256: sha256File(BENCH_SCRIPT),
      },
      sourceFingerprint: fingerprint,
      command: [process.execPath, ...process.argv.slice(1)].join(" "),
      runCommands: commandLines,
      conditions: {
        maxLoadavg,
        minDiskGiB,
        minCpus,
        start: startCheck,
        end: endCheck,
        abortedReason,
        allConditionsMet,
      },
      verdict,
    };
    writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ event: "night-bench-summary", outDir, summary: join(outDir, "summary.json"), allConditionsMet, overallPass: verdict.overallPass }));

    if (!allConditionsMet) {
      const reasons = [
        ...(abortedReason ? [abortedReason] : []),
        ...(!endCheck.ok ? endCheck.reasons.map((r) => `end: ${r}`) : []),
        ...(!verdict.allRunsValid ? ["one or more runs marked valid=false"] : []),
      ];
      console.error(`night-bench: INVALID measurement conditions: ${reasons.join(" | ")}`);
      process.exitCode = 1;
    } else if (!verdict.overallPass) {
      console.error("night-bench: measurement valid, but one or more L5B thresholds failed");
      process.exitCode = 1;
    }
  } finally {
    try { rmSync(sessionTmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    if (!hadWorkTmpBefore) {
      try {
        if (existsSync(workTmpBase) && readdirSync(workTmpBase).length === 0) {
          rmSync(workTmpBase, { recursive: true, force: true });
        }
      } catch { /* ignore */ }
    }
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
