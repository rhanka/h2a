/**
 * LH-09 remote terminal input, control lease, replay, filter & surveillance module.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { isRemoteControlKilledByEnv } from "./flag.js";
import type { ShareAllowedResult } from "./exclusions.js";
import { readRemoteControlKillFlag } from "./service.js";
import type { NativeObserverSessionState } from "./terminal-bridge.js";
import {
  inputLogFilePath,
  openTerminalInputLog,
  purgeStaleIncarnationLogs,
  type EpochEndReason,
  type TerminalInputLog
} from "./terminal-input-log.js";
import {
  createTerminalReplyFilter,
  type TerminalReplyFilter
} from "./terminal-reply-filter.js";
import type { TrunkChannelContext, TrunkTerminalConsumer } from "./trunk-client.js";
import {
  TERMINAL_INPUT_MAX_BYTES,
  type TermCtl,
  type TermIn,
  type TermInSync,
  type TermResize,
  type TermStop,
  type TrunkTerminalRecord
} from "./types.js";

export const REMOTE_CONTROL_ACTIVITY_WINDOW_MS = 30_000 as const;
export const REMOTE_CONTROL_IDLE_TIMEOUT_MS = 900_000 as const;
export const REMOTE_CONTROL_GRACE_TIMEOUT_MS = 30_000 as const;
export const REMOTE_CONTROL_WATCH_INTERVAL_MS = 250 as const;
export const TERMINAL_CONTROL_PORT_TIMEOUT_MS = 5_000 as const;
export const TERMINAL_SIZE_MIN = 1 as const;
export const TERMINAL_SIZE_MAX = 65_535 as const;

export type TerminalChannelCloseReason =
  | "peer-close"
  | "excluded"
  | "error"
  | "exit"
  | "dispose"
  | "link";

const STRICT_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export interface TerminalControlLease {
  readonly role: "controller";
  readonly id: string;
  readonly generation: string;
  readonly incarnation: string;
  readonly controllerId: string;
  readonly epoch: number;
}

export type TerminalControlAcquireResult =
  | { readonly granted: true; readonly lease: TerminalControlLease }
  | {
      readonly granted: false;
      readonly reason: "recent-human" | "held-by-automation" | "held-by-remote" | "already-held";
      readonly controllerEpoch: number;
    };

export interface TerminalControlPort {
  acquire(id: string, controllerId: string, activityWindowMs: number): Promise<TerminalControlAcquireResult>;
  write(lease: TerminalControlLease, data: string): Promise<void>;
  resize(lease: TerminalControlLease, cols: number, rows: number): Promise<void>;
  release(lease: TerminalControlLease): Promise<unknown>;
  state(id: string): Promise<NativeObserverSessionState>;
  stopIfIncarnation(id: string, generation: string, incarnation: string): Promise<NativeObserverSessionState>;
  close(): void;
}

export type TerminalControlPortFactory = (
  socketPath: string,
  options?: { readonly connectTimeoutMs?: number; readonly requestTimeoutMs?: number }
) => Promise<TerminalControlPort>;

export interface TerminalInputClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TerminalInputAuditEvent {
  readonly kind: string;
  readonly ch: number;
  readonly sid: string;
  readonly reason?: string;
  readonly result?: string;
  readonly count?: number;
  readonly at: number;
}

export interface TerminalInputOptions {
  readonly root: string;
  readonly scope: string;
  readonly clock?: TerminalInputClock;
  readonly connectControlPort?: TerminalControlPortFactory | null;
  readonly isKilled?: () => boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly withShareAllowed: (sid: string, enqueue: () => void) => ShareAllowedResult;
  readonly onAudit?: (event: TerminalInputAuditEvent) => void;
}

export interface TerminalInputChannelAttachment {
  readonly ch: number;
  readonly sid: string;
  readonly nativeId: string;
  readonly socketPath: string;
  readonly generation: string;
  readonly incarnation: string;
  readonly ctx: TrunkChannelContext;
}

export interface TerminalInputModule {
  attachChannel(attachment: TerminalInputChannelAttachment): void;
  onRecord(ch: number, record: TrunkTerminalRecord): void;
  onChannelClose(ch: number, reason: TerminalChannelCloseReason): void;
  onLinkLost(info: { readonly linkGeneration: number; readonly reason: string; readonly at: number }): void;
  onLinkTerminated(info: {
    readonly cause: Parameters<NonNullable<TrunkTerminalConsumer["onLinkTerminated"]>>[0]["cause"];
    readonly at: number;
  }): void;
  releaseAll(cause?: string): void;
  getLog(sid: string, generation: string, incarnation: string): TerminalInputLog | undefined;
  dispose(): void;
}

interface AttachedChannelState {
  readonly ch: number;
  readonly sid: string;
  readonly nativeId: string;
  readonly socketPath: string;
  readonly generation: string;
  readonly incarnation: string;
  readonly ctx: TrunkChannelContext;
  readonly replyFilter: TerminalReplyFilter;
  closed: boolean;
}

interface ActiveLeaseState {
  readonly lease: TerminalControlLease;
  readonly port: TerminalControlPort;
  readonly log: TerminalInputLog;
  readonly sid: string;
  readonly generation: string;
  readonly incarnation: string;
  boundCh: number | null;
  ctx: TrunkChannelContext | null;
  queue: Promise<void>;
  closing: boolean;
  incarnationEnded: boolean;
  writeInFlight: boolean;
  watchInFlight: boolean;
  idleTimer: unknown;
  graceTimer: unknown;
  watchTimer: unknown;
}

/**
 * Default control port over `@sentropic/h2a-runtime` `NativeTerminalClient`,
 * loaded via a `string`-typed specifier to preserve `@sentropic/h2a`'s leaf contract.
 */
export async function defaultConnectNativeControlPort(
  socketPath: string,
  options?: { readonly connectTimeoutMs?: number; readonly requestTimeoutMs?: number }
): Promise<TerminalControlPort> {
  const packageName: string = "@sentropic/h2a-runtime";
  const runtime = (await import(packageName)) as {
    NativeTerminalClient?: {
      connect(
        socketPath: string,
        opts?: { readonly connectTimeoutMs?: number; readonly requestTimeoutMs?: number }
      ): Promise<{
        acquireRemoteControllerIfNoRecentHuman(
          id: string,
          controllerId: string,
          activityWindowMs: number
        ): Promise<TerminalControlAcquireResult>;
        write(lease: TerminalControlLease, data: string): Promise<void>;
        resize(lease: TerminalControlLease, cols: number, rows: number): Promise<void>;
        releaseController(lease: TerminalControlLease): Promise<unknown>;
        state(id: string): Promise<NativeObserverSessionState>;
        stopIfIncarnation(
          id: string,
          generation: string,
          incarnation: string
        ): Promise<NativeObserverSessionState>;
        close(): void;
      }>;
    };
  };
  if (!runtime.NativeTerminalClient) {
    throw new Error("runtime NativeTerminalClient is unavailable");
  }
  const connectTimeoutMs = options?.connectTimeoutMs ?? TERMINAL_CONTROL_PORT_TIMEOUT_MS;
  const requestTimeoutMs = options?.requestTimeoutMs ?? TERMINAL_CONTROL_PORT_TIMEOUT_MS;
  const client = await runtime.NativeTerminalClient.connect(socketPath, {
    connectTimeoutMs,
    requestTimeoutMs
  });
  return {
    acquire: (id, controllerId, activityWindowMs) =>
      client.acquireRemoteControllerIfNoRecentHuman(id, controllerId, activityWindowMs),
    write: (lease, data) => client.write(lease, data),
    resize: (lease, cols, rows) => client.resize(lease, cols, rows),
    release: (lease) => client.releaseController(lease),
    state: (id) => client.state(id),
    stopIfIncarnation: (id, generation, incarnation) =>
      client.stopIfIncarnation(id, generation, incarnation),
    close: () => client.close()
  };
}

const DEFAULT_CLOCK: TerminalInputClock = {
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

function getHostErrorCode(err: unknown): string | null {
  if (err instanceof Error && err.name === "NativeTerminalRemoteError") {
    const code = (err as { readonly code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return null;
}

function decodeStrictInputPayload(dataB64: string): string | null {
  if (typeof dataB64 !== "string" || dataB64.length === 0) return null;
  if (!STRICT_BASE64_RE.test(dataB64)) return null;
  const bytes = Buffer.from(dataB64, "base64");
  if (bytes.byteLength < 1 || bytes.byteLength > TERMINAL_INPUT_MAX_BYTES) return null;
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    return null;
  }
}

export function createTerminalInput(options: TerminalInputOptions): TerminalInputModule {
  const root = options.root;
  const scope = options.scope;
  const clock = options.clock ?? DEFAULT_CLOCK;
  const connectControlPort =
    options.connectControlPort === null
      ? undefined
      : (options.connectControlPort ?? defaultConnectNativeControlPort);
  const env = options.env ?? process.env;
  const isKilled =
    options.isKilled ??
    (() => isRemoteControlKilledByEnv(env) || readRemoteControlKillFlag(root).kill);
  const withShareAllowed = options.withShareAllowed;
  const onAudit = options.onAudit;

  const channels = new Map<number, AttachedChannelState>();
  const logsByIncarnation = new Map<string, TerminalInputLog>();
  const leasesBySid = new Map<string, ActiveLeaseState>();
  const acquireInFlight = new Set<string>();
  let disposed = false;

  function incKey(sid: string, generation: string, incarnation: string): string {
    return `${sid}\0${generation}\0${incarnation}`;
  }

  function getOrOpenLog(sid: string, generation: string, incarnation: string): TerminalInputLog {
    const key = incKey(sid, generation, incarnation);
    let log = logsByIncarnation.get(key);
    if (!log) {
      log = openTerminalInputLog(root, scope, sid, generation, incarnation);
      logsByIncarnation.set(key, log);
    }
    return log;
  }

  function audit(
    kind: string,
    ch: number,
    sid: string,
    extra: { readonly reason?: string; readonly result?: string; readonly count?: number } = {}
  ): void {
    onAudit?.({
      kind,
      ch,
      sid,
      ...(extra.reason !== undefined ? { reason: extra.reason } : {}),
      ...(extra.result !== undefined ? { result: extra.result } : {}),
      ...(extra.count !== undefined ? { count: extra.count } : {}),
      at: clock.now()
    });
  }

  function matchesChannelIncarnation(
    chState: AttachedChannelState,
    rec: { readonly sid: string; readonly generation: string; readonly incarnation: string }
  ): boolean {
    return (
      rec.sid === chState.sid &&
      rec.generation === chState.generation &&
      rec.incarnation === chState.incarnation
    );
  }

  function sendTermInAck(
    chState: AttachedChannelState,
    inSeq: number,
    result: "applied" | "refused" | "uncertain",
    reason?: string
  ): void {
    if (chState.closed || disposed) return;
    chState.ctx.sendControl({
      t: "term.in.ack",
      inSeq,
      result,
      ...(reason !== undefined ? { reason } : {})
    });
  }

  function sendErr(chState: AttachedChannelState, code: string, retryable = false): void {
    if (chState.closed || disposed) return;
    chState.ctx.sendControl({
      t: "err",
      code,
      retryable
    });
  }

  function clearLeaseTimers(lease: ActiveLeaseState): void {
    if (lease.idleTimer !== null) {
      clock.clearTimeout(lease.idleTimer);
      lease.idleTimer = null;
    }
    if (lease.graceTimer !== null) {
      clock.clearTimeout(lease.graceTimer);
      lease.graceTimer = null;
    }
    if (lease.watchTimer !== null) {
      clock.clearTimeout(lease.watchTimer);
      lease.watchTimer = null;
    }
  }

  function clearGraceTimer(lease: ActiveLeaseState): void {
    if (lease.graceTimer !== null) {
      clock.clearTimeout(lease.graceTimer);
      lease.graceTimer = null;
    }
  }

  function resetIdleTimer(lease: ActiveLeaseState): void {
    if (lease.idleTimer !== null) {
      clock.clearTimeout(lease.idleTimer);
      lease.idleTimer = null;
    }
    if (lease.closing || lease.incarnationEnded || disposed) return;
    lease.idleTimer = clock.setTimeout(() => {
      lease.idleTimer = null;
      if (lease.closing || lease.incarnationEnded || disposed) return;
      closeEpoch(lease, "idle-released");
    }, REMOTE_CONTROL_IDLE_TIMEOUT_MS);
  }

  function armGraceTimer(lease: ActiveLeaseState): void {
    if (lease.graceTimer !== null || lease.closing || lease.incarnationEnded || disposed) return;
    lease.graceTimer = clock.setTimeout(() => {
      lease.graceTimer = null;
      if (lease.closing || lease.incarnationEnded || lease.boundCh !== null || disposed) return;
      closeEpoch(lease, "lost-link");
    }, REMOTE_CONTROL_GRACE_TIMEOUT_MS);
  }

  function deleteIncarnationLogFiles(sid: string, generation: string, incarnation: string): void {
    const key = incKey(sid, generation, incarnation);
    const existingLog = logsByIncarnation.get(key);
    if (existingLog) {
      existingLog.drop();
      logsByIncarnation.delete(key);
      return;
    }
    const path = inputLogFilePath(root, scope, sid, generation, incarnation);
    if (existsSync(path)) {
      openTerminalInputLog(root, scope, sid, generation, incarnation).drop();
    }
  }

  function endIncarnation(sid: string, generation: string, incarnation: string): void {
    const lease = leasesBySid.get(sid);
    if (
      lease &&
      lease.generation === generation &&
      lease.incarnation === incarnation &&
      !lease.incarnationEnded
    ) {
      lease.incarnationEnded = true;
      lease.closing = true;
      clearLeaseTimers(lease);
      try {
        lease.port.close();
      } catch {
        // ignore
      }
      if (leasesBySid.get(sid) === lease) {
        leasesBySid.delete(sid);
      }
      lease.boundCh = null;
      lease.ctx = null;
    }
    deleteIncarnationLogFiles(sid, generation, incarnation);
  }

  function scheduleWatch(lease: ActiveLeaseState): void {
    if (lease.watchTimer !== null || lease.closing || lease.incarnationEnded || disposed) return;
    lease.watchTimer = clock.setTimeout(() => {
      lease.watchTimer = null;
      void runWatchTick(lease);
    }, REMOTE_CONTROL_WATCH_INTERVAL_MS);
  }

  async function runWatchTick(lease: ActiveLeaseState): Promise<void> {
    if (lease.closing || lease.incarnationEnded || disposed || lease.watchInFlight) return;
    if (lease.boundCh === null && isKilled()) {
      releaseAll("killed");
      return;
    }
    lease.watchInFlight = true;
    let st: NativeObserverSessionState;
    try {
      st = await lease.port.state(lease.lease.id);
    } catch (err) {
      lease.watchInFlight = false;
      if (lease.closing || lease.incarnationEnded || disposed) return;
      if (getHostErrorCode(err) === "operation-failed") {
        // Cas 1: unknown session -> incarnation ended.
        endIncarnation(lease.sid, lease.generation, lease.incarnation);
        return;
      }
      // Cas 3: no response (timeout, broken socket, or non-v1 code).
      if (lease.writeInFlight) {
        scheduleWatch(lease);
        return;
      }
      closeEpoch(lease, "released");
      return;
    }
    lease.watchInFlight = false;
    if (lease.closing || lease.incarnationEnded || disposed) return;

    // Cas 1: Incarnation ended (checked BEFORE Cas 2 per host invalidation order).
    if (
      st.status === "exited" ||
      st.generation !== lease.generation ||
      st.incarnation !== lease.incarnation
    ) {
      endIncarnation(lease.sid, lease.generation, lease.incarnation);
      return;
    }

    // Cas 2: Lease lost.
    if (st.controllerEpoch !== lease.lease.epoch || st.holderKind !== "remote") {
      const reason: EpochEndReason =
        st.holderKind === "human" || st.holderKind === "automation" ? "taken-back" : "released";
      closeEpoch(lease, reason);
      return;
    }

    // Cas 4: Lease intact.
    scheduleWatch(lease);
  }

  function closeEpoch(lease: ActiveLeaseState, reason: EpochEndReason): void {
    if (lease.closing || lease.incarnationEnded) return;
    lease.closing = true;
    const boundCh = lease.boundCh;

    // 1. Synced end line with motif and maxInSeq.
    lease.log.endEpoch(lease.lease.epoch, reason);

    // 2. Stop timers and surveillance.
    clearLeaseTimers(lease);

    // 3. Emit term.ctl.state on bound channel if still accepting sends.
    if (boundCh !== null && lease.ctx) {
      const chState = channels.get(boundCh);
      if (chState && !chState.closed) {
        lease.ctx.sendControl({
          t: "term.ctl.state",
          sid: lease.sid,
          state: reason,
          epoch: lease.lease.epoch
        });
      }
    }

    // 4. Close port (host releases lease with the connection).
    try {
      lease.port.close();
    } catch {
      // ignore
    }

    // 5. Unbind lease.
    if (leasesBySid.get(lease.sid) === lease) {
      leasesBySid.delete(lease.sid);
    }
    lease.boundCh = null;
    lease.ctx = null;
    audit("control-closed", boundCh ?? 0, lease.sid, { reason });
  }

  async function classifyAcquireFailure(
    chState: AttachedChannelState,
    port: TerminalControlPort,
    err: unknown
  ): Promise<{ readonly code: string; readonly retryable: boolean }> {
    const code = getHostErrorCode(err);
    if (code === "invalid-request") {
      return { code: "host-upgrade-required", retryable: false };
    }
    if (code === "operation-failed") {
      try {
        const st = await port.state(chState.nativeId);
        if (st.status === "exited") {
          return { code: "not-operable", retryable: false };
        }
        if (st.generation !== chState.generation || st.incarnation !== chState.incarnation) {
          return { code: "stale-incarnation", retryable: false };
        }
        return { code: "host-unavailable", retryable: true };
      } catch (stateErr) {
        if (getHostErrorCode(stateErr) === "operation-failed") {
          return { code: "not-operable", retryable: false };
        }
        return { code: "host-unavailable", retryable: true };
      }
    }
    return { code: "host-unavailable", retryable: true };
  }

  async function handleCtlAcquire(chState: AttachedChannelState, rec: TermCtl): Promise<void> {
    if (!matchesChannelIncarnation(chState, rec)) {
      sendErr(chState, "stale-incarnation", false);
      return;
    }
    if (!connectControlPort) {
      sendErr(chState, "control-unavailable", false);
      return;
    }
    if (isKilled()) {
      sendErr(chState, "killed", false);
      return;
    }
    const shareRes = withShareAllowed(chState.sid, () => {});
    if (!shareRes.allowed) {
      sendErr(chState, shareRes.reason === "excluded" ? "excluded" : shareRes.reason, false);
      return;
    }

    const existing = leasesBySid.get(chState.sid);
    if (existing && !existing.closing) {
      if (
        existing.boundCh === chState.ch &&
        existing.generation === chState.generation &&
        existing.incarnation === chState.incarnation
      ) {
        if (!chState.closed && !disposed) {
          chState.ctx.sendControl({
            t: "term.ctl.state",
            sid: chState.sid,
            state: "granted",
            epoch: existing.lease.epoch,
            generation: chState.generation,
            incarnation: chState.incarnation
          });
        }
        return;
      }
      if (!chState.closed && !disposed) {
        chState.ctx.sendControl({
          t: "term.ctl.state",
          sid: chState.sid,
          state: "refused-held"
        });
      }
      return;
    }

    if (acquireInFlight.has(chState.sid)) {
      if (!chState.closed && !disposed) {
        chState.ctx.sendControl({
          t: "term.ctl.state",
          sid: chState.sid,
          state: "refused-held"
        });
      }
      return;
    }

    acquireInFlight.add(chState.sid);
    let port: TerminalControlPort | null = null;
    try {
      port = await connectControlPort(chState.socketPath);
      if (chState.closed || disposed) {
        port.close();
        return;
      }
      const controllerId = `h2a-remote:${randomUUID()}`;
      const res = await port.acquire(chState.nativeId, controllerId, REMOTE_CONTROL_ACTIVITY_WINDOW_MS);
      if (res.granted) {
        if (
          res.lease.id !== chState.nativeId ||
          res.lease.generation !== chState.generation ||
          res.lease.incarnation !== chState.incarnation
        ) {
          try {
            await port.release(res.lease);
          } catch {
            // ignore
          }
          port.close();
          sendErr(chState, "stale-incarnation", false);
          return;
        }
        if (chState.closed || disposed) {
          try {
            await port.release(res.lease);
          } catch {
            // ignore
          }
          port.close();
          return;
        }
        const log = getOrOpenLog(chState.sid, chState.generation, chState.incarnation);
        log.beginEpoch(res.lease.epoch);
        const leaseState: ActiveLeaseState = {
          lease: res.lease,
          port,
          log,
          sid: chState.sid,
          generation: chState.generation,
          incarnation: chState.incarnation,
          boundCh: chState.ch,
          ctx: chState.ctx,
          queue: Promise.resolve(),
          closing: false,
          incarnationEnded: false,
          writeInFlight: false,
          watchInFlight: false,
          idleTimer: null,
          graceTimer: null,
          watchTimer: null
        };
        leasesBySid.set(chState.sid, leaseState);
        resetIdleTimer(leaseState);
        scheduleWatch(leaseState);
        chState.ctx.sendControl({
          t: "term.ctl.state",
          sid: chState.sid,
          state: "granted",
          epoch: res.lease.epoch,
          generation: chState.generation,
          incarnation: chState.incarnation
        });
        audit("control-acquired", chState.ch, chState.sid, { result: "granted" });
        return;
      }

      port.close();
      const state = res.reason === "recent-human" ? "refused-recent-human" : "refused-held";
      if (!chState.closed && !disposed) {
        chState.ctx.sendControl({
          t: "term.ctl.state",
          sid: chState.sid,
          state
        });
      }
      audit("control-refused", chState.ch, chState.sid, { reason: res.reason });
    } catch (err) {
      if (port) {
        const classified = await classifyAcquireFailure(chState, port, err);
        try {
          port.close();
        } catch {
          // ignore
        }
        sendErr(chState, classified.code, classified.retryable);
      } else {
        sendErr(chState, "host-unavailable", true);
      }
    } finally {
      acquireInFlight.delete(chState.sid);
    }
  }

  function handleCtlRelease(chState: AttachedChannelState, rec: TermCtl): void {
    if (!matchesChannelIncarnation(chState, rec)) {
      sendErr(chState, "stale-incarnation", false);
      return;
    }
    const existing = leasesBySid.get(chState.sid);
    if (
      !existing ||
      existing.closing ||
      existing.boundCh !== chState.ch ||
      existing.generation !== chState.generation ||
      existing.incarnation !== chState.incarnation ||
      rec.epoch !== existing.lease.epoch
    ) {
      sendErr(chState, "not-controller", false);
      return;
    }
    existing.queue = existing.queue.then(async () => {
      if (existing.closing || disposed) return;
      try {
        await existing.port.release(existing.lease);
      } catch {
        // Closing the port releases the lease on the host connection as well.
      }
      closeEpoch(existing, "released");
    });
  }

  async function processTermIn(
    chState: AttachedChannelState,
    lease: ActiveLeaseState,
    rec: TermIn
  ): Promise<void> {
    // Re-check step 1 inside serialized queue in case an earlier queued input closed the epoch.
    if (
      lease.closing ||
      leasesBySid.get(chState.sid) !== lease ||
      lease.boundCh !== chState.ch ||
      lease.lease.epoch !== rec.epoch
    ) {
      const log = getOrOpenLog(chState.sid, chState.generation, chState.incarnation);
      const liveLease = leasesBySid.get(chState.sid);
      const hasLiveEpoch =
        liveLease !== undefined && !liveLease.closing && liveLease.lease.epoch === rec.epoch;
      const reason =
        !hasLiveEpoch && rec.epoch >= 1 && rec.epoch <= log.highestOpenedEpoch()
          ? "stale-epoch"
          : "not-controller";
      sendTermInAck(chState, rec.inSeq, "refused", reason);
      return;
    }

    const log = lease.log;

    // 2. Advance maxAckedInSeq and prune.
    log.advanceAck(rec.epoch, rec.ackThrough);

    // 3. Classify inSeq.
    const cls = log.classify(rec.epoch, rec.inSeq);
    if (cls.kind === "pruned") {
      sendTermInAck(chState, rec.inSeq, "refused", "already-acked");
      return;
    }
    if (cls.kind === "present") {
      sendTermInAck(chState, rec.inSeq, cls.entry.result, cls.entry.reason);
      return;
    }
    if (cls.kind === "hole") {
      sendTermInAck(chState, rec.inSeq, "refused", "log-full");
      return;
    }
    if (cls.kind === "ahead") {
      sendTermInAck(chState, rec.inSeq, "refused", "out-of-order");
      return;
    }

    // 4. Unacked overflow check (512).
    if (log.activeUnackedCount() >= 512) {
      log.skip(rec.epoch, rec.inSeq);
      sendTermInAck(chState, rec.inSeq, "refused", "log-full");
      return;
    }

    // 5. Payload, origin, and reply filter (refusal stored).
    const decodedText = decodeStrictInputPayload(rec.dataB64);
    if (decodedText === null) {
      log.recordRefusal(rec.epoch, rec.inSeq, "invalid-input");
      sendTermInAck(chState, rec.inSeq, "refused", "invalid-input");
      return;
    }
    if (rec.origin === "terminal-reply") {
      const filterRes = chState.replyFilter.check(decodedText, clock.now());
      if (!filterRes.allowed) {
        log.recordRefusal(rec.epoch, rec.inSeq, filterRes.reason);
        sendTermInAck(chState, rec.inSeq, "refused", filterRes.reason);
        if (filterRes.reason === "reply-rate-limited") {
          audit("terminal-reply-rate-limited", chState.ch, chState.sid, {
            reason: filterRes.reason,
            count: chState.replyFilter.rateLimitedCount()
          });
        }
        return;
      }
    } else if (rec.origin !== "user") {
      log.recordRefusal(rec.epoch, rec.inSeq, "invalid-input");
      sendTermInAck(chState, rec.inSeq, "refused", "invalid-input");
      return;
    }

    // 6. Kill switch then exclusion (refusal stored).
    if (isKilled()) {
      log.recordRefusal(rec.epoch, rec.inSeq, "killed");
      sendTermInAck(chState, rec.inSeq, "refused", "killed");
      return;
    }
    const shareRes = withShareAllowed(chState.sid, () => {});
    if (!shareRes.allowed) {
      const reason = shareRes.reason === "excluded" ? "excluded" : shareRes.reason;
      log.recordRefusal(rec.epoch, rec.inSeq, reason);
      sendTermInAck(chState, rec.inSeq, "refused", reason);
      return;
    }

    // 7. Reserve uncertain on disk (fsynced), call host write, settle and ack.
    log.reserve(rec.epoch, rec.inSeq);
    lease.writeInFlight = true;
    try {
      await lease.port.write(lease.lease, decodedText);
      lease.writeInFlight = false;
      if (!lease.incarnationEnded) {
        log.settle(rec.epoch, rec.inSeq, "applied");
        if (rec.origin === "user" && !lease.closing) {
          resetIdleTimer(lease);
        }
      }
      sendTermInAck(chState, rec.inSeq, "applied");
      audit("terminal-input", chState.ch, chState.sid, { result: "applied" });
    } catch (err) {
      lease.writeInFlight = false;
      if (getHostErrorCode(err) !== null) {
        if (!lease.incarnationEnded) {
          log.settle(rec.epoch, rec.inSeq, "refused", "stale-epoch");
        }
        sendTermInAck(chState, rec.inSeq, "refused", "stale-epoch");
        if (!lease.incarnationEnded) {
          let closeReason: EpochEndReason = "released";
          try {
            const st = await lease.port.state(chState.nativeId);
            if (st.holderKind === "human" || st.holderKind === "automation") {
              closeReason = "taken-back";
            }
          } catch {
            closeReason = "released";
          }
          closeEpoch(lease, closeReason);
        }
      } else {
        // No response (timeout / broken socket): stays uncertain in log, never retried.
        sendTermInAck(chState, rec.inSeq, "uncertain");
        audit("terminal-input", chState.ch, chState.sid, { result: "uncertain" });
        if (!lease.incarnationEnded) {
          closeEpoch(lease, "released");
        }
      }
    }
  }

  function handleTermIn(chState: AttachedChannelState, rec: TermIn): void {
    // 1. Ownership check before touching log or storage.
    if (!matchesChannelIncarnation(chState, rec)) {
      sendTermInAck(chState, rec.inSeq, "refused", "not-controller");
      return;
    }

    const liveLease = leasesBySid.get(chState.sid);
    if (
      liveLease &&
      !liveLease.closing &&
      liveLease.boundCh === chState.ch &&
      liveLease.generation === chState.generation &&
      liveLease.incarnation === chState.incarnation &&
      liveLease.lease.epoch === rec.epoch
    ) {
      liveLease.queue = liveLease.queue.then(() => processTermIn(chState, liveLease, rec));
      return;
    }

    const log = getOrOpenLog(chState.sid, chState.generation, chState.incarnation);
    const epochHasLiveLease =
      liveLease !== undefined &&
      !liveLease.closing &&
      liveLease.generation === chState.generation &&
      liveLease.incarnation === chState.incarnation &&
      liveLease.lease.epoch === rec.epoch;
    const reason =
      !epochHasLiveLease && rec.epoch >= 1 && rec.epoch <= log.highestOpenedEpoch()
        ? "stale-epoch"
        : "not-controller";
    sendTermInAck(chState, rec.inSeq, "refused", reason);
  }

  function executeTermInSync(chState: AttachedChannelState, rec: TermInSync): void {
    if (chState.closed || disposed) return;

    // 1. Check (sid, generation, incarnation).
    if (!matchesChannelIncarnation(chState, rec)) {
      sendErr(chState, "stale-incarnation", false);
      return;
    }

    const log = getOrOpenLog(chState.sid, chState.generation, chState.incarnation);
    const liveLease = leasesBySid.get(chState.sid);

    // 2 & 3. Live lease matching epoch?
    if (
      liveLease &&
      !liveLease.closing &&
      liveLease.generation === chState.generation &&
      liveLease.incarnation === chState.incarnation &&
      liveLease.lease.epoch === rec.epoch
    ) {
      if (liveLease.boundCh !== null && liveLease.boundCh !== chState.ch) {
        sendErr(chState, "not-controller", false);
        return;
      }
      if (liveLease.boundCh === null) {
        clearGraceTimer(liveLease);
        liveLease.boundCh = chState.ch;
        liveLease.ctx = chState.ctx;
      }
      const replay = log.replayAfter(rec.epoch, rec.lastAckedInSeq);
      for (const entry of replay.entries) {
        sendTermInAck(chState, entry.inSeq, entry.result, entry.reason);
      }
      if (!chState.closed && !disposed) {
        chState.ctx.sendControl({
          t: "term.in.synced",
          sid: chState.sid,
          epoch: rec.epoch,
          syncedThroughInSeq: replay.syncedThroughInSeq,
          evicted: false
        });
      }
      return;
    }

    // 4, 5, 6. Ended, evicted, or unknown epoch.
    const status = log.epochStatus(rec.epoch);
    if (status.status === "ended") {
      const replay = log.replayAfter(rec.epoch, rec.lastAckedInSeq);
      for (const entry of replay.entries) {
        sendTermInAck(chState, entry.inSeq, entry.result, entry.reason);
      }
      if (!chState.closed && !disposed) {
        chState.ctx.sendControl({
          t: "term.in.synced",
          sid: chState.sid,
          epoch: rec.epoch,
          syncedThroughInSeq: replay.syncedThroughInSeq,
          evicted: false
        });
        chState.ctx.sendControl({
          t: "term.ctl.state",
          sid: chState.sid,
          state: status.reason,
          epoch: rec.epoch
        });
      }
      return;
    }

    if (status.status === "evicted") {
      if (!chState.closed && !disposed) {
        chState.ctx.sendControl({
          t: "term.in.synced",
          sid: chState.sid,
          epoch: rec.epoch,
          syncedThroughInSeq: rec.lastAckedInSeq,
          evicted: true
        });
        chState.ctx.sendControl({
          t: "term.ctl.state",
          sid: chState.sid,
          state: "released",
          epoch: rec.epoch
        });
      }
      return;
    }

    sendErr(chState, "stale-epoch", false);
  }

  function handleTermInSync(chState: AttachedChannelState, rec: TermInSync): void {
    const liveLease = leasesBySid.get(chState.sid);
    if (
      liveLease &&
      !liveLease.closing &&
      (liveLease.boundCh === chState.ch || liveLease.boundCh === null) &&
      liveLease.lease.epoch === rec.epoch
    ) {
      liveLease.queue = liveLease.queue.then(() => executeTermInSync(chState, rec));
      return;
    }
    executeTermInSync(chState, rec);
  }

  function handleTermResize(chState: AttachedChannelState, rec: TermResize): void {
    const existing = leasesBySid.get(chState.sid);
    if (
      !existing ||
      existing.closing ||
      existing.incarnationEnded ||
      rec.sid !== chState.sid ||
      existing.boundCh !== chState.ch ||
      existing.generation !== chState.generation ||
      existing.incarnation !== chState.incarnation
    ) {
      sendErr(chState, "not-controller", false);
      return;
    }
    if (
      !Number.isSafeInteger(rec.cols) ||
      rec.cols < TERMINAL_SIZE_MIN ||
      rec.cols > TERMINAL_SIZE_MAX ||
      !Number.isSafeInteger(rec.rows) ||
      rec.rows < TERMINAL_SIZE_MIN ||
      rec.rows > TERMINAL_SIZE_MAX
    ) {
      sendErr(chState, "invalid-size", false);
      return;
    }
    const cols = rec.cols;
    const rows = rec.rows;
    existing.queue = existing.queue.then(async () => {
      if (
        existing.closing ||
        existing.incarnationEnded ||
        leasesBySid.get(chState.sid) !== existing ||
        existing.boundCh !== chState.ch ||
        chState.closed ||
        disposed
      ) {
        sendErr(chState, "not-controller", false);
        return;
      }
      try {
        await existing.port.resize(existing.lease, cols, rows);
        audit("terminal-resize", chState.ch, chState.sid);
      } catch (err) {
        if (getHostErrorCode(err) !== null) {
          sendErr(chState, "stale-epoch", false);
        } else {
          sendErr(chState, "host-unavailable", true);
        }
      }
    });
  }

  async function handleTermStop(chState: AttachedChannelState, rec: TermStop): Promise<void> {
    if (!matchesChannelIncarnation(chState, rec)) {
      sendErr(chState, "stale-incarnation", false);
      return;
    }
    if (!connectControlPort) {
      sendErr(chState, "control-unavailable", false);
      return;
    }
    const existing = leasesBySid.get(chState.sid);
    if (
      existing &&
      !existing.closing &&
      !existing.incarnationEnded &&
      existing.generation === chState.generation &&
      existing.incarnation === chState.incarnation
    ) {
      try {
        await existing.port.stopIfIncarnation(chState.nativeId, chState.generation, chState.incarnation);
        audit("terminal-stop", chState.ch, chState.sid, { result: "stopped" });
      } catch (err) {
        if (getHostErrorCode(err) !== null) {
          sendErr(chState, "stale-incarnation", false);
        } else {
          sendErr(chState, "host-unavailable", true);
        }
      }
      return;
    }
    let port: TerminalControlPort | null = null;
    try {
      port = await connectControlPort(chState.socketPath);
      if (chState.closed || disposed) return;
      await port.stopIfIncarnation(chState.nativeId, chState.generation, chState.incarnation);
      audit("terminal-stop", chState.ch, chState.sid, { result: "stopped" });
    } catch (err) {
      if (getHostErrorCode(err) !== null) {
        sendErr(chState, "stale-incarnation", false);
      } else {
        sendErr(chState, "host-unavailable", true);
      }
    } finally {
      if (port) {
        try {
          port.close();
        } catch {
          // ignore
        }
      }
    }
  }

  function releaseAll(_cause = "released"): void {
    for (const lease of [...leasesBySid.values()]) {
      if (!lease.closing && !lease.incarnationEnded) {
        try {
          void lease.port.release(lease.lease).catch(() => {});
        } catch {
          // ignore
        }
        closeEpoch(lease, "released");
      }
    }
  }

  return {
    attachChannel(attachment: TerminalInputChannelAttachment): void {
      if (disposed) return;
      const existingLease = leasesBySid.get(attachment.sid);
      if (
        existingLease &&
        (existingLease.generation !== attachment.generation ||
          existingLease.incarnation !== attachment.incarnation)
      ) {
        endIncarnation(existingLease.sid, existingLease.generation, existingLease.incarnation);
      }
      purgeStaleIncarnationLogs(
        root,
        scope,
        attachment.sid,
        attachment.generation,
        attachment.incarnation
      );
      channels.set(attachment.ch, {
        ch: attachment.ch,
        sid: attachment.sid,
        nativeId: attachment.nativeId,
        socketPath: attachment.socketPath,
        generation: attachment.generation,
        incarnation: attachment.incarnation,
        ctx: attachment.ctx,
        replyFilter: createTerminalReplyFilter(clock),
        closed: false
      });
    },

    onRecord(ch: number, record: TrunkTerminalRecord): void {
      if (disposed) return;
      const chState = channels.get(ch);
      if (!chState || chState.closed) return;

      switch (record.t) {
        case "term.ctl":
          if (record.action === "acquire") {
            void handleCtlAcquire(chState, record);
          } else {
            handleCtlRelease(chState, record);
          }
          break;
        case "term.in":
          handleTermIn(chState, record);
          break;
        case "term.in.sync":
          handleTermInSync(chState, record);
          break;
        case "term.resize":
          handleTermResize(chState, record);
          break;
        case "term.stop":
          void handleTermStop(chState, record);
          break;
        default:
          break;
      }
    },

    onChannelClose(ch: number, reason: TerminalChannelCloseReason): void {
      const chState = channels.get(ch);
      if (reason === "exit") {
        if (chState) {
          chState.closed = true;
          channels.delete(ch);
          endIncarnation(chState.sid, chState.generation, chState.incarnation);
        }
        for (const lease of [...leasesBySid.values()]) {
          if (lease.boundCh === ch) {
            endIncarnation(lease.sid, lease.generation, lease.incarnation);
          }
        }
        return;
      }

      // For excluded, error, dispose: close epoch(s) BEFORE removing channel from channels so term.ctl.state can emit.
      if (reason === "dispose") {
        releaseAll("dispose");
      } else if (reason === "peer-close" || reason === "excluded" || reason === "error") {
        for (const lease of [...leasesBySid.values()]) {
          if (lease.boundCh !== ch) continue;
          try {
            void lease.port.release(lease.lease).catch(() => {});
          } catch {
            // ignore
          }
          closeEpoch(lease, "released");
        }
      } else if (reason === "link") {
        for (const lease of [...leasesBySid.values()]) {
          if (lease.boundCh !== ch || lease.closing || lease.incarnationEnded) continue;
          lease.boundCh = null;
          lease.ctx = null;
          armGraceTimer(lease);
        }
      }

      if (chState) {
        chState.closed = true;
        channels.delete(ch);
      }
    },

    onLinkLost(): void {
      for (const lease of [...leasesBySid.values()]) {
        if (lease.boundCh === null || lease.closing || lease.incarnationEnded) continue;
        lease.boundCh = null;
        lease.ctx = null;
        armGraceTimer(lease);
      }
    },

    onLinkTerminated(info): void {
      releaseAll(info.cause);
    },

    releaseAll(cause = "released"): void {
      releaseAll(cause);
    },

    getLog(sid: string, generation: string, incarnation: string): TerminalInputLog | undefined {
      return logsByIncarnation.get(incKey(sid, generation, incarnation));
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      releaseAll("dispose");
      for (const chState of channels.values()) {
        chState.closed = true;
      }
      channels.clear();
    }
  };
}
