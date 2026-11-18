/**
 * Native right panel (L0, read-only). Reserved columns mirror the bottom
 * status bar's reserved row: the child PTY is resized to the remaining
 * columns and the panel paints inside the reserved strip. Everything here
 * is behind a default-OFF flag; with the flag off nothing is constructed
 * and attach behaviour is byte-identical to before.
 */

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

export type RightPanelSession = Readonly<{
  id: string;
  label: string;
  status: RightPanelSessionStatus;
  delegated?: boolean;
}>;

export type RightPanelWorkspace = Readonly<{
  title: string;
  sessions: readonly RightPanelSession[];
}>;

export type RightPanelDecision = Readonly<{
  id: string;
  title: string;
  kind: "decision" | "question";
  sessionId?: string;
  dossierLink?: string;
}>;

export type RightPanelSnapshot = Readonly<{
  workspaces: readonly RightPanelWorkspace[];
  decisions: readonly RightPanelDecision[];
  /** Other sessions needing attention plus pending decisions/questions. */
  attentionCount: number;
  /** True when another session (not the attached one) needs attention. */
  collapsedLit: boolean;
  degraded: boolean;
}>;

export type RightPanelView = "sessions" | "decisions" | "track";

export type RightPanelAction =
  | { type: "toggle" }
  | { type: "select-tab"; index: number }
  | { type: "select-session"; index: number }
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
  unknown: { symbol: "?", ansi: "\x1b[2m", attention: false },
};

export function sessionStatusGlyph(status: RightPanelSessionStatus) {
  return GLYPHS[status] ?? GLYPHS.unknown;
}

type RightPanelConfigLike = {
  rightPanel?: { enabled?: boolean; width?: number };
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

export function buildRightPanelSnapshot(args: {
  currentSessionId?: string;
  groups: readonly {
    title: string;
    sessions: readonly RightPanelSession[];
  }[];
  decisions: readonly RightPanelDecision[];
  degraded?: boolean;
}): RightPanelSnapshot {
  const workspaces = args.groups.map((g) => ({
    title: g.title,
    // Delegated sub-sessions stay hidden from the human list by default.
    sessions: g.sessions.filter((s) => s.delegated !== true),
  }));
  let attention = args.decisions.length;
  let collapsedLit = args.decisions.length > 0;
  for (const ws of workspaces) {
    for (const s of ws.sessions) {
      if (!sessionStatusGlyph(s.status).attention) continue;
      attention += 1;
      if (s.id !== args.currentSessionId) collapsedLit = true;
    }
  }
  return {
    workspaces,
    decisions: args.decisions,
    attentionCount: attention,
    collapsedLit,
    degraded: args.degraded === true,
  };
}

type TrackDecisionRow = {
  id: string;
  title: string;
  outcome?: string;
  workspace?: string;
  dossier?: { path?: string; url?: string; link?: string } | string;
  dossierLink?: string;
  sessionId?: string;
  qa?: readonly { question?: string; answer?: unknown }[];
};

function dossierLinkOf(row: TrackDecisionRow): string | undefined {
  if (typeof row.dossierLink === "string" && row.dossierLink) return row.dossierLink;
  if (typeof row.dossier === "string" && row.dossier) return row.dossier;
  if (row.dossier && typeof row.dossier === "object") {
    return row.dossier.path ?? row.dossier.url ?? row.dossier.link;
  }
  return undefined;
}

/** Pending/deferred Track decisions plus their unanswered questions. */
export function decisionsFromTrackDecisions(
  rows: readonly TrackDecisionRow[],
): RightPanelDecision[] {
  const out: RightPanelDecision[] = [];
  for (const row of rows) {
    if (row.outcome !== "pending" && row.outcome !== "deferred") continue;
    const unanswered = (row.qa ?? []).some(
      (q) => q.answer === undefined || q.answer === null || q.answer === "",
    );
    const link = dossierLinkOf(row);
    out.push({
      id: row.id,
      title: row.title,
      kind: unanswered ? "question" : "decision",
      ...(row.sessionId ? { sessionId: row.sessionId } : {}),
      ...(link ? { dossierLink: link } : {}),
    });
  }
  return out;
}

export type SgrMouseEvent = Readonly<{
  button: number;
  x: number;
  y: number;
  release: boolean;
  wheel: boolean;
  shift: boolean;
}>;

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
  geom: { totalCols: number; totalRows: number; childCols: number; open: boolean },
  opts: { cliMouseEnabled: boolean },
): MouseRoute {
  if (event.shift) return { zone: "native-selection", forwardToCli: false };
  // The clickable bottom-bar marker lives in the last columns of the last row.
  if (event.y >= geom.totalRows && event.x >= geom.totalCols - 4) {
    return { zone: "status-marker", forwardToCli: false };
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
  actions: RightPanelAction[];
}>;

function truncate(text: string, width: number): string {
  const chars = [...text];
  if (chars.length <= width) return text.padEnd(width, " ");
  return chars.slice(0, Math.max(0, width - 1)).join("") + "…";
}

export class RightPanelController {
  readonly #stdout: PanelStdout;
  readonly #width: number;
  #snapshot: RightPanelSnapshot;
  #open = false;
  #focus = false;
  view: RightPanelView = "sessions";
  activeTabIndex = 0;
  #selectedSession = 0;
  #pending = "";
  #hitRows = new Map<number, RightPanelAction>();

  constructor(opts: {
    stdout: PanelStdout;
    snapshot: RightPanelSnapshot;
    width?: number;
  }) {
    this.#stdout = opts.stdout;
    this.#snapshot = opts.snapshot;
    this.#width = opts.width ?? RIGHT_PANEL_DEFAULT_WIDTH;
  }

  isOpen(): boolean {
    return this.#open;
  }

  hasPanelFocus(): boolean {
    return this.#open && this.#focus;
  }

  setSnapshot(snapshot: RightPanelSnapshot): void {
    this.#snapshot = snapshot;
    if (this.activeTabIndex >= snapshot.workspaces.length) {
      this.activeTabIndex = 0;
    }
    this.paint();
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
    if (this.#open) {
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
    lines.push(truncate(tabs || "sessions", width));
    if (this.view === "sessions") {
      const ws = this.#snapshot.workspaces[this.activeTabIndex];
      let row = 2;
      (ws?.sessions ?? []).forEach((s, index) => {
        const g = sessionStatusGlyph(s.status);
        const star = g.attention ? "*" : " ";
        lines.push(
          truncate(`${g.ansi}${g.symbol}\x1b[0m${star} ${s.label}`, width),
        );
        this.#hitRows.set(row, { type: "select-session", index });
        row += 1;
      });
      if ((ws?.sessions.length ?? 0) === 0) lines.push(truncate("(no sessions)", width));
    } else if (this.view === "decisions") {
      let row = 2;
      if (this.#snapshot.decisions.length === 0) {
        lines.push(truncate("(no pending decision)", width));
      }
      this.#snapshot.decisions.forEach((d) => {
        const symbol = d.kind === "question" ? "?" : "◆";
        lines.push(truncate(`${symbol}* ${d.title}`, width));
        this.#hitRows.set(
          row,
          d.dossierLink
            ? { type: "open-link", target: d.dossierLink }
            : { type: "select-session", index: row - 2 },
        );
        row += 1;
        if (d.dossierLink) {
          lines.push(truncate(d.dossierLink, width));
          this.#hitRows.set(row, { type: "open-link", target: d.dossierLink });
          row += 1;
        }
      });
    } else {
      lines.push(truncate("track: not in L0", width));
    }
    return lines;
  }

  handleInput(
    data: string,
    opts: { cliMouseEnabled: boolean },
  ): RightPanelHandleResult {
    const input = this.#pending + data;
    this.#pending = "";
    const actions: RightPanelAction[] = [];

    if (input.includes(RIGHT_PANEL_TOGGLE_SEQUENCE)) {
      this.toggle();
      actions.push({ type: "toggle" });
      const rest = input.replace(RIGHT_PANEL_TOGGLE_SEQUENCE, "");
      return rest.length > 0
        ? { consumed: false, forward: rest, actions }
        : { consumed: true, actions };
    }
    // In panel focus a bare Esc returns focus to the CLI at once.
    if (this.hasPanelFocus() && input === "\x1b") {
      this.#focus = false;
      return { consumed: true, actions };
    }
    // A split toggle sequence stays buffered instead of leaking to the CLI.
    if (
      input.length >= 2 &&
      RIGHT_PANEL_TOGGLE_SEQUENCE.startsWith(input) &&
      input.length < RIGHT_PANEL_TOGGLE_SEQUENCE.length &&
      input.startsWith("\x1b")
    ) {
      this.#pending = input;
      return { consumed: true, actions };
    }

    if (input.includes("\x1b[<")) {
      const { events, rest } = parseSgrMouse(input);
      let consumedAll = rest.trim() === "" || rest === input;
      for (const event of events) {
        const totalCols = this.#stdout.columns ?? 0;
        const totalRows = this.#stdout.rows ?? 0;
        const route = routePanelMouse(
          event,
          {
            totalCols,
            totalRows,
            childCols: this.childCols(totalCols),
            open: this.#open,
          },
          opts,
        );
        if (route.zone === "native-selection") {
          consumedAll = true;
          continue;
        }
        if (route.zone === "status-marker" || (!this.#open && route.zone === "panel")) {
          if (!event.release && !event.wheel) {
            this.toggle();
            actions.push({ type: "toggle" });
          }
          consumedAll = true;
          continue;
        }
        if (route.zone === "panel") {
          consumedAll = true;
          if (event.release || event.wheel) continue;
          if (event.y === 1) {
            const next = Math.min(
              Math.max(0, this.#snapshot.workspaces.length - 1),
              this.activeTabIndex + 1,
            );
            // Tab row click cycles to the next meta-workspace tab in L0.
            this.activeTabIndex =
              this.#snapshot.workspaces.length > 0
                ? (this.activeTabIndex + 1) % this.#snapshot.workspaces.length
                : 0;
            void next;
            actions.push({ type: "select-tab", index: this.activeTabIndex });
          } else {
            const hit = this.#hitRows.get(event.y);
            if (hit) actions.push(hit);
          }
          this.paint();
          continue;
        }
        // CLI zone: forward only when the CLI itself enabled mouse tracking.
        if (!route.forwardToCli) consumedAll = true;
      }
      if (events.length > 0) {
        return consumedAll
          ? { consumed: true, actions }
          : { consumed: false, forward: input, actions };
      }
    }

    if (!this.hasPanelFocus()) {
      return { consumed: false, forward: input, actions };
    }

    // Panel focus: the owner's in-panel grammar; nothing reaches the CLI.
    if (input === "\x1b") {
      this.#focus = false;
      return { consumed: true, actions };
    }
    if (input === "/s") this.view = "sessions";
    else if (input === "/d") this.view = "decisions";
    else if (input === "/t") this.view = "track";
    else if (input === "\t") {
      const n = this.#snapshot.workspaces.length;
      if (n > 0) this.activeTabIndex = (this.activeTabIndex + 1) % n;
      actions.push({ type: "select-tab", index: this.activeTabIndex });
    }
    this.paint();
    return { consumed: true, actions };
  }
}
