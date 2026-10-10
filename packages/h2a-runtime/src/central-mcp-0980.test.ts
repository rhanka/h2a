import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

// Daemon liveness is simulated and the published discovery function receives
// its existing runtimeBase test seam. Preparation and writer bytes are unchanged.
const core = vi.hoisted(() => ({
  H2A_MCP_CENTRAL_ENV: "H2A_MCP_CENTRAL",
  H2A_MCP_CENTRAL_ENDPOINT_ENV: "H2A_MCP_CENTRAL_ENDPOINT",
  centralMcpPing: vi.fn(async () => ({ kind: "generation", generation: "fixture-0980" })),
  readCentralMcpMarker: vi.fn(),
  runCli: vi.fn(),
}));
vi.mock("@sentropic/h2a", () => core);
import { prepareCentralMcpForLaunch, prepareCentralMcpForRestore } from "./central-mcp.js";

const qual = resolve(import.meta.dirname, "../../../.qual-tmp");
const fixtureDir = resolve(import.meta.dirname, "../../h2a/test/fixtures");
const endpoint = "http://127.0.0.1:47831/mcp";
const graphify = {
  command: "npx.cmd",
  args: ["--yes", "@mohammednagy/graphify-ts@0.23.1", "serve", "--stdio", "C:\\Users\\kwil73px\\Documents\\GitHub\\d2d\\graphify-out\\graph.json"],
  env: { GRAPHIFY_TOOL_PROFILE: "core" },
};
const original = JSON.stringify({ mcpServers: { "graphify-ts": graphify } }, null, 2) + "\n";
let scratch: string;
let historical: typeof import("./central-mcp.js");
let savedEnv: NodeJS.ProcessEnv;

async function extract(archive: string, hash: string, leaf: string) {
  expect(createHash("sha256").update(readFileSync(join(fixtureDir, archive))).digest("hex")).toBe(hash);
  const dir = join(scratch, leaf);
  mkdirSync(dir);
  execFileSync("tar", ["-xzf", join(fixtureDir, archive), "-C", dir]);
  return join(dir, "package", "dist");
}

beforeAll(async () => {
  mkdirSync(qual, { recursive: true });
  scratch = mkdtempSync(join(qual, "central-0980-"));
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
});

afterAll(() => {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  rmSync(scratch, { recursive: true, force: true });
});

it("R6 published 0.98.0 run/restore preparation rewrites the tracked Airbus-shaped config but preserves graphify-ts; candidate writes nothing", async () => {
  const workspace = join(scratch, "airbus-genair-d2d");
  const state = join(scratch, "state");
  mkdirSync(workspace);
  const path = join(workspace, ".mcp.json");
  writeFileSync(path, original, { mode: 0o640 });
  execFileSync("git", ["init", "-q", workspace]);
  execFileSync("git", ["-C", workspace, "add", ".mcp.json"]);
  const configHome = join(scratch, "config");
  process.env.REMOTE_CLI_CONFIG_HOME = configHome;
  process.env.H2A_ROOT = state;
  delete process.env.H2A_MCP_CENTRAL;
  const config = await import(join(scratch, "runtime", "package", "dist", "config.js"));
  config.setH2aConfig({ central: { enabled: true, endpoint } });
  const marker = { endpoint, generation: "fixture-0980", pid: process.pid, startedAt: "2026-10-04T00:40:00Z", token: "isolated-fixture-token", root: state, protocol: 2 };
  core.readCentralMcpMarker.mockReturnValue(marker);
  const markerDir = join(process.env.XDG_RUNTIME_DIR!, "h2a-mcp-central");
  mkdirSync(markerDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(markerDir, "marker.json"), JSON.stringify(marker), { mode: 0o600 });

  expect(await historical.prepareCentralMcpForRestore({ root: workspace })).toMatchObject({ status: "central" });
  expect(readFileSync(path, "utf8")).toBe(original);
  const launched = await historical.prepareCentralMcpForLaunch({ root: workspace, profile: "claude", cwd: workspace });
  console.log("0.98.0 launch preparation result:", launched);
  expect(launched).toMatchObject({ status: "central" });
  const written = readFileSync(path, "utf8");
  expect(JSON.parse(written).mcpServers["graphify-ts"]).toEqual(graphify);
  expect(JSON.parse(written).mcpServers.h2a.args[0]).toBe("mcp-central-connect");
  expect(written).not.toBe(original);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(readdirSync(workspace).filter(name => name.includes("backup"))).toEqual([]);
  expect(execFileSync("git", ["-C", workspace, "diff", "--name-only"], { encoding: "utf8" }).trim()).toBe(".mcp.json");
  console.log("R6 observation: published 0.98.0 run/restore graphifyPreserved=true; production entry loss is NOT reproduced");

  writeFileSync(path, original);
  const before = execFileSync("git", ["-C", workspace, "status", "--porcelain"], { encoding: "utf8" });
  core.runCli.mockClear();
  expect(await prepareCentralMcpForRestore()).toMatchObject({ status: "central" });
  expect(await prepareCentralMcpForLaunch({ profile: "claude", cwd: workspace })).toMatchObject({ status: "central" });
  expect(readFileSync(path, "utf8")).toBe(original);
  expect(execFileSync("git", ["-C", workspace, "status", "--porcelain"], { encoding: "utf8" })).toBe(before);
  expect(core.runCli).not.toHaveBeenCalled();
});
