/**
 * LH-07 outbound trunk client.
 *
 * Owns the single outbound link for one enrolled node record:
 * - Re-reads enable flag, H2A_REMOTE_OFF and local kill file before first open
 *   and before every reconnect attempt.
 * - Loads the LH-01 node key (never generates) and signs the WET-2 clause 17
 *   challenge with Ed25519 over the contract provider's canonical bytes.
 * - Validates framing, sequences (`s`), channels (`0`, `1`, `>= 2`), phases
 *   and directions strictly before dispatching any record.
 * - Delegates catalogue framing to the injected contract provider and manages
 *   per-channel monotonic credit (`TrunkCreditManager`) and instance lifecycle
 *   (`TrunkInstanceManager`).
 * - Persists non-sensitive link state and last refusal in
 *   `<root>/remote-control/link-status.json` under `<root>/remote-control/.lock`.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { LockTimeoutError, withLockSync } from "../local-files/locks.js";
import { isRemoteControlEnabled, isRemoteControlKilledByEnv } from "./flag.js";
import { loadNodeKey, type NodeKeyOptions } from "./node-key.js";
import { readRemoteControlKillFlag, setRemoteControlKillFlag } from "./service.js";
import {
  MAX_CREDIT_WINDOW_BYTES,
  MAX_CREDIT_WINDOW_RECORDS,
  TrunkCreditManager,
  type CreditAvailability
} from "./trunk-credit.js";
import {
  remoteControlLockPath,
  TrunkInstanceManager,
  type InstanceActResult
} from "./trunk-instance.js";
import {
  isTrunkRecord,
  signTrunkBytes,
  TRUNK_PROTOCOL_VERSION,
  type CatalogueDelta,
  type CatalogueRowStatusUpdate,
  type CatalogueSessionRow,
  type CatalogueSnapshot,
  type CreditRecord,
  type InstanceBoundRecord,
  type InstanceRevokedRecord,
  type TermOpen,
  type TermOpened,
  type TrunkAuthPayload,
  type TrunkErrorRecord,
  type TrunkHelloRecord,
  type TrunkReadyRecord,
  type TrunkRecord,
  type TrunkTerminalRecord
} from "./types.js";

const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 45_000;
const IDLE_LIVENESS_INTERVAL_MS = 5_000;
const KILL_WATCHDOG_INTERVAL_MS = 500;
const BACKOFF_BASE_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

const DEFINITIVE_AUTH_ERRORS = new Set([
  "unknown-enrolment",
  "enrolment-revoked",
  "not-provisioned",
  "record-expired",
  "missing-usage",
  "invalid-signature",
  "identity-mismatch",
  "tenant-mismatch",
  "mesh-mismatch",
  "endpoint-mismatch",
  "challenge-expired",
  "challenge-replayed",
  "challenge-mismatch",
  "unknown-challenge",
  "nonce-too-short",
  "fakes-sealed",
  "remote-control-disabled"
]);

export interface TrunkEnrolment {
  readonly meshId: string;
  readonly endpoint: string;
  readonly tenantId: string;
  readonly enrolmentRef: string;
  readonly nodeId: string;
}

export interface TrunkClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TrunkConnectionHandlers {
  readonly onMessage: (frame: Uint8Array | string) => void;
  readonly onClose: (reason?: string) => void;
  readonly onError: (error: Error) => void;
}

export interface TrunkConnection {
  send(frame: Uint8Array): void;
  close(reason?: string): void;
}

export interface TrunkConnector {
  open(endpoint: string, handlers: TrunkConnectionHandlers): TrunkConnection;
}

export type CatalogueStatusUpdate = CatalogueRowStatusUpdate;

export type CatalogueEmitEvent =
  | CatalogueSnapshot
  | CatalogueDelta
  | { readonly kind: "snapshot"; readonly at: number; readonly rows: readonly CatalogueSessionRow[]; readonly truncatedRows?: number }
  | {
      readonly kind: "delta";
      readonly at: number;
      readonly adds?: readonly CatalogueSessionRow[];
      readonly updates?: readonly (CatalogueSessionRow | CatalogueStatusUpdate)[];
      readonly removes?: readonly string[];
    };

export interface TrunkCatalogueSource {
  startWatch(emit: (event: CatalogueEmitEvent) => void): void;
  stopWatch(): void;
  applyRevokedInstances(ids: readonly string[]): void;
  setInstanceStatus(instanceId: string, status: "live" | "revoked"): void;
}

export interface TrunkChannelContext {
  readonly linkGeneration: number;
  readonly ch: number;
  availableOutput(): CreditAvailability;
  trySendOutput(record: Record<string, unknown>, rawBytes: number): "sent" | "no-credit" | "closed";
  sendControl(record: Record<string, unknown>): boolean;
  close(): void;
}

export interface TrunkTerminalConsumer {
  onOpen(
    open: TermOpen,
    ctx: TrunkChannelContext
  ): { readonly ok: true; readonly opened?: Omit<TermOpened, "v" | "t" | "ch" | "s"> } | { readonly ok: false; readonly code: string; readonly retryable?: boolean } | void;
  onCredit?(ch: number, available: CreditAvailability): void;
  onRecord?(ch: number, record: TrunkTerminalRecord): void;
  onClose?(ch: number, reason: string): void;
  onLinkLost?(info: { readonly linkGeneration: number; readonly reason: string; readonly at: number }): void;
  onLinkReady?(info: { readonly linkGeneration: number; readonly at: number }): void;
}

export interface TrunkInstanceBindPayload {
  readonly meshId: string;
  readonly endpoint: string;
  readonly tenantId: string;
  readonly enrolmentRef: string;
  readonly nodeId: string;
  readonly instanceId: string;
  readonly instancePublicKey: string;
  readonly bindNonce: string;
}

export interface PreparedCatalogueRecord {
  readonly record: CatalogueSnapshot | CatalogueDelta;
  readonly encodedBytes: number;
  readonly nextCursor: unknown;
  readonly deliveredAdds?: readonly CatalogueSessionRow[];
  readonly deliveredUpdates?: readonly (CatalogueSessionRow | CatalogueStatusUpdate)[];
  readonly deliveredRemoves?: readonly string[];
}

export interface TrunkContractProvider {
  readonly wet2TextHash?: string;
  readonly maxCatalogueRecordBytes: number;
  readonly maxSignallingRecordBytes?: number;
  readonly maxTermOutRawBytes?: number;
  readonly maxRecordBytes?: number;
  encodeFrame(record: TrunkRecord | Record<string, unknown>): Uint8Array;
  decodeFrame(frame: Uint8Array | string): { readonly ok: true; readonly record: TrunkRecord; readonly encodedBodyBytes: number } | { readonly ok: false; readonly code: string };
  canonicalAuthBytes(payload: TrunkAuthPayload): Uint8Array;
  canonicalInstanceBindBytes(payload: TrunkInstanceBindPayload): Uint8Array;
  prepareNextCatalogueRecord(request: {
    readonly mode: "snapshot" | "delta";
    readonly at: number;
    readonly rows?: readonly CatalogueSessionRow[];
    readonly truncatedRows?: number;
    readonly removes?: readonly string[];
    readonly updates?: readonly (CatalogueSessionRow | CatalogueStatusUpdate)[];
    readonly adds?: readonly CatalogueSessionRow[];
    readonly cursor: unknown;
    readonly nextSeq: number;
    readonly revokedInstanceIds?: ReadonlySet<string>;
  }): PreparedCatalogueRecord | null;
}

export interface TrunkAuditEvent {
  readonly kind: string;
  readonly at: number;
  readonly meshId: string;
  readonly tenantId: string;
  readonly enrolmentRef: string;
  readonly instanceId?: string;
  readonly instanceHandle?: string;
  readonly fingerprint?: string;
  readonly reason?: string;
  readonly linkGeneration?: number;
}

export interface TrunkLinkRefusal {
  readonly code: string;
  readonly instanceId?: string;
  readonly instanceHandle?: string;
  readonly at: number;
}

export interface TrunkLinkStatus {
  readonly state: string;
  readonly linkGeneration?: number;
  readonly reason?: string;
  readonly requiresEnrolment?: boolean;
  readonly updatedAt: number;
  readonly lastRefusal?: TrunkLinkRefusal;
}

export interface TrunkClientOptions {
  readonly root: string;
  readonly env: Readonly<Record<string, string | undefined>> | (() => Readonly<Record<string, string | undefined>>);
  readonly enrolment: TrunkEnrolment;
  readonly nodeKeyOptions?: NodeKeyOptions;
  readonly connector: TrunkConnector;
  readonly contract?: TrunkContractProvider;
  readonly clock: TrunkClock;
  readonly random?: () => number;
  readonly catalogue: TrunkCatalogueSource;
  readonly terminalConsumer?: TrunkTerminalConsumer;
  readonly onEnrolmentRevoked?: (enrolment: TrunkEnrolment) => void;
  readonly onAudit?: (event: TrunkAuditEvent) => void;
  readonly onLinkEvent?: (event: {
    readonly kind: string;
    readonly at: number;
    readonly linkGeneration?: number;
    readonly reason?: string;
    readonly outageMs?: number;
  }) => void;
  readonly protocolVersions?: readonly number[];
}

export function linkStatusFilePath(root: string): string {
  return join(root, "remote-control", "link-status.json");
}

function sanitizeStatus(raw: unknown): TrunkLinkStatus | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r["state"] !== "string" || typeof r["updatedAt"] !== "number" || !Number.isFinite(r["updatedAt"])) {
    return undefined;
  }
  const out: {
    state: string;
    linkGeneration?: number;
    reason?: string;
    requiresEnrolment?: boolean;
    updatedAt: number;
    lastRefusal?: TrunkLinkRefusal;
  } = {
    state: r["state"],
    updatedAt: r["updatedAt"]
  };
  if (typeof r["linkGeneration"] === "number" && Number.isSafeInteger(r["linkGeneration"])) {
    out.linkGeneration = r["linkGeneration"];
  }
  if (typeof r["reason"] === "string") {
    out.reason = r["reason"];
  }
  if (typeof r["requiresEnrolment"] === "boolean") {
    out.requiresEnrolment = r["requiresEnrolment"];
  }
  if (r["lastRefusal"] && typeof r["lastRefusal"] === "object" && !Array.isArray(r["lastRefusal"])) {
    const lr = r["lastRefusal"] as Record<string, unknown>;
    if (typeof lr["code"] === "string" && typeof lr["at"] === "number" && Number.isFinite(lr["at"])) {
      out.lastRefusal = {
        code: lr["code"],
        ...(typeof lr["instanceId"] === "string" ? { instanceId: lr["instanceId"] } : {}),
        ...(typeof lr["instanceHandle"] === "string" ? { instanceHandle: lr["instanceHandle"] } : {}),
        at: lr["at"]
      };
    }
  }
  return out;
}

function readLinkStatusUnlocked(root: string): TrunkLinkStatus | undefined {
  const file = linkStatusFilePath(root);
  if (!existsSync(file)) return undefined;
  try {
    return sanitizeStatus(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return undefined;
  }
}

export function readLinkStatusFile(root: string, options?: { readonly timeoutMs?: number }): TrunkLinkStatus | undefined {
  const dir = join(root, "remote-control");
  if (!existsSync(dir)) return undefined;
  try {
    return withLockSync(
      remoteControlLockPath(root),
      () => readLinkStatusUnlocked(root),
      { timeoutMs: options?.timeoutMs ?? 250 }
    );
  } catch {
    return readLinkStatusUnlocked(root);
  }
}

export function writeLinkStatusFile(
  root: string,
  patch: Partial<TrunkLinkStatus>,
  options?: { readonly timeoutMs?: number }
): { readonly ok: boolean; readonly busy?: boolean; readonly status?: TrunkLinkStatus } {
  const dir = join(root, "remote-control");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // ignore
  }
  try {
    const status = withLockSync(
      remoteControlLockPath(root),
      () => {
        const existing = readLinkStatusUnlocked(root);
        const merged = sanitizeStatus({
          ...(existing ?? {}),
          ...patch,
          state: patch.state ?? existing?.state ?? "idle",
          updatedAt: patch.updatedAt ?? existing?.updatedAt ?? Date.now()
        })!;
        const file = linkStatusFilePath(root);
        const tmp = join(dir, `.link-status.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
        writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
        try {
          chmodSync(tmp, 0o600);
        } catch {
          // ignore
        }
        renameSync(tmp, file);
        return merged;
      },
      { timeoutMs: options?.timeoutMs ?? 250 }
    );
    return { ok: true, status };
  } catch (err) {
    if (err instanceof LockTimeoutError) {
      return { ok: false, busy: true };
    }
    return { ok: false };
  }
}

interface PendingDeltaState {
  at: number;
  removes: Set<string>;
  priorityUpdates: Map<string, CatalogueStatusUpdate>;
  updates: Map<string, CatalogueSessionRow>;
  adds: Map<string, CatalogueSessionRow>;
}

interface ActiveConnectionState {
  readonly id: number;
  handle: TrunkConnection | null;
  earlyOutboundQueue: Uint8Array[];
  closed: boolean;
  phase: "awaiting-hello" | "awaiting-ready" | "ready";
  expectedInboundSeq: number;
  outboundSeq: number;
  linkGeneration?: number;
  loadedPrivateKeyPem: string;
  credit: TrunkCreditManager;
  activeChannels: Set<number>;
  watching: boolean;
  lastPongAt: number;
  pingTimer: unknown;
  pongTimer: unknown;
  livenessTimer: unknown;
  killWatchdogTimer: unknown;
  // Catalogue streaming state for this connection generation
  deliveredRows: Map<string, CatalogueSessionRow>;
  activeSnapshot: { at: number; rows: readonly CatalogueSessionRow[]; truncatedRows?: number } | null;
  snapshotCursor: unknown;
  queuedLatestSnapshot: { at: number; rows: readonly CatalogueSessionRow[]; truncatedRows?: number } | null;
  pendingDelta: PendingDeltaState | null;
  deltaCursor: unknown;
  queuedDelta: PendingDeltaState | null;
}

function emptyDelta(at: number): PendingDeltaState {
  return {
    at,
    removes: new Set(),
    priorityUpdates: new Map(),
    updates: new Map(),
    adds: new Map()
  };
}

function isStatusOnlyUpdate(u: CatalogueSessionRow | CatalogueStatusUpdate): u is CatalogueStatusUpdate {
  return !("hostKind" in u) && "instanceStatus" in u && "instanceId" in u;
}

export class TrunkClient {
  readonly #opts: TrunkClientOptions;
  readonly #protocolVersions: readonly number[];
  readonly #random: () => number;
  #state = "idle";
  #linkGeneration: number | undefined;
  #connSeq = 0;
  #activeConn: ActiveConnectionState | null = null;
  #openingAttempt = false;
  #terminalStopped = false;
  #backoffAttempt = 0;
  #reconnectTimer: unknown = null;
  #lastLostAt: number | null = null;
  #statusRetryTimer: unknown = null;
  #pendingStatusPatch: Partial<TrunkLinkStatus> | null = null;
  #instanceManager: TrunkInstanceManager | null = null;

  constructor(options: TrunkClientOptions) {
    this.#opts = options;
    this.#protocolVersions = options.protocolVersions && options.protocolVersions.length > 0
      ? [...options.protocolVersions]
      : [TRUNK_PROTOCOL_VERSION];
    this.#random = options.random ?? Math.random;
  }

  getState(): string {
    return this.#state;
  }

  getLinkGeneration(): number | undefined {
    return this.#linkGeneration;
  }

  readLinkStatus(): TrunkLinkStatus | undefined {
    return readLinkStatusFile(this.#opts.root);
  }

  start(): { readonly ok: boolean; readonly reason?: string; readonly requiresEnrolment?: boolean } {
    if (this.#openingAttempt || (this.#activeConn !== null && !this.#activeConn.closed)) {
      return { ok: false, reason: "attempt-already-in-flight" };
    }
    this.#terminalStopped = false;
    this.#clearReconnectTimer();
    return this.#attemptConnect();
  }

  stop(reason = "local-stop"): void {
    this.#terminalStopped = true;
    this.#clearReconnectTimer();
    const conn = this.#activeConn;
    if (conn && !conn.closed) {
      if (conn.phase === "ready") {
        this.#sendRecord(conn, { v: TRUNK_PROTOCOL_VERSION, t: "bye", ch: 0 });
      }
      this.#teardownConnection(conn, reason, { notifyLoss: false });
    }
    this.#state = "stopped";
    this.#persistStatus({ state: "stopped", reason, updatedAt: this.#opts.clock.now() });
    this.#instanceManager?.dispose();
    this.#clearStatusRetryTimer();
    this.#emitLinkEvent({ kind: "stopped", at: this.#opts.clock.now(), reason });
  }

  bindInstance(instanceId: string): { readonly ok: boolean; readonly reason?: string } {
    if (!this.#activeConn || this.#activeConn.closed || this.#activeConn.phase !== "ready" || !this.#instanceManager) {
      return { ok: false, reason: "link-not-ready" };
    }
    return this.#instanceManager.requestBind(instanceId);
  }

  admitInstanceAct(instanceId: string): InstanceActResult {
    if (!this.#instanceManager) {
      return { ok: false, reason: "link-not-ready" };
    }
    return this.#instanceManager.admitAct(instanceId);
  }

  availableOutput(ch: number): CreditAvailability {
    const conn = this.#activeConn;
    if (!conn || conn.closed || conn.phase !== "ready") {
      return { records: 0, bytes: 0 };
    }
    if (ch !== 1 && !conn.activeChannels.has(ch)) {
      return { records: 0, bytes: 0 };
    }
    return conn.credit.availableOutput(ch);
  }

  trySendOutput(ch: number, record: Record<string, unknown>, rawBytes: number): "sent" | "no-credit" | "closed" {
    const conn = this.#activeConn;
    if (!conn || conn.closed || conn.phase !== "ready") {
      return "closed";
    }
    if (ch < 2 || !conn.activeChannels.has(ch)) {
      return "closed";
    }
    if (!conn.credit.canSendOutput(ch, rawBytes)) {
      return "no-credit";
    }
    const sent = this.#sendRecord(conn, { ...record, v: TRUNK_PROTOCOL_VERSION, ch });
    if (!sent) {
      return "closed";
    }
    conn.credit.recordSentOutput(ch, rawBytes);
    return "sent";
  }

  sendControl(ch: number, record: Record<string, unknown>): boolean {
    const conn = this.#activeConn;
    if (!conn || conn.closed || conn.phase !== "ready") {
      return false;
    }
    if (ch >= 2 && !conn.activeChannels.has(ch)) {
      return false;
    }
    return this.#sendRecord(conn, { ...record, v: TRUNK_PROTOCOL_VERSION, ch });
  }

  closeChannel(ch: number): void {
    const conn = this.#activeConn;
    if (!conn || conn.closed) return;
    if (ch >= 2 && conn.activeChannels.has(ch)) {
      conn.activeChannels.delete(ch);
      conn.credit.closeChannel(ch);
    }
  }

  #resolveEnv(): Readonly<Record<string, string | undefined>> {
    return typeof this.#opts.env === "function" ? this.#opts.env() : this.#opts.env;
  }

  #checkPreConnectGuards(): { readonly ok: true; readonly env: Readonly<Record<string, string | undefined>> } | { readonly ok: false; readonly reason: string } {
    const env = this.#resolveEnv();
    if (!isRemoteControlEnabled(env)) {
      this.#clearReconnectTimer();
      this.#state = "disabled";
      return { ok: false, reason: "remote-control-disabled" };
    }
    if (isRemoteControlKilledByEnv(env)) {
      this.#terminalStopped = true;
      this.#clearReconnectTimer();
      setRemoteControlKillFlag(this.#opts.root);
      this.#state = "killed";
      this.#persistStatus({ state: "killed", reason: "killed-by-env", updatedAt: this.#opts.clock.now() });
      this.#emitAudit({ kind: "kill-switch-env", reason: "killed-by-env" });
      this.#emitLinkEvent({ kind: "killed", at: this.#opts.clock.now(), reason: "killed-by-env" });
      return { ok: false, reason: "killed-by-env" };
    }
    if (readRemoteControlKillFlag(this.#opts.root).kill) {
      this.#terminalStopped = true;
      this.#clearReconnectTimer();
      this.#state = "killed";
      this.#persistStatus({ state: "killed", reason: "killed", updatedAt: this.#opts.clock.now() });
      this.#emitAudit({ kind: "kill-switch-file", reason: "killed" });
      this.#emitLinkEvent({ kind: "killed", at: this.#opts.clock.now(), reason: "killed" });
      return { ok: false, reason: "killed" };
    }
    if (!this.#opts.contract) {
      this.#state = "contract-unavailable";
      this.#persistStatus({ state: "contract-unavailable", reason: "contract-unavailable", updatedAt: this.#opts.clock.now() });
      return { ok: false, reason: "contract-unavailable" };
    }
    return { ok: true, env };
  }

  #attemptConnect(): { readonly ok: boolean; readonly reason?: string; readonly requiresEnrolment?: boolean } {
    if (this.#terminalStopped) {
      return { ok: false, reason: "stopped" };
    }
    const guard = this.#checkPreConnectGuards();
    if (!guard.ok) {
      return guard;
    }

    const keyOptions: NodeKeyOptions = {
      ...(this.#opts.nodeKeyOptions ?? {}),
      ...(this.#opts.nodeKeyOptions?.env === undefined ? { env: guard.env } : {})
    };
    const keyResult = loadNodeKey(keyOptions);
    if (keyResult.state === "missing") {
      this.#state = "node-key-missing";
      this.#persistStatus({
        state: "node-key-missing",
        reason: "node-key-missing",
        requiresEnrolment: true,
        updatedAt: this.#opts.clock.now()
      });
      return { ok: false, reason: "node-key-missing", requiresEnrolment: true };
    }
    if (keyResult.state === "invalid") {
      this.#state = "node-key-invalid";
      this.#persistStatus({
        state: "node-key-invalid",
        reason: "node-key-invalid",
        requiresEnrolment: true,
        updatedAt: this.#opts.clock.now()
      });
      return { ok: false, reason: "node-key-invalid", requiresEnrolment: true };
    }
    if (keyResult.nodeId !== this.#opts.enrolment.nodeId) {
      this.#state = "node-id-mismatch";
      this.#persistStatus({
        state: "node-id-mismatch",
        reason: "node-id-mismatch",
        updatedAt: this.#opts.clock.now()
      });
      return { ok: false, reason: "node-id-mismatch" };
    }

    this.#openingAttempt = true;
    const connId = ++this.#connSeq;
    const conn: ActiveConnectionState = {
      id: connId,
      handle: null,
      earlyOutboundQueue: [],
      closed: false,
      phase: "awaiting-hello",
      expectedInboundSeq: 1,
      outboundSeq: 0,
      loadedPrivateKeyPem: keyResult.privateKeyPem,
      credit: new TrunkCreditManager(),
      activeChannels: new Set(),
      watching: false,
      lastPongAt: this.#opts.clock.now(),
      pingTimer: null,
      pongTimer: null,
      livenessTimer: null,
      killWatchdogTimer: null,
      deliveredRows: new Map(),
      activeSnapshot: null,
      snapshotCursor: null,
      queuedLatestSnapshot: null,
      pendingDelta: null,
      deltaCursor: null,
      queuedDelta: null
    };
    this.#activeConn = conn;
    this.#state = "connecting";

    let handle: TrunkConnection;
    try {
      handle = this.#opts.connector.open(this.#opts.enrolment.endpoint, {
        onMessage: (frame) => this.#onMessage(connId, frame),
        onClose: (reason) => this.#onClose(connId, reason),
        onError: (err) => this.#onError(connId, err)
      });
    } catch {
      this.#openingAttempt = false;
      this.#handleConnectionLoss(conn, "connect-error", true);
      return { ok: false, reason: "connect-error" };
    }

    this.#openingAttempt = false;
    conn.handle = handle;
    if (conn.closed) {
      try {
        handle.close("closed-during-open");
      } catch {
        // ignore
      }
      return { ok: false, reason: this.#state };
    }

    // Flush any outbound frames generated synchronously during open() (e.g. hello -> auth).
    while (conn.earlyOutboundQueue.length > 0 && !conn.closed && this.#activeConn === conn) {
      const queued = conn.earlyOutboundQueue.shift()!;
      try {
        handle.send(queued);
      } catch {
        this.#handleConnectionLoss(conn, "write-error", true);
        return { ok: false, reason: "write-error" };
      }
    }

    return { ok: true };
  }

  #sendRecord(conn: ActiveConnectionState, partial: Record<string, unknown>): boolean {
    if (conn.closed || this.#activeConn !== conn || !this.#opts.contract) {
      return false;
    }
    const nextSeq = conn.outboundSeq + 1;
    const record = {
      ...partial,
      v: TRUNK_PROTOCOL_VERSION,
      s: nextSeq
    };
    let frame: Uint8Array;
    try {
      frame = this.#opts.contract.encodeFrame(record);
    } catch {
      this.#handleConnectionLoss(conn, "encode-error", true);
      return false;
    }
    // Reserve `s` at actual dispatch.
    conn.outboundSeq = nextSeq;
    if (conn.handle === null) {
      conn.earlyOutboundQueue.push(frame);
      return true;
    }
    try {
      conn.handle.send(frame);
      return true;
    } catch {
      this.#handleConnectionLoss(conn, "write-error", true);
      return false;
    }
  }

  #onMessage(connId: number, frame: Uint8Array | string): void {
    const conn = this.#activeConn;
    if (!conn || conn.id !== connId || conn.closed || !this.#opts.contract) {
      // Ignore late messages from stale/superseded connections, even if ch was reused.
      return;
    }

    const decoded = this.#opts.contract.decodeFrame(frame);
    if (!decoded.ok) {
      this.#closeProtocolError(conn, decoded.code);
      return;
    }
    const rec = decoded.record;
    if (!isTrunkRecord(rec)) {
      this.#closeProtocolError(conn, "invalid-record");
      return;
    }
    if (rec.s !== conn.expectedInboundSeq) {
      this.#closeProtocolError(conn, "sequence-error");
      return;
    }
    conn.expectedInboundSeq += 1;

    // Unknown `x-*` extension: ignore after validating envelope, channel and `s`.
    if (rec.t.startsWith("x-")) {
      if (rec.ch >= 2 && !conn.activeChannels.has(rec.ch)) {
        this.#closeProtocolError(conn, "unallocated-channel");
        return;
      }
      return;
    }

    // Phase-strict validation before any dispatch.
    if (conn.phase === "awaiting-hello") {
      if (rec.ch === 0 && rec.t === "hello") {
        this.#handleHello(conn, rec);
        return;
      }
      if (rec.ch === 0 && rec.t === "err") {
        this.#handleHandshakeError(conn, rec);
        return;
      }
      this.#closeProtocolError(conn, "unexpected-record-before-hello");
      return;
    }

    if (conn.phase === "awaiting-ready") {
      if (rec.ch === 0 && rec.t === "ready") {
        this.#handleReady(conn, rec);
        return;
      }
      if (rec.ch === 0 && rec.t === "err") {
        this.#handleHandshakeError(conn, rec);
        return;
      }
      this.#closeProtocolError(conn, "unexpected-record-before-ready");
      return;
    }

    // Phase === "ready"
    this.#dispatchReadyRecord(conn, rec);
  }

  #handleHello(conn: ActiveConnectionState, hello: TrunkHelloRecord): void {
    const commonVersions = hello.protocolVersions.filter((v) => this.#protocolVersions.includes(v));
    if (commonVersions.length === 0) {
      this.#closeProtocolError(conn, "unsupported-protocol-version");
      return;
    }
    const selectedVersion = Math.max(...commonVersions);
    if (selectedVersion !== TRUNK_PROTOCOL_VERSION) {
      this.#closeProtocolError(conn, "unsupported-protocol-version");
      return;
    }
    if (
      hello.meshId !== this.#opts.enrolment.meshId ||
      hello.endpoint !== this.#opts.enrolment.endpoint ||
      hello.tenantId !== this.#opts.enrolment.tenantId
    ) {
      this.#closeProtocolError(conn, "hello-context-mismatch");
      return;
    }
    const clientTime = this.#opts.clock.now();
    const authPayload: TrunkAuthPayload = {
      nonce: hello.nonce,
      meshId: hello.meshId,
      endpoint: hello.endpoint,
      tenantId: hello.tenantId,
      serverTime: hello.serverTime,
      nodeId: this.#opts.enrolment.nodeId,
      enrolmentRef: this.#opts.enrolment.enrolmentRef,
      protocolVersions: [...this.#protocolVersions],
      clientTime
    };
    const canonicalBytes = this.#opts.contract!.canonicalAuthBytes(authPayload);
    const signature = signTrunkBytes(canonicalBytes, conn.loadedPrivateKeyPem);
    conn.phase = "awaiting-ready";
    this.#sendRecord(conn, {
      t: "auth",
      ch: 0,
      nodeId: authPayload.nodeId,
      enrolmentRef: authPayload.enrolmentRef,
      protocolVersions: authPayload.protocolVersions,
      clientTime,
      signature
    });
  }

  #handleHandshakeError(conn: ActiveConnectionState, err: TrunkErrorRecord): void {
    const code = err.code;
    this.#teardownConnection(conn, code, { notifyLoss: false });
    if (code === "handshake_busy") {
      this.#state = "handshake-busy";
      this.#persistStatus({
        state: "handshake-busy",
        reason: code,
        updatedAt: this.#opts.clock.now()
      });
      const retryDelay = Math.max(BACKOFF_MIN_MS, err.retryAfterMs ?? 60_000);
      this.#scheduleReconnectWithDelay(retryDelay);
      return;
    }
    if (!err.retryable || DEFINITIVE_AUTH_ERRORS.has(code)) {
      this.#terminalStopped = true;
      this.#clearReconnectTimer();
      this.#state = "auth-refused";
      this.#persistStatus({
        state: "auth-refused",
        reason: code,
        updatedAt: this.#opts.clock.now()
      });
      this.#emitAudit({ kind: "auth-refused", reason: code });
      return;
    }
    this.#scheduleReconnectBackoff();
  }

  #handleReady(conn: ActiveConnectionState, ready: TrunkReadyRecord): void {
    const maxRecs = Math.min(MAX_CREDIT_WINDOW_RECORDS, ready.limits?.maxCreditRecords ?? MAX_CREDIT_WINDOW_RECORDS);
    const maxBytes = Math.min(MAX_CREDIT_WINDOW_BYTES, ready.limits?.maxCreditBytes ?? MAX_CREDIT_WINDOW_BYTES);
    conn.credit = new TrunkCreditManager({ maxWindowRecords: maxRecs, maxWindowBytes: maxBytes });
    conn.credit.openChannel(1);

    conn.phase = "ready";
    conn.linkGeneration = ready.linkGeneration;
    conn.lastPongAt = this.#opts.clock.now();
    this.#linkGeneration = ready.linkGeneration;
    this.#state = "ready";
    this.#backoffAttempt = 0;

    if (!this.#instanceManager) {
      this.#instanceManager = new TrunkInstanceManager({
        root: this.#opts.root,
        meshId: this.#opts.enrolment.meshId,
        endpoint: this.#opts.enrolment.endpoint,
        tenantId: this.#opts.enrolment.tenantId,
        enrolmentRef: this.#opts.enrolment.enrolmentRef,
        nodeId: this.#opts.enrolment.nodeId,
        clock: this.#opts.clock,
        canonicalBindBytes: (payload) => this.#opts.contract!.canonicalInstanceBindBytes(payload),
        sendBindRecord: (rec) => this.sendControl(0, rec),
        onAudit: (ev) => this.#opts.onAudit?.({ ...ev, linkGeneration: this.#linkGeneration }),
        onRefusalRecorded: (refusal) => {
          this.#persistStatus({ lastRefusal: refusal, updatedAt: refusal.at });
        },
        onStatusUpdated: (instanceId, status) => {
          this.#opts.catalogue.setInstanceStatus(instanceId, status);
        }
      });
    }

    // Apply ALL revocations to instance store and catalogue BEFORE accepting watch or dispatching channels.
    const effectiveRevoked = this.#instanceManager.onReady(ready.bindNonce, ready.revokedInstances);
    this.#opts.catalogue.applyRevokedInstances(effectiveRevoked);

    const now = this.#opts.clock.now();
    const outageMs = this.#lastLostAt !== null ? Math.max(0, now - this.#lastLostAt) : undefined;
    this.#lastLostAt = null;

    this.#persistStatus({
      state: "ready",
      linkGeneration: ready.linkGeneration,
      updatedAt: now
    });
    this.#emitLinkEvent({
      kind: "link-ready",
      at: now,
      linkGeneration: ready.linkGeneration,
      ...(outageMs !== undefined ? { outageMs } : {})
    });
    this.#opts.terminalConsumer?.onLinkReady?.({ linkGeneration: ready.linkGeneration, at: now });

    this.#startLiveTimers(conn);
  }

  #dispatchReadyRecord(conn: ActiveConnectionState, rec: TrunkRecord): void {
    // Reject server->client invalid directions (client-only outbound records)
    if (
      rec.t === "hello" ||
      rec.t === "auth" ||
      rec.t === "ready" ||
      rec.t === "instance.bind" ||
      rec.t === "cat.snapshot" ||
      rec.t === "cat.delta" ||
      rec.t === "term.opened" ||
      rec.t === "term.out" ||
      rec.t === "term.gap" ||
      rec.t === "term.in.ack" ||
      rec.t === "term.ctl.state" ||
      rec.t === "term.exit"
    ) {
      this.#closeProtocolError(conn, "invalid-record-direction");
      return;
    }

    if (rec.ch === 0) {
      switch (rec.t) {
        case "ping":
          this.#sendRecord(conn, { t: "pong", ch: 0, at: rec.at });
          return;
        case "pong":
          conn.lastPongAt = this.#opts.clock.now();
          this.#reschedulePongTimer(conn);
          return;
        case "superseded":
          this.#handleTerminalCause(conn, "superseded", rec.reason ?? "superseded");
          return;
        case "revoked":
          this.#handleTerminalCause(conn, "revoked", rec.reason ?? "revoked");
          return;
        case "kill":
          this.#handleTerminalCause(conn, "killed", rec.reason ?? "kill");
          return;
        case "bye":
          this.#handleTerminalCause(conn, "stopped", "bye");
          return;
        case "instance.bound": {
          const res = this.#instanceManager?.onInstanceBound(rec as InstanceBoundRecord);
          if (!res || !res.ok) {
            this.#closeProtocolError(conn, res?.code ?? "unexpected-instance-bound");
          }
          return;
        }
        case "instance.revoked":
          this.#instanceManager?.onInstanceRevoked(rec as InstanceRevokedRecord);
          return;
        case "err":
          this.#closeProtocolError(conn, rec.code);
          return;
        default:
          this.#closeProtocolError(conn, "invalid-channel-0-record");
          return;
      }
    }

    if (rec.ch === 1) {
      switch (rec.t) {
        case "watch.start":
          this.#startWatch(conn);
          return;
        case "watch.stop":
          this.#stopWatch(conn);
          return;
        case "credit":
          this.#handleCredit(conn, rec as CreditRecord);
          return;
        case "err":
          this.#closeProtocolError(conn, rec.code);
          return;
        default:
          this.#closeProtocolError(conn, "invalid-channel-1-record");
          return;
      }
    }

    // ch >= 2
    if (rec.t === "term.open") {
      if (conn.activeChannels.has(rec.ch)) {
        this.#closeProtocolError(conn, "channel-already-allocated");
        return;
      }
      this.#handleTermOpen(conn, rec);
      return;
    }

    if (!conn.activeChannels.has(rec.ch)) {
      this.#closeProtocolError(conn, "unallocated-channel");
      return;
    }

    if (rec.t === "credit") {
      this.#handleCredit(conn, rec as CreditRecord);
      return;
    }

    if (rec.t === "term.close") {
      conn.activeChannels.delete(rec.ch);
      conn.credit.closeChannel(rec.ch);
      this.#opts.terminalConsumer?.onClose?.(rec.ch, "peer-close");
      return;
    }

    this.#opts.terminalConsumer?.onRecord?.(rec.ch, rec as TrunkTerminalRecord);
  }

  #handleTermOpen(conn: ActiveConnectionState, open: TermOpen): void {
    const ch = open.ch;
    const gen = conn.linkGeneration!;
    // Allocate channel & credit ledger immediately so initial credit can arrive even before term.opened.
    conn.activeChannels.add(ch);
    conn.credit.openChannel(ch);

    const ctx: TrunkChannelContext = {
      linkGeneration: gen,
      ch,
      availableOutput: () => (this.#activeConn === conn && !conn.closed ? conn.credit.availableOutput(ch) : { records: 0, bytes: 0 }),
      trySendOutput: (record, rawBytes) => (this.#activeConn === conn && !conn.closed ? this.trySendOutput(ch, record, rawBytes) : "closed"),
      sendControl: (record) => (this.#activeConn === conn && !conn.closed ? this.sendControl(ch, record) : false),
      close: () => {
        if (this.#activeConn === conn && !conn.closed) {
          this.closeChannel(ch);
        }
      }
    };

    const result = this.#opts.terminalConsumer?.onOpen(open, ctx);
    if (result && !result.ok) {
      // Validly addressed open refused locally: emit err on ch and free ch; keep link alive.
      this.#sendRecord(conn, {
        t: "err",
        ch,
        code: result.code,
        retryable: result.retryable ?? false
      });
      conn.activeChannels.delete(ch);
      conn.credit.closeChannel(ch);
      return;
    }
    if (result && result.ok && result.opened) {
      this.#sendRecord(conn, {
        t: "term.opened",
        ch,
        ...result.opened
      });
    }
  }

  #handleCredit(conn: ActiveConnectionState, rec: CreditRecord): void {
    const res = conn.credit.onCredit(rec);
    if (!res.ok) {
      this.#closeProtocolError(conn, res.code);
      return;
    }
    if (!res.gained) {
      return;
    }
    if (rec.ch === 1) {
      this.#pumpCatalogue(conn);
    } else {
      this.#opts.terminalConsumer?.onCredit?.(rec.ch, res.available);
    }
  }

  #startWatch(conn: ActiveConnectionState): void {
    this.#stopIdleLiveness(conn);
    conn.watching = true;
    conn.activeSnapshot = null;
    conn.snapshotCursor = null;
    conn.queuedLatestSnapshot = null;
    conn.pendingDelta = null;
    conn.deltaCursor = null;
    conn.queuedDelta = null;
    conn.deliveredRows.clear();

    this.#opts.catalogue.startWatch((ev) => {
      if (this.#activeConn !== conn || conn.closed || !conn.watching) return;
      this.#onCatalogueEmit(conn, ev);
    });
  }

  #stopWatch(conn: ActiveConnectionState): void {
    if (!conn.watching) return;
    conn.watching = false;
    conn.activeSnapshot = null;
    conn.snapshotCursor = null;
    conn.queuedLatestSnapshot = null;
    conn.pendingDelta = null;
    conn.deltaCursor = null;
    conn.queuedDelta = null;
    conn.deliveredRows.clear();
    this.#opts.catalogue.stopWatch();
    this.#startIdleLiveness(conn);
  }

  #onCatalogueEmit(conn: ActiveConnectionState, ev: CatalogueEmitEvent): void {
    const isSnapshot = ("kind" in ev && ev.kind === "snapshot") || ("t" in ev && ev.t === "cat.snapshot");
    if (isSnapshot) {
      const snap = ev as CatalogueSnapshot | { readonly kind: "snapshot"; readonly at: number; readonly rows: readonly CatalogueSessionRow[]; readonly truncatedRows?: number };
      if (conn.activeSnapshot !== null && conn.snapshotCursor !== null) {
        // Under saturation keep at most current in-flight selection and latest bounded view.
        conn.queuedLatestSnapshot = {
          at: snap.at,
          rows: snap.rows,
          ...(snap.truncatedRows !== undefined ? { truncatedRows: snap.truncatedRows } : {})
        };
      } else {
        conn.activeSnapshot = {
          at: snap.at,
          rows: snap.rows,
          ...(snap.truncatedRows !== undefined ? { truncatedRows: snap.truncatedRows } : {})
        };
        conn.snapshotCursor = null;
        conn.pendingDelta = null;
        conn.deltaCursor = null;
        conn.queuedDelta = null;
      }
      this.#pumpCatalogue(conn);
      return;
    }

    // delta (`kind: "delta"` from test double or `t: "cat.delta"` from LH-06 projector)
    const deltaEv = ev as CatalogueDelta | {
      readonly kind: "delta";
      readonly at: number;
      readonly adds?: readonly CatalogueSessionRow[];
      readonly updates?: readonly (CatalogueSessionRow | CatalogueStatusUpdate)[];
      readonly removes?: readonly string[];
    };
    const target = conn.deltaCursor !== null
      ? (conn.queuedDelta ??= emptyDelta(deltaEv.at))
      : (conn.pendingDelta ??= emptyDelta(deltaEv.at));
    target.at = deltaEv.at;

    for (const sid of deltaEv.removes ?? []) {
      target.adds.delete(sid);
      target.updates.delete(sid);
      target.priorityUpdates.delete(sid);
      if (conn.deliveredRows.has(sid)) {
        target.removes.add(sid);
      }
    }
    for (const u of deltaEv.updates ?? []) {
      if (isStatusOnlyUpdate(u)) {
        if (conn.deliveredRows.has(u.sessionId)) {
          target.priorityUpdates.set(u.sessionId, u);
        }
      } else {
        target.removes.delete(u.sessionId);
        if (conn.deliveredRows.has(u.sessionId)) {
          target.updates.set(u.sessionId, u);
        } else {
          target.adds.set(u.sessionId, u);
        }
      }
    }
    for (const a of deltaEv.adds ?? []) {
      target.removes.delete(a.sessionId);
      if (conn.deliveredRows.has(a.sessionId)) {
        target.updates.set(a.sessionId, a);
      } else {
        target.adds.set(a.sessionId, a);
      }
    }

    this.#pumpCatalogue(conn);
  }

  #pumpCatalogue(conn: ActiveConnectionState): void {
    const contract = this.#opts.contract;
    if (!contract) return;
    while (this.#activeConn === conn && !conn.closed && conn.phase === "ready" && conn.watching) {
      if (this.#instanceManager?.isRegistryCorrupt()) {
        // Suspend status publication until local revocation registry is restored.
        return;
      }
      if (conn.credit.availableOutput(1).records < 1) {
        return;
      }
      const nextSeq = conn.outboundSeq + 1;
      const revokedIds = this.#instanceManager?.revokedIds();

      // Priority 1: snapshot (initial or remaining tail)
      if (conn.activeSnapshot !== null) {
        const prepared = contract.prepareNextCatalogueRecord({
          mode: "snapshot",
          at: conn.activeSnapshot.at,
          rows: conn.activeSnapshot.rows,
          ...(conn.activeSnapshot.truncatedRows !== undefined ? { truncatedRows: conn.activeSnapshot.truncatedRows } : {}),
          cursor: conn.snapshotCursor,
          nextSeq,
          revokedInstanceIds: revokedIds
        });
        if (!prepared) {
          conn.activeSnapshot = conn.queuedLatestSnapshot;
          conn.queuedLatestSnapshot = null;
          conn.snapshotCursor = null;
          continue;
        }
        if (!conn.credit.canSendOutput(1, prepared.encodedBytes)) {
          // Pause without consuming `s` or advancing cursor.
          return;
        }
        const sent = this.#sendRecord(conn, prepared.record as unknown as Record<string, unknown>);
        if (!sent) return;
        conn.credit.recordSentOutput(1, prepared.encodedBytes);
        for (const r of prepared.deliveredAdds ?? []) {
          conn.deliveredRows.set(r.sessionId, r);
        }
        if (prepared.nextCursor === null || prepared.nextCursor === undefined) {
          conn.activeSnapshot = conn.queuedLatestSnapshot;
          conn.queuedLatestSnapshot = null;
          conn.snapshotCursor = null;
        } else {
          conn.snapshotCursor = prepared.nextCursor;
        }
        continue;
      }

      // Priority 2: pending delta (priority status updates first, then removes/updates/adds via provider)
      if (conn.pendingDelta !== null) {
        const d = conn.pendingDelta;
        const allUpdates: Array<CatalogueSessionRow | CatalogueStatusUpdate> = [
          ...d.priorityUpdates.values(),
          ...d.updates.values()
        ];
        const prepared = contract.prepareNextCatalogueRecord({
          mode: "delta",
          at: d.at,
          removes: [...d.removes],
          updates: allUpdates,
          adds: [...d.adds.values()],
          cursor: conn.deltaCursor,
          nextSeq,
          revokedInstanceIds: revokedIds
        });
        if (!prepared) {
          conn.pendingDelta = conn.queuedDelta;
          conn.queuedDelta = null;
          conn.deltaCursor = null;
          continue;
        }
        if (!conn.credit.canSendOutput(1, prepared.encodedBytes)) {
          return;
        }
        const sent = this.#sendRecord(conn, prepared.record as unknown as Record<string, unknown>);
        if (!sent) return;
        conn.credit.recordSentOutput(1, prepared.encodedBytes);
        for (const sid of prepared.deliveredRemoves ?? []) {
          conn.deliveredRows.delete(sid);
        }
        for (const u of prepared.deliveredUpdates ?? []) {
          if (isStatusOnlyUpdate(u)) {
            const prev = conn.deliveredRows.get(u.sessionId);
            if (prev) {
              conn.deliveredRows.set(u.sessionId, { ...prev, instanceId: u.instanceId, instanceStatus: u.instanceStatus });
            }
          } else {
            conn.deliveredRows.set(u.sessionId, u);
          }
        }
        for (const a of prepared.deliveredAdds ?? []) {
          conn.deliveredRows.set(a.sessionId, a);
        }
        if (prepared.nextCursor === null || prepared.nextCursor === undefined) {
          conn.pendingDelta = conn.queuedDelta;
          conn.queuedDelta = null;
          conn.deltaCursor = null;
        } else {
          conn.deltaCursor = prepared.nextCursor;
        }
        continue;
      }

      return;
    }
  }

  #startLiveTimers(conn: ActiveConnectionState): void {
    const schedulePing = () => {
      conn.pingTimer = this.#opts.clock.setTimeout(() => {
        if (this.#activeConn !== conn || conn.closed || conn.phase !== "ready") return;
        this.#sendRecord(conn, { t: "ping", ch: 0, at: this.#opts.clock.now() });
        if (this.#activeConn === conn && !conn.closed) {
          schedulePing();
        }
      }, PING_INTERVAL_MS);
    };
    schedulePing();
    this.#reschedulePongTimer(conn);
    this.#startIdleLiveness(conn);
    const scheduleKillWatchdog = () => {
      conn.killWatchdogTimer = this.#opts.clock.setTimeout(() => {
        conn.killWatchdogTimer = null;
        if (this.#activeConn !== conn || conn.closed || conn.phase !== "ready") return;
        const env = this.#resolveEnv();
        if (isRemoteControlKilledByEnv(env)) {
          this.#handleTerminalCause(conn, "killed", "killed-by-env");
          return;
        }
        if (readRemoteControlKillFlag(this.#opts.root).kill) {
          this.#handleTerminalCause(conn, "killed", "killed");
          return;
        }
        if (!isRemoteControlEnabled(env)) {
          this.#terminalStopped = true;
          this.#clearReconnectTimer();
          this.#teardownConnection(conn, "remote-control-disabled", { notifyLoss: false });
          this.#state = "disabled";
          return;
        }
        scheduleKillWatchdog();
      }, KILL_WATCHDOG_INTERVAL_MS);
    };
    scheduleKillWatchdog();
  }

  #reschedulePongTimer(conn: ActiveConnectionState): void {
    if (conn.pongTimer !== null) {
      this.#opts.clock.clearTimeout(conn.pongTimer);
      conn.pongTimer = null;
    }
    const elapsed = Math.max(0, this.#opts.clock.now() - conn.lastPongAt);
    const remaining = Math.max(0, PONG_TIMEOUT_MS - elapsed);
    conn.pongTimer = this.#opts.clock.setTimeout(() => {
      if (this.#activeConn !== conn || conn.closed || conn.phase !== "ready") return;
      conn.pongTimer = null;
      this.#handleConnectionLoss(conn, "pong-timeout", true);
    }, remaining);
  }

  #startIdleLiveness(conn: ActiveConnectionState): void {
    if (conn.watching || conn.livenessTimer !== null) return;
    const schedule = () => {
      conn.livenessTimer = this.#opts.clock.setTimeout(() => {
        conn.livenessTimer = null;
        if (this.#activeConn !== conn || conn.closed || conn.phase !== "ready" || conn.watching) return;
        this.#sendRecord(conn, { t: "x-liveness", ch: 0, at: this.#opts.clock.now() });
        if (this.#activeConn === conn && !conn.closed && !conn.watching) {
          schedule();
        }
      }, IDLE_LIVENESS_INTERVAL_MS);
    };
    schedule();
  }

  #stopIdleLiveness(conn: ActiveConnectionState): void {
    if (conn.livenessTimer !== null) {
      this.#opts.clock.clearTimeout(conn.livenessTimer);
      conn.livenessTimer = null;
    }
  }

  #clearConnectionTimers(conn: ActiveConnectionState): void {
    if (conn.pingTimer !== null) {
      this.#opts.clock.clearTimeout(conn.pingTimer);
      conn.pingTimer = null;
    }
    if (conn.pongTimer !== null) {
      this.#opts.clock.clearTimeout(conn.pongTimer);
      conn.pongTimer = null;
    }
    if (conn.killWatchdogTimer !== null) {
      this.#opts.clock.clearTimeout(conn.killWatchdogTimer);
      conn.killWatchdogTimer = null;
    }
    this.#stopIdleLiveness(conn);
  }

  #handleTerminalCause(conn: ActiveConnectionState, state: "superseded" | "revoked" | "killed" | "stopped", reason: string): void {
    this.#terminalStopped = true;
    this.#clearReconnectTimer();
    this.#teardownConnection(conn, reason, { notifyLoss: false });
    this.#state = state;

    if (state === "killed") {
      setRemoteControlKillFlag(this.#opts.root);
    } else if (state === "revoked") {
      this.#opts.onEnrolmentRevoked?.(this.#opts.enrolment);
    }

    this.#persistStatus({
      state,
      reason,
      ...(conn.linkGeneration !== undefined ? { linkGeneration: conn.linkGeneration } : {}),
      updatedAt: this.#opts.clock.now()
    });
    this.#emitAudit({ kind: `link-${state}`, reason, linkGeneration: conn.linkGeneration });
    this.#emitLinkEvent({ kind: state, at: this.#opts.clock.now(), reason, linkGeneration: conn.linkGeneration });
  }

  #closeProtocolError(conn: ActiveConnectionState, code: string): void {
    this.#emitAudit({ kind: "protocol-error", reason: code, linkGeneration: conn.linkGeneration });
    this.#handleConnectionLoss(conn, code, true);
  }

  #onError(connId: number, _err: Error): void {
    const conn = this.#activeConn;
    if (!conn || conn.id !== connId || conn.closed) return;
    // Never leak raw exception text into status or audit.
    this.#handleConnectionLoss(conn, "transport-error", true);
  }

  #onClose(connId: number, reason?: string): void {
    const conn = this.#activeConn;
    if (!conn || conn.id !== connId || conn.closed) return;
    this.#handleConnectionLoss(conn, reason ?? "transport-closed", true);
  }

  #teardownConnection(conn: ActiveConnectionState, reason: string, options: { notifyLoss: boolean }): void {
    if (conn.closed) return;
    conn.closed = true;
    this.#clearConnectionTimers(conn);

    if (conn.watching) {
      conn.watching = false;
      this.#opts.catalogue.stopWatch();
    }
    conn.activeSnapshot = null;
    conn.snapshotCursor = null;
    conn.queuedLatestSnapshot = null;
    conn.pendingDelta = null;
    conn.deltaCursor = null;
    conn.queuedDelta = null;
    conn.deliveredRows.clear();

    const closedChannels = [...conn.activeChannels];
    conn.activeChannels.clear();
    conn.credit.reset();
    this.#instanceManager?.resetConnectionState();

    if (this.#activeConn === conn) {
      this.#activeConn = null;
    }

    if (conn.handle) {
      try {
        conn.handle.close(reason);
      } catch {
        // ignore
      }
    }

    for (const ch of closedChannels) {
      this.#opts.terminalConsumer?.onClose?.(ch, reason);
    }

    if (options.notifyLoss && conn.linkGeneration !== undefined) {
      const now = this.#opts.clock.now();
      this.#lastLostAt = now;
      this.#opts.terminalConsumer?.onLinkLost?.({ linkGeneration: conn.linkGeneration, reason, at: now });
      this.#emitLinkEvent({ kind: "link-lost", at: now, linkGeneration: conn.linkGeneration, reason });
    }
  }

  #handleConnectionLoss(conn: ActiveConnectionState, reason: string, scheduleReconnect: boolean): void {
    if (conn.closed) return;
    const wasReady = conn.phase === "ready";
    this.#teardownConnection(conn, reason, { notifyLoss: wasReady });
    if (this.#terminalStopped) return;
    this.#state = "disconnected";
    this.#persistStatus({
      state: "disconnected",
      reason,
      ...(conn.linkGeneration !== undefined ? { linkGeneration: conn.linkGeneration } : {}),
      updatedAt: this.#opts.clock.now()
    });
    if (scheduleReconnect) {
      this.#scheduleReconnectBackoff();
    }
  }

  #scheduleReconnectBackoff(): void {
    if (this.#terminalStopped || this.#reconnectTimer !== null) return;
    const idx = Math.min(this.#backoffAttempt, BACKOFF_BASE_MS.length - 1);
    const base = BACKOFF_BASE_MS[idx]!;
    this.#backoffAttempt += 1;
    const r = Math.min(1, Math.max(0, this.#random()));
    const factor = 0.9 + 0.2 * r;
    const delay = Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_MIN_MS, Math.round(base * factor)));
    this.#scheduleReconnectWithDelay(delay);
  }

  #scheduleReconnectWithDelay(delayMs: number): void {
    if (this.#terminalStopped || this.#reconnectTimer !== null) return;
    this.#reconnectTimer = this.#opts.clock.setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.#terminalStopped) return;
      this.#attemptConnect();
    }, delayMs);
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== null) {
      this.#opts.clock.clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #persistStatus(patch: Partial<TrunkLinkStatus>): void {
    this.#pendingStatusPatch = { ...(this.#pendingStatusPatch ?? {}), ...patch };
    const res = writeLinkStatusFile(this.#opts.root, this.#pendingStatusPatch, { timeoutMs: 0 });
    if (res.ok) {
      this.#pendingStatusPatch = null;
      this.#clearStatusRetryTimer();
      return;
    }
    if (res.busy && this.#statusRetryTimer === null && !this.#terminalStopped) {
      this.#statusRetryTimer = this.#opts.clock.setTimeout(() => {
        this.#statusRetryTimer = null;
        if (this.#pendingStatusPatch) {
          this.#persistStatus(this.#pendingStatusPatch);
        }
      }, 25);
    }
  }

  #clearStatusRetryTimer(): void {
    if (this.#statusRetryTimer !== null) {
      this.#opts.clock.clearTimeout(this.#statusRetryTimer);
      this.#statusRetryTimer = null;
    }
  }

  #emitAudit(fields: { readonly kind: string; readonly instanceId?: string; readonly fingerprint?: string; readonly reason?: string; readonly linkGeneration?: number }): void {
    this.#opts.onAudit?.({
      kind: fields.kind,
      at: this.#opts.clock.now(),
      meshId: this.#opts.enrolment.meshId,
      tenantId: this.#opts.enrolment.tenantId,
      enrolmentRef: this.#opts.enrolment.enrolmentRef,
      ...(fields.instanceId !== undefined ? { instanceId: fields.instanceId } : {}),
      ...(fields.fingerprint !== undefined ? { fingerprint: fields.fingerprint } : {}),
      ...(fields.reason !== undefined ? { reason: fields.reason } : {}),
      ...(fields.linkGeneration !== undefined ? { linkGeneration: fields.linkGeneration } : {})
    });
  }

  #emitLinkEvent(ev: { readonly kind: string; readonly at: number; readonly linkGeneration?: number; readonly reason?: string; readonly outageMs?: number }): void {
    this.#opts.onLinkEvent?.(ev);
  }
}
