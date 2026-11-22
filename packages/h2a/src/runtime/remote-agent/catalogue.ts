/**
 * Catalogue projector, wire allowlist, privacy filter and bounds (LH-00 + LH-06).
 *
 * LH-00 helpers (`projectCatalogueRow`, `buildCatalogueSnapshot`) are kept for
 * backward compatibility. The watched pipeline (`catalogue-watch.ts`) uses the
 * joined projection, mirror allowlist sanitization (`sanitizePresenceForMirror`),
 * scalar leak filtering, code-point-safe row shrinking (<= 512 B/row) and
 * snapshot capping (<= 512 rows, <= 256 KiB canonical JSON).
 */

import type { H2ALaunchContext, H2ASession } from "../../session.js";
import { sanitizePresenceForMirror } from "../mirror/sanitize.js";
import { classifyLaunchHost } from "./fleet-inventory.js";
import {
  isCanonicalCatalogueSid,
  nativeCatalogueSid,
  presenceCatalogueSid,
  wireInstanceId
} from "./wire-ids.js";
import {
  CATALOGUE_MAX_ROWS,
  CATALOGUE_ROW_MAX_BYTES,
  CATALOGUE_SNAPSHOT_MAX_BYTES,
  TRUNK_PROTOCOL_VERSION,
  canonicalTrunkJson,
  type CatalogueDelta,
  type CatalogueInstanceStatus,
  type CatalogueInstanceStatusUpdate,
  type CatalogueOperabilityReason,
  type CatalogueRowUpdate,
  type CatalogueSessionRow,
  type CatalogueSnapshot,
  type InventoryHostKind
} from "./types.js";

const FORBIDDEN_LOCAL_KEYS = new Set([
  "cwd",
  "command",
  "resumeCommand",
  "tty",
  "tmux",
  "nativePty",
  "pid",
  "launchContext",
  "workspace"
]);

const ALLOWED_SNAPSHOT_KEYS = new Set(["v", "t", "ch", "s", "at", "rows", "truncatedRows"]);
const ALLOWED_DELTA_KEYS = new Set(["v", "t", "ch", "s", "at", "adds", "updates", "removes"]);
const ALLOWED_ROW_KEYS = new Set([
  "sessionId",
  "instance",
  "instanceId",
  "instanceStatus",
  "host",
  "name",
  "workspaceLabel",
  "startedAt",
  "heartbeatAt",
  "state",
  "workStatus",
  "hostKind",
  "operable",
  "excluded",
  "operabilityReason"
]);
const ALLOWED_STATUS_UPDATE_KEYS = new Set(["sessionId", "instanceId", "instanceStatus"]);
const ALLOWED_OPERABILITY_REASONS = new Set<CatalogueOperabilityReason>([
  "not-shared",
  "not-operable-tmux",
  "open-with-h2a-to-operate"
]);

const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f-\u009f]/;
const UNIX_ABS_PATH_RE = /(?:^|[\s=:(,"'])\/(?:\S|$)/;
const WINDOWS_ABS_PATH_RE = /[A-Za-z]:[\\/]/;
const UNC_PATH_RE = /(?:^|[\s=:(,"'])\\\\[^\\\s]+\\[^\\\s]+/;
const FILE_URI_RE = /file:\/\//i;

export function isInternalCompanionNativeId(nativeId: string): boolean {
  return typeof nativeId === "string" && nativeId.endsWith(".h2a");
}

export { isCanonicalCatalogueSid, nativeCatalogueSid, presenceCatalogueSid };

function containsKey(value: unknown, path: readonly string[] = []): string[] | null {
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = containsKey(value[i], [...path, String(i)]);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_LOCAL_KEYS.has(key)) return [...path, key];
    const hit = containsKey(child, [...path, key]);
    if (hit) return hit;
  }
  return null;
}

export function containsForbiddenLocalField(value: unknown): boolean {
  return containsKey(value) !== null;
}

function collectLocalLeakValues(session: H2ASession, socketPath?: string): Set<string> {
  const blocked = new Set<string>();
  const add = (value: string | undefined): void => {
    if (typeof value === "string" && value.length > 0) {
      blocked.add(value);
      const trimmed = value.trim();
      if (trimmed.length > 0) blocked.add(trimmed);
    }
  };
  const lc = session.launchContext;
  if (lc) {
    add(lc.cwd);
    add(lc.command);
    add(lc.resumeCommand);
    add(lc.tty);
    if (lc.tmux) {
      add(lc.tmux.session);
      add(lc.tmux.window);
      add(lc.tmux.pane);
      add(`${lc.tmux.session}:${lc.tmux.pane}`);
      if (lc.tmux.window) {
        add(`${lc.tmux.session}:${lc.tmux.window}.${lc.tmux.pane}`);
      }
    }
    if (lc.nativePty) {
      add(lc.nativePty.session);
    }
  }
  if (session.workspace) {
    add(session.workspace.path);
    add(session.workspace.repo);
  }
  add(socketPath);
  return blocked;
}

export function sanitizeDisplayScalar(
  value: string | undefined,
  localValues?: ReadonlySet<string>
): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (CONTROL_CHAR_RE.test(value)) return undefined;
  if (FILE_URI_RE.test(value)) return undefined;
  if (UNIX_ABS_PATH_RE.test(value)) return undefined;
  if (WINDOWS_ABS_PATH_RE.test(value)) return undefined;
  if (UNC_PATH_RE.test(value)) return undefined;
  if (localValues && (localValues.has(value) || localValues.has(value.trim()))) {
    return undefined;
  }
  return value;
}

export interface ProjectJoinedRowInput {
  readonly sessionId: string;
  readonly hostKind: InventoryHostKind;
  readonly operable: boolean;
  readonly excluded: boolean;
  readonly state: string;
  readonly presence?: H2ASession;
  readonly presenceFresh: boolean;
  readonly instanceStatus?: CatalogueInstanceStatus;
  readonly socketPath?: string;
}

/**
 * Joined LH-06 row projection: passes the presence through
 * `sanitizePresenceForMirror` first, extracts only allowlisted scalars
 * (`workspace.label` -> `workspaceLabel`), strips paths/URIs/controls/local
 * coordinates, omits unattested fields on native-only rows, and sets
 * operability/exclusion semantics.
 */
export function projectJoinedCatalogueRow(input: ProjectJoinedRowInput): CatalogueSessionRow {
  const excluded = input.excluded;
  const operable = excluded ? false : input.operable;
  let operabilityReason: CatalogueOperabilityReason | undefined;
  if (excluded) {
    operabilityReason = "not-shared";
  } else if (!operable) {
    operabilityReason =
      input.hostKind === "tmux" ? "not-operable-tmux" : "open-with-h2a-to-operate";
  }

  if (!input.presence) {
    return {
      sessionId: input.sessionId,
      state: input.state,
      workStatus: "unknown",
      hostKind: input.hostKind,
      operable,
      ...(excluded ? { excluded: true } : {}),
      ...(operabilityReason !== undefined ? { operabilityReason } : {})
    };
  }

  const localValues = collectLocalLeakValues(input.presence, input.socketPath);
  const mirrored = sanitizePresenceForMirror(input.presence);
  const safeName = sanitizeDisplayScalar(mirrored.name, localValues);
  const safeWorkspaceLabel = sanitizeDisplayScalar(mirrored.workspace?.label, localValues);
  // `host` keeps its CLI vocabulary (e.g. "claude", "codex") and must not be
  // stripped when `launchContext.command` happens to equal the CLI name.
  const safeHost = sanitizeDisplayScalar(mirrored.host);
  const instanceId =
    typeof mirrored.instance === "string" && mirrored.instance.length > 0
      ? wireInstanceId(mirrored.instance)
      : undefined;
  const instanceStatus: CatalogueInstanceStatus = input.instanceStatus ?? "live";
  const workStatus = input.presenceFresh ? (mirrored.workStatus ?? "unknown") : "unknown";

  return {
    sessionId: input.sessionId,
    instanceId,
    instanceStatus,
    ...(safeHost === undefined ? {} : { host: safeHost }),
    ...(safeName === undefined ? {} : { name: safeName }),
    ...(safeWorkspaceLabel === undefined ? {} : { workspaceLabel: safeWorkspaceLabel }),
    startedAt: mirrored.startedAt,
    heartbeatAt: mirrored.heartbeatAt,
    state: input.state,
    workStatus,
    hostKind: input.hostKind,
    operable,
    ...(excluded ? { excluded: true } : {}),
    ...(operabilityReason !== undefined ? { operabilityReason } : {})
  };
}

/** LH-00 compatibility helper kept for existing callers. */
export function projectCatalogueRow(
  session: H2ASession,
  options: { readonly hostKind?: InventoryHostKind; readonly operable?: boolean; readonly excluded?: boolean } = {}
): CatalogueSessionRow {
  const hostKind = options.hostKind ?? classifyLaunchHost(session.launchContext as H2ALaunchContext | undefined);
  const operable = options.operable ?? hostKind === "native";
  return {
    sessionId: session.sessionId,
    instance: session.instance,
    ...(session.host === undefined ? {} : { host: session.host }),
    ...(session.name === undefined ? {} : { name: session.name }),
    startedAt: session.startedAt,
    heartbeatAt: session.heartbeatAt,
    state: session.state,
    ...(session.workStatus === undefined ? {} : { workStatus: session.workStatus }),
    hostKind,
    operable,
    ...(options.excluded === undefined ? {} : { excluded: options.excluded })
  };
}

/** LH-00 compatibility helper kept for existing callers. */
export function buildCatalogueSnapshot(
  sessions: readonly H2ASession[],
  options: { readonly at: number; readonly ch?: number; readonly s?: number } = { at: 0 }
): CatalogueSnapshot {
  return {
    v: TRUNK_PROTOCOL_VERSION,
    t: "cat.snapshot",
    ch: options.ch ?? 1,
    s: options.s ?? 1,
    at: options.at,
    rows: sessions.map((session) => projectCatalogueRow(session)),
    truncatedRows: 0
  };
}

function canonicalUtf8Bytes(value: unknown): number {
  return Buffer.byteLength(canonicalTrunkJson(value), "utf8");
}

function shrinkFieldToFit(
  row: CatalogueSessionRow,
  field: "name" | "workspaceLabel",
  maxBytes: number
): CatalogueSessionRow {
  const value = row[field];
  if (value === undefined) return row;

  const withoutField = { ...row };
  delete (withoutField as Record<string, unknown>)[field];
  if (canonicalUtf8Bytes(withoutField) > maxBytes) {
    return withoutField;
  }

  // Binary search on Unicode code points so surrogate pairs are never split
  // and JSON escaping (quotes, backslashes, multi-byte UTF-8) is measured
  // on the exact serialized canonical bytes.
  const codePoints = Array.from(value);
  let lo = 0;
  let hi = codePoints.length;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (mid === 0) {
      best = Math.max(best, 0);
      lo = 1;
      continue;
    }
    const candidate: CatalogueSessionRow = {
      ...withoutField,
      [field]: codePoints.slice(0, mid).join("")
    };
    if (canonicalUtf8Bytes(candidate) <= maxBytes) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best === 0) return withoutField;
  return {
    ...withoutField,
    [field]: codePoints.slice(0, best).join("")
  };
}

/**
 * Fit one catalogue row within `CATALOGUE_ROW_MAX_BYTES` (512 canonical UTF-8
 * bytes): shrinks `name` first on code-point boundaries, then `workspaceLabel`,
 * keeping all identifiers intact. Returns `null` if still unencodable.
 */
export function fitCatalogueRowToBound(
  row: CatalogueSessionRow,
  maxBytes: number = CATALOGUE_ROW_MAX_BYTES
): CatalogueSessionRow | null {
  if (canonicalUtf8Bytes(row) <= maxBytes) return row;
  let current = shrinkFieldToFit(row, "name", maxBytes);
  if (canonicalUtf8Bytes(current) <= maxBytes) return current;
  current = shrinkFieldToFit(current, "workspaceLabel", maxBytes);
  if (canonicalUtf8Bytes(current) <= maxBytes) return current;
  return null;
}

function compareBinaryString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Sort rows stably by `sessionId` (binary order), shrink or drop unencodable
 * rows, and retain the longest prefix fitting within `CATALOGUE_MAX_ROWS` (512)
 * and `CATALOGUE_SNAPSHOT_MAX_BYTES` (256 KiB), measured on canonical UTF-8
 * JSON bytes including the final `truncatedRows`.
 */
export function buildBoundedCatalogueSnapshot(input: {
  readonly rows: readonly CatalogueSessionRow[];
  readonly at: number;
  readonly ch?: number;
  readonly s?: number;
}): { readonly snapshot: CatalogueSnapshot; readonly truncatedRows: number } {
  const ch = input.ch ?? 1;
  const s = input.s ?? 1;
  const at = input.at;

  const sorted = [...input.rows].sort((a, b) => compareBinaryString(a.sessionId, b.sessionId));
  const encodable: CatalogueSessionRow[] = [];
  let unencodableCount = 0;

  for (const row of sorted) {
    const fitted = fitCatalogueRowToBound(row, CATALOGUE_ROW_MAX_BYTES);
    if (fitted === null) {
      unencodableCount += 1;
    } else {
      encodable.push(fitted);
    }
  }

  const maxCandidateCount = Math.min(encodable.length, CATALOGUE_MAX_ROWS);
  const makeCandidate = (k: number): CatalogueSnapshot => ({
    v: TRUNK_PROTOCOL_VERSION,
    t: "cat.snapshot",
    ch,
    s,
    at,
    rows: encodable.slice(0, k),
    truncatedRows: unencodableCount + (encodable.length - k)
  });

  // Binary search for the longest prefix k in [0, maxCandidateCount] whose
  // canonical JSON bytes (with exact final `truncatedRows`) fit in 256 KiB.
  let lo = 0;
  let hi = maxCandidateCount;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const candidate = makeCandidate(mid);
    if (canonicalUtf8Bytes(candidate) <= CATALOGUE_SNAPSHOT_MAX_BYTES) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  // Re-verify around `best` because decreasing `truncatedRows` by 1 digit
  // could theoretically make `best + 1` fit or vice versa.
  while (
    best < maxCandidateCount &&
    canonicalUtf8Bytes(makeCandidate(best + 1)) <= CATALOGUE_SNAPSHOT_MAX_BYTES
  ) {
    best += 1;
  }
  while (best > 0 && canonicalUtf8Bytes(makeCandidate(best)) > CATALOGUE_SNAPSHOT_MAX_BYTES) {
    best -= 1;
  }

  const snapshot = makeCandidate(best);
  return { snapshot, truncatedRows: snapshot.truncatedRows ?? 0 };
}

export function serializeCatalogueSnapshot(snapshot: CatalogueSnapshot): string {
  return canonicalTrunkJson(snapshot);
}

export function serializeCatalogueDelta(delta: CatalogueDelta): string {
  return canonicalTrunkJson(delta);
}

export function isInstanceStatusUpdate(value: unknown): value is CatalogueInstanceStatusUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== ALLOWED_STATUS_UPDATE_KEYS.size) return false;
  for (const key of keys) {
    if (!ALLOWED_STATUS_UPDATE_KEYS.has(key)) return false;
  }
  if (typeof obj["sessionId"] !== "string" || obj["sessionId"].length === 0) return false;
  if (typeof obj["instanceId"] !== "string" || obj["instanceId"].length === 0) return false;
  if (obj["instanceStatus"] !== "live" && obj["instanceStatus"] !== "revoked") return false;
  return true;
}

function isRow(value: unknown): value is CatalogueSessionRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (!ALLOWED_ROW_KEYS.has(key)) return false;
  }
  if (typeof row["sessionId"] !== "string" || row["sessionId"].length === 0) return false;
  if (row["instance"] !== undefined && typeof row["instance"] !== "string") return false;
  if (row["instanceId"] !== undefined && typeof row["instanceId"] !== "string") return false;
  if (
    row["instanceStatus"] !== undefined &&
    row["instanceStatus"] !== "live" &&
    row["instanceStatus"] !== "revoked"
  ) {
    return false;
  }
  if (row["startedAt"] !== undefined && typeof row["startedAt"] !== "string") return false;
  if (row["heartbeatAt"] !== undefined && typeof row["heartbeatAt"] !== "string") return false;
  if (typeof row["state"] !== "string" || row["state"].length === 0) return false;
  if (row["host"] !== undefined && typeof row["host"] !== "string") return false;
  if (row["name"] !== undefined && typeof row["name"] !== "string") return false;
  if (row["workspaceLabel"] !== undefined && typeof row["workspaceLabel"] !== "string") return false;
  if (row["workStatus"] !== undefined && typeof row["workStatus"] !== "string") return false;
  if (row["hostKind"] !== "native" && row["hostKind"] !== "tmux" && row["hostKind"] !== "unknown") return false;
  if (typeof row["operable"] !== "boolean") return false;
  if (row["excluded"] !== undefined && typeof row["excluded"] !== "boolean") return false;
  if (
    row["operabilityReason"] !== undefined &&
    !ALLOWED_OPERABILITY_REASONS.has(row["operabilityReason"] as CatalogueOperabilityReason)
  ) {
    return false;
  }
  return true;
}

export function parseCatalogueSnapshot(json: string): CatalogueSnapshot {
  if (Buffer.byteLength(json, "utf8") > CATALOGUE_SNAPSHOT_MAX_BYTES) {
    throw new TypeError("catalogue snapshot: exceeds 256 KiB bound");
  }
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("catalogue snapshot: not an object");
  }
  const snap = parsed as Record<string, unknown>;
  for (const key of Object.keys(snap)) {
    if (!ALLOWED_SNAPSHOT_KEYS.has(key)) throw new TypeError(`catalogue snapshot: unexpected field "${key}"`);
  }
  if (snap["v"] !== TRUNK_PROTOCOL_VERSION || snap["t"] !== "cat.snapshot") {
    throw new TypeError("catalogue snapshot: wrong version or type");
  }
  if (
    typeof snap["ch"] !== "number" ||
    !Number.isFinite(snap["ch"]) ||
    typeof snap["s"] !== "number" ||
    !Number.isFinite(snap["s"]) ||
    typeof snap["at"] !== "number" ||
    !Number.isFinite(snap["at"])
  ) {
    throw new TypeError("catalogue snapshot: missing envelope fields");
  }
  let truncatedRows = 0;
  if (snap["truncatedRows"] !== undefined) {
    if (
      typeof snap["truncatedRows"] !== "number" ||
      !Number.isSafeInteger(snap["truncatedRows"]) ||
      snap["truncatedRows"] < 0
    ) {
      throw new TypeError("catalogue snapshot: invalid truncatedRows");
    }
    truncatedRows = snap["truncatedRows"];
  }
  if (!Array.isArray(snap["rows"])) throw new TypeError("catalogue snapshot: rows is not an array");
  const rows = snap["rows"] as unknown[];
  if (rows.length > CATALOGUE_MAX_ROWS) {
    throw new TypeError(`catalogue snapshot: rows exceed cap (${rows.length} > ${CATALOGUE_MAX_ROWS})`);
  }
  for (const row of rows) {
    if (!isRow(row)) throw new TypeError("catalogue snapshot: malformed row");
    if (canonicalUtf8Bytes(row) > CATALOGUE_ROW_MAX_BYTES) {
      throw new TypeError("catalogue snapshot: row exceeds 512 bytes");
    }
  }
  if (containsForbiddenLocalField(parsed)) throw new TypeError("catalogue snapshot: forbidden local field");
  const normalized: CatalogueSnapshot = {
    v: TRUNK_PROTOCOL_VERSION,
    t: "cat.snapshot",
    ch: snap["ch"],
    s: snap["s"],
    at: snap["at"],
    rows: rows as CatalogueSessionRow[],
    truncatedRows
  };
  if (canonicalUtf8Bytes(normalized) > CATALOGUE_SNAPSHOT_MAX_BYTES) {
    throw new TypeError("catalogue snapshot: canonical encoding exceeds 256 KiB bound");
  }
  return normalized;
}

export function parseCatalogueDelta(json: string): CatalogueDelta {
  if (Buffer.byteLength(json, "utf8") > CATALOGUE_SNAPSHOT_MAX_BYTES) {
    throw new TypeError("catalogue delta: exceeds 256 KiB bound");
  }
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("catalogue delta: not an object");
  }
  const delta = parsed as Record<string, unknown>;
  for (const key of Object.keys(delta)) {
    if (!ALLOWED_DELTA_KEYS.has(key)) throw new TypeError(`catalogue delta: unexpected field "${key}"`);
  }
  if (delta["v"] !== TRUNK_PROTOCOL_VERSION || delta["t"] !== "cat.delta") {
    throw new TypeError("catalogue delta: wrong version or type");
  }
  if (
    typeof delta["ch"] !== "number" ||
    !Number.isFinite(delta["ch"]) ||
    typeof delta["s"] !== "number" ||
    !Number.isFinite(delta["s"]) ||
    typeof delta["at"] !== "number" ||
    !Number.isFinite(delta["at"])
  ) {
    throw new TypeError("catalogue delta: missing envelope fields");
  }
  if (!Array.isArray(delta["adds"]) || !Array.isArray(delta["updates"]) || !Array.isArray(delta["removes"])) {
    throw new TypeError("catalogue delta: adds, updates and removes must be arrays");
  }
  const adds = delta["adds"] as unknown[];
  const updates = delta["updates"] as unknown[];
  const removes = delta["removes"] as unknown[];
  if (adds.length + updates.length > CATALOGUE_MAX_ROWS || removes.length > CATALOGUE_MAX_ROWS) {
    throw new TypeError("catalogue delta: entries exceed catalogue row cap");
  }
  for (const row of adds) {
    if (!isRow(row)) throw new TypeError("catalogue delta: malformed add row");
    if (canonicalUtf8Bytes(row) > CATALOGUE_ROW_MAX_BYTES) {
      throw new TypeError("catalogue delta: add row exceeds 512 bytes");
    }
  }
  for (const upd of updates) {
    if (isInstanceStatusUpdate(upd)) {
      if (canonicalUtf8Bytes(upd) > CATALOGUE_ROW_MAX_BYTES) {
        throw new TypeError("catalogue delta: status update exceeds 512 bytes");
      }
      continue;
    }
    if (!isRow(upd)) throw new TypeError("catalogue delta: malformed update entry");
    if (canonicalUtf8Bytes(upd) > CATALOGUE_ROW_MAX_BYTES) {
      throw new TypeError("catalogue delta: update row exceeds 512 bytes");
    }
  }
  for (const sid of removes) {
    if (typeof sid !== "string" || sid.length === 0) {
      throw new TypeError("catalogue delta: malformed remove sessionId");
    }
  }
  if (containsForbiddenLocalField(parsed)) throw new TypeError("catalogue delta: forbidden local field");
  return delta as unknown as CatalogueDelta;
}

/**
 * Apply a validated `CatalogueDelta` to a sorted row view.
 * Partial status updates `{ sessionId, instanceId, instanceStatus }` are
 * applied ONLY to an existing row whose `instanceId` matches.
 */
export function applyCatalogueDelta(
  currentRows: readonly CatalogueSessionRow[],
  delta: CatalogueDelta
): readonly CatalogueSessionRow[] {
  const byId = new Map<string, CatalogueSessionRow>();
  for (const row of currentRows) {
    byId.set(row.sessionId, row);
  }
  for (const sid of delta.removes) {
    byId.delete(sid);
  }
  for (const row of delta.adds) {
    byId.set(row.sessionId, row);
  }
  for (const upd of delta.updates as readonly CatalogueRowUpdate[]) {
    if (isInstanceStatusUpdate(upd)) {
      const existing = byId.get(upd.sessionId);
      if (existing && existing.instanceId === upd.instanceId) {
        byId.set(upd.sessionId, {
          ...existing,
          instanceStatus: upd.instanceStatus
        });
      }
    } else {
      byId.set(upd.sessionId, upd);
    }
  }
  return [...byId.values()].sort((a, b) => compareBinaryString(a.sessionId, b.sessionId));
}
