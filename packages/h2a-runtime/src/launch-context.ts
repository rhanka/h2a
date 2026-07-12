/**
 * launch-context — record WHICH launch options produced a managed local tmux session,
 * so `h2a ls`/inspect can surface gateway on/off, the active model mapping, the h2a
 * side-window command and the relaunch line WITHOUT the user remembering raw tmux
 * `show-options`. Spec: docs/specs/2026-07-11-tmux-launch-context-and-gateway-model-mappings.md
 *
 * This module is PURE and testable: it builds the diagnostic key/value set and formats it.
 * The tmux side effects (set-option/show-options) live in tmux.ts. It NEVER records a secret —
 * it reads only ANTHROPIC_BASE_URL (a URL) and the PRESENCE of OPENAI_MODEL_MAP (a flag, not its
 * content); tokens/api-keys are never read or stored, and free strings are redaction-scrubbed.
 */

/** Managed-session option prefix; kept distinct from @remote_agent_* / @display_name. */
export const LAUNCH_OPTION_PREFIX = "@remote_launch_";

export interface LaunchContextInput {
  profile: string;
  cwd: string;
  label?: string | undefined;
  /** CLI-native resume argv (e.g. ["--resume", id] / ["resume", id]); only the id is kept. */
  resumeArgs?: ReadonlyArray<string> | undefined;
  /** h2a side-window command line, if one was requested. */
  h2aCommand?: string | undefined;
}

export interface LaunchContext {
  profile: string;
  cwd: string;
  label?: string;
  /** the resume conversation id (ids are safe; never a secret). */
  resume?: string;
  gateway: "on" | "off";
  /** only surfaced when local/non-secret (localhost / 127.0.0.1). */
  gatewayBaseUrl?: string;
  /** summary of the active model-map source, e.g. "env:OPENAI_MODEL_MAP" or "catalog-default". */
  modelMap: string;
  h2a?: string;
}

const SECRET_RE =
  /(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]+|eyJ[A-Za-z0-9._-]{10,}|[A-Za-z0-9_-]{32,})/g;

/** Defence-in-depth: scrub anything token-shaped from a free string before it is stored. */
export function redactSecrets(s: string): string {
  return s.replace(SECRET_RE, "«redacted»");
}

function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url);
}

/**
 * Build the diagnostic launch context from the launcher inputs + the environment. Pure: pass
 * `env` for tests. Reads ONLY ANTHROPIC_BASE_URL + the presence of OPENAI_MODEL_MAP — never a
 * token/api-key.
 */
export function buildLaunchContext(
  input: LaunchContextInput,
  env: NodeJS.ProcessEnv = process.env,
): LaunchContext {
  const base = (env.ANTHROPIC_BASE_URL ?? "").trim();
  const ctx: LaunchContext = {
    profile: input.profile,
    cwd: input.cwd,
    gateway: base ? "on" : "off",
    modelMap: env.OPENAI_MODEL_MAP?.trim() ? "env:OPENAI_MODEL_MAP" : "catalog-default",
  };
  if (input.label && input.label.trim()) ctx.label = input.label.trim();
  if (base && isLocalUrl(base)) ctx.gatewayBaseUrl = base;
  const resumeArgs = input.resumeArgs ?? [];
  if (resumeArgs.length > 0) {
    const id = resumeArgs[resumeArgs.length - 1];
    if (id && id !== resumeArgs[0]) ctx.resume = redactSecrets(id);
  }
  if (input.h2aCommand && input.h2aCommand.trim()) {
    ctx.h2a = redactSecrets(input.h2aCommand.trim());
  }
  return ctx;
}

/** The tmux `set-option` key/value pairs for a launch context (undefined fields omitted). */
export function launchContextOptions(ctx: LaunchContext): Array<[string, string]> {
  const out: Array<[string, string]> = [
    [`${LAUNCH_OPTION_PREFIX}profile`, ctx.profile],
    [`${LAUNCH_OPTION_PREFIX}cwd`, ctx.cwd],
    [`${LAUNCH_OPTION_PREFIX}gateway`, ctx.gateway],
    [`${LAUNCH_OPTION_PREFIX}model_map`, ctx.modelMap],
  ];
  if (ctx.label) out.push([`${LAUNCH_OPTION_PREFIX}label`, ctx.label]);
  if (ctx.resume) out.push([`${LAUNCH_OPTION_PREFIX}resume`, ctx.resume]);
  if (ctx.gatewayBaseUrl) out.push([`${LAUNCH_OPTION_PREFIX}gateway_base_url`, ctx.gatewayBaseUrl]);
  if (ctx.h2a) out.push([`${LAUNCH_OPTION_PREFIX}h2a`, ctx.h2a]);
  return out;
}

/** Reconstruct a launch context from a tmux option reader (`show-options -qv`). */
export function parseLaunchContext(
  readOption: (key: string) => string | undefined,
): LaunchContext | undefined {
  const profile = readOption(`${LAUNCH_OPTION_PREFIX}profile`);
  const cwd = readOption(`${LAUNCH_OPTION_PREFIX}cwd`);
  if (!profile || !cwd) return undefined; // no launch context recorded on this session
  const gatewayRaw = readOption(`${LAUNCH_OPTION_PREFIX}gateway`);
  const ctx: LaunchContext = {
    profile,
    cwd,
    gateway: gatewayRaw === "on" ? "on" : "off",
    modelMap: readOption(`${LAUNCH_OPTION_PREFIX}model_map`) ?? "catalog-default",
  };
  const label = readOption(`${LAUNCH_OPTION_PREFIX}label`);
  if (label) ctx.label = label;
  const resume = readOption(`${LAUNCH_OPTION_PREFIX}resume`);
  if (resume) ctx.resume = resume;
  const url = readOption(`${LAUNCH_OPTION_PREFIX}gateway_base_url`);
  if (url) ctx.gatewayBaseUrl = url;
  const h2a = readOption(`${LAUNCH_OPTION_PREFIX}h2a`);
  if (h2a) ctx.h2a = h2a;
  return ctx;
}

/** Human-friendly multi-line render for `h2a inspect` / an `ls --context` block. */
export function formatLaunchContext(ctx: LaunchContext): string {
  const lines = [
    `  profile: ${ctx.profile}`,
    `  cwd: ${ctx.cwd}`,
    ctx.label ? `  label: ${ctx.label}` : undefined,
    `  gateway: ${ctx.gateway}${ctx.gatewayBaseUrl ? ` (ANTHROPIC_BASE_URL=${ctx.gatewayBaseUrl})` : ""}`,
    `  model-map: ${ctx.modelMap}`,
    ctx.h2a ? `  h2a: ${ctx.h2a}` : undefined,
    ctx.resume ? `  resume: ${ctx.resume}` : undefined,
  ];
  return lines.filter((l): l is string => l !== undefined).join("\n");
}
