import { writeSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

import { NativeTerminalRequestTimeoutError } from "./client.js";
import type { NativeTerminalClient } from "./client.js";
import type {
  NativeTerminalControllerLease,
  NativeTerminalReplay,
  NativeTerminalSessionState,
} from "./host.js";
import { NativeTerminalRemoteError } from "./protocol.js";
import {
  H2A_OUTER_MOUSE_ENABLE,
  H2A_OUTER_MOUSE_RESET,
  TerminalModeTracker,
} from "./terminal-modes.js";
import { TerminalResetRelay } from "./reset-relay.js";
import { ReplayFilter } from "./replay-filter.js";
import {
  OBSERVER_INPUT_PENDING_TIMEOUT_MS,
  ObserverInputClassifier,
} from "./observer-input.js";
import { TerminalUndoRegistry } from "./attach-recovery.js";
import {
  appendCrashLog,
  crashSignalName,
  type CrashLogEntry,
} from "../crash-log.js";
import type { NativeStatusBarLinkState } from "../status-projection.js";

export const ATTACH_PENDING_INPUT_MAX_BYTES = 64 * 1024;
export const REMOTE_OBSERVER_BANNER =
  "remote control active — remote.sent-tech.ca — type to take back";

/** The host answered "no such session", or its endpoint is provably gone. */
export function isDefinitiveNativeTerminalAbsence(error: unknown): boolean {
  if (
    error instanceof NativeTerminalRemoteError &&
    error.message.includes("unknown terminal session")
  ) {
    return true;
  }
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ECONNREFUSED";
}

export function isStateRequestTimeout(error: unknown): boolean {
  return (
    error instanceof NativeTerminalRequestTimeoutError ||
    (error instanceof Error && error.name === "NativeTerminalRequestTimeoutError")
  );
}

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
  setObserverBanner?(banner: string | undefined, repaint?: boolean): boolean;
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

/**
 * Why a view lost its controller. A station turns this into a card and keeps
 * running; a plain attach keeps its historical notice and exits.
 */
export type SessionViewControllerLoss = Readonly<{
  kind: "controller-changed" | "stale-lease";
  reason: string;
  state?: NativeTerminalSessionState;
}>;

export type NativeSessionViewOptions = {
  readonly sessionId: string;
  readonly stdout: NodeJS.WriteStream;
  readonly now: () => number;
  readonly delay?: ((ms: number) => Promise<void>) | undefined;
  readonly tty: string;
  readonly statusBar: SessionViewStatusBar;
  readonly takeover?: boolean | undefined;
  readonly remoteObserver?: boolean | undefined;
  readonly ownOuterMouse?: boolean | undefined;
  readonly saveTerminalReset?: ((sequence: string) => void) | undefined;
  readonly getChildCols?: (() => number | undefined) | undefined;
  readonly onCrashLog?: ((entry: CrashLogEntry) => void) | undefined;
  /** Controller id presented to the host (default: the attach identity). */
  readonly controllerId?: string | undefined;
  /**
   * Station hook (S1): when set, a lost controller is reported here instead of
   * printing the attach notice. The view still ends; the station does not.
   */
  readonly onControllerLost?:
    | ((loss: SessionViewControllerLoss) => void)
    | undefined;
  /**
   * Station hook (S1.6): return false to skip a resize the session already
   * has. An equal-size resize is never sent twice for a displayed session.
   */
  readonly resizeGate?: ((cols: number, rows: number) => boolean) | undefined;
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
  readonly #delay: (ms: number) => Promise<void>;
  readonly #tty: string;
  readonly #remoteObserver: boolean;
  readonly #ownOuterMouse: boolean;
  readonly #saveTerminalReset: ((sequence: string) => void) | undefined;
  readonly #getChildCols: () => number | undefined;
  readonly #logCrash: (entry: CrashLogEntry) => void;
  readonly #controllerId: string;
  readonly #onControllerLost:
    | ((loss: SessionViewControllerLoss) => void)
    | undefined;
  readonly #resizeGate: ((cols: number, rows: number) => boolean) | undefined;

  readonly undoRegistry = new TerminalUndoRegistry();
  modes: TerminalModeTracker;
  modesSuspended = false;
  resetRelay: TerminalResetRelay;
  detached = false;
  terminalEnded = false;
  exitCode = 0;
  active: ActiveAttachConnection | undefined;
  observing = false;
  wasObservingBeforeReconnect = false;
  observerClient: NativeTerminalAttachClient | undefined;
  observerIncarnation: { generation: string; incarnation: string } | undefined;
  #observerFilter: ReplayFilter | undefined;
  readonly #observerInput = new ObserverInputClassifier();
  #pendingInputTimerToken = 0;
  #takebackInFlight: Promise<void> | undefined;
  #discardingPaste = false;
  #bannerNoticeShown = false;
  #inputSuspended = false;
  #afterAcquire: (() => void) | undefined;
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
    this.#delay =
      options.delay ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#tty = options.tty;
    this.#remoteObserver = options.remoteObserver === true;
    this.#ownOuterMouse = options.ownOuterMouse === true;
    this.#saveTerminalReset = options.saveTerminalReset;
    this.#getChildCols =
      options.getChildCols ?? (() => this.stdout.columns);
    this.#logCrash =
      options.onCrashLog ??
      ((entry) => appendCrashLog("attach", entry));
    this.#controllerId = options.controllerId ?? `h2a-attach-${process.pid}`;
    this.#onControllerLost = options.onControllerLost;
    this.#resizeGate = options.resizeGate;
    this.takeoverPending = options.takeover === true;
    this.modes = new TerminalModeTracker();
    // Older protocol-v1 hosts relay the wrapper marker verbatim. New hosts
    // consume it themselves so detached sessions also return to a clean shell.
    this.resetRelay = new TerminalResetRelay(
      (data) => this.relayOutput(data),
      () => this.modes.resetSequence({ excludeMouse: this.#ownOuterMouse }),
    );
  }

  /**
   * Register an h2a-owned terminal state undo sequence and publish the updated
   * receipt STRICTLY BEFORE writing the activation sequence to stdout.
   */
  activateOuterState(
    slot: string,
    undoSequence: string,
    activationSequence: string,
  ): void {
    this.undoRegistry.set(slot, undoSequence);
    this.saveReset();
    if (activationSequence) {
      this.stdout.write(activationSequence);
    }
  }

  /** Enable h2a-owned whole-attach outer mouse tracking (?1000h ?1006h). */
  enableOuterMouse(): void {
    if (!this.#ownOuterMouse) return;
    this.undoRegistry.set("h2a-hygiene", "\x1b[4l\x1b[?6l\x1b[r\x1b[0m");
    this.activateOuterState(
      "h2a-mouse",
      H2A_OUTER_MOUSE_RESET,
      H2A_OUTER_MOUSE_ENABLE,
    );
  }

  saveReset(): void {
    if (this.modesSuspended) {
      this.undoRegistry.clear();
      this.undoRegistry.publish(this.#saveTerminalReset);
      return;
    }
    this.undoRegistry.set("status-bar", this.statusBar.peekRestoreSequence());
    this.undoRegistry.set(
      "child-modes",
      this.modes.resetSequence({ excludeMouse: this.#ownOuterMouse }),
    );
    this.undoRegistry.publish(this.#saveTerminalReset);
  }

  restoreBarForNotice(): void {
    const pending = this.statusBar.flushPendingSequence();
    const barRestore = this.statusBar.restoreSequence();
    const seq = `${pending}${barRestore}`;
    if (seq) this.stdout.write(seq);
  }

  relayOutput(data: string): void {
    if (this.#ownOuterMouse) {
      const filtered = this.modes.feedAndFilterOuterMouse(data);
      // Pre-publish child mode undos BEFORE relaying activation bytes to stdout.
      this.saveReset();
      const transformed = this.statusBar.transformChildOutput(filtered);
      if (transformed) this.stdout.write(transformed);
      return;
    }
    this.modes.feed(data);
    // Pre-publish child mode undos BEFORE relaying activation bytes to stdout.
    this.saveReset();
    this.stdout.write(this.statusBar.transformChildOutput(data));
  }

  /**
   * Relay a replay. `catchUp` marks retained bytes repainted at a switch (or
   * after a retention gap): terminal queries and one-shot side effects are
   * removed from them, never from live output (S1.5, INJ D10 (b)).
   */
  feedReplay(
    replay: NativeTerminalReplay,
    options: { catchUp?: boolean } = {},
  ): void {
    const observerFilter = this.observing
      ? (this.#observerFilter ?? (this.#observerFilter = new ReplayFilter()))
      : undefined;
    const catchUpFilter =
      observerFilter === undefined && options.catchUp === true
        ? new ReplayFilter()
        : undefined;
    const filter = observerFilter ?? catchUpFilter;
    if (replay.gap) {
      this.resetModes();
      this.modes = new TerminalModeTracker();
      this.resetRelay = new TerminalResetRelay(
        (data) => this.relayOutput(data),
        () => this.modes.resetSequence({ excludeMouse: this.#ownOuterMouse }),
      );
      this.modesSuspended = false;
      if (this.#ownOuterMouse) {
        this.enableOuterMouse();
      }
      this.statusBar.resumeAfterReset();
      if (this.observing) {
        this.#observerFilter = new ReplayFilter();
      }
      if (replay.terminalModePrefix) {
        this.resetRelay.feed(replay.terminalModePrefix);
      }
    }
    const activeFilter = this.observing ? this.#observerFilter : catchUpFilter;
    for (const chunk of replay.chunks) {
      const data = activeFilter ? activeFilter.filter(chunk.data) : chunk.data;
      if (data) this.resetRelay.feed(data);
      this.seq = chunk.seq;
    }
    if (catchUpFilter) {
      // An unfinished sequence goes out unchanged: live output completes it.
      const tail = catchUpFilter.flush();
      if (tail) this.resetRelay.feed(tail);
    }
    this.statusBar.flushAfterOutputBatch();
  }

  flushRelay(): void {
    this.resetRelay.flush();
    if (this.#ownOuterMouse) {
      const pending = this.modes.flushMouseFilterPending();
      if (pending) {
        this.saveReset();
        const transformed = this.statusBar.transformChildOutput(pending);
        if (transformed) this.stdout.write(transformed);
      }
    }
  }

  resetModes(): void {
    if (this.modesSuspended) return;
    this.modesSuspended = true;
    const pending = this.statusBar.flushPendingSequence();
    const barRestore = this.statusBar.restoreSequence();
    this.undoRegistry.set("status-bar", barRestore);
    this.undoRegistry.set(
      "child-modes",
      this.modes.resetSequence({ excludeMouse: this.#ownOuterMouse }),
    );
    const sequence = `${pending}${this.undoRegistry.compose()}`;
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

  /**
   * Undo this view's outer-terminal state for a station switch (t3): status
   * bar and child modes go, the h2a-owned mouse stays for the whole station.
   * The published receipt keeps covering what h2a still owns.
   */
  leaveForSwitch(): void {
    this.flushRelay();
    if (this.modesSuspended) return;
    this.modesSuspended = true;
    const pending = this.statusBar.flushPendingSequence();
    const barRestore = this.statusBar.restoreSequence();
    const childReset = this.modes.resetSequence({
      excludeMouse: this.#ownOuterMouse,
    });
    const sequence = `${pending}${barRestore}${childReset}`;
    if (sequence) this.stdout.write(sequence);
    this.undoRegistry.delete("status-bar");
    this.undoRegistry.delete("child-modes");
    this.undoRegistry.publish(this.#saveTerminalReset);
  }

  controllerChanged(
    state: NativeTerminalSessionState,
    lease: NativeTerminalControllerLease,
  ): boolean {
    if (this.observing) return false;
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
    if (this.#onControllerLost) {
      this.#onControllerLost({ kind: "controller-changed", reason, state });
    } else {
      this.restoreBarForNotice();
      this.stdout.write(`\r\n[h2a] ${reason}; attach detached\r\n`);
    }
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

  handleRemoteSwitchState(state: NativeTerminalSessionState): boolean {
    if (!this.#remoteObserver || this.observing || this.detached || this.terminalEnded) {
      return false;
    }
    const current = this.active;
    if (!current) return false;
    if (
      state.holderKind === "remote" &&
      state.status === "running" &&
      state.stopSignal === null &&
      state.generation === current.lease.generation &&
      state.incarnation === current.lease.incarnation &&
      state.controllerEpoch !== undefined &&
      state.controllerEpoch !== current.lease.epoch
    ) {
      this.#enterObserverMode(current.client, state);
      return true;
    }
    return false;
  }

  isTakebackInFlight(): boolean {
    return this.#takebackInFlight !== undefined;
  }

  #purgeForObserverOrTakeback(): void {
    this.pendingInput.length = 0;
    this.pendingInputBytes = 0;
    this.#inputDecoder.end();
  }

  #enterObserverMode(
    client: NativeTerminalAttachClient,
    state: NativeTerminalSessionState,
  ): void {
    this.active = undefined;
    this.observerClient = client;
    this.observerIncarnation = {
      generation: state.generation,
      incarnation: state.incarnation,
    };
    this.observing = true;
    this.wasObservingBeforeReconnect = true;
    this.transportFailure = undefined;
    this.#observerFilter = new ReplayFilter();
    this.#observerInput.reset();
    this.#pendingInputTimerToken += 1;
    this.#discardingPaste = false;
    this.#purgeForObserverOrTakeback();
    const handledByBar =
      this.statusBar.setObserverBanner?.(REMOTE_OBSERVER_BANNER) === true;
    if (!handledByBar && !this.#bannerNoticeShown) {
      this.#bannerNoticeShown = true;
      this.stdout.write(`\r\n[h2a] ${REMOTE_OBSERVER_BANNER}\r\n`);
    }
  }

  #exitObserverMode(clearBanner = true): void {
    this.observing = false;
    this.wasObservingBeforeReconnect = false;
    this.observerClient = undefined;
    this.observerIncarnation = undefined;
    this.#pendingInputTimerToken += 1;
    this.#bannerNoticeShown = false;
    const tail = this.#observerFilter?.flush();
    this.#observerFilter = undefined;
    if (tail) {
      this.resetRelay.feed(tail);
    }
    if (clearBanner) {
      this.statusBar.setObserverBanner?.(undefined);
    }
  }

  clearObserverForExit(): void {
    this.observing = false;
    this.wasObservingBeforeReconnect = false;
    const obs = this.observerClient;
    this.observerClient = undefined;
    this.observerIncarnation = undefined;
    this.#pendingInputTimerToken += 1;
    this.#bannerNoticeShown = false;
    this.#observerFilter = undefined;
    this.statusBar.setObserverBanner?.(undefined, false);
    obs?.close();
  }

  #armPendingInputTimer(): void {
    const token = ++this.#pendingInputTimerToken;
    void this.#delay(OBSERVER_INPUT_PENDING_TIMEOUT_MS).then(() => {
      if (
        token !== this.#pendingInputTimerToken ||
        !this.observing ||
        this.detached ||
        this.terminalEnded
      ) {
        return;
      }
      const expired = this.#observerInput.expirePending();
      if (expired?.kind === "keystroke") {
        this.#triggerTakeback(false);
      }
    });
  }

  #triggerTakeback(pasteOpen: boolean): void {
    if (
      this.#takebackInFlight !== undefined ||
      !this.observing ||
      this.detached ||
      this.terminalEnded
    ) {
      return;
    }
    const client = this.observerClient;
    if (!client) return;
    if (pasteOpen) this.#discardingPaste = true;
    this.#purgeForObserverOrTakeback();
    this.#takebackInFlight = (async () => {
      try {
        const lease = await client.acquireController(
          this.sessionId,
          this.#controllerId,
          "human",
          { takeover: true, pid: process.pid, tty: this.#tty },
        );
        if (
          this.detached ||
          this.terminalEnded ||
          this.observerClient !== client
        ) {
          await client.releaseController(lease).catch(() => {});
          return;
        }
        this.#exitObserverMode(true);
        this.#purgeForObserverOrTakeback();
        await this.attachLease({ client, lease }, this.#afterAcquire);
      } catch (error) {
        if (
          this.detached ||
          this.terminalEnded ||
          this.observerClient !== client
        ) {
          return;
        }
        this.markObserverTransportFailure(client, error);
      }
    })().finally(() => {
      this.#takebackInFlight = undefined;
    });
  }

  async returnFromObserverPassive(): Promise<
    { returned: true } | { returned: false; retryState: NativeTerminalSessionState }
  > {
    const client = this.observerClient;
    if (!client || !this.observing || this.#takebackInFlight !== undefined) {
      return { returned: true };
    }
    try {
      const lease = await client.acquireController(
        this.sessionId,
        this.#controllerId,
        "human",
        { passive: true, pid: process.pid, tty: this.#tty },
      );
      if (
        this.detached ||
        this.terminalEnded ||
        this.observerClient !== client
      ) {
        await client.releaseController(lease).catch(() => {});
        return { returned: true };
      }
      this.#exitObserverMode(true);
      await this.attachLease({ client, lease }, this.#afterAcquire);
      return { returned: true };
    } catch (error) {
      if (
        error instanceof NativeTerminalRemoteError &&
        (error.message.includes("already has a controller") ||
          error.message.includes("not running"))
      ) {
        const retryState = await client.state(this.sessionId);
        return { returned: false, retryState };
      }
      this.markObserverTransportFailure(client, error);
      return { returned: true };
    }
  }

  markObserverTransportFailure(
    client: NativeTerminalAttachClient,
    error: unknown,
  ): void {
    if (this.observerClient !== client) return;
    this.#exitObserverMode(true);
    this.wasObservingBeforeReconnect = true;
    if (this.transportFailure === undefined) {
      this.transportFailure = error;
      this.interruptedAt = this.#now();
    }
    client.close();
  }

  reportObserverLoss(
    state: NativeTerminalSessionState,
    reason: string,
    isExitOrStop: boolean,
  ): void {
    this.clearObserverForExit();
    if (this.#onControllerLost) {
      this.#onControllerLost({ kind: "controller-changed", reason, state });
    } else {
      this.restoreBarForNotice();
      this.stdout.write(`\r\n[h2a] ${reason}; attach detached\r\n`);
    }
    this.exitCode =
      state.status === "exited" && !state.stopSignal
        ? (state.exit?.exitCode ?? 0)
        : 0;
    if (isExitOrStop) {
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
  }

  closeActive(): void {
    const current = this.active;
    this.active = undefined;
    current?.client.close();
    const obs = this.observerClient;
    this.observerClient = undefined;
    this.observing = false;
    this.#pendingInputTimerToken += 1;
    obs?.close();
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
      if (this.#onControllerLost) {
        this.#onControllerLost({
          kind: "stale-lease",
          reason: "controller revoked by takeover or stop",
        });
      } else {
        this.restoreBarForNotice();
        this.stdout.write(
          "\r\n[h2a] controller revoked by takeover or stop; attach detached\r\n",
        );
      }
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

  async #handleWriteFailure(
    current: ActiveAttachConnection,
    failedChunk: Buffer,
    error: unknown,
  ): Promise<void> {
    if (this.active !== current || this.observing) return;
    if (
      this.#remoteObserver &&
      error instanceof NativeTerminalRemoteError &&
      error.message === "stale terminal controller lease"
    ) {
      this.#inputSuspended = true;
      let state: NativeTerminalSessionState | undefined;
      try {
        state = await current.client.state(this.sessionId);
      } catch {
        this.#inputSuspended = false;
        this.markTransportFailure(current, error, true);
        return;
      }
      if (this.active !== current || this.detached || this.terminalEnded) {
        this.#inputSuspended = false;
        return;
      }
      if (
        state.holderKind === "remote" &&
        state.status === "running" &&
        state.stopSignal === null
      ) {
        const queued = [failedChunk, ...this.pendingInput.splice(0)];
        this.pendingInputBytes = 0;
        this.#inputDecoder.end();
        this.#inputSuspended = false;
        this.#enterObserverMode(current.client, state);
        let sawKeystroke = false;
        let pasteStarted = false;
        for (const block of queued) {
          const res = this.#observerInput.feed(block, this.#now());
          if (res.kind === "keystroke") {
            sawKeystroke = true;
            if (res.pasteStarted) pasteStarted = true;
          }
        }
        if (sawKeystroke) {
          this.#pendingInputTimerToken += 1;
          this.#triggerTakeback(pasteStarted || this.#observerInput.isInBracketedPaste());
        } else if (this.#observerInput.hasPending()) {
          this.#armPendingInputTimer();
        }
        return;
      }
      this.#inputSuspended = false;
    }
    this.markTransportFailure(current, error, true);
  }

  pumpInput(): void {
    if (
      this.#inputPump !== undefined ||
      this.#inputSuspended ||
      this.detached ||
      this.observing ||
      this.active === undefined
    ) {
      return;
    }
    this.#inputPump = (async () => {
      while (
        !this.detached &&
        !this.#inputSuspended &&
        !this.observing &&
        this.pendingInput.length > 0
      ) {
        const current = this.active;
        if (current === undefined) return;
        const chunk = this.pendingInput[0]!;
        const decoded = this.#inputDecoder.write(chunk);
        try {
          if (decoded.length > 0) {
            await current.client.write(current.lease, decoded);
          }
          if (this.pendingInput[0] === chunk) {
            this.pendingInput.shift();
            this.pendingInputBytes -= chunk.length;
          }
        } catch (error) {
          // The host may have accepted the write before the response path
          // broke. Drop this ONE uncertain chunk with an explicit warning;
          // replaying it could duplicate a command. Later queued input stays
          // ordered and is delivered only after a fresh exclusive lease.
          if (this.pendingInput[0] === chunk) {
            this.pendingInput.shift();
            this.pendingInputBytes -= chunk.length;
          }
          await this.#handleWriteFailure(current, chunk, error);
          return;
        }
      }
    })().finally(() => {
      this.#inputPump = undefined;
      if (
        !this.detached &&
        !this.#inputSuspended &&
        !this.observing &&
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
    if (this.observing) {
      if (this.#takebackInFlight !== undefined || this.#discardingPaste) {
        if (this.#discardingPaste || this.#observerInput.isInBracketedPaste()) {
          if (this.#observerInput.consumePasteDiscard(chunk)) {
            this.#discardingPaste = false;
          }
        }
        return true;
      }
      const res = this.#observerInput.feed(chunk, this.#now());
      if (res.kind === "report") {
        this.#pendingInputTimerToken += 1;
        return true;
      }
      if (res.kind === "pending") {
        this.#armPendingInputTimer();
        return true;
      }
      this.#pendingInputTimerToken += 1;
      this.#triggerTakeback(this.#observerInput.isInBracketedPaste());
      return true;
    }
    if (this.#discardingPaste) {
      if (this.#observerInput.consumePasteDiscard(chunk)) {
        this.#discardingPaste = false;
      }
      return true;
    }
    if (this.pendingInputBytes + chunk.length > maxPendingBytes) {
      return false;
    }
    this.pushInput(chunk);
    return true;
  }

  /** True while a chunk of human input is being written to the session. */
  hasInFlightInput(): boolean {
    return this.#inputPump !== undefined;
  }

  /**
   * Drop the input still queued for this session (station t0, I4): a byte
   * typed for this session is never delivered to another one. Returns the
   * number of bytes dropped.
   */
  purgePendingInput(): number {
    // The chunk being written stays: it is already on its way to this
    // session, and the pump accounts for it when the write settles.
    const keep = this.#inputPump !== undefined && this.pendingInput.length > 0 ? 1 : 0;
    let dropped = 0;
    for (let i = keep; i < this.pendingInput.length; i += 1) {
      dropped += this.pendingInput[i]!.length;
    }
    this.pendingInput.length = keep;
    this.pendingInputBytes -= dropped;
    return dropped;
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
      if (this.#resizeGate && !this.#resizeGate(cols, rows)) return;
      void current.client
        .resize(current.lease, cols, rows)
        .catch(async (error) => {
          if (
            this.#remoteObserver &&
            this.active === current &&
            error instanceof NativeTerminalRemoteError &&
            error.message === "stale terminal controller lease"
          ) {
            try {
              const state = await current.client.state(this.sessionId);
              if (
                this.active === current &&
                !this.detached &&
                !this.terminalEnded &&
                state.holderKind === "remote" &&
                state.status === "running" &&
                state.stopSignal === null
              ) {
                this.#enterObserverMode(current.client, state);
                return;
              }
            } catch {
              // Fall through to markTransportFailure
            }
          }
          this.markTransportFailure(current, error);
        });
    }
  }

  async attachObserverConnection(
    client: NativeTerminalAttachClient,
    state: NativeTerminalSessionState,
    afterAcquire?: () => void,
  ): Promise<void> {
    this.#afterAcquire = afterAcquire;
    this.transportFailure = undefined;
    await this.statusBar.probe(true, "attached");
    afterAcquire?.();
    this.saveReset();
    this.#enterObserverMode(client, state);
  }

  async connectAndAcquire(
    connect: () => Promise<NativeTerminalAttachClient>,
    afterAcquire?: () => void,
  ): Promise<NativeTerminalSessionState> {
    this.#afterAcquire = afterAcquire;
    const client = await connect();
    try {
      const state = await client.state(this.sessionId);
      if (state.status === "exited") {
        client.close();
        return state;
      }
      if (
        this.#remoteObserver &&
        !this.takeoverPending &&
        state.status === "running" &&
        state.stopSignal === null &&
        state.holderKind === "remote"
      ) {
        await this.attachObserverConnection(client, state, afterAcquire);
        return state;
      }
      const passive = this.wasObservingBeforeReconnect && !this.takeoverPending;
      try {
        const lease = await client.acquireController(
          this.sessionId,
          this.#controllerId,
          "human",
          {
            takeover: this.takeoverPending,
            ...(passive ? { passive: true } : {}),
            pid: process.pid,
            tty: this.#tty,
          },
        );
        // A reconnect must never take the terminal back from a newer attach.
        this.takeoverPending = false;
        this.wasObservingBeforeReconnect = false;
        await this.attachLease({ client, lease }, afterAcquire);
        return state;
      } catch (acquireError) {
        if (
          this.#remoteObserver &&
          !this.takeoverPending &&
          acquireError instanceof NativeTerminalRemoteError &&
          acquireError.message.includes("already has a controller")
        ) {
          const reread = await client.state(this.sessionId);
          if (
            reread.status === "running" &&
            reread.stopSignal === null &&
            reread.holderKind === "remote"
          ) {
            await this.attachObserverConnection(client, reread, afterAcquire);
            return reread;
          }
        }
        throw acquireError;
      }
    } catch (error) {
      client.close();
      throw error;
    }
  }

  /**
   * Adopt a controller lease the caller already holds. A station acquires the
   * target before leaving the source (t2), then hands the lease to the view.
   */
  async attachLease(
    connection: ActiveAttachConnection,
    afterAcquire?: () => void,
  ): Promise<void> {
    this.#afterAcquire = afterAcquire;
    this.active = connection;
    this.transportFailure = undefined;
    await this.statusBar.probe(true, "attached");
    afterAcquire?.();
    this.sendChildResize();
    this.saveReset();
    this.pumpInput();
  }

  async releaseActive(): Promise<void> {
    const current = this.active;
    this.active = undefined;
    if (current !== undefined) {
      await current.client.releaseController(current.lease).catch(() => {});
      current.client.close();
    }
    const obs = this.observerClient;
    this.observerClient = undefined;
    this.observing = false;
    this.#pendingInputTimerToken += 1;
    obs?.close();
  }

  dispose(): void {
    this.#pendingInputTimerToken += 1;
    this.#discardingPaste = false;
    this.statusBar.dispose();
  }
}

export function createSessionView(
  options: NativeSessionViewOptions,
): NativeSessionView {
  return new NativeSessionView(options);
}
