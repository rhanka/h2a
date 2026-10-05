/** Native-only wrapper request. The host replaces it with selective VT resets. */
export const NATIVE_TERMINAL_RESET_MARKER = "\x1b]777;h2a-reset\x07";

export class TerminalResetRelay {
  #pending = "";

  constructor(
    readonly emit: (data: string) => void,
    readonly reset: () => string,
  ) {}

  feed(data: string): void {
    let remaining = this.#pending + data;
    this.#pending = "";
    for (;;) {
      const index = remaining.indexOf(NATIVE_TERMINAL_RESET_MARKER);
      if (index < 0) break;
      if (index > 0) this.emit(remaining.slice(0, index));
      const reset = this.reset();
      if (reset) this.emit(reset);
      remaining = remaining.slice(index + NATIVE_TERMINAL_RESET_MARKER.length);
    }
    let carry = Math.min(remaining.length, NATIVE_TERMINAL_RESET_MARKER.length - 1);
    while (carry > 0 && !NATIVE_TERMINAL_RESET_MARKER.startsWith(remaining.slice(-carry))) carry--;
    if (remaining.length > carry) this.emit(remaining.slice(0, remaining.length - carry));
    this.#pending = carry > 0 ? remaining.slice(-carry) : "";
  }

  flush(): void {
    if (this.#pending) this.emit(this.#pending);
    this.#pending = "";
  }
}
