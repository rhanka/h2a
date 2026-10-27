import { describe, expect, it, vi } from "vitest";

import {
  OPERATOR_BREAK_HOP_ENV,
  OPERATOR_BREAK_VERB,
  operatorBreak,
  type OperatorBreakRunner,
} from "./identity-operator-break.js";

function runnerWith(overrides: Partial<OperatorBreakRunner> = {}): {
  runner: OperatorBreakRunner;
  spawn: ReturnType<typeof vi.fn>;
  writes: string[];
  codes: number[];
} {
  const writes: string[] = [];
  const codes: number[] = [];
  const spawn = vi.fn(() => ({ status: 0 }) as never);
  const runner: OperatorBreakRunner = {
    spawn,
    env: {},
    stderr: { write: (chunk: string) => { writes.push(chunk); return true; } },
    setExitCode: (code: number) => { codes.push(code); },
    ...overrides,
  };
  return { runner, spawn, writes, codes };
}

describe("operator break delegation (no core import)", () => {
  it("spawns the hidden core plumbing and relays a success exit code", () => {
    const { runner, spawn, codes } = runnerWith();
    operatorBreak("/store/identity/.lock", "tok", false, () => {}, runner);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawn.mock.calls[0] as [string, string[], { stdio: unknown; env: NodeJS.ProcessEnv }];
    expect(command).toBe("h2a");
    expect(args).toEqual([OPERATOR_BREAK_VERB, "--lock", "/store/identity/.lock", "--token", "tok"]);
    expect(options.stdio).toBe("inherit");
    expect(options.env[OPERATOR_BREAK_HOP_ENV]).toBe("1");
    expect(codes).toEqual([0]);
  });

  it("forwards --assert-dead and relays refusal exit codes", () => {
    const refusingSpawn = vi.fn(() => ({ status: 1 }) as never);
    const { runner, codes } = runnerWith({
      spawn: refusingSpawn,
    } as Partial<OperatorBreakRunner>);
    operatorBreak("/store/succ.LOCK", "tok", true, () => {}, runner);
    expect(refusingSpawn).toHaveBeenCalledTimes(1);
    expect((refusingSpawn.mock.calls[0] as [string, string[]])[1]).toEqual(
      expect.arrayContaining(["--assert-dead"]),
    );
    expect(codes).toEqual([1]);
  });

  it("refuses cleanly when the core CLI is missing (no module crash)", () => {
    // spawnSync reports a missing binary on result.error, never by throwing.
    const refused = Object.assign(new Error("spawnSync h2a ENOENT"), { code: "ENOENT" });
    const { runner, codes, writes } = runnerWith({
      spawn: vi.fn(() => ({ status: null, error: refused }) as never),
    } as Partial<OperatorBreakRunner>);
    operatorBreak("/store/identity/.lock", "tok", false, () => {}, runner);
    expect(codes).toEqual([1]);
    expect(writes.join("")).toMatch(/core h2a CLI is not installed/);
  });

  it("refuses cleanly on other spawn failures without crashing", () => {
    const denied = Object.assign(new Error("spawnSync h2a EACCES"), { code: "EACCES" });
    const { runner, codes, writes } = runnerWith({
      spawn: vi.fn(() => ({ status: null, error: denied }) as never),
    } as Partial<OperatorBreakRunner>);
    operatorBreak("/store/identity/.lock", "tok", false, () => {}, runner);
    expect(codes).toEqual([1]);
    expect(writes.join("")).toMatch(/cannot delegate.*EACCES/);
  });

  it("spawns the dispatching core entry directly when core exported it (no PATH)", () => {
    const { runner, spawn, codes } = runnerWith({
      env: { H2A_CORE_ENTRY: "/repo/packages/h2a/dist/bin.js" },
    });
    operatorBreak("/store/identity/.lock", "tok", false, () => {}, runner);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args] = spawn.mock.calls[0] as [string, string[]];
    expect(command).toBe(process.execPath);
    expect(args).toEqual(["/repo/packages/h2a/dist/bin.js", OPERATOR_BREAK_VERB,
      "--lock", "/store/identity/.lock", "--token", "tok"]);
    expect(codes).toEqual([0]);
  });

  it("refuses without spawning when already delegated (skew guard)", () => {
    const { runner, spawn, codes, writes } = runnerWith({
      env: { [OPERATOR_BREAK_HOP_ENV]: "1" },
    });
    operatorBreak("/store/identity/.lock", "tok", false, () => {}, runner);
    expect(spawn).not.toHaveBeenCalled();
    expect(codes).toEqual([1]);
    expect(writes.join("")).toMatch(/already delegated/);
  });
});
