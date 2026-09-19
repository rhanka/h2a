#!/usr/bin/env node
/**
 * L0 external import-envelope probe (dual mode).
 *
 * PRELOAD mode (when passed to `node --import`): before the CLI's own static
 * imports execute, it stamps ONE `preimport` marker on stderr with the CHILD's
 * `performance.now()` (the SAME monotonic origin the in-process phase trace
 * uses). It replaces no FS or module function — it only observes.
 *
 * DRIVER mode (when run as the main script): spawns `node --import <self>
 * dist/bin.js mcp-serve ...`, records the client-side lifecycle ordering
 * (spawn_requested, child_spawned, initialize_sent/received,
 * first_tool_received, close), and computes the IMPORT ENVELOPE
 * `preimport → process_start` — a duration entirely inside the child process,
 * never a subtraction of two different processes' clocks. It does NOT assert a
 * cause for the 30 s connect delay (T8 stays UNRESOLVED); it only measures.
 *
 * Usage (driver): node scripts/mcp-phase-probe.mjs [--seed <dir>] --out <file.json>
 */

import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const PROBE_PREFIX = "h2a.mcp.probe ";
const TRACE_PREFIX = "h2a.mcp.phase ";

// `--import <self> bin.js` → argv[1] is bin.js, so this module is a PRELOAD.
// `node <self>` → argv[1] is this module, so it is the DRIVER main.
let isMain = false;
try {
  isMain = fileURLToPath(import.meta.url) === process.argv[1];
} catch {
  isMain = false;
}

if (!isMain) {
  // PRELOAD: earliest possible child-side marker. Same clock as the trace.
  try {
    process.stderr.write(
      `${PROBE_PREFIX}${JSON.stringify({
        marker: "preimport",
        pid: process.pid,
        perfNowMs: Math.round(performance.now() * 1000) / 1000,
        timeOrigin: Math.round(performance.timeOrigin)
      })}\n`
    );
  } catch {
    /* a broken stderr must never break the launch */
  }
} else {
  await runDriver();
}

async function runDriver() {
  const { spawn } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const { readFileSync, writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir, cpus, type: osType, release: osRelease, arch } = await import("node:os");
  const os = await import("node:os");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const HERE = dirname(fileURLToPath(import.meta.url));
  const BIN = join(HERE, "..", "packages", "h2a", "dist", "bin.js");
  const SELF = fileURLToPath(import.meta.url);

  const argOf = (name, fb) => {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
      ? process.argv[i + 1]
      : fb;
  };
  const out = argOf("out", "/tmp/mcp-phase-probe.json");
  const seed = argOf("seed", process.env.H2A_MCP_TEST_SEED);

  let root;
  if (seed) {
    const { copySeed } = await import("../packages/h2a/test/helpers/mcp-fix-lab.js");
    root = copySeed(seed);
  } else {
    root = mkdtempSync(join(tmpdir(), "h2a-probe-root-"));
  }

  const binSha = createHash("sha256").update(readFileSync(BIN)).digest("hex");

  // Secret-free env: throwaway HOME, explicit root, no inherited tokens.
  const home = mkdtempSync(join(tmpdir(), "h2a-probe-home-"));
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    NO_COLOR: "1",
    H2A_MCP_TRACE: "1"
  };
  const args = ["--import", SELF, BIN, "mcp-serve", "--root", root, "--auto-open", "--host", "agent"];

  const clientClock = () => Math.round(performance.now() * 1000) / 1000;
  const timeline = [];
  const mark = (name) => timeline.push({ event: name, clientMs: clientClock() });

  mark("spawn_requested");
  const child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"], env });
  mark("child_spawned");

  let stderr = "";
  const stdoutFrames = [];
  let acc = Buffer.alloc(0);
  const pending = new Map();

  child.stdout.on("data", (chunk) => {
    acc = Buffer.concat([acc, chunk]);
    let nl;
    while ((nl = acc.indexOf(0x0a)) !== -1) {
      const line = acc.subarray(0, nl).toString("utf8");
      acc = acc.subarray(nl + 1);
      try {
        const msg = JSON.parse(line);
        if (msg && Object.prototype.hasOwnProperty.call(msg, "id") && pending.has(msg.id)) {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          p({ msg, bytes: Buffer.byteLength(line, "utf8") });
        } else {
          stdoutFrames.push({ bytes: Buffer.byteLength(line, "utf8") });
        }
      } catch {
        stdoutFrames.push({ nonJson: true });
      }
    }
  });
  child.stderr.on("data", (c) => {
    stderr += c.toString("utf8");
  });

  const rpc = (request, label) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timeout`)), 120000);
      pending.set(request.id, (v) => {
        clearTimeout(timer);
        mark(label);
        resolve(v);
      });
      child.stdin.write(`${JSON.stringify(request)}\n`);
    });

  const closed = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));

  let initialize;
  let firstTool;
  try {
    mark("initialize_sent");
    initialize = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, "initialize_received");
    mark("first_tool_sent");
    firstTool = await rpc(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "h2a_discover_instances", arguments: {} } },
      "first_tool_received"
    );
  } finally {
    try {
      child.stdin.end();
    } catch {
      /* ignore */
    }
    child.kill("SIGTERM");
  }
  const exit = await Promise.race([
    closed,
    new Promise((r) => setTimeout(() => r({ code: null, signal: "TIMEOUT" }), 5000))
  ]);
  mark("closed");

  // --- Child-side import envelope (SAME process; legitimate subtraction) -----
  const probeMarker = parsePrefixed(stderr, PROBE_PREFIX).find((m) => m.marker === "preimport");
  const traceEvents = parsePrefixed(stderr, TRACE_PREFIX);
  const processStart = traceEvents.find((e) => e.phase === "process_start");
  const transportEnter = traceEvents.find((e) => e.phase === "transport_enter");
  const importEnvelope =
    probeMarker && processStart
      ? {
          preimportPerfMs: probeMarker.perfNowMs,
          processStartMonotonicMs: processStart.monotonicMs,
          // Both are child-side performance.now() → this duration is valid.
          preimportToProcessStartMs:
            Math.round((processStart.monotonicMs - probeMarker.perfNowMs) * 1000) / 1000,
          processStartToTransportMs:
            transportEnter && processStart
              ? Math.round((transportEnter.monotonicMs - processStart.monotonicMs) * 1000) / 1000
              : null,
          note:
            "preimport→process_start is the STATIC-IMPORT envelope measured inside the child; process_start→transport_enter is the in-body boot (root+identity resolution)."
        }
      : { available: false, note: "preimport marker or process_start trace missing" };

  const report = {
    lot: "L0",
    kind: "import-envelope-probe",
    generatedAt: new Date().toISOString(),
    inventory: {
      node: process.version,
      os: `${osType()} ${osRelease()} ${arch()}`,
      cpu: cpus()[0]?.model,
      cpus: cpus().length,
      loadavg: os.loadavg?.() ?? null,
      bin: BIN,
      binSha256: binSha,
      argv: args,
      storage: root,
      lockMode: process.env.H2A_LOCK_MODE ?? "pid(default)",
      claudeCount: null,
      codexCount: null,
      otherCount: null,
      auxProcesses: null,
      note: "process counts are host-inventory placeholders filled by h-runtime; no env token collected"
    },
    childPid: child.pid,
    exit,
    clientTimeline: timeline,
    importEnvelope,
    tracePhaseCount: traceEvents.length,
    tracePhases: [...new Set(traceEvents.map((e) => e.phase))],
    frames: {
      initializeBytes: initialize?.bytes ?? null,
      firstToolBytes: firstTool?.bytes ?? null,
      firstToolName: "h2a_discover_instances"
    },
    t8: "UNRESOLVED — this probe measures the import envelope and boot ordering; it does NOT establish a cause for the 30s connect delay. No arbitrary 30s sleep is presented as the cause."
  };
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(`wrote ${out}`);
  console.log(
    `import envelope: preimport→process_start = ${importEnvelope.preimportToProcessStartMs ?? "n/a"} ms; ` +
      `process_start→transport = ${importEnvelope.processStartToTransportMs ?? "n/a"} ms`
  );
  console.log(`trace phases seen: ${report.tracePhases.length}; child exit: ${JSON.stringify(exit)}`);
}

function parsePrefixed(text, prefix) {
  const out = [];
  for (const line of text.split("\n")) {
    const at = line.indexOf(prefix);
    if (at === -1) continue;
    try {
      out.push(JSON.parse(line.slice(at + prefix.length)));
    } catch {
      /* skip */
    }
  }
  return out;
}
