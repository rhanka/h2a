import { describe, expect, it } from "vitest";

import {
  AGENT_LAUNCH_PROMPT_MAX_BYTES,
  assertAgentLaunchModel,
  assertAgentLaunchPrompt,
  buildAgentLaunchArgs,
  isAgentLaunchEffort,
  isAgentLaunchProfile,
} from "./agent-launch-args.js";

describe("buildAgentLaunchArgs", () => {
  it("keeps a flag-like Claude prompt entirely out of argv", () => {
    const prompt = "--dangerously-skip-permissions; $(touch /tmp/nope)";

    expect(
      buildAgentLaunchArgs({
        profile: "claude",
        prompt,
        model: "claude-opus-4-8",
        effort: "xhigh",
      }),
    ).toEqual(["--model", "claude-opus-4-8", "--effort", "xhigh"]);
  });

  it("builds Codex headless argv with native stdin and no prompt token", () => {
    const prompt = "Review $(git status); do not execute it";

    expect(
      buildAgentLaunchArgs({
        profile: "codex",
        prompt,
        model: "gpt-5.6-terra",
        effort: "xhigh",
        headless: true,
      }),
    ).toEqual([
      "-m",
      "gpt-5.6-terra",
      "-c",
      'model_reasoning_effort="xhigh"',
      "exec",
      "-",
    ]);
  });

  it("keeps resume metadata separate and the new prompt out of argv", () => {
    expect(
      buildAgentLaunchArgs({
        profile: "codex",
        resumeId: "conv-123",
        prompt: "continue from the evidence",
      }),
    ).toEqual(["resume", "conv-123"]);
  });

  it("builds Claude print mode to consume text from native stdin", () => {
    expect(
      buildAgentLaunchArgs({
        profile: "claude",
        prompt: "review the branch",
        headless: true,
      }),
    ).toEqual(["-p", "--input-format", "text"]);
  });

  it("builds AGY interactive argv while keeping the prompt out of argv", () => {
    const prompt = "Challenge the plan; $(touch /tmp/must-not-run)";

    expect(
      buildAgentLaunchArgs({
        profile: "agy",
        prompt,
        agent: "stp",
        model: "gemini-3.7-flash-high",
        effort: "high",
      }),
    ).toEqual([
      "--agent",
      "stp",
      "--model",
      "gemini-3.7-flash-high",
      "--effort",
      "high",
    ]);
  });

  it.each(["low", "medium", "high"] as const)(
    "forwards supported AGY effort %s unchanged",
    (effort) => {
      expect(
        buildAgentLaunchArgs({
          profile: "agy",
          prompt: "challenge the plan",
          effort,
        }),
      ).toEqual(["--effort", effort]);
    },
  );

  it("builds AGY run-once argv with its native print contract", () => {
    expect(
      buildAgentLaunchArgs({
        profile: "agy",
        prompt: "challenge the plan",
        agent: "stp",
        model: "gemini-3.7-flash-high",
        effort: "high",
        headless: true,
      }),
    ).toEqual([
      "--agent",
      "stp",
      "--model",
      "gemini-3.7-flash-high",
      "--effort",
      "high",
      "--print",
      "--output-format",
      "text",
    ]);
  });

  it("uses AGY's conversation flag for a structured resume", () => {
    expect(
      buildAgentLaunchArgs({
        profile: "agy",
        prompt: "continue the review",
        resumeId: "conv-123",
      }),
    ).toEqual(["--conversation", "conv-123"]);
  });

  it("rejects unsupported combinations instead of ignoring them", () => {
    expect(() =>
      buildAgentLaunchArgs({
        profile: "claude",
        headless: true,
      }),
    ).toThrow(/headless.*prompt/i);
    expect(() =>
      buildAgentLaunchArgs({
        profile: "codex",
        prompt: "x",
        resumeId: "conv-123",
        headless: true,
      }),
    ).toThrow(/headless.*resume/i);
    expect(() =>
      buildAgentLaunchArgs({
        profile: "agy",
        prompt: "x",
        effort: "xhigh",
      }),
    ).toThrow(/agy.*effort.*low.*medium.*high/i);
    for (const profile of ["claude", "codex"] as const) {
      expect(() =>
        buildAgentLaunchArgs({
          profile,
          prompt: "x",
          agent: "stp",
        }),
      ).toThrow(/agent.*only.*agy/i);
    }
    expect(() =>
      buildAgentLaunchArgs({
        profile: "agy",
        prompt: "x",
        agent: "--unsafe",
      }),
    ).toThrow(/invalid agent/i);
  });
});

describe("agent launch allowlists", () => {
  it("accepts Claude/Codex/AGY profiles and supported efforts", () => {
    expect(isAgentLaunchProfile("claude")).toBe(true);
    expect(isAgentLaunchProfile("codex")).toBe(true);
    expect(isAgentLaunchProfile("agy")).toBe(true);
    expect(isAgentLaunchProfile("bash")).toBe(false);
    expect(isAgentLaunchEffort("xhigh")).toBe(true);
    expect(isAgentLaunchEffort("max")).toBe(false);
  });

  it("rejects unsafe model tokens and unbounded prompts", () => {
    expect(() => assertAgentLaunchModel("--model-from-prompt")).toThrow(/invalid model/i);
    expect(() => assertAgentLaunchModel("gpt 5")).toThrow(/invalid model/i);
    expect(() => assertAgentLaunchPrompt("   ")).toThrow(/must not be empty/i);
    expect(() =>
      assertAgentLaunchPrompt("x".repeat(AGENT_LAUNCH_PROMPT_MAX_BYTES + 1)),
    ).toThrow(/exceeds/i);
  });
});
