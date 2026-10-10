import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const start = vi.hoisted(() => vi.fn());
vi.mock("./tmux.js", async original => ({ ...await original<typeof import("./tmux.js")>(), tmuxAvailable: () => false }));
vi.mock("./central-mcp.js", () => ({ prepareCentralMcpForLaunch: async () => undefined, prepareCentralMcpForRestore: async () => undefined }));
vi.mock("./native-host.js", async original => ({
  ...await original<typeof import("./native-host.js")>(),
  nativeHostAvailable: () => ({ ok: true }), nativeSessionLiveness: () => false,
  preflightNativeLaunch: () => ({ launchFence: true, launchInputFence: true }),
  startNativeSession: start, nativeSessionPid: () => 4242, nativeWorkerPid: () => undefined,
}));
const { main } = await import("./index.js");
const { loadRegistry } = await import("./registry.js");
let root: string, previous: string | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "legacy-conversation-"));
  previous = process.env.REMOTE_CLI_CONFIG_HOME; process.env.REMOTE_CLI_CONFIG_HOME = root;
  process.exitCode = 0; start.mockReset().mockReturnValue({ name: "h2a-legacy", slug: "legacy" });
});
afterEach(() => {
  if (previous === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME; else process.env.REMOTE_CLI_CONFIG_HOME = previous;
  process.exitCode = 0; rmSync(root, { recursive: true, force: true });
});
for (const structured of [false, true]) {
  it(`should register only a conversation actually passed to Claude on a ${structured ? "structured" : "historical"} launch without a prompt`, async () => {
    await main(["node", "h2a", "run", "claude", root, "--name", "legacy", "--no-attach", "--no-h2a", "--no-gw", ...(structured ? ["--model", "claude-sonnet-4-6"] : [])]);
    expect(start).toHaveBeenCalledTimes(1);
    const args = start.mock.calls[0]![3] as string[], registry = loadRegistry();
    expect(registry.state).toBe("ok"); expect(registry.entries).toHaveLength(1);
    if (structured) {
      expect(args).toContain("--session-id");
      expect(registry.entries[0]?.convId).toBe(args[args.indexOf("--session-id") + 1]);
    } else {
      expect(args).not.toContain("--session-id");
      expect(registry.entries[0]?.convId).toBeUndefined();
    }
  });
}
