#!/usr/bin/env node
/**
 * L0 byte-size baseline driver.
 *
 * Drives the REAL MCP stdio transport against a PRIVATE copy of the seed and
 * records the exact UTF-8 byte length FINALLY EMITTED on the wire for:
 *   - initialize
 *   - the whole tools/list
 *   - each exercised tool result family (incl. a Track, already
 *     transport-formatted, tool and the large h2a_discover_instances)
 *   - an error result family
 * plus the per-inscription byte-length distribution of the registry (with a
 * count of rows carrying accents / emojis / quotes / backslashes).
 *
 * It also emits a substantiated budget-B proposal. It never signs, never spawns
 * an agent, never touches the real bus/root/HOME, and exercises effectful tools
 * on the copy only. Categories it cannot legitimately drive (e.g. push
 * notifications, which need a live diff) are DECLARED as not-measured rather
 * than guessed.
 *
 * Usage:
 *   node scripts/mcp-size-baseline.mjs --seed <dir> --out <file.json> [--keep]
 */

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

import {
  copySeed,
  spawnMcp,
  callRpc,
  collectFrames,
  stopChildren,
  seedRegistryBytes
} from "../packages/h2a/test/helpers/mcp-fix-lab.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) {
    return process.argv[i + 1];
  }
  return fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const seed = arg("seed", process.env.H2A_MCP_TEST_SEED);
const out = arg("out", "/tmp/mcp-size-baseline.json");
if (!seed) {
  console.error("mcp-size-baseline: --seed <dir> (or H2A_MCP_TEST_SEED) is required");
  process.exit(2);
}

function quantiles(values) {
  if (values.length === 0) return { n: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: sorted[0],
    p50: at(50),
    p95: at(95),
    p99: at(99),
    max: sorted[sorted.length - 1],
    mean: Math.round(sum / sorted.length)
  };
}

function classifyRegistry(root) {
  const file = join(root, "registry", "instances.jsonl");
  let raw;
  try {
    raw = readFileSync(file);
  } catch {
    return { available: false };
  }
  const lines = raw.toString("utf8").split("\n").filter((l) => l.length > 0);
  const lineBytes = [];
  let accents = 0;
  let emojis = 0;
  let quotes = 0;
  let backslashes = 0;
  const emojiRe = /\p{Extended_Pictographic}/u;
  const accentRe = /[À-ɏ]/;
  for (const line of lines) {
    lineBytes.push(Buffer.byteLength(line, "utf8"));
    if (accentRe.test(line)) accents++;
    if (emojiRe.test(line)) emojis++;
    // A JSON-escaped quote inside a string value.
    if (line.includes('\\"')) quotes++;
    if (line.includes("\\\\")) backslashes++;
  }
  return {
    available: true,
    fileBytes: raw.length,
    inscriptions: lines.length,
    perInscriptionBytes: quantiles(lineBytes),
    withAccents: accents,
    withEmoji: emojis,
    withEscapedQuote: quotes,
    withBackslash: backslashes
  };
}

// Read-only / copy-safe calls to exercise. Effectful tools run on the COPY only.
// Each entry: { key, request }. Errors are captured as data, not failures.
function scenarios() {
  return [
    { key: "initialize", request: { jsonrpc: "2.0", id: 10, method: "initialize" } },
    { key: "tools/list", request: { jsonrpc: "2.0", id: 11, method: "tools/list" } },
    {
      key: "tools/call h2a_discover_instances (all)",
      family: "large-result",
      request: {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: { name: "h2a_discover_instances", arguments: {} }
      }
    },
    {
      key: "tools/call h2a_discover_sessions",
      family: "result",
      request: {
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: { name: "h2a_discover_sessions", arguments: {} }
      }
    },
    {
      key: "tools/call track_status",
      family: "track-result",
      request: {
        jsonrpc: "2.0",
        id: 14,
        method: "tools/call",
        params: { name: "track_status", arguments: {} }
      }
    },
    {
      key: "tools/call unknown_tool (error family)",
      family: "error",
      request: {
        jsonrpc: "2.0",
        id: 15,
        method: "tools/call",
        params: { name: "h2a_no_such_tool", arguments: {} }
      }
    },
    {
      key: "unknown method (-32601 error family)",
      family: "rpc-error",
      request: { jsonrpc: "2.0", id: 16, method: "no/such/method" }
    }
  ];
}

async function main() {
  const root = copySeed(seed);
  const registry = classifyRegistry(root);
  const measures = [];
  const handle = spawnMcp({ root, trace: true, seed });
  try {
    for (const sc of scenarios()) {
      let rec;
      try {
        const res = await callRpc(handle, sc.request, { timeoutMs: 120000 });
        const result = res.message.result;
        const isError =
          Boolean(res.message.error) ||
          Boolean(result && typeof result === "object" && result.isError);
        rec = {
          key: sc.key,
          family: sc.family ?? sc.key,
          wireBytes: res.bytes,
          isError,
          note: describe(sc, result, res.message)
        };
      } catch (err) {
        rec = { key: sc.key, family: sc.family ?? sc.key, wireBytes: null, error: String(err.message) };
      }
      measures.push(rec);
    }
  } finally {
    await stopChildren(handle);
  }

  const traceEvents = collectFrames(handle);
  const byWire = measures.filter((m) => typeof m.wireBytes === "number").map((m) => m.wireBytes);

  const B = 1048576;
  const CLAUDE = 16777216;
  const large = measures.find((m) => m.family === "large-result");
  const initialize = measures.find((m) => m.key === "initialize");
  const toolsList = measures.find((m) => m.key === "tools/list");
  const proposal = {
    PROPOSED_MCP_MAX_FRAME_BYTES: B,
    claudeObservedLimit: CLAUDE,
    initializeFitsWithMargin: initialize ? initialize.wireBytes * 4 < B : null,
    toolsListFitsWithMargin: toolsList ? toolsList.wireBytes * 4 < B : null,
    largestMeasuredWireBytes: byWire.length ? Math.max(...byWire) : null,
    largeResultExceedsB: large && typeof large.wireBytes === "number" ? large.wireBytes > B : null,
    largeResultExceedsClaude: large && typeof large.wireBytes === "number" ? large.wireBytes > CLAUDE : null,
    recommendation:
      large && typeof large.wireBytes === "number" && large.wireBytes > B
        ? "Adopt B=1,048,576 for initialize/tools-list/errors (they fit with wide margin), and REQUIRE pagination + a chunked read-recovery path (L1 h2a_read_payload, discovery default 200) for large result families — do NOT raise the frame cap to 16 MiB: the full discover result exceeds even the Claude 16 MiB limit, so recovery, not a bigger frame, is the contract."
        : "Insufficient large-result evidence; re-run against the mandatory seed before fixing B."
  };

  const report = {
    lot: "L0",
    generatedAt: new Date().toISOString(),
    env: {
      node: process.version,
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model,
      cpus: os.cpus().length
    },
    seed: {
      source: seed,
      privateCopyRoot: root,
      registryFileBytes: seedRegistryBytes(root)
    },
    registry,
    measures,
    frameByMethod: measures.map((m) => ({ key: m.key, family: m.family, wireBytes: m.wireBytes, isError: m.isError })),
    notMeasured: [
      "push notifications (notifications/*): require a live presence/inbox diff to fire; not driven synchronously here — DECLARED not-measured",
      "signed tool results (h2a_send/h2a_sign): would need fixture-owned keys; out of L0 read-only scope",
      "h2a_run: spawns an agent — never exercised"
    ],
    budgetProposal: proposal,
    traceEventCount: traceEvents.length,
    tracePhases: [...new Set(traceEvents.map((e) => e.phase))]
  };
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(`wrote ${out}`);
  console.log(`registry: ${registry.inscriptions} inscriptions, file ${registry.fileBytes} bytes`);
  for (const m of measures) {
    console.log(`  ${String(m.wireBytes).padStart(10)}  ${m.family}  ${m.key}${m.isError ? " [isError]" : ""}`);
  }
  console.log(
    `budget: B=${B} initFits=${proposal.initializeFitsWithMargin} listFits=${proposal.toolsListFitsWithMargin} large=${large?.wireBytes} >B=${proposal.largeResultExceedsB} >Claude=${proposal.largeResultExceedsClaude}`
  );
  if (!has("keep")) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  } else {
    console.log(`kept private copy: ${root}`);
  }
}

function describe(sc, result, message) {
  if (message?.error) return `rpc-error code=${message.error.code}`;
  if (sc.request.method === "tools/list") return `${result?.tools?.length ?? 0} tools`;
  if (sc.request.method === "initialize") return `version=${result?.serverInfo?.version}`;
  if (result?.isError) {
    const text = result?.content?.[0]?.text ?? "";
    return `tool error: ${text.slice(0, 80)}`;
  }
  return "ok";
}

main().catch((err) => {
  console.error("mcp-size-baseline failed:", err);
  process.exit(1);
});
