/**
 * `remote relaunch` — bring back local tmux sessions whose CLI has dropped to a
 * shell (in situ, keeping the windows), each resuming ITS OWN conversation.
 *
 * Why a dedicated command: closing the terminal windows does NOT kill the tmux
 * sessions, and `remote restore` goes through `remote run -r`, which the
 * single-writer guard refuses while the (idle) session still holds the
 * conversation. This relaunches the CLI inside the existing session — no
 * `remote run`, no guard fight — and crucially resumes each session's OWN
 * convId (from the registry), never "most recent", so the N sessions that share
 * a cwd never collide on one .jsonl.
 */

import { isCliProfile, resolveProfile, resumeArgsFor } from "./profiles.js";
import {
  cpuRateMsPerSecond,
  DEFAULT_WORKING_CPU_MS_PER_SECOND,
} from "./session-lease.js";

export type ResumeLaunch = {
  command: string;
  args: string[];
  display: string;
};

export type RelaunchSafety = {
  /** True only when the shell has no live CLI worker descendant. */
  dead: boolean;
  /** A live worker is present, whether parked or actively working. Never kill it. */
  activatable: boolean;
  /** Missing or changing evidence is never permission to kill. */
  indeterminate: boolean;
  /** The hard floor: true while a live worker crosses the CPU threshold. */
  activelyWorking: boolean;
  reason: string;
  rateMsPerSecond?: number;
  /** Present only for a proven-dead pane that can be compare-and-swapped before kill. */
  identity?: RelaunchKillIdentity;
};

/** The tmux pane generation observed while proving a session has no worker. */
export type RelaunchKillIdentity = {
  pane: string;
  panePid: number;
};

export type RelaunchSafetySample = {
  pane?: string | undefined;
  paneCommand?: string | undefined;
  panePid?: number | undefined;
  firstWorkerPid?: number | undefined;
  secondWorkerPid?: number | undefined;
  firstCpuMs?: number | undefined;
  secondCpuMs?: number | undefined;
  elapsedMs?: number | undefined;
};

const SHELL_COMMANDS = new Set(["bash", "sh"]);

/**
 * Pure relaunch liveness projection.
 *
 * The relaunch path must never turn missing evidence into permission to kill.
 * A complete pair of observations is required: the pane must be a wrapper
 * shell, both observations must resolve the same worker/root, and CPU must
 * produce a non-negative rate. Anything else is indeterminate and therefore
 * receives the hard working floor.
 */
export function decideRelaunchSafety(
  sample: RelaunchSafetySample,
): RelaunchSafety {
  if (!SHELL_COMMANDS.has(sample.paneCommand ?? "")) {
    return {
      dead: false,
      activatable: false,
      indeterminate: true,
      activelyWorking: true,
      reason: "liveness indeterminate: pane command is not a readable shell",
    };
  }
  if (
    typeof sample.panePid !== "number" ||
    !Number.isInteger(sample.panePid) ||
    sample.panePid <= 0 ||
    typeof sample.firstWorkerPid !== "number" ||
    !Number.isInteger(sample.firstWorkerPid) ||
    typeof sample.secondWorkerPid !== "number" ||
    !Number.isInteger(sample.secondWorkerPid) ||
    typeof sample.firstCpuMs !== "number" ||
    !Number.isFinite(sample.firstCpuMs) ||
    typeof sample.secondCpuMs !== "number" ||
    !Number.isFinite(sample.secondCpuMs) ||
    typeof sample.elapsedMs !== "number" ||
    !Number.isFinite(sample.elapsedMs) ||
    sample.elapsedMs <= 0
  ) {
    return {
      dead: false,
      activatable: false,
      indeterminate: true,
      activelyWorking: true,
      reason: "liveness indeterminate: pane, worker, or CPU sample unreadable",
    };
  }

  // A worker disappearing, appearing, or changing identity during the sample
  // is not evidence of idleness. The safe outcome is to leave the session.
  if (sample.firstWorkerPid !== sample.secondWorkerPid) {
    return {
      dead: false,
      activatable: false,
      indeterminate: true,
      activelyWorking: true,
      reason: "liveness indeterminate: worker identity changed during sample",
    };
  }

  // busiestDescendant returns the pane root when the wrapper has no live
  // descendant. This is the only shape that proves a dead shell.
  if (sample.firstWorkerPid === sample.panePid) {
    const identity =
      typeof sample.pane === "string" && sample.pane.length > 0
        ? { pane: sample.pane, panePid: sample.panePid }
        : undefined;
    return {
      dead: true,
      activatable: false,
      indeterminate: false,
      activelyWorking: false,
      reason: "no live CLI worker descendant",
      ...(identity ? { identity } : {}),
    };
  }

  const rateMsPerSecond = cpuRateMsPerSecond(
    {
      sample: {
        cpuMs: sample.firstCpuMs,
        sampledAt: new Date(0).toISOString(),
      },
    },
    sample.secondCpuMs,
    new Date(sample.elapsedMs).toISOString(),
  );
  if (rateMsPerSecond === undefined) {
    return {
      dead: false,
      activatable: false,
      indeterminate: true,
      activelyWorking: true,
      reason: "liveness indeterminate: CPU rate could not be computed",
    };
  }
  if (rateMsPerSecond >= DEFAULT_WORKING_CPU_MS_PER_SECOND) {
    return {
      dead: false,
      activatable: true,
      indeterminate: false,
      activelyWorking: true,
      rateMsPerSecond,
      reason: "live working CLI — never killed (even with --force)",
    };
  }
  return {
    dead: false,
    activatable: true,
    indeterminate: false,
    activelyWorking: false,
    rateMsPerSecond,
    reason: "live parked CLI worker is activatable — never force-killed",
  };
}

/** Structured argv for resuming a conversation, safe to hand to a new tmux session. */
export function resumeLaunchFor(
  profile: string,
  convId: string,
): ResumeLaunch | undefined {
  if (!isCliProfile(profile)) return undefined;
  const cfg = resolveProfile(profile);
  const args = resumeArgsFor(cfg, convId);
  if (args.length === 0) return undefined;
  return {
    command: cfg.command,
    args,
    display: [cfg.command, ...args].join(" "),
  };
}

/** The shell command that resumes `convId` for `profile`, or undefined if the */
/** profile has no resume form (e.g. shell). */
export function resumeCommandFor(
  profile: string,
  convId: string,
): string | undefined {
  return resumeLaunchFor(profile, convId)?.display;
}

export type RelaunchCandidate = {
  /** short name, e.g. `sentropic#2` */
  slug: string;
  /** full tmux session name, e.g. `h2a-sentropic#2` */
  name: string;
  profile: string;
  /** True only when the shell has no live CLI worker descendant. */
  dead: boolean;
  /** A live worker exists and can be woken, but must never be force-killed. */
  activatable: boolean;
  /** Missing or ambiguous liveness evidence; fail closed toward alive. */
  indeterminate: boolean;
  /** Hard safety floor while a worker is actively using CPU. */
  activelyWorking: boolean;
  /** Diagnostic reason for the hard floor or liveness projection. */
  livenessReason?: string;
  /** this session's own conversation id, from the registry */
  convId?: string;
  /** why its registry row cannot safely produce a resume conversation */
  unresumableReason?: string;
};

export type RelaunchAction = {
  slug: string;
  name: string;
  profile: string;
  convId: string;
  /** the command to run in the session (e.g. `claude --resume <id>`) */
  cmd: string;
  /** structured launch command, never execute `cmd` as a shell string */
  command: string;
  args: string[];
};

export type RelaunchSkip = { slug: string; reason: string };

export type RelaunchPlan = {
  actions: RelaunchAction[];
  skipped: RelaunchSkip[];
};

export type PlanRelaunchOptions = {
  /** A forced restart kill/recreates an eligible dead session. */
  force?: boolean;
  /** Bulk operations must leave human-facing agent CLIs alone unless opted in. */
  excludeInteractiveAgents?: boolean;
};

export function isInteractiveAgentProfile(profile: string): boolean {
  return ["claude", "claude-code", "codex", "agy", "antigravity"].includes(
    profile,
  );
}

/**
 * A kill is permitted only after proving that the shell has no live worker.
 * Every other state, including a parked worker or incomplete evidence, is
 * preserved as alive.
 */
export function isRelaunchKillable(
  safety: Pick<
    RelaunchSafety,
    "dead" | "activatable" | "indeterminate" | "activelyWorking"
  >,
): boolean {
  return (
    safety.dead &&
    !safety.activatable &&
    safety.activelyWorking === false &&
    safety.indeterminate === false
  );
}

/**
 * Decide what to relaunch. Pure: takes fully-resolved liveness candidates +
 * convId already gathered, so it is unit-testable without tmux/registry I/O.
 * Skips every live or indeterminate session, sessions with no known
 * convId (relaunch by hand rather than guess and risk a collision), and
 * profiles with no resume form. Also refuses to point two sessions at the SAME
 * convId (defensive: the registry should already be 1:1).
 */
export function planRelaunch(
  candidates: ReadonlyArray<RelaunchCandidate>,
  options: PlanRelaunchOptions = {},
): RelaunchPlan {
  const actions: RelaunchAction[] = [];
  const skipped: RelaunchSkip[] = [];
  const claimed = new Map<string, string>(); // convId -> slug that took it
  const namesBySlug = new Map<string, string[]>();
  for (const candidate of candidates) {
    const names = namesBySlug.get(candidate.slug) ?? [];
    names.push(candidate.name);
    namesBySlug.set(candidate.slug, names);
  }
  for (const c of candidates) {
    const sameSlug = namesBySlug.get(c.slug) ?? [];
    if (sameSlug.length > 1) {
      skipped.push({
        slug: c.slug,
        reason:
          `tmux slug is ambiguous (${sameSlug.sort().join(", ")}) — ` +
          "relaunch each exact session manually",
      });
      continue;
    }
    if (options.excludeInteractiveAgents && isInteractiveAgentProfile(c.profile)) {
      skipped.push({
        slug: c.slug,
        reason: `interactive agent CLI (${c.profile}) excluded by default; pass --include-agents`,
      });
      continue;
    }
    if (!isRelaunchKillable(c)) {
      skipped.push({
        slug: c.slug,
        reason:
          c.livenessReason ??
          (c.activatable
            ? "live worker is activatable — never force-killed"
            : "liveness is not proven dead — left alone (never kill on unknown)"),
      });
      continue;
    }
    if (!c.convId) {
      skipped.push({
        slug: c.slug,
        reason:
          c.unresumableReason ??
          "no convId in the registry — relaunch manually",
      });
      continue;
    }
    const prior = claimed.get(c.convId);
    if (prior) {
      skipped.push({
        slug: c.slug,
        reason: `conversation ${c.convId} already taken by ${prior} — would collide`,
      });
      continue;
    }
    const launch = resumeLaunchFor(c.profile, c.convId);
    if (!launch) {
      skipped.push({
        slug: c.slug,
        reason: `profile "${c.profile}" has no resume form`,
      });
      continue;
    }
    claimed.set(c.convId, c.slug);
    actions.push({
      slug: c.slug,
      name: c.name,
      profile: c.profile,
      convId: c.convId,
      cmd: launch.display,
      command: launch.command,
      args: launch.args,
    });
  }
  return { actions, skipped };
}
