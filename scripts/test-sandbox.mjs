#!/usr/bin/env node
/**
 * Lot L0 (D16) — filesystem-barrier launcher for authorised test commands.
 *
 * Usage (from repository root):
 *   node scripts/test-sandbox.mjs -- <command> [args...]
 *   node scripts/test-sandbox.mjs --prepare-ci
 *
 * Exit codes:
 *   0   — confined command succeeded (and any role-scoped host export succeeded)
 *   2   — invalid CLI usage
 *   3   — qualification-incomplete (OS barrier unavailable or unverifiable)
 *   1/+ — command failure, signal, or CI proof exchange contract violation
 *
 * Pure Node stdlib only (no external packages, runnable before build or npm ci).
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  copyFileSync,
  cpSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CI_IMPORT_ENV_VARS,
  COMPAT_TMP_TARGET,
  QUALIFICATION_INCOMPLETE_EXIT,
  SANDBOX_MOUNT_ROOT,
  SANDBOX_RECEIPT_PATH,
  SANDBOX_RO_WITNESS_PATH,
  SANDBOX_USAGE_EXIT,
  TEST_OWNER_HOME_ENV,
  TEST_SANDBOX_NONCE_ENV,
  TEST_STATE_BARRIER_ENV,
  TEST_STATE_QUALIFICATION_ROOT_ENV,
  TEST_STATE_RECEIPT_ENV,
  TEST_STATE_ROOT_ENV,
  TEST_STATE_STAGE_ROOT_ENV,
  detectSandboxRole,
  isWithinDirectory,
  parseMountInfo,
} from "./test-sandbox-contract.mjs";
import {
  IDENTITY_BASE_REF,
  L0_HERITAGE_REF,
  LEGACY_HOST_REF,
  ensureHistoricalGitRef,
} from "./historical-test-ref.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const MAX_EXCHANGE_FILE_BYTES = 32 * 1024 * 1024;
const TMPFS_MAGIC = 0x01021994;

const STRIPPED_ENV_KEYS = new Set([
  "GITHUB_ENV",
  "GITHUB_PATH",
  "GITHUB_OUTPUT",
  "GITHUB_STATE",
  "GITHUB_STEP_SUMMARY",
  "ACTIONS_RUNTIME_TOKEN",
  "ACTIONS_RUNTIME_URL",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_URL",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "NODE_OPTIONS",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
]);

function failIncomplete(message) {
  process.stderr.write(`test-sandbox: qualification-incomplete: ${message}\n`);
  process.exit(QUALIFICATION_INCOMPLETE_EXIT);
}

function failContract(message) {
  process.stderr.write(`test-sandbox: contract error: ${message}\n`);
  process.exit(1);
}

function isDisposableGitHubVm(env = process.env) {
  return env.GITHUB_ACTIONS === "true" && env.RUNNER_ENVIRONMENT === "github-hosted";
}

function assertNoSymlinkAncestors(dirPath) {
  const abs = resolve(dirPath);
  const parts = abs.split("/").filter(Boolean);
  let cur = "/";
  for (const part of parts) {
    cur = join(cur, part);
    const st = lstatSync(cur);
    if (st.isSymbolicLink()) {
      throw new Error(`symlinked ancestor forbidden: ${cur}`);
    }
  }
}

function isGlobalTmp(dirPath) {
  const norm = resolve(dirPath);
  return norm === "/tmp" || norm.startsWith("/tmp/") || norm === "/var/tmp" || norm.startsWith("/var/tmp/");
}

function selectHostTempBase(env = process.env) {
  const candidates = [];
  if (env.GITHUB_ACTIONS === "true" && env.RUNNER_TEMP) {
    candidates.push(env.RUNNER_TEMP);
  }
  if (env[TEST_STATE_STAGE_ROOT_ENV]) {
    candidates.push(env[TEST_STATE_STAGE_ROOT_ENV]);
  }
  if (env.TMPDIR && !isGlobalTmp(env.TMPDIR)) {
    candidates.push(env.TMPDIR);
  }
  candidates.push(join(homedir(), ".cache-tmp", "h2a-test"));

  for (const candidate of candidates) {
    const abs = resolve(candidate);
    if (isGlobalTmp(abs)) continue;
    try {
      mkdirSync(abs, { recursive: true, mode: 0o700 });
      assertNoSymlinkAncestors(abs);
      const st = lstatSync(abs);
      if (!st.isDirectory() || st.isSymbolicLink()) continue;
      if (typeof process.getuid === "function" && st.uid !== process.getuid()) continue;
      return abs;
    } catch {
      continue;
    }
  }
  failIncomplete("cannot establish private non-global host temp directory");
}

function probeBwrapNamespace({ unshareNet = false, probeDir }) {
  const witness = join(probeDir, "probe-ro");
  rmSync(witness, { force: true });
  writeFileSync(witness, "ro\n", { mode: 0o644 });
  const rwDir = join(probeDir, "probe-rw");
  mkdirSync(rwDir, { recursive: true, mode: 0o700 });

  const args = [
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-cgroup",
    ...(unshareNet ? ["--unshare-net"] : []),
    "--die-with-parent",
    "--ro-bind", "/", "/",
    "--dev", "/dev",
    "--proc", "/proc",
    "--tmpfs", "/run",
    "--dir", "/run/h2a-test",
    "--bind", rwDir, "/run/h2a-test/r",
    "--ro-bind", witness, "/run/h2a-test/ro-witness",
    "--",
    process.execPath,
    "-e",
    `
      const fs = require('node:fs');
      const net = require('node:net');
      try { fs.openSync('/run/h2a-test/ro-witness', fs.constants.O_WRONLY); process.exit(41); }
      catch (e) { if (e.code !== 'EROFS') process.exit(42); }
      const p = '/run/h2a-test/r/.probe-' + process.pid;
      const fd = fs.openSync(p, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
      fs.closeSync(fd);
      fs.unlinkSync(p);
      if (${JSON.stringify(unshareNet)}) {
        const s = net.createServer();
        s.on('error', () => process.exit(43));
        s.listen(0, '127.0.0.1', () => {
          const { port } = s.address();
          const c = net.connect(port, '127.0.0.1', () => { c.destroy(); s.close(() => process.exit(0)); });
          c.on('error', () => process.exit(44));
        });
      } else {
        process.exit(0);
      }
    `,
  ];
  const res = spawnSync("bwrap", args, { encoding: "utf8", timeout: 15_000 });
  return {
    ok: !res.error && res.status === 0,
    status: res.status,
    stderr: (res.stderr ?? "").trim(),
    error: res.error?.message ?? null,
  };
}

function runPrepareCi() {
  if (process.platform !== "linux" || !isDisposableGitHubVm(process.env)) {
    failIncomplete("--prepare-ci is restricted to disposable Linux GitHub-hosted runners");
  }
  const base = selectHostTempBase(process.env);
  const probeDir = mkdtempSync(join(base, "prepare-probe-"));
  try {
    // 1. Short probe first: if bwrap already works, install nothing.
    const initial = probeBwrapNamespace({ unshareNet: false, probeDir });
    if (initial.ok) {
      process.stdout.write("test-sandbox: --prepare-ci: bubblewrap barrier already verified\n");
      process.exit(0);
    }

    // 2. Install bubblewrap and uidmap if absent (bounded lock wait + retries).
    const hasBwrap = spawnSync("which", ["bwrap"], { encoding: "utf8" }).status === 0;
    const hasNewuidmap = spawnSync("which", ["newuidmap"], { encoding: "utf8" }).status === 0;
    if (!hasBwrap || !hasNewuidmap) {
      let installed = false;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const upd = spawnSync(
          "sudo",
          ["apt-get", "-o", "DPkg::Lock::Timeout=120", "update", "-qq"],
          { stdio: "inherit", timeout: 180_000 },
        );
        if (upd.status !== 0) continue;
        const inst = spawnSync(
          "sudo",
          [
            "env",
            "DEBIAN_FRONTEND=noninteractive",
            "apt-get",
            "-o",
            "DPkg::Lock::Timeout=120",
            "install",
            "-y",
            "--no-install-recommends",
            "bubblewrap",
            "uidmap",
          ],
          { stdio: "inherit", timeout: 240_000 },
        );
        if (inst.status === 0) {
          installed = true;
          break;
        }
      }
      if (!installed) {
        failIncomplete("failed to install bubblewrap and uidmap via apt-get");
      }
    }

    // 3. Re-probe after package install.
    const afterInstall = probeBwrapNamespace({ unshareNet: false, probeDir });
    if (afterInstall.ok) {
      process.stdout.write("test-sandbox: --prepare-ci: bubblewrap barrier verified after install\n");
      process.exit(0);
    }

    // 4. On Ubuntu with kernel.apparmor_restrict_unprivileged_userns=1, install
    //    a scoped AppArmor profile for /usr/bin/bwrap ONLY (never relax global sysctl).
    let restricted = false;
    try {
      restricted = readFileSync("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "utf8").trim() === "1";
    } catch { /* ignore */ }
    if (restricted) {
      const profile = [
        "abi <abi/4.0>,",
        "include <tunables/global>",
        "",
        "profile bwrap /usr/bin/bwrap flags=(unconfined) {",
        "  userns,",
        "  include if exists <local/bwrap>",
        "}",
        "",
      ].join("\n");
      const profileTmp = join(probeDir, "bwrap.apparmor");
      writeFileSync(profileTmp, profile, { mode: 0o644 });
      spawnSync("sudo", ["install", "-m", "0644", profileTmp, "/etc/apparmor.d/bwrap"], {
        stdio: "inherit",
        timeout: 30_000,
      });
      spawnSync("sudo", ["apparmor_parser", "-r", "/etc/apparmor.d/bwrap"], {
        stdio: "inherit",
        timeout: 30_000,
      });
    }

    // 5. Final mandatory verification probe.
    const finalProbe = probeBwrapNamespace({ unshareNet: false, probeDir });
    if (!finalProbe.ok) {
      failIncomplete(
        `bubblewrap namespace probe failed after preparation: ${finalProbe.stderr || finalProbe.error || `exit ${finalProbe.status}`}`,
      );
    }
    process.stdout.write("test-sandbox: --prepare-ci: bubblewrap barrier verified\n");
    process.exit(0);
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

/**
 * Safely read a regular file without following symlinks, verifying ownership,
 * single hardlink, and size cap (32 MiB) via fstat on the open descriptor.
 */
function readRegularExchangeFile(filePath, expectedDir) {
  assertNoSymlinkAncestors(dirname(filePath));
  const abs = resolve(filePath);
  if (expectedDir) {
    assert.ok(isWithinDirectory(abs, expectedDir), `exchange path escapes expected dir: ${filePath}`);
  }
  const lst = lstatSync(abs);
  assert.ok(lst.isFile() && !lst.isSymbolicLink(), `exchange file must be regular: ${filePath}`);
  const fd = openSync(abs, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    assert.ok(st.isFile(), `exchange fd is not a regular file: ${filePath}`);
    assert.equal(st.nlink, 1, `exchange file must not have external hardlinks (nlink=${st.nlink}): ${filePath}`);
    assert.ok(st.size <= MAX_EXCHANGE_FILE_BYTES, `exchange file exceeds 32 MiB limit: ${filePath}`);
    if (typeof process.getuid === "function") {
      assert.equal(st.uid, process.getuid(), `exchange file UID mismatch: ${filePath}`);
    }
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Atomically publish `bytes` into `destPath` on the host using an exclusive
 * temporary file in the same directory + hardlink (fails on EEXIST), then
 * always unlinks the temp name.
 */
function publishHostFileAtomically(destPath, bytes) {
  assert.ok(bytes.length <= MAX_EXCHANGE_FILE_BYTES, "published file exceeds 32 MiB cap");
  const destDir = dirname(resolve(destPath));
  mkdirSync(destDir, { recursive: true, mode: 0o700 });
  assertNoSymlinkAncestors(destDir);
  const tmpName = join(destDir, `.h2a-pub-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
  let fd;
  try {
    fd = openSync(
      tmpName,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW,
      0o600,
    );
    let offset = 0;
    while (offset < bytes.length) {
      const n = writeSync(fd, bytes, offset, bytes.length - offset);
      if (n <= 0) throw new Error("short write during host publication");
      offset += n;
    }
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    linkSync(tmpName, resolve(destPath));
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
    try { unlinkSync(tmpName); } catch { /* ignore */ }
  }
}

function validateCiImports(roleInfo, env, workspace, controlDir) {
  const { role, shardIndex } = roleInfo;
  const isCi = env.GITHUB_ACTIONS === "true";
  const m17Var = env.H2A_TEST_CI_M17_REPORT;
  const bulkVar = env.H2A_TEST_CI_BULK_REPORT;
  const shardDirVar = env.H2A_TEST_NODE_SHARD_DIR;
  const anyImportSet = m17Var !== undefined || bulkVar !== undefined || shardDirVar !== undefined;

  const imports = []; // { hostCopy, guestPath }

  const copySingleImport = (varName, actualVal, relExpected, copyRel) => {
    const expectedPath = join(workspace, relExpected);
    if (resolve(actualVal ?? "") !== resolve(expectedPath)) {
      failContract(`${varName} must be exact workspace path ${expectedPath}, got ${actualVal}`);
    }
    if (!existsSync(expectedPath)) {
      failContract(`required CI import missing: ${expectedPath}`);
    }
    const bytes = readRegularExchangeFile(expectedPath, dirname(expectedPath));
    const dest = join(controlDir, "imports", copyRel);
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    writeFileSync(dest, bytes, { mode: 0o400 });
    imports.push({ hostCopy: dest, guestPath: expectedPath });
  };

  if (role === "aggregator") {
    const ciAggregateJob =
      isCi &&
      ["build-and-test", "npm-test-trust-root", "verify"].includes(env.GITHUB_JOB ?? "");
    if (ciAggregateJob || anyImportSet) {
      if (!m17Var || !bulkVar || !shardDirVar) {
        failContract(
          "aggregator role with CI imports requires all three variables (H2A_TEST_CI_M17_REPORT, H2A_TEST_CI_BULK_REPORT, H2A_TEST_NODE_SHARD_DIR)",
        );
      }
      copySingleImport("H2A_TEST_CI_M17_REPORT", m17Var, "tmp/m17-import/proof.json", "m17/proof.json");
      copySingleImport("H2A_TEST_CI_BULK_REPORT", bulkVar, "tmp/bulk-import/proof.json", "bulk/proof.json");
      const expectedShardDir = join(workspace, "tmp/node-shards");
      if (resolve(shardDirVar) !== resolve(expectedShardDir)) {
        failContract(`H2A_TEST_NODE_SHARD_DIR must be ${expectedShardDir}, got ${shardDirVar}`);
      }
      assertNoSymlinkAncestors(expectedShardDir);
      const dirStat = lstatSync(expectedShardDir);
      if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
        failContract(`H2A_TEST_NODE_SHARD_DIR must be a real directory: ${expectedShardDir}`);
      }
      const entries = readdirSync(expectedShardDir).sort();
      const expectedFiles = [0, 1, 2, 3].map((i) => `node-shard-${i}.json`);
      if (JSON.stringify(entries) !== JSON.stringify(expectedFiles)) {
        failContract(
          `H2A_TEST_NODE_SHARD_DIR must contain exactly ${expectedFiles.join(", ")}, found ${entries.join(", ")}`,
        );
      }
      for (const name of expectedFiles) {
        const src = join(expectedShardDir, name);
        const bytes = readRegularExchangeFile(src, expectedShardDir);
        const dest = join(controlDir, "imports", "node-shards", name);
        mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
        writeFileSync(dest, bytes, { mode: 0o400 });
        imports.push({ hostCopy: dest, guestPath: src });
      }
    }
  } else if (role === "node-shard") {
    if (shardIndex === null || shardIndex < 0 || shardIndex > 3) {
      failContract(`node-shard role requires valid --shard=0..3, got ${shardIndex}`);
    }
    if (shardDirVar !== undefined) {
      failContract("node-shard role forbids H2A_TEST_NODE_SHARD_DIR");
    }
    if (isCi || anyImportSet) {
      if (!m17Var || !bulkVar) {
        failContract("node-shard role requires H2A_TEST_CI_M17_REPORT and H2A_TEST_CI_BULK_REPORT");
      }
      copySingleImport("H2A_TEST_CI_M17_REPORT", m17Var, "tmp/m17-import/proof.json", "m17/proof.json");
      copySingleImport("H2A_TEST_CI_BULK_REPORT", bulkVar, "tmp/bulk-import/proof.json", "bulk/proof.json");
    }
  } else {
    // m17-run, bulk, focus-perf, ordinary (including trust-root independent test): ZERO imports
    if (anyImportSet) {
      failContract(`role ${role} forbids CI proof import env vars (${CI_IMPORT_ENV_VARS.filter((k) => env[k] !== undefined).join(", ")})`);
    }
  }

  return imports;
}

function shouldPrefetchHistoricalRefs(command) {
  if (!Array.isArray(command) || command.length === 0) return false;
  const joined = command.join(" ");
  return (
    joined.includes("--test") ||
    joined.includes("vitest") ||
    joined.includes("run-tests.mjs") ||
    joined.includes("run-test-gates.mjs") ||
    joined.includes("run-node-shard.mjs") ||
    joined.includes("ci-bulk-proof.mjs") ||
    joined.includes("ci-m17-proof.mjs") ||
    joined.includes("identity-isolated-run.mjs") ||
    joined.includes("host-isolated-run.mjs") ||
    (command[0].endsWith("npm") && command[1] === "test")
  );
}

function prefetchHistoricalRefsBeforeBarrier(repoRoot, env) {
  const gitDir = join(repoRoot, ".git");
  if (!existsSync(gitDir)) return;
  const refs = [LEGACY_HOST_REF, IDENTITY_BASE_REF, L0_HERITAGE_REF];
  const canFetch = env.GITHUB_ACTIONS === "true" || env.H2A_TEST_ALLOW_GIT_FETCH === "1";
  const missing = [];
  for (const ref of refs) {
    const present =
      spawnSync("git", ["cat-file", "-e", `${ref}^{commit}`], {
        cwd: repoRoot,
        env: { ...env, GIT_OPTIONAL_LOCKS: "0" },
        stdio: "ignore",
      }).status === 0;
    if (present) continue;
    if (canFetch) {
      ensureHistoricalGitRef(repoRoot, ref);
    } else {
      missing.push(ref);
    }
  }
  if (missing.length > 0) {
    process.stderr.write(
      `test-sandbox: warning: historical git refs absent in local checkout (${missing.join(", ")}); fetch them on the conductor before running historical suites\n`,
    );
  }
}

function copyIndependentDir(src, dest) {
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  if (!existsSync(src)) return;
  // Prefer reflink=auto copy-on-write on Linux; never create hardlinks (-l)!
  if (process.platform === "linux") {
    const cp = spawnSync("cp", ["-a", "--reflink=auto", `${src}/.`, dest], { encoding: "utf8" });
    if (cp.status === 0) return;
  }
  cpSync(src, dest, { recursive: true });
}

function listWorkspacePackages(repoRoot) {
  const dirs = [];
  for (const parent of ["packages", "apps"]) {
    const fullParent = join(repoRoot, parent);
    if (!existsSync(fullParent)) continue;
    for (const ent of readdirSync(fullParent, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        dirs.push(join(parent, ent.name));
      }
    }
  }
  return dirs;
}

/**
 * Build bwrap mount arguments for writable views and read-only imports under
 * `repoRoot` WITHOUT creating a single file or directory on the real checkout.
 * Missing mount points get a synthetic `--tmpfs` parent populated with
 * read-only siblings and literal symlinks, then locked with `--remount-ro`.
 */
function buildCheckoutOverlayArgs(repoRoot, runRoot, ciImports) {
  const writableViews = []; // { visible, shadow, targetRel, isFile }

  const addDirView = (relPath, targetRel, { prePopulate = false } = {}) => {
    const visible = join(repoRoot, relPath);
    const shadow = join(runRoot, targetRel);
    mkdirSync(shadow, { recursive: true, mode: 0o700 });
    if (prePopulate && existsSync(visible)) {
      copyIndependentDir(visible, shadow);
    }
    writableViews.push({ visible, shadow, targetRel, isFile: false });
  };

  const addFileView = (relPath, targetRel) => {
    const visible = join(repoRoot, relPath);
    const shadow = join(runRoot, targetRel);
    mkdirSync(dirname(shadow), { recursive: true, mode: 0o700 });
    if (existsSync(visible)) {
      copyFileSync(visible, shadow);
    } else {
      const fd = openSync(shadow, "a", 0o600);
      closeSync(fd);
    }
    writableViews.push({ visible, shadow, targetRel, isFile: true });
  };

  // Fixed checkout views
  addDirView("tmp", "views/tmp");
  addDirView("tmp/test-runtime", "aliases/test-runtime");
  addDirView(".tmp", "views/dot-tmp");
  addDirView(".qual-tmp", "aliases/qual-tmp");

  if (existsSync(join(repoRoot, "node_modules"))) {
    addDirView("node_modules/.vite", "views/vite-root");
    addDirView("node_modules/.vite-temp", "views/vite-root-temp");
  }

  const scratchLocs = [
    ["", ".test-scratch"],
    ["src", ".cfg-test"],
    ["src", ".auth-test"],
    ["src", ".stack-test"],
  ];

  for (const wsRel of listWorkspacePackages(repoRoot)) {
    const safeName = wsRel.replaceAll("/", "__");
    const wsAbs = join(repoRoot, wsRel);

    if (existsSync(join(wsAbs, "node_modules"))) {
      addDirView(join(wsRel, "node_modules/.vite"), `views/vite-${safeName}`);
      addDirView(join(wsRel, "node_modules/.vite-temp"), `views/vite-temp-${safeName}`);
    }

    // dist/ and tsconfig.tsbuildinfo for buildable workspaces (pre-populated!)
    if (existsSync(join(wsAbs, "tsconfig.json")) || existsSync(join(wsAbs, "dist"))) {
      addDirView(join(wsRel, "dist"), `views/dist/${safeName}`, { prePopulate: true });
      addFileView(join(wsRel, "tsconfig.tsbuildinfo"), `views/tsbuildinfo/${safeName}.tsbuildinfo`);
    }

    // Legacy scratch overlays (pre-populated with committed fixtures if present)
    for (const [sub, scratchName] of scratchLocs) {
      const parentAbs = sub ? join(wsAbs, sub) : wsAbs;
      if (!existsSync(parentAbs)) continue;
      const rel = sub ? join(wsRel, sub, scratchName) : join(wsRel, scratchName);
      addDirView(rel, `views/scratch/${safeName}-${sub || "pkg"}-${scratchName.replace(/^\./, "")}`, {
        prePopulate: true,
      });
    }
  }

  // Ensure parent subdirs exist inside `views/tmp` for tmp/test-runtime and CI imports
  mkdirSync(join(runRoot, "views/tmp/test-runtime"), { recursive: true, mode: 0o700 });
  for (const imp of ciImports) {
    const relFromTmp = relative(join(repoRoot, "tmp"), imp.guestPath);
    if (!relFromTmp.startsWith("..") && !isAbsolute(relFromTmp)) {
      const shadowParent = join(runRoot, "views/tmp", dirname(relFromTmp));
      mkdirSync(shadowParent, { recursive: true, mode: 0o700 });
      const placeholder = join(shadowParent, basename(relFromTmp));
      const fd = openSync(placeholder, "a", 0o600);
      closeSync(fd);
    }
  }

  // Determine which parents need synthetic --tmpfs because a leaf mount point
  // does not exist on the real checkout (and is NOT inside an already-writable
  // view like <repo>/tmp).
  const writableDirSet = new Set(
    writableViews.filter((v) => !v.isFile).map((v) => resolve(v.visible)),
  );
  const isCoveredByWritableDir = (targetPath) => {
    let p = dirname(resolve(targetPath));
    while (p.length >= repoRoot.length) {
      if (writableDirSet.has(p)) return true;
      const up = dirname(p);
      if (up === p) break;
      p = up;
    }
    return false;
  };

  const syntheticParents = new Set();
  const targetSet = new Set(writableViews.map((v) => resolve(v.visible)));

  for (const view of writableViews) {
    if (existsSync(view.visible)) continue;
    if (isCoveredByWritableDir(view.visible)) continue;
    let parent = dirname(view.visible);
    while (parent.length >= repoRoot.length) {
      syntheticParents.add(parent);
      if (existsSync(parent)) break;
      const up = dirname(parent);
      if (up === parent) break;
      parent = up;
    }
  }

  const args = [];
  // 1. Emit synthetic --tmpfs parents top-down and mirror their read-only siblings.
  const sortedSynthetic = [...syntheticParents].sort((a, b) => a.length - b.length);
  for (const parent of sortedSynthetic) {
    args.push("--tmpfs", parent);
    if (!existsSync(parent)) continue;
    for (const ent of readdirSync(parent, { withFileTypes: true })) {
      const childPath = join(parent, ent.name);
      if (syntheticParents.has(childPath) || targetSet.has(childPath)) continue;
      if (ent.isSymbolicLink()) {
        args.push("--symlink", readlinkSync(childPath), childPath);
      } else {
        args.push("--ro-bind", childPath, childPath);
      }
    }
  }

  // 2. Emit writable leaf binds top-down so `<repo>/tmp` precedes `<repo>/tmp/test-runtime`.
  const sortedViews = [...writableViews].sort((a, b) => a.visible.length - b.visible.length);
  for (const view of sortedViews) {
    args.push("--bind", view.shadow, view.visible);
  }

  // 3. Emit read-only CI import binds on top of `<repo>/tmp/...`.
  for (const imp of ciImports) {
    args.push("--ro-bind", imp.hostCopy, imp.guestPath);
  }

  // 4. Lock every synthetic parent non-recursively with --remount-ro.
  for (const parent of sortedSynthetic) {
    args.push("--remount-ro", parent);
  }

  return { args, writableViews };
}

function readProcessBirth(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(") ") + 2).split(" ");
    return fields[19] ?? null;
  } catch {
    return null;
  }
}

function isProcessAliveWithBirth(pid, birth) {
  if (!pid || !birth) return false;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(") ") + 2).split(" ");
    return fields[0] !== "Z" && fields[19] === birth;
  } catch {
    return false;
  }
}

function findUniqueFocusMetrics(runRoot) {
  const found = [];
  const scanTmp = (tmpDir) => {
    if (!existsSync(tmpDir)) return;
    for (const ent of readdirSync(tmpDir, { withFileTypes: true })) {
      if (!ent.isDirectory() || !ent.name.startsWith("focus-evidence-performance-")) continue;
      const full = join(tmpDir, ent.name, "metrics.json");
      if (!existsSync(full)) continue;
      const lst = lstatSync(full);
      if (!lst.isFile() || lst.isSymbolicLink()) {
        throw new Error(`focus metrics must be a regular file: ${full}`);
      }
      found.push({ dirName: ent.name, fullPath: full, dirPath: join(tmpDir, ent.name) });
    }
  };
  scanTmp(join(runRoot, "tmp"));
  for (const ent of readdirSync(runRoot, { withFileTypes: true })) {
    if (ent.isDirectory() && ent.name.startsWith("w-")) {
      scanTmp(join(runRoot, ent.name, "tmp"));
    }
  }
  return found;
}

function seedNpmCache(runRoot, env) {
  const candidates = [];
  if (env.npm_config_cache && existsSync(join(env.npm_config_cache, "_cacache"))) {
    candidates.push(join(env.npm_config_cache, "_cacache"));
  }
  const homeCache = join(homedir(), ".npm", "_cacache");
  if (isDisposableGitHubVm(env) && existsSync(homeCache)) {
    candidates.push(homeCache);
  }
  for (const src of candidates) {
    try {
      const dest = join(runRoot, "home", ".npm", "_cacache");
      copyIndependentDir(src, dest);
      return;
    } catch { /* fallback to cold writable cache */ }
  }
}

function sanitizeGuestEnv(rawEnv, { runRootVisible, nonce, receiptPath, roleInfo, m17StateRel, ciImports }) {
  const clean = {};
  for (const [k, v] of Object.entries(rawEnv)) {
    if (v === undefined) continue;
    if (STRIPPED_ENV_KEYS.has(k)) continue;
    clean[k] = v;
  }
  // Never expose host physical temp paths to the guest.
  delete clean.RUNNER_TEMP;
  delete clean[TEST_STATE_STAGE_ROOT_ENV];
  delete clean.H2A_TEST_M17_HOST_RECEIPT;
  delete clean.H2A_TEST_M17_CONTROL_DIR;

  clean.HOME = join(runRootVisible, "home");
  clean.XDG_STATE_HOME = join(runRootVisible, "state");
  clean.XDG_CONFIG_HOME = join(runRootVisible, "config");
  clean.XDG_RUNTIME_DIR = join(runRootVisible, "runtime");
  clean.XDG_CACHE_HOME = join(runRootVisible, "cache");
  clean.XDG_DATA_HOME = join(runRootVisible, "data");
  clean.TMPDIR = join(runRootVisible, "tmp");
  clean.TMP = join(runRootVisible, "tmp");
  clean.TEMP = join(runRootVisible, "tmp");
  clean.REMOTE_CLI_CONFIG_HOME = join(runRootVisible, "config");
  clean.H2A_ROOT = join(runRootVisible, "store");
  clean.H2A_NATIVE_SOCKET = join(runRootVisible, "runtime", "host.sock");
  clean.H2A_NATIVE_HOST_LOG = join(runRootVisible, "state", "native-host.log");
  clean.DBUS_SESSION_BUS_ADDRESS = `unix:path=${join(runRootVisible, "runtime", "no-bus")}`;
  delete clean.CODEX_HOME;
  delete clean.CLAUDE_CONFIG_DIR;
  delete clean.VIBE_HOME;
  clean.npm_config_cache = join(runRootVisible, "home", ".npm");
  clean.GIT_OPTIONAL_LOCKS = "0";
  clean[TEST_STATE_ROOT_ENV] = runRootVisible;
  clean[TEST_STATE_QUALIFICATION_ROOT_ENV] = runRootVisible;
  clean[TEST_STATE_BARRIER_ENV] = "1";
  clean[TEST_SANDBOX_NONCE_ENV] = nonce;
  clean[TEST_STATE_RECEIPT_ENV] = receiptPath;
  clean[TEST_OWNER_HOME_ENV] = homedir();
  clean.H2A_TEST_REPORT_PATH = join(runRootVisible, "reports", "vitest-report.json");

  if (roleInfo.role === "m17-run") {
    clean.H2A_TEST_M17_TMPDIR = join(runRootVisible, "m17");
    clean.H2A_TEST_M17_STATE_REL = m17StateRel;
  }

  // Expose Playwright browsers read-only if pre-installed on the host.
  if (!clean.PLAYWRIGHT_BROWSERS_PATH) {
    const browsers = join(homedir(), ".cache", "ms-playwright");
    if (existsSync(browsers)) {
      clean.PLAYWRIGHT_BROWSERS_PATH = browsers;
    }
  }

  // Strip CI import vars if no imports were admitted for this role.
  if (ciImports.length === 0) {
    for (const key of CI_IMPORT_ENV_VARS) delete clean[key];
  }

  return clean;
}

function buildOwnerMaskArgs(repoRoot, hostH, hostC) {
  const args = [];
  const home = homedir();
  const sensitive = [
    join(home, ".local", "state", "h2a"),
    join(home, ".local", "state", "sentropic"),
    join(home, ".config", "sentropic"),
    join(home, ".config", "h2a"),
    join(home, ".config", "claude"),
    join(home, ".claude"),
    join(home, ".codex"),
    join(home, ".vibe"),
    join(home, ".h2a"),
    hostC,
    hostH,
  ];
  const seen = new Set();
  for (const target of sensitive) {
    const abs = resolve(target);
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (!existsSync(abs)) continue;
    // Never mask an ancestor of repoRoot or node binary!
    if (isWithinDirectory(repoRoot, abs) || isWithinDirectory(process.execPath, abs)) continue;
    args.push("--tmpfs", abs, "--remount-ro", abs);
  }
  return args;
}

async function main() {
  if (process.argv.includes("--prepare-ci")) {
    if (process.argv.length !== 3 || process.argv[2] !== "--prepare-ci") {
      process.stderr.write("test-sandbox: usage: node scripts/test-sandbox.mjs --prepare-ci\n");
      process.exit(SANDBOX_USAGE_EXIT);
    }
    runPrepareCi();
    return;
  }

  const separator = process.argv.indexOf("--");
  if (separator === -1 || separator === process.argv.length - 1) {
    process.stderr.write("test-sandbox: usage: node scripts/test-sandbox.mjs -- <command> [args...]\n");
    process.exit(SANDBOX_USAGE_EXIT);
  }
  const command = process.argv.slice(separator + 1);
  if (command.some((arg) => typeof arg !== "string" || arg.length === 0)) {
    process.stderr.write("test-sandbox: usage: non-empty command arguments required\n");
    process.exit(SANDBOX_USAGE_EXIT);
  }

  const workspace = resolve(process.env.GITHUB_WORKSPACE || REPO_ROOT);
  const roleInfo = detectSandboxRole(command, process.env, REPO_ROOT);

  // Prefetch historical Git refs before entering read-only checkout barrier.
  if (shouldPrefetchHistoricalRefs(command)) {
    prefetchHistoricalRefsBeforeBarrier(REPO_ROOT, process.env);
  }

  const base = selectHostTempBase(process.env);
  let controlDir;
  let hostH;
  let ownsH = true;
  let ownsC = true;
  let m17SetupReceipt = null;
  let m17StateRel = null;
  let m17StateDev = null;
  let m17StateIno = null;

  if (roleInfo.role === "m17-run") {
    // Reopen host-reserved H and C created by `scripts/ci-m17-temp.mjs setup`.
    const runnerTemp = process.env.RUNNER_TEMP;
    if (!runnerTemp) failContract("m17-run requires RUNNER_TEMP from ci-m17-temp.mjs setup");
    const pointerPath = join(realpathSync(runnerTemp), "h2a-m17-active.json");
    if (!existsSync(pointerPath)) failContract("m17-run requires active reservation from ci-m17-temp.mjs setup");
    const pointer = JSON.parse(readFileSync(pointerPath, "utf8"));
    controlDir = pointer.controlDir;
    const setupPath = join(controlDir, "setup-receipt.json");
    m17SetupReceipt = JSON.parse(readFileSync(setupPath, "utf8"));
    hostH = m17SetupReceipt.hostRoot;
    ownsH = false; // cleanup owns H removal
    ownsC = false; // finalize owns C closure
    const m17Info = lstatSync(m17SetupReceipt.volumePath);
    if (String(m17Info.dev) !== String(m17SetupReceipt.dev) || String(m17Info.ino) !== String(m17SetupReceipt.ino)) {
      failContract("m17-run: mounted tmpfs volume identity changed before run");
    }
    const stateNonce = randomBytes(8).toString("hex");
    m17StateRel = `tmp/m17-ci-run-${stateNonce}`;
    const stateHostPath = join(hostH, m17StateRel);
    mkdirSync(stateHostPath, { recursive: true, mode: 0o700 });
    const stateStat = lstatSync(stateHostPath);
    m17StateDev = String(stateStat.dev);
    m17StateIno = String(stateStat.ino);
  } else {
    controlDir = mkdtempSync(join(base, "c-"));
    chmodSync(controlDir, 0o700);
    hostH = mkdtempSync(join(base, "h-"));
    chmodSync(hostH, 0o700);
  }

  const cleanup = () => {
    if (ownsH && hostH) {
      try { rmSync(hostH, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    if (ownsC && controlDir) {
      try { rmSync(controlDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  };

  try {
    // Prepare standard directories under H.
    for (const sub of [
      "home",
      "state",
      "config",
      "runtime",
      "cache",
      "data",
      "tmp",
      "store",
      "reports",
      COMPAT_TMP_TARGET,
      "aliases/qual-tmp",
      "aliases/test-runtime",
      ...(roleInfo.role === "m17-run" ? ["m17"] : []),
    ]) {
      mkdirSync(join(hostH, sub), { recursive: true, mode: 0o700 });
    }

    // Validate N3 CI imports (copied into C/imports, never writable by guest).
    const ciImports = validateCiImports(roleInfo, process.env, workspace, controlDir);

    // Seed offline npm cache independently into H/home/.npm.
    seedNpmCache(hostH, process.env);

    const nonce = randomBytes(24).toString("hex");
    const roWitnessHost = join(controlDir, "ro-witness");
    writeFileSync(roWitnessHost, `h2a-d16-ro-witness:${nonce}\n`, { mode: 0o644 });
    const receiptHost = join(controlDir, "receipt.json");
    writeFileSync(receiptHost, "{}\n", { mode: 0o600 });

    if (process.platform === "linux") {
      const vmSharedNet = isDisposableGitHubVm(process.env);
      const unshareNet = !vmSharedNet;

      const probeDir = join(controlDir, "probe");
      mkdirSync(probeDir, { mode: 0o700 });
      const probe = probeBwrapNamespace({ unshareNet, probeDir });
      rmSync(probeDir, { recursive: true, force: true });
      if (!probe.ok) {
        cleanup();
        failIncomplete(
          `Linux bubblewrap namespace barrier unavailable (${probe.stderr || probe.error || `exit ${probe.status}`})`,
        );
      }

      const { args: checkoutArgs, writableViews } = buildCheckoutOverlayArgs(REPO_ROOT, hostH, ciImports);
      const maskArgs = buildOwnerMaskArgs(REPO_ROOT, hostH, controlDir);

      const bwrapArgs = [
        "--unshare-user",
        "--unshare-pid",
        "--unshare-ipc",
        "--unshare-uts",
        "--unshare-cgroup",
        ...(unshareNet ? ["--unshare-net"] : []),
        "--die-with-parent",
        "--info-fd", "3",
        "--block-fd", "4",
        "--ro-bind", "/", "/",
        "--dev", "/dev",
        "--proc", "/proc",
        "--tmpfs", "/run",
        "--dir", "/run/h2a-test",
        "--bind", hostH, SANDBOX_MOUNT_ROOT,
        ...(roleInfo.role === "m17-run" ? ["--bind", m17SetupReceipt.volumePath, join(SANDBOX_MOUNT_ROOT, "m17")] : []),
        "--ro-bind", receiptHost, SANDBOX_RECEIPT_PATH,
        "--ro-bind", roWitnessHost, SANDBOX_RO_WITNESS_PATH,
        ...(!unshareNet && existsSync("/run/systemd/resolve")
          ? ["--dir", "/run/systemd", "--ro-bind", "/run/systemd/resolve", "/run/systemd/resolve"]
          : []),
        "--remount-ro", "/run",
        "--bind", join(hostH, COMPAT_TMP_TARGET), "/tmp",
        ...checkoutArgs,
        ...maskArgs,
        "--chdir", REPO_ROOT,
        "--",
        ...command,
      ];

      const guestEnv = sanitizeGuestEnv(process.env, {
        runRootVisible: SANDBOX_MOUNT_ROOT,
        nonce,
        receiptPath: SANDBOX_RECEIPT_PATH,
        roleInfo,
        m17StateRel,
        ciImports,
      });

      const hostMntNs = (() => { try { return readlinkSync("/proc/self/ns/mnt"); } catch { return null; } })();
      const hostNetNs = (() => { try { return readlinkSync("/proc/self/ns/net"); } catch { return null; } })();

      const hStat = statSync(hostH);
      const qualTmpStat = statSync(join(hostH, "aliases/qual-tmp"));
      const testRuntimeStat = statSync(join(hostH, "aliases/test-runtime"));
      const compatTmpStat = statSync(join(hostH, COMPAT_TMP_TARGET));

      const aliases = [
        {
          visible: join(REPO_ROOT, ".qual-tmp"),
          target: "aliases/qual-tmp",
          dev: String(qualTmpStat.dev),
          ino: String(qualTmpStat.ino),
        },
        {
          visible: join(REPO_ROOT, "tmp", "test-runtime"),
          target: "aliases/test-runtime",
          dev: String(testRuntimeStat.dev),
          ino: String(testRuntimeStat.ino),
        },
        {
          visible: "/tmp",
          target: COMPAT_TMP_TARGET,
          dev: String(compatTmpStat.dev),
          ino: String(compatTmpStat.ino),
        },
      ];

      const writableMounts = writableViews
        .filter((v) => !v.isFile)
        .map((v) => {
          const st = statSync(v.shadow);
          return {
            visible: v.visible,
            target: v.targetRel,
            dev: String(st.dev),
            ino: String(st.ino),
          };
        });

      const child = spawn("bwrap", bwrapArgs, {
        env: guestEnv,
        stdio: ["inherit", "inherit", "inherit", "pipe", "pipe"],
      });

      // Extra pipe fds are AF_UNIX socketpairs on Linux; bwrap reads 1 byte
      // from block-fd and closes both fds, which may emit ECONNRESET/EPIPE.
      child.stdio[3].on("error", () => {});
      child.stdio[4].on("error", () => {});

      let infoBuf = "";
      let released = false;
      let childInitPid = null;
      let childInitBirth = null;

      const releaseWithInfo = (raw) => {
        if (released) return;
        released = true;
        try {
          const info = JSON.parse(raw);
          childInitPid = Number(info["child-pid"]);
          childInitBirth = readProcessBirth(childInitPid);
          const guestMntNs = (() => {
            try { return readlinkSync(`/proc/${childInitPid}/ns/mnt`); } catch { return null; }
          })();
          const guestNetNs = (() => {
            try { return readlinkSync(`/proc/${childInitPid}/ns/net`); } catch { return null; }
          })();

          const receipt = {
            version: 1,
            backend: "bwrap",
            root: SANDBOX_MOUNT_ROOT,
            rootDev: String(hStat.dev),
            rootIno: String(hStat.ino),
            uid: process.getuid(),
            mountNamespace: guestMntNs,
            hostMountNamespace: hostMntNs,
            netNamespace: guestNetNs,
            hostNetNamespace: hostNetNs,
            networkMode: unshareNet ? "isolated" : "vm-shared",
            nonce,
            checkout: REPO_ROOT,
            roWitness: SANDBOX_RO_WITNESS_PATH,
            aliases,
            writableMounts,
          };
          // Update receipt IN-PLACE on the exact inode bound into the guest!
          const fd = openSync(receiptHost, fsConstants.O_WRONLY | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW);
          try {
            const payload = Buffer.from(JSON.stringify(receipt, null, 2) + "\n", "utf8");
            writeSync(fd, payload, 0, payload.length);
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
          chmodSync(receiptHost, 0o444);
          // bwrap reads exactly 1 byte from --block-fd before closing it.
          child.stdio[4].end(Buffer.from([0x31]));
        } catch (err) {
          try { child.kill("SIGKILL"); } catch { /* ignore */ }
          process.stderr.write(`test-sandbox: failed to publish receipt: ${err.message}\n`);
        }
      };

      child.stdio[3].on("data", (chunk) => {
        infoBuf += chunk.toString("utf8");
        if (infoBuf.includes("}")) {
          releaseWithInfo(infoBuf);
        }
      });
      child.stdio[3].on("end", () => {
        if (!released && infoBuf.trim()) releaseWithInfo(infoBuf);
      });

      const exitInfo = await new Promise((resolveExit, rejectExit) => {
        child.once("error", rejectExit);
        child.once("close", (code, signal) => {
          try { child.stdio[3].destroy(); } catch { /* ignore */ }
          try { child.stdio[4].destroy(); } catch { /* ignore */ }
          resolveExit({ code, signal });
        });
      });

      // Wait until the bwrap child init of this exact birth is gone.
      if (childInitPid && childInitBirth) {
        const deadline = Date.now() + 5_000;
        while (isProcessAliveWithBirth(childInitPid, childInitBirth) && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 20));
        }
      }

      // Role-scoped post-exit host publication (N3).
      if (roleInfo.role === "focus-perf") {
        // Export diagnostic metrics even if the test failed after writing them.
        const outBase = process.env.RUNNER_TEMP || process.env.FOCUS_METRICS_OUT;
        if (outBase) {
          try {
            const metricsList = findUniqueFocusMetrics(hostH);
            if (metricsList.length === 1) {
              const entry = metricsList[0];
              const bytes = readRegularExchangeFile(entry.fullPath, entry.dirPath);
              const dest = join(resolve(outBase), entry.dirName, "metrics.json");
              publishHostFileAtomically(dest, bytes);
            } else if (metricsList.length > 1) {
              process.stderr.write(`test-sandbox: refusing ambiguous Focus metrics (${metricsList.length} files)\n`);
              cleanup();
              process.exit(1);
            }
          } catch (err) {
            process.stderr.write(`test-sandbox: Focus metrics export failed: ${err.message}\n`);
            if (exitInfo.code === 0) {
              cleanup();
              process.exit(1);
            }
          }
        }
      }

      if (exitInfo.signal) {
        cleanup();
        process.stderr.write(`test-sandbox: confined command terminated by signal ${exitInfo.signal}\n`);
        process.exit(1);
      }

      if (exitInfo.code !== 0) {
        if (roleInfo.role === "m17-run") {
          // Record failed run in C so finalize refuses publication; leave H for cleanup.
          writeFileSync(
            join(controlDir, "run-failed.json"),
            JSON.stringify({ exitCode: exitInfo.code, nonce: m17SetupReceipt.nonce }) + "\n",
            { mode: 0o600 },
          );
        }
        cleanup();
        process.exit(exitInfo.code ?? 1);
      }

      // Command exited 0 — perform role-scoped atomic exports to host.
      if (roleInfo.role === "m17-run") {
        // Verify init gone, H/<m17StateRel> gone, H/m17 still mounted, copy provisional into C.
        if (childInitPid && childInitBirth && isProcessAliveWithBirth(childInitPid, childInitBirth)) {
          failContract("m17-run: bwrap init process survived after exit");
        }
        if (existsSync(join(hostH, m17StateRel))) {
          failContract(`m17-run: private state directory ${m17StateRel} was not removed before exit`);
        }
        const volStat = lstatSync(m17SetupReceipt.volumePath);
        if (
          String(volStat.dev) !== String(m17SetupReceipt.dev) ||
          String(volStat.ino) !== String(m17SetupReceipt.ino)
        ) {
          failContract("m17-run: M17 volume identity changed during run");
        }
        const hostMounts = parseMountInfo(readFileSync("/proc/self/mountinfo", "utf8"));
        const stillMounted = hostMounts.some(
          (m) => resolve(m.mountPoint) === resolve(m17SetupReceipt.volumePath) && m.fsType === "tmpfs",
        );
        if (!stillMounted) {
          failContract("m17-run: M17 tmpfs volume is no longer mounted before cleanup");
        }
        const provisionalSrc = join(hostH, "views/tmp/m17-export/pending.json");
        const bytes = readRegularExchangeFile(provisionalSrc, join(hostH, "views/tmp/m17-export"));
        const provisionalDest = join(controlDir, "m17-provisional.json");
        publishHostFileAtomically(provisionalDest, bytes);
        writeFileSync(
          join(controlDir, "run-receipt.json"),
          JSON.stringify({
            version: 1,
            nonce: m17SetupReceipt.nonce,
            hostRoot: hostH,
            volumePath: m17SetupReceipt.volumePath,
            stateRel: m17StateRel,
            stateDev: m17StateDev,
            stateIno: m17StateIno,
            initExited: true,
            provisionalPath: provisionalDest,
          }) + "\n",
          { flag: "wx", mode: 0o600 },
        );
        // Leave H and H/m17 for `ci-m17-temp.mjs cleanup`, C for `ci-m17-proof.mjs finalize`.
        process.exit(0);
      }

      if (roleInfo.role === "bulk" && process.env.H2A_TEST_CI_BULK_OUTPUT) {
        const destDir = resolve(process.env.H2A_TEST_CI_BULK_OUTPUT);
        if (!isWithinDirectory(destDir, join(workspace, "tmp"))) {
          failContract(`H2A_TEST_CI_BULK_OUTPUT must be under ${join(workspace, "tmp")}`);
        }
        const relOut = relative(join(workspace, "tmp"), destDir);
        const src = join(hostH, "views/tmp", relOut, "proof.json");
        const bytes = readRegularExchangeFile(src, dirname(src));
        publishHostFileAtomically(join(destDir, "proof.json"), bytes);
      }

      if (roleInfo.role === "node-shard") {
        const fileName = `node-shard-${roleInfo.shardIndex}.json`;
        const src = join(hostH, "views/tmp/node-shard", fileName);
        if (existsSync(src)) {
          const bytes = readRegularExchangeFile(src, dirname(src));
          publishHostFileAtomically(join(workspace, "tmp/node-shard", fileName), bytes);
        }
      }

      cleanup();
      process.exit(0);
    } else if (process.platform === "darwin") {
      const probe = spawnSync("sandbox-exec", ["-h"], { encoding: "utf8" });
      if (probe.status !== 0 && probe.status !== 64) {
        cleanup();
        failIncomplete("sandbox-exec is unavailable on this macOS machine");
      }
      const hStat = statSync(hostH);
      const receipt = {
        version: 1,
        backend: "sandbox-exec",
        root: hostH,
        rootDev: String(hStat.dev),
        rootIno: String(hStat.ino),
        uid: process.getuid(),
        mountNamespace: `sandbox-exec:${nonce}`,
        networkMode: "isolated",
        nonce,
        checkout: REPO_ROOT,
        roWitness: roWitnessHost,
        aliases: [],
        writableMounts: [],
      };
      writeFileSync(receiptHost, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o444 });
      const guestEnv = sanitizeGuestEnv(process.env, {
        runRootVisible: hostH,
        nonce,
        receiptPath: receiptHost,
        roleInfo,
        m17StateRel: null,
        ciImports,
      });
      const profile = `(version 1)(deny default)(allow process-exec)(allow sysctl-read)(allow mach-lookup)(allow file-read*)(allow file-write* (subpath "${hostH}"))`;
      const res = spawnSync("sandbox-exec", ["-p", profile, ...command], {
        env: guestEnv,
        stdio: "inherit",
        cwd: REPO_ROOT,
      });
      cleanup();
      if (res.error) {
        failIncomplete(`sandbox-exec failed: ${res.error.message}`);
      }
      process.exit(res.status ?? 1);
    } else {
      cleanup();
      failIncomplete(`no qualified filesystem-barrier tool for platform ${process.platform}`);
    }
  } catch (error) {
    cleanup();
    process.stderr.write(`test-sandbox: ${error.stack ?? error.message}\n`);
    process.exit(1);
  }
}

await main();
