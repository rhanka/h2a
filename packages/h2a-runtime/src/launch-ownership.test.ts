import { describe, expect, it, vi } from "vitest";

const { op } = vi.hoisted(() => ({ op: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: op }));
import { startNativeH2aSidecar, startNativeSession } from "./native-host.js";

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
      .toThrow("cannot reserve launch ownership");
    expect(op.mock.calls.some(([, argv]) => argv[1] === "create")).toBe(false);
  });
});
