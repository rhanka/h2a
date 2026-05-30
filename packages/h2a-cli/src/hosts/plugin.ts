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
    // Poll command for every host (agy uses it as its only path; the others
    // can use it as a manual fallback). Drumbeat scan + blockage list.
    poll: `h2a drumbeat scan${rootArg}`
  };
}

/** A single Claude Code `Stop` hook entry (settings.json `hooks.Stop[]`). */
export interface H2AClaudeStopHook {
  readonly hooks: ReadonlyArray<{ readonly type: "command"; readonly command: string }>;
}

/**
 * DEC-102 (D6 slice b): build the Claude Code `Stop` hook entry that runs the
 * rendered `record` command when a claude session stops — so the drumbeat (D2)
 * gets a stop recorded with launch context (D1) and D3 can relance it. This is
 * the merge fragment for `~/.claude/settings.json` `hooks.Stop`.
 */
export function claudeStopHookEntry(record: string): H2AClaudeStopHook {
  return { hooks: [{ type: "command", command: record }] };
}

/** True if a settings.json Stop-hook entry is an h2a drumbeat-record hook. */
export function isH2ARecordHook(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const hooks = (entry as { hooks?: unknown }).hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some(
    (h) =>
      typeof h === "object" &&
      h !== null &&
      typeof (h as { command?: unknown }).command === "string" &&
      (h as { command: string }).command.includes("h2a drumbeat record")
  );
}

/**
 * DEC-113 (D6 done): the codex plugin manifest, written to
 * `<plugin-dir>/.codex-plugin/plugin.json`. Verified against codex's own
 * installed plugins (`~/.codex/plugins/cache/.../.codex-plugin/plugin.json`):
 * a JSON manifest with `name`/`version`/`description` and a relative `hooks`
 * pointer to the Claude-format `hooks.json` (cf. the cross-CLI
 * `.cursor-plugin/plugin.json` `"hooks": "./hooks/hooks.json"` convention).
 */
export interface H2ACodexPluginManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  /** Relative path (POSIX) from the manifest's plugin-dir to the hooks.json. */
  readonly hooks: string;
}

/** Default plugin name codex registers this scaffold under. */
export const H2A_CODEX_PLUGIN_NAME = "h2a-drumbeat";

/**
 * Build the codex-native plugin manifest. The `hooks` pointer is the relative
 * path codex resolves from the plugin root (`./hooks/hooks.json`), matching the
 * `hooks.json` the same `--scaffold` writes.
 */
export function codexPluginManifest(
  name: string = H2A_CODEX_PLUGIN_NAME
): H2ACodexPluginManifest {
  return {
    name,
    version: "0.1.0",
    description:
      "h2a drumbeat stop-hook: records a stop with launch context so the " +
      "drumbeat (D2) and local-tmux relauncher (D3) can relance this codex agent.",
    hooks: "./hooks/hooks.json"
  };
}

/**
 * The trust step a codex user must run to load a freshly-scaffolded plugin.
 * Codex has **no drop-in plugin dir and no `--bypass-hook-trust` flag** in the
 * shipped CLI (probed live: `codex plugin {marketplace add, list, add}`; trust
 * is recorded in `~/.codex/config.toml` as `[plugins."<name>@<mkt>"] enabled =
 * true`). `marketplace add` derives the marketplace name from the source — it
 * is NOT caller-named — so h2a cannot safely pre-write that snapshot/config
 * itself. Instead it emits the exact, idempotent commands: register the dir as
 * a local marketplace, list to read the assigned marketplace name, then install
 * `<plugin>@<marketplace>` (codex prompts to enable/trust). No faked install.
 */
export function codexPluginTrustCommands(
  pluginDir: string,
  name: string = H2A_CODEX_PLUGIN_NAME
): readonly string[] {
  return [
    `codex plugin marketplace add ${JSON.stringify(pluginDir)}`,
    "codex plugin marketplace list   # read the marketplace name assigned to the dir above",
    `codex plugin add ${name}@<marketplace>`
  ];
}
