import { expect, it, vi } from "vitest";
import { NATIVE_TERMINAL_PROTOCOL_VERSION } from "./protocol.js";

const state = vi.hoisted(() => ({ clients: [] as Array<{ close: ReturnType<typeof vi.fn> }>, hung: false, pings: 0,
  electionTimeout: false, connectFailures: 0 }));
vi.mock("./client.js", () => ({ NativeTerminalClient: { connect: async () => {
  if (state.connectFailures > 0) { state.connectFailures--; throw Object.assign(new Error("not published"), { code: "ENOENT" }); }
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
  withNativeTerminalStartupLock: async (_path: string, operation: () => Promise<unknown>) => {
    if (state.electionTimeout) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    return operation();
  },
  proveNativeTerminalEndpointAbsent: async () => false,
}));
vi.mock("./socket-path.js", async original => ({ ...await original<object>(),
  knownNativeTerminalSocketPaths: () => ["/private/a", "/private/b"],
  inspectPrivateNativeTerminalSocket: async () => ({ dev: 1, ino: 1 }),
  sameNativeTerminalSocket: () => true,
}));
const { probeNativeSession, runNativeTerminalOp, closeAllNativeTerminalOpClients } = await import("./op.js");

it("should adopt a healthy successor after the startup election's contention deadline", async () => {
  vi.stubEnv("H2A_NATIVE_SOCKET", "/private/a");
  state.electionTimeout = true;
  state.connectFailures = 1;
  const before = state.clients.length;
  try { expect(await probeNativeSession("target", "/private/a", true)).toEqual({ verdict: "dead" }); }
  finally {
    state.electionTimeout = false; state.connectFailures = 0;
    closeAllNativeTerminalOpClients(); state.clients.splice(before); vi.unstubAllEnvs();
  }
});

it("should keep election expiry fail-closed when no healthy successor answers", async () => {
  state.electionTimeout = true;
  state.connectFailures = 10000;
  try {
    await expect(probeNativeSession("target", "/private/a", true)).rejects.toMatchObject({ name: "TimeoutError" });
  } finally { state.electionTimeout = false; state.connectFailures = 0; closeAllNativeTerminalOpClients(); }
});

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
