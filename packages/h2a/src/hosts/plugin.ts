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
  | "agy-plugin-poll"
  | "hermes-hooks"
  | "opencode-plugin";

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
  },
  hermes: {
    host: "hermes",
    resumeCommand: "hermes --continue",
    mechanism: "hermes-hooks",
    push: true,
    hint: "Register the record command with Hermes hooks/plugins (`hermes hooks` / `hermes plugins`) so session stops are recorded."
  },
  opencode: {
    host: "opencode",
    resumeCommand: "opencode",
    mechanism: "opencode-plugin",
    push: true,
    hint: "Register the record command with an OpenCode plugin/hook so session stops are recorded."
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
  /** Pre-action host hook: verifies signed h2a drive prompts before the host acts. */
  readonly receive: string;
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
  const receive =
    `h2a drive receive --to ${options.instance} --stdin --ignore-non-drive` +
    rootArg;
  return {
    host: target.host,
    mechanism: target.mechanism,
    push: target.push,
    hint: target.hint,
    record,
    receive,
    // Poll command for every host (agy uses it as its only path; the others
    // can use it as a manual fallback). Drumbeat scan + blockage list.
    poll: `h2a drumbeat scan${rootArg}`
  };
}

/** A single Claude-format command hook entry. */
export interface H2AClaudeCommandHook {
  readonly hooks: ReadonlyArray<{ readonly type: "command"; readonly command: string }>;
}

/** A single Claude Code `Stop` hook entry (settings.json `hooks.Stop[]`). */
export type H2AClaudeStopHook = H2AClaudeCommandHook;

/**
 * DEC-102 (D6 slice b): build the Claude Code `Stop` hook entry that runs the
 * rendered `record` command when a claude session stops — so the drumbeat (D2)
 * gets a stop recorded with launch context (D1) and D3 can relance it. This is
 * the merge fragment for `~/.claude/settings.json` `hooks.Stop`.
 */
export function claudeStopHookEntry(record: string): H2AClaudeStopHook {
  return { hooks: [{ type: "command", command: record }] };
}

/**
 * Build the pre-action receive gate hook. The command reads the host hook JSON
 * from stdin, ignores ordinary user prompts, and rejects invalid signed h2a
 * drive prompts before the host processes them.
 */
export function claudeDriveReceiveHookEntry(receive: string): H2AClaudeCommandHook {
  return { hooks: [{ type: "command", command: receive }] };
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

/** True if a Claude-format hook entry is an h2a drive receive gate. */
export function isH2ADriveReceiveHook(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const hooks = (entry as { hooks?: unknown }).hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some(
    (h) =>
      typeof h === "object" &&
      h !== null &&
      typeof (h as { command?: unknown }).command === "string" &&
      (h as { command: string }).command.includes("h2a drive receive")
  );
}

/**
 * DEC-113 (D6 done): codex loads a plugin from a **local marketplace**, not a
 * bare plugin dir (verified live against codex CLI: `codex plugin marketplace
 * add <bare-plugin-dir>` is rejected with "marketplace root does not contain a
 * supported manifest"). A self-installable codex scaffold is therefore a
 * marketplace directory laid out exactly like codex's own `openai-curated`:
 *
 *   <dir>/.agents/plugins/marketplace.json    — the marketplace manifest
 *   <dir>/plugins/<name>/.codex-plugin/plugin.json  — the plugin manifest
 *   <dir>/plugins/<name>/hooks/hooks.json      — the Claude-format Stop hook
 *
 * The marketplace NAME comes from `marketplace.json.name` (codex assigns it on
 * `marketplace add` — confirmed it registered as `h2a-local`), so the trust
 * commands can use a fixed `<name>@<marketplace>` selector — no placeholder.
 */
export const H2A_CODEX_PLUGIN_NAME = "h2a-drumbeat";
export const H2A_CODEX_MARKETPLACE_NAME = "h2a-local";
/** POSIX-relative path the plugin manifest's `hooks` key points at. */
export const H2A_CODEX_PLUGIN_HOOKS_REL = "./hooks/hooks.json";

/** The codex-native plugin manifest (`.codex-plugin/plugin.json`). */
export interface H2ACodexPluginManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  /** Relative path (POSIX) from the plugin root to the hooks.json. */
  readonly hooks: string;
}

/**
 * One plugin entry in a codex `marketplace.json` (matches codex's curated
 * marketplace: `policy.authentication` ∈ {`ON_INSTALL`,`ON_USE`} — `NONE` is
 * rejected; verified live).
 */
export interface H2ACodexMarketplacePluginEntry {
  readonly name: string;
  readonly source: { readonly source: "local"; readonly path: string };
  readonly policy: { readonly installation: "AVAILABLE"; readonly authentication: "ON_INSTALL" };
  readonly category: string;
}

/** The codex marketplace manifest (`.agents/plugins/marketplace.json`). */
export interface H2ACodexMarketplaceManifest {
  readonly name: string;
  readonly interface: { readonly displayName: string };
  readonly plugins: ReadonlyArray<H2ACodexMarketplacePluginEntry>;
}

/** Build the codex-native plugin manifest pointing at the scaffolded hooks.json. */
export function codexPluginManifest(
  name: string = H2A_CODEX_PLUGIN_NAME
): H2ACodexPluginManifest {
  return {
    name,
    version: "0.1.0",
    description:
      "h2a drumbeat stop-hook: records a stop with launch context so the " +
      "drumbeat (D2) and local-tmux relauncher (D3) can relance this codex agent.",
    hooks: H2A_CODEX_PLUGIN_HOOKS_REL
  };
}

/**
 * Build the codex marketplace manifest that lists the scaffolded plugin. The
 * plugin `source.path` is the marketplace-relative `./plugins/<name>` dir.
 */
export function codexMarketplaceManifest(
  name: string = H2A_CODEX_PLUGIN_NAME,
  marketplace: string = H2A_CODEX_MARKETPLACE_NAME
): H2ACodexMarketplaceManifest {
  return {
    name: marketplace,
    interface: { displayName: "h2a (local)" },
    plugins: [
      {
        name,
        source: { source: "local", path: `./plugins/${name}` },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Developer Tools"
      }
    ]
  };
}

/**
 * The trust step a codex user must run to load the freshly-scaffolded plugin.
 * Codex has **no drop-in plugin dir and no hook-trust-bypass flag** in the
 * shipped CLI (probed live: `codex plugin {marketplace add, list, add}`; trust
 * is recorded in `~/.codex/config.toml` as `[plugins."<name>@<mkt>"] enabled =
 * true`). h2a cannot safely pre-write that config, so it scaffolds the
 * marketplace + emits the exact, idempotent two-command trust step (register
 * the local marketplace, then install — codex prompts to enable/trust). No
 * faked install. Verified live: `marketplace add` registers as `<marketplace>`
 * and `plugin list` then shows `<name>@<marketplace>` ready to install.
 */
export function codexPluginTrustCommands(
  marketplaceDir: string,
  name: string = H2A_CODEX_PLUGIN_NAME,
  marketplace: string = H2A_CODEX_MARKETPLACE_NAME
): readonly string[] {
  return [
    // Double-quote (not JSON.stringify) so the displayed command is correct on
    // Windows too: JSON-escaping doubles every backslash (`D:\\mkt`), which is
    // both wrong for the user's shell and breaks the literal-path assertion.
    // Plain double quotes still cover spaces on POSIX and Windows.
    `codex plugin marketplace add "${marketplaceDir}"`,
    `codex plugin add ${name}@${marketplace}`
  ];
}
