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
} = {}) {
  const written: string[] = [];
  const registry = vi.fn(
    (): RegistryRead => overrides.registry ?? { state: "ok" },
  );
  const launch = vi.fn((_args: readonly string[]) => overrides.exitCode ?? 0);
  const statePath = join(dir, "config", "station-state.json");
  const code = restoreStation({
    ...(overrides.group !== undefined ? { group: overrides.group } : {}),
    ...(overrides.lazy !== undefined ? { lazy: overrides.lazy } : {}),
    ...(overrides.forceGateway !== undefined
      ? { forceGateway: overrides.forceGateway }
      : {}),
    stdinIsTTY: overrides.stdinIsTTY ?? true,
    stdoutIsTTY: overrides.stdoutIsTTY ?? true,
    stderr: { write: (chunk: string) => written.push(String(chunk)) > 0 },
    registry,
    launch,
    statePath,
    locale: "en",
  });
  return { code, written: written.join(""), registry, launch, statePath };
}

describe("S2 step 1 — `h2a restore --station` bridge (plan 09-S2)", () => {
  it.each([
    ["stdin is not a TTY", { stdinIsTTY: false }],
    ["stdout is not a TTY", { stdoutIsTTY: false }],
    ["neither is a TTY", { stdinIsTTY: false, stdoutIsTTY: false }],
  ])("should refuse clearly and with no effect when %s", (_label, tty) => {
    const h = harness(tty);
    expect(h.code).toBe(1);
    expect(h.written).toBe(
      "[h2a] restore --station needs an interactive terminal (stdin and stdout must be a TTY); nothing was opened.\n",
    );
    // No effect: no registry read, no bridge, no state file.
    expect(h.registry).not.toHaveBeenCalled();
    expect(h.launch).not.toHaveBeenCalled();
    expect(readdirSync(dir)).toEqual([]);
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
