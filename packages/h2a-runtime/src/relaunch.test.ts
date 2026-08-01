import { describe, expect, it } from "vitest";

import {
  decideRelaunchSafety,
  planRelaunch,
  resumeCommandFor,
} from "./relaunch.js";

describe("resumeCommandFor", () => {
  it("uses --resume for claude/agy and the resume subcommand for codex", () => {
    expect(resumeCommandFor("claude", "c1")).toBe("claude --resume c1");
    expect(resumeCommandFor("agy", "c1")).toBe("agy --resume c1");
    expect(resumeCommandFor("codex", "r1")).toBe("codex resume r1");
  });
  it("returns undefined for a profile with no resume form", () => {
    expect(resumeCommandFor("shell", "x")).toBeUndefined();
    expect(resumeCommandFor("not-a-profile", "x")).toBeUndefined();
  });
});

describe("planRelaunch", () => {
  const idleClaude = (slug: string, convId?: string) => ({
    slug,
    name: `remote-${slug}`,
    profile: "claude",
    idle: true,
    activelyWorking: false,
    ...(convId ? { convId } : {}),
  });

  it("plans idle sessions with a known convId, each its own command", () => {
    const plan = planRelaunch([
      idleClaude("sentropic", "c-a"),
      idleClaude("sentropic#2", "c-b"),
      { ...idleClaude("dataviz", "r-1"), profile: "codex" },
    ]);
    expect(plan.actions.map((a) => a.cmd)).toEqual([
      "claude --resume c-a",
      "claude --resume c-b",
      "codex resume r-1",
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("leaves running sessions alone", () => {
    const plan = planRelaunch([
      { ...idleClaude("live", "c-x"), idle: false },
    ]);
    expect(plan.actions).toEqual([]);
    expect(plan.skipped[0]?.reason).toMatch(/running/);
  });

  it("never force-relaunches an actively working worker", () => {
    const plan = planRelaunch(
      [
        {
          ...idleClaude("working", "c-working"),
          idle: true, // the flaky child-count path said idle
          activelyWorking: true,
          livenessReason:
            "live working CLI — never killed (even with --force)",
        },
      ],
      { force: true },
    );

    expect(plan.actions).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain("never killed");
  });

  it("treats an indeterminate CPU probe as actively working", () => {
    const plan = planRelaunch(
      [
        {
          ...idleClaude("unknown", "c-unknown"),
          idle: false,
          activelyWorking: true,
          livenessReason:
            "liveness indeterminate: CPU rate could not be computed",
        },
      ],
      { force: true },
    );

    expect(plan.actions).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain("indeterminate");
  });

  it("classifies dead, parked, and working workers from the short CPU sample", () => {
    expect(
      decideRelaunchSafety({
        paneCommand: "bash",
        panePid: 10,
        firstWorkerPid: 10,
        secondWorkerPid: 10,
        firstCpuMs: 100,
        secondCpuMs: 100,
        elapsedMs: 250,
      }),
    ).toMatchObject({ idle: true, activelyWorking: false });
    expect(
      decideRelaunchSafety({
        paneCommand: "bash",
        panePid: 10,
        firstWorkerPid: 20,
        secondWorkerPid: 20,
        firstCpuMs: 100,
        secondCpuMs: 110,
        elapsedMs: 250,
      }),
    ).toMatchObject({ idle: true, activelyWorking: false, rateMsPerSecond: 40 });
    expect(
      decideRelaunchSafety({
        paneCommand: "bash",
        panePid: 10,
        firstWorkerPid: 20,
        secondWorkerPid: 20,
        firstCpuMs: 100,
        secondCpuMs: 120,
        elapsedMs: 250,
      }),
    ).toMatchObject({ idle: false, activelyWorking: true, rateMsPerSecond: 80 });
    expect(
      decideRelaunchSafety({
        paneCommand: "bash",
        panePid: 10,
        firstWorkerPid: 20,
        secondWorkerPid: 20,
        firstCpuMs: undefined,
        secondCpuMs: 120,
        elapsedMs: 250,
      }),
    ).toMatchObject({ idle: false, activelyWorking: true });
  });

  it("skips sessions with no convId rather than guessing", () => {
    const plan = planRelaunch([idleClaude("opendb")]);
    expect(plan.actions).toEqual([]);
    expect(plan.skipped[0]?.reason).toMatch(/no convId/);
  });

  it("refuses to point two sessions at the SAME conversation", () => {
    const plan = planRelaunch([
      idleClaude("a", "dup"),
      idleClaude("b", "dup"),
    ]);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]?.slug).toBe("a");
    expect(plan.skipped[0]?.reason).toMatch(/collide/);
  });

  it("refuses a dual-prefix tmux collision before assigning either conversation", () => {
    const plan = planRelaunch([
      { ...idleClaude("proj", "canonical"), name: "h2a-proj" },
      { ...idleClaude("proj", "legacy"), name: "remote-proj" },
    ]);

    expect(plan.actions).toEqual([]);
    expect(plan.skipped).toHaveLength(2);
    expect(plan.skipped[0]?.reason).toContain("h2a-proj");
    expect(plan.skipped[0]?.reason).toContain("remote-proj");
  });
});
