import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listLocalSessions = vi.hoisted(() => vi.fn());
const listLocalSessionsWithDiagnostics = vi.hoisted(() => vi.fn());
const listNativeSessions = vi.hoisted(() => vi.fn());
const spawn = vi.hoisted(() => vi.fn());
const homedirMock = vi.hoisted(() => vi.fn());

vi.mock("./tmux.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tmux.js")>();
  return { ...actual, listLocalSessions, listLocalSessionsWithDiagnostics };
});

vi.mock("./native-host.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./native-host.js")>();
  return { ...actual, listNativeSessions };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: homedirMock };
});

const {
  AGY_RESTORE_DEFAULT_MODEL,
  AGY_RESTORE_DESIGN_MODEL,
  applyRestoreProfileOverride,
  resolveRestoreAgyModel,
  resolveRestoreModelInput,
  resolveRestoreProfileInput,
  restore,
  tabCommand,
} = await import("./restore.js");
const { encodeCwd } = await import("./convsync.js");
type RegistryEntry = import("./registry.js").RegistryEntry;

const SCRATCH_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".test-scratch",
  "restore-profile",
);

const CONV_CLAUDE = "3f2504e0-4f89-41d3-9a0c-0305e82c3310";
const CONV_CODEX = "rollout-2026-11-19-design";
const CONV_AGY = "agy-conv-1111";

let scratch: string;
let home: string;
let runtimeDir: string;
let prevConfigHome: string | undefined;
let prevRuntimeDir: string | undefined;
let stderrChunks: string[];

const stderrStream = {
  write: (chunk: unknown) => {
    stderrChunks.push(String(chunk));
    return true;
  },
} as unknown as NodeJS.WriteStream;

const iso = new Date().toISOString();

function row(over: Partial<RegistryEntry> & { id: string }): RegistryEntry {
  return {
    tool: "claude",
    kind: "local-native",
    cwd: join(home, "src", "h2a"),
    sessionClass: "human",
    source: "run",
    enrolledAt: iso,
    lastSeenAt: iso,
    ...over,
  } as RegistryEntry;
}

function writeConfigAndRegistry(
  layoutGroups: Array<{ title: string; projects?: string[]; remote?: boolean }>,
  entries: RegistryEntry[],
): void {
  const dir = join(scratch, ".config", "sentropic", "h2a");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify(
      {
        layout: {
          maxAgeHours: 48,
          maxPerWindow: 12,
          sharedWindows: 1,
          multiSessionDefault: 0,
          groups: layoutGroups,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    join(dir, "registry.json"),
    JSON.stringify({ version: 1, entries }, null, 2),
    "utf8",
  );
}

function launchedMapLines(): string[] {
  return spawn.mock.calls.flatMap((call) => {
    const args = call[1] as string[];
    return readFileSync(args.at(-1)!, "utf8").split("\n").filter(Boolean);
  });
}

beforeEach(() => {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  scratch = mkdtempSync(join(SCRATCH_ROOT, "p-"));
  home = join(scratch, "home");
  runtimeDir = join(scratch, "run");
  mkdirSync(join(home, "src", "h2a"), { recursive: true });
  mkdirSync(join(home, "src", "ds"), { recursive: true });
  mkdirSync(join(home, "src", "portal"), { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  homedirMock.mockReset().mockReturnValue(home);
  prevConfigHome = process.env.REMOTE_CLI_CONFIG_HOME;
  process.env.REMOTE_CLI_CONFIG_HOME = scratch;
  prevRuntimeDir = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = runtimeDir;
  listLocalSessions.mockReset().mockReturnValue([]);
  listLocalSessionsWithDiagnostics
    .mockReset()
    .mockReturnValue({ sessions: [], known: true });
  listNativeSessions.mockReset().mockReturnValue([]);
  spawn.mockReset().mockReturnValue({ stderr: { on: vi.fn() }, unref: vi.fn() });
  stderrChunks = [];
});

afterEach(() => {
  if (prevConfigHome === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME;
  else process.env.REMOTE_CLI_CONFIG_HOME = prevConfigHome;
  if (prevRuntimeDir === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = prevRuntimeDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("resolveRestoreAgyModel (role-based model mapping)", () => {
  it("maps conductor and build labels to gemini-4-neon-high", () => {
    for (const label of ["h-cond", "cond", "h-build", "h-infra", "ops-lane", "impl-api"]) {
      expect(resolveRestoreAgyModel({ label })).toEqual({
        model: AGY_RESTORE_DEFAULT_MODEL,
        role: "build-conductor",
      });
    }
  });

  it("maps design/architecture/spec labels to gemini-4-carbon", () => {
    for (const label of ["h-design", "design", "ux-review", "ui-kit", "arch", "archi", "spec-writer", "sent-tech-design-system"]) {
      expect(resolveRestoreAgyModel({ label })).toEqual({
        model: AGY_RESTORE_DESIGN_MODEL,
        role: "design",
      });
    }
  });

  it("gives build/conductor priority over design tokens when both appear", () => {
    for (const label of ["design-cond", "ds-build", "arch-infra", "ui-conductor"]) {
      expect(resolveRestoreAgyModel({ label })).toEqual({
        model: AGY_RESTORE_DEFAULT_MODEL,
        role: "build-conductor",
      });
    }
  });

  it("defaults unlabelled/general sessions to gemini-4-neon-high", () => {
    for (const label of ["h2a", "track", "coop", "gateway", "portal"]) {
      expect(resolveRestoreAgyModel({ label })).toEqual({
        model: AGY_RESTORE_DEFAULT_MODEL,
        role: "default",
      });
    }
  });

  it("always lets explicit --model override the role rule and normalizes aliases", () => {
    expect(
      resolveRestoreAgyModel({ label: "h-design", explicitModel: "gemini-4-neon-high" }),
    ).toEqual({ model: "gemini-4-neon-high", role: "explicit" });
    expect(
      resolveRestoreAgyModel({ label: "h-cond", explicitModel: "carbon" }),
    ).toEqual({ model: "gemini-4-carbon", role: "explicit" });
    expect(
      resolveRestoreAgyModel({ label: "h-design", explicitModel: "neon" }),
    ).toEqual({ model: "gemini-4-neon-high", role: "explicit" });
  });
});

describe("profile and model CLI input validation", () => {
  it("accepts canonical profiles and aliases and rejects unknown ones", () => {
    expect(resolveRestoreProfileInput("agy")).toBe("agy");
    expect(resolveRestoreProfileInput("antigravity")).toBe("agy");
    expect(resolveRestoreProfileInput("claude-code")).toBe("claude");
    expect(() => resolveRestoreProfileInput("bogus")).toThrow(/invalid --profile/i);
    expect(() => resolveRestoreProfileInput("shell")).toThrow(/invalid --profile/i);
  });

  it("normalizes AGY models and rejects invalid model tokens or efforts", () => {
    expect(resolveRestoreModelInput("gemini-4-neon-high", "agy")).toBe("gemini-4-neon-high");
    expect(resolveRestoreModelInput("neon", "agy")).toBe("gemini-4-neon-high");
    expect(resolveRestoreModelInput("carbon", "agy")).toBe("gemini-4-carbon");
    expect(() => resolveRestoreModelInput("-bad", "agy")).toThrow(/invalid model/i);
    expect(() => resolveRestoreModelInput("gemini-4-carbon-max", "agy")).toThrow(/effort/i);
  });
});

describe("applyRestoreProfileOverride + tabCommand", () => {
  it("rewrites claude/codex tabs to agy, drops foreign sid and Claude-only pins, preserves agy sid and remote tabs", () => {
    const cwdClaude = join(home, "src", "h2a");
    const transcriptDir = join(home, ".claude", "projects", encodeCwd(cwdClaude));
    mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = join(transcriptDir, `${CONV_CLAUDE}.jsonl`);
    writeFileSync(transcriptPath, "{}\n", "utf8");

    const rewritten = applyRestoreProfileOverride(
      [
        {
          title: "throwaway",
          tabs: [
            {
              cwd: cwdClaude,
              label: "h-cond",
              tool: "claude",
              sid: CONV_CLAUDE,
              model: "claude-opus-4-8",
              gatewayMode: "gateway",
              gatewayProvenance: "explicit",
              bare: true,
              hostKind: "local-native",
              managedName: "h2a-h-cond",
              task: "Coordinate release gate",
            },
            {
              cwd: join(home, "src", "ds"),
              label: "h-design",
              tool: "codex",
              sid: CONV_CODEX,
              model: "gpt-5.6-terra",
              hostKind: "local-tmux",
              managedName: "h2a-h-design",
            },
            {
              cwd: join(home, "src", "portal"),
              label: "portal-agy",
              tool: "agy",
              sid: CONV_AGY,
              hostKind: "local-native",
              managedName: "h2a-portal-agy",
            },
            {
              cwd: "/pod/work",
              label: "scw-pod",
              remoteId: "sess-remote-1",
            },
          ],
        },
      ],
      { profile: "agy", home },
    );

    const tabs = rewritten[0]!.tabs;
    expect(tabs).toHaveLength(4);

    // 1. Claude conductor -> agy neon-high, no --resume, no --gw, no --bare
    expect(tabs[0]).toMatchObject({
      label: "h-cond",
      cwd: cwdClaude,
      tool: "agy",
      model: "gemini-4-neon-high",
      hostKind: "local-native",
      rewrite: {
        fromTool: "claude",
        fromModel: "claude-opus-4-8",
        toTool: "agy",
        toModel: "gemini-4-neon-high",
        modelRole: "build-conductor",
        crossProfile: true,
        droppedSid: CONV_CLAUDE,
        priorTranscriptPath: transcriptPath,
        hasBrief: true,
      },
    });
    expect(tabs[0]!.sid).toBeUndefined();
    expect(tabCommand(tabs[0]!)).toBe(
      `H2A_SESSION_HOST=native h2a run 'agy' '${cwdClaude}' --name 'h-cond' --model 'gemini-4-neon-high'`,
    );

    // 2. Codex design -> agy carbon, no --resume, preserves --tmux pin
    expect(tabs[1]).toMatchObject({
      label: "h-design",
      tool: "agy",
      model: "gemini-4-carbon",
      hostKind: "local-tmux",
    });
    expect(tabs[1]!.sid).toBeUndefined();
    expect(tabCommand(tabs[1]!)).toBe(
      `h2a run 'agy' '${join(home, "src", "ds")}' --name 'h-design' --model 'gemini-4-carbon' --tmux`,
    );

    // 3. Existing agy session preserves its native AGY conversation id
    expect(tabs[2]).toMatchObject({
      label: "portal-agy",
      tool: "agy",
      sid: CONV_AGY,
      model: "gemini-4-neon-high",
      rewrite: { crossProfile: false },
    });
    expect(tabCommand(tabs[2]!)).toBe(
      `H2A_SESSION_HOST=native h2a run 'agy' '${join(home, "src", "portal")}' --resume '${CONV_AGY}' --name 'portal-agy' --model 'gemini-4-neon-high'`,
    );

    // 4. Remote pod tab stays untouched
    expect(tabCommand(tabs[3]!)).toBe("h2a attach 'sess-remote-1' --exec");
  });
});

describe("restore() end-to-end with --profile agy", () => {
  it("prints the per-session old->new plan in --dry-run without launching or writing handoffs", () => {
    const cwdH2a = join(home, "src", "h2a");
    const cwdDs = join(home, "src", "ds");
    const cwdPortal = join(home, "src", "portal");
    writeConfigAndRegistry(
      [{ title: "throwaway", projects: ["h2a", "ds", "portal"] }],
      [
        row({
          id: "h-cond",
          label: "h-cond",
          tool: "claude",
          model: "claude-opus-4-8",
          cwd: cwdH2a,
          convId: CONV_CLAUDE,
          tmuxSession: "h2a-h-cond",
          gatewayMode: "gateway",
          gatewayProvenance: "explicit",
          task: "Keep CI green",
        }),
        row({
          id: "h-design",
          label: "h-design",
          tool: "codex",
          model: "gpt-5.6-terra",
          cwd: cwdDs,
          convId: CONV_CODEX,
          tmuxSession: "h2a-h-design",
        }),
        row({
          id: "portal-live",
          label: "portal-live",
          tool: "claude",
          cwd: cwdPortal,
          convId: "3f2504e0-4f89-41d3-9a0c-0305e82c3399",
          tmuxSession: "h2a-portal-live",
        }),
      ],
    );
    // portal-live is currently running (detached) on native host -> must stay attach-only
    listNativeSessions.mockReturnValue([
      { id: "h2a-portal-live", pid: 9999, status: "running", exit: null, controlled: false },
    ]);

    const res = restore({
      group: "throwaway",
      profile: "agy",
      dryRun: true,
      stderr: stderrStream,
    });

    expect(res.total).toBe(3);
    expect(spawn).not.toHaveBeenCalled();

    const out = stderrChunks.join("");
    expect(out).toContain("claude (claude-opus-4-8) -> agy (gemini-4-neon-high, role: build/conductor)");
    expect(out).toContain("codex (gpt-5.6-terra) -> agy (gemini-4-carbon, role: design)");
    expect(out).toContain(`claude conv ${CONV_CLAUDE} lost (not resumable by agy)`);
    expect(out).toContain("brief -> handoff");
    expect(out).toContain("LIVE on local-native — attach only");
    expect(out).toContain("h2a attach 'h2a-portal-live'");
    expect(out).toContain("Claude/Codex conversation history cannot be resumed by agy");
    // Dry-run must stay side-effect-free: no handoff files written
    const runSubdir = join(runtimeDir, "sentropic-remote");
    expect(existsSync(runSubdir)).toBe(false);
  });

  it("keeps dead claude rows with unresolved convId when --profile agy is active and writes handoff on launch", () => {
    const cwdH2a = join(home, "src", "h2a");
    writeConfigAndRegistry(
      [{ title: "throwaway", projects: ["h2a"] }],
      [
        row({
          id: "h-cond",
          label: "h-cond",
          tool: "claude",
          cwd: cwdH2a,
          // Canonical-broken convId (equals label) -> normally skipped, but
          // --profile agy launches fresh so it must NOT drop the slot.
          convId: "h-cond",
          tmuxSession: "h2a-h-cond",
          task: "Resume integration lane",
        }),
      ],
    );

    const res = restore({
      group: "throwaway",
      profile: "agy",
      model: "gemini-4-neon-high",
      stderr: stderrStream,
    });

    expect(res.total).toBe(1);
    const lines = launchedMapLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      `${cwdH2a}\tH2A_SESSION_HOST=native h2a run 'agy' '${cwdH2a}' --name 'h-cond' --model 'gemini-4-neon-high'`,
    );
    expect(stderrChunks.join("")).not.toContain('restore skipped "h-cond"');

    // Handoff file written in runtimeDir (never inside cwd)
    const runSubdir = join(runtimeDir, "sentropic-remote");
    const handoffFiles = readdirSync(runSubdir).filter((f) =>
      f.startsWith("restore-handoff-"),
    );
    expect(handoffFiles).toHaveLength(1);
    const body = readFileSync(join(runSubdir, handoffFiles[0]!), "utf8");
    expect(body).toContain("Resume integration lane");
    expect(body).toContain("cannot be resumed directly by `agy`");
  });
});
