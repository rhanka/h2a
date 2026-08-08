import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listLocalSessionsWithDiagnostics = vi.hoisted(() => vi.fn());
const killLocalSession = vi.hoisted(() => vi.fn());
const spawn = vi.hoisted(() => vi.fn());
const listNativeSessions = vi.hoisted(() => vi.fn());

vi.mock("./tmux.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tmux.js")>();
  return { ...actual, killLocalSession, listLocalSessionsWithDiagnostics };
});

vi.mock("./native-host.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./native-host.js")>();
  return { ...actual, listNativeSessions };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn };
});

const { launchLayout } = await import("./restore.js");

describe("launchLayout prefix collision", () => {
  let previousScreen: string | undefined;
  let previousRuntimeDir: string | undefined;
  let runtimeDir: string;

  beforeEach(() => {
    listLocalSessionsWithDiagnostics.mockReset();
    listLocalSessionsWithDiagnostics.mockReturnValue({ sessions: [], known: true });
    listNativeSessions.mockReset();
    // A KNOWN-empty native view (the host answers, no sessions): a throwing
    // probe would rightly fail closed and block every launch decision.
    listNativeSessions.mockReturnValue([]);
    killLocalSession.mockReset();
    spawn.mockReset();
    spawn.mockReturnValue({ stderr: { on: vi.fn() }, unref: vi.fn() });
    previousScreen = process.env.GNOME_TERMINAL_SCREEN;
    previousRuntimeDir = process.env.XDG_RUNTIME_DIR;
    runtimeDir = mkdtempSync(join(tmpdir(), "h2a-restore-launch-"));
    process.env.XDG_RUNTIME_DIR = runtimeDir;
  });

  afterEach(() => {
    if (previousScreen === undefined) delete process.env.GNOME_TERMINAL_SCREEN;
    else process.env.GNOME_TERMINAL_SCREEN = previousScreen;
    if (previousRuntimeDir === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = previousRuntimeDir;
    rmSync(runtimeDir, { recursive: true, force: true });
  });

  it("skips the tab instead of emitting a bare-slug attach command", () => {
    listLocalSessionsWithDiagnostics.mockReturnValue({
      sessions: [
        {
          name: "h2a-proj",
          slug: "proj",
          profile: "claude",
          path: "/repo/proj",
          attached: false,
        },
        {
          name: "remote-proj",
          slug: "proj",
          profile: "claude",
          path: "/repo/proj",
          attached: false,
        },
      ],
      known: true,
    });
    const write = vi.fn(() => true);

    const result = launchLayout(
      [
        {
          title: "work",
          tabs: [
            {
              cwd: "/repo/proj",
              label: "proj",
              tool: "claude",
              sid: "conv-1",
            },
          ],
        },
      ],
      { write } as unknown as NodeJS.WriteStream,
      { reattach: true },
    );

    expect(result).toEqual({ opened: 0, skippedLive: ["proj"] });
    const output = write.mock.calls.map((call) => String(call[0])).join("");
    expect(output).toContain("h2a attach h2a-proj");
    expect(output).toContain("h2a attach remote-proj");
    expect(output).not.toContain("h2a attach 'proj'");
  });

  it("does not pass a foreign GNOME_TERMINAL_SCREEN to gnome-terminal", () => {
    process.env.GNOME_TERMINAL_SCREEN = "/org/gnome/Terminal/screen/foreign";

    const result = launchLayout(
      [
        {
          title: "work",
          tabs: [
            {
              cwd: "/repo/proj",
              label: "proj",
              tool: "claude",
              sid: "conv-1",
            },
          ],
        },
      ],
      { write: vi.fn(() => true) } as unknown as NodeJS.WriteStream,
      { reattach: true },
    );

    expect(result).toEqual({ opened: 1, skippedLive: [] });
    expect(spawn).toHaveBeenCalledTimes(1);
    const options = spawn.mock.calls[0]![2] as { env: NodeJS.ProcessEnv };
    expect(options.env).not.toHaveProperty("GNOME_TERMINAL_SCREEN");
  });

  it("re-attaches a live orphan with its exact tmux name without relaunching or changing its PID", () => {
    const orphan = {
      name: "h2a-orphan",
      slug: "orphan",
      profile: "claude",
      path: "/repo/orphan",
      tmuxServerPid: "4242",
      attached: false,
    };
    const tmuxState = { sessions: [orphan] };
    listLocalSessionsWithDiagnostics.mockImplementation(() => ({
      sessions: tmuxState.sessions,
      known: true,
    }));
    killLocalSession.mockImplementation((name: string) => {
      tmuxState.sessions = tmuxState.sessions.filter((session) => session.name !== name);
      return true;
    });
    const pidBefore = listLocalSessionsWithDiagnostics().sessions.find(
      (session) => session.name === "h2a-orphan",
    )?.tmuxServerPid;

    const result = launchLayout(
      [
        {
          title: "work",
          tabs: [
            { cwd: "/repo/orphan", label: "orphan", tool: "claude", sid: "conv-1" },
          ],
        },
      ],
      { write: vi.fn(() => true) } as unknown as NodeJS.WriteStream,
    );

    expect(result).toEqual({ opened: 1, skippedLive: [] });
    expect(spawn).toHaveBeenCalledTimes(1);
    const args = spawn.mock.calls[0]![1] as string[];
    const mapPath = args.at(-1)!;
    const command = readFileSync(mapPath, "utf8");
    // The attach rides `h2a attach` (host-agnostic: it honors the session's
    // recorded host), still bound to the EXACT managed name.
    expect(command).toContain("h2a attach 'h2a-orphan'");
    expect(command).not.toMatch(/h2a run|h2a resume|--replace/);

    expect(killLocalSession).not.toHaveBeenCalledWith("h2a-orphan");
    const pidAfter = listLocalSessionsWithDiagnostics().sessions.find(
      (session) => session.name === "h2a-orphan",
    )?.tmuxServerPid;
    expect(pidAfter).toBe(pidBefore);
  });

  it("launches an absent session and leaves an already-attached session alone", () => {
    listLocalSessionsWithDiagnostics.mockReturnValue({
      sessions: [
        {
          name: "h2a-visible",
          slug: "visible",
          profile: "claude",
          path: "/repo/visible",
          attached: true,
        },
      ],
      known: true,
    });

    const result = launchLayout(
      [
        {
          title: "work",
          tabs: [
            { cwd: "/repo/absent", label: "absent", tool: "codex", sid: "conv-a" },
            { cwd: "/repo/visible", label: "visible", tool: "claude", sid: "conv-v" },
          ],
        },
      ],
      { write: vi.fn(() => true) } as unknown as NodeJS.WriteStream,
    );

    expect(result).toEqual({ opened: 1, skippedLive: ["visible"] });
    const args = spawn.mock.calls[0]![1] as string[];
    const command = readFileSync(args.at(-1)!, "utf8");
    expect(command).toContain("h2a run 'codex' '/repo/absent' --resume 'conv-a' --name 'absent'");
    expect(command).not.toContain("visible");
  });

  it("defaults to an attach command when tmux view state is unavailable", () => {
    listLocalSessionsWithDiagnostics.mockReturnValue({
      sessions: [],
      known: false,
      reason: "tmux list failed",
    });

    const result = launchLayout(
      [
        {
          title: "work",
          tabs: [{ cwd: "/repo/unknown", label: "unknown", tool: "claude", sid: "conv-u" }],
        },
      ],
      { write: vi.fn(() => true) } as unknown as NodeJS.WriteStream,
    );

    expect(result).toEqual({ opened: 1, skippedLive: [] });
    const args = spawn.mock.calls[0]![1] as string[];
    const command = readFileSync(args.at(-1)!, "utf8");
    // Host-agnostic attach to the exact managed name (never a relaunch).
    expect(command).toContain("h2a attach 'h2a-unknown'");
    expect(command).not.toContain("h2a run");
  });
});
