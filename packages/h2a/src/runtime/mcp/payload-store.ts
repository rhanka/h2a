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
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";

/** Announced recovery window: a ref is readable for 24h after it is written. */
export const PAYLOAD_TTL_MS = 24 * 60 * 60 * 1000;

/** Proposed per-root ceiling (measured against the store dir before a write). */
export const PAYLOAD_ROOT_QUOTA_BYTES = 128 * 1024 * 1024;

/** Hard maximum a single read may return (also bounded again by the frame budget). */
export const PAYLOAD_MAX_READ_BYTES = 65536;

const REF_RE = /^[0-9a-f]{64}$/;

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
  /** Read a budget-sized chunk of a ref, or a typed read error. */
  readPayload(
    ref: string,
    offset: number,
    maxBytes: number
  ): PayloadReadChunk | { error: PayloadReadError };
  /** Remove ONLY expired refs (dedicated maintenance; never touches live data). */
  sweepExpired(now?: number): number;
}

function binPath(dir: string, ref: string): string {
  return join(dir, `${ref}.bin`);
}
function metaPath(dir: string, ref: string): string {
  return join(dir, `${ref}.json`);
}

function dirBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    try {
      total += statSync(join(dir, entry)).size;
    } catch {
      /* a racing unlink is not a measurement failure */
    }
  }
  return total;
}

/**
 * A payload store confined to `<root>/mcp-payloads/`. `scope` defaults to the
 * root, so two roots (two tenants) never share a namespace.
 */
export function createPayloadStore(root: string, scope: string = root): PayloadStore {
  const dir = join(root, "mcp-payloads");

  function ensureDir(): void {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {
      /* best effort; a pre-existing dir may be owned differently in tests */
    }
  }

  function sweepExpired(now: number = Date.now()): number {
    if (!existsSync(dir)) return 0;
    let removed = 0;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".json")) continue;
      const ref = entry.slice(0, -".json".length);
      if (!REF_RE.test(ref)) continue;
      try {
        const meta = JSON.parse(readFileSync(join(dir, entry), "utf8")) as PayloadMeta;
        if (Date.parse(meta.expiresAt) <= now) {
          try {
            unlinkSync(metaPath(dir, ref));
          } catch {
            /* already gone */
          }
          try {
            unlinkSync(binPath(dir, ref));
          } catch {
            /* already gone */
          }
          removed += 1;
        }
      } catch {
        /* a corrupt meta is left for a human sweep, never live source data */
      }
    }
    return removed;
  }

  function persistOutput(bytes: Buffer): PayloadRecoveryRef {
    try {
      ensureDir();
    } catch (err) {
      throw new PayloadStoreError(
        "recovery_unavailable",
        (err as NodeJS.ErrnoException).code ?? "mkdir_failed",
        `cannot create payload store directory: ${(err as Error).message}`
      );
    }
    // Reclaim expired space before enforcing the quota; never evict live data.
    let used = 0;
    try {
      sweepExpired();
      used = dirBytes(dir);
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
    const tmpBin = binPath(dir, `.${ref}.tmp`);
    const tmpMeta = metaPath(dir, `.${ref}.tmp`);
    try {
      writeFileSync(tmpBin, bytes, { mode: 0o600, flag: "wx" });
      writeFileSync(tmpMeta, `${JSON.stringify(meta)}\n`, { mode: 0o600, flag: "wx" });
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
    return { ref, sha256, totalBytes: bytes.length, expiresAt: meta.expiresAt };
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

  return { scope, persistOutput, readPayload, sweepExpired };
}
