import { describe, expect, it, vi } from "vitest";
import { collectNativeInventory, resolveNativeOwner } from "./fleet.js";
import type { NativeTerminalClient } from "./client.js";

const session = { id: "h2a-worker", status: "running", pid: 123, generation: "g", incarnation: "i" };
const endpoints = ["/private/native-terminal.sock", "/private/native-terminal.lf1.sock"];

describe("native fleet ownership", () => {
  it("should wait for a positively live publisher to finish before adopting it", async () => {
    let attempts = 0;
    const client = { list: async () => [session] } as unknown as NativeTerminalClient;
    const inventory = await collectNativeInventory([endpoints[0]!], async () => {
      if (++attempts < 4) throw Object.assign(new Error("not published yet"), { code: "ECONNREFUSED" });
      return client;
    }, async () => { throw Object.assign(new Error("publisher starting"), { code: "H2A_ENDPOINT_LIVE_OWNER" }); });
    expect(inventory.complete).toBe(true);
    expect(resolveNativeOwner(session.id, inventory)).toMatchObject({ state: "found", client });
    expect(attempts).toBe(4);
  });
  it("should wait for a successor that is still publishing after a lock-timeout absence proof", async () => {
    let attempts = 0;
    const client = { list: async () => [session] } as unknown as NativeTerminalClient;
    const inventory = await collectNativeInventory([endpoints[0]!], async () => {
      if (++attempts < 5) throw Object.assign(new Error("not published yet"), { code: "ECONNREFUSED" });
      return client;
    }, async () => { throw Object.assign(new Error("terminal socket publication lock timed out"), { code: "H2A_PUBLICATION_LOCK_TIMEOUT" }); });
    expect(inventory.complete).toBe(true);
    expect(resolveNativeOwner(session.id, inventory)).toMatchObject({ state: "found", client });
    expect(attempts).toBe(5);
  });
  it.each(["live-owner", "lock-timeout"])("should adopt a healthy successor after a raced %s absence proof", async (failure) => {
    let attempts = 0;
    const client = { list: async () => [session] } as unknown as NativeTerminalClient;
    const inventory = await collectNativeInventory([endpoints[0]!], async () => {
      if (attempts++ === 0) throw Object.assign(new Error("old host died"), { code: "ECONNREFUSED" });
      return client;
    }, async () => {
      if (failure === "lock-timeout") throw new Error("publication lock timed out");
      return false;
    });
    expect(inventory.complete).toBe(true);
    expect(resolveNativeOwner(session.id, inventory)).toMatchObject({ state: "found", client });
    expect(attempts).toBe(2);
  });
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
