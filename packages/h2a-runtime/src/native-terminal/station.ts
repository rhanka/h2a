/**
 * Station (panel lot S1): one terminal, every live native session.
 *
 * The PTYs stay in the native hosts. The station is an attach that follows one
 * session at a time under a single ACTIVE controller lease and switches the
 * main view between sessions from the right panel:
 *
 *   t0 freeze input ─► t1 read B ─► t2 hold B ─► t3 leave A ─► t4 neutral
 *   terminal ─► t5 paint B (filtered replay) ─► t6 sentinel, open input
 *
 * A refused switch leaves the station on A, untouched. Losing the lease or the
 * session ends the VIEW, never the station: it shows a card and stays usable.
 * Only the detach byte, the end of stdin and a termination signal close it.
 *
 * On a host that announces the composer broker (`composerBrokerVersion: 1` in
 * the ping, INJ L2), a session that is left is released: the host protects its
 * composer. On an older host the lease is kept as a local compatibility guard
 * that is never written to nor resized. The manual pin, the broker and the
 * draft vault live in the host; the station only calls them.
 *
 * This module never spawns a process and never starts or stops a PTY.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { NativeTerminalRequestTimeoutError } from "./client.js";
import type { NativeTerminalClient } from "./client.js";
import {
  collectNativeInventory,
  resolveNativeOwner,
  type NativeInventory,
  type NativeInventoryClient,
} from "./fleet.js";
import type {
  NativeTerminalControllerLease,
  NativeTerminalSessionState,
} from "./host.js";
import {
  NATIVE_TERMINAL_INTERACTIVE_READ_TIMEOUT_MS,
  NativeTerminalRemoteError,
  type NativeTerminalPing,
} from "./protocol.js";
import type { PanelInputEvent } from "./panel-input.js";
import {
  RightPanelController,
  buildRightPanelSnapshot,
  panelDisplayColumns,
  resolveRightPanelWidth,
  type RightPanelBarMarkerState,
  type RightPanelDraftCapabilityState,
  type RightPanelDraftRecoveryState,
  type RightPanelExtraRow,
  type RightPanelForwardedMouse,
  type RightPanelHandleResult,
  type RightPanelOverlay,
  type RightPanelSession,
  type RightPanelSnapshot,
} from "./right-panel.js";
import {
  RightPanelSnapshotRefresher,
  TrackJournalCache,
  buildLiveRightPanelSnapshot,
  type BuildLiveRightPanelSnapshotOptions,
} from "./right-panel-snapshot.js";
import {
  ATTACH_PENDING_INPUT_MAX_BYTES,
  createSessionView,
  isDefinitiveNativeTerminalAbsence,
  isStateRequestTimeout,
  sessionExitCrashEntry,
  type NativeSessionView,
  type NativeTerminalAttachClient,
  type SessionViewControllerLoss,
  type SessionViewStatusBar,
} from "./session-view.js";
import {
  EMPTY_STATION_STATE,
  readStationState,
  withActiveTab,
  withCompatGuard,
  withDisplayedSession,
  withoutCompatGuard,
  writeStationState,
  type StationState,
} from "./station-state.js";
import {
  DraftRecoveryView,
  draftExportBytes,
  type DraftRecoveryAction,
  type DraftRecoveryLabels,
  type DraftRecoveryRecord,
  type DraftSubmissionOutcome,
} from "./draft-recovery-view.js";
import { H2A_OUTER_MOUSE_ENABLE, H2A_OUTER_MOUSE_RESET } from "./terminal-modes.js";
import { TerminalUndoRegistry } from "./attach-recovery.js";
import { appendCrashLog, type CrashLogEntry } from "../crash-log.js";
import { readRemoteConfig } from "../config.js";
import { humanOutputText, resolveHumanOutputLocale } from "../human-output.js";

const ESC = "\x1b";
const DETACH_BYTE = 0x1c;

/** t6 — station status request and its reply (r2 annex D). */
export const STATION_SENTINEL_QUERY = `${ESC}[5n`;
export const STATION_SENTINEL_REPLY = `${ESC}[0n`;
export const STATION_SENTINEL_TIMEOUT_MS = 150;
/** t3 — longest wait for a human write still in flight to the session left. */
export const STATION_SWITCH_INPUT_WAIT_MS = 250;
/** t2 — single retry when the holder is a lease without terminal identity. */
export const STATION_UNKNOWN_TTY_RETRY_MS = 250;

/** Soft reset, never a full one (`ESC c` would drop the h2a-owned mouse). */
export const STATION_SOFT_RESET = `${ESC}[!p`;
/** Explicit neutral base: what DECSTR leaves terminal-dependent or untracked. */
export const STATION_NEUTRAL_BASE =
  `${ESC}[?7h${ESC}[?25h${ESC}[?6l${ESC}[4l${ESC}[0m${ESC}[0 q${ESC}(B\x0f`;
/** Q9: the terminal scrollback is cleared at a switch and rebuilt by the replay. */
export const STATION_CLEAR = `${ESC}[2J${ESC}[3J${ESC}[H`;
/** t4, in the fixed order of r2 annex D (the h2a mouse is re-applied by the view). */
export const STATION_NEUTRAL_SEQUENCE = `${STATION_SOFT_RESET}${STATION_NEUTRAL_BASE}${STATION_CLEAR}`;
/** Motion reporting of the outer terminal follows the displayed session only. */
const STATION_MOTION_OFF = `${ESC}[?1003l${ESC}[?1002l`;
const STATION_TITLE_PUSH = `${ESC}[22;0t`;
const STATION_TITLE_POP = `${ESC}[23;0t`;
const FOCUS_IN = `${ESC}[I`;
const FOCUS_OUT = `${ESC}[O`;
const SENTINEL_REPLY_BYTES = Buffer.from(STATION_SENTINEL_REPLY, "latin1");
const LATE_TAIL_FLUSH_MS = 25;
const PANEL_ESCAPE_FLUSH_MS = 25;
const IDLE_POLL_MIN_MS = 100;
const IDLE_POLL_MAX_MS = 500;
const ACTIVE_POLL_MS = 100;
const STATE_POLL_MS = 1_000;
const STATE_POLL_MAX_MS = 16_000;
const RECONNECT_MIN_MS = 100;
const RECONNECT_MAX_MS = 2_000;

// ---------------------------------------------------------------------------
// Host surface
// ---------------------------------------------------------------------------

/** Ping of a host; `composerBrokerVersion` is published by INJ L2 hosts only. */
export type StationHostPing = NativeTerminalPing & {
  readonly composerBrokerVersion?: unknown;
};

export type StationDraftRef = Readonly<{
  sessionId: string;
  applicationIncarnation: string;
  requestId: string;
}>;

export type StationDraftOutcome =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: string }>;

/** What the host reports about automatic messages and kept drafts of a session. */
export type StationSessionDraftStatus = Readonly<{
  /** Refusal of an automatic deposit still visible on this line (machine code). */
  refusal?: string;
  /** Outcome of the last automatic message. */
  submission?: DraftSubmissionOutcome;
  /** Human sequences closed as `dropped-on-app-exit`. */
  droppedOnAppExit?: number;
  /** Kept drafts, without their content. */
  drafts?: readonly DraftRecoveryRecord[];
}>;

/**
 * Station-side port over the INJ host surface (r4 §3.2 and §3.6). The broker,
 * the vault and the pin belong to the host: no host before INJ L2 implements
 * any of this, and the station then reports `refused-no-capability`. Only
 * `set-manual-pin` has a name fixed by the specification; the other
 * operations are bound to the real host operations when INJ L2 lands.
 */
export type StationInjPort = {
  setManualPin(request: {
    sessionId: string;
    incarnation: string;
    manualPin: boolean;
  }): Promise<unknown>;
  draftStatus(
    sessionIds: readonly string[],
  ): Promise<Readonly<Record<string, StationSessionDraftStatus>>>;
  readDraft(ref: StationDraftRef): Promise<Uint8Array | undefined>;
  replaceDraft(ref: StationDraftRef): Promise<StationDraftOutcome>;
  deleteDraft(ref: StationDraftRef): Promise<StationDraftOutcome>;
};

/** One client per owner host: the attach surface, the inventory, the INJ port. */
export type StationHostClient = NativeTerminalAttachClient & {
  ping(): Promise<StationHostPing>;
  list(): Promise<ReadonlyArray<NativeTerminalSessionState>>;
} & Partial<StationInjPort>;

/** The real client is a station host client (compile-time proof). */
const _realClientFits: (client: NativeTerminalClient) => StationHostClient = (client) => client;
void _realClientFits;

export type StationStatusBar = SessionViewStatusBar & {
  setRightPanel(
    panel:
      | {
          childCols(totalCols: number): number;
          isPaintActive(): boolean;
          isOpen(): boolean;
          paint(): void;
        }
      | undefined,
  ): void;
  setOnBeforeActivate(callback: (() => void) | undefined): void;
  setRightPanelMarkerProvider(
    provider: (() => RightPanelBarMarkerState | undefined) | undefined,
  ): void;
  setSelectedDelegatedNamesProvider(
    provider: (() => readonly string[] | "unknown" | undefined) | undefined,
  ): void;
  isActive(): boolean;
  paint(force?: boolean): void;
  onRightPanelGeometryChange(): void;
  restoreChildStateSequence(): string;
};

export type StationRuntime = {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  now(): number;
  delay(ms: number): Promise<void>;
  onResize(listener: () => void): void;
  offResize(listener: () => void): void;
  onTerminate?(listener: () => void): void;
  offTerminate?(listener: () => void): void;
  saveTerminalReset?(sequence: string): void;
  /** Owner endpoints known on this machine. */
  endpoints(): readonly string[];
  /** A new connection to one owner host. */
  connect(socketPath: string): Promise<StationHostClient>;
  /** Proof that an unreachable endpoint is absent rather than unknown. */
  proveAbsent?(socketPath: string, failure: unknown): Promise<boolean>;
};

export type StationRefusalReason =
  | "absent"
  | "ended"
  | "unknown-view"
  | "ambiguous-owner"
  | "host-silent"
  | "controlled-elsewhere"
  | "input-in-flight";

export type StationCardKind =
  | "controlled-elsewhere"
  | "ended"
  | "disappeared"
  | StationRefusalReason;

export type StationEvent =
  | { type: "idle" }
  | { type: "snapshot"; snapshot: RightPanelSnapshot }
  | {
      type: "displayed";
      sessionId: string;
      tab: string | undefined;
      socketPath: string;
      panelOpen: boolean;
      initial: boolean;
    }
  | { type: "same-session"; sessionId: string }
  | { type: "switch-refused"; sessionId: string; reason: StationRefusalReason }
  | { type: "card"; kind: StationCardKind; sessionId: string }
  | { type: "notice"; key: string }
  | { type: "input-dropped"; bytes: number; reason: "transition" | "no-session" | "closed" }
  | { type: "input-purged"; bytes: number; reason: "transition" | "queue-full" }
  | { type: "sentinel"; outcome: "answered" | "timeout" | "skipped" | "late-swallowed" }
  | {
      type: "guard";
      action: "kept" | "promoted" | "stale" | "released" | "reacquired" | "dropped";
      sessionId: string;
    }
  | { type: "lease-released"; sessionId: string }
  | { type: "reconnected"; sessionId: string }
  | { type: "gesture"; gesture: string; sessionId: string; outcome: string }
  | { type: "closed"; reason: "detach" | "stdin-end" | "terminate" };

export type StationPanelOptions = {
  readonly width?: number;
  readonly env?: NodeJS.ProcessEnv;
  /** Replaces the live snapshot loader (tests and embedding). */
  readonly loadSnapshot?: (context: {
    currentSessionId: string | undefined;
    seenDecisionKeys: ReadonlySet<string>;
  }) => RightPanelSnapshot | Promise<RightPanelSnapshot>;
  readonly snapshotOptions?: Omit<
    BuildLiveRightPanelSnapshotOptions,
    "currentSessionId" | "seenDecisionKeys" | "nowMs" | "collectNative"
  >;
  readonly refreshIntervalMs?: number;
};

export type StationOptions = {
  /** One bottom bar per displayed session (the attach controller of op.ts). */
  readonly createStatusBar: (sessionId: string) => StationStatusBar;
  readonly panel?: StationPanelOptions;
  /** Station state file; without it nothing is persisted. */
  readonly statePath?: string;
  /** Private directory of raw draft exports (default: next to the state). */
  readonly exportDir?: string;
  /** Dead sessions of the restore plan: displayed as a number before S2. */
  readonly deadCount?: number;
  readonly locale?: string;
  readonly tty?: string;
  readonly pid?: number;
  readonly sentinelTimeoutMs?: number;
  readonly onEvent?: (event: StationEvent) => void;
  readonly onCrashLog?: (entry: CrashLogEntry) => void;
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type HostLink = {
  socketPath: string;
  client: StationHostClient;
  /** INJ L2 host: the legacy automation lease is closed server-side. */
  brokerProtected: boolean;
  generation: string;
};

type GuardLease = { lease: NativeTerminalControllerLease; socketPath: string };

type InventoryView = {
  complete: boolean;
  sessions: Array<NativeTerminalSessionState & { socketPath: string }>;
  hosts: Array<{ socketPath: string; absent?: true; reason?: string }>;
};

type Displayed = {
  id: string;
  socketPath: string;
  label: string;
  tab: string | undefined;
  generation: string;
  incarnation: string;
};

type Request = { type: "activate"; sessionId: string; takeover: boolean };

type HoldResult =
  | { ok: true; lease: NativeTerminalControllerLease; wasGuard: boolean }
  | { ok: false; reason: StationRefusalReason; state?: NativeTerminalSessionState };

type HeldPress = Pick<RightPanelForwardedMouse, "button" | "x" | "y" | "mode" | "encoding">;

function stripInventory<C extends NativeInventoryClient>(inventory: NativeInventory<C>): InventoryView {
  return {
    complete: inventory.complete,
    sessions: inventory.sessions,
    hosts: inventory.hosts.map((host) => ({
      socketPath: host.socketPath,
      ...(host.absent ? { absent: true as const } : {}),
      ...(host.reason !== undefined ? { reason: host.reason } : {}),
    })),
  };
}

function isAlreadyControlled(error: unknown): boolean {
  return (
    error instanceof NativeTerminalRemoteError &&
    error.message.includes("already has a controller")
  );
}

function isStaleLease(error: unknown): boolean {
  return (
    error instanceof NativeTerminalRemoteError &&
    error.message === "stale terminal controller lease"
  );
}

/** A remote refusal is an answer of a live host; anything else is transport. */
function isHostAnswer(error: unknown): boolean {
  return error instanceof NativeTerminalRemoteError;
}

function singleLine(text: string, max = 96): string {
  const clean = text.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ").replace(/\s+/g, " ").trim();
  const scalars = Array.from(clean);
  return scalars.length > max ? `${scalars.slice(0, max - 1).join("")}…` : clean;
}

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (panelDisplayColumns(candidate) <= width) {
      line = candidate;
      continue;
    }
    if (line.length > 0) out.push(line);
    line = "";
    let rest = word;
    while (panelDisplayColumns(rest) > width) {
      let cut = "";
      for (const ch of rest) {
        if (panelDisplayColumns(cut + ch) > width) break;
        cut += ch;
      }
      if (cut.length === 0) break;
      out.push(cut);
      rest = rest.slice(cut.length);
    }
    line = rest;
  }
  if (line.length > 0 || out.length === 0) out.push(line);
  return out;
}

/**
 * Synthetic release for a press that was forwarded to the session being left:
 * same button, same coordinates, in the encoding the press went out in
 * (r2 annex D). X10 compatibility mode 9 never reports releases.
 */
export function syntheticMouseRelease(press: HeldPress): string {
  if (press.mode === 9) return "";
  if (press.encoding === "sgr" || press.encoding === "sgr-pixel") {
    return `${ESC}[<${press.button};${press.x};${press.y}m`;
  }
  const released = (press.button & ~3) | 3;
  if (press.encoding === "urxvt") return `${ESC}[${released + 32};${press.x};${press.y}M`;
  if (press.encoding === "utf8") {
    if (press.x > 2015 || press.y > 2015) return "";
    return `${ESC}[M${String.fromCodePoint(released + 32, press.x + 32, press.y + 32)}`;
  }
  if (press.x > 223 || press.y > 223) return "";
  return `${ESC}[M${String.fromCharCode(released + 32, press.x + 32, press.y + 32)}`;
}

/** Card or confirmation shown in place of the panel list. */
class StationCardOverlay implements RightPanelOverlay {
  readonly #text: readonly string[];
  readonly #prompt: string;
  readonly #onConfirm: (() => void) | undefined;
  readonly #onClose: () => void;

  constructor(options: {
    text: readonly string[];
    prompt: string;
    onConfirm?: (() => void) | undefined;
    onClose: () => void;
  }) {
    this.#text = options.text;
    this.#prompt = options.prompt;
    this.#onConfirm = options.onConfirm;
    this.#onClose = options.onClose;
  }

  render(width: number, rows: number): readonly string[] {
    const lines = this.#text.flatMap((line) => wrapText(line, width));
    const prompt = wrapText(this.#prompt, width);
    return [...lines, "", ...prompt].slice(0, Math.max(0, rows));
  }

  handleKey(event: PanelInputEvent): boolean {
    if (event.type === "enter" && this.#onConfirm) {
      this.#onClose();
      this.#onConfirm();
    } else if (event.type === "escape" || (event.type === "enter" && !this.#onConfirm)) {
      this.#onClose();
    }
    return true;
  }
}

class Station {
  readonly #runtime: StationRuntime;
  readonly #options: StationOptions;
  readonly #stdin: NodeJS.ReadStream;
  readonly #stdout: NodeJS.WriteStream;
  readonly #locale: string;
  readonly #tty: string;
  readonly #pid: number;
  readonly #controllerId: string;
  readonly #sentinelTimeoutMs: number;
  readonly #logCrash: (entry: CrashLogEntry) => void;
  readonly #links = new Map<string, HostLink>();
  readonly #linking = new Map<string, Promise<HostLink>>();
  readonly #guards = new Map<string, GuardLease>();
  readonly #sizes = new Map<string, { cols: number; rows: number }>();
  readonly #stationUndo = new TerminalUndoRegistry();
  readonly #draftStatus = new Map<string, StationSessionDraftStatus>();

  #state: StationState = EMPTY_STATION_STATE;
  #panel!: RightPanelController;
  #refresher!: RightPanelSnapshotRefresher;
  #rawSnapshot: RightPanelSnapshot | undefined;
  #inventory: InventoryView | undefined;
  #view: NativeSessionView | undefined;
  #bar: StationStatusBar | undefined;
  #displayed: Displayed | undefined;
  #gate: "open" | "frozen" = "frozen";
  #inputClosedUntilReconnect = false;
  #request: Request | undefined;
  #ended: "detach" | "stdin-end" | "terminate" | undefined;
  #exitCode = 0;
  #wake: (() => void) | undefined;
  #catchUpPending = false;
  #pendingLoss: SessionViewControllerLoss | undefined;
  #heldPress: HeldPress | undefined;
  #outerFocus: "unknown" | "gained" | "lost" = "unknown";
  #sentinelWaiter: (() => void) | undefined;
  #lateSentinels = 0;
  #lateTail: Buffer = Buffer.alloc(0);
  #lateTailGeneration = 0;
  #pendingEscapeAt: number | undefined;
  #idlePollMs = IDLE_POLL_MIN_MS;
  #statePollMs = STATE_POLL_MS;
  #nextStatePollAt = 0;
  #reconnectDelayMs = RECONNECT_MIN_MS;
  #titlePushed = false;
  #recoveryView: { view: DraftRecoveryView; ref: StationDraftRef } | undefined;
  #trackCache: TrackJournalCache | undefined;
  /** Nothing is painted before the launch decided what to display. */
  #started = false;

  constructor(runtime: StationRuntime, options: StationOptions) {
    this.#runtime = runtime;
    this.#options = options;
    this.#stdin = runtime.stdin;
    this.#stdout = runtime.stdout;
    this.#locale = options.locale ?? resolveHumanOutputLocale();
    this.#tty = options.tty ?? "not-a-tty";
    this.#pid = options.pid ?? process.pid;
    this.#controllerId = `h2a-station-${this.#pid}`;
    this.#sentinelTimeoutMs = options.sentinelTimeoutMs ?? STATION_SENTINEL_TIMEOUT_MS;
    this.#logCrash = options.onCrashLog ?? ((entry) => appendCrashLog("attach", entry));
  }

  // --- small helpers -------------------------------------------------------

  #t(key: string, vars: Readonly<Record<string, string | number>> = {}): string {
    return humanOutputText(key, this.#locale).replace(/\{(\w+)\}/g, (match, name: string) =>
      name in vars ? String(vars[name]) : match,
    );
  }

  #emit(event: StationEvent): void {
    try {
      this.#options.onEvent?.(event);
    } catch {
      /* an observer never breaks the station */
    }
  }

  #persist(next: StationState): void {
    this.#state = next;
    if (this.#options.statePath !== undefined) writeStationState(this.#options.statePath, next);
  }

  #wakeLoop(): void {
    const wake = this.#wake;
    this.#wake = undefined;
    wake?.();
  }

  async #pause(ms: number): Promise<void> {
    if (this.#request || this.#ended) return;
    await Promise.race([
      this.#runtime.delay(ms),
      new Promise<void>((resolve) => {
        this.#wake = resolve;
      }),
    ]);
    this.#wake = undefined;
  }

  #sessionLabel(sessionId: string): string {
    for (const workspace of this.#rawSnapshot?.workspaces ?? []) {
      const row = workspace.sessions.find((session) => session.id === sessionId);
      if (row) return row.label;
    }
    return sessionId;
  }

  #tabOf(sessionId: string): string | undefined {
    return this.#rawSnapshot?.workspaces.find((workspace) =>
      workspace.sessions.some((session) => session.id === sessionId),
    )?.title;
  }

  #liveView(): NativeSessionView | undefined {
    const view = this.#view;
    return view && !view.terminalEnded ? view : undefined;
  }

  // --- hosts ---------------------------------------------------------------

  async #link(socketPath: string): Promise<HostLink> {
    const existing = this.#links.get(socketPath);
    if (existing) return existing;
    const pending = this.#linking.get(socketPath);
    if (pending) return pending;
    const work = (async (): Promise<HostLink> => {
      const client = await this.#runtime.connect(socketPath);
      try {
        const ping = await client.ping();
        const link: HostLink = {
          socketPath,
          client,
          // Absent or not understood ⇒ compatibility guard (r4 §3.1, §4).
          brokerProtected: ping.composerBrokerVersion === 1,
          generation: ping.generation,
        };
        this.#links.set(socketPath, link);
        return link;
      } catch (error) {
        client.close();
        throw error;
      }
    })().finally(() => {
      this.#linking.delete(socketPath);
    });
    this.#linking.set(socketPath, work);
    return work;
  }

  /** The connection is gone: so is every lease it carried. */
  #dropLink(socketPath: string): void {
    const link = this.#links.get(socketPath);
    if (!link) return;
    this.#links.delete(socketPath);
    try {
      link.client.close();
    } catch {
      /* already closed */
    }
    for (const [sessionId, guard] of this.#guards) {
      // The persisted guard stays: it is taken again after reconnection.
      if (guard.socketPath === socketPath) this.#guards.delete(sessionId);
    }
  }

  /** The session view never closes the host client it shares with the guards. */
  #viewClient(link: HostLink): NativeTerminalAttachClient {
    const client = link.client;
    return {
      readOutput: (id, afterSeq, timeoutMs) => client.readOutput(id, afterSeq, timeoutMs),
      state: (id) => client.state(id),
      acquireController: (id, controllerId, activity, options) =>
        client.acquireController(id, controllerId, activity, options),
      releaseController: (lease) => client.releaseController(lease),
      write: (lease, data) => client.write(lease, data),
      resize: (lease, cols, rows) => client.resize(lease, cols, rows),
      close: () => {},
    };
  }

  async #collectInventory(): Promise<NativeInventory<StationHostClient>> {
    const proveAbsent = this.#runtime.proveAbsent;
    const inventory = await collectNativeInventory<StationHostClient>(
      this.#runtime.endpoints(),
      (socketPath) => this.#runtime.connect(socketPath),
      proveAbsent ? (socketPath, failure) => proveAbsent(socketPath, failure) : undefined,
    );
    this.#inventory = stripInventory(inventory);
    return inventory;
  }

  async #freshInventory(): Promise<InventoryView> {
    const inventory = await this.#collectInventory();
    for (const host of inventory.hosts) host.client?.close();
    return this.#inventory!;
  }

  async #resolveOwner(sessionId: string, fresh = false) {
    if (!fresh && this.#inventory) {
      const cached = resolveNativeOwner(sessionId, this.#inventory);
      if (cached.state === "found" && cached.session.status === "running") return cached;
    }
    return resolveNativeOwner(sessionId, await this.#freshInventory());
  }

  // --- compatibility guards (hosts without the composer broker) -------------

  #dropGuard(sessionId: string, action: "stale" | "dropped" | "released"): void {
    this.#guards.delete(sessionId);
    this.#persist(withoutCompatGuard(this.#state, sessionId));
    this.#emit({ type: "guard", action, sessionId });
  }

  /** A guard is ours only while the host still shows our exact lease. */
  #guardIsCurrent(guard: GuardLease, state: NativeTerminalSessionState): boolean {
    return (
      state.status === "running" &&
      state.generation === guard.lease.generation &&
      state.incarnation === guard.lease.incarnation &&
      state.controllerEpoch === guard.lease.epoch
    );
  }

  /** Retire guards the inventory proves stale; the shared client stays open. */
  #reconcileGuards(inventory: InventoryView): void {
    for (const [sessionId, guard] of this.#guards) {
      const state = inventory.sessions.find(
        (session) => session.id === sessionId && session.socketPath === guard.socketPath,
      );
      if (state === undefined) {
        if (inventory.complete) this.#dropGuard(sessionId, "stale");
        continue;
      }
      if (!this.#guardIsCurrent(guard, state)) this.#dropGuard(sessionId, "stale");
    }
  }

  /**
   * Take the persisted guards again on a host without the broker: after a
   * relaunch or a reconnection, never by force, only for the same incarnation.
   */
  async #reacquireGuards(link: HostLink): Promise<void> {
    if (link.brokerProtected) return;
    for (const [sessionId, persisted] of Object.entries(this.#state.compatGuards)) {
      if (this.#guards.has(sessionId) || sessionId === this.#displayed?.id) continue;
      const known = this.#inventory?.sessions.find((session) => session.id === sessionId);
      if (known !== undefined && known.socketPath !== link.socketPath) continue;
      let state: NativeTerminalSessionState;
      try {
        state = await link.client.state(sessionId);
      } catch (error) {
        if (isDefinitiveNativeTerminalAbsence(error)) this.#dropGuard(sessionId, "dropped");
        continue;
      }
      if (state.status !== "running" || state.incarnation !== persisted.incarnation) {
        this.#dropGuard(sessionId, "dropped");
        continue;
      }
      if (state.controlled) continue;
      try {
        const lease = await link.client.acquireController(sessionId, this.#controllerId, "human", {
          pid: this.#pid,
          tty: this.#tty,
        });
        this.#guards.set(sessionId, { lease, socketPath: link.socketPath });
        this.#persist(
          withCompatGuard(this.#state, sessionId, {
            generation: lease.generation,
            incarnation: lease.incarnation,
          }),
        );
        this.#emit({ type: "guard", action: "reacquired", sessionId });
      } catch {
        /* held elsewhere meanwhile: the line shows it, the guard is not forced */
      }
    }
  }

  async #reacquireAllGuards(): Promise<void> {
    const sockets = new Set<string>();
    for (const sessionId of Object.keys(this.#state.compatGuards)) {
      const owner = this.#inventory?.sessions.find((session) => session.id === sessionId);
      if (owner) sockets.add(owner.socketPath);
      else if (this.#inventory?.complete) this.#dropGuard(sessionId, "dropped");
    }
    for (const socketPath of sockets) {
      try {
        await this.#reacquireGuards(await this.#link(socketPath));
      } catch {
        /* an unreachable host keeps its persisted guards for the next attempt */
      }
    }
  }

  // --- snapshot -------------------------------------------------------------

  async #loadSnapshot(seenDecisionKeys: ReadonlySet<string>): Promise<RightPanelSnapshot> {
    const panel = this.#options.panel;
    let snapshot: RightPanelSnapshot;
    if (panel?.loadSnapshot) {
      snapshot = await panel.loadSnapshot({
        currentSessionId: this.#displayed?.id,
        seenDecisionKeys,
      });
      await this.#freshInventory().catch(() => {});
    } else {
      const env = panel?.snapshotOptions?.env ?? panel?.env;
      snapshot = await buildLiveRightPanelSnapshot({
        ...panel?.snapshotOptions,
        currentSessionId: this.#displayed?.id ?? "",
        ...(env !== undefined ? { env } : {}),
        nowMs: this.#runtime.now(),
        seenDecisionKeys,
        ...(this.#trackCache !== undefined ? { trackCache: this.#trackCache } : {}),
        // One inventory feeds the panel rows, the owners and the guard checks.
        collectNative: () => this.#collectInventory(),
      });
    }
    if (this.#inventory) this.#reconcileGuards(this.#inventory);
    await this.#refreshDraftStatus(snapshot).catch(() => {});
    return snapshot;
  }

  /** Ask every host that offers the INJ port for the lines it knows about. */
  async #refreshDraftStatus(snapshot: RightPanelSnapshot): Promise<void> {
    const bySocket = new Map<string, string[]>();
    for (const workspace of snapshot.workspaces) {
      for (const row of workspace.sessions) {
        const owner = this.#inventory?.sessions.find((session) => session.id === row.id);
        if (!owner) continue;
        const list = bySocket.get(owner.socketPath) ?? [];
        list.push(row.id);
        bySocket.set(owner.socketPath, list);
      }
    }
    for (const [socketPath, sessionIds] of bySocket) {
      let link: HostLink;
      try {
        link = await this.#link(socketPath);
      } catch {
        continue;
      }
      if (!link.brokerProtected || typeof link.client.draftStatus !== "function") {
        for (const id of sessionIds) this.#draftStatus.delete(id);
        continue;
      }
      try {
        const statuses = await link.client.draftStatus(sessionIds);
        for (const id of sessionIds) {
          const status = statuses[id];
          if (status) this.#draftStatus.set(id, status);
          else this.#draftStatus.delete(id);
        }
      } catch {
        /* keep the last known lines: an unreadable source never reads as clear */
      }
    }
    this.#refreshRecoveryView();
  }

  #draftRecoveryState(status: StationSessionDraftStatus | undefined): RightPanelDraftRecoveryState {
    const drafts = status?.drafts ?? [];
    if (drafts.some((draft) => draft.draft === "saved-for-recovery")) return "saved-for-recovery";
    if (drafts.some((draft) => draft.draft === "restoring-on-ready")) return "restoring-on-ready";
    if (status?.submission === "uncertain" || drafts.some((d) => d.submission === "uncertain")) {
      return "uncertain";
    }
    return "none";
  }

  #decorateRow(row: RightPanelSession): RightPanelSession {
    const state = this.#inventory?.sessions.find((session) => session.id === row.id);
    const link = state ? this.#links.get(state.socketPath) : undefined;
    const guard = this.#guards.get(row.id);
    const displayedHere = row.id === this.#displayed?.id;
    const ours = guard !== undefined || (displayedHere && this.#liveView()?.active !== undefined);
    const status = this.#draftStatus.get(row.id);
    const manualPin = (state as { manualPin?: unknown } | undefined)?.manualPin === true;
    const draftCapability: RightPanelDraftCapabilityState | undefined =
      link === undefined
        ? "unknown"
        : !link.brokerProtected
          ? "refused-no-capability"
          : status?.refusal === "refused-no-draft-adapter"
            ? "refused-no-draft-adapter"
            : undefined;

    const extraBadges: string[] = [];
    if (manualPin) extraBadges.push(this.#t("station.badge.manualPin"));

    const extraRows: RightPanelExtraRow[] = [];
    if (status?.refusal) extraRows.push({ id: "refusal", text: status.refusal });
    if (status?.submission && status.submission !== "submitted") {
      extraRows.push({ id: "submission", text: `submission: ${status.submission}` });
    }
    if (status?.droppedOnAppExit !== undefined && status.droppedOnAppExit > 0) {
      extraRows.push({
        id: "dropped",
        text: `${status.droppedOnAppExit} dropped-on-app-exit`,
      });
    }
    for (const draft of status?.drafts ?? []) {
      if (draft.draft === "untouched") continue;
      extraRows.push({
        id: `draft:${draft.applicationIncarnation}:${draft.requestId}`,
        text:
          draft.draft === "restoring-on-ready"
            ? "restoring-on-ready"
            : draft.draft === "restored"
              ? "restored"
              : this.#t("station.row.draftKept"),
        activatable: true,
      });
    }
    // Contextual gestures: shown under the selected row, always confirmed.
    if (link !== undefined && state?.status === "running") {
      if (!link.brokerProtected && !displayedHere) {
        if (guard) {
          extraRows.push({
            id: "guard-release",
            text: `⚑ ${this.#t("station.row.guardRelease")}`,
            activatable: true,
            whenSelected: true,
          });
        } else if (!state.controlled) {
          extraRows.push({
            id: "guard-keep",
            text: `⚑ ${this.#t("station.row.guardKeep")}`,
            activatable: true,
            whenSelected: true,
          });
        }
      }
      if (link.brokerProtected && typeof link.client.setManualPin === "function") {
        extraRows.push({
          id: manualPin ? "pin-remove" : "pin-set",
          text: this.#t(manualPin ? "station.row.pinRemove" : "station.row.pinSet"),
          activatable: true,
          whenSelected: true,
        });
      }
    }

    const { draftCapability: _capability, extraBadges: _badges, extraRows: _rows, ...base } = row;
    return {
      ...base,
      displayedHere,
      controlledElsewhere: state?.controlled === true && !ours,
      compatGuard: guard !== undefined,
      ...(draftCapability !== undefined ? { draftCapability } : {}),
      draftRecovery: this.#draftRecoveryState(status),
      ...(extraBadges.length > 0 ? { extraBadges } : {}),
      ...(extraRows.length > 0 ? { extraRows } : {}),
    };
  }

  #decorate(snapshot: RightPanelSnapshot): RightPanelSnapshot {
    const dead = this.#options.deadCount ?? 0;
    return {
      ...snapshot,
      workspaces: snapshot.workspaces.map((workspace) => ({
        title: workspace.title,
        sessions: workspace.sessions.map((row) => this.#decorateRow(row)),
      })),
      ...(dead > 0
        ? { footerRows: [this.#t("station.dead.count", { count: dead })] }
        : {}),
    };
  }

  #applySnapshot(snapshot: RightPanelSnapshot): void {
    this.#rawSnapshot = snapshot;
    const decorated = this.#decorate(snapshot);
    this.#panel.setSnapshot(decorated);
    this.#bar?.paint(false);
    this.#emit({ type: "snapshot", snapshot: decorated });
  }

  /** Re-derive the station marks (displayed, guards, drafts) without a reload. */
  #redecorate(): void {
    if (this.#rawSnapshot) this.#applySnapshot(this.#rawSnapshot);
  }

  // --- input ----------------------------------------------------------------

  #inputContext() {
    const view = this.#liveView();
    return {
      cliMouseEnabled: view?.modes.isMouseTrackingEnabled() ?? false,
      cliMouseMode: view?.modes.mouseTrackingMode() ?? null,
      cliMouseEncoding: view?.modes.mouseEncoding() ?? ("x10" as const),
      bracketedPasteEnabled: view?.modes.isBracketedPasteEnabled() ?? false,
      kittyKeyboardEnabled: view?.modes.isKittyKeyboardEnabled() ?? false,
      statusBarActive: this.#bar?.isActive() ?? false,
    };
  }

  /** Last focus state the outer terminal reported (mode 1004). */
  #observeOuterFocus(chunk: Buffer): void {
    for (let i = chunk.indexOf(0x1b); i >= 0 && i + 2 < chunk.length; i = chunk.indexOf(0x1b, i + 1)) {
      if (chunk[i + 1] !== 0x5b) continue;
      if (chunk[i + 2] === 0x49) this.#outerFocus = "gained";
      else if (chunk[i + 2] === 0x4f) this.#outerFocus = "lost";
    }
  }

  /** A late sentinel reply is swallowed, even split across chunks (S1.5). */
  #swallowLateSentinel(chunk: Buffer): Buffer {
    let data = this.#lateTail.length > 0 ? Buffer.concat([this.#lateTail, chunk]) : chunk;
    this.#lateTail = Buffer.alloc(0);
    this.#lateTailGeneration += 1;
    while (this.#lateSentinels > 0) {
      const at = data.indexOf(SENTINEL_REPLY_BYTES);
      if (at < 0) break;
      data = Buffer.concat([data.subarray(0, at), data.subarray(at + SENTINEL_REPLY_BYTES.length)]);
      this.#lateSentinels -= 1;
      this.#emit({ type: "sentinel", outcome: "late-swallowed" });
    }
    if (this.#lateSentinels === 0) return data;
    // Hold back a trailing prefix of the reply: the next chunk may complete it.
    let keep = Math.min(data.length, SENTINEL_REPLY_BYTES.length - 1);
    while (keep > 0 && !SENTINEL_REPLY_BYTES.subarray(0, keep).equals(data.subarray(data.length - keep))) {
      keep -= 1;
    }
    if (keep === 0) return data;
    this.#lateTail = Buffer.from(data.subarray(data.length - keep));
    const generation = this.#lateTailGeneration;
    void this.#runtime.delay(LATE_TAIL_FLUSH_MS).then(() => {
      if (generation !== this.#lateTailGeneration || this.#lateTail.length === 0) return;
      // Not a reply after all (a lone Esc): deliver what was held.
      const held = this.#lateTail;
      this.#lateTail = Buffer.alloc(0);
      if (!this.#ended && this.#gate === "open") this.#dispatch(held);
    });
    return data.subarray(0, data.length - keep);
  }

  #onInput = (value: Buffer | string): void => {
    let chunk: Buffer = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value);
    // The detach byte closes the station from any state, transitions included.
    if (chunk.includes(DETACH_BYTE)) {
      this.#end("detach");
      return;
    }
    this.#observeOuterFocus(chunk);
    if (this.#sentinelWaiter) {
      // Everything that arrives before the sentinel reply is dropped.
      if (chunk.indexOf(SENTINEL_REPLY_BYTES) >= 0) this.#sentinelWaiter();
      this.#emit({ type: "input-dropped", bytes: chunk.length, reason: "transition" });
      return;
    }
    if (this.#gate === "frozen") {
      this.#emit({ type: "input-dropped", bytes: chunk.length, reason: "transition" });
      return;
    }
    if (this.#lateSentinels > 0 || this.#lateTail.length > 0) {
      chunk = this.#swallowLateSentinel(chunk);
      if (chunk.length === 0) return;
    }
    this.#dispatch(chunk);
  };

  #dispatch(chunk: Buffer): void {
    const handled = this.#panel.handleInputBytes(chunk, this.#inputContext());
    this.#pendingEscapeAt = this.#panel.hasPendingEscape() ? this.#runtime.now() : undefined;
    this.#applyPanelResult(handled);
  }

  #applyPanelResult(handled: RightPanelHandleResult): void {
    for (const action of handled.actions) {
      if (action.type === "detach") {
        this.#end("detach");
        return;
      }
      if (action.type === "toggle") {
        this.#bar?.onRightPanelGeometryChange();
        this.#liveView()?.sendChildResize();
      } else if (action.type === "activate-session") {
        if (action.sessionId !== undefined) this.#requestActivation(action.sessionId, false);
      } else if (action.type === "select-tab") {
        const title = this.#rawSnapshot?.workspaces[action.index]?.title;
        if (title !== undefined) {
          this.#persist(withActiveTab(this.#state, title));
          // Each tab remembers its last displayed session (r2 §2.3).
          const remembered = this.#state.lastSessionByTab[title];
          if (remembered !== undefined) this.#panel.selectSessionById(remembered);
        }
      } else if (action.type === "activate-extra-row") {
        this.#activateExtraRow(action.sessionId, action.rowId);
      }
    }
    for (const mouse of handled.forwardedMouse ?? []) {
      if (mouse.wheel || mouse.motion) continue;
      this.#heldPress = mouse.release
        ? undefined
        : { button: mouse.button, x: mouse.x, y: mouse.y, mode: mouse.mode, encoding: mouse.encoding };
    }
    if (handled.forwardBytes && handled.forwardBytes.length > 0) {
      this.#toChild(handled.forwardBytes);
    }
  }

  #toChild(bytes: Buffer): void {
    const view = this.#liveView();
    if (!view) {
      this.#emit({ type: "input-dropped", bytes: bytes.length, reason: "no-session" });
      return;
    }
    if (this.#inputClosedUntilReconnect) {
      this.#emit({ type: "input-dropped", bytes: bytes.length, reason: "closed" });
      return;
    }
    if (view.enqueueInput(bytes, ATTACH_PENDING_INPUT_MAX_BYTES)) return;
    // Queue saturated during a reconnection: purge with a notice; the input
    // reopens once the session is reacquired (never a silent detach).
    const dropped = view.purgePendingInput() + bytes.length;
    this.#inputClosedUntilReconnect = true;
    this.#emit({ type: "input-purged", bytes: dropped, reason: "queue-full" });
    this.#notice("station.notice.inputPurged");
    this.#logCrash({ event: "refusal", sessionId: view.sessionId, reason: "input-buffer-full" });
  }

  #notice(key: string, vars: Readonly<Record<string, string | number>> = {}): void {
    this.#emit({ type: "notice", key });
    if (this.#panel.isOpen()) {
      this.#showCard([this.#t(key, vars)], this.#t("station.card.dismiss"));
    }
  }

  #flushPanelEscape(): void {
    if (
      this.#pendingEscapeAt === undefined ||
      this.#runtime.now() - this.#pendingEscapeAt < PANEL_ESCAPE_FLUSH_MS
    ) {
      return;
    }
    this.#pendingEscapeAt = undefined;
    this.#applyPanelResult(this.#panel.flushPending(this.#inputContext()));
  }

  // --- cards and gestures -----------------------------------------------------

  #showCard(text: readonly string[], prompt: string, onConfirm?: () => void): void {
    this.#recoveryView = undefined;
    this.#panel.setOverlay(
      new StationCardOverlay({
        text,
        prompt,
        onConfirm,
        onClose: () => this.#panel.setOverlay(undefined),
      }),
    );
  }

  #refusalText(
    sessionId: string,
    reason: StationRefusalReason,
    state?: NativeTerminalSessionState,
  ): string {
    const session = this.#sessionLabel(sessionId);
    switch (reason) {
      case "controlled-elsewhere": {
        const holder = state?.controller;
        return holder
          ? this.#t("station.card.controlledElsewhere", {
              session,
              pid: holder.pid ?? "unknown",
              tty: holder.tty,
              since: holder.since,
            })
          : this.#t("station.card.controlledUnknown", { session });
      }
      case "ended":
        return this.#endedText(session, state);
      case "absent":
        return this.#t("station.card.absent", { session });
      case "unknown-view":
        return this.#t("station.card.unknownView", { session });
      case "ambiguous-owner":
        return this.#t("station.card.ambiguousOwner", { session });
      case "host-silent":
        return this.#t("station.card.hostSilent", { session });
      case "input-in-flight":
        return this.#t("station.card.inputInFlight", {
          session,
          current: this.#displayed?.label ?? "",
        });
    }
  }

  #endedText(session: string, state?: NativeTerminalSessionState): string {
    if (state?.stopSignal) return this.#t("station.card.stopped", { session, signal: state.stopSignal });
    const code = state?.exit?.exitCode;
    return typeof code === "number"
      ? this.#t("station.card.ended", { session, code })
      : this.#t("station.card.endedUnknown", { session });
  }

  /** A switch that is refused leaves the station exactly where it was. */
  #refuse(
    sessionId: string,
    reason: StationRefusalReason,
    state?: NativeTerminalSessionState,
  ): "refused" {
    this.#emit({ type: "switch-refused", sessionId, reason });
    this.#emit({ type: "card", kind: reason, sessionId });
    const text = this.#refusalText(sessionId, reason, state);
    if (reason === "controlled-elsewhere") {
      // I5: taking a session held elsewhere needs an explicit, confirmed gesture.
      this.#showCard([text], this.#t("station.card.takeoverConfirm"), () =>
        this.#requestActivation(sessionId, true),
      );
    } else {
      this.#showCard([text], this.#t("station.card.dismiss"));
    }
    if (reason === "absent" || reason === "ended") void this.#refresher.maybeRefresh(true);
    return "refused";
  }

  #activateExtraRow(sessionId: string, rowId: string): void {
    const session = this.#sessionLabel(sessionId);
    const confirm = (key: string, run: () => Promise<void>): void =>
      this.#showCard([this.#t(key, { session })], this.#t("station.confirm.prompt"), () => {
        void run().catch(() => {});
      });
    if (rowId === "guard-release") confirm("station.confirm.guardRelease", () => this.#releaseGuard(sessionId));
    else if (rowId === "guard-keep") confirm("station.confirm.guardKeep", () => this.#keepGuard(sessionId));
    else if (rowId === "pin-set") confirm("station.confirm.pinSet", () => this.#setManualPin(sessionId, true));
    else if (rowId === "pin-remove") confirm("station.confirm.pinRemove", () => this.#setManualPin(sessionId, false));
    else if (rowId.startsWith("draft:")) void this.#openRecoveryView(sessionId, rowId).catch(() => {});
  }

  async #releaseGuard(sessionId: string): Promise<void> {
    const guard = this.#guards.get(sessionId);
    if (!guard) return;
    const link = this.#links.get(guard.socketPath);
    try {
      await link?.client.releaseController(guard.lease);
    } catch (error) {
      if (!isHostAnswer(error)) this.#dropLink(guard.socketPath);
    }
    this.#dropGuard(sessionId, "released");
    this.#emit({ type: "gesture", gesture: "guard-release", sessionId, outcome: "released" });
    void this.#refresher.maybeRefresh(true);
    this.#redecorate();
  }

  async #keepGuard(sessionId: string): Promise<void> {
    let outcome = "kept";
    try {
      const owner = await this.#resolveOwner(sessionId);
      if (owner.state !== "found") throw new Error(owner.state);
      const link = await this.#link(owner.socketPath);
      if (link.brokerProtected) throw new Error("refused-no-capability");
      // A guard lease is never written to nor resized, and never taken by force.
      const lease = await link.client.acquireController(sessionId, this.#controllerId, "human", {
        pid: this.#pid,
        tty: this.#tty,
      });
      this.#guards.set(sessionId, { lease, socketPath: link.socketPath });
      this.#persist(
        withCompatGuard(this.#state, sessionId, {
          generation: lease.generation,
          incarnation: lease.incarnation,
        }),
      );
      this.#emit({ type: "guard", action: "kept", sessionId });
    } catch (error) {
      outcome = error instanceof Error ? singleLine(error.message) : "refused";
      this.#showCard([`${this.#sessionLabel(sessionId)}: ${outcome}`], this.#t("station.card.dismiss"));
    }
    this.#emit({ type: "gesture", gesture: "guard-keep", sessionId, outcome });
    void this.#refresher.maybeRefresh(true);
    this.#redecorate();
  }

  /** `set-manual-pin`: the host is the authority; the value shown is read back. */
  async #setManualPin(sessionId: string, manualPin: boolean): Promise<void> {
    let outcome = "acknowledged";
    try {
      const owner = await this.#resolveOwner(sessionId);
      if (owner.state !== "found") throw new Error(owner.state);
      const link = await this.#link(owner.socketPath);
      if (!link.brokerProtected || typeof link.client.setManualPin !== "function") {
        throw new Error("refused-no-capability");
      }
      await link.client.setManualPin({
        sessionId,
        incarnation: owner.session.incarnation,
        manualPin,
      });
    } catch (error) {
      outcome = error instanceof Error ? singleLine(error.message) : "refused";
      this.#showCard([`${this.#sessionLabel(sessionId)}: ${outcome}`], this.#t("station.card.dismiss"));
    }
    this.#emit({
      type: "gesture",
      gesture: manualPin ? "pin-set" : "pin-remove",
      sessionId,
      outcome,
    });
    // Whatever the gesture returned, the line shows the value read from the host.
    await this.#refresher.maybeRefresh(true);
    this.#redecorate();
  }

  // --- draft recovery view ----------------------------------------------------

  #draftLabels(): DraftRecoveryLabels {
    const same = <T extends string>(values: readonly T[]): Record<T, string> =>
      Object.fromEntries(values.map((value) => [value, value])) as unknown as Record<T, string>;
    return {
      title: this.#t("station.row.draftKept"),
      // Outcome codes are machine values: never localised.
      submission: same(["pending", "submitted", "uncertain", "refused"] as const),
      draft: same(["untouched", "restoring-on-ready", "restored", "saved-for-recovery"] as const),
      message: this.#t("station.draft.message"),
      draftWord: this.#t("station.draft.draftWord"),
      bytes: this.#t("station.draft.bytes"),
      purged: this.#t("station.draft.purged"),
      retainedKeystrokes: this.#t("station.draft.retainedKeystrokes"),
      actions: {
        export: this.#t("station.draft.action.export"),
        replace: this.#t("station.draft.action.replace"),
        delete: this.#t("station.draft.action.delete"),
      },
      confirm: this.#t("station.confirm.prompt"),
      hint: this.#t("station.draft.hint"),
    };
  }

  #draftRecord(ref: StationDraftRef): DraftRecoveryRecord | undefined {
    return this.#draftStatus
      .get(ref.sessionId)
      ?.drafts?.find(
        (draft) =>
          draft.applicationIncarnation === ref.applicationIncarnation &&
          draft.requestId === ref.requestId,
      );
  }

  async #draftLink(sessionId: string): Promise<HostLink | undefined> {
    const owner = this.#inventory?.sessions.find((session) => session.id === sessionId);
    if (!owner) return undefined;
    try {
      return await this.#link(owner.socketPath);
    } catch {
      return undefined;
    }
  }

  async #openRecoveryView(sessionId: string, rowId: string): Promise<void> {
    const [, applicationIncarnation, requestId] = rowId.split(":");
    if (applicationIncarnation === undefined || requestId === undefined) return;
    const ref: StationDraftRef = { sessionId, applicationIncarnation, requestId };
    const summary = this.#draftRecord(ref);
    if (!summary) return;
    const link = await this.#draftLink(sessionId);
    let content: Uint8Array | undefined;
    try {
      content = await link?.client.readDraft?.(ref);
    } catch {
      content = undefined;
    }
    const view = new DraftRecoveryView({ ...summary, content }, this.#draftLabels(), {
      onAction: (action) => {
        void this.#runDraftAction(ref, action).catch(() => {});
      },
      onClose: () => {
        this.#recoveryView = undefined;
        this.#panel.setOverlay(undefined);
      },
    });
    this.#recoveryView = { view, ref };
    this.#panel.setOverlay(view);
  }

  /** The view follows the host: a proven restitution purges what it shows. */
  #refreshRecoveryView(): void {
    const open = this.#recoveryView;
    if (!open) return;
    const summary = this.#draftRecord(open.ref);
    if (!summary) return;
    const keepContent = summary.draft !== "restored" ? open.view.record.content : undefined;
    open.view.update({ ...summary, content: keepContent });
    if (this.#panel.overlay() === open.view) this.#panel.paint();
  }

  async #runDraftAction(ref: StationDraftRef, action: DraftRecoveryAction): Promise<void> {
    const open = this.#recoveryView;
    if (!open || open.ref !== ref) return;
    const label = this.#draftLabels().actions[action];
    let status: string;
    if (action === "export") {
      status = this.#exportDraft(open.view.record);
    } else {
      const link = await this.#draftLink(ref.sessionId);
      const operation = action === "replace" ? link?.client.replaceDraft : link?.client.deleteDraft;
      let outcome: StationDraftOutcome;
      try {
        outcome =
          link && typeof operation === "function"
            ? await operation.call(link.client, ref)
            : { ok: false, reason: "refused-no-capability" };
      } catch (error) {
        outcome = { ok: false, reason: error instanceof Error ? singleLine(error.message) : "refused" };
      }
      status = outcome.ok ? this.#t("station.draft.done", { action: label }) : outcome.reason;
      this.#emit({
        type: "gesture",
        gesture: `draft-${action}`,
        sessionId: ref.sessionId,
        outcome: outcome.ok ? "done" : outcome.reason,
      });
      await this.#refresher.maybeRefresh(true);
      if (outcome.ok && action === "delete") {
        this.#recoveryView = undefined;
        this.#panel.setOverlay(undefined);
        this.#redecorate();
        return;
      }
    }
    if (this.#recoveryView?.ref === ref) {
      this.#recoveryView.view.setStatus(status);
      this.#panel.paint();
    }
    this.#redecorate();
  }

  /** Raw export: the exact saved bytes, in an owner-only file. */
  #exportDraft(record: DraftRecoveryRecord): string {
    const bytes = draftExportBytes(record);
    const directory =
      this.#options.exportDir ??
      (this.#options.statePath !== undefined
        ? join(dirname(this.#options.statePath), "draft-exports")
        : undefined);
    let outcome: string;
    let status: string;
    if (bytes === undefined || directory === undefined) {
      outcome = "unavailable";
      status = this.#t("station.draft.exportFailed", { reason: "unavailable" });
    } else {
      const safe = (value: string): string => value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
      const path = join(
        directory,
        `${safe(record.sessionId)}-${safe(record.requestId)}-${this.#runtime.now()}.bin`,
      );
      try {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        // `wx`: never overwrite, never follow a planted symlink.
        writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
        outcome = path;
        status = this.#t("station.draft.exported", { path });
      } catch (error) {
        outcome = "failed";
        status = this.#t("station.draft.exportFailed", {
          reason: (error as NodeJS.ErrnoException | undefined)?.code ?? "error",
        });
      }
    }
    this.#emit({ type: "gesture", gesture: "draft-export", sessionId: record.sessionId, outcome });
    return status;
  }

  // --- switch -----------------------------------------------------------------

  /** t0, synchronously with the gesture that asks for the switch. */
  #requestActivation(sessionId: string, takeover: boolean): void {
    const view = this.#liveView();
    if (
      view !== undefined &&
      view.sessionId === sessionId &&
      view.active !== undefined &&
      view.transportFailure === undefined
    ) {
      // A→A under a valid lease: no request, no reset, no card.
      this.#panel.focusCli();
      this.#emit({ type: "same-session", sessionId });
      return;
    }
    this.#freeze();
    this.#request = { type: "activate", sessionId, takeover };
    this.#wakeLoop();
  }

  /** Freeze the input and drop what was still queued for the session shown. */
  #freeze(): void {
    this.#gate = "frozen";
    const dropped = this.#view?.purgePendingInput() ?? 0;
    if (dropped > 0) this.#emit({ type: "input-purged", bytes: dropped, reason: "transition" });
  }

  /** t2 — hold B before leaving A. */
  async #hold(
    link: HostLink,
    state: NativeTerminalSessionState,
    takeover: boolean,
  ): Promise<HoldResult> {
    const sessionId = state.id;
    const guard = this.#guards.get(sessionId);
    if (guard) {
      // A guard is promoted only after a fresh comparison of
      // generation/incarnation/controllerEpoch.
      if (guard.socketPath === link.socketPath && this.#guardIsCurrent(guard, state)) {
        this.#guards.delete(sessionId);
        this.#emit({ type: "guard", action: "promoted", sessionId });
        return { ok: true, lease: guard.lease, wasGuard: true };
      }
      // That lease alone is retired; the shared client stays open.
      this.#dropGuard(sessionId, "stale");
    }
    const acquire = (): Promise<NativeTerminalControllerLease> =>
      link.client.acquireController(sessionId, this.#controllerId, "human", {
        takeover,
        pid: this.#pid,
        tty: this.#tty,
      });
    try {
      return { ok: true, lease: await acquire(), wasGuard: false };
    } catch (error) {
      if (isAlreadyControlled(error)) {
        const holder = state.controller;
        if (holder === undefined || holder === null || holder.tty === "unknown") {
          // A lease without terminal identity is short-lived: one retry.
          await this.#runtime.delay(STATION_UNKNOWN_TTY_RETRY_MS);
          try {
            return { ok: true, lease: await acquire(), wasGuard: false };
          } catch (retryError) {
            if (!isAlreadyControlled(retryError)) return this.#holdFailure(link, retryError);
          }
        }
        let fresh = state;
        try {
          fresh = await link.client.state(sessionId);
        } catch {
          /* keep the state read at t1 for the card */
        }
        return { ok: false, reason: "controlled-elsewhere", state: fresh };
      }
      return this.#holdFailure(link, error);
    }
  }

  #holdFailure(link: HostLink, error: unknown): HoldResult {
    if (isDefinitiveNativeTerminalAbsence(error)) return { ok: false, reason: "absent" };
    if (isHostAnswer(error)) return { ok: false, reason: "ended" };
    this.#dropLink(link.socketPath);
    return { ok: false, reason: "host-silent" };
  }

  /** Undo the hold of a switch that is abandoned before A was left. */
  async #giveBack(link: HostLink, held: Extract<HoldResult, { ok: true }>): Promise<void> {
    if (held.wasGuard) {
      this.#guards.set(held.lease.id, { lease: held.lease, socketPath: link.socketPath });
      return;
    }
    try {
      await link.client.releaseController(held.lease);
    } catch (error) {
      if (!isHostAnswer(error)) this.#dropLink(link.socketPath);
    }
  }

  /** t3 — bounded wait for the human write still in flight to A. */
  async #inFlightSettled(view: NativeSessionView): Promise<boolean> {
    if (!view.hasInFlightInput()) return true;
    let settled = false;
    await Promise.race([
      view.drainInputPump().then(() => {
        settled = true;
      }),
      this.#runtime.delay(STATION_SWITCH_INPUT_WAIT_MS),
    ]);
    return settled || !view.hasInFlightInput();
  }

  /** t3 — leave A: synthetic release and focus-out, modes undone, guard or release. */
  async #leave(view: NativeSessionView): Promise<void> {
    const current = view.active;
    const displayed = this.#displayed;
    if (current !== undefined && view.transportFailure === undefined) {
      const press = this.#heldPress;
      const synthetic =
        (press ? syntheticMouseRelease(press) : "") +
        (view.modes.isFocusReportingEnabled() ? FOCUS_OUT : "");
      if (synthetic.length > 0) {
        try {
          await current.client.write(current.lease, synthetic);
        } catch {
          /* the session is being left: a lost synthetic event changes nothing */
        }
      }
    }
    this.#heldPress = undefined;
    view.detached = true;
    view.leaveForSwitch();
    this.#stdout.write(STATION_MOTION_OFF);
    view.active = undefined;
    if (current !== undefined && displayed !== undefined) {
      const link = this.#links.get(displayed.socketPath);
      if (link === undefined || view.transportFailure !== undefined) {
        /* the connection is gone and its leases with it */
      } else if (link.brokerProtected) {
        // The host protects the composer: A is released, adapter or not.
        try {
          await link.client.releaseController(current.lease);
        } catch (error) {
          if (!isHostAnswer(error)) this.#dropLink(link.socketPath);
        }
        this.#emit({ type: "lease-released", sessionId: view.sessionId });
      } else {
        // Compatibility guard: the lease is kept, never written to nor resized.
        this.#guards.set(view.sessionId, { lease: current.lease, socketPath: link.socketPath });
        this.#persist(
          withCompatGuard(this.#state, view.sessionId, {
            generation: current.lease.generation,
            incarnation: current.lease.incarnation,
          }),
        );
        this.#emit({ type: "guard", action: "kept", sessionId: view.sessionId });
      }
    }
    view.dispose();
    this.#view = undefined;
    this.#bar = undefined;
  }

  #sizeKey(state: Pick<NativeTerminalSessionState, "id" | "generation" | "incarnation">): string {
    return `${state.id}\u0000${state.generation}\u0000${state.incarnation}`;
  }

  #setTitle(): void {
    const displayed = this.#displayed;
    if (!displayed || !this.#titlePushed) return;
    const title = singleLine(
      this.#t("station.title", { group: displayed.tab ?? "other", session: displayed.label }),
      120,
    ).replace(/[\x07\x1b]/g, "");
    this.#stdout.write(`${ESC}]2;${title}\x07`);
  }

  /** t5 — paint B: its own bar, its lease, then the filtered replay. */
  async #paint(
    link: HostLink,
    lease: NativeTerminalControllerLease,
    state: NativeTerminalSessionState,
  ): Promise<void> {
    const sessionId = state.id;
    const bar = this.#options.createStatusBar(sessionId);
    bar.setRightPanel(this.#panel);
    bar.setRightPanelMarkerProvider(() => this.#panel.statusBarMarker());
    bar.setSelectedDelegatedNamesProvider(() => this.#panel.selectedDelegatedNamesForBar());
    const sizeKey = this.#sizeKey(state);
    const view = createSessionView({
      sessionId,
      stdout: this.#stdout,
      now: () => this.#runtime.now(),
      tty: this.#tty,
      statusBar: bar,
      ownOuterMouse: true,
      saveTerminalReset: this.#runtime.saveTerminalReset,
      getChildCols: () => this.#panel.childCols(this.#stdout.columns ?? 0),
      onCrashLog: this.#logCrash,
      controllerId: this.#controllerId,
      onControllerLost: (loss) => {
        this.#pendingLoss = loss;
      },
      // S1.6: a session is resized only when its geometry really differs.
      resizeGate: (cols, rows) => {
        const last = this.#sizes.get(sizeKey);
        if (last !== undefined && last.cols === cols && last.rows === rows) return false;
        this.#sizes.set(sizeKey, { cols, rows });
        return true;
      },
    });
    bar.setOnBeforeActivate(() => view.saveReset());
    if (this.#titlePushed) view.undoRegistry.set("h2a-title", STATION_TITLE_POP);
    this.#view = view;
    this.#bar = bar;
    this.#pendingLoss = undefined;
    this.#displayed = {
      id: sessionId,
      socketPath: link.socketPath,
      label: this.#sessionLabel(sessionId),
      tab: this.#tabOf(sessionId),
      generation: state.generation,
      incarnation: state.incarnation,
    };
    // Publish-then-enable: the receipt knows the mouse before it is on again.
    view.enableOuterMouse();
    await view.attachLease({ client: this.#viewClient(link), lease }, () => {
      this.#panel.paint();
    });
    this.#setTitle();
    const tab = this.#displayed.tab;
    if (tab !== undefined) this.#persist(withDisplayedSession(this.#state, tab, sessionId));
    this.#redecorate();
    this.#catchUpPending = true;
    this.#idlePollMs = IDLE_POLL_MIN_MS;
    this.#statePollMs = STATE_POLL_MS;
    this.#nextStatePollAt = this.#runtime.now() + this.#statePollMs;
    await this.#follow(view);
  }

  /** t6 — bounded station status request; a late reply is swallowed later. */
  async #sentinel(): Promise<void> {
    if (this.#stdin.isTTY !== true || (this.#stdout as { isTTY?: boolean }).isTTY !== true) {
      this.#emit({ type: "sentinel", outcome: "skipped" });
      return;
    }
    let answered = false;
    const reply = new Promise<void>((resolve) => {
      this.#sentinelWaiter = () => {
        answered = true;
        resolve();
      };
    });
    this.#stdout.write(STATION_SENTINEL_QUERY);
    await Promise.race([reply, this.#runtime.delay(this.#sentinelTimeoutMs)]);
    this.#sentinelWaiter = undefined;
    if (answered) {
      this.#emit({ type: "sentinel", outcome: "answered" });
    } else {
      this.#lateSentinels += 1;
      this.#emit({ type: "sentinel", outcome: "timeout" });
    }
  }

  async #switchTo(
    sessionId: string,
    options: { initial?: boolean; takeover?: boolean } = {},
  ): Promise<"displayed" | "refused" | "same"> {
    const from = this.#view;
    const fromLive = this.#liveView();
    if (
      fromLive !== undefined &&
      fromLive.sessionId === sessionId &&
      fromLive.active !== undefined &&
      fromLive.transportFailure === undefined
    ) {
      this.#panel.focusCli();
      this.#emit({ type: "same-session", sessionId });
      return "same";
    }
    this.#freeze();
    try {
      // t1 — read B at its owner.
      const owner = await this.#resolveOwner(sessionId);
      if (owner.state === "absent") return this.#refuse(sessionId, "absent");
      if (owner.state === "ambiguous-owner") return this.#refuse(sessionId, "ambiguous-owner");
      if (owner.state === "unknown") return this.#refuse(sessionId, "unknown-view");
      let link: HostLink;
      let state: NativeTerminalSessionState;
      try {
        link = await this.#link(owner.socketPath);
        state = await link.client.state(sessionId);
      } catch (error) {
        if (isDefinitiveNativeTerminalAbsence(error)) return this.#refuse(sessionId, "absent");
        if (!isHostAnswer(error)) this.#dropLink(owner.socketPath);
        return this.#refuse(sessionId, "host-silent");
      }
      if (state.status !== "running") return this.#refuse(sessionId, "ended", state);

      // t2 — hold B before leaving A.
      const held = await this.#hold(link, state, options.takeover === true);
      if (!held.ok) return this.#refuse(sessionId, held.reason, held.state ?? state);

      // t3 — leave A (or discard a view that already ended on a card).
      if (fromLive !== undefined) {
        if (!(await this.#inFlightSettled(fromLive))) {
          await this.#giveBack(link, held);
          return this.#refuse(sessionId, "input-in-flight");
        }
        await this.#leave(fromLive);
      } else if (from !== undefined) {
        from.dispose();
        this.#view = undefined;
        this.#bar = undefined;
      }

      // t4 — neutral terminal. The very first paint keeps the shell scrollback.
      if (options.initial !== true) this.#stdout.write(STATION_NEUTRAL_SEQUENCE);

      // t5 — paint B.
      let fresh = state;
      try {
        fresh = await link.client.state(sessionId);
      } catch {
        /* the follow loop reports what happens next */
      }
      await this.#paint(link, held.lease, fresh);

      // t6 — sentinel, focus-in, open the input for B.
      const view = this.#liveView();
      this.#panel.setOverlay(undefined);
      if (view !== undefined && view.active !== undefined) {
        await this.#sentinel();
        if (view.modes.isFocusReportingEnabled() && this.#outerFocus !== "lost") {
          const active = view.active;
          if (active !== undefined) {
            await active.client.write(active.lease, FOCUS_IN).catch(() => {});
          }
        }
        this.#panel.focusCli();
        this.#emit({
          type: "displayed",
          sessionId,
          tab: this.#displayed?.tab,
          socketPath: link.socketPath,
          panelOpen: this.#panel.isOpen(),
          initial: options.initial === true,
        });
      }
      return "displayed";
    } finally {
      // Refused: the station is back on A, unchanged. Displayed: B is open.
      this.#gate = "open";
    }
  }

  // --- following the displayed session -------------------------------------------

  /** The displayed session is over for this station: card, never an exit. */
  async #cardOnDisplayed(kind: StationCardKind, text: string): Promise<void> {
    const view = this.#view;
    if (!view) return;
    const sessionId = view.sessionId;
    view.detached = true;
    view.terminalEnded = true;
    view.flushRelay();
    view.leaveForSwitch();
    this.#stdout.write(
      `${STATION_MOTION_OFF}\r\n[h2a] ${text}\r\n[h2a] ${this.#t("station.card.selectAnother")}\r\n`,
    );
    const current = view.active;
    view.active = undefined;
    if (current !== undefined && kind !== "controlled-elsewhere") {
      await current.client.releaseController(current.lease).catch(() => {});
    }
    this.#heldPress = undefined;
    this.#pendingLoss = undefined;
    view.dispose();
    this.#bar = undefined;
    this.#emit({ type: "card", kind, sessionId });
    this.#panel.paint();
    this.#redecorate();
    void this.#refresher.maybeRefresh(true);
  }

  async #afterState(
    view: NativeSessionView,
    state: NativeTerminalSessionState,
    lease: NativeTerminalControllerLease,
  ): Promise<boolean> {
    if (view.controllerChanged(state, lease)) {
      await this.#cardOnDisplayed(
        state.status === "exited" ? "ended" : "controlled-elsewhere",
        state.status === "exited"
          ? this.#endedText(this.#sessionLabel(view.sessionId), state)
          : this.#refusalText(view.sessionId, "controlled-elsewhere", state),
      );
      return true;
    }
    if (state.status === "exited") {
      this.#logCrash(
        sessionExitCrashEntry(state, { sessionId: view.sessionId, detail: "session exited in station" }),
      );
      await this.#cardOnDisplayed("ended", this.#endedText(this.#sessionLabel(view.sessionId), state));
      return true;
    }
    return false;
  }

  async #follow(view: NativeSessionView): Promise<void> {
    const current = view.active;
    if (current === undefined) return;
    try {
      const replay = await current.client.readOutput(
        view.sessionId,
        view.seq,
        NATIVE_TERMINAL_INTERACTIVE_READ_TIMEOUT_MS,
      );
      if (this.#ended || this.#view !== view) return;
      // Retained bytes repainted at a switch (or after a gap) are a catch-up:
      // queries and one-shot side effects are filtered. Live output never is.
      const catchUp = this.#catchUpPending || (replay.gap !== null && replay.gap !== undefined);
      this.#catchUpPending = false;
      view.feedReplay(replay, { catchUp });
      this.#flushPanelEscape();
      void this.#refresher.maybeRefresh();
      await view.statusBar.probe(false);
      view.seq = replay.latestSeq;
      this.#idlePollMs =
        replay.chunks.length === 0
          ? Math.min(IDLE_POLL_MAX_MS, this.#idlePollMs * 2)
          : IDLE_POLL_MIN_MS;
      if (replay.state !== undefined) {
        this.#statePollMs = STATE_POLL_MS;
        this.#nextStatePollAt = this.#runtime.now() + this.#statePollMs;
        await this.#afterState(view, replay.state, current.lease);
      } else if (this.#runtime.now() >= this.#nextStatePollAt) {
        let state: NativeTerminalSessionState | undefined;
        try {
          state = await current.client.state(view.sessionId);
          this.#statePollMs = STATE_POLL_MS;
        } catch (stateError) {
          if (!isStateRequestTimeout(stateError)) throw stateError;
          this.#statePollMs = Math.min(STATE_POLL_MAX_MS, this.#statePollMs * 2);
        }
        this.#nextStatePollAt = this.#runtime.now() + this.#statePollMs;
        if (state !== undefined) await this.#afterState(view, state, current.lease);
      }
    } catch (error) {
      if (this.#ended || this.#view !== view) return;
      if (isDefinitiveNativeTerminalAbsence(error)) {
        this.#logCrash(
          sessionExitCrashEntry(
            { exit: null, stopSignal: null },
            { sessionId: view.sessionId, reason: "definitive-absence", detail: "session proven absent in station" },
          ),
        );
        await this.#cardOnDisplayed(
          "disappeared",
          this.#t("station.card.disappeared", { session: this.#sessionLabel(view.sessionId) }),
        );
        return;
      }
      view.markTransportFailure(current, error);
      await this.#settleLoss(view);
    }
  }

  /** A stale lease (takeover or stop) ends the view on a card. */
  async #settleLoss(view: NativeSessionView): Promise<void> {
    const loss = this.#pendingLoss;
    if (loss === undefined || !view.terminalEnded) return;
    this.#pendingLoss = undefined;
    let state = loss.state;
    if (state === undefined) {
      const link = this.#displayed ? this.#links.get(this.#displayed.socketPath) : undefined;
      try {
        state = await link?.client.state(view.sessionId);
      } catch {
        state = undefined;
      }
    }
    if (state?.status === "exited") {
      await this.#cardOnDisplayed("ended", this.#endedText(this.#sessionLabel(view.sessionId), state));
      return;
    }
    await this.#cardOnDisplayed(
      "controlled-elsewhere",
      this.#refusalText(view.sessionId, "controlled-elsewhere", state),
    );
  }

  /** One reconnection attempt; the loop paces the next one. */
  async #reconnect(view: NativeSessionView): Promise<boolean> {
    const displayed = this.#displayed;
    if (!displayed) return false;
    const startedAt = view.interruptedAt ?? this.#runtime.now();
    const cause =
      view.transportFailure instanceof Error
        ? view.transportFailure.message
        : view.transportFailure !== undefined
          ? String(view.transportFailure)
          : "connection interrupted";
    const reason =
      view.transportFailure instanceof NativeTerminalRequestTimeoutError
        ? `timeout:${view.transportFailure.operation}`
        : "transport-interrupted";
    view.closeActive();
    this.#dropLink(displayed.socketPath);
    await view.statusBar.probe(false, "reconnecting");
    const session = this.#sessionLabel(view.sessionId);
    try {
      // New inventory: the owner endpoint may have been replaced.
      const owner = await this.#resolveOwner(view.sessionId, true);
      if (owner.state === "absent") {
        await this.#cardOnDisplayed("disappeared", this.#t("station.card.disappeared", { session }));
        return true;
      }
      if (owner.state !== "found") throw new Error(`owner ${owner.state}`);
      const link = await this.#link(owner.socketPath);
      const state = await link.client.state(view.sessionId);
      if (state.status === "exited") {
        this.#logCrash(
          sessionExitCrashEntry(state, {
            sessionId: view.sessionId,
            detail: `session exited during reconnect (${cause})`,
          }),
        );
        await this.#cardOnDisplayed("ended", this.#endedText(session, state));
        return true;
      }
      // Never by force: a reconnection must not take the session back.
      const lease = await link.client.acquireController(view.sessionId, this.#controllerId, "human", {
        pid: this.#pid,
        tty: this.#tty,
      });
      displayed.socketPath = link.socketPath;
      displayed.generation = state.generation;
      displayed.incarnation = state.incarnation;
      await view.attachLease({ client: this.#viewClient(link), lease }, () => {
        view.enableOuterMouse();
        this.#panel.paint();
        void this.#refresher.maybeRefresh(true);
      });
      view.interruptedAt = undefined;
      this.#inputClosedUntilReconnect = false;
      this.#reconnectDelayMs = RECONNECT_MIN_MS;
      this.#idlePollMs = IDLE_POLL_MIN_MS;
      this.#nextStatePollAt = this.#runtime.now() + STATE_POLL_MS;
      await this.#reacquireGuards(link);
      this.#logCrash({
        event: "reconnect",
        sessionId: view.sessionId,
        instanceId: state.generation,
        reason,
        durationMs: Math.max(0, this.#runtime.now() - startedAt),
        detail: `station reconnected (${cause})`,
      });
      this.#emit({ type: "reconnected", sessionId: view.sessionId });
      this.#redecorate();
      return true;
    } catch (error) {
      if (isAlreadyControlled(error)) {
        this.#logCrash({
          event: "refusal",
          sessionId: view.sessionId,
          reason: "already-has-controller",
          detail: error instanceof Error ? error.message : String(error),
        });
        let state: NativeTerminalSessionState | undefined;
        try {
          state = await this.#links.get(displayed.socketPath)?.client.state(view.sessionId);
        } catch {
          state = undefined;
        }
        await this.#cardOnDisplayed(
          "controlled-elsewhere",
          this.#refusalText(view.sessionId, "controlled-elsewhere", state),
        );
        return true;
      }
      if (isDefinitiveNativeTerminalAbsence(error) && isHostAnswer(error)) {
        await this.#cardOnDisplayed("disappeared", this.#t("station.card.disappeared", { session }));
        return true;
      }
      if (!isHostAnswer(error)) this.#dropLink(displayed.socketPath);
      this.#reconnectDelayMs = Math.min(RECONNECT_MAX_MS, this.#reconnectDelayMs * 2);
      return false;
    }
  }

  // --- lifecycle ----------------------------------------------------------------

  #end(reason: "detach" | "stdin-end" | "terminate"): void {
    if (this.#ended) return;
    this.#ended = reason;
    this.#sentinelWaiter?.();
    this.#wakeLoop();
  }

  /** Persisted session, else the most recent of the first group, then the rest. */
  #initialCandidates(snapshot: RightPanelSnapshot): string[] {
    const candidates: string[] = [];
    const live = new Set(snapshot.workspaces.flatMap((w) => w.sessions.map((s) => s.id)));
    const push = (id: string | undefined): void => {
      if (id !== undefined && live.has(id) && !candidates.includes(id)) candidates.push(id);
    };
    const tab = this.#state.activeTab;
    if (tab !== undefined) push(this.#state.lastSessionByTab[tab]);
    for (const workspace of snapshot.workspaces) {
      const byRecency = [...workspace.sessions].sort(
        (a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0) || a.id.localeCompare(b.id, "en"),
      );
      for (const session of byRecency) push(session.id);
    }
    return candidates;
  }

  #buildPanel(): void {
    const options = this.#options.panel;
    const env = options?.env ?? process.env;
    let config: ReturnType<typeof readRemoteConfig> | undefined;
    try {
      config = options?.snapshotOptions?.config ?? readRemoteConfig();
    } catch {
      config = undefined;
    }
    const initial = buildRightPanelSnapshot({ groups: [], decisions: [], degraded: true });
    const stdout = this.#stdout;
    const started = (): boolean => this.#started;
    this.#panel = new RightPanelController({
      stdout: {
        get columns() {
          return stdout.columns;
        },
        get rows() {
          return stdout.rows;
        },
        write: (chunk: string) => (started() ? stdout.write(chunk) : true),
      },
      snapshot: initial,
      width: options?.width ?? resolveRightPanelWidth(env, config),
      onOpen: () => {
        const updated = this.#refresher?.markCurrentDecisionsSeen();
        if (updated) this.#applySnapshot(updated);
      },
      restoreChildState: () => this.#bar?.restoreChildStateSequence() ?? "",
      isStatusBarActive: () => this.#bar?.isActive() ?? false,
      onSelectionChange: () => {
        this.#bar?.paint(false);
      },
    });
    this.#trackCache =
      options?.snapshotOptions?.trackCache ?? new TrackJournalCache({ env });
    this.#refresher = new RightPanelSnapshotRefresher({
      currentSessionId: () => this.#displayed?.id,
      initialSnapshot: initial,
      now: () => this.#runtime.now(),
      minIntervalMs: options?.refreshIntervalMs ?? 1_000,
      load: (seen) => this.#loadSnapshot(seen),
      onUpdate: (next) => this.#applySnapshot(next),
    });
  }

  async run(): Promise<number> {
    if (this.#options.statePath !== undefined) {
      this.#state = readStationState(this.#options.statePath).state;
    }
    this.#buildPanel();
    // One inventory, one plan, before the terminal is touched.
    await this.#refresher.maybeRefresh(true);
    const snapshot = this.#rawSnapshot;
    const candidates = snapshot ? this.#initialCandidates(snapshot) : [];
    if (candidates.length === 0) {
      const key =
        this.#inventory !== undefined && !this.#inventory.complete
          ? "station.refusal.inventoryUnknown"
          : "station.refusal.noSession";
      const reason = this.#inventory?.hosts.find((host) => host.reason)?.reason ?? "unknown";
      this.#emit({ type: "notice", key });
      this.#stdout.write(`[h2a] ${this.#t(key, { reason: singleLine(reason) })}\r\n`);
      this.#refresher.dispose();
      for (const socketPath of [...this.#links.keys()]) this.#dropLink(socketPath);
      return 1;
    }

    const stdin = this.#stdin;
    const isRawCapable = stdin.isTTY === true;
    const wasRaw = stdin.isRaw === true;
    const terminate = (): void => {
      this.#ended ??= "terminate";
      try {
        const view = this.#view;
        if (view && !view.modesSuspended) {
          view.flushRelay();
          view.resetModes();
        } else {
          this.#stdout.write(this.#stationUndo.compose());
        }
      } finally {
        if (isRawCapable) stdin.setRawMode(wasRaw);
        stdin.pause();
        // Closing the connections releases every lease this station held.
        for (const socketPath of [...this.#links.keys()]) this.#dropLink(socketPath);
      }
    };
    const onEnd = (): void => this.#end("stdin-end");
    const resize = (): void => {
      const view = this.#liveView();
      view?.sendChildResize();
      view?.statusBar.onResize();
      this.#panel.onResize();
      view?.saveReset();
    };

    try {
      this.#started = true;
      if (isRawCapable) stdin.setRawMode(true);
      stdin.resume();
      stdin.on("data", this.#onInput);
      stdin.on("end", onEnd);
      this.#runtime.onResize(resize);
      this.#runtime.onTerminate?.(terminate);

      // Everything h2a puts on the outer terminal is published before it is on.
      this.#stationUndo.set("h2a-hygiene", `${ESC}[4l${ESC}[?6l${ESC}[r${ESC}[0m`);
      this.#stationUndo.set("h2a-mouse", H2A_OUTER_MOUSE_RESET);
      this.#stationUndo.set("h2a-title", STATION_TITLE_POP);
      this.#stationUndo.publish(this.#runtime.saveTerminalReset, true);
      this.#stdout.write(STATION_TITLE_PUSH);
      this.#titlePushed = true;

      // The panel opens at launch when the width allows it, focus on the CLI.
      const opened = this.#panel.setOpen(true, { focus: false });
      if (!opened) {
        this.#emit({ type: "notice", key: "station.notice.narrow" });
        this.#stdout.write(
          `[h2a] ${this.#t("station.notice.narrow", { cols: this.#stdout.columns ?? 0 })}\r\n`,
        );
      }

      await this.#reacquireAllGuards();
      let shown = false;
      for (const candidate of candidates) {
        if (this.#ended) break;
        if ((await this.#switchTo(candidate, { initial: true })) === "displayed") {
          shown = true;
          break;
        }
      }
      if (!shown && !this.#ended) {
        // Nothing could be displayed yet: the panel still lists every session.
        this.#stdout.write(H2A_OUTER_MOUSE_ENABLE);
        this.#panel.paint();
        this.#gate = "open";
      }

      while (!this.#ended) {
        const request = this.#request;
        if (request !== undefined) {
          this.#request = undefined;
          await this.#switchTo(request.sessionId, { takeover: request.takeover });
          continue;
        }
        const lost = this.#view;
        if (lost !== undefined && lost.terminalEnded && this.#pendingLoss !== undefined) {
          await this.#settleLoss(lost);
        }
        const view = this.#liveView();
        let pauseMs = this.#idlePollMs;
        if (view !== undefined) {
          if (view.active === undefined || view.transportFailure !== undefined) {
            const settled = await this.#reconnect(view);
            pauseMs = settled ? IDLE_POLL_MIN_MS : this.#reconnectDelayMs;
          } else {
            const before = view.seq;
            await this.#follow(view);
            if (view.seq !== before) pauseMs = ACTIVE_POLL_MS;
          }
        } else {
          this.#flushPanelEscape();
          void this.#refresher.maybeRefresh();
          pauseMs = IDLE_POLL_MAX_MS;
        }
        if (this.#ended || this.#request !== undefined) continue;
        this.#emit({ type: "idle" });
        await this.#pause(pauseMs);
      }
    } finally {
      const reason = this.#ended ?? "terminate";
      try {
        const view = this.#view;
        if (view && !view.modesSuspended) {
          view.flushRelay();
          view.restoreBarForNotice();
          this.#stdout.write(`\r\n[h2a] ${this.#t("station.notice.closed")}\r\n`);
          view.resetModes();
        } else {
          this.#stdout.write(
            `${this.#stationUndo.compose()}\r\n[h2a] ${this.#t("station.notice.closed")}\r\n`,
          );
          this.#runtime.saveTerminalReset?.("");
        }
      } finally {
        this.#runtime.offTerminate?.(terminate);
        this.#runtime.offResize(resize);
        stdin.removeListener("data", this.#onInput);
        stdin.removeListener("end", onEnd);
        if (isRawCapable) stdin.setRawMode(wasRaw);
        stdin.pause();
        const view = this.#view;
        if (view) {
          view.detached = true;
          await view.drainInputPump();
        }
        this.#refresher.dispose();
        this.#panel.dispose();
        if (view) {
          await view.releaseActive();
          view.dispose();
        }
        // The guards are persisted: a relaunch takes them again on old hosts.
        for (const socketPath of [...this.#links.keys()]) this.#dropLink(socketPath);
        this.#emit({ type: "closed", reason });
      }
    }
    return this.#exitCode;
  }
}

/**
 * Run the station on this terminal until the detach byte, the end of stdin or
 * a termination signal. Returns 0 on a normal close, 1 when nothing could be
 * opened (no live session, or an unknown host view).
 */
export function runStation(
  runtime: StationRuntime,
  options: StationOptions,
): Promise<number> {
  return new Station(runtime, options).run();
}
