/**
 * Byte-level streaming classifier for local input received while a native
 * attach view is in remote observer mode (LH-05, spec §5.4).
 *
 * Terminal reports (cursor position, attributes, status/color, DECRQM mode,
 * XTVERSION/XTGETTCAP/DECRQSS, kitty capability, window metrics, palette
 * colors, focus, mouse) are ignored in observer mode so window focus changes
 * and terminal query replies never steal control from the remote user. Any
 * keystroke, paste, arrow/function key, or incomplete sequence held past 25 ms
 * triggers take-back.
 */

export const OBSERVER_INPUT_CSI_MAX_BYTES = 64;
export const OBSERVER_INPUT_STRING_MAX_BYTES = 1_024;
export const OBSERVER_INPUT_PENDING_TIMEOUT_MS = 25;
export const OBSERVER_PASTE_DISCARD_MAX_BYTES = 1_048_576;

export type ObserverReportFamily = Readonly<{
  id: string;
  form: string;
}>;

export const OBSERVER_REPORT_FAMILIES: readonly ObserverReportFamily[] = Object.freeze([
  { id: "cursor-position", form: "CSI row ; col R / CSI ? row ; col R" },
  { id: "attributes", form: "CSI ? … c / CSI > … c / DCS ! | … ST" },
  { id: "status-color-scheme", form: "CSI 0 n / CSI ? … n" },
  { id: "mode", form: "CSI … $ y / CSI ? … $ y" },
  { id: "version-caps-settings", form: "DCS > | … ST / DCS 0|1 +|$ r … ST" },
  { id: "kitty-keyboard", form: "CSI ? … u" },
  { id: "window", form: "CSI 4|6|8|48 ; … t / OSC l|L … ST" },
  { id: "colors", form: "OSC 4|10|11|12 ; … ST|BEL" },
  { id: "focus", form: "CSI I / CSI O" },
  { id: "mouse", form: "CSI < … M|m / CSI n;n;n M / CSI M <3 bytes>" },
] as const);

export type ObserverInputFeedResult = Readonly<
  | { kind: "report"; pasteEnded?: boolean }
  | { kind: "pending"; deadlineMs: number; pasteEnded?: boolean }
  | { kind: "keystroke"; pasteStarted?: boolean; pasteEnded?: boolean }
>;

type ParseState =
  | "ground"
  | "escape"
  | "csi"
  | "x10-mouse"
  | "osc"
  | "osc-esc"
  | "dcs"
  | "dcs-esc";

const CSI_CURSOR_RE = /^\x1b\[\??\d+;\d+R$/;
const CSI_ATTR_RE = /^\x1b\[[?>][0-9;]*c$/;
const CSI_STATUS_RE = /^\x1b\[(?:0|\?[0-9;]*)n$/;
const CSI_MODE_RE = /^\x1b\[\??[0-9;]*\$y$/;
const CSI_KITTY_QUERY_RE = /^\x1b\[\?[0-9;]*u$/;
const CSI_WINDOW_RE = /^\x1b\[(?:4|6|8|48);[0-9;]*t$/;
const CSI_FOCUS_RE = /^\x1b\[[IO]$/;
const CSI_SGR_MOUSE_RE = /^\x1b\[<\d+;\d+;\d+[Mm]$/;
const CSI_URXVT_MOUSE_RE = /^\x1b\[\d+;\d+;\d+M$/;

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const PASTE_END_BYTES = Buffer.from(PASTE_END, "latin1");

function isReportCsi(seq: string): boolean {
  return (
    CSI_CURSOR_RE.test(seq) ||
    CSI_ATTR_RE.test(seq) ||
    CSI_STATUS_RE.test(seq) ||
    CSI_MODE_RE.test(seq) ||
    CSI_KITTY_QUERY_RE.test(seq) ||
    CSI_WINDOW_RE.test(seq) ||
    CSI_FOCUS_RE.test(seq) ||
    CSI_SGR_MOUSE_RE.test(seq) ||
    CSI_URXVT_MOUSE_RE.test(seq)
  );
}

function isReportOsc(seq: string): boolean {
  if (!seq.startsWith("\x1b]")) return false;
  const body = seq.endsWith("\x07")
    ? seq.slice(2, -1)
    : seq.endsWith("\x1b\\")
      ? seq.slice(2, -2)
      : "";
  if (body.length === 0) return false;
  if (body.startsWith("l") || body.startsWith("L")) return true;
  return /^(?:4|10|11|12);/.test(body);
}

function isReportDcs(seq: string): boolean {
  if (!seq.startsWith("\x1bP") || !seq.endsWith("\x1b\\")) return false;
  const body = seq.slice(2, -2);
  return /^(?:!\||>\||[01]\+r|[01]\$r)/.test(body);
}

export class ObserverInputClassifier {
  #state: ParseState = "ground";
  #buf: number[] = [];
  #x10Remaining = 0;
  #inPaste = false;
  #pasteEndMatch = 0;
  #pasteDiscardedBytes = 0;

  isInBracketedPaste(): boolean {
    return this.#inPaste;
  }

  hasPending(): boolean {
    return this.#buf.length > 0;
  }

  reset(): void {
    this.#state = "ground";
    this.#buf = [];
    this.#x10Remaining = 0;
    this.#inPaste = false;
    this.#pasteEndMatch = 0;
    this.#pasteDiscardedBytes = 0;
  }

  expirePending(): ObserverInputFeedResult | null {
    if (this.#buf.length === 0) return null;
    this.#state = "ground";
    this.#buf = [];
    this.#x10Remaining = 0;
    return { kind: "keystroke" };
  }

  /**
   * Consume a block while discarding a take-back bracketed paste until ESC[201~
   * is observed (or the 1 MiB safety bound is reached).
   */
  consumePasteDiscard(chunk: Uint8Array): boolean {
    if (!this.#inPaste) return false;
    for (let i = 0; i < chunk.length; i += 1) {
      this.#pasteDiscardedBytes += 1;
      const b = chunk[i]!;
      if (b === PASTE_END_BYTES[this.#pasteEndMatch]) {
        this.#pasteEndMatch += 1;
        if (this.#pasteEndMatch === PASTE_END_BYTES.length) {
          this.#inPaste = false;
          this.#pasteEndMatch = 0;
          this.#pasteDiscardedBytes = 0;
          return true;
        }
      } else {
        this.#pasteEndMatch = b === PASTE_END_BYTES[0] ? 1 : 0;
      }
      if (this.#pasteDiscardedBytes >= OBSERVER_PASTE_DISCARD_MAX_BYTES) {
        this.#inPaste = false;
        this.#pasteEndMatch = 0;
        this.#pasteDiscardedBytes = 0;
        return true;
      }
    }
    return false;
  }

  feed(chunk: Uint8Array, nowMs: number): ObserverInputFeedResult {
    let sawKeystroke = false;
    let pasteStarted = false;
    let pasteEnded = false;

    const failToKeystroke = (): void => {
      sawKeystroke = true;
      this.#state = "ground";
      this.#buf = [];
      this.#x10Remaining = 0;
    };

    for (let i = 0; i < chunk.length; i += 1) {
      const b = chunk[i]!;

      if (this.#inPaste) {
        this.#pasteDiscardedBytes += 1;
        sawKeystroke = true;
        if (b === PASTE_END_BYTES[this.#pasteEndMatch]) {
          this.#pasteEndMatch += 1;
          if (this.#pasteEndMatch === PASTE_END_BYTES.length) {
            this.#inPaste = false;
            this.#pasteEndMatch = 0;
            this.#pasteDiscardedBytes = 0;
            pasteEnded = true;
          }
        } else {
          this.#pasteEndMatch = b === PASTE_END_BYTES[0] ? 1 : 0;
        }
        if (this.#pasteDiscardedBytes >= OBSERVER_PASTE_DISCARD_MAX_BYTES) {
          this.#inPaste = false;
          this.#pasteEndMatch = 0;
          this.#pasteDiscardedBytes = 0;
          pasteEnded = true;
        }
        continue;
      }

      if (this.#state === "ground") {
        if (b === 0x1b) {
          this.#state = "escape";
          this.#buf = [b];
        } else {
          sawKeystroke = true;
        }
        continue;
      }

      if (this.#state === "escape") {
        if (b === 0x5b) {
          // ESC [
          this.#state = "csi";
          this.#buf.push(b);
        } else if (b === 0x5d) {
          // ESC ]
          this.#state = "osc";
          this.#buf.push(b);
        } else if (b === 0x50) {
          // ESC P
          this.#state = "dcs";
          this.#buf.push(b);
        } else {
          failToKeystroke();
        }
        continue;
      }

      if (this.#state === "x10-mouse") {
        this.#buf.push(b);
        this.#x10Remaining -= 1;
        if (this.#x10Remaining <= 0) {
          this.#state = "ground";
          this.#buf = [];
        }
        continue;
      }

      if (this.#state === "csi") {
        this.#buf.push(b);
        if (this.#buf.length > OBSERVER_INPUT_CSI_MAX_BYTES) {
          failToKeystroke();
          continue;
        }
        if (b >= 0x40 && b <= 0x7e) {
          const seq = Buffer.from(this.#buf).toString("latin1");
          if (seq === "\x1b[M") {
            this.#state = "x10-mouse";
            this.#x10Remaining = 3;
            continue;
          }
          if (seq === PASTE_START) {
            this.#inPaste = true;
            this.#pasteEndMatch = 0;
            this.#pasteDiscardedBytes = 0;
            pasteStarted = true;
            failToKeystroke();
            continue;
          }
          this.#state = "ground";
          this.#buf = [];
          if (!isReportCsi(seq)) {
            sawKeystroke = true;
          }
        } else if (b < 0x20 || b > 0x3f) {
          failToKeystroke();
        }
        continue;
      }

      if (this.#state === "osc" || this.#state === "osc-esc") {
        this.#buf.push(b);
        if (this.#buf.length > OBSERVER_INPUT_STRING_MAX_BYTES) {
          failToKeystroke();
          continue;
        }
        if (this.#state === "osc") {
          if (b === 0x07) {
            const seq = Buffer.from(this.#buf).toString("latin1");
            this.#state = "ground";
            this.#buf = [];
            if (!isReportOsc(seq)) sawKeystroke = true;
          } else if (b === 0x1b) {
            this.#state = "osc-esc";
          }
        } else {
          if (b === 0x5c) {
            const seq = Buffer.from(this.#buf).toString("latin1");
            this.#state = "ground";
            this.#buf = [];
            if (!isReportOsc(seq)) sawKeystroke = true;
          } else {
            failToKeystroke();
          }
        }
        continue;
      }

      // dcs / dcs-esc
      this.#buf.push(b);
      if (this.#buf.length > OBSERVER_INPUT_STRING_MAX_BYTES) {
        failToKeystroke();
        continue;
      }
      if (this.#state === "dcs") {
        if (b === 0x1b) {
          this.#state = "dcs-esc";
        }
      } else {
        if (b === 0x5c) {
          const seq = Buffer.from(this.#buf).toString("latin1");
          this.#state = "ground";
          this.#buf = [];
          if (!isReportDcs(seq)) sawKeystroke = true;
        } else {
          failToKeystroke();
        }
      }
    }

    if (sawKeystroke) {
      return {
        kind: "keystroke",
        ...(pasteStarted ? { pasteStarted: true } : {}),
        ...(pasteEnded ? { pasteEnded: true } : {}),
      };
    }
    if (this.#buf.length > 0) {
      return {
        kind: "pending",
        deadlineMs: nowMs + OBSERVER_INPUT_PENDING_TIMEOUT_MS,
        ...(pasteEnded ? { pasteEnded: true } : {}),
      };
    }
    return {
      kind: "report",
      ...(pasteEnded ? { pasteEnded: true } : {}),
    };
  }
}
