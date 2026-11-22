/**
 * LH-08 observe-only native PTY terminal bridge.
 *
 * Connects to the single authoritative native host resolved by LH-06,
 * attaches as an observer, sends `term.opened` / `term.gap` / `term.out` /
 * `term.exit` under LH-07 per-channel credit and LH-06 `withShareAllowed`,
 * and refuses all active control/input/resize/stop operations.
 */

import type {
  CatalogueProjector,
  CatalogueUnavailableEvent
} from "./catalogue-watch.js";
import {
  CoalescedRangeIndex,
  TERMINAL_OUTPUT_COALESCE_MS,
  TERMINAL_OUTPUT_POLL_INTERVAL_MS,
  TerminalOutputAssembler
} from "./terminal-output.js";
import type { TerminalChannelCloseReason, TerminalInputModule } from "./terminal-input.js";
import type {
  TrunkChannelContext,
  TrunkLinkTerminationCause,
  TrunkTerminalConsumer
} from "./trunk-client.js";
import type { CreditAvailability } from "./trunk-credit.js";
import type {
  TermExit,
  TermOpen,
  TermOpened,
  TrunkTerminalRecord
} from "./types.js";

export const TERMINAL_BRIDGE_DEFAULT_READ_TIMEOUT_MS = 30_000 as const;
export const TERMINAL_BRIDGE_SHARE_CHECK_INTERVAL_MS = 250 as const;

export interface NativeObserverSessionState {
  readonly id: string;
  readonly generation: string;
  readonly incarnation: string;
  readonly pid?: number;
  readonly cols?: number;
  readonly rows?: number;
  readonly status: string;
  readonly latestSeq: number;
  readonly exit: { readonly exitCode: number; readonly signal?: number } | null;
  readonly stopSignal: string | null;
  readonly controlled: boolean;
  readonly holderKind?: "none" | "human" | "automation" | "remote";
  readonly controllerEpoch?: number;
  readonly lastHumanActivityAt?: number | null;
}

export interface NativeObserverAttachment {
  readonly role: string;
  readonly id: string;
  readonly generation: string;
  readonly incarnation: string;
  readonly controllerEpoch: number;
}

export interface NativeObserverReplay {
  readonly generation: string;
  readonly incarnation: string;
  readonly chunks: ReadonlyArray<{ readonly seq: number; readonly data: string }>;
  readonly gap: { readonly fromSeq: number; readonly toSeq: number } | null;
  readonly latestSeq: number;
  readonly terminalModePrefix?: string;
  readonly state?: NativeObserverSessionState;
}

export interface NativeTerminalObserverClient {
  attachObserver(id: string): Promise<NativeObserverAttachment>;
  state(id: string): Promise<NativeObserverSessionState>;
  readOutput(id: string, afterSeq: number, timeoutMs?: number): Promise<NativeObserverReplay>;
  close(): void;
}

export interface TerminalBridgeClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TerminalBridgeAuditEvent {
  readonly kind: string;
  readonly ch: number;
  readonly sid: string;
  readonly code?: string;
  readonly at: number;
}

export interface TerminalBridgeOptions {
  readonly catalogue: Pick<
    CatalogueProjector,
    "resolveOpen" | "withShareAllowed" | "onUnavailable"
  >;
  readonly clock?: TerminalBridgeClock;
  readonly rangeIndex?: CoalescedRangeIndex;
  readonly connectNativeClient?: (
    socketPath: string,
    options?: { readonly connectTimeoutMs?: number; readonly requestTimeoutMs?: number }
  ) => Promise<NativeTerminalObserverClient>;
  readonly readTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly coalesceMs?: number;
  readonly onAudit?: (event: TerminalBridgeAuditEvent) => void;
  readonly input?: TerminalInputModule;
}

export interface TerminalBridge extends TrunkTerminalConsumer {
  readonly rangeIndex: CoalescedRangeIndex;
  activeChannelCount(): number;
  dispose(): void;
}

const DEFAULT_CLOCK: TerminalBridgeClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimeout: (handle) => {
    clearTimeout(handle as NodeJS.Timeout);
  }
};

const VALID_HOLDER_KINDS = new Set(["none", "human", "automation", "remote"]);

function isSafeNonNegInt(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}

function isSafePosInt(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 1;
}

interface ValidatedLh04State {
  readonly cols: number;
  readonly rows: number;
  readonly holderKind: "none" | "human" | "automation" | "remote";
  readonly latestSeq: number;
  readonly status: string;
  readonly generation: string;
  readonly incarnation: string;
  readonly controllerEpoch?: number;
  readonly exit: { readonly exitCode: number; readonly signal?: number } | null;
}

function validateLh04State(state: NativeObserverSessionState | undefined | null): ValidatedLh04State | null {
  if (!state || typeof state !== "object") return null;
  if (!isSafePosInt(state.cols) || !isSafePosInt(state.rows)) return null;
  if (typeof state.holderKind !== "string" || !VALID_HOLDER_KINDS.has(state.holderKind)) return null;
  if (!isSafeNonNegInt(state.latestSeq)) return null;
  if (typeof state.status !== "string" || state.status.length === 0) return null;
  if (typeof state.generation !== "string" || state.generation.length === 0) return null;
  if (typeof state.incarnation !== "string" || state.incarnation.length === 0) return null;
  return {
    cols: state.cols,
    rows: state.rows,
    holderKind: state.holderKind,
    latestSeq: state.latestSeq,
    status: state.status,
    generation: state.generation,
    incarnation: state.incarnation,
    ...(isSafeNonNegInt(state.controllerEpoch) ? { controllerEpoch: state.controllerEpoch } : {}),
    exit: state.exit ?? null
  };
}

function hasUsableCredit(avail: CreditAvailability): boolean {
  return avail.records >= 1 && avail.bytes > 0;
}

/**
 * Lazy runtime import via a `string`-typed specifier so `@sentropic/h2a`
 * preserves its leaf-package contract (checked by `check-public-contract.sh`).
 */
export async function defaultConnectNativeObserverClient(
  socketPath: string,
  options?: { readonly connectTimeoutMs?: number; readonly requestTimeoutMs?: number }
): Promise<NativeTerminalObserverClient> {
  const packageName: string = "@sentropic/h2a-runtime";
  const runtime = (await import(packageName)) as {
    NativeTerminalClient?: {
      connect(
        socketPath: string,
        opts?: { readonly connectTimeoutMs?: number; readonly requestTimeoutMs?: number }
      ): Promise<NativeTerminalObserverClient>;
    };
  };
  if (!runtime.NativeTerminalClient) {
    throw new Error("runtime NativeTerminalClient is unavailable");
  }
  return runtime.NativeTerminalClient.connect(socketPath, options);
}

interface ChannelState {
  readonly ch: number;
  readonly sid: string;
  readonly open: TermOpen;
  readonly ctx: TrunkChannelContext;
  closed: boolean;
  openedSent: boolean;
  attachedToInput: boolean;
  exitSent: boolean;
  awaitingInitialReplay: boolean;
  readInFlight: boolean;
  nativeId?: string;
  socketPath?: string;
  generation?: string;
  incarnation?: string;
  client: NativeTerminalObserverClient | null;
  assembler: TerminalOutputAssembler | null;
  pollTimer: unknown;
  coalesceTimer: unknown;
  lastShareCheckAtMs: number;
}

export function createTerminalBridge(options: TerminalBridgeOptions): TerminalBridge {
  const catalogue = options.catalogue;
  const clock = options.clock ?? DEFAULT_CLOCK;
  const rangeIndex = options.rangeIndex ?? new CoalescedRangeIndex();
  const connectNativeClient = options.connectNativeClient ?? defaultConnectNativeObserverClient;
  const readTimeoutMs = options.readTimeoutMs ?? TERMINAL_BRIDGE_DEFAULT_READ_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? TERMINAL_OUTPUT_POLL_INTERVAL_MS;
  const coalesceMs = options.coalesceMs ?? TERMINAL_OUTPUT_COALESCE_MS;
  const onAudit = options.onAudit;
  const input = options.input;

  const channels = new Map<number, ChannelState>();
  let disposed = false;

  const unsubscribeUnavailable = catalogue.onUnavailable((ev: CatalogueUnavailableEvent) => {
    if (disposed) return;
    for (const chState of [...channels.values()]) {
      if (chState.closed || chState.sid !== ev.sid) continue;
      if (ev.reason === "excluded") {
        abortChannelWithErr(chState, "excluded", false, chState.openedSent);
        continue;
      }
      if (ev.reason === "exit") {
        if (
          chState.generation !== undefined &&
          ev.generation !== undefined &&
          chState.incarnation !== undefined &&
          ev.incarnation !== undefined &&
          (ev.generation !== chState.generation || ev.incarnation !== chState.incarnation)
        ) {
          continue;
        }
        if (chState.openedSent) {
          pumpSend(chState, true);
          emitExitOnceAndClose(chState, ev.exit ?? null);
        } else {
          abortChannelWithErr(chState, "not-operable", false, false);
        }
      }
    }
  });

  function audit(kind: string, chState: ChannelState, code?: string): void {
    onAudit?.({
      kind,
      ch: chState.ch,
      sid: chState.sid,
      ...(code !== undefined ? { code } : {}),
      at: clock.now()
    });
  }

  function clearChannelTimers(chState: ChannelState): void {
    if (chState.pollTimer !== null) {
      clock.clearTimeout(chState.pollTimer);
      chState.pollTimer = null;
    }
    if (chState.coalesceTimer !== null) {
      clock.clearTimeout(chState.coalesceTimer);
      chState.coalesceTimer = null;
    }
  }

  function teardownChannelLocal(chState: ChannelState, reason: TerminalChannelCloseReason): void {
    if (chState.closed) return;
    chState.closed = true;
    if (chState.attachedToInput) {
      input?.onChannelClose(chState.ch, reason);
    }
    if (channels.get(chState.ch) === chState) {
      channels.delete(chState.ch);
    }
    clearChannelTimers(chState);
    if (chState.client) {
      try {
        chState.client.close();
      } catch {
        // ignore
      }
      chState.client = null;
    }
  }

  function attachChannelToInput(chState: ChannelState): void {
    if (chState.attachedToInput || chState.closed || !input) return;
    if (!chState.nativeId || !chState.socketPath || !chState.generation || !chState.incarnation) return;
    chState.attachedToInput = true;
    input.attachChannel({
      ch: chState.ch,
      sid: chState.sid,
      nativeId: chState.nativeId,
      socketPath: chState.socketPath,
      generation: chState.generation,
      incarnation: chState.incarnation,
      ctx: chState.ctx
    });
  }

  function abortChannelWithErr(
    chState: ChannelState,
    code: string,
    retryable: boolean,
    sendTermClose: boolean
  ): void {
    if (chState.closed) return;
    const wasOpened = sendTermClose;
    teardownChannelLocal(chState, code === "excluded" ? "excluded" : "error");
    audit("channel-error", chState, code);
    chState.ctx.sendControl({ t: "err", code, retryable });
    if (wasOpened) {
      chState.ctx.sendControl({ t: "term.close", sid: chState.sid });
    }
    chState.ctx.close();
  }

  function emitExitOnceAndClose(
    chState: ChannelState,
    exit: { readonly exitCode: number; readonly signal?: number } | null
  ): void {
    if (chState.closed || chState.exitSent) {
      teardownChannelLocal(chState, "exit");
      chState.ctx.close();
      return;
    }
    chState.exitSent = true;
    const incarnation = chState.incarnation ?? "";
    const sid = chState.sid;
    const exitRecord: Omit<TermExit, "v" | "ch" | "s"> = {
      t: "term.exit",
      sid,
      incarnation,
      ...(exit && typeof exit.exitCode === "number" ? { exitCode: exit.exitCode } : {}),
      ...(exit && typeof exit.signal === "number" ? { signal: exit.signal } : {})
    };
    const shareRes = catalogue.withShareAllowed(sid, () => {
      if (!chState.closed) {
        chState.ctx.sendControl(exitRecord);
      }
    });
    if (!shareRes.allowed) {
      abortChannelWithErr(chState, shareRes.reason, false, chState.openedSent);
      return;
    }
    if (chState.generation !== undefined && chState.incarnation !== undefined) {
      rangeIndex.deleteIncarnation(sid, chState.generation, chState.incarnation);
    }
    teardownChannelLocal(chState, "exit");
    chState.ctx.close();
    audit("channel-exit", chState);
  }

  function buildTermOpened(
    chState: ChannelState,
    state: ValidatedLh04State,
    gap: { readonly fromSeq: number; readonly toSeq: number } | null,
    modePrefix?: string
  ): Omit<TermOpened, "v" | "t" | "ch" | "s"> {
    return {
      sid: chState.sid,
      generation: state.generation,
      incarnation: state.incarnation,
      status: state.status,
      latestSeq: state.latestSeq,
      gap,
      ...(modePrefix !== undefined && modePrefix.length > 0 ? { modePrefix } : {}),
      ...(state.controllerEpoch !== undefined ? { controllerEpoch: state.controllerEpoch } : {}),
      holderKind: state.holderKind,
      size: { cols: state.cols, rows: state.rows }
    };
  }

  function scheduleCoalesceFlush(chState: ChannelState): void {
    if (chState.closed || !chState.assembler) return;
    const delayMs = chState.assembler.pendingDelayMs(clock.now());
    if (delayMs === null) {
      if (chState.coalesceTimer !== null) {
        clock.clearTimeout(chState.coalesceTimer);
        chState.coalesceTimer = null;
      }
      return;
    }
    if (chState.coalesceTimer !== null) return;
    chState.coalesceTimer = clock.setTimeout(() => {
      chState.coalesceTimer = null;
      if (chState.closed) return;
      pumpSend(chState, false);
      if (!chState.closed && hasUsableCredit(chState.ctx.availableOutput())) {
        schedulePoll(chState);
      }
    }, delayMs);
  }

  function schedulePoll(chState: ChannelState): void {
    if (chState.closed || chState.readInFlight || chState.pollTimer !== null) return;
    if (!hasUsableCredit(chState.ctx.availableOutput())) return;
    chState.pollTimer = clock.setTimeout(() => {
      chState.pollTimer = null;
      if (chState.closed) return;
      void performReadAndEmit(chState);
    }, pollIntervalMs);
  }

  function pauseForCredit(chState: ChannelState): void {
    clearChannelTimers(chState);
    chState.assembler?.releaseBufferForCreditPause();
  }

  function pumpSend(chState: ChannelState, flushTail: boolean): boolean {
    if (chState.closed || !chState.assembler) return false;
    const assembler = chState.assembler;

    for (;;) {
      if (chState.closed) return false;
      const avail = chState.ctx.availableOutput();
      if (!hasUsableCredit(avail)) {
        if (!flushTail) {
          pauseForCredit(chState);
        }
        return false;
      }
      const proposal = assembler.peekNextProposal({
        nowMs: clock.now(),
        flushTail
      });
      if (!proposal) {
        if (!flushTail && assembler.hasPendingData()) {
          scheduleCoalesceFlush(chState);
        }
        return true;
      }
      if (avail.records < 1 || avail.bytes < proposal.rawBytes) {
        // Record is indivisible; wait for credit increase before emitting.
        if (!flushTail) {
          pauseForCredit(chState);
        }
        return false;
      }

      let sendStatus: "sent" | "no-credit" | "closed" = "closed";
      const shareRes = catalogue.withShareAllowed(chState.sid, () => {
        if (chState.closed) {
          sendStatus = "closed";
          return;
        }
        sendStatus = chState.ctx.trySendOutput(
          proposal.record as unknown as Record<string, unknown>,
          proposal.rawBytes
        );
      });

      if (!shareRes.allowed) {
        abortChannelWithErr(chState, shareRes.reason, false, chState.openedSent);
        return false;
      }
      if (sendStatus === "closed") {
        teardownChannelLocal(chState, "link");
        return false;
      }
      if (sendStatus === "no-credit") {
        if (!flushTail) {
          pauseForCredit(chState);
        }
        return false;
      }
      assembler.consumeNextProposal(proposal);
    }
  }

  async function handleReadFailure(chState: ChannelState): Promise<void> {
    if (chState.closed || !chState.client || !chState.nativeId) return;
    let st: NativeObserverSessionState;
    try {
      st = await chState.client.state(chState.nativeId);
    } catch {
      if (!chState.closed) {
        abortChannelWithErr(chState, "host-unavailable", true, chState.openedSent);
      }
      return;
    }
    if (chState.closed) return;

    if (st.generation !== chState.generation || st.incarnation !== chState.incarnation) {
      if (chState.openedSent) {
        emitExitOnceAndClose(chState, null);
      } else {
        abortChannelWithErr(chState, "not-operable", false, false);
      }
      return;
    }
    if (st.status === "exited") {
      if (chState.openedSent) {
        pumpSend(chState, true);
        emitExitOnceAndClose(chState, st.exit);
      } else {
        abortChannelWithErr(chState, "not-operable", false, false);
      }
      return;
    }
    if (chState.assembler && chState.assembler.nextReadAfterSeq > st.latestSeq) {
      abortChannelWithErr(chState, "resume-unavailable", false, chState.openedSent);
      return;
    }
    abortChannelWithErr(chState, "host-unavailable", true, chState.openedSent);
  }

  async function performReadAndEmit(chState: ChannelState): Promise<void> {
    if (chState.closed || chState.readInFlight || !chState.client || !chState.nativeId || !chState.assembler) {
      return;
    }
    const nowMs = clock.now();
    if (chState.openedSent && nowMs - chState.lastShareCheckAtMs >= TERMINAL_BRIDGE_SHARE_CHECK_INTERVAL_MS) {
      chState.lastShareCheckAtMs = nowMs;
      const shareRes = catalogue.withShareAllowed(chState.sid, () => {});
      if (!shareRes.allowed) {
        abortChannelWithErr(chState, shareRes.reason, false, chState.openedSent);
        return;
      }
    }
    if (!hasUsableCredit(chState.ctx.availableOutput())) {
      pauseForCredit(chState);
      return;
    }

    chState.readInFlight = true;
    let replay: NativeObserverReplay;
    try {
      replay = await chState.client.readOutput(
        chState.nativeId,
        chState.assembler.nextReadAfterSeq,
        readTimeoutMs
      );
    } catch {
      chState.readInFlight = false;
      await handleReadFailure(chState);
      return;
    }
    chState.readInFlight = false;
    if (chState.closed) return;

    let rawState = replay.state;
    if (!rawState) {
      try {
        rawState = await chState.client.state(chState.nativeId);
      } catch {
        if (!chState.closed) {
          abortChannelWithErr(chState, "host-unavailable", true, chState.openedSent);
        }
        return;
      }
      if (chState.closed) return;
    }

    const validState = validateLh04State(rawState);
    if (!validState) {
      abortChannelWithErr(chState, "host-upgrade-required", false, chState.openedSent);
      return;
    }

    // Incarnation / generation change proves old incarnation ended.
    if (
      replay.generation !== chState.generation ||
      replay.incarnation !== chState.incarnation ||
      validState.generation !== chState.generation ||
      validState.incarnation !== chState.incarnation
    ) {
      if (chState.openedSent) {
        pumpSend(chState, true);
        emitExitOnceAndClose(chState, null);
      } else {
        abortChannelWithErr(chState, "not-operable", false, false);
      }
      return;
    }

    if (!chState.openedSent) {
      if (chState.open.receivedSegBytes > 0) {
        if (replay.gap !== null || !chState.assembler.validateResumeFirstChunk(replay.chunks[0])) {
          abortChannelWithErr(chState, "resume-unavailable", false, false);
          return;
        }
      }

      if (replay.gap !== null) {
        rangeIndex.pruneBefore(chState.sid, chState.generation!, chState.incarnation!, replay.gap.toSeq + 1);
        chState.assembler.resetForGap(replay.gap.toSeq);
      }

      const shareRes = catalogue.withShareAllowed(chState.sid, () => {
        if (chState.closed) return;
        if (replay.gap !== null) {
          chState.ctx.sendControl({
            t: "term.gap",
            sid: chState.sid,
            fromSeq: replay.gap.fromSeq,
            toSeq: replay.gap.toSeq
          });
        }
        chState.ctx.sendControl({
          t: "term.opened",
          ...buildTermOpened(chState, validState, replay.gap, replay.terminalModePrefix)
        });
      });
      if (!shareRes.allowed) {
        abortChannelWithErr(chState, shareRes.reason, false, false);
        return;
      }
      chState.openedSent = true;
      chState.lastShareCheckAtMs = clock.now();
      chState.awaitingInitialReplay = false;
      attachChannelToInput(chState);
    } else if (replay.gap !== null) {
      rangeIndex.pruneBefore(chState.sid, chState.generation!, chState.incarnation!, replay.gap.toSeq + 1);
      chState.assembler.resetForGap(replay.gap.toSeq);
      const shareRes = catalogue.withShareAllowed(chState.sid, () => {
        if (chState.closed) return;
        chState.ctx.sendControl({
          t: "term.gap",
          sid: chState.sid,
          fromSeq: replay.gap!.fromSeq,
          toSeq: replay.gap!.toSeq
        });
        chState.ctx.sendControl({
          t: "term.opened",
          ...buildTermOpened(chState, validState, replay.gap, replay.terminalModePrefix)
        });
      });
      if (!shareRes.allowed) {
        abortChannelWithErr(chState, shareRes.reason, false, true);
        return;
      }
    }

    chState.assembler.pushChunks(replay.chunks, clock.now());

    const isExited = validState.status === "exited";
    const drained = pumpSend(chState, isExited);
    if (chState.closed) return;

    if (isExited) {
      emitExitOnceAndClose(chState, validState.exit);
      return;
    }

    if (drained && hasUsableCredit(chState.ctx.availableOutput())) {
      if (chState.assembler.hasPendingData()) {
        scheduleCoalesceFlush(chState);
      }
      schedulePoll(chState);
    }
  }

  async function openAsync(chState: ChannelState): Promise<void> {
    const resolved = await catalogue.resolveOpen(chState.sid);
    if (chState.closed) return;

    if (!resolved.ok) {
      abortChannelWithErr(chState, resolved.reason, false, false);
      return;
    }
    if (resolved.nativeId.endsWith(".h2a")) {
      abortChannelWithErr(chState, "unknown-session", false, false);
      return;
    }

    chState.nativeId = resolved.nativeId;
    chState.socketPath = resolved.socketPath;
    chState.generation = resolved.generation;
    chState.incarnation = resolved.incarnation;

    let client: NativeTerminalObserverClient;
    try {
      client = await connectNativeClient(resolved.socketPath);
    } catch {
      if (!chState.closed) {
        abortChannelWithErr(chState, "host-unavailable", true, false);
      }
      return;
    }
    if (chState.closed) {
      try { client.close(); } catch { /* ignore */ }
      return;
    }
    chState.client = client;

    let att: NativeObserverAttachment;
    try {
      att = await client.attachObserver(resolved.nativeId);
    } catch {
      if (!chState.closed) {
        abortChannelWithErr(chState, "host-unavailable", true, false);
      }
      return;
    }
    if (chState.closed) return;

    if (
      att.role !== "observer" ||
      att.id !== resolved.nativeId ||
      att.generation !== resolved.generation ||
      att.incarnation !== resolved.incarnation
    ) {
      abortChannelWithErr(chState, "not-operable", false, false);
      return;
    }

    let rawState: NativeObserverSessionState;
    try {
      rawState = await client.state(resolved.nativeId);
    } catch {
      if (!chState.closed) {
        abortChannelWithErr(chState, "host-unavailable", true, false);
      }
      return;
    }
    if (chState.closed) return;

    if (
      rawState.id !== resolved.nativeId ||
      rawState.generation !== resolved.generation ||
      rawState.incarnation !== resolved.incarnation
    ) {
      abortChannelWithErr(chState, "not-operable", false, false);
      return;
    }

    const validState = validateLh04State(rawState);
    if (!validState) {
      abortChannelWithErr(chState, "host-upgrade-required", false, false);
      return;
    }
    if (validState.status === "exited") {
      abortChannelWithErr(chState, "not-operable", false, false);
      return;
    }

    const effectiveAfterSeq = chState.open.afterSeq ?? 0;
    if (chState.open.afterSeq !== null && chState.open.afterSeq > validState.latestSeq) {
      abortChannelWithErr(chState, "resume-unavailable", false, false);
      return;
    }
    if (effectiveAfterSeq === validState.latestSeq && chState.open.receivedSegBytes > 0) {
      abortChannelWithErr(chState, "resume-unavailable", false, false);
      return;
    }

    chState.assembler = new TerminalOutputAssembler({
      sid: chState.sid,
      generation: validState.generation,
      incarnation: validState.incarnation,
      afterSeq: effectiveAfterSeq,
      receivedSegBytes: chState.open.receivedSegBytes,
      rangeIndex,
      coalesceMs
    });

    if (effectiveAfterSeq === validState.latestSeq && chState.open.receivedSegBytes === 0) {
      const shareRes = catalogue.withShareAllowed(chState.sid, () => {
        if (chState.closed) return;
        chState.ctx.sendControl({
          t: "term.opened",
          ...buildTermOpened(chState, validState, null)
        });
      });
      if (!shareRes.allowed) {
        abortChannelWithErr(chState, shareRes.reason, false, false);
        return;
      }
      chState.openedSent = true;
      chState.lastShareCheckAtMs = clock.now();
      attachChannelToInput(chState);
      if (hasUsableCredit(chState.ctx.availableOutput())) {
        schedulePoll(chState);
      }
      return;
    }

    chState.awaitingInitialReplay = true;
    if (hasUsableCredit(chState.ctx.availableOutput())) {
      await performReadAndEmit(chState);
    }
  }

  return {
    rangeIndex,

    activeChannelCount(): number {
      return channels.size;
    },

    onOpen(open: TermOpen, ctx: TrunkChannelContext) {
      if (disposed) {
        return { ok: false, code: "host-unavailable", retryable: false };
      }
      if (open.mode !== "observe" && open.mode !== "control") {
        return { ok: false, code: "invalid-open", retryable: false };
      }
      if (open.afterSeq !== null && !isSafeNonNegInt(open.afterSeq)) {
        return { ok: false, code: "invalid-open", retryable: false };
      }
      if (!isSafeNonNegInt(open.receivedSegBytes)) {
        return { ok: false, code: "invalid-open", retryable: false };
      }
      if (open.afterSeq === null && open.receivedSegBytes > 0) {
        return { ok: false, code: "resume-unavailable", retryable: false };
      }
      if (open.cols !== undefined && !isSafePosInt(open.cols)) {
        return { ok: false, code: "invalid-open", retryable: false };
      }
      if (open.rows !== undefined && !isSafePosInt(open.rows)) {
        return { ok: false, code: "invalid-open", retryable: false };
      }

      const chState: ChannelState = {
        ch: open.ch,
        sid: open.sid,
        open,
        ctx,
        closed: false,
        openedSent: false,
        attachedToInput: false,
        exitSent: false,
        awaitingInitialReplay: false,
        readInFlight: false,
        client: null,
        assembler: null,
        pollTimer: null,
        coalesceTimer: null,
        lastShareCheckAtMs: clock.now()
      };
      channels.set(open.ch, chState);
      void openAsync(chState);
    },

    onCredit(ch: number, available: CreditAvailability): void {
      if (disposed) return;
      const chState = channels.get(ch);
      if (!chState || chState.closed || !hasUsableCredit(available)) return;

      if (chState.awaitingInitialReplay && chState.assembler && !chState.openedSent && !chState.readInFlight) {
        void performReadAndEmit(chState);
        return;
      }

      if (chState.openedSent && chState.assembler) {
        if (chState.assembler.hasPendingData()) {
          pumpSend(chState, false);
        }
        if (!chState.closed && !chState.readInFlight && hasUsableCredit(chState.ctx.availableOutput())) {
          void performReadAndEmit(chState);
        }
      }
    },

    onRecord(ch: number, record: TrunkTerminalRecord): void {
      if (disposed) return;
      const chState = channels.get(ch);
      if (!chState || chState.closed) return;

      if (!chState.openedSent) {
        switch (record.t) {
          case "term.in":
            chState.ctx.sendControl({
              t: "term.in.ack",
              inSeq: record.inSeq,
              result: "refused",
              reason: "not-controller"
            });
            audit("refused-observe-input", chState, "not-controller");
            break;
          case "term.in.sync":
          case "term.ctl":
          case "term.resize":
          case "term.stop":
            chState.ctx.sendControl({
              t: "err",
              code: "channel-not-ready",
              retryable: true
            });
            audit("refused-channel-not-ready", chState, "channel-not-ready");
            break;
          default:
            break;
        }
        return;
      }

      if (input && chState.attachedToInput) {
        switch (record.t) {
          case "term.in":
          case "term.in.sync":
          case "term.ctl":
          case "term.resize":
          case "term.stop":
            input.onRecord(ch, record);
            return;
          default:
            return;
        }
      }

      switch (record.t) {
        case "term.in":
          chState.ctx.sendControl({
            t: "term.in.ack",
            inSeq: record.inSeq,
            result: "refused",
            reason: "not-controller"
          });
          audit("refused-observe-input", chState, "not-controller");
          break;
        case "term.in.sync":
        case "term.ctl":
        case "term.resize":
        case "term.stop":
          chState.ctx.sendControl({
            t: "err",
            code: "control-unavailable",
            retryable: false
          });
          audit("refused-observe-command", chState, "control-unavailable");
          break;
        default:
          break;
      }
    },

    onClose(ch: number, reason: "peer-close" | "link"): void {
      const chState = channels.get(ch);
      if (chState) {
        teardownChannelLocal(chState, reason);
      }
    },

    onLinkLost(info: { readonly linkGeneration: number; readonly reason: string; readonly at: number }): void {
      input?.onLinkLost(info);
      for (const chState of [...channels.values()]) {
        teardownChannelLocal(chState, "link");
      }
    },

    onLinkTerminated(info: { readonly cause: TrunkLinkTerminationCause; readonly at: number }): void {
      input?.onLinkTerminated(info);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribeUnavailable();
      for (const chState of [...channels.values()]) {
        teardownChannelLocal(chState, "dispose");
      }
      input?.dispose();
      rangeIndex.clear();
    }
  };
}
