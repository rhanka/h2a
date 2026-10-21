import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

/**
 * Lot L0 — single mutation-point guard seam for test-state isolation.
 *
 * When a test run is marked (H2A_TEST_STATE_ROOT set by the authorised
 * launcher/setup), every inventoried writer validates its EFFECTIVE
 * destination at the mutation point — following symlinks, before any
 * directory, lock or file is created. Outside the marked root the writer
 * must refuse (named error, zero bytes). Outside a marked run this module
 * is inert: production behaviour is unchanged.
 */

export const TEST_STATE_ROOT_ENV = "H2A_TEST_STATE_ROOT";
export const TEST_STATE_ATTESTATION_ENV = "H2A_TEST_STATE_ATTESTATION";
export const TEST_STATE_BARRIER_ENV = "H2A_TEST_STATE_BARRIER";
export const TEST_STATE_OVERLAYS_ENV = "H2A_TEST_STATE_OVERLAYS";

export class TestStateRefusalError extends Error {
  constructor(destination: string) {
    super(`REFUSING test-state write outside the test state root: ${destination}`);
    this.name = "TestStateRefusalError";
  }
}

export class UnconfinedTestRunError extends Error {
  constructor(detail: string) {
    super(`REFUSING unconfined test run before test evaluation: ${detail}`);
    this.name = "UnconfinedTestRunError";
  }
}

/** Marked root for this process, or undefined when unmarked (production). */
export function testStateRoot(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const root = env[TEST_STATE_ROOT_ENV];
  return root !== undefined && root.length > 0 ? root : undefined;
}

export function isTestStateMarked(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return testStateRoot(env) !== undefined;
}

function nearestExistingAncestor(path: string): string {
  let current = resolve(path);
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      lstatSync(current);
      return current;
    } catch {
      const parent = resolve(join(current, ".."));
      if (parent === current) return current;
      current = parent;
    }
  }
  return current;
}

/**
 * Effective filesystem destination: nearest existing ancestor resolved
 * through symlinks, with the remainder re-appended. Never throws on
 * missing paths; throws only on unresolvable (cyclic) links.
 */
export function resolveEffectivePath(candidate: string): string {
  const absolute = resolve(candidate);
  const ancestor = nearestExistingAncestor(absolute);
  let realBase: string;
  try {
    realBase = realpathSync(ancestor);
  } catch {
    realBase = ancestor;
  }
  return join(realBase, relative(ancestor, absolute));
}

function isWithinRoot(effective: string, root: string): boolean {
  const rel = relative(resolve(root), effective);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

export type TestStateOverlay = {
  /** Checkout-visible path physically backed by `shadow` inside the barrier. */
  path: string;
  /** Writable per-run backing dir (must resolve inside the marked root). */
  shadow: string;
};

/**
 * Launcher-declared overlay mapping (scripts/test-sandbox.mjs): JSON array
 * of {path, shadow} pairs. Malformed entries never throw — they are
 * ignored, so the check below refuses exactly as without the mapping
 * (fail closed). A mapping can only redirect INTO the marked root, never
 * out of it (shadows outside the root are ignored).
 */
export function readTestStateOverlays(
  env: Readonly<Record<string, string | undefined>> = process.env,
): TestStateOverlay[] {
  const raw = env[TEST_STATE_OVERLAYS_ENV];
  if (raw === undefined || raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const overlays: TestStateOverlay[] = [];
  for (const entry of parsed) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { path?: unknown }).path !== "string" ||
      typeof (entry as { shadow?: unknown }).shadow !== "string"
    ) {
      continue;
    }
    const { path, shadow } = entry as { path: string; shadow: string };
    if (!isAbsolute(path) || !isAbsolute(shadow)) continue;
    overlays.push({ path: resolve(path), shadow: resolve(shadow) });
  }
  return overlays;
}

/**
 * Translate a barrier-overlay checkout path to its run-root backing dir.
 * Inert unless the barrier is active in `env`: outside the barrier no bind
 * mount exists, so the checkout path is real and must be refused as usual.
 * Entries whose shadow falls outside the marked root are ignored.
 */
export function applyTestStateOverlays(
  destination: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (env[TEST_STATE_BARRIER_ENV] !== "1") return destination;
  const root = testStateRoot(env);
  if (root === undefined) return destination;
  const absolute = resolve(destination);
  for (const overlay of readTestStateOverlays(env)) {
    if (!isWithinRoot(overlay.shadow, resolve(root))) continue;
    const rel = relative(overlay.path, absolute);
    if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"))) {
      return join(overlay.shadow, rel);
    }
  }
  return destination;
}

/**
 * Mutation-point check. Inert when unmarked. When marked, throws
 * TestStateRefusalError unless the effective destination (symlinks
 * followed, barrier overlays translated) is inside the marked root.
 * Callers that must never throw catch it and fail closed (drop the row,
 * return false/undefined).
 */
export function guardTestStateWrite(
  destination: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const root = testStateRoot(env);
  if (root === undefined) return;
  if (!isAbsolute(destination)) {
    throw new TestStateRefusalError(destination);
  }
  destination = applyTestStateOverlays(destination, env);
  let effectiveRoot: string;
  try {
    effectiveRoot = realpathSync(root);
  } catch {
    effectiveRoot = resolve(root);
  }
  if (!isWithinRoot(resolveEffectivePath(destination), effectiveRoot)) {
    throw new TestStateRefusalError(destination);
  }
}

export interface TestStateAttestation {
  readonly version: 1;
  readonly root: string;
  readonly nonce: string;
}

/** Read and structurally validate the launcher attestation file. */
export function readTestStateAttestation(
  env: Readonly<Record<string, string | undefined>> = process.env,
): TestStateAttestation {
  const marker = testStateRoot(env);
  const path = env[TEST_STATE_ATTESTATION_ENV];
  if (marker === undefined || path === undefined || path.length === 0) {
    throw new UnconfinedTestRunError("no test-state marker or attestation (run through scripts/test-sandbox.mjs)");
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new UnconfinedTestRunError(`cannot read attestation file: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new UnconfinedTestRunError(`attestation file is not JSON: ${path}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1 ||
    typeof (parsed as { root?: unknown }).root !== "string" ||
    typeof (parsed as { nonce?: unknown }).nonce !== "string" ||
    ((parsed as { nonce?: unknown }).nonce as string).length < 16
  ) {
    throw new UnconfinedTestRunError(`attestation file malformed: ${path}`);
  }
  const attestation = parsed as TestStateAttestation;
  if (resolve(attestation.root) !== resolve(marker)) {
    throw new UnconfinedTestRunError("attestation root does not match the marked test-state root");
  }
  return attestation;
}

/**
 * Confinement gate for setup/preload: verifies the launcher attestation
 * AND the live filesystem barrier before any test or product module is
 * evaluated. Throws UnconfinedTestRunError otherwise. Never falls back.
 */
export function assertConfinedTestEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): TestStateAttestation {
  const attestation = readTestStateAttestation(env);
  if (env[TEST_STATE_BARRIER_ENV] !== "1") {
    throw new UnconfinedTestRunError("filesystem barrier not active (run through scripts/test-sandbox.mjs)");
  }
  return attestation;
}

function ownerStatePaths(): string[] {
  const home = homedir();
  return [
    join(home, ".local", "state", "h2a"),
    join(home, ".config", "h2a"),
  ];
}

/**
 * Negative control: fails when the given environment still points at owner
 * state (real HOME resolving crash-log/journal paths under the owner's
 * home). Pure path computation — reads no owner state.
 */
export function assertTestEnvironmentIsolated(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const home = env["HOME"] ?? homedir();
  const stateHome = env["XDG_STATE_HOME"];
  const resolved = stateHome !== undefined && stateHome.length > 0 && isAbsolute(stateHome)
    ? join(stateHome, "h2a")
    : join(home, ".local", "state", "h2a");
  for (const owned of ownerStatePaths()) {
    const rel = relative(owned, resolve(resolved));
    if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"))) {
      throw new UnconfinedTestRunError(`test environment resolves state under owner state: ${resolved}`);
    }
  }
}
