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
import type { CatalogueProjection } from "./catalogue-plan.js";
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
  type CatalogueInstanceStatus,
  type CatalogueOperabilityReason,
  type CatalogueSessionRow,
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

function compareBinaryString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Sort rows in ascending ASCII order of `sessionId`, deduplicate by `sessionId`,
 * retain at most `CATALOGUE_MAX_ROWS` (512) rows, and count omitted rows in `truncatedRows`.
 */
export function projectBoundedCatalogue(rows: readonly CatalogueSessionRow[]): CatalogueProjection {
  const sorted = [...rows].sort((a, b) => compareBinaryString(a.sessionId, b.sessionId));
  const deduped: CatalogueSessionRow[] = [];
  const seen = new Set<string>();
  for (const row of sorted) {
    if (seen.has(row.sessionId)) continue;
    seen.add(row.sessionId);
    deduped.push(row);
  }
  const bounded = deduped.slice(0, CATALOGUE_MAX_ROWS);
  return {
    rows: bounded,
    truncatedRows: deduped.length - bounded.length
  };
}
