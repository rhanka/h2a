/**
 * Persistent state of the station (S1, r4 §2).
 *
 * The file keeps only what the station cannot read back from a host: the
 * active tab, the last displayed session of each tab, and the local
 * compatibility guards held on hosts that predate the composer broker. The
 * manual pin, the drafts and every lease live in the host, never here.
 *
 * Reads are tolerant (absent or unreadable ⇒ empty state, never a launch
 * failure). Writes are atomic, owner-only, last writer wins.
 */
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export const STATION_STATE_VERSION = 1 as const;
export const STATION_STATE_FILE_NAME = "station-state.json";
const STATION_STATE_MAX_BYTES = 1024 * 1024;

/** Identity of the lease a local compatibility guard was taken under. */
export type StationCompatGuard = Readonly<{
  generation: string;
  incarnation: string;
}>;

export type StationState = Readonly<{
  activeTab?: string;
  lastSessionByTab: Readonly<Record<string, string>>;
  compatGuards: Readonly<Record<string, StationCompatGuard>>;
}>;

export const EMPTY_STATION_STATE: StationState = Object.freeze({
  lastSessionByTab: Object.freeze({}),
  compatGuards: Object.freeze({}),
});

export type StationStateRead = Readonly<{
  state: StationState;
  status: "ok" | "absent" | "unreadable";
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function normalize(raw: unknown): StationState | undefined {
  if (!isRecord(raw) || raw.version !== STATION_STATE_VERSION) return undefined;
  const lastSessionByTab: Record<string, string> = {};
  if (isRecord(raw.lastSessionByTab)) {
    for (const [tab, session] of Object.entries(raw.lastSessionByTab)) {
      if (tab.length > 0 && nonEmptyString(session)) lastSessionByTab[tab] = session;
    }
  }
  const compatGuards: Record<string, StationCompatGuard> = {};
  if (isRecord(raw.compatGuards)) {
    for (const [session, guard] of Object.entries(raw.compatGuards)) {
      if (
        session.length > 0 &&
        isRecord(guard) &&
        nonEmptyString(guard.generation) &&
        nonEmptyString(guard.incarnation)
      ) {
        compatGuards[session] = {
          generation: guard.generation,
          incarnation: guard.incarnation,
        };
      }
    }
  }
  return {
    ...(nonEmptyString(raw.activeTab) ? { activeTab: raw.activeTab } : {}),
    lastSessionByTab,
    compatGuards,
  };
}

/** Tolerant read: never throws, never follows a symlinked state file. */
export function readStationState(path: string): StationStateRead {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return {
      state: EMPTY_STATION_STATE,
      status: code === "ENOENT" || code === "ENOTDIR" ? "absent" : "unreadable",
    };
  }
  if (!stat.isFile() || stat.size > STATION_STATE_MAX_BYTES) {
    return { state: EMPTY_STATION_STATE, status: "unreadable" };
  }
  try {
    const state = normalize(JSON.parse(readFileSync(path, "utf8")));
    if (state === undefined) return { state: EMPTY_STATION_STATE, status: "unreadable" };
    return { state, status: "ok" };
  } catch {
    return { state: EMPTY_STATION_STATE, status: "unreadable" };
  }
}

/**
 * Atomic owner-only write (process-private temporary file, then rename). A
 * write failure is swallowed: losing the remembered tab must never end the
 * station. Returns whether the state reached the disk.
 */
export function writeStationState(path: string, state: StationState): boolean {
  const payload = JSON.stringify(
    {
      version: STATION_STATE_VERSION,
      ...(state.activeTab !== undefined ? { activeTab: state.activeTab } : {}),
      lastSessionByTab: state.lastSessionByTab,
      compatGuards: Object.fromEntries(
        Object.entries(state.compatGuards).map(([session, guard]) => [
          session,
          { generation: guard.generation, incarnation: guard.incarnation },
        ]),
      ),
    },
    null,
    2,
  );
  const tmp = `${path}.tmp.${process.pid}`;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    rmSync(tmp, { force: true });
    // `wx` never follows a symlink planted at the temporary name.
    writeFileSync(tmp, payload, { mode: 0o600, flag: "wx" });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
    return true;
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
    return false;
  }
}

/** Record the session displayed in a tab; that tab becomes the active one. */
export function withDisplayedSession(
  state: StationState,
  tab: string,
  sessionId: string,
): StationState {
  return {
    ...state,
    activeTab: tab,
    lastSessionByTab: { ...state.lastSessionByTab, [tab]: sessionId },
  };
}

export function withActiveTab(state: StationState, tab: string): StationState {
  return { ...state, activeTab: tab };
}

export function withCompatGuard(
  state: StationState,
  sessionId: string,
  guard: StationCompatGuard,
): StationState {
  return {
    ...state,
    compatGuards: {
      ...state.compatGuards,
      [sessionId]: { generation: guard.generation, incarnation: guard.incarnation },
    },
  };
}

export function withoutCompatGuard(
  state: StationState,
  sessionId: string,
): StationState {
  if (!(sessionId in state.compatGuards)) return state;
  const { [sessionId]: _dropped, ...rest } = state.compatGuards;
  return { ...state, compatGuards: rest };
}
