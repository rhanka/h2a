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
 * The station never spawns a process itself and never starts or stops a PTY:
 * every relaunch goes through the `execH2a` effect port of its runtime
 * (`nt/op.ts`), one call at a time, as detached `h2a` tokens.
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
  type RightPanelRestorableRow,
  type RightPanelSession,
  type RightPanelSnapshot,
} from "./right-panel.js";
import { resumeArgvVerified, titleMatches } from "../restore-plan.js";
import {
  RightPanelSnapshotRefresher,
  TrackJournalCache,
  TranscriptScanCache,
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
import {
  enterRawOutputTty,
  installTtySuspendHandlers,
  restoreTtyState,
  type TtyState,
  type TtyStdout,
} from "../terminal-reset.js";
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
/**
 * An absence proof takes the host publication lock. A long-lived station
 * refreshes its inventory every second: it re-proves an absent endpoint at
 * most this often, so it can never get in the way of a host being launched.
 */
const ABSENCE_PROOF_TTL_MS = 30_000;

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

/** S2 effect port: one detached `h2a` call, tokens after the binary. */
export type StationCliRequest = Readonly<{
  args: readonly string[];
  cwd: string;
  /** Plan pins, added to the station environment. */
  env?: Readonly<Record<string, string>>;
}>;

export type StationCliResult =
  | Readonly<{ ok: true; stdout: string }>
  | Readonly<{
      ok: false;
      code: "binary-missing" | "timeout" | "exit-nonzero" | "spawn-error";
      exitCode?: number;
      stdout: string;
      stderr: string;
    }>;

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
  /**
   * S2 relaunch effect (launch file and D1/D2 gestures share one queue).
   * Never throws. Absent ⇒ every relaunch gesture reports
   * `relaunch-unavailable` on its line.
   */
  execH2a?(request: StationCliRequest): Promise<StationCliResult>;
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
  | { type: "card"; kind: StationCardKind; sessionId: string; text: string }
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
  | {
      type: "relaunch";
      key: string;
      phase: "queued" | "started" | "done" | "failed";
      code?: string;
    }
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
  /** S2: a group title matched to the initial tab. */
  readonly group?: string;
  /** S2: list the relaunchable sessions without launching them. */
  readonly lazy?: boolean;
  /** S2: gateway posture passed to the station plan. */
  readonly forceGateway?: "gateway" | "direct";
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
  /** S2 D1: the host can respawn a session in place (`softRespawn` ping). */
  softRespawn: boolean;
  generation: string;
};

type RelaunchEntry = {
  key: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  /**
   * Restorable row this entry was taken from, when any: the pump skips the
   * entry once the current snapshot withdraws its gesture (refused plan).
   */
  restorableKey?: string | undefined;
  /** Pending display to drop when this entry settles outside `running`. */
  pendingName?: string | undefined;
  pendingSessionId?: string | undefined;
  /**
   * NB-16: guard re-read at the head of the file, before the effect runs.
   * A refusal fails the entry with its code and never reaches the port.
   */
  beforeRun?: (() => Promise<{ ok: true } | { ok: false; code: string }>) | undefined;
};

/** S2 relaunch issue: the port output travels with every outcome. */
type RelaunchIssue =
  | Readonly<{ ok: true; stdout: string }>
  | Readonly<{ ok: false; code: string; stdout: string; stderr: string }>;

/**
 * S2 reason id → catalogued motif key. A `launch` row shows its file state
 * instead of a motif; any other code shows as-is.
 */
const RESTORABLE_REASON_TEXT_KEYS: Readonly<Record<string, string>> = {
  "launch-cap": "station.restorable.reason.launchCap",
  "resume-argv-unverified": "station.restorable.reason.resumeArgvUnverified",
  "unresolved-conversation": "station.restorable.reason.unresolvedConversation",
  "dual-host": "station.restorable.reason.dualHost",
  "unknown-view": "station.restorable.reason.unknownView",
};

/** S2 D-guard bound: terminal draft state waited at most this long. */
const DRAFT_TERMINAL_WAIT_MS = 2_000;
/** S2 D-guard poll slice on the harness clock. */
const DRAFT_TERMINAL_POLL_MS = 250;

type GuardLease = {
  lease: NativeTerminalControllerLease;
  socketPath: string;
  /** Logical time of the acquisition: older inventories cannot judge it. */
  since: number;
};

type InventoryView = {
  /** Logical time at which this inventory started being collected. */
  started: number;
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

function stripInventory<C extends NativeInventoryClient>(
  inventory: NativeInventory<C>,
  started: number,
): InventoryView {
  return {
    started,
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
  /** Endpoints proven absent, with the station time of the proof. */
  readonly #absence = new Map<string, number>();
  readonly #draftStatus = new Map<string, StationSessionDraftStatus>();

  /** Logical clock ordering inventories against lease acquisitions. */
  #clock = 0;
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
  #sentinelCarry: Buffer = Buffer.alloc(0);
  #sentinelSatisfied = false;
  #postSentinelInput: Buffer[] = [];
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
  /** S2: the station provides the transcript-scan cache (single 60 s slot). */
  #scanCache = new TranscriptScanCache();
  /** S2 relaunch file: one call in flight for the whole station. */
  #relaunchQueue: RelaunchEntry[] = [];
  #relaunchStates = new Map<string, { state: RightPanelRestorableRow["state"]; code?: string }>();
  #relaunchInFlight: string | undefined;
  #pumpRunning = false;
  /** S2: D1 effects wait behind the file like every other relaunch. */
  #relaunchWaiters = new Map<string, (result: RelaunchIssue) => void>();
  /** S2: harness clock of the last uncertain port issue, if any. */
  #uncertainSince: number | undefined;
  /** S2 D1: sessions whose hard relaunch confirmation is armed. */
  #hardRespawnArmed = new Map<
    string,
    { pid: number; group: number | null; generation: string; incarnation: string }
  >();
  /** S2: relaunch targets watched for their first running observation. */
  #pendingDisplay: Array<{ sessionId?: string; name?: string; onlyIfIdle: boolean }> = [];
  /** S2: a human gesture already activated a line (no initial auto-display). */
  #humanActivatedLine = false;
  /** S2: the launch file already showed its first running session. */
  #launchAutoShown = false;
  /** Nothing is painted before the launch decided what to display. */
  #started = false;
  /** Set when the station is leaving: no connection may be opened or kept. */
  #closing = false;
  /** True while the launch walks its candidates (no card per refusal). */
  #quietRefusals = false;

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
    if (this.#closing) throw new Error("station is closing");
    const existing = this.#links.get(socketPath);
    if (existing) return existing;
    const pending = this.#linking.get(socketPath);
    if (pending) return pending;
    const work = (async (): Promise<HostLink> => {
      const client = await this.#runtime.connect(socketPath);
      try {
        const ping = await client.ping();
        // A connection that completes after the station left is not kept:
        // an open socket would hold the process (and its leases) alive.
        if (this.#closing) throw new Error("station is closing");
        const link: HostLink = {
          socketPath,
          client,
          // Absent or not understood ⇒ compatibility guard (r4 §3.1, §4).
          brokerProtected: ping.composerBrokerVersion === 1,
          // S2 D1: in-place respawn needs the host soft-respawn capability.
          softRespawn: ping.softRespawn === true,
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
  #isTtyResponder(): boolean {
    return (
      this.#stdin.isTTY === true &&
      (this.#stdout as { isTTY?: boolean }).isTTY === true &&
      process.env["TERM"] !== "dumb"
    );
  }

  #viewClient(link: HostLink): NativeTerminalAttachClient {
    const client = link.client;
    return {
      readOutput: (id, afterSeq, timeoutMs) => client.readOutput(id, afterSeq, timeoutMs),
      state: (id) => client.state(id),
      acquireController: (id, controllerId, activity, options) =>
        client.acquireController(id, controllerId, activity, options),
      ...(client.setControllerResponder
        ? {
            setControllerResponder: (lease: NativeTerminalControllerLease, enabled: boolean) =>
              client.setControllerResponder!(lease, enabled),
          }
        : {}),
      releaseController: (lease) => client.releaseController(lease),
      write: (lease, data) => client.write(lease, data),
      resize: (lease, cols, rows) => client.resize(lease, cols, rows),
      close: () => {},
    };
  }

  async #collectInventory(): Promise<NativeInventory<StationHostClient>> {
    const proveAbsent = this.#runtime.proveAbsent;
    const started = (this.#clock += 1);
    const inventory = await collectNativeInventory<StationHostClient>(
      this.#runtime.endpoints(),
      async (socketPath) => {
        const client = await this.#runtime.connect(socketPath);
        // A host answers there now: any earlier absence proof is void.
        this.#absence.delete(socketPath);
        return client;
      },
      proveAbsent
        ? async (socketPath, failure) => {
            const code = (failure as NodeJS.ErrnoException | undefined)?.code;
            if (code !== "ENOENT" && code !== "ECONNREFUSED") return false;
            const provenAt = this.#absence.get(socketPath);
            const now = this.#runtime.now();
            if (provenAt !== undefined && now - provenAt < ABSENCE_PROOF_TTL_MS) return true;
            const absent = await proveAbsent(socketPath, failure);
            if (absent) this.#absence.set(socketPath, now);
            else this.#absence.delete(socketPath);
            return absent;
          }
        : undefined,
    );
    // A slower, older collection never overwrites a newer one.
    if (this.#inventory === undefined || this.#inventory.started < started) {
      this.#inventory = stripInventory(inventory, started);
    }
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

  #setGuard(sessionId: string, lease: NativeTerminalControllerLease, socketPath: string): void {
    this.#guards.set(sessionId, { lease, socketPath, since: (this.#clock += 1) });
  }

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
      // An inventory collected before the guard was taken says nothing of it.
      if (inventory.started <= guard.since) continue;
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
        this.#setGuard(sessionId, lease, link.socketPath);
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
        // S2: the station never reads tmux: the photo scope is
        // `known: false`, never "known and empty", so tmux sessions and
        // legacy tabs list under "view unknown" instead of relaunching.
        listTmux: async () => ({ known: false as const }),
        // S2: the station always provides the scan cache and the gateway
        // posture; the loader computes the restore plan from its own photo.
        scanCache: this.#scanCache,
        ...(this.#options.forceGateway !== undefined
          ? { forceGateway: this.#options.forceGateway }
          : {}),
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
    // S2 D1: in-place relaunch of the process in place, confirmed and naming
    // what is terminated. Facets `cli` and `other` never offer it: the CLI is
    // alive there, this is not a D1 (r2 `:271`). Unverified argv or
    // conversation shows the motif instead of the gesture (r2 `:279`).
    if (link !== undefined && state?.status === "running") {
      const facet = state.applicationFacet;
      // A `shell` first plane is the fallback shell by construction (r2 `:241`).
      if (facet === "shell") extraBadges.push(this.#t("station.badge.shellExited"));
      if (facet === "shell" || facet === undefined || facet === "unknown") {
        if (!row.tool || !resumeArgvVerified(row.tool)) {
          extraRows.push({
            id: "respawn-unavailable",
            text: this.#t("station.restorable.reason.resumeArgvUnverified"),
            whenSelected: true,
          });
        } else if (row.resumeConversationVerified !== true) {
          extraRows.push({
            id: "respawn-unavailable",
            text: this.#t("station.restorable.reason.unresolvedConversation"),
            whenSelected: true,
          });
        } else {
          extraRows.push({
            id: "respawn-in-place",
            text: this.#t("station.row.respawn"),
            activatable: true,
            whenSelected: true,
          });
        }
      }
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

  #decorateRestorableRow(row: RightPanelRestorableRow): RightPanelRestorableRow {
    const progress = this.#relaunchStates.get(row.key);
    const state = progress?.state ?? row.state;
    const code = progress?.code ?? row.code;
    const motifKey = RESTORABLE_REASON_TEXT_KEYS[row.reason];
    const reasonText =
      row.reasonText ??
      (motifKey !== undefined ? this.#t(motifKey) : row.reason === "launch" ? undefined : row.reason);
    // NB-14: outside --lazy a capped row with a gesture shows its motif
    // alone while it waits: the deferred state text names --lazy. The row
    // state stays `deferred`; only the painted text drops it (the view
    // renders an empty state text as motif-only).
    // B-10: only the waiting state drops its text. Once the file owns the
    // row (queued, launching) or settles it (ended, failed), the file state
    // paints: a failure must never look like a neutral motif.
    const cappedOutsideLazy =
      row.reason === "launch-cap" &&
      row.relaunch !== undefined &&
      state === "deferred" &&
      this.#options.lazy !== true;
    return {
      ...row,
      state,
      ...(code !== undefined ? { code } : {}),
      ...(reasonText !== undefined ? { reasonText } : {}),
      stateText: cappedOutsideLazy
        ? ""
        : this.#t(`station.restorable.state.${state}`, { code: code ?? "unknown" }),
    };
  }

  #decorate(snapshot: RightPanelSnapshot): RightPanelSnapshot {
    // S2: the parent no longer counts dead sessions; the station plan lists
    // them under `restorable`, one row each. The relaunch file progress and
    // the localised motif/state lines merge here.
    return {
      ...snapshot,
      workspaces: snapshot.workspaces.map((workspace) => ({
        title: workspace.title,
        sessions: workspace.sessions.map((row) => this.#decorateRow(row)),
        ...(workspace.restorable !== undefined
          ? {
              restorable: workspace.restorable.map((row) => this.#decorateRestorableRow(row)),
              restorableHeader: this.#t("station.restorable.header", {
                count: workspace.restorable.length,
              }),
            }
          : {}),
      })),
      // S2: a refused restore plan says its reason once, in the foot.
      ...(snapshot.restorablePlanRefused !== undefined
        ? {
            footerRows: [
              this.#t("station.restorable.planRefused", {
                reason: singleLine(snapshot.restorablePlanRefused),
              }),
            ],
          }
        : {}),
    };
  }

  #applySnapshot(snapshot: RightPanelSnapshot): void {
    this.#rawSnapshot = snapshot;
    const decorated = this.#decorate(snapshot);
    this.#panel.setSnapshot(decorated);
    this.#bar?.paint(false);
    this.#emit({ type: "snapshot", snapshot: decorated });
    // S2: a watched relaunch target switches at its first running observation.
    void this.#maybePendingDisplay();
  }

  /** Re-derive the station marks (displayed, guards, drafts) without a reload. */
  #redecorate(): void {
    if (this.#rawSnapshot) this.#applySnapshot(this.#rawSnapshot);
  }

  // --- S2 relaunch file -------------------------------------------------------

  /**
   * One detached `h2a` call; absent port or throw ⇒ a named issue, never a
   * throw. The port output travels with every outcome so a JSON issue stays
   * readable on `exit-nonzero` too (r4 §5).
   */
  async #execRelaunch(entry: {
    args: readonly string[];
    cwd: string;
    env: Readonly<Record<string, string>>;
  }): Promise<RelaunchIssue> {
    const exec = this.#runtime.execH2a;
    if (!exec) return { ok: false, code: "relaunch-unavailable", stdout: "", stderr: "" };
    try {
      const result = await exec({ args: entry.args, cwd: entry.cwd, env: entry.env });
      return result.ok
        ? { ok: true, stdout: result.stdout }
        : { ok: false, code: result.code, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    } catch {
      return { ok: false, code: "spawn-error", stdout: "", stderr: "" };
    }
  }

  #enqueueRelaunch(
    entry: RelaunchEntry,
    front: boolean,
    onSettled?: (result: RelaunchIssue) => void,
  ): boolean {
    if (
      this.#relaunchQueue.some((queued) => queued.key === entry.key) ||
      this.#relaunchInFlight === entry.key
    ) {
      return false;
    }
    if (front) this.#relaunchQueue.unshift(entry);
    else this.#relaunchQueue.push(entry);
    if (onSettled !== undefined) this.#relaunchWaiters.set(entry.key, onSettled);
    this.#relaunchStates.set(entry.key, { state: "queued" });
    this.#emit({ type: "relaunch", key: entry.key, phase: "queued" });
    this.#pumpRelaunchFile();
    if (!this.#ended) this.#redecorate();
    return true;
  }

  /**
   * S2 D1: an effect behind the file, awaited by its gesture. The loop never
   * awaits the file itself (r2 `:281`): the waiter settles with the entry.
   */
  #enqueueRelaunchAndWait(entry: RelaunchEntry): Promise<RelaunchIssue> {
    if (this.#ended) {
      return Promise.resolve({ ok: false, code: "station-closing", stdout: "", stderr: "" });
    }
    return new Promise((resolve) => {
      if (!this.#enqueueRelaunch(entry, true, resolve)) {
        resolve({ ok: false, code: "already-queued", stdout: "", stderr: "" });
      }
    });
  }

  /**
   * S2 launch file at station start: exactly the `launch` decisions of the
   * plan, in plan order. Capped rows keep their D2 gesture outside the file.
   */
  #startRelaunchFile(rows: readonly RightPanelRestorableRow[]): void {
    for (const row of rows) {
      if (row.relaunch === undefined || row.reason !== "launch") continue;
      if (this.#options.lazy === true) {
        this.#relaunchStates.set(row.key, { state: "deferred" });
        continue;
      }
      const env: Record<string, string> = {};
      for (const pin of row.relaunch.env) {
        const at = pin.indexOf("=");
        if (at > 0) env[pin.slice(0, at)] = pin.slice(at + 1);
      }
      if (this.#relaunchQueue.some((queued) => queued.key === row.key)) continue;
      this.#relaunchQueue.push({
        key: row.key,
        args: [...row.relaunch.args],
        cwd: row.relaunch.cwd,
        env,
        restorableKey: row.key,
        ...(row.relaunch.name !== undefined ? { pendingName: row.relaunch.name } : {}),
      });
      this.#relaunchStates.set(row.key, { state: "queued" });
      this.#emit({ type: "relaunch", key: row.key, phase: "queued" });
      // At launch the station shows the first relaunched session running —
      // once, only while nothing is displayed and no gesture was made.
      if (row.relaunch.name !== undefined) {
        this.#pendingDisplay.push({ name: row.relaunch.name, onlyIfIdle: true });
      }
    }
    if (!this.#ended) this.#redecorate();
    this.#pumpRelaunchFile();
  }

  /**
   * NB-15: true while a file entry already relaunches this session (queued
   * or in flight). Row entries name the session through their row; hard
   * entries carry it directly.
   */
  #fileTargetsSession(sessionId: string): boolean {
    const rows = this.#rawSnapshot?.workspaces.flatMap((workspace) => workspace.restorable ?? []) ?? [];
    const keyTargets = (key: string | undefined): boolean => {
      if (key === undefined) return false;
      if (key === sessionId) return true;
      return rows.some((row) => row.key === key && row.relaunch?.name === sessionId);
    };
    if (keyTargets(this.#relaunchInFlight)) return true;
    return this.#relaunchQueue.some(
      (entry) =>
        keyTargets(entry.key) ||
        keyTargets(entry.restorableKey) ||
        keyTargets(entry.pendingSessionId) ||
        keyTargets(entry.pendingName),
    );
  }

  /** Drop the watched display of an entry that settles outside `running`. */
  #dropPendingDisplay(entry: RelaunchEntry): void {
    if (entry.pendingName === undefined && entry.pendingSessionId === undefined) return;
    // NB-13: drop only this entry's own watch. The old conjunction dropped
    // every other watch too (`undefined !== undefined` is false), so one
    // failed relaunch cancelled the initial display and every later switch.
    this.#pendingDisplay = this.#pendingDisplay.filter(
      (pending) =>
        !(entry.pendingName !== undefined && pending.name === entry.pendingName) &&
        !(entry.pendingSessionId !== undefined && pending.sessionId === entry.pendingSessionId),
    );
  }

  /**
   * One call in flight for the whole station, relaunches of the launch file
   * and gestures confounded. The loop never awaits it (r2 `:281`): an entry
   * settles, a typed keystroke is served, then the next entry starts. A
   * failed entry marks its line and lets the next one go.
   */
  #pumpRelaunchFile(): void {
    if (this.#pumpRunning) return;
    this.#pumpRunning = true;
    void (async () => {
      try {
        for (;;) {
          if (this.#ended) return;
          const next = this.#relaunchQueue.shift();
          if (!next) return;
          // A snapshot taken after the entry was queued can withdraw its
          // gesture (refused plan): skip it, never run a stale row.
          if (next.restorableKey !== undefined) {
            const fresh = this.#rawSnapshot?.workspaces
              .flatMap((workspace) => workspace.restorable ?? [])
              .find((row) => row.key === next.restorableKey);
            if (fresh?.relaunch === undefined) {
              this.#relaunchStates.set(next.key, { state: "failed", code: "plan-refused" });
              this.#emit({ type: "relaunch", key: next.key, phase: "failed", code: "plan-refused" });
              this.#dropPendingDisplay(next);
              if (!this.#ended) this.#redecorate();
              continue;
            }
          }
          const waiter = this.#relaunchWaiters.get(next.key);
          this.#relaunchWaiters.delete(next.key);
          // NB-16: the guard is re-read when the entry reaches the head of
          // the file. A refusal fails the entry with its code before any
          // port call; the waiter maps it to its card below.
          if (next.beforeRun !== undefined) {
            let gate: { ok: true } | { ok: false; code: string };
            try {
              gate = await next.beforeRun();
            } catch {
              gate = { ok: false, code: "spawn-error" };
            }
            if (!gate.ok) {
              this.#relaunchStates.set(next.key, { state: "failed", code: gate.code });
              this.#emit({ type: "relaunch", key: next.key, phase: "failed", code: gate.code });
              this.#dropPendingDisplay(next);
              if (!this.#ended) this.#redecorate();
              waiter?.({ ok: false, code: gate.code, stdout: "", stderr: "" });
              continue;
            }
          }
          this.#relaunchInFlight = next.key;
          this.#relaunchStates.set(next.key, { state: "launching" });
          this.#emit({ type: "relaunch", key: next.key, phase: "started" });
          if (!this.#ended) this.#redecorate();
          const result = await this.#execRelaunch(next);
          this.#relaunchInFlight = undefined;
          if (result.ok) {
            this.#relaunchStates.set(next.key, { state: "ended" });
            this.#emit({ type: "relaunch", key: next.key, phase: "done" });
          } else {
            this.#relaunchStates.set(next.key, { state: "failed", code: result.code });
            this.#emit({ type: "relaunch", key: next.key, phase: "failed", code: result.code });
            // A failed relaunch never switches later to a same-named session.
            this.#dropPendingDisplay(next);
            if (result.code === "timeout" || result.code === "spawn-error") {
              // Uncertain issue (r4 §5): re-read the effect before any
              // repetition, then let gestures decide on the fresh snapshot.
              this.#uncertainSince = this.#runtime.now();
              await this.#refresher.maybeRefresh(true)?.catch(() => {});
            }
          }
          waiter?.(result);
          if (!this.#ended) {
            this.#redecorate();
            await this.#maybePendingDisplay();
          }
          await this.#runtime.delay(0);
        }
      } finally {
        this.#pumpRunning = false;
      }
    })().catch(() => {
      this.#pumpRunning = false;
    });
  }

  /** Switch to a watched relaunch target at its first running observation. */
  async #maybePendingDisplay(): Promise<void> {
    if (this.#ended || !this.#inventory) return;
    const remaining: Array<{ sessionId?: string; name?: string; onlyIfIdle: boolean }> = [];
    for (const pending of this.#pendingDisplay) {
      const id = pending.sessionId ?? pending.name;
      const target =
        id !== undefined
          ? this.#inventory.sessions.find(
              (session) => session.id === id && session.status === "running",
            )
          : undefined;
      if (!target) {
        remaining.push(pending);
        continue;
      }
      if (pending.onlyIfIdle) {
        if (this.#displayed !== undefined || this.#humanActivatedLine || this.#launchAutoShown) {
          remaining.push(pending);
          continue;
        }
        this.#launchAutoShown = true;
      }
      // B-9: every automatic switch goes through the loop. The request is
      // posed here and consumed there, never applied around the loop, so a
      // human gesture and two pendings can never drive two overlapping
      // switches. A pending human request wins; the automatic one waits
      // for the next snapshot. Nothing here touches the live view: a hard
      // relaunch under the displayed session is taken by the full switch,
      // which leaves the old view through the t3 protocol (B-3).
      if (this.#request !== undefined) {
        remaining.push(pending);
        continue;
      }
      this.#request = { type: "activate", sessionId: target.id, takeover: false };
      this.#wakeLoop();
    }
    this.#pendingDisplay = remaining;
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

  /** Longest trailing prefix of `SENTINEL_REPLY_BYTES` at the end of `data`. */
  #trailingSentinelReplyPrefix(data: Buffer): Buffer {
    let keep = Math.min(data.length, SENTINEL_REPLY_BYTES.length - 1);
    while (
      keep > 0 &&
      !SENTINEL_REPLY_BYTES.subarray(0, keep).equals(data.subarray(data.length - keep))
    ) {
      keep -= 1;
    }
    return keep > 0 ? Buffer.from(data.subarray(data.length - keep)) : Buffer.alloc(0);
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
    const prefix = this.#trailingSentinelReplyPrefix(data);
    if (prefix.length === 0) return data;
    this.#lateTail = prefix;
    const generation = this.#lateTailGeneration;
    void this.#runtime.delay(LATE_TAIL_FLUSH_MS).then(() => {
      if (generation !== this.#lateTailGeneration || this.#lateTail.length === 0) return;
      // Not a reply after all (a lone Esc): deliver what was held.
      const held = this.#lateTail;
      this.#lateTail = Buffer.alloc(0);
      if (!this.#ended && this.#gate === "open") this.#dispatch(held);
    });
    return data.subarray(0, data.length - prefix.length);
  }

  /**
   * Consume input during t6 sentinel wait: drop everything up to and including
   * `ESC[0n` (even if split across chunks), and return any trailing bytes that
   * arrived after the terminal replied.
   */
  #consumeSentinelChunk(chunk: Buffer): {
    matched: boolean;
    tail: Buffer;
    droppedBytes: number;
  } {
    const window =
      this.#sentinelCarry.length > 0 ? Buffer.concat([this.#sentinelCarry, chunk]) : chunk;
    const at = window.indexOf(SENTINEL_REPLY_BYTES);
    if (at >= 0) {
      const consumed = at + SENTINEL_REPLY_BYTES.length;
      const droppedBytes = consumed - this.#sentinelCarry.length;
      const tail = Buffer.from(window.subarray(consumed));
      this.#sentinelCarry = Buffer.alloc(0);
      return { matched: true, tail, droppedBytes };
    }
    this.#sentinelCarry = this.#trailingSentinelReplyPrefix(window);
    return { matched: false, tail: Buffer.alloc(0), droppedBytes: chunk.length };
  }

  #flushPostSentinelInput(): void {
    if (this.#postSentinelInput.length === 0) return;
    const buffered = this.#postSentinelInput.splice(0);
    for (const chunk of buffered) {
      if (this.#ended) continue;
      if (this.#gate === "frozen") {
        this.#emit({ type: "input-dropped", bytes: chunk.length, reason: "transition" });
        continue;
      }
      let next = chunk;
      if (this.#lateSentinels > 0 || this.#lateTail.length > 0) {
        next = this.#swallowLateSentinel(next);
        if (next.length === 0) continue;
      }
      this.#dispatch(next);
    }
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
      // Everything up to and including the sentinel reply is dropped; bytes
      // arriving after it wait for the transition epilogue to open the gate.
      const { matched, tail, droppedBytes } = this.#consumeSentinelChunk(chunk);
      if (droppedBytes > 0) {
        this.#emit({ type: "input-dropped", bytes: droppedBytes, reason: "transition" });
      }
      if (matched) {
        const waiter = this.#sentinelWaiter;
        this.#sentinelWaiter = undefined;
        this.#sentinelSatisfied = true;
        if (tail.length > 0) this.#postSentinelInput.push(tail);
        waiter();
      }
      return;
    }
    if (this.#gate === "frozen") {
      if (this.#sentinelSatisfied && !this.#request) {
        this.#postSentinelInput.push(chunk);
        return;
      }
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
        this.#humanActivatedLine = true;
        this.#activateExtraRow(action.sessionId, action.rowId);
      } else if (action.type === "toggle-restorable-expander") {
        // Panel-internal: the controller already toggled its section.
      } else if (action.type === "activate-restorable-row") {
        this.#humanActivatedLine = true;
        this.#relaunchFromRow(action.key);
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
    const text = this.#refusalText(sessionId, reason, state);
    this.#emit({ type: "switch-refused", sessionId, reason });
    // At launch the station tries its candidates one after the other: a
    // session held elsewhere is simply not displayed, without a card each.
    if (this.#quietRefusals) return "refused";
    this.#emit({ type: "card", kind: reason, sessionId, text });
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
    else if (rowId === "respawn-in-place") void this.#confirmRespawnInPlace(sessionId).catch(() => {});
    else if (rowId.startsWith("draft:")) void this.#openRecoveryView(sessionId, rowId).catch(() => {});
  }

  /** S2 D1 availability, re-checked at gesture time (never a guessed identifier). */
  #respawnAvailability(
    sessionId: string,
  ):
    | {
        ok: true;
        kind: "shell" | "unknown";
        pid: number;
        group: number | null;
        generation: string;
        incarnation: string;
      }
    | { ok: false; reason: "argv" | "conversation" | "facet" | "state" } {
    const state = this.#inventory?.sessions.find((session) => session.id === sessionId);
    if (!state || state.status !== "running") return { ok: false, reason: "state" };
    const facet = state.applicationFacet;
    if (facet !== "shell" && facet !== undefined && facet !== "unknown") {
      return { ok: false, reason: "facet" };
    }
    const row = this.#rawSnapshot?.workspaces
      .flatMap((workspace) => workspace.sessions)
      .find((candidate) => candidate.id === sessionId);
    if (!row?.tool || !resumeArgvVerified(row.tool)) return { ok: false, reason: "argv" };
    if (row.resumeConversationVerified !== true) return { ok: false, reason: "conversation" };
    return {
      ok: true,
      kind: facet === "shell" ? "shell" : "unknown",
      pid: state.pid,
      group: state.foregroundProcessGroup ?? null,
      generation: state.generation,
      incarnation: state.incarnation,
    };
  }

  /**
   * S2 D1: the refusal is shown alone; the hard relaunch needs its own
   * confirmation card. Arming survives the dismissal of the refusal.
   * NB-4: the arm is bound to the incarnation that refused soft: a moved
   * pid, group, generation or incarnation clears it instead of killing the
   * wrong PTY.
   */
  #refuseSoftThenArm(
    sessionId: string,
    stamp: { pid: number; group: number | null; generation: string; incarnation: string },
  ): void {
    const session = this.#sessionLabel(sessionId);
    this.#emit({ type: "gesture", gesture: "respawn-in-place", sessionId, outcome: "refused" });
    this.#hardRespawnArmed.set(sessionId, stamp);
    this.#showCard(
      [this.#t("station.respawn.softUnsupported", { session })],
      this.#t("station.card.dismiss"),
    );
  }

  /**
   * S2 D1: confirm naming the process in place (pid, foreground state).
   * NB-4: the card names a fresh read, never the last snapshot: the
   * inventory is re-read before the card is shown.
   */
  async #confirmRespawnInPlace(sessionId: string): Promise<void> {
    await this.#freshInventory().catch(() => {});
    if (this.#ended) return;
    const session = this.#sessionLabel(sessionId);
    const availability = this.#respawnAvailability(sessionId);
    if (!availability.ok) {
      // No port call: argv and conversation name their motif; a facet or
      // state that moved under the gesture shows its machine code as-is.
      if (availability.reason === "argv" || availability.reason === "conversation") {
        const key =
          availability.reason === "argv"
            ? "station.restorable.reason.resumeArgvUnverified"
            : "station.restorable.reason.unresolvedConversation";
        this.#showCard([`${session}: ${this.#t(key)}`], this.#t("station.card.dismiss"));
      } else {
        this.#showCard(
          [`${session}: respawn-unavailable (${availability.reason})`],
          this.#t("station.card.dismiss"),
        );
      }
      return;
    }
    // A refused soft respawn arms this session: the next gesture confirms
    // the hard relaunch on its own card, which names the lost PTY.
    const armed = this.#hardRespawnArmed.get(sessionId);
    if (armed !== undefined) {
      // NB-4: the arm names one incarnation. A move since the arming clears
      // it: the gesture falls back to a fresh soft probe, zero port call.
      if (
        availability.pid !== armed.pid ||
        availability.group !== armed.group ||
        availability.generation !== armed.generation ||
        availability.incarnation !== armed.incarnation
      ) {
        this.#hardRespawnArmed.delete(sessionId);
        this.#showCard(
          [`${session}: respawn-unavailable (moved)`],
          this.#t("station.card.dismiss"),
        );
        return;
      }
      this.#showCard(
        [this.#t("station.confirm.respawnHard", { session })],
        this.#t("station.confirm.prompt"),
        () => {
          this.#hardRespawnArmed.delete(sessionId);
          void this.#respawnHard(sessionId, armed).catch(() => {});
        },
      );
      return;
    }
    const confirmKey =
      availability.kind === "shell" && availability.group !== null
        ? "station.confirm.respawnShell"
        : "station.confirm.respawnUnknown";
    const stamp = {
      pid: availability.pid,
      group: availability.group,
      generation: availability.generation,
      incarnation: availability.incarnation,
    };
    this.#showCard(
      [
        this.#t(confirmKey, {
          session,
          pid: availability.pid,
          group: availability.group ?? "unknown",
        }),
      ],
      this.#t("station.confirm.prompt"),
      () => {
        void this.#respawnInPlace(sessionId, stamp).catch(() => {});
      },
    );
  }

  /**
   * S2 step 6: the D1/D-hard effect waits for a terminal draft state first.
   * A read failure refuses with a named code (zero port call); only a host
   * without the D port carries no draft, so only it passes the guard.
   */
  async #readDraftTerminal(sessionId: string): Promise<boolean> {
    const owner = this.#inventory?.sessions.find((session) => session.id === sessionId);
    if (!owner) throw new Error("owner-gone");
    let link: HostLink;
    try {
      link = await this.#link(owner.socketPath);
    } catch {
      throw new Error("link-failed");
    }
    // A host without the D port carries no draft: the guard passes.
    if (typeof link.client.draftStatus !== "function") return true;
    let statuses: Record<string, StationSessionDraftStatus | undefined>;
    try {
      statuses = (await link.client.draftStatus([sessionId])) as Record<
        string,
        StationSessionDraftStatus | undefined
      >;
    } catch {
      throw new Error("draft-status-unreadable");
    }
    const drafts = statuses[sessionId]?.drafts ?? [];
    return !drafts.some((draft) => draft.draft === "restoring-on-ready");
  }

  async #awaitDraftTerminal(sessionId: string): Promise<boolean> {
    const start = this.#runtime.now();
    for (;;) {
      if (await this.#readDraftTerminal(sessionId)) return true;
      if (this.#runtime.now() - start >= DRAFT_TERMINAL_WAIT_MS) return false;
      await this.#runtime.delay(DRAFT_TERMINAL_POLL_MS);
    }
  }

  /** Read the `h2a restart --json` issue (`h2a.restart.result`). */
  #parseRestartResult(
    stdout: string,
    sessionId: string,
  ): { ok: true; strategy: string } | { ok: false; code: string } {
    let parsed: {
      kind?: unknown;
      ok?: unknown;
      sessions?: Array<{
        id?: unknown;
        name?: unknown;
        restarted?: unknown;
        strategy?: unknown;
        failure?: unknown;
      }>;
    };
    try {
      parsed = JSON.parse(stdout) as typeof parsed;
    } catch {
      return { ok: false, code: "invalid-response" };
    }
    const row = parsed?.sessions?.find(
      (candidate) => candidate.id === sessionId || candidate.name === sessionId,
    );
    if (parsed?.kind !== "h2a.restart.result" || !row) {
      return { ok: false, code: "invalid-response" };
    }
    if (typeof row.failure === "string") return { ok: false, code: row.failure };
    if (parsed.ok !== true || row.restarted !== true || typeof row.strategy !== "string") {
      return { ok: false, code: "unknown" };
    }
    return { ok: true, strategy: row.strategy };
  }

  /**
   * NB-16: guard re-read when a D1 entry reaches the head of the file,
   * before the effect runs. A refusal fails the entry with its code and
   * never reaches the port.
   */
  async #rereadDraftGuard(
    sessionId: string,
  ): Promise<{ ok: true } | { ok: false; code: string }> {
    try {
      return (await this.#readDraftTerminal(sessionId))
        ? { ok: true }
        : { ok: false, code: "restoring-on-ready" };
    } catch (error) {
      return { ok: false, code: error instanceof Error ? singleLine(error.message) : "refused" };
    }
  }

  /**
   * NB-4: the card and Enter are apart in time. Re-read the inventory, then
   * the line, and refuse when it moved (or its argv/conversation lapsed)
   * since the card named it; the move shows a machine code, zero port call.
   * A failed re-read refuses closed too. Returns the fresh stamp, or
   * undefined once the refusal card is shown.
   */
  async #checkRespawnFresh(
    sessionId: string,
    session: string,
    expected: { pid: number; group: number | null; generation: string; incarnation: string },
  ): Promise<
    | {
        ok: true;
        kind: "shell" | "unknown";
        pid: number;
        group: number | null;
        generation: string;
        incarnation: string;
      }
    | undefined
  > {
    try {
      await this.#freshInventory();
    } catch {
      this.#showCard(
        [`${session}: respawn-unavailable (link-failed)`],
        this.#t("station.card.dismiss"),
      );
      this.#emit({ type: "gesture", gesture: "respawn-in-place", sessionId, outcome: "refused" });
      return undefined;
    }
    if (this.#ended) {
      this.#emit({ type: "gesture", gesture: "respawn-in-place", sessionId, outcome: "refused" });
      return undefined;
    }
    const fresh = this.#respawnAvailability(sessionId);
    if (!fresh.ok) {
      if (fresh.reason === "argv" || fresh.reason === "conversation") {
        const key =
          fresh.reason === "argv"
            ? "station.restorable.reason.resumeArgvUnverified"
            : "station.restorable.reason.unresolvedConversation";
        this.#showCard([`${session}: ${this.#t(key)}`], this.#t("station.card.dismiss"));
      } else {
        this.#showCard(
          [`${session}: respawn-unavailable (${fresh.reason})`],
          this.#t("station.card.dismiss"),
        );
      }
      this.#emit({ type: "gesture", gesture: "respawn-in-place", sessionId, outcome: "refused" });
      return undefined;
    }
    const moved =
      fresh.pid !== expected.pid ||
      fresh.group !== expected.group ||
      fresh.generation !== expected.generation ||
      fresh.incarnation !== expected.incarnation;
    if (moved) {
      this.#showCard(
        [`${session}: respawn-unavailable (moved)`],
        this.#t("station.card.dismiss"),
      );
      this.#emit({ type: "gesture", gesture: "respawn-in-place", sessionId, outcome: "refused" });
      return undefined;
    }
    return fresh;
  }

  /** S2 D1: relaunch in place (soft), then watch or refuse per the issue. */
  async #respawnInPlace(
    sessionId: string,
    expected: { pid: number; group: number | null; generation: string; incarnation: string },
  ): Promise<void> {
    const session = this.#sessionLabel(sessionId);
    let outcome = "done";
    try {
      const owner = await this.#resolveOwner(sessionId, true);
      if (owner.state !== "found") throw new Error(owner.state);
      // The card and Enter are apart in time: re-read the line before any
      // effect. A moved facet, pid, group or incarnation refuses here (NB-4),
      // zero port call.
      const fresh = await this.#checkRespawnFresh(sessionId, session, expected);
      if (!fresh) {
        outcome = "refused";
        return;
      }
      const link = await this.#link(owner.socketPath);
      if (link.softRespawn !== true) {
        this.#refuseSoftThenArm(sessionId, {
          pid: fresh.pid,
          group: fresh.group,
          generation: fresh.generation,
          incarnation: fresh.incarnation,
        });
        return;
      }
      if (!(await this.#awaitDraftTerminal(sessionId))) {
        this.#showCard(
          [this.#t("station.respawn.draftInFlight", { session })],
          this.#t("station.card.dismiss"),
        );
        outcome = "refused";
        this.#emit({ type: "gesture", gesture: "respawn-in-place", sessionId, outcome });
        return;
      }
      // One call in flight for the whole station: the D1 effect files behind
      // the launch file instead of doubling it.
      const result = await this.#enqueueRelaunchAndWait({
        key: sessionId,
        args: ["restart", sessionId, "--soft", "--json"],
        cwd: process.cwd(),
        env: {},
        beforeRun: () => this.#rereadDraftGuard(sessionId),
      });
      // NB-16: the head-of-file refusal lands here, before any port call.
      if (!result.ok && result.code === "restoring-on-ready") {
        this.#showCard(
          [this.#t("station.respawn.draftInFlight", { session })],
          this.#t("station.card.dismiss"),
        );
        outcome = "refused";
        this.#emit({ type: "gesture", gesture: "respawn-in-place", sessionId, outcome });
        return;
      }
      if (
        !result.ok &&
        (result.code === "owner-gone" ||
          result.code === "link-failed" ||
          result.code === "draft-status-unreadable")
      ) {
        throw new Error(result.code);
      }
      // NB-1: the JSON issue is readable even on `exit-nonzero` (r4 §5): an
      // unsupported soft respawn arms the hard confirmation, not a failure,
      // and any other JSON code wins over the bare exit code.
      // NB-20: the JSON code wins only when it comes from readable JSON.
      // Without readable JSON (`invalid-response`) the port code names the
      // issue: an uncertain `timeout` must stay readable as a timeout.
      // NB-23: `unknown` (readable JSON with no failure and no success)
      // names nothing, so the port code wins exactly like `invalid-response`.
      const parsed = this.#parseRestartResult(result.stdout, sessionId);
      if (!parsed.ok && parsed.code === "host-soft-restart-unsupported") {
        this.#refuseSoftThenArm(sessionId, {
          pid: fresh.pid,
          group: fresh.group,
          generation: fresh.generation,
          incarnation: fresh.incarnation,
        });
        return;
      }
      if (!result.ok) {
        throw new Error(
          !parsed.ok && parsed.code !== "invalid-response" && parsed.code !== "unknown"
            ? parsed.code
            : result.code,
        );
      }
      if (!parsed.ok) throw new Error(parsed.code);
      if (parsed.strategy !== "soft") throw new Error(`strategy: ${parsed.strategy}`);
    } catch (error) {
      outcome = error instanceof Error ? singleLine(error.message) : "refused";
      this.#showCard(
        [this.#t("station.respawn.failed", { session, code: outcome })],
        this.#t("station.card.dismiss"),
      );
    }
    this.#emit({ type: "gesture", gesture: "respawn-in-place", sessionId, outcome });
    // Soft keeps incarnation, lease and scrollback: no switch, just re-read.
    await this.#refresher.maybeRefresh(true);
    this.#redecorate();
  }

  /** S2 D1 on an old host: hard relaunch after its own confirmation, then switch. */
  async #respawnHard(
    sessionId: string,
    expected: { pid: number; group: number | null; generation: string; incarnation: string },
  ): Promise<void> {
    const session = this.#sessionLabel(sessionId);
    let outcome = "done";
    try {
      // NB-4: the hard card and its Enter are apart in time too: re-read
      // the line before the effect, zero port call on a move.
      const fresh = await this.#checkRespawnFresh(sessionId, session, expected);
      if (!fresh) {
        outcome = "refused";
        return;
      }
      if (!(await this.#awaitDraftTerminal(sessionId))) {
        this.#showCard(
          [this.#t("station.respawn.draftInFlight", { session })],
          this.#t("station.card.dismiss"),
        );
        outcome = "refused";
        this.#emit({ type: "gesture", gesture: "respawn-in-place", sessionId, outcome });
        return;
      }
      const result = await this.#enqueueRelaunchAndWait({
        key: sessionId,
        args: ["restart", sessionId, "--soft", "--allow-hard", "--json"],
        cwd: process.cwd(),
        env: {},
        pendingSessionId: sessionId,
        beforeRun: () => this.#rereadDraftGuard(sessionId),
      });
      // NB-16: the head-of-file refusal lands here, before any port call.
      if (!result.ok && result.code === "restoring-on-ready") {
        this.#showCard(
          [this.#t("station.respawn.draftInFlight", { session })],
          this.#t("station.card.dismiss"),
        );
        outcome = "refused";
        this.#emit({ type: "gesture", gesture: "respawn-in-place", sessionId, outcome });
        return;
      }
      if (
        !result.ok &&
        (result.code === "owner-gone" ||
          result.code === "link-failed" ||
          result.code === "draft-status-unreadable")
      ) {
        throw new Error(result.code);
      }
      // NB-1: the JSON issue is read even on `exit-nonzero` (r4 §5), so its
      // code wins over the bare exit code here too. NB-20: only when it
      // comes from readable JSON; otherwise the port code names the issue.
      // NB-23: `unknown` names nothing, so the port code wins for it too.
      const parsed = this.#parseRestartResult(result.stdout, sessionId);
      if (!result.ok) {
        throw new Error(
          !parsed.ok && parsed.code !== "invalid-response" && parsed.code !== "unknown"
            ? parsed.code
            : result.code,
        );
      }
      if (!parsed.ok) throw new Error(parsed.code);
      if (parsed.strategy !== "hard" && parsed.strategy !== "hard-fallback") {
        throw new Error(`strategy: ${parsed.strategy}`);
      }
      // A new incarnation starts: switch at its first running observation.
      this.#pendingDisplay.push({ sessionId, onlyIfIdle: false });
      await this.#refresher.maybeRefresh(true);
      this.#redecorate();
    } catch (error) {
      outcome = error instanceof Error ? singleLine(error.message) : "refused";
      this.#showCard(
        [this.#t("station.respawn.failed", { session, code: outcome })],
        this.#t("station.card.dismiss"),
      );
    }
    this.#emit({ type: "gesture", gesture: "respawn-in-place", sessionId, outcome });
    if (outcome === "done") {
      await this.#refresher.maybeRefresh(true);
      this.#redecorate();
    }
  }

  /** S2: read a restorable row from the current snapshot, by key. */
  #readRelaunchRow(key: string): RightPanelRestorableRow | undefined {
    return this.#rawSnapshot?.workspaces
      .flatMap((workspace) => workspace.restorable ?? [])
      .find((candidate) => candidate.key === key);
  }

  /** S2 D2 from a restorable row: confirmed relaunch of the dead session. */
  #relaunchFromRow(key: string): void {
    const row = this.#readRelaunchRow(key);
    // A line without tokens offers nothing: zero calls, never a guessed name.
    if (!row?.relaunch) return;
    this.#humanActivatedLine = true;
    this.#showCard(
      [this.#t("station.confirm.relaunch", { session: row.label })],
      this.#t("station.confirm.prompt"),
      () => {
        if (this.#uncertainSince !== undefined) {
          // An uncertain port issue is outstanding (r4 §5): re-read the
          // effect first, then decide on the fresh snapshot — never repeat
          // on a row the new snapshot withdrew.
          void (async () => {
            await this.#refresher.maybeRefresh(true)?.catch(() => {});
            const fresh = this.#readRelaunchRow(key);
            this.#uncertainSince = undefined;
            if (!fresh?.relaunch) return;
            this.#enqueueRowRelaunch(fresh);
          })();
          return;
        }
        this.#enqueueRowRelaunch(row);
      },
    );
  }

  /** S2: confirmed D2 effect shared by the row gesture and the end card. */
  #enqueueRowRelaunch(row: RightPanelRestorableRow): void {
    const relaunch = row.relaunch;
    if (!relaunch) return;
    const env: Record<string, string> = {};
    for (const pin of relaunch.env) {
      const at = pin.indexOf("=");
      if (at > 0) env[pin.slice(0, at)] = pin.slice(at + 1);
    }
    this.#enqueueRelaunch(
      {
        key: row.key,
        args: [...relaunch.args],
        cwd: relaunch.cwd,
        env,
        restorableKey: row.key,
        ...(relaunch.name !== undefined ? { pendingName: relaunch.name } : {}),
      },
      true,
    );
    if (relaunch.name !== undefined) {
      this.#pendingDisplay.push({ name: relaunch.name, onlyIfIdle: false });
    }
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
      this.#setGuard(sessionId, lease, link.socketPath);
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
    // S2: a human gesture activated a line: no initial auto-display afterwards.
    this.#humanActivatedLine = true;
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
        // The lease is the active one now: it is no longer a persisted guard.
        this.#persist(withoutCompatGuard(this.#state, sessionId));
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
      this.#setGuard(held.lease.id, held.lease, link.socketPath);
      this.#persist(
        withCompatGuard(this.#state, held.lease.id, {
          generation: held.lease.generation,
          incarnation: held.lease.incarnation,
        }),
      );
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
        // Demote its terminal responder so host resumes handling ESC[6n] safely.
        if (this.#isTtyResponder()) {
          await link.client.setControllerResponder?.(current.lease, false).catch(() => {});
        }
        this.#setGuard(view.sessionId, current.lease, link.socketPath);
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
    if (this.#isTtyResponder()) {
      try {
        const promoted = await link.client.setControllerResponder?.(lease, true);
        if (typeof promoted?.responderFromSeq === "number") {
          view.setCatchUpUntilSeq(promoted.responderFromSeq);
        } else if (typeof state.latestSeq === "number") {
          view.setCatchUpUntilSeq(state.latestSeq);
        }
      } catch {
        // Older host or mock without set-controller-responder.
      }
    }
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
    this.#sentinelCarry = Buffer.alloc(0);
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
    this.#sentinelCarry = Buffer.alloc(0);
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
    const fromLease = fromLive?.active;
    if (
      fromLive !== undefined &&
      fromLive.sessionId === sessionId &&
      fromLease !== undefined &&
      fromLive.transportFailure === undefined
    ) {
      // A hard relaunch replaces the incarnation under the displayed view:
      // the inventory then carries a newer generation than the held lease,
      // and only a full switch takes the fresh lease (B-9). Otherwise this
      // request is a no-op that keeps the focus on the CLI.
      const known = this.#inventory?.sessions.find((session) => session.id === sessionId);
      if (
        known === undefined ||
        (known.generation === fromLease.lease.generation &&
          known.incarnation === fromLease.lease.incarnation)
      ) {
        this.#panel.focusCli();
        this.#emit({ type: "same-session", sessionId });
        return "same";
      }
    }
    this.#freeze();
    try {
      // t1 — read B at its owner.
      const owner = await this.#resolveOwner(sessionId);
      // The detach byte closes the station even in the middle of a switch.
      if (this.#ended) return "refused";
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
      if (this.#ended) return "refused";
      if (state.status !== "running") return this.#refuse(sessionId, "ended", state);

      // t2 — hold B before leaving A.
      const held = await this.#hold(link, state, options.takeover === true);
      if (this.#ended) {
        if (held.ok) await this.#giveBack(link, held);
        return "refused";
      }
      if (!held.ok) return this.#refuse(sessionId, held.reason, held.state ?? state);

      // t3 — leave A (or discard a view that already ended on a card).
      if (fromLive !== undefined) {
        const settled = await this.#inFlightSettled(fromLive);
        if (this.#ended || !settled) {
          await this.#giveBack(link, held);
          return this.#ended ? "refused" : this.#refuse(sessionId, "input-in-flight");
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
        // The cursor of the panel follows the session now displayed and focus
        // returns to the CLI before the sentinel goes out, so all transition
        // painting precedes the query.
        this.#panel.selectSessionById(sessionId);
        this.#panel.focusCli();
        this.#sentinelSatisfied = false;
        this.#postSentinelInput.length = 0;
        await this.#sentinel();
        if (view.modes.isFocusReportingEnabled() && this.#outerFocus !== "lost") {
          const active = view.active;
          if (active !== undefined) {
            await active.client.write(active.lease, FOCUS_IN).catch(() => {});
          }
        }
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
      this.#sentinelWaiter = undefined;
      this.#sentinelCarry = Buffer.alloc(0);
      this.#sentinelSatisfied = false;
      // Refused: the station is back on A, unchanged. Displayed: B is open.
      this.#gate = "open";
      this.#flushPostSentinelInput();
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
    this.#emit({ type: "card", kind, sessionId, text });
    // S2 D2: the end card of a relaunched-able session offers the relaunch.
    if (kind === "ended") {
      // The plan is re-read first: the session just ended, so no snapshot
      // taken before is allowed to decide whether it is relaunchable.
      await this.#refresher.maybeRefresh(true);
      const row = this.#rawSnapshot?.workspaces
        .flatMap((workspace) => workspace.restorable ?? [])
        .find((candidate) => candidate.relaunch?.name === sessionId);
      // NB-15: no end offer while a file entry already relaunches this
      // session (a hard relaunch stops the old PTY before its own issue):
      // the offer would double the in-flight relaunch.
      if (row?.relaunch && !this.#fileTargetsSession(sessionId)) {
        this.#showCard(
          [text, this.#t("station.confirm.relaunch", { session: row.label })],
          this.#t("station.confirm.prompt"),
          () => {
            this.#humanActivatedLine = true;
            this.#enqueueRowRelaunch(row);
          },
        );
        this.#panel.paint();
        this.#redecorate();
        void this.#refresher.maybeRefresh(true);
        return;
      }
    }
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
        ...(this.#isTtyResponder() ? { terminalResponder: true } : {}),
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
  /**
   * S6 step 4: one notice per foreign (pid, tty) pair holding sessions in the
   * first inventory. Own pair excluded. Read-only: takes no lock, no lease.
   */
  #noticeOtherControllers(): void {
    const inventory = this.#inventory;
    if (inventory === undefined) return;
    const pairs = new Map<string, { count: number; pid: string; tty: string }>();
    for (const session of inventory.sessions) {
      const holder = session.controller;
      if (holder === undefined || holder === null) continue;
      if (holder.pid === this.#pid && holder.tty === this.#tty) continue;
      const pid = holder.pid === null ? "unknown" : String(holder.pid);
      const key = `${pid} ${holder.tty}`;
      const known = pairs.get(key);
      if (known !== undefined) known.count += 1;
      else pairs.set(key, { count: 1, pid, tty: holder.tty });
    }
    const ordered = [...pairs.values()].sort(
      (a, b) => a.tty.localeCompare(b.tty, "en") || a.pid.localeCompare(b.pid, "en"),
    );
    for (const pair of ordered) {
      this.#emit({ type: "notice", key: "station.notice.otherController" });
      this.#stdout.write(
        `[h2a] ${this.#t("station.notice.otherController", { count: pair.count, tty: pair.tty, pid: pair.pid })}\r\n`,
      );
    }
  }

  #initialCandidates(snapshot: RightPanelSnapshot, preferredTab?: string): string[] {
    const candidates: string[] = [];
    const live = new Set(snapshot.workspaces.flatMap((w) => w.sessions.map((s) => s.id)));
    const push = (id: string | undefined): void => {
      if (id !== undefined && live.has(id) && !candidates.includes(id)) candidates.push(id);
    };
    const tab = this.#state.activeTab;
    if (tab !== undefined) push(this.#state.lastSessionByTab[tab]);
    // S2: the bridge group opens on its tab: that tab's sessions lead.
    const ordered =
      preferredTab !== undefined
        ? [
            ...snapshot.workspaces.filter((workspace) => workspace.title === preferredTab),
            ...snapshot.workspaces.filter((workspace) => workspace.title !== preferredTab),
          ]
        : snapshot.workspaces;
    for (const workspace of ordered) {
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
    // S2: the bridge group becomes the initial tab; without a matching tab
    // the station warns and opens on the remembered tab instead.
    let preferredTab: string | undefined;
    if (this.#options.group !== undefined && snapshot) {
      const titles = snapshot.workspaces.map((workspace) => workspace.title);
      const initial = titles.find((title) =>
        titleMatches(title, this.#options.group as string),
      );
      if (initial !== undefined) {
        this.#persist(withActiveTab(this.#state, initial));
        preferredTab = initial;
      } else {
        this.#emit({ type: "notice", key: "station.notice.groupUnknown" });
        this.#stdout.write(
          `[h2a] ${this.#t("station.notice.groupUnknown", { group: this.#options.group })}\r\n`,
        );
      }
    }
    const candidates = snapshot ? this.#initialCandidates(snapshot, preferredTab) : [];
    const restorable = snapshot?.workspaces.flatMap((workspace) => workspace.restorable ?? []) ?? [];
    if (candidates.length === 0 && restorable.length === 0) {
      const key =
        this.#inventory !== undefined && !this.#inventory.complete
          ? "station.refusal.inventoryUnknown"
          : "station.refusal.noSession";
      const reason = this.#inventory?.hosts.find((host) => host.reason)?.reason ?? "unknown";
      this.#emit({ type: "notice", key });
      this.#stdout.write(`[h2a] ${this.#t(key, { reason: singleLine(reason) })}\r\n`);
      this.#closing = true;
      this.#refresher.dispose();
      for (const socketPath of [...this.#links.keys()]) this.#dropLink(socketPath);
      return 1;
    }
    // S6 step 4: after the first inventory, say which other terminal holds
    // sessions. A pure read of the published controller states: no lock,
    // no lease, no takeover. A station holding no lease yet is not visible.
    this.#noticeOtherControllers();

    const stdin = this.#stdin;
    let ttyState: TtyState | undefined;
    let uninstallSuspend: (() => void) | undefined;
    let terminated = false;
    const restoreStationTty = (onReset?: () => void): void => {
      const doReset = (): void => {
        try {
          const view = this.#view;
          if (view && !view.modesSuspended) {
            view.flushRelay();
            onReset?.();
            view.resetModes();
          } else {
            this.#stdout.write(this.#stationUndo.compose());
            onReset?.();
          }
        } catch {
          // Best effort on teardown.
        }
      };
      if (ttyState) {
        restoreTtyState(ttyState, stdin, doReset);
      } else {
        doReset();
      }
    };
    const terminate = (): void => {
      if (terminated) return;
      terminated = true;
      this.#ended ??= "terminate";
      this.#closing = true;
      try {
        restoreStationTty();
      } finally {
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
      // Everything h2a puts on the outer terminal is published before it is on.
      this.#stationUndo.set("h2a-hygiene", `${ESC}[4l${ESC}[?6l${ESC}[r${ESC}[0m`);
      this.#stationUndo.set("h2a-mouse", H2A_OUTER_MOUSE_RESET);
      this.#stationUndo.set("h2a-title", STATION_TITLE_POP);
      this.#stationUndo.publish(this.#runtime.saveTerminalReset, true);
      ttyState = enterRawOutputTty(stdin, this.#stdout as TtyStdout);
      if (stdin.isTTY === true || (this.#stdout as { isTTY?: boolean }).isTTY === true) {
        uninstallSuspend = installTtySuspendHandlers({
          state: ttyState,
          stdin,
          stdout: this.#stdout as TtyStdout,
          beforeSuspend: () => {
            const view = this.#liveView();
            const active = view?.active;
            if (active && this.#isTtyResponder()) {
              void active.client.setControllerResponder?.(active.lease, false).catch(() => {});
            }
            try {
              view?.flushRelay();
              const resetSeq =
                (view && !view.modesSuspended
                  ? `${view.statusBar.flushPendingSequence()}${view.statusBar.restoreSequence()}${view.modes.resetSequence({ excludeMouse: false })}`
                  : "") + this.#stationUndo.compose();
              if (resetSeq) this.#stdout.write(resetSeq);
            } catch {
              // Best effort before suspend.
            }
          },
          afterResume: () => {
            this.#stationUndo.publish(this.#runtime.saveTerminalReset, true);
            this.#stdout.write(STATION_TITLE_PUSH);
            const view = this.#liveView();
            if (view) {
              view.modesSuspended = false;
              view.enableOuterMouse();
              this.#panel.paint();
              this.#setTitle();
              void view.statusBar.probe(true, "attached");
              view.saveReset();
              view.sendChildResize();
              const active = view.active;
              if (active && this.#isTtyResponder()) {
                void active.client
                  .setControllerResponder?.(active.lease, true)
                  .then((res) => {
                    if (typeof res?.responderFromSeq === "number") {
                      view.setCatchUpUntilSeq(res.responderFromSeq);
                    }
                  })
                  .catch(() => {});
              }
            } else {
              this.#stdout.write(H2A_OUTER_MOUSE_ENABLE);
              this.#panel.paint();
            }
          },
        });
      }
      stdin.resume();
      stdin.on("data", this.#onInput);
      stdin.on("end", onEnd);
      this.#runtime.onResize(resize);
      this.#runtime.onTerminate?.(terminate);

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
      // S2 launch file: the loop never awaits it; entries settle on their own
      // while keystrokes keep flowing to the displayed session.
      this.#startRelaunchFile(restorable);
      let shown = false;
      this.#quietRefusals = true;
      try {
        for (const candidate of candidates) {
          if (this.#ended) break;
          if ((await this.#switchTo(candidate, { initial: true })) === "displayed") {
            shown = true;
            break;
          }
        }
      } finally {
        this.#quietRefusals = false;
      }
      if (!shown && !this.#ended) {
        // Nothing could be displayed (every session is held elsewhere, as when
        // restore tabs are still open): the panel lists them all and takes the
        // keyboard, so a session can be chosen — and taken only on confirmation.
        this.#stdout.write(
          `[h2a] ${this.#t("station.card.selectAnother")}\r\n${H2A_OUTER_MOUSE_ENABLE}`,
        );
        this.#panel.setOpen(true, { focus: true });
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
      this.#closing = true;
      try {
        restoreStationTty(() => {
          const view = this.#view;
          if (view && !view.modesSuspended) {
            view.restoreBarForNotice();
            this.#stdout.write(`\r\n[h2a] ${this.#t("station.notice.closed")}\r\n`);
          } else {
            this.#stdout.write(
              `\r\n[h2a] ${this.#t("station.notice.closed")}\r\n`,
            );
            this.#runtime.saveTerminalReset?.("");
          }
        });
      } finally {
        this.#runtime.offTerminate?.(terminate);
        this.#runtime.offResize(resize);
        uninstallSuspend?.();
        stdin.removeListener("data", this.#onInput);
        stdin.removeListener("end", onEnd);
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
