import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";
import xtermMod from "@xterm/headless";

import type { RemoteCliConfig } from "../config.js";
import type { RegistryEntry } from "../registry.js";
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
import {
  runStation,
  type StationEvent,
  type StationHostClient,
  type StationOptions,
  type StationRuntime,
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
    } as NativeTerminalSessionState;
  }
}

type FakeHostHooks = {
  beforeAcquire?: (session: FakeSession) => void | Promise<void>;
  beforeWrite?: (session: FakeSession, data: string) => void | Promise<void>;
  beforeRead?: (session: FakeSession, afterSeq: number) => void | Promise<void>;
  beforeState?: (id: string) => void | Promise<void>;
};

class FakeHost {
  readonly socketPath: string;
  generation: string;
  hostPid = 7000;
  /** INJ L2 host: the ping carries `composerBrokerVersion: 1`. */
  composerBrokerVersion: unknown;
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

  constructor(host: FakeHost) {
    this.host = host;
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
  deadCount?: number;
  /** INJ L2 hosts answer the ping with `composerBrokerVersion: 1`. */
  brokerProtected?: boolean;
  sessions?: readonly FixtureSession[];
  /** Extra registry rows without a live host session (dead before S2). */
  deadSessions?: readonly FixtureSession[];
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
        tool: "claude",
        kind: "local-native",
        cwd,
        label: fixture.label,
        tmuxSession: fixture.id,
        source: "run",
        sessionClass: "human",
        lastSeenAt: new Date(fixture.mtime).toISOString(),
        enrolledAt: new Date(fixture.mtime).toISOString(),
      } as RegistryEntry);
    }
    for (const fixture of sessions) {
      const host = this.fleet.host(fixture.host);
      host.now = () => this.now;
      if (options.brokerProtected) host.composerBrokerVersion = 1;
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
      endpoints: () => [...this.fleet.hosts.keys()],
      connect: async (socketPath) => {
        const host = this.fleet.hosts.get(socketPath);
        if (!host) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return host.connect();
      },
    };
  }

  options(): StationOptions {
    return {
      createStatusBar: (sessionId) =>
        this.#options.statusBar?.(this.stdout, sessionId) ?? new PlainStatusBar(this.stdout),
      statePath: this.statePath,
      ...(this.#options.deadCount !== undefined ? { deadCount: this.#options.deadCount } : {}),
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

  async run(): Promise<number> {
    const code = await runStation(this.runtime(), this.options());
    if (this.stepError !== undefined) throw this.stepError;
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

// ---------------------------------------------------------------------------
// Step 1 — S1.1 launch
// ---------------------------------------------------------------------------

describe("S1.1 launch: one window, every live session, no PTY started or stopped", () => {
  it("should open on the persisted session with tabs in config order then `other`, 7 rows and the panel open", async () => {
    const h = new Harness({
      state: JSON.stringify({
        version: 1,
        activeTab: "docs",
        lastSessionByTab: { docs: "h2a-guide", core: "h2a-tracker" },
        compatGuards: {},
      }),
      deadCount: 2,
      deadSessions: [
        { id: "h2a-dead-1", project: "h2a", label: "dead-one", host: "", mtime: 1_700_000_050_000 },
        { id: "h2a-dead-2", project: "site", label: "dead-two", host: "", mtime: 1_700_000_060_000 },
      ],
    });
    const before = h.fleet.all().map((s) => [s.id, s.host.generation, s.incarnation, s.status]);

    const code = await h.run();

    expect(code).toBe(0);
    const snapshot = h.lastSnapshot();
    expect(snapshot.workspaces.map((w) => w.title)).toEqual(["core", "docs", "lab", "other"]);
    const rows = snapshot.workspaces.flatMap((w) => w.sessions.map((s) => s.id));
    expect(rows).toHaveLength(7);
    expect(new Set(rows)).toEqual(new Set(FIXTURE_SESSIONS.map((s) => s.id)));
    // Dead sessions are neither listed nor relaunched before S2: a count only.
    expect(rows).not.toContain("h2a-dead-1");
    expect(snapshot.footerRows).toEqual(["2 dead · not relaunched (lot S2)"]);
    expect(plain(h.stdout.text())).toContain("2 dead · not relaunched (lot S2)");

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
