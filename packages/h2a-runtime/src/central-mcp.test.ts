import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const central = vi.hoisted(() => {
  type Marker = {
    endpoint: string;
    generation: string;
    pid: number;
    startedAt: string;
    root: string;
    protocol: number;
    endpointMode: 'discovered';
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
      endpoint: options.env?.H2A_MCP_CENTRAL_ENDPOINT ?? "http://127.0.0.1:47831/mcp",
      generation: `generation-${++generation}`,
      pid: 71_001,
      startedAt: "2026-08-24T00:00:00.000Z",
      root: _args[_args.indexOf("--root") + 1],
      protocol: 2,
      endpointMode: 'discovered',
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
    // Runtime delegates startup to core's registered absolute starter. This
    // boundary fixture supplies its result; core's own tests exercise spawning.
    ensureCentralForRoot: vi.fn(async (root: string) => {
      marker ??= { endpoint: 'http://127.0.0.1:47042/mcp', generation: `generation-${++generation}`,
        pid: 71_001, startedAt: '2026-08-24T00:00:00.000Z', root, protocol: 2, endpointMode: 'discovered' };
      return { endpoint: marker.endpoint, generation: marker.generation };
    }),
    centralMcpMarkerPath: vi.fn(() => join(process.env.XDG_RUNTIME_DIR!, 'h2a-mcp-central', 'marker.json')),
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
      core.ensureCentralForRoot.mockClear();
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
import { getH2aConfig, resolveConfigPath, setH2aConfig } from "./config.js";

describe("central MCP auto-start", () => {
  let scratch: string;
  let previousConfigHome: string | undefined;
  let previousXdgConfigHome: string | undefined;
  let previousCentral: string | undefined;
  let previousEndpoint: string | undefined;
  let previousAuthority: string | undefined;

  beforeEach(() => {
    central.reset();
    scratch = mkdtempSync(join(tmpdir(), "h2a-central-auto-"));
    previousConfigHome = process.env.REMOTE_CLI_CONFIG_HOME;
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    previousCentral = process.env.H2A_MCP_CENTRAL;
    previousEndpoint = process.env.H2A_MCP_CENTRAL_ENDPOINT;
    previousAuthority = process.env.H2A_MCP_AUTHORITY;
    process.env.REMOTE_CLI_CONFIG_HOME = scratch;
    process.env.XDG_CONFIG_HOME = join(scratch, "xdg");
    delete process.env.H2A_MCP_CENTRAL;
    delete process.env.H2A_MCP_CENTRAL_ENDPOINT;
    delete process.env.H2A_MCP_AUTHORITY;
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
    if (previousAuthority === undefined) delete process.env.H2A_MCP_AUTHORITY;
    else process.env.H2A_MCP_AUTHORITY = previousAuthority;
    rmSync(scratch, { recursive: true, force: true });
  });

  it("delegates to the qualified core starter without runtime spawning and reuses the generation for run and restore", async () => {
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
    expect(first).toEqual({ status: "central", endpoint, generation: "generation-1" });
    expect(central.core.ensureCentralForRoot).toHaveBeenCalledExactlyOnceWith(workspace);
    expect(central.spawn).not.toHaveBeenCalled();
    expect(central.unref).not.toHaveBeenCalled();
    expect(process.env).toMatchObject({
      H2A_MCP_CENTRAL: "1",
      H2A_MCP_AUTHORITY: central.core.centralMcpMarkerPath(),
    });
    expect(process.env.H2A_MCP_CENTRAL_ENDPOINT).toBeUndefined();
    expect(central.core.runCli).not.toHaveBeenCalled();
    expect(getH2aConfig().central).toEqual({ enabled: true, endpoint });

    const second = await ensureCentralMcp({ root: workspace });
    expect(second).toMatchObject({ endpoint, generation: "generation-1" });
    expect(central.core.ensureCentralForRoot).toHaveBeenCalledTimes(2);
    expect(central.spawn).not.toHaveBeenCalled();

    const restored = await prepareCentralMcpForRestore({ root: workspace });
    expect(restored).toEqual({ status: "central", endpoint, generation: "generation-1" });
    expect(central.core.ensureCentralForRoot).toHaveBeenCalledTimes(3);
    expect(central.spawn).not.toHaveBeenCalled();
  });

  it("degrades launch and restore when central ensure fails without enabling central routing", async () => {
    const endpoint = "http://127.0.0.1:47042/mcp";
    const workspace = join(scratch, "workspace");
    setH2aConfig({ central: { enabled: true, endpoint } });

    central.core.ensureCentralForRoot.mockRejectedValueOnce(new Error("central liveness is ambiguous"));
    await expect(prepareCentralMcpForLaunch({ root: workspace, profile: "codex", cwd: workspace })).resolves.toEqual({
      status: "degraded",
      reason: "central liveness is ambiguous",
    });
    expect(process.env.H2A_MCP_CENTRAL).toBeUndefined();
    expect(process.env.H2A_MCP_CENTRAL_ENDPOINT).toBeUndefined();
    expect(central.core.runCli).not.toHaveBeenCalled();

    central.core.ensureCentralForRoot.mockRejectedValueOnce(new Error("central liveness is ambiguous"));
    await expect(prepareCentralMcpForRestore({ root: workspace })).resolves.toEqual({
      status: "degraded",
      reason: "central liveness is ambiguous",
    });
    expect(process.env.H2A_MCP_CENTRAL).toBeUndefined();
    expect(process.env.H2A_MCP_CENTRAL_ENDPOINT).toBeUndefined();
  });

  it("is a warning-free no-op while central MCP remains disabled", async () => {
    const workspace = join(scratch, "workspace");
    setH2aConfig({ central: { enabled: false } });

    await expect(prepareCentralMcpForLaunch({ root: workspace, profile: "codex", cwd: workspace })).resolves.toBeUndefined();
    await expect(prepareCentralMcpForRestore({ root: workspace })).resolves.toBeUndefined();
    expect(central.spawn).not.toHaveBeenCalled();
    expect(central.core.ensureCentralForRoot).not.toHaveBeenCalled();
    expect(central.core.runCli).not.toHaveBeenCalled();
    expect(process.env.H2A_MCP_CENTRAL).toBeUndefined();
    expect(process.env.H2A_MCP_CENTRAL_ENDPOINT).toBeUndefined();
  });

  it("leaves project files and git status unchanged after run and restore", async () => {
    const workspace = join(scratch, "workspace");
    mkdirSync(workspace);
    execFileSync("git", ["init", "-q", workspace]);
    const config = '{ "mcpServers": { "graphify-ts": { "command": "graphify" } } }\n';
    writeFileSync(join(workspace, ".mcp.json"), config);
    execFileSync("git", ["-C", workspace, "add", ".mcp.json"]);
    const status = () => execFileSync("git", ["-C", workspace, "status", "--porcelain"], { encoding: "utf8" });
    const before = status();
    setH2aConfig({ central: { enabled: true, endpoint: "http://127.0.0.1:47042/mcp" } });
    await prepareCentralMcpForLaunch({ profile: "claude", cwd: workspace });
    await prepareCentralMcpForRestore();
    expect(status()).toBe(before);
    expect(readFileSync(join(workspace, ".mcp.json"), "utf8")).toBe(config);
    expect(central.core.runCli).not.toHaveBeenCalled();
    expect(central.core.ensureCentralForRoot).toHaveBeenCalledTimes(2);
    expect(central.core.ensureCentralForRoot.mock.calls[0][0]).not.toBe(workspace);
    expect(central.spawn).not.toHaveBeenCalled();
  });

  it("does not write configuration while selecting an endpoint", async () => {
    setH2aConfig({ central: { enabled: true } });
    const before = readFileSync(resolveConfigPath(), "utf8");
    await ensureCentralMcp();
    expect(readFileSync(resolveConfigPath(), "utf8")).toBe(before);
    expect(getH2aConfig().central.endpoint).toBeUndefined();
  });

  it('refuses a core without a qualified starter rather than falling back to the installed h2a binary', async () => {
    setH2aConfig({ central: { enabled: true } });
    const starter = central.core.ensureCentralForRoot;
    try {
      Object.defineProperty(central.core, 'ensureCentralForRoot', { value: undefined, configurable: true, writable: true });
      await expect(prepareCentralMcpForRestore()).resolves.toEqual({ status: 'degraded', reason: 'central_starter_unqualified' });
      expect(central.spawn).not.toHaveBeenCalled();
      expect(process.env.H2A_MCP_AUTHORITY).toBeUndefined();
    } finally { central.core.ensureCentralForRoot = starter; }
  });
});
