import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import type {
  NativeTerminalControllerLease,
  NativeTerminalReplay,
  NativeTerminalSessionState,
} from "./host.js";
import {
  NativeTerminalRequestTimeoutError,
  type NativeTerminalClient,
} from "./client.js";
import {
  NATIVE_TERMINAL_INTERACTIVE_READ_TIMEOUT_MS,
} from "./protocol.js";
import { runAttach, type NativeTerminalAttachRuntime } from "./op.js";

class FakeInput extends EventEmitter {
  readonly isTTY = false;
  readonly resume = vi.fn();
  readonly pause = vi.fn();
  readonly setRawMode = vi.fn();
}

class FakeOutput {
  readonly columns = 120;
  readonly rows = 40;
  readonly chunks: string[] = [];

  write(chunk: string): boolean {
    this.chunks.push(String(chunk));
    return true;
  }
}

type AttachClient = Pick<
  NativeTerminalClient,
  | "readOutput"
  | "state"
  | "acquireController"
  | "releaseController"
  | "write"
  | "resize"
  | "close"
>;

function running(controlled = false): NativeTerminalSessionState {
  return {
    id: "h2a-alpha",
    pid: 4242,
    status: "running",
    exit: null,
    generation: "generation-1",
    incarnation: 1,
    controllerEpoch: controlled ? 1 : 0,
    controlled,
  };
}

function exited(): NativeTerminalSessionState {
  return {
    ...running(false),
    status: "exited",
    exit: { exitCode: 0 },
  };
}

function replay(seq: number, data: string): NativeTerminalReplay {
  return {
    id: "h2a-alpha",
    earliestSeq: seq,
    latestSeq: seq,
    truncated: false,
    chunks: [{ seq, data }],
  };
}

describe("native terminal attach recovery", () => {
  it.each([
    [
      "read timeout",
      () =>
        new NativeTerminalRequestTimeoutError(
          "read-output",
          NATIVE_TERMINAL_INTERACTIVE_READ_TIMEOUT_MS,
        ),
    ],
    ["socket close", () => new Error("terminal host connection closed")],
  ])(
    "reconnects after %s without killing the PTY or overlapping controllers",
    async (_label, failure) => {
      const stdin = new FakeInput();
      const stdout = new FakeOutput();
      let now = 0;
      let connections = 0;
      let controllers = 0;
      let maxControllers = 0;
      let rejectFirstWrite: ((error: Error) => void) | undefined;
      const reads: Array<{ connection: number; afterSeq: number; timeoutMs?: number }> = [];
      const writes: Array<{ connection: number; data: string }> = [];

      const connect = async (): Promise<AttachClient> => {
        connections += 1;
        const connection = connections;
        let closed = false;
        let leased = false;
        let readCount = 0;
        let stateCount = 0;
        const lease: NativeTerminalControllerLease = {
          role: "controller",
          id: "h2a-alpha",
          generation: "generation-1",
          incarnation: 1,
          controllerId: `controller-${connection}`,
          epoch: connection,
        };

        return {
          async acquireController() {
            expect(controllers).toBe(0);
            leased = true;
            controllers += 1;
            maxControllers = Math.max(maxControllers, controllers);
            if (connection === 2) {
              // Keystrokes received while the new controller is being acquired
              // must be held and delivered after recovery, never dropped.
              stdin.emit("data", Buffer.from("continued-input"));
            }
            return lease;
          },
          async releaseController() {
            if (leased) {
              leased = false;
              controllers -= 1;
            }
            return { controlled: false, controllerEpoch: connection };
          },
          async readOutput(_id, afterSeq, timeoutMs) {
            readCount += 1;
            reads.push({ connection, afterSeq, timeoutMs });
            if (connection === 1 && readCount === 1) {
              queueMicrotask(() => stdin.emit("data", Buffer.from("uncertain-input")));
              return replay(1, "first-output");
            }
            if (connection === 1) throw failure();
            if (readCount === 1) {
              // Settle the old socket's in-flight write only after connection 2
              // owns the controller. Its stale failure must not close the new
              // connection or replay the ambiguous chunk.
              rejectFirstWrite?.(new Error("old socket write response lost"));
              await Promise.resolve();
              return replay(2, "second-output");
            }
            return {
              id: "h2a-alpha",
              earliestSeq: 2,
              latestSeq: 2,
              truncated: false,
              chunks: [],
            };
          },
          async state() {
            stateCount += 1;
            // First state read validates the newly-connected session. The
            // periodic state read ends the deterministic scenario.
            return connection === 2 && stateCount > 1 ? exited() : running(leased);
          },
          write(_lease, data) {
            writes.push({ connection, data });
            if (connection === 1) {
              return new Promise<void>((_resolve, reject) => {
                rejectFirstWrite = reject;
              });
            }
            return Promise.resolve();
          },
          async resize() {},
          close() {
            if (closed) return;
            closed = true;
            if (leased) {
              leased = false;
              controllers -= 1;
            }
          },
        } as AttachClient;
      };

      const runtime: NativeTerminalAttachRuntime = {
        connect,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        now: () => now,
        delay: async (ms) => {
          now += ms;
        },
        onResize: () => {},
        offResize: () => {},
      };

      await expect(runAttach("h2a-alpha", runtime)).resolves.toBe(0);

      expect(connections).toBe(2);
      expect(maxControllers).toBe(1);
      expect(controllers).toBe(0);
      expect(reads[0]).toEqual({
        connection: 1,
        afterSeq: 0,
        timeoutMs: NATIVE_TERMINAL_INTERACTIVE_READ_TIMEOUT_MS,
      });
      expect(reads.find((read) => read.connection === 2)).toMatchObject({
        afterSeq: 1,
        timeoutMs: NATIVE_TERMINAL_INTERACTIVE_READ_TIMEOUT_MS,
      });
      expect(writes).toContainEqual({ connection: 1, data: "uncertain-input" });
      expect(writes).toContainEqual({ connection: 2, data: "continued-input" });
      expect(stdout.chunks.join("")).toContain("first-output");
      expect(stdout.chunks.join("")).toContain("second-output");
      expect(stdout.chunks.join("")).toMatch(/reconnecting/i);
      expect(stdout.chunks.join("")).toMatch(/reconnected/i);
      expect(stdout.chunks.join("")).toMatch(/input delivery became uncertain/i);
      // At idle, the adaptive delay keeps this scenario to a handful of RPCs,
      // rather than the old read+state every 40ms (~50 RPC/s).
      expect(reads.filter((read) => read.connection === 2).length).toBeLessThan(8);
    },
  );
});
