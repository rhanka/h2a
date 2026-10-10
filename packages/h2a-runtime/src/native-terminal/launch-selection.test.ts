import { afterEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => {
  const old = { ping: vi.fn(async () => ({ protocolVersion: 1, hostPid: 10, generation: "old", launchFence: true, launchInputFence: false })), close: vi.fn() };
  const current = { ping: vi.fn(async () => ({ protocolVersion: 1, hostPid: 20, generation: "current", launchFence: true, launchInputFence: true })), close: vi.fn() };
  return { old, current, connect: vi.fn(async (path: string) => path === "/private/old.sock" ? old : current) };
});
vi.mock("node:fs", async original => ({ ...await original<typeof import("node:fs")>(), existsSync: () => true }));
vi.mock("./socket-path.js", async original => ({ ...await original<typeof import("./socket-path.js")>(),
  defaultNativeTerminalSocketPath: () => "/private/old.sock", knownNativeTerminalSocketPaths: () => ["/private/old.sock", "/private/current.sock"],
  inspectPrivateNativeTerminalSocket: async () => ({ ino: 1, dev: 1 }),
}));
vi.mock("./client.js", async original => ({ ...await original<typeof import("./client.js")>(), NativeTerminalClient: { connect: f.connect } }));
vi.mock("./supervisor.js", () => ({ NativeTerminalHostSupervisor: class { async client() { return f.current; } } }));
const { runNativeTerminalOp, closeAllNativeTerminalOpClients } = await import("./op.js");
afterEach(() => { closeAllNativeTerminalOpClients(); vi.restoreAllMocks(); });
for (const inputFenced of [false, true]) {
  it(`should select capabilities required by this attempt with input fencing ${inputFenced}`, async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(chunk => { output.push(String(chunk)); return true; });
    expect(await runNativeTerminalOp(["node", "op", "ensure-host", "--fenced", "true", ...(inputFenced ? ["--input-fenced", "true"] : [])])).toBe(0);
    const selected = JSON.parse(output.join(""));
    expect(selected.generation).toBe(inputFenced ? "current" : "old");
    expect(selected.socketPath).toBe(inputFenced ? "/private/current.sock" : "/private/old.sock");
    expect(await f.old.ping()).toMatchObject({ hostPid: 10, generation: "old", launchInputFence: false });
  });
}
