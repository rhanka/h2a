// @ts-ignore Shared, read-only isolation helper.
import { setupNativeTestEnvironment } from "../../../h2a/test/helpers/native-isolation.js";
import { afterAll, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { NativeTerminalHost } from "./host.js";
import { createNativeTerminalLeaseContext, executeNativeTerminalHostRequest, releaseNativeTerminalLeases } from "./server.js";
import type { NativeTerminalOperation } from "./protocol.js";
setupNativeTestEnvironment(afterAll);

function fixture() {
  const write = vi.fn();
  const host = new NativeTerminalHost({
    generation: "write-ack", replayBytesPerSession: 1024,
    registryPath: join(process.env.TMPDIR!, randomUUID() + ".json"),
    readLeaderStartTime: () => 100,
    reaper: { killGroup() {}, isGroupAlive: () => false, describeGroup: () => "empty fixture" },
    spawner: () => ({ pid: 41000, pgid: 41000, cols: 80, rows: 24, write,
      resize() {}, kill() {}, onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }) }),
  });
  host.create({ id: "cli", command: "fixture", args: [], cwd: process.env.TMPDIR!, env: {}, cols: 80, rows: 24 });
  const context = createNativeTerminalLeaseContext();
  const request = (operation: NativeTerminalOperation, params?: Record<string, unknown>, ctx = context): any =>
    executeNativeTerminalHostRequest(host, ctx, { version: 1, id: randomUUID(), operation, params });
  const lease = request("acquire-controller", { id: "cli", controllerId: "controller", writeIdentity: true });
  const identity = (seq: number) => ({ sessionId: lease.id, incarnation: lease.incarnation, controllerEpoch: lease.epoch, seq });
  const send = (seq: number, data = "one", ctx = context, granted = lease) =>
    request("write", { lease: granted, data, writeIdentity: identity(seq) }, ctx);
  return { host, context, request, lease, identity, send, write };
}

describe("owner applied write frontier", () => {
  it("should ACK an executed retry without writing to the PTY twice", () => {
    const f = fixture();
    expect(f.send(1)).toEqual({ controllerId: "controller", epoch: f.lease.epoch, frontier: 1 });
    expect(f.send(1)).toEqual({ controllerId: "controller", epoch: f.lease.epoch, frontier: 1 });
    expect(f.write.mock.calls).toEqual([["one"]]);
  });

  it("should reject a write with a sequence gap instead of applying it out of order", () => {
    const f = fixture();
    expect(() => f.send(2)).toThrow(/write-sequence-gap/);
    expect(f.write).not.toHaveBeenCalled();
    f.send(1); f.send(2, "two");
    expect(f.write.mock.calls).toEqual([["one"], ["two"]]);
  });

  it("should reject a changed last in-flight payload and malformed identities", () => {
    const f = fixture(); f.send(1);
    expect(() => f.send(1, "changed")).toThrow(/write-identity-conflict/);
    for (const writeIdentity of [{ ...f.identity(2), incarnation: "stale" }, { ...f.identity(2), seq: 0 }, { ...f.identity(2), seq: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(() => f.request("write", { lease: f.lease, data: "invalid", writeIdentity })).toThrow();
    }
    expect(f.write).toHaveBeenCalledTimes(1);
  });

  it("should resume the same lease and frontier after connection cleanup", () => {
    const f = fixture(); f.send(1);
    releaseNativeTerminalLeases(f.host, f.context);
    const next = createNativeTerminalLeaseContext();
    const lease = f.request("acquire-controller", { id: "cli", controllerId: "controller", writeIdentity: true, resumeLease: f.lease }, next);
    expect(lease.epoch).toBe(f.lease.epoch);
    expect(lease.resumeToken).toBe(f.lease.resumeToken);
    expect(lease.appliedFrontier.frontier).toBe(1);
    f.send(1, "one", next, lease);
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(() => f.request("acquire-controller", { id: "cli", controllerId: "other", writeIdentity: true })).toThrow(/already has a controller/);
    expect(() => f.request("acquire-controller", { id: "cli", controllerId: "controller", writeIdentity: true, resumeLease: { ...f.lease, resumeToken: "forged" } })).toThrow();
  });

  it("should fence a resume after takeover, including delayed old disconnect cleanup", () => {
    const f = fixture(); f.send(1);
    const next = createNativeTerminalLeaseContext();
    const lease = f.request("acquire-controller", { id: "cli", controllerId: "other", takeover: true, writeIdentity: true }, next);
    releaseNativeTerminalLeases(f.host, f.context);
    expect(() => f.request("acquire-controller", { id: "cli", controllerId: "controller", writeIdentity: true, resumeLease: f.lease })).toThrow(/stale terminal controller lease/);
    expect(() => f.send(2)).toThrow();
    f.request("write", { lease, data: "new", writeIdentity: { sessionId: lease.id, incarnation: lease.incarnation, controllerEpoch: lease.epoch, seq: 1 } }, next);
    expect(f.write.mock.calls).toEqual([["one"], ["new"]]);
  });

  it("should require write identities on resumable leases and release explicit detach", () => {
    const f = fixture();
    expect(() => f.request("write", { lease: f.lease, data: "unidentified" })).toThrow(/write-identity-required/);
    f.request("release-controller", { lease: f.lease });
    expect(() => f.request("acquire-controller", { id: "cli", controllerId: "controller", writeIdentity: true, resumeLease: f.lease })).toThrow(/stale terminal controller lease/);
    const legacy = f.request("acquire-controller", { id: "cli", controllerId: "legacy" });
    expect(legacy.resumeToken).toBeUndefined();
    f.request("write", { lease: legacy, data: "legacy" });
    releaseNativeTerminalLeases(f.host, f.context);
    expect(f.host.state("cli").controlled).toBe(false);
  });

  it("should keep only one frontier and a 32-byte last-write digest per current epoch", () => {
    const f = fixture();
    for (let seq = 1; seq <= 1024; seq++) f.send(seq, String(seq));
    // The resume result is constant-size irrespective of the number of writes.
    releaseNativeTerminalLeases(f.host, f.context);
    const lease = f.request("acquire-controller", { id: "cli", controllerId: "controller", writeIdentity: true, resumeLease: f.lease });
    expect(lease.appliedFrontier).toEqual({ controllerId: "controller", epoch: f.lease.epoch, frontier: 1024 });
    expect(f.send(1)).toEqual(lease.appliedFrontier);
    expect(f.write).toHaveBeenCalledTimes(1024);
  });
});
