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

export type ResumeLaunch = {
  command: string;
  args: string[];
  display: string;
};

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
  /** true when the pane is an idle shell (CLI gone) — only these are relaunched */
  idle: boolean;
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
  /** A forced restart may replace a CLI that is still running. */
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
 * Decide what to relaunch. Pure: takes fully-resolved candidates (idle flag +
 * convId already gathered) so it is unit-testable without tmux/registry I/O.
 * Skips running sessions (never disturb a live CLI), sessions with no known
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
    if (!options.force && !c.idle) {
      skipped.push({ slug: c.slug, reason: "CLI is running — left alone" });
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
