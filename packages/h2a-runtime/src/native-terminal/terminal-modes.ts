const ESC = "\x1b";
const DEC_MODES = [2026, 1, 1000, 1002, 1003, 1004, 1006, 1015, 2004, 47, 1047, 1049];
const ALTERNATE_MODES = new Set([47, 1047, 1049]);

/** State changed by relayed VT output, relative to a normal shell terminal.
 * Never uses RIS: only outstanding application changes are undone. Control
 * strings are skipped, CSI storage is bounded, and parsing survives any split.
 */
export class TerminalModeTracker {
  readonly #enabled = new Set<number>();
  #cursorHidden = false;
  #keypad = false;
  #modifyOtherKeys = 0;
  // Kitty stacks belong to the main/alternate screen, independently.
  #mainKeyboard = [0];
  #alternateKeyboard = [0];
  #state: "text" | "escape" | "csi" | "string" | "string-escape" = "text";
  #osc = false;
  #csi = "";

  get #alternate(): boolean {
    return [...ALTERNATE_MODES].some((mode) => this.#enabled.has(mode));
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

  #apply(params: string, final: string): void {
    if ((final === "h" || final === "l") && /^\?\d+(;\d+)*$/.test(params)) {
      const wasAlternate = this.#alternate;
      for (const mode of params.slice(1).split(";").map(Number)) {
        if (mode === 25) this.#cursorHidden = final === "l";
        else if (DEC_MODES.includes(mode)) {
          if (final === "h") this.#enabled.add(mode);
          else this.#enabled.delete(mode);
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

  resetSequence(): string {
    // End synchronized output first. Pop kitty BEFORE leaving its screen.
    let result = this.#state !== "text" ? "\x18" : "";
    result += this.#enabled.has(2026) ? `${ESC}[?2026l` : "";
    result += this.#keyboardReset(this.#alternate ? this.#alternateKeyboard : this.#mainKeyboard);
    for (const mode of DEC_MODES) {
      if (mode !== 2026 && this.#enabled.has(mode)) result += `${ESC}[?${mode}l`;
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
