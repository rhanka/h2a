import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, appendFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { deliverClaudeNativePrompt } = await import(process.env.QUAL_CLAUDE_DRIVER_MODULE ?? "./claude-native-driver.js");
import { ClaudeDebugReader } from "./claude-debug-adapter.js";
import { correlatedClaudeResponse } from "./claude-transcript.js";

const settled = "[DEBUG] hooks module test prompt.submit settled in 1ms\n";
const turn = "[DEBUG] [engine] turn 1 start\n";
const main = "[DEBUG] [API REQUEST] /v1/messages source=repl_main_thread\n";
const title = "[DEBUG] [API REQUEST] /v1/messages source=generate_session_title\n";
function fixture(log: string, options: { mcpAt?: number; blockedAfterPaste?: boolean; truncated?: boolean } = {}) {
  let time = 0, screen = "❯ \n· ~/project", submitted = false;
  const submit = vi.fn(() => { submitted = true; appendFileSync(log, title); return true; });
  const capture = vi.fn(() => screen);
  const paste = vi.fn((_name: string, prompt: string) => {
    screen = options.blockedAfterPaste ? "Compacting conversation…" : options.truncated ? "❯ [Pasted Content 12 chars] exact brief\n· ~/project" : "❯ " + prompt + "\n· ~/project";
    return true;
  });
  let connected = false, completed = false;
  const deps = { capturePane: capture, clearComposer: () => true, pasteBlock: paste, submit, cpuMs: () => 0,
    now: () => time, sleep: (ms: number) => {
      time += ms;
      if (!connected && options.mcpAt !== undefined && time >= options.mcpAt) {
        connected = true;
        appendFileSync(log, '[DEBUG] MCP server "playwright": Successfully connected\n[DEBUG] MCP server "playwright": Connection established with capabilities: {"hasTools":true}\n');
      }
      if (submitted && !completed && time >= 2000) { completed = true; appendFileSync(log, settled + turn + main); }
    } };
  return { deps, submit, paste, capture, time: () => time };
}
function temporary(test: (file: string) => Promise<void> | void) {
  return async () => { const dir = mkdtempSync(join(tmpdir(), "l0-driver-")), file = join(dir, "debug.log"); writeFileSync(file, "");
    try { await test(file); } finally { rmSync(dir, { recursive: true, force: true }); } };
}
describe("L0 product driver adversaries", () => {
  for (const proof of ["dispatch", "response"]) {
    it("should preserve submission when a required MCP dies during Enter with " + proof, temporary(async file => {
      const f = fixture(file);
      let live = true;
      appendFileSync(file, '[DEBUG] MCP server "playwright": Successfully connected\n[DEBUG] MCP server "playwright": Connection established with capabilities: {"hasTools":true}\n');
      f.submit.mockImplementation(() => { live = false; appendFileSync(file, settled + turn + main); return true; });
      const result = await deliverClaudeNativePrompt("w", "exact brief", f.deps, { debugFile: file,
        requiredMcps: ["playwright"], requiredMcpProof: () => live,
        qualifiedDiagnostic: proof === "dispatch", correlatedPrompt: () => true,
        correlatedResponse: () => proof === "response" });
      expect(result.state).toBe("launch-unconfirmed");
      expect(result.submitAttempted).toBe(true); expect(f.submit).toHaveBeenCalledTimes(1);
    }));
  }
  it("should revalidate required MCP liveness at final publication", temporary(async file => {
    const f = fixture(file);
    let live = true, publish: (() => string | undefined) | undefined;
    appendFileSync(file, '[DEBUG] MCP server "playwright": Successfully connected\n[DEBUG] MCP server "playwright": Connection established with capabilities: {"hasTools":true}\n');
    f.submit.mockImplementation(() => { appendFileSync(file, settled + turn + main); return true; });
    const result = await deliverClaudeNativePrompt("w", "exact brief", f.deps, { debugFile: file,
      requiredMcps: ["playwright"], requiredMcpProof: () => live,
      qualifiedDiagnostic: true, correlatedPrompt: () => true, publicationCheck: check => { publish = check; } });
    expect(result.state).toBe("working"); live = false;
    expect(publish?.()).toMatch(/required MCP/);
  }));
  it("should observe a queued refusal beyond the incremental read window before publication", temporary(async file => {
    const f = fixture(file);
    f.submit.mockImplementation(() => { appendFileSync(file, settled + turn + main + "[DEBUG] unrelated record\n".repeat(10000) + "[ERROR] API error (attempt 1/11): 401 401 {}\n"); return true; });
    const result = await deliverClaudeNativePrompt("w", "exact brief", f.deps, { debugFile: file,
      qualifiedDiagnostic: true, correlatedPrompt: () => true });
    expect(result.state).toBe("provider-blocked"); expect(f.submit).toHaveBeenCalledTimes(1);
  }));
  it("should preserve uncertainty when publication has an incomplete diagnostic record", temporary(async file => {
    const f = fixture(file);
    f.submit.mockImplementation(() => { appendFileSync(file, settled + turn + main + "[ERROR] API error (attempt 1/11): 401"); return true; });
    const result = await deliverClaudeNativePrompt("w", "exact brief", f.deps, { debugFile: file,
      qualifiedDiagnostic: true, correlatedPrompt: () => true });
    expect(result.state).toBe("launch-unconfirmed"); expect(f.submit).toHaveBeenCalledTimes(1);
  }));
  it("should preserve potential foreign submission before our own Enter", temporary(async file => {
    const f = fixture(file), mark = vi.fn();
    f.paste.mockImplementation(() => { throw new Error("launch input epoch changed"); });
    const result = await deliverClaudeNativePrompt("w", "exact brief", f.deps, { debugFile: file,
      launchGuard: { markSubmitAttempted: mark } as never });
    expect(result.state).toBe("launch-unconfirmed"); expect(mark).toHaveBeenCalledTimes(1);
    expect(f.submit).not.toHaveBeenCalled();
  }));
  it("should wait for required MCP capabilities before submitting the first turn", temporary(async file => {
    const f = fixture(file, { mcpAt: 1000 });
    const result = await deliverClaudeNativePrompt("w", "exact brief", f.deps, { debugFile: file, requiredMcps: ["playwright"], requiredMcpProof: () => f.time() >= 1000, qualifiedDiagnostic: true, correlatedPrompt: () => true });
    expect(result.state).toBe("working"); expect(f.submit).toHaveBeenCalledTimes(1);
    expect(f.paste).toHaveBeenCalledTimes(1); expect(f.capture.mock.calls.length).toBeLessThanOrEqual(Math.ceil(f.time() / 250) + 1);
  }));
  it("should reject compaction raised after readiness", temporary(async file => {
    const f = fixture(file, { blockedAfterPaste: true });
    const result = await deliverClaudeNativePrompt("w", "exact brief", f.deps, { debugFile: file });
    expect(result.state).toBe("undelivered"); expect(f.submit).not.toHaveBeenCalled();
  }));
  it("should reject a truncated marker even when a prompt probe is present", temporary(async file => {
    const f = fixture(file, { truncated: true });
    await deliverClaudeNativePrompt("w", "exact brief with a much longer final instruction", f.deps, { debugFile: file });
    expect(f.submit).not.toHaveBeenCalled();
  }));
  for (const proof of [title, main, turn + main, settled + main]) {
    it("should not accept an incomplete hook/turn/dispatch sequence " + JSON.stringify(proof), temporary(async file => {
      const f = fixture(file); f.submit.mockImplementation(() => { appendFileSync(file, proof); return true; });
      const result = await deliverClaudeNativePrompt("w", "exact brief", f.deps, { debugFile: file, qualifiedDiagnostic: true, observationTimeoutMs: 1000 });
      expect(result.state).toBe("launch-unconfirmed");
    }));
  }
  it("should preserve a submitted session when a hook veto occurs", temporary(async file => {
    const f = fixture(file); f.submit.mockImplementation(() => { appendFileSync(file, "[ERROR] hook pre-submit rejected: veto\n"); return true; });
    expect((await deliverClaudeNativePrompt("w", "exact brief", f.deps, { debugFile: file })).state).toBe("provider-blocked");
    expect(f.submit).toHaveBeenCalledTimes(1);
  }));
  for (const status of [400, 401, 429, 500]) {
    it("should reject a known HTTP refusal before publishing a local dispatch " + status, temporary(async file => {
      const f = fixture(file);
      f.submit.mockImplementation(() => { appendFileSync(file, settled + turn + main + `[ERROR] API error (attempt 1/11): ${status} ${status} {}\n`); return true; });
      const result = await deliverClaudeNativePrompt("w", "exact brief", f.deps, { debugFile: file, qualifiedDiagnostic: true });
      expect(result.state).toBe("provider-blocked"); expect(f.submit).toHaveBeenCalledTimes(1);
    }));
  }
  it("should preserve uncertainty when dispatch belongs to an unverified conversation or prompt", temporary(async file => {
    const f = fixture(file);
    f.submit.mockImplementation(() => { appendFileSync(file, settled + turn + main); return true; });
    const result = await deliverClaudeNativePrompt("w", "exact brief", f.deps, { debugFile: file, qualifiedDiagnostic: true, correlatedPrompt: () => false, observationTimeoutMs: 1000 });
    expect(result.state).toBe("launch-unconfirmed");
  }));
  it("should retain a fragmented dispatch line and detect truncation", temporary(file => {
    const reader = new ClaudeDebugReader(file);
    appendFileSync(file, main.slice(0, 30)); expect(reader.read().content).toBe("");
    appendFileSync(file, main.slice(30)); expect(reader.read().content).toBe(main);
    writeFileSync(file, ""); expect(reader.read().error).toMatch(/truncated/);
  }));
  it("should correlate an out-of-order assistant response only to the exact conversation and prompt", temporary(file => {
    const user = { type: "user", sessionId: "c", uuid: "u", message: { content: "exact brief" } };
    const assistant = { type: "assistant", sessionId: "c", parentUuid: "u", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } };
    writeFileSync(file, JSON.stringify(assistant) + "\n" + JSON.stringify(user) + "\n");
    expect(correlatedClaudeResponse(file, "c", "exact brief")).toBe(true);
    expect(correlatedClaudeResponse(file, "other", "exact brief")).toBe(false);
    expect(correlatedClaudeResponse(file, "c", "different brief")).toBe(false);
  }));
});
