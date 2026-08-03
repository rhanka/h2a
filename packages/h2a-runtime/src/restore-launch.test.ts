import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listLocalSessions = vi.hoisted(() => vi.fn());
const spawn = vi.hoisted(() => vi.fn());

vi.mock("./tmux.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tmux.js")>();
  return { ...actual, listLocalSessions };
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
    listLocalSessions.mockReset();
    listLocalSessions.mockReturnValue([]);
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
    listLocalSessions.mockReturnValue([
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
    ]);
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
});
