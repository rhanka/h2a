import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";
import xtermMod from "@xterm/headless";

import type { RemoteCliConfig } from "../config.js";
import type { RegistryEntry } from "../registry.js";
import type { DiscoveredSession } from "../restore-plan.js";
import type {
  NativeTerminalControllerIdentity,
  NativeTerminalControllerLease,
  NativeTerminalReplay,
  NativeTerminalSessionState,
} from "./host.js";
import { createNativeStatusBar } from "./op.js";
import { NativeTerminalRemoteError } from "./protocol.js";
import type { RightPanelSnapshot } from "./right-panel.js";
import type { SessionViewStatusBar } from "./session-view.js";
import type { DraftRecoveryRecord } from "./draft-recovery-view.js";
import {
  runStation,
  type StationCliRequest,
  type StationCliResult,
  type StationDraftOutcome,
  type StationDraftRef,
  type StationEvent,
  type StationHostClient,
  type StationOptions,
  type StationRuntime,
  type StationSessionDraftStatus,
  type StationStatusBar,
} from "./station.js";
import { STATION_STATE_FILE_NAME, readStationState } from "./station-state.js";

const XtermTerminal = (
  (xtermMod as unknown as { default?: typeof xtermMod }).default ?? xtermMod
).Terminal;
type HeadlessTerm = InstanceType<typeof XtermTerminal>;

async function writeTerm(term: HeadlessTerm, data: string): Promise<void> {
  if (data.length === 0) return;
  await new Promise<void>((resolve) => term.write(data, resolve));
}

// ---------------------------------------------------------------------------
// Fake fleet: several owner hosts, each with its own sessions and lease table.
// It mirrors the host contract the station relies on (nt/host.ts): one
// controller per session, epoch-fenced leases, leases dropped on disconnect.
// ---------------------------------------------------------------------------

const remoteError = (message: string): NativeTerminalRemoteError =>
  new NativeTerminalRemoteError({ code: "operation-failed", message });

class FakeSession {
  readonly id: string;
  readonly host: FakeHost;
  incarnation = "inc-1";
  pid = 4242;
  /** S2 D1 designation: the facet and foreground group the host publishes. */
  facet: "shell" | "cli" | "other" | "unknown" | undefined;
  foregroundProcessGroup: number | null | undefined;
  status: NativeTerminalSessionState["status"] = "running";
  exit: NativeTerminalSessionState["exit"] = null;
  stopSignal: string | null = null;
  controllerId: string | null = null;
  controllerEpoch = 0;
  controller: NativeTerminalControllerIdentity | null = null;
  lastHumanActivityAt: number | null = null;
  manualPin: boolean | undefined;
  readonly chunks: Array<{ seq: number; data: string }> = [];
  latestSeq = 0;
  /** Bytes that reached the PTY, in order. */
  readonly writes: string[] = [];
  readonly resizes: Array<{ cols: number; rows: number }> = [];
  acquireRequests = 0;

  constructor(host: FakeHost, id: string) {
    this.host = host;
    this.id = id;
  }

  emit(data: string): void {
    this.latestSeq += 1;
    this.chunks.push({ seq: this.latestSeq, data });
  }

  /** Another terminal takes (or holds) the controller of this session. */
  controlElsewhere(identity: { pid: number | null; tty: string }): NativeTerminalControllerLease {
    this.controllerEpoch += 1;
    this.controllerId = `elsewhere-${this.controllerEpoch}`;
    this.controller = { ...identity, since: "2026-11-21T08:00:00.000Z" };
    return this.leaseFor(this.controllerId);
  }

  releaseElsewhere(): void {
    this.controllerEpoch += 1;
    this.controllerId = null;
    this.controller = null;
  }

  end(exitCode: number): void {
    this.status = "exited";
    this.exit = { exitCode, signal: null } as NativeTerminalSessionState["exit"];
    this.controllerEpoch += 1;
    this.controllerId = null;
    this.controller = null;
  }

  leaseFor(controllerId: string): NativeTerminalControllerLease {
    return {
      role: "controller",
      id: this.id,
      generation: this.host.generation,
      incarnation: this.incarnation,
      controllerId,
      epoch: this.controllerEpoch,
    };
  }

  state(): NativeTerminalSessionState {
    return {
      id: this.id,
      generation: this.host.generation,
      incarnation: this.incarnation,
      pid: this.pid,
      status: this.status,
      latestSeq: this.latestSeq,
      exit: this.exit,
      stopSignal: this.stopSignal,
      controlled: this.controllerId !== null,
      controllerEpoch: this.controllerEpoch,
      controller: this.controller,
      lastHumanActivityAt: this.lastHumanActivityAt,
      ...(this.manualPin !== undefined ? { manualPin: this.manualPin } : {}),
      ...(this.facet !== undefined
        ? {
            applicationFacet: this.facet,
            applicationIncarnation: this.incarnation,
            foregroundProcessGroup: this.foregroundProcessGroup ?? null,
            foregroundRevision: 0,
          }
        : {}),
    } as NativeTerminalSessionState;
  }
}

type FakeHostHooks = {
  beforeAcquire?: (session: FakeSession) => void | Promise<void>;
  beforeWrite?: (session: FakeSession, data: string) => void | Promise<void>;
  beforeRead?: (session: FakeSession, afterSeq: number) => void | Promise<void>;
  beforeState?: (id: string) => void | Promise<void>;
};

/**
 * INJ test double (r4 §3, plans 05/06): the host-side composer broker, its
 * vault and the manual pin. It is NOT the host implementation: it only gives
 * the station something to call and something to display. A session is either
 * "qualified" (the test adapter: a cooperative composer) or has no adapter.
 */
class FakeBroker {
  readonly host: FakeHost;
  readonly adapters = new Map<string, "qualified">();
  /** Composer content of each cooperative session (what the human typed). */
  readonly composer = new Map<string, string>();
  readonly accepted: Array<{ sessionId: string; text: string }> = [];
  readonly deposits: Array<{ sessionId: string; text: string; outcome: string }> = [];
  readonly status = new Map<string, StationSessionDraftStatus>();
  /** S2: dynamic draft status consulted before the static map (D-guard tests). */
  statusFn: ((sessionId: string) => StationSessionDraftStatus | undefined) | undefined;
  readonly vault = new Map<string, Uint8Array>();
  readonly pinCalls: Array<{ sessionId: string; incarnation: string; manualPin: boolean }> = [];
  readonly replaceCalls: StationDraftRef[] = [];
  readonly deleteCalls: StationDraftRef[] = [];
  /** Automatic bytes written to a PTY: must stay empty (zero D message on PTY). */
  readonly automaticPtyBytes: string[] = [];
  replaceOutcome: (ref: StationDraftRef) => StationDraftOutcome | Promise<StationDraftOutcome> =
    () => ({ ok: true });
  deleteOutcome: (ref: StationDraftRef) => StationDraftOutcome = () => ({ ok: true });
  quietWindowMs = 4_000;

  constructor(host: FakeHost) {
    this.host = host;
  }

  static key(ref: StationDraftRef): string {
    return `${ref.sessionId}/${ref.applicationIncarnation}/${ref.requestId}`;
  }

  /** An automatic message (wake, drive) reaches the broker for this session. */
  deposit(sessionId: string, text: string): string {
    const session = this.host.sessions.get(sessionId)!;
    const record = (outcome: string): string => {
      this.deposits.push({ sessionId, text, outcome });
      return outcome;
    };
    const refuse = (refusal: string): string => {
      this.status.set(sessionId, { ...this.status.get(sessionId), refusal, submission: "refused" });
      return record(refusal);
    };
    // P0 admission: pin, adapter, quiet human window.
    if (session.manualPin === true) return refuse("refused-manual-pin");
    if (!this.adapters.has(sessionId)) return refuse("refused-no-draft-adapter");
    const at = session.lastHumanActivityAt;
    if (at !== null && this.host.now() - at < this.quietWindowMs) return record("deferred-recent-human");
    // P1–P6 on the cooperative composer: save D0, submit once, restore D0.
    const d0 = this.composer.get(sessionId) ?? "";
    this.accepted.push({ sessionId, text });
    this.composer.set(sessionId, d0);
    this.status.set(sessionId, { submission: "submitted" });
    return record("submitted");
  }
}

class FakeHost {
  readonly socketPath: string;
  generation: string;
  hostPid = 7000;
  /** INJ L2 host: the ping carries `composerBrokerVersion: 1`. */
  composerBrokerVersion: unknown;
  /** S2 D1: the ping carries `softRespawn` when the host can respawn in place. */
  softRespawn: boolean | undefined;
  /** INJ double; present only on a "new host" fixture. */
  broker: FakeBroker | undefined;
  readonly sessions = new Map<string, FakeSession>();
  readonly clients = new Set<FakeClient>();
  hooks: FakeHostHooks = {};
  /** Fails every request of every connection (host muted or restarting). */
  down = false;
  connects = 0;
  /** Lease-relevant operations in the order the host served them. */
  readonly log: string[] = [];
  now: () => number = () => 0;

  constructor(socketPath: string, generation: string) {
    this.socketPath = socketPath;
    this.generation = generation;
  }

  add(id: string): FakeSession {
    const session = new FakeSession(this, id);
    this.sessions.set(id, session);
    return session;
  }

  /** The host process is replaced: every lease dies, sessions get a new generation. */
  restart(generation: string): void {
    for (const client of this.clients) client.sever();
    this.clients.clear();
    this.generation = generation;
    for (const session of this.sessions.values()) {
      session.controllerEpoch += 1;
      session.controllerId = null;
      session.controller = null;
    }
  }

  connect(): FakeClient {
    if (this.down) {
      throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    }
    this.connects += 1;
    const client = new FakeClient(this);

    this.clients.add(client);
    return client;
  }
}

class FakeClient implements StationHostClient {
  readonly host: FakeHost;
  readonly held = new Map<string, NativeTerminalControllerLease>();
  closed = false;
  severed = false;
  // INJ port: absent on a host without the broker, as on every host today.
  setManualPin?: StationHostClient["setManualPin"];
  draftStatus?: StationHostClient["draftStatus"];
  readDraft?: StationHostClient["readDraft"];
  replaceDraft?: StationHostClient["replaceDraft"];
  deleteDraft?: StationHostClient["deleteDraft"];

  constructor(host: FakeHost) {
    this.host = host;
    const broker = host.broker;
    if (!broker) return;
    this.setManualPin = async (request) => {
      this.#guard();
      broker.pinCalls.push(request);
      const session = this.#session(request.sessionId);
      if (request.incarnation !== session.incarnation) {
        throw remoteError("stale terminal session incarnation");
      }
      // Durable before the acknowledgement, then published in the session state.
      session.manualPin = request.manualPin;
      return { manualPin: request.manualPin };
    };
    this.draftStatus = async (sessionIds) => {
      this.#guard();
      return Object.fromEntries(
        sessionIds.flatMap((id) => {
          const status = broker.statusFn?.(id) ?? broker.status.get(id);
          return status ? [[id, status] as const] : [];
        }),
      );
    };
    this.readDraft = async (ref) => {
      this.#guard();
      return broker.vault.get(FakeBroker.key(ref));
    };
    this.replaceDraft = async (ref) => {
      this.#guard();
      broker.replaceCalls.push(ref);
      return broker.replaceOutcome(ref);
    };
    this.deleteDraft = async (ref) => {
      this.#guard();
      broker.deleteCalls.push(ref);
      return broker.deleteOutcome(ref);
    };
  }

  sever(): void {
    this.severed = true;
    this.held.clear();
  }

  #guard(): void {
    if (this.closed) throw new Error("terminal host client is closed");
    if (this.severed || this.host.down) throw new Error("terminal host connection closed");
  }

  #session(id: string): FakeSession {
    const session = this.host.sessions.get(id);
    if (!session) throw remoteError(`unknown terminal session: ${id}`);
    return session;
  }

  #requireLease(lease: NativeTerminalControllerLease): FakeSession {
    const session = this.#session(lease.id);
    if (
      lease.generation !== this.host.generation ||
      lease.incarnation !== session.incarnation ||
      lease.epoch !== session.controllerEpoch ||
      lease.controllerId !== session.controllerId
    ) {
      throw remoteError("stale terminal controller lease");
    }
    return session;
  }

  async ping() {
    this.#guard();
    return {
      generation: this.host.generation,
      hostPid: this.host.hostPid,
      protocolVersion: 1 as const,
      ...(this.host.composerBrokerVersion !== undefined
        ? { composerBrokerVersion: this.host.composerBrokerVersion }
        : {}),
      ...(this.host.softRespawn !== undefined ? { softRespawn: this.host.softRespawn } : {}),
    };
  }

  async list() {
    this.#guard();
    return [...this.host.sessions.values()].map((session) => session.state());
  }

  async state(id: string) {
    await this.host.hooks.beforeState?.(id);
    this.#guard();
    return this.#session(id).state();
  }

  async readOutput(id: string, afterSeq: number): Promise<NativeTerminalReplay> {
    this.#guard();
    const session = this.#session(id);
    await this.host.hooks.beforeRead?.(session, afterSeq);
    this.#guard();
    return {
      generation: this.host.generation,
      incarnation: session.incarnation,
      chunks: session.chunks.filter((chunk) => chunk.seq > afterSeq),
      gap: null,
      latestSeq: session.latestSeq,
      state: session.state(),
    } as NativeTerminalReplay;
  }

  async acquireController(
    id: string,
    controllerId: string,
    _activity: "human" | "automation" = "human",
    options: { takeover?: boolean; pid?: number; tty?: string } = {},
  ): Promise<NativeTerminalControllerLease> {
    this.#guard();
    const session = this.#session(id);
    session.acquireRequests += 1;
    await this.host.hooks.beforeAcquire?.(session);
    this.#guard();
    if (session.status !== "running") throw remoteError(`terminal session is not running: ${id}`);
    if (session.controllerId !== null && options.takeover !== true) {
      const holder = session.controller;
      throw remoteError(
        `terminal session already has a controller: ${id}; pid=${holder?.pid ?? "unknown"} tty=${holder?.tty ?? "unknown"} since=${holder?.since ?? "unknown"}; use h2a attach ${id.replace(/^h2a-/, "")} --takeover to detach it`,
      );
    }
    session.controllerEpoch += 1;
    session.controllerId = controllerId;
    session.controller = {
      pid: options.pid ?? null,
      tty: options.tty ?? "unknown",
      since: "2026-11-21T08:00:00.000Z",
    };
    session.lastHumanActivityAt = this.host.now();
    const lease = session.leaseFor(controllerId);
    this.held.set(id, lease);
    this.host.log.push(`acquire:${id}${options.takeover ? ":takeover" : ""}`);
    return lease;
  }

  /** The legacy automation path (`op drive`): the 4 s human-activity lease. */
  async acquireAutomationControllerIfNoRecentHuman(
    id: string,
    controllerId: string,
    activityWindowMs: number,
  ): Promise<NativeTerminalControllerLease> {
    this.#guard();
    const session = this.#session(id);
    if (session.controllerId !== null) {
      throw remoteError(`terminal session already has a controller: ${id}`);
    }
    const at = session.lastHumanActivityAt;
    if (at !== null && this.host.now() - at < activityWindowMs) {
      throw remoteError(`terminal session has recent human activity: ${id}`);
    }
    session.controllerEpoch += 1;
    session.controllerId = controllerId;
    session.controller = { pid: null, tty: "unknown", since: "2026-11-21T08:00:00.000Z" };
    const lease = session.leaseFor(controllerId);
    this.held.set(id, lease);
    return lease;
  }

  async releaseController(lease: NativeTerminalControllerLease) {
    this.#guard();
    const session = this.#requireLease(lease);
    session.lastHumanActivityAt = this.host.now();
    session.controllerEpoch += 1;
    session.controllerId = null;
    session.controller = null;
    this.held.delete(lease.id);
    this.host.log.push(`release:${lease.id}`);
    return {
      id: session.id,
      generation: this.host.generation,
      incarnation: session.incarnation,
      controllerEpoch: session.controllerEpoch,
    };
  }

  async write(lease: NativeTerminalControllerLease, data: string): Promise<void> {
    this.#guard();
    const session = this.#requireLease(lease);
    await this.host.hooks.beforeWrite?.(session, data);
    this.#guard();
    this.#requireLease(lease);
    session.lastHumanActivityAt = this.host.now();
    session.writes.push(data);
    // A cooperative composer receives the human input as its draft.
    const broker = this.host.broker;
    if (broker?.adapters.has(lease.id)) {
      broker.composer.set(lease.id, (broker.composer.get(lease.id) ?? "") + data);
    }
    this.host.log.push(`write:${lease.id}`);
  }

  async resize(lease: NativeTerminalControllerLease, cols: number, rows: number): Promise<void> {
    this.#guard();
    const session = this.#requireLease(lease);
    session.resizes.push({ cols, rows });
    this.host.log.push(`resize:${lease.id}`);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.host.clients.delete(this);
    // The host drops every lease of a disconnected client (nt/server.ts).
    for (const lease of this.held.values()) {
      const session = this.host.sessions.get(lease.id);
      if (
        session &&
        session.controllerId === lease.controllerId &&
        session.controllerEpoch === lease.epoch
      ) {
        session.controllerEpoch += 1;
        session.controllerId = null;
        session.controller = null;
      }
    }
    this.held.clear();
  }
}

class FakeFleet {
  readonly hosts = new Map<string, FakeHost>();

  host(socketPath: string, generation = `gen-${socketPath}`): FakeHost {
    let host = this.hosts.get(socketPath);
    if (!host) {
      host = new FakeHost(socketPath, generation);
      this.hosts.set(socketPath, host);
    }
    return host;
  }

  session(id: string): FakeSession {
    for (const host of this.hosts.values()) {
      const session = host.sessions.get(id);
      if (session) return session;
    }
    throw new Error(`no fake session ${id}`);
  }

  all(): FakeSession[] {
    return [...this.hosts.values()].flatMap((host) => [...host.sessions.values()]);
  }
}

// ---------------------------------------------------------------------------
// Terminal fakes and the harness.
// ---------------------------------------------------------------------------

class FakeInput extends EventEmitter {
  isTTY: boolean;
  isRaw = false;
  readonly resume = vi.fn();
  readonly pause = vi.fn();
  readonly setRawMode = vi.fn((raw: boolean) => {
    this.isRaw = raw;
  });

  constructor(isTTY: boolean) {
    super();
    this.isTTY = isTTY;
  }

  type(data: string | Buffer): void {
    this.emit("data", Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8"));
  }
}

class FakeOutput {
  columns: number;
  rows: number;
  isTTY: boolean;
  readonly chunks: string[] = [];
  /** Simulated terminal side: observes every write (to answer the sentinel…). */
  onWrite: ((chunk: string) => void) | undefined;

  constructor(columns: number, rows: number, isTTY: boolean) {
    this.columns = columns;
    this.rows = rows;
    this.isTTY = isTTY;
  }

  /** Receipts and writes in the order they happened (receipt-before-mode proofs). */
  readonly timeline: Array<{ kind: "write" | "receipt"; data: string }> = [];

  write(chunk: string): boolean {
    this.chunks.push(String(chunk));
    this.timeline.push({ kind: "write", data: String(chunk) });
    this.onWrite?.(String(chunk));
    return true;
  }

  text(): string {
    return this.chunks.join("");
  }

  mark(): number {
    return this.chunks.length;
  }

  since(mark: number): string {
    return this.chunks.slice(mark).join("");
  }
}

/** A status bar that reserves nothing: the plain fake for lease/input tests. */
class PlainStatusBar implements StationStatusBar {
  readonly #stdout: FakeOutput;
  constructor(stdout: FakeOutput) {
    this.#stdout = stdout;
  }
  childRows(): number | undefined {
    return this.#stdout.rows;
  }
  async probe(): Promise<void> {}
  onResize(): void {}
  flushAfterOutputBatch(): void {}
  flushPendingSequence(): string {
    return "";
  }
  resumeAfterReset(): void {}
  dispose(): void {}
  peekRestoreSequence(): string {
    return "";
  }
  restoreSequence(): string {
    return "";
  }
  transformChildOutput(data: string): string {
    return data;
  }
  setRightPanel(): void {}
  setOnBeforeActivate(): void {}
  setRightPanelMarkerProvider(): void {}
  setSelectedDelegatedNamesProvider(): void {}
  isActive(): boolean {
    return false;
  }
  paint(): void {}
  onRightPanelGeometryChange(): void {}
  restoreChildStateSequence(): string {
    return "";
  }
}
// Compile-time check: the plain bar is a valid session-view bar.
const _plainIsViewBar: (bar: PlainStatusBar) => SessionViewStatusBar = (bar) => bar;
void _plainIsViewBar;

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

type FixtureSession = {
  id: string;
  project: string;
  label: string;
  host: string;
  mtime: number;
  /** S2: registry conversation id (absent ⇒ the conversation is unresolved). */
  convId?: string;
  /** S2: CLI profile of the registry row (default `claude`). */
  tool?: string;
};

/** 3 configured groups + `other`, 7 live sessions, 2 owner hosts (S1.1). */
const FIXTURE_SESSIONS: readonly FixtureSession[] = [
  { id: "h2a-conductor", project: "h2a", label: "conductor", host: "/fake/host-1.sock", mtime: 1_700_000_100_000 },
  { id: "h2a-api", project: "h2a", label: "api", host: "/fake/host-1.sock", mtime: 1_700_000_900_000 },
  { id: "h2a-tracker", project: "track", label: "tracker", host: "/fake/host-1.sock", mtime: 1_700_000_300_000 },
  { id: "h2a-spec", project: "site", label: "spec", host: "/fake/host-1.sock", mtime: 1_700_000_400_000 },
  { id: "h2a-guide", project: "site", label: "guide", host: "/fake/host-2.sock", mtime: 1_700_000_200_000 },
  { id: "h2a-probe", project: "lab", label: "probe", host: "/fake/host-2.sock", mtime: 1_700_000_500_000 },
  { id: "h2a-scratch", project: "misc", label: "scratch", host: "/fake/host-2.sock", mtime: 1_700_000_600_000 },
];

const FIXTURE_CONFIG: RemoteCliConfig = {
  layout: {
    maxPerWindow: 12,
    sharedWindows: 2,
    groups: [
      { title: "core", projects: ["h2a", "track"] },
      { title: "docs", projects: ["site"] },
      { title: "lab", projects: ["lab"] },
    ],
  },
};

type HarnessOptions = {
  columns?: number;
  rows?: number;
  tty?: boolean;
  /** Raw content of the persisted station state, or absent. */
  state?: string;
  /** INJ L2 hosts answer the ping with `composerBrokerVersion: 1`. */
  brokerProtected?: boolean;
  sessions?: readonly FixtureSession[];
  /** Extra registry rows without a live host session (dead before S2). */
  deadSessions?: readonly FixtureSession[];
  /** S2: transcript-scan reader injected into the snapshot options. */
  scanReader?: (maxAgeMs: number, home: string) => DiscoveredSession[];
  statusBar?: (stdout: FakeOutput, sessionId: string) => StationStatusBar;
  station?: Partial<StationOptions>;
};

type Step = (h: Harness) => void;

class Harness {
  readonly fleet = new FakeFleet();
  readonly stdin: FakeInput;
  readonly stdout: FakeOutput;
  readonly events: StationEvent[] = [];
  readonly receipts: string[] = [];
  readonly statePath: string;
  readonly home: string;
  now = 1_000;
  resizeListener: (() => void) | undefined;
  terminateListener: (() => void) | undefined;
  readonly #steps: Step[] = [];
  #ticks = 0;
  #held: Array<{ match: (ms: number) => boolean; waiters: Array<() => void> }> = [];
  readonly #options: HarnessOptions;
  autoDetach = true;
  /** Every `delay(ms)` the station asked for, in order. */
  readonly delays: number[] = [];
  readonly listeners: Array<(event: StationEvent) => void> = [];
  /** Tab the panel cursor is on, as the harness drives it. */
  panelTab = 0;
  /** S2: every `execH2a` call the station made, in order. */
  readonly execCalls: StationCliRequest[] = [];
  /** S2: issue of the next `execH2a` calls (settled per call, in order). */
  execOutcomes: StationCliResult[] = [];
  /** S2: default issue when `execOutcomes` runs dry. */
  execDefaultOutcome: StationCliResult = { ok: true, stdout: "{}" };
  /** S2: gate awaited before each `execH2a` call settles (ordering tests). */
  execGate: ((request: StationCliRequest) => Promise<void> | void) | undefined;

  constructor(options: HarnessOptions = {}) {
    this.#options = options;
    const tty = options.tty ?? false;
    this.stdin = new FakeInput(tty);
    this.stdout = new FakeOutput(options.columns ?? 160, options.rows ?? 40, tty);
    this.home = mkdtempSync(join(tmpdir(), "h2a-station-"));
    tempDirs.push(this.home);
    this.statePath = join(this.home, "config", STATION_STATE_FILE_NAME);
    if (options.state !== undefined) {
      mkdirSync(dirname(this.statePath), { recursive: true });
      writeFileSync(this.statePath, options.state);
    }
    const sessions = options.sessions ?? FIXTURE_SESSIONS;
    const entries: RegistryEntry[] = [];
    for (const fixture of [...sessions, ...(options.deadSessions ?? [])]) {
      const cwd = join(this.home, "src", fixture.project);
      mkdirSync(cwd, { recursive: true });
      entries.push({
        id: fixture.id,
        tool: fixture.tool ?? "claude",
        kind: "local-native",
        cwd,
        label: fixture.label,
        tmuxSession: fixture.id,
        source: "run",
        sessionClass: "human",
        ...(fixture.convId !== undefined ? { convId: fixture.convId } : {}),
        lastSeenAt: new Date(fixture.mtime).toISOString(),
        enrolledAt: new Date(fixture.mtime).toISOString(),
      } as RegistryEntry);
    }
    for (const fixture of sessions) {
      const host = this.fleet.host(fixture.host);
      host.now = () => this.now;
      if (options.brokerProtected) {
        host.composerBrokerVersion = 1;
        host.broker ??= new FakeBroker(host);
      }
      host.add(fixture.id).emit(`${fixture.label} ready\r\n`);
    }
    mkdirSync(join(this.home, ".h2a", "presence"), { recursive: true });
    writeFileSync(
      join(this.home, "registry.json"),
      JSON.stringify({ version: 1, entries }, null, 2),
    );
  }

  /** Queue a step: one runs each time the station reaches its idle pause. */
  step(...steps: Step[]): this {
    this.#steps.push(...steps);
    return this;
  }

  /** Hold every `delay(ms)` matching the predicate until `releaseHeld()`. */
  holdDelays(match: (ms: number) => boolean): { release(): void; waiting(): number } {
    const entry = { match, waiters: [] as Array<() => void> };
    this.#held.push(entry);
    return {
      release: () => {
        this.#held = this.#held.filter((candidate) => candidate !== entry);
        for (const waiter of entry.waiters.splice(0)) waiter();
      },
      waiting: () => entry.waiters.length,
    };
  }

  runtime(): StationRuntime {
    return {
      stdin: this.stdin as unknown as NodeJS.ReadStream,
      stdout: this.stdout as unknown as NodeJS.WriteStream,
      now: () => this.now,
      delay: async (ms) => {
        this.delays.push(ms);
        const held = this.#held.find((entry) => entry.match(ms));
        if (held) {
          await new Promise<void>((resolve) => held.waiters.push(resolve));
          return;
        }
        this.now += ms;
        // A real delay is a timer: everything already queued (input pump,
        // pending writes) settles before the station resumes.
        await new Promise<void>((resolve) => setImmediate(resolve));
      },
      onResize: (listener) => {
        this.resizeListener = listener;
      },
      offResize: () => {
        this.resizeListener = undefined;
      },
      onTerminate: (listener) => {
        this.terminateListener = listener;
      },
      offTerminate: () => {
        this.terminateListener = undefined;
      },
      saveTerminalReset: (sequence) => {
        this.receipts.push(sequence);
        this.stdout.timeline.push({ kind: "receipt", data: sequence });
      },
      endpoints: () => [...this.fleet.hosts.keys(), ...this.absentEndpoints],
      ...(this.proveAbsent ? { proveAbsent: this.proveAbsent } : {}),
      execH2a: async (request: StationCliRequest) => {
        this.execCalls.push(request);
        await this.execGate?.(request);
        const outcome = this.execOutcomes.length > 0 ? this.execOutcomes.shift()! : this.execDefaultOutcome;
        // Like a detached child, the issue settles after the input pump ran.
        await new Promise<void>((resolve) => setImmediate(resolve));
        return outcome;
      },
      connect: async (socketPath) => {
        const host = this.fleet.hosts.get(socketPath);
        if (!host) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        const client = host.connect();
        // A connection can take time to establish: the gate lets a test hold it.
        await this.connectGate?.(socketPath);
        return client;
      },
    };
  }

  options(): StationOptions {
    return {
      createStatusBar: (sessionId) =>
        this.#options.statusBar?.(this.stdout, sessionId) ?? new PlainStatusBar(this.stdout),
      statePath: this.statePath,
      locale: "en",
      tty: "/dev/pts/9",
      pid: 9001,
      panel: {
        width: 32,
        refreshIntervalMs: 1_000,
        snapshotOptions: {
          home: this.home,
          config: FIXTURE_CONFIG,
          registryPath: join(this.home, "registry.json"),
          h2aRoot: join(this.home, ".h2a"),
          env: {},
          trackSources: [],
          // The station provides the scan cache; tests inject the reader.
          ...(this.#options.scanReader !== undefined
            ? { scanReader: this.#options.scanReader }
            : {}),
        },
      },
      onEvent: (event) => {
        this.events.push(event);
        for (const listener of this.listeners) listener(event);
        if (event.type === "displayed") {
          const tabs = this.lastSnapshot().workspaces.map((workspace) => workspace.title);
          const tab = tabs.indexOf(event.tab ?? "");
          if (tab >= 0) this.panelTab = tab;
        }
        if (event.type === "idle") this.#onIdle();
      },
      ...this.#options.station,
    };
  }

  #onIdle(): void {
    this.#ticks += 1;
    if (this.#ticks > 5_000) {
      this.stdin.type(Buffer.from([0x1c]));
      throw new Error("station harness: too many idle ticks (station did not end)");
    }
    const step = this.#steps.shift();
    if (step) {
      try {
        step(this);
      } catch (error) {
        // A failed assertion inside a step fails the test: close and rethrow.
        this.stepError ??= error;
        this.#steps.length = 0;
        this.stdin.type(Buffer.from([0x1c]));
      }
      return;
    }
    if (this.autoDetach) this.stdin.type(Buffer.from([0x1c]));
  }

  stepError: unknown;
  connectGate: ((socketPath: string) => Promise<void>) | undefined;
  /** Known endpoints with no host behind them (the unused socket generation). */
  absentEndpoints: string[] = [];
  /** Absence proof of the runtime; the real one takes the host publication lock. */
  proveAbsent: ((socketPath: string, failure: unknown) => Promise<boolean>) | undefined;
  /** Runs once the station returned, before the clean-exit invariant. */
  afterStation: (() => void | Promise<void>) | undefined;

  /** Connections of the station still open (a leak keeps the process alive). */
  openConnections(): number {
    return [...this.fleet.hosts.values()].reduce(
      (count, host) => count + [...host.clients].filter((client) => !client.closed).length,
      0,
    );
  }

  async run(): Promise<number> {
    const code = await runStation(this.runtime(), this.options());
    if (this.stepError !== undefined) throw this.stepError;
    await this.afterStation?.();
    // Let every promise the station left behind settle, then check the
    // invariant of a clean exit: no host connection stays open.
    for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));

    expect(this.openConnections(), "host connections left open by the station").toBe(0);
    return code;
  }

  // --- driving helpers -------------------------------------------------------

  /** Click an empty panel cell: the panel takes the keyboard, nothing else. */
  focusPanel(): void {
    const x = this.stdout.columns;
    const y = this.stdout.rows - 3;
    this.stdin.type(`\x1b[<0;${x};${y}M`);
    this.stdin.type(`\x1b[<0;${x};${y}m`);
  }

  /** Activate a session from the panel: focus, Tab to its tab, its digit. */
  activate(sessionId: string): void {
    const workspaces = this.lastSnapshot().workspaces;
    const tab = workspaces.findIndex((workspace) =>
      workspace.sessions.some((session) => session.id === sessionId),
    );
    if (tab < 0) throw new Error(`session ${sessionId} is not listed`);
    const row = workspaces[tab]!.sessions.findIndex((session) => session.id === sessionId);
    this.focusPanel();
    const count = workspaces.length;
    for (let i = 0; i < (tab - this.panelTab + count) % count; i += 1) this.stdin.type("\t");
    this.panelTab = tab;
    this.stdin.type(String(row + 1));
  }

  /** Put the panel cursor on a session row (keyboard only). */
  selectRow(sessionId: string): void {
    const workspaces = this.lastSnapshot().workspaces;
    const tab = workspaces.findIndex((workspace) =>
      workspace.sessions.some((session) => session.id === sessionId),
    );
    const row = workspaces[tab]!.sessions.findIndex((session) => session.id === sessionId);
    this.focusPanel();
    const count = workspaces.length;
    for (let i = 0; i < (tab - this.panelTab + count) % count; i += 1) this.stdin.type("\t");
    this.panelTab = tab;
    // Up to the first row, then down: a selected row shows its activatable
    // extra rows, and the cursor walks through them before the next session.
    for (let i = 0; i < 40; i += 1) this.stdin.type("k");
    for (const before of workspaces[tab]!.sessions.slice(0, row)) {
      const extras = (before.extraRows ?? []).filter((extra) => extra.activatable === true);
      for (let i = 0; i <= extras.length; i += 1) this.stdin.type("j");
    }
  }

  /** Rows listed under a session whatever the cursor (states, not gestures). */
  stateRows(sessionId: string) {
    return (this.row(sessionId).extraRows ?? []).filter((extra) => extra.whenSelected !== true);
  }

  /** Select a row, walk down to one of its activatable extra rows, press Enter. */
  gesture(sessionId: string, rowId: string): void {
    this.selectRow(sessionId);
    const position = (this.row(sessionId).extraRows ?? [])
      .filter((extra) => extra.activatable === true)
      .findIndex((extra) => extra.id === rowId);
    if (position < 0) {
      throw new Error(
        `no activatable row ${rowId} under ${sessionId}: ${JSON.stringify(this.row(sessionId).extraRows)}`,
      );
    }
    for (let i = 0; i <= position; i += 1) this.stdin.type("j");
    this.stdin.type("\r");
  }

  broker(socketPath = "/fake/host-1.sock"): FakeBroker {
    const broker = this.fleet.host(socketPath).broker;
    if (!broker) throw new Error("no broker double on this host");
    return broker;
  }

  /** Station-owned controller id (pid 9001 in the harness). */
  readonly stationController = "h2a-station-9001";

  heldByStation(): string[] {
    return this.fleet
      .all()
      .filter((session) => session.controllerId === this.stationController)
      .map((session) => session.id)
      .sort();
  }

  row(sessionId: string) {
    for (const workspace of this.lastSnapshot().workspaces) {
      const row = workspace.sessions.find((session) => session.id === sessionId);
      if (row) return row;
    }
    throw new Error(`no row ${sessionId}`);
  }

  // --- observation helpers -------------------------------------------------

  displayed(): string[] {
    return this.events.flatMap((event) => (event.type === "displayed" ? [event.sessionId] : []));
  }

  lastSnapshot(): RightPanelSnapshot {
    const snapshots = this.events.flatMap((event) =>
      event.type === "snapshot" ? [event.snapshot] : [],
    );
    const last = snapshots[snapshots.length - 1];
    if (!last) throw new Error("no snapshot event");
    return last;
  }

  of<T extends StationEvent["type"]>(type: T): Array<Extract<StationEvent, { type: T }>> {
    return this.events.filter((event): event is Extract<StationEvent, { type: T }> => event.type === type);
  }

  persisted() {
    return readStationState(this.statePath);
  }
}

const F12 = "\x1b[24~";
const ENTER = "\r";
const DOWN = "\x1b[B";
const UP = "\x1b[A";
const TAB = "\t";
const ESCAPE_KEY = "\x1b";
const DETACH = Buffer.from([0x1c]);
void [F12, ENTER, DOWN, UP, TAB, ESCAPE_KEY, DETACH];

/** Strip SGR/positioning so panel text can be matched as plain words. */
function plain(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/** Collapse all whitespace: wrapped card lines read as one sentence. */
function squashed(text: string): string {
  return plain(text).replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Step 1 — S1.1 launch
// ---------------------------------------------------------------------------

describe("S1.1 launch: one window, every live session, no PTY started or stopped", () => {
  it("should open on the persisted session, relaunch the selected dead sessions through the port and list the others", async () => {
    const CONV1 = "33333333-3333-4333-8333-333333333331";
    const CONV2 = "33333333-3333-4333-8333-333333333332";
    const h = new Harness({
      state: JSON.stringify({
        version: 1,
        activeTab: "docs",
        lastSessionByTab: { docs: "h2a-guide", core: "h2a-tracker" },
        compatGuards: {},
      }),
      deadSessions: [
        { id: "h2a-dead-1", project: "h2a", label: "dead-one", host: "", mtime: 1_700_000_050_000, convId: CONV1 },
        { id: "h2a-dead-2", project: "site", label: "dead-two", host: "", mtime: 1_700_000_060_000, convId: CONV2 },
        // No resolved conversation: listed with its motif, never relaunched.
        { id: "h2a-dead-3", project: "h2a", label: "dead-three", host: "", mtime: 1_700_000_040_000 },
      ],
    });
    const before = h.fleet.all().map((s) => [s.id, s.host.generation, s.incarnation, s.status]);
    // Let the launch file drain before the detach: the loop never awaits it.
    h.step(tick, tick, tick, tick, tick, tick, tick, tick, tick, tick);
    h.afterStation = async () => {
      for (let i = 0; i < 200 && h.execCalls.length < 2; i += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    };

    const code = await h.run();

    expect(code).toBe(0);
    const snapshot = h.lastSnapshot();
    expect(snapshot.workspaces.map((w) => w.title)).toEqual(["core", "docs", "lab", "other"]);
    const rows = snapshot.workspaces.flatMap((w) => w.sessions.map((s) => s.id));
    expect(rows).toHaveLength(7);
    expect(new Set(rows)).toEqual(new Set(FIXTURE_SESSIONS.map((s) => s.id)));
    // Dead sessions are never live lines; the selected ones go through the
    // effect port, the others stay listed with one motif each.
    expect(rows).not.toContain("h2a-dead-1");
    expect(snapshot.footerRows).toBeUndefined();
    expect(h.execCalls.map((call) => call.args)).toEqual([
      ["run", "claude", `${h.home}/src/h2a`, "--resume", CONV1, "--name", "dead-one", "--no-attach"],
      ["run", "claude", `${h.home}/src/site`, "--resume", CONV2, "--name", "dead-two", "--no-attach"],
    ]);
    expect(h.execCalls.map((call) => call.cwd)).toEqual([
      `${h.home}/src/h2a`,
      `${h.home}/src/site`,
    ]);
    for (const call of h.execCalls) {
      expect(call.env).toEqual({ H2A_SESSION_HOST: "native" });
    }
    expect(h.of("relaunch").filter((e) => e.phase === "queued").map((e) => e.key)).toEqual([
      "registry:h2a-dead-1",
      "registry:h2a-dead-2",
    ]);
    const deadRows = snapshot.workspaces.flatMap((w) => w.restorable ?? []);
    expect(deadRows.find((r) => r.key === "registry:h2a-dead-3")).toMatchObject({
      reason: "unresolved-conversation",
    });
    expect(deadRows.find((r) => r.key === "registry:h2a-dead-3")?.relaunch).toBeUndefined();

    // Displayed session = the last persisted one, owned by the second host.
    expect(h.displayed()).toEqual(["h2a-guide"]);
    const displayed = h.of("displayed")[0]!;
    expect(displayed).toMatchObject({
      sessionId: "h2a-guide",
      tab: "docs",
      socketPath: "/fake/host-2.sock",
      panelOpen: true,
      initial: true,
    });
    expect(snapshot.workspaces[1]!.sessions.find((s) => s.id === "h2a-guide")?.displayedHere).toBe(true);
    // Panel open ⇒ the displayed PTY gets the columns left of the panel.
    expect(h.fleet.session("h2a-guide").resizes).toEqual([{ cols: 160 - 32, rows: 40 }]);
    expect(plain(h.stdout.text())).toContain("guide ready");

    // No PTY created nor stopped: same generations, incarnations and statuses.
    expect(h.fleet.all().map((s) => [s.id, s.host.generation, s.incarnation, s.status])).toEqual(before);
    // Exactly one session was ever acquired, none written to.
    expect(h.fleet.all().filter((s) => s.acquireRequests > 0).map((s) => s.id)).toEqual(["h2a-guide"]);
    expect(h.fleet.all().flatMap((s) => s.writes)).toEqual([]);
    // Leaving the station releases its lease; the session keeps running.
    expect(h.fleet.session("h2a-guide").controllerId).toBeNull();
    expect(h.of("closed")).toEqual([{ type: "closed", reason: "detach" }]);
  });

  it("should never spawn a process: the station module has no child_process dependency", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "station.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/child_process/);
    expect(source).not.toMatch(/gnome-terminal/);
  });

  it.each([
    ["absent", undefined, {}],
    ["corrupt", '{"version":1,"activeTab":', {}],
    [
      "pointing at a session that is gone",
      JSON.stringify({ version: 1, activeTab: "docs", lastSessionByTab: { docs: "h2a-vanished" }, compatGuards: {} }),
      // A remembered session that is not live is kept: S2 may bring it back.
      { docs: "h2a-vanished" },
    ],
  ])("should fall back to the most recent session of the first group when the state is %s", async (_label, state, remembered) => {
    const h = new Harness(state === undefined ? {} : { state });
    const code = await h.run();
    expect(code).toBe(0);
    // First group = core; its most recent session is `api`.
    expect(h.displayed()).toEqual(["h2a-api"]);
    expect(h.of("displayed")[0]).toMatchObject({ tab: "core", panelOpen: true });
    // The station rewrites a clean state: tab and last session per tab only.
    expect(h.persisted()).toEqual({
      status: "ok",
      state: { activeTab: "core", lastSessionByTab: { ...remembered, core: "h2a-api" }, compatGuards: {} },
    });
  });

  it("should display the session with a notice and keep the panel closed under the width threshold", async () => {
    // 60 columns leave 28 child columns with the panel open: below the 40 minimum.
    const h = new Harness({ columns: 60 });
    const code = await h.run();
    expect(code).toBe(0);
    expect(h.displayed()).toEqual(["h2a-api"]);
    expect(h.of("displayed")[0]).toMatchObject({ panelOpen: false });
    expect(h.of("notice").map((e) => e.key)).toContain("station.notice.narrow");
    expect(plain(h.stdout.text())).toContain(
      "terminal too narrow for the side panel (60 columns): session displayed, switching unavailable until lot S1b.",
    );
    // Collapsed: only the one-column marker is reserved.
    expect(h.fleet.session("h2a-api").resizes).toEqual([{ cols: 59, rows: 40 }]);
  });

  it("should refuse to open without any live session and report it, with no effect", async () => {
    const h = new Harness({ sessions: [] });
    const code = await h.run();
    expect(code).toBe(1);
    expect(h.displayed()).toEqual([]);
    expect(h.stdin.setRawMode).not.toHaveBeenCalled();
    expect(h.of("notice").map((e) => e.key)).toContain("station.refusal.noSession");
  });
});

// ---------------------------------------------------------------------------
// Step 3 — S1.2 leases, A→A, refusals
// ---------------------------------------------------------------------------

/** Wait one idle tick without doing anything. */
const tick: Step = () => {};

describe("S1.2 lease: hold B before leaving A, one active lease, A→A is a no-op", () => {
  it("should release A on a host that announces the composer broker, adapter or not", async () => {
    const h = new Harness({ brokerProtected: true });
    const host = h.fleet.host("/fake/host-1.sock");
    h.step(
      (x) => {
        expect(x.displayed()).toEqual(["h2a-api"]);
        expect(x.heldByStation()).toEqual(["h2a-api"]);
        x.activate("h2a-tracker");
      },
      (x) => {
        expect(x.displayed()).toEqual(["h2a-api", "h2a-tracker"]);
        // Outside a transition the station holds exactly one lease: the active one.
        expect(x.heldByStation()).toEqual(["h2a-tracker"]);
        expect(x.fleet.session("h2a-api").controllerId).toBeNull();
      },
    );
    await h.run();

    // B was held before A was let go.
    const order = host.log.filter((entry) => /^(acquire|release):/.test(entry));
    expect(order.indexOf("acquire:h2a-tracker")).toBeGreaterThan(-1);
    expect(order.indexOf("acquire:h2a-tracker")).toBeLessThan(order.indexOf("release:h2a-api"));
    expect(h.of("lease-released").map((e) => e.sessionId)).toEqual(["h2a-api"]);
    expect(h.of("guard")).toEqual([]);
    expect(h.persisted().state.compatGuards).toEqual({});
    expect(h.persisted().state).toMatchObject({
      activeTab: "core",
      lastSessionByTab: { core: "h2a-tracker" },
    });
  });

  it.each([
    ["absent", undefined],
    ["a newer version", 2],
    ["a string", "1"],
    ["a boolean", true],
    ["null", null],
  ])("should keep A as a compatibility guard when composerBrokerVersion is %s", async (_label, value) => {
    const h = new Harness();
    for (const host of h.fleet.hosts.values()) host.composerBrokerVersion = value;
    const api = h.fleet.session("h2a-api");
    let writesAtGuard = -1;
    let resizesAtGuard = -1;
    h.step(
      (x) => x.activate("h2a-tracker"),
      (x) => {
        expect(x.displayed()).toEqual(["h2a-api", "h2a-tracker"]);
        // A is still held by the station, as a guard.
        expect(x.heldByStation()).toEqual(["h2a-api", "h2a-tracker"]);
        writesAtGuard = api.writes.length;
        resizesAtGuard = api.resizes.length;
        expect(x.row("h2a-api")).toMatchObject({
          compatGuard: true,
          controlledElsewhere: false,
          displayedHere: false,
          draftCapability: "refused-no-capability",
        });
        expect(x.row("h2a-tracker")).toMatchObject({ displayedHere: true, compatGuard: false });
        // Typing and a window resize reach the displayed session only.
        x.stdin.type("typed-for-b");
        x.stdout.columns = 150;
        x.resizeListener?.();
      },
      tick,
    );
    await h.run();

    // No byte and no resize ever reaches a session under a guard lease.
    expect(api.writes.length).toBe(writesAtGuard);
    expect(api.resizes.length).toBe(resizesAtGuard);
    expect(h.fleet.session("h2a-tracker").writes.join("")).toBe("typed-for-b");
    expect(h.of("guard").map((e) => [e.action, e.sessionId])).toEqual([["kept", "h2a-api"]]);
    expect(h.of("lease-released")).toEqual([]);
    // The guard is persisted with the identity of its lease, nothing else.
    expect(h.persisted().state.compatGuards).toEqual({
      "h2a-api": { generation: "gen-/fake/host-1.sock", incarnation: "inc-1" },
    });
  });

  it("should promote a guard after a fresh comparison, with no new acquisition request", async () => {
    const h = new Harness();
    const api = h.fleet.session("h2a-api");
    const tracker = h.fleet.session("h2a-tracker");
    h.step(
      (x) => x.activate("h2a-tracker"),
      (x) => {
        expect(api.acquireRequests).toBe(1);
        x.activate("h2a-api");
      },
      (x) => {
        expect(x.displayed()).toEqual(["h2a-api", "h2a-tracker", "h2a-api"]);
        // A came back through its guard: the same lease, no request to the host.
        expect(api.acquireRequests).toBe(1);
        expect(tracker.acquireRequests).toBe(1);
        expect(x.heldByStation()).toEqual(["h2a-api", "h2a-tracker"]);
        expect(x.row("h2a-tracker").compatGuard).toBe(true);
        expect(x.row("h2a-api").compatGuard).toBe(false);
      },
    );
    await h.run();
    expect(h.of("guard").map((e) => [e.action, e.sessionId])).toEqual([
      ["kept", "h2a-api"],
      ["promoted", "h2a-api"],
      ["kept", "h2a-tracker"],
    ]);
  });

  it("should retire a stale guard alone and keep the shared host client open", async () => {
    const h = new Harness();
    const host = h.fleet.host("/fake/host-1.sock");
    const api = h.fleet.session("h2a-api");
    let stationClient: FakeClient | undefined;
    h.step(
      (x) => x.activate("h2a-tracker"),
      (x) => {
        stationClient = [...host.clients].find((client) => client.held.has("h2a-tracker"));
        expect(stationClient?.held.has("h2a-api")).toBe(true);
        // Another terminal takes A by force: the guard lease is now stale.
        api.controlElsewhere({ pid: 555, tty: "/dev/pts/4" });
        x.now += 2_000;
      },
      tick,
      tick,
      (x) => {
        expect(x.row("h2a-api")).toMatchObject({ compatGuard: false, controlledElsewhere: true });
        // The displayed session kept its lease on the very same connection.
        expect(stationClient?.closed).toBe(false);
        expect(x.heldByStation()).toEqual(["h2a-tracker"]);
        x.stdin.type("still-b");
      },
      tick,
    );
    await h.run();
    expect(h.of("guard").map((e) => [e.action, e.sessionId])).toEqual([
      ["kept", "h2a-api"],
      ["stale", "h2a-api"],
    ]);
    expect(h.fleet.session("h2a-tracker").writes.join("")).toBe("still-b");
    expect(h.persisted().state.compatGuards).toEqual({});
    // One long-lived connection per owner host was enough for the whole run.
    expect(h.displayed()).toEqual(["h2a-api", "h2a-tracker"]);
  });

  it("should do nothing on A→A: no acquisition request, no card, focus back to the CLI", async () => {
    const h = new Harness();
    const api = h.fleet.session("h2a-api");
    const logBefore: string[] = [];
    h.step(
      (x) => {
        logBefore.push(...x.fleet.host("/fake/host-1.sock").log);
        const mark = x.stdout.mark();
        x.activate("h2a-api");
        // Handled synchronously: no neutral reset, no clear, nothing repainted for A.
        expect(x.stdout.since(mark)).not.toContain("\x1b[!p");
        expect(x.stdout.since(mark)).not.toContain("\x1b[2J");
        // The keyboard is back on the CLI: this goes to A, not to the panel.
        x.stdin.type("j1/");
      },
      tick,
    );
    await h.run();
    expect(api.acquireRequests).toBe(1);
    expect(h.of("same-session")).toEqual([{ type: "same-session", sessionId: "h2a-api" }]);
    expect(h.of("card")).toEqual([]);
    expect(h.of("switch-refused")).toEqual([]);
    expect(h.displayed()).toEqual(["h2a-api"]);
    expect(api.writes.join("")).toBe("j1/");
    expect(
      h.fleet.host("/fake/host-1.sock").log.filter((entry) => entry.startsWith("acquire")),
    ).toEqual(logBefore.filter((entry) => entry.startsWith("acquire")));
  });

  it.each([
    [
      "controlled by another terminal",
      (x: Harness) => void x.fleet.session("h2a-tracker").controlElsewhere({ pid: 4321, tty: "/dev/pts/7" }),
      "controlled-elsewhere",
      "tracker: controlled by pid 4321 tty /dev/pts/7 since 2026-11-21T08:00:00.000Z",
    ],
    [
      "exited",
      (x: Harness) => void x.fleet.session("h2a-tracker").end(3),
      "ended",
      "tracker: session ended (exit code 3)",
    ],
    [
      "gone from its host",
      (x: Harness) => void x.fleet.host("/fake/host-1.sock").sessions.delete("h2a-tracker"),
      "absent",
      "tracker: absent",
    ],
  ] as const)("should stay on A with its lease intact when B is %s", async (_label, arrange, reason, card) => {
    const h = new Harness();
    const api = h.fleet.session("h2a-api");
    let epoch = -1;
    h.step(
      (x) => {
        epoch = api.controllerEpoch;
        arrange(x);
        x.activate("h2a-tracker");
      },
      (x) => {
        expect(x.of("switch-refused")).toEqual([{ type: "switch-refused", sessionId: "h2a-tracker", reason }]);
        expect(x.of("card").map((e) => e.text)).toEqual([card]);
        // The card is painted in the panel (wrapped to its width).
        expect(plain(x.stdout.text())).toContain(card.slice(0, 20));
        // The lease of A is the very same one: never released, never retaken.
        expect(api.controllerEpoch).toBe(epoch);
        expect(x.heldByStation()).toEqual(["h2a-api"]);
        // Esc closes the card; a second Esc gives the keyboard back to the CLI.
        x.stdin.type("\x1b");
      },
      (x) => x.stdin.type("\x1b"),
      tick,
      (x) => x.stdin.type("after-refusal"),
      tick,
    );
    await h.run();
    expect(h.displayed()).toEqual(["h2a-api"]);
    expect(api.acquireRequests).toBe(1);
    expect(api.writes.join("")).toBe("after-refusal");
    expect(h.of("guard")).toEqual([]);
  });

  it("should stay on A when the host of B is silent", async () => {
    const h = new Harness();
    const api = h.fleet.session("h2a-api");
    h.step(
      (x) => {
        // h2a-guide lives on the second owner host.
        x.fleet.host("/fake/host-2.sock").down = true;
        x.activate("h2a-guide");
      },
      (x) => {
        expect(x.of("switch-refused").map((e) => e.reason)).toEqual(["host-silent"]);
        expect(x.heldByStation()).toEqual(["h2a-api"]);
        x.stdin.type("\x1b");
      },
      (x) => x.stdin.type("\x1b"),
      tick,
      (x) => x.stdin.type("still-a"),
      tick,
    );
    await h.run();
    expect(h.displayed()).toEqual(["h2a-api"]);
    expect(api.writes.join("")).toBe("still-a");
    expect(h.of("card").map((e) => e.text)).toEqual(["guide: host did not answer, no switch"]);
    expect(plain(h.stdout.text())).toContain("guide: host did not answer");
  });

  it("should show the card at once for a human holder and retry once for a lease without terminal identity", async () => {
    const human = new Harness();
    const tracker = human.fleet.session("h2a-tracker");
    human.step(
      (x) => {
        tracker.controlElsewhere({ pid: 4321, tty: "/dev/pts/7" });
        x.activate("h2a-tracker");
      },
      tick,
    );
    await human.run();
    expect(tracker.acquireRequests).toBe(1);
    expect(human.delays).not.toContain(250);

    const anonymous = new Harness();
    const target = anonymous.fleet.session("h2a-tracker");
    anonymous.fleet.host("/fake/host-1.sock").hooks.beforeAcquire = (session) => {
      // The short-lived automation lease ends before the retry.
      if (session.id === "h2a-tracker" && session.acquireRequests === 2) session.releaseElsewhere();
    };
    anonymous.step(
      (x) => {
        target.controlElsewhere({ pid: null, tty: "unknown" });
        x.activate("h2a-tracker");
      },
      tick,
    );
    await anonymous.run();
    expect(target.acquireRequests).toBe(2);
    expect(anonymous.delays.filter((ms) => ms === 250)).toHaveLength(1);
    expect(anonymous.displayed()).toEqual(["h2a-api", "h2a-tracker"]);
    expect(anonymous.of("switch-refused")).toEqual([]);

    const stuck = new Harness();
    const held = stuck.fleet.session("h2a-tracker");
    stuck.step(
      (x) => {
        held.controlElsewhere({ pid: null, tty: "unknown" });
        x.activate("h2a-tracker");
      },
      tick,
    );
    await stuck.run();
    // Exactly one retry, then the card: the station stays on A.
    expect(held.acquireRequests).toBe(2);
    expect(stuck.displayed()).toEqual(["h2a-api"]);
    expect(stuck.of("switch-refused").map((e) => e.reason)).toEqual(["controlled-elsewhere"]);
  });

  it("should take a session held elsewhere only after the confirmation", async () => {
    const h = new Harness();
    const tracker = h.fleet.session("h2a-tracker");
    let other: NativeTerminalControllerLease | undefined;
    h.step(
      (x) => {
        other = tracker.controlElsewhere({ pid: 4321, tty: "/dev/pts/7" });
        x.activate("h2a-tracker");
      },
      (x) => {
        expect(plain(x.stdout.text())).toContain("Enter: take control · Esc: stay");
        // Esc: nothing is taken.
        x.stdin.type("\x1b");
      },
      tick,
      (x) => {
        expect(tracker.controllerId).toBe(other?.controllerId);
        expect(tracker.acquireRequests).toBe(1);
        x.activate("h2a-tracker");
      },
      // Enter on the card is the explicit, confirmed gesture.
      (x) => x.stdin.type("\r"),
      tick,
    );
    await h.run();
    expect(h.displayed()).toEqual(["h2a-api", "h2a-tracker"]);
    expect(h.fleet.host("/fake/host-1.sock").log).toContain("acquire:h2a-tracker:takeover");
    // The other terminal lost its lease: its next request is refused as stale.
    expect(tracker.controllerEpoch).toBeGreaterThan(other!.epoch);
    expect(h.of("switch-refused")).toHaveLength(2);
  });

  it("should abandon the switch when a human write to A is still in flight after 250 ms", async () => {
    const h = new Harness();
    const host = h.fleet.host("/fake/host-1.sock");
    const api = h.fleet.session("h2a-api");
    const tracker = h.fleet.session("h2a-tracker");
    let release: (() => void) | undefined;
    host.hooks.beforeWrite = (session) =>
      session.id === "h2a-api"
        ? new Promise<void>((resolve) => {
            release = resolve;
          })
        : undefined;
    h.step(
      (x) => {
        x.stdin.type("slow");
        x.activate("h2a-tracker");
      },
      (x) => {
        expect(x.of("switch-refused").map((e) => e.reason)).toEqual(["input-in-flight"]);
        // B was given back, A kept its lease and its size.
        expect(tracker.controllerId).toBeNull();
        expect(x.heldByStation()).toEqual(["h2a-api"]);
        expect(tracker.resizes).toEqual([]);
        release?.();
        host.hooks.beforeWrite = undefined;
        x.stdin.type("\x1b");
      },
      tick,
    );
    await h.run();
    expect(h.displayed()).toEqual(["h2a-api"]);
    expect(h.delays).toContain(250);
    expect(api.resizes).toHaveLength(1);
    expect(api.writes).toEqual(["slow"]);
    expect(host.log.filter((entry) => entry.endsWith("h2a-tracker"))).toEqual([
      "acquire:h2a-tracker",
      "release:h2a-tracker",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Step 4 — S1.3 input, S1.5 replay and sentinel, S1.6 size
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32): the 50 switches are the same on every run. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("S1.3 input (I4): a byte typed for A never reaches B", () => {
  it("should deliver or drop 1 000 keystrokes across 50 deterministic switches with zero misrouted byte", async () => {
    const h = new Harness();
    const random = prng(0x5eed2611);
    const ids = FIXTURE_SESSIONS.map((session) => session.id);
    let current = "";
    let switching = false;
    let typed = 0;
    const idle: Array<{ token: string; target: string }> = [];
    const transition: Array<{ token: string; target: string }> = [];
    const type = (bucket: Array<{ token: string; target: string }>): void => {
      const token = `<${typed}:${current}>`;
      typed += 1;
      bucket.push({ token, target: current });
      h.stdin.type(token);
    };
    h.listeners.push((event) => {
      if (event.type === "displayed") {
        current = event.sessionId;
        switching = false;
      }
    });
    // While a switch is running, keystrokes meant for the session still shown
    // arrive at every await point of the transition.
    for (const host of h.fleet.hosts.values()) {
      host.hooks.beforeAcquire = () => {
        if (switching) for (let i = 0; i < 3; i += 1) type(transition);
      };
      host.hooks.beforeState = () => {
        if (switching) for (let i = 0; i < 2; i += 1) type(transition);
      };
      host.hooks.beforeRead = (_session, afterSeq) => {
        if (switching && afterSeq === 0) for (let i = 0; i < 3; i += 1) type(transition);
      };
    }
    for (let k = 0; k < 50; k += 1) {
      h.step(
        () => {
          for (let i = 0; i < 4; i += 1) type(idle);
        },
        (x) => {
          const others = ids.filter((id) => id !== current);
          const target = others[Math.floor(random() * others.length)]!;
          switching = true;
          x.activate(target);
          // Typed right after the gesture, before the switch is over.
          for (let i = 0; i < 2; i += 1) type(transition);
        },
      );
    }
    // Top up to exactly 1 000 keystrokes, a burst per idle pause.
    for (let burst = 0; burst < 40; burst += 1) {
      h.step(() => {
        for (let i = 0; i < 10 && typed < 1_000; i += 1) type(idle);
      });
    }
    h.step(tick);

    await h.run();

    expect(typed).toBe(1_000);
    expect(h.displayed()).toHaveLength(51);
    expect(new Set(h.displayed()).size).toBeGreaterThan(3);
    const delivered = new Map<string, string>();
    for (const session of h.fleet.all()) {
      const stream = session.writes.join("");
      const tokens = stream.match(/<\d+:[^>]+>/g) ?? [];
      // Only whole tokens, and only tokens typed for this very session.
      expect(stream.replace(/<\d+:[^>]+>/g, ""), session.id).toBe("");
      for (const token of tokens) {
        expect(token.endsWith(`:${session.id}>`), `${token} reached ${session.id}`).toBe(true);
        expect(delivered.has(token), `${token} delivered twice`).toBe(false);
        delivered.set(token, session.id);
      }
      // Order is preserved within a session.
      const order = tokens.map((token) => Number(token.slice(1, token.indexOf(":"))));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
    // Typed while the input was open: every keystroke arrived.
    for (const { token, target } of idle) expect(delivered.get(token), token).toBe(target);
    // Typed during a transition: dropped, or delivered to the session it was typed for.
    expect(transition.length).toBeGreaterThan(300);
    for (const { token, target } of transition) {
      const reached = delivered.get(token);
      expect(reached === undefined || reached === target, token).toBe(true);
    }
    const droppedBytes = h.of("input-dropped").reduce((sum, event) => sum + event.bytes, 0);
    expect(droppedBytes).toBeGreaterThan(0);
    expect(new Set(h.of("input-dropped").map((event) => event.reason))).toEqual(new Set(["transition"]));
  });

  it("should purge the queue still pending for A and wait for its write in flight", async () => {
    const h = new Harness();
    const host = h.fleet.host("/fake/host-1.sock");
    const api = h.fleet.session("h2a-api");
    const tracker = h.fleet.session("h2a-tracker");
    let release: (() => void) | undefined;
    host.hooks.beforeWrite = (session) =>
      session.id === "h2a-api"
        ? new Promise<void>((resolve) => {
            release = resolve;
          })
        : undefined;
    // The write to A settles while the station is holding B (within the 250 ms).
    host.hooks.beforeAcquire = (session) => {
      if (session.id === "h2a-tracker") setTimeout(() => release?.(), 0);
    };
    const held = h.holdDelays((ms) => ms === 250);
    h.step(
      (x) => {
        x.stdin.type("first");
        x.stdin.type("second");
        x.stdin.type("third");
        x.activate("h2a-tracker");
      },
      (x) => {
        held.release();
        x.stdin.type("for-b");
      },
      tick,
    );
    await h.run();
    expect(h.displayed()).toEqual(["h2a-api", "h2a-tracker"]);
    // The chunk in flight reached A; what was queued behind it was dropped.
    expect(api.writes).toEqual(["first"]);
    expect(tracker.writes.join("")).toBe("for-b");
    expect(h.of("input-purged")).toEqual([
      { type: "input-purged", bytes: "secondthird".length, reason: "transition" },
    ]);
  });

  it("should close the station when the detach byte is typed during a transition", async () => {
    const h = new Harness();
    const tracker = h.fleet.session("h2a-tracker");
    h.fleet.host("/fake/host-1.sock").hooks.beforeAcquire = (session) => {
      if (session.id === "h2a-tracker") h.stdin.type(DETACH);
    };
    h.step((x) => x.activate("h2a-tracker"));
    const code = await h.run();
    expect(code).toBe(0);
    expect(h.of("closed")).toEqual([{ type: "closed", reason: "detach" }]);
    expect(h.displayed()).toEqual(["h2a-api"]);
    // B was held for a moment and given back; nothing stays controlled.
    expect(tracker.controllerId).toBeNull();
    expect(h.heldByStation()).toEqual([]);
    expect(h.fleet.all().flatMap((session) => session.writes)).toEqual([]);
  });
});

describe("S1.5 replay: no terminal request, no reply, no side effect is replayed", () => {
  const ESC = "\x1b";
  const QUERIES = [
    `${ESC}[6n`, `${ESC}[?6n`, `${ESC}[5n`, `${ESC}[c`, `${ESC}[>c`, `${ESC}[=c`, `${ESC}[>q`,
    `${ESC}[?u`, `${ESC}[14t`, `${ESC}[16t`, `${ESC}[18t`, `${ESC}[21t`, `${ESC}[?2026$p`,
    `${ESC}P$qm${ESC}\\`, `${ESC}P+q544e${ESC}\\`, `${ESC}]4;1;?${ESC}\\`, `${ESC}]10;?\x07`,
    `${ESC}]11;?\x07`, `${ESC}]12;?\x07`, `${ESC}]52;c;?\x07`, "\x05",
  ];
  const SIDE_EFFECTS = [`${ESC}]52;c;aGVsbG8=\x07`, "\x07", `${ESC}]9;done\x07`, `${ESC}]777;notify;a;b\x07`];

  it("should filter the catch-up bytes and leave the live output untouched", async () => {
    const h = new Harness();
    const tracker = h.fleet.session("h2a-tracker");
    const k = 9;
    // History of B: k cursor-position requests, every family, a clipboard write, a bell.
    for (let i = 0; i < k; i += 1) tracker.emit(`history ${i}${ESC}[6n\r\n`);
    tracker.emit(QUERIES.join("q"));
    tracker.emit(SIDE_EFFECTS.join("s"));
    tracker.emit("history-end\r\n");
    let afterSwitch = -1;
    let beforeSwitch = -1;
    h.step(
      (x) => {
        beforeSwitch = x.stdout.mark();
        x.activate("h2a-tracker");
      },
      (x) => {
        afterSwitch = x.stdout.mark();
        // Live output of B, after the catch-up: this request must go through.
        tracker.emit(`live${ESC}[6n${ESC}]52;c;bGl2ZQ==\x07\x07`);
      },
      tick,
      tick,
    );
    await h.run();

    const catchUp = h.stdout.chunks.slice(beforeSwitch, afterSwitch).join("");
    const live = h.stdout.chunks.slice(afterSwitch).join("");
    expect(plain(catchUp)).toContain("history-end");

    // A terminal that answers everything is the oracle.
    const answering = async (data: string) => {
      const term = new XtermTerminal({ cols: 160, rows: 40, allowProposedApi: true });
      const replies: string[] = [];
      const clipboard: string[] = [];
      const notifications: string[] = [];
      let bells = 0;
      term.onData((reply) => replies.push(reply));
      term.onBell(() => {
        bells += 1;
      });
      term.parser.registerOscHandler(52, (payload) => {
        clipboard.push(payload);
        return true;
      });
      for (const code of [9, 99, 777]) {
        term.parser.registerOscHandler(code, (payload) => {
          notifications.push(`${code};${payload}`);
          return true;
        });
      }
      await writeTerm(term, data);
      term.dispose();
      return { replies, clipboard, notifications, bells };
    };
    // Zero request emitted during the catch-up ⇒ zero reply, zero side effect.
    expect(await answering(catchUp)).toEqual({ replies: [], clipboard: [], notifications: [], bells: 0 });
    for (const query of QUERIES.filter((q) => q.length > 1)) {
      expect(catchUp.includes(query), JSON.stringify(query)).toBe(false);
    }
    // Zero reply byte transmitted to the resumed CLI.
    expect(tracker.writes).toEqual([]);
    // The live output is not filtered: request, clipboard write and bell go out.
    const liveOutcome = await answering(live);
    expect(liveOutcome.replies.length).toBeGreaterThan(0);
    expect(liveOutcome.clipboard).toEqual(["c;bGl2ZQ=="]);
    expect(liveOutcome.bells).toBe(1);
    expect(live).toContain(`live${ESC}[6n`);
    // Off a TTY the station emits no sentinel of its own.
    expect(h.stdout.text()).not.toContain(`${ESC}[5n`);
    expect(h.of("sentinel").map((event) => event.outcome)).toEqual(["skipped", "skipped"]);
  });

  it("should open the input as soon as the terminal answers the sentinel", async () => {
    const h = new Harness({ tty: true });
    const tracker = h.fleet.session("h2a-tracker");
    h.stdout.onWrite = (chunk) => {
      // Garbage that precedes the reply is dropped with it.
      if (chunk.includes(`${ESC}[5n`)) h.stdin.type(`junk${ESC}[0n`);
    };
    h.step((x) => x.activate("h2a-tracker"), (x) => x.stdin.type("after"), tick);
    await h.run();
    expect(h.of("sentinel").map((event) => event.outcome)).toEqual(["answered", "answered"]);
    expect(h.delays).toContain(150);
    expect(tracker.writes.join("")).toBe("after");
    expect(h.fleet.session("h2a-api").writes).toEqual([]);
  });

  it("should preserve input coalesced behind or split across the sentinel reply", async () => {
    const h = new Harness({ tty: true });
    const api = h.fleet.session("h2a-api");
    const tracker = h.fleet.session("h2a-tracker");
    let sentinels = 0;
    h.stdout.onWrite = (chunk) => {
      if (!chunk.includes(`${ESC}[5n`)) return;
      sentinels += 1;
      if (sentinels === 1) {
        // Coalesced in one read: garbage + ESC[0n + panel click + digit to switch.
        h.stdin.type(`junk${ESC}[0n${ESC}[<0;160;37M${ESC}[<0;160;37m3`);
      } else {
        // Split ESC[0n across two chunks, with keystrokes right after `n`.
        h.stdin.type(`early${ESC}[0`);
        h.stdin.type("nafter-split");
      }
    };
    h.step(tick, tick);
    await h.run();
    expect(h.of("sentinel").map((event) => event.outcome)).toEqual(["answered", "answered"]);
    expect(h.displayed()).toEqual(["h2a-api", "h2a-tracker"]);
    expect(api.writes).toEqual([]);
    expect(tracker.writes.join("")).toBe("after-split");
    // Only bytes up to and including ESC[0n were dropped as transition input.
    const dropped = h.of("input-dropped").reduce((sum, event) => sum + event.bytes, 0);
    expect(dropped).toBe(`junk${ESC}[0n`.length + `early${ESC}[0n`.length);
  });

  it("should preserve input arriving after the sentinel reply while focus-in is in flight", async () => {
    const h = new Harness({ tty: true });
    const tracker = h.fleet.session("h2a-tracker");
    tracker.emit(`${ESC}[?1004h`);
    let releaseFocusIn: (() => void) | undefined;
    h.fleet.host("/fake/host-1.sock").hooks.beforeWrite = (session, data) => {
      if (session.id === "h2a-tracker" && data === `${ESC}[I`) {
        return new Promise<void>((resolve) => {
          releaseFocusIn = resolve;
        });
      }
      return undefined;
    };
    let sentinels = 0;
    h.stdout.onWrite = (chunk) => {
      if (!chunk.includes(`${ESC}[5n`)) return;
      sentinels += 1;
      h.stdin.type(`${ESC}[0n`);
      if (sentinels === 2) {
        // Arrives in a separate chunk after ESC[0n while FOCUS_IN is still pending.
        setTimeout(() => {
          h.stdin.type(`${ESC}[<0;160;37M${ESC}[<0;160;37m`);
          h.stdin.type("1");
          releaseFocusIn?.();
        }, 0);
      }
    };
    h.step((x) => x.activate("h2a-tracker"), tick, tick);
    await h.run();
    expect(h.displayed()).toEqual(["h2a-api", "h2a-tracker", "h2a-api"]);
    expect(tracker.writes.join("")).toBe(`${ESC}[I${ESC}[O`);
  });

  it("should open the input at the bounded delay when nothing answers, and swallow a late reply", async () => {
    const h = new Harness({ tty: true });
    const tracker = h.fleet.session("h2a-tracker");
    let sentinels = 0;
    let waiting: { release(): void; waiting(): number } | undefined;
    h.stdout.onWrite = (chunk) => {
      if (!chunk.includes(`${ESC}[5n`)) return;
      sentinels += 1;
      if (sentinels === 2) {
        // Second sentinel (the switch): hold its delay, type while it waits.
        waiting = h.holdDelays((ms) => ms === 150);
        setTimeout(() => {
          h.stdin.type("typed-too-early");
          waiting?.release();
        }, 0);
      }
    };
    h.step(
      (x) => x.activate("h2a-tracker"),
      (x) => {
        expect(x.of("sentinel").map((event) => event.outcome)).toEqual(["timeout", "timeout"]);
        // Two late replies are still owed: both are swallowed, even split.
        x.stdin.type(`ab${ESC}[0ncd`);
        x.stdin.type(`x${ESC}[`);
        x.stdin.type("0ny");
      },
      tick,
      (x) => {
        // No reply is owed any more: these bytes are plain input again.
        x.stdin.type(`${ESC}[0n`);
      },
      tick,
    );
    await h.run();
    expect(sentinels).toBe(2);
    expect(h.of("sentinel").map((event) => event.outcome)).toEqual([
      "timeout",
      "timeout",
      "late-swallowed",
      "late-swallowed",
    ]);
    // Nothing typed before the delay reached B; the late replies never did.
    expect(tracker.writes.join("")).toBe(`abcdxy${ESC}[0n`);
  });

  it("should deliver a lone Esc typed while a late reply is still owed", async () => {
    const h = new Harness({ tty: true });
    const api = h.fleet.session("h2a-api");
    h.step((x) => x.stdin.type(ESC), tick, tick, (x) => x.stdin.type("z"), tick);
    await h.run();
    expect(h.of("sentinel").map((event) => event.outcome)).toEqual(["timeout"]);
    expect(api.writes.join("")).toBe(`${ESC}z`);
  });
});

describe("S1.6 size: only the displayed session is resized", () => {
  it("should resize B once at the switch, never A, and A again only after the window changed", async () => {
    const h = new Harness();
    const api = h.fleet.session("h2a-api");
    const tracker = h.fleet.session("h2a-tracker");
    h.step(
      (x) => {
        expect(api.resizes).toEqual([{ cols: 128, rows: 40 }]);
        x.activate("h2a-tracker");
      },
      (x) => {
        // One resize of B, none of A.
        expect(tracker.resizes).toEqual([{ cols: 128, rows: 40 }]);
        expect(api.resizes).toHaveLength(1);
        x.activate("h2a-api");
      },
      (x) => {
        // Same geometry as when A was left: no resize request at all.
        expect(api.resizes).toHaveLength(1);
        // The window is resized while A is displayed: A alone follows.
        x.stdout.columns = 140;
        x.stdout.rows = 30;
        x.resizeListener?.();
      },
      (x) => {
        expect(api.resizes).toEqual([{ cols: 128, rows: 40 }, { cols: 108, rows: 30 }]);
        expect(tracker.resizes).toHaveLength(1);
        x.activate("h2a-tracker");
      },
      (x) => {
        // B gets the new geometry when it comes back, not before.
        expect(tracker.resizes).toEqual([{ cols: 128, rows: 40 }, { cols: 108, rows: 30 }]);
        expect(api.resizes).toHaveLength(2);
      },
    );
    await h.run();
    for (const other of h.fleet.all().filter((s) => !["h2a-api", "h2a-tracker"].includes(s.id))) {
      expect(other.resizes, other.id).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Step 4 — S1.4 modes oracle, S1.10 containment during the replay
// Step 5 — synthetic focus and mouse release, receipt before mode, no RIS
// ---------------------------------------------------------------------------

/** The real attach bar (disabled): its child-sized model contains the output. */
const realBar = (stdout: FakeOutput, sessionId: string): StationStatusBar =>
  createNativeStatusBar(sessionId, stdout as unknown as NodeJS.WriteStream, () => 0, false);

const E = "\x1b";
/** A child using every tracked mode and the untracked state of r2 annex D. */
const MODE_HEAVY =
  `${E}[?1049h${E}[?1000h${E}[?1006h${E}[?2004h${E}[?1004h${E}[>1u${E}[?25l` +
  `${E}[2;10r${E}[?7l${E}[?6h${E}[4h${E}(0${E}[4 q${E}]10;#ffffff\x07` +
  `${E}[1;1HALPHA-SCREEN`;
const PLAIN_B = `bravo line 1\r\nbravo line 2\r\n${E}[?2004h`;

function cellSignature(term: HeadlessTerm, y: number, x: number): string {
  const cell = term.buffer.active.getLine(y)?.getCell(x);
  if (!cell) return "<missing>";
  const fg = cell.isFgRGB() ? `rgb:${cell.getFgColor()}` : cell.isFgPalette() ? `pal:${cell.getFgColor()}` : "def";
  const bg = cell.isBgRGB() ? `rgb:${cell.getBgColor()}` : cell.isBgPalette() ? `pal:${cell.getBgColor()}` : "def";
  return `${JSON.stringify(cell.getChars() || " ")}/w${cell.getWidth()}/${fg}/${bg}/b${cell.isBold()}/i${cell.isInverse()}`;
}

function screenSignature(term: HeadlessTerm, fromCol = 0, toCol = term.cols): string[] {
  const rows: string[] = [];
  for (let y = 0; y < term.rows; y += 1) {
    let row = "";
    for (let x = fromCol; x < toCol; x += 1) row += cellSignature(term, y, x) + "|";
    rows.push(row);
  }
  return rows;
}

function terminalState(term: HeadlessTerm) {
  return {
    buffer: term.buffer.active.type,
    cursor: [term.buffer.active.cursorX, term.buffer.active.cursorY],
    modes: { ...term.modes },
    screen: screenSignature(term),
  };
}

async function outerAfter(data: string, cols = 160, rows = 40): Promise<HeadlessTerm> {
  const term = new XtermTerminal({ cols, rows, allowProposedApi: true, scrollback: 0 });
  await writeTerm(term, data);
  return term;
}

function modeFixture(overrides: Partial<HarnessOptions> = {}): Harness {
  const h = new Harness({ brokerProtected: true, statusBar: realBar, ...overrides });
  h.fleet.session("h2a-api").emit(MODE_HEAVY);
  h.fleet.session("h2a-tracker").emit(PLAIN_B);
  return h;
}

describe("S1.4 modes: A→B→A leaves the terminal as a fresh attach on A would", () => {
  it("should equal a fresh attach after A→B→A, with no mode of A active while B is shown", async () => {
    const h = modeFixture();
    const marks: number[] = [];
    h.listeners.push((event) => {
      if (event.type === "displayed") marks.push(h.stdout.mark());
    });
    h.step((x) => x.activate("h2a-tracker"), (x) => x.activate("h2a-api"), tick);
    await h.run();
    expect(h.displayed()).toEqual(["h2a-api", "h2a-tracker", "h2a-api"]);

    const freshOn = async (sessionId: string) => {
      const tab = "core";
      const fresh = modeFixture({
        state: JSON.stringify({ version: 1, activeTab: tab, lastSessionByTab: { [tab]: sessionId }, compatGuards: {} }),
      });
      let mark = -1;
      fresh.listeners.push((event) => {
        if (event.type === "displayed") mark = fresh.stdout.mark();
      });
      await fresh.run();
      expect(fresh.displayed()).toEqual([sessionId]);
      return terminalState(await outerAfter(fresh.stdout.chunks.slice(0, mark).join("")));
    };

    const onB = terminalState(await outerAfter(h.stdout.chunks.slice(0, marks[1]).join("")));
    const backOnA = terminalState(await outerAfter(h.stdout.chunks.slice(0, marks[2]).join("")));
    const freshA = await freshOn("h2a-api");
    const freshB = await freshOn("h2a-tracker");

    // Oracle: full-width headless terminal, state and screen, cell by cell.
    expect(backOnA).toEqual(freshA);
    expect(onB).toEqual(freshB);
    // The fixture really exercises the modes: A is in the alternate screen…
    expect(freshA.buffer).toBe("alternate");
    expect(freshA.modes).toMatchObject({
      bracketedPasteMode: true,
      sendFocusMode: true,
      insertMode: true,
      originMode: true,
      wraparoundMode: false,
    });
    // …and none of that is active while B is displayed.
    expect(onB.buffer).toBe("normal");
    expect(onB.modes).toMatchObject({
      sendFocusMode: false,
      insertMode: false,
      originMode: false,
      wraparoundMode: true,
    });
    // The h2a-owned mouse survives every switch: a panel click is received.
    expect(onB.modes.mouseTrackingMode).not.toBe("none");
    expect(backOnA.modes.mouseTrackingMode).not.toBe("none");
    // Never a full reset.
    expect(h.stdout.text()).not.toContain(`${E}c`);
    expect(h.stdout.text()).toContain(`${E}[!p`);
  });

  it("should apply the t4 order of annex D: A undone, soft reset, neutral base, clear, h2a mouse", async () => {
    const h = modeFixture();
    let mark = -1;
    h.step((x) => {
      mark = x.stdout.mark();
      x.activate("h2a-tracker");
    }, tick);
    await h.run();
    const out = h.stdout.since(mark);
    const at = (needle: string): number => {
      const index = out.indexOf(needle);
      expect(index, JSON.stringify(needle)).toBeGreaterThan(-1);
      return index;
    };
    const undoA = at(`${E}[?1049l`);
    const soft = at(`${E}[!p`);
    const base = at(`${E}[?7h${E}[?25h${E}[?6l${E}[4l${E}[0m${E}[0 q${E}(B\x0f`);
    const clear = at(`${E}[2J${E}[3J${E}[H`);
    const mouse = out.indexOf(`${E}[?1000h${E}[?1006h`, clear);
    const replay = at("bravo line 1");
    expect(undoA).toBeLessThan(soft);
    expect(soft).toBeLessThan(base);
    expect(base).toBeLessThan(clear);
    expect(clear).toBeLessThan(mouse);
    expect(mouse).toBeLessThan(replay);
    // The h2a mouse is never switched off by the switch itself.
    expect(out.slice(0, replay)).not.toContain(`${E}[?1000l`);
  });
});

describe("S1.10 containment during the replay (PANEL §4.1 (i) and (ii))", () => {
  it("should hold after the catch-up and after every live batch, panel open", async () => {
    const childCols = 160 - 32;
    const childRows = 40;
    const near = childCols - 2;
    // Corpus of PANEL L0.5.5: overlong lines, wide glyphs at the boundary,
    // out-of-range cursor moves, EL/ECH/ICH/DCH/REP, scrolls, ED, alt screen.
    const corpus = [
      `${E}[1;1H${"A".repeat(childCols)}OVERFLOW_WRAP_LINE\r\n${"B".repeat(childCols)}\bZ`,
      `${E}[4;1H${"X".repeat(childCols - 1)}中AFTER${E}[?7l${E}[6;1H${"Y".repeat(childCols + 5)}${E}[?7h`,
      `${E}[7;${near}H\tT${E}[8;${childCols + 20}HCUP${E}[${childRows + 10};${childCols + 15}HCLAMP${E}[9;1H${E}[${childCols + 25}GCHA`,
      `${E}[1;1H${E}[44m${E}[1;10H${E}[K${E}[2;15H${E}[1K${E}[3;5H${E}[2K${E}[4;${childCols - 4}H${E}[30X${E}[0m`,
      `${E}[5;1H${"0123456789".repeat(13).slice(0, childCols)}${E}[5;3H${E}[5@${E}[5;3H${E}[5P`,
      `${E}[6;${childCols - 3}HR${E}[15b`,
      `${E}[2;12r${E}[3;1HLINE_A${E}[2L${E}[1M${E}[2S${E}[1T${E}[r`,
      `${E}[4;10H${E}[J${E}[2;5H${E}[1J${E}[2J${E}[!p${E}[1;1HAFTER_DECSTR`,
      `${E}[?1049h${E}[1;1H${"M".repeat(childCols + 12)}${E}[3;1H${E}[2KALT_OK${E}[?1049l${E}[2;1HBACK_NORMAL`,
    ];
    const replayed = 5;
    const h = new Harness({ brokerProtected: true, statusBar: realBar });
    const tracker = h.fleet.session("h2a-tracker");
    for (const batch of corpus.slice(0, replayed)) tracker.emit(batch);
    const checkpoints: Array<{ label: string; mark: number; chunks: number }> = [];
    const checkpoint = (label: string): void => {
      checkpoints.push({ label, mark: h.stdout.mark(), chunks: tracker.chunks.length });
    };
    h.step((x) => x.activate("h2a-tracker"));
    h.step(() => checkpoint("catch-up"));
    corpus.slice(replayed).forEach((batch, index) => {
      h.step(() => tracker.emit(batch), () => checkpoint(`live-${replayed + index + 1}`));
    });
    await h.run();
    expect(checkpoints).toHaveLength(1 + corpus.length - replayed);

    let baseline: string[] | undefined;
    for (const point of checkpoints) {
      const outer = await outerAfter(h.stdout.chunks.slice(0, point.mark).join(""));
      const reference = await outerAfter(
        tracker.chunks.slice(0, point.chunks).map((chunk) => chunk.data).join(""),
        childCols,
        childRows,
      );
      // (ii) child cells equal the child-sized model.
      expect(outer.buffer.active.type, point.label).toBe(reference.buffer.active.type);
      expect(screenSignature(outer, 0, childCols), `${point.label}: child area`).toEqual(
        screenSignature(reference),
      );
      expect(outer.buffer.active.cursorX, `${point.label}: cursor stays in the child area`).toBeLessThan(childCols);
      // (i) reserved cells equal the panel render: stable across every batch.
      const reserved = screenSignature(outer, childCols, 160);
      baseline ??= reserved;
      expect(reserved, `${point.label}: reserved area`).toEqual(baseline);
      outer.dispose();
      reference.dispose();
    }
    // The reserved area really is the panel, not blank cells.
    const final = await outerAfter(h.stdout.chunks.slice(0, checkpoints.at(-1)!.mark).join(""));
    let header = "";
    for (let x = childCols; x < 160; x += 1) header += final.buffer.active.getLine(0)?.getCell(x)?.getChars() || " ";
    expect(header).toContain("[core] docs lab other");
    final.dispose();
  });
});

describe("Step 5 — synthetic focus and mouse release, receipt before mode", () => {
  it.each([
    ["SGR", `${E}[?1000h${E}[?1006h`, `${E}[<0;10;5M`, `${E}[<0;10;5m`],
    ["urxvt", `${E}[?1000h${E}[?1015h`, `${E}[32;10;5M`, `${E}[35;10;5M`],
    ["X10 default", `${E}[?1000h`, `${E}[M${String.fromCharCode(32, 42, 37)}`, `${E}[M${String.fromCharCode(35, 42, 37)}`],
  ])("should release a held press in its %s encoding, then send focus-out, before leaving A", async (_label, modes, press, release) => {
    const h = new Harness({ brokerProtected: true });
    const api = h.fleet.session("h2a-api");
    const tracker = h.fleet.session("h2a-tracker");
    api.emit(`${modes}${E}[?1004h`);
    tracker.emit(`${E}[?1004h`);
    h.step(
      (x) => {
        // A press in the CLI zone is forwarded to A; its release never comes.
        x.stdin.type(`${E}[<0;10;5M`);
      },
      (x) => {
        // t6 of the first display already told A that the terminal has the focus.
        expect(api.writes.join("")).toBe(`${E}[I${press}`);
        x.activate("h2a-tracker");
      },
      (x) => {
        // Same button, same coordinates, the encoding the press went out in.
        expect(api.writes.join("")).toBe(`${E}[I${press}${release}${E}[O`);
        // B asked for focus reporting and the terminal focus is not known lost.
        expect(tracker.writes.join("")).toBe(`${E}[I`);
        x.activate("h2a-api");
      },
      (x) => {
        expect(tracker.writes.join("")).toBe(`${E}[I${E}[O`);
        // No press is held any more: only focus-in on the way back.
        expect(api.writes.join("")).toBe(`${E}[I${press}${release}${E}[O${E}[I`);
      },
    );
    await h.run();
  });

  it("should send no synthetic focus-in while the outer terminal reported focus lost", async () => {
    const h = new Harness({ brokerProtected: true });
    const tracker = h.fleet.session("h2a-tracker");
    h.fleet.session("h2a-api").emit(`${E}[?1004h`);
    tracker.emit(`${E}[?1004h`);
    h.step(
      // The window lost the focus: the terminal says so (mode 1004 of A).
      (x) => x.stdin.type(`${E}[O`),
      (x) => x.activate("h2a-tracker"),
      (x) => expect(tracker.writes.join("")).toBe(""),
    );
    await h.run();
    // A: focus-in at its first display, the terminal's own focus-out (plain
    // input, forwarded), then the synthetic focus-out of the switch.
    expect(h.fleet.session("h2a-api").writes.join("")).toBe(`${E}[I${E}[O${E}[O`);
  });

  it("should publish the undo receipt before every h2a or child mode goes on", async () => {
    const h = modeFixture();
    h.step((x) => x.activate("h2a-tracker"), (x) => x.activate("h2a-api"), tick);
    await h.run();
    const timeline = h.stdout.timeline;
    const lastReceiptBefore = (index: number): string => {
      for (let i = index - 1; i >= 0; i -= 1) {
        if (timeline[i]!.kind === "receipt") return timeline[i]!.data;
      }
      return "<none>";
    };
    const activations: Array<[string, string]> = [
      [`${E}[22;0t`, `${E}[23;0t`], // title pushed ⇒ pop published first
      [`${E}[?1000h`, `${E}[?1000l`], // h2a mouse
      [`${E}[?1049h`, `${E}[?1049l`], // child alternate screen
      [`${E}[?2004h`, `${E}[?2004l`], // child bracketed paste
      [`${E}[?1004h`, `${E}[?1004l`], // child focus reporting
      [`${E}[?25l`, `${E}[?25h`], // child hidden cursor
    ];
    for (const [activation, undo] of activations) {
      const hits = timeline
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.kind === "write" && entry.data.includes(activation));
      expect(hits.length, JSON.stringify(activation)).toBeGreaterThan(0);
      for (const { index } of hits) {
        expect(lastReceiptBefore(index), `receipt before ${JSON.stringify(activation)}`).toContain(undo);
      }
    }
    // While the station runs the receipt always knows the h2a mouse and title.
    const receipts = h.receipts.slice(0, -1);
    expect(receipts.length).toBeGreaterThan(4);
    for (const receipt of receipts) {
      expect(receipt).toContain(`${E}[?1000l`);
      expect(receipt).toContain(`${E}[23;0t`);
    }
    // A clean close leaves nothing to undo.
    expect(h.receipts.at(-1)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Step 8 — the thirteen exit branches of runAttach (r2 M5) and reconnection
// ---------------------------------------------------------------------------

describe("Step 8 — no exit branch closes the station, except the three wanted ones", () => {
  it("should close on the end of stdin and release every lease", async () => {
    const h = new Harness();
    h.autoDetach = false;
    h.step((x) => x.activate("h2a-tracker"), (x) => x.stdin.emit("end"));
    const code = await h.run();
    expect(code).toBe(0);
    expect(h.of("closed")).toEqual([{ type: "closed", reason: "stdin-end" }]);
    // The active lease and the compatibility guard both went with the station.
    expect(h.heldByStation()).toEqual([]);
    expect(h.fleet.all().every((session) => session.status === "running")).toBe(true);
  });

  it("should close on a termination signal with every lease released and the terminal undone", async () => {
    const h = modeFixture({ brokerProtected: false });
    h.autoDetach = false;
    let mark = -1;
    h.step(
      (x) => x.activate("h2a-tracker"),
      (x) => {
        mark = x.stdout.mark();
        x.terminateListener?.();
      },
    );
    const code = await h.run();
    expect(code).toBe(0);
    expect(h.of("closed")).toEqual([{ type: "closed", reason: "terminate" }]);
    expect(h.heldByStation()).toEqual([]);
    const undo = h.stdout.since(mark);
    // Child modes of the displayed session, the h2a mouse and the title are undone.
    expect(undo).toContain(`${E}[?2004l`);
    expect(undo).toContain(`${E}[?1000l`);
    expect(undo).toContain(`${E}[23;0t`);
  });

  it("should turn a takeover of the displayed session into a card and stay alive", async () => {
    const h = new Harness();
    const api = h.fleet.session("h2a-api");
    const tracker = h.fleet.session("h2a-tracker");
    h.step(
      (x) => {
        // Another terminal takes the displayed session by force.
        api.controlElsewhere({ pid: 777, tty: "/dev/pts/3" });
        x.stdin.type("lost");
      },
      tick,
      (x) => {
        expect(x.of("card").map((e) => [e.kind, e.text])).toEqual([
          ["controlled-elsewhere", "api: controlled by pid 777 tty /dev/pts/3 since 2026-11-21T08:00:00.000Z"],
        ]);
        expect(plain(x.stdout.text())).toContain("[h2a] api: controlled by pid 777 tty /dev/pts/3");
        expect(plain(x.stdout.text())).toContain("[h2a] F12: panel · choose a session");
        // The lease is not taken back without a confirmation.
        expect(api.controllerId).toBe("elsewhere-2");
        expect(x.row("h2a-api")).toMatchObject({ controlledElsewhere: true });
        // The station is alive: another session can be displayed.
        x.activate("h2a-tracker");
      },
      (x) => {
        expect(x.displayed()).toEqual(["h2a-api", "h2a-tracker"]);
        x.stdin.type("alive");
      },
      tick,
    );
    await h.run();
    expect(api.writes).toEqual([]);
    expect(tracker.writes.join("")).toBe("alive");
    expect(api.acquireRequests).toBe(1);
    expect(h.of("closed")).toEqual([{ type: "closed", reason: "detach" }]);
  });

  it("should take the session back only through an activation and its confirmation", async () => {
    const h = new Harness();
    const api = h.fleet.session("h2a-api");
    h.step(
      () => void api.controlElsewhere({ pid: 777, tty: "/dev/pts/3" }),
      tick,
      (x) => x.activate("h2a-api"),
      (x) => {
        expect(x.of("switch-refused").map((e) => e.reason)).toEqual(["controlled-elsewhere"]);
        x.stdin.type("\r");
      },
      (x) => x.stdin.type("back"),
      tick,
    );
    await h.run();
    expect(h.displayed()).toEqual(["h2a-api", "h2a-api"]);
    expect(h.fleet.host("/fake/host-1.sock").log).toContain("acquire:h2a-api:takeover");
    expect(api.writes.join("")).toBe("back");
  });

  it.each([
    ["exits while followed", (s: FakeSession) => s.end(7), "ended", "api: session ended (exit code 7)"],
    [
      "is proven absent on read",
      (s: FakeSession) => void s.host.sessions.delete(s.id),
      "disappeared",
      "api: session disappeared",
    ],
  ] as const)("should show a card when the displayed session %s", async (_label, arrange, kind, text) => {
    const h = new Harness();
    const api = h.fleet.session("h2a-api");
    const tracker = h.fleet.session("h2a-tracker");
    h.step(
      () => arrange(api),
      tick,
      (x) => {
        expect(x.of("card").map((e) => [e.kind, e.text])).toEqual([[kind, text]]);
        x.stdin.type("into-the-void");
        x.activate("h2a-tracker");
      },
      (x) => x.stdin.type("next"),
      tick,
    );
    const code = await h.run();
    expect(code).toBe(0);
    expect(h.displayed()).toEqual(["h2a-api", "h2a-tracker"]);
    expect(tracker.writes.join("")).toBe("next");
    // Typed with no session to receive it: dropped, never delivered elsewhere.
    expect(h.of("input-dropped").some((e) => e.reason === "no-session")).toBe(true);
    expect(h.fleet.all().flatMap((s) => s.writes).join("")).toBe("next");
  });

  it("should show a card when a write finds the lease stale", async () => {
    const h = new Harness();
    const api = h.fleet.session("h2a-api");
    h.fleet.host("/fake/host-1.sock").hooks.beforeWrite = (session) => {
      // The takeover lands between the keystroke and its delivery.
      if (session.id === "h2a-api" && session.controllerId === h.stationController) {
        session.controlElsewhere({ pid: 888, tty: "/dev/pts/5" });
      }
    };
    h.step((x) => x.stdin.type("x"), tick, tick);
    await h.run();
    expect(h.of("card").map((e) => e.kind)).toEqual(["controlled-elsewhere"]);
    expect(api.writes).toEqual([]);
    expect(h.of("closed")).toEqual([{ type: "closed", reason: "detach" }]);
  });

  it("should reconnect after a host restart and take its leases again without force", async () => {
    const h = new Harness();
    const host = h.fleet.host("/fake/host-1.sock");
    const api = h.fleet.session("h2a-api");
    const tracker = h.fleet.session("h2a-tracker");
    h.step(
      (x) => x.activate("h2a-tracker"),
      (x) => {
        expect(x.heldByStation()).toEqual(["h2a-api", "h2a-tracker"]);
        host.restart("gen-restarted");
        expect(x.heldByStation()).toEqual([]);
      },
      tick,
      tick,
      (x) => {
        expect(x.of("reconnected").map((e) => e.sessionId)).toEqual(["h2a-tracker"]);
        // Active lease and compatibility guard are back, on the new generation.
        expect(x.heldByStation()).toEqual(["h2a-api", "h2a-tracker"]);
        expect(x.row("h2a-api").compatGuard).toBe(true);
        x.stdin.type("after-restart");
      },
      tick,
    );
    await h.run();
    expect(tracker.writes.join("")).toBe("after-restart");
    expect(api.writes).toEqual([]);
    expect(host.log.filter((entry) => entry.includes("takeover"))).toEqual([]);
    expect(h.of("guard").map((e) => [e.action, e.sessionId])).toEqual([
      ["kept", "h2a-api"],
      ["reacquired", "h2a-api"],
    ]);
    expect(h.persisted().state.compatGuards).toEqual({
      "h2a-api": { generation: "gen-restarted", incarnation: "inc-1" },
    });
    expect(h.displayed()).toEqual(["h2a-api", "h2a-tracker"]);
  });

  it.each([
    ["ended during the reconnection", (s: FakeSession) => s.end(9), "ended", "api: session ended (exit code 9)"],
    [
      "controlled elsewhere at the reconnection",
      (s: FakeSession) => void s.controlElsewhere({ pid: 999, tty: "/dev/pts/8" }),
      "controlled-elsewhere",
      "api: controlled by pid 999 tty /dev/pts/8 since 2026-11-21T08:00:00.000Z",
    ],
    [
      "proven absent during the reconnection",
      (s: FakeSession) => void s.host.sessions.delete(s.id),
      "disappeared",
      "api: session disappeared",
    ],
  ] as const)("should show a card when the session is %s", async (_label, arrange, kind, text) => {
    const h = new Harness();
    const host = h.fleet.host("/fake/host-1.sock");
    const api = h.fleet.session("h2a-api");
    h.step(
      () => {
        host.restart("gen-restarted");
        arrange(api);
      },
      tick,
      tick,
      tick,
      (x) => {
        expect(x.of("card").map((e) => [e.kind, e.text])).toEqual([[kind, text]]);
        expect(x.of("reconnected")).toEqual([]);
        x.activate("h2a-tracker");
      },
      tick,
    );
    const code = await h.run();
    expect(code).toBe(0);
    expect(h.displayed()).toEqual(["h2a-api", "h2a-tracker"]);
    expect(host.log.filter((entry) => entry.includes("takeover"))).toEqual([]);
  });

  it("should purge a saturated input queue with a notice and reopen the input after reconnection", async () => {
    const h = new Harness();
    const host = h.fleet.host("/fake/host-1.sock");
    const api = h.fleet.session("h2a-api");
    const flood = "f".repeat(40 * 1024);
    h.step(
      () => {
        host.down = true;
        host.restart("gen-restarted");
      },
      tick,
      (x) => {
        // Typed while the session is unreachable: queued, then over the bound.
        x.stdin.type(flood);
        x.stdin.type(flood);
        x.stdin.type("dropped-while-closed");
      },
      (x) => {
        expect(x.of("input-purged")).toEqual([
          { type: "input-purged", bytes: 2 * flood.length, reason: "queue-full" },
        ]);
        expect(x.of("notice").map((e) => e.key)).toContain("station.notice.inputPurged");
        expect(x.of("closed")).toEqual([]);
        host.down = false;
      },
      tick,
      tick,
      tick,
      (x) => {
        expect(x.of("reconnected").map((e) => e.sessionId)).toEqual(["h2a-api"]);
        x.stdin.type("reopened");
      },
      tick,
    );
    const code = await h.run();
    expect(code).toBe(0);
    // Nothing of the flood was delivered late; the input works again.
    expect(api.writes.join("")).toBe("reopened");
    expect(h.of("input-dropped").some((e) => e.reason === "closed")).toBe(true);
    expect(h.displayed()).toEqual(["h2a-api"]);
  });

  it("should leave the geometry and the lease of the other sessions untouched by a card", async () => {
    const h = new Harness();
    const api = h.fleet.session("h2a-api");
    const tracker = h.fleet.session("h2a-tracker");
    let guardEpoch = -1;
    h.step(
      (x) => x.activate("h2a-tracker"),
      () => {
        guardEpoch = api.controllerEpoch;
        tracker.end(1);
      },
      tick,
      tick,
      (x) => {
        expect(x.of("card").map((e) => e.kind)).toEqual(["ended"]);
        // The guard on A is the same lease; A was not resized nor written to.
        expect(api.controllerEpoch).toBe(guardEpoch);
        expect(api.controllerId).toBe(x.stationController);
        expect(api.resizes).toHaveLength(1);
        expect(api.writes).toEqual([]);
      },
    );
    await h.run();
  });
});

// ---------------------------------------------------------------------------
// Step 6 — S1.7b / D-A14–15: a wake on the session left, with INJ doubles
// ---------------------------------------------------------------------------

const MULTILINE_DRAFT = "first line\n\tindented  \nlast, unfinished";

describe("Step 6 — automatic message on the session that was left (INJ doubles)", () => {
  it("should let a qualified composer accept the wake once and keep the draft exact (mixed fleet)", async () => {
    const h = new Harness({ brokerProtected: true });
    const broker = h.broker();
    // Mixed test registry: A (api) has the test adapter, B (tracker) has none.
    broker.adapters.set("h2a-api", "qualified");
    const api = h.fleet.session("h2a-api");
    const tracker = h.fleet.session("h2a-tracker");
    let outcomes: string[] = [];
    h.step(
      (x) => x.stdin.type(MULTILINE_DRAFT),
      (x) => x.activate("h2a-tracker"),
      (x) => {
        // A is released on this host: a wake right now is deferred, not refused.
        expect(api.controllerId).toBeNull();
        outcomes.push(broker.deposit("h2a-api", "wake: continue"));
        x.now += 5_000;
      },
      () => {
        outcomes.push(broker.deposit("h2a-api", "wake: continue"));
        // The neighbour without adapter keeps its deposit, visibly refused.
        outcomes.push(broker.deposit("h2a-tracker", "wake: tracker"));
      },
      tick,
      tick,
      (x) => {
        expect(x.row("h2a-tracker").extraRows).toContainEqual({ id: "refusal", text: "refused-no-draft-adapter" });
        expect(x.row("h2a-tracker").draftCapability).toBe("refused-no-draft-adapter");
        expect(x.stateRows("h2a-api")).toEqual([]);
        x.activate("h2a-api");
      },
      (x) => x.stdin.type(" + more"),
      tick,
    );
    await h.run();

    expect(outcomes).toEqual(["deferred-recent-human", "submitted", "refused-no-draft-adapter"]);
    // Accepted exactly once; D0 is back, byte for byte, multi-line included.
    expect(broker.accepted).toEqual([{ sessionId: "h2a-api", text: "wake: continue" }]);
    expect(broker.composer.get("h2a-api")).toBe(`${MULTILINE_DRAFT} + more`);
    // Zero automatic byte on any PTY; B received nothing at all.
    expect(broker.automaticPtyBytes).toEqual([]);
    expect(tracker.writes).toEqual([]);
    expect(api.writes.join("")).toBe(`${MULTILINE_DRAFT} + more`);
    expect(h.displayed()).toEqual(["h2a-api", "h2a-tracker", "h2a-api"]);
    expect(h.of("guard")).toEqual([]);
  });

  it("should keep every line usable with a visible refusal at 0/5 on a new host", async () => {
    const h = new Harness({ brokerProtected: true });
    const broker = h.broker();
    const api = h.fleet.session("h2a-api");
    h.step(
      (x) => x.stdin.type("draft"),
      (x) => x.activate("h2a-tracker"),
      (x) => {
        x.now += 5_000;
        expect(broker.deposit("h2a-api", "wake")).toBe("refused-no-draft-adapter");
      },
      tick,
      tick,
      (x) => {
        // A is not held by anyone: the refusal comes from the host, not a lease.
        expect(api.controllerId).toBeNull();
        expect(x.row("h2a-api")).toMatchObject({
          compatGuard: false,
          draftCapability: "refused-no-draft-adapter",
        });
        expect(x.row("h2a-api").extraRows).toContainEqual({ id: "refusal", text: "refused-no-draft-adapter" });
        x.activate("h2a-api");
      },
      (x) => x.stdin.type("-still-mine"),
      tick,
    );
    await h.run();
    // The deposit is kept, nothing was submitted, nothing was written for it.
    expect(broker.deposits).toEqual([{ sessionId: "h2a-api", text: "wake", outcome: "refused-no-draft-adapter" }]);
    expect(broker.accepted).toEqual([]);
    expect(broker.automaticPtyBytes).toEqual([]);
    expect(api.writes.join("")).toBe("draft-still-mine");
    expect(h.displayed()).toEqual(["h2a-api", "h2a-tracker", "h2a-api"]);
  });

  it("should defer the legacy automation under a compatibility guard and drive after a confirmed release (old host)", async () => {
    const h = new Harness();
    const api = h.fleet.session("h2a-api");
    const drive = async (): Promise<string> => {
      // What the base `op drive` does: the 4 s human-activity lease, then text + CR.
      const client = h.fleet.host("/fake/host-1.sock").connect();
      try {
        const lease = await client.acquireAutomationControllerIfNoRecentHuman("h2a-api", "drive", 4_000);
        await client.write(lease, "automatic line\r");
        await client.releaseController(lease);
        return "driven";
      } catch {
        return "deferred";
      } finally {
        client.close();
      }
    };
    const results: string[] = [];
    h.autoDetach = false;
    h.step(
      (x) => x.stdin.type("partial draft"),
      (x) => x.activate("h2a-tracker"),
      (x) => {
        x.now += 5_000;
        expect(x.row("h2a-api")).toMatchObject({ compatGuard: true, draftCapability: "refused-no-capability" });
        void drive().then((result) => results.push(result));
      },
      tick,
      (x) => {
        expect(results).toEqual(["deferred"]);
        expect(api.writes.join("")).toBe("partial draft");
        // The confirmed "release" gesture: row, Enter, then Enter on the card.
        x.gesture("h2a-api", "guard-release");
      },
      (x) => {
        expect(plain(x.stdout.text())).toContain("Release api? A draft left there may then");
        expect(api.controllerId).toBe(x.stationController);
        x.stdin.type("\r");
      },
      tick,
      (x) => {
        expect(api.controllerId).toBeNull();
        expect(x.row("h2a-api").compatGuard).toBe(false);
        x.now += 5_000;
        void drive().then((result) => results.push(result));
      },
      tick,
      (x) => x.stdin.type(DETACH),
    );
    await h.run();
    expect(results).toEqual(["deferred", "driven"]);
    expect(api.writes.join("")).toBe("partial draftautomatic line\r");
    expect(h.of("gesture")).toEqual([
      { type: "gesture", gesture: "guard-release", sessionId: "h2a-api", outcome: "released" },
    ]);
    expect(h.persisted().state.compatGuards).toEqual({});
  });

  it("should keep a session taken by force guarded, and offer to guard a session never displayed (old host)", async () => {
    const h = new Harness();
    const tracker = h.fleet.session("h2a-tracker");
    const conductor = h.fleet.session("h2a-conductor");
    h.step(
      (x) => {
        tracker.controlElsewhere({ pid: 4321, tty: "/dev/pts/7" });
        x.activate("h2a-tracker");
      },
      (x) => x.stdin.type("\r"),
      (x) => x.activate("h2a-api"),
      (x) => {
        // Taken by force, then left: it stays under the station's guard.
        expect(tracker.controllerId).toBe(x.stationController);
        expect(x.row("h2a-tracker").compatGuard).toBe(true);
        // A session never displayed can be guarded by a confirmed gesture.
        x.gesture("h2a-conductor", "guard-keep");
      },
      (x) => x.stdin.type("\r"),
      tick,
      (x) => {
        expect(conductor.controllerId).toBe(x.stationController);
        expect(x.row("h2a-conductor").compatGuard).toBe(true);
        // Guarded, never displayed: no byte and no resize ever reached it.
        expect(conductor.writes).toEqual([]);
        expect(conductor.resizes).toEqual([]);
      },
    );
    await h.run();
    expect(Object.keys(h.persisted().state.compatGuards).sort()).toEqual(["h2a-conductor", "h2a-tracker"]);
  });
});

// ---------------------------------------------------------------------------
// Step 7 — D-A05/A10/A13/A16/A17 recovery states and view, D-A18 manual pin
// ---------------------------------------------------------------------------

const HOSTILE_DRAFT = "line one  \r\n\x1b[2J\x1b]0;pwned\x07<b>html</b>\tend\n";

function keptDraft(overrides: Partial<DraftRecoveryRecord> = {}): DraftRecoveryRecord {
  return {
    sessionId: "h2a-api",
    applicationIncarnation: "app-1",
    requestId: "req-7",
    submission: "submitted",
    draft: "saved-for-recovery",
    byteLength: Buffer.byteLength(HOSTILE_DRAFT),
    ...overrides,
  };
}

function seedDraft(broker: FakeBroker, record: DraftRecoveryRecord, status: Partial<StationSessionDraftStatus> = {}): void {
  broker.status.set(record.sessionId, { submission: record.submission, drafts: [record], ...status });
  broker.vault.set(FakeBroker.key(record), Buffer.from(HOSTILE_DRAFT, "utf8"));
}

describe("Step 7 — recovery states, inert view and confirmed gestures (INJ doubles)", () => {
  it("should list per session the restitution state, the submission outcome and the dropped-on-app-exit count", async () => {
    const h = new Harness({ brokerProtected: true });
    const broker = h.broker();
    seedDraft(broker, keptDraft());
    broker.status.set("h2a-tracker", {
      submission: "uncertain",
      droppedOnAppExit: 3,
      drafts: [keptDraft({ sessionId: "h2a-tracker", requestId: "req-9", submission: "uncertain", draft: "restoring-on-ready" })],
    });
    h.step(tick, tick);
    await h.run();
    expect(h.row("h2a-api")).toMatchObject({ draftRecovery: "saved-for-recovery" });
    expect(h.row("h2a-api").extraRows).toContainEqual({
      id: "draft:app-1:req-7",
      text: "Draft kept — restitution to resume",
      activatable: true,
    });
    expect(h.row("h2a-tracker")).toMatchObject({ draftRecovery: "restoring-on-ready" });
    expect(h.stateRows("h2a-tracker")).toEqual([
      { id: "submission", text: "submission: uncertain" },
      { id: "dropped", text: "3 dropped-on-app-exit" },
      { id: "draft:app-1:req-9", text: "restoring-on-ready", activatable: true },
    ]);
    expect(plain(h.stdout.text())).toContain("3 dropped-on-app-exit");
    expect(plain(h.stdout.text())).toContain("Draft kept — restitution to");
  });

  it("should show the complete draft inert, export the exact bytes and stay navigable", async () => {
    const h = new Harness({ brokerProtected: true });
    const broker = h.broker();
    seedDraft(broker, keptDraft({ retainedKeystrokes: 2 }));
    h.step(
      tick,
      (x) => x.gesture("h2a-api", "draft:app-1:req-7"),
      tick,
      (x) => {
        const text = plain(x.stdout.text());
        expect(text).toContain("Draft kept — restitution to");
        expect(text).toContain("message: submitted");
        expect(text).toContain("draft: saved-for-recovery");
        expect(text).toContain(`${Buffer.byteLength(HOSTILE_DRAFT)} bytes`);
        expect(text).toContain("2 keystrokes retained after");
        // The draft is painted as text: its CSI and OSC are visible, not executed.
        expect(text).toContain("␛[2J␛]0;pwned␇<b>html</b>␉end");
        // Export is selected first: Enter writes the raw bytes.
        x.stdin.type("\r");
      },
      tick,
      // Navigation stays possible: close the view and switch.
      (x) => x.stdin.type("\x1b"),
      (x) => x.activate("h2a-tracker"),
      tick,
    );
    await h.run();
    const exported = h.of("gesture").find((event) => event.gesture === "draft-export");
    expect(exported?.outcome).toMatch(/draft-exports\/h2a-api-req-7-\d+\.bin$/);
    const bytes = readFileSync(exported!.outcome);
    expect(Buffer.compare(bytes, Buffer.from(HOSTILE_DRAFT, "utf8"))).toBe(0);
    expect(statSync(exported!.outcome).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(exported!.outcome)).mode & 0o777).toBe(0o700);
    expect(readdirSync(dirname(exported!.outcome))).toHaveLength(1);
    expect(h.displayed()).toEqual(["h2a-api", "h2a-tracker"]);
    // The draft never became a title, a clear screen or a session input.
    expect(h.stdout.text()).not.toContain("\x1b]0;pwned");
    expect(h.fleet.all().flatMap((session) => session.writes)).toEqual([]);
  });

  it("should replace and delete only after a confirmation, and show a host refusal", async () => {
    const h = new Harness({ brokerProtected: true });
    const broker = h.broker();
    const record = keptDraft();
    seedDraft(broker, record);
    broker.deleteOutcome = () => ({ ok: false, reason: "refused-transaction-not-settled" });
    broker.replaceOutcome = () => {
      // A proven restitution purges the content at the host.
      broker.vault.delete(FakeBroker.key(record));
      broker.status.set("h2a-api", { submission: "submitted", drafts: [{ ...record, draft: "restored" }] });
      return { ok: true };
    };
    h.step(
      tick,
      (x) => x.gesture("h2a-api", "draft:app-1:req-7"),
      tick,
      (x) => {
        // Delete: Tab twice, Enter asks, Esc withdraws — nothing was called.
        x.stdin.type("\t");
        x.stdin.type("\t");
        x.stdin.type("\r");
      },
      (x) => {
        expect(plain(x.stdout.text())).toContain("Enter: confirm · Esc: cancel");
        expect(broker.deleteCalls).toEqual([]);
        x.stdin.type("\r");
      },
      tick,
      (x) => {
        expect(broker.deleteCalls).toHaveLength(1);
        expect(plain(x.stdout.text())).toContain("refused-transaction-not-settled");
        // Replace: Shift+Tab back to it, Enter, Enter.
        x.stdin.type("\x1b[Z");
        x.stdin.type("\r");
        x.stdin.type("\r");
      },
      tick,
      tick,
      (x) => {
        expect(broker.replaceCalls).toEqual([{ sessionId: "h2a-api", applicationIncarnation: "app-1", requestId: "req-7" }]);
        const text = plain(x.stdout.text());
        expect(text).toContain("draft: restored");
        expect(text).toContain("content purged after proven");
        expect(x.row("h2a-api").draftRecovery).toBe("none");
      },
    );
    await h.run();
    expect(h.of("gesture").map((event) => [event.gesture, event.outcome])).toEqual([
      ["draft-delete", "refused-transaction-not-settled"],
      ["draft-replace", "done"],
    ]);
  });

  it("should find the same recovery state after the station is closed and reopened (D-A16)", async () => {
    const first = new Harness({ brokerProtected: true });
    seedDraft(first.broker(), keptDraft({ submission: "uncertain" }));
    first.step(tick);
    await first.run();
    // A second station over the same hosts: the host is the authority.
    const second = new Harness({ brokerProtected: true });
    seedDraft(second.broker(), keptDraft({ submission: "uncertain" }));
    second.step(tick);
    await second.run();
    for (const h of [first, second]) {
      expect(h.row("h2a-api")).toMatchObject({ draftRecovery: "saved-for-recovery" });
      expect(h.row("h2a-api").extraRows).toContainEqual({ id: "submission", text: "submission: uncertain" });
    }
    // Uncertain: the station itself never asked for a new submission.
    expect(second.broker().accepted).toEqual([]);
    expect(second.broker().replaceCalls).toEqual([]);
  });
});

describe("Step 7 — D-A18 manual pin through set-manual-pin (INJ double)", () => {
  it("should set and remove the pin after a confirmation and display the value read from the host", async () => {
    const h = new Harness({ brokerProtected: true });
    const broker = h.broker();
    const tracker = h.fleet.session("h2a-tracker");
    h.step(
      tick,
      (x) => x.gesture("h2a-tracker", "pin-set"),
      (x) => {
        expect(plain(x.stdout.text())).toContain("Set manual-only on tracker?");
        // Nothing is sent before the confirmation.
        expect(broker.pinCalls).toEqual([]);
        x.stdin.type("\r");
      },
      tick,
      tick,
      (x) => {
        expect(broker.pinCalls).toEqual([{ sessionId: "h2a-tracker", incarnation: "inc-1", manualPin: true }]);
        expect(tracker.manualPin).toBe(true);
        expect(x.row("h2a-tracker").extraBadges).toEqual(["manual-only"]);
        // A pinned session refuses the automatic message, even after a switch.
        expect(broker.deposit("h2a-tracker", "wake")).toBe("refused-manual-pin");
        x.activate("h2a-tracker");
      },
      tick,
      tick,
      (x) => {
        expect(x.row("h2a-tracker").extraRows).toContainEqual({ id: "refusal", text: "refused-manual-pin" });
        x.gesture("h2a-tracker", "pin-remove");
      },
      (x) => x.stdin.type("\r"),
      tick,
      tick,
      (x) => {
        expect(tracker.manualPin).toBe(false);
        expect(x.row("h2a-tracker").extraBadges).toBeUndefined();
      },
    );
    await h.run();
    expect(h.of("gesture").map((event) => [event.gesture, event.outcome])).toEqual([
      ["pin-set", "acknowledged"],
      ["pin-remove", "acknowledged"],
    ]);
    expect(broker.pinCalls.map((call) => call.manualPin)).toEqual([true, false]);
  });

  it("should show to a second station, then to a reopened one, the value the host holds", async () => {
    const one = new Harness({ brokerProtected: true });
    one.fleet.session("h2a-tracker").manualPin = true;
    one.step(tick);
    await one.run();
    expect(one.row("h2a-tracker").extraBadges).toEqual(["manual-only"]);
    // The station state never stores the pin.
    expect(JSON.stringify(one.persisted().state)).not.toContain("manual");
    const reopened = new Harness({ brokerProtected: true });
    reopened.fleet.session("h2a-tracker").manualPin = true;
    reopened.step(tick);
    await reopened.run();
    expect(reopened.row("h2a-tracker").extraBadges).toEqual(["manual-only"]);
    expect(reopened.row("h2a-api").extraBadges).toBeUndefined();
  });

  it("should display the refusal of a stale incarnation and leave the pin unchanged", async () => {
    const h = new Harness({ brokerProtected: true });
    const tracker = h.fleet.session("h2a-tracker");
    h.step(
      tick,
      (x) => x.gesture("h2a-tracker", "pin-set"),
      (x) => {
        // The PTY was replaced between the gesture and its confirmation.
        tracker.incarnation = "inc-2";
        x.stdin.type("\r");
      },
      tick,
      tick,
    );
    await h.run();
    expect(h.of("gesture")).toEqual([
      { type: "gesture", gesture: "pin-set", sessionId: "h2a-tracker", outcome: "stale terminal session incarnation" },
    ]);
    expect(tracker.manualPin).toBeUndefined();
    expect(plain(h.stdout.text())).toContain("tracker: stale terminal session");
  });

  it("should offer no pin gesture on a host without the capability", async () => {
    const h = new Harness();
    h.step(tick, (x) => x.selectRow("h2a-tracker"), tick);
    await h.run();
    const rows = (h.row("h2a-tracker").extraRows ?? []).map((row) => row.id);
    // S2: the D1 gesture is replaced by its motif on an unverified row
    // (the fixture carries no resolved conversation); the pin behavior is
    // unchanged — still no pin gesture.
    expect(rows).toEqual(["respawn-unavailable", "guard-keep"]);
    expect(h.row("h2a-tracker").draftCapability).toBe("refused-no-capability");
  });
});

describe("Clean exit — no host connection outlives the station", () => {
  it("should close a host connection that was still being established when the station closed", async () => {
    const h = new Harness();
    const pending: Array<() => void> = [];
    h.step(
      (x) => {
        // The link to the second host is lost; the next refresh re-establishes it…
        x.fleet.host("/fake/host-2.sock").restart("gen-2b");
        x.now += 2_000;
        // …slowly: the connection is still being set up when Ctrl-\ is typed.
        x.connectGate = (socketPath) =>
          socketPath === "/fake/host-2.sock"
            ? new Promise<void>((resolve) => {
                pending.push(resolve);
              })
            : Promise.resolve();
      },
      tick,
      tick,
      (x) => x.stdin.type(DETACH),
    );
    h.autoDetach = false;
    let pendingAtClose = -1;
    h.afterStation = () => {
      // The station returned although connection attempts are still pending…
      pendingAtClose = pending.length;
      for (const release of pending.splice(0)) release();
    };
    // …and those late connections are closed, not kept (run() asserts it).
    await expect(h.run()).resolves.toBe(0);
    expect(pendingAtClose).toBeGreaterThan(0);
  });
});

describe("Inventory — an absent endpoint is proven absent sparingly", () => {
  it("should take the publication-lock proof at most once per 30 s for an absent endpoint", async () => {
    const h = new Harness();
    h.absentEndpoints = ["/fake/absent.sock"];
    const proofs: number[] = [];
    h.proveAbsent = async (socketPath, failure) => {
      expect(socketPath).toBe("/fake/absent.sock");
      expect((failure as NodeJS.ErrnoException).code).toBe("ENOENT");
      proofs.push(h.now);
      return true;
    };
    // Twelve refreshes, two seconds apart: 24 s of station time.
    for (let i = 0; i < 12; i += 1) h.step((x) => void (x.now += 2_000));
    h.step((x) => {
      // The absent endpoint does not degrade the panel: the view is complete.
      expect(x.lastSnapshot().degraded).toBe(false);
      expect(proofs).toHaveLength(1);
      x.now += 31_000;
    });
    h.step(tick, tick);
    await h.run();
    // One more proof once the first one is older than 30 s, never one per refresh.
    expect(proofs).toHaveLength(2);
    expect(proofs[1]! - proofs[0]!).toBeGreaterThanOrEqual(30_000);
    expect(h.displayed()).toEqual(["h2a-api"]);
  });
});

describe("Launch — every session is held by another terminal (restore tabs still open)", () => {
  it("should open on the panel with no card pile-up, take nothing, and switch after one confirmation", async () => {
    const h = new Harness();
    for (const session of h.fleet.all()) session.controlElsewhere({ pid: 600, tty: "/dev/pts/2" });
    const tracker = h.fleet.session("h2a-tracker");
    h.step(
      (x) => {
        // Nothing is displayed, nothing was taken: one acquisition attempt each, no takeover.
        expect(x.displayed()).toEqual([]);
        expect(x.heldByStation()).toEqual([]);
        expect(x.fleet.all().map((session) => session.acquireRequests)).toEqual([1, 1, 1, 1, 1, 1, 1]);
        // The seven refusals of the launch are silent: no card is waiting.
        expect(x.of("card")).toEqual([]);
        expect(x.of("switch-refused")).toHaveLength(7);
        expect(plain(x.stdout.text())).toContain("[h2a] F12: panel · choose a session");
        // The panel has the keyboard: a digit activates without any click.
        x.stdin.type("3");
      },
      (x) => {
        expect(x.of("card").map((e) => e.kind)).toEqual(["controlled-elsewhere"]);
        x.stdin.type("\r");
      },
      (x) => x.stdin.type("mine-now"),
      tick,
    );
    const code = await h.run();
    expect(code).toBe(0);
    expect(h.displayed()).toEqual(["h2a-tracker"]);
    expect(tracker.writes.join("")).toBe("mine-now");
    const takeovers = [...h.fleet.hosts.values()].flatMap((host) => host.log.filter((e) => e.includes("takeover")));
    expect(takeovers).toEqual(["acquire:h2a-tracker:takeover"]);
  });
});

// ---------------------------------------------------------------------------
// S2 — relaunch file, gestures and guards (plan 09-S2)
// ---------------------------------------------------------------------------

/** S2 UUIDs with distinct conversations (dedup is on the sid). */
const S2C1 = "33333333-3333-4333-8333-333333333331";
const S2C2 = "33333333-3333-4333-8333-333333333332";
const S2C3 = "33333333-3333-4333-8333-333333333333";

/** Walk the panel to a restorable row and press Enter on it. */
function walkToRestorableRow(h: Harness, tabTitle: string, key: string): void {
  const snapshot = h.lastSnapshot();
  const tab = snapshot.workspaces.findIndex((w) => w.title === tabTitle);
  if (tab < 0) throw new Error(`no tab ${tabTitle}`);
  h.focusPanel();
  const count = snapshot.workspaces.length;
  for (let i = 0; i < (tab - h.panelTab + count) % count; i += 1) h.stdin.type("\t");
  h.panelTab = tab;
  const ws = snapshot.workspaces[tab]!;
  // From session 0, one step per session plus one per activatable extra row
  // of each visited session (only activatable rows stop the cursor).
  let presses = 0;
  for (const session of ws.sessions) {
    presses += 1 + (session.extraRows ?? []).filter((row) => row.activatable === true).length;
  }
  for (let i = 0; i < presses; i += 1) h.stdin.type("j");
  h.stdin.type("\r");
  const rows = ws.restorable ?? [];
  const rowIndex = rows.findIndex((r) => r.key === key);
  if (rowIndex < 0) throw new Error(`no restorable row ${key}`);
  for (let i = 0; i <= rowIndex; i += 1) h.stdin.type("j");
  h.stdin.type("\r");
}

/** Wait (bounded) for the launch file to settle its calls after the run. */
function waitForExecCalls(h: Harness, count: number): () => Promise<void> {
  return async () => {
    for (let i = 0; i < 500 && h.execCalls.length < count; i += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
}

function restartJson(strategy: "soft" | "hard", id: string): string {
  return JSON.stringify({
    kind: "h2a.restart.result",
    version: 1,
    ok: true,
    scope: "session",
    sessions: [
      {
        id,
        name: id,
        requested: "restart",
        state: "completed",
        gatewayMode: "direct",
        restarted: true,
        strategy,
        ptyPreserved: strategy === "soft",
      },
    ],
  });
}

describe("S2 launch file: detached, one at a time, in plan order, never ahead of input", () => {
  it("should relaunch exactly the launch decisions of the plan, detached, one at a time, in plan order", async () => {
    const h = new Harness({
      sessions: [
        { id: "h2a-live", project: "h2a", label: "live", host: "/fake/host-1.sock", mtime: 1_700_000_100_000 },
      ],
      deadSessions: [
        { id: "h2a-k1", project: "h2a", label: "k1", host: "", mtime: 1_700_000_050_000, convId: S2C1 },
        { id: "h2a-k2", project: "h2a", label: "k2", host: "", mtime: 1_700_000_040_000, convId: S2C2 },
        // Argv not verified: listed, never launched.
        { id: "h2a-k3", project: "h2a", label: "k3", host: "", mtime: 1_700_000_030_000, convId: S2C3, tool: "agy" },
      ],
    });
    // The first relaunch stays in flight until the owner typed: the loop
    // never waits for it, and the second starts only after the keystroke.
    let inFlight = 0;
    let maxInFlight = 0;
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    h.execGate = async () => {
      calls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (calls === 1) await firstHeld;
      } finally {
        inFlight -= 1;
      }
    };
    const live = () => h.fleet.session("h2a-live");
    h.step(
      (x) => {
        // The launch file is already working while the station displays.
        expect(x.displayed()).toEqual(["h2a-live"]);
        expect(x.execCalls).toHaveLength(1);
        x.stdin.type("x");
      },
      (x) => {
        expect(live().writes.join("")).toBe("x");
        releaseFirst();
      },
      tick,
      tick,
      (x) => {
        expect(x.execCalls).toHaveLength(2);
      },
    );
    h.afterStation = waitForExecCalls(h, 2);
    const code = await h.run();

    expect(code).toBe(0);
    // Exactly the launch decisions: tokens, detached, in plan order.
    expect(h.execCalls.map((call) => call.args)).toEqual([
      ["run", "claude", `${h.home}/src/h2a`, "--resume", S2C1, "--name", "k1", "--no-attach"],
      ["run", "claude", `${h.home}/src/h2a`, "--resume", S2C2, "--name", "k2", "--no-attach"],
    ]);
    expect(maxInFlight).toBe(1);
    // queued, started and done in plan order; the agy row never enters the file.
    expect(h.of("relaunch").map((e) => [e.key, e.phase])).toEqual([
      ["registry:h2a-k1", "queued"],
      ["registry:h2a-k2", "queued"],
      ["registry:h2a-k1", "started"],
      ["registry:h2a-k1", "done"],
      ["registry:h2a-k2", "started"],
      ["registry:h2a-k2", "done"],
    ]);
    // The agy row stays listed with the argv motif, never launched.
    const rows = h.lastSnapshot().workspaces.flatMap((w) => w.restorable ?? []);
    expect(rows.find((r) => r.key === "registry:h2a-k3")).toMatchObject({
      reason: "resume-argv-unverified",
    });
    expect(rows.find((r) => r.key === "registry:h2a-k3")?.relaunch).toBeUndefined();
  });

  it("should relaunch nothing at launch with --lazy and list the selected sessions as deferred", async () => {
    const h = new Harness({
      station: { lazy: true },
      sessions: [
        { id: "h2a-live", project: "h2a", label: "live", host: "/fake/host-1.sock", mtime: 1_700_000_100_000 },
      ],
      deadSessions: [
        { id: "h2a-k1", project: "h2a", label: "k1", host: "", mtime: 1_700_000_050_000, convId: S2C1 },
      ],
    });
    const code = await h.run();
    expect(code).toBe(0);
    expect(h.execCalls).toEqual([]);
    expect(h.of("relaunch").map((e) => [e.key, e.phase])).toEqual([["registry:h2a-k1", "queued"]]);
    const rows = h.lastSnapshot().workspaces.flatMap((w) => w.restorable ?? []);
    expect(rows.find((r) => r.key === "registry:h2a-k1")).toMatchObject({ state: "deferred" });
  });

  it("should open on the panel with nothing displayed when only restorable sessions exist", async () => {
    const h = new Harness({
      station: { lazy: true },
      sessions: [],
      deadSessions: [
        { id: "h2a-k1", project: "h2a", label: "k1", host: "", mtime: 1_700_000_050_000, convId: S2C1 },
      ],
    });
    const code = await h.run();
    // With --lazy nothing is displayed before a gesture, and nothing launched.
    expect(code).toBe(0);
    expect(h.displayed()).toEqual([]);
    expect(h.execCalls).toEqual([]);
  });

  it("should open on the tab of the group argument", async () => {
    const h = new Harness({ station: { group: "docs" } });
    const code = await h.run();
    expect(code).toBe(0);
    expect(h.displayed()).toEqual(["h2a-spec"]);
    expect(h.panelTab).toBe(1);
  });

  it("should warn on a group argument that matches no tab and open on the remembered tab", async () => {
    const h = new Harness({ station: { group: "nope" } });
    const code = await h.run();
    expect(code).toBe(0);
    expect(h.displayed()).toEqual(["h2a-api"]);
    expect(h.of("notice").map((e) => e.key)).toContain("station.notice.groupUnknown");
    expect(plain(h.stdout.text())).toContain('group "nope" matches no tab');
  });
});

describe("S2 D1: in-place relaunch of the process in place", () => {
  function opsHarness(facet: "shell" | "cli" | "other" | "unknown", over: {
    convId?: string;
    tool?: string;
    softRespawn?: boolean;
    brokerProtected?: boolean;
    group?: number | null;
  } = {}) {
    const h = new Harness({
      brokerProtected: over.brokerProtected,
      sessions: [
        {
          id: "h2a-ops",
          project: "h2a",
          label: "ops",
          host: "/fake/host-1.sock",
          mtime: 1_700_000_100_000,
          ...(over.convId !== undefined ? { convId: over.convId } : {}),
          ...(over.tool !== undefined ? { tool: over.tool } : {}),
        },
      ],
    });
    const ops = h.fleet.session("h2a-ops");
    ops.facet = facet;
    ops.foregroundProcessGroup = over.group ?? 123;
    if (over.softRespawn !== undefined) h.fleet.host("/fake/host-1.sock").softRespawn = over.softRespawn;
    return { h, ops };
  }

  it("should respawn in place only after the confirmation that names what is terminated, and keep incarnation, lease and scrollback", async () => {
    const { h, ops } = opsHarness("shell", { convId: S2C1, softRespawn: true });
    h.execDefaultOutcome = { ok: true, stdout: restartJson("soft", "h2a-ops") };
    const scrollback = "ops ready\r\n";
    ops.emit(scrollback);
    h.step(
      (x) => {
        expect(x.displayed()).toEqual(["h2a-ops"]);
        x.gesture("h2a-ops", "respawn-in-place");
      },
      (x) => {
        expect(plain(x.stdout.text())).toContain(
          "fallback shell (pid 4242, group 123) and everything it runs are terminated",
        );
        x.stdin.type("\r");
      },
      tick,
      tick,
      (x) => {
        expect(x.execCalls.map((call) => call.args)).toEqual([
          ["restart", "h2a-ops", "--soft", "--json"],
        ]);
      },
      // Same incarnation, same lease while the station holds the session.
      (x) => {
        expect(ops.incarnation).toBe("inc-1");
        expect(ops.controllerId).toBe(x.stationController);
        expect(x.displayed()).toEqual(["h2a-ops"]);
      },
    );
    h.afterStation = waitForExecCalls(h, 1);
    await h.run();

    // No switch, no second acquisition, scrollback kept.
    expect(ops.incarnation).toBe("inc-1");
    expect(h.displayed()).toEqual(["h2a-ops"]);
    expect(ops.acquireRequests).toBe(1);
    expect(plain(h.stdout.text())).toContain("ops ready");
    expect(h.of("gesture")).toContainEqual({
      type: "gesture",
      gesture: "respawn-in-place",
      sessionId: "h2a-ops",
      outcome: "done",
    });
  });

  it("should refuse on a host without soft respawn, then relaunch hard only after a second confirmation", async () => {
    const { h, ops } = opsHarness("unknown", { convId: S2C1 });
    h.execDefaultOutcome = { ok: true, stdout: restartJson("hard", "h2a-ops") };
    h.execGate = async (request) => {
      // The hard relaunch replaces the incarnation before the station re-reads.
      if (request.args.includes("--allow-hard")) ops.incarnation = "inc-2";
    };
    h.step(
      (x) => {
        expect(x.displayed()).toEqual(["h2a-ops"]);
        x.gesture("h2a-ops", "respawn-in-place");
      },
      (x) => {
        // The confirmation names the process in place, foreground unidentified.
        expect(squashed(x.stdout.text())).toContain(
          "The process in place (pid 4242) and everything this terminal runs are terminated; its foreground is not identified.",
        );
        x.stdin.type("\r");
      },
      tick,
      tick,
      (x) => {
        // No soft capability: separate refusal, then a separate hard confirm.
        expect(squashed(x.stdout.text())).toContain("cannot respawn in place");
        x.stdin.type("\r");
      },
      tick, tick, tick,
      (x) => {
        expect(x.execCalls.map((call) => call.args)).toEqual([
          ["restart", "h2a-ops", "--soft", "--allow-hard", "--json"],
        ]);
      },
      // Let the hard relaunch settle and the station switch on the new incarnation.
      tick, tick, tick, tick, tick, tick,
      (x) => {
        // New incarnation: the station switched at its first running
        // observation and holds the fresh lease while it runs.
        expect(ops.incarnation).toBe("inc-2");
        expect(x.displayed()).toEqual(["h2a-ops", "h2a-ops"]);
        expect(ops.acquireRequests).toBe(2);
        expect(x.heldByStation()).toEqual(["h2a-ops"]);
      },
    );
    h.afterStation = waitForExecCalls(h, 1);
    await h.run();

    expect(ops.incarnation).toBe("inc-2");
    expect(h.displayed()).toEqual(["h2a-ops", "h2a-ops"]);
    expect(ops.acquireRequests).toBe(2);
  });

  it("should offer no in-place relaunch while the host reports a live CLI, and a motif for unverified rows", async () => {
    const liveCli = opsHarness("cli", { convId: S2C1, softRespawn: true });
    liveCli.h.step((x) => x.selectRow("h2a-ops"), tick);
    await liveCli.h.run();
    expect(
      (liveCli.h.row("h2a-ops").extraRows ?? []).map((row) => row.id),
    ).not.toContain("respawn-in-place");
    expect(
      (liveCli.h.row("h2a-ops").extraRows ?? []).map((row) => row.id),
    ).not.toContain("respawn-unavailable");

    const noConv = opsHarness("shell", { softRespawn: true });
    noConv.h.step((x) => x.selectRow("h2a-ops"), tick);
    await noConv.h.run();
    expect(noConv.h.row("h2a-ops").extraRows).toContainEqual({
      id: "respawn-unavailable",
      text: "conversation not resolved",
      whenSelected: true,
    });

    const agy = opsHarness("shell", { convId: S2C1, tool: "agy", softRespawn: true });
    agy.h.step((x) => x.selectRow("h2a-ops"), tick);
    await agy.h.run();
    expect(agy.h.row("h2a-ops").extraRows).toContainEqual({
      id: "respawn-unavailable",
      text: "resume argument not verified",
      whenSelected: true,
    });
  });
});

describe("S2 D guards, D2 rows and mixed fleet (plan 09-S2 steps 5-6)", () => {
  it("should wait for the terminal state of a draft in flight for at most 2 000 ms of harness clock, then refuse this relaunch", async () => {
    const restoring = (id: string): StationSessionDraftStatus => ({
      drafts: [
        {
          sessionId: id,
          applicationIncarnation: "app-1",
          requestId: "req-1",
          submission: "pending",
          draft: "restoring-on-ready",
          byteLength: 3,
        },
      ],
    });
    const h = new Harness({
      brokerProtected: true,
      sessions: [
        { id: "h2a-ops", project: "h2a", label: "ops", host: "/fake/host-1.sock", mtime: 1_700_000_100_000, convId: S2C1 },
      ],
    });
    const ops = h.fleet.session("h2a-ops");
    ops.facet = "shell";
    ops.foregroundProcessGroup = 123;
    h.fleet.host("/fake/host-1.sock").softRespawn = true;
    const readAt: number[] = [];
    h.broker().statusFn = (id) => {
      readAt.push(h.now);
      return restoring(id);
    };
    h.autoDetach = false;
    h.step(
      (x) => {
        expect(x.displayed()).toEqual(["h2a-ops"]);
        x.gesture("h2a-ops", "respawn-in-place");
      },
      (x) => x.stdin.type("\r"),
      tick, tick, tick, tick, tick, tick, tick, tick,
      (x) => {
        x.stdin.type(Buffer.from([0x1c]));
      },
    );
    const code = await h.run();
    expect(code).toBe(0);

    // Refused at 2 000 ms of harness clock, not before, zero port calls.
    expect(h.execCalls).toEqual([]);
    expect(h.of("gesture")).toContainEqual({
      type: "gesture",
      gesture: "respawn-in-place",
      sessionId: "h2a-ops",
      outcome: "refused",
    });
    expect(squashed(h.stdout.text())).toContain(
      "ops: relaunch refused, a draft is still being restored (restoring-on-ready)",
    );
    expect(Math.max(...readAt)).toBeGreaterThanOrEqual(3000);
    expect(h.broker().replaceCalls).toEqual([]);
    expect(h.broker().deleteCalls).toEqual([]);
  });

  it("should proceed when the draft reaches a terminal state inside the wait", async () => {
    const h = new Harness({
      brokerProtected: true,
      sessions: [
        { id: "h2a-ops", project: "h2a", label: "ops", host: "/fake/host-1.sock", mtime: 1_700_000_100_000, convId: S2C1 },
      ],
    });
    const ops = h.fleet.session("h2a-ops");
    ops.facet = "shell";
    ops.foregroundProcessGroup = 123;
    h.fleet.host("/fake/host-1.sock").softRespawn = true;
    h.execDefaultOutcome = { ok: true, stdout: restartJson("soft", "h2a-ops") };
    // Terminal from 1 500 ms of harness clock: the wait proceeds, no refusal.
    h.broker().statusFn = (id) =>
      h.now >= 2500
        ? { submission: "submitted" }
        : {
            drafts: [
              {
                sessionId: id,
                applicationIncarnation: "app-1",
                requestId: "req-1",
                submission: "pending",
                draft: "restoring-on-ready",
                byteLength: 3,
              },
            ],
          };
    h.step(
      (x) => {
        expect(x.displayed()).toEqual(["h2a-ops"]);
        x.gesture("h2a-ops", "respawn-in-place");
      },
      (x) => x.stdin.type("\r"),
      tick, tick, tick, tick, tick, tick,
    );
    h.afterStation = waitForExecCalls(h, 1);
    await h.run();

    expect(h.execCalls.map((call) => call.args)).toEqual([["restart", "h2a-ops", "--soft", "--json"]]);
    expect(h.of("gesture")).toContainEqual({
      type: "gesture",
      gesture: "respawn-in-place",
      sessionId: "h2a-ops",
      outcome: "done",
    });
  });

  it("should relaunch a resolved dead session from its row and switch at the first running observation", async () => {
    const h = new Harness({
      station: { lazy: true },
      sessions: [
        { id: "h2a-live", project: "h2a", label: "live", host: "/fake/host-1.sock", mtime: 1_700_000_100_000 },
      ],
      deadSessions: [
        { id: "h2a-k1", project: "h2a", label: "k1", host: "", mtime: 1_700_000_050_000, convId: S2C1 },
      ],
    });
    h.step(
      (x) => {
        // Lazy lists without launching; the live session still displays.
        expect(x.displayed()).toEqual(["h2a-live"]);
        walkToRestorableRow(x, "core", "registry:h2a-k1");
      },
      (x) => {
        expect(squashed(x.stdout.text())).toContain(
          "Relaunch k1? A new incarnation starts; the old scrollback is lost.",
        );
        x.stdin.type("\r");
      },
      (x) => {
        expect(x.execCalls.map((call) => call.args)).toEqual([
          ["run", "claude", `${x.home}/src/h2a`, "--resume", S2C1, "--name", "k1", "--no-attach"],
        ]);
        // The relaunched session appears running: the station switches to it.
        x.fleet.host("/fake/host-1.sock").add("h2a-k1").emit("k1 ready\r\n");
      },
      tick, tick, tick, tick, tick, tick,
      (x) => {
        expect(x.displayed()).toContain("h2a-k1");
      },
    );
    h.afterStation = waitForExecCalls(h, 1);
    const code = await h.run();
    expect(code).toBe(0);
    expect(h.fleet.session("h2a-k1").acquireRequests).toBe(1);
  });

  it("should launch nothing for an unresolved, ambiguous or unknown row", async () => {
    const h = new Harness({
      station: { lazy: true },
      sessions: [
        { id: "h2a-live", project: "h2a", label: "live", host: "/fake/host-1.sock", mtime: 1_700_000_100_000 },
      ],
      deadSessions: [
        { id: "h2a-k1", project: "h2a", label: "k1", host: "", mtime: 1_700_000_050_000 },
      ],
    });
    h.step((x) => {
      // Lazy lists without launching; the live session still displays.
      expect(x.displayed()).toEqual(["h2a-live"]);
      walkToRestorableRow(x, "core", "registry:h2a-k1");
    }, tick);
    await h.run();
    // No gesture on the row: zero calls, never a guessed identifier.
    expect(h.execCalls).toEqual([]);
    expect(h.of("gesture")).toEqual([]);
  });

  it("should offer the relaunch from the end card of the displayed session", async () => {
    const h = new Harness({
      sessions: [
        { id: "h2a-ops", project: "h2a", label: "ops", host: "/fake/host-1.sock", mtime: 1_700_000_100_000, convId: S2C1 },
      ],
    });
    h.step(
      (x) => {
        expect(x.displayed()).toEqual(["h2a-ops"]);
        x.fleet.session("h2a-ops").end(0);
      },
      tick,
      tick,
      (x) => {
        expect(x.of("card").map((e) => e.kind)).toContain("ended");
        // Cards live in the panel: focus it first, then confirm.
        x.focusPanel();
        x.stdin.type("\r");
      },
      tick,
    );
    h.afterStation = waitForExecCalls(h, 1);
    const code = await h.run();
    expect(code).toBe(0);
    expect(h.execCalls.map((call) => call.args)).toEqual([
      ["run", "claude", `${h.home}/src/h2a`, "--resume", S2C1, "--name", "ops", "--no-attach"],
    ]);
  });

  it("should open a relaunched session without adapter and keep its deposit visible with refused-no-draft-adapter", async () => {
    const h = new Harness({
      station: { lazy: true },
      brokerProtected: true,
      sessions: [
        { id: "h2a-live", project: "h2a", label: "live", host: "/fake/host-1.sock", mtime: 1_700_000_100_000 },
      ],
      deadSessions: [
        { id: "h2a-k1", project: "h2a", label: "k1", host: "", mtime: 1_700_000_050_000, convId: S2C1 },
      ],
    });
    h.step(
      (x) => {
        // Lazy lists without launching; the live session still displays.
        expect(x.displayed()).toEqual(["h2a-live"]);
        // eslint-disable-next-line no-console
        console.error("FLOTTE-ROWS", JSON.stringify(x.row("h2a-live").extraRows?.map((r) => r.id)));
        walkToRestorableRow(x, "core", "registry:h2a-k1");
      },
      (x) => {
        // eslint-disable-next-line no-console
        console.error("FLOTTE-GESTURES", JSON.stringify(x.of("gesture")));
        x.stdin.type("\r");
      },
      (x) => {
        // eslint-disable-next-line no-console
        console.error("FLOTTE-EXEC", JSON.stringify(x.execCalls.map((c) => c.args)));
        expect(x.execCalls).toHaveLength(1);
        x.fleet.host("/fake/host-1.sock").add("h2a-k1").emit("k1 ready\r\n");
      },
      tick, tick, tick, tick, tick, tick,
      (x) => {
        expect(x.displayed()).toContain("h2a-k1");
        x.stdin.type("hi");
      },
      tick,
      (x) => {
        expect(x.fleet.session("h2a-k1").writes.join("")).toBe("hi");
        // A later automatic message stays deposited and visible, never automatic.
        expect(x.broker().deposit("h2a-k1", "wake")).toBe("refused-no-draft-adapter");
      },
      tick, tick,
      (x) => {
        expect(x.row("h2a-k1").extraRows).toContainEqual({
          id: "refusal",
          text: "refused-no-draft-adapter",
        });
        expect(x.broker().automaticPtyBytes).toEqual([]);
      },
    );
    h.afterStation = waitForExecCalls(h, 1);
    const code = await h.run();
    expect(code).toBe(0);
  });
});
