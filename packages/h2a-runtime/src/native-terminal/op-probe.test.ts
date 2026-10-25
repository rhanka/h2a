import { expect, it, vi } from "vitest";
import { NATIVE_TERMINAL_PROTOCOL_VERSION } from "./protocol.js";

const state = vi.hoisted(() => ({ clients: [] as Array<{ close: ReturnType<typeof vi.fn> }> }));
vi.mock("./client.js", () => ({ NativeTerminalClient: { connect: async () => {
  const client = { ping: async () => ({ protocolVersion: NATIVE_TERMINAL_PROTOCOL_VERSION, generation: "g", hostPid: 123, launchFence: true }),
    list: async () => [], close: vi.fn() };
  state.clients.push(client);
  return client;
} } }));
vi.mock("./socket-path.js", async original => ({ ...await original<object>(),
  knownNativeTerminalSocketPaths: () => ["/private/a", "/private/b"],
  inspectPrivateNativeTerminalSocket: async () => ({ dev: 1, ino: 1 }),
  sameNativeTerminalSocket: () => true,
}));
const { probeNativeSession, closeAllNativeTerminalOpClients } = await import("./op.js");

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
