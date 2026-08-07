import { randomUUID } from "node:crypto";

import type { PtyHandle, PtySpawner } from "../pty.js";
import {
  TerminalReplayBuffer,
  type TerminalOutputChunk,
  type TerminalReplayGap,
} from "./replay-buffer.js";
import {
  NATIVE_TERMINAL_DEFAULT_MAX_SESSIONS,
  NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS,
  NATIVE_TERMINAL_MAX_SESSIONS,
  type NativeTerminalStopSignal,
} from "./protocol.js";

export type NativeTerminalExit = Readonly<{
  exitCode: number;
  signal?: number;
}>;

export type NativeTerminalSessionStatus = "running" | "stopping" | "exited";

export type NativeTerminalSessionState = Readonly<{
  id: string;
  generation: string;
  incarnation: string;
  pid: number;
  status: NativeTerminalSessionStatus;
  latestSeq: number;
  exit: NativeTerminalExit | null;
  stopSignal: string | null;
}>;

export type NativeTerminalReplay = Readonly<{
  generation: string;
  incarnation: string;
  chunks: ReadonlyArray<TerminalOutputChunk>;
  gap: TerminalReplayGap | null;
  latestSeq: number;
}>;

export type NativeTerminalObserverAttachment = Readonly<{
  role: "observer";
  id: string;
  generation: string;
  incarnation: string;
  controllerEpoch: number;
}>;

export type NativeTerminalControllerLease = Readonly<{
  role: "controller";
  id: string;
  generation: string;
  incarnation: string;
  controllerId: string;
  epoch: number;
}>;

export type NativeTerminalControllerState = Readonly<{
  id: string;
  generation: string;
  incarnation: string;
  controllerEpoch: number;
}>;

export type NativeTerminalCreateOptions = Readonly<{
  id: string;
  command: string;
  args: ReadonlyArray<string>;
  cwd: string;
  env: Readonly<Record<string, string>>;
  cols: number;
  rows: number;
}>;

type SessionRecord = {
  readonly id: string;
  readonly incarnation: string;
  readonly pty: PtyHandle;
  readonly replay: TerminalReplayBuffer;
  status: NativeTerminalSessionStatus;
  exit: NativeTerminalExit | null;
  stopSignal: string | null;
  controllerId: string | null;
  controllerEpoch: number;
  dataSubscription?: { dispose(): void };
  exitSubscription?: { dispose(): void };
};

export class NativeTerminalHost {
  readonly #generation: string;
  readonly #replayBytesPerSession: number;
  readonly #maxSessions: number;
  readonly #spawner: PtySpawner;
  readonly #sessions = new Map<string, SessionRecord>();

  constructor(options: {
    generation: string;
    replayBytesPerSession: number;
    maxSessions?: number;
    spawner: PtySpawner;
  }) {
    if (
      options.generation.trim().length === 0 ||
      options.generation.length > NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS
    ) {
      throw new RangeError(
        `terminal host generation must contain 1-${NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS} characters`,
      );
    }
    // Validate the budget once, before the first process is spawned.
    new TerminalReplayBuffer(options.replayBytesPerSession);
    const maxSessions =
      options.maxSessions ?? NATIVE_TERMINAL_DEFAULT_MAX_SESSIONS;
    if (
      !Number.isSafeInteger(maxSessions) ||
      maxSessions <= 0 ||
      maxSessions > NATIVE_TERMINAL_MAX_SESSIONS
    ) {
      throw new RangeError(
        `maxSessions must be between 1 and ${NATIVE_TERMINAL_MAX_SESSIONS}`,
      );
    }
    this.#generation = options.generation;
    this.#replayBytesPerSession = options.replayBytesPerSession;
    this.#maxSessions = maxSessions;
    this.#spawner = options.spawner;
  }

  get generation(): string {
    return this.#generation;
  }

  create(options: NativeTerminalCreateOptions): NativeTerminalSessionState {
    if (
      options.id.trim().length === 0 ||
      options.id.length > NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS
    ) {
      throw new RangeError(
        `terminal session id must contain 1-${NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS} characters`,
      );
    }
    const existing = this.#sessions.get(options.id);
    if (existing?.status === "exited") {
      this.#forget(existing);
    } else if (existing) {
      throw new Error(`terminal session already exists: ${options.id}`);
    }
    this.#reapExitedUntilBelowLimit();
    if (this.#sessions.size >= this.#maxSessions) {
      throw new Error(
        `terminal host session limit reached: ${this.#maxSessions}`,
      );
    }

    const record: SessionRecord = {
      id: options.id,
      incarnation: randomUUID(),
      pty: this.#spawner(options),
      replay: new TerminalReplayBuffer(this.#replayBytesPerSession),
      status: "running",
      exit: null,
      stopSignal: null,
      controllerId: null,
      controllerEpoch: 0,
    };
    this.#sessions.set(record.id, record);

    record.dataSubscription = record.pty.onData((data) => {
      if (record.exit !== null || data.length === 0) return;
      record.replay.append(data);
    });
    record.exitSubscription = record.pty.onExit((event) => {
      if (record.exit !== null) return;
      const exit: { exitCode: number; signal?: number } = {
        exitCode: event.exitCode,
      };
      if (event.signal !== undefined) exit.signal = event.signal;
      record.exit = Object.freeze(exit);
      record.status = "exited";
      this.#invalidateController(record);
      record.dataSubscription?.dispose();
      record.exitSubscription?.dispose();
    });

    return this.#snapshot(record);
  }

  list(): ReadonlyArray<NativeTerminalSessionState> {
    return Object.freeze(
      [...this.#sessions.values()].map((record) => this.#snapshot(record)),
    );
  }

  state(id: string): NativeTerminalSessionState {
    return this.#snapshot(this.#requireSession(id));
  }

  readOutput(id: string, afterSeq: number): NativeTerminalReplay {
    const record = this.#requireSession(id);
    const replay = record.replay.readAfter(afterSeq);
    return Object.freeze({
      generation: this.#generation,
      incarnation: record.incarnation,
      ...replay,
    });
  }

  attachObserver(id: string): NativeTerminalObserverAttachment {
    const record = this.#requireSession(id);
    return Object.freeze({
      role: "observer",
      id,
      generation: this.#generation,
      incarnation: record.incarnation,
      controllerEpoch: record.controllerEpoch,
    });
  }

  acquireController(
    id: string,
    controllerId: string,
  ): NativeTerminalControllerLease {
    const record = this.#requireControllableSession(id);
    if (
      controllerId.trim().length === 0 ||
      controllerId.length > NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS
    ) {
      throw new RangeError(
        `terminal controller id must contain 1-${NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS} characters`,
      );
    }
    if (record.controllerId !== null) {
      throw new Error(`terminal session already has a controller: ${id}`);
    }
    record.controllerEpoch += 1;
    record.controllerId = controllerId;
    return Object.freeze({
      role: "controller",
      id,
      generation: this.#generation,
      incarnation: record.incarnation,
      controllerId,
      epoch: record.controllerEpoch,
    });
  }

  releaseController(
    lease: NativeTerminalControllerLease,
  ): NativeTerminalControllerState {
    const record = this.#requireMatchingController(lease);
    this.#invalidateController(record);
    return Object.freeze({
      id: record.id,
      generation: this.#generation,
      incarnation: record.incarnation,
      controllerEpoch: record.controllerEpoch,
    });
  }

  write(lease: NativeTerminalControllerLease, data: string): void {
    if (data.length === 0) {
      throw new RangeError("terminal input must not be empty");
    }
    this.#requireController(lease).pty.write(data);
  }

  resize(
    lease: NativeTerminalControllerLease,
    cols: number,
    rows: number,
  ): void {
    if (
      !Number.isSafeInteger(cols) ||
      cols <= 0 ||
      !Number.isSafeInteger(rows) ||
      rows <= 0
    ) {
      throw new RangeError("terminal dimensions must be positive safe integers");
    }
    this.#requireController(lease).pty.resize(cols, rows);
  }

  stop(
    lease: NativeTerminalControllerLease,
    signal: NativeTerminalStopSignal = "SIGTERM",
  ): NativeTerminalSessionState {
    const record = this.#requireMatchingController(lease);
    const previousStatus = record.status;
    const previousSignal = record.stopSignal;
    record.status = "stopping";
    record.stopSignal = signal;
    try {
      record.pty.kill(signal);
    } catch (error) {
      record.status = previousStatus;
      record.stopSignal = previousSignal;
      throw error;
    }
    return this.#snapshot(record);
  }

  stopAll(
    signal: NativeTerminalStopSignal = "SIGTERM",
  ): ReadonlyArray<NativeTerminalSessionState> {
    for (const record of this.#sessions.values()) {
      if (record.status !== "running") continue;
      record.status = "stopping";
      record.stopSignal = signal;
      this.#invalidateController(record);
      try {
        record.pty.kill(signal);
      } catch (error) {
        record.status = "running";
        record.stopSignal = null;
        throw error;
      }
    }
    return this.list();
  }

  forceStopAll(
    signal: NativeTerminalStopSignal = "SIGKILL",
  ): ReadonlyArray<NativeTerminalSessionState> {
    const errors: unknown[] = [];
    for (const record of this.#sessions.values()) {
      if (record.status === "exited") continue;
      if (record.status === "running") {
        record.status = "stopping";
        this.#invalidateController(record);
      }
      record.stopSignal = signal;
      try {
        record.pty.kill(signal);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "failed to force-stop one or more terminal sessions");
    }
    return this.list();
  }

  #requireSession(id: string): SessionRecord {
    const record = this.#sessions.get(id);
    if (!record) throw new Error(`unknown terminal session: ${id}`);
    return record;
  }

  #requireControllableSession(id: string): SessionRecord {
    const record = this.#requireSession(id);
    if (record.status === "exited") {
      throw new Error(`terminal session is already exited: ${id}`);
    }
    return record;
  }

  #requireController(lease: NativeTerminalControllerLease): SessionRecord {
    const record = this.#requireMatchingController(lease);
    if (record.status !== "running") {
      throw new Error("stale terminal controller lease");
    }
    return record;
  }

  #requireMatchingController(
    lease: NativeTerminalControllerLease,
  ): SessionRecord {
    const record = this.#sessions.get(lease.id);
    if (
      lease.generation !== this.#generation ||
      !record ||
      lease.incarnation !== record.incarnation ||
      record.status === "exited" ||
      record.controllerId !== lease.controllerId ||
      record.controllerEpoch !== lease.epoch
    ) {
      throw new Error("stale terminal controller lease");
    }
    return record;
  }

  #reapExitedUntilBelowLimit(): void {
    if (this.#sessions.size < this.#maxSessions) return;
    for (const record of this.#sessions.values()) {
      if (record.status !== "exited") continue;
      this.#forget(record);
      if (this.#sessions.size < this.#maxSessions) return;
    }
  }

  #forget(record: SessionRecord): void {
    record.dataSubscription?.dispose();
    record.exitSubscription?.dispose();
    delete record.dataSubscription;
    delete record.exitSubscription;
    this.#sessions.delete(record.id);
  }

  #invalidateController(record: SessionRecord): void {
    if (record.controllerId === null) return;
    record.controllerId = null;
    record.controllerEpoch += 1;
  }

  #snapshot(record: SessionRecord): NativeTerminalSessionState {
    return Object.freeze({
      id: record.id,
      generation: this.#generation,
      incarnation: record.incarnation,
      pid: record.pty.pid,
      status: record.status,
      latestSeq: record.replay.latestSeq,
      exit: record.exit,
      stopSignal: record.stopSignal,
    });
  }
}
