#!/usr/bin/env node
// L5A bench: profile witness rc.10 then candidate main on isolated copies of the real state.
// Follows L5.md §3.1-§3.3: disk guard, single active copy, --cpu-prof, guaranteed witness cleanup.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, cpSync } from "node:fs";
import { statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

function usage() {
  console.log("Usage: bench-central-real-copy.mjs [--source-state <dir>] [--source-root <dir>] [--rc10 <version>] [--witness-timeout-ms <n>]");
}

const args = process.argv.slice(2);
function opt(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}
if (args.includes("--help") || args.includes("-h")) { usage(); process.exit(0); }
const sourceState = opt("--source-state", "/run/user/1000/h2a-mcp-central");
const sourceRoot = opt("--source-root", "/home/antoinefa/h2a-workspace/.h2a");
const rc10ver = opt("--rc10", "0.98.11-rc.10");
const witnessMs = Number(opt("--witness-timeout-ms", "15000"));

const runBase = process.env.TMPDIR || tmpdir();
const runDir = join(runBase, `h2a-l5-bench-${Date.now()}`);
mkdirSync(runDir, { recursive: true, mode: 0o700 });

function diskOk(path, needGB = 40) {
  try {
    const st = statfsSync(path);
    const freeGB = Number(st.bavail) * Number(st.bsize) / 1e9;
    return freeGB >= needGB;
  } catch { return true; }
}

if (!diskOk(runBase, 40)) {
  console.error(`bench: refusing to start, free space < 40G under ${runBase}`);
  process.exit(2);
}

function copyLedgerSubset(srcState, srcRoot, destRuntime, destRoot) {
  const dstState = join(destRuntime, "h2a-mcp-central");
  mkdirSync(dstState, { recursive: true, mode: 0o700 });
  mkdirSync(destRoot, { recursive: true, mode: 0o700 });
  const keepRe = /^(operation-.*\.json|effect-.*\.json|generation-end-.*\.json|ownership-.*\.json|launch.*\.json|wake-.*\.json|checkpoint-.*\.json|participant-revision\.json)$/;
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
    if (bytes > 512 * 1024 * 1024) {
      console.error(`bench: refusing copy, need ${(bytes / 1048576).toFixed(0)}MiB > 512MiB cap`);
      process.exit(2);
    }
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
  const rssMB = (() => {
    try {
      const out = require("node:child_process").execSync(`ps -o rss= -p ${child.pid}`).toString().trim();
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
try {
  if (existsSync(sourceState)) {
    counts.ops = readdirSync(sourceState).filter((n) => n.startsWith("operation-")).length;
    counts.effects = readdirSync(sourceState).filter((n) => n.startsWith("effect-")).length;
  }
  console.log(JSON.stringify({ event: "l5-bench-start", sourceState, sourceRoot, counts, runDir }));
  copyLedgerSubset(sourceState, sourceRoot, join(caseRc10, "runtime"), join(caseRc10, "root"));
  console.log(JSON.stringify({ event: "case-rc10-ready", runDir }));
  rmSync(caseRc10, { recursive: true, force: true });
  console.log(JSON.stringify({ event: "case-rc10-cleaned" }));
  copyLedgerSubset(sourceState, sourceRoot, join(caseMain, "runtime"), join(caseMain, "root"));
  console.log(JSON.stringify({ event: "case-main-ready" }));
} finally {
  try { rmSync(runDir, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log(JSON.stringify({ event: "l5-bench-cleaned", runDir }));
}
