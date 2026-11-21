import { writeSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

import type { NativeTerminalClient } from "./client.js";
import type {
  NativeTerminalControllerLease,
  NativeTerminalReplay,
  NativeTerminalSessionState,
} from "./host.js";
import { NativeTerminalRemoteError } from "./protocol.js";
import { TerminalModeTracker } from "./terminal-modes.js";
import { TerminalResetRelay } from "./reset-relay.js";
import {
  appendCrashLog,
  crashSignalName,
  type CrashLogEntry,
} from "../crash-log.js";
import type { NativeStatusBarLinkState } from "../status-projection.js";

export const ATTACH_PENDING_INPUT_MAX_BYTES = 64 * 1024;

export type NativeTerminalAttachClient = Pick<
  NativeTerminalClient,
  | "readOutput"
  | "state"
  | "acquireController"
  | "releaseController"
  | "write"
  | "resize"
  | "close"
>;

export type ActiveAttachConnection = {
  client: NativeTerminalAttachClient;
  lease: NativeTerminalControllerLease;
};

export interface SessionViewStatusBar {
  childRows(): number | undefined;
  probe(force?: boolean, linkState?: NativeStatusBarLinkState): Promise<void>;
  onResize(): void;
  flushAfterOutputBatch(): void;
  flushPendingSequence(): string;
  resumeAfterReset(): void;
  dispose(): void;
  peekRestoreSequence(): string;
  restoreSequence(): string;
  transformChildOutput(data: string): string;
}

/**
 * Build the crash-log record for an observed session exit. Only observed
 * values are recorded: `exitCode` comes from the session's exit report and
 * `signal` from the stop order (`stopSignal`) or the pty exit signal. Either
 * field is omitted when unknown — never defaulted to 0/1.
 */
export function sessionExitCrashEntry(
  state: Pick<NativeTerminalSessionState, "exit" | "stopSignal">,
  options: {
    sessionId: string;
    reason?: string | undefined;
    detail?: string | undefined;
  },
): CrashLogEntry {
  const exitCode = state.exit?.exitCode;
  const signal =
    state.stopSignal ?? crashSignalName(state.exit?.signal ?? undefined);
  return {
    event: "sessionExit",
    sessionId: options.sessionId,
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.detail ? { detail: options.detail } : {}),
    ...(typeof exitCode === "number" && Number.isSafeInteger(exitCode)
      ? { exitCode }
      : {}),
    ...(signal ? { signal } : {}),
  };
}

export type NativeSessionViewOptions = {
  readonly sessionId: string;
  readonly stdout: NodeJS.WriteStream;
  readonly now: () => number;
  readonly tty: string;
  readonly statusBar: SessionViewStatusBar;
  readonly takeover?: boolean | undefined;
  readonly saveTerminalReset?: ((sequence: string) => void) | undefined;
  readonly getChildCols?: (() => number | undefined) | undefined;
  readonly onCrashLog?: ((entry: CrashLogEntry) => void) | undefined;
};

/**
 * Re-entrant state for a single attached native PTY session view.
 *
 * Extracted from `runAttach` (S0) without changing attach behavior: every
 * piece of per-session state (sessionId, mode tracker, reset relay, output
 * sequence cursor, controller connection, pending input queue, and exit/end
 * flags) lives on this instance with no closure over an outer session id.
 */
export class NativeSessionView {
  readonly sessionId: string;
  readonly stdout: NodeJS.WriteStream;
  readonly statusBar: SessionViewStatusBar;
  readonly #now: () => number;
  readonly #tty: string;
  readonly #saveTerminalReset: ((sequence: string) => void) | undefined;
  readonly #getChildCols: () => number | undefined;
  readonly #logCrash: (entry: CrashLogEntry) => void;

  modes: TerminalModeTracker;
  modesSuspended = false;
  #savedReset = "";
  resetRelay: TerminalResetRelay;
  detached = false;
  terminalEnded = false;
  exitCode = 0;
  active: ActiveAttachConnection | undefined;
  transportFailure: unknown;
  interruptedAt: number | undefined;
  pendingInputBytes = 0;
  readonly pendingInput: Buffer[] = [];
  readonly #inputDecoder = new StringDecoder("utf8");
  #inputPump: Promise<void> | undefined;
  takeoverPending: boolean;
  seq = 0;

  constructor(options: NativeSessionViewOptions) {
    this.sessionId = options.sessionId;
    this.stdout = options.stdout;
    this.statusBar = options.statusBar;
    this.#now = options.now;
    this.#tty = options.tty;
    this.#saveTerminalReset = options.saveTerminalReset;
    this.#getChildCols =
      options.getChildCols ?? (() => this.stdout.columns);
    this.#logCrash =
      options.onCrashLog ??
      ((entry) => appendCrashLog("attach", entry));
    this.takeoverPending = options.takeover === true;
    this.modes = new TerminalModeTracker();
    // Older protocol-v1 hosts relay the wrapper marker verbatim. New hosts
    // consume it themselves so detached sessions also return to a clean shell.
    this.resetRelay = new TerminalResetRelay(
      (data) => this.relayOutput(data),
      () => this.modes.resetSequence(),
    );
  }

  saveReset(): void {
    const reset = this.modesSuspended
      ? ""
      : `${this.statusBar.peekRestoreSequence()}${this.modes.resetSequence()}`;
    if (reset === this.#savedReset) return;
    this.#saveTerminalReset?.(reset);
    this.#savedReset = reset;
  }

  restoreBarForNotice(): void {
    const pending = this.statusBar.flushPendingSequence();
    const barRestore = this.statusBar.restoreSequence();
    const seq = `${pending}${barRestore}`;
    if (seq) this.stdout.write(seq);
  }

  relayOutput(data: string): void {
    this.modes.feed(data);
    this.stdout.write(this.statusBar.transformChildOutput(data));
    this.saveReset();
  }

  feedReplay(replay: NativeTerminalReplay): void {
    if (replay.gap) {
      this.resetModes();
      this.modes = new TerminalModeTracker();
      this.resetRelay = new TerminalResetRelay(
        (data) => this.relayOutput(data),
        () => this.modes.resetSequence(),
      );
      this.modesSuspended = false;
      this.statusBar.resumeAfterReset();
      if (replay.terminalModePrefix) {
        this.resetRelay.feed(replay.terminalModePrefix);
      }
    }
    for (const chunk of replay.chunks) {
      this.resetRelay.feed(chunk.data);
      this.seq = chunk.seq;
    }
    this.statusBar.flushAfterOutputBatch();
  }

  flushRelay(): void {
    this.resetRelay.flush();
  }

  resetModes(): void {
    if (this.modesSuspended) return;
    this.modesSuspended = true;
    const pending = this.statusBar.flushPendingSequence();
    const barRestore = this.statusBar.restoreSequence();
    const reset = this.modes.resetSequence();
    const sequence = `${pending}${barRestore}${reset}`;
    if (!sequence) {
      this.saveReset();
      return;
    }
    // Signals and fatal exits cannot wait for an asynchronous pipe flush.
    const fd = (this.stdout as NodeJS.WriteStream & { fd?: number }).fd;
    if (typeof fd === "number") writeSync(fd, sequence);
    else this.stdout.write(sequence);
    this.saveReset();
  }

  controllerChanged(
    state: NativeTerminalSessionState,
    lease: NativeTerminalControllerLease,
  ): boolean {
    if (state.status === "exited" && !state.stopSignal) return false;
    if (
      state.generation === lease.generation &&
      state.incarnation === lease.incarnation &&
      (state.controllerEpoch === undefined ||
        state.controllerEpoch === lease.epoch)
    ) {
      return false;
    }
    const reason = state.stopSignal
      ? `session stopped (${state.stopSignal})`
      : state.status === "exited"
        ? "session exited"
        : state.controller
          ? `controller taken over by pid=${state.controller.pid ?? "unknown"} tty=${state.controller.tty} since=${state.controller.since}`
          : "controller released or session replaced";
    this.restoreBarForNotice();
    this.stdout.write(`\r\n[h2a] ${reason}; attach detached\r\n`);
    this.exitCode =
      state.status === "exited" && !state.stopSignal
        ? (state.exit?.exitCode ?? 0)
        : 0;
    if (state.status === "exited") {
      this.#logCrash(
        sessionExitCrashEntry(state, {
          sessionId: this.sessionId,
          detail: reason,
        }),
      );
    } else {
      this.#logCrash({
        event: "refusal",
        sessionId: this.sessionId,
        reason: "controller-changed",
        detail: reason,
      });
    }
    this.terminalEnded = true;
    return true;
  }

  closeActive(): void {
    const current = this.active;
    this.active = undefined;
    current?.client.close();
  }

  markTransportFailure(
    connection: ActiveAttachConnection,
    error: unknown,
    inputDeliveryUncertain = false,
  ): void {
    if (inputDeliveryUncertain && !this.detached) {
      this.#logCrash({
        event: "refusal",
        sessionId: this.sessionId,
        reason: "input-delivery-uncertain",
        detail:
          "terminal input delivery became uncertain during reconnect; " +
          "the in-flight chunk was not replayed to avoid duplicate input",
      });
    }
    // A request from the previous socket may settle after recovery. Fence that
    // stale failure so it can never tear down the newly-acquired controller.
    if (this.active !== connection) return;
    if (
      error instanceof NativeTerminalRemoteError &&
      error.message === "stale terminal controller lease"
    ) {
      this.restoreBarForNotice();
      this.stdout.write(
        "\r\n[h2a] controller revoked by takeover or stop; attach detached\r\n",
      );
      this.#logCrash({
        event: "refusal",
        sessionId: this.sessionId,
        reason: "stale-controller-lease",
      });
      this.terminalEnded = true;
      this.closeActive();
      return;
    }
    if (this.transportFailure === undefined) {
      this.transportFailure = error;
      this.interruptedAt = this.#now();
    }
    this.closeActive();
  }

  pumpInput(): void {
    if (
      this.#inputPump !== undefined ||
      this.detached ||
      this.active === undefined
    ) {
      return;
    }
    this.#inputPump = (async () => {
      while (!this.detached && this.pendingInput.length > 0) {
        const current = this.active;
        if (current === undefined) return;
        const chunk = this.pendingInput[0]!;
        const decoded = this.#inputDecoder.write(chunk);
        try {
          if (decoded.length > 0) {
            await current.client.write(current.lease, decoded);
          }
          this.pendingInput.shift();
          this.pendingInputBytes -= chunk.length;
        } catch (error) {
          // The host may have accepted the write before the response path
          // broke. Drop this ONE uncertain chunk with an explicit warning;
          // replaying it could duplicate a command. Later queued input stays
          // ordered and is delivered only after a fresh exclusive lease.
          this.pendingInput.shift();
          this.pendingInputBytes -= chunk.length;
          this.markTransportFailure(current, error, true);
          return;
        }
      }
    })().finally(() => {
      this.#inputPump = undefined;
      if (
        !this.detached &&
        this.active !== undefined &&
        this.pendingInput.length > 0
      ) {
        this.pumpInput();
      }
    });
  }

  pushInput(chunk: Buffer): void {
    this.pendingInput.push(chunk);
    this.pendingInputBytes += chunk.length;
    this.pumpInput();
  }

  enqueueInput(
    chunk: Buffer,
    maxPendingBytes = ATTACH_PENDING_INPUT_MAX_BYTES,
  ): boolean {
    if (this.pendingInputBytes + chunk.length > maxPendingBytes) {
      return false;
    }
    this.pushInput(chunk);
    return true;
  }

  async drainInputPump(): Promise<void> {
    if (this.#inputPump !== undefined) {
      await this.#inputPump.catch(() => {});
    }
  }

  sendChildResize(): void {
    const current = this.active;
    const rows = this.statusBar.childRows();
    const cols = this.#getChildCols();
    if (current && cols && rows) {
      void current.client
        .resize(current.lease, cols, rows)
        .catch((error) => this.markTransportFailure(current, error));
    }
  }

  async connectAndAcquire(
    connect: () => Promise<NativeTerminalAttachClient>,
    afterAcquire?: () => void,
  ): Promise<NativeTerminalSessionState> {
    const client = await connect();
    try {
      const state = await client.state(this.sessionId);
      if (state.status === "exited") {
        client.close();
        return state;
      }
      const lease = await client.acquireController(
        this.sessionId,
        `h2a-attach-${process.pid}`,
        "human",
        { takeover: this.takeoverPending, pid: process.pid, tty: this.#tty },
      );
      // A reconnect must never take the terminal back from a newer attach.
      this.takeoverPending = false;
      this.active = { client, lease };
      this.transportFailure = undefined;
      await this.statusBar.probe(true, "attached");
      afterAcquire?.();
      this.sendChildResize();
      this.saveReset();
      this.pumpInput();
      return state;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  async releaseActive(): Promise<void> {
    const current = this.active;
    this.active = undefined;
    if (current !== undefined) {
      await current.client.releaseController(current.lease).catch(() => {});
      current.client.close();
    }
  }

  dispose(): void {
    this.statusBar.dispose();
  }
}

export function createSessionView(
  options: NativeSessionViewOptions,
): NativeSessionView {
  return new NativeSessionView(options);
}
