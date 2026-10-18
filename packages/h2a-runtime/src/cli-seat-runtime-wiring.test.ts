import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { LlmMeshFacade } from "@sentropic/cluster-mesh/llm-mesh/facade";

const { op } = vi.hoisted(() => ({ op: vi.fn() }));
vi.mock("node:child_process", async original => ({ ...await original<typeof import("node:child_process")>(), spawnSync: op }));
// Use the same contract bytes from this checkout; no installed dist required.
vi.mock("./agy-claude.js", () => import("../../h2a/src/runtime/agy-claude.js"));
import { startNativeSession, startNativeHeadlessSession, startNativeH2aSidecar } from "./native-host.js";
import { enrollViaFacade } from "./llm-mesh-accounts.js";
import { destroyMaterializedSeat, materializeSeatBundle } from "./cli-seat-materialization.js";
import { makeSyntheticConsumerBundle } from "./cli-seat-fixtures.js";

let runtimeBase: string;
beforeEach(() => { runtimeBase = mkdtempSync(join(tmpdir(), "seat-wiring-runtime-")); vi.stubEnv("XDG_RUNTIME_DIR", runtimeBase); });
afterEach(() => { vi.unstubAllEnvs(); op.mockReset(); rmSync(runtimeBase, { recursive: true, force: true }); });

describe("review 348 finding 3: real runtime environment capture", () => {
  it.each(["agy", "claude", "vibe"] as const)("maps the public %s seat alias to its enrollment provider", async alias => {
    const facade = { enroll: vi.fn().mockRejectedValue(new Error("synthetic-enroll-boundary")), completeClaudeEnrollment: vi.fn() } as unknown as LlmMeshFacade;
    await expect(enrollViaFacade(alias, { facade, from: "oauth", ownerScope: "lab-review" })).rejects.toThrow();
    expect(vi.mocked(facade.enroll).mock.calls[0]?.[0]).toBe(alias === "agy" ? "cloud-code" : alias === "claude" ? "claude-code" : "mistral-vibe");
  });
  it.each(["interactive", "headless", "mcp"])("sanitizes the actual %s env.json before create", kind => {
    const root = mkdtempSync(join(runtimeBase, "seat-native-wiring-"));
    const seat = materializeSeatBundle(makeSyntheticConsumerBundle("codex"), { parentDir: root, mode: "token", labProfile: "lab-review", gateway: "off" });
    try {
      const canary = "H2A-SYNTHETIC-NATIVE-ENV-CANARY";
      vi.stubEnv("MISTRAL_API_KEY", canary);
      vi.stubEnv("H2A_LLM_MESH_CONFIG_JSON", JSON.stringify({ token: canary }));
      vi.stubEnv("H2A_TOKEN", canary);
      vi.stubEnv("INNOCUOUS_ENCODED", Buffer.from(canary).toString("base64"));
      vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "provider-secret-profile"));
      let captured: Record<string, string> | undefined;
      let created = false;
      op.mockImplementation((_command, argv: string[]) => {
        let payload: unknown = created ? { verdict: "live", state: { pid: 123, id: "h2a-review.h2a", status: "running" } } : { verdict: "dead" };
        if (argv[1] === "create") {
          captured = JSON.parse(readFileSync(argv[argv.indexOf("--env-file") + 1]!, "utf8"));
          payload = { pid: 123, id: "h2a-review", status: "running" };
          created = true;
        }
        return { status: 0, stdout: JSON.stringify(payload), stderr: "" };
      });
      if (kind === "interactive") startNativeSession("codex", "codex", root, [], "review", { terminateOnAgentExit: true, seat });
      else if (kind === "headless") startNativeHeadlessSession("codex", "codex", root, [], join(root, "result"), join(root, "output"), "review", undefined, undefined, undefined, undefined, undefined, undefined, seat);
      else expect(startNativeH2aSidecar("h2a-review", root, "h2a mcp-serve", { seat })).toBe(true);
      expect(captured).toBeDefined();
      expect(JSON.stringify(captured)).not.toContain(canary);
      expect(JSON.stringify(captured)).not.toContain(Buffer.from(canary).toString("base64"));
      if (kind === "mcp") {
        expect(captured!.CLAUDE_CONFIG_DIR).toBeUndefined();
        expect(captured!.HOME).not.toBe(process.env.HOME);
        expect(captured!.XDG_CONFIG_HOME).not.toBe(process.env.XDG_CONFIG_HOME);
        expect(captured!.H2A_TOKEN).toBeUndefined();
      }
    } finally { destroyMaterializedSeat(seat); rmSync(root, { recursive: true, force: true }); }
  });
  it.each(["interactive", "headless"])("preserves gateway and direct authentication in non-seat %s IPC", kind => {
    const original = {
      ANTHROPIC_AUTH_TOKEN: "llm-mesh", ANTHROPIC_BASE_URL: "http://127.0.0.1:1234",
      OPENAI_API_KEY: "synthetic-openai", ANTHROPIC_API_KEY: "synthetic-anthropic",
      MISTRAL_API_KEY: "synthetic-mistral", GEMINI_API_KEY: "synthetic-gemini", GH_TOKEN: "synthetic-gh",
      AGY_ADC_AUTH: "1", MAX_TOKENS: "1", SECRET_FLAG: "true", GCLOUD_PROJECT: "h2a",
      HOME: join(runtimeBase, "home-h2a-1"), PATH: "/usr/bin:/bin", PWD: runtimeBase,
    };
    for (const [key, value] of Object.entries(original)) vi.stubEnv(key, value);
    let captured: Record<string, string> | undefined;
    op.mockImplementation((_command, argv: string[]) => {
      if (argv[1] !== "create") return { status: 0, stdout: JSON.stringify({ verdict: "dead" }), stderr: "" };
      captured = JSON.parse(readFileSync(argv[argv.indexOf("--env-file") + 1]!, "utf8"));
      return { status: 0, stdout: JSON.stringify({ pid: 123, id: "h2a-review", status: "running" }), stderr: "" };
    });
    if (kind === "interactive") startNativeSession("claude", "claude", runtimeBase, [], "review", { terminateOnAgentExit: true });
    else startNativeHeadlessSession("claude", "claude", runtimeBase, [], join(runtimeBase, "result"), join(runtimeBase, "output"), "review");
    expect(captured).toMatchObject(original);
    expect(captured!.XDG_RUNTIME_DIR).toBe(runtimeBase);
    expect(captured!.TERM).toBe("xterm-256color");
  });
  it.each(["codex", "cloud-code", "mistral-vibe"] as const)("reports the exact missing L1 CLI import for %s without invoking OAuth", async provider => {
    const facade = { enroll: vi.fn() } as unknown as LlmMeshFacade;
    await expect(enrollViaFacade(provider, { facade, from: "cli", ownerScope: "lab-review" })).rejects.toMatchObject({ code: "seat-import-unavailable" });
    expect(facade.enroll).not.toHaveBeenCalled();
  });
  it.each(["codex", "cloud-code", "mistral-vibe", "muse"] as const)("reports the exact missing L1 token import for %s before reading input", async provider => {
    const facade = { enroll: vi.fn() } as unknown as LlmMeshFacade;
    const readInput = vi.fn();
    await expect(enrollViaFacade(provider, { facade, readInput, from: "token", ownerScope: "lab-review" })).rejects.toMatchObject({ code: "seat-import-unavailable" });
    expect(facade.enroll).not.toHaveBeenCalled(); expect(readInput).not.toHaveBeenCalled();
  });
});
