#!/usr/bin/env node
import { loadM17Partition } from "./m17-ci-evidence.mjs";
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
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { verifyCleanseContracts } from "./cleanse-contract-ledger.mjs";

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
import { ensureHistoricalGitRef, LEGACY_HOST_REF } from "./historical-test-ref.mjs";
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

function main() {
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

  // CI may supply only the closed M17 shard proof from this exact workflow
  // run/attempt/checkout/Node. Discovery above remains complete. The default
  // invocation executes M17 locally; malformed explicit proof is a hard error.
  const m17Partition = loadM17Partition(nodeTestFiles, REPO_ROOT);
  if (m17Partition.report) process.stdout.write(`M17 companion proof validated: ${JSON.stringify({
    file: 'packages/h2a/test/mh-l5-concurrency.test.js', checkout: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, node: process.version,
    source: process.env.H2A_TEST_CI_M17_REPORT,
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

  // Defense-in-depth: create a throwaway temp dir for H2A_ROOT so that any test
  // that runs a writing verb (connect/register/mcp-serve) without --root AND with
  // H2A_ROOT unset writes to an isolated temp instead of the real shared bus.
  // Tests that pass --root explicitly override this; tests that set H2A_ROOT
  // themselves also override it within their own process.env assignments.
  // Runtime launch workspaces are intentionally rejected under OS-global /tmp.
  // Keep the process-wide OS temp semantics intact: tests rely on tmpdir() being
  // outside the repository for non-git and /tmp rejection coverage. Tests that
  // need a durable launch workspace opt into the dedicated repo-local root.
  const testScratch = join(REPO_ROOT, "tmp", "test-runtime");
  mkdirSync(testScratch, { recursive: true });
  const testRoot = mkdtempSync(join(testScratch, "h2a-test-root-"));
  const durableRoot = join(testRoot, "durable");
  mkdirSync(durableRoot, { recursive: true });

  mkdirSync(join(testRoot, "home"), { recursive: true });
  mkdirSync(join(testRoot, "run"), { mode: 0o700 });
  mkdirSync(join(testRoot, "cache"), { mode: 0o700 });
  mkdirSync(join(testRoot, "data"), { mode: 0o700 });

  // Historical PTY host the pre-upgrade suites qualify against. The inventory
  // REQUIRES native-inventory-absence's legacy test passed, and the
  // native-host-generations suites run (instead of skipping) once this build
  // exists — so the runner provisions it instead of letting the suites skip.
  // Transpile-only, no typecheck, no install: the same trick as the identity
  // lane's compile(), with the worktree's node_modules symlinked so the
  // legacy host loads the current native bindings (node-pty).
  const LEGACY_HOST_ENTRY = join("packages", "h2a-runtime", "dist", "native-terminal", "process.js");
  function transpilePackage(root, pkg) {
    // Resolve the transpiler from the worktree, not from the provisioned
    // tree: its node_modules symlink is only created after transpiling.
    const ts = createRequire(join(REPO_ROOT, "package.json"))("typescript");
    const base = join(root, "packages", pkg, "src");
    const walk = (dir) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, ent.name);
        if (ent.isDirectory()) walk(path);
        else {
          const dest = path.replace("/src/", "/dist/").replace(/\.ts$/, ".js");
          mkdirSync(resolve(dest, ".."), { recursive: true });
          if (ent.name.endsWith(".d.ts")) continue;
          const src = readFileSync(path);
          writeFileSync(dest, ent.name.endsWith(".ts") ? ts.transpileModule(src.toString(), {
            compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
          }).outputText : src);
        }
      }
    };
    walk(base);
  }
  function provisionLegacyHostDir() {
    const preset = process.env.H2A_TEST_LEGACY_HOST_DIR;
    if (preset && existsSync(join(preset, LEGACY_HOST_ENTRY))) return { dir: preset, owned: false };
    ensureHistoricalGitRef(REPO_ROOT, LEGACY_HOST_REF);
    const dir = mkdtempSync(join(tmpdir(), "h2a-legacy-host-"));
    const archive = spawnSync("git", ["archive", LEGACY_HOST_REF], { cwd: REPO_ROOT, encoding: "buffer", maxBuffer: 200 * 1024 * 1024 });
    if (archive.status !== 0 || !archive.stdout) throw new Error(`run-tests: git archive ${LEGACY_HOST_REF} failed`);
    const extract = spawnSync("tar", ["-x", "-C", dir], { input: archive.stdout });
    if (extract.status !== 0) throw new Error(`run-tests: extracting ${LEGACY_HOST_REF} failed`);
    transpilePackage(dir, "h2a-runtime");
    if (!existsSync(join(dir, "node_modules"))) symlinkSync(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"));
    if (!existsSync(join(dir, LEGACY_HOST_ENTRY))) throw new Error(`run-tests: legacy host entry missing after provisioning ${LEGACY_HOST_REF}`);
    return { dir, owned: true };
  }
  const legacyHost = provisionLegacyHostDir();

  // Resolve npm's configured cache before HOME isolation, while its prepared
  // tarballs and any npmrc/environment override still have their original meaning.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const cache = spawnSync(npm, ['config', 'get', 'cache'], { cwd: REPO_ROOT,
    env: process.env, encoding: 'utf8', shell: process.platform === 'win32' });
  if (cache.status !== 0 || !cache.stdout?.trim()) {
    throw new Error(`run-tests: cannot resolve the prepared npm cache: ${cache.stderr ?? cache.error ?? ''}`);
  }
  const testEnv = {
    ...process.env,
    npm_config_cache: resolve(REPO_ROOT, cache.stdout.trim()),
    HOME: join(testRoot, "home"),
    XDG_RUNTIME_DIR: join(testRoot, "run"),
    XDG_CONFIG_HOME: join(testRoot, "home/.config"),
    XDG_STATE_HOME: join(testRoot, "home/.local/state"),
    XDG_CACHE_HOME: join(testRoot, "cache"),
    XDG_DATA_HOME: join(testRoot, "data"),
    H2A_ROOT: join(testRoot, ".h2a"),
    H2A_TEST_DURABLE_ROOT: durableRoot,
    H2A_TEST_LEGACY_HOST_DIR: legacyHost.dir,
    // Opt-in gates that are cheap and deterministic here: the full-stack
    // example (~1s) and the lock-stress race (~30s). Running them keeps the
    // execution proof complete instead of declaring `skipped`.
    H2A_RUN_EXAMPLE: "1",
    H2A_LOCK_STRESS: "1"
  };
  // Only this orchestration imports the companion proof. Tests of the runner
  // create their own private checkouts and must exercise the default full path.
  delete testEnv.H2A_TEST_CI_M17_REPORT;

  // These suites require the real pinned archives, never absent-state skips.
  const prepared = spawnSync(process.execPath, [join(REPO_ROOT, "scripts/prepare-mh-test-fixtures.mjs")], {
    cwd: REPO_ROOT, env: testEnv, encoding: "utf8", timeout: 600_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (prepared.status !== 0) throw new Error(`run-tests: MH fixtures failed: ${prepared.stderr ?? prepared.error}`);
  const mhFixtures = JSON.parse(prepared.stdout);
  Object.assign(testEnv, mhFixtures.env);

  // Track's no-store fixtures intentionally walk to the filesystem root.
  // Use the invocation's temporary parent, and reject any .track ancestor.
  function hasTrackAncestor(dir) {
    let current = resolve(dir);
    for (;;) {
      if (existsSync(join(current, ".track"))) return true;
      const parent = dirname(current);
      if (parent === current) return false;
      current = parent;
    }
  }

  function makeCleanTrackTempDir(parent) {
    const dir = mkdtempSync(join(parent, "h2a-track-tests-"));
    if (!hasTrackAncestor(dir)) return dir;
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`run-tests: Track test temporary directory inherits a .track ancestor from ${parent}`);
  }

  function makeTrackTempDir() {
    const fallback = tmpdir();
    const parents = [fallback];
    let lastError;
    for (const parent of parents) {
      try {
        return makeCleanTrackTempDir(parent);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  const trackTemp = makeTrackTempDir();
  const trackFixtureEnv = {
    ...testEnv,
    H2A_TEST_TRACK_TMPDIR: trackTemp
  };
  const trackTestEnv = {
    ...trackFixtureEnv,
    TMPDIR: trackTemp,
    TMP: trackTemp,
    TEMP: trackTemp
  };

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

  const nodeReport = join(testRoot, "node.json");
  const trackReport = join(testRoot, "track.json");
  // One JSON evidence report per Vitest suite: every suite uses the same
  // `--reporter=json --outputFile`, so sharing a single path would let the
  // second suite overwrite the first one's evidence unnoticed.
  const vitestReportFor = (suite) => join(testRoot, `${suite.name.toLowerCase()}.json`);
  // Lane pointer before this run (see cleanup in finally): the lane helper
  // overwrites tmp/idlock-build2-lane.txt on every full run.
  let lanePointerBefore = null;
  try { lanePointerBefore = readFileSync(join(REPO_ROOT, "tmp", "idlock-build2-lane.txt"), "utf8"); } catch {}
  let exitCode = 0;
  try {
    const nodeStatus = runSuite("Node test suite", process.execPath,
      [join(REPO_ROOT, "scripts/run-node-tests.mjs"), "--test", "--test-reporter=spec", `--test-reporter=${join(REPO_ROOT, "scripts/node-evidence-reporter.mjs")}`, "--test-reporter-destination=stdout", `--test-reporter-destination=${nodeReport}`, ...m17Partition.local],
      REPO_ROOT, trackFixtureEnv, NODE_TIMEOUT_MS);
    const vitestStatuses = vitestSuites.map((suite) => {
      const cwd = join(REPO_ROOT, suite.dir);
      const configArgs = suite.config === undefined ? [] : ["--config", suite.config];
      const status = runSuite(
        `${suite.name} Vitest suite`,
        process.execPath,
        [vitestEntrypoint(cwd), "run", ...configArgs, "--reporter=default", "--reporter=json", `--outputFile=${vitestReportFor(suite)}`, ...suite.files.map((file) => join(suite.testDir ?? "src", file))],
        cwd,
        trackTestEnv,
      );
      try {
        reportSuiteDurations(JSON.parse(readFileSync(vitestReportFor(suite), "utf8")), { label: suite.name });
      } catch {
        process.stderr.write(`WARNING: ${suite.name}: suite timing unavailable (missing or malformed report).\n`);
      }
      return status;
    });
    // Lane-scoped identity-lock suites (LANE_TEST_FILES): the isolated lane
    // they require exists only inside identity-isolated-run.mjs, which builds
    // it (previous-release bindings + lane TMPDIR) and runs exactly these
    // files under the lane guard. Gated on exit status like the Vitest suites.
    const laneStatus = runSuite("Identity lane suite", process.execPath,
      [join(REPO_ROOT, "packages/h2a/test/helpers/identity-isolated-run.mjs"), ...LANE_TEST_FILES],
      REPO_ROOT, trackFixtureEnv);
    let reports;
    try { reports = [nodeReport, trackReport].map((path) => JSON.parse(readFileSync(path, "utf8"))); }
    catch { reports = []; }
    const localReportCount = reports.length;
    if (m17Partition.report) reports.push(m17Partition.report);
    const required = listNodeTrackSuiteFiles();
    const combined = {
      success: localReportCount === 2 && reports.every((report) => report.success !== false),
      testResults: reports.flatMap((report) => report.testResults ?? []),
      ...Object.fromEntries(["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests"]
        .map((key) => [key, reports.reduce((sum, report) => sum + report[key], 0)])),
    };
    const holes = verifyNodeTrackExecution(combined, required);
    if (!holes.length && m17Partition.report) process.stdout.write('M17 local/external exhaustive inventory verification: passed\n');
    if (holes.length) process.stderr.write(holes.join("\n") + "\n");
    else process.stdout.write(`RC 0.98.6: ${readDeclaredNonTests(REPO_ROOT).length} declared non-tests observed at their exact expected statuses; not claimed as coverage.\n`);
    const reportPath = process.env.H2A_TEST_REPORT_PATH ?? NODE_TRACK_EXECUTION_REPORT;
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(combined));
    exitCode = holes.length ? 1 : [nodeStatus, ...vitestStatuses, laneStatus].every((status) => status === 0) ? 0 : Math.max(nodeStatus, ...vitestStatuses, laneStatus);
  } finally {
    for (const root of mhFixtures.owned) rmSync(root, { recursive: true, force: true });
    // Best-effort cleanup of what this run provisioned. A preset legacy dir
    // (owner-provided) is never ours to delete. The lane helper records the
    // lane it built in tmp/idlock-build2-lane.txt: remove that lane — and the
    // pointer, when it still names it — so OS tmp does not accumulate one lane
    // per run. Cleanup warnings never mask the suite verdict.
    try {
      if (legacyHost.owned) rmSync(legacyHost.dir, { recursive: true, force: true });
    } catch (error) {
      process.stderr.write(`run-tests: warning: legacy host cleanup failed (${(error && error.message) || error})\n`);
    }
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
    try {
      rmSync(testRoot, { recursive: true, force: true });
    } finally {
      rmSync(trackTemp, { recursive: true, force: true });
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
