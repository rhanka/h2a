/**
 * RC2.authority-native — content-free consent-fence supplement.
 *
 * Durable `sourceConsentRevision` without changing historical journal
 * payloads: this fence stores ONLY `{ revision, snapshotDigest }` per consent
 * pair id in its own file. First committed snapshot is revision 1; each
 * changed snapshot commits +1 atomically (temp file + rename). Identical
 * snapshots re-commit nothing.
 *
 * Pair equality (`assertConsentPair`) pins the binding/ACK drive-binding
 * position: the exact selected `requestId` AND `grantId` of the live
 * `projectConsent` projection must match, even when another request projects
 * positive. The A axis (`ownerConsentRevision`) and the native axis
 * (`sourceConsentRevision`) are distinct counters, keyed per pair id — never
 * merged by max, timestamp, or direction.
 */

import { closeSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, fsyncSync } from "node:fs";
import { join } from "node:path";

const HEX64_RE = /^[a-f0-9]{64}$/;
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
  /** Durable revision for the pair id, 0 when never committed. */
  revisionOf(pairId: string): number;
  /**
   * Commit a snapshot digest: first commit allocates 1, an identical digest
   * reuses the current revision, a changed digest allocates exactly +1.
   */
  commitSnapshot(pairId: string, snapshotDigest: string): number;
}

const FENCE_FILE = "source-consent-revisions.json";

function readState(dir: string): Record<string, { revision: number; digest: string }> {
  let raw: string;
  try {
    raw = readFileSync(join(dir, FENCE_FILE), "utf8");
  } catch {
    throw new Error(`fence_unavailable: cannot read fence state in ${dir}`);
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
  const pairs = (parsed as Record<string, unknown>)["pairs"];
  if (!pairs || typeof pairs !== "object" || Array.isArray(pairs)) {
    throw new Error("fence_unavailable: fence state has no pairs table");
  }
  // P1-3: strict revalidation — a corrupt entry refuses instead of
  // resetting to 0 (which checkBindingRevision would then mismatch or,
  // worse, a revision-0 binding would match).
  for (const [pairId, entry] of Object.entries(pairs as Record<string, unknown>)) {
    if (
      typeof pairId !== "string" ||
      pairId.length === 0 ||
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      !Number.isSafeInteger((entry as Record<string, unknown>)["revision"]) ||
      ((entry as Record<string, unknown>)["revision"] as number) < 1 ||
      typeof (entry as Record<string, unknown>)["digest"] !== "string" ||
      !DIGEST_RE.test((entry as Record<string, unknown>)["digest"] as string)
    ) {
      throw new Error("fence_unavailable: fence state entry is corrupt");
    }
  }
  return pairs as Record<string, { revision: number; digest: string }>;
}

function writeState(
  dir: string,
  pairs: Record<string, { revision: number; digest: string }>,
  genesis: string,
): void {
  const tmp = join(dir, `${FENCE_FILE}.tmp`);
  try {
    writeFileSync(
      tmp,
      JSON.stringify({ format: "h2a.source-consent-fence/1", genesis, pairs }) + "\n",
    );
    // P1-3: fsync the temp file before rename so a crash cannot leave a
    // committed-but-unreadable revision behind.
    const fd = openSync(tmp, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, join(dir, FENCE_FILE));
  } catch {
    throw new Error(`fence_unavailable: cannot commit fence state in ${dir}`);
  }
}

/** Open (or create) the durable fence rooted at `dir`. No journal payloads. */
export function openSourceConsentFence(dir: string): SourceConsentFence {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    throw new Error(`fence_unavailable: cannot create fence dir ${dir}`);
  }
  let pairs: Record<string, { revision: number; digest: string }>;
  let genesis: string;
  try {
    pairs = readState(dir);
    // Genesis marker: present on fences created after this fix; older
    // fences keep their pairs untouched (restart never resets the domain).
    try {
      const raw = readFileSync(join(dir, FENCE_FILE), "utf8");
      const marker = (JSON.parse(raw) as Record<string, unknown>)["genesis"];
      genesis = typeof marker === "string" && marker.length > 0 ? marker : "pre-genesis";
    } catch {
      genesis = "pre-genesis";
    }
  } catch (err) {
    if (/cannot read fence state/.test((err as Error).message)) {
      pairs = {};
      genesis = new Date().toISOString();
      writeState(dir, pairs, genesis);
    } else {
      throw err;
    }
  }
  return {
    revisionOf(pairId: string): number {
      const entry = pairs[pairId];
      return entry && Number.isSafeInteger(entry.revision) ? entry.revision : 0;
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
      // P1-3: re-read the durable state before committing so concurrent
      // instances cannot silently roll back each other's revisions, and
      // mutate memory only after the write+fsync succeeded.
      const fresh = readState(dir);
      const current = fresh[pairId];
      if (current && current.digest === snapshotDigest) {
        pairs = fresh;
        return current.revision;
      }
      const next = current ? current.revision + 1 : 1;
      const updated = { ...fresh, [pairId]: { revision: next, digest: snapshotDigest } };
      writeState(dir, updated, genesis);
      pairs = updated;
      return next;
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
