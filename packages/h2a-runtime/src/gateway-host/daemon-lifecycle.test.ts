import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as daemon from "./daemon.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps the PID until a slow child exits and releases its port", async () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-gateway-stop-"));
  const child = spawn(process.execPath, ["-e", `
    const server = require('node:net').createServer();
    server.listen(0, '127.0.0.1', () => console.log(server.address().port));
    process.on('SIGTERM', () => setTimeout(() => server.close(() => process.exit(0)), 150));
  `], { env: { ...process.env, HOME: dir, XDG_RUNTIME_DIR: dir, H2A_ROOT: dir }, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  try {
    const [output] = await once(child.stdout!, "data");
    const port = Number(String(output).trim());
    writeFileSync(daemon.llmMeshPidPath(dir), String(child.pid));
    writeFileSync(daemon.llmMeshTokenPath(dir), JSON.stringify({ pid: child.pid, baseUrl: `http://127.0.0.1:${port}` }));
    const stopping = daemon.stopGateway(dir);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(existsSync(daemon.llmMeshPidPath(dir))).toBe(true);
    await expect(stopping).resolves.toEqual({ stopped: true, pid: child.pid });
    expect(existsSync(daemon.llmMeshPidPath(dir))).toBe(false);
    const replacement = createServer();
    replacement.listen(port, "127.0.0.1");
    await once(replacement, "listening");
    await new Promise<void>((resolve) => replacement.close(() => resolve()));
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await exited;
    rmSync(dir, { recursive: true, force: true });
  }
});

it("waits on readiness without treating an unready host as an older daemon", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await daemon.waitForHealth("http://127.0.0.1:43121", 1000);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    "http://127.0.0.1:43121/readyz", "http://127.0.0.1:43121/readyz",
  ]);
});

it("labels the health fallback and uses it only for an older daemon", async () => {
  const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await daemon.waitForHealth("http://127.0.0.1:43121", 1000);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    "http://127.0.0.1:43121/readyz", "http://127.0.0.1:43121/health",
  ]);
  expect(write).toHaveBeenCalledWith(expect.stringMatching(/older daemon.*\/health/));
});

it("bounds shutdown and retains the PID when the process refuses to exit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "h2a-gateway-stuck-"));
  try {
    writeFileSync(daemon.llmMeshPidPath(dir), "12345");
    vi.spyOn(process, "kill").mockReturnValue(true);
    await expect(daemon.stopGateway(dir, 30)).rejects.toThrow(/shutdown timed out.*PID retained/);
    expect(existsSync(daemon.llmMeshPidPath(dir))).toBe(true);
    expect(process.kill).not.toHaveBeenCalledWith(12345, "SIGKILL");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
