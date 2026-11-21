/**
 * Local, inert and scrollable view of a draft kept by the host vault
 * (S1, r4 §3.6, D-A17).
 *
 * The view shows the message state, the length and the complete text of a
 * draft the host could not hand back yet. Nothing in the draft is ever
 * interpreted: every control, bidi and format character is made visible, so a
 * draft holding CSI, OSC or HTML paints as text. The raw export returns the
 * exact saved bytes. Replace and delete only run after a confirmation, and the
 * host stays the authority: this module renders and asks, it never decides.
 */
import type { PanelInputEvent } from "./panel-input.js";
import { panelDisplayColumns } from "./right-panel.js";

export type DraftSubmissionOutcome = "pending" | "submitted" | "uncertain" | "refused";
export type DraftRestitutionState =
  | "untouched"
  | "restoring-on-ready"
  | "restored"
  | "saved-for-recovery";

export type DraftRecoveryRecord = Readonly<{
  sessionId: string;
  applicationIncarnation: string;
  requestId: string;
  submission: DraftSubmissionOutcome;
  draft: DraftRestitutionState;
  /** Declared length of the saved draft, in bytes. */
  byteLength: number;
  /** Exact saved bytes; absent once a proven restitution purged the content. */
  content?: Uint8Array | undefined;
  /** Human keystrokes the adapter still retains after a failed import. */
  retainedKeystrokes?: number | undefined;
}>;

export type DraftRecoveryAction = "export" | "replace" | "delete";

export type DraftRecoveryLabels = Readonly<{
  title: string;
  submission: Readonly<Record<DraftSubmissionOutcome, string>>;
  draft: Readonly<Record<DraftRestitutionState, string>>;
  message: string;
  draftWord: string;
  bytes: string;
  purged: string;
  retainedKeystrokes: string;
  actions: Readonly<Record<DraftRecoveryAction, string>>;
  confirm: string;
  hint: string;
}>;

export type DraftRecoveryHandlers = Readonly<{
  onAction(action: DraftRecoveryAction): void;
  onClose(): void;
}>;

const CONFIRMED_ACTIONS: ReadonlySet<DraftRecoveryAction> = new Set(["replace", "delete"]);

function hex(cp: number, width: number): string {
  return cp.toString(16).toUpperCase().padStart(width, "0");
}

/** One visible, inert rendering per code point. */
function inertCodePoint(cp: number): string {
  if (cp < 0x20) return String.fromCodePoint(0x2400 + cp);
  if (cp === 0x7f) return "␡";
  if (cp >= 0x80 && cp <= 0x9f) return `⟨${hex(cp, 2)}⟩`;
  const ch = String.fromCodePoint(cp);
  // Format controls (bidi overrides, joiners, BOM…), separators and lone
  // surrogates never reach the terminal as themselves.
  if (/[\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Cn}]/u.test(ch)) return `⟨U+${hex(cp, 4)}⟩`;
  return ch;
}

/**
 * Logical lines of a draft, split on LF, with every control character made
 * visible. Invalid UTF-8 stays visible as U+FFFD; the exact bytes remain
 * available through `draftExportBytes`.
 */
export function inertDraftLines(bytes: Uint8Array): string[] {
  const text = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(bytes);
  const lines: string[] = [];
  let current = "";
  for (const ch of text) {
    if (ch === "\n") {
      lines.push(current);
      current = "";
      continue;
    }
    current += inertCodePoint(ch.codePointAt(0)!);
  }
  lines.push(current);
  return lines;
}

/** Hard-wrap an inert line on display columns (wide glyphs count two). */
function wrapLine(line: string, width: number): string[] {
  if (width <= 0) return [""];
  if (line.length === 0) return [""];
  const out: string[] = [];
  let current = "";
  let cols = 0;
  for (const ch of line) {
    const w = panelDisplayColumns(ch);
    if (cols + w > width && current.length > 0) {
      out.push(current);
      current = "";
      cols = 0;
    }
    current += ch;
    cols += w;
  }
  out.push(current);
  return out;
}

/** Exact saved bytes (a private copy), or undefined once the host purged them. */
export function draftExportBytes(record: DraftRecoveryRecord): Buffer | undefined {
  return record.content === undefined ? undefined : Buffer.from(record.content);
}

export class DraftRecoveryView {
  #record: DraftRecoveryRecord;
  readonly #labels: DraftRecoveryLabels;
  readonly #handlers: DraftRecoveryHandlers;
  #lines: string[];
  #scroll = 0;
  #selected = 0;
  #confirming: DraftRecoveryAction | undefined;
  #status: string | undefined;
  #lastBodyRows = 1;
  #lastWrapped = 0;

  constructor(
    record: DraftRecoveryRecord,
    labels: DraftRecoveryLabels,
    handlers: DraftRecoveryHandlers,
  ) {
    this.#record = record;
    this.#labels = labels;
    this.#handlers = handlers;
    this.#lines = record.content === undefined ? [] : inertDraftLines(record.content);
  }

  get record(): DraftRecoveryRecord {
    return this.#record;
  }

  /** Refresh after the host reported a new state; the scroll position stays. */
  update(record: DraftRecoveryRecord): void {
    this.#record = record;
    this.#lines = record.content === undefined ? [] : inertDraftLines(record.content);
    this.#confirming = undefined;
    if (this.#selected >= this.#actions().length) this.#selected = 0;
  }

  /** Outcome of the last action (export path, refusal reason…), one line. */
  setStatus(status: string | undefined): void {
    this.#status = status;
  }

  #actions(): DraftRecoveryAction[] {
    // Without content there is nothing to export or to put back.
    return this.#record.content === undefined ? ["delete"] : ["export", "replace", "delete"];
  }

  #header(): string[] {
    const r = this.#record;
    const lines = [
      this.#labels.title,
      `${r.sessionId} · ${r.requestId}`,
      // One state per line: the panel is narrow and a state word never wraps.
      `${this.#labels.message}: ${this.#labels.submission[r.submission]}`,
      `${this.#labels.draftWord}: ${this.#labels.draft[r.draft]}`,
      `${r.byteLength} ${this.#labels.bytes}`,
    ];
    if (r.retainedKeystrokes !== undefined && r.retainedKeystrokes > 0) {
      lines.push(`${r.retainedKeystrokes} ${this.#labels.retainedKeystrokes}`);
    }
    if (r.content === undefined) lines.push(this.#labels.purged);
    return lines;
  }

  render(width: number, rows: number): string[] {
    const header = this.#header().flatMap((line) => wrapLine(line, width));
    const actions = this.#actions();
    const footer: string[] = actions.map((action, index) => {
      const label = `[${this.#labels.actions[action]}]`;
      return index === this.#selected ? `\x1b[7m${label}\x1b[0m` : label;
    });
    footer.push(
      this.#confirming !== undefined
        ? this.#labels.confirm
        : (this.#status ?? this.#labels.hint),
    );
    const wrapped = this.#lines.flatMap((line) => wrapLine(line, width));
    this.#lastWrapped = wrapped.length;
    const bodyRows = Math.max(1, rows - header.length - footer.length);
    this.#lastBodyRows = bodyRows;
    this.#scroll = Math.max(0, Math.min(this.#scroll, Math.max(0, wrapped.length - bodyRows)));
    const body = wrapped.slice(this.#scroll, this.#scroll + bodyRows);
    while (body.length < bodyRows) body.push("");
    return [...header, ...body, ...footer].slice(0, Math.max(rows, 0));
  }

  #scrollBy(delta: number): boolean {
    const max = Math.max(0, this.#lastWrapped - this.#lastBodyRows);
    const next = Math.max(0, Math.min(max, this.#scroll + delta));
    if (next === this.#scroll) return true;
    this.#scroll = next;
    return true;
  }

  handleWheel(deltaRows: number): boolean {
    return this.#scrollBy(deltaRows);
  }

  /** Panel-focus key. Always consumed: nothing typed here reaches a session. */
  handleKey(event: PanelInputEvent): boolean {
    if (event.type === "escape") {
      if (this.#confirming !== undefined) {
        this.#confirming = undefined;
        return true;
      }
      this.#handlers.onClose();
      return true;
    }
    if (event.type === "enter") {
      const action = this.#actions()[this.#selected];
      if (action === undefined) return true;
      if (CONFIRMED_ACTIONS.has(action) && this.#confirming !== action) {
        this.#confirming = action;
        return true;
      }
      this.#confirming = undefined;
      this.#handlers.onAction(action);
      return true;
    }
    // Any other key withdraws a pending confirmation.
    this.#confirming = undefined;
    if (event.type === "tab") {
      const count = this.#actions().length;
      this.#selected = (this.#selected + (event.shift ? count - 1 : 1)) % count;
      return true;
    }
    if (event.type === "nav") {
      if (event.direction === "up") return this.#scrollBy(-1);
      if (event.direction === "down") return this.#scrollBy(1);
      return true;
    }
    if (event.type === "char") {
      if (event.char === "k") return this.#scrollBy(-1);
      if (event.char === "j") return this.#scrollBy(1);
    }
    return true;
  }
}
