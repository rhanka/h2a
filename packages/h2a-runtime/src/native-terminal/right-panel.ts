/**
 * Native right panel (L0 + L0.5a live selector foundation). Reserved columns
 * mirror the bottom status bar's reserved row: the child PTY is resized to
 * the remaining columns and the panel paints inside the reserved strip.
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

export type RightPanelSession = Readonly<{
  id: string;
  label: string;
  status: RightPanelSessionStatus;
  delegated?: boolean;
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
  project?: string;
  tool?: string;
}>;

export type RightPanelWorkspace = Readonly<{
  title: string;
  sessions: readonly RightPanelSession[];
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
  /** Stable revision key used for unseen/seen tracking across refreshes (`PANEL §4.5`). */
  revisionKey?: string;
}>;

export type RightPanelSnapshot = Readonly<{
  workspaces: readonly RightPanelWorkspace[];
  decisions: readonly RightPanelDecision[];
  /** Deduplicated attention subject count (`PANEL §4.5`). */
  attentionCount: number;
  /** True when another session or an unseen pending decision needs owner attention (`PANEL §4.5`). */
  collapsedLit: boolean;
  degraded: boolean;
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
  | { type: "select-session"; index: number; sessionId?: string }
  | { type: "activate-session"; index: number; sessionId?: string }
  | { type: "select-decision"; index: number; decisionId?: string }
  | { type: "activate-decision"; index: number; decisionId?: string }
  | { type: "open-link"; target: string };

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

export function sessionStatusGlyph(status: RightPanelSessionStatus) {
  return GLYPHS[status] ?? GLYPHS.unknown;
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
  }[];
  decisions: readonly RightPanelDecision[];
  seenDecisionKeys?: ReadonlySet<string>;
  degraded?: boolean;
}): RightPanelSnapshot {
  const workspaces = args.groups.map((g) => ({
    title: g.title,
    // Delegated sub-sessions stay hidden from the human list by default.
    sessions: g.sessions.filter((s) => s.delegated !== true),
  }));

  const seen = args.seenDecisionKeys;
  const isUnseenPending = (d: RightPanelDecision): boolean => {
    if (d.outcome === "deferred") return false;
    if (!seen) return true;
    return !seen.has(decisionSeenKey(d));
  };

  // Track which other-sessions have an unseen pending decision attributed to them.
  const sessionsWithUnseenDecision = new Set<string>();
  const unseenPendingDecisions: RightPanelDecision[] = [];
  for (const d of args.decisions) {
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

  return {
    workspaces,
    decisions: args.decisions,
    attentionCount: countedSessionIds.size + unattributedUnseenCount,
    collapsedLit,
    degraded: args.degraded === true,
  };
}

export type TrackDecisionRow = {
  id: string;
  title: string;
  outcome?: string;
  workspace?: string;
  accountable?: string;
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
  zone: "panel" | "cli" | "native-selection" | "status-marker";
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
  const barActive = geom.statusBarActive !== false;
  if (barActive && event.y >= geom.totalRows) {
    const span = rightPanelStatusBarHitSpan(
      geom.totalCols,
      geom.statusBarMarker ?? { enabled: true, lit: false },
    );
    if (span && event.x >= span.startCol && event.x <= span.endCol) {
      return { zone: "status-marker", forwardToCli: false };
    }
  }
  if (event.x > geom.childCols) return { zone: "panel", forwardToCli: false };
  return { zone: "cli", forwardToCli: opts.cliMouseEnabled };
}

type PanelStdout = {
  columns?: number;
  rows?: number;
  write(chunk: string): boolean;
};

export type RightPanelHandleResult = Readonly<{
  consumed: boolean;
  forward?: string;
  forwardBytes?: Buffer;
  actions: RightPanelAction[];
}>;

export type RightPanelHandleInputOptions = Readonly<{
  cliMouseEnabled: boolean;
  bracketedPasteEnabled?: boolean;
  kittyKeyboardEnabled?: boolean;
  statusBarActive?: boolean;
}>;

function truncate(text: string, width: number): string {
  const chars = [...text];
  if (chars.length <= width) return text.padEnd(width, " ");
  return chars.slice(0, Math.max(0, width - 1)).join("") + "…";
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
  return tags.length > 0 ? ` [${tags.join(",")}]` : "";
}

export class RightPanelController {
  readonly #stdout: PanelStdout;
  readonly #width: number;
  readonly #parser = new PanelInputParser();
  readonly #onOpen: (() => void) | undefined;
  #snapshot: RightPanelSnapshot;
  #open = false;
  #focus = false;
  view: RightPanelView = "sessions";
  activeTabIndex = 0;
  #selectedSession = 0;
  #selectedDecision = 0;
  #slashPrompt: string | undefined;
  #notice: string | undefined;
  #hitRows = new Map<number, RightPanelAction>();

  constructor(opts: {
    stdout: PanelStdout;
    snapshot: RightPanelSnapshot;
    width?: number;
    onOpen?: () => void;
  }) {
    this.#stdout = opts.stdout;
    this.#snapshot = opts.snapshot;
    this.#width = opts.width ?? RIGHT_PANEL_DEFAULT_WIDTH;
    this.#onOpen = opts.onOpen;
  }

  isOpen(): boolean {
    return this.#open;
  }

  hasPanelFocus(): boolean {
    return this.#open && this.#focus;
  }

  selectedSessionIndex(): number {
    return this.#selectedSession;
  }

  selectedDecisionIndex(): number {
    return this.#selectedDecision;
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
  }

  #clampSelection(): void {
    const ws = this.#snapshot.workspaces[this.activeTabIndex];
    const sLen = ws?.sessions.length ?? 0;
    this.#selectedSession = sLen === 0 ? 0 : Math.min(this.#selectedSession, sLen - 1);
    const dLen = this.#snapshot.decisions.length;
    this.#selectedDecision = dLen === 0 ? 0 : Math.min(this.#selectedDecision, dLen - 1);
  }

  childCols(totalCols: number): number {
    return (
      totalCols -
      rightPanelReservedCols({ totalCols, width: this.#width, open: this.#open })
    );
  }

  reservedCols(): number {
    const total = this.#stdout.columns ?? 0;
    return rightPanelReservedCols({
      totalCols: total,
      width: this.#width,
      open: this.#open,
    });
  }

  toggle(): void {
    this.#open = !this.#open;
    this.#focus = this.#open;
    this.#slashPrompt = undefined;
    this.#notice = undefined;
    if (this.#open) {
      this.#onOpen?.();
      this.#stdout.write("\x1b[?1000h\x1b[?1006h");
    } else {
      this.#stdout.write("\x1b[?1006l\x1b[?1000l\x1b[?69l");
    }
    this.paint();
  }

  onResize(): void {
    this.paint();
  }

  dispose(): void {
    if (this.#open) this.#stdout.write("\x1b[?1006l\x1b[?1000l\x1b[?69l");
    this.#open = false;
    this.#focus = false;
    this.#parser.reset();
  }

  paint(): void {
    const totalCols = this.#stdout.columns ?? 0;
    const totalRows = this.#stdout.rows ?? 0;
    if (totalCols <= 0 || totalRows <= 0) return;
    const childCols = this.childCols(totalCols);
    const lines = this.#renderLines(childCols, totalRows);
    let out = "\x1b[s";
    if (this.#open) out += `\x1b[?69h\x1b[1;${childCols}s`;
    for (let row = 1; row <= totalRows - 1; row += 1) {
      out += `\x1b[${row};${childCols + 1}H${lines[row - 1] ?? ""}`;
    }
    out += "\x1b[u";
    this.#stdout.write(out);
  }

  #renderLines(childCols: number, totalRows: number): string[] {
    const width = Math.max(0, (this.#stdout.columns ?? 0) - childCols);
    const lines: string[] = [];
    this.#hitRows.clear();
    if (!this.#open) {
      const marker = this.#snapshot.degraded
        ? "?"
        : this.#snapshot.collapsedLit
          ? "*"
          : "│";
      const lit = this.#snapshot.collapsedLit && !this.#snapshot.degraded;
      const mid = Math.max(1, Math.floor(totalRows / 2));
      for (let row = 1; row <= totalRows - 1; row += 1) {
        const ch = row === mid ? marker : "│";
        lines.push(lit && row === mid ? `\x1b[41m${ch}\x1b[0m` : ch);
      }
      return lines;
    }

    const tabs = this.#snapshot.workspaces
      .map((w, i) => (i === this.activeTabIndex ? `[${w.title}]` : w.title))
      .join(" ");
    const header =
      this.#slashPrompt !== undefined
        ? `${this.#slashPrompt}_`
        : this.#notice !== undefined
          ? this.#notice
          : this.#snapshot.degraded
            ? `${tabs || "sessions"} [unknown]`
            : tabs || "sessions";
    lines.push(truncate(header, width));

    if (this.view === "sessions") {
      const ws = this.#snapshot.workspaces[this.activeTabIndex];
      let row = 2;
      (ws?.sessions ?? []).forEach((s, index) => {
        const g = sessionStatusGlyph(s.status);
        const star = g.attention ? "*" : " ";
        const badges = formatSessionBadges(s);
        const rawLabel =
          s.status === "unknown"
            ? `${s.label} unknown${badges}`
            : `${s.label}${badges}`;
        const body = truncate(`${g.symbol}${star} ${rawLabel}`, width);
        if (index === this.#selectedSession) {
          lines.push(`\x1b[7m${body}\x1b[0m`);
        } else {
          lines.push(`${g.ansi}${g.symbol}\x1b[0m${truncate(`${star} ${rawLabel}`, Math.max(0, width - 1))}`);
        }
        this.#hitRows.set(row, { type: "select-session", index, sessionId: s.id });
        row += 1;
      });
      if ((ws?.sessions.length ?? 0) === 0) lines.push(truncate("(no sessions)", width));
    } else if (this.view === "decisions") {
      let row = 2;
      if (this.#snapshot.decisions.length === 0) {
        lines.push(truncate("(no pending decision)", width));
      }
      this.#snapshot.decisions.forEach((d, index) => {
        const symbol = d.kind === "question" ? "?" : "◆";
        // PANEL §4.3 & §10: `*` while pending, NEVER on deferred.
        const star = d.outcome === "deferred" ? " " : "*";
        const body = truncate(`${symbol}${star} ${d.title}`, width);
        lines.push(index === this.#selectedDecision ? `\x1b[7m${body}\x1b[0m` : body);
        this.#hitRows.set(
          row,
          d.dossierLink
            ? { type: "open-link", target: d.dossierLink }
            : { type: "select-decision", index, decisionId: d.id },
        );
        row += 1;
        if (d.dossierLink) {
          const linkText =
            d.dossierLinkClass === "not-openable"
              ? `${d.dossierLink} (not openable)`
              : d.dossierLink;
          lines.push(truncate(linkText, width));
          this.#hitRows.set(row, { type: "open-link", target: d.dossierLink });
          row += 1;
        }
      });
    } else {
      lines.push(truncate("track: not in L0", width));
    }
    return lines;
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
    let dirty = false;

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
        if (step.actions.length > 0) actions.push(...step.actions);
        if (step.forwardBytes && step.forwardBytes.length > 0) {
          forwardChunks.push(step.forwardBytes);
        }
      },
    );

    if (dirty) this.paint();
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
    for (const event of events) {
      const step = this.#handleSingleEvent(event, opts);
      if (step.dirty) dirty = true;
      if (step.actions.length > 0) actions.push(...step.actions);
      if (step.forwardBytes && step.forwardBytes.length > 0) {
        forwardChunks.push(step.forwardBytes);
      }
    }
    if (dirty) this.paint();
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
  ): { dirty: boolean; actions: RightPanelAction[]; forwardBytes?: Buffer } {
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

    if (event.type === "escape") {
      if (this.#slashPrompt !== undefined) {
        this.#slashPrompt = undefined;
        this.#notice = undefined;
        return { dirty: true, actions: [] };
      }
      this.#focus = false;
      this.#notice = undefined;
      return { dirty: true, actions: [] };
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
          return { dirty: true, actions: [] };
        }
        if (next === "/d") {
          this.#slashPrompt = undefined;
          this.#notice = undefined;
          this.view = "decisions";
          return { dirty: true, actions: [] };
        }
        if (next === "/t") {
          this.#slashPrompt = undefined;
          this.#notice = undefined;
          this.view = "track";
          return { dirty: true, actions: [] };
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
      return { dirty: false, actions: [] };
    }

    if (event.type === "tab") {
      const n = this.#snapshot.workspaces.length;
      if (n > 0) {
        this.activeTabIndex = event.shift
          ? (this.activeTabIndex - 1 + n) % n
          : (this.activeTabIndex + 1) % n;
        this.#selectedSession = 0;
      }
      this.#notice = undefined;
      return {
        dirty: true,
        actions: [{ type: "select-tab", index: this.activeTabIndex }],
      };
    }

    if (event.type === "nav") {
      if (event.direction === "up") return this.#moveSelection(-1);
      if (event.direction === "down") return this.#moveSelection(1);
      return { dirty: false, actions: [] };
    }

    if (event.type === "enter") {
      return this.#activateSelected();
    }

    return { dirty: false, actions: [] };
  }

  #moveSelection(delta: -1 | 1): { dirty: boolean; actions: RightPanelAction[] } {
    this.#notice = undefined;
    if (this.view === "sessions") {
      const ws = this.#snapshot.workspaces[this.activeTabIndex];
      const sessions = ws?.sessions ?? [];
      if (sessions.length === 0) return { dirty: false, actions: [] };
      const next = Math.max(0, Math.min(sessions.length - 1, this.#selectedSession + delta));
      this.#selectedSession = next;
      const target = sessions[next]!;
      return {
        dirty: true,
        actions: [{ type: "select-session", index: next, sessionId: target.id }],
      };
    }
    if (this.view === "decisions") {
      const decisions = this.#snapshot.decisions;
      if (decisions.length === 0) return { dirty: false, actions: [] };
      const next = Math.max(0, Math.min(decisions.length - 1, this.#selectedDecision + delta));
      this.#selectedDecision = next;
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
      const ws = this.#snapshot.workspaces[this.activeTabIndex];
      const target = ws?.sessions[this.#selectedSession];
      if (!target) return { dirty: false, actions: [] };
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
    raw: Buffer,
    opts: RightPanelHandleInputOptions,
  ): { dirty: boolean; actions: RightPanelAction[]; forwardBytes?: Buffer } {
    const totalCols = this.#stdout.columns ?? 0;
    const totalRows = this.#stdout.rows ?? 0;
    const route = routePanelMouse(
      event,
      {
        totalCols,
        totalRows,
        childCols: this.childCols(totalCols),
        open: this.#open,
        ...(opts.statusBarActive !== undefined
          ? { statusBarActive: opts.statusBarActive }
          : {}),
        statusBarMarker: this.statusBarMarker(),
      },
      opts,
    );
    if (route.zone === "native-selection") {
      return { dirty: false, actions: [] };
    }
    if (route.zone === "status-marker" || (!this.#open && route.zone === "panel")) {
      if (!event.release && !event.wheel) {
        this.toggle();
        return { dirty: false, actions: [{ type: "toggle" }] };
      }
      return { dirty: false, actions: [] };
    }
    if (route.zone === "panel") {
      if (event.release || event.wheel) return { dirty: false, actions: [] };
      this.#focus = true;
      if (event.y === 1) {
        this.activeTabIndex =
          this.#snapshot.workspaces.length > 0
            ? (this.activeTabIndex + 1) % this.#snapshot.workspaces.length
            : 0;
        this.#selectedSession = 0;
        return {
          dirty: true,
          actions: [{ type: "select-tab", index: this.activeTabIndex }],
        };
      }
      const hit = this.#hitRows.get(event.y);
      if (hit) {
        if (hit.type === "select-session") {
          const alreadySelected = this.#selectedSession === hit.index;
          this.#selectedSession = hit.index;
          return {
            dirty: true,
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
        if (hit.type === "select-decision") {
          this.#selectedDecision = hit.index;
        }
        return { dirty: true, actions: [hit] };
      }
      return { dirty: true, actions: [] };
    }
    // CLI zone: clicking returns keyboard focus to CLI; forward only if CLI subscribed.
    if (!event.release && !event.wheel && this.#focus) {
      this.#focus = false;
    }
    if (route.forwardToCli) {
      return { dirty: false, actions: [], forwardBytes: raw };
    }
    return { dirty: false, actions: [] };
  }
}
