import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { restoreStation } from "./restore.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "h2a-restore-station-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type RegistryRead = { state: "ok" } | { state: "unknown"; reason: string };

function harness(overrides: {
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  registry?: RegistryRead;
  group?: string;
  lazy?: boolean;
  forceGateway?: "gateway" | "direct";
  exitCode?: number;
  env?: NodeJS.ProcessEnv;
  windowError?: string;
} = {}) {
  const written: string[] = [];
  const registry = vi.fn(
    (): RegistryRead => overrides.registry ?? { state: "ok" },
  );
  const launch = vi.fn((_args: readonly string[]) => overrides.exitCode ?? 0);
  // The double honors the launchStationWindow contract: it relays the
  // gnome-terminal error on stderr, then throws for the caller to exit 1.
  const launchWindow = vi.fn(
    (
      _args: { cwd: string; title: string; command: string },
      stderr?: { write(chunk: string): unknown },
    ) => {
      if (overrides.windowError !== undefined) {
        stderr?.write(`[h2a] gnome-terminal: ${overrides.windowError}\n`);
        throw new Error(overrides.windowError);
      }
      return undefined;
    },
  );
  const statePath = join(dir, "config", "station-state.json");
  const code = restoreStation({
    ...(overrides.group !== undefined ? { group: overrides.group } : {}),
    ...(overrides.lazy !== undefined ? { lazy: overrides.lazy } : {}),
    ...(overrides.forceGateway !== undefined
      ? { forceGateway: overrides.forceGateway }
      : {}),
    ...(overrides.env !== undefined ? { env: overrides.env } : {}),
    stdinIsTTY: overrides.stdinIsTTY ?? true,
    stdoutIsTTY: overrides.stdoutIsTTY ?? true,
    stderr: { write: (chunk: string) => written.push(String(chunk)) > 0 },
    registry,
    launch,
    launchWindow,
    statePath,
    locale: "en",
  });
  return { code, written: written.join(""), registry, launch, launchWindow, statePath };
}

describe("S6 step 3 — no TTY: window or named refusal (plan 13-S6)", () => {
  it.each([
    ["stdin is not a TTY", { stdinIsTTY: false }],
    ["stdout is not a TTY", { stdoutIsTTY: false }],
    ["neither is a TTY", { stdinIsTTY: false, stdoutIsTTY: false }],
  ])(
    "should refuse without opening a second window when %s inside the station window",
    (_label, tty) => {
      const h = harness({
        ...tty,
        env: {
          H2A_STATION_WINDOW: "1",
          DISPLAY: ":0",
        },
      });
      expect(h.code).toBe(1);
      expect(h.written).toBe(
        "[h2a] restore needs an interactive terminal (stdin and stdout must be a TTY); nothing was opened.\n",
      );
      // No effect: no registry read, no bridge, no window, no state file.
      expect(h.registry).not.toHaveBeenCalled();
      expect(h.launch).not.toHaveBeenCalled();
      expect(h.launchWindow).not.toHaveBeenCalled();
      expect(readdirSync(dir)).toEqual([]);
    },
  );

  it("should refuse by name and launch no process without a graphical display", async () => {
    for (const tty of [
      { stdinIsTTY: false },
      { stdoutIsTTY: false },
      { stdinIsTTY: false, stdoutIsTTY: false },
    ]) {
      const h = harness({ ...tty, env: {} });
      expect(h.code).toBe(1);
      expect(h.written).toBe(
        "[h2a] restore: no interactive terminal and no graphical display (DISPLAY and WAYLAND_DISPLAY unset or empty); nothing was launched.\n",
      );
      expect(h.registry).not.toHaveBeenCalled();
      expect(h.launch).not.toHaveBeenCalled();
      expect(h.launchWindow).not.toHaveBeenCalled();
      expect(readdirSync(dir)).toEqual([]);
    }
  });

  it("should never open a window from inside the station window", () => {
    const h = harness({
      stdinIsTTY: false,
      stdoutIsTTY: false,
      env: {
        H2A_STATION_WINDOW: "1",
        DISPLAY: ":0",
        WAYLAND_DISPLAY: "wayland-0",
      },
    });
    expect(h.code).toBe(1);
    expect(h.written).toContain("needs an interactive terminal");
    expect(h.launchWindow).not.toHaveBeenCalled();
    expect(h.launch).not.toHaveBeenCalled();
  });

  it("should open exactly one window hosting the station when a display is proven", () => {
    const cwd = process.cwd();
    const h = harness({
      stdinIsTTY: false,
      stdoutIsTTY: false,
      env: { DISPLAY: ":0" },
      group: "docs",
      lazy: true,
      forceGateway: "gateway",
    });
    expect(h.code).toBe(0);
    expect(h.launchWindow).toHaveBeenCalledTimes(1);
    expect(h.launchWindow).toHaveBeenCalledWith(
      {
        cwd,
        title: "h2a",
        command:
          "H2A_STATION_WINDOW=1 h2a restore --station 'docs' --lazy --gw",
      },
      expect.anything(),
    );
    expect(h.launch).not.toHaveBeenCalled();
    expect(h.registry).not.toHaveBeenCalled();
    expect(h.written).toBe(
      "[h2a] restore: no interactive terminal here; the station opens in a new terminal window.\n",
    );
  });

  it("should relay the window launcher error and exit non-zero", () => {
    const h = harness({
      stdinIsTTY: false,
      stdoutIsTTY: false,
      env: { WAYLAND_DISPLAY: "wayland-0" },
      windowError: "Failed to get screen",
    });
    expect(h.launchWindow).toHaveBeenCalledTimes(1);
    expect(h.code).toBe(1);
    expect(h.written).toContain("[h2a] gnome-terminal: Failed to get screen");
    expect(h.launch).not.toHaveBeenCalled();
    expect(h.registry).not.toHaveBeenCalled();
  });

  it("should open the station bridge without computing any plan", () => {
    const h = harness();
    expect(h.code).toBe(0);
    expect(h.registry).toHaveBeenCalledTimes(1);
    expect(h.launch).toHaveBeenCalledTimes(1);
    expect(h.launch.mock.calls[0]![0]).toEqual([
      "station",
      "--state-file",
      h.statePath,
    ]);
    expect(h.written).toBe("");
  });

  it("should transmit the group, lazy and gateway arguments over the bridge", () => {
    const h = harness({ group: "docs", lazy: true, forceGateway: "gateway" });
    expect(h.code).toBe(0);
    expect(h.launch).toHaveBeenCalledTimes(1);
    expect(h.launch.mock.calls[0]![0]).toEqual([
      "station",
      "--state-file",
      h.statePath,
      "--group",
      "docs",
      "--lazy",
      "--force-gateway",
      "gateway",
    ]);
    // A group argument is transmitted, never announced as ignored.
    expect(h.written).toBe("");
  });

  it("should return the exit code of the station bridge", () => {
    expect(harness({ exitCode: 1 }).code).toBe(1);
  });

  it("should launch nothing when the registry is unreadable", () => {
    const h = harness({ registry: { state: "unknown", reason: "registry is absent" } });
    expect(h.code).toBe(1);
    expect(h.launch).not.toHaveBeenCalled();
    expect(h.written).toContain("restore refused: the local registry is unreadable (registry is absent)");
    expect(h.written).toContain("nothing was launched (fail closed)");
  });
});
