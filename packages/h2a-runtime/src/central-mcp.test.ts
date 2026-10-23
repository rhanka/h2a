import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const childProcess = vi.hoisted(() => {
  const unref = vi.fn();
  const spawn = vi.fn((
    _command: string,
    _args: string[],
    _options: { env?: NodeJS.ProcessEnv },
  ) => {
    const child = new EventEmitter() as EventEmitter & { unref(): void };
    child.unref = unref;
    return child;
  });
  const spawnSync = vi.fn(() => ({ status: 0 }) as never);
  return {
    spawn,
    spawnSync,
    unref,
    reset() {
      unref.mockClear();
      spawn.mockClear();
      spawnSync.mockClear();
      spawn.mockImplementation((_command, _args, _options) => {
        const child = new EventEmitter() as EventEmitter & { unref(): void };
        child.unref = unref;
        return child;
      });
      spawnSync.mockImplementation((() => ({ status: 0 })) as never);
    },
  };
});

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: childProcess.spawn,
  spawnSync: childProcess.spawnSync,
}));

import {
  centralMcpPing,
  ensureCentralMcp,
  prepareCentralMcpForLaunch,
  prepareCentralMcpForRestore,
  readCentralMcpMarker,
  resolveCentralMcpLogPath,
} from "./central-mcp.js";
import { MAX_CRASH_LOG_BYTES, readCrashLog, resolveCrashLogPath } from "./crash-log.js";
import { getH2aConfig, setH2aConfig } from "./config.js";

const MARKER_GENERATION = "generation-1";

function writeMarker(runtimeBase: string, overrides: Record<string, unknown> = {}): void {
  const dir = join(runtimeBase, "h2a-mcp-central");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "marker.json"),
    JSON.stringify({
      pid: process.pid,
      startedAt: "2026-08-24T00:00:00.000Z",
      token: "tok",
      ...overrides,
    }),
    { mode: 0o600 },
  );
}

async function startPingServer(generation: string | null): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = createServer((req, res) => {
    if (req.url === "/_h2a-central/ping") {
      if (generation === null) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("nope");
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ generation }));
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

describe("central MCP auto-start", () => {
  let scratch: string;
  let runtimeBase: string;
  let servers: Array<() => Promise<void>>;
  let previousStateHome: string | undefined;
  let previousConfigHome: string | undefined;
  let previousXdgConfigHome: string | undefined;
  let previousCentral: string | undefined;
  let previousEndpoint: string | undefined;

  beforeEach(() => {
    childProcess.reset();
    servers = [];
    scratch = mkdtempSync(join(tmpdir(), "h2a-central-auto-"));
    runtimeBase = join(scratch, "run");
    previousStateHome = process.env.XDG_STATE_HOME;
    previousConfigHome = process.env.REMOTE_CLI_CONFIG_HOME;
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    previousCentral = process.env.H2A_MCP_CENTRAL;
    previousEndpoint = process.env.H2A_MCP_CENTRAL_ENDPOINT;
    process.env.REMOTE_CLI_CONFIG_HOME = scratch;
    process.env.XDG_CONFIG_HOME = join(scratch, "xdg");
    process.env.XDG_STATE_HOME = join(scratch, "state");
    delete process.env.H2A_MCP_CENTRAL;
    delete process.env.H2A_MCP_CENTRAL_ENDPOINT;
  });

  afterEach(async () => {
    for (const close of servers.splice(0)) await close();
    if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousStateHome;
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
    const server = await startPingServer(MARKER_GENERATION);
    servers.push(server.close);
    const workspace = join(scratch, "workspace");
    writeMarker(runtimeBase, { endpoint: server.url, generation: MARKER_GENERATION });
    setH2aConfig({ central: { enabled: true, endpoint: server.url } });
    expect(process.env.H2A_MCP_CENTRAL).toBeUndefined();
    expect(process.env.H2A_MCP_CENTRAL_ENDPOINT).toBeUndefined();

    const first = await prepareCentralMcpForLaunch({
      root: workspace,
      profile: "codex",
      cwd: workspace,
      paths: { runtimeBase },
    });
    expect(first).toEqual({ status: "central", endpoint: server.url, generation: MARKER_GENERATION });
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(childProcess.spawnSync).toHaveBeenCalledTimes(1);
    expect(childProcess.spawnSync).toHaveBeenCalledWith(
      "h2a",
      ["host", "setup", "--host", "codex", "--write", join(scratch, "xdg", "codex", "mcp.json")],
      expect.objectContaining({ cwd: workspace }),
    );
    expect(process.env).toMatchObject({
      H2A_MCP_CENTRAL: "1",
      H2A_MCP_CENTRAL_ENDPOINT: server.url,
    });
    expect(getH2aConfig().central).toEqual({ enabled: true, endpoint: server.url });

    const second = await ensureCentralMcp({ root: workspace, paths: { runtimeBase } });
    expect(second).toEqual({ endpoint: server.url, generation: MARKER_GENERATION });
    expect(childProcess.spawn).not.toHaveBeenCalled();

    const restored = await prepareCentralMcpForRestore({ root: workspace, paths: { runtimeBase } });
    expect(restored).toEqual({ status: "central", endpoint: server.url, generation: MARKER_GENERATION });
    expect(childProcess.spawn).not.toHaveBeenCalled();
    // Restore inherits the environment; it never rewrites the host config.
    expect(childProcess.spawnSync).toHaveBeenCalledTimes(1);
  });

  it("persists a deterministic endpoint the first time central MCP is enabled", async () => {
    setH2aConfig({ central: { enabled: true } });
    vi.useFakeTimers();
    try {
      const pending = ensureCentralMcp({ paths: { runtimeBase } });
      const assertion = expect(pending).rejects.toThrow(/did not become ready/);
      await vi.advanceTimersByTimeAsync(11_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
    const configured = getH2aConfig().central.endpoint;
    expect(configured).toMatch(/^http:\/\/127\.0\.0\.1:4[7-9]\d{3}\/mcp$/);
    expect(childProcess.spawn).toHaveBeenCalledTimes(1);
  });

  it("degrades launch and restore when the marker and the listener disagree", async () => {
    const server = await startPingServer("generation-live");
    servers.push(server.close);
    const workspace = join(scratch, "workspace");
    writeMarker(runtimeBase, { endpoint: server.url, generation: "generation-stale" });
    setH2aConfig({ central: { enabled: true, endpoint: server.url } });

    await expect(prepareCentralMcpForLaunch({
      root: workspace,
      profile: "codex",
      cwd: workspace,
      paths: { runtimeBase },
    })).resolves.toEqual({
      status: "degraded",
      reason: `central MCP marker/listener mismatch (${server.url}, generation generation-stale); refusing to replace a live server`,
    });
    expect(process.env.H2A_MCP_CENTRAL).toBeUndefined();
    expect(process.env.H2A_MCP_CENTRAL_ENDPOINT).toBeUndefined();
    expect(childProcess.spawnSync).not.toHaveBeenCalled();

    await expect(prepareCentralMcpForRestore({ root: workspace, paths: { runtimeBase } })).resolves.toEqual({
      status: "degraded",
      reason: `central MCP marker/listener mismatch (${server.url}, generation generation-stale); refusing to replace a live server`,
    });
    expect(process.env.H2A_MCP_CENTRAL).toBeUndefined();
    expect(process.env.H2A_MCP_CENTRAL_ENDPOINT).toBeUndefined();
  });

  it("restores the existing per-session sidecar config when central host setup fails", async () => {
    const server = await startPingServer(MARKER_GENERATION);
    servers.push(server.close);
    const workspace = join(scratch, "workspace");
    const configPath = join(scratch, "xdg", "codex", "mcp.json");
    const sidecarConfig = `${JSON.stringify({
      mcpServers: { h2a: { command: "h2a", args: ["mcp-serve"] } },
    })}\n`;
    mkdirSync(join(scratch, "xdg", "codex"), { recursive: true });
    writeFileSync(configPath, sidecarConfig);
    writeMarker(runtimeBase, { endpoint: server.url, generation: MARKER_GENERATION });
    setH2aConfig({ central: { enabled: true, endpoint: server.url } });
    childProcess.spawnSync.mockImplementationOnce((() => {
      writeFileSync(configPath, JSON.stringify({
        mcpServers: { h2a: { command: "h2a", args: ["mcp-central-connect"] } },
      }));
      return { status: 2 };
    }) as never);

    await expect(prepareCentralMcpForLaunch({
      root: workspace,
      profile: "codex",
      cwd: workspace,
      paths: { runtimeBase },
    })).resolves.toEqual({
      status: "degraded",
      reason: `central MCP could not write the codex host config at ${configPath}`,
    });
    expect(readFileSync(configPath, "utf8")).toBe(sidecarConfig);
    expect(process.env.H2A_MCP_CENTRAL).toBeUndefined();
    expect(process.env.H2A_MCP_CENTRAL_ENDPOINT).toBeUndefined();
  });

  it("is a warning-free no-op while central MCP remains disabled", async () => {
    const workspace = join(scratch, "workspace");
    setH2aConfig({ central: { enabled: false } });

    await expect(prepareCentralMcpForLaunch({
      root: workspace,
      profile: "codex",
      cwd: workspace,
      paths: { runtimeBase },
    })).resolves.toBeUndefined();
    await expect(prepareCentralMcpForRestore({ root: workspace, paths: { runtimeBase } })).resolves.toBeUndefined();
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(childProcess.spawnSync).not.toHaveBeenCalled();
    expect(process.env.H2A_MCP_CENTRAL).toBeUndefined();
    expect(process.env.H2A_MCP_CENTRAL_ENDPOINT).toBeUndefined();
  });
});

describe("central MCP crash records (revcrashlog constats 2/4)", () => {
  let stateRoot: string;
  let runtimeBase: string;
  let servers: Array<() => Promise<void>>;
  let previousStateHome: string | undefined;
  let previousConfigHome: string | undefined;
  let previousXdgConfigHome: string | undefined;
  let previousCentral: string | undefined;
  let previousEndpoint: string | undefined;

  beforeEach(() => {
    childProcess.reset();
    servers = [];
    stateRoot = mkdtempSync(join(tmpdir(), "h2a-centralcrash-"));
    runtimeBase = join(stateRoot, "run");
    previousStateHome = process.env["XDG_STATE_HOME"];
    previousConfigHome = process.env.REMOTE_CLI_CONFIG_HOME;
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    previousCentral = process.env.H2A_MCP_CENTRAL;
    previousEndpoint = process.env.H2A_MCP_CENTRAL_ENDPOINT;
    process.env["XDG_STATE_HOME"] = join(stateRoot, "state");
    process.env.REMOTE_CLI_CONFIG_HOME = stateRoot;
    process.env.XDG_CONFIG_HOME = join(stateRoot, "xdg");
    delete process.env.H2A_MCP_CENTRAL;
    delete process.env.H2A_MCP_CENTRAL_ENDPOINT;
  });

  afterEach(async () => {
    vi.useRealTimers();
    for (const close of servers.splice(0)) await close();
    if (previousStateHome === undefined) delete process.env["XDG_STATE_HOME"];
    else process.env["XDG_STATE_HOME"] = previousStateHome;
    if (previousConfigHome === undefined) delete process.env.REMOTE_CLI_CONFIG_HOME;
    else process.env.REMOTE_CLI_CONFIG_HOME = previousConfigHome;
    if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    if (previousCentral === undefined) delete process.env.H2A_MCP_CENTRAL;
    else process.env.H2A_MCP_CENTRAL = previousCentral;
    if (previousEndpoint === undefined) delete process.env.H2A_MCP_CENTRAL_ENDPOINT;
    else process.env.H2A_MCP_CENTRAL_ENDPOINT = previousEndpoint;
    rmSync(stateRoot, { recursive: true, force: true });
  });

  function serverRows() {
    return readCrashLog("mcp-server", resolveCrashLogPath("mcp-server", { XDG_STATE_HOME: join(stateRoot, "state") }));
  }

  function deadSpawn() {
    const child = new EventEmitter() as EventEmitter & { unref(): void };
    child.unref = () => {};
    childProcess.spawn.mockImplementationOnce(() => child);
    return child;
  }

  it("logs a spawn failure as startupError, not as a child exit", async () => {
    const endpoint = "http://127.0.0.1:47043/mcp";
    const workspace = join(stateRoot, "workspace");
    setH2aConfig({ central: { enabled: true, endpoint } });
    const child = deadSpawn();
    const pending = ensureCentralMcp({ root: workspace, paths: { runtimeBase } });
    // Attach the rejection handler BEFORE the failure can fire: otherwise the
    // rejection is unhandled and fails the whole suite run (CI proof).
    const assertion = expect(pending).rejects.toThrow("boom-spawn");
    await new Promise((r) => setImmediate(r));
    child.emit("error", new Error("boom-spawn"));
    await assertion;
    expect(serverRows()[0]).toMatchObject({ event: "startupError", reason: "spawn-failed" });
  });

  it("logs a readiness timeout as exit, not as a child exit", async () => {
    const endpoint = "http://127.0.0.1:47044/mcp";
    const workspace = join(stateRoot, "workspace");
    setH2aConfig({ central: { enabled: true, endpoint } });
    deadSpawn();
    vi.useFakeTimers();
    const pending = ensureCentralMcp({ root: workspace, paths: { runtimeBase } });
    // Same unhandled-rejection hazard: the rejection fires DURING the timer
    // advance, so the handler must already be attached here.
    const assertion = expect(pending).rejects.toThrow(/did not become ready/);
    await vi.advanceTimersByTimeAsync(11_000);
    await assertion;
    expect(serverRows()[0]).toMatchObject({ event: "exit", reason: "readiness-timeout" });
  });

  it("records a post-readiness server exit with its real code", async () => {
    const server = await startPingServer("generation-echo");
    servers.push(server.close);
    const workspace = join(stateRoot, "workspace");
    setH2aConfig({ central: { enabled: true, endpoint: server.url } });
    deadSpawn();
    // The mocked spawn never starts a server, so the readiness rendezvous is
    // completed by publishing the matching marker before the first poll reads.
    const pending = ensureCentralMcp({ root: workspace, paths: { runtimeBase } });
    writeMarker(runtimeBase, { endpoint: server.url, generation: "generation-echo" });
    await expect(pending).resolves.toEqual({ endpoint: server.url, generation: "generation-echo" });
    const child = childProcess.spawn.mock.results[0]!.value as EventEmitter;
    child.emit("exit", 1, null);
    const rows = serverRows();
    expect(rows.at(-1)).toMatchObject({ event: "childExit", reason: "server-exit", exitCode: 1 });
  });

  it("records a post-readiness server kill with its signal and no invented code", async () => {
    const server = await startPingServer("generation-echo");
    servers.push(server.close);
    const workspace = join(stateRoot, "workspace");
    setH2aConfig({ central: { enabled: true, endpoint: server.url } });
    deadSpawn();
    const pending = ensureCentralMcp({ root: workspace, paths: { runtimeBase } });
    writeMarker(runtimeBase, { endpoint: server.url, generation: "generation-echo" });
    await expect(pending).resolves.toEqual({ endpoint: server.url, generation: "generation-echo" });
    const child = childProcess.spawn.mock.results[0]!.value as EventEmitter;
    child.emit("exit", null, "SIGTERM");
    const rows = serverRows();
    expect(rows.at(-1)).toMatchObject({ event: "childExit", reason: "server-exit", signal: "SIGTERM" });
    expect("exitCode" in rows.at(-1)!).toBe(false);
  });

  it("caps the rotated raw server log at the bound", async () => {
    const server = await startPingServer("generation-echo");
    servers.push(server.close);
    const workspace = join(stateRoot, "workspace");
    setH2aConfig({ central: { enabled: true, endpoint: server.url } });
    const raw = resolveCentralMcpLogPath();
    mkdirSync(dirname(raw), { recursive: true });
    writeFileSync(raw, "x".repeat(3 * MAX_CRASH_LOG_BYTES));
    const pending = ensureCentralMcp({ root: workspace, paths: { runtimeBase } });
    writeMarker(runtimeBase, { endpoint: server.url, generation: "generation-echo" });
    await pending;
    expect(statSync(`${raw}.1`).size).toBeLessThanOrEqual(MAX_CRASH_LOG_BYTES);
  });
});

describe("central MCP liveness ping", () => {
  let servers: Array<() => Promise<void>>;

  beforeEach(() => {
    servers = [];
  });

  afterEach(async () => {
    for (const close of servers.splice(0)) await close();
  });

  it("reports the live generation", async () => {
    const server = await startPingServer("generation-7");
    servers.push(server.close);
    await expect(centralMcpPing(server.url)).resolves.toEqual({ kind: "generation", generation: "generation-7" });
  });

  it("reports a dead listener on refusal and on HTTP errors", async () => {
    const closed = await startPingServer("generation-7");
    const url = closed.url;
    await closed.close();
    await expect(centralMcpPing(url, 500)).resolves.toEqual({ kind: "dead" });
    const broken = await startPingServer(null);
    servers.push(broken.close);
    await expect(centralMcpPing(broken.url)).resolves.toEqual({ kind: "dead" });
  });

  it("reports ambiguous when the listener hangs past the budget", async () => {
    const hanging = createServer(() => {});
    await new Promise<void>((resolve) => hanging.listen(0, "127.0.0.1", resolve));
    servers.push(() => new Promise((resolve, reject) => hanging.close((error) => (error ? reject(error) : resolve()))));
    const port = (hanging.address() as AddressInfo).port;
    await expect(centralMcpPing(`http://127.0.0.1:${port}/mcp`, 200)).resolves.toEqual({ kind: "ambiguous" });
  });

  it("refuses non-loopback endpoints without touching the network", async () => {
    await expect(centralMcpPing("http://10.0.0.1:1/mcp")).rejects.toThrow(/absolute http URL/);
  });
});

describe("central MCP marker read", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "h2a-central-marker-"));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("returns undefined when no marker is published", () => {
    expect(readCentralMcpMarker({ runtimeBase: base })).toBeUndefined();
  });

  it("reads a live-holder marker without exposing its token", async () => {
    const server = await startPingServer("generation-9");
    try {
      writeMarker(base, { endpoint: server.url, generation: "generation-9" });
      expect(readCentralMcpMarker({ runtimeBase: base })).toEqual({
        endpoint: server.url,
        generation: "generation-9",
        pid: process.pid,
        startedAt: "2026-08-24T00:00:00.000Z",
      });
    } finally {
      await server.close();
    }
  });

  it("rejects malformed and insecure markers", () => {
    const dir = join(base, "h2a-mcp-central");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "marker.json");
    writeFileSync(path, "not-json", { mode: 0o600 });
    expect(() => readCentralMcpMarker({ runtimeBase: base })).toThrow(/malformed/);
    writeFileSync(path, JSON.stringify({ endpoint: "http://127.0.0.1:1/mcp" }), { mode: 0o600 });
    expect(() => readCentralMcpMarker({ runtimeBase: base })).toThrow(/malformed/);
    writeFileSync(
      path,
      JSON.stringify({ endpoint: "http://127.0.0.1:1/mcp", generation: "g", pid: 1, startedAt: "t", token: "k" }),
    );
    // writeFileSync mode applies on creation only; relax explicitly.
    chmodSync(path, 0o644);
    expect(() => readCentralMcpMarker({ runtimeBase: base })).toThrow(/0600/);
  });
});
