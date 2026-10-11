import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyDurableProcFrame, readBootTimeMs } from "./proc-identity.js";
import { isLive } from "./registry.js";
import * as fs from "node:fs";

vi.mock("node:fs", async importOriginal => ({ ...await importOriginal<typeof import("node:fs")>(), readFileSync: vi.fn() }));
vi.mock("node:os", async importOriginal => ({ ...await importOriginal<typeof import("node:os")>(), uptime: () => 0 }));
const current = { machineId: "a".repeat(32), bootId: "11111111-1111-4111-8111-111111111111", pidNamespace: "4026531836" };
afterEach(() => vi.restoreAllMocks());
describe("durable process frame v5", () => {
  it.each(["machineId", "bootId", "pidNamespace"] as const)("should classify an unknown current %s as foreign-frame", key => {
    expect(classifyDurableProcFrame(current, { ...current, [key]: undefined })).toBe("foreign-frame");
  });
  it("should require a known machine even when boot and namespace match", () => {
    expect(classifyDurableProcFrame({ ...current, machineId: undefined }, current)).toBe("foreign-frame");
  });
  it.each(["bootId", "pidNamespace"] as const)("should classify an unrecorded %s as foreign-frame", key => {
    expect(classifyDurableProcFrame({ ...current, [key]: undefined }, current)).toBe("foreign-frame");
  });
  it.each([{ machineId: "0".repeat(32) }, { machineId: "A".repeat(32) }, { pidNamespace: "pid:[123]" }, { bootId: "garbage" }])(
    "should classify malformed stored anchors as foreign-frame: %j", malformed => {
      const recorded = { ...current, ...malformed };
      expect(classifyDurableProcFrame(recorded, recorded)).toBe("foreign-frame");
      expect(classifyDurableProcFrame(recorded, current)).toBe("foreign-frame");
    });
  it("should classify a malformed recorded bootId as foreign-frame", () => {
    expect(classifyDurableProcFrame({ ...current, bootId: "garbage" }, current)).toBe("foreign-frame");
  });
  it("should grant only the same known machine and namespace", () => {
    expect(classifyDurableProcFrame(current, current)).toBe("current");
    expect(classifyDurableProcFrame({ ...current, bootId: "00000000-0000-4000-8000-000000000000" }, current)).toBe("stale-boot");
    expect(classifyDurableProcFrame({ ...current, machineId: "b".repeat(32) }, current)).toBe("foreign-frame");
    expect(classifyDurableProcFrame({ ...current, pidNamespace: "123" }, current)).toBe("foreign-frame");
  });
  it("should treat uptime 0 as unknown boot time, never as mass death", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => "0.00 0.00\n");
    expect(readBootTimeMs()).toBeUndefined();
    expect(isLive({ kind: "local", lastSeenAt: "2000-01-01T00:00:00Z" } as any)).toBe(true);
  });
  it("should treat unreadable uptime as unknown", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error("unreadable"); });
    expect(readBootTimeMs()).toBeUndefined();
  });
  it("should derive boot time only from positive readable uptime", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("120.25 400.00\n");
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    expect(readBootTimeMs()).toBe(879_750);
  });
});
