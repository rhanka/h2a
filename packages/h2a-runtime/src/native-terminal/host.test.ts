import { describe, expect, it, vi } from "vitest";

import type { PtyHandle, PtySpawner } from "../pty.js";
import { NativeTerminalHost } from "./host.js";

class StubPty implements PtyHandle {
  static #nextPid = 41000;
  readonly pid = StubPty.#nextPid++;
  readonly cols = 80;
  readonly rows = 24;
  readonly #dataHandlers = new Set<(chunk: string) => void>();
  readonly #exitHandlers = new Set<
    (event: { exitCode: number; signal?: number }) => void
  >();
  readonly write = vi.fn();
  readonly resize = vi.fn();
  readonly kill = vi.fn();

  onData(handler: (chunk: string) => void): { dispose(): void } {
    this.#dataHandlers.add(handler);
    return { dispose: () => this.#dataHandlers.delete(handler) };
  }

  onExit(
    handler: (event: { exitCode: number; signal?: number }) => void,
  ): { dispose(): void } {
    this.#exitHandlers.add(handler);
    return { dispose: () => this.#exitHandlers.delete(handler) };
  }

  emitData(chunk: string): void {
    for (const handler of this.#dataHandlers) handler(chunk);
  }

  emitExit(event: { exitCode: number; signal?: number }): void {
    for (const handler of this.#exitHandlers) handler(event);
  }
}

function stubSpawner(): {
  spawner: PtySpawner;
  ptys: Map<string, StubPty>;
} {
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

function createSession(host: NativeTerminalHost, id: string): void {
  host.create({
    id,
    command: id,
    args: [],
    cwd: `/workspace/${id}`,
    env: {},
    cols: 80,
    rows: 24,
  });
}

describe("NativeTerminalHost", () => {
  it("should keep output and exit lifecycle independent across sessions", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-1",
      replayBytesPerSession: 32,
      spawner,
    });

    createSession(host, "alpha");
    createSession(host, "beta");
    ptys.get("alpha")!.emitData("alpha-output");
    ptys.get("beta")!.emitData("beta-output");
    ptys.get("alpha")!.emitExit({ exitCode: 7, signal: 15 });
    ptys.get("alpha")!.emitData("ignored-after-exit");
    ptys.get("alpha")!.emitExit({ exitCode: 0 });
    ptys.get("beta")!.emitData("-still-running");

    expect(host.readOutput("alpha", 0)).toEqual({
      generation: "host-generation-1",
      chunks: [{ seq: 1, data: "alpha-output" }],
      gap: null,
      latestSeq: 1,
    });
    expect(host.readOutput("beta", 0)).toEqual({
      generation: "host-generation-1",
      chunks: [
        { seq: 1, data: "beta-output" },
        { seq: 2, data: "-still-running" },
      ],
      gap: null,
      latestSeq: 2,
    });
    expect(host.list()).toEqual([
      {
        id: "alpha",
        generation: "host-generation-1",
        pid: expect.any(Number),
        status: "exited",
        latestSeq: 1,
        exit: { exitCode: 7, signal: 15 },
        stopSignal: null,
      },
      {
        id: "beta",
        generation: "host-generation-1",
        pid: expect.any(Number),
        status: "running",
        latestSeq: 2,
        exit: null,
        stopSignal: null,
      },
    ]);
  });

  it("should let the controller escalate one stopping session without affecting another", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-2",
      replayBytesPerSession: 32,
      spawner,
    });

    createSession(host, "alpha");
    createSession(host, "beta");
    const lease = host.acquireController("alpha", "stopper");

    expect(host.stop(lease, "SIGTERM")).toMatchObject({
      id: "alpha",
      status: "stopping",
      stopSignal: "SIGTERM",
    });
    expect(host.stop(lease, "SIGKILL")).toMatchObject({
      id: "alpha",
      status: "stopping",
      stopSignal: "SIGKILL",
    });
    expect(ptys.get("alpha")!.kill).toHaveBeenCalledTimes(2);
    expect(ptys.get("alpha")!.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(ptys.get("alpha")!.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(ptys.get("beta")!.kill).not.toHaveBeenCalled();

    ptys.get("alpha")!.emitExit({ exitCode: 0 });
    ptys.get("beta")!.emitData("alive");

    expect(host.state("alpha")).toMatchObject({
      status: "exited",
      exit: { exitCode: 0 },
    });
    expect(host.state("beta")).toMatchObject({
      status: "running",
      latestSeq: 1,
    });
  });

  it("should force-stop every non-exited session during bounded host shutdown", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-force",
      replayBytesPerSession: 32,
      spawner,
    });
    createSession(host, "alpha");
    createSession(host, "beta");

    const lease = host.acquireController("alpha", "stopper");
    host.stop(lease, "SIGTERM");
    expect(host.forceStopAll("SIGKILL")).toEqual([
      expect.objectContaining({ id: "alpha", status: "stopping", stopSignal: "SIGKILL" }),
      expect.objectContaining({ id: "beta", status: "stopping", stopSignal: "SIGKILL" }),
    ]);
    expect(ptys.get("alpha")!.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(ptys.get("alpha")!.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(ptys.get("beta")!.kill).toHaveBeenCalledOnce();
    expect(ptys.get("beta")!.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("should reject duplicate and unknown session identifiers", () => {
    const { spawner } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-3",
      replayBytesPerSession: 32,
      spawner,
    });

    createSession(host, "alpha");

    expect(() => createSession(host, "alpha")).toThrow(/already exists/i);
    expect(() => host.state("missing")).toThrow(/unknown terminal session/i);
    expect(() => host.readOutput("missing", 0)).toThrow(
      /unknown terminal session/i,
    );
  });

  it("should bound retained sessions and recycle exited identifiers", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-bounded",
      replayBytesPerSession: 32,
      maxSessions: 2,
      spawner,
    });

    createSession(host, "alpha");
    createSession(host, "beta");
    expect(() => createSession(host, "gamma")).toThrow(/session limit/i);

    ptys.get("alpha")!.emitExit({ exitCode: 0 });
    createSession(host, "gamma");
    expect(host.list().map((session) => session.id)).toEqual(["beta", "gamma"]);

    ptys.get("gamma")!.emitExit({ exitCode: 0 });
    createSession(host, "gamma");
    expect(host.state("gamma")).toMatchObject({
      status: "running",
      latestSeq: 0,
      exit: null,
    });
  });

  it("should allow one controller while observers remain read-only", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-4",
      replayBytesPerSession: 32,
      spawner,
    });
    createSession(host, "alpha");

    expect(host.attachObserver("alpha")).toEqual({
      role: "observer",
      id: "alpha",
      generation: "host-generation-4",
      controllerEpoch: 0,
    });
    const controller = host.acquireController("alpha", "focus-client");
    expect(controller).toEqual({
      role: "controller",
      id: "alpha",
      generation: "host-generation-4",
      controllerId: "focus-client",
      epoch: 1,
    });
    expect(host.attachObserver("alpha")).toMatchObject({
      role: "observer",
      controllerEpoch: 1,
    });
    expect(() => host.acquireController("alpha", "cli-client")).toThrow(
      /already has a controller/i,
    );

    host.write(controller, "pwd\r");
    host.resize(controller, 120, 40);

    expect(ptys.get("alpha")!.write).toHaveBeenCalledWith("pwd\r");
    expect(ptys.get("alpha")!.resize).toHaveBeenCalledWith(120, 40);
  });

  it("should reject stale controller epochs after ownership changes", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-5",
      replayBytesPerSession: 32,
      spawner,
    });
    createSession(host, "alpha");

    const first = host.acquireController("alpha", "first-client");
    expect(host.releaseController(first)).toEqual({
      id: "alpha",
      generation: "host-generation-5",
      controllerEpoch: 2,
    });
    const second = host.acquireController("alpha", "second-client");

    expect(second.epoch).toBe(3);
    expect(() => host.write(first, "stale")).toThrow(
      /stale terminal controller lease/i,
    );
    expect(() => host.resize(first, 100, 30)).toThrow(
      /stale terminal controller lease/i,
    );
    expect(ptys.get("alpha")!.write).not.toHaveBeenCalled();
    expect(ptys.get("alpha")!.resize).not.toHaveBeenCalled();

    host.write(second, "current");
    expect(ptys.get("alpha")!.write).toHaveBeenCalledWith("current");
  });

  it("should fence the active controller when its session becomes terminal", () => {
    const { spawner, ptys } = stubSpawner();
    const host = new NativeTerminalHost({
      generation: "host-generation-6",
      replayBytesPerSession: 32,
      spawner,
    });
    createSession(host, "alpha");
    createSession(host, "beta");
    const stopped = host.acquireController("alpha", "alpha-client");
    const exited = host.acquireController("beta", "beta-client");

    host.stop(stopped);
    ptys.get("beta")!.emitExit({ exitCode: 0 });

    expect(() => host.write(stopped, "after-stop")).toThrow(
      /stale terminal controller lease/i,
    );
    expect(() => host.resize(exited, 90, 30)).toThrow(
      /stale terminal controller lease/i,
    );
  });
});
