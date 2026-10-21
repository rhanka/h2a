import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isolateNativeTerminalHost } from "./host-scope.js";

vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(), spawnSync: vi.fn(),
}));
vi.mock("node:fs", async importOriginal => ({
  ...await importOriginal<typeof import("node:fs")>(), readFileSync: vi.fn(),
}));

afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

describe("native host memory scope", () => {
  it("should confirm its own move before accepting the scope as isolated", async () => {
    vi.mocked(spawnSync).mockImplementation((_command, args) => {
      const unit = args![8];
      vi.mocked(readFileSync).mockReturnValue(`0::/user.slice/app.slice/${unit}\n`);
      return { status: 0 } as ReturnType<typeof spawnSync>;
    });
    expect(await isolateNativeTerminalHost()).toEqual({ isolated: true });
    const [command, args, options] = vi.mocked(spawnSync).mock.calls[0]!;
    expect(command).toBe("busctl");
    expect(args).toContain("StartTransientUnit");
    expect(args).toContain(String(process.pid));
    expect(args).toContain("avoid");
    expect(options).toMatchObject({ timeout: 1_000 });
    expect(readFileSync).toHaveBeenCalledWith("/proc/self/cgroup", "utf8");
  });

  it.each(["ENOENT", "ETIMEDOUT", "denied"])("should retain detached fallback when systemd is %s", async code => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1,
      ...(code !== "denied" ? { error: Object.assign(new Error("unavailable"), { code }) } : {}),
    } as ReturnType<typeof spawnSync>);
    expect(await isolateNativeTerminalHost()).toMatchObject({ isolated: false });
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it("should not claim isolation from a queued job whose cgroup never changes", async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
    vi.mocked(readFileSync).mockReturnValue("0::/user.slice/terminal.scope\n");
    const result = isolateNativeTerminalHost();
    expect(await result).toEqual({ isolated: false, reason: "systemd scope move was not confirmed" });
  });
});
