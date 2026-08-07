import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";

import type {
  NativeTerminalControllerLease,
  NativeTerminalControllerState,
  NativeTerminalCreateOptions,
  NativeTerminalObserverAttachment,
  NativeTerminalReplay,
  NativeTerminalSessionState,
} from "./host.js";
import {
  NATIVE_TERMINAL_DEFAULT_REQUEST_TIMEOUT_MS,
  NATIVE_TERMINAL_MAX_FRAME_BYTES,
  NATIVE_TERMINAL_PROTOCOL_VERSION,
  NativeTerminalRemoteError,
  isRecord,
  type NativeTerminalPing,
  type NativeTerminalRequest,
  type NativeTerminalResponse,
  type NativeTerminalStopSignal,
} from "./protocol.js";
import {
  inspectPrivateNativeTerminalSocket,
  sameNativeTerminalSocket,
} from "./socket-path.js";

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
};

export class NativeTerminalClient {
  readonly #socket: Socket;
  readonly #requestTimeoutMs: number;
  readonly #pending = new Map<string, PendingRequest>();
  #buffer = "";
  #closed = false;

  private constructor(socket: Socket, requestTimeoutMs: number) {
    this.#socket = socket;
    this.#requestTimeoutMs = requestTimeoutMs;
    socket.setNoDelay(true);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.#onData(chunk));
    socket.on("error", (error) => this.#fail(error));
    socket.on("close", () => this.#fail(new Error("terminal host connection closed")));
  }

  static async connect(
    socketPath: string,
    options: {
      connectTimeoutMs?: number;
      requestTimeoutMs?: number;
    } = {},
  ): Promise<NativeTerminalClient> {
    const expected = await inspectPrivateNativeTerminalSocket(socketPath);
    const connectTimeoutMs = options.connectTimeoutMs ?? 1_000;
    const requestTimeoutMs =
      options.requestTimeoutMs ?? NATIVE_TERMINAL_DEFAULT_REQUEST_TIMEOUT_MS;
    for (const [label, value] of [
      ["connectTimeoutMs", connectTimeoutMs],
      ["requestTimeoutMs", requestTimeoutMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive safe integer`);
      }
    }
    return new Promise((resolve, reject) => {
      const socket = createConnection(socketPath);
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new Error("terminal host connection timed out"));
      }, connectTimeoutMs);
      timeout.unref();
      const onError = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.removeListener("connect", onConnect);
        socket.destroy();
        reject(error);
      };
      const onConnect = (): void => {
        void inspectPrivateNativeTerminalSocket(socketPath).then(
          (connected) => {
            if (settled) return;
            if (!sameNativeTerminalSocket(expected, connected)) {
              settled = true;
              clearTimeout(timeout);
              socket.destroy();
              reject(
                new Error("terminal host socket changed while connecting"),
              );
              return;
            }
            settled = true;
            clearTimeout(timeout);
            socket.removeListener("error", onError);
            resolve(new NativeTerminalClient(socket, requestTimeoutMs));
          },
          onError,
        );
      };
      socket.once("error", onError);
      socket.once("connect", onConnect);
    });
  }

  ping(timeoutMs = this.#requestTimeoutMs): Promise<NativeTerminalPing> {
    return this.#request("ping", undefined, timeoutMs) as Promise<NativeTerminalPing>;
  }

  create(options: NativeTerminalCreateOptions): Promise<NativeTerminalSessionState> {
    return this.#request("create", options) as Promise<NativeTerminalSessionState>;
  }

  list(): Promise<ReadonlyArray<NativeTerminalSessionState>> {
    return this.#request("list") as Promise<ReadonlyArray<NativeTerminalSessionState>>;
  }

  state(id: string): Promise<NativeTerminalSessionState> {
    return this.#request("state", { id }) as Promise<NativeTerminalSessionState>;
  }

  readOutput(id: string, afterSeq: number): Promise<NativeTerminalReplay> {
    return this.#request("read-output", { id, afterSeq }) as Promise<NativeTerminalReplay>;
  }

  attachObserver(id: string): Promise<NativeTerminalObserverAttachment> {
    return this.#request("attach-observer", { id }) as Promise<NativeTerminalObserverAttachment>;
  }

  acquireController(id: string, controllerId: string): Promise<NativeTerminalControllerLease> {
    return this.#request("acquire-controller", { id, controllerId }) as Promise<NativeTerminalControllerLease>;
  }

  releaseController(lease: NativeTerminalControllerLease): Promise<NativeTerminalControllerState> {
    return this.#request("release-controller", { lease }) as Promise<NativeTerminalControllerState>;
  }

  async write(lease: NativeTerminalControllerLease, data: string): Promise<void> {
    await this.#request("write", { lease, data });
  }

  async resize(lease: NativeTerminalControllerLease, cols: number, rows: number): Promise<void> {
    await this.#request("resize", { lease, cols, rows });
  }

  stop(
    lease: NativeTerminalControllerLease,
    signal?: NativeTerminalStopSignal,
  ): Promise<NativeTerminalSessionState> {
    return this.#request(
      "stop",
      signal === undefined ? { lease } : { lease, signal },
    ) as Promise<NativeTerminalSessionState>;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#socket.destroy();
    this.#fail(new Error("terminal host client closed"));
  }

  #request(
    operation: NativeTerminalRequest["operation"],
    params?: Readonly<Record<string, unknown>>,
    timeoutMs = this.#requestTimeoutMs,
  ): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error("terminal host client is closed"));
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(
        new RangeError("terminal host request timeout must be a positive safe integer"),
      );
    }
    const id = randomUUID();
    const request: NativeTerminalRequest = params === undefined
      ? { version: NATIVE_TERMINAL_PROTOCOL_VERSION, id, operation }
      : { version: NATIVE_TERMINAL_PROTOCOL_VERSION, id, operation, params };
    const frame = `${JSON.stringify(request)}\n`;
    if (Buffer.byteLength(frame) > NATIVE_TERMINAL_MAX_FRAME_BYTES) {
      return Promise.reject(new RangeError("terminal host request exceeds the frame limit"));
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.#pending.delete(id)) return;
        reject(
          new Error(
            `terminal host ${operation} request timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
      timeout.unref();
      this.#pending.set(id, { resolve, reject, timeout });
      this.#socket.write(frame, (error) => {
        if (!error) return;
        const pending = this.#pending.get(id);
        if (!pending) return;
        this.#pending.delete(id);
        clearTimeout(pending.timeout);
        reject(error);
      });
    });
  }

  #onData(chunk: string): void {
    this.#buffer += chunk;
    for (;;) {
      const newline = this.#buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line.length === 0) continue;
      if (Buffer.byteLength(line) > NATIVE_TERMINAL_MAX_FRAME_BYTES) {
        this.#socket.destroy(new Error("terminal host response exceeds the frame limit"));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        this.#socket.destroy(new Error("terminal host returned invalid JSON"));
        return;
      }
      if (!isRecord(parsed) || typeof parsed.id !== "string" || typeof parsed.ok !== "boolean") {
        this.#socket.destroy(new Error("terminal host returned an invalid response"));
        return;
      }
      const response = parsed as NativeTerminalResponse;
      const pending = this.#pending.get(response.id);
      if (!pending) continue;
      this.#pending.delete(response.id);
      clearTimeout(pending.timeout);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new NativeTerminalRemoteError(response.error));
    }
    if (Buffer.byteLength(this.#buffer) > NATIVE_TERMINAL_MAX_FRAME_BYTES) {
      this.#socket.destroy(new Error("terminal host response exceeds the frame limit"));
    }
  }

  #fail(error: Error): void {
    if (!this.#closed) this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
