/**
 * Replay filter for the station switch (S1, r2 §2.2 and annex D; INJ D10 (b)).
 *
 * A switch repaints the target session from its retained output. That stream
 * still carries the terminal queries the CLI emitted earlier: replaying them
 * makes the outer terminal answer again, and the answer would reach the CLI as
 * keystrokes. It also carries one-shot side effects (bell, clipboard write,
 * desktop notifications) that must not fire a second time.
 *
 * This module holds the single family table shared with INJ D10 and a
 * streaming filter that removes exactly those families. It is applied to
 * catch-up bytes only: live output is never filtered.
 */
import { NATIVE_TERMINAL_RESET_MARKER } from "./reset-relay.js";

export type ReplayFilterFamilyKind = "query" | "side-effect";

export type ReplayFilterFamily = Readonly<{
  id: string;
  /** Human-readable byte form, as written in the specification table. */
  form: string;
  kind: ReplayFilterFamilyKind;
}>;

/** r2 annex D minimum table. Order is part of the pinned contract. */
export const REPLAY_FILTER_FAMILIES: readonly ReplayFilterFamily[] = Object.freeze([
  { id: "dsr-cpr", form: "CSI 6 n", kind: "query" },
  { id: "dsr-decxcpr", form: "CSI ? 6 n", kind: "query" },
  { id: "dsr-status", form: "CSI 5 n", kind: "query" },
  { id: "da1", form: "CSI c", kind: "query" },
  { id: "da2", form: "CSI > c", kind: "query" },
  { id: "da3", form: "CSI = c", kind: "query" },
  { id: "xtversion", form: "CSI > q", kind: "query" },
  { id: "kitty-keyboard-query", form: "CSI ? u", kind: "query" },
  { id: "xtwinops-14", form: "CSI 14 t", kind: "query" },
  { id: "xtwinops-16", form: "CSI 16 t", kind: "query" },
  { id: "xtwinops-18", form: "CSI 18 t", kind: "query" },
  { id: "xtwinops-21", form: "CSI 21 t", kind: "query" },
  { id: "decrqm", form: "CSI … $ p", kind: "query" },
  { id: "decrqss", form: "DCS $ q … ST", kind: "query" },
  { id: "xtgettcap", form: "DCS + q … ST", kind: "query" },
  { id: "osc-4-query", form: "OSC 4 ; … ; ? ST", kind: "query" },
  { id: "osc-10-query", form: "OSC 10 ; ? ST", kind: "query" },
  { id: "osc-11-query", form: "OSC 11 ; ? ST", kind: "query" },
  { id: "osc-12-query", form: "OSC 12 ; ? ST", kind: "query" },
  { id: "enq", form: "ENQ", kind: "query" },
  { id: "bel", form: "BEL", kind: "side-effect" },
  // Clipboard read and write share one family: neither may be replayed.
  { id: "osc-52", form: "OSC 52 ; … ST", kind: "side-effect" },
  { id: "osc-9", form: "OSC 9 ; … ST", kind: "side-effect" },
  { id: "osc-99", form: "OSC 99 ; … ST", kind: "side-effect" },
  { id: "osc-777", form: "OSC 777 ; … ST", kind: "side-effect" },
] as const);

export type ReplayFilterStats = { queries: number; sideEffects: number };

const ESC = "\x1b";
const BEL = "\x07";
const ENQ = "\x05";
const C1_CSI = "\x9b";
const C1_OSC = "\x9d";
const C1_DCS = "\x90";
const C1_ST = "\x9c";
const CSI_MAX_BODY = 128;
/** Undecided control strings are short; longer ones are never queries. */
const STRING_DECISION_MAX = 1_024;
/** Bound on the bytes kept to hand an unfinished dropped string back at flush. */
const DROPPED_RAW_MAX = 64 * 1_024;
const XTWINOPS_REPORTS = new Set(["14", "16", "18", "21"]);
const SIDE_EFFECT_OSC = new Set(["52", "9", "99", "777"]);
const COLOR_QUERY_OSC = new Set(["4", "10", "11", "12"]);
/** `777;h2a-reset`: the native wrapper marker, not a desktop notification. */
const RESET_MARKER_BODY = NATIVE_TERMINAL_RESET_MARKER.slice(2, -1);

type State =
  | "ground"
  | "escape"
  | "csi"
  | "osc-undecided"
  | "dcs-undecided"
  | "string-pass"
  | "string-drop";

function csiIsQuery(params: string, intermediates: string, final: string): boolean {
  if (final === "n") return intermediates === "" && (params === "6" || params === "?6" || params === "5");
  if (final === "c") {
    return intermediates === "" && ["", "0", ">", ">0", "=", "=0"].includes(params);
  }
  if (final === "q") return intermediates === "" && (params === ">" || params === ">0");
  if (final === "u") return intermediates === "" && params === "?";
  if (final === "t") {
    return intermediates === "" && XTWINOPS_REPORTS.has(params.split(";", 1)[0] ?? "");
  }
  if (final === "p") return intermediates === "$";
  return false;
}

function oscColorQuery(code: string, body: string): boolean {
  const parts = body.split(";").slice(1);
  if (code === "4") {
    // OSC 4 ; index ; spec [; index ; spec …]
    for (let i = 1; i < parts.length; i += 2) if (parts[i] === "?") return true;
    return false;
  }
  return parts.some((part) => part === "?");
}

/**
 * Streaming filter. Feed the catch-up bytes in order with `filter()`, then
 * call `flush()` once: an unfinished sequence is handed back unchanged so the
 * live stream that follows can complete it.
 */
export class ReplayFilter {
  #state: State = "ground";
  /** Raw bytes of the sequence being read, introducer included. */
  #raw = "";
  /** Body of the control string being read (without introducer). */
  #body = "";
  /** True when the pending control string is an OSC (BEL terminates it). */
  #oscString = false;
  /** True when the previous character of a string was ESC (possible ST). */
  #stringEscape = false;
  #droppedRaw: string | undefined;
  readonly #stats: ReplayFilterStats = { queries: 0, sideEffects: 0 };

  stats(): ReplayFilterStats {
    return { ...this.#stats };
  }

  filter(data: string): string {
    let out = "";
    for (const c of data) out += this.#step(c);
    return out;
  }

  flush(): string {
    const pending =
      this.#state === "string-drop"
        ? (this.#droppedRaw ?? "")
        : this.#state === "string-pass"
          ? (this.#stringEscape ? ESC : "")
          : this.#raw;
    this.#reset();
    return pending;
  }

  #reset(): void {
    this.#state = "ground";
    this.#raw = "";
    this.#body = "";
    this.#oscString = false;
    this.#stringEscape = false;
    this.#droppedRaw = undefined;
  }

  #count(kind: ReplayFilterFamilyKind): void {
    if (kind === "query") this.#stats.queries += 1;
    else this.#stats.sideEffects += 1;
  }

  #step(c: string): string {
    switch (this.#state) {
      case "ground":
        return this.#ground(c);
      case "escape":
        return this.#escape(c);
      case "csi":
        return this.#csi(c);
      case "osc-undecided":
        return this.#oscUndecided(c);
      case "dcs-undecided":
        return this.#dcsUndecided(c);
      case "string-pass":
        return this.#stringPass(c);
      case "string-drop":
        return this.#stringDrop(c);
    }
  }

  #ground(c: string): string {
    if (c === ENQ) {
      this.#count("query");
      return "";
    }
    if (c === BEL) {
      this.#count("side-effect");
      return "";
    }
    if (c === ESC) {
      this.#state = "escape";
      this.#raw = c;
      return "";
    }
    if (c === C1_CSI) {
      this.#state = "csi";
      this.#raw = c;
      this.#body = "";
      return "";
    }
    if (c === C1_OSC) return this.#beginOsc(c);
    if (c === C1_DCS) return this.#beginDcs(c);
    if (c === "\x98" || c === "\x9e" || c === "\x9f") {
      this.#state = "string-pass";
      this.#oscString = false;
      this.#stringEscape = false;
      return c;
    }
    return c;
  }

  #beginOsc(introducer: string): string {
    this.#state = "osc-undecided";
    this.#raw = introducer;
    this.#body = "";
    this.#oscString = true;
    this.#stringEscape = false;
    return "";
  }

  #beginDcs(introducer: string): string {
    this.#state = "dcs-undecided";
    this.#raw = introducer;
    this.#body = "";
    this.#oscString = false;
    this.#stringEscape = false;
    return "";
  }

  #escape(c: string): string {
    if (c === "[") {
      this.#state = "csi";
      this.#raw += c;
      this.#body = "";
      return "";
    }
    if (c === "]") return this.#beginOsc(this.#raw + c);
    if (c === "P") return this.#beginDcs(this.#raw + c);
    if (c === "X" || c === "^" || c === "_") {
      const head = this.#raw + c;
      this.#reset();
      this.#state = "string-pass";
      return head;
    }
    if (c === ESC) {
      // A second ESC restarts the escape; the first one is plain output.
      return ESC;
    }
    const head = this.#raw;
    this.#reset();
    // Two-character escape (ESC 7, ESC c, ESC ( …): never a query here.
    return head + this.#ground(c);
  }

  #csi(c: string): string {
    if (c >= "@" && c <= "~") {
      const raw = this.#raw + c;
      const body = this.#body;
      this.#reset();
      let split = 0;
      while (split < body.length && body[split]! >= "0" && body[split]! <= "?") split += 1;
      if (csiIsQuery(body.slice(0, split), body.slice(split), c)) {
        this.#count("query");
        return "";
      }
      return raw;
    }
    if (c >= " " && c <= "?" && this.#body.length < CSI_MAX_BODY) {
      this.#raw += c;
      this.#body += c;
      return "";
    }
    // Malformed or oversized: give the bytes back untouched.
    const raw = this.#raw;
    this.#reset();
    return raw + this.#ground(c);
  }

  /** Terminator of the pending control string, or undefined while inside it. */
  #stringEnd(c: string): "end" | "aborted" | undefined {
    if (c === "\x18" || c === "\x1a") return "end";
    if (c === C1_ST) return "end";
    if (this.#oscString && c === BEL) return "end";
    if (this.#stringEscape) {
      this.#stringEscape = false;
      return c === "\\" ? "end" : "aborted";
    }
    if (c === ESC) this.#stringEscape = true;
    return undefined;
  }

  #oscUndecided(c: string): string {
    const end = this.#stringEnd(c);
    if (end === "aborted") {
      const raw = this.#raw;
      this.#reset();
      this.#state = "escape";
      this.#raw = ESC;
      return raw.slice(0, -1) + this.#escape(c);
    }
    this.#raw += c;
    if (end === undefined) {
      if (!this.#stringEscape) this.#body += c;
      const code = this.#oscCode();
      if (code !== undefined) {
        if (SIDE_EFFECT_OSC.has(code)) {
          const markerPrefix =
            code === "777" && RESET_MARKER_BODY.startsWith(this.#body);
          if (!markerPrefix) return this.#toDrop("side-effect");
        } else if (!COLOR_QUERY_OSC.has(code)) {
          return this.#toPass();
        }
      } else if (!/^\d*$/.test(this.#body)) {
        return this.#toPass();
      }
      if (this.#raw.length > STRING_DECISION_MAX) return this.#toPass();
      return "";
    }
    // Terminated before any decision was forced.
    const raw = this.#raw;
    const body = this.#body;
    const code = body.split(";", 1)[0] ?? "";
    this.#reset();
    if (SIDE_EFFECT_OSC.has(code)) {
      if (raw === NATIVE_TERMINAL_RESET_MARKER) return raw;
      this.#count("side-effect");
      return "";
    }
    if (COLOR_QUERY_OSC.has(code) && oscColorQuery(code, body)) {
      this.#count("query");
      return "";
    }
    return raw;
  }

  /** OSC numeric code once its `;` separator has been read. */
  #oscCode(): string | undefined {
    const separator = this.#body.indexOf(";");
    if (separator < 0) return undefined;
    const code = this.#body.slice(0, separator);
    return /^\d+$/.test(code) ? code : "";
  }

  #dcsUndecided(c: string): string {
    const end = this.#stringEnd(c);
    if (end === "aborted") {
      const raw = this.#raw;
      this.#reset();
      this.#state = "escape";
      this.#raw = ESC;
      return raw.slice(0, -1) + this.#escape(c);
    }
    this.#raw += c;
    if (end === "end") {
      const raw = this.#raw;
      this.#reset();
      return raw;
    }
    if (this.#stringEscape) return "";
    this.#body += c;
    if (c >= "@" && c <= "~") {
      // DCS params intermediates final: `$ q` and `+ q` are requests.
      const header = this.#body.slice(0, -1).replace(/^[0-?]*/, "");
      if (c === "q" && (header === "$" || header === "+")) return this.#toDrop("query");
      return this.#toPass();
    }
    if (c < " " || c > "?" || this.#body.length > CSI_MAX_BODY) return this.#toPass();
    return "";
  }

  #toPass(): string {
    const osc = this.#oscString;
    const escape = this.#stringEscape;
    // A trailing ESC is held back: it may open the string terminator.
    const raw = escape ? this.#raw.slice(0, -1) : this.#raw;
    this.#reset();
    this.#state = "string-pass";
    this.#oscString = osc;
    this.#stringEscape = escape;
    return raw;
  }

  #toDrop(kind: ReplayFilterFamilyKind): string {
    const raw = this.#raw;
    const osc = this.#oscString;
    const escape = this.#stringEscape;
    this.#reset();
    this.#count(kind);
    this.#state = "string-drop";
    this.#oscString = osc;
    this.#stringEscape = escape;
    this.#droppedRaw = raw;
    return "";
  }

  #stringPass(c: string): string {
    if (this.#stringEscape) {
      this.#stringEscape = false;
      if (c === "\\") {
        this.#reset();
        return ESC + c;
      }
      // The held ESC opens a new sequence instead of the string terminator.
      this.#reset();
      this.#state = "escape";
      this.#raw = ESC;
      return this.#escape(c);
    }
    if (c === ESC) {
      this.#stringEscape = true;
      return "";
    }
    if (c === "\x18" || c === "\x1a" || c === C1_ST || (this.#oscString && c === BEL)) {
      this.#reset();
      return c;
    }
    return c;
  }

  #stringDrop(c: string): string {
    const end = this.#stringEnd(c);
    if (end === "end") {
      this.#reset();
      return "";
    }
    if (end === "aborted") {
      this.#reset();
      this.#state = "escape";
      this.#raw = ESC;
      return this.#escape(c);
    }
    if (this.#droppedRaw !== undefined) {
      this.#droppedRaw =
        this.#droppedRaw.length < DROPPED_RAW_MAX ? this.#droppedRaw + c : undefined;
    }
    return "";
  }
}

/** One-shot helper for a complete catch-up buffer. */
export function filterReplay(data: string): {
  output: string;
  stats: ReplayFilterStats;
} {
  const filter = new ReplayFilter();
  const output = filter.filter(data) + filter.flush();
  return { output, stats: filter.stats() };
}
