/**
 * RC2.authority-native — content-free consent-fence supplement.
 *
 * Durable `sourceConsentRevision` without changing historical journal
 * payloads: this fence stores ONLY `{ revision, snapshotDigest }` per consent
 * pair id in its own file. First committed snapshot is revision 1; each
 * changed snapshot commits +1 atomically (temp file + rename, directory
 * fsync). Identical snapshots re-commit nothing. An exclusive interprocess
 * lock covers reads and commits; contention refuses without retry. A lock
 * left by a crashed writer or uncertain publication also refuses: recovery
 * belongs to B5+, never an automatic stale-lock removal.
 *
 * Pair equality (`assertConsentPair`) pins the binding/ACK drive-binding
 * position: the exact selected `requestId` AND `grantId` of the live
 * `projectConsent` projection must match, even when another request projects
 * positive. The A axis (`ownerConsentRevision`) and the native axis
 * (`sourceConsentRevision`) are distinct counters, keyed per pair id — never
 * merged by max, timestamp, or direction.
 */

import { closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmdirSync, writeFileSync, fsyncSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const DIGEST_RE = /^(sha256:)?[a-f0-9]{64}$/;

export type ConsentFenceRefusal =
  | "fence_unavailable"
  | "pair_mismatch"
  | "revision_mismatch";

export interface ConsentSelection {
  readonly requestId: string;
  readonly grantId: string;
}

export type PairCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "pair_mismatch" };

/**
 * Exact selected request/grant equality against the live projection.
 * A binding selected for any other request — even a positive one — refuses.
 */
export function assertConsentPair(
  projected: ConsentSelection,
  selected: ConsentSelection,
): PairCheck {
  if (
    typeof projected?.requestId !== "string" ||
    typeof projected?.grantId !== "string" ||
    typeof selected?.requestId !== "string" ||
    typeof selected?.grantId !== "string"
  ) {
    return { ok: false, reason: "pair_mismatch" };
  }
  if (
    projected.requestId === selected.requestId &&
    projected.grantId === selected.grantId
  ) {
    return { ok: true };
  }
  return { ok: false, reason: "pair_mismatch" };
}

export interface BindingRevision {
  readonly pairId: string;
  readonly consentRevision: number;
  readonly sourceConsentRevision: number;
}

export type RevisionCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "revision_mismatch" };

export interface SourceConsentFence {
  /**
   * Durable revision for the pair id, 0 when never committed. Re-reads
   * the file on every call; throws `fence_unavailable` when the state
   * cannot be read — never serves a stale in-memory revision.
   */
  revisionOf(pairId: string): number;
  /**
   * Commit a snapshot digest: first commit allocates 1, an identical digest
   * reuses the current revision, a changed digest allocates exactly +1.
   */
  commitSnapshot(pairId: string, snapshotDigest: string): number;
}

const FENCE_FILE = "source-consent-revisions.json";
const FENCE_FORMAT = "h2a.source-consent-fence/1";

// After publication, an I/O failure leaves durability unknown. Keep the lock
// so no handle/process can accept those bytes as a confirmed revision.
class FencePublicationUncertain extends Error {}

function withFenceLock<T>(dir: string, action: () => T): T {
  const lock = join(dir, `${FENCE_FILE}.lock`);
  try {
    mkdirSync(lock);
  } catch (err) {
    throw new Error("fence_unavailable: cannot acquire exclusive fence lock", { cause: err });
  }
  let release = true;
  try {
    return action();
  } catch (err) {
    if (err instanceof FencePublicationUncertain) release = false;
    throw err;
  } finally {
    if (release) {
      try {
        rmdirSync(lock);
      } catch (err) {
        throw new Error("fence_unavailable: cannot release fence lock", { cause: err });
      }
    }
  }
}

type FencePairs = Record<string, { revision: number; digest: string }>;

interface FenceState {
  readonly pairs: FencePairs;
  readonly genesis: string;
}

function readState(dir: string): FenceState {
  let raw: string;
  try {
    raw = readFileSync(join(dir, FENCE_FILE), "utf8");
  } catch (err) {
    throw new Error(`fence_unavailable: cannot read fence state in ${dir}`, { cause: err });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("fence_unavailable: fence state is not JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("fence_unavailable: fence state has no pairs table");
  }
  const doc = parsed as Record<string, unknown>;
  // P1-1 round 3: the envelope is pinned — exact format const and a
  // non-empty genesis marker. A file without them is not a fence state.
  if (doc["format"] !== FENCE_FORMAT) {
    throw new Error("fence_unavailable: fence state has an unknown format");
  }
  const genesis = doc["genesis"];
  if (typeof genesis !== "string" || genesis.length === 0) {
    throw new Error("fence_unavailable: fence state has no genesis");
  }
  const pairs = doc["pairs"];
  if (!pairs || typeof pairs !== "object" || Array.isArray(pairs)) {
    throw new Error("fence_unavailable: fence state has no pairs table");
  }
  // P1-3: strict revalidation — a corrupt entry refuses instead of
  // resetting to 0 (which checkBindingRevision would then mismatch or,
  // worse, a revision-0 binding would match). P1-1 round 3: entries carry
  // exactly { revision, digest } — no extra keys.
  for (const [pairId, entry] of Object.entries(pairs as Record<string, unknown>)) {
    if (
      typeof pairId !== "string" ||
      pairId.length === 0 ||
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).length !== 2 ||
      !Object.hasOwn(entry, "revision") ||
      !Object.hasOwn(entry, "digest") ||
      !Number.isSafeInteger((entry as Record<string, unknown>)["revision"]) ||
      ((entry as Record<string, unknown>)["revision"] as number) < 1 ||
      typeof (entry as Record<string, unknown>)["digest"] !== "string" ||
      !DIGEST_RE.test((entry as Record<string, unknown>)["digest"] as string)
    ) {
      throw new Error("fence_unavailable: fence state entry is corrupt");
    }
  }
  return { pairs: pairs as FencePairs, genesis };
}

function writeState(dir: string, pairs: FencePairs, genesis: string, create = false): void {
  const tmp = join(dir, `${FENCE_FILE}.tmp.${randomUUID()}`);
  let published = false;
  try {
    writeFileSync(tmp, JSON.stringify({ format: FENCE_FORMAT, genesis, pairs }) + "\n", { flag: "wx" });
    // P1-3: fsync the temp file before rename so a crash cannot leave a
    // committed-but-unreadable revision behind.
    const fd = openSync(tmp, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    // Exclusive publication on creation cannot overwrite another creator.
    if (create) linkSync(tmp, join(dir, FENCE_FILE));
    else renameSync(tmp, join(dir, FENCE_FILE));
    published = true;
    rmSync(tmp, { force: true });
    const directory = openSync(dir, "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } catch (err) {
    // Preserve the publication failure even if best-effort cleanup also
    // fails; otherwise a raw cleanup error could release an uncertain lock.
    try { rmSync(tmp, { force: true }); } catch { /* keep the original error */ }
    const Failure = published ? FencePublicationUncertain : Error;
    throw new Failure(`fence_unavailable: cannot commit fence state in ${dir}`, { cause: err });
  }
}

/** Open the durable fence; initial creation requires `{ create: true }`. */
export function openSourceConsentFence(dir: string, options: { readonly create?: boolean } = {}): SourceConsentFence {
  if (options.create === true) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      throw new Error(`fence_unavailable: cannot create fence dir ${dir}`);
    }
  }
  const initial = withFenceLock(dir, () => {
    try {
      return readState(dir);
    } catch (err) {
      if (options.create === true && ((err as Error).cause as NodeJS.ErrnoException)?.code === "ENOENT") {
        writeState(dir, {}, randomUUID(), true);
        return readState(dir);
      }
      throw err;
    }
  });
  const freshState = (): FenceState => {
    const fresh = readState(dir);
    if (fresh.genesis !== initial.genesis) {
      throw new Error("fence_unavailable: fence genesis changed");
    }
    return fresh;
  };
  return {
    // P1-1 round 3: revisionOf re-reads durable state on every call and
    // refuses on any read error — a long-lived handle never serves the
    // revision it saw at open time after another writer advanced the file.
    revisionOf(pairId: string): number {
      return withFenceLock(dir, () => {
        const fresh = freshState();
        const entry = fresh.pairs[pairId];
        return entry && Number.isSafeInteger(entry.revision) ? entry.revision : 0;
      });
    },
    commitSnapshot(pairId: string, snapshotDigest: string): number {
      if (typeof pairId !== "string" || pairId.length === 0) {
        throw new Error("fence_unavailable: pair id must be a non-empty string");
      }
      // P1-3: opaque digests are format-checked — arbitrary strings never
      // advance the fence. (Computing the digest from the enumerated
      // snapshot fields belongs to the contract-fence lot B5+.)
      if (typeof snapshotDigest !== "string" || !DIGEST_RE.test(snapshotDigest)) {
        throw new Error("fence_unavailable: snapshot digest must be hex64 or sha256:hex64");
      }
      // R4: hold exclusion across read, validation and durable publication;
      // a fresh read alone still permits another process to commit r2/r3
      // before this process overwrites them with its stale r2.
      return withFenceLock(dir, () => {
        const fresh = freshState();
        const current = fresh.pairs[pairId];
        if (current && current.digest === snapshotDigest) {
          return current.revision;
        }
        const next = current ? current.revision + 1 : 1;
        const updated = { ...fresh.pairs, [pairId]: { revision: next, digest: snapshotDigest } };
        writeState(dir, updated, fresh.genesis);
        return next;
      });
    },
  };
}

/**
 * Pair equality in the binding/ACK drive-binding position: the binding's
 * `sourceConsentRevision` must equal the fence's durable revision for its
 * pair id, and `consentRevision` must be a positive integer.
 */
export function checkBindingRevision(
  binding: BindingRevision,
  fence: SourceConsentFence,
): RevisionCheck {
  // P1-3: revision 0 is never valid in an accepted binding/ACK — an
  // uncommitted pair (fence 0) and a revision-0 binding both refuse.
  // Unknown pairs and rollbacks refuse via the equality below.
  if (
    !binding ||
    typeof binding.pairId !== "string" ||
    binding.pairId.length === 0 ||
    !Number.isSafeInteger(binding.consentRevision) ||
    binding.consentRevision < 1 ||
    !Number.isSafeInteger(binding.sourceConsentRevision) ||
    binding.sourceConsentRevision < 1
  ) {
    return { ok: false, reason: "revision_mismatch" };
  }
  let current: number;
  try {
    current = fence.revisionOf(binding.pairId);
  } catch {
    return { ok: false, reason: "revision_mismatch" };
  }
  if (!Number.isSafeInteger(current) || current < 1) {
    return { ok: false, reason: "revision_mismatch" };
  }
  if (current !== binding.sourceConsentRevision) {
    return { ok: false, reason: "revision_mismatch" };
  }
  return { ok: true };
}
