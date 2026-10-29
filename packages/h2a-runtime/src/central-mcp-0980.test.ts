import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { setH2aConfig } from "./config.js";

// Main owns the subprocess writer contract after #390. No installed h2a or
// native host may be reached by this historical incident witness.
const childProcess = vi.hoisted(() => ({
  spawn: vi.fn(() => { throw new Error("unexpected h2a server spawn in isolated fixture"); }),
  spawnSync: vi.fn(() => ({ status: 0 }) as never),
}));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: childProcess.spawn,
  spawnSync: childProcess.spawnSync,
}));

// Daemon liveness is simulated and the published discovery function receives
// its existing runtimeBase test seam. Preparation and writer code are unchanged.
const io = vi.hoisted(() => ({ calls: [] as { operation: string; path: string }[] }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const wrapped: Record<string, unknown> = { ...actual };
  for (const operation of ["writeFileSync", "chmodSync", "unlinkSync", "mkdirSync", "renameSync", "copyFileSync"] as const) {
    const original = actual[operation] as (...args: unknown[]) => unknown;
    wrapped[operation] = (...args: unknown[]) => {
      if (typeof args[0] === "string") io.calls.push({ operation, path: resolve(args[0]) });
      return original(...args);
    };
  }
  return wrapped;
});
const core = vi.hoisted(() => ({
  H2A_MCP_CENTRAL_ENV: "H2A_MCP_CENTRAL",
  H2A_MCP_CENTRAL_ENDPOINT_ENV: "H2A_MCP_CENTRAL_ENDPOINT",
  centralMcpPing: vi.fn(async () => ({ kind: "generation", generation: "fixture-0980" })),
  readCentralMcpMarker: vi.fn(),
  ensureCentralForRoot: vi.fn(async (_root: string) => core.readCentralMcpMarker()),
  centralMcpMarkerPath: vi.fn(() => join(process.env.XDG_RUNTIME_DIR!, 'h2a-mcp-central', 'marker.json')),
  runCli: vi.fn(),
}));
vi.mock("@sentropic/h2a", () => core);
import { prepareCentralMcpForLaunch, prepareCentralMcpForRestore } from "./central-mcp.js";

const qual = tmpdir();
const fixtureDir = resolve(import.meta.dirname, "../../h2a/test/fixtures");
const endpoint = `http://127.0.0.1:${47_000 + process.getuid!() % 10_000}/mcp`;
// Exact owner-supplied git HEAD:.mcp.json from airbus-genair-d2d at 3508b24.
const original = readFileSync(join(fixtureDir, "d2d-mcp.json.pre-incident"));
const originalHash = "984069aaed26cd2ce888dc692a4400f9c9c1cbb5add9c86fedbed3fc6b3d5470";
const graphify = JSON.parse(original.toString("utf8")).mcpServers["graphify-ts"];
let scratch: string;
let historical: typeof import("./central-mcp.js");
let savedEnv: NodeJS.ProcessEnv;
let config: typeof import("./config.js");

function projectWrites(workspace: string) {
  return io.calls.filter(call => call.path === workspace || call.path.startsWith(workspace + sep));
}

function repo(name: string) {
  const workspace = join(scratch, name);
  mkdirSync(workspace);
  const path = join(workspace, ".mcp.json");
  writeFileSync(path, original, { mode: 0o640 });
  execFileSync("git", ["init", "-q", workspace]);
  execFileSync("git", ["-C", workspace, "add", ".mcp.json"]);
  return { workspace, path };
}

function selectCentral() {
  delete process.env.H2A_MCP_CENTRAL;
  delete process.env.H2A_MCP_CENTRAL_ENDPOINT;
  // The observed incident setting had no endpoint. 0.98.0 persists the
  // UID-derived endpoint; the incident UID 1000 produces the observed port 48000.
  config.setH2aConfig({ central: { enabled: true } });
  core.runCli.mockClear();
  io.calls.length = 0;
}

async function extract(archive: string, hash: string, leaf: string) {
  expect(createHash("sha256").update(readFileSync(join(fixtureDir, archive))).digest("hex")).toBe(hash);
  const dir = join(scratch, leaf);
  mkdirSync(dir);
  execFileSync("tar", ["-xzf", join(fixtureDir, archive), "-C", dir]);
  return join(dir, "package", "dist");
}

beforeAll(async () => {
  expect(createHash("sha256").update(original).digest("hex")).toBe(originalHash);
  expect(graphify.command).toBe("npx.cmd");
  mkdirSync(qual, { recursive: true });
  scratch = mkdtempSync(join(qual, "central-0980-"));
  symlinkSync(resolve(import.meta.dirname, "../../../node_modules"), join(scratch, "node_modules"), "dir");
  savedEnv = { ...process.env };
  const dist = await extract("sentropic-h2a-runtime-0.98.0.tgz", "8d7be8ac52a0d17466c4635c2c1374249a1661276f8c70d668c9a89b84ebffd6", "runtime");
  const coreDist = await extract("sentropic-h2a-0.98.0.tgz", "3de15d2ebce30ef5b27748ad06696844980c3c3d2ac5dfd4c6f5f7ff8c66d9a3", "core");
  vi.doMock(join(coreDist, "runtime", "mcp-central.js"), async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown> & { centralMcpClientEndpoint: (env: NodeJS.ProcessEnv, paths: { runtimeBase: string }) => unknown }>();
    return { ...actual, centralMcpClientEndpoint: (env: NodeJS.ProcessEnv) => actual.centralMcpClientEndpoint(env, { runtimeBase: process.env.XDG_RUNTIME_DIR! }) };
  });
  const published = await import(join(coreDist, "index.js"));
  core.runCli.mockImplementation(published.runCli);
  historical = await import(join(dist, "central-mcp.js"));
  config = await import(join(dist, "config.js"));
  process.env.REMOTE_CLI_CONFIG_HOME = join(scratch, "config");
  const state = join(scratch, "state");
  process.env.H2A_ROOT = state;
  const marker = { endpoint, generation: "fixture-0980", pid: process.pid, startedAt: "2026-10-04T00:40:00Z", token: "isolated-fixture-token", root: state, protocol: 2 };
  core.readCentralMcpMarker.mockReturnValue(marker);
  const markerDir = join(process.env.XDG_RUNTIME_DIR!, "h2a-mcp-central");
  mkdirSync(markerDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(markerDir, "marker.json"), JSON.stringify(marker), { mode: 0o600 });
  console.log(`R6 exact input: bytes=${original.length} sha256=${originalHash} source=airbus-genair-d2d@3508b24:HEAD:.mcp.json`);
});

afterAll(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  rmSync(scratch, { recursive: true, force: true });
});

it("R6 published 0.98.0 restore preparation alone leaves the exact incident file untouched", async () => {
  const { workspace, path } = repo("restore-only");
  selectCentral();
  expect(await historical.prepareCentralMcpForRestore({ root: workspace })).toMatchObject({ status: "central" });
  expect(readFileSync(path)).toEqual(original);
  expect(projectWrites(workspace)).toEqual([]);
  expect(core.runCli).not.toHaveBeenCalled();
  console.log("R6 0.98.0 restore-only: projectWrites=0 bytesEqual=true graphifyDestroyed=false");
});

for (const restored of [false, true]) {
  const route = restored ? "restore-reentered-run" : "run";
  it(`R6 published 0.98.0 ${route} modifies the exact tracked incident file but does not destroy graphify-ts`, async () => {
    const { workspace, path } = repo(route);
    selectCentral();
    if (restored) expect(await historical.prepareCentralMcpForRestore({ root: workspace })).toMatchObject({ status: "central" });
    expect(await historical.prepareCentralMcpForLaunch({ root: workspace, profile: "claude", cwd: workspace })).toMatchObject({ status: "central", endpoint });
    expect(core.runCli).toHaveBeenCalledExactlyOnceWith(
      ["host", "setup", "--host", "claude", "--write", path], expect.anything(), expect.anything(),
    );
    const written = readFileSync(path);
    const parsed = JSON.parse(written.toString("utf8"));
    expect(parsed.mcpServers["graphify-ts"]).toEqual(graphify);
    expect(parsed.mcpServers.h2a).toEqual({ command: "h2a", args: ["mcp-central-connect", "--endpoint", endpoint, "--runtime-base", process.env.XDG_RUNTIME_DIR] });
    expect(written).not.toEqual(original);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(workspace).filter(name => name.includes("backup"))).toEqual([]);
    expect(projectWrites(workspace).map(call => call.operation)).toEqual(["writeFileSync", "chmodSync"]);
    const diff = execFileSync("git", ["-C", workspace, "diff", "--no-ext-diff"], { encoding: "utf8" });
    expect(diff).toContain('+    "h2a": {');
    expect(diff).not.toContain('-    "graphify-ts": {');
    console.log(`R6 0.98.0 ${route}: projectWrites=2 bytesEqual=false mode=600 backups=0 servers=${JSON.stringify(Object.keys(parsed.mcpServers))} graphifyDestroyed=false`);
    console.log(diff);
    // Repeated launches also retain the foreign server and are byte-idempotent.
    expect(await historical.prepareCentralMcpForLaunch({ root: workspace, profile: "claude", cwd: workspace })).toMatchObject({ status: "central" });
    expect(readFileSync(path)).toEqual(written);
    console.log(`R6 0.98.0 ${route} repeat: bytesEqualToFirstWrite=true graphifyDestroyed=false`);
  });
}

for (const restored of [false, true]) {
  const route = restored ? "restore-reentered-run" : "run";
  it(`R6 candidate ${route} delegates host setup through main's subprocess contract`, async (t) => {
    const { workspace, path } = repo(`candidate-${route}`);
    selectCentral();
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ generation: "fixture-0980" }));
    });
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    t.onTestFinished(() => new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())));
    const privateEndpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
    const runtimeBase = join(scratch, `runtime-${route}`), markerDir = join(runtimeBase, "h2a-mcp-central");
    mkdirSync(markerDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(markerDir, "marker.json"), JSON.stringify({ endpoint: privateEndpoint,
      generation: "fixture-0980", pid: process.pid, startedAt: "2026-10-29T00:00:00Z", token: "private-fixture" }), { mode: 0o600 });
    setH2aConfig({ central: { enabled: true, endpoint: privateEndpoint } });
    childProcess.spawn.mockClear();
    childProcess.spawnSync.mockClear();
    io.calls.length = 0;
    const before = statSync(path, { bigint: true });
    const status = execFileSync("git", ["-C", workspace, "status", "--porcelain"], { encoding: "utf8" });
    const paths = { runtimeBase };
    if (restored) expect(await prepareCentralMcpForRestore({ root: workspace, paths })).toMatchObject({ status: "central" });
    expect(await prepareCentralMcpForLaunch({ profile: "claude", cwd: workspace, paths })).toMatchObject({ status: "central" });
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(childProcess.spawnSync).toHaveBeenCalledExactlyOnceWith("h2a",
      ["host", "setup", "--host", "claude", "--write", path], expect.objectContaining({ cwd: workspace, stdio: "pipe" }));
    // The writer is a subprocess double. These checks cover the caller only;
    // the former R6 claim of zero product writes no longer applies to main.
    expect(projectWrites(workspace)).toEqual([]);
    expect(readFileSync(path)).toEqual(original);
    const after = statSync(path, { bigint: true });
    expect([after.mode, after.ino, after.mtimeNs, after.ctimeNs]).toEqual([before.mode, before.ino, before.mtimeNs, before.ctimeNs]);
    expect(execFileSync("git", ["-C", workspace, "status", "--porcelain"], { encoding: "utf8" })).toBe(status);
    expect(core.runCli).not.toHaveBeenCalled();
    console.log(`R6 candidate ${route}: subprocessWriterCalls=1 callerProjectWrites=0 writerStub=true sha256=${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
  });
}
