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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
cleanup();
if (result.status === 0) process.stdout.write(reportNote);
process.exit(result.status ?? 1);
