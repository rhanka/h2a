import { describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";

const { op, proc } = vi.hoisted(() => ({ op: vi.fn(), proc: new Map<string, string>() }));
vi.mock("node:child_process", () => ({ spawnSync: op }));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, readFileSync: (path: string, ...args: unknown[]) => {
    if (path.startsWith("/proc/")) {
      const value = proc.get(path);
      if (value === undefined) throw new Error("unreadable synthetic process");
      return value;
    }
    return (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...args);
  } };
});
import { startNativeH2aSidecar } from "./native-host.js";

// All PID/group observations are synthetic: this test never inspects a host.
function procStat(pid: number, ppid: number, group: number, state = "S"): string {
  const fields = Array<string>(20).fill("0");
  fields[0] = state; fields[1] = String(ppid); fields[2] = String(group); fields[19] = "123";
  return `${pid} (synthetic process) ${fields.join(" ")}`;
}

describe("native sidecar readiness", () => {
  for (const scenario of ["ready", "foreign-group", "foreign-parent", "zombie", "unreadable", "wrong-nonce", "wrong-mode", "parent-replaced", "sidecar-replaced", "exited-without-ack"]) {
    it(`should ${scenario === "ready" ? "accept" : "refuse"} ${scenario} using the owned incarnation and correlated ACK`, () => {
      let created = false;
      let challengeFile: string | undefined;
      let sidecarProbes = 0;
      proc.clear();
      proc.set("/proc/334/stat", procStat(334, scenario === "foreign-parent" ? 999 : 333,
        scenario === "foreign-group" ? 999 : 333, scenario === "zombie" ? "Z" : "S"));
      if (scenario === "unreadable") proc.clear();
      const state = (id: string, incarnation: string, pid: number) => ({ id, generation: "g", incarnation, pid, status: "running", socketPath: "/synthetic.sock" });
      op.mockImplementation((_command, argv: string[]) => {
        const operation = argv[1];
        let payload: unknown;
        if (operation === "ensure-host") payload = { hostPid: 1, socketPath: "/synthetic.sock", generation: "g", launchFence: true };
        if (operation === "admit") payload = { admitted: true };
        if (operation === "probe") {
          const id = argv[argv.indexOf("--id") + 1]!;
          if (created) expect(argv).toContain("/synthetic.sock");
          if (!id.endsWith(".h2a")) payload = { verdict: "live", state: state(id, created && scenario === "parent-replaced" ? "replaced" : "parent", 222) };
          else {
            if (created) sidecarProbes++;
            payload = !created ? { verdict: "dead" } : { verdict: "live", state: {
              ...state(id, scenario === "sidecar-replaced" && sidecarProbes > 1 ? "replaced" : "sidecar", 333),
              ...(scenario === "exited-without-ack" ? { status: "exited" } : {})
            } };
          }
        }
        if (operation === "create") {
          expect(argv.at(-1)).toBe("exec h2a mcp-serve --auto-open");
          const env = JSON.parse(readFileSync(argv[argv.indexOf("--env-file") + 1]!, "utf8"));
          challengeFile = env.H2A_MCP_READY_FILE;
          if (scenario !== "exited-without-ack") writeFileSync(challengeFile!, JSON.stringify({
            kind: "h2a.mcp.ready", version: 1, pid: 334, sessionId: "ready-session",
            nonce: scenario === "wrong-nonce" ? "wrong" : env.H2A_MCP_READY_NONCE
          }), { mode: scenario === "wrong-mode" ? 0o644 : 0o600 });
          created = true;
          payload = state("h2a-worker.h2a", "sidecar", 333);
        }
        return { status: 0, stdout: JSON.stringify(payload), stderr: "" };
      });
      op.mockClear();
      expect(startNativeH2aSidecar("h2a-worker", "/synthetic", "h2a mcp-serve --auto-open", { verified: true }))
        .toBe(scenario === "ready");
      expect(challengeFile).toBeDefined();
      expect(() => readFileSync(challengeFile!, "utf8")).toThrow();
    });
  }
});
