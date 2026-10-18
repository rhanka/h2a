import { describe, expect, it, vi } from "vitest";
import { collectNativeInventory, resolveNativeOwner } from "./fleet.js";
import type { NativeTerminalClient } from "./client.js";

const session = { id: "h2a-worker", status: "running", pid: 123, generation: "g", incarnation: "i" };
const endpoints = ["/private/native-terminal.sock", "/private/native-terminal.lf1.sock"];
const ping = async () => ({ protocolVersion: 1, hostPid: 123, generation: "g" });

describe("native fleet ownership", () => {
  for (const owner of endpoints) {
    it(`should retain the client and socket owning a session on ${owner}`, async () => {
      const clients = new Map(endpoints.map(path => [path, { ping, list: async () => path === owner ? [session] : [] }]));
      const connect = vi.fn(async (path: string) => clients.get(path)! as unknown as NativeTerminalClient);
      const inventory = await collectNativeInventory(endpoints, connect);
      expect(inventory.complete).toBe(true);
      expect(resolveNativeOwner("h2a-worker", inventory)).toMatchObject({ state: "found", socketPath: owner, client: clients.get(owner) });
    });
  }
  it("should refuse two owners without deduplicating names", async () => {
    const inventory = await collectNativeInventory(endpoints, async () => ({ ping, list: async () => [session] }) as unknown as NativeTerminalClient);
    expect(inventory.sessions).toHaveLength(2);
    expect(resolveNativeOwner("h2a-worker", inventory)).toMatchObject({ state: "ambiguous-owner", sockets: endpoints });
  });
  for (const code of ["ECONNREFUSED", "ENOENT", "ETIMEDOUT"]) {
    it(`should report unknown rather than absence when one host fails with ${code}`, async () => {
      const inventory = await collectNativeInventory(endpoints, async path => {
        if (path === endpoints[0]) throw Object.assign(new Error(code), { code });
        return { ping, list: async () => [] } as unknown as NativeTerminalClient;
      });
      expect(inventory.complete).toBe(false);
      expect(resolveNativeOwner("h2a-worker", inventory)).toMatchObject({ state: "unknown" });
    });
  }
  it("should use the sole observed owner even when the other inventory is incomplete", async () => {
    const inventory = await collectNativeInventory(endpoints, async path => {
      if (path === endpoints[0]) throw new Error("unreachable");
      return { ping, list: async () => [session] } as unknown as NativeTerminalClient;
    });
    expect(resolveNativeOwner("h2a-worker", inventory)).toMatchObject({ state: "found", socketPath: endpoints[1] });
  });
  it("should certify absence only after every known endpoint answers", async () => {
    const inventory = await collectNativeInventory(endpoints, async () => ({ ping, list: async () => [] }) as unknown as NativeTerminalClient);
    expect(resolveNativeOwner("h2a-worker", inventory)).toEqual({ state: "absent" });
  });
  it("should reject an unknown ping protocol instead of certifying an empty inventory", async () => {
    const inventory = await collectNativeInventory(endpoints, async () => ({
      ping: async () => ({ ...await ping(), protocolVersion: 99 }), list: async () => [],
    }) as unknown as NativeTerminalClient);
    expect(inventory.complete).toBe(false);
    expect(resolveNativeOwner("missing", inventory)).toMatchObject({ state: "unknown" });
  });
  it("should retain unknown legacy versions and defer retirement despite a launch fence", async () => {
    const inventory = await collectNativeInventory(endpoints, async () => ({
      ping: async () => ({ ...await ping(), launchFence: true }), list: async () => [],
    }) as unknown as NativeTerminalClient);
    expect(inventory.hosts).toEqual(endpoints.map(socketPath => expect.objectContaining({ socketPath,
      generation: "g", loadedVersion: "unknown", admission: "unfenced", retirement: "deferred" })));
  });
  it("should report component versions from the loaded owner and frontend", async () => {
    const inventory = await collectNativeInventory(endpoints, async () => ({
      ping: async () => ({ ...await ping(), owner: { pid: 123, version: "0.1.0" }, frontend: { version: "0.2.0" } }), list: async () => [],
    }) as unknown as NativeTerminalClient);
    expect(inventory.hosts[0]).toMatchObject({ loadedVersion: "0.1.0", frontendVersion: "0.2.0" });
    expect(inventory.hosts[0]).not.toHaveProperty("retirement");
  });
});
