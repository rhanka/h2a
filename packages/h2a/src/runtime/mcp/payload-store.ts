import { withWriterMutation, withWriterMutationAsync } from "../handover/mutation.js";
/**
 * Durable recovery store for oversize MCP outputs (lot L1).
 *
 * When a legitimate response or notification exceeds the frame budget
 * (`frame-budget.ts`), the INTACT original bytes are persisted here BEFORE the
 * bounded error/notice is emitted, and the client recovers them in budget-sized
 * chunks through the `h2a_read_payload` tool. The store never holds tool
 * arguments or a private key — only output already destined for THIS client —
 * and it never re-executes an effectful tool: it hands back stored bytes.
 *
 * Security properties (DEC-116 lineage):
 *  - Root/tenant confinement: one store per store-root; a ref is a 256-bit
 *    random capability whose file name IS the ref, so there is no free path, no
 *    `../`, and no cross-tenant lookup. Symlinks are refused on read.
 *  - Atomic publication: content is staged to a temp file (0600) and renamed.
 *  - Integrity: every payload carries a SHA-256 the reader verifies after
 *    reassembly.
 *  - Durability across restart: refs survive; nothing is purged at boot. Only a
 *    dedicated maintenance sweep removes EXPIRED refs, never live data.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  promises as fsPromises,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { join, sep } from "node:path";

/** Announced recovery window: a ref is readable for 24h after it is written. */
export const PAYLOAD_TTL_MS = 24 * 60 * 60 * 1000;

/** Proposed per-root ceiling (measured against the store dir before a write). */
export const PAYLOAD_ROOT_QUOTA_BYTES = 128 * 1024 * 1024;

/** Hard maximum a single read may return (also bounded again by the frame budget). */
export const PAYLOAD_MAX_READ_BYTES = 65536;

const REF_RE = /^[0-9a-f]{64}$/;
const AUTO_SWEEP_INTERVAL_MS = 30_000;

export interface PayloadRecoveryRef {
  /** Opaque 256-bit capability. */
  readonly ref: string;
  readonly sha256: string;
  readonly totalBytes: number;
  readonly expiresAt: string;
}

interface PayloadMeta {
  readonly sha256: string;
  readonly totalBytes: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  /** The store-root/tenant this payload belongs to (confinement check on read). */
  readonly scope: string;
}

export type PayloadReadError =
  | "payload_not_found"
  | "payload_expired"
  | "invalid_offset"
  | "payload_corrupt";

export interface PayloadReadChunk {
  readonly ref: string;
  readonly encoding: "base64";
  readonly data: string;
  readonly offset: number;
  readonly nextOffset: number | null;
  readonly totalBytes: number;
  readonly sha256: string;
  readonly expiresAt: string;
}

export class PayloadStoreError extends Error {
  constructor(
    readonly reason: "recovery_unavailable",
    readonly cause: string,
    message: string
  ) {
    super(message);
    this.name = "PayloadStoreError";
  }
}

export interface PayloadStore {
  /** The scope (store-root) every ref of this store is bound to. */
  readonly scope: string;
  /** Persist output bytes and return the recovery ref, or throw PayloadStoreError. */
  persistOutput(bytes: Buffer): PayloadRecoveryRef;
  /** L2: non-blocking async persistence with incremental quota counter and sliced sweep. */
  persistOutputAsync(bytes: Buffer): Promise<PayloadRecoveryRef>;
  /** Read a budget-sized chunk of a ref, or a typed read error. */
  readPayload(
    ref: string,
    offset: number,
    maxBytes: number
  ): PayloadReadChunk | { error: PayloadReadError };
  /** Remove ONLY expired refs (dedicated maintenance; never touches live data). */
  sweepExpired(now?: number): number;
  /** L2: sliced non-blocking async sweep (<= 8 ms per event-loop slice). */
  sweepExpiredAsync(now?: number, maxSliceMs?: number): Promise<number>;
}

function binPath(dir: string, ref: string): string {
  return join(dir, `${ref}.bin`);
}
function metaPath(dir: string, ref: string): string {
  return join(dir, `${ref}.json`);
}

function dirBytes(dir: string): number {
  let total = 0;
  // readdir returns basenames, never separators or dot/parent entries. The
  // directory is already joined; retain a fresh stat for every quota entry
  // without normalizing that same directory once per file.
  const prefix = dir + sep;
  for (const entry of readdirSync(dir)) {
    const info = statSync(prefix + entry, { throwIfNoEntry: false });
    if (info) total += info.size;
  }
  return total;
}

interface FileStamp {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

interface CachedExpiry extends FileStamp {
  readonly expiresAt: number;
  gen: number;
}

interface ExpiredCandidate {
  readonly ref: string;
  readonly path: string;
  readonly stamp: FileStamp;
}

function sameStamp(a: FileStamp, b: FileStamp): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}

function readQuotaWatermark(path: string): bigint | undefined {
  try {
    const raw = readFileSync(path, "utf8").trim();
    if (!/^\d+$/.test(raw)) return undefined;
    return BigInt(raw);
  } catch {
    return undefined;
  }
}

function writeQuotaWatermark(dir: string, path: string, value: bigint): void {
  const tmp = join(dir, `.${randomBytes(8).toString("hex")}.quota.tmp`);
  try {
    writeFileSync(tmp, `${value}\n`, { mode: 0o600, flag: "wx" });
    renameSync(tmp, path);
  } catch {
    try {
      unlinkSync(tmp);
    } catch {
      /* best effort cleanup */
    }
  }
}

/**
 * A payload store confined to `<root>/mcp-payloads/`. `scope` defaults to the
 * root, so two roots (two tenants) never share a namespace.
 */
export function createPayloadStore(root: string, scope: string = root): PayloadStore {
  const dir = join(root, "mcp-payloads");
  const prefix = dir + sep;
  const watermarkPath = join(dir, ".quota-written");
  let lastSweepAt = Number.NEGATIVE_INFINITY;
  // Derived parsing cache only. Every sweep checks current inode/size/times;
  // expired records are always read again before deletion. No quota or read
  // authority is cached, and a restart simply performs a cold scan.
  const liveExpiries = new Map<string, CachedExpiry>();
  let sweepGen = 0;
  let cachedUsedBytes: number | undefined;
  let cachedWatermark: bigint | undefined;
  let sweepInFlight: Promise<number> | undefined;

  function yieldSlice(): Promise<void> {
    return new Promise((resolveYield) => {
      const timer = setTimeout(resolveYield, 1);
      timer.unref?.();
    });
  }

  async function sha256Async(bytes: Buffer): Promise<string> {
    const CHUNK_BYTES = 512 * 1024;
    const hash = createHash("sha256");
    if (bytes.length <= CHUNK_BYTES) {
      return `sha256:${hash.update(bytes).digest("hex")}`;
    }
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      hash.update(bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.length)));
      if (offset + CHUNK_BYTES < bytes.length) {
        await new Promise<void>((resolveYield) => setImmediate(resolveYield));
      }
    }
    return `sha256:${hash.digest("hex")}`;
  }

  async function ensureDirAsync(): Promise<void> {
    await fsPromises.mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      await fsPromises.chmod(dir, 0o700);
    } catch {
      /* best effort; a pre-existing dir may be owned differently in tests */
    }
  }

  async function readQuotaWatermarkAsync(path: string): Promise<bigint | undefined> {
    try {
      const raw = (await fsPromises.readFile(path, "utf8")).trim();
      if (!/^\d+$/.test(raw)) return undefined;
      return BigInt(raw);
    } catch {
      return undefined;
    }
  }

  async function statFileStampAsync(path: string): Promise<FileStamp | undefined> {
    let info;
    try {
      info = await fsPromises.lstat(path, { bigint: true });
    } catch {
      return undefined;
    }
    if (!info.isFile()) return undefined;
    return {
      dev: info.dev,
      ino: info.ino,
      size: info.size,
      mtimeNs: info.mtimeNs,
      ctimeNs: info.ctimeNs
    };
  }

  async function dirBytesAsync(maxSliceMs = 4): Promise<number> {
    const STAT_BATCH_SIZE = 16;
    let entries: string[];
    try {
      entries = await fsPromises.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw err;
    }
    let total = 0;
    let sliceStart = performance.now();
    for (let i = 0; i < entries.length; i += STAT_BATCH_SIZE) {
      const end = Math.min(i + STAT_BATCH_SIZE, entries.length);
      const batch: Array<Promise<number>> = [];
      for (let j = i; j < end; j++) {
        batch.push(
          fsPromises.stat(prefix + entries[j]!).then(
            (info) => info.size,
            () => 0
          )
        );
      }
      const sizes = await Promise.all(batch);
      for (const size of sizes) total += size;
      if (performance.now() - sliceStart >= maxSliceMs) {
        await yieldSlice();
        sliceStart = performance.now();
      }
    }
    return total;
  }

  async function scanExpiredAsync(now: number, maxSliceMs = 4): Promise<{ exists: boolean; candidates: ExpiredCandidate[] }> {
    const SCAN_BATCH_SIZE = 8;
    let entries: string[];
    try {
      entries = await fsPromises.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, candidates: [] };
      throw err;
    }
    const targets: Array<{ ref: string; path: string }> = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      if (entry.length === 69 && entry.charCodeAt(64) === 46 && entry.endsWith(".json")) {
        const ref = entry.slice(0, 64);
        if (liveExpiries.has(ref) || REF_RE.test(ref)) {
          targets.push({ ref, path: prefix + entry });
        }
      }
    }
    const candidates: ExpiredCandidate[] = [];
    const gen = ++sweepGen;
    let sliceStart = performance.now();
    for (let i = 0; i < targets.length; i += SCAN_BATCH_SIZE) {
      const batch = targets.slice(i, i + SCAN_BATCH_SIZE);
      await Promise.all(
        batch.map(async ({ ref, path }) => {
          try {
            const stamp = await statFileStampAsync(path);
            if (!stamp) return;
            const cached = liveExpiries.get(ref);
            if (cached && sameStamp(cached, stamp) && cached.expiresAt > now) {
              cached.gen = gen;
              return;
            }
            const raw = await fsPromises.readFile(path, "utf8");
            const meta = JSON.parse(raw) as PayloadMeta;
            const after = await statFileStampAsync(path);
            if (after && sameStamp(stamp, after)) {
              const expiresAt = Date.parse(meta.expiresAt);
              if (expiresAt <= now) {
                candidates.push({ ref, path, stamp });
              } else if (Number.isFinite(expiresAt)) {
                liveExpiries.set(ref, { ...stamp, expiresAt, gen });
              }
            }
          } catch {
            /* a corrupt meta is left for a human sweep, never live source data */
          }
        })
      );
      if (performance.now() - sliceStart >= maxSliceMs) {
        await yieldSlice();
        sliceStart = performance.now();
      }
    }
    for (const [key, entry] of liveExpiries) {
      if (entry.gen < gen) liveExpiries.delete(key);
    }
    return { exists: true, candidates };
  }

  async function sweepExpiredAsync(now: number = Date.now(), maxSliceMs = 8): Promise<number> {
    if (sweepInFlight) return sweepInFlight;
    sweepInFlight = (async () => {
      try {
        const scanned = await scanExpiredAsync(now, maxSliceMs);
        if (!scanned.exists) {
          lastSweepAt = performance.now();
          return 0;
        }
        if (scanned.candidates.length === 0) {
          lastSweepAt = performance.now();
          return 0;
        }
        const removed = await withWriterMutationAsync(root, "payloads", () =>
          reapCandidates(scanned.candidates, now)
        );
        if (removed > 0) {
          cachedUsedBytes = undefined;
          cachedWatermark = undefined;
        }
        return removed;
      } finally {
        sweepInFlight = undefined;
      }
    })();
    return sweepInFlight;
  }

  function statFileStamp(path: string): FileStamp | undefined {
    const info = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    if (!info || !info.isFile()) return undefined;
    return {
      dev: info.dev,
      ino: info.ino,
      size: info.size,
      mtimeNs: info.mtimeNs,
      ctimeNs: info.ctimeNs
    };
  }

  function ensureDir(): void {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {
      /* best effort; a pre-existing dir may be owned differently in tests */
    }
  }

  function scanExpired(now: number): { exists: boolean; candidates: ExpiredCandidate[] } {
    if (!existsSync(dir)) return { exists: false, candidates: [] };
    const candidates: ExpiredCandidate[] = [];
    const gen = ++sweepGen;
    for (const entry of readdirSync(dir)) {
      if (entry.length !== 69 || entry.charCodeAt(64) !== 46 || !entry.endsWith(".json")) continue;
      const ref = entry.slice(0, 64);
      const cached = liveExpiries.get(ref);
      if (!cached && !REF_RE.test(ref)) continue;
      try {
        const path = prefix + entry;
        const stamp = statFileStamp(path);
        if (!stamp) continue;
        if (cached && sameStamp(cached, stamp) && cached.expiresAt > now) {
          cached.gen = gen;
          continue;
        }
        const meta = JSON.parse(readFileSync(path, "utf8")) as PayloadMeta;
        // External replacement during the read cannot authorize deletion or
        // populate a cache entry for a different generation of the metadata.
        const after = statFileStamp(path);
        if (!after || !sameStamp(stamp, after)) continue;
        const expiresAt = Date.parse(meta.expiresAt);
        if (expiresAt <= now) {
          candidates.push({ ref, path, stamp });
        } else if (Number.isFinite(expiresAt)) {
          liveExpiries.set(ref, { ...stamp, expiresAt, gen });
        }
      } catch {
        /* a corrupt meta is left for a human sweep, never live source data */
      }
    }
    for (const [key, entry] of liveExpiries) {
      if (entry.gen !== gen) liveExpiries.delete(key);
    }
    return { exists: true, candidates };
  }

  function reapCandidates(candidates: ExpiredCandidate[], now: number): number {
    let removed = 0;
    for (const candidate of candidates) {
      try {
        const current = statFileStamp(candidate.path);
        if (!current) {
          liveExpiries.delete(candidate.ref);
          continue;
        }
        if (!sameStamp(candidate.stamp, current)) {
          // Revalidate if replaced between the unlocked scan and lock entry.
          const meta = JSON.parse(readFileSync(candidate.path, "utf8")) as PayloadMeta;
          const after = statFileStamp(candidate.path);
          if (!after || !sameStamp(current, after)) continue;
          const expiresAt = Date.parse(meta.expiresAt);
          if (!(expiresAt <= now)) continue;
        }
        let unlinkedMeta = false;
        try {
          unlinkSync(candidate.path);
          unlinkedMeta = true;
        } catch {
          /* already gone */
        }
        try {
          unlinkSync(binPath(dir, candidate.ref));
        } catch {
          /* already gone */
        }
        liveExpiries.delete(candidate.ref);
        if (unlinkedMeta) removed += 1;
      } catch {
        /* a corrupt meta is left for a human sweep, never live source data */
      }
    }
    lastSweepAt = performance.now();
    return removed;
  }

  function sweepExpiredLocked(now: number = Date.now()): number {
    const scanned = scanExpired(now);
    if (!scanned.exists) return 0;
    return reapCandidates(scanned.candidates, now);
  }

  function sweepExpired(now: number = Date.now()): number {
    // Perform the read-only metadata scan outside the global writer mutation
    // lock so concurrent processes scale across CPUs; revalidate and unlink
    // under the lock so barriers and concurrent sweepers stay exact.
    const scanned = scanExpired(now);
    return withWriterMutation(root, "payloads", () => {
      if (!scanned.exists) return 0;
      return reapCandidates(scanned.candidates, now);
    });
  }

  function persistOutput(bytes: Buffer): PayloadRecoveryRef {
    // Read-only pre-scan outside the global writer mutation lock. Combined
    // with the monotonic written-bytes watermark updated under the lock,
    // preUsed + (w1 - w0) is a proven upper bound on current directory size
    // against concurrent writers; near quota or without a valid watermark,
    // the critical section falls back to an exact locked dirBytes() scan.
    let preSweep: { exists: boolean; candidates: ExpiredCandidate[] } | undefined;
    let preW0: bigint | undefined;
    let preUsed: number | undefined;
    if (existsSync(dir)) {
      if (performance.now() - lastSweepAt >= AUTO_SWEEP_INTERVAL_MS) {
        preSweep = scanExpired(Date.now());
      }
      preW0 = readQuotaWatermark(watermarkPath);
      if (preW0 !== undefined) {
        try {
          preUsed = dirBytes(dir);
        } catch {
          preUsed = undefined;
        }
      }
    }

    return withWriterMutation(root, "payloads", () => {
      try {
        ensureDir();
      } catch (err) {
        throw new PayloadStoreError(
          "recovery_unavailable",
          (err as NodeJS.ErrnoException).code ?? "mkdir_failed",
          `cannot create payload store directory: ${(err as Error).message}`
        );
      }
      // Avoid reparsing every expiry record for every output in a burst.
      // Explicit maintenance is immediate; quota pressure always reclaims
      // expired space before refusal. Reads still enforce the TTL themselves.
      let swept = false;
      if (preSweep) {
        if (preSweep.exists) reapCandidates(preSweep.candidates, Date.now());
        swept = true;
      } else if (performance.now() - lastSweepAt >= AUTO_SWEEP_INTERVAL_MS) {
        sweepExpiredLocked();
        swept = true;
      }

      const w1 = readQuotaWatermark(watermarkPath);
      let quotaVerified = false;
      if (preW0 !== undefined && w1 !== undefined && w1 >= preW0 && preUsed !== undefined) {
        const delta = w1 - preW0;
        if (
          delta <= BigInt(PAYLOAD_ROOT_QUOTA_BYTES) &&
          preUsed + Number(delta) + bytes.length <= PAYLOAD_ROOT_QUOTA_BYTES
        ) {
          quotaVerified = true;
        }
      }
      if (!quotaVerified) {
        let used = 0;
        try {
          used = dirBytes(dir);
          if (!swept && used + bytes.length > PAYLOAD_ROOT_QUOTA_BYTES) {
            sweepExpiredLocked();
            used = dirBytes(dir);
          }
        } catch {
          used = 0;
        }
        if (used + bytes.length > PAYLOAD_ROOT_QUOTA_BYTES) {
          throw new PayloadStoreError(
            "recovery_unavailable",
            "quota_exceeded",
            `payload store quota exceeded for ${dir}`
          );
        }
      }
      const ref = randomBytes(32).toString("hex");
      const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      const now = Date.now();
      const meta: PayloadMeta = {
        sha256,
        totalBytes: bytes.length,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + PAYLOAD_TTL_MS).toISOString(),
        scope
      };
      const metaText = `${JSON.stringify(meta)}\n`;
      const tmpBin = binPath(dir, `.${ref}.tmp`);
      const tmpMeta = metaPath(dir, `.${ref}.tmp`);
      try {
        writeFileSync(tmpBin, bytes, { mode: 0o600, flag: "wx" });
        writeFileSync(tmpMeta, metaText, { mode: 0o600, flag: "wx" });
        renameSync(tmpBin, binPath(dir, ref));
        renameSync(tmpMeta, metaPath(dir, ref));
      } catch (err) {
        for (const p of [tmpBin, tmpMeta, binPath(dir, ref), metaPath(dir, ref)]) {
          try {
            unlinkSync(p);
          } catch {
            /* best effort cleanup of a half-written record */
          }
        }
        throw new PayloadStoreError(
          "recovery_unavailable",
          (err as NodeJS.ErrnoException).code ?? "write_failed",
          `cannot persist payload: ${(err as Error).message}`
        );
      }
      const nextWatermark = (w1 ?? 0n) + BigInt(bytes.length + Buffer.byteLength(metaText));
      writeQuotaWatermark(dir, watermarkPath, nextWatermark);
      if (cachedUsedBytes !== undefined && cachedWatermark !== undefined && w1 === cachedWatermark) {
        cachedUsedBytes += bytes.length + Buffer.byteLength(metaText);
        cachedWatermark = nextWatermark;
      } else {
        cachedUsedBytes = undefined;
        cachedWatermark = undefined;
      }
      return { ref, sha256, totalBytes: bytes.length, expiresAt: meta.expiresAt };
    });
  }

  async function persistOutputAsync(bytes: Buffer): Promise<PayloadRecoveryRef> {
    try {
      await ensureDirAsync();
    } catch (err) {
      throw new PayloadStoreError(
        "recovery_unavailable",
        (err as NodeJS.ErrnoException).code ?? "mkdir_failed",
        `cannot create payload store directory: ${(err as Error).message}`
      );
    }

    // Read watermark & update cachedUsedBytes asynchronously in <= 4 ms slices if cold or stale.
    let preW0 = await readQuotaWatermarkAsync(watermarkPath);
    let preUsed: number;
    if (cachedUsedBytes !== undefined && cachedWatermark !== undefined && preW0 !== undefined && preW0 >= cachedWatermark) {
      const delta = preW0 - cachedWatermark;
      preUsed = delta <= BigInt(PAYLOAD_ROOT_QUOTA_BYTES)
        ? cachedUsedBytes + Number(delta)
        : await dirBytesAsync(4);
    } else if (cachedUsedBytes === undefined && preW0 !== undefined && preW0 <= BigInt(PAYLOAD_ROOT_QUOTA_BYTES) && Number(preW0) + bytes.length <= PAYLOAD_ROOT_QUOTA_BYTES) {
      // Monotonic written-bytes watermark is a proven upper bound on current directory size.
      preUsed = Number(preW0);
    } else {
      preUsed = await dirBytesAsync(4);
    }
    if (preW0 !== undefined) {
      cachedUsedBytes = preUsed;
      cachedWatermark = preW0;
    }

    // Reclaim expired payloads asynchronously only when approaching quota.
    if (preUsed + bytes.length > PAYLOAD_ROOT_QUOTA_BYTES) {
      await sweepExpiredAsync(Date.now(), 4);
      preW0 = await readQuotaWatermarkAsync(watermarkPath);
      preUsed = await dirBytesAsync(4);
      if (preW0 !== undefined) {
        cachedUsedBytes = preUsed;
        cachedWatermark = preW0;
      }
    }

    const ref = randomBytes(32).toString("hex");
    const sha256 = await sha256Async(bytes);
    const now = Date.now();
    const meta: PayloadMeta = {
      sha256,
      totalBytes: bytes.length,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + PAYLOAD_TTL_MS).toISOString(),
      scope
    };
    const metaText = `${JSON.stringify(meta)}\n`;
    const writtenBytes = bytes.length + Buffer.byteLength(metaText);
    const tmpBin = binPath(dir, `.${ref}.tmp`);
    const tmpMeta = metaPath(dir, `.${ref}.tmp`);

    // Stage bytes asynchronously outside .mutation.lock.
    try {
      await fsPromises.writeFile(tmpBin, bytes, { mode: 0o600, flag: "wx" });
      await fsPromises.writeFile(tmpMeta, metaText, { mode: 0o600, flag: "wx" });
    } catch (err) {
      for (const p of [tmpBin, tmpMeta]) {
        try { unlinkSync(p); } catch { /* best effort */ }
      }
      throw new PayloadStoreError(
        "recovery_unavailable",
        (err as NodeJS.ErrnoException).code ?? "write_failed",
        `cannot persist payload: ${(err as Error).message}`
      );
    }

    try {
      const persisted = await withWriterMutationAsync(root, "payloads", () => {
        const w1 = readQuotaWatermark(watermarkPath);
        let used = preUsed;
        if (preW0 !== undefined && w1 !== undefined && w1 >= preW0) {
          const delta = w1 - preW0;
          used = delta <= BigInt(PAYLOAD_ROOT_QUOTA_BYTES)
            ? preUsed + Number(delta)
            : PAYLOAD_ROOT_QUOTA_BYTES + 1;
        } else if (preW0 === undefined && w1 !== undefined) {
          // Concurrent writer created watermark; fall back to conservative add.
          used = preUsed + (w1 <= BigInt(PAYLOAD_ROOT_QUOTA_BYTES) ? Number(w1) : PAYLOAD_ROOT_QUOTA_BYTES + 1);
        }
        if (used + bytes.length > PAYLOAD_ROOT_QUOTA_BYTES) {
          throw new PayloadStoreError(
            "recovery_unavailable",
            "quota_exceeded",
            `payload store quota exceeded for ${dir}`
          );
        }
        try {
          renameSync(tmpBin, binPath(dir, ref));
          renameSync(tmpMeta, metaPath(dir, ref));
        } catch (err) {
          for (const p of [binPath(dir, ref), metaPath(dir, ref)]) {
            try { unlinkSync(p); } catch { /* best effort */ }
          }
          throw new PayloadStoreError(
            "recovery_unavailable",
            (err as NodeJS.ErrnoException).code ?? "write_failed",
            `cannot persist payload: ${(err as Error).message}`
          );
        }
        const nextWatermark = (w1 ?? 0n) + BigInt(writtenBytes);
        writeQuotaWatermark(dir, watermarkPath, nextWatermark);
        cachedUsedBytes = used + writtenBytes;
        cachedWatermark = nextWatermark;
        return { ref, sha256, totalBytes: bytes.length, expiresAt: meta.expiresAt };
      });
      // Schedule periodic expiry sweep in the background after the foreground write settles.
      if (performance.now() - lastSweepAt >= AUTO_SWEEP_INTERVAL_MS && !sweepInFlight) {
        const t = setTimeout(() => {
          void sweepExpiredAsync(Date.now(), 4).catch(() => { /* best effort background sweep */ });
        }, 25);
        t.unref?.();
      }
      return persisted;
    } catch (err) {
      for (const p of [tmpBin, tmpMeta]) {
        try { unlinkSync(p); } catch { /* best effort cleanup */ }
      }
      throw err;
    }
  }

  function readMeta(ref: string): PayloadMeta | undefined {
    const mp = metaPath(dir, ref);
    let st;
    try {
      st = lstatSync(mp);
    } catch {
      return undefined;
    }
    if (!st.isFile()) return undefined; // refuse a symlink/dir masquerading as a ref
    try {
      return JSON.parse(readFileSync(mp, "utf8")) as PayloadMeta;
    } catch {
      return undefined;
    }
  }

  function readPayload(
    ref: string,
    offset: number,
    maxBytes: number
  ): PayloadReadChunk | { error: PayloadReadError } {
    if (typeof ref !== "string" || !REF_RE.test(ref)) {
      return { error: "payload_not_found" };
    }
    const meta = readMeta(ref);
    if (!meta || meta.scope !== scope) return { error: "payload_not_found" };
    if (Date.parse(meta.expiresAt) <= Date.now()) return { error: "payload_expired" };
    if (!Number.isInteger(offset) || offset < 0 || offset > meta.totalBytes) {
      return { error: "invalid_offset" };
    }
    const bp = binPath(dir, ref);
    let bst;
    try {
      bst = lstatSync(bp);
    } catch {
      return { error: "payload_not_found" };
    }
    if (!bst.isFile() || bst.size !== meta.totalBytes) return { error: "payload_corrupt" };

    const cap = Math.max(
      1,
      Math.min(
        Number.isInteger(maxBytes) && maxBytes > 0 ? maxBytes : PAYLOAD_MAX_READ_BYTES,
        PAYLOAD_MAX_READ_BYTES
      )
    );
    const remaining = meta.totalBytes - offset;
    const chunkLen = Math.min(cap, remaining);
    const buf = Buffer.allocUnsafe(chunkLen);
    let fd: number | undefined;
    try {
      fd = openSync(bp, "r");
      let read = 0;
      while (read < chunkLen) {
        const n = readSync(fd, buf, read, chunkLen - read, offset + read);
        if (n === 0) break;
        read += n;
      }
      if (read !== chunkLen) return { error: "payload_corrupt" };
    } catch {
      return { error: "payload_corrupt" };
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          /* fd closed on error already */
        }
      }
    }
    const nextOffset = offset + chunkLen;
    return {
      ref,
      encoding: "base64",
      data: buf.toString("base64"),
      offset,
      nextOffset: nextOffset >= meta.totalBytes ? null : nextOffset,
      totalBytes: meta.totalBytes,
      sha256: meta.sha256,
      expiresAt: meta.expiresAt
    };
  }

  return { scope, readPayload, persistOutput, persistOutputAsync, sweepExpired, sweepExpiredAsync };
}
