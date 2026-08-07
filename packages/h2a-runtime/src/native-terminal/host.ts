import type { PtyHandle, PtySpawner } from "../pty.js";
import {
  TerminalReplayBuffer,
  type TerminalOutputChunk,
  type TerminalReplayGap,
} from "./replay-buffer.js";

export type NativeTerminalExit = Readonly<{
  exitCode: number;
  signal?: number;
}>;

export type NativeTerminalSessionStatus = "running" | "exited" | "stopped";

export type NativeTerminalSessionState = Readonly<{
  id: string;
  generation: string;
  status: NativeTerminalSessionStatus;
  latestSeq: number;
  exit: NativeTerminalExit | null;
  stopSignal: string | null;
}>;

export type NativeTerminalReplay = Readonly<{
  generation: string;
  chunks: ReadonlyArray<TerminalOutputChunk>;
  gap: TerminalReplayGap | null;
  latestSeq: number;
}>;

export type NativeTerminalObserverAttachment = Readonly<{
  role: "observer";
  id: string;
  generation: string;
  controllerEpoch: number;
}>;

export type NativeTerminalControllerLease = Readonly<{
  role: "controller";
  id: string;
  generation: string;
  controllerId: string;
  epoch: number;
}>;

export type NativeTerminalControllerState = Readonly<{
  id: string;
  generation: string;
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
  readonly #spawner: PtySpawner;
  readonly #sessions = new Map<string, SessionRecord>();

  constructor(options: {
    generation: string;
    replayBytesPerSession: number;
    spawner: PtySpawner;
  }) {
    if (options.generation.trim().length === 0) {
      throw new RangeError("terminal host generation must not be empty");
    }
    // Validate the budget once, before the first process is spawned.
    new TerminalReplayBuffer(options.replayBytesPerSession);
    this.#generation = options.generation;
    this.#replayBytesPerSession = options.replayBytesPerSession;
    this.#spawner = options.spawner;
  }

  create(options: NativeTerminalCreateOptions): NativeTerminalSessionState {
    if (options.id.trim().length === 0) {
      throw new RangeError("terminal session id must not be empty");
    }
    if (this.#sessions.has(options.id)) {
      throw new Error(`terminal session already exists: ${options.id}`);
    }

    const record: SessionRecord = {
      id: options.id,
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
      if (record.status === "running") record.status = "exited";
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
    const replay = this.#requireSession(id).replay.readAfter(afterSeq);
    return Object.freeze({ generation: this.#generation, ...replay });
  }

  attachObserver(id: string): NativeTerminalObserverAttachment {
    const record = this.#requireSession(id);
    return Object.freeze({
      role: "observer",
      id,
      generation: this.#generation,
      controllerEpoch: record.controllerEpoch,
    });
  }

  acquireController(
    id: string,
    controllerId: string,
  ): NativeTerminalControllerLease {
    const record = this.#requireRunningSession(id);
    if (controllerId.trim().length === 0) {
      throw new RangeError("terminal controller id must not be empty");
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
      controllerId,
      epoch: record.controllerEpoch,
    });
  }

  releaseController(
    lease: NativeTerminalControllerLease,
  ): NativeTerminalControllerState {
    const record = this.#requireController(lease);
    this.#invalidateController(record);
    return Object.freeze({
      id: record.id,
      generation: this.#generation,
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

  stop(id: string, signal = "SIGTERM"): NativeTerminalSessionState {
    const record = this.#requireSession(id);
    if (record.status !== "running") return this.#snapshot(record);

    record.status = "stopped";
    record.stopSignal = signal;
    this.#invalidateController(record);
    record.pty.kill(signal);
    return this.#snapshot(record);
  }

  #requireSession(id: string): SessionRecord {
    const record = this.#sessions.get(id);
    if (!record) throw new Error(`unknown terminal session: ${id}`);
    return record;
  }

  #requireRunningSession(id: string): SessionRecord {
    const record = this.#requireSession(id);
    if (record.status !== "running") {
      throw new Error(`terminal session is not running: ${id}`);
    }
    return record;
  }

  #requireController(lease: NativeTerminalControllerLease): SessionRecord {
    const record = this.#sessions.get(lease.id);
    if (
      lease.generation !== this.#generation ||
      !record ||
      record.status !== "running" ||
      record.controllerId !== lease.controllerId ||
      record.controllerEpoch !== lease.epoch
    ) {
      throw new Error("stale terminal controller lease");
    }
    return record;
  }

  #invalidateController(record: SessionRecord): void {
    if (record.controllerId === null) return;
    record.controllerId = null;
    record.controllerEpoch += 1;
  }

  #snapshot(record: SessionRecord): NativeTerminalSessionState {
    const { latestSeq } = record.replay.readAfter(0);
    return Object.freeze({
      id: record.id,
      generation: this.#generation,
      status: record.status,
      latestSeq,
      exit: record.exit,
      stopSignal: record.stopSignal,
    });
  }
}
