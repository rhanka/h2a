/**
 * Bounded, paginated `h2a_discover_instances` (lot L1).
 *
 * The historical handler returned EVERY registration in one frame — 19,185,053 B
 * for the demo seed, over both the 1 MiB frame budget and Claude's 16 MiB cap.
 * This pager replaces that with:
 *   - a default of the 200 MOST RECENT inscriptions (a documented public change),
 *   - `total` / `hasMore` / an opaque authenticated `cursor` for full traversal,
 *   - a stable canonical order (createdAt desc; missing/invalid last; then id by
 *     code point), with a duplicate id refused as `registry_inconsistent`,
 *   - a per-request STABLE snapshot: both registry sources are captured with
 *     before/after content checks, and a change during capture is `registry_changed`,
 *   - a `generation` fingerprint (registry ∪ grants ∪ sort version) so a cursor
 *     from a stale corpus (or a restarted server) fails `cursor_stale` rather than
 *     silently omitting or duplicating a row,
 *   - a page trimmed until the REAL serialized frame fits the budget, and an
 *     indivisible oversize entry surfaced as `entry_too_large` with a durable
 *     recovery ref and a `resumeCursor` — never skipped, never a silent drop.
 *
 * The CLI `discover` verb and `LocalStore.listInstances()` keep their exhaustive
 * contract; only the MCP tool paginates.
 */

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

import { effectiveOrgInstances, type H2AActorRegistration } from "@sentropic/h2a";

import type { LocalStore } from "../local-files/store.js";
import { encodeFrame, type FrameBudget } from "./frame-budget.js";
import type { PayloadRecoveryRef, PayloadStore } from "./payload-store.js";

export interface DiscoverInstancesArgs {
  role?: string;
  scope?: string;
  limit?: number;
  cursor?: string;
}

export interface DiscoverInstancesPage {
  instances: H2AActorRegistration[];
  /** Total filtered count of THIS generation, not just the page. */
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
  /** Fingerprint of registry + grants + sort version. */
  generation: string;
  /** The requested limit (default 200). */
  limit: number;
  /** Emitted count — can be below `limit` because of the byte budget. */
  returned: number;
}

export type DiscoveryErrorCode =
  | "invalid_filter"
  | "invalid_limit"
  | "invalid_cursor"
  | "cursor_stale"
  | "registry_changed"
  | "registry_inconsistent"
  | "entry_too_large";

export interface DiscoveryError {
  readonly code: DiscoveryErrorCode;
  readonly message: string;
  readonly data?: Record<string, unknown>;
}

export type DiscoverOutcome =
  | { readonly kind: "page"; readonly page: DiscoverInstancesPage }
  | { readonly kind: "error"; readonly error: DiscoveryError };

export interface DiscoveryPager {
  discover(args: DiscoverInstancesArgs | undefined): DiscoverOutcome;
}

export interface DiscoveryPagerOptions {
  /** Random per-server HMAC secret for cursor authentication. */
  readonly secret?: Buffer;
  /** Random per-server-instance epoch; a different epoch → `cursor_stale`. */
  readonly serverEpoch?: string;
  /** Frame budget; the page is trimmed until the real frame fits it. */
  readonly budget: FrameBudget;
  /** Durable store for an oversize indivisible entry's intact bytes. */
  readonly payloadStore?: PayloadStore;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const MAX_ROLE_BYTES = 64;
const MAX_SCOPE_BYTES = 256;
const MAX_CURSOR_CHARS = 2048;
const SORT_ORDER_VERSION = "discovery-order-v1";
const CAPTURE_ATTEMPTS = 3;
/**
 * Bytes reserved below the budget when fitting a page: the placeholder id used
 * for measurement is 1 char, but a real id is ≤128 UTF-8 bytes and an SSE frame
 * adds `event:`/`data:`/blank-line overhead. Reserving here keeps the fitted page
 * within budget on every transport; the transport's universal guard is the final
 * backstop that never lets a raw oversize frame reach the wire.
 */
const PAGE_FRAME_RESERVE = 1024;

// eslint-disable-next-line no-control-regex
const C0_DEL_RE = /[\u0000-\u001f\u007f]/;

function err(code: DiscoveryErrorCode, message: string, data?: Record<string, unknown>): DiscoverOutcome {
  return { kind: "error", error: { code, message, ...(data ? { data } : {}) } };
}

/** Compare two strings by Unicode code point (ascending) without `localeCompare`. */
function codePointCompare(a: string, b: string): number {
  const ai = a[Symbol.iterator]();
  const bi = b[Symbol.iterator]();
  for (;;) {
    const x = ai.next();
    const y = bi.next();
    if (x.done && y.done) return 0;
    if (x.done) return -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0) ?? 0;
    const cy = y.value.codePointAt(0) ?? 0;
    if (cx !== cy) return cx - cy;
  }
}

interface SourceCapture {
  readonly instances: Buffer;
  readonly grants: Buffer;
}

function readOrEmpty(path: string): Buffer {
  try {
    return readFileSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return Buffer.alloc(0);
    throw e;
  }
}

function statSig(path: string): string {
  try {
    const s = statSync(path);
    return `${s.size}:${s.mtimeMs}:${s.ino}`;
  } catch {
    return "absent";
  }
}

/**
 * Capture BOTH registry sources as a stable photograph: record every source's
 * metadata, read every source, then re-read and re-check every source. A change
 * detected across the window is `registry_changed` (retried up to 3 times). Not
 * mtime/size alone — the byte content is compared, so a same-size mutation is
 * still caught.
 */
function captureSources(instancesPath: string, grantsPath: string): SourceCapture | undefined {
  for (let attempt = 0; attempt < CAPTURE_ATTEMPTS; attempt += 1) {
    const beforeI = statSig(instancesPath);
    const beforeG = statSig(grantsPath);
    const instances = readOrEmpty(instancesPath);
    const grants = readOrEmpty(grantsPath);
    const instances2 = readOrEmpty(instancesPath);
    const grants2 = readOrEmpty(grantsPath);
    const afterI = statSig(instancesPath);
    const afterG = statSig(grantsPath);
    if (
      beforeI === afterI &&
      beforeG === afterG &&
      instances.equals(instances2) &&
      grants.equals(grants2)
    ) {
      return { instances, grants };
    }
  }
  return undefined;
}

function uint64BE(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}

/** Generation = SHA-256 of length-prefixed(instances) ++ length-prefixed(grants) ++ order version. */
function computeGeneration(capture: SourceCapture): string {
  const h = createHash("sha256");
  h.update(uint64BE(capture.instances.length));
  h.update(capture.instances);
  h.update(uint64BE(capture.grants.length));
  h.update(capture.grants);
  h.update(SORT_ORDER_VERSION);
  return `sha256:${h.digest("hex")}`;
}

function toArray<T>(value: T[] | T | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Canonical stable identity for ordering + duplicate detection. `instance` is
 * always present; `id` is the pre-DEC-114 legacy address and may be absent on an
 * old row, so the key falls back to `instance` (still unique per registration).
 */
function regKey(reg: H2AActorRegistration): string {
  return typeof reg.id === "string" && reg.id.length > 0 ? reg.id : reg.instance;
}

interface ParsedCorpus {
  readonly registrations: H2AActorRegistration[];
  readonly grants: ReturnType<LocalStore["listOrgMembership"]>;
}

function parseCorpus(capture: SourceCapture): ParsedCorpus | { duplicateOrInvalid: true } {
  const registrations: H2AActorRegistration[] = [];
  const seen = new Set<string>();
  const text = capture.instances.toString("utf8");
  if (text.length > 0) {
    for (const line of text.split("\n")) {
      if (line.length === 0) continue;
      let reg: H2AActorRegistration;
      try {
        reg = JSON.parse(line) as H2AActorRegistration;
      } catch {
        return { duplicateOrInvalid: true };
      }
      if (typeof reg.instance !== "string" || reg.instance.length === 0) {
        return { duplicateOrInvalid: true };
      }
      const key = regKey(reg);
      if (seen.has(key)) return { duplicateOrInvalid: true };
      seen.add(key);
      registrations.push({ ...reg, roles: toArray(reg.roles), scopes: toArray(reg.scopes) });
    }
  }
  const grants: ReturnType<LocalStore["listOrgMembership"]> = [];
  const gtext = capture.grants.toString("utf8");
  if (gtext.length > 0) {
    for (const line of gtext.split("\n")) {
      if (line.length === 0) continue;
      try {
        grants.push(JSON.parse(line));
      } catch {
        return { duplicateOrInvalid: true };
      }
    }
  }
  return { registrations, grants };
}

interface CursorPayload {
  v: 1;
  e: string; // serverEpoch
  g: string; // generation
  o: number; // offset
  l: number; // limit
  r: string; // role ("" = absent)
  s: string; // scope ("" = absent)
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input as never).toString("base64url");
}

function macFor(secret: Buffer, body: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

function encodeCursor(secret: Buffer, payload: CursorPayload): string {
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(macFor(secret, body));
  return `${body}.${mac}`;
}

type CursorDecode =
  | { readonly ok: true; readonly payload: CursorPayload }
  | { readonly ok: false; readonly code: "invalid_cursor" | "cursor_stale" };

function decodeCursor(secret: Buffer, serverEpoch: string, raw: string): CursorDecode {
  if (raw.length === 0 || raw.length > MAX_CURSOR_CHARS) return { ok: false, code: "invalid_cursor" };
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return { ok: false, code: "invalid_cursor" };
  const body = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  let payload: CursorPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CursorPayload;
  } catch {
    return { ok: false, code: "invalid_cursor" };
  }
  if (
    payload === null ||
    typeof payload !== "object" ||
    payload.v !== 1 ||
    typeof payload.e !== "string" ||
    typeof payload.g !== "string" ||
    !Number.isInteger(payload.o) ||
    payload.o < 0 ||
    !Number.isInteger(payload.l) ||
    typeof payload.r !== "string" ||
    typeof payload.s !== "string"
  ) {
    return { ok: false, code: "invalid_cursor" };
  }
  const expected = macFor(secret, body);
  let macValid = false;
  try {
    const got = Buffer.from(mac, "base64url");
    macValid = got.length === expected.length && timingSafeEqual(got, expected);
  } catch {
    macValid = false;
  }
  if (!macValid) {
    // A cursor minted by a PREVIOUS server instance (different secret) cannot be
    // authenticated; distinguish a stale traversal from a forged/tampered cursor
    // by the embedded (unauthenticated) epoch — either way traversal is refused.
    return payload.e !== serverEpoch
      ? { ok: false, code: "cursor_stale" }
      : { ok: false, code: "invalid_cursor" };
  }
  if (payload.e !== serverEpoch) return { ok: false, code: "cursor_stale" };
  return { ok: true, payload };
}

const CURSOR_STALE_MESSAGE = "registry changed or server restarted; restart discovery without cursor";

export function createDiscoveryPager(
  store: LocalStore,
  options: DiscoveryPagerOptions
): DiscoveryPager {
  const secret = options.secret ?? randomBytes(32);
  const serverEpoch = options.serverEpoch ?? randomUUID();
  const budget = options.budget;
  const effectiveBudget = Math.max(1024, budget.maxBytes - PAGE_FRAME_RESERVE);

  /** Measure the REAL frame bytes for a page (placeholder id; reserve covers the delta). */
  function frameBytesFor(page: DiscoverInstancesPage): number {
    const text = JSON.stringify(page);
    return encodeFrame({
      jsonrpc: "2.0",
      id: 0,
      result: { content: [{ type: "text", text }] }
    }).bytes;
  }

  function validateFilter(
    value: unknown,
    maxBytes: number
  ): { ok: true; value: string | undefined } | { ok: false } {
    if (value === undefined) return { ok: true, value: undefined };
    if (typeof value !== "string") return { ok: false };
    if (C0_DEL_RE.test(value)) return { ok: false };
    if (Buffer.byteLength(value, "utf8") > maxBytes) return { ok: false };
    return { ok: true, value: value.length === 0 ? undefined : value };
  }

  function discover(args: DiscoverInstancesArgs | undefined): DiscoverOutcome {
    const a = args ?? {};

    // 1. Validate filters and limit (cheap, before any registry read).
    const roleV = validateFilter(a.role, MAX_ROLE_BYTES);
    if (!roleV.ok) {
      return err("invalid_filter", "role or scope exceeds the supported filter format");
    }
    const scopeV = validateFilter(a.scope, MAX_SCOPE_BYTES);
    if (!scopeV.ok) {
      return err("invalid_filter", "role or scope exceeds the supported filter format");
    }
    if (a.limit !== undefined) {
      if (typeof a.limit !== "number" || !Number.isInteger(a.limit) || a.limit < 1 || a.limit > MAX_LIMIT) {
        return err("invalid_limit", "limit must be an integer between 1 and 1000");
      }
    }
    if (a.cursor !== undefined) {
      if (typeof a.cursor !== "string" || a.cursor.length === 0 || a.cursor.length > MAX_CURSOR_CHARS) {
        return err("invalid_cursor", "cursor is malformed or does not match the query");
      }
    }

    // 2. Capture a stable photograph of BOTH sources.
    const capture = captureSources(store.paths.instances, store.paths.orgMembership);
    if (!capture) {
      return err("registry_changed", "registry changed during capture; retry discovery", {
        retryable: true
      });
    }

    // 3. Generation fingerprint (registry ∪ grants ∪ sort version).
    const generation = computeGeneration(capture);

    // 4. Parse corpus (duplicate id / malformed row → inconsistent).
    const parsed = parseCorpus(capture);
    if ("duplicateOrInvalid" in parsed) {
      return err("registry_inconsistent", "registry contains conflicting or invalid records", {
        generation
      });
    }

    // 5. Resolve offset + effective filters/limit from the cursor when present.
    let offset = 0;
    let role = roleV.value;
    let scope = scopeV.value;
    let limit = a.limit ?? DEFAULT_LIMIT;
    if (a.cursor !== undefined) {
      const decoded = decodeCursor(secret, serverEpoch, a.cursor);
      if (!decoded.ok) {
        if (decoded.code === "cursor_stale") {
          return err("cursor_stale", CURSOR_STALE_MESSAGE, { restartRequired: true });
        }
        return err("invalid_cursor", "cursor is malformed or does not match the query");
      }
      const p = decoded.payload;
      if (p.g !== generation) {
        return err("cursor_stale", CURSOR_STALE_MESSAGE, { restartRequired: true });
      }
      // The client keeps its filters/limit OR omits them; a DIFFERENT explicit
      // value is a mismatch (invalid_cursor), never a silent override.
      const cursorRole = p.r === "" ? undefined : p.r;
      const cursorScope = p.s === "" ? undefined : p.s;
      if (a.role !== undefined && roleV.value !== cursorRole) {
        return err("invalid_cursor", "cursor is malformed or does not match the query");
      }
      if (a.scope !== undefined && scopeV.value !== cursorScope) {
        return err("invalid_cursor", "cursor is malformed or does not match the query");
      }
      if (a.limit !== undefined && a.limit !== p.l) {
        return err("invalid_cursor", "cursor is malformed or does not match the query");
      }
      offset = p.o;
      role = cursorRole;
      scope = cursorScope;
      limit = p.l;
    }

    // 6. Filter on the effective org view (registration ∪ grants), like the CLI.
    const effective = effectiveOrgInstances(parsed.registrations, parsed.grants);
    const effByInstance = new Map(effective.map((e) => [e.instance, e]));
    let filtered = parsed.registrations;
    if (role !== undefined) {
      filtered = filtered.filter((reg) => effByInstance.get(reg.instance)?.roles.includes(role as string));
    }
    if (scope !== undefined) {
      filtered = filtered.filter((reg) => effByInstance.get(reg.instance)?.scopes.includes(scope as string));
    }

    // 7. Canonical order: createdAt desc (valid), missing/invalid last, then id by code point.
    const decorated = filtered.map((reg) => {
      const ts = Date.parse(reg.createdAt);
      return { reg, ts, hasValid: Number.isFinite(ts) };
    });
    decorated.sort((x, y) => {
      if (x.hasValid && y.hasValid) {
        if (x.ts !== y.ts) return y.ts - x.ts;
      } else if (x.hasValid !== y.hasValid) {
        return x.hasValid ? -1 : 1;
      }
      return codePointCompare(regKey(x.reg), regKey(y.reg));
    });
    const sorted = decorated.map((d) => d.reg);
    const total = sorted.length;

    if (offset > total) {
      // A cursor whose offset is past the (possibly shrunk) end for THIS
      // generation cannot be trusted to complete the traversal.
      return err("cursor_stale", CURSOR_STALE_MESSAGE, { restartRequired: true });
    }

    // 8. Build the page, trimming until the REAL frame fits the budget.
    const maxAvailable = Math.min(limit, total - offset);

    const buildPage = (n: number): DiscoverInstancesPage => {
      const instances = sorted.slice(offset, offset + n);
      const nextOffset = offset + n;
      const hasMore = nextOffset < total;
      const nextCursor = hasMore
        ? encodeCursor(secret, {
            v: 1,
            e: serverEpoch,
            g: generation,
            o: nextOffset,
            l: limit,
            r: role ?? "",
            s: scope ?? ""
          })
        : null;
      return { instances, total, hasMore, nextCursor, generation, limit, returned: n };
    };

    if (total === 0 || maxAvailable === 0) {
      return { kind: "page", page: buildPage(0) };
    }

    // Binary search for the largest n whose full frame fits the reserved budget.
    let lo = 0;
    let hi = maxAvailable;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (frameBytesFor(buildPage(mid)) <= effectiveBudget) lo = mid;
      else hi = mid - 1;
    }
    const fitCount = lo;

    if (fitCount === 0) {
      // Even a single entry at `offset` overflows: recover its intact bytes and
      // hand back a resumeCursor for the NEXT offset — never skip the entry.
      const entry = sorted[offset];
      const entryId = regKey(entry);
      const entryJson = JSON.stringify(entry);
      const entryBytes = Buffer.byteLength(entryJson, "utf8");
      let recovery: PayloadRecoveryRef | undefined;
      if (options.payloadStore) {
        try {
          recovery = options.payloadStore.persistOutput(Buffer.from(entryJson, "utf8"));
        } catch {
          recovery = undefined;
        }
      }
      const resumeOffset = offset + 1;
      const resumeCursor =
        resumeOffset < total
          ? encodeCursor(secret, {
              v: 1,
              e: serverEpoch,
              g: generation,
              o: resumeOffset,
              l: limit,
              r: role ?? "",
              s: scope ?? ""
            })
          : null;
      return err("entry_too_large", "one registry entry exceeds the MCP frame budget", {
        budgetBytes: budget.maxBytes,
        entryBytes,
        id: entryId.length > 256 ? `${entryId.slice(0, 256)}…` : entryId,
        entrySha256: `sha256:${createHash("sha256").update(entryJson).digest("hex")}`,
        generation,
        total,
        offset,
        resumeCursor,
        ...(recovery ? { recovery } : {})
      });
    }

    return { kind: "page", page: buildPage(fitCount) };
  }

  return { discover };
}
