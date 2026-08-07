import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Mock child_process at the module boundary so NOTHING here ever talks to the
// user's real tmux server (or shells out at all).
const spawnSyncMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));
const tmuxProfileConfigMock = vi.hoisted(() =>
  vi.fn(() => ({ profile: "remote" })),
);
vi.mock("./config.js", () => ({
  getTmuxProfileConfig: tmuxProfileConfigMock,
}));

import {
  H2A_WINDOW_NAME,
  HEADLESS_WRAPPER,
  LEGACY_LOCAL_PREFIX,
  LOCAL_PREFIX,
  LOCAL_WRAPPER,
  REMOTE_TMUX_PROFILE,
  REMOTE_TMUX_PROFILE_NAME,
  STRUCTURED_LOCAL_WRAPPER,
  STRUCTURED_WINDOW_WRAPPER,
  attachLocalSession,
  buildCodexImagePasteBinding,
  buildSessionWindowArgs,
  buildStructuredSessionWindowArgs,
  buildTmuxGlobalOptions,
  capturePaneVisible,
  clearPaneComposer,
  ensureHeadlessTerminal,
  pasteLiteralBlock,
  cleanupHeadlessPromptFile,
  ensureManagedTmuxProfile,
  existingLocalSessionSlugs,
  fanoutLabels,
  getLocalSessionDisplayName,
  listLocalSessions,
  killLocalSession,
  localRelaunchCommand,
  localSessionName,
  localSessionPanePid,
  resolveAgentPaneForInstance,
  resolveLocalSession,
  managedSessionCandidates,
  parseManagedSessionName,
  sendKeysLiteral,
  sessionAttachedCount,
  sessionRelaunchSafety,
  setLocalSessionDisplayName,
  startLocalSession,
  startHeadlessSession,
  installH2aStatusSurface,
  installH2aStatusSurfaceWithAccess,
  type H2aStatusOptionAccess,
  startH2aWindow,
  startH2aWindowVerified,
  validateManagedTmuxProfile,
} from "./tmux.js";

// child_process is mocked module-wide (above); the wrapper regression test needs
// the REAL spawnSync to actually run bash.
const { spawnSync: realSpawnSync } =
  await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );

const H2A_CMD = "h2a mcp-serve --auto-open --auto-upgrade --wake local-tmux";
const ORIGINAL_TMUX_ENV = process.env.TMUX;
const ORIGINAL_ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
const ORIGINAL_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ORIGINAL_ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;

beforeEach(() => {
  spawnSyncMock.mockReset();
  spawnMock.mockReset();
  tmuxProfileConfigMock.mockReset();
  tmuxProfileConfigMock.mockReturnValue({ profile: REMOTE_TMUX_PROFILE_NAME });
});

afterEach(() => {
  if (ORIGINAL_TMUX_ENV === undefined) {
    delete process.env.TMUX;
  } else {
    process.env.TMUX = ORIGINAL_TMUX_ENV;
  }
  if (ORIGINAL_ANTHROPIC_BASE_URL === undefined) {
    delete process.env.ANTHROPIC_BASE_URL;
  } else {
    process.env.ANTHROPIC_BASE_URL = ORIGINAL_ANTHROPIC_BASE_URL;
  }
  if (ORIGINAL_ANTHROPIC_API_KEY === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_API_KEY;
  }
  if (ORIGINAL_ANTHROPIC_AUTH_TOKEN === undefined) {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  } else {
    process.env.ANTHROPIC_AUTH_TOKEN = ORIGINAL_ANTHROPIC_AUTH_TOKEN;
  }
});

/** Calls to `tmux <subcommand> …` recorded by the mock. */
function tmuxCalls(subcommand: string): unknown[][] {
  return spawnSyncMock.mock.calls.filter(
    (c) => c[0] === "tmux" && Array.isArray(c[1]) && c[1][0] === subcommand,
  );
}

function fakeStderr(): { write: (s: string) => boolean; text: () => string } {
  let buf = "";
  return {
    write: (s: string) => {
      buf += s;
      return true;
    },
    text: () => buf,
  };
}

/**
 * The current `list-sessions` projection deliberately includes identity and
 * server fields before the managed-session fields.  Keep fixtures shaped like
 * the real tmux format so managed-session resolution is exercised rather than
 * silently filtered as a malformed row.
 */
function tmuxSessionRow(
  name: string,
  attached: number,
  path: string,
  profile: string,
  displayName = "",
): string {
  return `$1\t1710000000\t1234\t/tmp/tmux-1000/default\t${name}\t${attached}\t${path}\t${profile}\t${displayName}\n`;
}

function parseRunShellScriptArg(commandArg: string): string {
  const prefix = "run-shell -b ";
  if (!commandArg.startsWith(prefix)) {
    throw new Error(`expected run-shell binding command, got: ${commandArg}`);
  }
  const quoted = commandArg.slice(prefix.length);
  if (!quoted.startsWith("'") || !quoted.endsWith("'")) {
    throw new Error(`expected run-shell command to be single-quoted: ${commandArg}`);
  }
  return quoted.slice(1, -1).replace(/'\\''/g, "'");
}

describe("attachLocalSession", () => {
  it("uses tmux attach-session outside tmux", () => {
    delete process.env.TMUX;
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "" });

    const status = attachLocalSession("remote-projA");

    expect(status).toBe(0);
    expect(spawnSyncMock.mock.calls).toContainEqual([
      "tmux",
      ["attach-session", "-t", "=remote-projA"],
      { stdio: "inherit" },
    ]);
  });

  it("uses tmux switch-client inside tmux and returns its status", () => {
    process.env.TMUX = "/tmp/tmux-1000/default,1,0";
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "switch-client") {
        return { status: 7, stdout: "" };
      }
      return { status: 0, stdout: "" };
    });

    const status = attachLocalSession("remote-projA");

    expect(status).toBe(7);
    expect(spawnSyncMock.mock.calls).toContainEqual([
      "tmux",
      ["switch-client", "-t", "=remote-projA"],
      { stdio: "inherit" },
    ]);
  });
});

describe("ensureHeadlessTerminal", () => {
  it("starts a persistent fixed-size PTY client and proves tmux sees it attached", () => {
    let attachedReads = 0;
    const unref = vi.fn();
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "display") {
        attachedReads += 1;
        return { status: 0, stdout: attachedReads === 1 ? "0\n" : "1\n" };
      }
      if (cmd === "bash") return { status: 0, stdout: "" };
      return { status: 0, stdout: "" };
    });
    spawnMock.mockReturnValue({ on: vi.fn(), unref });

    expect(ensureHeadlessTerminal("h2a-agent")).toEqual({
      state: "headless-attached",
      attachedClients: 1,
      cols: 160,
      rows: 48,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "/bin/sh",
      [
        "-c",
        expect.stringMatching(/script -qefc.*stty cols 160 rows 48/),
      ],
      expect.objectContaining({
        detached: true,
        stdio: "ignore",
        env: expect.objectContaining({
          H2A_HEADLESS_TARGET: "=h2a-agent:",
        }),
      }),
    );
    const shellCommand = spawnMock.mock.calls[0]?.[1]?.[1];
    expect(shellCommand).toContain('sleep infinity > "$pipe" &');
    expect(shellCommand).toContain("trap cleanup EXIT");
    expect(shellCommand).not.toContain("tail -f /dev/null");
    expect(unref).toHaveBeenCalledOnce();
    expect(tmuxCalls("set-option")).toContainEqual([
      "tmux",
      [
        "set-option",
        "-t",
        "=h2a-agent:",
        "@h2a_attached_terminal",
        "headless:160x48",
      ],
      { stdio: "ignore" },
    ]);
  });

  it("keeps an existing human terminal and does not spawn a second client", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "2\n" });

    expect(ensureHeadlessTerminal("h2a-agent")).toEqual({
      state: "already-attached",
      attachedClients: 2,
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("fails closed when a new client never becomes attached", () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "display") {
        return { status: 0, stdout: "0\n" };
      }
      return { status: 0, stdout: "" };
    });
    spawnMock.mockReturnValue({ on: vi.fn(), unref: vi.fn() });

    expect(ensureHeadlessTerminal("h2a-agent", { timeoutMs: 0 })).toEqual({
      state: "unavailable",
      reason: "tmux client did not attach within 0ms",
    });
  });
});

describe("killLocalSession", () => {
  it("does not issue a kill when a batch target becomes a new live worker after its dead re-check", () => {
    let deadClockCalls = 0;
    const rechecked = sessionRelaunchSafety("h2a-proj", {
      resolvePane: () => "%7",
      panePid: () => 100,
      paneCommand: () => "bash",
      observe: () => ({
        cpuMs: 0,
        worker: { pid: 100, startTime: "100", bootId: "boot" },
        procView: { currentBootId: "boot", processes: [] },
      }),
      sleep: () => {},
      now: () => (deadClockCalls++ === 0 ? 1_000 : 1_250),
    });
    let liveClockCalls = 0;

    expect(rechecked).toMatchObject({
      dead: true,
      identity: { pane: "%7", panePid: 100 },
    });
    expect(
      killLocalSession("h2a-proj", rechecked.identity!, {
        resolvePane: () => "%8",
        panePid: () => 200,
        paneCommand: () => "bash",
        observe: () => ({
          cpuMs: 10,
          worker: { pid: 201, startTime: "201", bootId: "boot" },
          procView: { currentBootId: "boot", processes: [] },
        }),
        sleep: () => {},
        now: () => (liveClockCalls++ === 0 ? 2_000 : 2_250),
      }),
    ).toBe(false);

    const forcedActionCount = tmuxCalls("kill-session").filter(
      ([, args]) => Array.isArray(args) && args.includes("=h2a-proj:"),
    ).length;
    expect(forcedActionCount).toBe(0);
  });

  it("uses an exact tmux session target", () => {
    spawnSyncMock.mockReturnValue({ status: 0 });

    expect(killLocalSession("h2a-proj")).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "tmux",
      ["kill-session", "-t", "=h2a-proj:"],
      { stdio: "ignore" },
    );
  });
});

describe("buildSessionWindowArgs (pure)", () => {
  it("builds a detached NAMED window running the command line under the drop-to-shell wrapper", () => {
    const args = buildSessionWindowArgs(
      "remote-surch",
      H2A_WINDOW_NAME,
      "/home/u/src/surch",
      H2A_CMD,
    );
    expect(args.slice(0, 8)).toEqual([
      "new-window",
      "-d",
      "-t",
      "remote-surch",
      "-n",
      "h2a",
      "-c",
      "/home/u/src/surch",
    ]);
    expect(args[8]).toBe("/bin/bash");
    expect(args[9]).toBe("-lc");
    // wrapper: runs the command line, then drops to a shell instead of dying
    expect(args[10]).toContain('eval "$cmd"');
    expect(args[10]).toContain("exec /bin/bash -l");
    // the command line is passed VERBATIM as the final wrapper arg.
    expect(args[args.length - 1]).toBe(H2A_CMD);
  });

  it("exports the agent pane before eval when a wake target pane is provided", () => {
    const args = buildSessionWindowArgs(
      "remote-surch",
      H2A_WINDOW_NAME,
      "/home/u/src/surch",
      H2A_CMD,
      "%42",
    );
    expect(args[10]).toContain('export TMUX_PANE="$agent_pane"');
    expect(args[10]!.indexOf("export TMUX_PANE")).toBeLessThan(
      args[10]!.indexOf('eval "$cmd"'),
    );
    expect(args[args.length - 2]).toBe("%42");
    expect(args[args.length - 1]).toBe(H2A_CMD);
  });
});

describe("buildStructuredSessionWindowArgs (pure)", () => {
  it("captures the exact pane and has no shell fallback", () => {
    const readiness = {
      file: "/tmp/h2a-ready-test/ready.json",
      nonce: "11111111-1111-4111-8111-111111111111",
    };
    const args = buildStructuredSessionWindowArgs(
      "remote-worker",
      H2A_WINDOW_NAME,
      "/home/u/src/repo",
      H2A_CMD,
      "%7",
      readiness,
    );
    expect(args.slice(0, 5)).toEqual([
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
    ]);
    expect(args).toContain(STRUCTURED_WINDOW_WRAPPER);
    expect(STRUCTURED_WINDOW_WRAPPER).toContain('eval "exec $cmd"');
    expect(STRUCTURED_WINDOW_WRAPPER).not.toContain("exec /bin/bash -l");
    expect(args).toContain(`H2A_MCP_READY_FILE=${readiness.file}`);
    expect(args).toContain(`H2A_MCP_READY_NONCE=${readiness.nonce}`);
    expect(args.slice(-2)).toEqual(["%7", H2A_CMD]);
  });
});

describe("startLocalSession agent pane metadata", () => {
  it("applies the configured managed tmux profile by default before creating a session", () => {
    tmuxProfileConfigMock.mockReturnValue({ profile: "old-pc" });
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "-V") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-sessions")
        return { status: 1, stdout: "" };
      if (cmd === "tmux" && args[0] === "new-session") return { status: 0 };
      return { status: 0, stdout: "" };
    });

    startLocalSession("claude", "claude", "/home/u/src/remote", [], "remote");

    const setLines = tmuxCalls("set").map((c) => (c[1] as string[]).join(" "));
    expect(setLines).toContain("set -g @remote_profile old-pc");
  });

  it("passes Anthropic gateway env explicitly to tmux new-session", () => {
    process.env.ANTHROPIC_BASE_URL = "http://localhost:3002";
    process.env.ANTHROPIC_AUTH_TOKEN = "gw-test";
    process.env.ANTHROPIC_API_KEY = "gw-test";
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "-V") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-sessions")
        return { status: 1, stdout: "" };
      if (cmd === "tmux" && args[0] === "new-session") return { status: 0 };
      return { status: 0, stdout: "" };
    });

    startLocalSession("claude", "claude", "/home/u/src/remote", [], "remote");

    const newSession = tmuxCalls("new-session")[0]!;
    expect(newSession[1]).toContain("ANTHROPIC_BASE_URL=http://localhost:3002");
    expect(newSession[1]).toContain("ANTHROPIC_AUTH_TOKEN=gw-test");
    expect(newSession[1]).toContain("ANTHROPIC_API_KEY=gw-test");
  });

  it("records the launch context (@remote_launch_*) with the gateway state, never a secret", () => {
    process.env.ANTHROPIC_BASE_URL = "http://localhost:3002";
    process.env.ANTHROPIC_AUTH_TOKEN = "sk-should-never-be-stored";
    delete process.env.ANTHROPIC_API_KEY;
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "-V") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-sessions")
        return { status: 1, stdout: "" };
      if (cmd === "tmux" && args[0] === "new-session") return { status: 0 };
      return { status: 0, stdout: "" };
    });

    startLocalSession("claude", "claude", "/home/u/src/remote", [], "remote");

    const setOpt = spawnSyncMock.mock.calls
      .filter(
        (c) => c[0] === "tmux" && Array.isArray(c[1]) && c[1][0] === "set-option",
      )
      .map((c) => (c[1] as string[]).join(" "));
    expect(setOpt).toContain(
      "set-option -t =h2a-remote: @remote_launch_profile claude",
    );
    expect(setOpt).toContain(
      "set-option -t =h2a-remote: @remote_launch_gateway on",
    );
    expect(setOpt).toContain(
      "set-option -t =h2a-remote: @remote_launch_gateway_base_url http://localhost:3002",
    );
    // the auth token is never read, so it can never land in a stored option
    expect(setOpt.join("\n")).not.toContain("sk-should-never-be-stored");
  });

  it("keeps ordinary CLI args out of resume metadata and relaunch hints", () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "-V") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-sessions")
        return { status: 1, stdout: "" };
      if (cmd === "tmux" && args[0] === "new-session") return { status: 0 };
      return { status: 0, stdout: "" };
    });

    startLocalSession(
      "codex",
      "codex",
      "/home/u/src/remote",
      ["--verbose"],
      "worker",
      "remote",
      { resumeId: "conv-123", h2aCommand: H2A_CMD },
    );

    const newSession = tmuxCalls("new-session")[0]![1] as string[];
    expect(newSession).toContain("--verbose");
    expect(newSession).toContain("h2a run codex /home/u/src/remote --name worker -r conv-123");
    expect(
      spawnSyncMock.mock.calls.some(
        (call) =>
          call[0] === "tmux" &&
          Array.isArray(call[1]) &&
          call[1].includes("@remote_launch_resume") &&
          call[1].includes("conv-123"),
      ),
    ).toBe(true);
    expect(
      spawnSyncMock.mock.calls.some(
        (call) =>
          call[0] === "tmux" &&
          Array.isArray(call[1]) &&
          call[1].includes("@remote_launch_resume") &&
          call[1].includes("--verbose"),
      ),
    ).toBe(false);
  });

  it("uses the no-shell-fallback wrapper for structured prompt sessions", () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "-V") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-sessions") {
        return { status: 1, stdout: "" };
      }
      if (cmd === "tmux" && args[0] === "new-session") {
        return { status: 0, stdout: "%7\n" };
      }
      return { status: 0, stdout: "" };
    });

    startLocalSession(
      "claude",
      "claude",
      "/home/u/src/remote",
      ["--model", "opus"],
      "worker",
      "remote",
      { terminateOnAgentExit: true },
    );

    const argv = tmuxCalls("new-session")[0]![1] as string[];
    expect(argv).toContain(STRUCTURED_LOCAL_WRAPPER);
    expect(argv).not.toContain(LOCAL_WRAPPER);
    expect(argv).not.toContain("h2a run claude /home/u/src/remote --name worker");
    expect(argv.slice(-4)).toEqual([
      STRUCTURED_LOCAL_WRAPPER,
      "claude",
      "--model",
      "opus",
    ]);
  });

  it("attaches the PTY before respawning a structured agent into its pane", () => {
    let attachedReads = 0;
    spawnSyncMock.mockImplementation((cmd: string, argv: string[]) => {
      if (cmd === "tmux" && argv[0] === "-V") return { status: 0 };
      if (cmd === "tmux" && argv[0] === "list-sessions") {
        return { status: 1, stdout: "" };
      }
      if (cmd === "tmux" && argv[0] === "new-session") {
        return { status: 0, stdout: "%17\n" };
      }
      if (cmd === "tmux" && argv[0] === "display") {
        attachedReads += 1;
        return { status: 0, stdout: attachedReads === 1 ? "0\n" : "1\n" };
      }
      if (cmd === "bash") return { status: 0, stdout: "" };
      return { status: 0, stdout: "" };
    });
    spawnMock.mockReturnValue({ on: vi.fn(), unref: vi.fn() });

    startLocalSession(
      "codex",
      "codex",
      "/home/u/src/remote",
      ["--model", "gpt-5.6"],
      "worker",
      "remote",
      { terminateOnAgentExit: true, attachedTerminal: true },
    );

    const newSession = tmuxCalls("new-session")[0]![1] as string[];
    expect(newSession).toContain("exec sleep 86400");
    expect(newSession).not.toContain(STRUCTURED_LOCAL_WRAPPER);
    const respawn = tmuxCalls("respawn-pane")[0]![1] as string[];
    expect(respawn.slice(0, 6)).toEqual([
      "respawn-pane",
      "-k",
      "-t",
      "%17",
      "-c",
      "/home/u/src/remote",
    ]);
    expect(respawn).toContain(STRUCTURED_LOCAL_WRAPPER);
    expect(respawn.slice(-4)).toEqual([
      STRUCTURED_LOCAL_WRAPPER,
      "codex",
      "--model",
      "gpt-5.6",
    ]);
  });

  it("refuses a structured duplicate inside startLocalSession without effects", () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "-V") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-sessions") {
        return {
          status: 0,
          stdout: tmuxSessionRow("remote-worker", 0, "/home/u/src/remote", "claude", "worker"),
        };
      }
      return { status: 0, stdout: "" };
    });

    expect(() =>
      startLocalSession(
        "claude",
        "claude",
        "/home/u/src/remote",
        [],
        "worker",
        "remote",
        { refuseExisting: true },
      ),
    ).toThrow(/already exists.*no agent was started/i);
    expect(tmuxCalls("new-session")).toHaveLength(0);
  });

  it("reuses a legacy-only session instead of creating a conflicting canonical name", () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "-V") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-sessions") {
        return {
          status: 0,
          stdout: tmuxSessionRow("remote-worker", 0, "/home/u/src/repo", "claude"),
        };
      }
      if (cmd === "tmux" && args[0] === "show-options") {
        return { status: 1, stdout: "" };
      }
      if (cmd === "tmux" && args[0] === "list-panes") {
        return { status: 0, stdout: "claude\t%9\n" };
      }
      return { status: 0, stdout: "" };
    });

    expect(
      startLocalSession("claude", "claude", "/home/u/src/repo", [], "worker"),
    ).toMatchObject({ name: "remote-worker", slug: "worker" });
    expect(tmuxCalls("new-session")).toHaveLength(0);
  });

  it("refuses a bare slug shared by canonical and legacy sessions", () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "-V") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-sessions") {
        return {
          status: 0,
          stdout:
            tmuxSessionRow("h2a-worker", 0, "/home/u/src/repo", "claude") +
            tmuxSessionRow("remote-worker", 0, "/home/u/src/repo", "claude"),
        };
      }
      return { status: 0, stdout: "" };
    });

    expect(() =>
      startLocalSession("claude", "claude", "/home/u/src/repo", [], "worker"),
    ).toThrow(/ambiguous/);
    expect(tmuxCalls("new-session")).toHaveLength(0);
  });

  it("refuses a structured headless duplicate before writing prompt input", () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "-V") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-sessions") {
        return {
          status: 0,
          stdout: tmuxSessionRow("remote-worker", 0, "/home/u/src/remote", "codex", "worker"),
        };
      }
      return { status: 0, stdout: "" };
    });

    expect(() =>
      startHeadlessSession(
        "codex",
        "codex",
        "/home/u/src/remote",
        ["exec", "-"],
        "/must/not/be/written/result.json",
        "/must/not/be/written/output.log",
        "worker",
        "remote",
        "prompt",
        true,
      ),
    ).toThrow(/already exists.*no agent was started/i);
    expect(tmuxCalls("new-session")).toHaveLength(0);
  });

  it("scrubs stale Anthropic env inherited from the tmux server when launching direct", () => {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "-V") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-sessions")
        return { status: 1, stdout: "" };
      if (cmd === "tmux" && args[0] === "new-session") return { status: 0 };
      return { status: 0, stdout: "" };
    });

    startLocalSession(
      "claude",
      "claude",
      "/home/u/src/impots2025",
      [],
      "Impots",
    );

    const newSession = tmuxCalls("new-session")[0]![1] as string[];
    const envIndex = newSession.indexOf("env");
    expect(envIndex).toBeGreaterThan(-1);
    expect(newSession.slice(envIndex, envIndex + 7)).toEqual([
      "env",
      "-u",
      "ANTHROPIC_BASE_URL",
      "-u",
      "ANTHROPIC_AUTH_TOKEN",
      "-u",
      "ANTHROPIC_API_KEY",
    ]);
  });

  it("stores the agent pane on the tmux session after creation", () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "-V") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-sessions")
        return { status: 1, stdout: "" };
      if (cmd === "tmux" && args[0] === "new-session") return { status: 0 };
      if (cmd === "tmux" && args[0] === "show-options")
        return { status: 1, stdout: "" };
      if (cmd === "tmux" && args[0] === "list-panes")
        return { status: 0, stdout: "codex\t%7\n" };
      return { status: 0, stdout: "" };
    });

    const result = startLocalSession(
      "codex",
      "codex",
      "/home/u/src/remote",
      [],
      "h2a-target",
    );

    expect(result).toEqual({
      name: "h2a-h2a-target",
      slug: "h2a-target",
      agentPane: "%7",
    });
    expect(spawnSyncMock.mock.calls).toContainEqual([
      "tmux",
      ["set-option", "-t", "=h2a-h2a-target:", "@remote_agent_pane", "%7"],
      { stdio: "ignore" },
    ]);
    expect(spawnSyncMock.mock.calls).toContainEqual([
      "tmux",
      ["set-option", "-t", "=h2a-h2a-target:", "@remote_agent_host", "codex"],
      { stdio: "ignore" },
    ]);
    expect(spawnSyncMock.mock.calls).toContainEqual([
      "tmux",
      [
        "set-option",
        "-t",
        "=h2a-h2a-target:",
        "@remote_agent_cwd",
        "/home/u/src/remote",
      ],
      { stdio: "ignore" },
    ]);
  });
});

describe("localSessionPanePid", () => {
  it("returns only a positive tmux pane pid", () => {
    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: "4242\n" });
    expect(localSessionPanePid("%1")).toBe(4242);

    spawnSyncMock.mockReturnValueOnce({ status: 1, stdout: "" });
    expect(localSessionPanePid("%2")).toBeUndefined();

    expect(localSessionPanePid("remote-worker")).toBeUndefined();
  });
});

describe("existingLocalSessionSlugs", () => {
  it("detects a duplicate name before any new-session effect", () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "-V") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-sessions") {
        return {
          status: 0,
          stdout: tmuxSessionRow("remote-existing", 0, "/home/u/src/repo", "codex", "existing"),
        };
      }
      return { status: 0, stdout: "" };
    });

    expect(
      existingLocalSessionSlugs(
        ["new-worker", "existing"],
        "/home/u/src/repo",
      ),
    ).toEqual(["existing"]);
    expect(tmuxCalls("new-session")).toHaveLength(0);
  });
});

describe("sendKeysLiteral", () => {
  it("feeds literal content through tmux stdin and never process argv", () => {
    const prompt = "--dangerously-skip-permissions; $(touch /tmp/nope)";
    spawnSyncMock.mockReturnValue({ status: 0 });

    expect(sendKeysLiteral("%1", prompt)).toBe(true);

    const load = tmuxCalls("load-buffer")[0]!;
    expect(load[2]).toMatchObject({ input: prompt, encoding: "utf8" });
    expect(tmuxCalls("paste-buffer")).toHaveLength(1);
    expect(tmuxCalls("send-keys")[0]?.[1]).toEqual([
      "send-keys",
      "-t",
      "%1",
      "Enter",
    ]);
    const allArgv = spawnSyncMock.mock.calls
      .map((call) => (Array.isArray(call[1]) ? call[1].join(" ") : ""))
      .join("\n");
    expect(allArgv).not.toContain(prompt);
  });

  it("does not paste or submit when loading the private buffer fails", () => {
    spawnSyncMock.mockReturnValueOnce({ status: 1 });

    expect(sendKeysLiteral("%1", "prompt")).toBe(false);
    expect(tmuxCalls("paste-buffer")).toHaveLength(0);
    expect(tmuxCalls("send-keys")).toHaveLength(0);
  });

  it("keeps the throttle-nudge path UNbracketed (single lines, unchanged)", () => {
    spawnSyncMock.mockReturnValue({ status: 0 });
    sendKeysLiteral("%1", "nudge");
    expect(tmuxCalls("paste-buffer")[0]?.[1]).not.toContain("-p");
  });
});

describe("pasteLiteralBlock", () => {
  it("uses bracketed paste so a multi-line brief is not submitted line by line", () => {
    // Measured on Claude Code 2.1.220: without -p, line 1 of a 2-line brief was
    // sent as its own request and line 2 was left sitting in the composer.
    const brief = "line one\nline two";
    spawnSyncMock.mockReturnValue({ status: 0 });

    expect(pasteLiteralBlock("%1", brief)).toBe(true);

    expect(tmuxCalls("paste-buffer")[0]![1] as string[]).toContain("-p");
    expect(tmuxCalls("load-buffer")[0]![2]).toMatchObject({ input: brief });
    // It must NOT submit: the caller proves the text landed first.
    expect(tmuxCalls("send-keys")).toHaveLength(0);
    const allArgv = spawnSyncMock.mock.calls
      .map((call) => (Array.isArray(call[1]) ? call[1].join(" ") : ""))
      .join("\n");
    expect(allArgv).not.toContain(brief);
  });

  it("drops the private buffer when the paste fails", () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0 }) // load-buffer
      .mockReturnValueOnce({ status: 1 }); // paste-buffer

    expect(pasteLiteralBlock("%1", "brief")).toBe(false);
    expect(tmuxCalls("delete-buffer")).toHaveLength(1);
  });
});

describe("capturePaneVisible", () => {
  it("returns undefined when tmux cannot be read, so unreadable is not empty", () => {
    spawnSyncMock.mockReturnValue({ status: 1, stdout: undefined });
    expect(capturePaneVisible("%1")).toBeUndefined();
  });

  it("returns the pane text on success", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "> composer\n" });
    expect(capturePaneVisible("%1")).toBe("> composer\n");
  });
});

describe("clearPaneComposer", () => {
  it("sends Ctrl-U repeatedly, because one only clears the CURRENT line", () => {
    // Measured: a single C-u left a multi-line brief in place, and retrying the
    // paste then stacked twelve copies of it into one composer.
    spawnSyncMock.mockReturnValue({ status: 0 });

    expect(clearPaneComposer("%7")).toBe(true);

    const sends = tmuxCalls("send-keys");
    expect(sends.length).toBeGreaterThan(1);
    expect(sends[0]?.[1]).toEqual(["send-keys", "-t", "%7", "C-u"]);
  });
});

describe("HEADLESS_WRAPPER", () => {
  it("opens and unlinks a 0600 prompt file before feeding CLI stdin", () => {
    const dir = mkdtempSync(join(tmpdir(), "h2a-headless-wrapper-"));
    const result = join(dir, "result.json");
    const log = join(dir, "output.log");
    const promptFile = join(dir, "prompt");
    const prompt = "--flag-like; $(touch /tmp/must-not-run)";
    writeFileSync(promptFile, `${prompt}\n`, { mode: 0o600 });
    try {
      const run = realSpawnSync(
        "/bin/bash",
        [
          "-lc",
          HEADLESS_WRAPPER,
          result,
          log,
          promptFile,
          "/bin/sh",
          "-c",
          'IFS= read -r line; printf "%s" "$line"',
        ],
        { encoding: "utf8" },
      );

      expect(run.status).toBe(0);
      expect(readFileSync(log, "utf8")).toBe(prompt);
      expect(JSON.parse(readFileSync(result, "utf8"))).toEqual({
        state: "done",
        exitCode: 0,
      });
      expect(existsSync(promptFile)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scrubs stale Anthropic variables for a direct headless launch", () => {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    const dir = mkdtempSync(join(tmpdir(), "h2a-headless-direct-"));
    const resultJson = join(dir, "result.json");
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "-V") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-sessions") {
        return { status: 1, stdout: "" };
      }
      if (cmd === "tmux" && args[0] === "new-session") {
        return { status: 0, stdout: "%3\n" };
      }
      return { status: 0, stdout: "" };
    });
    try {
      const started = startHeadlessSession(
        "codex",
        "codex",
        dir,
        ["exec", "-"],
        resultJson,
        join(dir, "output.log"),
        "direct-worker",
        "remote",
        "prompt",
        true,
      );
      expect(started.agentPane).toBe("%3");
      const argv = tmuxCalls("new-session")[0]![1] as string[];
      const envIndex = argv.indexOf("env");
      expect(argv.slice(envIndex, envIndex + 7)).toEqual([
        "env",
        "-u",
        "ANTHROPIC_BASE_URL",
        "-u",
        "ANTHROPIC_AUTH_TOKEN",
        "-u",
        "ANTHROPIC_API_KEY",
      ]);
      cleanupHeadlessPromptFile(started.promptFile);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("removes the transient prompt when pane capture verification fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "h2a-headless-pane-fail-"));
    const promptFile = join(dir, "result.json.prompt");
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "-V") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-sessions") {
        return { status: 1, stdout: "" };
      }
      if (cmd === "tmux" && args[0] === "new-session") {
        return { status: 0, stdout: "not-a-pane\n" };
      }
      if (cmd === "tmux" && args[0] === "show-options") {
        return { status: 1, stdout: "" };
      }
      if (cmd === "tmux" && args[0] === "list-panes") {
        return { status: 1, stdout: "" };
      }
      return { status: 0, stdout: "" };
    });
    try {
      expect(() =>
        startHeadlessSession(
          "codex",
          "codex",
          dir,
          ["exec", "-"],
          join(dir, "result.json"),
          join(dir, "output.log"),
          "failed-worker",
          "remote",
          "sensitive prompt",
          true,
        ),
      ).toThrow(/did not return a live agent pane/i);
      expect(existsSync(promptFile)).toBe(false);
      expect(tmuxCalls("kill-session")).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("startH2aWindow", () => {
  it("warns and returns false when the h2a binary is absent — and never touches tmux", () => {
    // `bash -lc "command -v -- h2a"` fails -> binary absent.
    spawnSyncMock.mockReturnValue({ status: 1, stdout: "" });
    const err = fakeStderr();

    const ok = startH2aWindow(
      "remote-surch",
      "/home/u/src/surch",
      H2A_CMD,
      err,
    );

    expect(ok).toBe(false);
    expect(err.text()).toContain("[h2a]");
    expect(err.text()).toContain("h2a");
    expect(err.text()).toContain("not found");
    // only the command -v probe ran; no tmux call at all
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(spawnSyncMock.mock.calls[0]?.[0]).toBe("bash");
    expect(tmuxCalls("new-window")).toHaveLength(0);
  });

  it("adds the named window when the binary exists and it is not there yet", () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "bash") return { status: 0 }; // command -v ok
      if (cmd === "tmux" && args[0] === "list-windows")
        return { status: 0, stdout: "claude\n" }; // no h2a window yet
      if (cmd === "tmux" && args[0] === "show-options")
        return { status: 0, stdout: "%11\n" }; // stored agent pane
      return { status: 0 }; // new-window ok
    });
    const err = fakeStderr();

    const ok = startH2aWindow(
      "remote-surch",
      "/home/u/src/surch",
      H2A_CMD,
      err,
    );

    expect(ok).toBe(true);
    expect(err.text()).toBe("");
    const calls = tmuxCalls("new-window");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual(
      buildSessionWindowArgs(
        "remote-surch",
        H2A_WINDOW_NAME,
        "/home/u/src/surch",
        H2A_CMD,
        "%11",
      ),
    );
  });

  it('is idempotent but warns when an existing "h2a" window may have a stale wake target', () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "bash") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-windows")
        return { status: 0, stdout: "claude\nh2a\n" };
      return { status: 0 };
    });
    const err = fakeStderr();

    const ok = startH2aWindow(
      "remote-surch",
      "/home/u/src/surch",
      H2A_CMD,
      err,
    );

    expect(ok).toBe(true);
    expect(tmuxCalls("new-window")).toHaveLength(0);
    expect(err.text()).toContain("already exists");
    expect(err.text()).toContain("wake target may be stale");
  });

  it("warns (but does not throw) when tmux new-window fails", () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "bash") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-windows")
        return { status: 0, stdout: "claude\n" };
      if (cmd === "tmux" && args[0] === "show-options")
        return { status: 0, stdout: "%12\n" };
      return { status: 1 }; // new-window fails
    });
    const err = fakeStderr();

    const ok = startH2aWindow(
      "remote-surch",
      "/home/u/src/surch",
      H2A_CMD,
      err,
    );

    expect(ok).toBe(false);
    expect(err.text()).toContain("h2a window failed");
  });

  it("refuses to start --wake local-tmux when no agent pane can be resolved", () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "bash") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-windows")
        return { status: 0, stdout: "codex\n" };
      if (cmd === "tmux" && args[0] === "show-options")
        return { status: 1, stdout: "" };
      if (cmd === "tmux" && args[0] === "list-panes")
        return { status: 1, stdout: "" };
      return { status: 0 };
    });
    const err = fakeStderr();

    const ok = startH2aWindow(
      "remote-surch",
      "/home/u/src/surch",
      H2A_CMD,
      err,
    );

    expect(ok).toBe(false);
    expect(err.text()).toContain("agent pane could not be resolved");
    expect(tmuxCalls("new-window")).toHaveLength(0);
  });
});

describe("startH2aWindowVerified", () => {
  const verificationOptions = {
    attempts: 3,
    intervalMs: 1,
    delay: async () => {},
  };

  it("returns only after the captured sidecar pane stays live", async () => {
    let ackFile: string | undefined;
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "bash") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-windows") {
        return { status: 0, stdout: "claude\n" };
      }
      if (cmd === "tmux" && args[0] === "new-window") {
        return { status: 0, stdout: "%2\n" };
      }
      if (cmd === "tmux" && args[0] === "display") {
        return {
          status: 0,
          stdout: args.includes("%1") ? "111\n" : "222\n",
        };
      }
      return { status: 0, stdout: "" };
    });
    const options = {
      ...verificationOptions,
      delay: async () => {
        if (ackFile) return;
        const argv = tmuxCalls("new-window")[0]![1] as string[];
        const fileEnv = argv.find((arg) =>
          arg.startsWith("H2A_MCP_READY_FILE="),
        )!;
        const nonceEnv = argv.find((arg) =>
          arg.startsWith("H2A_MCP_READY_NONCE="),
        )!;
        ackFile = fileEnv.slice("H2A_MCP_READY_FILE=".length);
        const nonce = nonceEnv.slice("H2A_MCP_READY_NONCE=".length);
        writeFileSync(
          ackFile,
          `${JSON.stringify({
            kind: "h2a.mcp.ready",
            version: 1,
            nonce,
            pid: 222,
            sessionId: "sess:ready",
          })}\n`,
          { mode: 0o600, flag: "wx" },
        );
      },
    };

    const result = await startH2aWindowVerified(
      "remote-worker",
      "/home/u/src/repo",
      H2A_CMD,
      "%1",
      fakeStderr(),
      options,
    );

    expect(result).toEqual({ pane: "%2", pid: 222 });
    expect(ackFile).toBeDefined();
    expect(existsSync(ackFile!)).toBe(false);
    expect(existsSync(dirname(ackFile!))).toBe(false);
    expect(tmuxCalls("kill-pane")).toHaveLength(0);
    expect(tmuxCalls("new-window")[0]?.[1]).toContain("%1");
  });

  it("fails when the sidecar exits immediately after new-window", async () => {
    let readyFile: string | undefined;
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "bash") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-windows") {
        return { status: 0, stdout: "codex\n" };
      }
      if (cmd === "tmux" && args[0] === "new-window") {
        const fileEnv = args.find((arg) =>
          arg.startsWith("H2A_MCP_READY_FILE="),
        );
        readyFile = fileEnv?.slice("H2A_MCP_READY_FILE=".length);
        return { status: 0, stdout: "%2\n" };
      }
      if (cmd === "tmux" && args[0] === "display") {
        return args.includes("%1")
          ? { status: 0, stdout: "111\n" }
          : { status: 1, stdout: "" };
      }
      return { status: 0, stdout: "" };
    });
    const err = fakeStderr();

    const result = await startH2aWindowVerified(
      "remote-worker",
      "/home/u/src/repo",
      H2A_CMD,
      "%1",
      err,
      verificationOptions,
    );

    expect(result).toBeUndefined();
    expect(err.text()).toContain("pane/PID guard");
    expect(readyFile).toBeDefined();
    expect(existsSync(dirname(readyFile!))).toBe(false);
    expect(tmuxCalls("kill-pane")[0]?.[1]).toEqual([
      "kill-pane",
      "-t",
      "%2",
    ]);
  });

  it("fails if the agent pane disappears while the sidecar becomes current", async () => {
    let agentProbes = 0;
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "bash") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-windows") {
        return { status: 0, stdout: "claude\n" };
      }
      if (cmd === "tmux" && args[0] === "new-window") {
        return { status: 0, stdout: "%2\n" };
      }
      if (cmd === "tmux" && args[0] === "display") {
        if (args.includes("%1")) {
          agentProbes += 1;
          return agentProbes < 3
            ? { status: 0, stdout: "111\n" }
            : { status: 1, stdout: "" };
        }
        return { status: 0, stdout: "222\n" };
      }
      return { status: 0, stdout: "" };
    });

    const result = await startH2aWindowVerified(
      "remote-worker",
      "/home/u/src/repo",
      H2A_CMD,
      "%1",
      fakeStderr(),
      verificationOptions,
    );

    expect(result).toBeUndefined();
    const displayTargets = tmuxCalls("display").map(
      (call) => (call[1] as string[])[3],
    );
    expect(displayTargets.every((target) => target === "%1" || target === "%2")).toBe(true);
    expect(displayTargets).not.toContain("remote-worker");
  });

  it("rejects a live fake mcp-serve process that never writes the correlated ACK", async () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "bash") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-windows") {
        return { status: 0, stdout: "claude\n" };
      }
      if (cmd === "tmux" && args[0] === "new-window") {
        return { status: 0, stdout: "%2\n" };
      }
      if (cmd === "tmux" && args[0] === "display") {
        return {
          status: 0,
          stdout: args.includes("%1") ? "111\n" : "222\n",
        };
      }
      if (cmd === "ps") {
        return { status: 0, stdout: "h2a mcp-serve --wake local-tmux\n" };
      }
      return { status: 0, stdout: "" };
    });
    const err = fakeStderr();

    const result = await startH2aWindowVerified(
      "remote-worker",
      "/home/u/src/repo",
      H2A_CMD,
      "%1",
      err,
      verificationOptions,
    );

    expect(result).toBeUndefined();
    expect(err.text()).toContain("correlated readiness ACK");
    expect(spawnSyncMock.mock.calls.some((call) => call[0] === "ps")).toBe(
      false,
    );
    expect(tmuxCalls("kill-pane")).toHaveLength(1);
  });

  it("fails closed when auto-open never ACKs even if the sidecar pane stays alive", async () => {
    let readyFile: string | undefined;
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "bash") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-windows") {
        return { status: 0, stdout: "claude\n" };
      }
      if (cmd === "tmux" && args[0] === "new-window") {
        const fileEnv = args.find((arg) =>
          arg.startsWith("H2A_MCP_READY_FILE="),
        );
        readyFile = fileEnv?.slice("H2A_MCP_READY_FILE=".length);
        return { status: 0, stdout: "%2\n" };
      }
      if (cmd === "tmux" && args[0] === "display") {
        return {
          status: 0,
          stdout: args.includes("%1") ? "111\n" : "222\n",
        };
      }
      return { status: 0, stdout: "" };
    });
    const err = fakeStderr();

    const result = await startH2aWindowVerified(
      "remote-worker",
      "/home/u/src/repo",
      H2A_CMD,
      "%1",
      err,
      verificationOptions,
    );

    expect(result).toBeUndefined();
    expect(err.text()).toContain("timed out");
    expect(readyFile).toBeDefined();
    expect(existsSync(dirname(readyFile!))).toBe(false);
    expect(tmuxCalls("kill-pane")).toHaveLength(1);
  });

  it("rejects a nonce-valid ACK whose PID is not the exact sidecar pane PID", async () => {
    let readyFile: string | undefined;
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "bash") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-windows") {
        return { status: 0, stdout: "claude\n" };
      }
      if (cmd === "tmux" && args[0] === "new-window") {
        return { status: 0, stdout: "%2\n" };
      }
      if (cmd === "tmux" && args[0] === "display") {
        return {
          status: 0,
          stdout: args.includes("%1") ? "111\n" : "222\n",
        };
      }
      return { status: 0, stdout: "" };
    });
    const options = {
      ...verificationOptions,
      delay: async () => {
        if (readyFile) return;
        const argv = tmuxCalls("new-window")[0]![1] as string[];
        const fileEnv = argv.find((arg) =>
          arg.startsWith("H2A_MCP_READY_FILE="),
        )!;
        const nonceEnv = argv.find((arg) =>
          arg.startsWith("H2A_MCP_READY_NONCE="),
        )!;
        readyFile = fileEnv.slice("H2A_MCP_READY_FILE=".length);
        const nonce = nonceEnv.slice("H2A_MCP_READY_NONCE=".length);
        writeFileSync(
          readyFile,
          `${JSON.stringify({
            kind: "h2a.mcp.ready",
            version: 1,
            nonce,
            pid: 999,
            sessionId: "sess:forged-pid",
          })}\n`,
          { mode: 0o600, flag: "wx" },
        );
      },
    };
    const err = fakeStderr();

    const result = await startH2aWindowVerified(
      "remote-worker",
      "/home/u/src/repo",
      H2A_CMD,
      "%1",
      err,
      options,
    );

    expect(result).toBeUndefined();
    expect(err.text()).toContain("invalid readiness ACK");
    expect(readyFile).toBeDefined();
    expect(existsSync(dirname(readyFile!))).toBe(false);
    expect(tmuxCalls("kill-pane")[0]?.[1]).toEqual([
      "kill-pane",
      "-t",
      "%2",
    ]);
  });
});

describe("buildTmuxGlobalOptions (bug #1 — tab follows the agent's live title)", () => {
  const flat = (clip?: string, profile?: string) =>
    buildTmuxGlobalOptions(clip, profile).map((c) => c.join(" "));

  it("is the embedded remote profile and passes its invariants", () => {
    const cmds = buildTmuxGlobalOptions("wl-copy");
    expect(REMOTE_TMUX_PROFILE.name).toBe(REMOTE_TMUX_PROFILE_NAME);
    expect(REMOTE_TMUX_PROFILE.version).toBe(1);
    expect(validateManagedTmuxProfile(cmds)).toEqual([]);
  });

  it("turns set-titles ON so tmux forwards the agent's OSC title to the GNOME tab", () => {
    expect(flat()).toContain("set -g set-titles on");
  });

  it("points set-titles-string directly at pane_title like the old-PC baseline", () => {
    const line = flat().find((l) => l.startsWith("set -g set-titles-string"));
    expect(line).toBeDefined();
    expect(line).toBe("set -g set-titles-string #{pane_title}");
  });

  it("uses automatic-rename and disables manual allow-rename like the old-PC baseline", () => {
    const lines = flat();
    expect(lines).toContain("setw -g automatic-rename on");
    expect(lines).toContain(
      "setw -g automatic-rename-format #{?pane_title,#{pane_title},#{pane_current_command}}",
    );
    expect(lines).toContain("setw -g allow-rename off");
  });

  it("keeps the old-PC scroll/clipboard contract intact (no regression)", () => {
    const lines = flat("wl-copy");
    expect(lines).toContain("set -g @remote_profile remote");
    expect(lines).toContain("set -g allow-passthrough on");
    expect(lines).toContain("set -g history-limit 50000");
    expect(lines).toContain("set -g default-terminal tmux-256color");
    expect(lines).toContain(
      "set -g terminal-overrides ,*256col*:Tc,xterm*:Tc,gnome*:Tc",
    );
    expect(lines).toContain("set -g mouse on");
    expect(lines).toContain("set -g set-clipboard on");
    expect(lines).toContain("set -g focus-events on");
    expect(lines).toContain("set -g copy-command wl-copy");
    const wheelUp = lines.find((l) => l.startsWith("bind -n WheelUpPane"));
    expect(wheelUp).toBeDefined();
    expect(wheelUp).toContain("send-keys -M");
    expect(wheelUp).toContain("copy-mode -e; send-keys -M");
    expect(wheelUp).not.toContain("send-keys -X -N 5 scroll-up");
    expect(wheelUp).not.toContain("#{alternate_on}");
    expect(lines.some((l) => l.startsWith("bind -n WheelDownPane"))).toBe(true);
    expect(lines.some((l) => l.startsWith("bind -n PPage"))).toBe(true);
    expect(lines.some((l) => l.startsWith("bind -n C-S-c"))).toBe(true);
    expect(lines).toContain(
      "bind -T copy-mode C-S-c send-keys -X copy-pipe-and-cancel",
    );
    expect(lines).toContain(
      "bind -T copy-mode-vi C-S-c send-keys -X copy-pipe-and-cancel",
    );
    expect(lines.some((l) => l.startsWith("bind -n C-v if-shell"))).toBe(true);
  });

  it("marks a custom tmux profile when requested", () => {
    expect(flat("wl-copy", "old-pc")).toContain(
      "set -g @remote_profile old-pc",
    );
  });

  it("omits copy-command when no clipboard tool is detected", () => {
    expect(flat(undefined).some((l) => l.includes("copy-command"))).toBe(false);
  });
});

describe("ensureManagedTmuxProfile", () => {
  it("applies the embedded profile idempotently and uses the configured profile marker", () => {
    tmuxProfileConfigMock.mockReturnValue({ profile: "old-pc" });
    spawnSyncMock.mockImplementation((cmd: string) => {
      if (cmd === "command") return { status: 1 };
      return { status: 0, stdout: "" };
    });

    ensureManagedTmuxProfile();

    const tmuxArgs = spawnSyncMock.mock.calls
      .filter((c) => c[0] === "tmux")
      .map((c) => c[1] as string[]);
    const lines = tmuxArgs.map((args) => args.join(" "));
    expect(lines).toContain("set -g @remote_profile old-pc");
    expect(validateManagedTmuxProfile(tmuxArgs)).toEqual([]);
  });
});

describe("buildCodexImagePasteBinding", () => {
  it("binds Ctrl+V to save Wayland clipboard images and paste the file path into Codex panes only", () => {
    const line = buildCodexImagePasteBinding().join(" ");
    expect(line).toContain("bind -n C-v");
    expect(line).toContain("wl-paste --list-types");
    expect(line).toContain("image/png");
    expect(line).toContain("image/jpeg");
    expect(line).toContain(".remote/images");
    expect(line).toContain("tmux send-keys");
    expect(line).toContain("-l");
    expect(line).toContain("codex");
  });

  it("targets the triggering pane explicitly in both scripts (pane_id)", () => {
    const line = buildCodexImagePasteBinding().join(" ");
    // #{pane_id} must appear in each script so tmux expands it at binding-fire
    // time, preventing the background shell from targeting the wrong pane.
    expect(line).toContain("#{pane_id}");
  });

  it("compiles generated image/text shell scripts with /bin/sh -n", () => {
    const binding = buildCodexImagePasteBinding();
    const imageScript = parseRunShellScriptArg(binding[6] as string);
    const fallbackScript = parseRunShellScriptArg(binding[7] as string);
    const dir = mkdtempSync(join(tmpdir(), "h2a-tmux-copy-"));
    const imagePath = join(dir, "image.sh");
    const fallbackPath = join(dir, "fallback.sh");

    try {
      writeFileSync(imagePath, `${imageScript}\n`);
      writeFileSync(fallbackPath, `${fallbackScript}\n`);
      expect(realSpawnSync("/bin/sh", ["-n", imagePath]).status).toBe(0);
      expect(realSpawnSync("/bin/sh", ["-n", fallbackPath]).status).toBe(0);
    } finally {
      rmSync(fallbackPath, { force: true });
      rmSync(imagePath, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("routes non-Codex text pastes through system clipboard tools", () => {
    const line = buildCodexImagePasteBinding().join(" ");
    expect(line).toContain("xclip -selection clipboard -out");
    expect(line).toContain("xsel -ob");
    expect(line).toContain("tmux paste-buffer");
  });
});

describe("localRelaunchCommand", () => {
  it("includes profile, cwd and --name", () => {
    expect(localRelaunchCommand("claude", "/home/u/src/surch", "surch")).toBe(
      "h2a run claude /home/u/src/surch --name surch",
    );
  });

  it("surfaces the conversation id as -r (claude resume argv)", () => {
    expect(
      localRelaunchCommand("claude", "/home/u/src/surch", "surch", [
        "--resume",
        "conv-123",
      ]),
    ).toBe("h2a run claude /home/u/src/surch --name surch -r conv-123");
  });

  it("surfaces the conversation id as -r (codex resume subcommand argv)", () => {
    expect(
      localRelaunchCommand("codex", "/home/u/src/x", "x", ["resume", "abc"]),
    ).toBe("h2a run codex /home/u/src/x --name x -r abc");
  });

  it("omits -r when there is no resume arg, and --name when unlabelled", () => {
    expect(localRelaunchCommand("codex", "/home/u/src/x", undefined)).toBe(
      "h2a run codex /home/u/src/x",
    );
  });
});

describe("sessionRelaunchSafety", () => {
  it("fails closed when the /proc CPU read is unavailable", () => {
    let nowCalls = 0;
    const safety = sessionRelaunchSafety("h2a-live", {
      resolvePane: () => "%7",
      panePid: () => 100,
      paneCommand: () => "bash",
      observe: () => ({
        cpuMs: undefined,
        worker: { pid: 101, startTime: "101", bootId: "boot" },
        procView: { currentBootId: "boot", processes: [] },
      }),
      sleep: () => {},
      now: () => (nowCalls++ === 0 ? 1_000 : 1_250),
    });

    expect(safety.activelyWorking).toBe(true);
    expect(safety.dead).toBe(false);
    expect(safety.indeterminate).toBe(true);
    expect(safety.reason).toContain("CPU sample unreadable");
  });
});

describe("fanoutLabels", () => {
  it("returns just the base for count <= 1", () => {
    expect(fanoutLabels("sentropic", 1)).toEqual(["sentropic"]);
    expect(fanoutLabels("sentropic", 0)).toEqual(["sentropic"]);
  });
  it("suffixes #1…#N for a fan-out", () => {
    expect(fanoutLabels("sentropic", 3)).toEqual([
      "sentropic#1",
      "sentropic#2",
      "sentropic#3",
    ]);
  });
});

describe("LOCAL_WRAPPER (real bash) — regression: cli runs with its args", () => {
  // Invoked as `bash -lc WRAPPER <relaunch> <cli> <args…>`: bash puts the FIRST
  // positional in $0, so the wrapper must read relaunch=$0, cli=$1, shift once.
  // Reading $1/$2 (the original bug) ran the FIRST CLI ARG as a command —
  // `--resume: command not found (127)` — dropping every relaunched session to
  // a shell. stdin is closed so the trailing `exec bash -l` exits at once.
  function runWrapper(relaunch: string, cli: string, args: string[]) {
    return realSpawnSync(
      "bash",
      ["-lc", LOCAL_WRAPPER, relaunch, cli, ...args],
      { encoding: "utf8", input: "" },
    );
  }

  it("runs `echo --resume CONV` (the resume shape that broke) with both args", () => {
    const r = runWrapper("h2a run claude /x --name remote -r CONV", "echo", [
      "--resume",
      "CONV-abc",
    ]);
    expect(r.stdout).toContain("--resume CONV-abc"); // echo got BOTH args
    expect(r.stdout).toContain("echo exited (code 0)");
    expect(r.stdout).toContain(
      "relaunch: h2a run claude /x --name remote -r CONV",
    );
    expect(r.stdout).not.toContain("command not found");
  });

  it("runs a no-arg CLI cleanly", () => {
    const r = runWrapper("h2a run codex /x", "true", []);
    expect(r.stdout).toContain("true exited (code 0)");
    expect(r.stdout).not.toContain("command not found");
  });
});

describe("STRUCTURED_LOCAL_WRAPPER (real bash)", () => {
  it("never executes prompt-shaped stdin when the agent fails immediately", () => {
    const dir = mkdtempSync(join(tmpdir(), "h2a-structured-wrapper-"));
    const sentinel = join(dir, "prompt-was-executed");
    try {
      const r = realSpawnSync(
        "bash",
        ["-lc", STRUCTURED_LOCAL_WRAPPER, "/definitely/missing-agent"],
        {
          encoding: "utf8",
          input: `touch ${sentinel}\n`,
        },
      );

      expect(r.status).not.toBe(0);
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("listLocalSessions", () => {
  beforeEach(() => spawnSyncMock.mockReset());

  it("treats any positive tmux client count as attached", () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "-V")
        return { status: 0, stdout: "tmux 3.4\n" };
      if (cmd === "tmux" && args[0] === "list-sessions") {
        return {
          status: 0,
          stdout: tmuxSessionRow("remote-parent", 2, "/home/u/src/remote", "claude", "Parent session"),
        };
      }
      return { status: 1, stdout: "" };
    });

    expect(listLocalSessions()).toMatchObject([
      {
        name: "remote-parent",
        slug: "parent",
        profile: "claude",
        path: "/home/u/src/remote",
        attached: true,
        displayName: "Parent session",
      },
    ]);
  });
});

describe("managed tmux name resolution", () => {
  const canonical = {
    name: "h2a-proj",
    slug: "proj",
    profile: "claude",
    path: "/repo",
    attached: false,
  };
  const legacy = {
    ...canonical,
    name: "remote-proj",
    profile: "codex",
  };

  it("writes only canonical h2a names while retaining legacy parsing", () => {
    expect(LOCAL_PREFIX).toBe("h2a-");
    expect(LEGACY_LOCAL_PREFIX).toBe("remote-");
    expect(localSessionName("proj")).toBe("h2a-proj");
    expect(localSessionName("h2a-target")).toBe("h2a-h2a-target");
    expect(managedSessionCandidates("proj")).toEqual([
      "h2a-proj",
      "remote-proj",
    ]);
    expect(parseManagedSessionName("h2a-proj")).toEqual({
      prefix: "h2a-",
      slug: "proj",
    });
    expect(parseManagedSessionName("remote-proj")).toEqual({
      prefix: "remote-",
      slug: "proj",
    });
  });

  it("resolves legacy-only and exact names, but refuses a bare dual-prefix slug", () => {
    expect(resolveLocalSession("proj", [legacy])).toEqual({
      kind: "found",
      session: legacy,
    });
    expect(resolveLocalSession("h2a-proj", [canonical, legacy])).toEqual({
      kind: "found",
      session: canonical,
    });
    expect(resolveLocalSession("remote-proj", [canonical, legacy])).toEqual({
      kind: "found",
      session: legacy,
    });
    expect(resolveLocalSession("proj", [canonical, legacy])).toEqual({
      kind: "ambiguous",
      sessions: [canonical, legacy],
    });
  });

  it("lists both canonical and legacy managed sessions", () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "-V") return { status: 0 };
      if (cmd === "tmux" && args[0] === "list-sessions") {
        return {
          status: 0,
          stdout:
            tmuxSessionRow("h2a-current", 0, "/repo/current", "claude") +
            tmuxSessionRow("remote-legacy", 0, "/repo/legacy", "codex"),
        };
      }
      return { status: 1, stdout: "" };
    });

    expect(listLocalSessions().map((session) => session.name)).toEqual([
      "h2a-current",
      "remote-legacy",
    ]);
  });
});

describe("sessionAttachedCount (the detached-only HARD guard source)", () => {
  beforeEach(() => spawnSyncMock.mockReset());

  it("returns 0 for a detached session", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "0\n" });
    expect(sessionAttachedCount("remote-a")).toBe(0);
    // It must query #{session_attached} with tmux 3.6's exact SESSION target.
    const call = spawnSyncMock.mock.calls[0]!;
    expect(call[0]).toBe("tmux");
    expect(call[1]).toEqual([
      "display",
      "-p",
      "-t",
      "=remote-a:",
      "#{session_attached}",
    ]);
  });

  it("returns the client count for an attached session", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "2\n" });
    expect(sessionAttachedCount("remote-a")).toBe(2);
  });

  it("returns undefined when the session/tmux is gone (conservative → treated as attached)", () => {
    spawnSyncMock.mockReturnValue({ status: 1, stdout: "" });
    expect(sessionAttachedCount("remote-gone")).toBeUndefined();
  });

  it("returns undefined on non-numeric output", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "??\n" });
    expect(sessionAttachedCount("remote-a")).toBeUndefined();
  });
});

describe("setLocalSessionDisplayName / getLocalSessionDisplayName (R1 — allow-rename coexistence)", () => {
  beforeEach(() => spawnSyncMock.mockReset());

  it("stores display name via set-option @display_name WITHOUT calling rename-window", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "" });

    const ok = setLocalSessionDisplayName("remote-surch", "My Project");

    expect(ok).toBe(true);
    // Must use set-option with the exact session target and @display_name key.
    expect(spawnSyncMock.mock.calls).toContainEqual([
      "tmux",
      ["set-option", "-t", "=remote-surch:", "@display_name", "My Project"],
      { stdio: "ignore" },
    ]);
    // Must NEVER call rename-window (which would disable allow-rename per-window).
    const renameWindowCalls = spawnSyncMock.mock.calls.filter(
      (c) =>
        c[0] === "tmux" && Array.isArray(c[1]) && c[1][0] === "rename-window",
    );
    expect(renameWindowCalls).toHaveLength(0);
  });

  it("returns false when set-option fails (session gone)", () => {
    spawnSyncMock.mockReturnValue({ status: 1, stdout: "" });
    expect(setLocalSessionDisplayName("remote-gone", "name")).toBe(false);
  });

  it("reads back the stored display name via show-options -qv @display_name", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "My Project\n" });

    const v = getLocalSessionDisplayName("remote-surch");

    expect(v).toBe("My Project");
    expect(spawnSyncMock.mock.calls[0]).toEqual([
      "tmux",
      ["show-options", "-qv", "-t", "=remote-surch:", "@display_name"],
      { encoding: "utf8" },
    ]);
  });

  it("returns undefined when no display name has been set (empty output)", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "\n" });
    expect(getLocalSessionDisplayName("remote-surch")).toBeUndefined();
  });

  it("returns undefined when show-options fails (session gone)", () => {
    spawnSyncMock.mockReturnValue({ status: 1, stdout: "" });
    expect(getLocalSessionDisplayName("remote-gone")).toBeUndefined();
  });

  it("accepts a session name that already has the = prefix (exactSessionTarget idempotent)", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "" });
    setLocalSessionDisplayName("=remote-surch", "label");
    const call = spawnSyncMock.mock.calls[0]!;
    // exactSessionTarget must NOT double-prefix with ==
    // args: ["set-option", "-t", <target>, "@display_name", <value>]
    expect((call[1] as string[])[2]).toBe("=remote-surch:");
  });
});

// ---------------------------------------------------------------------------
// resolveAgentPaneForInstance
// ---------------------------------------------------------------------------

describe("resolveAgentPaneForInstance", () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  /**
   * Arrange list-sessions to return one session named `remote-<label>` with the
   * given profile option, then arrange show-options to return the pane id for
   * @remote_agent_host and @remote_agent_pane reads.
   */
  function arrangeSession(label: string, host: string, paneId: string): void {
    spawnSyncMock.mockImplementation(
      (cmd: string, args: string[], _opts?: unknown) => {
        if (cmd !== "tmux") return { status: 0, stdout: "" };
        const sub = Array.isArray(args) ? args[0] : "";
        // list-sessions: return a matching session
        if (sub === "list-sessions") {
          return {
            status: 0,
            stdout: tmuxSessionRow(`remote-${label}`, 0, `/home/u/src/${label}`, host),
          };
        }
        // show-options: return different values for different options
        if (sub === "show-options") {
          const option = args[args.length - 1];
          if (option === "@remote_agent_host") {
            return { status: 0, stdout: `${host}\n` };
          }
          if (option === "@remote_agent_pane") {
            return { status: 0, stdout: `${paneId}\n` };
          }
          // other options (e.g. @display_name)
          return { status: 0, stdout: "\n" };
        }
        if (sub === "-V") return { status: 0, stdout: "tmux 3.4\n" };
        return { status: 0, stdout: "" };
      },
    );
  }

  it("resolves host:label[:uuid] → pane when session and host match", () => {
    arrangeSession("remote", "codex", "%42");
    const pane = resolveAgentPaneForInstance("codex:remote:a6694dc87c1d");
    expect(pane).toBe("%42");
  });

  it("returns undefined when no session matches the label", () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd !== "tmux") return { status: 0, stdout: "" };
      const sub = Array.isArray(args) ? args[0] : "";
      if (sub === "-V") return { status: 0, stdout: "tmux 3.4\n" };
      if (sub === "list-sessions")
        return { status: 0, stdout: tmuxSessionRow("remote-other", 0, "/tmp", "codex") };
      if (sub === "show-options") return { status: 0, stdout: "\n" };
      return { status: 0, stdout: "" };
    });
    // instance references label "remote" but only "other" exists
    expect(resolveAgentPaneForInstance("codex:remote:abc")).toBeUndefined();
  });

  it("returns undefined when host does not match (@remote_agent_host is different)", () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd !== "tmux") return { status: 0, stdout: "" };
      const sub = Array.isArray(args) ? args[0] : "";
      if (sub === "-V") return { status: 0, stdout: "tmux 3.4\n" };
      if (sub === "list-sessions")
        return { status: 0, stdout: tmuxSessionRow("remote-remote", 0, "/tmp", "claude") };
      if (sub === "show-options") {
        const option = (args as string[])[args.length - 1];
        if (option === "@remote_agent_host")
          return { status: 0, stdout: "claude\n" };
        return { status: 0, stdout: "\n" };
      }
      return { status: 0, stdout: "" };
    });
    // instance host is "codex" but session has "claude"
    expect(resolveAgentPaneForInstance("codex:remote:abc")).toBeUndefined();
  });

  it("returns undefined for a malformed instance string (no colon)", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "" });
    expect(resolveAgentPaneForInstance("codexremote")).toBeUndefined();
  });

  it("returns undefined when tmux is not available", () => {
    spawnSyncMock.mockReturnValue({ status: 1, stdout: "" });
    expect(resolveAgentPaneForInstance("codex:remote:abc")).toBeUndefined();
  });
});

describe("session-option targets (tmux 3.6 regression)", () => {
  it("uses an exact session target for every status-surface option access", () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd !== "tmux") return { status: 0, stdout: "" };
      if (args[0] === "list-sessions") {
        return {
          status: 0,
          stdout:
            "$1\t1710000000\t1234\t/tmp/tmux-1000/default\th2a-worker\t0\t/work\tclaude\t\n",
        };
      }
      return { status: 0, stdout: "" };
    });

    expect(installH2aStatusSurface("h2a-worker")).toBe(true);

    const sessionOptionCalls = spawnSyncMock.mock.calls
      .filter(
        (call) =>
          call[0] === "tmux" &&
          Array.isArray(call[1]) &&
          (["set-option", "show-options"] as string[]).includes(call[1][0]),
      )
      .map((call) => call[1] as string[]);

    expect(sessionOptionCalls.some((args) => args[0] === "set-option")).toBe(
      true,
    );
    expect(sessionOptionCalls.some((args) => args[0] === "show-options")).toBe(
      true,
    );
    for (const args of sessionOptionCalls) {
      expect(args[args.indexOf("-t") + 1]).toBe("=h2a-worker:");
    }
  });
});

describe("status surface per-refresh spawn ban (2026-07-31 storm)", () => {
  function fakeAccess(): {
    store: Map<string, string>;
    access: H2aStatusOptionAccess;
  } {
    const store = new Map<string, string>([
      ["status", "on"],
      ["status-left", "[prev] "],
      ["status-right", "%H:%M"],
      ["status-interval", "1"],
      ["status-left-length", "10"],
      ["status-right-length", "40"],
    ]);
    return {
      store,
      access: {
        read: (_session, option) => store.get(option) ?? "",
        set: (_session, option, value) => {
          store.set(option, value);
          return true;
        },
        unset: (_session, option) => {
          store.delete(option);
          return true;
        },
      },
    };
  }

  it("installs a bar whose only per-refresh commands are file reads", () => {
    const { store, access } = fakeAccess();
    expect(installH2aStatusSurfaceWithAccess("h2a-worker", access)).toBe(true);
    for (const option of ["status-left", "status-right"] as const) {
      const value = store.get(option) ?? "";
      expect(value).not.toContain("#(h2a");
      const commands = [...value.matchAll(/#\(([^)]*)\)/g)].map(
        (match) => match[1],
      );
      expect(commands.length).toBeGreaterThan(0);
      for (const command of commands) {
        expect(command).toMatch(/^cat /);
      }
    }
  });
});
