/**
 * Catalogue projector, wire allowlist, privacy filter and bounds (LH-00 + LH-06).
 *
 * LH-00 helpers (`projectCatalogueRow`, `buildCatalogueSnapshot`) are kept for
 * backward compatibility. The watched pipeline (`catalogue-watch.ts`) uses the
 * joined projection, mirror allowlist sanitization (`sanitizePresenceForMirror`),
 * scalar leak filtering, code-point-safe row shrinking (<= 512 B/row) and
 * snapshot capping (<= 512 rows, <= 256 KiB canonical JSON).
 */

import { H2A_WORK_STATUSES, type H2ALaunchContext, type H2ASession } from "../../session.js";
import { sanitizePresenceForMirror } from "../mirror/sanitize.js";
import { classifyLaunchHost } from "./fleet-inventory.js";
import {
  isCanonicalCatalogueSid,
  nativeCatalogueSid,
  presenceCatalogueSid,
  wireInstanceId
} from "./wire-ids.js";
import {
  CATALOGUE_LABEL_MAX_BYTES,
  CATALOGUE_LABEL_PREFIX_MAX_BYTES,
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
const HOST_RE = /^[a-z0-9._-]{1,16}$/;
const ISO_24_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ALLOWED_WORK_STATUSES: ReadonlySet<string> = new Set<string>([...H2A_WORK_STATUSES, "unknown"]);

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

/**
 * Strip C0 (U+0000..U+001F), DEL (U+007F), and lone UTF-16 surrogates from a
 * catalogue display label, leaving C1 (U+0080..U+009F) and all valid scalars
 * intact per SPEC_EVOL_REMOTE_FASTLANE.md (r11 §7.2).
 */
export function stripCatalogueLabel(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value.slice(i, i + 2);
        i += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }
    if ((code >= 0x00 && code <= 0x1f) || code === 0x7f) {
      continue;
    }
    out += value[i]!;
  }
  return out;
}

/**
 * JCS-escaped string content byte length (without surrounding quotes):
 * quotes and backslashes count 2 bytes, all other scalars count UTF-8 bytes.
 */
export function jcsEscapedLength(value: string): number {
  let bytes = 0;
  for (const ch of value) {
    if (ch === '"' || ch === "\\") {
      bytes += 2;
    } else {
      bytes += Buffer.byteLength(ch, "utf8");
    }
  }
  return bytes;
}

/**
 * Bound a catalogue label to at most 64 UTF-8 bytes and 64 JCS-escaped bytes,
 * truncating on whole Unicode scalars within 61 bytes on both measures plus `…`.
 */
export function boundCatalogueLabel(value: string): string | undefined {
  const stripped = stripCatalogueLabel(value);
  if (stripped.length === 0) return undefined;
  if (
    Buffer.byteLength(stripped, "utf8") <= CATALOGUE_LABEL_MAX_BYTES &&
    jcsEscapedLength(stripped) <= CATALOGUE_LABEL_MAX_BYTES
  ) {
    return stripped;
  }
  let prefix = "";
  let utf8Bytes = 0;
  let jcsBytes = 0;
  for (const ch of stripped) {
    const chUtf8 = Buffer.byteLength(ch, "utf8");
    const chJcs = ch === '"' || ch === "\\" ? 2 : chUtf8;
    if (
      utf8Bytes + chUtf8 > CATALOGUE_LABEL_PREFIX_MAX_BYTES ||
      jcsBytes + chJcs > CATALOGUE_LABEL_PREFIX_MAX_BYTES
    ) {
      break;
    }
    prefix += ch;
    utf8Bytes += chUtf8;
    jcsBytes += chJcs;
  }
  return `${prefix}…`;
}

function hasLeakPattern(value: string, localValues?: ReadonlySet<string>): boolean {
  if (FILE_URI_RE.test(value)) return true;
  if (UNIX_ABS_PATH_RE.test(value)) return true;
  if (WINDOWS_ABS_PATH_RE.test(value)) return true;
  if (UNC_PATH_RE.test(value)) return true;
  if (localValues && (localValues.has(value) || localValues.has(value.trim()))) {
    return true;
  }
  return false;
}

function sanitizeCatalogueLabel(
  value: string | undefined,
  localValues?: ReadonlySet<string>
): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const stripped = stripCatalogueLabel(value);
  if (stripped.length === 0) return undefined;
  if (hasLeakPattern(stripped, localValues)) return undefined;
  return boundCatalogueLabel(stripped);
}

function normalizeCatalogueTimestamp(value: string | undefined): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  try {
    const iso = new Date(value).toISOString();
    return ISO_24_RE.test(iso) ? iso : undefined;
  } catch {
    return undefined;
  }
}

export function sanitizeDisplayScalar(
  value: string | undefined,
  localValues?: ReadonlySet<string>
): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (CONTROL_CHAR_RE.test(value)) return undefined;
  if (hasLeakPattern(value, localValues)) return undefined;
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
  const safeName = sanitizeCatalogueLabel(mirrored.name, localValues);
  const safeWorkspaceLabel = sanitizeCatalogueLabel(mirrored.workspace?.label, localValues);
  // `host` keeps its CLI vocabulary (e.g. "claude", "codex") and must not be
  // stripped when `launchContext.command` happens to equal the CLI name.
  const rawSafeHost = sanitizeDisplayScalar(mirrored.host);
  const safeHost = rawSafeHost !== undefined && HOST_RE.test(rawSafeHost) ? rawSafeHost : undefined;
  const startedAt = normalizeCatalogueTimestamp(mirrored.startedAt);
  const heartbeatAt = normalizeCatalogueTimestamp(mirrored.heartbeatAt);
  const instanceId =
    typeof mirrored.instance === "string" && mirrored.instance.length > 0
      ? wireInstanceId(mirrored.instance)
      : undefined;
  const instanceStatus: CatalogueInstanceStatus = input.instanceStatus ?? "live";
  const workStatus =
    input.presenceFresh &&
    typeof mirrored.workStatus === "string" &&
    ALLOWED_WORK_STATUSES.has(mirrored.workStatus)
      ? mirrored.workStatus
      : "unknown";

  return {
    sessionId: input.sessionId,
    instanceId,
    instanceStatus,
    ...(safeHost === undefined ? {} : { host: safeHost }),
    ...(safeName === undefined ? {} : { name: safeName }),
    ...(safeWorkspaceLabel === undefined ? {} : { workspaceLabel: safeWorkspaceLabel }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(heartbeatAt === undefined ? {} : { heartbeatAt }),
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

function compareBinaryString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Sort rows stably by `sessionId` (binary order) and retain the longest prefix
 * fitting within `CATALOGUE_MAX_ROWS` (512) and `CATALOGUE_SNAPSHOT_MAX_BYTES`
 * (256 KiB), measured on canonical UTF-8 JSON bytes including `truncatedRows`.
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

  const encodable = [...input.rows].sort((a, b) => compareBinaryString(a.sessionId, b.sessionId));
  const unencodableCount = 0;

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
