import { describe, it, expect } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAgentLaunchArgs } from "./agent-launch-args.js";

describe("L1 durable launch ownership", () => {
  it("should use the reserved conversation UUID only for new Claude conversations", () => {
    const id = "00000000-1111-4000-8000-000000000001";
    expect(buildAgentLaunchArgs({ profile: "claude", sessionId: id })).toContain(id);
    const resumed = buildAgentLaunchArgs({ profile: "claude", resumeId: id });
    expect(resumed).toContain("--resume"); expect(resumed).not.toContain("--session-id");
  });
  for (const phase of ["before-enter", "during-enter", "before-publication"]) {
    it("should preserve durable potential submission on real guard EOF at " + phase, async () => {
      const dir = mkdtempSync(join(tmpdir(), "l1-eof-")), path = join(dir, "launch.json");
      const ownership = { host: "native", sessions: [{ name: "w", generation: "g", incarnation: "i", socketPath: join(dir, "absent.sock") }] };
      writeFileSync(path, JSON.stringify({ token: "t", state: "launching", submitAttempted: true, ownership }));
      const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./launch-guard.ts", import.meta.url)), path],
        { env: { ...process.env, H2A_RUN_LAUNCH_TOKEN: "t" }, stdio: ["pipe", "ignore", "pipe"] });
      try {
        child.stdin.end(JSON.stringify({ ownership }) + "\n");
        const [code] = await once(child, "exit"); expect(code).toBe(0);
        const result = JSON.parse(readFileSync(path, "utf8"));
        expect(result.state).toBe("launch-unconfirmed"); expect(result.submitAttempted).toBe(true);
        expect(result.stopped).toBe(false); expect(result.retrySafe).toBe(false);
      } finally { if (child.exitCode === null) child.kill("SIGKILL"); rmSync(dir, { recursive: true, force: true }); }
    });
  }
  it("should share reservation capacity across fresh CLI processes and retain resident memory after started", () => {
    const dir = mkdtempSync(join(tmpdir(), "l1-shared-"));
    const module = fileURLToPath(new URL("./launch-capacity.ts", import.meta.url));
    const call = (id: string, finish = false) => JSON.parse(execFileSync(process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", 'import {acquireLaunchSlot,releaseLaunchSlot} from '+JSON.stringify(module)+'; const result=acquireLaunchSlot('+JSON.stringify(id)+',1,3*1024**3); '+(finish ? 'releaseLaunchSlot('+JSON.stringify(id)+',"started");' : '')+'console.log(JSON.stringify(result));'],
      { env: { ...process.env, XDG_STATE_HOME: dir }, encoding: "utf8" }));
    try {
      expect(call("one", true).acquired).toBe(true);
      expect(call("one").acquired).toBe(false);
      // Started releases observation capacity, while its 3 GiB resident charge remains.
      expect(call("two").acquired).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
