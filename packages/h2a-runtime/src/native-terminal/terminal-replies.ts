/**
 * Lot L4-replies (D10) — terminal replies never reach the shell.
 *
 * Two directions, two different byte vocabularies:
 *
 * - OUTER → HOST (this module's classifier): the attach bridge must tell
 *   machine replies apart from human bytes. Replies travel to the host as
 *   TYPED units (correlation: query family + key, controller epoch,
 *   incarnation, application incarnation); human bytes keep the existing
 *   `write` path, verbatim and ordered. Anything that is not positively a
 *   reply is input (D10(c): on ambiguity, preserve human input).
 * - HOST → OUTER (query scanner + strip): the host records which queries the
 *   foreground app emitted so the final-write gate can revalidate the typed
 *   units; the bridge strips queries from gap repaints so history never
 *   re-issues them (D10(b)).
 *
 * Reply families (D10(a)): Primary/Secondary DA, XTVERSION, DECRPM, CPR +
 * DSR-status, DECRQSS, kitty-keyboard, OSC colour replies. Input, always:
 * focus events, bracketed paste (whole block, contents included), arrows,
 * keys, Alt-key sequences, lone ESC, plain text. A bare `CSI c` is the DA
 * QUERY (host→outer direction); only `CSI ?…c` is a reply. kitty key events
 * (`CSI unicode:alternate u`, no prefix) are key presses — input; only the
 * `?`-prefixed form is the query reply.
 */
const ESC = "\x1b";
const BEL = "\x07";
const ST7 = `${ESC}\\`;
const ST8 = "\x9c";

import type {
  NativeTerminalReplyFamily,
  NativeTerminalReplyUnit,
} from "./protocol.js";

export const TERMINAL_REPLY_QUERY_WINDOW_MS = 5_000;
export const TERMINAL_REPLY_MAX_OUTSTANDING = 64;
/** Longest partial sequence the classifier/scanner holds (replies are short). */
const TERMINAL_REPLY_MAX_HELD = 1_024;

export type TerminalReplyFamily = NativeTerminalReplyFamily;

/** Classifier-local alias for the protocol's typed reply unit. */
export type TerminalReplyUnit = NativeTerminalReplyUnit;

export type TerminalReplyQuery = Readonly<{
  family: TerminalReplyFamily;
  key: string;
}>;

export type TerminalReplyOutcome = Readonly<
  | { outcome: "applied" }
  | {
    outcome: "swallowed";
    reason:
      | "stale-epoch"
      | "stale-incarnation"
      | "stale-application"
      | "no-outstanding-query";
  }
>;

export type ClassifiedPart = Readonly<
  | { kind: "input"; text: string }
  | { kind: "reply"; family: TerminalReplyFamily; key: string; text: string }
>;

/** Correlation key for one outstanding query / one reply unit. */
export function replyQueryKey(query: Pick<TerminalReplyQuery, "family" | "key">): string {
  return `${query.family}:${query.key}`;
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

/**
 * Incremental, chunk-safe classifier for the outer→host direction.
 * Complete reply sequences become typed replies; everything else — and any
 * trailing partial that cannot complete yet — stays human input, except a
 * partial CSI/DCS/OSC introducer which is held for the next chunk (a bare
 * trailing ESC is forwarded immediately: it is Alt-key or Esc-to-cancel,
 * never held). `flush` emits held bytes as input (detach/terminate path).
 */
export class TerminalReplyClassifier {
  #tail = "";
  #inPaste = false;
  #pasteStart: number | undefined;

  feed(chunk: string): ClassifiedPart[] {
    const parts: ClassifiedPart[] = [];
    let s = this.#tail + chunk;
    this.#tail = "";
    for (;;) {
      if (this.#inPaste) {
        const end = s.indexOf(`${ESC}[201~`);
        if (end < 0) {
          // Keep a carry so a split closer is still recognised; the rest is
          // paste content — input, emitted now, never classified as replies.
          const keep = Math.min(s.length, 5);
          if (s.length > keep) {
            parts.push({ kind: "input", text: s.slice(0, s.length - keep) });
            s = s.slice(s.length - keep);
          }
          this.#tail = s;
          return parts;
        }
        parts.push({ kind: "input", text: s.slice(0, end + 6) });
        s = s.slice(end + 6);
        this.#inPaste = false;
        // One paste, one input part: merge the opener emitted above with the
        // content and closer whenever the whole block arrived in one feed.
        if (this.#pasteStart !== undefined) {
          const merged = parts
            .slice(this.#pasteStart)
            .map((p) => p.text)
            .join("");
          parts.splice(this.#pasteStart);
          parts.push({ kind: "input", text: merged });
          this.#pasteStart = undefined;
        }
        continue;
      }
      const esc = s.indexOf(ESC);
      if (esc < 0) {
        if (s.length > 0) parts.push({ kind: "input", text: s });
        return parts;
      }
      if (esc > 0) {
        parts.push({ kind: "input", text: s.slice(0, esc) });
        s = s.slice(esc);
      }
      // s starts with ESC here.
      if (s.length === 1) {
        // Trailing bare ESC: Alt-key prefix or Esc-to-cancel — input, now.
        parts.push({ kind: "input", text: s });
        return parts;
      }
      const introducer = s[1]!;
      if (introducer === "[") {
        const parsed = parseCsi(s.slice(2));
        if (parsed === null) {
          // Partial CSI: hold for the next chunk (bounded).
          if (s.length > TERMINAL_REPLY_MAX_HELD) {
            parts.push({ kind: "input", text: s });
            return parts;
          }
          this.#tail = s;
          return parts;
        }
        const { sequence, rest } = parsed;
        if (sequence === `${ESC}[200~`) {
          this.#inPaste = true;
          this.#pasteStart = parts.length;
          parts.push({ kind: "input", text: sequence });
          s = rest;
          continue;
        }
        const reply = classifyCsiReply(sequence);
        parts.push(
          reply === null
            ? { kind: "input", text: sequence }
            : { kind: "reply", family: reply.family, key: reply.key, text: sequence },
        );
        s = rest;
        continue;
      }
      if (introducer === "P") {
        const end = findDcsEnd(s);
        if (end < 0) {
          if (s.length > TERMINAL_REPLY_MAX_HELD) {
            parts.push({ kind: "input", text: s });
            return parts;
          }
          this.#tail = s;
          return parts;
        }
        const sequence = s.slice(0, end);
        const reply = classifyDcsReply(sequence);
        parts.push(
          reply === null
            ? { kind: "input", text: sequence }
            : { kind: "reply", family: reply.family, key: reply.key, text: sequence },
        );
        s = s.slice(end);
        continue;
      }
      if (introducer === "]") {
        const end = findOscEnd(s);
        if (end < 0) {
          if (s.length > TERMINAL_REPLY_MAX_HELD) {
            parts.push({ kind: "input", text: s });
            return parts;
          }
          this.#tail = s;
          return parts;
        }
        const sequence = s.slice(0, end);
        const reply = classifyOscReply(sequence);
        parts.push(
          reply === null
            ? { kind: "input", text: sequence }
            : { kind: "reply", family: reply.family, key: reply.key, text: sequence },
        );
        s = s.slice(end);
        continue;
      }
      // Any other ESC sequence (SS3, charset, RIS, lone Alt-letter…): input.
      parts.push({ kind: "input", text: s.slice(0, 2) });
      s = s.slice(2);
    }
  }

  flush(): ClassifiedPart[] {
    if (this.#tail.length === 0 && !this.#inPaste) return [];
    const text = this.#tail;
    this.#tail = "";
    this.#inPaste = false;
    this.#pasteStart = undefined;
    return text.length > 0 ? [{ kind: "input", text }] : [];
  }
}

type ParsedCsi = { sequence: string; rest: string } | null;

/** Parse one complete CSI at the start of `s` (without the `ESC[`); null when partial. */
function parseCsi(s: string): ParsedCsi {
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c >= "@" && c <= "~") {
      return { sequence: `${ESC}[${s.slice(0, i + 1)}`, rest: s.slice(i + 1) };
    }
    // Parameter bytes 0x30–0x3F, intermediates 0x20–0x2F; anything else ends it.
    if (!((c >= " " && c <= "?"))) return { sequence: `${ESC}[${s.slice(0, i + 1)}`, rest: s.slice(i + 1) };
    i++;
  }
  return null;
}

/**
 * End offset (exclusive) of a DCS starting at s[0] (`ESC P…`), -1 when
 * partial. A trailing bare ESC is partial, not a terminator: the reply unit
 * must carry complete bytes (the final `\` may still be in flight).
 */
function findDcsEnd(s: string): number {
  if (s.endsWith(ESC)) return -1;
  for (let i = 2; i < s.length; i++) {
    if (s[i] === "\x9c") return i + 1;
    if (s[i] === ESC && s[i + 1] === "\\") return i + 2;
  }
  return -1;
}

/**
 * End offset (exclusive) of an OSC starting at s[0] (`ESC ]…`), -1 when
 * partial. Same trailing-ESC rule as DCS: never split the terminator.
 */
function findOscEnd(s: string): number {
  if (s.endsWith(ESC)) return -1;
  for (let i = 2; i < s.length; i++) {
    const c = s[i]!;
    if (c === BEL || c === "\x9c") return i + 1;
    if (c === ESC && s[i + 1] === "\\") return i + 2;
  }
  return -1;
}

/**
 * Modes requested by a DECRQM query body (`?2026;1016$`, final stripped) or
 * answered by a DECRPM reply body (`?2026;1$`, final stripped). Null when the
 * body is not a well-formed mode query/answer.
 */
function decrpmModes(body: string): string[] | null {
  const match = /^\?([0-9]+(?:;[0-9]+)*)\$$/.exec(body);
  return match ? match[1]!.split(";") : null;
}

function classifyCsiReply(sequence: string): { family: TerminalReplyFamily; key: string } | null {
  const body = sequence.slice(2, -1);
  const final = sequence[sequence.length - 1]!;
  if (final === "c" && body.startsWith("?")) return { family: "da", key: "" };
  if (final === "c" && body.startsWith(">")) return { family: "da2", key: "" };
  if (final === "R") {
    const params = body.split(";");
    if (params.length === 2 && params.every((p) => p.length > 0 && [...p].every(isDigit))) {
      // CPR carries no correlation data (position varies): one outstanding
      // cursor query is consumed per answer, never matched by value.
      return { family: "cpr", key: "" };
    }
    return null;
  }
  if (final === "n" && body === "0") return { family: "dsr-status", key: "" };
  if (final === "y") {
    const modes = decrpmModes(body);
    if (modes !== null) return { family: "decrpm", key: modes[0]! };
    return null;
  }
  if (final === "u" && body.startsWith("?")) return { family: "kitty", key: "" };
  return null;
}

function classifyDcsReply(sequence: string): { family: TerminalReplyFamily; key: string } | null {
  let body = sequence.slice(2);
  if (body.endsWith(ST7)) body = body.slice(0, -2);
  else if (body.endsWith(ST8)) body = body.slice(0, -1);
  else return null;
  if (/^>\s*\|/.test(body)) return { family: "xtversion", key: "" };
  if (/^1\s*\$\s*r/.test(body)) return { family: "decrqss", key: "" };
  return null;
}

function classifyOscReply(sequence: string): { family: TerminalReplyFamily; key: string } | null {
  let body = sequence.slice(2);
  if (body.endsWith(BEL) || body.endsWith(ST8)) body = body.slice(0, -1);
  else if (body.endsWith(ST7)) body = body.slice(0, -2);
  else return null;
  // A query (`4;7;?`) is not a reply: the outer never queries, it answers.
  if (/^(4;[0-9]+|10|11);\?$/.test(body)) return null;
  const match = /^(4;[0-9]+|10|11);/.exec(body);
  return match ? { family: "osc", key: match[1]! } : null;
}

/**
 * Incremental scanner for the host→outer direction: which queries did the
 * foreground app emit? Chunk-safe via an internal carry (bounded). Markers
 * (`h2a-reset`) are NOT counted here: `TerminalResetRelay`'s `onMarker` hook
 * owns the application-incarnation bump (single owner, no double count —
 * both observe the same byte stream).
 */
export class TerminalQueryScanner {
  #carry = "";

  feed(data: string): TerminalReplyQuery[] {
    const s = this.#carry + data;
    this.#carry = "";
    const queries: TerminalReplyQuery[] = [];
    let i = 0;
    while (i < s.length) {
      if (s[i] !== ESC) {
        i++;
        continue;
      }
      const parsed = parseQueryAt(s, i);
      if (parsed === null) {
        // Partial tail: hold (bounded), emit nothing yet.
        const tail = s.slice(i);
        if (tail.length > TERMINAL_REPLY_MAX_HELD) {
          i = s.length;
          continue;
        }
        this.#carry = tail;
        break;
      }
      if (parsed.queries.length > 0) queries.push(...parsed.queries);
      i = parsed.next;
    }
    return queries;
  }
}

function parseQueryAt(s: string, at: number): { queries: TerminalReplyQuery[]; next: number } | null {
  const second = s[at + 1];
  if (second === undefined) return null;
  if (second === "[") {
    const parsed = parseCsi(s.slice(at + 2));
    if (parsed === null) return null;
    const body = parsed.sequence.slice(2, -1);
    const final = parsed.sequence[parsed.sequence.length - 1]!;
    const queries: TerminalReplyQuery[] = [];
    if (final === "c" && (body === "" || body === "0")) queries.push({ family: "da", key: "" });
    else if (final === "c" && (body === ">" || body === ">0")) queries.push({ family: "da2", key: "" });
    else if (final === "q" && body === ">") queries.push({ family: "xtversion", key: "" });
    else if (final === "p") {
      const modes = /^\?([0-9]+(?:;[0-9]+)*)\$$/.exec(body)?.[1]?.split(";");
      if (modes !== undefined) {
        for (const mode of modes) queries.push({ family: "decrpm", key: mode });
      }
    } else if (final === "n" && /^(?:\?6|[56]|0)$/.test(body)) {
      queries.push(body === "6" || body === "?6" ? { family: "cpr", key: "" } : { family: "dsr-status", key: "" });
    } else if (final === "u" && (body === "?" || body === ">")) queries.push({ family: "kitty", key: "" });
    return { queries, next: at + parsed.sequence.length };
  }
  if (second === "P") {
    const end = findDcsEnd(s.slice(at));
    if (end < 0) return null;
    const sequence = s.slice(at, at + end);
    const body = sequence.slice(2, sequence.endsWith(ST7) ? -2 : -1).trim();
    const queries: TerminalReplyQuery[] = [];
    if (/^\$\s*q/.test(body)) queries.push({ family: "decrqss", key: "" });
    return { queries, next: at + sequence.length };
  }
  if (second === "]") {
    const end = findOscEnd(s.slice(at));
    if (end < 0) return null;
    const sequence = s.slice(at, at + end);
    const terminator = sequence.endsWith(BEL) || sequence.endsWith(ST8) ? 1 : 2;
    const body = sequence.slice(2, sequence.length - terminator);
    const queries: TerminalReplyQuery[] = [];
    const osc = /^(4;[0-9]+|10|11);\?$/.exec(body.trim());
    if (osc) queries.push({ family: "osc", key: osc[1]! });
    return { queries, next: at + sequence.length };
  }
  // Any other ESC sequence: skip the introducer, keep scanning after it.
  return { queries: [], next: at + 2 };
}

/**
 * Lot L4-replies (D10(b)) — strip terminal QUERIES from repainted history so
 * a reattach never re-issues them (the outer would answer stale queries
 * straight into the new reader). Live output is never stripped — the bridge
 * applies this to gap repaints only. Replies, mode sets and text pass
 * through untouched.
 */
export function stripTerminalQueries(data: string): string {
  return data
    .replace(/\x1b\[[0]?c/g, "")
    .replace(/\x1b\[>0?c/g, "")
    .replace(/\x1b\[>q/g, "")
    .replace(/\x1b\[\?[0-9]+(;[0-9]+)*\$p/g, "")
    .replace(/\x1b\[(?:\?6|[56]|0)n/g, "")
    .replace(/\x1bP\$q.*?(?:\x1b\\|\x9c)/g, "")
    .replace(/\x1b\[\?u/g, "")
    .replace(/\x1b\[>u/g, "")
    .replace(/\x1b\]4;[0-9]+;\?(?:\x1b\\|\x07|\x9c)/g, "")
    .replace(/\x1b\]1[01];\?(?:\x1b\\|\x07|\x9c)/g, "");
}
