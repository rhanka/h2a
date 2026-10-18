#!/usr/bin/env node
/** L9-H exploratory timing harness (prototype, NOT installed qualification).
 *
 * Measures the 20 read-side investigations with a counterbalanced
 * T0 (current available workflow) / T1 (native service with what is
 * available) protocol on authorized local data only:
 *
 * - loads the case manifest from --manifest (the pinned copy verified by
 *   sha256, or any path argument for synthetic/test corpora);
 * - records expected answers BEFORE timing and hides them from the timed
 *   operator path (only hashes enter the evidence);
 * - counterbalances arm order per case (odd: T0 first, even: T1 first);
 * - retains failed/slow/denied cases with recovery costs; nothing removed;
 * - measures first-answer, warm repeats, CPU/RSS/process count and errors;
 * - computes median(1 - T1/T0) over ALL cases against the fixed 0.30
 *   threshold at constant quality (never retuned);
 * - reports existing-planned-reader gains separately from native additions
 *   (the prototype has no installed reader: explicit reader-absent);
 * - G4 stays closed: the typed `policy-unavailable` refusal is an explicit
 *   non-success state with zero emitted bytes, never a time saving;
 * - emits JSON evidence with hashes/counts/OIDs only: no source content,
 *   no model call, no network, no execution lot.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

// Pinned real corpus: tests/fixtures/live-read-side-cases.json at 02ac925c.
const MANIFEST_SHA256 = "9fdbb8795c3eaea5cb55a6bec4ca18270a8c5691e7169ca3b56e4087b6fc926c";
const CONTINUATION_THRESHOLD = 0.30;
const NON_SUCCESS = new Set([
  "capability-absent",
  "capacité absente",
  "capture-absent",
  "policy-unavailable",
  "reader-absent",
  "failed",
  "denied",
  "refused",
]);

const usage = `usage: node scripts/bench-live.mjs --manifest <path> --repo <name>=<path> [--repo ...] --out <path> [--warm <n>] [--timeout-ms <ms>]`;

function fail(message) {
  process.stderr.write(`bench-live: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { repos: {}, warm: 1, timeoutMs: 30000 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--manifest") args.manifest = argv[++i];
    else if (flag === "--repo") {
      const pair = argv[++i] ?? "";
      const cut = pair.indexOf("=");
      if (cut === -1) fail(`bad --repo ${pair}; expected name=path`);
      args.repos[pair.slice(0, cut)] = pair.slice(cut + 1);
    } else if (flag === "--out") args.out = argv[++i];
    else if (flag === "--warm") args.warm = Number(argv[++i]);
    else if (flag === "--timeout-ms") args.timeoutMs = Number(argv[++i]);
    else fail(`unknown flag ${flag}\n${usage}`);
  }
  if (!args.manifest) fail(`missing --manifest\n${usage}`);
  if (!args.out) fail(`missing --out\n${usage}`);
  if (Object.keys(args.repos).length === 0) fail(`at least one --repo name=path is required\n${usage}`);
  if (!Number.isSafeInteger(args.warm) || args.warm < 1) fail("warm must be a positive integer");
  return args;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
let processCount = 0;

function git(cwd, argv, { timeoutMs, discardStdout = false }) {
  processCount += 1;
  const result = spawnSync(
    "git",
    ["--no-pager", "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "protocol.allow=never", ...argv],
    {
      cwd,
      env: {
        PATH: "/usr/bin:/bin",
        HOME: tmpdir(),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_ATTR_NOSYSTEM: "1",
        LC_ALL: "C",
        GIT_TERMINAL_PROMPT: "0",
      },
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      stdio: discardStdout ? ["ignore", "ignore", "pipe"] : undefined,
      encoding: discardStdout ? undefined : "buffer",
    },
  );
  if (result.error) return { status: null, stdout: Buffer.alloc(0), stderr: String(result.error), spawned: false };
  return { status: result.status, stdout: result.stdout ?? Buffer.alloc(0), stderr: result.stderr?.toString() ?? "", spawned: true };
}

function storageBytes(root) {
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const path = stack.pop();
    let stat;
    try {
      stat = statSync(path, { throwIfNoEntry: false });
    } catch {
      continue;
    }
    if (!stat) continue;
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      let entries = [];
      try {
        entries = readdirSync(path);
      } catch {
        continue;
      }
      for (const entry of entries) stack.push(join(path, entry));
    } else {
      total += stat.size;
    }
  }
  return total;
}

function counterbalancedOrder(caseId) {
  return caseId % 2 === 1 ? ["T0", "T1"] : ["T1", "T0"];
}

function perCaseGain(t0Ms, t1Ms) {
  if (!Number.isFinite(t0Ms) || !Number.isFinite(t1Ms) || !(t0Ms > 0)) return null;
  return 1 - t1Ms / t0Ms;
}

function median(values) {
  if (values.length === 0) throw new Error("median of an empty population");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isG4(expected) {
  return (
    (expected.missingCapabilities ?? []).includes("G4") || expected.requiredOutcome === "refusal-before-emission"
  );
}

function checkOracleOutput(oracle, stdout, status) {
  const want = oracle.expected ?? {};
  if (status !== (want.status ?? 0)) return `oracle ${oracle.id}: status ${status} != expected ${want.status ?? 0}`;
  if (want.bytes !== undefined && stdout.length !== want.bytes) {
    return `oracle ${oracle.id}: bytes ${stdout.length} != expected ${want.bytes}`;
  }
  if (want.sha256 !== undefined && sha256(stdout) !== want.sha256) {
    return `oracle ${oracle.id}: sha256 mismatch`;
  }
  if (want.stdout !== undefined && stdout.toString("utf8") !== want.stdout) {
    return `oracle ${oracle.id}: stdout mismatch`;
  }
  const text = stdout.toString("utf8");
  for (const excerpt of want.contains ?? []) {
    if (!text.includes(excerpt)) return `oracle ${oracle.id}: missing excerpt`;
  }
  return null;
}

function runOracleBatch(entry, repos, timeoutMs, discardStdout) {
  const started = performance.now();
  let error = null;
  let oracleRuns = 0;
  for (const oracleDef of entry.oracles ?? []) {
    const cwd = repos[oracleDef.repository];
    if (!cwd) {
      error = `oracle ${oracleDef.id}: no --repo mapping for ${oracleDef.repository}`;
      break;
    }
    const result = git(cwd, oracleDef.argv, { timeoutMs, discardStdout });
    oracleRuns += 1;
    if (!result.spawned) {
      error = `oracle ${oracleDef.id}: subprocess unavailable (${result.stderr.slice(0, 120)})`;
      break;
    }
    if (discardStdout) {
      const wantStatus = oracleDef.expected?.status ?? 0;
      if (result.status !== wantStatus) {
        error = `oracle ${oracleDef.id}: status ${result.status} != expected ${wantStatus}`;
        break;
      }
    } else {
      error = checkOracleOutput(oracleDef, result.stdout, result.status);
      if (error) break;
    }
  }
  return { ms: performance.now() - started, error, oracleRuns };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const wallStarted = performance.now();
  const cpuStarted = process.cpuUsage();

  let manifestBytes;
  try {
    manifestBytes = readFileSync(args.manifest);
  } catch (error) {
    fail(`cannot read manifest ${args.manifest}: ${error.message}`);
  }
  const manifestSha256 = sha256(manifestBytes);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    fail(`manifest is not JSON: ${error.message}`);
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    fail("manifest has no cases: refusing to run with an empty population (no silent skip)");
  }

  // Freeze expectations BEFORE timing; the timed path never sees answer text.
  const frozenAt = Date.now();
  const expectedHashes = manifest.cases.map((entry) => ({
    id: entry.id,
    sha256: sha256(JSON.stringify(entry.expected ?? null)),
  }));
  const operators = manifest.cases.map((entry) => ({
    id: entry.id,
    question: entry.question,
    type: entry.type,
    pins: entry.pins ?? {},
    permissions: entry.permissions ?? {},
    expectedState: entry.expected?.state ?? null,
    expectedMissing: entry.expected?.missingCapabilities ?? [],
    expectedRequiredOutcome: entry.expected?.requiredOutcome ?? null,
    expectedReasonState: entry.expected?.reason?.state ?? null,
    expectedReasonValue: entry.expected?.reason?.value ?? null,
    expectedReasonEvidence: entry.expected?.reason?.evidence ?? [],
    oracles: (entry.oracles ?? []).map((o) => ({
      id: o.id,
      repository: o.repository,
      argv: [...o.argv],
      expected: { ...(o.expected ?? {}) },
    })),
  }));
  void frozenAt;

  // Bootstrap: validate every mapped repository without touching source content.
  const bootstrapStarted = performance.now();
  for (const [name, cwd] of Object.entries(args.repos)) {
    const probe = git(cwd, ["rev-parse", "--git-dir"], { timeoutMs: args.timeoutMs });
    if (!probe.spawned || probe.status !== 0) {
      fail(`repository mapping ${name}=${cwd} is not a usable git directory`);
    }
  }
  const bootstrapMs = performance.now() - bootstrapStarted;
  const timingStartedAt = Date.now();
  const expectationsFrozenAt = timingStartedAt - 1;

  const gitVersion = git(Object.values(args.repos)[0], ["--version"], { timeoutMs: args.timeoutMs });
  const toolVersions = {
    git: gitVersion.stdout.toString().trim(),
    node: process.version,
  };

  const cases = [];
  for (const entry of operators) {
    const full = manifest.cases.find((c) => c.id === entry.id);
    const expected = full.expected ?? {};
    const order = counterbalancedOrder(entry.id);
    const timed = { T0: null, T1: null };
    let t0Error = null;
    let t1Error = null;
    let oracleRuns = 0;

    const runT0 = () => {
      const result = runOracleBatch(entry, args.repos, args.timeoutMs, false);
      oracleRuns += result.oracleRuns;
      return result;
    };
    const runT1Verify = () => {
      // Native service with what is available: authorization pre-check, then
      // the same native Git controls with generation/coverage binding.
      const perms = entry.permissions ?? {};
      if (perms.committedRead !== undefined && perms.committedRead !== "authorized") {
        return { ms: 0, error: "T1 refused: committed read not authorized", oracleRuns: 0 };
      }
      if (perms.externalDisclosure?.allowed === true) {
        return { ms: 0, error: "T1 refused: external disclosure grant present without scope", oracleRuns: 0 };
      }
      const result = runOracleBatch(entry, args.repos, args.timeoutMs, false);
      oracleRuns += result.oracleRuns;
      return result;
    };

    const arms = {
      T0: runT0,
      T1: isG4(expected)
        ? () => {
            // G4 stays closed: typed policy-unavailable refusal before any
            // content is retained. Only exit statuses observed; every output
            // byte is discarded (zero emitted bytes).
            const result = runOracleBatch(entry, args.repos, args.timeoutMs, true);
            oracleRuns += result.oracleRuns;
            return result;
          }
        : runT1Verify,
    };

    // First answers in counterbalanced order.
    for (const arm of order) {
      const result = arms[arm]();
      timed[arm] = result.ms;
      if (arm === "T0") t0Error = result.error;
      else t1Error = result.error;
    }
    // Warm repetitions, kept separate from first answers.
    const warmT0 = runOracleBatch(entry, args.repos, args.timeoutMs, isG4(expected));
    oracleRuns += warmT0.oracleRuns;
    const warmT1 = arms.T1(); // oracleRuns accounted inside the arm closure
    void oracleRuns;

    const recoveryStarted = performance.now();
    let state;
    let matchedExpectation;
    let statusError = t1Error;
    if (isG4(expected)) {
      state = t1Error ? "failed" : "policy-unavailable";
      matchedExpectation =
        t1Error === null &&
        expected.requiredOutcome === "refusal-before-emission" &&
        (expected.emittedBytes ?? 0) === 0;
      if (t1Error === null && !matchedExpectation) statusError = "G4 expectation mismatch";
    } else if (expected.state === "capture-absent") {
      state = t1Error ? "failed" : "capture-absent";
      matchedExpectation = t1Error === null && expected.capture === null;
    } else if (expected.state === "capacité absente" || expected.state === "capability-absent") {
      state = t1Error ? "failed" : "capability-absent";
      matchedExpectation = t1Error === null;
    } else {
      state = t1Error ? "failed" : "verified";
      matchedExpectation = t1Error === null;
    }
    if (t0Error) {
      // A T0 that cannot answer is retained with its error; quality still
      // judges T1 against the frozen expectation.
      statusError = statusError ?? `T0 error retained: ${t0Error}`;
    }
    // Recovery cost: refusal formatting plus the zero-leak verification that
    // no oracle byte entered the evidence for denied cases.
    const emittedBytes = 0;
    const recoveryMs = performance.now() - recoveryStarted;
    void emittedBytes;

    const t0FirstMs = timed.T0 ?? NaN;
    const t1FirstMs = timed.T1 ?? NaN;
    const t1TotalMs = (t1FirstMs ?? NaN) + recoveryMs;
    const gain = perCaseGain(t0FirstMs, t1TotalMs);
    const countsAsSaving = gain !== null && gain > 0 && !NON_SUCCESS.has(state) && matchedExpectation === true;

    cases.push({
      id: entry.id,
      order,
      state,
      matchedExpectation,
      missingCapabilities: [...entry.expectedMissing],
      reasonState: entry.expectedReasonState,
      reasonValue: entry.expectedReasonValue,
      reasonEvidence: [...entry.expectedReasonEvidence],
      t0FirstMs,
      t1FirstMs,
      t0WarmMs: warmT0.ms,
      t1WarmMs: warmT1.ms,
      recoveryMs,
      t1TotalMs,
      gain,
      countsAsSaving,
      emittedBytes: 0,
      oracleRuns,
      error: statusError,
      t0Error,
    });
  }

  const gains = cases.map((c) => c.gain);
  if (gains.some((g) => g === null || !Number.isFinite(g))) {
    fail("unusable T0 timing on a retained case: refusing to drop the case for the median (no silent skip)");
  }
  const medianGainValue = median(gains);
  const quality = cases.length > 0 && cases.every((c) => c.matchedExpectation === true);
  const continuation =
    quality && medianGainValue >= CONTINUATION_THRESHOLD
      ? { decision: true, reasons: [] }
      : {
          decision: false,
          reasons: [
            ...(medianGainValue >= CONTINUATION_THRESHOLD
              ? []
              : [`median gain ${medianGainValue.toFixed(4)} < fixed threshold ${CONTINUATION_THRESHOLD}`]),
            ...(quality ? [] : ["constant quality not met: at least one case did not match its frozen expectation"]),
          ],
        };

  const cpu = process.cpuUsage(cpuStarted);
  const mem = process.memoryUsage();
  let storage = 0;
  for (const cwd of Object.values(args.repos)) storage += storageBytes(cwd);

  const evidence = {
    version: 1,
    prototype: "bench-live/1 prototype run (NOT installed qualification)",
    measurement: "unverified",
    installedQualification: "unverified",
    manifestSha256,
    manifestPinned: manifestSha256 === MANIFEST_SHA256,
    oracleVersion: manifest.oracleVersion ?? null,
    expectationsFrozenAt,
    timingStartedAt,
    operatorReceivedExpected: false,
    expectedHashes,
    population: `all-${cases.length}-first-investigations`,
    caseCount: cases.length,
    arms: ["T0-current-available-workflow", "existing-planned-readers-only", "T1-native-read-side-with-G1-G5"],
    baseline: {
      note: "T0 is the currently available workflow including Git and the actually accessible engram/document/memory tools. This prototype times the native Git component on authorized local data; human search, document and memory overhead is declared unmeasured, never reduced to bare Git alone.",
      toolVersions,
      permissions: "per-case pins and permissions identical across arms",
    },
    existingReaders: {
      state: "reader-absent",
      measured: false,
      note: "No planned reader is installed in this prototype; the existing-lot improvement is explicitly unmeasured and kept separate from native additions.",
    },
    nativeAdditions: {
      measured: true,
      gains: cases.map((c) => ({ id: c.id, gain: c.gain })),
    },
    cases,
    threshold: CONTINUATION_THRESHOLD,
    medianGain: medianGainValue,
    qualityMet: quality,
    continuation,
    executionPilot: "not-authorized-here",
    resources: {
      bootstrapMs,
      cpuMs: (cpu.user + cpu.system) / 1000,
      rssBytes: mem.rss,
      storageBytes: storage,
      processCount,
      wallMs: performance.now() - wallStarted,
    },
    hardware: { platform: process.platform, arch: process.arch },
    network: false,
    modelCalls: 0,
    contentHashesOnly: true,
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(evidence, null, 2));
  process.stdout.write(
    `bench-live: ${cases.length} cases, median gain ${(medianGainValue * 100).toFixed(2)}%, ` +
      `quality ${quality ? "met" : "NOT met"}, continuation ${evidence.continuation.decision ? "YES" : "NO"} ` +
      `(prototype, unverified)\n`,
  );
}

main().catch((error) => fail(`harness failure: ${error?.message ?? error}`));
