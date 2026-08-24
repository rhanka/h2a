import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const central = vi.hoisted(() => {
  type Marker = {
    endpoint: string;
    generation: string;
    pid: number;
    startedAt: string;
  };
  let marker: Marker | undefined;
  let generation = 0;
  const unref = vi.fn();
  const spawn = vi.fn((
    _command: string,
    _args: string[],
    options: { env?: NodeJS.ProcessEnv },
  ) => {
    marker = {
      endpoint: options.env?.H2A_MCP_CENTRAL_ENDPOINT ?? "",
      generation: `generation-${++generation}`,
      pid: 71_001,
      startedAt: "2026-08-24T00:00:00.000Z",
    };
    const child = new EventEmitter() as EventEmitter & { unref(): void };
    child.unref = unref;
    return child;
  });
  const core = {
    H2A_MCP_CENTRAL_ENV: "H2A_MCP_CENTRAL",
    H2A_MCP_CENTRAL_ENDPOINT_ENV: "H2A_MCP_CENTRAL_ENDPOINT",
    centralMcpPing: vi.fn(async (endpoint: string) =>
      marker?.endpoint === endpoint
        ? { kind: "generation" as const, generation: marker.generation }
        : { kind: "dead" as const },
    ),
    readCentralMcpMarker: vi.fn(() => marker),
    runCli: vi.fn(() => 0),
  };
  return {
    core,
    spawn,
    unref,
    reset() {
      marker = undefined;
      generation = 0;
      unref.mockClear();
      spawn.mockClear();
      core.centralMcpPing.mockClear();
      core.readCentralMcpMarker.mockClear();
      core.runCli.mockClear();
    },
  };
});

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: central.spawn,
}));

vi.mock("@sentropic/h2a", () => central.core);

import {
  ensureCentralMcp,
  prepareCentralMcpForLaunch,
  prepareCentralMcpForRestore,
} from "./central-mcp.js";
import { getH2aConfig, setH2aConfig } from "./config.js";

describe("central MCP auto-start", () => {
  let scratch: string;
  let previousConfigHome: string | undefined;
  let previousXdgConfigHome: string | undefined;
  let previousCentral: string | undefined;
  let previousEndpoint: string | undefined;

  beforeEach(() => {
    central.reset();
    scratch = mkdtempSync(join(tmpdir(), "h2a-central-auto-"));
    previousConfigHome = process.env.REMOTE_CLI_CONFIG_HOME;
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    previousCentral = process.env.H2A_MCP_CENTRAL;
    previousEndpoint = process.env.H2A_MCP_CENTRAL_ENDPOINT;
    process.env.REMOTE_CLI_CONFIG_HOME = scratch;
    process.env.XDG_CONFIG_HOME = join(scratch, "xdg");
    delete process.env.H2A_MCP_CENTRAL;
    delete process.env.H2A_MCP_CENTRAL_ENDPOINT;
  });

  afterEach(() => {
    if (previousConfigHome === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME;
    else process.env.REMOTE_CLI_CONFIG_HOME = previousConfigHome;
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    if (previousCentral === undefined) delete process.env.H2A_MCP_CENTRAL;
    else process.env.H2A_MCP_CENTRAL = previousCentral;
    if (previousEndpoint === undefined) delete process.env.H2A_MCP_CENTRAL_ENDPOINT;
    else process.env.H2A_MCP_CENTRAL_ENDPOINT = previousEndpoint;
    rmSync(scratch, { recursive: true, force: true });
  });

  it("starts once, selects central-connect host setup, and reuses the generation for run and restore", async () => {
    const endpoint = "http://127.0.0.1:47042/mcp";
    const workspace = join(scratch, "workspace");
    setH2aConfig({ central: { enabled: true, endpoint } });
    expect(process.env.H2A_MCP_CENTRAL).toBeUndefined();
    expect(process.env.H2A_MCP_CENTRAL_ENDPOINT).toBeUndefined();

    const first = await prepareCentralMcpForLaunch({
      root: workspace,
      profile: "codex",
      cwd: workspace,
    });
    expect(first).toEqual({ endpoint, generation: "generation-1" });
    expect(central.spawn).toHaveBeenCalledTimes(1);
    expect(central.unref).toHaveBeenCalledTimes(1);
    expect(central.spawn).toHaveBeenCalledWith(
      "h2a",
      ["mcp-central-serve", "--root", workspace],
      expect.objectContaining({
        detached: true,
        stdio: ["ignore", expect.any(Number), expect.any(Number)],
        env: expect.objectContaining({
          H2A_MCP_CENTRAL: "1",
          H2A_MCP_CENTRAL_ENDPOINT: endpoint,
        }),
      }),
    );
    expect(process.env).toMatchObject({
      H2A_MCP_CENTRAL: "1",
      H2A_MCP_CENTRAL_ENDPOINT: endpoint,
    });
    expect(central.core.runCli).toHaveBeenCalledWith(
      [
        "host",
        "setup",
        "--host",
        "codex",
        "--write",
        join(scratch, "xdg", "codex", "mcp.json"),
      ],
      expect.any(Object),
      expect.objectContaining({ doctorHostInstallations: expect.any(Function) }),
    );
    expect(getH2aConfig().central).toEqual({ enabled: true, endpoint });

    const second = await ensureCentralMcp({ root: workspace });
    expect(second).toEqual(first);
    expect(central.spawn).toHaveBeenCalledTimes(1);

    const restored = await prepareCentralMcpForRestore({ root: workspace });
    expect(restored).toEqual(first);
    expect(central.spawn).toHaveBeenCalledTimes(1);
  });

  it("persists a deterministic endpoint the first time central MCP is enabled", async () => {
    setH2aConfig({ central: { enabled: true } });
    const ensured = await ensureCentralMcp();
    const configured = getH2aConfig().central.endpoint;
    expect(configured).toMatch(/^http:\/\/127\.0\.0\.1:4[7-9]\d{3}\/mcp$/);
    expect(ensured?.endpoint).toBe(configured);
    expect(central.spawn).toHaveBeenCalledTimes(1);
  });
});
