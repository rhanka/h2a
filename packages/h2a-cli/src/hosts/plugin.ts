/**
 * DEC-093 — Drumbeat D6 (slice a): per-host plugin glue. The drumbeat (D2) can
 * only relance a stopped agent if the stop was recorded with a launch context,
 * and the local-tmux relauncher (D3) needs a pane to target — both captured at
 * *stop* time, inside the host's own terminal. h2a cannot write into each
 * host's runtime, so — exactly like `renderMcpConfig` — it RENDERS the per-host
 * lifecycle-hook command + where each host places it.
 *
 * Grounded in `docs/plugin-capability-matrix.md` (primary-source probe of all
 * four CLIs, even-handed): claude settings hooks · gemini `gemini hooks` ·
 * codex app-server / remote-control · agy = plugin import + **poll** (no daemon,
 * the one push gap). No host is privileged; agy is a first-class target here
 * (EVO-0), with a polling fallback instead of push.
 */

export type H2AHostPluginMechanism =
  | "claude-settings-hook"
  | "gemini-hooks"
  | "codex-app-server"
  | "agy-plugin-poll";

export interface H2AHostPluginTarget {
  readonly host: string;
  /** The host's resume invocation — what the D3 relauncher sends to revive it. */
  readonly resumeCommand: string;
  readonly mechanism: H2AHostPluginMechanism;
  /** Where/how to register the stop hook for this host. */
  readonly hint: string;
  /** Whether the host can be push-notified (false ⇒ poll-only, e.g. agy). */
  readonly push: boolean;
}

/** The four supported hosts, at parity (codex/claude/gemini/agy). */
export const H2A_HOST_PLUGIN_TARGETS: Readonly<Record<string, H2AHostPluginTarget>> = {
  claude: {
    host: "claude",
    resumeCommand: "claude -c",
    mechanism: "claude-settings-hook",
    push: true,
    hint: "Register the record command as a Stop hook in Claude Code settings.json (hooks.Stop)."
  },
  codex: {
    host: "codex",
    resumeCommand: "codex resume",
    mechanism: "codex-app-server",
    push: true,
    hint: "Run the record command from a codex app-server / remote-control stop handler."
  },
  gemini: {
    host: "gemini",
    resumeCommand: "gemini -r",
    mechanism: "gemini-hooks",
    push: true,
    hint: "Register the record command as a gemini lifecycle hook (`gemini hooks`)."
  },
  agy: {
    host: "agy",
    resumeCommand: "agy -c",
    mechanism: "agy-plugin-poll",
    push: false,
    hint: "agy has no background daemon: import the h2a plugin and poll `h2a drumbeat scan` / `h2a blockage list`. Run the record command on clean quit where a hook exists."
  }
};

export const H2A_HOST_PLUGIN_HOSTS = Object.keys(H2A_HOST_PLUGIN_TARGETS);

export interface RenderStopHookOptions {
  readonly instance: string;
  readonly root?: string;
  /** workStatus recorded on stop. Default `paused` (an unexpected stop = relance candidate). */
  readonly status?: string;
}

export interface H2AStopHookRender {
  readonly host: string;
  readonly mechanism: H2AHostPluginMechanism;
  readonly push: boolean;
  readonly hint: string;
  /** Shell command the stop hook runs — captures the launch context (DEC-085) for D3. */
  readonly record: string;
  /** Poll-only hosts (agy): the command to discover peers' stalls/blockages. */
  readonly poll?: string;
}

/**
 * Render the stop-hook command + placement for a host. The command runs inside
 * the host's terminal on stop, where `$TMUX_PANE` and the tmux session name are
 * available, so the recorded launch context lets D3 send `resumeCommand` back
 * into the captured pane. Returns undefined for an unknown host.
 */
export function renderStopHook(
  host: string,
  options: RenderStopHookOptions
): H2AStopHookRender | undefined {
  const target = H2A_HOST_PLUGIN_TARGETS[host];
  if (!target) return undefined;
  const status = options.status ?? "paused";
  const rootArg = options.root ? ` --root ${options.root}` : "";
  const record =
    `h2a drumbeat record --instance ${options.instance} --status ${status}` +
    ` --command ${JSON.stringify(target.resumeCommand)}` +
    ` --resume-command ${JSON.stringify(target.resumeCommand)}` +
    ` --tmux-session "$(tmux display-message -p '#{session_name}' 2>/dev/null)"` +
    ` --tmux-pane "$TMUX_PANE"` +
    rootArg;
  return {
    host: target.host,
    mechanism: target.mechanism,
    push: target.push,
    hint: target.hint,
    record,
    ...(target.push ? {} : { poll: `h2a drumbeat scan${rootArg}` })
  };
}
