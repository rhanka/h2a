import { describe, expect, it, vi } from "vitest";
import { collectNativeInventory, resolveNativeOwner } from "./fleet.js";
import type { NativeTerminalClient } from "./client.js";

const session = { id: "h2a-worker", status: "running", pid: 123, generation: "g", incarnation: "i" };
const endpoints = ["/private/native-terminal.sock", "/private/native-terminal.lf1.sock"];

describe("native fleet ownership", () => {
  for (const owner of endpoints) {
    it(`should retain the client and socket owning a session on ${owner}`, async () => {
      const clients = new Map(endpoints.map(path => [path, { list: async () => path === owner ? [session] : [] }]));
      const connect = vi.fn(async (path: string) => clients.get(path)! as unknown as NativeTerminalClient);
      const inventory = await collectNativeInventory(endpoints, connect);
      expect(inventory.complete).toBe(true);
      expect(resolveNativeOwner("h2a-worker", inventory)).toMatchObject({ state: "found", socketPath: owner, client: clients.get(owner) });
    });
  }
  it("should refuse two owners without deduplicating names", async () => {
    const inventory = await collectNativeInventory(endpoints, async () => ({ list: async () => [session] }) as unknown as NativeTerminalClient);
    expect(inventory.sessions).toHaveLength(2);
    expect(resolveNativeOwner("h2a-worker", inventory)).toMatchObject({ state: "ambiguous-owner", sockets: endpoints });
  });
  for (const code of ["ECONNREFUSED", "ENOENT", "ETIMEDOUT"]) {
    it(`should report unknown rather than absence when one host fails with ${code}`, async () => {
      const inventory = await collectNativeInventory(endpoints, async path => {
        if (path === endpoints[0]) throw Object.assign(new Error(code), { code });
        return { list: async () => [] } as unknown as NativeTerminalClient;
      });
      expect(inventory.complete).toBe(false);
      expect(resolveNativeOwner("h2a-worker", inventory)).toMatchObject({ state: "unknown" });
    });
  }
  it("should use the sole observed owner even when the other inventory is incomplete", async () => {
    const inventory = await collectNativeInventory(endpoints, async path => {
      if (path === endpoints[0]) throw new Error("unreachable");
      return { list: async () => [session] } as unknown as NativeTerminalClient;
    });
    expect(resolveNativeOwner("h2a-worker", inventory)).toMatchObject({ state: "found", socketPath: endpoints[1] });
  });
  it("should certify absence only after every known endpoint answers", async () => {
    const inventory = await collectNativeInventory(endpoints, async () => ({ list: async () => [] }) as unknown as NativeTerminalClient);
    expect(resolveNativeOwner("h2a-worker", inventory)).toEqual({ state: "absent" });
  });
});
