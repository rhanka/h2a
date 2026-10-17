import { describe, expect, it } from "vitest";

import { runInteractiveLogin } from "./auth-login.js";

const CLIENT_SIGNALS = ["SIGHUP", "SIGINT", "SIGQUIT", "SIGTERM"] as const;

function baselineListeners(): number[] {
  return CLIENT_SIGNALS.map((s) => process.listenerCount(s));
}

function expectNoListenerLeak(before: number[]): void {
  CLIENT_SIGNALS.forEach((s, i) => {
    expect(process.listenerCount(s)).toBe(before[i]);
  });
}

function removeExtraListeners(before: number[]): void {
  CLIENT_SIGNALS.forEach((s, i) => {
    const extra = process.listenerCount(s) - (before[i] ?? 0);
    if (extra <= 0) return;
    for (const listener of process.listeners(s).slice(-extra)) {
      process.removeListener(s, listener);
    }
  });
}

function stubExit(captured: Array<number | undefined>) {
  const realExit = process.exit;
  process.exit = ((code?: number) => {
    captured.push(code);
    return undefined as never;
  }) as typeof process.exit;
  return realExit;
}

describe("runInteractiveLogin client reset (rev351-3.3)", () => {
  it("should reset the terminal and report 0 on clean exit", async () => {
    let resets = 0;
    let spawned = "";
    const code = await runInteractiveLogin(
      { command: "codex", args: ["login"] },
      {
        spawnImpl: ((cmd: string, args: ReadonlyArray<string>) => {
          spawned = `${cmd} ${args.join(" ")}`;
          const handlers = new Map<string, Array<(...a: never[]) => void>>();
          return {
            on: (event: string, listener: (...a: never[]) => void) => {
              const list = handlers.get(event) ?? [];
              list.push(listener as (...a: never[]) => void);
              handlers.set(event, list);
              if (event === "close") {
                setTimeout(() => {
                  for (const fn of handlers.get("close") ?? [])
                    (fn as (code: number) => void)(0);
                }, 0);
              }
              return {};
            },
          } as unknown as import("node:child_process").ChildProcess;
        }) as never,
        reset: () => {
          resets += 1;
        },
      },
    );
    expect(spawned).toBe("codex login");
    expect(code).toBe(0);
    expect(resets).toBeGreaterThanOrEqual(1);
  });

  it("should reset and map child SIGINT death to 130, never 0/1", async () => {
    let resets = 0;
    const code = await runInteractiveLogin(
      { command: "codex", args: ["login"] },
      {
        spawnImpl: (() => {
          const handlers = new Map<string, Array<(...a: never[]) => void>>();
          return {
            on: (event: string, listener: (...a: never[]) => void) => {
              const list = handlers.get(event) ?? [];
              list.push(listener as (...a: never[]) => void);
              handlers.set(event, list);
              if (event === "close") {
                setTimeout(() => {
                  for (const fn of handlers.get("close") ?? [])
                    (fn as (code: null, signal: string) => void)(
                      null,
                      "SIGINT",
                    );
                }, 0);
              }
              return {};
            },
          } as unknown as import("node:child_process").ChildProcess;
        }) as never,
        reset: () => {
          resets += 1;
        },
      },
    );
    expect(code).toBe(130);
    expect(resets).toBeGreaterThanOrEqual(1);
  });

  it("should forward a parent SIGTERM and exit 143 once a cooperative child closes (rev351r2-2)", async () => {
    const killed: string[] = [];
    let resets = 0;
    const closeListeners: Array<(...args: never[]) => void> = [];
    const spawnImpl = (() => ({
      kill: (signal?: NodeJS.Signals) => {
        killed.push(String(signal));
        for (const fn of [...closeListeners])
          (fn as (code: null, sig: string) => void)(null, String(signal));
        return true;
      },
      on: (event: string, listener: (...args: never[]) => void) => {
        if (event === "close") closeListeners.push(listener);
        return {};
      },
    })) as never;
    const exitCodes: Array<number | undefined> = [];
    const realExit = stubExit(exitCodes);
    const before = baselineListeners();
    const pending = runInteractiveLogin(
      { command: "sleep", args: ["30"] },
      {
        spawnImpl,
        reset: () => {
          resets += 1;
        },
      },
    );
    try {
      process.emit("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      process.exit = realExit;
      removeExtraListeners(before);
    }
    expect(killed).toEqual(["SIGTERM"]);
    expect(exitCodes).toEqual([143]);
    expect(resets).toBeGreaterThanOrEqual(1);
    expectNoListenerLeak(before);
    void pending;
  });

  it("should SIGKILL a child that ignores the forwarded signal instead of orphaning it (rev351r2-4)", async () => {
    const killed: string[] = [];
    let resets = 0;
    const closeListeners: Array<(...args: never[]) => void> = [];
    const spawnImpl = (() => ({
      kill: (signal?: NodeJS.Signals) => {
        killed.push(String(signal));
        if (signal === "SIGKILL") {
          for (const fn of [...closeListeners])
            (fn as (code: null, sig: string) => void)(null, "SIGKILL");
        }
        // SIGTERM is ignored: no close, like `trap '' TERM`.
        return true;
      },
      on: (event: string, listener: (...args: never[]) => void) => {
        if (event === "close") closeListeners.push(listener);
        return {};
      },
    })) as never;
    const exitCodes: Array<number | undefined> = [];
    const realExit = stubExit(exitCodes);
    const before = baselineListeners();
    const pending = runInteractiveLogin(
      { command: "sleep", args: ["30"] },
      {
        spawnImpl,
        reset: () => {
          resets += 1;
        },
      },
    );
    try {
      process.emit("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 1200));
    } finally {
      process.exit = realExit;
      removeExtraListeners(before);
    }
    expect(killed).toContain("SIGTERM");
    expect(killed).toContain("SIGKILL");
    expect(exitCodes).toEqual([143]);
    expect(resets).toBeGreaterThanOrEqual(1);
    expectNoListenerLeak(before);
    void pending;
  });

  it("should report 127 on spawn error", async () => {
    let resets = 0;
    const code = await runInteractiveLogin(
      { command: "codex", args: ["login"] },
      {
        spawnImpl: (() => {
          const handlers = new Map<string, Array<(...a: never[]) => void>>();
          return {
            on: (event: string, listener: (...a: never[]) => void) => {
              const list = handlers.get(event) ?? [];
              list.push(listener as (...a: never[]) => void);
              handlers.set(event, list);
              if (event === "error") {
                setTimeout(() => {
                  for (const fn of handlers.get("error") ?? [])
                    (fn as (error: Error) => void)(new Error("ENOENT"));
                }, 0);
              }
              return {};
            },
          } as unknown as import("node:child_process").ChildProcess;
        }) as never,
        reset: () => {
          resets += 1;
        },
      },
    );
    expect(code).toBe(127);
    expect(resets).toBeGreaterThanOrEqual(1);
  });
});
