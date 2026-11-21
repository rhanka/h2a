/**
 * Lot L0 (D16 / C2 / T10) — dedicated root VM qualification entrypoint for
 * `packages/h2a-runtime/qualification/namespace-publication.test.ts`.
 *
 * Three exact modes (INJ C2):
 *   1. Direct entry (zero script args, UID 0, under sudo on disposable VM):
 *      verifies the root-owned `/run/h2a-qualification/t10-reservation.json`
 *      prepared by `scripts/test-host-qualification.mjs native-namespaces`,
 *      allocates a private 0700 root + 0400 piece under `/run/h2a-qualification`,
 *      strips ordinary D16 markers, and runs ONLY `namespace-publication.test.ts`
 *      with `packages/h2a-runtime/qualification/vitest.namespace.config.mjs`.
 *   2. Imported WITHOUT query string: pure module exporting `installVmFixture`
 *      and `createVmIsolationApi` (launches and installs nothing).
 *   3. Imported WITH `?preload=t10` (child `--import` URL): verifies the T10
 *      control piece and installs the VM spawn guard (no Vitest API, no relaunch).
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  HOST_QUALIFICATION_ROOT,
  TEST_SANDBOX_NONCE_ENV,
  TEST_STATE_BARRIER_ENV,
  TEST_STATE_QUALIFICATION_ROOT_ENV,
  TEST_STATE_RECEIPT_ENV,
  TEST_STATE_ROOT_ENV,
} from "./test-sandbox-contract.mjs";
import { createNativeIsolationApi } from "../packages/h2a/test/helpers/native-isolation-core.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const T10_RESERVATION_PATH = join(HOST_QUALIFICATION_ROOT, "t10-reservation.json");
const T10_PIECE_ENV = "H2A_T10_VM_PIECE";
const T10_NONCE_ENV = "H2A_T10_VM_NONCE";

function readBootId() {
  return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
}

function assertRootOwnedNonSymlink(filePath, expectedType, expectedModeMask = 0o077) {
  const st = lstatSync(filePath);
  assert.ok(!st.isSymbolicLink(), `T10 path must not be a symlink: ${filePath}`);
  assert.equal(st.uid, 0, `T10 path must be owned by root: ${filePath}`);
  if (expectedType === "dir") assert.ok(st.isDirectory(), `T10 path must be a dir: ${filePath}`);
  else assert.ok(st.isFile(), `T10 path must be a regular file: ${filePath}`);
  assert.equal(st.mode & expectedModeMask, 0, `T10 path permissions too broad: ${filePath}`);
  return st;
}

function verifyT10ControlPiece(env = process.env) {
  assert.equal(process.platform, "linux", "T10 VM qualification requires Linux");
  assert.equal(process.getuid?.(), 0, "T10 VM qualification requires UID 0");
  assert.equal(env.GITHUB_ACTIONS, "true", "T10 VM qualification requires GitHub Actions");
  assert.equal(env.RUNNER_ENVIRONMENT, "github-hosted", "T10 VM qualification requires GitHub-hosted VM");
  assert.equal(env.GITHUB_REPOSITORY, "rhanka/h2a", "T10 VM qualification requires rhanka/h2a");
  assert.equal(env.GITHUB_JOB, "native-namespaces", "T10 VM qualification requires native-namespaces job");
  // Ordinary D16 markers are forbidden in the T10 VM lab.
  assert.equal(env[TEST_STATE_ROOT_ENV], undefined, "ordinary D16 marker forbidden in T10 VM");
  assert.equal(env[TEST_STATE_BARRIER_ENV], undefined, "ordinary D16 barrier flag forbidden in T10 VM");

  const piecePath = env[T10_PIECE_ENV];
  const nonce = env[T10_NONCE_ENV];
  assert.ok(
    typeof piecePath === "string" && piecePath.startsWith(`${HOST_QUALIFICATION_ROOT}/t10-`),
    "missing or invalid T10 VM control piece path",
  );
  assert.match(nonce ?? "", /^[0-9a-f]{32,}$/, "missing or invalid T10 VM nonce");

  assertRootOwnedNonSymlink(HOST_QUALIFICATION_ROOT, "dir", 0o022);
  assertRootOwnedNonSymlink(piecePath, "file", 0o377);
  const piece = JSON.parse(readFileSync(piecePath, "utf8"));
  assert.equal(piece.version, 1);
  assert.equal(piece.role, "t10");
  assert.equal(piece.nonce, nonce);
  assert.equal(piece.bootId, readBootId());
  assert.ok(
    typeof piece.root === "string" && piece.root.startsWith(`${HOST_QUALIFICATION_ROOT}/t10-`),
    "invalid T10 VM root in piece",
  );
  const rootStat = assertRootOwnedNonSymlink(piece.root, "dir", 0o077);
  assert.equal(String(rootStat.dev), piece.rootDev);
  assert.equal(String(rootStat.ino), piece.rootIno);
  return piece;
}

const PRELOAD_URL = `${import.meta.url.split("?")[0]}?preload=t10`;

let cachedVmApi = null;

export function createVmIsolationApi(env = process.env) {
  const piece = verifyT10ControlPiece(env);
  if (cachedVmApi && cachedVmApi.root === piece.root) return cachedVmApi.api;
  const api = createNativeIsolationApi({
    root: piece.root,
    preloadUrl: PRELOAD_URL,
    receipt: null,
  });
  cachedVmApi = { root: piece.root, api };
  return api;
}

/**
 * Verify the T10 root-owned VM piece and install the VM spawn guard for this
 * process/worker. Does not import Vitest or relaunch any runner.
 */
export function installVmFixture(env = process.env) {
  const api = createVmIsolationApi(env);
  api.activateForCurrentProcess();
  return api;
}

// Mode 3: child preload (`?preload=t10`)
const currentUrl = new URL(import.meta.url);
if (currentUrl.searchParams.get("preload") === "t10") {
  installVmFixture(process.env);
}

// Mode 1: direct root CLI entry (zero script arguments)
const isDirectEntry =
  !currentUrl.search &&
  process.argv[1] &&
  currentUrl.href === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectEntry) {
  if (process.argv.length !== 2) {
    process.stderr.write("run-namespace-qualification: accepts zero script arguments\n");
    process.exit(2);
  }
  assert.equal(process.platform, "linux", "T10 requires Linux");
  assert.equal(process.getuid?.(), 0, "T10 must run as root under sudo");
  assert.equal(process.env.GITHUB_ACTIONS, "true", "T10 requires GitHub Actions");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted", "T10 requires GitHub-hosted VM");
  assert.equal(process.env.GITHUB_REPOSITORY, "rhanka/h2a", "T10 requires rhanka/h2a");
  assert.equal(process.env.GITHUB_JOB, "native-namespaces", "T10 requires native-namespaces job");

  assertRootOwnedNonSymlink(HOST_QUALIFICATION_ROOT, "dir", 0o022);
  assertRootOwnedNonSymlink(T10_RESERVATION_PATH, "file", 0o377);
  const reservation = JSON.parse(readFileSync(T10_RESERVATION_PATH, "utf8"));
  assert.equal(reservation.version, 1);
  assert.equal(reservation.selector, "native-namespaces");
  assert.equal(reservation.repository, process.env.GITHUB_REPOSITORY);
  assert.equal(reservation.job, process.env.GITHUB_JOB);
  assert.equal(reservation.runId, process.env.GITHUB_RUN_ID);
  assert.equal(reservation.attempt, process.env.GITHUB_RUN_ATTEMPT);
  assert.equal(reservation.bootId, readBootId());
  assert.equal(reservation.nodePath, realpathSync(process.execPath));

  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    encoding: "utf8",
  }).trim();
  assert.equal(head, reservation.sha, "checkout HEAD mismatch with T10 reservation");

  if (process.env.RUNNER_TEMP) {
    const canonTemp = realpathSync(process.env.RUNNER_TEMP);
    assert.equal(canonTemp, reservation.stageRoot, "RUNNER_TEMP mismatch with T10 reservation");
    const tempStat = lstatSync(canonTemp);
    if (process.env.SUDO_UID) {
      assert.equal(String(tempStat.uid), String(process.env.SUDO_UID), "RUNNER_TEMP UID != SUDO_UID");
    }
  }

  const nonce = randomBytes(24).toString("hex");
  const testRoot = mkdtempSync(join(HOST_QUALIFICATION_ROOT, "t10-"));
  chmodSync(testRoot, 0o700);
  const rootStat = statSync(testRoot);
  const piecePath = `${testRoot}.json`;
  const piece = {
    version: 1,
    role: "t10",
    root: testRoot,
    rootDev: String(rootStat.dev),
    rootIno: String(rootStat.ino),
    bootId: reservation.bootId,
    sha: reservation.sha,
    nonce,
  };
  writeFileSync(piecePath, JSON.stringify(piece, null, 2) + "\n", { flag: "wx", mode: 0o400 });

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { rmSync(testRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(piecePath, { force: true }); } catch { /* ignore */ }
  };

  const vmEnv = { ...process.env };
  delete vmEnv[TEST_STATE_ROOT_ENV];
  delete vmEnv[TEST_STATE_BARRIER_ENV];
  delete vmEnv[TEST_SANDBOX_NONCE_ENV];
  delete vmEnv[TEST_STATE_RECEIPT_ENV];
  delete vmEnv[TEST_STATE_QUALIFICATION_ROOT_ENV];
  delete vmEnv.H2A_TEST_STATE_ATTESTATION;
  vmEnv[T10_PIECE_ENV] = piecePath;
  vmEnv[T10_NONCE_ENV] = nonce;
  vmEnv.TMPDIR = join(testRoot, "tmp");
  vmEnv.TMP = vmEnv.TMPDIR;
  vmEnv.TEMP = vmEnv.TMPDIR;
  mkdirSync(vmEnv.TMPDIR, { recursive: true, mode: 0o700 });

  const child = spawn(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "packages/h2a-runtime/qualification/vitest.namespace.config.mjs",
      "packages/h2a-runtime/qualification/namespace-publication.test.ts",
    ],
    { cwd: REPO_ROOT, env: vmEnv, stdio: "inherit" },
  );

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.once(sig, () => {
      try { child.kill(sig); } catch { /* ignore */ }
      cleanup();
      process.exit(1);
    });
  }
  child.once("error", (error) => {
    cleanup();
    process.stderr.write(`${error}\n`);
    process.exitCode = 1;
  });
  child.once("close", (code) => {
    cleanup();
    process.exitCode = code ?? 1;
  });
}
