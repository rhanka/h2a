import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listNativeSessions, nativeSidecarName, resolveSessionHostKind } from "./native-host.js";
import {
  isLive,
  isManagedLocalKind,
  type RegistryEntry,
} from "./registry.js";
import { readCrashLog, resolveCrashLogPath } from "./crash-log.js";

const hostSpawn = vi.hoisted(() => ({ current: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawnSync: (...args: unknown[]) => hostSpawn.current(...args),
}));

describe("session host selector", () => {
  it("should default to the native PTY host", () => {
    expect(resolveSessionHostKind({}, {})).toBe("native");
  });

  it("should force tmux with the per-command --tmux flag", () => {
    expect(resolveSessionHostKind({ tmux: true }, {})).toBe("local-tmux");
  });

  it("should honor the fleet-wide H2A_SESSION_HOST=tmux valve", () => {
    expect(resolveSessionHostKind({}, { H2A_SESSION_HOST: "tmux" })).toBe(
      "local-tmux",
    );
    expect(resolveSessionHostKind({}, { H2A_SESSION_HOST: "TMUX" })).toBe(
      "local-tmux",
    );
  });

  it("should ignore any other valve value (native stays the default)", () => {
    expect(resolveSessionHostKind({}, { H2A_SESSION_HOST: "native" })).toBe(
      "native",
    );
    expect(resolveSessionHostKind({}, { H2A_SESSION_HOST: "" })).toBe("native");
  });

  it("should let the flag win over the valve being absent", () => {
    expect(resolveSessionHostKind({ tmux: false }, {})).toBe("native");
  });
});

describe("managed local kinds", () => {
  it("should treat both tmux and native as managed local", () => {
    expect(isManagedLocalKind("local-tmux")).toBe(true);
    expect(isManagedLocalKind("local-native")).toBe(true);
    expect(isManagedLocalKind("local")).toBe(false);
    expect(isManagedLocalKind("remote")).toBe(false);
  });

  it("should derive the sidecar companion name", () => {
    expect(nativeSidecarName("h2a-demo")).toBe("h2a-demo.h2a");
  });
});

describe("registry liveness for native sessions", () => {
  const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
    id: "demo",
    tool: "claude",
    kind: "local-native",
    cwd: "/tmp",
    enrolledAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    source: "run",
    tmuxSession: "h2a-demo",
    ...over,
  });

  it("should be live exactly when the native host reports the session", () => {
    expect(
      isLive(entry(), { nativeSessionLiveness: (name) => name === "h2a-demo" }),
    ).toBe(true);
    expect(isLive(entry(), { nativeSessionLiveness: () => false })).toBe(false);
  });

  it("should never consult tmux for a native entry", () => {
    let tmuxAsked = false;
    expect(
      isLive(entry(), {
        nativeSessionLiveness: () => true,
        tmuxHasSession: () => {
          tmuxAsked = true;
          return true;
        },
      }),
    ).toBe(true);
    expect(tmuxAsked).toBe(false);
  });

  it("should probe the managed name candidates when no session name is recorded", () => {
    const probed: string[] = [];
    const result = isLive(entry({ tmuxSession: undefined }), {
      nativeSessionLiveness: (name) => {
        probed.push(name);
        return name === "h2a-demo";
      },
    });
    expect(result).toBe(true);
    expect(probed).toContain("h2a-demo");
  });

  it("should stay dead once endedAt is recorded", () => {
    expect(
      isLive(entry({ endedAt: new Date().toISOString() }), {
        nativeSessionLiveness: () => true,
      }),
    ).toBe(false);
  });
});

describe("op child crash records (revcrashlog constat 2)", () => {
  let root = "";
  let previousStateHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "h2a-opcrash-"));
    previousStateHome = process.env["XDG_STATE_HOME"];
    process.env["XDG_STATE_HOME"] = join(root, "state");
    hostSpawn.current.mockReset();
  });

  afterEach(() => {
    if (previousStateHome === undefined) delete process.env["XDG_STATE_HOME"];
    else process.env["XDG_STATE_HOME"] = previousStateHome;
    rmSync(root, { recursive: true, force: true });
  });

  function cliRows() {
    return readCrashLog("cli", resolveCrashLogPath("cli", { XDG_STATE_HOME: join(root, "state") }));
  }

  it("logs a killed op child with its signal and no invented exit code", () => {
    hostSpawn.current.mockReturnValue({
      pid: 0, output: [], stdout: "", stderr: "",
      status: null, signal: "SIGKILL", error: undefined,
    });
    expect(() => listNativeSessions()).toThrow();
    const rows = cliRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event: "childExit", reason: "op:list", signal: "SIGKILL" });
    expect("exitCode" in rows[0]!).toBe(false);
  });

  it("logs a spawn failure as startupError, not as a child exit", () => {
    hostSpawn.current.mockReturnValue({
      pid: 0, output: [], stdout: "", stderr: "",
      status: null, signal: null, error: new Error("spawn ENOENT"),
    });
    expect(() => listNativeSessions()).toThrow(/ENOENT/);
    expect(cliRows()[0]).toMatchObject({ event: "startupError", reason: "op:list" });
  });

  it("logs an ordinary non-zero exit with its real code and no signal", () => {
    hostSpawn.current.mockReturnValue({
      pid: 0, output: [], stdout: "", stderr: "boom detail",
      status: 1, signal: null, error: undefined,
    });
    expect(() => listNativeSessions()).toThrow();
    const rows = cliRows();
    expect(rows[0]).toMatchObject({ event: "childExit", reason: "op:list", exitCode: 1 });
    expect(rows[0]?.detail).toContain("boom detail");
    expect("signal" in rows[0]!).toBe(false);
  });
});
