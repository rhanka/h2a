/**
 * Lot L4-replies (D10) RED — terminal replies never reach the shell.
 *
 * The attach bridge classifies outer-terminal bytes: machine replies travel
 * to the host as TYPED units (correlation revalidated at the final write),
 * human bytes keep the existing write path. The host applies a reply only
 * while its query is outstanding for the current controller epoch,
 * incarnation AND application incarnation — a reply accepted by the bridge
 * whose CLI exits before the write lands is swallowed with zero bytes.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-ignore Shared JS test isolation helper.
import { setupNativeTestEnvironment } from "../../../h2a/test/helpers/native-isolation.js";
setupNativeTestEnvironment(afterAll);
import type { PtyHandle, PtySpawner } from "../pty.js";
import { NativeTerminalHost } from "./host.js";
import { HOST_FAULT_COUNTERS, hostFaultCounters } from "./fault-counters.js";
import { NATIVE_TERMINAL_RESET_MARKER } from "./reset-relay.js";
import type { NativeTerminalControllerLease } from "./host.js";
import {
  TERMINAL_REPLY_QUERY_WINDOW_MS,
  TerminalQueryScanner,
  TerminalReplyClassifier,
  replyQueryKey,
  stripTerminalQueries,
  type TerminalReplyUnit,
} from "./terminal-replies.js";

const E = "\x1b";

class StubPty implements PtyHandle {
  static #nextPid = 62000;
  readonly pid = StubPty.#nextPid++;
  readonly pgid = this.pid;
  readonly cols = 80;
  readonly rows = 24;
  readonly #dataHandlers = new Set<(chunk: string) => void>();
  readonly #exitHandlers = new Set<(event: { exitCode: number; signal?: number }) => void>();
  readonly writes: string[] = [];
  write = vi.fn((data: string) => {
    this.writes.push(data);
  });
  readonly resize = vi.fn();
  readonly kill = vi.fn();

  onData(handler: (chunk: string) => void): { dispose(): void } {
    this.#dataHandlers.add(handler);
    return { dispose: () => this.#dataHandlers.delete(handler) };
  }

  onExit(handler: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.#exitHandlers.add(handler);
    return { dispose: () => this.#exitHandlers.delete(handler) };
  }

  emitData(chunk: string): void {
    for (const handler of [...this.#dataHandlers]) handler(chunk);
  }
}

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "h2a-replies-red-"));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(scratch, { recursive: true, force: true });
});

function stubHost(): { host: NativeTerminalHost; ptys: Map<string, StubPty> } {
  const ptys = new Map<string, StubPty>();
  const spawner: PtySpawner = (options) => {
    const pty = new StubPty();
    ptys.set(options.command, pty);
    return pty;
  };
  const host = new NativeTerminalHost({
    generation: "g",
    replayBytesPerSession: 4096,
    registryPath: join(scratch, "r.json"),
    spawner,
  });
  return { host, ptys };
}

function createSession(host: NativeTerminalHost, id: string): void {
  host.create({ id, command: id, args: [], cwd: `/workspace/${id}`, env: {}, cols: 80, rows: 24 });
}

describe("lot L4-replies RED: reply classifier", () => {
  it("should classify every reply family and keep human bytes as input", () => {
    const feed = (chunk: string) => new TerminalReplyClassifier().feed(chunk);
    // Machine replies, one per D10(a) family.
    expect(feed(`${E}[?1;2c`)).toEqual([
      { kind: "reply", family: "da", key: "", text: `${E}[?1;2c` },
    ]);
    expect(feed(`${E}[>0;95;0c`)).toEqual([
      { kind: "reply", family: "da2", key: "", text: `${E}[>0;95;0c` },
    ]);
    expect(feed(`${E}P>|XTerm(382)${E}\\`)).toEqual([
      { kind: "reply", family: "xtversion", key: "", text: `${E}P>|XTerm(382)${E}\\` },
    ]);
    expect(feed(`${E}[?2026;1$y`)).toEqual([
      { kind: "reply", family: "decrpm", key: "2026", text: `${E}[?2026;1$y` },
    ]);
    expect(feed(`${E}[24;80R`)).toEqual([
      { kind: "reply", family: "cpr", key: "", text: `${E}[24;80R` },
    ]);
    expect(feed(`${E}[0n`)).toEqual([
      { kind: "reply", family: "dsr-status", key: "", text: `${E}[0n` },
    ]);
    expect(feed(`${E}P1$r0;1$\"q\"${E}\\`)).toEqual([
      { kind: "reply", family: "decrqss", key: "", text: `${E}P1$r0;1$\"q\"${E}\\` },
    ]);
    expect(feed(`${E}[?5u`)).toEqual([
      { kind: "reply", family: "kitty", key: "", text: `${E}[?5u` },
    ]);
    expect(feed(`${E}]4;7;rgb:0000/0000/0000${E}\\`)).toEqual([
      { kind: "reply", family: "osc", key: "4;7", text: `${E}]4;7;rgb:0000/0000/0000${E}\\` },
    ]);
    // Input stays input: focus, bracketed paste (whole block verbatim),
    // arrows, Alt-key, plain text. A lone trailing ESC is held (it may open
    // a split reply) and resolves as one input unit on flush.
    expect(feed(`${E}[I`)).toEqual([{ kind: "input", text: `${E}[I` }]);
    expect(feed(`${E}[200~${E}[?1;2c${E}[201~`)).toEqual([
      { kind: "input", text: `${E}[200~${E}[?1;2c${E}[201~` },
    ]);
    expect(feed(`${E}[A`)).toEqual([{ kind: "input", text: `${E}[A` }]);
    expect(feed(`${E}x`)).toEqual([{ kind: "input", text: `${E}x` }]);
    // A lone trailing ESC is held (it may open a split reply) and resolves
    // as one input unit on flush — never lost, never half-typed.
    const lone = new TerminalReplyClassifier();
    expect(lone.feed(E)).toEqual([]);
    expect(lone.flush()).toEqual([{ kind: "input", text: E }]);
    expect(feed("hello")).toEqual([{ kind: "input", text: "hello" }]);
  });

  it("should reassemble replies split at every chunk boundary", () => {
    const sequences = [
      `${E}[?1;2c`,
      `${E}[?2026;1$y`,
      `${E}[24;80R`,
      `${E}P>|XTerm(382)${E}\\`,
      `${E}]4;7;rgb:0000/0000/0000${E}\\`,
    ];
    for (const seq of sequences) {
      // D10 demands every boundary, including cut 1 (a lone leading ESC):
      // the classifier holds the ambiguous ESC until the next chunk or a
      // flush resolves it, so a split reply is never half-typed as input.
      for (let split = 1; split < seq.length; split++) {
        const classifier = new TerminalReplyClassifier();
        const first = classifier.feed(seq.slice(0, split));
        const second = classifier.feed(seq.slice(split));
        const flushed = classifier.flush();
        const texts = [...first, ...second, ...flushed];
        const joined = texts.map((p) => p.text).join("");
        expect(joined, `split at ${split} of ${JSON.stringify(seq)}`).toBe(seq);
        // A split reply is never half-forwarded as input: exactly one part.
        expect(texts).toHaveLength(1);
      }
    }
  });

  it("should keep split bracketed paste as input, never as replies", () => {
    const seq = `${E}[200~${E}[?1;2c-paste${E}[201~`;
    // Same boundary rule as above: reassembly starts at a lone leading ESC.
    for (let split = 1; split < seq.length; split++) {
      const classifier = new TerminalReplyClassifier();
      const first = classifier.feed(seq.slice(0, split));
      const second = classifier.feed(seq.slice(split));
      const flushed = classifier.flush();
      const texts = [...first, ...second, ...flushed];
      expect(texts.map((p) => p.text).join(""), `split at ${split}`).toBe(seq);
      expect(texts.every((p) => p.kind === "input"), `split at ${split}`).toBe(true);
    }
  });

  it("should hold a trailing bare ESC until the next chunk or a flush resolves it", () => {
    const classifier = new TerminalReplyClassifier();
    // A lone trailing ESC is ambiguous (Alt-key prefix, Esc-to-cancel, or
    // the first byte of a split reply): hold it, never emit it as input.
    expect(classifier.feed(E)).toEqual([]);
    // When the rest of a reply follows, the whole resolves as one reply —
    // the ESC never reaches the human input path.
    expect(classifier.feed("[?1;2c")).toEqual([
      { kind: "reply", family: "da", key: "", text: `${E}[?1;2c` },
    ]);
    expect(classifier.flush()).toEqual([]);
    // A partial CSI is held, then completes as human input (arrow key).
    expect(classifier.feed(`${E}[`)).toEqual([]);
    expect(classifier.feed("A")).toEqual([{ kind: "input", text: `${E}[A` }]);
    // A partial that turns out to be a reply completes as a reply.
    expect(classifier.feed(`${E}[?1`)).toEqual([]);
    expect(classifier.feed(";2c")).toEqual([
      { kind: "reply", family: "da", key: "", text: `${E}[?1;2c` },
    ]);
    expect(classifier.flush()).toEqual([]);
    // With no continuation, a flush resolves the held ESC as one input
    // unit (a genuine lone Escape key is never lost, only bounded-delayed).
    const lone = new TerminalReplyClassifier();
    expect(lone.feed(E)).toEqual([]);
    expect(lone.flush()).toEqual([{ kind: "input", text: E }]);
  });
});

describe("lot L4-replies RED: query scanner and strip", () => {
  it("should track queries with correlation keys inside a bounded window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const scanner = new TerminalQueryScanner();
    const found = scanner.feed(`${E}[c${E}[?2026;1016$p${E}[6n`);
    expect(found).toEqual([
      { family: "da", key: "" },
      { family: "decrpm", key: "2026" },
      { family: "decrpm", key: "1016" },
      { family: "cpr", key: "" },
    ]);
    expect(replyQueryKey({ family: "decrpm", key: "2026" })).toBe("decrpm:2026");
    expect(TERMINAL_REPLY_QUERY_WINDOW_MS).toBeGreaterThan(0);
  });

  it("should leave the reset marker to the relay (single owner, no double count)", () => {
    const scanner = new TerminalQueryScanner();
    expect(scanner.feed(`a${NATIVE_TERMINAL_RESET_MARKER}b`)).toEqual([]);
  });

  it("should not reissue queries from repainted history", () => {
    const history =
      `line one\r\n${E}[c${E}[>q${E}[?2026$p${E}[6n` +
      `plain text${E}[?25lmore\r\n${E}]4;7;?${E}\\tail`;
    const stripped = stripTerminalQueries(history);
    expect(stripped).not.toContain(`${E}[c`);
    expect(stripped).not.toContain(`${E}[>q`);
    expect(stripped).not.toContain(`${E}[?2026$p`);
    expect(stripped).not.toContain(`${E}[6n`);
    expect(stripped).not.toContain(`${E}]4;7;?`);
    // Live content survives the strip: text, mode sets, replies.
    expect(stripped).toContain("line one");
    expect(stripped).toContain("plain text");
    expect(stripped).toContain(`${E}[?25l`);
    expect(stripped).toContain("tail");
  });
});

describe("lot L4-replies RED: host final-write revalidation", () => {
  function leasedHost(id = "alpha"): {
    host: NativeTerminalHost;
    ptys: Map<string, StubPty>;
    lease: NativeTerminalControllerLease;
  } {
    const { host, ptys } = stubHost();
    createSession(host, id);
    const lease = host.acquireController(id, "bridge", "human");
    return { host, ptys, lease };
  }

  function unitFor(
    lease: NativeTerminalControllerLease,
    family: TerminalReplyUnit["family"] = "da",
    key = "",
    appEpoch = 0,
  ): TerminalReplyUnit {
    return {
      family,
      key,
      epoch: lease.epoch,
      incarnation: lease.incarnation,
      appEpoch,
      bytes: `${E}[?1;2c`,
      acceptedAt: Date.now(),
    };
  }

  it("should apply a reply while its query is outstanding for the current epoch and incarnation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const { host, ptys, lease } = leasedHost();
    const before = hostFaultCounters()[HOST_FAULT_COUNTERS.terminalReplySwallowed] ?? 0;
    ptys.get("alpha")!.emitData(`${E}[c`);
    const activityBefore = host.state("alpha").lastHumanActivityAt;
    const outcome = host.writeReply(lease, unitFor(lease));
    expect(outcome).toEqual({ outcome: "applied" });
    expect(ptys.get("alpha")!.writes).toEqual([`${E}[?1;2c`]);
    // A machine reply never stamps human activity, and nothing is counted.
    expect(host.state("alpha").lastHumanActivityAt).toBe(activityBefore);
    expect(hostFaultCounters()[HOST_FAULT_COUNTERS.terminalReplySwallowed] ?? 0).toBe(before);
  });

  it("should swallow at the host a reply accepted by the bridge whose CLI exits before the write lands", () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000_000);
    const { host, ptys, lease } = leasedHost();
    ptys.get("alpha")!.emitData(`${E}[c`);
    // The reply RPC is held after bridge acceptance: the CLI exits (wrapper
    // reset marker) before the held RPC is delivered. Neighbouring human
    // keystrokes keep their own path and stay ordered.
    host.write(lease, "echo human-first\r");
    const activityBefore = host.state("alpha").lastHumanActivityAt;
    ptys.get("alpha")!.emitData(`some output${NATIVE_TERMINAL_RESET_MARKER}more`);
    const before = hostFaultCounters()[HOST_FAULT_COUNTERS.terminalReplySwallowed] ?? 0;
    const outcome = host.writeReply(lease, unitFor(lease, "da", "", 0));
    expect(outcome).toEqual({ outcome: "swallowed", reason: "stale-application" });
    expect(ptys.get("alpha")!.writes).toEqual(["echo human-first\r"]);
    expect(host.state("alpha").lastHumanActivityAt).toBe(activityBefore);
    expect(hostFaultCounters()[HOST_FAULT_COUNTERS.terminalReplySwallowed] ?? 0).toBe(before + 1);
  });

  it("should swallow a reply with a stale epoch, incarnation, or no outstanding query", () => {
    vi.useFakeTimers();
    vi.setSystemTime(4_000_000);
    const { host, ptys, lease } = leasedHost();
    // No query outstanding: swallowed even with fresh correlation.
    expect(host.writeReply(lease, unitFor(lease))).toEqual({
      outcome: "swallowed",
      reason: "no-outstanding-query",
    });
    // Stale controller epoch (takeover happened after bridge acceptance).
    ptys.get("alpha")!.emitData(`${E}[c`);
    host.acquireController("alpha", "newer", "human", { takeover: true });
    expect(host.writeReply(lease, unitFor(lease))).toEqual({
      outcome: "swallowed",
      reason: "stale-epoch",
    });
    // Stale incarnation.
    const fresh = host.acquireController("alpha", "third", "human", { takeover: true });
    expect(
      host.writeReply(fresh, { ...unitFor(fresh), incarnation: "other-incarnation" }),
    ).toEqual({ outcome: "swallowed", reason: "stale-incarnation" });
    expect(ptys.get("alpha")!.writes).toEqual([]);
  });

  it("should expire outstanding queries outside the bounded window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    const { host, ptys, lease } = leasedHost();
    ptys.get("alpha")!.emitData(`${E}[c`);
    vi.setSystemTime(5_000_000 + TERMINAL_REPLY_QUERY_WINDOW_MS + 1);
    expect(host.writeReply(lease, unitFor(lease))).toEqual({
      outcome: "swallowed",
      reason: "no-outstanding-query",
    });
    expect(ptys.get("alpha")!.writes).toEqual([]);
  });

  it("should swallow the outer CPR answer to a host-intercepted cursor query", () => {
    vi.useFakeTimers();
    vi.setSystemTime(6_000_000);
    const { host, ptys, lease } = leasedHost();
    // The inner app asks for the cursor; the host answers itself (the asking
    // CLI gets its CPR). The outer duplicate finds no outstanding query.
    ptys.get("alpha")!.emitData(`prompt ${E}[6n`);
    expect(ptys.get("alpha")!.writes).toEqual([`${E}[1;1R`]);
    const outcome = host.writeReply(lease, {
      ...unitFor(lease, "cpr", ""),
      bytes: `${E}[24;80R`,
    });
    expect(outcome).toEqual({ outcome: "swallowed", reason: "no-outstanding-query" });
    // Exactly one CPR was written: the host's own answer, never the outer dup.
    expect(ptys.get("alpha")!.writes).toEqual([`${E}[1;1R`]);
  });

  it("should match decrpm and osc replies by their correlation key", () => {
    vi.useFakeTimers();
    vi.setSystemTime(7_000_000);
    const { host, ptys, lease } = leasedHost();
    ptys.get("alpha")!.emitData(`${E}[?2026$p${E}]4;7;?${E}\\`);
    // Right family, wrong key: swallowed.
    expect(host.writeReply(lease, { ...unitFor(lease, "decrpm", "1016"), bytes: `${E}[?1016;1$y` })).toEqual({
      outcome: "swallowed",
      reason: "no-outstanding-query",
    });
    // Right family and key: applied, and consumed (no double apply).
    expect(
      host.writeReply(lease, { ...unitFor(lease, "decrpm", "2026"), bytes: `${E}[?2026;1$y` }),
    ).toEqual({ outcome: "applied" });
    expect(
      host.writeReply(lease, { ...unitFor(lease, "decrpm", "2026"), bytes: `${E}[?2026;1$y` }),
    ).toEqual({ outcome: "swallowed", reason: "no-outstanding-query" });
    expect(ptys.get("alpha")!.writes).toEqual([`${E}[?2026;1$y`]);
  });
});
