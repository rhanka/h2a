#!/usr/bin/env node
import { loadM17Partition } from "./m17-ci-evidence.mjs";
import { loadBulkPartition } from "./bulk-ci-evidence.mjs";
/**
 * Cross-platform test runner. Used by `npm test` (via scripts/run-test-gates.mjs).
 *
 * Shell glob expansion (`packages/h2a/test/*.test.js`) is fine on bash but
 * silently breaks on PowerShell (Windows runners), where the literal asterisk
 * is forwarded to node. This runner discovers test files itself using
 * `node:fs`, so it behaves identically on Linux, macOS and Windows.
 *
 * It runs the test trees explicitly owned by the root `npm test` gate:
 *   - top-level `*.test.js` files in packages/h2a/test and
 *     packages/focus-interactive/test through `node --test`, EXCEPT the gate
 *     runner's own trust-root test (RUNNER_TEST_FILE below), which CI invokes
 *     directly in a dedicated, independently requireable job so a mutation in
 *     the runner cannot decide that its own failing test has passed;
 *   - every source `.test.ts` or `.spec.ts` file under packages/track/src and
 *     every `.test.ts` file under packages/agent-stats/tests through Vitest.
 *     Those suites are separate because they are TypeScript/Vitest rather
 *     than Node's built-in test runner;
 *   - the four lane-scoped identity-lock suites (LANE_TEST_FILES below) through
 *     packages/h2a/test/helpers/identity-isolated-run.mjs, which builds an
 *     isolated lane (previous-release bindings + lane TMPDIR) they require.
 *
 * Other workspace packages own their own package-level test commands and are not
 * represented by this root gate. Do not quote this runner as a whole-monorepo
 * test count.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { verifyCleanseContracts } from "./cleanse-contract-ledger.mjs";
import { setupNodeSuiteEnv, teardownNodeSuiteEnv } from "./node-suite-env.mjs";
import { loadNodeShardReports } from "./ci-node-shards.mjs";

// Disposable-TMPDIR guarantee (PR #390 R3 P1): `npm test` never inherits a
// bare /tmp TMPDIR into the confinement assertion in restart-lab.js.
function ensureDisposableTmpdir() {
  // Same dual-guard contract as run-test-gates.mjs: TMPDIR set and != /tmp,
  // and the dir admitted as H2A_TEST_QUALIFICATION_ROOT
  // ($HOME/.cache-tmp/h2a-test/run-*).
  const qualPattern = /^\/home\/[^/]+\/\.cache-tmp\/h2a-test\/run-[A-Za-z0-9]+$/;
  const current = process.env.TMPDIR;
  try {
    if (current && qualPattern.test(resolve(current)) && existsSync(current)) {
      if (!process.env.H2A_TEST_QUALIFICATION_ROOT) process.env.H2A_TEST_QUALIFICATION_ROOT = resolve(current);
      return resolve(current);
    }
  } catch { /* fall through and create */ }
  const base = join(homedir(), ".cache-tmp", "h2a-test");
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, "run-"));
  process.env.TMPDIR = dir;
  process.env.TMP = dir;
  process.env.TEMP = dir;
  process.env.H2A_TEST_QUALIFICATION_ROOT = dir;
  process.once("exit", () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
  return dir;
}

ensureDisposableTmpdir();
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { discoverSuites, readInventory, verifyExecutionReport, inventoryFailures } from "./test-execution-evidence.mjs";
import { policyFor, readDeclaredNonTests } from "./test-inventory.mjs";
import { reportSuiteDurations } from "./report-test-durations.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..");

// A1: la suite vit dans packages/h2a/test (h2a-cli est un stub deprecie, sans tests).
export const TEST_DIRS = ["packages/h2a/test", "packages/focus-interactive/test"];

// This test must run outside scripts/run-test-gates.mjs. See CI's dedicated
// `npm-test-trust-root` job.
export const RUNNER_TEST_FILE = "packages/h2a/test/run-test-gates.test.js";

export function prioritizeNodeTestFiles(files) {
  const packageFiles = new Set(['mh-l6-package.test.js', 'mh-l6-runtime-package.test.js']);
  const priority = file => packageFiles.has(file.replaceAll('\\', '/').split('/').at(-1));
  return files.sort((a, b) => Number(priority(b)) - Number(priority(a)));
}

// Lane-scoped identity-lock suites. They mount the previous release's real
// bindings (lane/base) and confine every simulation root inside an isolated
// lane (IDLOCK_LANE + lane TMPDIR, enforced by legacy-reboot-loader). Under a
// plain `node --test` run there is no lane, so discovery here must skip them —
// exactly like RUNNER_TEST_FILE above — and main() runs them through
// packages/h2a/test/helpers/identity-isolated-run.mjs instead, where the lane
// exists. LANE_TEST_FILES is the single source: discovery excludes these names
// and the lane invocation below passes them, so a rename cannot silently drop
// a suite from both. See packages/h2a/test/lane-test-scope.test.js.
export const LANE_TEST_FILES = [
  "packages/h2a/test/identity-lock-incident.test.js",
  "packages/h2a/test/identity-lock-legacy-v6.test.js",
  "packages/h2a/test/identity-lock-stdio-v6.test.js",
  "packages/h2a/test/identity-lock-v6.test.js",
];

/**
 * Floor on the number of discovered test files.
 *
 * WHY A FLOOR AND NOT JUST "> 0". This is an early discovery diagnostic; per-test execution reports
 * are verified after both suites finish. The existing `files.length === 0` guard catches total discovery
 * failure, but nothing catches a COLLAPSE: a renamed directory, a changed
 * suffix, or a path bug that drops discovery from 189 files to 1 would still
 * exit 0 and still print a confident green. A run that silently stops looking
 * is the same defect class as a gate that silently suppresses the suite.
 *
 * WHY 150. Discovery currently finds well over 180 files. 150 sits ~20% below
 * that: low enough that ordinary churn (consolidating or deleting a few suites)
 * never trips it, high enough that any collapse worth the name does. It is a
 * tripwire against a broken discovery mechanism, NOT a coverage target — raise
 * it only to track a genuine, sustained rise in the file count.
 */
export const MINIMUM_TEST_FILES = 150;

/** Discover the node test files this runner would execute. Pure: no side effects. */
export function discoverTestFiles() {
  const files = [];
  for (const rel of TEST_DIRS) {
    const abs = join(REPO_ROOT, rel);
    let entries;
    try {
      entries = readdirSync(abs);
    } catch (err) {
      // Un dossier de test absent (ex: package sans tests) est ignore, pas fatal.
      if (err && err.code === "ENOENT") {
        continue;
      }
      throw new Error(
        `run-tests: cannot read ${abs} (${(err && err.message) || err})`
      );
    }
    for (const entry of entries) {
      if (entry.endsWith(".test.js")) {
        const file = join(rel, entry);
        const normalized = file.split("\\").join("/");
        if (normalized !== RUNNER_TEST_FILE && !LANE_TEST_FILES.includes(normalized)) {
          files.push(file);
        }
      }
    }
  }
  return files;
}

/** Rule-based, exhaustive partition; preserve discovery paths on every OS. */
export function partitionNodeTestFiles(files) {
  const buckets = [
    { name: "corpus", files: [] },
    { name: "native", files: [] },
    { name: "rest", files: [] },
  ];
  for (const file of [...files].sort()) {
    const normalized = file.replaceAll("\\", "/");
    const bucket = normalized.endsWith("/drive-consent-index.test.js") ? buckets[0]
      : /\/native-[^/]+\.test\.js$/.test(normalized) ? buckets[1] : buckets[2];
    bucket.files.push(file);
  }
  return buckets;
}

export const NODE_TRACK_EXECUTION_REPORT = join(REPO_ROOT, "tmp", "node-track-report.json");
export function listNodeTrackSuiteFiles() {
  const track = discoverSuites(join(REPO_ROOT, "packages/track/src"), [".test.ts", ".spec.ts"]);
  if (!track.length) return [];
  const files = [...discoverTestFiles().map((file) => join(REPO_ROOT, file)), ...track];
  const inventory = Object.fromEntries(Object.entries(readInventory(REPO_ROOT)).filter(([file]) => !file.startsWith("packages/h2a-runtime/src/")));
  // Removing an entire declared non-test file must not remove its identities
  // from the required execution scope unnoticed.
  const nonTestFiles = Object.fromEntries(readDeclaredNonTests(REPO_ROOT)
    .filter(entry => !entry.file.startsWith('packages/h2a-runtime/')).map(entry => [entry.file, []]));
  const missingNonTests = inventoryFailures(REPO_ROOT, nonTestFiles, files);
  if (missingNonTests.length) {
    process.stderr.write(missingNonTests.map(f => f.replace('normative suite missing', 'declared non-test suite disappeared')).join("\n") + "\n");
    return [];
  }
  return inventoryFailures(REPO_ROOT, inventory, files).length ? [] : files;
}
export function verifyNodeTrackExecution(report, requiredFiles, ledger) {
  return [...verifyExecutionReport(report, requiredFiles, policyFor(REPO_ROOT, readInventory(REPO_ROOT), "node")),
    ...verifyCleanseContracts(report, requiredFiles, ledger)];
}

async function main() {
  process.umask(0o022);
  // Each configured directory is REQUIRED, in the sense of main's original
  // contract: an unavailable directory, or one with no .test.js files at all,
  // is a broken suite root — not a silently skipped one.
  for (const rel of TEST_DIRS) {
    const abs = join(REPO_ROOT, rel);
    let entries;
    try {
      entries = readdirSync(abs);
    } catch (err) {
      process.stderr.write(
        `run-tests: required Node test directory is unavailable: ${abs} (${(err && err.message) || err})\n`
      );
      process.exit(1);
    }
    if (!entries.some((entry) => entry.endsWith(".test.js"))) {
      process.stderr.write(`run-tests: required Node test directory has no .test.js files: ${abs}\n`);
      process.exit(1);
    }
  }

  let nodeTestFiles;
  try {
    nodeTestFiles = discoverTestFiles();
    // Each package's real installations can take ~250s on CI. Start both
    // independent package files with the pool, retaining every scenario and
    // the existing shared 600s backstop.
    prioritizeNodeTestFiles(nodeTestFiles);
  } catch (err) {
    process.stderr.write(`${(err && err.message) || err}\n`);
    process.exit(1);
  }

  if (nodeTestFiles.length === 0) {
    process.stderr.write("run-tests: no .test.js files discovered\n");
    process.exit(1);
  }

  if (nodeTestFiles.length < MINIMUM_TEST_FILES) {
    process.stderr.write(
      `run-tests: DISCOVERY COLLAPSE — found ${nodeTestFiles.length} test files, ` +
        `expected at least ${MINIMUM_TEST_FILES}.\n` +
        `  Discovery looked in: ${TEST_DIRS.join(", ")}\n` +
        `  This is not a coverage complaint: a count this low means the discovery ` +
        `mechanism itself is broken (renamed directory, changed suffix, wrong path), ` +
        `and the tests that DID run attest nothing about the ones that were never found.\n` +
        `  If the drop is legitimate, lower MINIMUM_TEST_FILES deliberately and say why.\n`
    );
    process.exit(1);
  }

  // CI shard jobs execute their partition through scripts/run-node-shard.mjs on
  // their own runners; the aggregate consumer below imports their envelopes
  // instead of re-executing. See loadNodeShardReports.
  // CI can import only closed M17/bulk proofs from this exact workflow
  // run/attempt/checkout/Node. Discovery and the final inventory stay complete.
  // Without explicit proofs every file runs locally; malformed proof is fatal.
  const m17Partition = loadM17Partition(nodeTestFiles, REPO_ROOT);
  const bulkPartition = loadBulkPartition(m17Partition.local, REPO_ROOT);
  if (m17Partition.report) process.stdout.write(`M17 companion proof validated: ${JSON.stringify({
    file: 'packages/h2a/test/mh-l5-concurrency.test.js', checkout: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, node: process.version,
    source: process.env.H2A_TEST_CI_M17_REPORT,
  })}\n`);
  if (bulkPartition.report) process.stdout.write(`Bulk companion proof validated: ${JSON.stringify({
    checkout: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT, node: process.version,
    source: process.env.H2A_TEST_CI_BULK_REPORT,
  })}\n`);

  const VITEST_SUITES = [
    { name: "Track", dir: "packages/track", config: "vitest.config.ts" },
    { name: "AgentStats", dir: "packages/agent-stats", testDir: "tests", config: "vitest.config.ts" },
    { name: "Focus", dir: "packages/focus", testDir: "tests", config: "vitest.config.ts" },
  ];

  function discoverVitestTests(dir, relative = "") {
    const entries = readdirSync(join(dir, relative), { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const entryPath = join(relative, entry.name);
      if (entry.isDirectory()) {
        files.push(...discoverVitestTests(dir, entryPath));
      } else if (entry.isFile() && (entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts"))) {
        files.push(entryPath);
      }
    }
    return files;
  }

  const vitestSuites = VITEST_SUITES.map((suite) => {
    const sourceDir = join(REPO_ROOT, suite.dir, suite.testDir ?? "src");
    let files;
    try {
      files = discoverVitestTests(sourceDir);
    } catch (err) {
      process.stderr.write(
        `run-tests: cannot read ${sourceDir} (${(err && err.message) || err})\n`
      );
      process.exit(1);
    }
    if (files.length === 0) {
      process.stderr.write(`run-tests: no .test.ts/.spec.ts files discovered for ${suite.name}\n`);
      process.exit(1);
    }
    return { ...suite, files };
  });
  const vitestFileCount = vitestSuites.reduce((count, suite) => count + suite.files.length, 0);
  process.stderr.write(
    `run-tests: discovered ${nodeTestFiles.length} Node test files and ${vitestFileCount} Vitest files ` +
      `(${vitestSuites.map((suite) => `${suite.name}: ${suite.files.length}`).join("; ")}) ` +
      `and ${LANE_TEST_FILES.length} lane files (identity-isolated-run)\n`,
  )

  // Wall-clock backstop. A single hanging test (e.g. a spawned mcp-serve child
  // that never closes on Windows) used to eat the CI job's full 15-minute budget
  // and get CANCELLED — a silent, mysterious failure that blocked npm publish
  // twice. Cap each suite well under any CI job timeout so a hang fails CLEAN
  // and NAMED instead. Portable across node versions (a spawnSync option, not the
  // node-20-incompatible `--test-timeout` flag). Override via H2A_TEST_TIMEOUT_MS.
  const RUN_TIMEOUT_MS = Number(process.env.H2A_TEST_TIMEOUT_MS) || 600000;
  // The expanded closed-package/Node-ABI qualification is still doing useful
  // work at ten minutes (owned-child progress identifies the active files).
  // The long backend campaign now overlaps the remaining Node phases; it keeps
  // all 10,000 mutations/domain. This outer leak backstop is twenty minutes;
  // individual case deadlines and the CI job's 25-minute budget are unchanged.
  const NODE_TIMEOUT_MS = Number(process.env.H2A_TEST_TIMEOUT_MS) || 1200000;

  // Fixture environment shared with the CI shard executor
  // (scripts/run-node-shard.mjs): identical isolated roots, legacy host,
  // fixture archives and pack warmer, from one source of truth.
  const { testRoot, testEnv, trackFixtureEnv, trackTestEnv, trackTemp, legacyHost, mhFixtures, packWarmer } =
    await setupNodeSuiteEnv(REPO_ROOT);

  function runSuite(name, command, args, cwd, env = testEnv, timeoutMs = RUN_TIMEOUT_MS) {
    const result = spawnSync(command, args, {
      cwd,
      stdio: "inherit",
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      env
    });

    if (result.error && result.error.code === "ETIMEDOUT") {
      process.stderr.write(
        `\nrun-tests: ${name} HUNG — the test run exceeded ${timeoutMs}ms and was killed. ` +
        `A test is not terminating (often a spawned child that never exits).\n`
      );
      return 124;
    }
    if (result.error) {
      process.stderr.write(`run-tests: ${name}: ${result.error.message}\n`);
      return 1;
    }
    return result.status ?? 1;
  }

  function vitestEntrypoint(cwd) {
    const local = join(cwd, "node_modules", "vitest", "vitest.mjs");
    return existsSync(local) ? local : join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs");
  }

  // Each Node invocation keeps the existing backstop and reporters. Separate
  // evidence paths prevent a later bucket from overwriting an earlier one.
  // Buckets cover ONLY the local partition: the M17 campaign and the nine
  // bulk suites run in their qualification jobs (same-run imported proofs),
  // never redundantly here (their local re-execution + appended external
  // reports used to duplicate every suite identity and blow the rest backstop).
  // A bucket emptied by proof import (corpus holds only the bulk-covered
  // drive-consent file) is skipped, not failed: its suite identity arrives
  // via the imported proof and the report math counts executed buckets only.
  //
  // CI aggregate mode (H2A_TEST_NODE_SHARD_DIR set by the CI consumers):
  // every local file arrives as a verified shard envelope from the node-shard
  // matrix jobs instead of executing here. Nothing runs locally; a missing,
  // stale or partial shard envelope throws above and fails the run. Unset:
  // every local file runs here (maintainer boxes).
  const shardPartition = loadNodeShardReports(bulkPartition.local, REPO_ROOT);
  if (shardPartition.reports.length) {
    if (shardPartition.local.length) {
      throw new Error('run-tests: shard evidence imported yet local files remain; refusing a split inventory');
    }
    for (const report of shardPartition.reports) {
      process.stdout.write(`run-tests: Node shard evidence validated: ${report.testResults.length} files\n`);
    }
  }
  const nodeBuckets = partitionNodeTestFiles(shardPartition.local).map((bucket) => ({
    ...bucket, report: join(testRoot, `node-${bucket.name}.json`),
  })).filter((bucket) => {
    if (!bucket.files.length) process.stderr.write(`run-tests: Node bucket ${bucket.name} is empty after proof import and is skipped\n`);
    return bucket.files.length > 0;
  });
  function runIndependentSuite(name, command, args, cwd, env) {
    return new Promise((done) => {
      let child, timer, finished = false;
      const finish = (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        done(code);
      };
      try {
        child = spawn(command, args, { cwd, env, stdio: "inherit" });
        child.once("error", (error) => {
          process.stderr.write(`run-tests: ${name}: ${error.message}\n`);
          finish(1);
        });
        child.once("close", (code) => finish(code ?? 1));
        timer = setTimeout(() => {
          child.kill("SIGKILL");
          process.stderr.write(`run-tests: ${name} HUNG — the test run exceeded ${RUN_TIMEOUT_MS}ms and was killed.\n`);
          finish(124);
        }, RUN_TIMEOUT_MS);
      } catch (error) {
        process.stderr.write(`run-tests: ${name}: ${error.message}\n`);
        finish(1);
      }
    });
  }
  const trackReport = join(testRoot, "track.json");
  // One JSON evidence report per Vitest suite: every suite uses the same
  // `--reporter=json --outputFile`, so sharing a single path would let the
  // second suite overwrite the first one's evidence unnoticed.
  const vitestReportFor = (suite) => join(testRoot, `${suite.name.toLowerCase()}.json`);
  // Lane pointer before this run (see cleanup in finally): the lane helper
  // overwrites tmp/idlock-build2-lane.txt on every full run.
  let lanePointerBefore = null;
  try { lanePointerBefore = readFileSync(join(REPO_ROOT, "tmp", "idlock-build2-lane.txt"), "utf8"); } catch {}
  // The shared fixture environment (pack warmer included) is reaped by
  // teardownNodeSuiteEnv in the try/finally below, on every path.
  let exitCode = 0;
  try {
    const nodeStatuses = nodeBuckets.map((bucket) => {
      const started = performance.now();
      // Empty buckets are filtered above, so every bucket here executes.
      // (run-node-tests.mjs asserts a non-empty explicit file list: an empty
      // list would rediscover the repository.)
      const status = runSuite(`Node ${bucket.name} test suite`, process.execPath,
        [join(REPO_ROOT, "scripts/run-node-tests.mjs"), "--test", "--test-reporter=spec", `--test-reporter=${join(REPO_ROOT, "scripts/node-evidence-reporter.mjs")}`, "--test-reporter-destination=stdout", `--test-reporter-destination=${bucket.report}`, ...bucket.files],
        REPO_ROOT, trackFixtureEnv, NODE_TIMEOUT_MS);
      process.stdout.write(`run-tests: Node bucket ${bucket.name}: ${bucket.files.length} file(s), ${((performance.now() - started) / 1000).toFixed(3)}s, exit ${status}\n`);
      return status;
    });
    // These suites use distinct temporary state and evidence files. Start
    // them after Node's protocol/package phase, together with the identity
    // lane, so their individual deadlines do not accumulate at the outer gate.
    const independent = await Promise.all([...vitestSuites.map(async (suite) => {
      const cwd = join(REPO_ROOT, suite.dir);
      const configArgs = suite.config === undefined ? [] : ["--config", suite.config];
      const status = await runIndependentSuite(
        `${suite.name} Vitest suite`,
        process.execPath,
        // Three Vitest processes share the runner with the identity lane.
        // One file worker each avoids three independent all-CPU pools.
        [vitestEntrypoint(cwd), "run", ...configArgs, "--maxWorkers=1", "--reporter=default", "--reporter=json", `--outputFile=${vitestReportFor(suite)}`, ...suite.files.map((file) => join(suite.testDir ?? "src", file))],
        cwd,
        trackTestEnv,
      );
      try {
        reportSuiteDurations(JSON.parse(readFileSync(vitestReportFor(suite), "utf8")), { label: suite.name });
      } catch {
        process.stderr.write(`WARNING: ${suite.name}: suite timing unavailable (missing or malformed report).\n`);
      }
      return status;
    }), runIndependentSuite("Identity lane suite", process.execPath,
      [join(REPO_ROOT, "packages/h2a/test/helpers/identity-isolated-run.mjs"), ...LANE_TEST_FILES],
      REPO_ROOT, trackFixtureEnv)]);
    const vitestStatuses = independent.slice(0, vitestSuites.length);
    // Lane-scoped identity-lock suites (LANE_TEST_FILES): the isolated lane
    // they require exists only inside identity-isolated-run.mjs, which builds
    // it (previous-release bindings + lane TMPDIR) and runs exactly these
    // files under the lane guard. Gated on exit status like the Vitest suites.
    const laneStatus = independent[vitestSuites.length];
    let reports;
    try { reports = [...nodeBuckets.map((bucket) => bucket.report), trackReport].map((path) => JSON.parse(readFileSync(path, "utf8"))); }
    catch { reports = []; }
    const localReportCount = reports.length;
    // Shard envelopes verified on import above merge here exactly like the
    // M17/bulk companion proofs: the aggregate inventory below proves every
    // required file executed exactly once, wherever it ran.
    if (shardPartition.reports.length) reports.push(...shardPartition.reports);
    if (m17Partition.report) reports.push(m17Partition.report);
    if (bulkPartition.report) reports.push(bulkPartition.report);
    const required = listNodeTrackSuiteFiles();
    const combined = {
      success: localReportCount === nodeBuckets.length + 1 && reports.every((report) => report.success !== false),
      testResults: reports.flatMap((report) => report.testResults ?? []),
      ...Object.fromEntries(["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests"]
        .map((key) => [key, reports.reduce((sum, report) => sum + report[key], 0)])),
    };
    const holes = verifyNodeTrackExecution(combined, required);
    if (!holes.length && m17Partition.report) process.stdout.write('M17 local/external exhaustive inventory verification: passed\n');
    if (!holes.length && bulkPartition.report) process.stdout.write('Bulk local/external exhaustive inventory verification: passed\n');
    if (!holes.length && shardPartition.reports.length) process.stdout.write(`Node shard/aggregate exhaustive inventory verification: passed (${shardPartition.reports.length} shards)\n`);
    if (holes.length) process.stderr.write(holes.join("\n") + "\n");
    else {
      process.stdout.write(shardPartition.reports.length
        ? `run-tests: Node shards inventory verified: ${nodeTestFiles.length} files exactly once across ${shardPartition.reports.length} shards (plus Track).\n`
        : `run-tests: Node buckets inventory verified: ${nodeTestFiles.length} files exactly once across ${nodeBuckets.length} buckets (plus Track).\n`);
      process.stdout.write(`RC 0.98.6: ${readDeclaredNonTests(REPO_ROOT).length} declared non-tests observed at their exact expected statuses; not claimed as coverage.\n`);
    }
    const reportPath = process.env.H2A_TEST_REPORT_PATH ?? NODE_TRACK_EXECUTION_REPORT;
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(combined));
    exitCode = holes.length ? 1 : [...nodeStatuses, ...vitestStatuses, laneStatus].every((status) => status === 0) ? 0 : Math.max(...nodeStatuses, ...vitestStatuses, laneStatus);
  } finally {
    await teardownNodeSuiteEnv({ testRoot, trackTemp, legacyHost, mhFixtures, packWarmer });
    // Best-effort cleanup of the identity lane. The lane helper records the
    // lane it built in tmp/idlock-build2-lane.txt: remove that lane — and the
    // pointer, when it still names it — so OS tmp does not accumulate one lane
    // per run. Cleanup warnings never mask the suite verdict.
    try {
      const pointer = join(REPO_ROOT, "tmp", "idlock-build2-lane.txt");
      let after = null;
      try { after = readFileSync(pointer, "utf8"); } catch {}
      if (after && after !== lanePointerBefore) {
        rmSync(after, { recursive: true, force: true });
        try {
          if (readFileSync(pointer, "utf8") === after) rmSync(pointer, { force: true });
        } catch {}
      }
    } catch (error) {
      process.stderr.write(`run-tests: warning: lane cleanup failed (${(error && error.message) || error})\n`);
    }
  }

  process.exit(exitCode);
}

// Only run when invoked directly, so that scripts/run-test-gates.mjs can import
// TEST_DIRS / discoverTestFiles to report the run's scope without executing it.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main();
}
