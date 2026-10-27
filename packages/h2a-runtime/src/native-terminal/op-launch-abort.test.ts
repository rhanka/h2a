import { expect, it, vi } from "vitest";
import { NATIVE_TERMINAL_PROTOCOL_VERSION } from "./protocol.js";

const client = vi.hoisted(() => ({ ping: vi.fn(), list: vi.fn(), create: vi.fn(), close: vi.fn() }));
vi.mock("./client.js", () => ({ NativeTerminalClient: { connect: async () => client } }));
vi.mock("./socket-path.js", async original => ({ ...await original<object>(),
  knownNativeTerminalSocketPaths: () => ["/private/h"],
  inspectPrivateNativeTerminalSocket: async () => ({ dev: 1, ino: 1 }),
  sameNativeTerminalSocket: () => true,
}));
const { runNativeTerminalOp, closeAllNativeTerminalOpClients } = await import("./op.js");

it("should enforce the wall deadline even before the abort timer is scheduled", async () => {
  await expect(runNativeTerminalOp(["node", "op.js", "launch"], () => {}, new AbortController().signal, Date.now() - 1))
    .rejects.toThrow("operation deadline exceeded");
  expect(client.create).not.toHaveBeenCalled();
});

it("should never issue create when the operation deadline expires during admission", async () => {
  const controller = new AbortController();
  const timeout = new Error("operation deadline");
  client.ping.mockResolvedValue({ protocolVersion: NATIVE_TERMINAL_PROTOCOL_VERSION, generation: "g", hostPid: 123 });
  client.list.mockImplementation(async () => { controller.abort(timeout); return []; });
  try {
    await expect(runNativeTerminalOp(["node", "op.js", "launch", "--socket", "/private/h", "--id", "target",
      "--cwd", "/private", "--", "codex"], () => {}, controller.signal)).rejects.toBe(timeout);
    expect(client.create).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalled();
  } finally { closeAllNativeTerminalOpClients(); }
});
