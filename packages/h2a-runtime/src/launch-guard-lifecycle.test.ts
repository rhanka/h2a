import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { stop, probe } = vi.hoisted(() => ({ stop: vi.fn(() => true), probe: vi.fn() }));
vi.mock("./native-host.js", () => ({ killNativeSessionIfIncarnation: stop, nativeSessionState: probe }));
import { startLaunchGuard } from "./launch-guard.js";

describe("launch guard lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());
  it("should recover completed observation capacity at EOF while retaining resident memory", async () => {
    const directory = mkdtempSync(join(tmpdir(), "launch-guard-published-"));
    const path = join(directory, "launch.json"), state = join(directory, "state");
    const capacity = join(state, "h2a", "launch-capacity", "reservations.json");
    mkdirSync(join(state, "h2a", "launch-capacity"), { recursive: true });
    writeFileSync(capacity, JSON.stringify({ slots: { published: { state: "launching", token: "owned", residentBytes: 1024 } } }));
    writeFileSync(path, JSON.stringify({ token: "owned", state: "started", submitAttempted: true,
      result: { kind: "h2a.run.result", state: "started", ok: true },
      ownership: { host: "native", sessions: [{ name: "h2a-published", socketPath: join(directory, "private.sock"), generation: "g", incarnation: "i" }] } }));
    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./launch-guard.ts", import.meta.url)), path],
      { env: { ...process.env, XDG_STATE_HOME: state, H2A_RUN_LAUNCH_TOKEN: "owned" }, stdio: ["pipe", "ignore", "pipe"] });
    try {
      child.stdin.end();
      const [code] = await once(child, "exit");
      expect(code).toBe(0);
      expect(JSON.parse(readFileSync(capacity, "utf8")).slots.published).toMatchObject({ state: "started", residentBytes: 1024 });
      expect(JSON.parse(readFileSync(path, "utf8")).result.state).toBe("started");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("should publish potential submission when pre-submit cleanup cannot establish ownership", () => {
    const directory = mkdtempSync(join(tmpdir(), "launch-guard-unknown-"));
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), unref() {} });
    probe.mockReturnValue({ state: "unknown", reason: "input ownership unavailable" });
    try {
      const guard = startLaunchGuard(directory, { host: "native", sessions: [
        { name: "worker", socketPath: "/private/owned.sock", generation: "g", incarnation: "i" },
      ] }, (() => child) as never);
      expect(guard.stop()).toBe(false);
      expect(JSON.parse(readFileSync(join(directory, "launch.json"), "utf8"))).toMatchObject({
        state: "launch-unconfirmed", submitAttempted: true, stopped: false, retrySafe: false,
      });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  for (const otherAttempt of [false, true]) {
    it(`should ${otherAttempt ? "ignore another attempt's receipt" : "preserve a completed receipt"} at EOF`, async () => {
      const directory = mkdtempSync(join(tmpdir(), "launch-guard-receipt-"));
      const path = join(directory, "launch.json");
      writeFileSync(path, JSON.stringify({ token: otherAttempt ? "other" : "owned", state: "started",
        ownership: { host: "native", sessions: [] } }));
      const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./launch-guard.ts", import.meta.url)), path],
        { env: { ...process.env, H2A_RUN_LAUNCH_TOKEN: "owned" }, stdio: ["pipe", "ignore", "pipe"] });
      try {
        child.stdin.end(JSON.stringify({ ownership: { host: "tmux", sessions: [] } }) + "\n");
        const [code] = await once(child, "exit");
        expect(code).toBe(0);
        const receipt = JSON.parse(readFileSync(path, "utf8"));
        expect(receipt.state).toBe("started");
        expect(receipt.ownership.host).toBe("native");
      } finally {
        if (child.exitCode === null) child.kill("SIGKILL");
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
  it("should ignore a late spawn error after completion", () => {
    const directory = mkdtempSync(join(tmpdir(), "launch-guard-test-"));
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), unref() {} });
    try {
      const guard = startLaunchGuard(directory, { host: "native", sessions: [
        { name: "worker", socketPath: "/private/owned.sock", generation: "g", incarnation: "i" },
      ] }, (() => child) as never);
      guard.complete();
      child.emit("error", new Error("late spawn error"));
      expect(probe).not.toHaveBeenCalled();
      expect(stop).not.toHaveBeenCalled();
      expect(JSON.parse(readFileSync(join(directory, "launch.json"), "utf8")).state).toBe("started");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("should attest stopped sessions without a second failing kill", () => {
    const directory = mkdtempSync(join(tmpdir(), "launch-guard-test-"));
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), unref() {} });
    probe.mockReturnValue({ state: "found", session: { socketPath: "/private/owned.sock", generation: "g", incarnation: "i", status: "exited" } });
    try {
      const guard = startLaunchGuard(directory, { host: "native", sessions: [
        { name: "worker", socketPath: "/private/owned.sock", generation: "g", incarnation: "i" },
      ] }, (() => child) as never);
      expect(guard.stop()).toBe(true);
      expect(stop).not.toHaveBeenCalled();
      expect(JSON.parse(readFileSync(join(directory, "launch.json"), "utf8")).state).toBe("stopped");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
