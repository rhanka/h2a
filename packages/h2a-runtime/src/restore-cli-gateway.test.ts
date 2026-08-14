import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmuxAvailable = vi.hoisted(() => vi.fn());
const restoreLayout = vi.hoisted(() => vi.fn());
const acquireLlmMeshSessionEnv = vi.hoisted(() => vi.fn());

vi.mock("./tmux.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tmux.js")>();
  return { ...actual, tmuxAvailable };
});

vi.mock("./restore.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./restore.js")>();
  return { ...actual, restore: restoreLayout };
});

vi.mock("./llm-mesh.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./llm-mesh.js")>();
  return { ...actual, acquireLlmMeshSessionEnv };
});

const { main } = await import("./index.js");

describe("restore gateway CLI propagation", () => {
  beforeEach(() => {
    tmuxAvailable.mockReset().mockReturnValue(true);
    restoreLayout.mockReset().mockReturnValue({
      windows: [],
      total: 0,
      dropped: 0,
    });
    acquireLlmMeshSessionEnv.mockReset().mockResolvedValue({
      ANTHROPIC_BASE_URL: "http://localhost:3002",
      ANTHROPIC_AUTH_TOKEN: "test-gateway-token",
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  });

  it.each(["--no-gw", "--no-llm-gateway"])(
    "should propagate explicit direct override from %s to restore",
    async (flag) => {
      const code = await main(["node", "h2a", "restore", flag]);

      expect(code).toBe(0);
      expect(restoreLayout).toHaveBeenCalledOnce();
      expect(restoreLayout).toHaveBeenCalledWith({ forceGateway: "direct" });
    },
  );

  it.each(["--gw", "--llm-gateway"])(
    "should propagate explicit gateway override from %s to restore",
    async (flag) => {
      const code = await main(["node", "h2a", "restore", flag]);

      expect(code).toBe(0);
      expect(restoreLayout).toHaveBeenCalledOnce();
      expect(restoreLayout).toHaveBeenCalledWith({ forceGateway: "gateway" });
    },
  );

  it.each(["--gw", "--no-gw"])(
    "should treat %s after -- as a literal group name, not a gateway override",
    async (group) => {
      const code = await main(["node", "h2a", "restore", "--", group]);

      expect(code).toBe(0);
      expect(restoreLayout).toHaveBeenCalledOnce();
      expect(restoreLayout).toHaveBeenCalledWith({ group });
    },
  );
});
