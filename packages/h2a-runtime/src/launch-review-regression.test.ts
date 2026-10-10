import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { deliverClaudeNativePrompt } from "./claude-native-driver.js";
import type { PromptDeliveryDeps } from "./prompt-delivery.js";
const { stop, probe } = vi.hoisted(() => ({ stop: vi.fn(() => true), probe: vi.fn() }));
vi.mock("./native-host.js", () => ({ killNativeSessionIfIncarnation: stop, nativeSessionState: probe }));
import { startLaunchGuard } from "./launch-guard.js";

function driverFixture(before = "❯ \n· ~/project", pasted = "❯ Return LAB_READY\n· ~/project") {
  let screen = before, time = 0;
  const submit = vi.fn(() => true);
  const deps: PromptDeliveryDeps = {
    capturePane: () => screen, clearComposer: () => true,
    pasteBlock: () => { screen = pasted; return true; }, submit,
    cpuMs: () => 0, now: () => time, sleep: ms => { time += ms; },
  };
  return { deps, submit };
}

describe("launch review counterexamples", () => {
  it("should preserve uncertainty when Enter is swallowed and the prompt contains the response marker", async () => {
    const { deps } = driverFixture();
    const result = await deliverClaudeNativePrompt("worker", "Return LAB_READY", deps, { observationTimeoutMs: 1000 });
    expect(result.state).toBe("launch-unconfirmed");
  });
  it("should refuse Enter when a required MCP has no readiness evidence", async () => {
    const { deps, submit } = driverFixture();
    await deliverClaudeNativePrompt("worker", "Return LAB_READY", deps, { requiredMcps: ["playwright"], observationTimeoutMs: 1000 });
    expect(submit).not.toHaveBeenCalled();
  });
  it("should reject a stale collapsed paste even when its size matches", async () => {
    const prompt = "line\n".repeat(30);
    const { deps, submit } = driverFixture("❯ [Pasted text #1 +30 lines]\n· ~/project", "❯ [Pasted text #1 +30 lines]\n· ~/project");
    await deliverClaudeNativePrompt("worker", prompt, deps, { observationTimeoutMs: 1000 });
    expect(submit).not.toHaveBeenCalled();
  });
  it("should re-read durable submission before stopping from a stale local guard", () => {
    const dir = mkdtempSync(join(tmpdir(), "review-guard-"));
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), unref() {} });
    probe.mockReturnValue({ state: "found", session: { generation: "g", incarnation: "i", status: "exited" } });
    try {
      const guard = startLaunchGuard(dir, { host: "native", sessions: [{ name: "w", generation: "g", incarnation: "i", socketPath: "/private/test.sock" }] }, (() => child) as never);
      const path = join(dir, "launch.json");
      const receipt = JSON.parse(readFileSync(path, "utf8"));
      writeFileSync(path, JSON.stringify({ ...receipt, submitAttempted: true }));
      expect(guard.stop()).toBe(false);
      expect(JSON.parse(readFileSync(path, "utf8")).submitAttempted).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("should reject a stale writer after the receipt token changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "review-token-"));
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), unref() {} });
    try {
      const guard = startLaunchGuard(dir, { host: "native", sessions: [] }, (() => child) as never);
      const path = join(dir, "launch.json");
      writeFileSync(path, JSON.stringify({ token: "replacement", state: "launching", submitAttempted: true, ownership: { host: "native", sessions: [] } }));
      expect(() => guard.complete()).toThrow();
      expect(JSON.parse(readFileSync(path, "utf8")).token).toBe("replacement");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
