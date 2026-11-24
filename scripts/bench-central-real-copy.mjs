#!/usr/bin/env node
// L5A bench: profile witness rc.10 then candidate main on isolated copies of the real state.
// Follows L5.md §3.1-§3.3: disk guard, single active copy, --cpu-prof, guaranteed witness cleanup.
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, cpSync } from "node:fs";
import { statfsSync } from "node:fs";
import { dirname, join } from "node:path";

function usage() {
  console.log("Usage: bench-central-real-copy.mjs --source-state <dir> --source-root <dir> [--run-base <dir>] [--rc10 <version>] [--witness-timeout-ms <n>]");
  console.log("  --run-base defaults to $TMPDIR (must be set, never /tmp); --source-state/--source-root are required (no hardcoded owner paths).");
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
// B-4/NB-6: no hardcoded owner paths; both sources are required options.
const sourceState = requiredOpt("--source-state");
const sourceRoot = requiredOpt("--source-root");
const rc10ver = opt("--rc10", "0.98.11-rc.10");
const witnessMs = Number(opt("--witness-timeout-ms", "15000"));

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

async function runCase(name, entryBin, root, runtimeBase, profDir, home) {
  mkdirSync(profDir, { recursive: true, mode: 0o700 });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const env = {
    ...process.env, HOME: home, XDG_RUNTIME_DIR: runtimeBase, H2A_ROOT: root,
    H2A_MCP_AUTHORITY: "", H2A_MCP_CENTRAL_ENDPOINT: "",
  };
  delete env.H2A_MCP_AUTHORITY;
  delete env.H2A_MCP_CENTRAL_ENDPOINT;
  const child = spawn(process.execPath, ["--max-old-space-size=384", "--cpu-prof", `--cpu-prof-dir=${profDir}`, entryBin, "mcp-central-serve", "--root", root, "--runtime-base", runtimeBase], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c) => { stdout += String(c); });
  child.stderr.on("data", (c) => { stderr += String(c); });
  const start = Date.now();
  const listen = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ms: Date.now() - start, timeout: true }), 30_000);
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
  await new Promise((r) => setTimeout(r, witnessMs));
  // B-4: ESM import (require() throws in this module); RSS in MiB.
  const rssMB = (() => {
    try {
      const out = execSync(`ps -o rss= -p ${child.pid}`).toString().trim();
      return Number(out) / 1024;
    } catch { return NaN; }
  })();
  child.kill("SIGINT");
  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 2000);
    child.once("exit", () => { clearTimeout(timer); resolve(true); });
  });
  if (!exited) {
    try { process.kill(child.pid, "SIGKILL"); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { listenMs: listen.ms, rssMB, stdout: stdout.slice(0, 2000), stderr: stderr.slice(0, 2000) };
}

const caseRc10 = join(runDir, "case-rc10");
const caseMain = join(runDir, "case-main");
let counts = { ops: 0, effects: 0 };
// B-4: branch runCase — witness rc.10 (tarball) then candidate (local dist).
// Resolves the witness entry without network when the tarball is pre-fetched
// via --rc10-tarball <file>; otherwise npm packs the pinned rc.10 version.
function resolveWitnessEntry() {
  const explicit = opt("--rc10-tarball", "");
  const packDir = join(runDir, "witness-pack");
  mkdirSync(packDir, { recursive: true, mode: 0o700 });
  try {
    const tarball = explicit || execSync(`npm pack @sentropic/h2a@${rc10ver} --pack-destination ${packDir} --silent`, { encoding: "utf8" }).trim().split("\n").pop();
    const tgz = explicit || join(packDir, tarball);
    const dest = join(runDir, "witness-pkg");
    mkdirSync(dest, { recursive: true, mode: 0o700 });
    execSync(`tar -xzf ${tgz} -C ${dest} --strip-components=1 package/dist/bin.js package/package.json`);
    return join(dest, "dist", "bin.js");
  } catch (error) {
    console.error(JSON.stringify({ event: "witness-unavailable", rc10ver, error: String(error?.message ?? error).slice(0, 300) }));
    return null;
  }
}
function candidateEntry() {
  // Candidate is the locally built package (this checkout).
  const here = new URL(import.meta.url);
  const repoBin = join(dirname(dirname(here.pathname)), "packages", "h2a", "dist", "bin.js");
  if (existsSync(repoBin)) return repoBin;
  return null;
}
try {
  if (existsSync(sourceState)) {
    counts.ops = readdirSync(sourceState).filter((n) => n.startsWith("operation-")).length;
    counts.effects = readdirSync(sourceState).filter((n) => n.startsWith("effect-")).length;
  }
  console.log(JSON.stringify({ event: "l5-bench-start", sourceState, sourceRoot, counts, runDir }));
  const witnessBin = resolveWitnessEntry();
  const mainBin = candidateEntry();
  if (!mainBin) {
    console.error(JSON.stringify({ event: "candidate-unavailable", hint: "run npm run build:h2a first" }));
    process.exit(2);
  }
  if (witnessBin) {
    copyLedgerSubset(sourceState, sourceRoot, join(caseRc10, "runtime"), join(caseRc10, "root"));
    console.log(JSON.stringify({ event: "case-rc10-ready", runDir }));
    const profRc10 = join(runDir, "prof-rc10");
    const w = await runCase("rc10", witnessBin, join(caseRc10, "root"), join(caseRc10, "runtime"), profRc10, join(caseRc10, "home"));
    console.log(JSON.stringify({ event: "case-rc10-done", listenMs: w.listenMs, rssMB: w.rssMB, profDir: profRc10 }));
    rmSync(caseRc10, { recursive: true, force: true });
    console.log(JSON.stringify({ event: "case-rc10-cleaned" }));
  }
  copyLedgerSubset(sourceState, sourceRoot, join(caseMain, "runtime"), join(caseMain, "root"));
  console.log(JSON.stringify({ event: "case-main-ready" }));
  const profMain = join(runDir, "prof-main");
  const m = await runCase("main", mainBin, join(caseMain, "root"), join(caseMain, "runtime"), profMain, join(caseMain, "home"));
  console.log(JSON.stringify({
    event: "case-main-done", listenMs: m.listenMs, rssMB: m.rssMB, profDir: profMain,
    note: "attach the newest .cpuprofile under each profDir plus rssMB to L5-report.md §2",
  }));
} finally {
  try { rmSync(runDir, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log(JSON.stringify({ event: "l5-bench-cleaned", runDir }));
}
