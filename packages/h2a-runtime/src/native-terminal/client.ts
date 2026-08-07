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
  NATIVE_TERMINAL_MAX_FRAME_BYTES,
  NATIVE_TERMINAL_PROTOCOL_VERSION,
  NativeTerminalRemoteError,
  isRecord,
  type NativeTerminalPing,
  type NativeTerminalRequest,
  type NativeTerminalResponse,
} from "./protocol.js";

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export class NativeTerminalClient {
  readonly #socket: Socket;
  readonly #pending = new Map<string, PendingRequest>();
  #buffer = "";
  #closed = false;

  private constructor(socket: Socket) {
    this.#socket = socket;
    socket.setNoDelay(true);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.#onData(chunk));
    socket.on("error", (error) => this.#fail(error));
    socket.on("close", () => this.#fail(new Error("terminal host connection closed")));
  }

  static connect(socketPath: string): Promise<NativeTerminalClient> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(socketPath);
      const onError = (error: Error): void => {
        socket.removeListener("connect", onConnect);
        socket.destroy();
        reject(error);
      };
      const onConnect = (): void => {
        socket.removeListener("error", onError);
        resolve(new NativeTerminalClient(socket));
      };
      socket.once("error", onError);
      socket.once("connect", onConnect);
    });
  }

  ping(): Promise<NativeTerminalPing> {
    return this.#request("ping") as Promise<NativeTerminalPing>;
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

  stop(id: string, signal?: string): Promise<NativeTerminalSessionState> {
    return this.#request("stop", signal === undefined ? { id } : { id, signal }) as Promise<NativeTerminalSessionState>;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#socket.end();
    this.#fail(new Error("terminal host client closed"));
  }

  #request(operation: NativeTerminalRequest["operation"], params?: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error("terminal host client is closed"));
    const id = randomUUID();
    const request: NativeTerminalRequest = params === undefined
      ? { version: NATIVE_TERMINAL_PROTOCOL_VERSION, id, operation }
      : { version: NATIVE_TERMINAL_PROTOCOL_VERSION, id, operation, params };
    const frame = `${JSON.stringify(request)}\n`;
    if (Buffer.byteLength(frame) > NATIVE_TERMINAL_MAX_FRAME_BYTES) {
      return Promise.reject(new RangeError("terminal host request exceeds the frame limit"));
    }
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.write(frame, (error) => {
        if (!error) return;
        this.#pending.delete(id);
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
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new NativeTerminalRemoteError(response.error));
    }
    if (Buffer.byteLength(this.#buffer) > NATIVE_TERMINAL_MAX_FRAME_BYTES) {
      this.#socket.destroy(new Error("terminal host response exceeds the frame limit"));
    }
  }

  #fail(error: Error): void {
    if (!this.#closed) this.#closed = true;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}
