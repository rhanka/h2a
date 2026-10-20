// @ts-ignore Shared JS test isolation helper.
import { createPrivateTestDirectory, setupNativeTestEnvironment } from "../../../h2a/test/helpers/native-isolation.js";
setupNativeTestEnvironment(afterAll);
import { mkdtempSync, rmSync } from "node:fs";
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
