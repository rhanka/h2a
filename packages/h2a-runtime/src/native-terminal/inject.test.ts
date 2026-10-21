// @ts-ignore Shared JS test isolation helper.
import { createPrivateTestDirectory, setupNativeTestEnvironment } from "../../../h2a/test/helpers/native-isolation.js";
setupNativeTestEnvironment(afterAll);
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PtyHandle, PtySpawner } from "../pty.js";
import { NativeTerminalHost } from "./host.js";
import { readCrashLog } from "../crash-log.js";

class StubPty implements PtyHandle {
  static #nextPid = 51000;
  readonly pid = StubPty.#nextPid++;
  readonly pgid = this.pid;
  readonly cols = 80;
  readonly rows = 24;
  readonly #dataHandlers = new Set<(chunk: string) => void>();
  readonly #exitHandlers = new Set<(event: { exitCode: number; signal?: number }) => void>();
  readonly writes: string[] = [];
  /** Test-only: deliver output bytes as the real PTY would. */
  emitData(chunk: string): void {
    for (const handler of [...this.#dataHandlers]) handler(chunk);
  }
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
}

function stubSpawner(): { spawner: PtySpawner; ptys: Map<string, StubPty> } {
  const ptys = new Map<string, StubPty>();
  return {
    ptys,
    spawner: (options) => {
      const pty = new StubPty();
      ptys.set(options.command, pty);
      return pty;
    },
  };
}

let scratch: string;
let registryPath: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "h2a-inject-red-"));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(scratch, { recursive: true, force: true });
});

function createSession(host: NativeTerminalHost, id: string): void {
  host.create({ id, command: id, args: [], cwd: `/workspace/${id}`, env: {}, cols: 80, rows: 24 });
}

describe("lot L2 RED: host-side injection concurrent with an attached window", () => {
  it("should inject a line while a human controller lease is held", () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000_000);
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({ generation: "g", replayBytesPerSession: 1024, registryPath: join(scratch, "r.json"), spawner });
    createSession(host, "alpha");
    host.acquireController("alpha", "human-window", "human");
    vi.setSystemTime(3_000_000 + 30_000);
    const outcome = host.inject("alpha", { text: "[h2a-wake test]", requestId: "req-1" });
    expect(outcome).toMatchObject({ outcome: "injected", automationSeq: 1 });
    expect(ptys.get("alpha")!.writes).toEqual(["[h2a-wake test]\r"]);
    // The human lease survives the injection: still attached, same epoch.
    const lease = host.acquireController("alpha", "second", "human", { takeover: true });
    expect(lease.epoch).toBe(2);
  });

  it("should defer inside the activity window with retryAfterMs and zero bytes", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({ generation: "g", replayBytesPerSession: 1024, registryPath: join(scratch, "r.json"), spawner });
    createSession(host, "alpha");
    host.acquireController("alpha", "human-window", "human");
    const outcome = host.inject("alpha", { text: "hello", requestId: "req-1", activityWindowMs: 4000 });
    expect(outcome.outcome).toBe("deferred-recent-human");
    if (outcome.outcome === "deferred-recent-human") {
      expect(outcome.retryAfterMs).toBeGreaterThan(0);
      expect(outcome.retryAfterMs).toBeLessThanOrEqual(4000);
    }
    expect(ptys.get("alpha")!.writes).toEqual([]);
  });

  it("should leave lastHumanActivityAt unchanged after a machine injection", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { spawner } = stubSpawner();
    const host = new NativeTerminalHost({ generation: "g", replayBytesPerSession: 1024, registryPath: join(scratch, "r.json"), spawner });
    createSession(host, "alpha");
    host.acquireController("alpha", "human-window", "human");
    const stamped = host.state("alpha").lastHumanActivityAt;
    vi.setSystemTime(1_000_000 + 30_000);
    const outcome = host.inject("alpha", { text: "hello", requestId: "req-1", activityWindowMs: 4000 });
    expect(outcome.outcome).toBe("injected");
    expect(host.state("alpha").lastHumanActivityAt).toBe(stamped);
  });

  it("should return the original outcome on redelivery without re-writing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({ generation: "g", replayBytesPerSession: 1024, registryPath: join(scratch, "r.json"), spawner });
    createSession(host, "alpha");
    host.acquireController("alpha", "human-window", "human");
    vi.setSystemTime(2_000_000 + 30_000);
    const first = host.inject("alpha", { text: "hello", requestId: "req-same" });
    const second = host.inject("alpha", { text: "hello", requestId: "req-same" });
    expect(second).toEqual(first);
    expect(ptys.get("alpha")!.writes).toEqual(["hello\r"]);
  });

  it("should refuse a stale incarnation with zero bytes", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({ generation: "g", replayBytesPerSession: 1024, registryPath: join(scratch, "r.json"), spawner });
    createSession(host, "alpha");
    const outcome = host.inject("alpha", { text: "hello", requestId: "req-1", incarnation: "stale-incarnation" });
    expect(outcome).toEqual({ outcome: "refused-stale-incarnation" });
    expect(ptys.get("alpha")!.writes).toEqual([]);
  });

  it("should reject an invalid line with zero bytes", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({ generation: "g", replayBytesPerSession: 1024, registryPath: join(scratch, "r.json"), spawner });
    createSession(host, "alpha");
    expect(() => host.inject("alpha", { text: "two\nlines", requestId: "req-1" })).toThrow();
    expect(() => host.inject("alpha", { text: "", requestId: "req-2" })).toThrow();
    expect(ptys.get("alpha")!.writes).toEqual([]);
  });

  it("should sequence automation writes monotonically without touching the human lease", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({ generation: "g", replayBytesPerSession: 1024, registryPath: join(scratch, "r.json"), spawner });
    createSession(host, "alpha");
    const epochBefore = host.attachObserver("alpha").controllerEpoch;
    const first = host.inject("alpha", { text: "one", requestId: "req-1" });
    const second = host.inject("alpha", { text: "two", requestId: "req-2" });
    expect(first).toMatchObject({ outcome: "injected", automationSeq: 1 });
    expect(second).toMatchObject({ outcome: "injected", automationSeq: 2 });
    expect(host.attachObserver("alpha").controllerEpoch).toBe(epochBefore);
    expect(ptys.get("alpha")!.writes).toEqual(["one\r", "two\r"]);
  });

  it("should audit every attempt without payload content", () => {
    const { spawner } = stubSpawner();
    const host = new NativeTerminalHost({ generation: "g", replayBytesPerSession: 1024, registryPath: join(scratch, "r.json"), spawner });
    createSession(host, "alpha");
    host.inject("alpha", { text: "secret-payload-bytes", requestId: "req-1", actor: "owner-channel/op.js" });
    host.inject("alpha", { text: "hello", requestId: "req-1" });
    const rows = readCrashLog("cli");
    const attempts = rows.filter((row) => row.sessionId === "alpha" && row.reason?.startsWith("inject:"));
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    const raw = JSON.stringify(attempts);
    expect(raw).not.toContain("secret-payload-bytes");
  });
});

describe("round-1 P1/P2 (code-review astra-2/5, sol-1/4/5): composition, admission, dedup", () => {
  it("should refuse with zero bytes when human bytes were forwarded without composition evidence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({ generation: "g", replayBytesPerSession: 1024, registryPath: join(scratch, "r.json"), spawner });
    createSession(host, "alpha");
    const lease = host.acquireController("alpha", "human-window", "human");
    // The human composes a draft and never submits it.
    host.write(lease, "printf 'HUMAN_RESULT:%s\\n' 'draft-");
    // The idle window expires: an expired timer alone never proves an empty composer.
    vi.setSystemTime(5_000_000 + 30_000);
    const outcome = host.inject("alpha", { text: "MACHINE", requestId: "req-machine" });
    expect(outcome.outcome).toBe("refused-unproven-composition");
    // Zero machine bytes: the human draft is untouched, the timer did not launder it.
    expect(ptys.get("alpha")!.writes).toEqual(["printf 'HUMAN_RESULT:%s\\n' 'draft-"]);
  });

  it("should refuse submit into a managed-shell foreground without an adapter", () => {
    vi.useFakeTimers();
    vi.setSystemTime(6_000_000);
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({ generation: "g", replayBytesPerSession: 1024, registryPath: join(scratch, "r.json"), spawner });
    createSession(host, "alpha");
    // The wrapper reset marker proves the managed shell now holds the
    // foreground (the CLI exited). No bytes were ever composed by a human.
    ptys.get("alpha")!.emitData("\x1b]777;h2a-reset\x07");
    vi.setSystemTime(6_000_000 + 30_000);
    const outcome = host.inject("alpha", { text: "[h2a-wake test]", requestId: "req-shell" });
    expect(outcome.outcome).toBe("refused-facet");
    expect(ptys.get("alpha")!.writes).toEqual([]);
  });

  it("should refuse mutation when durable admission cannot be recorded", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({ generation: "g", replayBytesPerSession: 1024, registryPath: join(scratch, "r.json"), spawner });
    createSession(host, "alpha");
    // XDG_STATE_HOME aimed at a plain file: the journal cannot be created.
    const sentinel = join(scratch, "not-a-dir");
    writeFileSync(sentinel, "sentinel");
    const prev = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = sentinel;
    try {
      const outcome = host.inject("alpha", { text: "audit-must-refuse", requestId: "req-audit" });
      expect(outcome.outcome).toBe("refused-audit-unavailable");
      expect(ptys.get("alpha")!.writes).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = prev;
    }
  });

  it("should never re-apply an evicted idempotency key", () => {
    vi.useFakeTimers();
    vi.setSystemTime(7_000_000);
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({ generation: "g", replayBytesPerSession: 1024, registryPath: join(scratch, "r.json"), spawner });
    createSession(host, "alpha");
    const first = host.inject("alpha", { text: "original", requestId: "req-original" });
    expect(first.outcome).toBe("injected");
    for (let i = 0; i < 512; i++) {
      host.inject("alpha", { text: `filler-${i}`, requestId: `req-filler-${i}` });
    }
    const writesBefore = ptys.get("alpha")!.writes.length;
    expect(writesBefore).toBe(513);
    const redelivered = host.inject("alpha", { text: "original", requestId: "req-original" });
    expect(redelivered.outcome).not.toBe("injected");
    expect(ptys.get("alpha")!.writes.length).toBe(writesBefore);
  });

  it("should never re-apply an original key past the old tombstone bound", () => {
    // Round-2 (code-review astra-3/sol-2): the 4096-tombstone ring forgot old
    // identifiers, so the original command was submitted a second time after
    // 4609 distinct requests. An applied key is never readmitted as new
    // within the host lifetime (host-crash exactly-once stays out of scope).
    vi.useFakeTimers();
    vi.setSystemTime(8_000_000);
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({ generation: "g", replayBytesPerSession: 1024, registryPath: join(scratch, "r.json"), spawner });
    createSession(host, "alpha");
    const first = host.inject("alpha", { text: "original", requestId: "req-original" });
    expect(first).toMatchObject({ outcome: "injected", automationSeq: 1 });
    for (let i = 0; i < 4609; i++) {
      host.inject("alpha", { text: `filler-${i}`, requestId: `req-filler-${i}` });
    }
    const writesBefore = ptys.get("alpha")!.writes.length;
    expect(writesBefore).toBe(4610);
    const redelivered = host.inject("alpha", { text: "original", requestId: "req-original" });
    expect(redelivered.outcome).toBe("refused-evicted-request");
    expect(ptys.get("alpha")!.writes.length).toBe(writesBefore);
  }, 120_000);
});

describe("round-3 P1 (reviews pr382-r3): no process-name composer assumption for interpreter runtimes", () => {
  const CTRL_E = String.fromCharCode(0x05);
  const CTRL_U = String.fromCharCode(0x15);
  const CTRL_Y = String.fromCharCode(0x19);
  function hostWithForeground(foreground: { command: string; args: string[] }): {
    host: NativeTerminalHost;
    ptys: Map<string, StubPty>;
  } {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "g",
      replayBytesPerSession: 1024,
      registryPath: join(scratch, "r.json"),
      spawner,
      readForegroundSnapshots: () => [
        { pid: 4242, command: foreground.command, args: foreground.args, startedAtMs: 1, ppid: 4241 },
      ],
    });
    return { host, ptys };
  }

  function idleHumanDraft(host: NativeTerminalHost, id: string, draft: string): void {
    createSession(host, id);
    const lease = host.acquireController(id, "human-window", "human");
    host.write(lease, draft);
    // The activity window expires with the draft still unsubmitted: an
    // expired timer alone never proves an empty composer.
    vi.setSystemTime(Date.now() + 30_000);
  }

  // `args` is the full argv including argv[0] (as read from /proc/<pid>/cmdline).
  it.each([
    { command: "node", args: ["node", "app.mjs"] },
    { command: "node", args: ["node", "--interactive", "--eval", "0"] },
    { command: "node", args: ["node"] },
    { command: "bun", args: ["bun", "app.ts"] },
    { command: "deno", args: ["deno", "run", "app.ts"] },
  ])("should refuse with zero machine bytes on unattested $command foreground ($args)", ({ command, args }) => {
    vi.useFakeTimers();
    vi.setSystemTime(9_000_000);
    const { host, ptys } = hostWithForeground({ command, args });
    idleHumanDraft(host, "alpha", "human-draft");
    const outcome = host.inject("alpha", { text: "[h2a-wake r3]", requestId: "req-r3" });
    expect(outcome.outcome).toBe("refused-unproven-composition");
    // Only the human bytes reached the PTY: the draft is intact, nothing
    // was submitted or executed on its behalf.
    expect(ptys.get("alpha")!.writes).toEqual(["human-draft"]);
  });

  it("should still drive an attested agent-CLI foreground with the draft preserved", () => {
    vi.useFakeTimers();
    vi.setSystemTime(9_100_000);
    const { host, ptys } = hostWithForeground({ command: "claude", args: ["claude"] });
    idleHumanDraft(host, "alpha", "human-draft");
    const outcome = host.inject("alpha", { text: "[h2a-wake r3]", requestId: "req-r3" });
    expect(outcome).toMatchObject({ outcome: "injected" });
    expect(ptys.get("alpha")!.writes).toEqual(["human-draft", CTRL_E + CTRL_U + "[h2a-wake r3]\r" + CTRL_Y]);
  });
});
