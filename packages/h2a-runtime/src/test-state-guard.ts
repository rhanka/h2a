import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/**
 * Lot L0 (D16) — single mutation-point guard seam for test-state isolation.
 *
 * Self-contained inside `@sentropic/h2a-runtime` with zero dependencies on
 * repository scripts.
 *
 * Activation rule (INJ N2 / Étape 3):
 *   - `H2A_TEST_STATE_ROOT` is the sole activation predicate.
 *   - Outside a marked run (no `H2A_TEST_STATE_ROOT` and no stray D16 env
 *     component), this module is completely inert (`H2A_TEST_QUALIFICATION_ROOT`
 *     alone stays an inert historical variable with no D16 scope).
 *   - Any reserved D16 component without `H2A_TEST_STATE_ROOT`, or
 *     `H2A_TEST_STATE_ROOT` without a valid receipt, fails closed before any
 *     mutation.
 *   - Under a valid marked run, every destination is validated at call time:
 *     existing ancestors, non-existing suffixes, symlink targets, and attested
 *     aliases (including C5 `/tmp` -> `R/compat-tmp` verified by `dev`/`ino`).
 */

export const TEST_STATE_ROOT_ENV = "H2A_TEST_STATE_ROOT";
export const TEST_STATE_RECEIPT_ENV = "H2A_TEST_STATE_RECEIPT";
export const TEST_STATE_ATTESTATION_ENV = "H2A_TEST_STATE_ATTESTATION";
export const TEST_STATE_BARRIER_ENV = "H2A_TEST_STATE_BARRIER";
export const TEST_SANDBOX_NONCE_ENV = "H2A_TEST_SANDBOX_NONCE";
export const TEST_OWNER_HOME_ENV = "H2A_TEST_OWNER_HOME";

const SANDBOX_LINUX_RECEIPT_PATH = "/run/h2a-test/receipt.json";
const COMPAT_TMP_TARGET = "compat-tmp";

const RESERVED_D16_COMPANION_ENVS = [
  TEST_STATE_BARRIER_ENV,
  TEST_SANDBOX_NONCE_ENV,
  TEST_STATE_RECEIPT_ENV,
  TEST_STATE_ATTESTATION_ENV,
] as const;

export class TestStateRefusalError extends Error {
  constructor(destination: string, detail?: string) {
    super(
      detail
        ? `REFUSING test-state write outside the test state root (${detail}): ${destination}`
        : `REFUSING test-state write outside the test state root: ${destination}`,
    );
    this.name = "TestStateRefusalError";
  }
}

export class UnconfinedTestRunError extends Error {
  constructor(detail: string) {
    super(`REFUSING unconfined test run before test evaluation: ${detail}`);
    this.name = "UnconfinedTestRunError";
  }
}

export interface TestStateAliasEntry {
  readonly visible: string;
  readonly target: string;
  readonly dev: string;
  readonly ino: string;
}

export interface TestStateReceipt {
  readonly version: 1;
  readonly backend: "bwrap" | "sandbox-exec";
  readonly root: string;
  readonly rootDev: string;
  readonly rootIno: string;
  readonly uid: number;
  readonly nonce: string;
  readonly checkout: string;
  readonly roWitness: string;
  readonly aliases: readonly TestStateAliasEntry[];
  readonly writableMounts?: readonly TestStateAliasEntry[];
}

/** Marked root for this process, or undefined when unmarked (production). */
export function testStateRoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const root = env[TEST_STATE_ROOT_ENV];
  return root !== undefined && root.length > 0 ? root : undefined;
}

function hasAnyD16CompanionEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return RESERVED_D16_COMPANION_ENVS.some((key) => {
    const val = env[key];
    return val !== undefined && val.length > 0;
  });
}

export function isTestStateMarked(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return testStateRoot(env) !== undefined || hasAnyD16CompanionEnv(env);
}

function isWithinRoot(effective: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(effective));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isValidAliasEntry(entry: unknown): entry is TestStateAliasEntry {
  if (!entry || typeof entry !== "object") return false;
  const a = entry as Record<string, unknown>;
  return (
    typeof a.visible === "string" &&
    isAbsolute(a.visible) &&
    typeof a.target === "string" &&
    a.target.length > 0 &&
    !isAbsolute(a.target) &&
    !a.target.split("/").includes("..") &&
    typeof a.dev === "string" &&
    /^\d+$/.test(a.dev) &&
    typeof a.ino === "string" &&
    /^\d+$/.test(a.ino)
  );
}

/** Read and validate the read-only D16 receipt bound to `env`. */
export function readTestStateReceipt(
  env: Readonly<Record<string, string | undefined>> = process.env,
): TestStateReceipt {
  const marker = testStateRoot(env);
  if (marker === undefined) {
    throw new UnconfinedTestRunError(
      "reserved D16 component set without H2A_TEST_STATE_ROOT",
    );
  }
  if (!isAbsolute(marker)) {
    throw new UnconfinedTestRunError(`H2A_TEST_STATE_ROOT must be absolute: ${marker}`);
  }
  if (env[TEST_STATE_BARRIER_ENV] !== "1") {
    throw new UnconfinedTestRunError(
      "filesystem barrier not active (run through scripts/test-sandbox.mjs)",
    );
  }
  const nonce = env[TEST_SANDBOX_NONCE_ENV];
  if (typeof nonce !== "string" || !/^[0-9a-f]{32,}$/.test(nonce)) {
    throw new UnconfinedTestRunError("missing or malformed H2A_TEST_SANDBOX_NONCE");
  }

  let receiptPath: string;
  const envReceipt = env[TEST_STATE_RECEIPT_ENV];
  if (process.platform === "linux") {
    if (envReceipt !== undefined && envReceipt !== SANDBOX_LINUX_RECEIPT_PATH) {
      throw new UnconfinedTestRunError(
        `contradictory receipt path on Linux: ${envReceipt}`,
      );
    }
    receiptPath = SANDBOX_LINUX_RECEIPT_PATH;
  } else {
    if (!envReceipt || !isAbsolute(envReceipt)) {
      throw new UnconfinedTestRunError("missing H2A_TEST_STATE_RECEIPT");
    }
    if (isWithinRoot(envReceipt, marker)) {
      throw new UnconfinedTestRunError("receipt must live outside H2A_TEST_STATE_ROOT");
    }
    receiptPath = envReceipt;
  }

  let raw: string;
  try {
    const lst = lstatSync(receiptPath);
    if (!lst.isFile() || lst.isSymbolicLink()) {
      throw new UnconfinedTestRunError(`receipt is not a regular file: ${receiptPath}`);
    }
    raw = readFileSync(receiptPath, "utf8");
  } catch (error) {
    if (error instanceof UnconfinedTestRunError) throw error;
    throw new UnconfinedTestRunError(`cannot read receipt ${receiptPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new UnconfinedTestRunError(`receipt is not valid JSON: ${receiptPath}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new UnconfinedTestRunError("receipt must be an object");
  }
  const r = parsed as Record<string, unknown>;
  if (
    r.version !== 1 ||
    (r.backend !== "bwrap" && r.backend !== "sandbox-exec") ||
    typeof r.root !== "string" ||
    !isAbsolute(r.root) ||
    typeof r.rootDev !== "string" ||
    !/^\d+$/.test(r.rootDev) ||
    typeof r.rootIno !== "string" ||
    !/^\d+$/.test(r.rootIno) ||
    typeof r.uid !== "number" ||
    typeof r.nonce !== "string" ||
    r.nonce !== nonce ||
    typeof r.checkout !== "string" ||
    !isAbsolute(r.checkout) ||
    typeof r.roWitness !== "string" ||
    !isAbsolute(r.roWitness) ||
    !Array.isArray(r.aliases) ||
    !r.aliases.every(isValidAliasEntry)
  ) {
    throw new UnconfinedTestRunError(`receipt malformed or nonce mismatch: ${receiptPath}`);
  }
  if (
    r.writableMounts !== undefined &&
    (!Array.isArray(r.writableMounts) || !r.writableMounts.every(isValidAliasEntry))
  ) {
    throw new UnconfinedTestRunError(`receipt writableMounts malformed: ${receiptPath}`);
  }
  if (typeof process.getuid === "function" && r.uid !== process.getuid()) {
    throw new UnconfinedTestRunError("receipt UID mismatch");
  }

  // Verify live stat identity of receipt.root.
  let rootStat;
  try {
    rootStat = lstatSync(r.root);
  } catch {
    throw new UnconfinedTestRunError(`cannot stat receipt root: ${r.root}`);
  }
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    String(rootStat.dev) !== r.rootDev ||
    String(rootStat.ino) !== r.rootIno
  ) {
    throw new UnconfinedTestRunError("receipt root dev/ino mismatch");
  }

  const receipt = parsed as TestStateReceipt;
  // Marker must equal receipt.root or narrow strictly inside it (never widen).
  const resolvedMarker = resolveEffectivePath(marker);
  const resolvedReceiptRoot = resolveEffectivePath(receipt.root);
  if (!isWithinRoot(resolvedMarker, resolvedReceiptRoot)) {
    throw new UnconfinedTestRunError(
      `H2A_TEST_STATE_ROOT (${marker}) escapes receipt root (${receipt.root})`,
    );
  }

  return receipt;
}

/**
 * Confinement gate for setup/preload/tests: verifies the read-only launcher
 * receipt and live barrier before any test or product module runs.
 */
export function assertConfinedTestEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): TestStateReceipt {
  return readTestStateReceipt(env);
}

/**
 * Resolve existing ancestors through symlinks (failing on cyclic symlinks)
 * and re-append the non-existing suffix.
 */
export function resolveEffectivePath(candidate: string): string {
  const absolute = resolve(candidate);
  let current = absolute;
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      lstatSync(current);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  const realBase = realpathSync(current);
  const suffix = relative(current, absolute);
  return suffix ? join(realBase, suffix) : realBase;
}

/**
 * Translate a candidate path under an attested alias (`.qual-tmp`,
 * `tmp/test-runtime`, or C5 `/tmp` -> `R/compat-tmp`) or writable mount entry
 * into its backing path under `receipt.root`, verifying live `dev`/`ino` on
 * both the visible mount and the backing directory at call time.
 *
 * Returns `null` if the path sits under `/tmp` without a verified `compat-tmp`
 * alias, or if a matching alias fails its live `dev`/`ino` check.
 */
export function translateAttestedAlias(
  candidate: string,
  receipt: TestStateReceipt,
): string | null {
  const abs = resolve(candidate);
  const isGuestTmp = abs === "/tmp" || abs.startsWith("/tmp/");

  const table: TestStateAliasEntry[] = [
    ...receipt.aliases,
    ...(receipt.writableMounts ?? []),
  ].sort((a, b) => b.visible.length - a.visible.length);

  for (const entry of table) {
    const visible = resolve(entry.visible);
    const rel = relative(visible, abs);
    if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) continue;

    // C5: `/tmp` MUST map to `compat-tmp`.
    if (visible === "/tmp" && entry.target !== COMPAT_TMP_TARGET) {
      return null;
    }

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

  // `/tmp` without an attested `compat-tmp` alias is always refused.
  if (isGuestTmp) return null;
  return abs;
}

/**
 * Validate `destination` (including existing ancestors, symlink hops, suffix,
 * and attested aliases) against the marked test-state root.
 *
 * Inert when unmarked (production). Under any D16 env component, fails closed
 * with `TestStateRefusalError` before any filesystem mutation.
 */
export function guardTestStateWrite(
  destination: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const marker = testStateRoot(env);
  if (marker === undefined) {
    if (hasAnyD16CompanionEnv(env)) {
      throw new TestStateRefusalError(
        destination,
        "reserved D16 env var set without H2A_TEST_STATE_ROOT",
      );
    }
    return;
  }
  if (!isAbsolute(destination)) {
    throw new TestStateRefusalError(destination, "non-absolute path");
  }

  let receipt: TestStateReceipt;
  try {
    receipt = readTestStateReceipt(env);
  } catch (error) {
    throw new TestStateRefusalError(
      destination,
      error instanceof Error ? error.message : String(error),
    );
  }

  const translated = translateAttestedAlias(destination, receipt);
  if (translated === null) {
    throw new TestStateRefusalError(destination, "missing or mismatched alias identity");
  }

  let effectiveRoot: string;
  let effectiveDest: string;
  try {
    effectiveRoot = resolveEffectivePath(marker);
    effectiveDest = resolveEffectivePath(translated);
  } catch (error) {
    throw new TestStateRefusalError(
      destination,
      `unresolvable path: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // `realpathSync` on Linux bind mounts can surface `/tmp/...` again;
  // re-translate once through the verified alias table and re-verify.
  const finalDest = translateAttestedAlias(effectiveDest, receipt);
  if (finalDest === null) {
    throw new TestStateRefusalError(destination, "resolved target alias verification failed");
  }

  if (!isWithinRoot(finalDest, effectiveRoot)) {
    throw new TestStateRefusalError(destination);
  }
}

/** Revalidate both endpoints of a rename, move, link or copy before effect. */
export function guardTestStateMove(
  fromPath: string,
  toPath: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  guardTestStateWrite(fromPath, env);
  guardTestStateWrite(toPath, env);
}

function ownerStatePaths(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const home = env[TEST_OWNER_HOME_ENV] || homedir();
  return [
    join(home, ".local", "state", "h2a"),
    join(home, ".config", "sentropic", "h2a"),
    join(home, ".config", "sentropic", "remote-cli"),
    join(home, ".config", "h2a"),
  ];
}

/**
 * Negative control: fails when the given environment still resolves state
 * under owner state paths. Pure path computation — never reads owner state.
 */
export function assertTestEnvironmentIsolated(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const home = env["HOME"] ?? homedir();
  const stateHome = env["XDG_STATE_HOME"];
  const resolved =
    stateHome !== undefined && stateHome.length > 0 && isAbsolute(stateHome)
      ? join(stateHome, "h2a")
      : join(home, ".local", "state", "h2a");
  for (const owned of ownerStatePaths(env)) {
    if (isWithinRoot(resolved, owned)) {
      throw new UnconfinedTestRunError(
        `test environment resolves state under owner state: ${resolved}`,
      );
    }
  }
}
