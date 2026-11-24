import type { MouseEncoding, MouseTrackingMode } from "./terminal-modes.js";

/**
 * Native right panel (L0 + L0.5a live selector foundation + L0.5b containment/mouse).
 * Reserved columns mirror the bottom status bar's reserved row: the child PTY is
 * resized to the remaining columns and the panel paints inside the reserved strip.
 * Everything here is behind a default-OFF flag; with the flag off nothing is
 * constructed and attach behaviour is byte-identical to before.
 */

import {
  PanelInputParser,
  type PanelInputEvent,
  type ParsedSgrMouseEvent,
} from "./panel-input.js";

export type RightPanelBarMarkerState = Readonly<{
  enabled: boolean;
  lit: boolean;
  degraded?: boolean;
}>;

/** Format the visible bottom-bar toggle marker (`▸▸`, `▸▸*`, or `▸▸?`) when enabled (`PANEL §4.4`, r2 :462). */
export function formatRightPanelBarMarker(
  marker: RightPanelBarMarkerState | undefined,
): string | undefined {
  if (!marker?.enabled) return undefined;
  if (marker.degraded) return "▸▸?";
  return marker.lit ? "▸▸*" : "▸▸";
}

/**
 * Single source of truth for the clickable hit-test span of the bottom-bar
 * panel toggle marker (`PANEL §4.4`): 1-based inclusive columns `[startCol, endCol]`
 * matching the exact rendered token ` ${token} ` at the right edge of the bar.
 */
export function rightPanelStatusBarHitSpan(
  totalCols: number,
  marker: RightPanelBarMarkerState | undefined,
): { readonly startCol: number; readonly endCol: number } | undefined {
  const token = formatRightPanelBarMarker(marker);
  if (!token || totalCols <= 0) return undefined;
  const safeCols = Math.max(1, Math.trunc(totalCols));
  // Every character in ` ▸▸ `, ` ▸▸* `, ` ▸▸? ` is 1 display column.
  const width = [...` ${token} `].length;
  const startCol = Math.max(1, safeCols - width + 1);
  return { startCol, endCol: totalCols };
}

export const RIGHT_PANEL_TOGGLE_SEQUENCE = "\x1b[24~"; // F12 as VTE sends it
export const RIGHT_PANEL_DEFAULT_WIDTH = 32;
export const RIGHT_PANEL_MIN_WIDTH = 20;
export const RIGHT_PANEL_MAX_WIDTH = 60;
export const RIGHT_PANEL_STRIP_COLS = 1;
export const RIGHT_PANEL_MIN_CHILD_COLS = 40;
export const RIGHT_PANEL_MIN_ROWS = 10;
export const RIGHT_PANEL_WHEEL_STEP = 3;

export type RightPanelSessionStatus =
  | "running"
  | "idle"
  | "waiting"
  | "paused"
  | "blocked"
  | "failed"
  | "question"
  | "decision"
  | "unknown";

/**
 * Broker/D capability status for a session (`02-L0.5a` Step 5, r4 §3.1/§4).
 * L0.5a never claims D is available before INJ L2 real qualification.
 */
export type RightPanelDraftCapabilityState =
  | "unavailable"
  | "refused-no-draft-adapter"
  | "refused-no-capability"
  | "unknown";

/** Draft recovery status for a session (`02-L0.5a` Step 5, r4 §3.6). */
export type RightPanelDraftRecoveryState =
  | "none"
  | "restoring-on-ready"
  | "saved-for-recovery"
  | "uncertain";

/** Provenanced delegated execution rendered under its parent session (`PANEL §4.2`, F9). */
export type RightPanelDelegatedChild = Readonly<{
  id: string;
  label: string;
  tool: string;
  state: "pending" | "running" | "throttled" | "failed";
  origin: "mcp:h2a_run" | "cli:h2a-delegate";
}>;

/**
 * Extra row rendered under a session row (station states and gestures, S1).
 * Activatable rows join the keyboard navigation and emit `activate-extra-row`;
 * a `whenSelected` row only shows while its session row is selected.
 */
export type RightPanelExtraRow = Readonly<{
  id: string;
  text: string;
  activatable?: boolean;
  whenSelected?: boolean;
}>;

export type RightPanelSession = Readonly<{
  id: string;
  label: string;
  status: RightPanelSessionStatus;
  delegated?: boolean;
  /** Last activity of the session, for "most recent of the first group" (S1). */
  mtimeMs?: number;
  /** Pre-localised badges appended after the built-in ones (station, S1). */
  extraBadges?: readonly string[];
  /** Station state/gesture rows listed under this session (S1, r4 §3.6). */
  extraRows?: readonly RightPanelExtraRow[];
  /** Session currently displayed in this attach view ("affichée ici"). */
  displayedHere?: boolean;
  /** Session currently controlled by another terminal/controller ("contrôlée ailleurs"). */
  controlledElsewhere?: boolean;
  /** Compatibility guard held on an older host ("main gardée"). */
  compatGuard?: boolean;
  /** Draft-preserving broker capability (populated via doubles until INJ L2). */
  draftCapability?: RightPanelDraftCapabilityState;
  /** Pending/uncertain draft recovery state (populated via doubles until INJ L2). */
  draftRecovery?: RightPanelDraftRecoveryState;
  /** Provenanced delegated execution names for bottom-bar rendering (`PANEL §4.4`, §11 L1). */
  delegatedNames?: readonly string[];
  /** Provenanced delegated executions for the in-place expander (`PANEL §4.2`, L1). */
  delegatedChildren?: readonly RightPanelDelegatedChild[];
  /** True when delegated provenance is degraded/unverifiable (`PANEL §4.2` => `deleg ?`). */
  delegatedDegraded?: boolean;
  project?: string;
  tool?: string;
  /**
   * S2: the registry `convId` equals the conversation id the plan resolved
   * (loader-computed). Absent or false ⇒ no in-place relaunch of this line.
   */
  resumeConversationVerified?: boolean | undefined;
}>;

/** A dead session of the restore plan carried by the station (S2, plan 09-S2). */
export type RightPanelRestorableState =
  | "deferred"
  | "queued"
  | "launching"
  | "ended"
  | "failed";

export type RightPanelRestorableRow = Readonly<{
  /** Plan classification key (`registry:…`, `scan:…`). */
  key: string;
  label: string;
  project?: string | undefined;
  /**
   * Canonical reason id: `launch` for a row taken by the launch file,
   * `launch-cap`, `resume-argv-unverified`, `unresolved-conversation`,
   * `dual-host`, `unknown-view`, or the raw plan code (`unclassified-scan`,
   * `per-project-scan-cap`, …) displayed as-is.
   */
  reason: string;
  /** Localised reason line (station-decorated; the renderer prefers it). */
  reasonText?: string | undefined;
  state: RightPanelRestorableState;
  /** Localised state line (station-decorated; the renderer prefers it). */
  stateText?: string | undefined;
  /** Issue code of a failed relaunch. */
  code?: string | undefined;
  /** Relaunch tokens (`h2a run … --no-attach`); absent ⇒ no gesture, ever. */
  relaunch?:
    | Readonly<{
        args: readonly string[];
        env: readonly string[];
        cwd: string;
        /** Managed session name to watch for the first running observation. */
        name?: string | undefined;
      }>
    | undefined;
}>;

export type RightPanelWorkspace = Readonly<{
  title: string;
  sessions: readonly RightPanelSession[];
  /** Dead sessions of the restore plan under this tab (station only, S2). */
  restorable?: readonly RightPanelRestorableRow[] | undefined;
  /**
   * Localised restorable section header (station-decorated from
   * `station.restorable.header`; the renderer falls back to English).
   */
  restorableHeader?: string | undefined;
}>;

export type RightPanelDossierLinkClass =
  | "local-md"
  | "claude-artifact"
  | "sentropic-artifact"
  | "h2a-decision-dossier"
  | "not-openable";

export type RightPanelDecision = Readonly<{
  id: string;
  title: string;
  kind: "decision" | "question";
  outcome?: "pending" | "deferred";
  sessionId?: string;
  dossierLink?: string;
  dossierLinkClass?: RightPanelDossierLinkClass;
  isOwnerGate?: boolean;
  workspace?: string;
  /** Project name whose journal of record produced this row (`PANEL §4.3`, L1). */
  project?: string;
  /** Resolved journal-of-record directory cited on this row (`PANEL §4.3`, L1). */
  journalOfRecord?: string;
  /** Decision/question source kind (`PANEL §4.3`, L1). */
  source?: "track" | "owner-gate" | "h2a-message";
  /** ISO timestamp used for oldest-first ordering within each class (`PANEL §4.3`). */
  createdAt?: string;
  /** Stable revision key used for unseen/seen tracking across refreshes (`PANEL §4.5`). */
  revisionKey?: string;
}>;

/** Per-project unreadable Track journal entry (`PANEL §4.3`, §11 L1). */
export type RightPanelProjectDecisionsDegraded = Readonly<{
  project: string;
  trackDir: string;
  reason: string;
}>;

export type RightPanelSnapshot = Readonly<{
  workspaces: readonly RightPanelWorkspace[];
  decisions: readonly RightPanelDecision[];
  /** Per-project unreadable Track stores (`PANEL §4.3`, §11 L1). */
  decisionsDegraded?: readonly RightPanelProjectDecisionsDegraded[];
  /** True when unattributed delegated work exists without proven parent (`PANEL §4.2`). */
  unattributedDelegatedDegraded?: boolean;
  /** Registry refusal detail of the station restore plan (S2, said in the foot). */
  restorablePlanRefused?: string | undefined;
  /** Deduplicated attention subject count (`PANEL §4.5`). */
  attentionCount: number;
  /** True when another session or an unseen pending decision needs owner attention (`PANEL §4.5`). */
  collapsedLit: boolean;
  degraded: boolean;
  /** Non-interactive lines closing the session list (station dead count, S1.1). */
  footerRows?: readonly string[];
}>;

export type RightPanelView = "sessions" | "decisions" | "track";

/**
 * Selection and activation remain two distinct actions (`02-L0.5a` Step 5).
 * L0.5a never switches leases on activation — S1 wires `activate-session`.
 */
export type RightPanelAction =
  | { type: "detach" }
  | { type: "toggle" }
  | { type: "select-tab"; index: number }
  | { type: "select-view"; view: RightPanelView }
  | { type: "select-session"; index: number; sessionId?: string }
  | { type: "activate-session"; index: number; sessionId?: string }
  | { type: "toggle-delegated-expander"; sessionId: string; expanded: boolean }
  | { type: "activate-extra-row"; sessionId: string; rowId: string }
  | { type: "toggle-restorable-expander"; tab: string; expanded: boolean }
  | { type: "activate-restorable-row"; key: string }
  | { type: "select-decision"; index: number; decisionId?: string }
  | { type: "activate-decision"; index: number; decisionId?: string }
  | { type: "open-link"; target: string }
  | { type: "scroll"; offset: number; delta: number };

export type RightPanelGlyphWidthOracle = (glyph: string) => number;

const GLYPHS: Record<
  RightPanelSessionStatus,
  { symbol: string; ansi: string; attention: boolean }
> = {
  running: { symbol: "●", ansi: "\x1b[32m", attention: false },
  idle: { symbol: "○", ansi: "\x1b[37m", attention: false },
  waiting: { symbol: "◐", ansi: "\x1b[34m", attention: false },
  paused: { symbol: "⏸", ansi: "\x1b[33m", attention: false },
  blocked: { symbol: "✖", ansi: "\x1b[31m", attention: true },
  failed: { symbol: "✖", ansi: "\x1b[31m", attention: true },
  question: { symbol: "?", ansi: "\x1b[33m", attention: true },
  decision: { symbol: "◆", ansi: "\x1b[35m", attention: true },
  // PANEL §10: distinct glyph from question (`?` is question-only).
  unknown: { symbol: "·", ansi: "\x1b[2m", attention: false },
};

/**
 * Width-stable ASCII fallback glyphs (`PANEL §10`, L1 Étape 4).
 * Used whenever a terminal width oracle disagrees with F6 display-column accounting.
 */
const FALLBACK_GLYPHS: Record<RightPanelSessionStatus, string> = {
  running: "o",
  idle: ".",
  waiting: "~",
  paused: "||",
  blocked: "x",
  failed: "x",
  question: "?",
  decision: "D",
  unknown: ".",
};

export function sessionStatusGlyph(status: RightPanelSessionStatus) {
  return GLYPHS[status] ?? GLYPHS.unknown;
}

/**
 * Resolve a status glyph verified against an optional terminal width oracle
 * (`PANEL §10`, `14-L1.md` Étape 4). If the oracle reports a different column
 * width than F6 `panelDisplayColumns`, substitutes the stable text fallback
 * (e.g. `||` for `paused`) instead of padding around a broken glyph.
 */
export function resolveStatusGlyph(
  status: RightPanelSessionStatus,
  widthOracle?: RightPanelGlyphWidthOracle,
): { symbol: string; ansi: string; attention: boolean } {
  const base = GLYPHS[status] ?? GLYPHS.unknown;
  if (!widthOracle) return base;
  const expected = panelDisplayColumns(base.symbol);
  let measured: number;
  try {
    measured = widthOracle(base.symbol);
  } catch {
    measured = -1;
  }
  if (measured !== expected) {
    return { ...base, symbol: FALLBACK_GLYPHS[status] ?? FALLBACK_GLYPHS.unknown };
  }
  return base;
}

type RightPanelConfigLike = {
  rightPanel?: {
    enabled?: boolean;
    width?: number;
    trackDirs?: Record<string, string>;
  };
};

function flagValue(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "on", "yes", "enabled"].includes(v)) return true;
  if (["0", "false", "off", "no", "disabled"].includes(v)) return false;
  return undefined;
}

/** Default OFF: only an explicit env or config opt-in enables the panel. */
export function resolveRightPanelEnabled(
  env: NodeJS.ProcessEnv = process.env,
  config?: RightPanelConfigLike,
): boolean {
  const fromEnv = flagValue(env.H2A_RIGHT_PANEL);
  if (fromEnv !== undefined) return fromEnv;
  return config?.rightPanel?.enabled === true;
}

export function resolveRightPanelWidth(
  env: NodeJS.ProcessEnv = process.env,
  config?: RightPanelConfigLike,
): number {
  const fromEnv = Number.parseInt(env.H2A_RIGHT_PANEL_WIDTH ?? "", 10);
  const raw = Number.isFinite(fromEnv) && fromEnv > 0
    ? fromEnv
    : config?.rightPanel?.width;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return RIGHT_PANEL_DEFAULT_WIDTH;
  }
  return Math.min(
    RIGHT_PANEL_MAX_WIDTH,
    Math.max(RIGHT_PANEL_MIN_WIDTH, Math.trunc(raw)),
  );
}

/**
 * Columns reserved on the right. Open reserves the panel width; collapsed
 * reserves the single marker column. Opening is refused (strip kept) when
 * the child would fall below the minimum usable width.
 */
export function rightPanelReservedCols(args: {
  totalCols: number;
  width: number;
  open: boolean;
}): number {
  if (!args.open) return RIGHT_PANEL_STRIP_COLS;
  if (args.totalCols - args.width < RIGHT_PANEL_MIN_CHILD_COLS) {
    return RIGHT_PANEL_STRIP_COLS;
  }
  return args.width;
}

export function decisionSeenKey(decision: Pick<RightPanelDecision, "id" | "revisionKey">): string {
  return decision.revisionKey ?? decision.id;
}

/**
 * Build a deduplicated RightPanelSnapshot following `PANEL §4.5`:
 * - Delegated sub-sessions are filtered out of top-level rows.
 * - `deferred` decisions stay listed (without `*`) and never count as attention
 *   or light the collapsed marker.
 * - `attentionCount` counts unique subjects: each other live session needing
 *   attention counts once, plus each unseen pending decision not attributed to
 *   an already-counted session (or attached session) counts once.
 * - `collapsedLit` is true iff another session (≠ currentSessionId) is
 *   blocked/failed/question or has an unseen pending decision, OR any unseen
 *   pending decision exists.
 */
export function buildRightPanelSnapshot(args: {
  currentSessionId?: string;
  groups: readonly {
    title: string;
    sessions: readonly RightPanelSession[];
    restorable?: readonly RightPanelRestorableRow[] | undefined;
    restorableHeader?: string | undefined;
  }[];
  decisions: readonly RightPanelDecision[];
  decisionsDegraded?: readonly RightPanelProjectDecisionsDegraded[];
  unattributedDelegatedDegraded?: boolean;
  restorablePlanRefused?: string | undefined;
  seenDecisionKeys?: ReadonlySet<string>;
  degraded?: boolean;
}): RightPanelSnapshot {
  const workspaces: RightPanelWorkspace[] = args.groups.map((g) => ({
    title: g.title,
    // Delegated sub-sessions stay hidden from the human list by default.
    sessions: g.sessions.filter((s) => s.delegated !== true),
    // S2: the restorable dead sessions of the plan travel with their tab.
    ...(g.restorable !== undefined ? { restorable: g.restorable } : {}),
    ...(g.restorableHeader !== undefined ? { restorableHeader: g.restorableHeader } : {}),
  }));

  // PANEL §4.3: one list — decisions first, then questions, oldest first within each class.
  const orderedDecisions = args.decisions
    .map((d, idx) => ({ d, idx }))
    .sort((a, b) => {
      const classA = a.d.kind === "question" ? 1 : 0;
      const classB = b.d.kind === "question" ? 1 : 0;
      if (classA !== classB) return classA - classB;
      if (a.d.createdAt && b.d.createdAt) {
        const cmp = a.d.createdAt.localeCompare(b.d.createdAt);
        if (cmp !== 0) return cmp;
      }
      return a.idx - b.idx;
    })
    .map((entry) => entry.d);

  const seen = args.seenDecisionKeys;
  const isUnseenPending = (d: RightPanelDecision): boolean => {
    if (d.outcome === "deferred") return false;
    if (!seen) return true;
    return !seen.has(decisionSeenKey(d));
  };

  // Track which other-sessions have an unseen pending decision attributed to them.
  const sessionsWithUnseenDecision = new Set<string>();
  const unseenPendingDecisions: RightPanelDecision[] = [];
  for (const d of orderedDecisions) {
    if (!isUnseenPending(d)) continue;
    unseenPendingDecisions.push(d);
    if (d.sessionId) sessionsWithUnseenDecision.add(d.sessionId);
  }

  const countedSessionIds = new Set<string>();
  let collapsedLit = false;

  for (const ws of workspaces) {
    for (const s of ws.sessions) {
      if (s.id === args.currentSessionId) continue;
      if (s.status === "blocked" || s.status === "failed" || s.status === "question") {
        countedSessionIds.add(s.id);
        collapsedLit = true;
      } else if (s.status === "decision") {
        // A session whose status is "decision" lights the marker when it has an
        // unseen pending decision (or when no explicit seen set was provided).
        if (!seen || sessionsWithUnseenDecision.has(s.id)) {
          countedSessionIds.add(s.id);
          collapsedLit = true;
        }
      } else if (sessionsWithUnseenDecision.has(s.id)) {
        countedSessionIds.add(s.id);
        collapsedLit = true;
      }
    }
  }

  let unattributedUnseenCount = 0;
  for (const d of unseenPendingDecisions) {
    // Any unseen pending decision lights the collapsed marker (unless it was
    // specifically bound to the attached session — wait: PANEL §4.5 says "any
    // pending decision created or revised since the owner last opened the panel").
    if (d.sessionId && countedSessionIds.has(d.sessionId)) {
      continue;
    }
    if (d.sessionId && d.sessionId === args.currentSessionId) {
      continue;
    }
    unattributedUnseenCount += 1;
    collapsedLit = true;
  }

  const decisionsDegraded =
    args.decisionsDegraded && args.decisionsDegraded.length > 0
      ? [...args.decisionsDegraded]
      : undefined;

  return {
    workspaces,
    decisions: orderedDecisions,
    ...(decisionsDegraded ? { decisionsDegraded } : {}),
    ...(args.unattributedDelegatedDegraded === true
      ? { unattributedDelegatedDegraded: true }
      : {}),
    // S2: a refused restore plan is said once, in the foot of the station.
    ...(args.restorablePlanRefused !== undefined
      ? { restorablePlanRefused: args.restorablePlanRefused }
      : {}),
    attentionCount: countedSessionIds.size + unattributedUnseenCount,
    collapsedLit,
    degraded: args.degraded === true || (decisionsDegraded?.length ?? 0) > 0,
  };
}

export type TrackDecisionRow = {
  id: string;
  title: string;
  outcome?: string;
  workspace?: string;
  accountable?: string;
  createdAt?: string;
  openQuestionCount?: number;
  artifacts?: readonly (
    | { kind: "h2a-decision-dossier"; negotiationRef: string; dossierHash?: string; label?: string }
    | { kind: "rendered-view"; viewRef: string; label?: string }
    | { kind: "mockup"; viewRef: string; label?: string }
  )[];
  /** Legacy test-fixture compatibility fields (real Track rows use `artifacts[]` / item `links[]`). */
  dossier?: { path?: string; url?: string; link?: string } | string;
  dossierLink?: string;
  sessionId?: string;
  qa?: readonly { question?: string; answer?: unknown }[];
};

export function classifyDossierRef(
  ref: string,
  repoRoot?: string,
): { link: string; linkClass: RightPanelDossierLinkClass } {
  const trimmed = ref.trim();
  if (trimmed.startsWith("https://claude.ai/")) {
    return { link: trimmed, linkClass: "claude-artifact" };
  }
  if (/^https?:\/\/[^/]*sentropic[^/]*\//i.test(trimmed)) {
    return { link: trimmed, linkClass: "sentropic-artifact" };
  }
  if (trimmed.startsWith("chat:")) {
    return { link: trimmed, linkClass: "not-openable" };
  }
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) && /\.md$/i.test(trimmed)) {
    const resolved =
      repoRoot && !trimmed.startsWith("/")
        ? `${repoRoot.replace(/\/+$/, "")}/${trimmed.replace(/^\.\//, "")}`
        : trimmed;
    return { link: resolved, linkClass: "local-md" };
  }
  return { link: trimmed, linkClass: "not-openable" };
}

function dossierLinkOf(
  row: TrackDecisionRow,
  repoRoot?: string,
): { link: string; linkClass: RightPanelDossierLinkClass } | undefined {
  // Priority 1: real Track `artifacts[]` in addition order (`PANEL §4.3`).
  if (Array.isArray(row.artifacts)) {
    for (const art of row.artifacts) {
      if (art.kind === "h2a-decision-dossier" && typeof art.negotiationRef === "string" && art.negotiationRef) {
        return { link: art.negotiationRef, linkClass: "h2a-decision-dossier" };
      }
      if ((art.kind === "rendered-view" || art.kind === "mockup") && typeof art.viewRef === "string" && art.viewRef) {
        return classifyDossierRef(art.viewRef, repoRoot);
      }
    }
  }
  // Fallback for synthetic unit fixtures that pass direct link fields.
  if (typeof row.dossierLink === "string" && row.dossierLink) {
    return classifyDossierRef(row.dossierLink, repoRoot);
  }
  if (typeof row.dossier === "string" && row.dossier) {
    return classifyDossierRef(row.dossier, repoRoot);
  }
  if (row.dossier && typeof row.dossier === "object") {
    const raw = row.dossier.path ?? row.dossier.url ?? row.dossier.link;
    if (raw) return classifyDossierRef(raw, repoRoot);
  }
  return undefined;
}

/** Pending/deferred Track decisions plus their unanswered questions. */
export function decisionsFromTrackDecisions(
  rows: readonly TrackDecisionRow[],
  opts?: { repoRoot?: string },
): RightPanelDecision[] {
  const out: RightPanelDecision[] = [];
  for (const row of rows) {
    if (row.outcome !== "pending" && row.outcome !== "deferred") continue;
    const isOwnerGate = row.title.trimStart().startsWith("OWNER GATE");
    const unanswered =
      isOwnerGate ||
      (typeof row.openQuestionCount === "number" && row.openQuestionCount > 0) ||
      (row.qa ?? []).some(
        (q) => q.answer === undefined || q.answer === null || q.answer === "",
      );
    const derived = dossierLinkOf(row, opts?.repoRoot);
    out.push({
      id: row.id,
      title: row.title,
      kind: unanswered ? "question" : "decision",
      outcome: row.outcome,
      ...(isOwnerGate ? { isOwnerGate: true } : {}),
      ...(row.workspace ? { workspace: row.workspace } : {}),
      ...(row.sessionId ? { sessionId: row.sessionId } : {}),
      ...(typeof row.createdAt === "string" && row.createdAt ? { createdAt: row.createdAt } : {}),
      ...(derived
        ? { dossierLink: derived.link, dossierLinkClass: derived.linkClass }
        : {}),
      revisionKey: `${row.id}:${row.outcome}:${row.title}:${derived?.link ?? ""}:${unanswered ? "q" : "d"}`,
    });
  }
  return out;
}

export type SgrMouseEvent = ParsedSgrMouseEvent;

const SGR_MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

/** Parse complete SGR mouse sequences; an incomplete tail stays in `rest`. */
export function parseSgrMouse(data: string): {
  events: SgrMouseEvent[];
  rest: string;
} {
  const events: SgrMouseEvent[] = [];
  let rest = data;
  let match: RegExpExecArray | null;
  SGR_MOUSE_RE.lastIndex = 0;
  let consumedUpTo = 0;
  while ((match = SGR_MOUSE_RE.exec(data)) !== null) {
    const button = Number(match[1]);
    events.push({
      button,
      x: Number(match[2]),
      y: Number(match[3]),
      release: match[4] === "m",
      wheel: (button & 64) !== 0,
      shift: (button & 4) !== 0,
    });
    consumedUpTo = match.index + match[0].length;
  }
  if (events.length > 0) {
    const tail = data.slice(consumedUpTo);
    const first = data.indexOf("\x1b[<");
    const head = first >= 0 ? data.slice(0, first) : "";
    rest = head + tail;
  }
  return { events, rest };
}

export type MouseRoute = Readonly<{
  zone: "panel" | "cli" | "native-selection" | "status-marker" | "status-bar";
  forwardToCli: boolean;
}>;

export function routePanelMouse(
  event: SgrMouseEvent,
  geom: {
    totalCols: number;
    totalRows: number;
    childCols: number;
    open: boolean;
    statusBarActive?: boolean;
    statusBarMarker?: RightPanelBarMarkerState;
  },
  opts: { cliMouseEnabled: boolean },
): MouseRoute {
  if (event.shift) return { zone: "native-selection", forwardToCli: false };
  // When the bottom bar is active, the entire last row is reserved (PANEL:181, :385).
  const barActive = geom.statusBarActive !== false;
  if (barActive && event.y >= geom.totalRows) {
    const span = rightPanelStatusBarHitSpan(
      geom.totalCols,
      geom.statusBarMarker ?? { enabled: true, lit: false },
    );
    if (span && event.x >= span.startCol && event.x <= span.endCol) {
      return { zone: "status-marker", forwardToCli: false };
    }
    return { zone: "status-bar", forwardToCli: false };
  }
  if (event.x > geom.childCols) return { zone: "panel", forwardToCli: false };
  return { zone: "cli", forwardToCli: opts.cliMouseEnabled };
}

/**
 * Transcode an outer SGR mouse event to the child CLI's negotiated mouse
 * reporting mode and encoding (PANEL:381, :386; r2:662). Returns undefined
 * when the child did not subscribe to this event class or coordinates cannot
 * be represented in the target encoding.
 */
export function transcodeSgrMouseForChild(
  event: SgrMouseEvent,
  mode: MouseTrackingMode | null,
  encoding: MouseEncoding,
): string | undefined {
  if (mode === null) return undefined;
  const isMotion = (event.button & 32) !== 0;
  const isDragMotion = isMotion && (event.button & 3) !== 3;
  if (mode === 9) {
    if (event.release || event.wheel || isMotion) return undefined;
  } else if (mode === 1000) {
    if (isMotion) return undefined;
  } else if (mode === 1002) {
    if (isMotion && !isDragMotion) return undefined;
  }

  if (encoding === "sgr" || encoding === "sgr-pixel") {
    return `\x1b[<${event.button};${event.x};${event.y}${event.release ? "m" : "M"}`;
  }
  const rawBtn = event.release ? (event.button & ~3) | 3 : event.button;
  if (encoding === "urxvt") {
    return `\x1b[${rawBtn + 32};${event.x};${event.y}M`;
  }
  if (encoding === "utf8") {
    if (event.x < 1 || event.y < 1 || event.x > 2015 || event.y > 2015) {
      return undefined;
    }
    return `\x1b[M${String.fromCodePoint(rawBtn + 32, event.x + 32, event.y + 32)}`;
  }
  // Legacy X10 / normal 3-byte encoding (coordinates 1..223)
  if (event.x < 1 || event.y < 1 || event.x > 223 || event.y > 223) {
    return undefined;
  }
  return `\x1b[M${String.fromCharCode(rawBtn + 32, event.x + 32, event.y + 32)}`;
}

type PanelStdout = {
  columns?: number;
  rows?: number;
  write(chunk: string): boolean;
};

/** A mouse event forwarded to the child, with the encoding it was sent in. */
export type RightPanelForwardedMouse = Readonly<{
  button: number;
  x: number;
  y: number;
  release: boolean;
  wheel: boolean;
  motion: boolean;
  mode: MouseTrackingMode;
  encoding: MouseEncoding;
}>;

export type RightPanelHandleResult = Readonly<{
  consumed: boolean;
  forward?: string;
  forwardBytes?: Buffer;
  actions: RightPanelAction[];
  /** Forwarded mouse events, so a held press can be released at a switch (S1). */
  forwardedMouse?: RightPanelForwardedMouse[];
}>;

/**
 * Content shown in place of the list while present (station cards and the
 * draft recovery view, S1). It owns every panel-focus key: nothing typed while
 * it is up reaches the list or a session.
 */
export interface RightPanelOverlay {
  render(width: number, rows: number): readonly string[];
  handleKey(event: PanelInputEvent): boolean;
  handleWheel?(deltaRows: number): boolean;
  /** 0-based row inside the overlay viewport. */
  handleClick?(row: number): boolean;
}

export type RightPanelHandleInputOptions = Readonly<{
  cliMouseEnabled: boolean;
  cliMouseMode?: MouseTrackingMode | null;
  cliMouseEncoding?: MouseEncoding;
  bracketedPasteEnabled?: boolean;
  kittyKeyboardEnabled?: boolean;
  statusBarActive?: boolean;
}>;

function isWideCodePoint(cp: number): boolean {
  return (
    cp >= 0x1100 &&
    (cp <= 0x115f ||
      cp === 0x2329 ||
      cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      (cp >= 0x20000 && cp <= 0x3fffd))
  );
}

/**
 * Display-column width matching F6 `terminalDisplayColumns` (`status-projection.ts`),
 * ignoring ANSI CSI sequences, combining marks (`\p{Mark}`), and C0/C1 controls.
 */
export function panelDisplayColumns(text: string): number {
  let visible = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\x1b" && text[i + 1] === "[") {
      let j = i + 2;
      while (j < text.length && text.charCodeAt(j) >= 0x20 && text.charCodeAt(j) <= 0x3f) {
        j += 1;
      }
      if (j < text.length && text.charCodeAt(j) >= 0x40 && text.charCodeAt(j) <= 0x7e) {
        i = j + 1;
        continue;
      }
    }
    const cp = text.codePointAt(i)!;
    const step = cp > 0xffff ? 2 : 1;
    const raw = text.slice(i, i + step);
    if (
      cp < 0x20 ||
      (cp >= 0x7f && cp <= 0x9f) ||
      /\p{Mark}/u.test(raw)
    ) {
      i += step;
      continue;
    }
    visible += isWideCodePoint(cp) ? 2 : 1;
    i += step;
  }
  return visible;
}

/**
 * Fit text (which may include ANSI SGR escape sequences, wide CJK glyphs, and
 * combining marks) to exact visible display columns matching F6 accounting:
 * truncate with "…" if wider, pad with spaces if narrower.
 */
function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  type Token = { raw: string; cols: number; isAnsi: boolean; isMark: boolean };
  const tokens: Token[] = [];
  let visible = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\x1b" && text[i + 1] === "[") {
      let j = i + 2;
      while (j < text.length && text.charCodeAt(j) >= 0x20 && text.charCodeAt(j) <= 0x3f) {
        j += 1;
      }
      if (j < text.length && text.charCodeAt(j) >= 0x40 && text.charCodeAt(j) <= 0x7e) {
        tokens.push({ raw: text.slice(i, j + 1), cols: 0, isAnsi: true, isMark: false });
        i = j + 1;
        continue;
      }
    }
    const cp = text.codePointAt(i)!;
    const step = cp > 0xffff ? 2 : 1;
    const raw = text.slice(i, i + step);
    const isMark = /\p{Mark}/u.test(raw);
    const cols =
      cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || isMark
        ? 0
        : isWideCodePoint(cp)
          ? 2
          : 1;
    tokens.push({ raw, cols, isAnsi: false, isMark });
    visible += cols;
    i += step;
  }
  if (visible <= width) {
    return text + " ".repeat(width - visible);
  }
  const limit = Math.max(0, width - 1);
  let out = "";
  let used = 0;
  let hasAnsi = false;
  for (let idx = 0; idx < tokens.length; idx += 1) {
    const tok = tokens[idx]!;
    if (tok.isAnsi) {
      out += tok.raw;
      hasAnsi = true;
      continue;
    }
    if (tok.isMark) {
      // Attach combining mark only if its base character was emitted.
      if (used > 0) out += tok.raw;
      continue;
    }
    if (used + tok.cols > limit) break;
    out += tok.raw;
    used += tok.cols;
  }
  if (hasAnsi) out += "\x1b[0m";
  if (width >= 1) {
    out += "…";
    used += 1;
  }
  if (used < width) out += " ".repeat(width - used);
  return out;
}

function formatSessionBadges(session: RightPanelSession): string {
  const tags: string[] = [];
  if (session.displayedHere) tags.push("ici");
  if (session.controlledElsewhere) tags.push("ailleurs");
  if (session.compatGuard) tags.push("gardée");
  if (session.draftRecovery && session.draftRecovery !== "none") {
    tags.push(session.draftRecovery === "saved-for-recovery" ? "récup" : session.draftRecovery);
  }
  if (session.draftCapability === "refused-no-draft-adapter") {
    tags.push("D:refus");
  }
  if (session.extraBadges) tags.push(...session.extraBadges);
  return tags.length > 0 ? ` [${tags.join(",")}]` : "";
}

type TabHitSpan = Readonly<{ index: number; startCol: number; endCol: number }>;
type ViewHitSpan = Readonly<{ view: RightPanelView; startCol: number; endCol: number }>;
type RenderedListRow = Readonly<{
  text: string;
  hit?: RightPanelAction;
  isSelected?: boolean;
}>;

export class RightPanelController {
  readonly #stdout: PanelStdout;
  readonly #width: number;
  readonly #parser = new PanelInputParser();
  readonly #onOpen: (() => void) | undefined;
  readonly #onSelectionChange: (() => void) | undefined;
  readonly #restoreChildState: (() => string) | undefined;
  readonly #isStatusBarActive: (() => boolean) | undefined;
  readonly #glyphWidthOracle: RightPanelGlyphWidthOracle | undefined;
  #snapshot: RightPanelSnapshot;
  #open = false;
  #focus = false;
  #barSelectionActive = false;
  view: RightPanelView = "sessions";
  activeTabIndex = 0;
  #selectedSession = 0;
  #selectedDecision = 0;
  #sessionScrollOffset = 0;
  #decisionScrollOffset = 0;
  #lastViewportRows = 1;
  #lastTotalListRows = 0;
  #expandedDelegatedSessions = new Set<string>();
  /** S2: expanded restorable sections, by tab title. */
  #expandedRestorable = new Set<string>();
  /**
   * S2: cursor in the restorable section of the tab (`undefined` = among the
   * live sessions; `-1` = on the expander; `>= 0` = on a restorable row).
   */
  #selectedRestorable: number | undefined;
  #slashPrompt: string | undefined;
  #notice: string | undefined;
  #hitRows = new Map<number, RightPanelAction>();
  #overlay: RightPanelOverlay | undefined;
  /** Selected extra row of the selected session, when the cursor is on one. */
  #selectedExtra: string | undefined;
  #tabHitSpans: TabHitSpan[] = [];
  #viewHitSpans: ViewHitSpan[] = [];
  #viewFooterRow: number | undefined;

  constructor(opts: {
    stdout: PanelStdout;
    snapshot: RightPanelSnapshot;
    width?: number;
    onOpen?: () => void;
    onSelectionChange?: () => void;
    restoreChildState?: () => string;
    isStatusBarActive?: () => boolean;
    glyphWidthOracle?: RightPanelGlyphWidthOracle;
  }) {
    this.#stdout = opts.stdout;
    this.#snapshot = opts.snapshot;
    this.#width = opts.width ?? RIGHT_PANEL_DEFAULT_WIDTH;
    this.#onOpen = opts.onOpen;
    this.#onSelectionChange = opts.onSelectionChange;
    this.#restoreChildState = opts.restoreChildState;
    this.#isStatusBarActive = opts.isStatusBarActive;
    this.#glyphWidthOracle = opts.glyphWidthOracle;
  }

  isPaintActive(): boolean {
    const totalCols = this.#stdout.columns ?? 0;
    const totalRows = this.#stdout.rows ?? 0;
    return totalCols > 0 && totalRows >= RIGHT_PANEL_MIN_ROWS;
  }

  isOpen(): boolean {
    if (!this.#open) return false;
    const totalCols = this.#stdout.columns ?? 0;
    if (totalCols > 0 && totalCols - this.#width < RIGHT_PANEL_MIN_CHILD_COLS) {
      return false;
    }
    return true;
  }

  hasPanelFocus(): boolean {
    return this.isOpen() && this.#focus;
  }

  selectedSessionIndex(): number {
    return this.#selectedSession;
  }

  selectedDecisionIndex(): number {
    return this.#selectedDecision;
  }

  /** Extra row under the selected session the cursor is on, if any. */
  selectedExtraRowId(): string | undefined {
    return this.#selectedExtra;
  }

  /** Show or clear the overlay that replaces the list (cards, recovery view). */
  setOverlay(overlay: RightPanelOverlay | undefined): void {
    this.#overlay = overlay;
    this.paint();
  }

  overlay(): RightPanelOverlay | undefined {
    return this.#overlay;
  }

  /**
   * Open or close without the toggle's focus rule: the station opens the panel
   * at launch while the keyboard stays on the CLI (r2 §2.3).
   */
  setOpen(open: boolean, opts: { focus?: boolean } = {}): boolean {
    if (open) {
      const totalCols = this.#stdout.columns ?? 0;
      if (totalCols > 0 && totalCols - this.#width < RIGHT_PANEL_MIN_CHILD_COLS) {
        this.#open = false;
        this.#focus = false;
        this.#barSelectionActive = false;
        return false;
      }
      const wasOpen = this.#open;
      this.#open = true;
      this.#focus = opts.focus === true;
      this.#barSelectionActive = this.#focus;
      if (!wasOpen) this.#onOpen?.();
      return true;
    }
    this.#open = false;
    this.#focus = false;
    this.#barSelectionActive = false;
    return true;
  }

  /** Return the keyboard to the CLI; the panel stays as it is (r2 §2.3). */
  focusCli(): void {
    if (!this.#focus && !this.#barSelectionActive) return;
    this.#focus = false;
    this.#barSelectionActive = false;
    this.paint();
    this.#onSelectionChange?.();
  }

  /** Move the cursor to a session row (and its tab) without activating it. */
  selectSessionById(sessionId: string): boolean {
    for (let tab = 0; tab < this.#snapshot.workspaces.length; tab += 1) {
      const index = this.#snapshot.workspaces[tab]!.sessions.findIndex(
        (session) => session.id === sessionId,
      );
      if (index < 0) continue;
      this.activeTabIndex = tab;
      this.#selectedSession = index;
      // S2: the cursor follows the displayed live session, out of restorable.
      this.#selectedRestorable = undefined;
      this.#selectedExtra = undefined;
      this.#ensureSelectedRowVisible();
      this.paint();
      return true;
    }
    return false;
  }

  scrollOffset(): number {
    if (this.view === "sessions") return this.#sessionScrollOffset;
    if (this.view === "decisions") return this.#decisionScrollOffset;
    return 0;
  }

  tabHitSpans(): readonly TabHitSpan[] {
    return this.#tabHitSpans;
  }

  /**
   * Delegated session names for the currently selected right-panel session
   * (`PANEL §4.4`, L1). Returns `undefined` when panel is closed or deselected
   * so bottom-bar rendering restores the byte-identical count form.
   * Never reads or exposes draft D fields.
   */
  selectedDelegatedNamesForBar(): readonly string[] | "unknown" | undefined {
    if (!this.isOpen() || !this.#barSelectionActive || this.view !== "sessions") {
      return undefined;
    }
    const ws = this.#snapshot.workspaces[this.activeTabIndex];
    const session = ws?.sessions[this.#selectedSession];
    if (!session) return undefined;
    if (session.delegatedNames !== undefined && session.delegatedNames.length > 0) {
      return session.delegatedNames;
    }
    if (session.delegatedDegraded === true) {
      return "unknown";
    }
    if (session.delegatedNames !== undefined) {
      return session.delegatedNames;
    }
    return undefined;
  }

  clearSelection(): void {
    if (!this.#barSelectionActive) return;
    this.#barSelectionActive = false;
    this.#onSelectionChange?.();
    this.paint();
  }

  slashPrompt(): string | undefined {
    return this.#slashPrompt;
  }

  notice(): string | undefined {
    return this.#notice;
  }

  hasPendingEscape(): boolean {
    return this.#parser.hasPendingEscape();
  }

  statusBarMarker(): RightPanelBarMarkerState {
    return {
      enabled: true,
      lit: this.#snapshot.collapsedLit && !this.#snapshot.degraded,
      degraded: this.#snapshot.degraded,
    };
  }

  setSnapshot(snapshot: RightPanelSnapshot): void {
    this.#snapshot = snapshot;
    if (this.activeTabIndex >= snapshot.workspaces.length) {
      this.activeTabIndex = 0;
    }
    this.#clampSelection();
    this.paint();
    this.#onSelectionChange?.();
  }

  /** S2: restorable rows of the active tab, whether or not they are shown. */
  #restorableRows(): readonly RightPanelRestorableRow[] {
    if (this.view !== "sessions") return [];
    return this.#snapshot.workspaces[this.activeTabIndex]?.restorable ?? [];
  }

  /**
   * S2: walkable restorable rows of the active tab (empty without a station
   * plan, or while its expander is collapsed so hidden rows stay
   * unselectable; the expander itself is always reachable).
   */
  #activeRestorable(): readonly RightPanelRestorableRow[] {
    const ws = this.#snapshot.workspaces[this.activeTabIndex];
    if (this.view !== "sessions" || !ws || !this.#expandedRestorable.has(ws.title)) return [];
    return ws.restorable ?? [];
  }

  #clampSelection(): void {
    const ws = this.#snapshot.workspaces[this.activeTabIndex];
    const sLen = ws?.sessions.length ?? 0;
    this.#selectedSession = sLen === 0 ? 0 : Math.min(this.#selectedSession, sLen - 1);
    const rLen = this.#restorableRows().length;
    if (this.#selectedRestorable !== undefined && rLen === 0) {
      this.#selectedRestorable = undefined;
    } else if (this.#selectedRestorable !== undefined && this.#selectedRestorable >= rLen) {
      this.#selectedRestorable = rLen - 1;
    }
    const dLen = this.#snapshot.decisions.length;
    this.#selectedDecision = dLen === 0 ? 0 : Math.min(this.#selectedDecision, dLen - 1);
    if (
      this.#selectedExtra !== undefined &&
      !this.#focusableExtras(this.#selectedSession).some((row) => row.id === this.#selectedExtra)
    ) {
      this.#selectedExtra = undefined;
    }
  }

  /** Activatable extra rows currently visible under a session row. */
  #focusableExtras(sessionIndex: number): RightPanelExtraRow[] {
    const session = this.#snapshot.workspaces[this.activeTabIndex]?.sessions[sessionIndex];
    return (session?.extraRows ?? []).filter(
      (row) =>
        row.activatable === true &&
        (row.whenSelected !== true || sessionIndex === this.#selectedSession),
    );
  }

  childCols(totalCols: number): number {
    const totalRows = this.#stdout.rows ?? 0;
    if (totalRows > 0 && totalRows < RIGHT_PANEL_MIN_ROWS) {
      return totalCols;
    }
    return (
      totalCols -
      rightPanelReservedCols({ totalCols, width: this.#width, open: this.#open })
    );
  }

  reservedCols(): number {
    const total = this.#stdout.columns ?? 0;
    const totalRows = this.#stdout.rows ?? 0;
    if (totalRows > 0 && totalRows < RIGHT_PANEL_MIN_ROWS) {
      return 0;
    }
    return rightPanelReservedCols({
      totalCols: total,
      width: this.#width,
      open: this.#open,
    });
  }

  toggle(): void {
    this.#slashPrompt = undefined;
    this.#notice = undefined;
    if (!this.#open) {
      const totalCols = this.#stdout.columns ?? 0;
      if (totalCols > 0 && totalCols - this.#width < RIGHT_PANEL_MIN_CHILD_COLS) {
        // Opening refused below minimum child columns; keep marker strip intact.
        this.#open = false;
        this.#focus = false;
        this.#barSelectionActive = false;
        this.paint();
        this.#onSelectionChange?.();
        return;
      }
      this.#open = true;
      this.#focus = true;
      this.#barSelectionActive = true;
      this.#onOpen?.();
    } else {
      this.#open = false;
      this.#focus = false;
      this.#barSelectionActive = false;
    }
    this.paint();
    this.#onSelectionChange?.();
  }

  onResize(): void {
    const totalCols = this.#stdout.columns ?? 0;
    if (this.#open && totalCols > 0 && totalCols - this.#width < RIGHT_PANEL_MIN_CHILD_COLS) {
      this.#focus = false;
      this.#barSelectionActive = false;
    }
    this.paint();
    this.#onSelectionChange?.();
  }

  dispose(): void {
    this.#open = false;
    this.#focus = false;
    this.#barSelectionActive = false;
    this.#parser.reset();
  }

  #panelRows(totalRows: number): number {
    const barActive = this.#isStatusBarActive ? this.#isStatusBarActive() : true;
    return barActive ? Math.max(0, totalRows - 1) : totalRows;
  }

  paint(): void {
    if (!this.isPaintActive()) return;
    const totalCols = this.#stdout.columns ?? 0;
    const totalRows = this.#stdout.rows ?? 0;
    const childCols = this.childCols(totalCols);
    const width = Math.max(0, totalCols - childCols);
    if (width <= 0) return;
    const panelRows = this.#panelRows(totalRows);
    const lines = this.#renderLines(childCols, panelRows);
    const blank = " ".repeat(width);
    // Never use DECSC/SCOSC (ESC 7/8, CSI s/u) or ?69/DECSLRM (PANEL:182-183).
    // Reset origin/insert/SGR before painting, then restore from the child-sized headless model.
    let out = "\x1b[?6l\x1b[4l\x1b[0m";
    for (let row = 1; row <= panelRows; row += 1) {
      out += `\x1b[${row};${childCols + 1}H${lines[row - 1] ?? blank}\x1b[0m`;
    }
    out += this.#restoreChildState?.() ?? "";
    this.#stdout.write(out);
  }

  #buildTabHeaderAndSpans(childCols: number, width: number): {
    headerLine: string;
    spans: TabHitSpan[];
  } {
    if (this.#slashPrompt !== undefined) {
      return { headerLine: truncate(`${this.#slashPrompt}_`, width), spans: [] };
    }
    if (this.#notice !== undefined) {
      return { headerLine: truncate(this.#notice, width), spans: [] };
    }
    const workspaces = this.#snapshot.workspaces;
    if (workspaces.length === 0) {
      const text = this.#snapshot.degraded ? "sessions [unknown]" : "sessions";
      return { headerLine: truncate(text, width), spans: [] };
    }

    const spans: TabHitSpan[] = [];
    let colOffset = 0;
    const parts: string[] = [];
    for (let i = 0; i < workspaces.length; i += 1) {
      if (i > 0) colOffset += 1; // single-space separator
      const label = i === this.activeTabIndex ? `[${workspaces[i]!.title}]` : workspaces[i]!.title;
      const labelCols = panelDisplayColumns(label);
      if (colOffset < width && labelCols > 0) {
        const startCol = childCols + 1 + colOffset;
        const endCol = childCols + Math.min(width, colOffset + labelCols);
        if (endCol >= startCol) {
          spans.push({ index: i, startCol, endCol });
        }
      }
      colOffset += labelCols;
      parts.push(label);
    }
    const joined = parts.join(" ");
    const full = this.#snapshot.degraded ? `${joined} [unknown]` : joined;
    return { headerLine: truncate(full, width), spans };
  }

  #buildViewFooterAndSpans(childCols: number, width: number): {
    footerLine: string;
    spans: ViewHitSpan[];
  } {
    const entries: Array<{ view: RightPanelView; token: string }> = [
      { view: "sessions", token: "/s" },
      { view: "decisions", token: "/d" },
      { view: "track", token: "/t" },
    ];
    const spans: ViewHitSpan[] = [];
    const parts: string[] = [];
    let colOffset = 0;
    for (let i = 0; i < entries.length; i += 1) {
      if (i > 0) colOffset += 1;
      const entry = entries[i]!;
      const label = entry.view === this.view ? `[${entry.token}]` : entry.token;
      const labelCols = panelDisplayColumns(label);
      if (colOffset < width && labelCols > 0) {
        const startCol = childCols + 1 + colOffset;
        const endCol = childCols + Math.min(width, colOffset + labelCols);
        if (endCol >= startCol) {
          spans.push({ view: entry.view, startCol, endCol });
        }
      }
      colOffset += labelCols;
      parts.push(label);
    }
    return { footerLine: truncate(parts.join(" "), width), spans };
  }

  #buildListRows(width: number): RenderedListRow[] {
    const rows: RenderedListRow[] = [];
    if (this.view === "sessions") {
      const ws = this.#snapshot.workspaces[this.activeTabIndex];
      const sessions = ws?.sessions ?? [];
      // S2: the cursor is either among the live sessions or in the restorable
      // section, never both.
      const inRestorable = this.#selectedRestorable !== undefined;
      let sawSessionDelegDegraded = false;
      sessions.forEach((s, index) => {
        const g = resolveStatusGlyph(s.status, this.#glyphWidthOracle);
        const star = g.attention ? "*" : " ";
        const badges = formatSessionBadges(s);
        const rawLabel =
          s.status === "unknown"
            ? `${s.label} unknown${badges}`
            : `${s.label}${badges}`;
        const isSelected = index === this.#selectedSession && !inRestorable;
        const body = truncate(`${g.symbol}${star} ${rawLabel}`, width);
        const symbolCols = panelDisplayColumns(g.symbol);
        const text = isSelected
          ? `\x1b[7m${body}\x1b[0m`
          : `${g.ansi}${g.symbol}\x1b[0m${truncate(`${star} ${rawLabel}`, Math.max(0, width - symbolCols))}`;
        const cursorOnExtra = isSelected && this.#selectedExtra !== undefined;
        rows.push({
          text: cursorOnExtra
            ? `${g.ansi}${g.symbol}\x1b[0m${truncate(`${star} ${rawLabel}`, Math.max(0, width - symbolCols))}`
            : text,
          hit: { type: "select-session", index, sessionId: s.id },
          isSelected: isSelected && !cursorOnExtra,
        });

        for (const extra of s.extraRows ?? []) {
          if (extra.whenSelected === true && !isSelected) continue;
          const extraSelected = isSelected && this.#selectedExtra === extra.id;
          const body = truncate(`  ${extra.text}`, width);
          rows.push({
            text: extraSelected ? `\x1b[7m${body}\x1b[0m` : body,
            ...(extra.activatable === true
              ? {
                  hit: {
                    type: "activate-extra-row" as const,
                    sessionId: s.id,
                    rowId: extra.id,
                  },
                }
              : {}),
            isSelected: extraSelected,
          });
        }

        const children = s.delegatedChildren ?? [];
        const hasExpander = children.length > 0 || s.delegatedDegraded === true;
        if (s.delegatedDegraded === true) sawSessionDelegDegraded = true;
        if (hasExpander) {
          const expanded = this.#expandedDelegatedSessions.has(s.id);
          const arrow = expanded ? "▾" : "▸";
          const expLabel =
            children.length > 0 && s.delegatedDegraded
              ? `  ${arrow} ${children.length} delegated · deleg ?`
              : children.length > 0
                ? `  ${arrow} ${children.length} delegated`
                : `  ${arrow} deleg ?`;
          rows.push({
            text: truncate(expLabel, width),
            hit: {
              type: "toggle-delegated-expander",
              sessionId: s.id,
              expanded: !expanded,
            },
          });
          if (expanded) {
            for (const child of children) {
              rows.push({
                text: truncate(`    · ${child.label} (${child.tool} · ${child.state})`, width),
              });
            }
            if (s.delegatedDegraded) {
              rows.push({
                text: truncate("    · deleg ? (provenance missing)", width),
              });
            }
          }
        }
      });

      // S2: one restorable expander per tab, uncapped, one motif a row.
      const restorable = ws?.restorable ?? [];
      if (restorable.length > 0 && ws) {
        const title = ws.title;
        const expanded = this.#expandedRestorable.has(title);
        const arrow = expanded ? "▾" : "▸";
        const expanderSelected = this.#selectedRestorable === -1;
        const header = ws.restorableHeader ?? `${restorable.length} restorable`;
        rows.push({
          text: expanderSelected
            ? `\x1b[7m${truncate(`  ${arrow} ${header}`, width)}\x1b[0m`
            : truncate(`  ${arrow} ${header}`, width),
          hit: { type: "toggle-restorable-expander", tab: title, expanded: !expanded },
          isSelected: expanderSelected,
        });
        if (expanded) {
          restorable.forEach((row, rowIndex) => {
            const rowSelected = this.#selectedRestorable === rowIndex;
            // A launch row carries no motif: its state is the detail. Every
            // other row shows its motif with its file state.
            const motif = row.reason === "launch" ? undefined : (row.reasonText ?? row.reason);
            const state = row.stateText ?? row.state;
            // NB-14: an empty state text paints the motif alone (a capped
            // row outside --lazy never claims to be deferred while it
            // waits; B-10: the file states still paint once it runs).
            // B-11: once the file owns the row (row.state beyond deferred:
            // queued, launching, settled), the state paints BEFORE the motif
            // so truncation at narrow widths keeps the state visible. A
            // failure must never read as a neutral motif. Deferred keeps the
            // motif-first rendering (NB-14, --lazy).
            const detail =
              motif === undefined || state === ""
                ? (motif ?? state)
                : row.state !== "deferred"
                  ? `${state} · ${motif}`
                  : `${motif} · ${state}`;
            const body = truncate(`    · ${row.label} (${detail})`, width);
            rows.push({
              text: rowSelected ? `\x1b[7m${body}\x1b[0m` : body,
              ...(row.relaunch !== undefined
                ? { hit: { type: "activate-restorable-row" as const, key: row.key } }
                : {}),
              isSelected: rowSelected,
            });
          });
        }
      }

      if (this.#snapshot.unattributedDelegatedDegraded && !sawSessionDelegDegraded) {
        const expanded = this.#expandedDelegatedSessions.has("__unattributed__");
        const arrow = expanded ? "▾" : "▸";
        rows.push({
          text: truncate(`  ${arrow} deleg ?`, width),
          hit: {
            type: "toggle-delegated-expander",
            sessionId: "__unattributed__",
            expanded: !expanded,
          },
        });
        if (expanded) {
          rows.push({
            text: truncate("    · unattributed delegation", width),
          });
        }
      }

      if (sessions.length === 0 && rows.length === 0) {
        rows.push({ text: truncate("(no sessions)", width) });
      }
      for (const footer of this.#snapshot.footerRows ?? []) {
        rows.push({ text: truncate(footer, width) });
      }
      return rows;
    }

    if (this.view === "decisions") {
      const degradedProjects = this.#snapshot.decisionsDegraded ?? [];
      if (this.#snapshot.decisions.length === 0 && degradedProjects.length === 0) {
        rows.push({ text: truncate("(no pending decision)", width) });
        return rows;
      }
      this.#snapshot.decisions.forEach((d, index) => {
        const symbol = d.kind === "question" ? "?" : "◆";
        // PANEL §4.3 & §10: `*` while pending, NEVER on deferred.
        const star = d.outcome === "deferred" ? " " : "*";
        const isSelected = index === this.#selectedDecision;
        const body = truncate(`${symbol}${star} ${d.title}`, width);
        rows.push({
          text: isSelected ? `\x1b[7m${body}\x1b[0m` : body,
          hit: { type: "select-decision", index, decisionId: d.id },
          isSelected,
        });
        if (d.dossierLink) {
          const linkText =
            d.dossierLinkClass === "not-openable"
              ? `${d.dossierLink} (not openable)`
              : d.dossierLink;
          rows.push({
            text: truncate(linkText, width),
            hit: { type: "open-link", target: d.dossierLink },
          });
        }
        if (d.project || d.journalOfRecord) {
          const cite = d.project && d.journalOfRecord
            ? `  ${d.project} · ${d.journalOfRecord}`
            : `  ${d.project ?? d.journalOfRecord}`;
          rows.push({ text: truncate(cite, width) });
        }
      });
      for (const deg of degradedProjects) {
        rows.push({
          text: truncate(`· ${deg.project}: decisions unknown (?)`, width),
        });
        rows.push({
          text: truncate(`  ${deg.trackDir}`, width),
        });
      }
      return rows;
    }

    rows.push({ text: truncate("track: not in L0", width) });
    return rows;
  }

  #getCurrentScrollOffset(): number {
    if (this.view === "sessions") return this.#sessionScrollOffset;
    if (this.view === "decisions") return this.#decisionScrollOffset;
    return 0;
  }

  #setCurrentScrollOffset(next: number): void {
    if (this.view === "sessions") this.#sessionScrollOffset = next;
    else if (this.view === "decisions") this.#decisionScrollOffset = next;
  }

  #renderLines(childCols: number, panelRows: number): string[] {
    const width = Math.max(0, (this.#stdout.columns ?? 0) - childCols);
    const lines: string[] = [];
    this.#hitRows.clear();
    this.#tabHitSpans = [];
    this.#viewHitSpans = [];
    this.#viewFooterRow = undefined;
    if (!this.isOpen()) {
      const marker = this.#snapshot.degraded
        ? "?"
        : this.#snapshot.collapsedLit
          ? "*"
          : "│";
      const lit = this.#snapshot.collapsedLit && !this.#snapshot.degraded;
      const mid = Math.max(1, Math.floor((panelRows + 1) / 2));
      for (let row = 1; row <= panelRows; row += 1) {
        const ch = row === mid ? marker : "│";
        lines.push(lit && row === mid ? `\x1b[41m${ch}\x1b[0m` : ch);
      }
      return lines;
    }

    const { headerLine, spans: tabSpans } = this.#buildTabHeaderAndSpans(childCols, width);
    this.#tabHitSpans = tabSpans;
    lines.push(headerLine);

    const hasFooter = panelRows >= 3;
    const viewportRows = hasFooter ? panelRows - 2 : Math.max(1, panelRows - 1);
    if (this.#overlay) {
      const overlayLines = this.#overlay.render(width, viewportRows);
      for (let i = 0; i < viewportRows; i += 1) {
        lines.push(truncate(overlayLines[i] ?? "", width));
      }
      this.#lastViewportRows = viewportRows;
      this.#lastTotalListRows = viewportRows;
      if (hasFooter) {
        const { footerLine, spans: viewSpans } = this.#buildViewFooterAndSpans(childCols, width);
        this.#viewHitSpans = viewSpans;
        this.#viewFooterRow = panelRows;
        lines.push(footerLine);
      }
      return lines;
    }
    const listRows = this.#buildListRows(width);
    this.#lastViewportRows = viewportRows;
    this.#lastTotalListRows = listRows.length;

    const maxScroll = Math.max(0, listRows.length - viewportRows);
    let offset = Math.max(0, Math.min(maxScroll, this.#getCurrentScrollOffset()));
    this.#setCurrentScrollOffset(offset);

    const visible = listRows.slice(offset, offset + viewportRows);
    for (let i = 0; i < visible.length; i += 1) {
      const item = visible[i]!;
      lines.push(item.text);
      if (item.hit) {
        this.#hitRows.set(2 + i, item.hit);
      }
    }

    if (hasFooter) {
      const blank = " ".repeat(width);
      while (lines.length < panelRows - 1) {
        lines.push(blank);
      }
      const { footerLine, spans: viewSpans } = this.#buildViewFooterAndSpans(childCols, width);
      this.#viewHitSpans = viewSpans;
      this.#viewFooterRow = panelRows;
      lines.push(footerLine);
    }
    return lines;
  }

  #ensureSelectedRowVisible(): void {
    const totalCols = this.#stdout.columns ?? 0;
    const childCols = this.childCols(totalCols);
    const width = Math.max(1, totalCols - childCols);
    const listRows = this.#buildListRows(width);
    const selIdx = listRows.findIndex((r) => r.isSelected === true);
    if (selIdx < 0) return;
    const viewportRows = Math.max(1, this.#lastViewportRows);
    let offset = this.#getCurrentScrollOffset();
    if (selIdx < offset) {
      offset = selIdx;
    } else if (selIdx >= offset + viewportRows) {
      offset = selIdx - viewportRows + 1;
    }
    const maxScroll = Math.max(0, listRows.length - viewportRows);
    this.#setCurrentScrollOffset(Math.max(0, Math.min(maxScroll, offset)));
  }

  /** Flush a pending bare Escape after disambiguation timeout. */
  flushPending(opts: RightPanelHandleInputOptions): RightPanelHandleResult {
    const events = this.#parser.flushPending({
      panelFocus: this.hasPanelFocus(),
      bracketedPasteEnabled: opts.bracketedPasteEnabled === true,
      kittyKeyboardEnabled: opts.kittyKeyboardEnabled === true,
    });
    return this.#applyEvents(events, opts);
  }

  /** Byte-level input entrypoint (used by `runAttach` in `op.ts`). */
  handleInputBytes(
    chunk: Uint8Array,
    opts: RightPanelHandleInputOptions,
  ): RightPanelHandleResult {
    const actions: RightPanelAction[] = [];
    const forwardChunks: Buffer[] = [];
    const forwardedMouse: RightPanelForwardedMouse[] = [];
    let dirty = false;
    let selectionChanged = false;

    this.#parser.feed(
      chunk,
      () => ({
        panelFocus: this.hasPanelFocus(),
        bracketedPasteEnabled: opts.bracketedPasteEnabled === true,
        kittyKeyboardEnabled: opts.kittyKeyboardEnabled === true,
      }),
      (event) => {
        const step = this.#handleSingleEvent(event, opts);
        if (step.dirty) dirty = true;
        if (step.selectionChanged) selectionChanged = true;
        if (step.actions.length > 0) actions.push(...step.actions);
        if (step.forwardBytes && step.forwardBytes.length > 0) {
          forwardChunks.push(step.forwardBytes);
        }
        if (step.forwardedMouse) forwardedMouse.push(step.forwardedMouse);
      },
    );

    if (dirty) this.paint();
    if (selectionChanged) this.#onSelectionChange?.();
    if (forwardChunks.length > 0) {
      const merged = Buffer.concat(forwardChunks);
      return {
        consumed: false,
        forwardBytes: merged,
        forward: merged.toString("utf8"),
        actions,
        ...(forwardedMouse.length > 0 ? { forwardedMouse } : {}),
      };
    }
    return { consumed: true, actions };
  }

  /** String-based entrypoint kept backwards-compatible for unit tests. */
  handleInput(
    data: string,
    opts: RightPanelHandleInputOptions,
  ): RightPanelHandleResult {
    return this.handleInputBytes(Buffer.from(data, "utf8"), opts);
  }

  #applyEvents(
    events: readonly PanelInputEvent[],
    opts: RightPanelHandleInputOptions,
  ): RightPanelHandleResult {
    const actions: RightPanelAction[] = [];
    const forwardChunks: Buffer[] = [];
    let dirty = false;
    let selectionChanged = false;
    for (const event of events) {
      const step = this.#handleSingleEvent(event, opts);
      if (step.dirty) dirty = true;
      if (step.selectionChanged) selectionChanged = true;
      if (step.actions.length > 0) actions.push(...step.actions);
      if (step.forwardBytes && step.forwardBytes.length > 0) {
        forwardChunks.push(step.forwardBytes);
      }
    }
    if (dirty) this.paint();
    if (selectionChanged) this.#onSelectionChange?.();
    if (forwardChunks.length > 0) {
      const merged = Buffer.concat(forwardChunks);
      return {
        consumed: false,
        forwardBytes: merged,
        forward: merged.toString("utf8"),
        actions,
      };
    }
    return { consumed: true, actions };
  }

  #handleSingleEvent(
    event: PanelInputEvent,
    opts: RightPanelHandleInputOptions,
  ): {
    dirty: boolean;
    selectionChanged?: boolean;
    actions: RightPanelAction[];
    forwardBytes?: Buffer;
    forwardedMouse?: RightPanelForwardedMouse;
  } {
    if (event.type === "detach") {
      return { dirty: false, actions: [{ type: "detach" }] };
    }
    if (event.type === "toggle") {
      this.toggle();
      return { dirty: false, actions: [{ type: "toggle" }] };
    }
    if (event.type === "forward") {
      return { dirty: false, actions: [], forwardBytes: event.bytes };
    }
    if (event.type === "sgr-mouse") {
      return this.#handleMouseEvent(event.event, event.raw, opts);
    }

    // Remaining events are panel-focus keyboard events.
    if (!this.hasPanelFocus()) {
      return { dirty: false, actions: [] };
    }

    if (this.#overlay) {
      // The overlay owns the keyboard while it is up (cards, recovery view).
      this.#overlay.handleKey(event);
      return { dirty: true, actions: [] };
    }

    if (event.type === "escape") {
      if (this.#slashPrompt !== undefined) {
        this.#slashPrompt = undefined;
        this.#notice = undefined;
        return { dirty: true, actions: [] };
      }
      this.#focus = false;
      this.#barSelectionActive = false;
      this.#notice = undefined;
      return { dirty: true, selectionChanged: true, actions: [] };
    }

    // Active slash prompt (`/s`, `/d`, `/t`, `/a`, `/c`, `/gw` + Enter, unknown `/x`).
    if (this.#slashPrompt !== undefined) {
      if (event.type === "backspace") {
        if (this.#slashPrompt.length <= 1) {
          this.#slashPrompt = undefined;
        } else {
          this.#slashPrompt = this.#slashPrompt.slice(0, -1);
        }
        return { dirty: true, actions: [] };
      }
      if (event.type === "enter") {
        if (this.#slashPrompt === "/gw") {
          this.#slashPrompt = undefined;
          this.#notice = "/gw: not in L0.5 (lot L7)";
          return { dirty: true, actions: [] };
        }
        const unknown = this.#slashPrompt;
        this.#slashPrompt = undefined;
        this.#notice = `unknown: ${unknown}`;
        return { dirty: true, actions: [] };
      }
      if (event.type === "char") {
        const next = this.#slashPrompt + event.char;
        if (next === "/s") {
          this.#slashPrompt = undefined;
          this.#notice = undefined;
          this.view = "sessions";
          return {
            dirty: true,
            selectionChanged: true,
            actions: [{ type: "select-view", view: "sessions" }],
          };
        }
        if (next === "/d") {
          this.#slashPrompt = undefined;
          this.#notice = undefined;
          this.view = "decisions";
          return {
            dirty: true,
            selectionChanged: true,
            actions: [{ type: "select-view", view: "decisions" }],
          };
        }
        if (next === "/t") {
          this.#slashPrompt = undefined;
          this.#notice = undefined;
          this.view = "track";
          return {
            dirty: true,
            selectionChanged: true,
            actions: [{ type: "select-view", view: "track" }],
          };
        }
        if (next === "/a") {
          this.#slashPrompt = undefined;
          this.#notice = "/a: not in L0.5 (lot L5)";
          return { dirty: true, actions: [] };
        }
        if (next === "/c") {
          this.#slashPrompt = undefined;
          this.#notice = "/c: not in L0.5 (lot L7)";
          return { dirty: true, actions: [] };
        }
        if (next === "/g" || next === "/gw") {
          this.#slashPrompt = next;
          return { dirty: true, actions: [] };
        }
        this.#slashPrompt = undefined;
        this.#notice = `unknown: ${next}`;
        return { dirty: true, actions: [] };
      }
      return { dirty: false, actions: [] };
    }

    if (event.type === "char") {
      if (event.char === "/") {
        this.#slashPrompt = "/";
        this.#notice = undefined;
        return { dirty: true, actions: [] };
      }
      if (event.char === "k") {
        return this.#moveSelection(-1);
      }
      if (event.char === "j") {
        return this.#moveSelection(1);
      }
      if (event.char === " ") {
        if (this.#selectedRestorable !== undefined) return this.#toggleRestorableExpander("toggle");
        return this.#toggleSelectedDelegatedExpander("toggle");
      }
      if (event.char >= "1" && event.char <= "9" && this.view === "sessions") {
        // r2 §2.3: digits activate the n-th session row of the tab.
        const index = Number(event.char) - 1;
        const target = this.#snapshot.workspaces[this.activeTabIndex]?.sessions[index];
        if (!target) return { dirty: false, actions: [] };
        this.#selectedSession = index;
        this.#selectedRestorable = undefined;
        this.#selectedExtra = undefined;
        this.#barSelectionActive = true;
        this.#ensureSelectedRowVisible();
        return {
          dirty: true,
          selectionChanged: true,
          actions: [{ type: "activate-session", index, sessionId: target.id }],
        };
      }
      return { dirty: false, actions: [] };
    }

    if (event.type === "tab") {
      const n = this.#snapshot.workspaces.length;
      if (n > 0) {
        this.activeTabIndex = event.shift
          ? (this.activeTabIndex - 1 + n) % n
          : (this.activeTabIndex + 1) % n;
        this.#selectedSession = 0;
        this.#selectedRestorable = undefined;
        this.#selectedExtra = undefined;
        this.#sessionScrollOffset = 0;
      }
      this.#notice = undefined;
      return {
        dirty: true,
        selectionChanged: true,
        actions: [{ type: "select-tab", index: this.activeTabIndex }],
      };
    }

    if (event.type === "nav") {
      if (event.direction === "up") return this.#moveSelection(-1);
      if (event.direction === "down") return this.#moveSelection(1);
      if (this.#selectedRestorable !== undefined) {
        if (event.direction === "right") return this.#toggleRestorableExpander("expand");
        if (event.direction === "left") return this.#toggleRestorableExpander("collapse");
        return { dirty: false, actions: [] };
      }
      if (event.direction === "right") return this.#toggleSelectedDelegatedExpander("expand");
      if (event.direction === "left") return this.#toggleSelectedDelegatedExpander("collapse");
      return { dirty: false, actions: [] };
    }

    if (event.type === "enter") {
      return this.#activateSelected();
    }

    return { dirty: false, actions: [] };
  }

  #toggleSelectedDelegatedExpander(
    mode: "toggle" | "expand" | "collapse",
  ): { dirty: boolean; actions: RightPanelAction[] } {
    if (this.view !== "sessions") return { dirty: false, actions: [] };
    const ws = this.#snapshot.workspaces[this.activeTabIndex];
    const target = ws?.sessions[this.#selectedSession];
    if (!target) return { dirty: false, actions: [] };
    const hasExpander =
      (target.delegatedChildren?.length ?? 0) > 0 || target.delegatedDegraded === true;
    if (!hasExpander) return { dirty: false, actions: [] };
    const currently = this.#expandedDelegatedSessions.has(target.id);
    const next =
      mode === "toggle" ? !currently : mode === "expand" ? true : false;
    if (next === currently) return { dirty: false, actions: [] };
    if (next) this.#expandedDelegatedSessions.add(target.id);
    else this.#expandedDelegatedSessions.delete(target.id);
    return {
      dirty: true,
      actions: [
        { type: "toggle-delegated-expander", sessionId: target.id, expanded: next },
      ],
    };
  }

  /** S2: toggle the restorable expander of the active tab, if it has rows. */
  #toggleRestorableExpander(mode: "toggle" | "expand" | "collapse"): {
    dirty: boolean;
    actions: RightPanelAction[];
  } {
    if (this.view !== "sessions") return { dirty: false, actions: [] };
    const ws = this.#snapshot.workspaces[this.activeTabIndex];
    if (!ws || (ws.restorable ?? []).length === 0) return { dirty: false, actions: [] };
    const currently = this.#expandedRestorable.has(ws.title);
    const next = mode === "toggle" ? !currently : mode === "expand";
    if (next === currently) return { dirty: false, actions: [] };
    if (next) this.#expandedRestorable.add(ws.title);
    else this.#expandedRestorable.delete(ws.title);
    return {
      dirty: true,
      actions: [{ type: "toggle-restorable-expander", tab: ws.title, expanded: next }],
    };
  }

  #moveSelection(delta: -1 | 1): {
    dirty: boolean;
    selectionChanged?: boolean;
    actions: RightPanelAction[];
  } {
    this.#notice = undefined;
    if (this.view === "sessions") {
      // S2: the restorable section is walked after the last live session.
      if (this.#selectedRestorable !== undefined) {
        const rows = this.#activeRestorable();
        if (rows.length === 0) {
          this.#selectedRestorable = undefined;
          return { dirty: true, actions: [] };
        }
        const next =
          delta === 1
            ? Math.min(rows.length - 1, this.#selectedRestorable + 1)
            : this.#selectedRestorable - 1;
        if (delta === -1 && next < -1) {
          this.#selectedRestorable = undefined;
          return { dirty: true, selectionChanged: true, actions: [] };
        }
        if (next === this.#selectedRestorable) return { dirty: false, actions: [] };
        this.#selectedRestorable = next;
        this.#ensureSelectedRowVisible();
        return { dirty: true, selectionChanged: true, actions: [] };
      }
      const ws = this.#snapshot.workspaces[this.activeTabIndex];
      const sessions = ws?.sessions ?? [];
      if (sessions.length === 0) {
        // A restorable-only tab: the cursor starts in its section.
        if (delta === 1 && this.#restorableRows().length > 0) {
          this.#selectedRestorable = -1;
          this.#ensureSelectedRowVisible();
          return { dirty: true, selectionChanged: true, actions: [] };
        }
        return { dirty: false, actions: [] };
      }
      // Activatable extra rows sit between a session row and the next one.
      const extras = this.#focusableExtras(this.#selectedSession);
      const extraIndex =
        this.#selectedExtra === undefined
          ? -1
          : extras.findIndex((row) => row.id === this.#selectedExtra);
      if (delta === 1 && extraIndex < extras.length - 1) {
        this.#selectedExtra = extras[extraIndex + 1]!.id;
        this.#ensureSelectedRowVisible();
        return { dirty: true, actions: [] };
      }
      if (delta === -1 && extraIndex >= 0) {
        this.#selectedExtra = extraIndex === 0 ? undefined : extras[extraIndex - 1]!.id;
        this.#ensureSelectedRowVisible();
        return { dirty: true, actions: [] };
      }
      const next = Math.max(0, Math.min(sessions.length - 1, this.#selectedSession + delta));
      // S2: past the last extra of the last session lies the restorable section.
      if (
        delta === 1 &&
        next === sessions.length - 1 &&
        next === this.#selectedSession &&
        extraIndex >= extras.length - 1 &&
        this.#restorableRows().length > 0
      ) {
        this.#selectedExtra = undefined;
        this.#selectedRestorable = -1;
        this.#ensureSelectedRowVisible();
        return { dirty: true, selectionChanged: true, actions: [] };
      }
      if (next === this.#selectedSession && this.#selectedExtra !== undefined) {
        return { dirty: false, actions: [] };
      }
      this.#selectedSession = next;
      this.#selectedExtra = undefined;
      this.#barSelectionActive = true;
      this.#ensureSelectedRowVisible();
      const target = sessions[next]!;
      return {
        dirty: true,
        selectionChanged: true,
        actions: [{ type: "select-session", index: next, sessionId: target.id }],
      };
    }
    if (this.view === "decisions") {
      const decisions = this.#snapshot.decisions;
      if (decisions.length === 0) return { dirty: false, actions: [] };
      const next = Math.max(0, Math.min(decisions.length - 1, this.#selectedDecision + delta));
      this.#selectedDecision = next;
      this.#ensureSelectedRowVisible();
      const target = decisions[next]!;
      return {
        dirty: true,
        actions: [{ type: "select-decision", index: next, decisionId: target.id }],
      };
    }
    return { dirty: false, actions: [] };
  }

  #activateSelected(): { dirty: boolean; actions: RightPanelAction[] } {
    if (this.view === "sessions") {
      // S2: Enter in the restorable section toggles the expander or offers
      // the gesture of a relaunchable row; other rows offer nothing. The
      // expander itself stays toggleable while collapsed.
      if (this.#selectedRestorable !== undefined) {
        if (this.#selectedRestorable === -1) {
          return this.#toggleRestorableExpander("toggle");
        }
        const ws = this.#snapshot.workspaces[this.activeTabIndex];
        const rows = this.#activeRestorable();
        if (!ws || rows.length === 0) return { dirty: false, actions: [] };
        const row = rows[this.#selectedRestorable];
        if (!row || row.relaunch === undefined) return { dirty: false, actions: [] };
        return { dirty: true, actions: [{ type: "activate-restorable-row", key: row.key }] };
      }
      const ws = this.#snapshot.workspaces[this.activeTabIndex];
      const target = ws?.sessions[this.#selectedSession];
      if (!target) return { dirty: false, actions: [] };
      if (this.#selectedExtra !== undefined) {
        return {
          dirty: true,
          actions: [
            { type: "activate-extra-row", sessionId: target.id, rowId: this.#selectedExtra },
          ],
        };
      }
      return {
        dirty: true,
        actions: [
          {
            type: "activate-session",
            index: this.#selectedSession,
            sessionId: target.id,
          },
        ],
      };
    }
    if (this.view === "decisions") {
      const target = this.#snapshot.decisions[this.#selectedDecision];
      if (!target) return { dirty: false, actions: [] };
      if (target.dossierLink) {
        return {
          dirty: true,
          actions: [{ type: "open-link", target: target.dossierLink }],
        };
      }
      return {
        dirty: true,
        actions: [
          {
            type: "activate-decision",
            index: this.#selectedDecision,
            decisionId: target.id,
          },
        ],
      };
    }
    return { dirty: false, actions: [] };
  }

  #handleMouseEvent(
    event: SgrMouseEvent,
    _raw: Buffer,
    opts: RightPanelHandleInputOptions,
  ): {
    dirty: boolean;
    selectionChanged?: boolean;
    actions: RightPanelAction[];
    forwardBytes?: Buffer;
    forwardedMouse?: RightPanelForwardedMouse;
  } {
    const effectiveMode: MouseTrackingMode | null =
      opts.cliMouseMode !== undefined
        ? opts.cliMouseMode
        : opts.cliMouseEnabled
          ? 1000
          : null;
    const effectiveEncoding: MouseEncoding = opts.cliMouseEncoding ?? "sgr";
    const statusBarActive =
      opts.statusBarActive !== undefined
        ? opts.statusBarActive
        : this.#isStatusBarActive
          ? this.#isStatusBarActive()
          : true;
    const totalCols = this.#stdout.columns ?? 0;
    const totalRows = this.#stdout.rows ?? 0;
    const route = routePanelMouse(
      event,
      {
        totalCols,
        totalRows,
        childCols: this.childCols(totalCols),
        open: this.isOpen(),
        statusBarActive,
        statusBarMarker: this.statusBarMarker(),
      },
      { cliMouseEnabled: effectiveMode !== null },
    );
    if (route.zone === "native-selection" || route.zone === "status-bar") {
      return { dirty: false, actions: [] };
    }
    if (route.zone === "status-marker" || (!this.isOpen() && route.zone === "panel")) {
      if (!event.release && !event.wheel) {
        this.toggle();
        return { dirty: false, actions: [{ type: "toggle" }] };
      }
      return { dirty: false, actions: [] };
    }
    if (route.zone === "panel") {
      if (event.release) return { dirty: false, actions: [] };
      if (this.#overlay) {
        if (event.wheel) {
          const delta = (event.button & 1) === 0 ? -RIGHT_PANEL_WHEEL_STEP : RIGHT_PANEL_WHEEL_STEP;
          return { dirty: this.#overlay.handleWheel?.(delta) === true, actions: [] };
        }
        this.#focus = true;
        this.#barSelectionActive = true;
        if (event.y >= 2) this.#overlay.handleClick?.(event.y - 2);
        return { dirty: true, selectionChanged: true, actions: [] };
      }
      if (event.wheel) {
        // PANEL §9.3 & L1.5: 3 rows per notch, clamped at bounds, never leaked to CLI.
        const step = (event.button & 1) === 0 ? -RIGHT_PANEL_WHEEL_STEP : RIGHT_PANEL_WHEEL_STEP;
        const maxScroll = Math.max(0, this.#lastTotalListRows - this.#lastViewportRows);
        const prev = this.#getCurrentScrollOffset();
        const next = Math.max(0, Math.min(maxScroll, prev + step));
        this.#setCurrentScrollOffset(next);
        return {
          dirty: next !== prev,
          actions: [{ type: "scroll", offset: next, delta: next - prev }],
        };
      }
      this.#focus = true;
      this.#barSelectionActive = true;
      if (event.y === 1) {
        const matchedTab = this.#tabHitSpans.find(
          (span) => event.x >= span.startCol && event.x <= span.endCol,
        );
        if (!matchedTab) {
          return { dirty: false, actions: [] };
        }
        this.activeTabIndex = matchedTab.index;
        this.#selectedSession = 0;
        this.#selectedRestorable = undefined;
        this.#selectedExtra = undefined;
        this.#sessionScrollOffset = 0;
        this.#notice = undefined;
        return {
          dirty: true,
          selectionChanged: true,
          actions: [{ type: "select-tab", index: this.activeTabIndex }],
        };
      }
      if (this.#viewFooterRow !== undefined && event.y === this.#viewFooterRow) {
        const matchedView = this.#viewHitSpans.find(
          (span) => event.x >= span.startCol && event.x <= span.endCol,
        );
        if (matchedView) {
          this.view = matchedView.view;
          this.#slashPrompt = undefined;
          this.#notice = undefined;
          return {
            dirty: true,
            selectionChanged: true,
            actions: [{ type: "select-view", view: matchedView.view }],
          };
        }
        return { dirty: false, actions: [] };
      }
      const hit = this.#hitRows.get(event.y);
      if (hit) {
        if (hit.type === "activate-extra-row") {
          const ws = this.#snapshot.workspaces[this.activeTabIndex];
          const owner = ws?.sessions.findIndex((session) => session.id === hit.sessionId) ?? -1;
          if (owner >= 0) this.#selectedSession = owner;
          this.#selectedExtra = hit.rowId;
          return { dirty: true, selectionChanged: true, actions: [hit] };
        }
        if (hit.type === "select-session") {
          const alreadySelected =
            this.#selectedSession === hit.index && this.#selectedExtra === undefined;
          this.#selectedSession = hit.index;
          this.#selectedRestorable = undefined;
          this.#selectedExtra = undefined;
          return {
            dirty: true,
            selectionChanged: true,
            actions: [
              alreadySelected
                ? {
                    type: "activate-session",
                    index: hit.index,
                    ...(hit.sessionId ? { sessionId: hit.sessionId } : {}),
                  }
                : hit,
            ],
          };
        }
        if (hit.type === "toggle-delegated-expander") {
          if (hit.expanded) this.#expandedDelegatedSessions.add(hit.sessionId);
          else this.#expandedDelegatedSessions.delete(hit.sessionId);
          return { dirty: true, actions: [hit] };
        }
        if (hit.type === "toggle-restorable-expander") {
          if (hit.expanded) this.#expandedRestorable.add(hit.tab);
          else this.#expandedRestorable.delete(hit.tab);
          const ws = this.#snapshot.workspaces[this.activeTabIndex];
          this.#selectedRestorable = ws && ws.title === hit.tab ? -1 : this.#selectedRestorable;
          this.#selectedExtra = undefined;
          return { dirty: true, selectionChanged: true, actions: [hit] };
        }
        if (hit.type === "activate-restorable-row") {
          // r2 §2.3: selection and activation stay separate, as for live
          // sessions — a first click only selects; the gesture (confirmed in
          // the station) fires on the second click or Enter.
          const ws = this.#snapshot.workspaces[this.activeTabIndex];
          const index = (ws?.restorable ?? []).findIndex((row) => row.key === hit.key);
          if (index < 0) return { dirty: false, actions: [] };
          const alreadySelected =
            this.#selectedRestorable === index && this.#selectedExtra === undefined;
          this.#selectedRestorable = index;
          this.#selectedExtra = undefined;
          if (!alreadySelected) return { dirty: true, selectionChanged: true, actions: [] };
          return { dirty: true, selectionChanged: true, actions: [hit] };
        }
        if (hit.type === "select-decision") {
          const alreadySelected = this.#selectedDecision === hit.index;
          this.#selectedDecision = hit.index;
          if (alreadySelected) {
            const target = this.#snapshot.decisions[hit.index];
            if (target?.dossierLink) {
              return {
                dirty: true,
                actions: [{ type: "open-link", target: target.dossierLink }],
              };
            }
            return {
              dirty: true,
              actions: [
                {
                  type: "activate-decision",
                  index: hit.index,
                  ...(hit.decisionId ? { decisionId: hit.decisionId } : {}),
                },
              ],
            };
          }
          return { dirty: true, actions: [hit] };
        }
        return { dirty: true, actions: [hit] };
      }
      return { dirty: true, actions: [] };
    }
    // CLI zone: clicking returns keyboard focus to CLI and clears panel bar selection;
    // forward transcoded event only if CLI subscribed.
    let focusCleared = false;
    if (!event.release && !event.wheel && (this.#focus || this.#barSelectionActive)) {
      this.#focus = false;
      this.#barSelectionActive = false;
      focusCleared = true;
    }
    if (route.forwardToCli) {
      const encoded = transcodeSgrMouseForChild(
        event,
        effectiveMode,
        effectiveEncoding,
      );
      if (encoded !== undefined && effectiveMode !== null) {
        return {
          dirty: focusCleared,
          selectionChanged: focusCleared,
          actions: [],
          forwardBytes: Buffer.from(
            encoded,
            effectiveEncoding === "x10" ? "latin1" : "utf8",
          ),
          forwardedMouse: {
            button: event.button,
            x: event.x,
            y: event.y,
            release: event.release,
            wheel: event.wheel,
            motion: (event.button & 32) !== 0,
            mode: effectiveMode,
            encoding: effectiveEncoding,
          },
        };
      }
    }
    return { dirty: focusCleared, selectionChanged: focusCleared, actions: [] };
  }
}
