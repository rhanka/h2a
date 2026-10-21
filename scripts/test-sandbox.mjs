#!/usr/bin/env node
/**
 * Lot L0 — filesystem-barrier launcher for authorised test commands.
 *
 * Usage (from the repository root):
 *   node scripts/test-sandbox.mjs -- npx vitest run <file>
 *   node scripts/test-sandbox.mjs -- node --import ./packages/h2a/test/helpers/native-isolation.js --test <file>
 *
 * The launcher creates a private run root, writes a confinement attestation
 * tied to that root, and re-executes the command inside an OS filesystem
 * barrier (Linux: bubblewrap mount namespace; only the run root is
 * writable, the workspace is read-only). Non-Node descendants writing to
 * absolute owner paths hit a read-only filesystem instead of owner state.
 *
 * No barrier available on a platform => exit 3 (qualification-incomplete),
 * never an unconfined fallback. Bare direct runs keep failing at the
 * setup/preload gate; this launcher is the only authorised envelope.
 */
import { spawnSync } from "node:child_process";
import { closeSync, copyFileSync, cpSync, mkdtempSync, mkdirSync, openSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const QUALIFICATION_INCOMPLETE = 3;

function failIncomplete(message) {
  process.stderr.write(`test-sandbox: qualification-incomplete: ${message}\n`);
  process.exit(QUALIFICATION_INCOMPLETE);
}

const separator = process.argv.indexOf("--");
if (separator === -1 || separator === process.argv.length - 1) {
  process.stderr.write("test-sandbox: usage: node scripts/test-sandbox.mjs -- <command> [args...]\n");
  process.exit(2);
}
const command = process.argv.slice(separator + 1);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Owner /tmp rule: run roots live under the cache-tmp h2a-test area, never
// the real /tmp. TMPDIR follows the same root for this launcher's mkdtemp.
const base = join(homedir(), ".cache-tmp", "h2a-test");
try {
  mkdirSync(base, { recursive: true, mode: 0o700 });
} catch (error) {
  failIncomplete(`cannot create run-root base ${base}: ${error.message}`);
}
process.env.TMPDIR = join(base, `tmp-${process.pid}`);
try {
  mkdirSync(process.env.TMPDIR, { recursive: true, mode: 0o700 });
} catch (error) {
  failIncomplete(`cannot create TMPDIR: ${error.message}`);
}
const runRoot = mkdtempSync(join(base, "run-"));
for (const dir of ["home", "state", "config", "runtime", "tmp", "q", "reports"]) {
  mkdirSync(join(runRoot, dir), { recursive: true, mode: 0o700 });
}

const nonce = randomBytes(24).toString("hex");
const attestationPath = join(runRoot, ".h2a-test-attestation.json");
writeFileSync(
  attestationPath,
  JSON.stringify({ version: 1, root: runRoot, nonce, pid: process.pid }),
  { mode: 0o600 },
);

// Vite/vitest bundle their config and transform caches next to the repo
// (node_modules/.vite*), and execution-evidence labs scratch under the
// repo's gitignored tmp/. Pre-create those mount points in the workspace
// and overlay writable run-root dirs over them inside the barrier, so the
// read-only workspace stays untouched while runners keep working with
// repo-relative paths. Everything overlaid lives in the run root and is
// removed with it — confinement is preserved, not weakened.
const viteCacheBinds = [
  "node_modules/.vite-temp",
  "node_modules/.vite",
  "packages/h2a-runtime/node_modules/.vite-temp",
  "tmp",
];
for (const rel of viteCacheBinds) {
  try {
    mkdirSync(join(repoRoot, rel), { recursive: true, mode: 0o700 });
  } catch { /* best effort */ }
  try {
    mkdirSync(join(runRoot, "cache", rel), { recursive: true, mode: 0o700 });
  } catch { /* best effort */ }
}

// Round-3 (reviews pr382-r3): the gate builds inside the barrier (STEPS
// pins `npm run build` as the first gate step and the envelope mandates
// confinement — `npm run build` under the barrier failed EROFS on runners
// cleaning packages/track/dist). dist/ trees and tsc .tsbuildinfo sidecars
// are gitignored build outputs, never real state: overlay writable per-run
// shadows over them exactly like the caches above, so `clean + tsc -b`
// works confined while the checkout stays untouched. Nothing else in the
// workspace becomes writable — confinement is preserved, not weakened.
// Package names are enumerated, never hardcoded.
const buildOutputBinds = [];
for (const pkgDir of readdirSync(join(repoRoot, "packages"), { withFileTypes: true })) {
  if (!pkgDir.isDirectory()) continue;
  const repoDist = join(repoRoot, "packages", pkgDir.name, "dist");
  const shadowDist = join(runRoot, "dist-shadow", pkgDir.name);
  try {
    mkdirSync(repoDist, { recursive: true, mode: 0o700 });
  } catch { /* best effort */ }
  try {
    mkdirSync(shadowDist, { recursive: true, mode: 0o700 });
  } catch { /* best effort */ }
  // Pre-populate the shadow with the checkout's build output: tests import
  // compiled dist, so an empty shadow would hide it. The gate rebuilds
  // inside anyway (STEPS pins the build first); direct vitest runs reuse a
  // fresh checkout build. Stale inputs rebuild — tsc validates buildinfo.
  try {
    cpSync(repoDist, shadowDist, { recursive: true });
  } catch { /* best effort */ }
  buildOutputBinds.push("--bind", shadowDist, repoDist);
  // tsc -b records buildinfo next to the project; copy the checkout's so
  // incremental builds keep working, falling back to an empty file (sound
  // full rebuild — tsc treats it as no info).
  const repoInfo = join(repoRoot, "packages", pkgDir.name, "tsconfig.tsbuildinfo");
  const shadowInfo = join(runRoot, "dist-shadow", `${pkgDir.name}.tsbuildinfo`);
  try {
    copyFileSync(repoInfo, shadowInfo);
  } catch {
    try {
      const handle = openSync(shadowInfo, "a", 0o600);
      closeSync(handle);
    } catch { /* best effort */ }
  }
  try {
    const handle = openSync(repoInfo, "a", 0o600);
    closeSync(handle);
  } catch { /* best effort */ }
  buildOutputBinds.push("--bind", shadowInfo, repoInfo);
}

// Round-3 CI repair: per-package `.test-scratch` overlays. Test suites
// scratch under `<package>/.test-scratch/<suite>` (a checkout-relative
// idiom that predates the barrier); inside the barrier the checkout is
// read-only, so every `mkdirSync(SCRATCH_ROOT, {recursive:true})` failed
// and ~300 tests reddened on runners (locally masked wherever the dir
// already existed). Like `tmp/` and `dist/` above, the launcher pre-creates
// the checkout mount point (gitignored) and binds a fresh per-run shadow
// over it: writes land in the run root (removed with it), the checkout
// stays untouched, and parallel workers keep sharing one scratch root as
// before. Shadows are NOT pre-populated (scratch starts empty by contract);
// no suite reads committed fixtures from `.test-scratch`.
const scratchBinds = [];
// Checkout-relative scratch idioms predating the barrier, as
// (package-subdir, dirname) pairs: `src/*.test.ts` suites scratch next to
// the test file (`src/.cfg-test`, `src/.auth-test`), the rest one level up
// (`<pkg>/.test-scratch/<suite>`). Empty mount points are git-invisible;
// the .gitignore entries cover crash residue.
const scratchLocs = [["", ".test-scratch"], ["src", ".cfg-test"], ["src", ".auth-test"], ["src", ".stack-test"]];
for (const pkgDir of readdirSync(join(repoRoot, "packages"), { withFileTypes: true })) {
  if (!pkgDir.isDirectory()) continue;
  for (const [subdir, scratchName] of scratchLocs) {
    // Never invent a package subdir that is not there (no `src/` in
    // packages that have none): a missing bind target would fail bwrap.
    try {
      readdirSync(join(repoRoot, "packages", pkgDir.name, subdir));
    } catch {
      continue;
    }
    const repoScratch = join(repoRoot, "packages", pkgDir.name, subdir, scratchName);
    const shadowScratch = join(runRoot, "scratch-shadow", `${pkgDir.name}-${subdir || "pkg"}${scratchName}`);
    try {
      mkdirSync(repoScratch, { recursive: true, mode: 0o700 });
    } catch { /* best effort */ }
    try {
      mkdirSync(shadowScratch, { recursive: true, mode: 0o700 });
    } catch { /* best effort */ }
    // Pre-populate the shadow with the checkout's committed fixtures: some
    // suites READ committed files under these roots (forward-*, sync-b1,
    // workspace-merge, …), so an empty shadow would hide them. Writes still
    // land in the shadow (the checkout stays untouched); tests that need a
    // fresh dir mkdtemp their own subdir as before.
    try {
      cpSync(repoScratch, shadowScratch, { recursive: true });
    } catch { /* best effort */ }
    scratchBinds.push("--bind", shadowScratch, repoScratch);
  }
}

// Declared overlay mapping for the in-barrier path guards (runtime
// test-state-guard.ts + the JS isolation helper): a checkout path under a
// listed `path` is physically backed by `shadow` (inside the run root), so
// guards translate before enforcing "inside the marked root". Entries are
// honored only with the barrier active and only when the shadow resolves
// inside the asserted root — a mapping can only redirect INTO confinement.
const overlayEntries = [];
for (let i = 0; i < scratchBinds.length; i += 3) {
  overlayEntries.push({ path: scratchBinds[i + 2], shadow: scratchBinds[i + 1] });
}

// Offline distribution fixtures (focus-kit distribution-increments) copy
// locked registry tarballs OUT of the ambient npm cache: they expect the
// workflow-warmed cache (`npm ci` runs before tests, HOME is the real home
// there). Inside the barrier HOME is the run root, so the cache would read
// cold. Hardlink-seed the run-root cache from the real one (best effort):
// reads resolve instantly with ~zero disk, npm writes land on fresh inodes
// in the shadow (cacache never mutates content in place), and the real
// cache is never written. A missing/foreign seed reads cold, as today.
try {
  const realCache = join(homedir(), ".npm", "_cacache");
  readdirSync(realCache);
  const seedCache = join(runRoot, "home", ".npm", "_cacache");
  mkdirSync(seedCache, { recursive: true, mode: 0o700 });
  const linkCopy = spawnSync("cp", ["-al", `${realCache}/.`, seedCache], { encoding: "utf8" });
  if (linkCopy.status !== 0) throw new Error(linkCopy.stderr || "cp -al failed");
} catch { /* best effort: cold cache, today's behaviour */ }

const childEnv = {
  ...process.env,
  TMPDIR: join(runRoot, "tmp"),
  HOME: join(runRoot, "home"),
  XDG_STATE_HOME: join(runRoot, "state"),
  XDG_CONFIG_HOME: join(runRoot, "config"),
  XDG_RUNTIME_DIR: join(runRoot, "runtime"),
  REMOTE_CLI_CONFIG_HOME: join(runRoot, "config"),
  H2A_ROOT: join(runRoot, "store"),
  H2A_TEST_STATE_ROOT: runRoot,
  H2A_TEST_STATE_ATTESTATION: attestationPath,
  H2A_TEST_STATE_BARRIER: "1",
  H2A_TEST_STATE_OVERLAYS: JSON.stringify(overlayEntries),
  // Offline distribution fixtures resolve locked tarballs from
  // `npm_config_cache ?? HOME/.npm`; the worker HOME varies per fixture,
  // so pin the cache to the seeded run-root copy (warm when the seed
  // succeeded, cold-but-writable otherwise — never the real home).
  npm_config_cache: join(runRoot, "home", ".npm"),
  // Browser fixtures launch Playwright from the workflow-installed browsers
  // (default ~/.cache/ms-playwright). Inside the barrier HOME is the run
  // root, so the launch would read an empty path. Point Playwright at the
  // real install when it exists (binaries are read-only at launch; profiles
  // and dumps go to tmp). Absent install: unset, today's error stands.
  ...(() => {
    try {
      const browsers = join(homedir(), ".cache", "ms-playwright");
      readdirSync(browsers);
      return { PLAYWRIGHT_BROWSERS_PATH: browsers };
    } catch {
      return {};
    }
  })(),
  // String-only owner-home reference for negative-control assertions
  // (assert a resolved path is NOT under it). Never read or written.
  H2A_TEST_OWNER_HOME: homedir(),
  H2A_TEST_REPORT_PATH: join(runRoot, "reports", "vitest-report.json"),
};

function cleanup() {
  try {
    rmSync(process.env.TMPDIR, { recursive: true, force: true });
  } catch { /* best effort */ }
  try {
    rmSync(runRoot, { recursive: true, force: true });
  } catch { /* best effort */ }
}

let result;
if (process.platform === "linux") {
  const probe = spawnSync("bwrap", ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    cleanup();
    failIncomplete("bubblewrap (bwrap) is unavailable on this Linux machine");
  }
  const viteBindArgs = viteCacheBinds.flatMap((rel) => ["--bind", join(runRoot, "cache", rel), join(repoRoot, rel)]);
  const distBindArgs = buildOutputBinds.slice();
  result = spawnSync(
    "bwrap",
    [
      // Round-2 (code-review astra-7/sol-5): explicit namespaces WITHOUT a
      // private network namespace. The L0 barrier is a filesystem + process
      // barrier (D16: private mount namespace, only the run root writable,
      // the workspace read-only) — it never required net isolation, and
      // creating a net namespace forces a loopback setup (`RTM_NEWADDR`)
      // the CI runners refuse (`Operation not permitted`), failing every
      // suite before its first test. Sharing the host network keeps host
      // loopback usable for the TCP-loopback tests (central-mcp and
      // friends bind 127.0.0.1); confinement of writes is unchanged.
      "--unshare-user",
      "--unshare-pid",
      "--unshare-uts",
      "--unshare-ipc",
      "--unshare-cgroup",
      "--die-with-parent",
      "--ro-bind", "/", "/",
      "--dev", "/dev",
      "--proc", "/proc",
      // Round-1 (astra-9): a PRIVATE /tmp inside the namespace. The host
      // /tmp stays untouched (never written), while the sandbox gets a
      // writable X11 space (/tmp/.X11-unix + the X lock files Xvfb needs) —
      // the VTE qualification harness no longer skips for an unwritable
      // /tmp. Tests that must write use TMPDIR (bound run-root tmp/).
      "--tmpfs", "/tmp",
      "--bind", runRoot, runRoot,
      ...viteBindArgs,
      ...distBindArgs,
      ...scratchBinds,
      "--chdir", repoRoot,
      "--", ...command,
    ],
    { env: childEnv, stdio: "inherit" },
  );
} else if (process.platform === "darwin") {
  const probe = spawnSync("sandbox-exec", ["-h"], { encoding: "utf8" });
  if (probe.status !== 0 && probe.status !== 64) {
    cleanup();
    failIncomplete("sandbox-exec is unavailable on this macOS machine");
  }
  const profile = `(version 1)(deny default)(allow process-exec)(allow sysctl-read)(allow mach-lookup)(allow file-read*)(allow file-write* (subpath "${runRoot}"))`;
  result = spawnSync(
    "sandbox-exec",
    ["-p", profile, ...command],
    { env: childEnv, stdio: "inherit", cwd: repoRoot },
  );
} else {
  cleanup();
  failIncomplete(`no filesystem-barrier tool for platform ${process.platform}`);
}

const reportNote = `test-sandbox: run root ${runRoot} removed; reports (if any) were under its reports/ dir during the run\n`;
if (result.error) {
  cleanup();
  process.stderr.write(`test-sandbox: barrier spawn failed: ${result.error.message}\n`);
  process.exit(1);
}
// Artifact exchange: the run root is deleted below, so a workflow step that
// must collect files after the run (e.g. a CI artifact upload) designates
// an exchange dir via FOCUS_METRICS_OUT (ephemeral CI temp, never owner
// state). Publish `<tmp>/**/metrics.json` there as `<out>/<parent>/metrics.json`
// BEFORE cleanup. Tests stay fully confined (they only ever write the run
// root); publication is the authorized launcher's act. Best effort: a
// missing/empty exchange never fails the run.
if (process.env.FOCUS_METRICS_OUT) {
  try {
    const out = process.env.FOCUS_METRICS_OUT;
    const walk = (dir, depth) => {
      if (depth > 4) return [];
      let found = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) found = found.concat(walk(full, depth + 1));
        else if (entry.isFile() && entry.name === "metrics.json") found.push(full);
      }
      return found;
    };
    // The run-root tmp AND every worker tmp: fixture environments redirect
    // TMPDIR to their worker root (`w-*/tmp`), so metrics may land there.
    const roots = [join(runRoot, "tmp")];
    for (const entry of readdirSync(runRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("w-")) roots.push(join(runRoot, entry.name, "tmp"));
    }
    for (const rootDir of roots) {
      for (const file of walk(rootDir, 0)) {
        const destDir = join(out, file.split("/").at(-2) ?? "metrics");
        mkdirSync(destDir, { recursive: true, mode: 0o700 });
        copyFileSync(file, join(destDir, "metrics.json"));
      }
    }
  } catch { /* best effort */ }
}
cleanup();
if (result.status === 0) process.stdout.write(reportNote);
process.exit(result.status ?? 1);
