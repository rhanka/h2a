import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RemoteCliConfig } from "../config.js";
import type { RegistryEntry } from "../registry.js";
import type {
  NativeTerminalControllerIdentity,
  NativeTerminalControllerLease,
  NativeTerminalReplay,
  NativeTerminalSessionState,
} from "./host.js";
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
  }

  async resize(lease: NativeTerminalControllerLease, cols: number, rows: number): Promise<void> {
    this.#guard();
    const session = this.#requireLease(lease);
    session.resizes.push({ cols, rows });
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

  constructor(columns: number, rows: number, isTTY: boolean) {
    this.columns = columns;
    this.rows = rows;
    this.isTTY = isTTY;
  }

  write(chunk: string): boolean {
    this.chunks.push(String(chunk));
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
        const held = this.#held.find((entry) => entry.match(ms));
        if (held) {
          await new Promise<void>((resolve) => held.waiters.push(resolve));
          return;
        }
        this.now += ms;
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
      step(this);
      return;
    }
    if (this.autoDetach) this.stdin.type(Buffer.from([0x1c]));
  }

  async run(): Promise<number> {
    return runStation(this.runtime(), this.options());
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
