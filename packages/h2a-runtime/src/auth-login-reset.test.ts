import { describe, expect, it } from "vitest";

import { runInteractiveLogin } from "./auth-login.js";

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
