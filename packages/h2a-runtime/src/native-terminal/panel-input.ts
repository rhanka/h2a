/**
 * Byte-level streaming input parser for the native right panel (L0.5a,
 * PANEL §9.2 & §9.3).
 *
 * Guarantees:
 * - Bytes stay bytes end-to-end: forwarded CLI chunks are NEVER UTF-8 decoded
 *   and re-encoded, so multibyte UTF-8 characters split across chunks reach
 *   the child unmodified (zero U+FFFD).
 * - Capture priority: (1) DETACH_BYTE (0x1c) wins everywhere, even in panel
 *   focus or bracketed paste; (2) bracketed paste (ESC[200~ .. ESC[201~) while
 *   child mode 2004 is on suspends opener and SGR mouse detection; (3) opener
 *   (F12 legacy & kitty forms) and SGR mouse sequences survive arbitrary
 *   1-byte fragmentation; (4) panel-focus keys (/s, /d, /t, Tab, Shift+Tab,
 *   arrows CSI/SS3/kitty, Enter, Esc legacy/kitty) never leak to the child.
 */

export const DETACH_BYTE = 0x1c;
export const F12_SEQUENCE = Buffer.from([0x1b, 0x5b, 0x32, 0x34, 0x7e]);

const ESC_BYTE = 0x1b;
const CSI_MAX_LEN = 64;
const PASTE_START_STR = "\x1b[200~";
const PASTE_END_BYTES = [0x1b, 0x5b, 0x32, 0x30, 0x31, 0x7e] as const; // ESC[201~

export type ParsedSgrMouseEvent = Readonly<{
  button: number;
  x: number;
  y: number;
  release: boolean;
  wheel: boolean;
  shift: boolean;
}>;

export type PanelInputContext = Readonly<{
  panelFocus: boolean;
  bracketedPasteEnabled: boolean;
  kittyKeyboardEnabled?: boolean;
}>;

export type PanelInputEvent =
  | { readonly type: "detach" }
  | { readonly type: "toggle" }
  | { readonly type: "escape" }
  | { readonly type: "tab"; readonly shift: boolean }
  | { readonly type: "nav"; readonly direction: "up" | "down" | "left" | "right" }
  | { readonly type: "enter" }
  | { readonly type: "backspace" }
  | { readonly type: "char"; readonly char: string }
  | {
      readonly type: "sgr-mouse";
      readonly event: ParsedSgrMouseEvent;
      readonly raw: Buffer;
    }
  | { readonly type: "forward"; readonly bytes: Buffer };

const SGR_MOUSE_EXACT_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;
const KITTY_F12_TILDE_RE = /^\x1b\[24(?:;(\d+)(?::(\d+))?)?~$/;
const KITTY_F12_PUA_RE = /^\x1b\[57375(?:;(\d+)(?::(\d+))?)?u$/;
const KITTY_ARROW_RE = /^\x1b\[1;(\d+)(?::(\d+))?([ABCD])$/;
const KITTY_CSI_U_RE = /^\x1b\[(\d+)(?:;(\d+)(?::(\d+))?)?u$/;

function isCliInterestingCsiPrefix(buf: readonly number[], pasteEnabled: boolean): boolean {
  // buf starts with [0x1b, 0x5b]
  if (buf.length <= 2) return true;
  const body = String.fromCharCode(...buf.slice(2));
  // SGR mouse: ESC [ < ...
  if (body.startsWith("<")) return true;
  // Legacy / kitty F12: ESC [ 24 ~ or ESC [ 24 ; 1 ... ~
  if ("24~".startsWith(body) || /^24(?:;[\d:]*)?$/.test(body)) return true;
  // Kitty PUA F12: ESC [ 57375 ... u
  if ("57375u".startsWith(body) || /^57375(?:;[\d:]*)?$/.test(body)) return true;
  // Bracketed paste start: ESC [ 200 ~
  if (pasteEnabled && "200~".startsWith(body)) return true;
  return false;
}

function directionFromCode(ch: string): "up" | "down" | "left" | "right" | undefined {
  if (ch === "A") return "up";
  if (ch === "B") return "down";
  if (ch === "C") return "right";
  if (ch === "D") return "left";
  return undefined;
}

export class PanelInputParser {
  #escBuf: number[] = [];
  #inPaste = false;
  #pasteEndIdx = 0;

  hasPendingEscape(): boolean {
    return this.#escBuf.length === 1 && this.#escBuf[0] === ESC_BYTE;
  }

  hasPendingSequence(): boolean {
    return this.#escBuf.length > 0;
  }

  isInBracketedPaste(): boolean {
    return this.#inPaste;
  }

  reset(): void {
    this.#escBuf = [];
    this.#inPaste = false;
    this.#pasteEndIdx = 0;
  }

  /**
   * Flush a lone held ESC (0x1b) after an escape-disambiguation delay, or any
   * truncated CLI-focus escape buffer.
   */
  flushPending(ctx: PanelInputContext): PanelInputEvent[] {
    if (this.#escBuf.length === 0) return [];
    const buf = this.#escBuf;
    this.#escBuf = [];
    if (buf.length === 1 && buf[0] === ESC_BYTE && ctx.panelFocus) {
      return [{ type: "escape" }];
    }
    if (!ctx.panelFocus) {
      return [{ type: "forward", bytes: Buffer.from(buf) }];
    }
    return [];
  }

  feed(
    chunk: Uint8Array,
    ctxOrGetter: PanelInputContext | (() => PanelInputContext),
    onEvent?: (event: PanelInputEvent) => void,
  ): PanelInputEvent[] {
    const events: PanelInputEvent[] = [];
    let pendingForward: number[] = [];

    const getCtx = (): PanelInputContext =>
      typeof ctxOrGetter === "function" ? ctxOrGetter() : ctxOrGetter;

    const flushForward = (): void => {
      if (pendingForward.length === 0) return;
      const ev: PanelInputEvent = {
        type: "forward",
        bytes: Buffer.from(pendingForward),
      };
      pendingForward = [];
      events.push(ev);
      onEvent?.(ev);
    };

    const emit = (ev: PanelInputEvent): void => {
      if (ev.type === "forward") {
        for (let k = 0; k < ev.bytes.length; k += 1) {
          pendingForward.push(ev.bytes[k]!);
        }
        return;
      }
      flushForward();
      events.push(ev);
      onEvent?.(ev);
    };

    const processByte = (b: number): boolean => {
      // Rule 1: DETACH_BYTE (Ctrl-\) wins over everything in any focus or paste.
      if (b === DETACH_BYTE) {
        this.#escBuf = [];
        this.#inPaste = false;
        this.#pasteEndIdx = 0;
        pendingForward = [];
        emit({ type: "detach" });
        return false; // stop processing remaining bytes after detach
      }

      // Rule 2: Bracketed paste active (CLI focus only) — suspend opener/mouse,
      // forward every byte verbatim, exit paste when ESC[201~ completes.
      if (this.#inPaste) {
        pendingForward.push(b);
        if (b === PASTE_END_BYTES[this.#pasteEndIdx]) {
          this.#pasteEndIdx += 1;
          if (this.#pasteEndIdx === PASTE_END_BYTES.length) {
            this.#inPaste = false;
            this.#pasteEndIdx = 0;
          }
        } else {
          this.#pasteEndIdx = b === PASTE_END_BYTES[0] ? 1 : 0;
        }
        return true;
      }

      const ctx = getCtx();

      // Rule 3: Inside buffered escape sequence.
      if (this.#escBuf.length > 0) {
        if (this.#escBuf.length === 1) {
          // After bare ESC (0x1b): '[' starts CSI, 'O' starts SS3.
          if (b === 0x5b || b === 0x4f) {
            this.#escBuf.push(b);
            return true;
          }
          this.#escBuf = [];
          if (ctx.panelFocus) {
            // Bare Esc followed by a non-sequence byte: resolve Esc first,
            // then process `b` under the updated focus context!
            emit({ type: "escape" });
            return processByte(b);
          }
          pendingForward.push(ESC_BYTE, b);
          return true;
        }

        // SS3 sequence: ESC O <final>
        if (this.#escBuf[1] === 0x4f) {
          const seq = Buffer.from([...this.#escBuf, b]);
          this.#escBuf = [];
          if (ctx.panelFocus) {
            const dir = directionFromCode(String.fromCharCode(b));
            if (dir) emit({ type: "nav", direction: dir });
            return true;
          }
          emit({ type: "forward", bytes: seq });
          return true;
        }

        // CSI sequence: ESC [ <params/intermediates>* <final 0x40..0x7e>
        this.#escBuf.push(b);
        const isFinal = b >= 0x40 && b <= 0x7e;
        const isParamOrInter = b >= 0x20 && b <= 0x3f;

        if (!isFinal && (!isParamOrInter || this.#escBuf.length >= CSI_MAX_LEN)) {
          // Malformed or oversized CSI: drop if SGR mouse or panel focus, else forward.
          const raw = Buffer.from(this.#escBuf);
          this.#escBuf = [];
          if (!ctx.panelFocus && !raw.toString("latin1").startsWith("\x1b[<")) {
            emit({ type: "forward", bytes: raw });
          }
          return true;
        }

        if (!isFinal) {
          // Still receiving CSI parameter bytes. In CLI focus, flush early if
          // this prefix can no longer match F12, SGR mouse, or paste-start.
          if (!ctx.panelFocus && !isCliInterestingCsiPrefix(this.#escBuf, ctx.bracketedPasteEnabled)) {
            const raw = Buffer.from(this.#escBuf);
            this.#escBuf = [];
            emit({ type: "forward", bytes: raw });
          }
          return true;
        }

        // Complete CSI sequence.
        const raw = Buffer.from(this.#escBuf);
        this.#escBuf = [];
        const seqStr = raw.toString("latin1");

        // Bracketed paste start (only when CLI has mode 2004 on and CLI has focus).
        if (!ctx.panelFocus && ctx.bracketedPasteEnabled && seqStr === PASTE_START_STR) {
          this.#inPaste = true;
          this.#pasteEndIdx = 0;
          emit({ type: "forward", bytes: raw });
          return true;
        }

        // F12 opener (legacy ESC[24~ and kitty functional/PUA forms).
        const f12Tilde = KITTY_F12_TILDE_RE.exec(seqStr);
        if (f12Tilde) {
          const mod = f12Tilde[1] ? Number(f12Tilde[1]) : 1;
          const evType = f12Tilde[2] ? Number(f12Tilde[2]) : 1;
          if (mod === 1) {
            if (evType !== 3) emit({ type: "toggle" });
            return true;
          }
        }
        const f12Pua = KITTY_F12_PUA_RE.exec(seqStr);
        if (f12Pua) {
          const mod = f12Pua[1] ? Number(f12Pua[1]) : 1;
          const evType = f12Pua[2] ? Number(f12Pua[2]) : 1;
          if (mod === 1) {
            if (evType !== 3) emit({ type: "toggle" });
            return true;
          }
        }

        // SGR mouse (ESC[<b;x;yM/m) — in any focus.
        if (seqStr.startsWith("\x1b[<")) {
          const m = SGR_MOUSE_EXACT_RE.exec(seqStr);
          if (m) {
            const button = Number(m[1]);
            emit({
              type: "sgr-mouse",
              event: {
                button,
                x: Number(m[2]),
                y: Number(m[3]),
                release: m[4] === "m",
                wheel: (button & 64) !== 0,
                shift: (button & 4) !== 0,
              },
              raw,
            });
          }
          // Malformed ESC[< sequences are dropped cleanly, never forwarded.
          return true;
        }

        // Panel-focus navigation & kitty key forms.
        if (ctx.panelFocus) {
          if (seqStr.length === 3) {
            const dir = directionFromCode(seqStr[2]!);
            if (dir) {
              emit({ type: "nav", direction: dir });
              return true;
            }
            if (seqStr[2] === "Z") {
              emit({ type: "tab", shift: true });
              return true;
            }
          }
          const kArrow = KITTY_ARROW_RE.exec(seqStr);
          if (kArrow) {
            const mod = Number(kArrow[1]);
            const evType = kArrow[2] ? Number(kArrow[2]) : 1;
            const dir = directionFromCode(kArrow[3]!);
            if (mod === 1 && evType !== 3 && dir) {
              emit({ type: "nav", direction: dir });
            }
            return true;
          }
          const kCsiU = KITTY_CSI_U_RE.exec(seqStr);
          if (kCsiU) {
            const code = Number(kCsiU[1]);
            const mod = kCsiU[2] ? Number(kCsiU[2]) : 1;
            const evType = kCsiU[3] ? Number(kCsiU[3]) : 1;
            if (evType === 3) return true; // ignore key release
            if (code === 27 && mod === 1) {
              emit({ type: "escape" });
              return true;
            }
            if (code === 9 && (mod === 1 || mod === 2)) {
              emit({ type: "tab", shift: mod === 2 });
              return true;
            }
            if (code === 13 && mod === 1) {
              emit({ type: "enter" });
              return true;
            }
            if ((code === 127 || code === 8) && mod === 1) {
              emit({ type: "backspace" });
              return true;
            }
            if (code >= 0x20 && code <= 0x7e && (mod === 1 || mod === 2)) {
              emit({ type: "char", char: String.fromCharCode(code) });
              return true;
            }
            return true;
          }
          // Unrecognized CSI in panel focus: consume, never leak to CLI.
          return true;
        }

        // CLI focus: forward non-intercepted CSI whole and unmodified.
        emit({ type: "forward", bytes: raw });
        return true;
      }

      // Rule 4: Not inside an escape sequence or paste.
      if (b === ESC_BYTE) {
        flushForward();
        this.#escBuf.push(ESC_BYTE);
        return true;
      }

      if (!ctx.panelFocus) {
        // Plain byte in CLI focus (including split multi-byte UTF-8): verbatim!
        pendingForward.push(b);
        return true;
      }

      // Panel focus single-byte keys.
      if (b === 0x09) {
        emit({ type: "tab", shift: false });
      } else if (b === 0x0d || b === 0x0a) {
        emit({ type: "enter" });
      } else if (b === 0x7f || b === 0x08) {
        emit({ type: "backspace" });
      } else if (b >= 0x20 && b <= 0x7e) {
        emit({ type: "char", char: String.fromCharCode(b) });
      }
      // Stray control/non-ASCII bytes in panel focus are consumed silently.
      return true;
    };

    for (let i = 0; i < chunk.length; i += 1) {
      if (!processByte(chunk[i]!)) break;
    }
    flushForward();
    return events;
  }
}
