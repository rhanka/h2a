import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LayoutConfig } from "./config.js";
import type { RegistryEntry } from "./registry.js";

// restore() resolves $HOME with node:os.homedir() (transcript-scan roots,
// registry evidence), NOT via REMOTE_CLI_CONFIG_HOME. Redirect it to the
// per-test scratch home so this suite never reads the real ~/.claude/~/.codex.
const homedir = vi.hoisted(() => vi.fn<() => string>());
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir };
});

// No live tmux evidence: session classification must come from the durable
// registry rows alone, keeping the fixtures hermetic on any machine.
const listLocalSessions = vi.hoisted(() => vi.fn(() => []));
vi.mock("./tmux.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tmux.js")>();
  return { ...actual, listLocalSessions };
});

const {
  discoverSessions,
  effectiveRestoreMaxAgeHours,
  groupSessions,
  parseRestoreMaxAgeHours,
  parseRestoreMaxPerProject,
  restore,
} = await import("./restore.js");
const { DEFAULT_LAYOUT, DEFAULT_RESTORE_MAX_AGE_HOURS, getLayoutConfig } =
  await import("./config.js");
type DiscoveredSession = import("./restore.js").DiscoveredSession;

// Scratch dir inside the package (never /tmp). It plays the role of $HOME.
const SCRATCH_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".test-scratch",
  "restore-recovery-cli",
);

const HOUR = 3600 * 1000;
const UUID_A = "00000000-0000-4000-8000-00000000000a";
const UUID_B = "00000000-0000-4000-8000-00000000000b";
const UUID_C = "00000000-0000-4000-8000-00000000000c";
const UUID_D = "00000000-0000-4000-8000-00000000000d";

let home: string;
let prevConfigHome: string | undefined;
const silentStderr = { write: () => true } as unknown as NodeJS.WriteStream;

beforeEach(() => {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  home = mkdtempSync(join(SCRATCH_ROOT, "h-"));
  homedir.mockReturnValue(home);
  prevConfigHome = process.env.REMOTE_CLI_CONFIG_HOME;
  process.env.REMOTE_CLI_CONFIG_HOME = home;
});

afterEach(() => {
  if (prevConfigHome === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME;
  else process.env.REMOTE_CLI_CONFIG_HOME = prevConfigHome;
  rmSync(home, { recursive: true, force: true });
});

function configDir(): string {
  return join(home, ".config", "sentropic", "h2a");
}

function writeConfigJson(config: object): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(join(configDir(), "config.json"), JSON.stringify(config), "utf8");
}

function writeRegistry(entries: RegistryEntry[]): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(
    join(configDir(), "registry.json"),
    JSON.stringify({ entries }, null, 2),
    "utf8",
  );
}

/** A durable, explicitly-human `run` session — the restorable population. */
function humanRunEntry(
  project: string,
  convId: string,
  agoHours: number,
): RegistryEntry {
  const seen = new Date(Date.now() - agoHours * HOUR).toISOString();
  return {
    id: `id-${project}`,
    tool: "claude",
    kind: "local-tmux",
    cwd: join(home, "src", project),
    label: project,
    convId,
    tmuxSession: `h2a-${project}`,
    enrolledAt: seen,
    lastSeenAt: seen,
    source: "run",
    sessionClass: "human",
  };
}

/** A raw transcript on disk with a controlled mtime — the age-scanned population. */
function seedClaudeTranscript(
  project: string,
  sid: string,
  agoHours: number,
): void {
  const cwd = join(home, "src", project);
  mkdirSync(cwd, { recursive: true });
  const dir = join(
    home,
    ".claude",
    "projects",
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
  );
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sid}.jsonl`);
  writeFileSync(file, `${JSON.stringify({ cwd })}\n`, "utf8");
  const ts = new Date(Date.now() - agoHours * HOUR);
  utimesSync(file, ts, ts);
}

/**
 * A session of the population the per-project cap applies to. The cap in
 * groupSessions/slotsFor only tames candidates whose origin is NOT "registry"
 * (registry-backed sessions are each a distinct verified session and are never
 * collapsed); restoreClass "human" marks these as sessions that passed the
 * restorable filter. (Measured 2026-08-08 on the owner's population: 111 human
 * sessions, the per-project cap — multiSessionDefault 1 — was the wall that
 * dropped 90 of them.)
 */
function cappedHumanSession(
  project: string,
  sid: string,
  ageMs: number,
): DiscoveredSession {
  return {
    project,
    mtimeMs: Date.now() - ageMs,
    tool: "claude",
    sid,
    cwd: join(home, "src", project),
    origin: "scan",
    label: sid,
    restoreClass: "human",
  };
}

describe("restore recovery CLI (--max-per-project / --max-age-hours / dropped surface)", () => {
  it("--max-per-project all recovers every human session the per-project cap dropped", () => {
    const sessions = [
      cappedHumanSession("sentropic", "a", 0),
      cappedHumanSession("sentropic", "b", 1000),
      cappedHumanSession("sentropic", "c", 2000),
    ];

    // Without the flag: the default per-project cap (multiSessionDefault 1)
    // keeps only the newest session of the project.
    const capped = groupSessions(sessions, DEFAULT_LAYOUT).windows.flatMap(
      (w) => w.tabs,
    );
    expect(capped).toHaveLength(1);
    expect(capped[0]!.label).toBe("a");

    // With `all` (the CLI maps it to Infinity — explicit token, never a magic
    // big number): every dropped session is recovered.
    const all = groupSessions(sessions, DEFAULT_LAYOUT, {
      maxPerProject: parseRestoreMaxPerProject("all"),
    }).windows.flatMap((w) => w.tabs);
    expect(all.map((t) => t.label).sort()).toEqual(["a", "b", "c"]);
  });

  it("--max-per-project overrides an explicit per-project cfg.multiSession[project], not only the default", () => {
    const sessions = [
      cappedHumanSession("sentropic", "a", 0),
      cappedHumanSession("sentropic", "b", 1000),
      cappedHumanSession("sentropic", "c", 2000),
    ];
    // The user once stored an explicit override for THIS project.
    const cfg: LayoutConfig = {
      ...DEFAULT_LAYOUT,
      multiSession: { sentropic: 2 },
    };

    // Sanity: without the flag the stored override caps at 2.
    expect(
      groupSessions(sessions, cfg).windows.flatMap((w) => w.tabs),
    ).toHaveLength(2);

    // The flag REPLACES the whole `cfg.multiSession[project] ??
    // cfg.multiSessionDefault` expression: it must win over the stored
    // per-project override too — widening…
    expect(
      groupSessions(sessions, cfg, { maxPerProject: 3 }).windows.flatMap(
        (w) => w.tabs,
      ),
    ).toHaveLength(3);
    // …and narrowing (replacement, never a max/min merge with the override).
    expect(
      groupSessions(sessions, cfg, { maxPerProject: 1 }).windows.flatMap(
        (w) => w.tabs,
      ),
    ).toHaveLength(1);
  });

  it("--max-age-hours defaults to 72h when the flag is absent", () => {
    // The default lives in the CLI layer now — NOT in the config, and NOT the
    // pre-rectification 48h.
    expect(DEFAULT_RESTORE_MAX_AGE_HOURS).toBe(72);
    expect(effectiveRestoreMaxAgeHours({})).toBe(72);
    expect(effectiveRestoreMaxAgeHours({ maxAgeHours: 12 })).toBe(12);
    expect(effectiveRestoreMaxAgeHours({ maxAgeHours: Infinity })).toBe(
      Infinity,
    );

    // The window is material on the discovery scan: a ~60h-old transcript is
    // inside the flagless 72h window but OUTSIDE the old 48h one.
    seedClaudeTranscript("sixty-hours", UUID_A, 60);
    const flagless = discoverSessions(
      effectiveRestoreMaxAgeHours({}) * HOUR,
      home,
    );
    expect(flagless.map((s) => s.project)).toContain("sixty-hours");
    const old48 = discoverSessions(48 * HOUR, home);
    expect(old48.map((s) => s.project)).not.toContain("sixty-hours");
  });

  it("an existing config carrying maxAgeHours parses without error and the field is ignored", () => {
    // The owner's real config still carries `maxAgeHours: 72`. Removing the
    // field from the schema must NOT turn a config update into a startup
    // crash: the stale field is ignored, never rejected.
    writeConfigJson({
      layout: { maxAgeHours: 72, maxPerWindow: 5, sharedWindows: 1 },
    });

    let cfg: LayoutConfig | undefined;
    expect(() => {
      cfg = getLayoutConfig();
    }).not.toThrow();
    // Known fields are still honored; the stale field is not propagated.
    expect(cfg!.maxPerWindow).toBe(5);
    expect(cfg!.sharedWindows).toBe(1);
    expect("maxAgeHours" in cfg!).toBe(false);

    // And a full restore on that config proceeds (empty home -> empty layout).
    expect(() => restore({ dryRun: true, stderr: silentStderr })).not.toThrow();
  });

  it("a truncated restore emits a dropped-count line on stderr, a complete one does not", () => {
    // 1 shared window × 2 tabs -> 4 human sessions: 2 restored, 2 dropped.
    writeConfigJson({
      layout: { maxPerWindow: 2, sharedWindows: 1, multiSessionDefault: 1 },
    });
    writeRegistry([
      humanRunEntry("p1", UUID_A, 1),
      humanRunEntry("p2", UUID_B, 2),
      humanRunEntry("p3", UUID_C, 3),
      humanRunEntry("p4", UUID_D, 4),
    ]);

    const lines: string[] = [];
    const capture = {
      write: (s: string | Uint8Array) => {
        lines.push(String(s));
        return true;
      },
    } as unknown as NodeJS.WriteStream;

    const truncated = restore({ dryRun: true, stderr: capture });
    expect(truncated.dropped).toBe(2);
    const dropLine = lines.find((l) => l.includes("écartée"));
    // The line says HOW MANY…
    expect(dropLine).toBeDefined();
    expect(dropLine).toContain("2 session(s) écartée(s)");
    // …and WHY: the shared cap maxShared = sharedWindows × maxPerWindow.
    expect(dropLine).toContain("plafond");
    expect(dropLine).toContain("sharedWindows 1");
    expect(dropLine).toContain("maxPerWindow 2");

    // A complete restore (everything fits) emits no such line.
    writeRegistry([
      humanRunEntry("p1", UUID_A, 1),
      humanRunEntry("p2", UUID_B, 2),
    ]);
    const completeLines: string[] = [];
    const captureComplete = {
      write: (s: string | Uint8Array) => {
        completeLines.push(String(s));
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    const complete = restore({ dryRun: true, stderr: captureComplete });
    expect(complete.dropped).toBe(0);
    expect(complete.total).toBe(2);
    expect(completeLines.find((l) => l.includes("écartée"))).toBeUndefined();
  });

  it("non-positive / non-numeric --max-age-hours and --max-per-project are rejected; 'none'/'all' accepted", () => {
    expect(() => parseRestoreMaxAgeHours("0")).toThrow(/--max-age-hours/);
    expect(() => parseRestoreMaxAgeHours("-3")).toThrow(/--max-age-hours/);
    expect(() => parseRestoreMaxAgeHours("abc")).toThrow(/--max-age-hours/);
    expect(() => parseRestoreMaxAgeHours("")).toThrow(/--max-age-hours/);
    expect(parseRestoreMaxAgeHours("none")).toBe(Infinity);
    expect(parseRestoreMaxAgeHours("NONE")).toBe(Infinity);
    expect(parseRestoreMaxAgeHours("168")).toBe(168);

    expect(() => parseRestoreMaxPerProject("0")).toThrow(/--max-per-project/);
    expect(() => parseRestoreMaxPerProject("-1")).toThrow(/--max-per-project/);
    expect(() => parseRestoreMaxPerProject("abc")).toThrow(/--max-per-project/);
    expect(() => parseRestoreMaxPerProject("")).toThrow(/--max-per-project/);
    // A cap is a count: a fractional cap would silently truncate.
    expect(() => parseRestoreMaxPerProject("2.5")).toThrow(/--max-per-project/);
    expect(parseRestoreMaxPerProject("all")).toBe(Infinity);
    expect(parseRestoreMaxPerProject("ALL")).toBe(Infinity);
    expect(parseRestoreMaxPerProject("3")).toBe(3);
  });
});
