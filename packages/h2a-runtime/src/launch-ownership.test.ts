import { describe, expect, it, vi } from "vitest";

const { op } = vi.hoisted(() => ({ op: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: op }));
import { NativeHostCapabilityMismatchError, startNativeHeadlessSession, startNativeH2aSidecar, startNativeSession } from "./native-host.js";

describe("ownership before native creation", () => {
  for (const sidecar of [false, true]) {
    it(`should own the ${sidecar ? "sidecar" : "agent"} before issuing create`, () => {
      let ownership: { name: string; generation: string; incarnation: string } | undefined;
      op.mockImplementation((_command, argv) => {
        const operation = argv[1];
        let payload: unknown;
        if (operation === "probe") payload = ownership
          ? { verdict: "live", state: { ...ownership, id: ownership.name, pid: 123, status: "running" } }
          : { verdict: "dead" };
        if (operation === "ensure-host") payload = { hostPid: 1, socketPath: "/test", generation: "g", launchFence: true };
        if (operation === "create") {
          expect(ownership).toBeDefined();
          expect(argv[argv.indexOf("--incarnation") + 1]).toBe(ownership!.incarnation);
          expect(argv[argv.indexOf("--generation") + 1]).toBe("g");
          payload = { ...ownership, pid: 123 };
        }
        return { status: 0, stdout: JSON.stringify(payload), stderr: "" };
      });
      const beforeCreate = (value: NonNullable<typeof ownership>) => { ownership = value; };
      if (sidecar) {
        expect(startNativeH2aSidecar("h2a-worker", "/tmp", "h2a", { beforeCreate })).toBe(true);
        expect(ownership!.name).toBe("h2a-worker.h2a");
      } else {
        startNativeSession("codex", "codex", "/tmp", [], "worker", { beforeCreate });
        expect(ownership!.name).toBe("h2a-worker");
      }
    });
  }
  it("should refuse an older host before creating an unowned session", () => {
    op.mockImplementation((_command, argv) => ({ status: 0, stdout: JSON.stringify(argv[1] === "probe"
      ? { verdict: "dead" } : { hostPid: 1, socketPath: "/test", generation: "g" }), stderr: "" }));
    op.mockClear();
    expect(() => startNativeSession("codex", "codex", "/tmp", [], "worker", { beforeCreate: vi.fn() }))
      .toThrow("does not provide launchFence");
    expect(op.mock.calls.some(([, argv]) => argv[1] === "create")).toBe(false);
  });

  it("should certify a capability refusal with the observed host identity before any creation marker", () => {
    const host = { hostPid: 123, socketPath: "/test/private.sock", generation: "legacy" };
    op.mockImplementation((_command, argv) => ({ status: 0, stdout: JSON.stringify(argv[1] === "probe"
      ? { verdict: "dead" } : host), stderr: "" }));
    op.mockClear();
    const beforeCreate = vi.fn(), onCreateAttempt = vi.fn();
    let error: unknown;
    try { startNativeSession("codex", "codex", "/tmp", [], "worker", { beforeCreate, onCreateAttempt }); }
    catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(NativeHostCapabilityMismatchError);
    if (!(error instanceof NativeHostCapabilityMismatchError)) throw error;
    expect(error.toRunFailure("worker")).toEqual({
      kind: "h2a.run.failure", version: 1, state: "not-started", launchId: "worker",
      code: "native-host-capability-mismatch", phase: "host-selection", creationAttempted: false, retrySafe: true,
      missingCapabilities: ["launchFence"], host,
      recovery: { action: "select-compatible-generation", automaticRetry: false },
    });
    expect(error.message).toContain("Launch refused before creation");
    expect(error.message).toContain("No restart of the existing host is necessary");
    expect(beforeCreate).not.toHaveBeenCalled();
    expect(onCreateAttempt).not.toHaveBeenCalled();
    expect(op.mock.calls.some(([, argv]) => argv[1] === "create")).toBe(false);
  });

  for (const sidecar of [false, true]) {
    it(`should mark the ${sidecar ? "sidecar" : "agent"} create only after selection and ownership`, () => {
      const events: string[] = [];
      op.mockImplementation((_command, argv) => {
        events.push(argv[1]);
        return { status: 0, stdout: JSON.stringify(argv[1] === "probe" ? { verdict: "dead" }
          : argv[1] === "ensure-host" ? { hostPid: 123, socketPath: "/test", generation: "g", launchFence: true }
          : { pid: 124 }), stderr: "" };
      });
      const metadata = { beforeCreate: () => { events.push("ownership"); }, onCreateAttempt: () => { events.push("creation-attempted"); } };
      if (sidecar) startNativeH2aSidecar("h2a-worker", "/tmp", "h2a", metadata);
      else startNativeSession("codex", "codex", "/tmp", [], "worker", metadata);
      expect(events.slice(0, 5)).toEqual(["probe", "ensure-host", "ownership", "creation-attempted", "create"]);
    });
  }

  it("should not mark creation when the ownership callback refuses", () => {
    op.mockImplementation((_command, argv) => ({ status: 0, stdout: JSON.stringify(argv[1] === "probe"
      ? { verdict: "dead" } : { hostPid: 123, socketPath: "/test", generation: "g", launchFence: true }), stderr: "" }));
    op.mockClear();
    const onCreateAttempt = vi.fn();
    expect(() => startNativeSession("codex", "codex", "/tmp", [], "worker", {
      beforeCreate: () => { throw new Error("ownership failed"); }, onCreateAttempt,
    })).toThrow("ownership failed");
    expect(onCreateAttempt).not.toHaveBeenCalled();
    expect(op.mock.calls.some(([, argv]) => argv[1] === "create")).toBe(false);
  });

  it("should mark an unfenced headless creation immediately before emitting create", () => {
    const events: string[] = [];
    op.mockImplementation((_command, argv) => {
      events.push(argv[1]);
      return { status: 0, stdout: JSON.stringify(argv[1] === "probe" ? { verdict: "dead" } : { pid: 124 }), stderr: "" };
    });
    startNativeHeadlessSession("codex", "codex", "/tmp", [], "/tmp/result", "/tmp/output", "worker",
      undefined, true, undefined, () => { events.push("creation-attempted"); });
    expect(events).toEqual(["probe", "creation-attempted", "create"]);
  });
});
