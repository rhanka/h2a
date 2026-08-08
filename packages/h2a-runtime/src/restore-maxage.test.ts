import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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

const { discoverSessions, parseRestoreMaxAgeHours, restore } = await import(
  "./restore.js"
);

// Scratch dir inside the package (never /tmp). It plays the role of $HOME.
const SCRATCH_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".test-scratch",
  "restore-maxage",
);

const HOUR = 3600 * 1000;
const UUID_A = "00000000-0000-4000-8000-00000000000a";
const UUID_B = "00000000-0000-4000-8000-00000000000b";
const UUID_C = "00000000-0000-4000-8000-00000000000c";
const UUID_D = "00000000-0000-4000-8000-00000000000d";
const UUID_E = "00000000-0000-4000-8000-00000000000e";

let home: string;
let prevConfigHome: string | undefined;
const stderr = { write: () => true } as unknown as NodeJS.WriteStream;

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

function writeRegistry(entries: RegistryEntry[]): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(
    join(configDir(), "registry.json"),
    JSON.stringify({ entries }, null, 2),
    "utf8",
  );
}

function writeLayout(layout: Partial<LayoutConfig>): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(join(configDir(), "config.json"), JSON.stringify({ layout }), "utf8");
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

describe("restore --max-age-hours (per-restore age-window override)", () => {
  // DISCRIMINATING: the flag is a FILTER (moves the age cutoff), never a
  // SELECTOR. On a fixture entirely inside BOTH the default window and a
  // widened one, widening must change nothing — same set, same order, byte
  // for byte. A selector (re-sorting, re-slicing, re-picking by age) fails this.
  it("keeps the restored set and order byte-identical when every session already fits the default window (filter, not selector)", () => {
    writeRegistry([
      humanRunEntry("alpha", UUID_A, 1),
      humanRunEntry("beta", UUID_B, 2),
      humanRunEntry("gamma", UUID_C, 3),
    ]);
    seedClaudeTranscript("delta", UUID_D, 4); // recent scan candidate, in both windows

    const base = restore({ dryRun: true, stderr });
    const widened = restore({ dryRun: true, maxAgeHours: 999999, stderr });

    expect(base.total).toBe(3); // fixture sanity: the sessions really restore
    expect(JSON.stringify(widened.windows)).toBe(JSON.stringify(base.windows));
    expect(widened.total).toBe(base.total);
    expect(widened.dropped).toBe(base.dropped);
  });

  it("applies the same per-window and per-project caps under 'none' (Infinity) as under a huge finite window — only the age axis widens", () => {
    // 1 shared window of 2 tabs -> 4 human sessions cap to 2 restored, 2 dropped.
    writeLayout({
      maxAgeHours: 48,
      maxPerWindow: 2,
      sharedWindows: 1,
      multiSessionDefault: 1,
    });
    writeRegistry([
      humanRunEntry("p1", UUID_A, 1),
      humanRunEntry("p2", UUID_B, 2),
      humanRunEntry("p3", UUID_C, 3),
      humanRunEntry("p4", UUID_D, 4),
    ]);
    // An old scan candidate that only a widened window lets into discovery:
    // it must not sneak past the caps (nor past classification) under 'none'.
    seedClaudeTranscript("p5", UUID_E, 100);

    const widened = restore({ dryRun: true, maxAgeHours: 999999, stderr });
    const none = restore({ dryRun: true, maxAgeHours: Infinity, stderr });

    expect(JSON.stringify(none.windows)).toBe(JSON.stringify(widened.windows));
    expect(none.total).toBe(widened.total);
    expect(none.dropped).toBe(widened.dropped);
    // caps sanity: the caps really dropped sessions, and 'none' kept the drops.
    expect(none.total).toBe(2);
    expect(none.dropped).toBe(2);
  });

  it("lets sessions older than the default window through the age filter once the window is widened", () => {
    // The window acts at the discovery scan: this is the ONLY age-gated
    // population (registry rows are not age-filtered, and raw scan candidates
    // are `unclassified` by construction — see isRestorableDiscoveredSession —
    // so they cannot restore further down the pipeline; measured on the
    // origin/main pipeline as of 2026-08-08, commit f35c3b82).
    seedClaudeTranscript("old-proj", UUID_A, 100); // ~100h old

    const atDefault = discoverSessions(48 * HOUR, home);
    const atWeek = discoverSessions(168 * HOUR, home);
    const unbounded = discoverSessions(Infinity, home);

    expect(atDefault.map((s) => s.project)).not.toContain("old-proj");
    expect(atWeek.map((s) => s.project)).toContain("old-proj");
    // Infinity -> cutoff of -Infinity -> no age bound (never NaN/overflow).
    expect(unbounded.map((s) => s.project)).toContain("old-proj");
  });

  it("keeps a restore without maxAgeHours on the config window (default behaviour unchanged)", () => {
    writeRegistry([
      humanRunEntry("alpha", UUID_A, 1),
      humanRunEntry("beta", UUID_B, 26),
    ]);
    seedClaudeTranscript("recent-scan", UUID_C, 1); // unclassified -> never restorable

    const r = restore({ dryRun: true, stderr });

    // Default layout: 2 shared round-robin windows, newest project first,
    // one tab per project; scan-only candidates stay out.
    expect(r.total).toBe(2);
    expect(r.dropped).toBe(0);
    expect(r.windows.map((w) => w.tabs.map((t) => t.label))).toEqual([
      ["alpha"],
      ["beta"],
    ]);
    const labels = r.windows.flatMap((w) => w.tabs.map((t) => t.label));
    expect(labels).not.toContain("recent-scan");
  });
});

describe("parseRestoreMaxAgeHours (--max-age-hours CLI value)", () => {
  it("rejects non-positive and non-numeric values (strict > 0) and maps 'none' to Infinity", () => {
    expect(() => parseRestoreMaxAgeHours("0")).toThrow(/--max-age-hours/);
    expect(() => parseRestoreMaxAgeHours("-3")).toThrow(/--max-age-hours/);
    expect(() => parseRestoreMaxAgeHours("abc")).toThrow(/--max-age-hours/);
    expect(() => parseRestoreMaxAgeHours("")).toThrow(/--max-age-hours/);
    // The restore handler catches this throw with its usual convention
    // (stderr `[h2a] …` + process.exitCode = 1 + return) — same style as the
    // gateway-flag conflict error in the same handler.
    expect(parseRestoreMaxAgeHours("none")).toBe(Infinity);
    expect(parseRestoreMaxAgeHours("NONE")).toBe(Infinity);
    expect(parseRestoreMaxAgeHours("168")).toBe(168);
    expect(parseRestoreMaxAgeHours("0.5")).toBe(0.5);
  });
});
