const ESC = "\x1b";
const DEC_MODES = [
  2026,
  1,
  9,
  1000,
  1002,
  1003,
  1004,
  1005,
  1006,
  1015,
  1016,
  2004,
  47,
  1047,
  1049,
];
const ALTERNATE_MODES = new Set([47, 1047, 1049]);
const MOUSE_TRACKING_MODES = [9, 1000, 1002, 1003] as const;
const MOUSE_ENCODING_MODES = new Set([1005, 1006, 1015, 1016]);
const ALL_MOUSE_MODES = new Set([9, 1000, 1002, 1003, 1005, 1006, 1015, 1016]);

export type MouseTrackingMode = (typeof MOUSE_TRACKING_MODES)[number];
export type MouseEncoding = "x10" | "utf8" | "sgr" | "urxvt" | "sgr-pixel";

export const H2A_OUTER_MOUSE_ENABLE = `${ESC}[?1000h${ESC}[?1006h`;
export const H2A_OUTER_MOUSE_RESET = `${ESC}[?1006l${ESC}[?1003l${ESC}[?1002l${ESC}[?1000l`;

/** State changed by relayed VT output, relative to a normal shell terminal.
 * Never uses RIS: only outstanding application changes are undone. Control
 * strings are skipped, CSI storage is bounded, and parsing survives any split.
 */
export class TerminalModeTracker {
  readonly #enabled = new Set<number>();
  readonly #encodingOrder: number[] = [];
  #cursorHidden = false;
  #keypad = false;
  #modifyOtherKeys = 0;
  // Kitty stacks belong to the main/alternate screen, independently.
  #mainKeyboard = [0];
  #alternateKeyboard = [0];
  #state: "text" | "escape" | "csi" | "string" | "string-escape" = "text";
  #osc = false;
  #csi = "";
  #filterPending = "";
  #filterStringState: "none" | "osc" | "other" = "none";
  #filterEscInString = false;
  #outerMotionMode: 1002 | 1003 | null = null;

  get #alternate(): boolean {
    return [...ALTERNATE_MODES].some((mode) => this.#enabled.has(mode));
  }

  /** True when the child itself enabled mouse reporting (9/1000/1002/1003). */
  isMouseTrackingEnabled(): boolean {
    return MOUSE_TRACKING_MODES.some((mode) => this.#enabled.has(mode));
  }

  /** Active child mouse reporting mode (highest enabled among 9/1000/1002/1003). */
  mouseTrackingMode(): MouseTrackingMode | null {
    if (this.#enabled.has(1003)) return 1003;
    if (this.#enabled.has(1002)) return 1002;
    if (this.#enabled.has(1000)) return 1000;
    if (this.#enabled.has(9)) return 9;
    return null;
  }

  /** Active child mouse encoding (1005/1006/1015/1016, or legacy x10). */
  mouseEncoding(): MouseEncoding {
    const latest = this.#encodingOrder[this.#encodingOrder.length - 1];
    if (latest === 1016) return "sgr-pixel";
    if (latest === 1006) return "sgr";
    if (latest === 1015) return "urxvt";
    if (latest === 1005) return "utf8";
    return "x10";
  }

  /** True when the child enabled focus reporting (?1004h). */
  isFocusReportingEnabled(): boolean {
    return this.#enabled.has(1004);
  }

  /** True when the child enabled bracketed paste mode (DECSET 2004). */
  isBracketedPasteEnabled(): boolean {
    return this.#enabled.has(2004);
  }

  /** True when the child pushed non-zero kitty keyboard flags on the active screen. */
  isKittyKeyboardEnabled(): boolean {
    const stack = this.#alternate ? this.#alternateKeyboard : this.#mainKeyboard;
    return (stack[stack.length - 1] ?? 0) !== 0;
  }

  /** True when the child enabled application cursor keys (DECCKM, DECSET 1). */
  isApplicationCursorKeysEnabled(): boolean {
    return this.#enabled.has(1);
  }

  feed(data: string): void {
    for (const c of data) {
      if (c === "\x18" || c === "\x1a") { this.#state = "text"; continue; }
      if (this.#state === "string" || this.#state === "string-escape") {
        if (c === "\x9c" || (this.#osc && c === "\x07") ||
          (this.#state === "string-escape" && c === "\\")) this.#state = "text";
        else this.#state = c === ESC ? "string-escape" : "string";
        continue;
      }
      if (c === ESC) { this.#state = "escape"; continue; }
      if (c === "\x9b") { this.#state = "csi"; this.#csi = ""; continue; }
      if (c === "\x9d" || c === "\x90" || c === "\x9e" || c === "\x9f") {
        this.#state = "string"; this.#osc = c === "\x9d"; continue;
      }
      if (this.#state === "escape") {
        this.#state = "text";
        if (c === "[") { this.#state = "csi"; this.#csi = ""; }
        else if ("]PX^_".includes(c)) { this.#state = "string"; this.#osc = c === "]"; }
        else if (c === "=" || c === ">") this.#keypad = c === "=";
        else if (c === "c") {
          this.#enabled.clear();
          this.#encodingOrder.length = 0;
          this.#cursorHidden = false;
          this.#keypad = false;
          this.#modifyOtherKeys = 0;
          this.#mainKeyboard = [0];
          this.#alternateKeyboard = [0];
        }
      } else if (this.#state === "csi") {
        if (c >= "@" && c <= "~") {
          this.#apply(this.#csi, c);
          this.#state = "text";
        } else if (c >= " " && c <= "?" && this.#csi.length < 128) this.#csi += c;
        else if (c >= " ") this.#state = "text";
      }
    }
  }

  /**
   * Feed child output into the tracker while consuming child DECSET/DECRST
   * mouse modes (9/1000/1002/1003/1005/1006/1015/1016) from the relayed stream
   * so h2a retains outer ?1000h ?1006h ownership for the whole attach.
   * Motion modes 1002/1003 are forwarded only while the child requests them.
   */
  feedAndFilterOuterMouse(data: string): string {
    const input = this.#filterPending + data;
    this.#filterPending = "";
    let out = "";
    let i = 0;
    while (i < input.length) {
      if (this.#filterStringState !== "none") {
        const start = i;
        while (i < input.length) {
          const c = input[i]!;
          i += 1;
          if (c === "\x18" || c === "\x1a" || c === "\x9c" || (this.#filterStringState === "osc" && c === "\x07")) {
            this.#filterStringState = "none";
            this.#filterEscInString = false;
            break;
          }
          if (this.#filterEscInString) {
            this.#filterEscInString = false;
            if (c === "\\") {
              this.#filterStringState = "none";
              break;
            }
          }
          if (c === ESC) this.#filterEscInString = true;
        }
        const seg = input.slice(start, i);
        this.feed(seg);
        out += seg;
        continue;
      }

      const c = input[i]!;
      if (c === ESC || c === "\x9b") {
        const isC1 = c === "\x9b";
        if (!isC1 && i + 1 >= input.length) {
          this.#filterPending = input.slice(i);
          break;
        }
        const next = isC1 ? "[" : input[i + 1]!;
        if (next === "[") {
          const bodyStart = isC1 ? i + 1 : i + 2;
          let j = bodyStart;
          while (j < input.length && input.charCodeAt(j) >= 0x30 && input.charCodeAt(j) <= 0x3f) {
            j += 1;
          }
          const params = input.slice(bodyStart, j);
          const intStart = j;
          while (j < input.length && input.charCodeAt(j) >= 0x20 && input.charCodeAt(j) <= 0x2f) {
            j += 1;
          }
          const intermediates = input.slice(intStart, j);
          if (j >= input.length) {
            if (input.length - i <= 128) {
              this.#filterPending = input.slice(i);
              break;
            }
            const seg = input.slice(i);
            this.feed(seg);
            out += seg;
            break;
          }
          if (input.charCodeAt(j) >= 0x40 && input.charCodeAt(j) <= 0x7e) {
            const final = input[j]!;
            const rawSeq = input.slice(i, j + 1);
            this.feed(rawSeq);
            out += this.#filterCsiForOuterMouse(params, intermediates, final, rawSeq);
            i = j + 1;
            continue;
          }
          const seg = input.slice(i, bodyStart);
          this.feed(seg);
          out += seg;
          i = bodyStart;
          continue;
        }
        if ("]PX^_".includes(next)) {
          const seg = input.slice(i, i + 2);
          this.feed(seg);
          out += seg;
          this.#filterStringState = next === "]" ? "osc" : "other";
          this.#filterEscInString = false;
          i += 2;
          continue;
        }
        const seg = input.slice(i, i + 2);
        this.feed(seg);
        if (next === "c") {
          this.#outerMotionMode = null;
          out += `${seg}${H2A_OUTER_MOUSE_ENABLE}`;
        } else {
          out += seg;
        }
        i += 2;
        continue;
      }

      if (c === "\x9d" || c === "\x90" || c === "\x9e" || c === "\x9f") {
        this.feed(c);
        out += c;
        this.#filterStringState = c === "\x9d" ? "osc" : "other";
        this.#filterEscInString = false;
        i += 1;
        continue;
      }

      let j = i + 1;
      while (j < input.length) {
        const ch = input[j]!;
        if (ch === ESC || ch === "\x9b" || ch === "\x9d" || ch === "\x90" || ch === "\x9e" || ch === "\x9f") {
          break;
        }
        j += 1;
      }
      const seg = input.slice(i, j);
      this.feed(seg);
      out += seg;
      i = j;
    }
    return out;
  }

  flushMouseFilterPending(): string {
    if (this.#filterPending.length === 0) return "";
    const pending = this.#filterPending;
    this.#filterPending = "";
    this.feed(pending);
    return pending;
  }

  #filterCsiForOuterMouse(
    params: string,
    intermediates: string,
    final: string,
    rawSeq: string,
  ): string {
    if (intermediates === "!" && final === "p" && params === "") {
      this.#outerMotionMode = null;
      return `${rawSeq}${H2A_OUTER_MOUSE_ENABLE}`;
    }
    if (
      intermediates !== "" ||
      (final !== "h" && final !== "l") ||
      !/^\?\d+(;\d+)*$/.test(params)
    ) {
      return rawSeq;
    }
    const modes = params.slice(1).split(";").map(Number);
    let hasMouse = false;
    const nonMouse: number[] = [];
    for (const mode of modes) {
      if (ALL_MOUSE_MODES.has(mode)) hasMouse = true;
      else nonMouse.push(mode);
    }
    if (!hasMouse) return rawSeq;

    let out = nonMouse.length > 0 ? `${ESC}[?${nonMouse.join(";")}${final}` : "";
    const desiredMotion: 1002 | 1003 | null = this.#enabled.has(1003)
      ? 1003
      : this.#enabled.has(1002)
        ? 1002
        : null;
    if (desiredMotion !== this.#outerMotionMode) {
      if (desiredMotion === 1003) {
        out += `${this.#outerMotionMode === 1002 ? `${ESC}[?1002l` : ""}${ESC}[?1003h`;
      } else if (desiredMotion === 1002) {
        out += `${this.#outerMotionMode === 1003 ? `${ESC}[?1003l` : ""}${ESC}[?1002h`;
      } else if (this.#outerMotionMode !== null) {
        out += `${ESC}[?${this.#outerMotionMode}l${H2A_OUTER_MOUSE_ENABLE}`;
      }
      this.#outerMotionMode = desiredMotion;
    }
    return out;
  }

  #apply(params: string, final: string): void {
    if ((final === "h" || final === "l") && /^\?\d+(;\d+)*$/.test(params)) {
      const wasAlternate = this.#alternate;
      for (const mode of params.slice(1).split(";").map(Number)) {
        if (mode === 25) this.#cursorHidden = final === "l";
        else if (DEC_MODES.includes(mode)) {
          if (final === "h") {
            this.#enabled.add(mode);
            if (MOUSE_ENCODING_MODES.has(mode)) {
              const existingIdx = this.#encodingOrder.indexOf(mode);
              if (existingIdx >= 0) this.#encodingOrder.splice(existingIdx, 1);
              this.#encodingOrder.push(mode);
            }
          } else {
            this.#enabled.delete(mode);
            if (MOUSE_ENCODING_MODES.has(mode)) {
              const existingIdx = this.#encodingOrder.indexOf(mode);
              if (existingIdx >= 0) this.#encodingOrder.splice(existingIdx, 1);
            }
          }
        }
      }
      if (wasAlternate !== this.#alternate) this.#alternateKeyboard = [0];
    } else if (final === "m" && /^>4;(0|1|2)$/.test(params)) {
      this.#modifyOtherKeys = Number(params.slice(3));
    } else if (final === "u" && /^[><=]\d*(;[123])?$/.test(params)) {
      const stack = this.#alternate ? this.#alternateKeyboard : this.#mainKeyboard;
      const [value, operation] = params.slice(1).split(";");
      const n = Number(value || (params[0] === "<" ? 1 : 0));
      if (!Number.isSafeInteger(n) || n < 0) return;
      if (params[0] === "<") stack.splice(Math.max(1, stack.length - n));
      else if (params[0] === ">") {
        // Kitty terminals retain at most 16 saved entries.
        if (stack.length >= 17) stack.splice(1, 1);
        stack.push(n);
      } else {
        const previous = stack[stack.length - 1]!;
        stack[stack.length - 1] = operation === "2" ? previous | n
          : operation === "3" ? previous & ~n : n;
      }
    }
  }

  #keyboardReset(stack: number[]): string {
    return (stack.length > 1 ? `${ESC}[<${stack.length - 1}u` : "") +
      (stack[0] !== 0 ? `${ESC}[=0u` : "");
  }

  #keyboardRestore(stack: number[]): string {
    return (stack[0] !== 0 ? `${ESC}[=${stack[0]}u` : "") +
      stack.slice(1).map((flags) => `${ESC}[>${flags}u`).join("");
  }

  resetSequence(opts?: { excludeMouse?: boolean }): string {
    const excludeMouse = opts?.excludeMouse === true;
    // End synchronized output first. Pop kitty BEFORE leaving its screen.
    let result = this.#state !== "text" ? "\x18" : "";
    result += this.#enabled.has(2026) ? `${ESC}[?2026l` : "";
    result += this.#keyboardReset(this.#alternate ? this.#alternateKeyboard : this.#mainKeyboard);
    for (const mode of DEC_MODES) {
      if (mode === 2026) continue;
      if (excludeMouse && ALL_MOUSE_MODES.has(mode)) continue;
      if (this.#enabled.has(mode)) result += `${ESC}[?${mode}l`;
    }
    if (this.#alternate) result += this.#keyboardReset(this.#mainKeyboard);
    if (this.#cursorHidden) result += `${ESC}[?25h`;
    if (this.#keypad) result += `${ESC}>`;
    if (this.#modifyOtherKeys !== 0) result += `${ESC}[>4;0m`;
    return result;
  }

  restoreSequence(): string {
    let result = this.#keyboardRestore(this.#mainKeyboard);
    for (const mode of DEC_MODES) {
      if (this.#enabled.has(mode)) result += `${ESC}[?${mode}h`;
    }
    if (this.#alternate) result += this.#keyboardRestore(this.#alternateKeyboard);
    if (this.#cursorHidden) result += `${ESC}[?25l`;
    if (this.#keypad) result += `${ESC}=`;
    if (this.#modifyOtherKeys !== 0) result += `${ESC}[>4;${this.#modifyOtherKeys}m`;
    return result;
  }

  /** Parser prefix at an evicted chunk boundary, including partial CSI.
   * Control-string contents are intentionally discarded, retaining its kind.
   */
  replayPrefix(): string {
    if (this.#state === "escape") return ESC;
    if (this.#state === "csi") return `${ESC}[${this.#csi}`;
    if (this.#state === "string" || this.#state === "string-escape") {
      return `${ESC}${this.#osc ? "]" : "P"}${this.#state === "string-escape" ? ESC : ""}`;
    }
    return "";
  }
}
