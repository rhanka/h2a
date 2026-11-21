/**
 * Lot L0 (D16) — pure Node stdlib sandbox confinement contract, bootstrap
 * verifier, alias resolver, worker root allocator, role classifier, and
 * confined-lane receipt v1 validator.
 *
 * Zero external dependencies: runnable on a cold checkout before `npm ci` or
 * any TypeScript build.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isMainThread, threadId } from "node:worker_threads";
import { isDeepStrictEqual } from "node:util";

export const SANDBOX_MOUNT_ROOT = "/run/h2a-test/r";
export const SANDBOX_RECEIPT_PATH = "/run/h2a-test/receipt.json";
export const SANDBOX_RO_WITNESS_PATH = "/run/h2a-test/ro-witness";
export const HOST_QUALIFICATION_ROOT = "/run/h2a-qualification";
export const COMPAT_TMP_TARGET = "compat-tmp";

export const SANDBOX_USAGE_EXIT = 2;
export const QUALIFICATION_INCOMPLETE_EXIT = 3;

export const TEST_STATE_ROOT_ENV = "H2A_TEST_STATE_ROOT";
export const TEST_STATE_QUALIFICATION_ROOT_ENV = "H2A_TEST_QUALIFICATION_ROOT";
export const TEST_STATE_RECEIPT_ENV = "H2A_TEST_STATE_RECEIPT";
export const TEST_STATE_BARRIER_ENV = "H2A_TEST_STATE_BARRIER";
export const TEST_SANDBOX_NONCE_ENV = "H2A_TEST_SANDBOX_NONCE";
export const TEST_STATE_STAGE_ROOT_ENV = "H2A_TEST_STAGE_ROOT";
export const TEST_WORKER_ROOT_ENV = "H2A_TEST_WORKER_ROOT";
export const TEST_WORKER_PID_ENV = "H2A_TEST_WORKER_PID";
export const TEST_OWNER_HOME_ENV = "H2A_TEST_OWNER_HOME";

export const CI_IMPORT_ENV_VARS = Object.freeze([
  "H2A_TEST_CI_M17_REPORT",
  "H2A_TEST_CI_BULK_REPORT",
  "H2A_TEST_NODE_SHARD_DIR",
]);

export class UnconfinedTestRunError extends Error {
  constructor(detail) {
    super(`REFUSING unconfined test run before test evaluation: ${detail}`);
    this.name = "UnconfinedTestRunError";
  }
}

export function isWithinDirectory(candidate, root) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function unescapeMountInfoField(field) {
  return field.replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(Number.parseInt(oct, 8)));
}

/** Parse Linux /proc/self/mountinfo lines into structured entries. */
export function parseMountInfo(text) {
  const entries = [];
  for (const rawLine of String(text ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const sep = line.indexOf(" - ");
    if (sep === -1) continue;
    const left = line.slice(0, sep).split(" ");
    const right = line.slice(sep + 3).split(" ");
    if (left.length < 6 || right.length < 3) continue;
    entries.push({
      mountId: left[0],
      parentId: left[1],
      dev: left[2],
      root: unescapeMountInfoField(left[3]),
      mountPoint: unescapeMountInfoField(left[4]),
      mountOptions: left[5].split(","),
      fsType: right[0],
      mountSource: unescapeMountInfoField(right[1]),
      superOptions: right[2].split(","),
    });
  }
  return entries;
}

/** Longest-prefix covering mount for `targetPath` from parsed mountinfo. */
export function findCoveringMount(mounts, targetPath) {
  const normalized = resolve(targetPath);
  let best = null;
  for (const mount of mounts) {
    const mp = mount.mountPoint;
    const matches = mp === "/" || normalized === mp || normalized.startsWith(`${mp}/`);
    if (matches && (!best || mp.length >= best.mountPoint.length)) {
      best = mount;
    }
  }
  return best;
}

function isMountReadOnly(mount) {
  return Boolean(
    mount &&
      (mount.mountOptions.includes("ro") || mount.superOptions.includes("ro")),
  );
}

function isMountReadWrite(mount) {
  return Boolean(
    mount &&
      mount.mountOptions.includes("rw") &&
      !mount.superOptions.includes("ro"),
  );
}

/**
 * Validate structural consistency of the D16 env tuple and read the
 * read-only receipt. Fails closed on partial or contradictory tuples.
 */
export function readAndValidateSandboxReceipt(env = process.env) {
  const stateRoot = env[TEST_STATE_ROOT_ENV];
  const barrier = env[TEST_STATE_BARRIER_ENV];
  const nonce = env[TEST_SANDBOX_NONCE_ENV];
  const envReceipt = env[TEST_STATE_RECEIPT_ENV];

  if (!stateRoot || !isAbsolute(stateRoot)) {
    throw new UnconfinedTestRunError(
      "missing or relative H2A_TEST_STATE_ROOT (run through scripts/test-sandbox.mjs)",
    );
  }
  if (barrier !== "1") {
    throw new UnconfinedTestRunError(
      "filesystem barrier not active (run through scripts/test-sandbox.mjs)",
    );
  }
  if (typeof nonce !== "string" || !/^[0-9a-f]{32,}$/.test(nonce)) {
    throw new UnconfinedTestRunError("missing or malformed sandbox nonce");
  }

  let receiptPath;
  if (process.platform === "linux") {
    receiptPath = SANDBOX_RECEIPT_PATH;
    if (envReceipt !== undefined && envReceipt !== SANDBOX_RECEIPT_PATH) {
      throw new UnconfinedTestRunError(
        `contradictory receipt path on Linux: ${envReceipt}`,
      );
    }
    if (resolve(stateRoot) !== SANDBOX_MOUNT_ROOT) {
      throw new UnconfinedTestRunError(
        `Linux D16 state root must be ${SANDBOX_MOUNT_ROOT}, got ${stateRoot}`,
      );
    }
  } else if (process.platform === "darwin") {
    if (!envReceipt || !isAbsolute(envReceipt)) {
      throw new UnconfinedTestRunError("missing macOS sandbox receipt path");
    }
    if (isWithinDirectory(envReceipt, stateRoot)) {
      throw new UnconfinedTestRunError("sandbox receipt must live outside H");
    }
    receiptPath = envReceipt;
  } else {
    throw new UnconfinedTestRunError(
      `no qualified D16 barrier on platform ${process.platform}`,
    );
  }

  let raw;
  try {
    const lst = lstatSync(receiptPath);
    if (!lst.isFile() || lst.isSymbolicLink()) {
      throw new UnconfinedTestRunError("sandbox receipt must be a regular file");
    }
    raw = readFileSync(receiptPath, "utf8");
  } catch (error) {
    if (error instanceof UnconfinedTestRunError) throw error;
    throw new UnconfinedTestRunError(
      `cannot read sandbox receipt ${receiptPath}: ${error.message}`,
    );
  }

  let receipt;
  try {
    receipt = JSON.parse(raw);
  } catch {
    throw new UnconfinedTestRunError(`sandbox receipt is not valid JSON: ${receiptPath}`);
  }

  if (!receipt || typeof receipt !== "object" || receipt.version !== 1) {
    throw new UnconfinedTestRunError("unsupported or malformed sandbox receipt version");
  }
  if (process.platform === "linux" && receipt.backend !== "bwrap") {
    throw new UnconfinedTestRunError(`unexpected Linux barrier backend: ${receipt.backend}`);
  }
  if (process.platform === "darwin" && receipt.backend !== "sandbox-exec") {
    throw new UnconfinedTestRunError(`unexpected macOS barrier backend: ${receipt.backend}`);
  }
  if (typeof receipt.root !== "string" || !isAbsolute(receipt.root)) {
    throw new UnconfinedTestRunError("receipt missing valid root path");
  }
  if (resolve(receipt.root) !== resolve(stateRoot)) {
    // Allow narrowing H2A_TEST_STATE_ROOT strictly inside receipt.root
    // (consistent with test-state-guard.ts), never widening or traversing symlinks.
    resolveCanonicalInsideRoot(stateRoot, receipt.root);
  }
  if (receipt.nonce !== nonce) {
    throw new UnconfinedTestRunError("receipt nonce does not match invocation nonce");
  }
  if (typeof process.getuid === "function" && receipt.uid !== process.getuid()) {
    throw new UnconfinedTestRunError("receipt UID mismatch");
  }
  if (
    typeof receipt.rootDev !== "string" ||
    !/^\d+$/.test(receipt.rootDev) ||
    typeof receipt.rootIno !== "string" ||
    !/^\d+$/.test(receipt.rootIno)
  ) {
    throw new UnconfinedTestRunError("receipt missing root dev/ino identity");
  }
  if (typeof receipt.roWitness !== "string" || !isAbsolute(receipt.roWitness)) {
    throw new UnconfinedTestRunError("receipt missing read-only witness path");
  }
  if (typeof receipt.checkout !== "string" || !isAbsolute(receipt.checkout)) {
    throw new UnconfinedTestRunError("receipt missing checkout path");
  }
  if (!Array.isArray(receipt.aliases)) {
    throw new UnconfinedTestRunError("receipt missing aliases table");
  }
  for (const alias of receipt.aliases) {
    if (
      !alias ||
      typeof alias !== "object" ||
      typeof alias.visible !== "string" ||
      !isAbsolute(alias.visible) ||
      typeof alias.target !== "string" ||
      isAbsolute(alias.target) ||
      alias.target.split("/").includes("..") ||
      typeof alias.dev !== "string" ||
      !/^\d+$/.test(alias.dev) ||
      typeof alias.ino !== "string" ||
      !/^\d+$/.test(alias.ino)
    ) {
      throw new UnconfinedTestRunError("malformed alias entry in sandbox receipt");
    }
  }
  if (receipt.writableMounts !== undefined && !Array.isArray(receipt.writableMounts)) {
    throw new UnconfinedTestRunError("malformed writableMounts table in sandbox receipt");
  }
  return receipt;
}

// Per-process / per-thread idempotence cache (never shared across processes or threads).
let cachedVerification = null;

export function resetSandboxVerificationCacheForTests() {
  cachedVerification = null;
}

function resolveCanonicalInsideRoot(candidate, root) {
  const abs = resolve(candidate);
  const absRoot = resolve(root);
  const rel = relative(absRoot, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new UnconfinedTestRunError(`path escapes attested root: ${candidate}`);
  }
  const parts = rel ? rel.split("/").filter(Boolean) : [];
  let cur = absRoot;
  const rootStat = lstatSync(cur);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new UnconfinedTestRunError(`attested root is not a real directory: ${cur}`);
  }
  for (const part of parts) {
    cur = join(cur, part);
    const st = lstatSync(cur);
    if (st.isSymbolicLink()) {
      throw new UnconfinedTestRunError(`symlink forbidden in attested path: ${cur}`);
    }
  }
  return cur;
}

function runPositiveWriteProbe(dir) {
  const probeFile = join(
    dir,
    `.d16-probe-${process.pid}-${threadId}-${randomBytes(6).toString("hex")}`,
  );
  let fd;
  try {
    fd = openSync(
      probeFile,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    throw new UnconfinedTestRunError(
      `positive write probe failed in ${dir}: ${error.code ?? error.message}`,
    );
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
    try { unlinkSync(probeFile); } catch { /* ignore */ }
  }
}

function runReadOnlyWitnessProbe(witnessPath, requireErofs) {
  let fd;
  try {
    fd = openSync(witnessPath, fsConstants.O_WRONLY | fsConstants.O_APPEND | fsConstants.O_NOFOLLOW);
  } catch (error) {
    const code = error?.code;
    if (requireErofs) {
      if (code !== "EROFS") {
        throw new UnconfinedTestRunError(
          `read-only witness expected EROFS on ${witnessPath}, got ${code ?? error.message}`,
        );
      }
      return;
    }
    if (code === "EROFS" || code === "EPERM" || code === "EACCES") return;
    throw new UnconfinedTestRunError(
      `read-only witness returned unexpected error on ${witnessPath}: ${code ?? error.message}`,
    );
  }
  try { closeSync(fd); } catch { /* ignore */ }
  throw new UnconfinedTestRunError(
    `read-only witness ${witnessPath} was unexpectedly writable`,
  );
}

/**
 * Full bootstrap confinement check shared by Node preload, Vitest setup,
 * IDLOCK guard, and runners. Verifies the read-only receipt, kernel mount
 * namespace, mountinfo, R dev/ino, aliases (including C5 compat-tmp), EROFS
 * witness, and positive exclusive write in R (or canonical IDLOCK_LANE I).
 */
export function verifySandboxConfinement(env = process.env, options = {}) {
  const idlockLane = env.IDLOCK_LANE;
  const cacheKey = `${process.pid}:${threadId}:${env[TEST_STATE_ROOT_ENV] ?? ""}:${env[TEST_SANDBOX_NONCE_ENV] ?? ""}:${idlockLane ?? ""}`;
  if (!options.force && cachedVerification && cachedVerification.key === cacheKey) {
    return cachedVerification.receipt;
  }

  const receipt = readAndValidateSandboxReceipt(env);

  // Verify R stat identity and permissions.
  let rootStat;
  try {
    rootStat = lstatSync(receipt.root);
  } catch (error) {
    throw new UnconfinedTestRunError(`cannot stat attested root ${receipt.root}: ${error.message}`);
  }
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    String(rootStat.dev) !== receipt.rootDev ||
    String(rootStat.ino) !== receipt.rootIno
  ) {
    throw new UnconfinedTestRunError("attested root dev/ino or type mismatch");
  }
  if (typeof process.getuid === "function" && rootStat.uid !== process.getuid()) {
    throw new UnconfinedTestRunError("attested root UID mismatch");
  }
  if ((rootStat.mode & 0o077) !== 0) {
    throw new UnconfinedTestRunError("attested root must be mode 0700");
  }

  if (process.platform === "linux") {
    let mntNs;
    try {
      mntNs = readlinkSync("/proc/self/ns/mnt");
    } catch (error) {
      throw new UnconfinedTestRunError(`cannot read /proc/self/ns/mnt: ${error.message}`);
    }
    if (receipt.mountNamespace && mntNs !== receipt.mountNamespace) {
      throw new UnconfinedTestRunError(
        `mount namespace mismatch: expected ${receipt.mountNamespace}, got ${mntNs}`,
      );
    }
    if (receipt.hostMountNamespace && mntNs === receipt.hostMountNamespace) {
      throw new UnconfinedTestRunError("process is still in the host mount namespace");
    }
    if (receipt.networkMode === "isolated") {
      let netNs;
      try {
        netNs = readlinkSync("/proc/self/ns/net");
      } catch (error) {
        throw new UnconfinedTestRunError(`cannot read /proc/self/ns/net: ${error.message}`);
      }
      if (receipt.netNamespace && netNs !== receipt.netNamespace) {
        throw new UnconfinedTestRunError("network namespace mismatch");
      }
      if (receipt.hostNetNamespace && netNs === receipt.hostNetNamespace) {
        throw new UnconfinedTestRunError("process is still in the host network namespace");
      }
    }

    let mounts;
    try {
      mounts = parseMountInfo(readFileSync(`/proc/${process.pid}/mountinfo`, "utf8"));
    } catch (error) {
      throw new UnconfinedTestRunError(`cannot read /proc/${process.pid}/mountinfo: ${error.message}`);
    }

    const rMount = findCoveringMount(mounts, SANDBOX_MOUNT_ROOT);
    if (!rMount || rMount.mountPoint !== SANDBOX_MOUNT_ROOT || !isMountReadWrite(rMount)) {
      throw new UnconfinedTestRunError(`${SANDBOX_MOUNT_ROOT} is not mounted read-write`);
    }
    const receiptMount = findCoveringMount(mounts, SANDBOX_RECEIPT_PATH);
    if (!receiptMount || !isMountReadOnly(receiptMount)) {
      throw new UnconfinedTestRunError(`${SANDBOX_RECEIPT_PATH} is not mounted read-only`);
    }
    const witnessMount = findCoveringMount(mounts, receipt.roWitness);
    if (!witnessMount || !isMountReadOnly(witnessMount)) {
      throw new UnconfinedTestRunError(`${receipt.roWitness} is not mounted read-only`);
    }
    const checkoutMount = findCoveringMount(mounts, receipt.checkout);
    if (!checkoutMount || !isMountReadOnly(checkoutMount)) {
      throw new UnconfinedTestRunError(`checkout ${receipt.checkout} is not mounted read-only`);
    }

    // Verify the three required aliases: .qual-tmp, tmp/test-runtime, /tmp -> compat-tmp (C5).
    const requiredVisible = [
      join(receipt.checkout, ".qual-tmp"),
      join(receipt.checkout, "tmp", "test-runtime"),
      "/tmp",
    ];
    for (const visible of requiredVisible) {
      const entry = receipt.aliases.find((a) => resolve(a.visible) === resolve(visible));
      if (!entry) {
        throw new UnconfinedTestRunError(`receipt missing required alias entry: ${visible}`);
      }
      if (visible === "/tmp" && entry.target !== COMPAT_TMP_TARGET) {
        throw new UnconfinedTestRunError(
          `receipt /tmp alias must target ${COMPAT_TMP_TARGET}, got ${entry.target}`,
        );
      }
    }
    for (const alias of receipt.aliases) {
      const backing = join(receipt.root, alias.target);
      let visStat;
      let backStat;
      try {
        visStat = statSync(alias.visible);
        backStat = statSync(backing);
      } catch (error) {
        throw new UnconfinedTestRunError(
          `cannot stat alias ${alias.visible} -> ${backing}: ${error.message}`,
        );
      }
      if (
        String(visStat.dev) !== alias.dev ||
        String(visStat.ino) !== alias.ino ||
        String(backStat.dev) !== alias.dev ||
        String(backStat.ino) !== alias.ino
      ) {
        throw new UnconfinedTestRunError(
          `alias dev/ino mismatch for ${alias.visible} -> ${alias.target}`,
        );
      }
      const aliasMount = findCoveringMount(mounts, alias.visible);
      if (!aliasMount || resolve(aliasMount.mountPoint) !== resolve(alias.visible)) {
        throw new UnconfinedTestRunError(
          `alias ${alias.visible} is not a real mount point in mountinfo`,
        );
      }
    }

    runReadOnlyWitnessProbe(receipt.roWitness, true);
  } else {
    // macOS sandbox-exec
    runReadOnlyWitnessProbe(receipt.roWitness, false);
  }

  // Positive write probe: in canonical IDLOCK_LANE I when active, else in R.
  let probeDir = receipt.root;
  if (idlockLane !== undefined && idlockLane.length > 0) {
    probeDir = resolveCanonicalInsideRoot(idlockLane, receipt.root);
  }
  runPositiveWriteProbe(probeDir);

  cachedVerification = { key: cacheKey, receipt };
  return receipt;
}

export function isSandboxConfined(env = process.env) {
  try {
    verifySandboxConfinement(env);
    return true;
  } catch {
    return false;
  }
}

/**
 * Translate a destination under an attested alias (.qual-tmp, tmp/test-runtime,
 * /tmp -> compat-tmp) or writable mount declared in the read-only receipt into
 * its backing path under R, verifying live dev/ino identity first.
 */
export function resolveAttestedAlias(destination, receipt) {
  const abs = resolve(destination);
  const candidates = [
    ...(receipt.aliases ?? []),
    ...(receipt.writableMounts ?? []),
  ].sort((a, b) => b.visible.length - a.visible.length);

  for (const entry of candidates) {
    const visible = resolve(entry.visible);
    const rel = relative(visible, abs);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
      const backing = join(receipt.root, entry.target);
      try {
        const visStat = statSync(visible);
        const backStat = statSync(backing);
        if (
          String(visStat.dev) !== entry.dev ||
          String(visStat.ino) !== entry.ino ||
          String(backStat.dev) !== entry.dev ||
          String(backStat.ino) !== entry.ino
        ) {
          return null;
        }
      } catch {
        return null;
      }
      return rel ? join(backing, rel) : backing;
    }
  }
  return destination;
}

/**
 * Check whether `candidate` resolves inside `R` or an attested alias backed by `R`.
 */
export function isPathWithinAttestedRoot(candidate, receipt) {
  if (typeof candidate !== "string" || !isAbsolute(candidate)) return false;
  const translated = resolveAttestedAlias(candidate, receipt);
  if (translated === null) return false;
  const absRoot = resolve(receipt.root);
  let effectiveRoot = absRoot;
  try { effectiveRoot = realpathSync(absRoot); } catch { /* fallback */ }

  // Walk existing ancestors without escaping root.
  const abs = resolve(translated);
  let cur = abs;
  for (let i = 0; i < 64; i += 1) {
    try {
      lstatSync(cur);
      break;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  let realBase = cur;
  try { realBase = realpathSync(cur); } catch { /* ignore */ }
  const effective = join(realBase, relative(cur, abs));
  // If realpath returned the alias visible path (e.g. /tmp on a bind mount),
  // translate one more time through the verified alias table.
  const finalPath = resolveAttestedAlias(effective, receipt);
  if (finalPath === null) return false;
  return isWithinDirectory(finalPath, effectiveRoot);
}

// Allocate a fresh worker root R/w-<id>/{home,state,config,runtime,cache,data,tmp}
// (or I/w-<id> when IDLOCK_LANE is active) with mode 0700.
export function allocateWorkerRoot(receipt, env = process.env, options = {}) {
  let base = receipt.root;
  if (env.IDLOCK_LANE && env.IDLOCK_LANE.length > 0) {
    base = resolveCanonicalInsideRoot(env.IDLOCK_LANE, receipt.root);
  }
  const tag = options.tag ?? `w-${process.pid}-${threadId}-`;
  const workerRoot = mkdtempSync(join(base, tag));
  for (const sub of ["home", "state", "config", "runtime", "cache", "data", "tmp", "store"]) {
    mkdirSync(join(workerRoot, sub), { recursive: true, mode: 0o700 });
  }
  const hostLog = join(workerRoot, "state", "native-host.log");
  return {
    workerRoot,
    env: {
      HOME: join(workerRoot, "home"),
      XDG_STATE_HOME: join(workerRoot, "state"),
      XDG_CONFIG_HOME: join(workerRoot, "config"),
      XDG_RUNTIME_DIR: join(workerRoot, "runtime"),
      XDG_CACHE_HOME: join(workerRoot, "cache"),
      XDG_DATA_HOME: join(workerRoot, "data"),
      TMPDIR: join(workerRoot, "tmp"),
      TMP: join(workerRoot, "tmp"),
      TEMP: join(workerRoot, "tmp"),
      REMOTE_CLI_CONFIG_HOME: join(workerRoot, "config"),
      H2A_ROOT: join(workerRoot, "store"),
      H2A_NATIVE_SOCKET: join(workerRoot, "runtime", "host.sock"),
      H2A_NATIVE_HOST_LOG: hostLog,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(workerRoot, "runtime", "no-bus")}`,
      [TEST_STATE_ROOT_ENV]: env[TEST_STATE_ROOT_ENV] || receipt.root,
      [TEST_STATE_QUALIFICATION_ROOT_ENV]: receipt.root,
      [TEST_WORKER_ROOT_ENV]: workerRoot,
      [TEST_WORKER_PID_ENV]: `${options.roleTag ?? "sup"}:${process.pid}`,
    },
  };
}

const CORE_ISOLATED_ENV_KEYS = [
  "HOME",
  "XDG_RUNTIME_DIR",
  "XDG_STATE_HOME",
  "XDG_CONFIG_HOME",
];

const ISOLATED_ENV_KEYS = [
  ...CORE_ISOLATED_ENV_KEYS,
  "TMPDIR",
];

function isSupervisorDefaultPath(value, root) {
  if (!value) return true;
  const r = resolve(root);
  const v = resolve(value);
  return (
    v === r ||
    v === join(r, "home") ||
    v === join(r, "state") ||
    v === join(r, "config") ||
    v === join(r, "runtime") ||
    v === join(r, "cache") ||
    v === join(r, "data") ||
    v === join(r, "tmp")
  );
}

// Establish or validate the per-worker environment inside D16.
// - Always rejects any inherited HOME/XDG/TMPDIR/H2A_ROOT outside R/attested aliases.
// - For a fresh test worker (Vitest setup or Node test worker), allocates a
//   distinct R/w-<id> (or I/w-<id>) root so two workers never collide.
// - For a fixture child that already received a complete, private, validated
//   environment strictly inside R (distinct from the parent supervisor's bare
//   R/{home,tmp,...}), preserves that fixture environment verbatim.
export function ensureWorkerEnvironment(receipt, targetEnv = process.env, options = {}) {
  const forceNewWorker = options.forceNewWorker === true;
  const workerTag = targetEnv[TEST_WORKER_PID_ENV] ?? "";
  // A fresh `node --test` test-file worker inherits `NODE_TEST_CONTEXT` from
  // the test-runner supervisor (whose workerTag is unset or `sup:<pid>`).
  // Helper children spawned BY an already-initialized test worker inherit
  // `worker:<pid>` and must preserve their validated fixture/worker env.
  const needsFreshNodeTestWorker =
    Boolean(targetEnv.NODE_TEST_CONTEXT) && !workerTag.startsWith("worker:");
  const workerAlreadyInitializedHere =
    Boolean(targetEnv[TEST_WORKER_ROOT_ENV]) &&
    (workerTag === `sup:${process.pid}` || workerTag === `worker:${process.pid}`) &&
    isMainThread &&
    !forceNewWorker;

  // Check if any inherited isolation variable points outside attested R/aliases.
  for (const key of [
    ...ISOLATED_ENV_KEYS,
    "TMP",
    "TEMP",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "REMOTE_CLI_CONFIG_HOME",
    "H2A_ROOT",
    "H2A_NATIVE_SOCKET",
    "H2A_NATIVE_HOST_LOG",
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
    "VIBE_HOME",
  ]) {
    const value = targetEnv[key];
    if (value === undefined || value === "") continue;
    // Allow tests to pass intentionally relative H2A_ROOT (e.g. ".h2a") so
    // production validation can reject it; the read-only OS barrier and
    // test-state-guard.ts still block any write outside R.
    if (key === "H2A_ROOT" && !isAbsolute(value)) continue;
    if (!isPathWithinAttestedRoot(value, receipt)) {
      throw new UnconfinedTestRunError(
        `inherited ${key}=${value} escapes attested root ${receipt.root}`,
      );
    }
  }

  if (workerAlreadyInitializedHere) {
    return { reused: true, workerRoot: targetEnv[TEST_WORKER_ROOT_ENV] };
  }

  // Does this child already carry a custom fixture environment inside R
  // (e.g. a test spawned a child with its own mkdtemp fixture HOME,
  // distinct from both supervisor default R/home and parent worker W/home)?
  // Preserve every caller-set variable verbatim even when NODE_TEST_CONTEXT
  // was inherited via ...process.env or when only a subset of XDG_* was set.
  const hasCustomFixtureEnv =
    Boolean(targetEnv.HOME) &&
    isPathWithinAttestedRoot(targetEnv.HOME, receipt) &&
    !isSupervisorDefaultPath(targetEnv.HOME, receipt.root) &&
    (!targetEnv[TEST_WORKER_ROOT_ENV] ||
      resolve(targetEnv.HOME) !== join(resolve(targetEnv[TEST_WORKER_ROOT_ENV]), "home"));

  if (!forceNewWorker && !needsFreshNodeTestWorker && hasCustomFixtureEnv) {
    // Preserve fixture child's private environment verbatim; only fill missing
    // isolation defaults inside R without overwriting any caller-provided key.
    targetEnv[TEST_STATE_ROOT_ENV] = targetEnv[TEST_STATE_ROOT_ENV] || receipt.root;
    targetEnv[TEST_STATE_QUALIFICATION_ROOT_ENV] = receipt.root;
    const baseDir = targetEnv.XDG_RUNTIME_DIR && isPathWithinAttestedRoot(targetEnv.XDG_RUNTIME_DIR, receipt)
      ? resolve(targetEnv.XDG_RUNTIME_DIR)
      : dirname(resolve(targetEnv.HOME));
    if (!targetEnv.TMPDIR) {
      const fallbackTmp = join(baseDir, "tmp");
      try { mkdirSync(fallbackTmp, { recursive: true, mode: 0o700 }); } catch { /* ignore */ }
      targetEnv.TMPDIR = fallbackTmp;
      targetEnv.TMP = fallbackTmp;
      targetEnv.TEMP = fallbackTmp;
    }
    return { reused: true, workerRoot: targetEnv[TEST_WORKER_ROOT_ENV] ?? dirname(resolve(targetEnv.HOME)) };
  }

  // Also preserve an already-initialized parent worker root for non-test-worker
  // children that inherited it (e.g. helper scripts spawned by a test without
  // overriding HOME) — only test workers (Vitest / node --test) allocate fresh
  // sibling w-* roots.
  const inheritedWorkerRoot = targetEnv[TEST_WORKER_ROOT_ENV];
  if (
    !forceNewWorker &&
    !needsFreshNodeTestWorker &&
    inheritedWorkerRoot &&
    isPathWithinAttestedRoot(inheritedWorkerRoot, receipt) &&
    ISOLATED_ENV_KEYS.every((k) => Boolean(targetEnv[k]) && isPathWithinAttestedRoot(targetEnv[k], receipt))
  ) {
    targetEnv[TEST_STATE_ROOT_ENV] = targetEnv[TEST_STATE_ROOT_ENV] || receipt.root;
    targetEnv[TEST_STATE_QUALIFICATION_ROOT_ENV] = receipt.root;
    return { reused: true, workerRoot: inheritedWorkerRoot };
  }

  // Allocate a brand-new per-worker root.
  const roleTag = forceNewWorker || needsFreshNodeTestWorker ? "worker" : "sup";
  const allocated = allocateWorkerRoot(receipt, targetEnv, { ...options, roleTag });
  // Preserve explicit H2A_NATIVE_SOCKET="" (fleet qualification dual-generation).
  const keepEmptySocket = targetEnv.H2A_NATIVE_SOCKET === "";
  for (const [k, v] of Object.entries(allocated.env)) {
    if (k === "H2A_NATIVE_SOCKET" && keepEmptySocket) continue;
    targetEnv[k] = v;
  }
  return { reused: false, workerRoot: allocated.workerRoot };
}

/**
 * Pure role classifier for N3 CI proof exchange.
 * Returns one of: "m17-run" | "bulk" | "node-shard" | "aggregator" | "focus-perf" | "ordinary".
 */
export function detectSandboxRole(command, env = process.env, repoRoot = process.cwd()) {
  if (!Array.isArray(command) || command.length === 0) {
    return { role: "ordinary", shardIndex: null };
  }
  const [exe, ...args] = command;
  const baseExe = exe.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const isNodeExe = baseExe === "node" || baseExe === "nodejs" || exe === process.execPath;
  const isNpmExe = baseExe === "npm" || baseExe === "npm.cmd";

  const normArg = (a) => {
    if (typeof a !== "string") return "";
    if (isAbsolute(a)) {
      const rel = relative(resolve(repoRoot), resolve(a)).replaceAll("\\", "/");
      if (!rel.startsWith("..") && !isAbsolute(rel)) return rel;
    }
    return a.replace(/^\.\//, "").replaceAll("\\", "/");
  };

  if (isNpmExe && args[0] === "test") {
    return { role: "aggregator", shardIndex: null };
  }

  if (isNodeExe) {
    // Find script entry (first non-flag arg, skipping --import <val>, --test-name-pattern <val>, etc.)
    const valueFlags = new Set(["--import", "--loader", "--experimental-loader", "-r", "--require", "--test-reporter", "--test-reporter-destination", "--test-name-pattern", "--test-skip-pattern"]);
    const positional = [];
    for (let i = 0; i < args.length; i += 1) {
      const a = args[i];
      if (a === "--") {
        positional.push(...args.slice(i + 1));
        break;
      }
      if (valueFlags.has(a)) {
        i += 1;
        continue;
      }
      if (a.startsWith("-")) continue;
      positional.push(a);
    }
    const script = positional.length > 0 ? normArg(positional[0]) : "";
    const isNodeTest = args.includes("--test");

    if (!isNodeTest && script === "scripts/ci-m17-proof.mjs" && positional[1] === "run") {
      return { role: "m17-run", shardIndex: null };
    }
    if (!isNodeTest && script === "scripts/ci-bulk-proof.mjs") {
      return { role: "bulk", shardIndex: null };
    }
    if (!isNodeTest && script === "scripts/run-node-shard.mjs") {
      const shardArg = args.find((a) => a.startsWith("--shard="));
      const shardIndex = shardArg ? Number(shardArg.slice("--shard=".length)) : NaN;
      return {
        role: "node-shard",
        shardIndex: Number.isSafeInteger(shardIndex) ? shardIndex : null,
      };
    }
    if (!isNodeTest && (script === "scripts/run-test-gates.mjs" || script === "scripts/run-tests.mjs")) {
      return { role: "aggregator", shardIndex: null };
    }
    if (
      isNodeTest &&
      positional.length === 1 &&
      script === "packages/h2a/focus-kit/test/evidence-performance-browser.test.mjs"
    ) {
      return { role: "focus-perf", shardIndex: null };
    }
  }
  return { role: "ordinary", shardIndex: null };
}

/**
 * N5 deterministic source manifest for confined lanes (v1).
 */
export function buildSourceManifest(repoRoot, options = {}) {
  const root = resolve(repoRoot);
  const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  const git = (args) =>
    execFileSync("git", args, {
      cwd: root,
      env: gitEnv,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });

  const baseSha = git(["rev-parse", "HEAD"]).toString("utf8").trim();
  assert.match(baseSha, /^[0-9a-f]{40}$/, "HEAD must be a 40-char lowercase SHA");

  const pathSet = new Set();
  const headEntries = new Map();

  // 1. HEAD tree (git ls-tree -r -z HEAD)
  const treeOut = git(["ls-tree", "-r", "-z", "HEAD"]).toString("utf8");
  for (const rec of treeOut.split("\0")) {
    if (!rec) continue;
    const tab = rec.indexOf("\t");
    assert.ok(tab > 0, `malformed ls-tree record: ${rec}`);
    const meta = rec.slice(0, tab).split(" ");
    const mode = meta[0];
    const type = meta[1];
    const path = rec.slice(tab + 1);
    assert.notEqual(mode, "160000", `gitlink refused in source manifest: ${path}`);
    assert.notEqual(type, "commit", `gitlink refused in source manifest: ${path}`);
    pathSet.add(path);
    headEntries.set(path, { mode, oid: meta[2] });
  }

  // 2. Index (git ls-files --stage -z) — refuse unmerged conflicts & gitlinks
  const stageOut = git(["ls-files", "--stage", "-z"]).toString("utf8");
  for (const rec of stageOut.split("\0")) {
    if (!rec) continue;
    const tab = rec.indexOf("\t");
    assert.ok(tab > 0, `malformed ls-files --stage record: ${rec}`);
    const meta = rec.slice(0, tab).split(" ");
    const mode = meta[0];
    const stage = meta[2];
    const path = rec.slice(tab + 1);
    assert.equal(stage, "0", `index conflict refused in source manifest: ${path} (stage ${stage})`);
    assert.notEqual(mode, "160000", `gitlink refused in index: ${path}`);
    pathSet.add(path);
  }

  // 3. Cached + untracked non-ignored files
  const filesOut = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).toString("utf8");
  for (const path of filesOut.split("\0")) {
    if (!path) continue;
    pathSet.add(path);
  }

  // Sort by unsigned UTF-8 byte order
  const sortedPaths = [...pathSet].sort((a, b) =>
    Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")),
  );

  // Optional allow-list check for differences relative to HEAD
  if (options.allowedPaths) {
    const allowed = new Set(
      [...options.allowedPaths].map((p) => p.replaceAll("\\", "/").replace(/^\.\//, "")),
    );
    const diffOut = git(["diff", "--name-only", "-z", "HEAD"]).toString("utf8");
    const cachedDiffOut = git(["diff", "--cached", "--name-only", "-z", "HEAD"]).toString("utf8");
    const othersOut = git(["ls-files", "--others", "--exclude-standard", "-z"]).toString("utf8");
    for (const changed of [
      ...diffOut.split("\0"),
      ...cachedDiffOut.split("\0"),
      ...othersOut.split("\0"),
    ]) {
      if (!changed) continue;
      if (!allowed.has(changed)) {
        throw new Error(`source manifest change outside closed lot allow-list: ${changed}`);
      }
    }
  }

  const hasher = createHash("sha256");
  hasher.update("INJ-L0-v1\0", "ascii");
  hasher.update(`${baseSha}\0`, "ascii");

  const entries = [];
  for (const relPath of sortedPaths) {
    const full = join(root, relPath);
    let st;
    try {
      st = lstatSync(full);
    } catch (error) {
      if (error.code === "ENOENT") {
        // Tracked entry deleted from working tree
        const entry = { mode: "000000", path: relPath, digest: "-" };
        entries.push(entry);
        hasher.update(`${entry.mode}\0`, "ascii");
        hasher.update(relPath, "utf8");
        hasher.update(`\0${entry.digest}\0`, "ascii");
        continue;
      }
      throw error;
    }

    let mode;
    let digest;
    if (st.isSymbolicLink()) {
      mode = "120000";
      const targetBytes = readlinkSync(full, "buffer");
      digest = createHash("sha256").update(targetBytes).digest("hex");
    } else if (st.isFile()) {
      mode = (st.mode & 0o111) !== 0 ? "100755" : "100644";
      digest = createHash("sha256").update(readFileSync(full)).digest("hex");
    } else {
      throw new Error(`unsupported special file in source manifest: ${relPath}`);
    }

    const entry = { mode, path: relPath, digest };
    entries.push(entry);
    hasher.update(`${mode}\0`, "ascii");
    hasher.update(relPath, "utf8");
    hasher.update(`\0${digest}\0`, "ascii");
  }

  return {
    version: 1,
    baseSha,
    sourceSha256: hasher.digest("hex"),
    entries,
  };
}

const REQUEST_KEYS = Object.freeze([
  "argv",
  "baseSha",
  "files",
  "id",
  "runner",
  "sourceSha256",
  "version",
]);

const RECEIPT_KEYS = Object.freeze([
  ...REQUEST_KEYS,
  "barrier",
  "executor",
  "exitCode",
  "failed",
  "node",
  "passed",
  "platform",
  "reports",
  "skipped",
].sort());

const BARRIER_KEYS = Object.freeze([
  "backend",
  "namespace",
  "readOnlyProbe",
  "rootDev",
  "rootIno",
  "writeProbe",
]);

function assertExactKeys(obj, expectedKeys, label) {
  assert.ok(obj && typeof obj === "object" && !Array.isArray(obj), `${label} must be an object`);
  assert.deepEqual(
    Object.keys(obj).sort(),
    [...expectedKeys].sort(),
    `${label} keys mismatch`,
  );
}

/**
 * Validate a confined-lane qualification request and receipt (v1, N5).
 */
export function verifyLaneReceipt(request, receipt, options = {}) {
  assertExactKeys(request, REQUEST_KEYS, "lane request");
  assert.equal(request.version, 1, "lane request version must be 1");
  assert.match(request.id, /^[0-9a-f]{32}$/, "lane request id must be 32 lowercase hex chars");
  assert.match(request.baseSha, /^[0-9a-f]{40}$/, "lane request baseSha must be 40 lowercase hex chars");
  assert.match(request.sourceSha256, /^[0-9a-f]{64}$/, "lane request sourceSha256 must be 64 lowercase hex chars");
  assert.ok(request.runner === "node" || request.runner === "vitest", "lane request runner must be node or vitest");
  assert.ok(Array.isArray(request.files) && request.files.length > 0, "lane request files must be non-empty");
  const seenFiles = new Set();
  for (const file of request.files) {
    assert.ok(
      typeof file === "string" &&
        file.length > 0 &&
        !file.startsWith("/") &&
        !file.includes("\\") &&
        !file.split("/").includes("..") &&
        !file.startsWith("./"),
      `invalid normalized repo file in request: ${file}`,
    );
    assert.ok(!seenFiles.has(file), `duplicate file in request: ${file}`);
    seenFiles.add(file);
  }
  assert.ok(
    Array.isArray(request.argv) &&
      request.argv.length > 0 &&
      request.argv.every((arg) => typeof arg === "string" && arg.length > 0),
    "lane request argv must be a non-empty string array",
  );

  if (options.expectedRequest) {
    assert.ok(
      isDeepStrictEqual(request, options.expectedRequest),
      "lane request does not match conductor-recorded original request",
    );
  }

  assertExactKeys(receipt, RECEIPT_KEYS, "lane receipt");
  for (const key of REQUEST_KEYS) {
    assert.ok(
      isDeepStrictEqual(receipt[key], request[key]),
      `lane receipt field ${key} does not match request`,
    );
  }

  if (options.expectedExecutor !== undefined) {
    assert.ok(
      isDeepStrictEqual(receipt.executor, options.expectedExecutor),
      "lane receipt executor does not match registered executor",
    );
  } else {
    assert.ok(
      (typeof receipt.executor === "string" && receipt.executor.length > 0) ||
        (receipt.executor && typeof receipt.executor === "object" && Object.keys(receipt.executor).length > 0),
      "lane receipt executor is required",
    );
  }

  assert.ok(typeof receipt.platform === "string" && receipt.platform.length > 0, "lane receipt platform required");
  assert.match(receipt.node, /^v\d+\.\d+\.\d+/, "lane receipt node version required");

  assertExactKeys(receipt.barrier, BARRIER_KEYS, "lane receipt barrier");
  assert.ok(typeof receipt.barrier.backend === "string" && receipt.barrier.backend.length > 0);
  assert.ok(typeof receipt.barrier.rootDev === "string" && receipt.barrier.rootDev.length > 0);
  assert.ok(typeof receipt.barrier.rootIno === "string" && receipt.barrier.rootIno.length > 0);
  assert.ok(typeof receipt.barrier.namespace === "string" && receipt.barrier.namespace.length > 0);
  assert.equal(receipt.barrier.readOnlyProbe, true, "barrier readOnlyProbe must be true");
  assert.equal(receipt.barrier.writeProbe, true, "barrier writeProbe must be true");

  assert.ok(Number.isSafeInteger(receipt.exitCode), "exitCode must be an integer");
  assert.ok(Number.isSafeInteger(receipt.passed), "passed must be an integer");
  assert.ok(Number.isSafeInteger(receipt.failed), "failed must be an integer");
  assert.ok(Number.isSafeInteger(receipt.skipped), "skipped must be an integer");

  assert.equal(receipt.exitCode, 0, "lane receipt exitCode must be 0");
  assert.ok(receipt.passed > 0, "lane receipt passed count must be > 0");
  assert.equal(receipt.failed, 0, "lane receipt failed count must be 0");
  assert.equal(receipt.skipped, 0, "lane receipt skipped count must be 0");

  assert.ok(Array.isArray(receipt.reports) && receipt.reports.length > 0, "lane receipt reports must be non-empty");
  for (const rep of receipt.reports) {
    assertExactKeys(rep, ["path", "sha256"], "lane receipt report entry");
    assert.ok(
      typeof rep.path === "string" &&
        rep.path.length > 0 &&
        !isAbsolute(rep.path) &&
        !rep.path.split("/").includes(".."),
      `invalid report relative path: ${rep.path}`,
    );
    assert.match(rep.sha256, /^[0-9a-f]{64}$/, `invalid report sha256: ${rep.sha256}`);
  }

  if (options.controlDir) {
    const controlRoot = resolve(options.controlDir);
    let recomputedPassed = 0;
    let recomputedFailed = 0;
    let recomputedSkipped = 0;
    const observedFiles = new Set();

    for (const rep of receipt.reports) {
      const full = resolve(controlRoot, rep.path);
      assert.ok(isWithinDirectory(full, controlRoot), `report escapes control dir: ${rep.path}`);
      const st = lstatSync(full);
      assert.ok(st.isFile() && !st.isSymbolicLink(), `report must be regular file: ${rep.path}`);
      const bytes = readFileSync(full);
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      assert.equal(actualHash, rep.sha256, `report sha256 mismatch for ${rep.path}`);
      const parsed = JSON.parse(bytes.toString("utf8"));
      assert.ok(Array.isArray(parsed.testResults), `report missing testResults: ${rep.path}`);
      for (const suite of parsed.testResults) {
        assert.equal(typeof suite.name, "string");
        const normName = suite.name.replaceAll("\\", "/");
        for (const reqFile of request.files) {
          if (normName === reqFile || normName.endsWith(`/${reqFile}`)) {
            observedFiles.add(reqFile);
          }
        }
        assert.ok(Array.isArray(suite.assertionResults) && suite.assertionResults.length > 0);
        for (const assertion of suite.assertionResults) {
          if (assertion.status === "passed") recomputedPassed += 1;
          else if (assertion.status === "failed") recomputedFailed += 1;
          else recomputedSkipped += 1;
        }
      }
    }

    assert.deepEqual(
      [...observedFiles].sort(),
      [...request.files].sort(),
      "lane reports do not cover the exact requested files",
    );
    assert.equal(recomputedPassed, receipt.passed, "recomputed passed count mismatch");
    assert.equal(recomputedFailed, receipt.failed, "recomputed failed count mismatch");
    assert.equal(recomputedSkipped, receipt.skipped, "recomputed skipped count mismatch");
  }

  return true;
}

/** Convenience: string-only owner state path check (never reads owner state). */
export function ownerStateRoots(env = process.env) {
  const home = env[TEST_OWNER_HOME_ENV] || homedir();
  return [
    join(home, ".local", "state", "h2a"),
    join(home, ".config", "sentropic", "h2a"),
    join(home, ".config", "sentropic", "remote-cli"),
    join(home, ".config", "h2a"),
  ];
}
