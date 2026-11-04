// Shared Node-suite fixture environment for run-tests.mjs and run-node-shard.mjs.
//
// WHY A SHARED MODULE. The CI node-shard jobs execute the same *.test.js files
// as the aggregate runner, and those suites require the identical environment:
// an isolated H2A_ROOT, the provisioned legacy host, the MH fixture archives,
// the frozen pack key and the Track temp dir. Duplicating that setup would let
// the two executors drift apart until a shard silently stops proving what the
// aggregate claims. One source of truth, imported by both.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureHistoricalGitRef, LEGACY_HOST_REF } from "./historical-test-ref.mjs";
import { SHARD_DIR_ENV } from "./ci-node-shards.mjs";

const LEGACY_HOST_ENTRY = join("packages", "h2a-runtime", "dist", "native-terminal", "process.js");

function startPackWarmer(root, env) {
  try {
    const child = spawn(process.execPath, [join(root, "scripts", "warm-pack-candidates.mjs")],
      { cwd: root, env, stdio: ["ignore", "inherit", "inherit"] });
    child.once("error", (error) => process.stderr.write(`node-suite-env: pack warmer: ${error.message}\n`));
    return child;
  } catch (error) {
    process.stderr.write(`node-suite-env: pack warmer could not start (${(error && error.message) || error}); suites pack privately\n`);
    return null;
  }
}

async function settlePackWarmer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolve) => child.once("close", resolve));
  const timeout = new Promise((resolve) => setTimeout(() => {
    try { child.kill("SIGKILL"); } catch {}
    resolve();
  }, 30_000));
  await Promise.race([closed, timeout]);
}

function transpilePackage(root, dir, pkg) {
  // Resolve the transpiler from the worktree, not from the provisioned
  // tree: its node_modules symlink is only created after transpiling.
  const ts = createRequire(join(root, "package.json"))("typescript");
  const base = join(dir, "packages", pkg, "src");
  const walk = (walkDir) => {
    for (const ent of readdirSync(walkDir, { withFileTypes: true })) {
      const path = join(walkDir, ent.name);
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

function provisionLegacyHostDir(root) {
  const preset = process.env.H2A_TEST_LEGACY_HOST_DIR;
  if (preset && existsSync(join(preset, LEGACY_HOST_ENTRY))) return { dir: preset, owned: false };
  ensureHistoricalGitRef(root, LEGACY_HOST_REF);
  const dir = mkdtempSync(join(tmpdir(), "h2a-legacy-host-"));
  const archive = spawnSync("git", ["archive", LEGACY_HOST_REF], { cwd: root, encoding: "buffer", maxBuffer: 200 * 1024 * 1024 });
  if (archive.status !== 0 || !archive.stdout) throw new Error(`node-suite-env: git archive ${LEGACY_HOST_REF} failed`);
  const extract = spawnSync("tar", ["-x", "-C", dir], { input: archive.stdout });
  if (extract.status !== 0) throw new Error(`node-suite-env: extracting ${LEGACY_HOST_REF} failed`);
  transpilePackage(root, dir, "h2a-runtime");
  if (!existsSync(join(dir, "node_modules"))) symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
  if (!existsSync(join(dir, LEGACY_HOST_ENTRY))) throw new Error(`node-suite-env: legacy host entry missing after provisioning ${LEGACY_HOST_REF}`);
  return { dir, owned: true };
}

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
  throw new Error(`node-suite-env: Track test temporary directory inherits a .track ancestor from ${parent}`);
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

/**
 * Provision the full Node-suite environment. Callers compute their own file
 * partitions before this (proof import needs the ambient CI report env) and
 * run their own suites after it with the returned envs.
 */
export async function setupNodeSuiteEnv(root) {
  // One frozen pack key for the whole run: the tree is fixed for this
  // invocation, so the warmer and every suite process must agree on the key
  // even while test outputs land mid-run (a live recomputation per process
  // repacks on volatile status). Dynamic import with a computed specifier so
  // the observation lab (which rewrites only static relative imports) stays
  // transparent: a missing helper simply leaves the key unset and every
  // consumer computes it live, exactly as before sharing.
  try {
    const packHelper = await import(pathToFileURL(join(root, 'packages', 'h2a', 'test', 'helpers', 'shared-pack-candidates.mjs')).href);
    const frozenPackKey = packHelper.cacheKey();
    if (typeof frozenPackKey === 'string' && /^[a-f0-9]{64}$/.test(frozenPackKey)) {
      process.env.H2A_SHARED_PACK_KEY = frozenPackKey;
    }
  } catch {
    // No frozen key: consumers fall back to live computation.
  }
  // Fire and forget here, reaped in teardownNodeSuiteEnv so no stray npm
  // grandchildren can contend with a later step.
  const packWarmer = startPackWarmer(root, process.env);

  // Defense-in-depth: create a throwaway temp dir for H2A_ROOT so that any test
  // that runs a writing verb (connect/register/mcp-serve) without --root AND with
  // H2A_ROOT unset writes to an isolated temp instead of the real shared bus.
  // Tests that pass --root explicitly override this; tests that set H2A_ROOT
  // themselves also override it within their own process.env assignments.
  // Runtime launch workspaces are intentionally rejected under OS-global /tmp.
  // Keep the process-wide OS temp semantics intact: tests rely on tmpdir() being
  // outside the repository for non-git and /tmp rejection coverage. Tests that
  // need a durable launch workspace opt into the dedicated repo-local root.
  const testScratch = join(root, "tmp", "test-runtime");
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
  const legacyHost = provisionLegacyHostDir(root);

  // Resolve npm's configured cache before HOME isolation, while its prepared
  // tarballs and any npmrc/environment override still have their original meaning.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const cache = spawnSync(npm, ['config', 'get', 'cache'], { cwd: root,
    env: process.env, encoding: 'utf8', shell: process.platform === 'win32' });
  if (cache.status !== 0 || !cache.stdout?.trim()) {
    throw new Error(`node-suite-env: cannot resolve the prepared npm cache: ${cache.stderr ?? cache.error ?? ''}`);
  }
  const testEnv = {
    ...process.env,
    npm_config_cache: resolve(root, cache.stdout.trim()),
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
  // Only the top-level orchestration imports companion proofs. Tests of the
  // runners create their own private checkouts and must exercise the default
  // full path. The shard directory is likewise an aggregate-consumer input,
  // never a shard-executor one: a shard inheriting it would observe its own
  // siblings instead of executing.
  delete testEnv.H2A_TEST_CI_M17_REPORT;
  delete testEnv.H2A_TEST_CI_BULK_REPORT;
  delete testEnv[SHARD_DIR_ENV];

  // These suites require the real pinned archives, never absent-state skips.
  // (The pack warmer and its frozen key started before this phase, so this
  // download already overlaps the pack.)
  const prepared = spawnSync(process.execPath, [join(root, "scripts/prepare-mh-test-fixtures.mjs")], {
    cwd: root, env: testEnv, encoding: "utf8", timeout: 600_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (prepared.status !== 0) throw new Error(`node-suite-env: MH fixtures failed: ${prepared.stderr ?? prepared.error}`);
  const mhFixtures = JSON.parse(prepared.stdout);
  Object.assign(testEnv, mhFixtures.env);

  // Track's no-store fixtures intentionally walk to the filesystem root.
  // Use the invocation's temporary parent, and reject any .track ancestor.
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

  return { testScratch, testRoot, durableRoot, legacyHost, mhFixtures, packWarmer, testEnv, trackFixtureEnv, trackTestEnv, trackTemp };
}

export async function teardownNodeSuiteEnv(ctx) {
  // Reap the pack warmer first: a still-packing warmer outliving this
  // runner would contend with a later step. Its lock is stale-takeover safe,
  // so killing it can never wedge a consumer.
  await settlePackWarmer(ctx.packWarmer);
  for (const root of ctx.mhFixtures.owned) rmSync(root, { recursive: true, force: true });
  // Best-effort cleanup of what this setup provisioned. A preset legacy dir
  // (owner-provided) is never ours to delete.
  try {
    if (ctx.legacyHost.owned) rmSync(ctx.legacyHost.dir, { recursive: true, force: true });
  } catch (error) {
    process.stderr.write(`node-suite-env: warning: legacy host cleanup failed (${(error && error.message) || error})\n`);
  }
  try {
    rmSync(ctx.testRoot, { recursive: true, force: true });
  } finally {
    rmSync(ctx.trackTemp, { recursive: true, force: true });
  }
}
