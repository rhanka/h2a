import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { renderTerminalScreen } from "./native-terminal/screen.js";

import {
  AGY_CLAUDE_QUOTA_CODE,
  AgyClaudeQuotaExhaustedError,
  AgyEffortError,
  agyClaudeQuotaError,
  assertAgyClaudeBuildAllowed,
  detectAgyClaudeQuotaExhaustion,
  isAgyClaudeModel,
  normalizeAgyEffort,
  resolveAgyModel,
} from "./agy-claude.js";
import {
  buildAgentLaunchArgs,
  buildAgentLaunchStdin,
} from "./agent-launch-args.js";

describe("isAgyClaudeModel (the precious pool selector)", () => {
  it("matches the claude-opus-5-5 and claude-sonnet-5-5 families", () => {
    for (const model of [
      "claude-opus-5-5-high",
      "claude-opus-5-5-medium",
      "claude-opus-5-5-low",
      "claude-sonnet-5-5-high",
      "claude-sonnet-5-5-medium",
      "claude-sonnet-5-5-low",
    ]) {
      expect(isAgyClaudeModel(model)).toBe(true);
    }
  });

  it("matches any claude- provider token and nothing else", () => {
    expect(isAgyClaudeModel("claude-opus-4-8")).toBe(true);
    expect(isAgyClaudeModel("gemini-3.7-flash-high")).toBe(false);
    expect(isAgyClaudeModel("gpt-5.6-terra")).toBe(false);
    expect(isAgyClaudeModel("")).toBe(false);
  });
});

describe("normalizeAgyEffort (low|medium|high, max→high, xhigh refused)", () => {
  it.each(["opus", "sonnet"])("normalizes and validates %s model effort tokens", family => {
    const base = `claude-${family}-5-5`;
    expect(resolveAgyModel(base, "max")).toBe(`${base}-high`);
    expect(resolveAgyModel(`${base}-max`)).toBe(`${base}-high`);
    expect(() => resolveAgyModel(`${base}-xhigh`)).toThrow(AgyEffortError);
    expect(() => resolveAgyModel(`${base}-xhigh`, "low")).toThrow(AgyEffortError);
    expect(() => resolveAgyModel(`${base}-extreme`)).toThrow(AgyEffortError);
    expect(resolveAgyModel(base)).toBe(base);
    expect(resolveAgyModel("gemini-3.7-flash-high", "max")).toBe("gemini-3.7-flash-high");
  });
  it("prefers a later reset observation over a preliminary quota error", () => {
    const now = Date.parse("2026-10-17T14:55:00Z");
    const diagnostic = 'Error: 429 quota exceeded\nAGY_ERROR {"short_error":"RESOURCE_EXHAUSTED (code 429): Individual quota reached. Resets in 2h."}';
    expect(detectAgyClaudeQuotaExhaustion(diagnostic, now).resetsAt).toBe(new Date(now + 7_200_000).toISOString());
  });
  it.each(["low", "medium", "high"] as const)("passes %s through", (effort) => {
    expect(normalizeAgyEffort(effort)).toBe(effort);
  });

  it("maps max to high", () => {
    expect(normalizeAgyEffort("max")).toBe("high");
  });

  it("passes undefined through (the caller owns the default)", () => {
    expect(normalizeAgyEffort(undefined)).toBeUndefined();
  });

  it("refuses xhigh with a typed error", () => {
    let caught: unknown;
    try {
      normalizeAgyEffort("xhigh");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AgyEffortError);
    expect((caught as AgyEffortError).code).toBe("agy-effort-unsupported");
    expect(String((caught as Error).message)).toMatch(/low\|medium\|high/);
  });

  it("refuses unknown levels instead of passing them to the CLI", () => {
    expect(() => normalizeAgyEffort("extreme")).toThrow(/invalid AGY effort/);
  });
});

describe("detectAgyClaudeQuotaExhaustion (fail-closed pool signal)", () => {
  it.each([
    ["Error: 429 quota exceeded (claude pool)", "agy-claude:http-429"],
    ["API Error: quota exceeded for claude-opus-5-5-high", "agy-claude:quota-exceeded"],
    ["Error: RESOURCE_EXHAUSTED: claude quota", "agy-claude:resource-exhausted"],
    ["error: request failed with 429", "agy-claude:http-429"],
  ])("flags %s as exhausted", (line, signature) => {
    const verdict = detectAgyClaudeQuotaExhaustion(`some context\n${line}\nmore context`);
    expect(verdict.exhausted).toBe(true);
    expect(verdict.signature).toBe(signature);
  });

  it.each([
    "",
    "done in 12s",
    "Error: conversation not found",
    // Prose about quota with no provider-error shape must not trip the detector.
    "Here is how quota works: exceeding quota is billed per seat.",
    // A bare 429 with no error shape is not quota evidence.
    "the endpoint returns 429 sometimes",
    JSON.stringify({ event: "assistant", message: { content: "Error: 429 quota exceeded" } }),
  ])("does not flag %s", (line) => {
    expect(detectAgyClaudeQuotaExhaustion(line).exhausted).toBe(false);
  });

  it("builds a typed fail-closed error carrying no fallback", () => {
    const error = agyClaudeQuotaError("agy-claude:http-429", "Error: 429 quota exceeded");
    expect(error).toBeInstanceOf(AgyClaudeQuotaExhaustedError);
    expect(error.code).toBe(AGY_CLAUDE_QUOTA_CODE);
    expect(error.signature).toBe("agy-claude:http-429");
    expect(error.message).toMatch(/no fallback/i);
  });

  it("derives the absolute reset from the real AGY_ERROR without accepting retryable:true", () => {
    const now = Date.parse("2026-10-17T14:55:00Z");
    const line = 'AGY_ERROR {"short_error":"RESOURCE_EXHAUSTED (code 429): Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 156h32m24s.","status":"RESOURCE_EXHAUSTED","error_code":429,"code_kind":"http","retryable":true}';
    const detected = detectAgyClaudeQuotaExhaustion(line, now);
    expect(detected.resetsAt).toBe(new Date(now + (156 * 3600 + 32 * 60 + 24) * 1000).toISOString());
    const error = agyClaudeQuotaError(detected.signature!, line, now);
    expect(error.resetsAt).toBe(detected.resetsAt);
    expect(error.quota.resetsAt).toBe(detected.resetsAt);
    expect(error.retryable).toBe(false);
    expect(error.retrySafe).toBe(false);
  });
  it.each([80,160])("detects the real AGY_ERROR wrapped by a %i-column terminal", async cols => {
    const now=Date.parse("2026-10-17T14:55:00Z");
    const diagnostic='AGY_ERROR {"short_error":"RESOURCE_EXHAUSTED (code 429): Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 156h32m24s.","status":"RESOURCE_EXHAUSTED","error_code":429,"code_kind":"http","retryable":true}';
    const screen=await renderTerminalScreen(`AGY Claude\r\n${diagnostic}\r\n❯ `,cols);
    expect(screen).not.toContain(diagnostic);
    expect(detectAgyClaudeQuotaExhaustion(screen,now)).toEqual({exhausted:true,signature:"agy-claude:http-429",
      resetsAt:new Date(now+(156*3600+32*60+24)*1000).toISOString()});
  });
  it("does not complete a partial AGY_ERROR with another diagnostic or quoted model JSON", () => {
    const partial='AGY_ERROR {"short_error":"RESOURCE_EXHAUSTED (code 429): Resets in 2';
    expect(detectAgyClaudeQuotaExhaustion(partial).exhausted).toBe(false);
    const quoted=JSON.stringify({event:"assistant",message:{content:'h."}'}});
    expect(detectAgyClaudeQuotaExhaustion(`${partial}\n${quoted}`).exhausted).toBe(false);
    expect(detectAgyClaudeQuotaExhaustion(`${partial}\nError: 429 quota exceeded`).exhausted).toBe(true);
    expect(detectAgyClaudeQuotaExhaustion(`${partial}\nError: 429 quota exceeded`).resetsAt).toBeUndefined();
  });
});

describe("assertAgyClaudeBuildAllowed (bulk opt-in guard)", () => {
  it("refuses a build-role claude launch without the explicit flag", () => {
    let caught: unknown;
    try {
      assertAgyClaudeBuildAllowed({
        profile: "agy",
        model: "claude-opus-5-5-high",
        role: "build",
        allowClaudeBuild: false,
      });
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string }).code).toBe("agy-claude-build-requires-opt-in");
  });

  it("allows a build-role claude launch with the explicit flag", () => {
    expect(() =>
      assertAgyClaudeBuildAllowed({
        profile: "agy",
        model: "claude-sonnet-5-5-medium",
        role: "build",
        allowClaudeBuild: true,
      }),
    ).not.toThrow();
  });

  it("leaves review/challenge and non-claude use alone", () => {
    for (const args of [
      { profile: "agy", model: "claude-opus-5-5-high", role: "review" as const },
      { profile: "agy", model: "claude-opus-5-5-high", role: "challenge" as const },
      { profile: "agy", model: "claude-opus-5-5-high", role: undefined },
      { profile: "agy", model: "gemini-3.7-flash-high", role: "build" as const },
      { profile: "agy", model: undefined, role: "build" as const },
      { profile: "claude", model: "claude-opus-4-8", role: "build" as const },
    ]) {
      expect(() => assertAgyClaudeBuildAllowed(args)).not.toThrow();
    }
  });

  it("rejects an unknown role instead of guessing", () => {
    expect(() =>
      assertAgyClaudeBuildAllowed({ profile: "agy", role: "bulk" }),
    ).toThrow(/invalid agy run role/);
  });
});

describe("fake agy binary (argv/stdin contract, no real model call)", () => {
  const FAKE_AGY = `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const out = process.env.FAKE_AGY_OUT;
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { stdin += c; });
process.stdin.on("end", () => {
  writeFileSync(\`\${out}/argv.json\`, JSON.stringify(process.argv.slice(2)));
  writeFileSync(\`\${out}/stdin.txt\`, stdin);
  if (process.env.FAKE_AGY_QUOTA === "1") {
    process.stderr.write("Error: 429 quota exceeded (claude pool)\\n");
    process.exit(1);
  }
  process.exit(0);
});
`;

  function withFakeAgy(fn: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), "fake-agy-"));
    try {
      writeFileSync(join(dir, "agy"), FAKE_AGY, { mode: 0o755 });
      chmodSync(join(dir, "agy"), 0o755);
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  function spawnFakeAgy(
    dir: string,
    args: string[],
    input: string,
    quota: boolean,
  ): ReturnType<typeof spawnSync> {
    return spawnSync("agy", args, {
      cwd: dir,
      input,
      encoding: "utf8",
      env: {
        PATH: `${dir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        FAKE_AGY_OUT: dir,
        ...(quota ? { FAKE_AGY_QUOTA: "1" } : {}),
      },
      timeout: 30_000,
    });
  }

  it("headless: --model leads argv, prompt never in argv, prompt framed on stdin", () => {
    withFakeAgy((dir) => {
      const prompt = "Review the plan; $(touch /tmp/must-not-run)";
      const args = buildAgentLaunchArgs({
        profile: "agy",
        prompt,
        agent: "stp",
        model: "claude-opus-5-5-high",
        effort: "high",
        headless: true,
      });
      const input = buildAgentLaunchStdin({ profile: "agy", prompt, headless: true })!;
      const result = spawnFakeAgy(dir, args, input, false);
      expect(result.status).toBe(0);
      const seenArgv = JSON.parse(readFileSync(join(dir, "argv.json"), "utf8")) as string[];
      expect(seenArgv).toEqual(args);
      // The --model flag is applied at launch, ahead of any positional.
      const modelAt = seenArgv.indexOf("--model");
      expect(modelAt).toBeGreaterThanOrEqual(0);
      expect(seenArgv[modelAt + 1]).toBe("claude-opus-5-5-high");
      // The prompt never rides argv (the -p-swallows---model pitfall cannot hit:
      // there is no -p/--print token at all).
      expect(seenArgv).not.toContain("-p");
      expect(seenArgv.some((arg) => arg.includes("--print"))).toBe(false);
      for (const arg of seenArgv) {
        expect(arg).not.toContain(prompt);
      }
      // The prompt arrives on stdin as one framed JSON event line.
      const seenStdin = readFileSync(join(dir, "stdin.txt"), "utf8");
      expect(seenStdin.endsWith("\n")).toBe(true);
      expect(seenStdin.trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(seenStdin)).toEqual({
        event: "user",
        message: { content: prompt },
      });
    });
  });

  it("quota exhaustion surfaces on stderr/exit and classifies typed", () => {
    withFakeAgy((dir) => {
      const prompt = "challenge the plan";
      const args = buildAgentLaunchArgs({
        profile: "agy",
        prompt,
        model: "claude-sonnet-5-5-medium",
        headless: true,
      });
      const input = buildAgentLaunchStdin({ profile: "agy", prompt, headless: true })!;
      const result = spawnFakeAgy(dir, args, input, true);
      expect(result.status).not.toBe(0);
      const verdict = detectAgyClaudeQuotaExhaustion(String(result.stderr ?? ""));
      expect(verdict.exhausted).toBe(true);
      const error = agyClaudeQuotaError(verdict.signature!, String(result.stderr ?? ""));
      expect(error.code).toBe(AGY_CLAUDE_QUOTA_CODE);
    });
  });
});
