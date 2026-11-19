/**
 * Pure profile/model override & role-mapping logic for `h2a restore --profile`.
 *
 * Kept free of live host readers so both `restore.ts` and `launch-layout.ts`
 * can import it without breaking the F3 module-boundary invariant.
 *
 * Role-based AGY model mapping rule (when `--profile agy` is used WITHOUT an
 * explicit `--model` override):
 *   1. Tokenize `[role, label]` on non-alphanumeric boundaries (lowercased).
 *   2. If any token matches a build/conductor marker
 *      (`cond`, `conductor`, `build`, `builder`, `impl`, `infra`, `ops`),
 *      map to `gemini-4-neon-high` (build/conductor wins even when paired with
 *      a design repo/label such as `design-cond` or `ds-build`).
 *   3. Else if any token matches a design marker
 *      (`design`, `designer`, `ux`, `ui`, `ds`, `arch`, `archi`, `architect`,
 *      `architecture`, `spec`, `specs`, `figma`),
 *      map to `gemini-4-carbon`.
 *   4. Else default to `gemini-4-neon-high`.
 *   5. An explicit `--model <id>` always overrides the role rule for every
 *      rewritten/targeted session.
 *
 * Cross-profile carryover & loss contract (claude/codex -> agy):
 *   - Preserved: terminal layout slot (window + tab position), PTY/session
 *     name (`--name <label>`), workspace directory (`cwd`, giving AGY access to
 *     `AGENTS.md`, `CLAUDE.md`, `BRANCH.md`, `.track/`, and git state), local
 *     host pin (`local-native` / `local-tmux`), and an optional runtime handoff
 *     note under `runDir()` when a recorded brief (`task`) or local Claude
 *     transcript exists on disk.
 *   - Preserved for already-AGY sessions: native AGY conversation id
 *     (`--resume <sid>` -> `agy --conversation <sid>`).
 *   - Lost on cross-profile rewrite: Claude Code conversation history
 *     (`.claude/projects/.../<sid>.jsonl`) and Codex rollout history
 *     (`.codex/sessions/.../rollout-*.jsonl`) CANNOT be resumed by `agy`.
 *     Rewritten sessions start a fresh AGY conversation. Claude-only pins
 *     (`--gw`/`--llm-gateway`, `--bare`/`--no-bare`) are stripped because AGY
 *     runs direct.
 */

import { join } from "node:path";

import {
  AGENT_LAUNCH_PROFILES,
  assertAgentLaunchModel,
  isAgentLaunchProfile,
  type AgentLaunchProfile,
} from "./agent-launch-args.js";
import {
  GEMINI_4_CARBON_MODEL,
  GEMINI_4_NEON_HIGH_MODEL,
  resolveAgyModel,
  resolveLaunchModelAlias,
} from "./agy-claude.js";
import { encodeCwd } from "./convsync.js";
import { coerceCliProfileName } from "./profiles.js";

export const AGY_RESTORE_DEFAULT_MODEL = GEMINI_4_NEON_HIGH_MODEL;
export const AGY_RESTORE_DESIGN_MODEL = GEMINI_4_CARBON_MODEL;

/** Source tools rewritten when `h2a restore --profile <target>` is passed. */
export const RESTORE_REWRITE_SOURCE_TOOLS: ReadonlySet<string> = new Set([
  "claude",
  "codex",
]);

export const RESTORE_BUILD_CONDUCTOR_TOKENS: ReadonlySet<string> = new Set([
  "cond",
  "conductor",
  "build",
  "builder",
  "impl",
  "infra",
  "ops",
]);

export const RESTORE_DESIGN_TOKENS: ReadonlySet<string> = new Set([
  "design",
  "designer",
  "ux",
  "ui",
  "ds",
  "arch",
  "archi",
  "architect",
  "architecture",
  "spec",
  "specs",
  "figma",
]);

export type RestoreModelRole =
  | "explicit"
  | "build-conductor"
  | "design"
  | "default"
  | "preserved";

export type RestoreTabRewrite = {
  readonly fromTool: string;
  readonly fromModel?: string;
  readonly toTool: string;
  readonly toModel?: string;
  readonly modelRole: RestoreModelRole;
  readonly crossProfile: boolean;
  /** Foreign conversation id dropped because the target CLI cannot resume it. */
  readonly droppedSid?: string;
  /** Existing local transcript path for manual reference in the handoff file. */
  readonly priorTranscriptPath?: string;
  /** Whether the source entry carried a recorded brief/task. */
  readonly hasBrief?: boolean;
};

export type TabLiveHostState =
  | { readonly state: "absent" }
  | { readonly state: "unknown" }
  | {
      readonly state: "live-attached" | "live-detached";
      readonly exactName: string;
      readonly hostLabel: string;
    };

export function isRestoreRewriteSourceTool(tool: string | undefined): boolean {
  return tool !== undefined && RESTORE_REWRITE_SOURCE_TOOLS.has(tool);
}

/** Validate and coerce `--profile <value>` for `h2a restore`. */
export function resolveRestoreProfileInput(raw: string): AgentLaunchProfile {
  const trimmed = raw.trim().toLowerCase();
  const coerced = coerceCliProfileName(trimmed);
  if (coerced !== undefined && isAgentLaunchProfile(coerced)) {
    return coerced;
  }
  throw new Error(
    `invalid --profile "${raw}" (expected: ${AGENT_LAUNCH_PROFILES.join(", ")})`,
  );
}

/** Validate and normalize `--model <value>` for `h2a restore`. */
export function resolveRestoreModelInput(
  raw: string,
  profile?: AgentLaunchProfile,
): string {
  const trimmed = raw.trim();
  assertAgentLaunchModel(trimmed);
  if (profile === "agy") {
    return resolveAgyModel(trimmed) ?? trimmed;
  }
  return resolveLaunchModelAlias(trimmed) ?? trimmed;
}

function roleTokens(label: string, role?: string): string[] {
  const parts: string[] = [];
  for (const input of [role, label]) {
    if (!input) continue;
    for (const token of input.toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length > 0) parts.push(token);
    }
  }
  return parts;
}

/**
 * Resolve the target AGY model for a restored session.
 *
 * Precedence:
 *   1. Explicit `--model` override.
 *   2. Build/conductor token in `role` or `label` -> `gemini-4-neon-high`.
 *   3. Design token in `role` or `label` -> `gemini-4-carbon`.
 *   4. Fallback default -> `gemini-4-neon-high`.
 */
export function resolveRestoreAgyModel(input: {
  label: string;
  role?: string | undefined;
  explicitModel?: string | undefined;
}): { model: string; role: RestoreModelRole } {
  if (input.explicitModel !== undefined) {
    const normalized =
      resolveAgyModel(input.explicitModel) ?? input.explicitModel;
    return { model: normalized, role: "explicit" };
  }
  const tokens = roleTokens(input.label, input.role);
  if (tokens.some((t) => RESTORE_BUILD_CONDUCTOR_TOKENS.has(t))) {
    return { model: AGY_RESTORE_DEFAULT_MODEL, role: "build-conductor" };
  }
  if (tokens.some((t) => RESTORE_DESIGN_TOKENS.has(t))) {
    return { model: AGY_RESTORE_DESIGN_MODEL, role: "design" };
  }
  return { model: AGY_RESTORE_DEFAULT_MODEL, role: "default" };
}

/** Canonical on-disk Claude transcript path for a workspace + conversation id. */
export function claudeTranscriptPath(
  home: string,
  cwd: string,
  sid: string,
): string {
  return join(home, ".claude", "projects", encodeCwd(cwd), `${sid}.jsonl`);
}

function formatModelRoleTag(role: RestoreModelRole): string {
  switch (role) {
    case "build-conductor":
      return "role: build/conductor";
    case "design":
      return "role: design";
    case "explicit":
      return "explicit --model";
    case "preserved":
      return "preserved";
    case "default":
      return "role: default";
  }
}

/**
 * Format one per-session plan entry for `h2a restore --profile ... --dry-run`
 * (and launch logging), showing `old profile/model -> new profile/model`,
 * live-vs-relaunch status, carryover/loss details, and the resolved tab command.
 */
export function formatRestoreRewritePlanLines(input: {
  label: string;
  cwd: string;
  remoteId?: string | undefined;
  tool?: string | undefined;
  model?: string | undefined;
  sid?: string | undefined;
  origin?: "registry" | "scan" | undefined;
  rewrite?: RestoreTabRewrite | undefined;
  liveState: TabLiveHostState;
  command: string;
  skippedLive?: boolean | undefined;
}): string[] {
  if (input.remoteId) {
    return [
      `    - ${input.label}  SCW:${input.remoteId} (unchanged)  ${input.cwd}\n`,
      `      cmd: ${input.command}\n`,
    ];
  }
  const rw = input.rewrite;
  const fromSpec = rw
    ? `${rw.fromTool} (${rw.fromModel ?? "default"})`
    : `${input.tool ?? "shell"} (${input.model ?? "default"})`;
  const toSpec = rw
    ? `${rw.toTool} (${rw.toModel ?? "default"}, ${formatModelRoleTag(rw.modelRole)})`
    : fromSpec;
  const transition = rw ? `${fromSpec} -> ${toSpec}` : fromSpec;

  let status: string;
  if (input.liveState.state === "live-attached") {
    status =
      `LIVE on ${input.liveState.hostLabel} (controlled) — skipped; ` +
      `stop first (\`h2a stop ${input.label} --reason restart\`) to relaunch as ${rw?.toTool ?? input.tool}`;
  } else if (input.liveState.state === "live-detached") {
    status =
      `LIVE on ${input.liveState.hostLabel} — attach only; ` +
      `stop first (\`h2a stop ${input.label} --reason restart\`) to relaunch as ${rw?.toTool ?? input.tool}`;
  } else if (input.liveState.state === "unknown") {
    status = "host state UNKNOWN — fail closed (not relaunched)";
  } else if (rw?.crossProfile) {
    const loss = rw.droppedSid
      ? `${rw.fromTool} conv ${rw.droppedSid} lost (not resumable by ${rw.toTool})`
      : `no ${rw.fromTool} conv to resume`;
    const extras: string[] = [];
    if (rw.hasBrief) extras.push("brief -> handoff");
    if (rw.priorTranscriptPath) extras.push(`transcript ref: ${rw.priorTranscriptPath}`);
    const extraStr = extras.length > 0 ? `; ${extras.join("; ")}` : "";
    status = `relaunch, fresh ${rw.toTool}; ${loss}${extraStr}`;
  } else if (input.sid) {
    status = `relaunch, resume ${input.tool ?? "session"} conv ${input.sid}`;
  } else {
    status = `relaunch, fresh ${input.tool ?? "session"}`;
  }

  const lines = [
    `    - ${input.label}  ${transition}  [${status}]  ${input.cwd}\n`,
  ];
  if (input.skippedLive) {
    lines.push(
      `      cmd: (skipped — already visible/controlled; stop first with \`h2a stop ${input.label} --reason restart\`)\n`,
    );
  } else if (input.liveState.state === "unknown") {
    lines.push(`      cmd: (refused — host state unknown)\n`);
  } else {
    lines.push(`      cmd: ${input.command}\n`);
  }
  return lines;
}

/**
 * Build the non-destructive runtime handoff note written under `runDir()` when
 * a cross-profile restore carries over a brief or prior transcript reference.
 */
export function buildRestoreHandoffMarkdown(input: {
  label: string;
  cwd: string;
  rewrite: RestoreTabRewrite;
  task?: string | undefined;
}): string {
  const lines = [
    `# Restore Handoff — ${input.label}`,
    "",
    `- Workspace: \`${input.cwd}\``,
    `- Transition: \`${input.rewrite.fromTool}\` (${input.rewrite.fromModel ?? "default"}) -> \`${input.rewrite.toTool}\` (${input.rewrite.toModel ?? "default"}, ${formatModelRoleTag(input.rewrite.modelRole)})`,
    `- History note: ${input.rewrite.fromTool} conversation history cannot be resumed directly by \`${input.rewrite.toTool}\`; this is a fresh \`${input.rewrite.toTool}\` session in the same workspace and PTY slot.`,
  ];
  if (input.rewrite.droppedSid) {
    lines.push(`- Prior ${input.rewrite.fromTool} conversation ID: \`${input.rewrite.droppedSid}\``);
  }
  if (input.rewrite.priorTranscriptPath) {
    lines.push(`- Prior local transcript (read-only reference): \`${input.rewrite.priorTranscriptPath}\``);
  }
  if (input.task) {
    lines.push("", "## Carried Brief / Task", "", input.task);
  }
  lines.push("");
  return lines.join("\n");
}
