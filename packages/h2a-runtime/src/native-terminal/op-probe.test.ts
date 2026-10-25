import { expect, it, vi } from "vitest";
import { NATIVE_TERMINAL_PROTOCOL_VERSION } from "./protocol.js";

const state = vi.hoisted(() => ({ clients: [] as Array<{ close: ReturnType<typeof vi.fn> }>, hung: false, pings: 0 }));
vi.mock("./client.js", () => ({ NativeTerminalClient: { connect: async () => {
  const client = { ping: async () => {
    state.pings++;
    if (state.hung) throw Object.assign(new Error("terminal host ping request timed out after 5000ms"), { code: "ETIMEDOUT" });
    return { protocolVersion: NATIVE_TERMINAL_PROTOCOL_VERSION, generation: "g", hostPid: 123, launchFence: true };
  },
    list: async () => [], close: vi.fn() };
  state.clients.push(client);
  return client;
} } }));
vi.mock("./server.js", async original => ({ ...await original<object>(),
  withNativeTerminalStartupLock: async (_path: string, operation: () => Promise<unknown>) => operation(),
  proveNativeTerminalEndpointAbsent: async () => false,
}));
vi.mock("./socket-path.js", async original => ({ ...await original<object>(),
  knownNativeTerminalSocketPaths: () => ["/private/a", "/private/b"],
  inspectPrivateNativeTerminalSocket: async () => ({ dev: 1, ino: 1 }),
  sameNativeTerminalSocket: () => true,
}));
const { probeNativeSession, runNativeTerminalOp, closeAllNativeTerminalOpClients } = await import("./op.js");

it("should close both prepared endpoints and inventory clients before an in-process probe returns", async () => {
  vi.stubEnv("H2A_NATIVE_SOCKET", "");
  try {
    expect(await probeNativeSession("target", undefined, true)).toEqual({ verdict: "dead" });
    expect(state.clients).toHaveLength(4);
    for (const client of state.clients) expect(client.close).toHaveBeenCalledOnce();
    closeAllNativeTerminalOpClients();
    for (const client of state.clients) expect(client.close).toHaveBeenCalledOnce();
  } finally { closeAllNativeTerminalOpClients(); vi.unstubAllEnvs(); }
});

it("should preserve a structured unknown refusal without paying a third suspended-host handshake", async () => {
  vi.stubEnv("H2A_NATIVE_SOCKET", "");
  state.hung = true;
  const before = state.pings;
  let result: unknown;
  try {
    expect(await runNativeTerminalOp(["node", "op.js", "ensure-host"], value => { result = value; })).toBe(1);
    expect(result).toMatchObject({ code: "native-inventory-unknown", hosts: [{ socketPath: "/private/a", reason: expect.stringContaining("timed out") }] });
    expect(state.pings - before).toBe(2);
  } finally { state.hung = false; closeAllNativeTerminalOpClients(); vi.unstubAllEnvs(); }
});
