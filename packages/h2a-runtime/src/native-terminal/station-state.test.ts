import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  EMPTY_STATION_STATE,
  STATION_STATE_FILE_NAME,
  readStationState,
  withCompatGuard,
  withDisplayedSession,
  withoutCompatGuard,
  writeStationState,
  type StationState,
} from "./station-state.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "h2a-station-state-"));
  file = join(dir, "config", STATION_STATE_FILE_NAME);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SAMPLE: StationState = {
  activeTab: "core",
  lastSessionByTab: { core: "h2a-conductor", docs: "h2a-spec" },
  compatGuards: {
    "h2a-api": { generation: "gen-1", incarnation: "inc-7" },
  },
};

describe("S1 station state (r4 §2, r2 §2.4 NB5)", () => {
  it("should fall back to the empty state when the file is absent, never throwing", () => {
    expect(readStationState(file)).toEqual({ state: EMPTY_STATION_STATE, status: "absent" });
  });

  it.each([
    ["truncated JSON", '{"version":1,"activeTab":"co'],
    ["a non-object", "[1,2,3]"],
    ["binary noise", "\x00\x01\xff\xfe"],
    ["an unknown version", JSON.stringify({ version: 99, activeTab: "core" })],
  ])("should fall back to the empty state on %s", (_label, content) => {
    mkdirSync(join(dir, "config"), { recursive: true });
    writeFileSync(file, content);
    expect(readStationState(file)).toEqual({ state: EMPTY_STATION_STATE, status: "unreadable" });
  });

  it("should round-trip the tab, the last session per tab and the compatibility guards", () => {
    writeStationState(file, SAMPLE);
    expect(readStationState(file)).toEqual({ state: SAMPLE, status: "ok" });
  });

  it("should persist nothing but the tab, the last session per tab and the guards", () => {
    writeStationState(file, {
      ...SAMPLE,
      // Fields of a richer in-memory object must never reach the disk.
      ...({ manualPin: { "h2a-api": true }, drafts: ["secret"] } as object),
    } as StationState);
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(
      ["activeTab", "compatGuards", "lastSessionByTab", "version"].sort(),
    );
    expect(readFileSync(file, "utf8")).not.toContain("secret");
  });

  it("should write atomically with owner-only permissions and leave no temporary file", () => {
    writeStationState(file, SAMPLE);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    writeStationState(file, { ...SAMPLE, activeTab: "docs" });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(dir, "config"))).toEqual([STATION_STATE_FILE_NAME]);
    expect(readStationState(file).state.activeTab).toBe("docs");
  });

  it("should tighten a pre-existing permissive file instead of inheriting its mode", () => {
    mkdirSync(join(dir, "config"), { recursive: true });
    writeFileSync(file, "{}", { mode: 0o644 });
    chmodSync(file, 0o644);
    writeStationState(file, SAMPLE);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("should let the last writer win between two stations", () => {
    writeStationState(file, SAMPLE);
    writeStationState(file, { activeTab: "docs", lastSessionByTab: { docs: "h2a-spec" }, compatGuards: {} });
    expect(readStationState(file).state).toEqual({
      activeTab: "docs",
      lastSessionByTab: { docs: "h2a-spec" },
      compatGuards: {},
    });
  });

  it("should drop malformed entries and keep the valid ones (tolerant read)", () => {
    mkdirSync(join(dir, "config"), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        activeTab: 42,
        lastSessionByTab: { core: "h2a-conductor", docs: 7, "": "x" },
        compatGuards: {
          "h2a-api": { generation: "gen-1", incarnation: "inc-7" },
          "h2a-bad": { generation: 3 },
          "h2a-worse": "yes",
        },
      }),
    );
    expect(readStationState(file)).toEqual({
      state: {
        lastSessionByTab: { core: "h2a-conductor" },
        compatGuards: { "h2a-api": { generation: "gen-1", incarnation: "inc-7" } },
      },
      status: "ok",
    });
  });

  it("should refuse to follow a symlinked state file on read and replace it on write", () => {
    mkdirSync(join(dir, "config"), { recursive: true });
    const target = join(dir, "elsewhere.json");
    writeFileSync(target, JSON.stringify({ version: 1, activeTab: "stolen", lastSessionByTab: {}, compatGuards: {} }));
    symlinkSync(target, file);
    expect(readStationState(file).status).toBe("unreadable");
    writeStationState(file, SAMPLE);
    expect(readStationState(file)).toEqual({ state: SAMPLE, status: "ok" });
    expect(JSON.parse(readFileSync(target, "utf8")).activeTab).toBe("stolen");
  });

  it("should never fail the station when the directory cannot be written", () => {
    mkdirSync(join(dir, "config"), { recursive: true });
    chmodSync(join(dir, "config"), 0o500);
    try {
      expect(() => writeStationState(file, SAMPLE)).not.toThrow();
      expect(readStationState(file).status).toBe("absent");
    } finally {
      chmodSync(join(dir, "config"), 0o700);
    }
  });

  it("should update the displayed session of a tab and the guard set as pure transitions", () => {
    const displayed = withDisplayedSession(EMPTY_STATION_STATE, "core", "h2a-conductor");
    expect(displayed).toEqual({
      activeTab: "core",
      lastSessionByTab: { core: "h2a-conductor" },
      compatGuards: {},
    });
    const guarded = withCompatGuard(displayed, "h2a-api", { generation: "g", incarnation: "i" });
    expect(guarded.compatGuards).toEqual({ "h2a-api": { generation: "g", incarnation: "i" } });
    expect(withoutCompatGuard(guarded, "h2a-api").compatGuards).toEqual({});
    // Inputs are never mutated.
    expect(EMPTY_STATION_STATE).toEqual({ lastSessionByTab: {}, compatGuards: {} });
    expect(displayed.compatGuards).toEqual({});
  });
});
