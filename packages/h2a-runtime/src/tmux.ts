/**
 * tmux-backed session management.
 *
 * Two uses, one battle-tested multiplexer:
 *  - LOCAL sessions: `h2a run <profile>` starts the CLI inside a local tmux
 *    session (`h2a-<slug>`), so `h2a ls`/`attach`/`stop` manage local and
 *    remote sessions uniformly, and detach/reattach is native.
 *  - REMOTE attach via exec: `remote attach <id> --exec` runs
 *    `kubectl exec -it … tmux attach` straight into the Pod's tmux session, so
 *    the LOCAL terminal owns scrollback + copy (OSC52) with no WS proxy in the
 *    middle — this is what fixes "I can't copy the code claude printed".
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

import { getTmuxProfileConfig } from "./config.js";
import { defaultLocalH2aRoot } from "./h2a-bridge.js";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { homedir, tmpdir } from "node:os";

import {
  readProcessObservation,
  readProcessTreeCpuMs,
  readProcView,
  readWorkerAttribution,
  readWorkerPid,
  resolveWorkerAttributionFromView,
  type ProcView,
  type ProcessObservation,
  type ProcReaderDeps,
  type WorkerAttribution,
} from "./proc-cpu.js";
import {
  decideRelaunchSafety,
  type RelaunchSafety,
} from "./relaunch.js";

import {
  LAUNCH_OPTION_PREFIX,
  buildLaunchContext,
  launchContextOptions,
  parseLaunchContext,
  redactSecrets,
  type LaunchContext,
} from "./launch-context.js";
import { SESSION_CLASS_ENV, type SessionClass } from "./session-class.js";
import type { TunnelConfig } from "./config.js";

const TMUX = "tmux";

/** Canonical tmux session-name prefix for h2a-managed local sessions. */
export const LOCAL_PREFIX = "h2a-";
/** Legacy tmux session-name prefix accepted during the compatibility window. */
export const LEGACY_LOCAL_PREFIX = "remote-";

/** Pod tmux session the session-agent runs the CLI in (see agent.ts). */
export const POD_TMUX_SESSION = "main";

/** Default remote-owned tmux profile name stored in remote CLI config. */
export const REMOTE_TMUX_PROFILE_NAME = "remote";

type TmuxProfileInvariant =
  | { readonly line: string }
  | { readonly prefix: string };

/**
 * The embedded, scroll-safe tmux profile remote owns. The commands are applied
 * directly to the running tmux server; no user ~/.tmux.conf entry is required.
 */
export const REMOTE_TMUX_PROFILE = {
  name: REMOTE_TMUX_PROFILE_NAME,
  version: 1,
  invariants: [
    { line: "set -g allow-passthrough on" },
    { line: "set -g history-limit 50000" },
    { line: "set -g default-terminal tmux-256color" },
    { line: "set -g terminal-overrides ,*256col*:Tc,xterm*:Tc,gnome*:Tc" },
    { line: "set -g mouse on" },
    { line: "set -g set-clipboard on" },
    { line: "set -g focus-events on" },
    { line: "set -g set-titles on" },
    { line: "set -g set-titles-string #{pane_title}" },
    { line: "setw -g automatic-rename on" },
    {
      line: "setw -g automatic-rename-format #{?pane_title,#{pane_title},#{pane_current_command}}",
    },
    { line: "setw -g allow-rename off" },
    { prefix: "bind -n WheelUpPane " },
    { line: "bind -n WheelDownPane send-keys -M" },
    { line: "bind -n PPage copy-mode -eu" },
    { prefix: "bind -n C-S-c " },
    { line: "bind -T copy-mode C-S-c send-keys -X copy-pipe-and-cancel" },
    { line: "bind -T copy-mode-vi C-S-c send-keys -X copy-pipe-and-cancel" },
    { prefix: "bind -n C-v if-shell " },
  ] satisfies ReadonlyArray<TmuxProfileInvariant>,
} as const;

/**
 * Persistent-box wrapper (local twin of the Pod one): run the CLI, and when it
 * exits drop into a login shell on the workdir instead of ending the tmux
 * session. Invoked as `bash -lc WRAPPER <relaunch> <cli> <args…>`, so the FIRST
 * positional lands in `$0` (the relaunch hint), the CLI in `$1`, args in `$2…`.
 */
export const LOCAL_WRAPPER = `relaunch="$0"; cli="$1"; shift
"$cli" "$@"; code=$?
printf '\\n[h2a] %s exited (code %s) — shell on %s.\\n' "$cli" "$code" "$PWD"
printf '[h2a] relaunch: %s   (or Ctrl-D to end this session)\\n' "$relaunch"
if [ -t 0 ]; then exec /bin/bash -l; else exit "$code"; fi`;

/**
 * Interactive structured-launch wrapper. Unlike LOCAL_WRAPPER it NEVER falls
 * back to a login shell: if the agent executable is absent or exits before it
 * consumes the injected prompt, the tmux pane terminates and the prompt cannot
 * become shell input.
 */
export const STRUCTURED_LOCAL_WRAPPER = `cli="$0"
exec "$cli" "$@"`;

/**
 * Run-once-exit wrapper for HEADLESS delegated jobs — the OPPOSITE of
 * LOCAL_WRAPPER's drop-to-shell. Redirects the CLI's stdout+stderr to an output
 * log, writes a result.json with the final state + exit code, then lets the
 * tmux session END (no `exec bash`). Invoked as
 * `bash -lc HEADLESS_WRAPPER <resultJson> <outputLog> <promptFile> <cli> <args…>`:
 * `$0`=result.json path, `$1`=output.log path, `$2`=transient prompt path,
 * `$3`=cli, `$4…`=cli args. The prompt file is opened and unlinked before
 * the CLI starts, so prompt content never appears in process argv.
 */
export const HEADLESS_WRAPPER = `result="$0"; log="$1"; prompt="$2"; cli="$3"; shift 3
if [ -n "$prompt" ]; then
  exec 3<"$prompt"
  rm -f -- "$prompt"
  "$cli" "$@" <&3 >"$log" 2>&1; code=$?
else
  "$cli" "$@" >"$log" 2>&1; code=$?
fi
if [ "$code" -eq 0 ]; then state=done; else state=failed; fi
printf '{"state":"%s","exitCode":%s}\\n' "$state" "$code" >"$result"`;

/**
 * The `remote run …` line that recreates this exact local session — shown when
 * the CLI exits so the user can copy-paste it. Pure, exported for tests.
 */
export function localRelaunchCommand(
  profile: string,
  cwd: string,
  label: string | undefined,
  resumeArgs: ReadonlyArray<string> = [],
): string {
  // resumeArgs is the CLI-native resume argv (e.g. ["--resume", id] /
  // ["resume", id]); the conversation id is its last token, surfaced as `-r`.
  const convId =
    resumeArgs.length > 0 ? resumeArgs[resumeArgs.length - 1] : undefined;
  let cmd = `h2a run ${profile} ${cwd}`;
  if (label) cmd += ` --name ${label}`;
  if (convId && convId !== resumeArgs[0]) cmd += ` -r ${convId}`;
  return cmd;
}

/**
 * Distinct session labels for a fan-out of `count` parallel agents on one base.
 * `count <= 1` → just the base (the normal single-session case). `#k` suffixes
 * keep each tmux session distinct (the slug derives from the label), so you can
 * run more than the per-project layout cap of parallel claude/codex agents.
 */
export function fanoutLabels(base: string, count: number): string[] {
  if (count <= 1) return [base];
  return Array.from({ length: count }, (_v, i) => `${base}#${i + 1}`);
}

/**
 * Same drop-to-shell contract for SIDE windows (h2a, …), but the command is a
 * single configured shell line (quoting preserved via eval), not cli+args.
 * `$0` is a label, `$1` is the optional agent pane wake target, `$2` is the
 * command line. When present, `TMUX_PANE` is deliberately overridden before
 * `eval` so h2a's local-tmux wake driver targets the agent pane, not the h2a
 * side-window process.
 */
const WINDOW_WRAPPER = `agent_pane="$1"; cmd="$2"
if [ -n "$agent_pane" ]; then export TMUX_PANE="$agent_pane"; fi
eval "$cmd"; code=$?
printf '\\n[h2a] %s exited (code %s) — shell on %s. Re-run it or Ctrl-D to end this window.\\n' "$cmd" "$code" "$PWD"
if [ -t 0 ]; then exec /bin/bash -l; else exit "$code"; fi`;

/** Structured sidecar wrapper: publish the agent pane, then replace the shell. */
export const STRUCTURED_WINDOW_WRAPPER = `agent_pane="$1"; cmd="$2"
if [ -n "$agent_pane" ]; then export TMUX_PANE="$agent_pane"; fi
eval "exec $cmd"`;

/**
 * Window name for the h2a MCP server side window — the a2a launcher contract:
 * agents live in NAMED tmux windows, with `h2a mcp-serve` running next to them
 * so the agent is reachable/wakeable through ~/h2a-workspace/.h2a.
 */
export const H2A_WINDOW_NAME = "h2a";
export const H2A_STATUS_WINDOW_NAME = "h2a-status";
const H2A_STATUS_INSTALLED_OPTION = "@h2a_status_surface";
const H2A_STATUS_PREVIOUS_LEFT = "@h2a_status_previous_left";
const H2A_STATUS_PREVIOUS_RIGHT = "@h2a_status_previous_right";
const H2A_STATUS_PREVIOUS_INTERVAL = "@h2a_status_previous_interval";
const H2A_STATUS_PREVIOUS_STATUS = "@h2a_status_previous_status";
const H2A_STATUS_PREVIOUS_LEFT_LENGTH = "@h2a_status_previous_left_length";
const H2A_STATUS_PREVIOUS_RIGHT_LENGTH = "@h2a_status_previous_right_length";
const H2A_STATUS_INSTALLING = "installing";
const H2A_STATUS_RESTORED = "restored";
const AGENT_PANE_OPTION = "@remote_agent_pane";
const AGENT_HOST_OPTION = "@remote_agent_host";
const AGENT_CWD_OPTION = "@remote_agent_cwd";
const H2A_MCP_READY_FILE_ENV = "H2A_MCP_READY_FILE";
const H2A_MCP_READY_NONCE_ENV = "H2A_MCP_READY_NONCE";
const H2A_MCP_READY_KIND = "h2a.mcp.ready";

export type LocalSession = {
  /** Stable tmux identity for this live session (for example `$3`). */
  tmuxId: string;
  /** Session creation epoch from tmux; paired with server identity for replay safety. */
  tmuxCreatedAt: string;
  tmuxServerPid: string;
  tmuxSocketPath: string;
  /** full tmux session name, e.g. `h2a-surch` */
  name: string;
  /** short name shown to the user, e.g. `surch` */
  slug: string;
  /** profile recorded on the session (claude/codex/…), or "?" if unknown */
  profile: string;
  /** working directory */
  path: string;
  /** is a client currently attached */
  attached: boolean;
  /** custom display name set via `remote rename`, if any */
  displayName?: string;
};

export type ManagedSessionName = {
  prefix: typeof LOCAL_PREFIX | typeof LEGACY_LOCAL_PREFIX;
  slug: string;
};

export type LocalSessionResolution =
  | { kind: "found"; session: LocalSession }
  | { kind: "ambiguous"; sessions: LocalSession[] }
  | { kind: "missing" };

export function tmuxAvailable(): boolean {
  try {
    return spawnSync(TMUX, ["-V"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

export function slugify(p: string): string {
  const base = basename(p)
    .replace(/[^a-zA-Z0-9_.-]/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "session";
}

/** Parse either canonical or legacy h2a-managed tmux session name. */
export function parseManagedSessionName(
  name: string,
): ManagedSessionName | undefined {
  for (const prefix of [LOCAL_PREFIX, LEGACY_LOCAL_PREFIX] as const) {
    if (name.startsWith(prefix) && name.length > prefix.length) {
      return { prefix, slug: name.slice(prefix.length) };
    }
  }
  return undefined;
}

/** All managed tmux names that can represent a short slug, canonical first. */
export function managedSessionCandidates(slug: string): string[] {
  return [`${LOCAL_PREFIX}${slug}`, `${LEGACY_LOCAL_PREFIX}${slug}`];
}

/** Canonical tmux session name for a workdir slug. */
export function localSessionName(slug: string): string {
  return `${LOCAL_PREFIX}${slug}`;
}

const ANTHROPIC_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
] as const;

/** Build the environment explicitly stamped into a newly-created tmux session. */
export function tmuxEnvironmentArgs(sessionClass?: SessionClass): string[] {
  const args: string[] = [];
  for (const key of ANTHROPIC_ENV_KEYS) {
    const value = process.env[key];
    if (value) args.push("-e", `${key}=${value}`);
  }
  if (sessionClass) args.push("-e", `${SESSION_CLASS_ENV}=${sessionClass}`);
  return args;
}

function anthopicEnvUnsetCommandPrefix(): string[] {
  // tmux sessions inherit the tmux *server* environment too. If remote deliberately
  // launches direct/default with no Anthropic env in its own process, scrub stale
  // gateway/API-key variables that an older tmux server may still carry.
  return ANTHROPIC_ENV_KEYS.some((key) => Boolean(process.env[key]))
    ? []
    : ["env", ...ANTHROPIC_ENV_KEYS.flatMap((key) => ["-u", key])];
}

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** List h2a-managed local tmux sessions (best-effort; [] if no server). */
export function listLocalSessionsWithDiagnostics(): {
  readonly sessions: LocalSession[];
  readonly known: boolean;
  readonly reason?: string;
} {
  if (!tmuxAvailable()) {
    return { sessions: [], known: false, reason: "tmux is unavailable" };
  }
  const r = spawnSync(
    TMUX,
    [
      "list-sessions",
      "-F",
      "#{session_id}\t#{session_created}\t#{pid}\t#{socket_path}\t#{session_name}\t#{session_attached}\t#{session_path}\t#{@profile}\t#{@display_name}",
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    const detail = `${r.stderr ?? ""}`.trim();
    if (/no server running|failed to connect to server/i.test(detail)) {
      return { sessions: [], known: true };
    }
    return {
      sessions: [],
      known: false,
      reason: detail ? `tmux list failed: ${detail}` : "tmux list failed",
    };
  }
  if (!r.stdout) return { sessions: [], known: true };
  const out: LocalSession[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!line) continue;
    const [
      tmuxId,
      tmuxCreatedAt,
      tmuxServerPid,
      tmuxSocketPath,
      name,
      attached,
      path,
      profile,
      displayName,
    ] = line.split("\t");
    if (
      !tmuxId ||
      !tmuxCreatedAt ||
      !tmuxServerPid ||
      !tmuxSocketPath ||
      !name
    ) continue;
    const managed = parseManagedSessionName(name);
    if (!managed) continue;
    const session: LocalSession = {
      tmuxId,
      tmuxCreatedAt,
      tmuxServerPid,
      tmuxSocketPath,
      name,
      slug: managed.slug,
      profile: profile || "?",
      path: path || "",
      attached: Number(attached) > 0,
    };
    if (displayName && displayName.trim()) {
      session.displayName = displayName.trim();
    }
    out.push(session);
  }
  return { sessions: out, known: true };
}

export type H2aStatusSurfaceRecord = {
  readonly sessionName: string;
  readonly marker?: string;
};

type FleetTmuxRunner = (
  command: string,
  args: string[],
  options: { encoding: "utf8"; stdio: ["ignore", "pipe", "ignore"] },
) => { status: number | null; stdout?: string };

/**
 * Read the status marker for the whole tmux fleet in one invocation. This is
 * intentionally a FORMAT projection: show-options -A -t <session> is a
 * per-target probe and recreates the process storm this auditor exists to fix.
 */
export function listH2aStatusSurfaces(
  run: FleetTmuxRunner = spawnSync as FleetTmuxRunner,
): H2aStatusSurfaceRecord[] {
  const r = run(
    TMUX,
    ["list-sessions", "-F", "#{session_name} #{@h2a_status_surface}"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  if (r.status !== 0 || !r.stdout) return [];
  const records: H2aStatusSurfaceRecord[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!line) continue;
    const separator = line.indexOf(" ");
    if (separator === -1) {
      records.push({ sessionName: line });
      continue;
    }
    const sessionName = line.slice(0, separator);
    const marker = line.slice(separator + 1).trim();
    if (sessionName) records.push({ sessionName, ...(marker ? { marker } : {}) });
  }
  return records;
}

/** Compatibility reader used by existing callers that accept best-effort []. */
export function listLocalSessions(): LocalSession[] {
  return listLocalSessionsWithDiagnostics().sessions;
}

/**
 * Resolve a local session by exact managed tmux name or by a unique slug.
 * A bare slug spanning canonical and legacy sessions is deliberately ambiguous.
 */
export function resolveLocalSession(
  target: string,
  sessions: readonly LocalSession[] = listLocalSessions(),
): LocalSessionResolution {
  if (parseManagedSessionName(target)) {
    const session = sessions.find((candidate) => candidate.name === target);
    return session ? { kind: "found", session } : { kind: "missing" };
  }
  const matches = sessions.filter((candidate) => candidate.slug === target);
  if (matches.length === 1) return { kind: "found", session: matches[0]! };
  if (matches.length > 1) return { kind: "ambiguous", sessions: matches };
  return { kind: "missing" };
}

/** Resolve a value that is already known to be a slug, never a full name. */
function resolveLocalSessionSlug(
  slug: string,
  sessions: readonly LocalSession[] = listLocalSessions(),
): LocalSessionResolution {
  const matches = sessions.filter((candidate) => candidate.slug === slug);
  if (matches.length === 1) return { kind: "found", session: matches[0]! };
  if (matches.length > 1) return { kind: "ambiguous", sessions: matches };
  return { kind: "missing" };
}

/** Find a local session by its full name or an unambiguous slug. */
export function findLocalSession(target: string): LocalSession | undefined {
  const resolution = resolveLocalSession(target);
  return resolution.kind === "found" ? resolution.session : undefined;
}

/** Resolve all requested labels that already name a managed tmux session. */
export function existingLocalSessionSlugs(
  labels: ReadonlyArray<string | undefined>,
  cwd: string,
): string[] {
  return labels
    .map((label) => {
      const slug = slugify(label ?? cwd);
      return resolveLocalSessionSlug(slug).kind !== "missing" ? slug : undefined;
    })
    .filter((slug): slug is string => slug !== undefined);
}

/**
 * Store a custom display name on a local tmux session WITHOUT calling
 * `rename-window`. This avoids tmux's per-window `allow-rename off` side-effect
 * that an explicit `rename-window` triggers — keeping the window name free to
 * follow the agent's live OSC title (activity status). The name is persisted as a
 * tmux session option `@display_name` and surfaced by `listLocalSessions` /
 * `remote ls`.
 */
export function setLocalSessionDisplayName(
  session: string,
  displayName: string,
): boolean {
  const r = spawnSync(
    TMUX,
    [
      "set-option",
      "-t",
      exactSessionTarget(session),
      "@display_name",
      displayName,
    ],
    { stdio: "ignore" },
  );
  return r.status === 0;
}

/**
 * Read the custom display name stored on a local tmux session via
 * `setLocalSessionDisplayName`, if any. Returns `undefined` when no display name
 * has been set or the session cannot be reached.
 */
export function getLocalSessionDisplayName(
  session: string,
): string | undefined {
  const r = spawnSync(
    TMUX,
    ["show-options", "-qv", "-t", exactSessionTarget(session), "@display_name"],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || r.stdout === undefined) return undefined;
  const v = r.stdout.trim();
  return v || undefined;
}

export type StartLocalResult = {
  name: string;
  slug: string;
  /** Exact agent pane captured from tmux `-P -F`, e.g. `%7`. */
  agentPane?: string;
  /** Transient headless prompt path; never surfaced in public JSON. */
  promptFile?: string;
};

export type ManagedLaunchMetadata = {
  /** Durable class inherited by the agent's SessionStart/SessionEnd hooks. */
  sessionClass?: SessionClass;
  /** Conversation id only; never pass arbitrary CLI argv as resume metadata. */
  resumeId?: string;
  /** Sidecar command selected for this launch, if any. */
  h2aCommand?: string;
  /** End the pane with the agent; never expose a fallback shell to prompt input. */
  terminateOnAgentExit?: boolean;
  /** Refuse an existing name instead of reusing it (structured launch contract). */
  refuseExisting?: boolean;
  /**
   * Keep a real, fixed-size PTY client attached while the pane is remotely
   * driven. Required before an initial TUI prompt can be delivered reliably.
   */
  attachedTerminal?: boolean;
};

/** Fixed PTY geometry for a non-human tmux client. */
export const HEADLESS_TERMINAL_SIZE = { cols: 160, rows: 48 } as const;

export type HeadlessTerminalResult =
  | {
      readonly state: "already-attached";
      readonly attachedClients: number;
    }
  | {
      readonly state: "headless-attached";
      readonly attachedClients: number;
      readonly cols: number;
      readonly rows: number;
    }
  | {
      readonly state: "unavailable";
      readonly reason: string;
    };

export type EnsureHeadlessTerminalOptions = {
  /** How long to wait for tmux to observe the new client. */
  readonly timeoutMs?: number;
  /** Poll cadence while the script-owned client starts. */
  readonly pollMs?: number;
};

const HEADLESS_TERMINAL_TIMEOUT_MS = 5_000;
const HEADLESS_TERMINAL_POLL_MS = 50;
const HEADLESS_TERMINAL_MARKER = "@h2a_attached_terminal";

function sleepBlocking(ms: number): void {
  if (ms <= 0) return;
  const cell = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(cell, 0, 0, ms);
}

/**
 * Give a detached tmux session a genuine terminal, without taking over the
 * launcher terminal. `script` allocates a PTY and an intentionally idle pipe
 * keeps its stdin open; without that pipe `script` receives EOF from a
 * headless launcher and the tmux client immediately detaches. A pipe or `tmux
 * send-keys` alone is not a terminal, and both Codex and Claude can drop their
 * initial composer input when started that way.
 */
export function ensureHeadlessTerminal(
  session: string,
  options: EnsureHeadlessTerminalOptions = {},
): HeadlessTerminalResult {
  const attached = sessionAttachedCount(session);
  if (attached !== undefined && attached > 0) {
    return { state: "already-attached", attachedClients: attached };
  }
  if (attached === undefined) {
    return {
      state: "unavailable",
      reason: `tmux could not inspect session ${session}`,
    };
  }
  if (!commandAvailable("script")) {
    return {
      state: "unavailable",
      reason: "the util-linux `script` command is required to allocate a persistent PTY",
    };
  }

  let launchError: string | undefined;
  try {
    const child = spawn(
      "/bin/sh",
      [
        "-c",
        `exec tail -f /dev/null | script -qefc 'export TERM=xterm-256color; stty cols ${HEADLESS_TERMINAL_SIZE.cols} rows ${HEADLESS_TERMINAL_SIZE.rows}; exec tmux -u attach-session -t "$H2A_HEADLESS_TARGET"' /dev/null`,
      ],
      {
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          H2A_HEADLESS_TARGET: exactSessionTarget(session),
        },
      },
    );
    child.on("error", (error) => {
      launchError = error.message;
    });
    child.unref();
  } catch (error) {
    return {
      state: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const timeoutMs = options.timeoutMs ?? HEADLESS_TERMINAL_TIMEOUT_MS;
  const pollMs = options.pollMs ?? HEADLESS_TERMINAL_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const clients = sessionAttachedCount(session);
    if (clients !== undefined && clients > 0) {
      setSessionOption(
        session,
        HEADLESS_TERMINAL_MARKER,
        `headless:${HEADLESS_TERMINAL_SIZE.cols}x${HEADLESS_TERMINAL_SIZE.rows}`,
      );
      return {
        state: "headless-attached",
        attachedClients: clients,
        ...HEADLESS_TERMINAL_SIZE,
      };
    }
    if (launchError) {
      return { state: "unavailable", reason: launchError };
    }
    if (Date.now() >= deadline) {
      return {
        state: "unavailable",
        reason: `tmux client did not attach within ${timeoutMs}ms`,
      };
    }
    sleepBlocking(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
}

/**
 * First clipboard CLI found on PATH, or undefined. With `mouse on`, a mouse
 * drag is captured by tmux (copy-mode) instead of the terminal's NATIVE
 * selection, so Ctrl+Shift+C / right-click-Copy see nothing. tmux's own copy
 * goes through OSC52 (set-clipboard) — but VTE/gnome-terminal silently DROP
 * OSC52 clipboard writes, so the copy lands nowhere. Piping copy-mode to a real
 * clipboard tool (copy-command, tmux ≥3.2) is the reliable local fix; Wayland
 * first, then X11.
 */
function detectClipboardCommand(): string | undefined {
  const candidates = process.env.WAYLAND_DISPLAY
    ? ["wl-copy", "xclip -selection clipboard", "xsel -ib"]
    : ["xclip -selection clipboard", "xsel -ib", "wl-copy"];
  for (const c of candidates) {
    const bin = c.split(" ")[0]!;
    if (
      spawnSync("command", ["-v", bin], { shell: true, stdio: "ignore" })
        .status === 0
    ) {
      return c;
    }
  }
  return undefined;
}

/**
 * Pure builder for the global tmux options applied at every run/attach. Split
 * out of `ensureScrollConfig` so the option set (scroll/clipboard AND the
 * title-following options for the GNOME tab) is unit-testable without a tmux
 * server. `clip` is the detected clipboard command (undefined → no copy-command).
 *
 * Title chain (bug #1 — "the tab name doesn't follow the agent"): the agent
 * (claude/codex) emits its live title as an OSC sequence, which tmux records as
 * `pane_title`. tmux only RE-EMITS that title to the OUTER terminal (the GNOME
 * tab) when `set-titles on`; it is OFF by default, so the OSC title was trapped
 * inside tmux and the GNOME tab kept the static launcher `--title`. We turn
 * `set-titles on` and point `set-titles-string` at `#{pane_title}` (the agent's
 * live title) with a friendly fallback (the window name, then the session name)
 * when the agent has not set a title yet. `allow-rename on` lets the window NAME
 * track the OSC title too. We deliberately NEVER touch `automatic-rename`
 * (project rule); it stays at its default `on`, which is what lets the window
 * follow the title.
 */
export function buildTmuxGlobalOptions(
  clip: string | undefined,
  profile = REMOTE_TMUX_PROFILE_NAME,
): Array<ReadonlyArray<string>> {
  const cmds: Array<ReadonlyArray<string>> = [
    // Mark this server as remote-managed so diagnostics can tell user config
    // apart from the embedded profile remote applies idempotently.
    ["set", "-g", "@remote_profile", profile],
    // Match the proven old-PC tmux baseline used by Antoine's remote sessions.
    ["set", "-g", "allow-passthrough", "on"],
    ["set", "-g", "history-limit", "50000"],
    ["set", "-g", "default-terminal", "tmux-256color"],
    ["set", "-g", "terminal-overrides", ",*256col*:Tc,xterm*:Tc,gnome*:Tc"],
    ["set", "-g", "mouse", "on"],
    ["set", "-g", "set-clipboard", "on"],
    ["set", "-g", "focus-events", "on"],
    ["set", "-g", "set-titles", "on"],
    ["set", "-g", "set-titles-string", "#{pane_title}"],
    ["set", "-g", "status-interval", "1"],
    ["setw", "-g", "automatic-rename", "on"],
    [
      "setw",
      "-g",
      "automatic-rename-format",
      "#{?pane_title,#{pane_title},#{pane_current_command}}",
    ],
    // Ignore \033k manual renames so OSC pane_title keeps driving live names.
    ["setw", "-g", "allow-rename", "off"],
    [
      "bind",
      "-n",
      "WheelUpPane",
      "if",
      "-Ft=",
      "#{pane_in_mode}",
      "send-keys -M",
      "copy-mode -e; send-keys -M",
    ],
    ["bind", "-n", "WheelDownPane", "send-keys", "-M"],
    ["bind", "-n", "PPage", "copy-mode", "-eu"],
    // Some terminals/desktop stacks forward Ctrl+Shift+C to tmux when the
    // selection was made inside tmux copy-mode. Bind it as an explicit fallback
    // so the familiar terminal shortcut copies the active tmux selection through
    // copy-command instead of being swallowed. Outside copy-mode, forward the key
    // unchanged so terminals that own Ctrl+Shift+C keep their native behavior.
    [
      "bind",
      "-n",
      "C-S-c",
      "if",
      "-F",
      "#{pane_in_mode}",
      "send-keys -X copy-pipe-and-cancel",
      "send-keys C-S-c",
    ],
    [
      "bind",
      "-T",
      "copy-mode",
      "C-S-c",
      "send-keys",
      "-X",
      "copy-pipe-and-cancel",
    ],
    [
      "bind",
      "-T",
      "copy-mode-vi",
      "C-S-c",
      "send-keys",
      "-X",
      "copy-pipe-and-cancel",
    ],
    buildCodexImagePasteBinding(),
  ];
  // copy-command makes every copy-pipe-and-cancel (mouse drag, double/triple
  // click) land in the real system clipboard. tmux's defaults already use
  // copy-pipe-and-cancel with no argument → they honour copy-command.
  if (clip) cmds.push(["set", "-g", "copy-command", clip]);
  return cmds;
}

function tmuxCommandLine(args: ReadonlyArray<string>): string {
  return args.join(" ");
}

export function validateManagedTmuxProfile(
  cmds: ReadonlyArray<ReadonlyArray<string>>,
): string[] {
  const lines = cmds.map(tmuxCommandLine);
  const missing: string[] = [];
  for (const invariant of REMOTE_TMUX_PROFILE.invariants) {
    if ("line" in invariant) {
      if (!lines.includes(invariant.line)) missing.push(invariant.line);
    } else if (!lines.some((line) => line.startsWith(invariant.prefix))) {
      missing.push(`${invariant.prefix}*`);
    }
  }
  return missing;
}

/**
 * Wayland image paste bridge for Codex panes. Terminals/tmux cannot paste image
 * bytes into a TTY, so the reliable path is: read the clipboard image with
 * wl-paste, save it under the pane cwd, then paste the resulting file path into
 * Codex. The binding is guarded by the current tmux session/window profile and
 * clipboard MIME type; when the guard fails, Ctrl+V is forwarded unchanged.
 */
export function buildCodexImagePasteBinding(): ReadonlyArray<string> {
  const condition = [
    "command -v wl-paste >/dev/null 2>&1",
    'wl-paste --list-types 2>/dev/null | grep -Eq "^(image/png|image/jpeg)$"',
    // Check @profile (set by remote run) OR window_name OR pane_current_command.
    // pane_current_command is often "node" for Codex (not "codex"), so @profile
    // is the reliable discriminant when the session was started via `remote run`.
    'tmux display-message -p "#{@profile}:#{window_name}:#{pane_current_command}" | grep -Eqi "(^|:)codex(:|$)"',
  ].join(" && ");
  // #{pane_id} is expanded by tmux at binding-fire time before the shell runs,
  // so the send-keys always targets the pane that triggered C-v even when the
  // run-shell -b shell is scheduled after a focus change.
  const script = [
    'PANE_TARGET="#{pane_id}"',
    'pane_cwd=$(tmux display-message -p -t "$PANE_TARGET" "#{pane_current_path}")',
    'dir="$pane_cwd/.remote/images"',
    'mkdir -p "$dir"',
    "mime=$(wl-paste --list-types | awk '/^image\\/png$/{print; exit} /^image\\/jpeg$/{print; exit}')",
    'case "$mime" in image/png) ext=png ;; image/jpeg) ext=jpg ;; *) exit 1 ;; esac',
    'file="$dir/paste-$(date +%Y%m%d-%H%M%S)-$$.$ext"',
    'wl-paste -t "$mime" > "$file"',
    'tmux send-keys -t "$PANE_TARGET" -l "$file"',
  ].join("; ");
  return [
    "bind",
    "-n",
    "C-v",
    "if-shell",
    "-b",
    condition,
    `run-shell -b ${shellSingleQuote(script)}`,
    "send-keys C-v",
  ];
}

/**
 * Make the LOCAL tmux server scroll the conversation on the wheel AND copy
 * selections to the system clipboard — same scroll settings the Pod image bakes
 * into /etc/tmux.conf. Without `mouse on`, the terminal falls back to
 * alternateScroll (wheel → arrow keys → the CLI's input history), which reads as
 * "scrolling scrolls the input history". With mouse on, a drag is tmux's
 * selection: `copy-command` pipes it to wl-copy/xclip so Ctrl+Shift+V / paste
 * works (VTE drops OSC52, so set-clipboard alone is not enough). Wheel events
 * follow the proven old-PC baseline: enter copy-mode on wheel-up and forward the
 * real mouse event (`send-keys -M`) instead of synthetic copy-mode scroll
 * commands. Native selection (for Ctrl+Shift+C) stays available via Shift+drag;
 * if Ctrl+Shift+C reaches tmux while in copy-mode, remote explicitly maps it to
 * copy-pipe-and-cancel so the same gesture still copies through copy-command.
 * ALSO turns on the
 * title-following options (see buildTmuxGlobalOptions) so the GNOME tab tracks
 * the agent's live title. Global, idempotent, applied at every run/attach so it
 * works even without ~/.tmux.conf.
 */
export function ensureManagedTmuxProfile(
  profile = getTmuxProfileConfig().profile,
): void {
  const cmds = buildTmuxGlobalOptions(detectClipboardCommand(), profile);
  for (const args of cmds) {
    // Best-effort: no server yet / old tmux must never fail the caller.
    spawnSync(TMUX, [...args], { stdio: "ignore" });
  }
}

/** Backwards-compatible name kept for older callers/tests. */
export function ensureScrollConfig(profile?: string): void {
  ensureManagedTmuxProfile(profile);
}

/**
 * Start a CLI in a detached local tmux session. Idempotent on name: if a
 * session with the same slug already exists it is reused (returns it). The slug
 * defaults to the workdir basename; pass `label` to override it (e.g. to keep
 * several sessions of the same project distinct: "sentropic#2").
 */
export function startLocalSession(
  profile: string,
  command: string,
  cwd: string,
  args: ReadonlyArray<string> = [],
  label?: string,
  tmuxProfile = getTmuxProfileConfig().profile,
  metadata: ManagedLaunchMetadata = {},
): StartLocalResult {
  const slug = slugify(label ?? cwd);
  const name = localSessionName(slug);
  const {
    sessionClass,
    terminateOnAgentExit = false,
    refuseExisting = false,
    attachedTerminal = false,
    ...launchMetadata
  } = metadata;
  ensureScrollConfig(tmuxProfile);
  const existing = resolveLocalSessionSlug(slug);
  if (existing.kind === "ambiguous") {
    throw new Error(
      `local session ${slug} is ambiguous; use an exact tmux session name`,
    );
  }
  if (existing.kind === "found") {
    if (refuseExisting) {
      throw new Error(`local session ${slug} already exists; no agent was started`);
    }
    const agentPane = persistAgentPaneMetadata(existing.session.name, profile, cwd);
    persistLaunchContext(
      existing.session.name,
      buildLaunchContext({ profile, cwd, label, ...launchMetadata }),
    );
    if (attachedTerminal) {
      const terminal = ensureHeadlessTerminal(existing.session.name);
      if (terminal.state === "unavailable") {
        throw new Error(
          `could not attach a persistent terminal to ${existing.session.slug}: ${terminal.reason}`,
        );
      }
    }
    return {
      name: existing.session.name,
      slug: existing.session.slug,
      ...(agentPane ? { agentPane } : {}),
    };
  }

  const agentCommand = [
    ...anthopicEnvUnsetCommandPrefix(),
    "/bin/bash",
    "-lc",
    terminateOnAgentExit ? STRUCTURED_LOCAL_WRAPPER : LOCAL_WRAPPER,
    ...(terminateOnAgentExit
      ? [command]
      : [
          localRelaunchCommand(
            profile,
            cwd,
            label,
            metadata.resumeId ? ["--resume", metadata.resumeId] : [],
          ),
          command,
        ]),
    ...args,
  ];
  const r = spawnSync(
    TMUX,
    [
      "new-session",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      ...tmuxEnvironmentArgs(sessionClass),
      "-s",
      name,
      // Launcher contract (a2a): the agent's window is NAMED after the profile
      // (claude/codex/…). One-shot name at creation only — we never touch the
      // automatic-rename option, so live titles elsewhere keep working.
      "-n",
      profile,
      "-c",
      cwd,
      // A detached pane has no actual terminal client. Do not start a TUI
      // there: a process that reads stdin before the PTY client attaches sees
      // EOF, while one that starts rendering can lose the first prompt. Keep a
      // benign pane alive, attach and verify the PTY, then respawn the agent.
      ...(attachedTerminal
        ? ["/bin/bash", "-lc", "exec sleep 86400"]
        : agentCommand),
    ],
    {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "inherit"],
    },
  );
  if (r.status !== 0) {
    throw new Error(`tmux new-session failed (exit ${r.status ?? "?"})`);
  }
  const printedPane = r.stdout?.trim();
  const capturedPane = validTmuxPaneId(printedPane) ? printedPane : undefined;
  const agentPane = persistAgentPaneMetadata(name, profile, cwd, capturedPane);
  if ((terminateOnAgentExit || refuseExisting || attachedTerminal) && !agentPane) {
    killLocalSession(name);
    throw new Error(`tmux did not return a live agent pane for ${slug}`);
  }
  if (attachedTerminal) {
    const terminal = ensureHeadlessTerminal(name);
    if (terminal.state === "unavailable") {
      killLocalSession(name);
      throw new Error(
        `could not attach a persistent terminal to ${slug}: ${terminal.reason}`,
      );
    }
    const respawned = spawnSync(
      TMUX,
      [
        "respawn-pane",
        "-k",
        "-t",
        agentPane!,
        "-c",
        cwd,
        ...tmuxEnvironmentArgs(sessionClass),
        ...agentCommand,
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    if (respawned.status !== 0) {
      killLocalSession(name);
      throw new Error(`tmux could not start the agent pane for ${slug} after terminal attachment`);
    }
  }
  // Record the profile as a session option so `remote ls` can show it.
  spawnSync(TMUX, ["set-option", "-t", name, "@profile", profile], {
    stdio: "ignore",
  });
  persistLaunchContext(name, buildLaunchContext({ profile, cwd, label, ...launchMetadata }));
  installH2aStatusSurface(name);
  return { name, slug, ...(agentPane ? { agentPane } : {}) };
}

/** PID for one exact tmux pane. Session/window targets are deliberately refused. */
export function localSessionPanePid(agentPane: string): number | undefined {
  if (!validTmuxPaneId(agentPane)) return undefined;
  const r = spawnSync(TMUX, ["display", "-p", "-t", agentPane, "#{pane_pid}"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (r.status !== 0 || !r.stdout) return undefined;
  const pid = Number.parseInt(r.stdout.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/**
 * Read the recorded agent pane's pid without discovering or mutating tmux
 * metadata. Status callers use this to prove an attested worker is still the
 * same process, not merely a recycled session name.
 */
export function localSessionAgentPanePid(session: string): number | undefined {
  const agentPane = readSessionOption(session, AGENT_PANE_OPTION);
  return validTmuxPaneId(agentPane) ? localSessionPanePid(agentPane) : undefined;
}

/**
 * Start a HEADLESS delegated job in a detached local tmux session under the
 * run-once-exit wrapper: the CLI runs, its output is captured to `outputLog`,
 * a `resultJson` is written, then the session ENDS. The task lands as a single
 * argv token inside `args` (no shell concat). Idempotent on slug like
 * startLocalSession unless `refuseExisting` is set for structured launches.
 * Returns the session name + slug.
 */
export function startHeadlessSession(
  profile: string,
  command: string,
  cwd: string,
  args: ReadonlyArray<string>,
  resultJson: string,
  outputLog: string,
  label: string,
  tmuxProfile = getTmuxProfileConfig().profile,
  promptInput?: string,
  refuseExisting = false,
  sessionClass?: SessionClass,
): StartLocalResult {
  const slug = slugify(label);
  const name = localSessionName(slug);
  ensureScrollConfig(tmuxProfile);
  const existing = resolveLocalSessionSlug(slug);
  if (existing.kind === "ambiguous") {
    throw new Error(
      `local session ${slug} is ambiguous; use an exact tmux session name`,
    );
  }
  if (existing.kind === "found") {
    if (refuseExisting) {
      throw new Error(`local session ${slug} already exists; no agent was started`);
    }
    return { name: existing.session.name, slug: existing.session.slug };
  }

  const promptFile = promptInput === undefined ? "" : `${resultJson}.prompt`;
  if (promptInput !== undefined) {
    writeFileSync(promptFile, promptInput, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  }

  const r = spawnSync(
    TMUX,
    [
      "new-session",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      ...tmuxEnvironmentArgs(sessionClass),
      "-s",
      name,
      "-n",
      profile,
      "-c",
      cwd,
      ...anthopicEnvUnsetCommandPrefix(),
      "/bin/bash",
      "-lc",
      HEADLESS_WRAPPER,
      resultJson,
      outputLog,
      promptFile,
      command,
      ...args,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  if (r.status !== 0) {
    cleanupHeadlessPromptFile(promptFile);
    throw new Error(`tmux new-session failed (exit ${r.status ?? "?"})`);
  }
  const printedPane = r.stdout?.trim();
  const capturedPane = validTmuxPaneId(printedPane) ? printedPane : undefined;
  const agentPane = persistAgentPaneMetadata(name, profile, cwd, capturedPane);
  if (refuseExisting && !agentPane) {
    cleanupHeadlessPromptFile(promptFile);
    killLocalSession(name);
    throw new Error(`tmux did not return a live agent pane for ${slug}`);
  }
  spawnSync(TMUX, ["set-option", "-t", name, "@profile", profile], {
    stdio: "ignore",
  });
  persistLaunchContext(name, buildLaunchContext({ profile, cwd, label }));
  installH2aStatusSurface(name);
  return {
    name,
    slug,
    ...(agentPane ? { agentPane } : {}),
    ...(promptFile ? { promptFile } : {}),
  };
}

/** Best-effort cleanup for a headless prompt that the wrapper did not consume. */
export function cleanupHeadlessPromptFile(promptFile?: string): void {
  if (!promptFile) return;
  try {
    unlinkSync(promptFile);
  } catch {
    // The wrapper normally unlinks it itself; absence is already success.
  }
}

/**
 * The raw tmux `#{session_attached}` count for a session: 0 = DETACHED (no client
 * attached), ≥1 = a client (a human terminal) is attached. `undefined` when the
 * session is gone / tmux can't be reached. The interactive throttle auto-resume
 * uses this as its HARD guard — it only ever nudges a pane whose count is 0, so
 * we never send keys into a session a human is driving. Best-effort.
 */
export function sessionAttachedCount(name: string): number | undefined {
  const r = spawnSync(
    TMUX,
    ["display", "-p", "-t", exactSessionTarget(name), "#{session_attached}"],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || r.stdout === undefined) return undefined;
  const n = Number.parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Last `lines` of a session's main pane (interactive job logs). "" if gone. */
export function capturePane(name: string, lines = 200): string {
  const r = spawnSync(
    TMUX,
    ["capture-pane", "-p", "-t", name, "-S", `-${lines}`],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || !r.stdout) return "";
  return r.stdout;
}

/**
 * tmux args adding a detached NAMED window to an existing session, running
 * `commandLine` (a shell line, quoting preserved) under the drop-to-shell
 * wrapper. Pure — exported for tests.
 */
export function buildSessionWindowArgs(
  session: string,
  windowName: string,
  cwd: string,
  commandLine: string,
  agentPane?: string,
): string[] {
  return [
    "new-window",
    "-d",
    "-t",
    session,
    "-n",
    windowName,
    "-c",
    cwd,
    "/bin/bash",
    "-lc",
    WINDOW_WRAPPER,
    "remote-window",
    agentPane ?? "",
    commandLine,
  ];
}

/**
 * Structured sidecar window: capture the exact pane and terminate it with the
 * command. There is deliberately no fallback shell that could hide a dead MCP.
 */
export function buildStructuredSessionWindowArgs(
  session: string,
  windowName: string,
  cwd: string,
  commandLine: string,
  agentPane: string,
  readiness: { readonly file: string; readonly nonce: string },
): string[] {
  return [
    "new-window",
    "-d",
    "-P",
    "-F",
    "#{pane_id}",
    "-e",
    `${H2A_MCP_READY_FILE_ENV}=${readiness.file}`,
    "-e",
    `${H2A_MCP_READY_NONCE_ENV}=${readiness.nonce}`,
    "-t",
    session,
    "-n",
    windowName,
    "-c",
    cwd,
    "/bin/bash",
    "-lc",
    STRUCTURED_WINDOW_WRAPPER,
    "structured-window",
    agentPane,
    commandLine,
  ];
}

/** Window names of a session (best-effort; [] if tmux/session is gone). */
export function sessionWindowNames(session: string): string[] {
  const r = spawnSync(
    TMUX,
    ["list-windows", "-t", session, "-F", "#{window_name}"],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout.split("\n").filter(Boolean);
}

/** Add a detached named window running `commandLine` to an existing session. */
export function addSessionWindow(
  session: string,
  windowName: string,
  cwd: string,
  commandLine: string,
  agentPane?: string,
): boolean {
  const r = spawnSync(
    TMUX,
    buildSessionWindowArgs(session, windowName, cwd, commandLine, agentPane),
    { stdio: "ignore" },
  );
  return r.status === 0;
}

/** Is `cmd` resolvable in PATH (login shell, same as the tmux windows use)? */
export function commandAvailable(cmd: string): boolean {
  try {
    return (
      spawnSync("bash", ["-lc", `command -v -- ${cmd}`], { stdio: "ignore" })
        .status === 0
    );
  } catch {
    return false;
  }
}

function validTmuxPaneId(value: string | undefined): value is string {
  return value !== undefined && /^%\d+$/.test(value);
}

/**
 * Exact, fail-closed SESSION target for `-t`, for both `show-options` and
 * `set-option`.
 *
 * Measured on tmux 3.6:
 *   -t <name>     bare  -> resolves exact THEN unique-PREFIX, so `set-option -t
 *                          h2a-foo` mutates `h2a-foobar` when h2a-foo is gone.
 *   -t =<name>          -> `=` marks a PANE target here; both commands miss the
 *                          session, and `-q` swallows the error so a read returns
 *                          "" — which is why the status surface silently never
 *                          installed on this tmux.
 *   -t =<name>:         -> `=` exact + trailing `:` (the session's target):
 *                          resolves the EXACT session, fails closed when it is
 *                          absent, and works for read and write alike.
 * So the correct exact-session form is `=<name>:`.
 */
function exactSessionTarget(session: string): string {
  const bare = session.replace(/^=/, "").replace(/:$/, "");
  return `=${bare}:`;
}

function readSessionOption(
  session: string,
  option: string,
): string | undefined {
  const r = spawnSync(
    TMUX,
    ["show-options", "-qv", "-t", exactSessionTarget(session), option],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || r.stdout === undefined) return undefined;
  const value = r.stdout.trim();
  return value || undefined;
}

function readSessionOptionRaw(
  session: string,
  option: string,
): string | undefined {
  const result = spawnSync(
    TMUX,
    ["show-options", "-qv", "-t", exactSessionTarget(session), option],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || result.stdout === undefined) return undefined;
  return result.stdout.replace(/\r?\n$/, "");
}

function setSessionOption(
  session: string,
  option: string,
  value: string,
): boolean {
  return spawnSync(
    TMUX,
    ["set-option", "-t", exactSessionTarget(session), option, value],
    {
      stdio: "ignore",
    },
  ).status === 0;
}

function unsetSessionOption(session: string, option: string): boolean {
  return spawnSync(
    TMUX,
    ["set-option", "-u", "-t", exactSessionTarget(session), option],
    { stdio: "ignore" },
  ).status === 0;
}

/** Directory under the h2a root where the bar writer publishes per-session text. */
export const STATUS_BAR_DIR = "status-bar";

/**
 * Lock file the bar writer holds inside the status-bar directory. The writer
 * side of this contract lives in @sentropic/h2a (status-bar-writer.ts); the
 * name is duplicated there because the CLI is a peer, not an import.
 */
const STATUS_BAR_WRITER_LOCK = "writer.lock";
const STATUS_BAR_WRITER_STALE_MS = 60_000;

function h2aRootForStatusBar(root?: string): string {
  return root ?? process.env.H2A_ROOT ?? defaultLocalH2aRoot();
}

/** Directory holding the writer lease and every per-session bar file. */
export function statusBarRoot(root?: string): string {
  return join(h2aRootForStatusBar(root), STATUS_BAR_DIR);
}

/**
 * Filesystem-safe, collision-free per-session bar file pair. The sanitized
 * name keeps files greppable; the hash keeps two sessions whose names differ
 * only by an unsafe character from sharing a file.
 */
export function statusBarFilesForSession(
  session: string,
  root?: string,
): { readonly left: string; readonly right: string } {
  const safe = session.replace(/[^A-Za-z0-9_.-]/g, "_");
  const hash = createHash("sha256").update(session).digest("hex").slice(0, 8);
  const base = join(statusBarRoot(root), `${safe}-${hash}`);
  return { left: `${base}.left`, right: `${base}.right` };
}

/**
 * Embed a path in a status option: single-quoted for the /bin/sh that runs
 * #() commands, with tmux format (#) and strftime (%) expansion escaped. The
 * escape only matters for exotic H2A_ROOT values — session file names are
 * sanitized to characters both layers pass through verbatim.
 */
function statusOptionPath(path: string): string {
  return shellSingleQuote(path).replace(/#/g, "##").replace(/%/g, "%%");
}

/**
 * The 2026-07-31 spawn-storm rule: tmux re-runs every #(...) here once per
 * status-interval for EVERY installed session, so nothing in these options may
 * start a process heavier than a file read. The bar text is produced by the
 * single background writer (h2a status --write-bars); when the writer or its
 * file is absent the bar falls back to a static placeholder and spawns
 * nothing heavier than the same cat.
 */
export function h2aStatusSurfaceOptions(
  _previousRight = "%H:%M",
  session = "",
): ReadonlyArray<readonly [string, string]> {
  const files = statusBarFilesForSession(session);
  return [
    ["status", "on"],
    ["status-interval", "5"],
    ["status-left-length", "40"],
    ["status-right-length", "200"],
    [
      "status-left",
      `[h2a] #(cat ${statusOptionPath(files.left)} 2>/dev/null || echo 'h2a ?') `,
    ],
    [
      "status-right",
      // Preserve the user's previous value for exact uninstall, but never
      // embed it in the active bar: tmux formats can expand pane/session
      // titles supplied by a host and bypass the status renderer's cap and
      // control/bidi stripping. The fixed clock is bounded, trusted text.
      `#(cat ${statusOptionPath(files.right)} 2>/dev/null || echo 'gw ?')  %H:%M`,
    ],
  ];
}

const H2A_STATUS_SNAPSHOTS = [
  [H2A_STATUS_PREVIOUS_STATUS, "status"],
  [H2A_STATUS_PREVIOUS_LEFT, "status-left"],
  [H2A_STATUS_PREVIOUS_RIGHT, "status-right"],
  [H2A_STATUS_PREVIOUS_INTERVAL, "status-interval"],
  [H2A_STATUS_PREVIOUS_LEFT_LENGTH, "status-left-length"],
  [H2A_STATUS_PREVIOUS_RIGHT_LENGTH, "status-right-length"],
] as const;

export interface H2aStatusOptionAccess {
  readonly read: (session: string, option: string) => string | undefined;
  readonly set: (session: string, option: string, value: string) => boolean;
  readonly unset: (session: string, option: string) => boolean;
}

const TMUX_STATUS_OPTION_ACCESS: H2aStatusOptionAccess = {
  read: readSessionOptionRaw,
  set: setSessionOption,
  unset: unsetSessionOption,
};

function removeStatusMetadata(
  session: string,
  access: H2aStatusOptionAccess,
): boolean {
  let removed = true;
  for (const [snapshot] of H2A_STATUS_SNAPSHOTS) {
    removed = access.unset(session, snapshot) && removed;
  }
  removed = access.unset(session, H2A_STATUS_INSTALLED_OPTION) && removed;
  return removed;
}

/** Restore a prior bar using captured effective values, with retryable recovery state. */
export function uninstallH2aStatusSurfaceWithAccess(
  session: string,
  access: H2aStatusOptionAccess,
): boolean {
  const marker = access.read(session, H2A_STATUS_INSTALLED_OPTION);
  if (marker === H2A_STATUS_RESTORED) return removeStatusMetadata(session, access);
  if (marker !== "v1" && marker !== H2A_STATUS_INSTALLING) return false;

  const captured = H2A_STATUS_SNAPSHOTS.map(([snapshot, option]) => ({
    snapshot,
    option,
    value: access.read(session, snapshot),
  }));
  if (captured.some((item) => item.value === undefined)) return false;

  let restored = true;
  for (const item of captured) {
    restored = access.set(session, item.option, item.value ?? "") && restored;
  }
  if (!restored) return false;
  if (!access.set(session, H2A_STATUS_INSTALLED_OPTION, H2A_STATUS_RESTORED)) {
    return false;
  }
  return removeStatusMetadata(session, access);
}

/**
 * Install transaction used by the tmux wrapper and executable failure-injection
 * tests. No live option changes until all six prior values are captured.
 */
export function installH2aStatusSurfaceWithAccess(
  session: string,
  access: H2aStatusOptionAccess,
): boolean {
  let marker = access.read(session, H2A_STATUS_INSTALLED_OPTION);
  if (marker === H2A_STATUS_INSTALLING || marker === H2A_STATUS_RESTORED) {
    if (!uninstallH2aStatusSurfaceWithAccess(session, access)) return false;
    marker = undefined;
  }

  if (marker !== "v1") {
    const captured = H2A_STATUS_SNAPSHOTS.map(([snapshot, option]) => ({
      snapshot,
      value: access.read(session, option),
    }));
    if (captured.some((item) => item.value === undefined)) return false;

    const written: string[] = [];
    for (const item of captured) {
      if (!access.set(session, item.snapshot, item.value ?? "")) {
        for (const snapshot of written) access.unset(session, snapshot);
        return false;
      }
      written.push(item.snapshot);
    }
    if (!access.set(session, H2A_STATUS_INSTALLED_OPTION, H2A_STATUS_INSTALLING)) {
      for (const snapshot of written) access.unset(session, snapshot);
      return false;
    }
  }

  const previousRight = access.read(session, H2A_STATUS_PREVIOUS_RIGHT);
  if (previousRight === undefined) return false;
  let applied = true;
  for (const [option, value] of h2aStatusSurfaceOptions(previousRight, session)) {
    applied = access.set(session, option, value) && applied;
  }
  applied = access.set(session, H2A_STATUS_INSTALLED_OPTION, "v1") && applied;
  if (applied) return true;

  // A failed live write may have partially changed the bar. Restore all six
  // captured values; retained metadata makes an incomplete recovery retryable.
  uninstallH2aStatusSurfaceWithAccess(session, access);
  return false;
}

function statusBarWriterAlive(dir: string): boolean {
  try {
    const lockPath = join(dir, STATUS_BAR_WRITER_LOCK);
    if (Date.now() - statSync(lockPath).mtimeMs > STATUS_BAR_WRITER_STALE_MS) {
      return false;
    }
    const holder = JSON.parse(readFileSync(lockPath, "utf8")) as {
      pid?: number;
    };
    if (typeof holder.pid !== "number") return false;
    process.kill(holder.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the single background bar writer when none is alive. Idempotent and
 * fail-safe: the spawned writer exits immediately if another one holds the
 * lease, and when no writer can start at all the installed bar shows its
 * static placeholders instead of ever spawning per refresh.
 */
export function ensureStatusBarWriter(root?: string): void {
  const resolvedRoot = h2aRootForStatusBar(root);
  try {
    if (statusBarWriterAlive(statusBarRoot(resolvedRoot))) return;
    const child = spawn(
      "h2a",
      ["status", "--write-bars", "--root", resolvedRoot],
      { detached: true, stdio: "ignore" },
    );
    child.on("error", () => {});
    child.unref();
  } catch {
    // Fail safe: without a writer the bar keeps its static placeholders.
  }
}

export interface StatusBarTarget {
  readonly session: string;
  readonly ownerInstance?: string;
  readonly clientWidth?: number;
}

/**
 * Managed sessions whose installed surface expects bar files. One bounded
 * tmux call for sessions plus one for client widths, regardless of session
 * count — the writer must never pay a per-session subprocess per tick.
 */
export function listStatusBarTargets(): StatusBarTarget[] {
  const sessions = spawnSync(
    TMUX,
    [
      "list-sessions",
      "-F",
      `#{session_name}\t#{${H2A_STATUS_INSTALLED_OPTION}}\t#{@h2a_owner_instance}`,
    ],
    { encoding: "utf8" },
  );
  if (sessions.status !== 0 || !sessions.stdout) return [];
  const widths = new Map<string, number>();
  const clients = spawnSync(
    TMUX,
    ["list-clients", "-F", "#{client_session}\t#{client_width}"],
    { encoding: "utf8" },
  );
  if (clients.status === 0 && clients.stdout) {
    for (const line of clients.stdout.split("\n")) {
      const [session, width] = line.split("\t");
      const value = Number(width);
      if (session && Number.isFinite(value) && value > 0) {
        widths.set(session, Math.max(widths.get(session) ?? 0, value));
      }
    }
  }
  const targets: StatusBarTarget[] = [];
  for (const line of sessions.stdout.split("\n")) {
    if (!line) continue;
    const [name, marker, owner] = line.split("\t");
    if (!name || marker !== "v1" || !parseManagedSessionName(name)) continue;
    const width = widths.get(name);
    targets.push({
      session: name,
      ...(owner ? { ownerInstance: owner } : {}),
      ...(width ? { clientWidth: width } : {}),
    });
  }
  return targets;
}

/** Install the composable 5-second status projection on one exact session. */
export function installH2aStatusSurface(session: string): boolean {
  if (!parseManagedSessionName(session)) return false;
  if (!listLocalSessions().some((item) => item.name === session)) return false;
  const installed = installH2aStatusSurfaceWithAccess(
    session,
    TMUX_STATUS_OPTION_ACCESS,
  );
  if (installed) ensureStatusBarWriter();
  return installed;
}

/** Restore every user option captured on first install. */
export function uninstallH2aStatusSurface(session: string): boolean {
  return uninstallH2aStatusSurfaceWithAccess(session, TMUX_STATUS_OPTION_ACCESS);
}

export function h2aStatusWindowCommand(
  session: string,
  ownerInstance: string | undefined,
): string {
  const quotedSession = shellSingleQuote(session);
  const quotedOwner = ownerInstance &&
      /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,255}$/.test(ownerInstance)
    ? ` --owner-instance ${shellSingleQuote(ownerInstance)}`
    : "";
  return `h2a status --human --watch --tmux-session ${quotedSession}${quotedOwner}`;
}

/** Open or reuse the detailed in-process watcher in a distinct tmux window. */
export function openH2aStatusWindow(
  session: string,
  cwd: string,
): boolean {
  if (!parseManagedSessionName(session)) return false;
  if (sessionWindowNames(session).includes(H2A_STATUS_WINDOW_NAME)) return true;
  // The same exact session option used by the bar is carried into the human
  // companion; without it J/I must deliberately remain UNKNOWN.
  const owner = readSessionOption(session, "@h2a_owner_instance");
  return addSessionWindow(
    session,
    H2A_STATUS_WINDOW_NAME,
    cwd,
    h2aStatusWindowCommand(session, owner),
  );
}

/** Exact current tmux session, only when this process is itself inside tmux. */
export function currentTmuxSessionName(): string | undefined {
  if (!process.env.TMUX) return undefined;
  const result = spawnSync(TMUX, ["display-message", "-p", "#{session_name}"], {
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout) return undefined;
  const name = result.stdout.trim();
  return name || undefined;
}

function firstNonH2aPane(session: string): string | undefined {
  const r = spawnSync(
    TMUX,
    [
      "list-panes",
      "-s",
      "-t",
      exactSessionTarget(session),
      "-F",
      "#{window_name}\t#{pane_id}",
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || !r.stdout) return undefined;
  for (const line of r.stdout.split("\n")) {
    if (!line) continue;
    const [windowName, paneId] = line.split("\t");
    if (windowName !== H2A_WINDOW_NAME && validTmuxPaneId(paneId)) {
      return paneId;
    }
  }
  return undefined;
}

/**
 * Resolve the durable agent pane for a given h2a instance.
 * Parses host:label[:uuid] → finds the matching managed tmux session
 * (h2a-<label> or legacy remote-<label>, @remote_agent_host === host) → returns
 * its @remote_agent_pane.
 * Returns undefined if no pane is known for this instance.
 */
export function resolveAgentPaneForInstance(
  instance: string,
): string | undefined {
  const parts = instance.split(":");
  if (parts.length < 2) return undefined;
  const host = parts[0];
  const label = parts[1];
  if (!host || !label) return undefined;
  const sessions = listLocalSessions();
  const resolved = resolveLocalSessionSlug(label, sessions);
  if (resolved.kind !== "found") return undefined;
  const match =
    readSessionOption(resolved.session.name, AGENT_HOST_OPTION) === host
      ? resolved.session
      : undefined;
  if (!match) return undefined;
  return resolveAgentPane(match.name);
}

/** Agent pane used as h2a local-tmux wake target, persisted on the tmux session. */
export function resolveAgentPane(session: string): string | undefined {
  const stored = readSessionOption(session, AGENT_PANE_OPTION);
  if (validTmuxPaneId(stored)) return stored;
  const pane = firstNonH2aPane(session);
  if (pane) setSessionOption(session, AGENT_PANE_OPTION, pane);
  return pane;
}

function persistAgentPaneMetadata(
  session: string,
  profile: string,
  cwd: string,
  capturedPane?: string,
): string | undefined {
  const pane = validTmuxPaneId(capturedPane)
    ? capturedPane
    : resolveAgentPane(session);
  if (!pane) return undefined;
  setSessionOption(session, AGENT_PANE_OPTION, pane);
  setSessionOption(session, AGENT_HOST_OPTION, profile);
  setSessionOption(session, AGENT_CWD_OPTION, cwd);
  return pane;
}

/**
 * Record the diagnostic launch context (gateway on/off, model-map source, resume id, …) as
 * `@remote_launch_*` tmux options so `h2a` can show WHICH options produced the session without
 * the user reading raw tmux state. Applied on every create AND reuse so a reused session refreshes
 * a stale context. Best-effort + secret-free (see launch-context.ts). Spec 2026-07-11.
 */
export function persistLaunchContext(session: string, ctx: LaunchContext): void {
  for (const [key, value] of launchContextOptions(ctx)) {
    setSessionOption(session, key, value);
  }
}

/** Read the launch context recorded on a managed session, or undefined if none. */
export function readLaunchContext(session: string): LaunchContext | undefined {
  return parseLaunchContext((key) => readSessionOption(session, key));
}

function commandNeedsLocalTmuxWake(commandLine: string): boolean {
  return /(?:^|\s)--wake(?:=|\s+)local-tmux(?:\s|$)/.test(commandLine);
}

/**
 * Opt-in launcher contract: start `h2a mcp-serve …` in a side window named
 * "h2a" of the agent's tmux session, so the agent is reachable/wakeable by the
 * h2a file-based network. Never fails the run: a missing h2a binary (or tmux
 * error) is a warning, and an already-present "h2a" window is reused as-is.
 */
export function startH2aWindow(
  session: string,
  cwd: string,
  commandLine: string,
  stderr: { write(chunk: string): unknown } = process.stderr,
): boolean {
  const bin = commandLine.trim().split(/\s+/)[0] ?? "";
  if (!bin || !commandAvailable(bin)) {
    stderr.write(
      `[h2a] h2a window skipped: \`${bin || commandLine}\` not found in PATH — install h2a (or fix the h2a.command config) and re-run with --h2a.\n`,
    );
    return false;
  }
  const needsLocalTmuxWake = commandNeedsLocalTmuxWake(commandLine);
  if (sessionWindowNames(session).includes(H2A_WINDOW_NAME)) {
    if (needsLocalTmuxWake) {
      stderr.write(
        `[h2a] h2a window already exists in ${session}; wake target may be stale/wrong. Restart that window/session to pick up the agent pane target.\n`,
      );
    }
    return true;
  }
  const agentPane = resolveAgentPane(session);
  if (needsLocalTmuxWake && !agentPane) {
    stderr.write(
      `[h2a] h2a window skipped: agent pane could not be resolved for ${session}; refusing to publish a false --wake local-tmux target.\n`,
    );
    return false;
  }
  if (
    !addSessionWindow(session, H2A_WINDOW_NAME, cwd, commandLine, agentPane)
  ) {
    stderr.write(
      `[h2a] h2a window failed to start (tmux new-window error on ${session})\n`,
    );
    return false;
  }
  // Record the requested h2a side-window command in the session's launch context (redacted).
  setSessionOption(session, `${LAUNCH_OPTION_PREFIX}h2a`, redactSecrets(commandLine));
  return true;
}

export type StructuredSidecarVerificationOptions = {
  /** Maximum correlated-readiness probes before timeout. */
  attempts?: number;
  /** Settle time before each observation. */
  intervalMs?: number;
  /** Test seam; production defaults to a real timer. */
  delay?: (ms: number) => Promise<void>;
};

export type StructuredH2aWindow = {
  pane: string;
  pid: number;
};

type StructuredReadinessChallenge = {
  directory: string;
  file: string;
  nonce: string;
};

function createStructuredReadinessChallenge(): StructuredReadinessChallenge {
  const directory = mkdtempSync(join(tmpdir(), "h2a-mcp-ready-"));
  return {
    directory,
    file: join(directory, "ready.json"),
    nonce: randomUUID(),
  };
}

function cleanupStructuredReadinessChallenge(
  challenge: StructuredReadinessChallenge,
): void {
  try {
    rmSync(challenge.directory, { recursive: true, force: true });
  } catch {
    // Best effort; never mask the launch result.
  }
}

type ReadinessProbe =
  | { state: "missing" }
  | { state: "invalid" }
  | { state: "ready"; pid: number };

function probeStructuredReadiness(
  challenge: StructuredReadinessChallenge,
  expectedPanePid: number,
): ReadinessProbe {
  let raw: string;
  try {
    const stat = statSync(challenge.file);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) {
      return { state: "invalid" };
    }
    raw = readFileSync(challenge.file, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { state: "missing" }
      : { state: "invalid" };
  }
  try {
    const ack = JSON.parse(raw) as Record<string, unknown>;
    if (
      ack.kind !== H2A_MCP_READY_KIND ||
      ack.version !== 1 ||
      ack.nonce !== challenge.nonce ||
      !Number.isInteger(ack.pid) ||
      ack.pid !== expectedPanePid ||
      typeof ack.sessionId !== "string" ||
      ack.sessionId.length === 0
    ) {
      return { state: "invalid" };
    }
    return { state: "ready", pid: ack.pid as number };
  } catch {
    return { state: "invalid" };
  }
}

function stopStructuredSidecar(pane: string): void {
  spawnSync(TMUX, ["kill-pane", "-t", pane], { stdio: "ignore" });
}

/**
 * Fail-closed structured sidecar launch. Success means the exact agent pane is
 * still live and the captured sidecar pane produced a nonce- and PID-correlated
 * ACK after auto-open. A successful `new-window` or matching argv is never enough.
 */
export async function startH2aWindowVerified(
  session: string,
  cwd: string,
  commandLine: string,
  agentPane: string,
  stderr: { write(chunk: string): unknown } = process.stderr,
  options: StructuredSidecarVerificationOptions = {},
): Promise<StructuredH2aWindow | undefined> {
  const bin = commandLine.trim().split(/\s+/)[0] ?? "";
  if (!bin || !commandAvailable(bin)) {
    stderr.write(
      `[h2a] required h2a sidecar unavailable: \`${bin || commandLine}\` not found in PATH.\n`,
    );
    return undefined;
  }
  if (!validTmuxPaneId(agentPane) || localSessionPanePid(agentPane) === undefined) {
    stderr.write(
      `[h2a] required h2a sidecar refused: agent pane ${agentPane || "<missing>"} is not live.\n`,
    );
    return undefined;
  }
  if (sessionWindowNames(session).includes(H2A_WINDOW_NAME)) {
    stderr.write(
      `[h2a] required h2a sidecar refused: ${H2A_WINDOW_NAME} window already exists in ${session}.\n`,
    );
    return undefined;
  }
  const challenge = createStructuredReadinessChallenge();
  let sidecarPane: string | undefined;
  try {
    const r = spawnSync(
      TMUX,
      buildStructuredSessionWindowArgs(
        session,
        H2A_WINDOW_NAME,
        cwd,
        commandLine,
        agentPane,
        challenge,
      ),
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    sidecarPane = r.stdout?.trim();
    if (r.status !== 0 || !validTmuxPaneId(sidecarPane)) {
      stderr.write(
        `[h2a] required h2a sidecar failed to capture a pane in ${session}.\n`,
      );
      return undefined;
    }

    const attempts = Math.max(2, options.attempts ?? 200);
    const intervalMs = Math.max(1, options.intervalMs ?? 100);
    const delay =
      options.delay ??
      ((ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let stablePid: number | undefined;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await delay(intervalMs);
      const agentPid = localSessionPanePid(agentPane);
      const sidecarPid = localSessionPanePid(sidecarPane);
      if (
        agentPid === undefined ||
        sidecarPid === undefined ||
        (stablePid !== undefined && sidecarPid !== stablePid)
      ) {
        stopStructuredSidecar(sidecarPane);
        stderr.write(
          `[h2a] required h2a sidecar failed pane/PID guard in ${session}.\n`,
        );
        return undefined;
      }
      stablePid = sidecarPid;
      const readiness = probeStructuredReadiness(challenge, sidecarPid);
      if (readiness.state === "invalid") {
        stopStructuredSidecar(sidecarPane);
        stderr.write(
          `[h2a] required h2a sidecar returned an invalid readiness ACK in ${session}.\n`,
        );
        return undefined;
      }
      if (readiness.state === "ready") {
        setSessionOption(
          session,
          `${LAUNCH_OPTION_PREFIX}h2a`,
          redactSecrets(commandLine),
        );
        return { pane: sidecarPane, pid: readiness.pid };
      }
    }
    stopStructuredSidecar(sidecarPane);
    stderr.write(
      `[h2a] required h2a sidecar timed out waiting for correlated readiness ACK in ${session}.\n`,
    );
    return undefined;
  } finally {
    cleanupStructuredReadinessChallenge(challenge);
  }
}

/**
 * Attach the real terminal to a local tmux session. Blocks until the user
 * detaches (Ctrl-b d) or the session ends. Returns the tmux exit status.
 */
export function attachLocalSession(name: string): number {
  ensureScrollConfig();
  const args = process.env.TMUX
    ? ["switch-client", "-t", `=${name}`]
    : ["attach-session", "-t", `=${name}`];
  const r = spawnSync(TMUX, args, { stdio: "inherit" });
  return r.status ?? 0;
}

export function currentTmuxSessionIs(name: string): boolean {
  if (!process.env.TMUX) return false;
  const r = spawnSync(TMUX, ["display-message", "-p", "#S"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return r.status === 0 && r.stdout.trim() === name;
}

export function runLocalCliForeground(command: string, args: string[]): number {
  const r = spawnSync(command, args, { stdio: "inherit" });
  return r.status ?? 0;
}

/** Kill a local tmux session. */
export function killLocalSession(name: string): boolean {
  const r = spawnSync(TMUX, ["kill-session", "-t", exactSessionTarget(name)], {
    stdio: "ignore",
  });
  return r.status === 0;
}

/**
 * M3 — is a `remote jobs conduct` conductor process running right now? Used by
 * `jobs ls` to warn when there are queued jobs but nothing to drain them. Matches
 * the conductor's command line via pgrep, NOT a tmux marker (the conductor may run
 * in any window/shell). Best-effort: any error (no pgrep, etc.) returns false so
 * we err toward SHOWING the advisory rather than hiding a real stall. Excludes the
 * current pid so a `conduct` process that itself shells out to `jobs ls` for
 * status doesn't self-detect.
 */
export function conductorRunning(): boolean {
  try {
    const r = spawnSync("pgrep", ["-f", "jobs +conduct"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (r.status !== 0 || !r.stdout) return false;
    const pids = r.stdout
      .split("\n")
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
    return pids.length > 0;
  } catch {
    return false;
  }
}

/**
 * True when a session's main pane is an IDLE shell (its CLI exited and dropped
 * to the wrapper's `bash -l`). Idle = pane command is bash/sh AND that pane
 * process has no child — the relaunch wrapper keeps the CLI as a child of bash,
 * so `pane_current_command` alone reads "bash" even with a live CLI; the child
 * count disambiguates. `/proc` scan because the relaunch wrapper context may
 * lack ps; falls back to ps when /proc is unavailable. Best-effort: on any
 * doubt returns false (treat as live → never disturbed).
 */
export function localSessionIdle(name: string): boolean {
  const disp = spawnSync(
    TMUX,
    ["display", "-p", "-t", name, "#{pane_pid} #{pane_current_command}"],
    { encoding: "utf8" },
  );
  if (disp.status !== 0 || !disp.stdout) return false;
  const [pidStr, cmd = ""] = disp.stdout.trim().split(/\s+/);
  if (cmd !== "bash" && cmd !== "sh") return false;
  const pid = Number(pidStr);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  // Count children of the pane shell.
  const children = spawnSync(
    "bash",
    [
      "-lc",
      `awk -v p="${pid}" '$1=="PPid:" && $2==p {c++} END{print c+0}' /proc/[0-9]*/status 2>/dev/null || ps --ppid ${pid} -o pid= 2>/dev/null | grep -c .`,
    ],
    { encoding: "utf8" },
  );
  const kids = Number((children.stdout ?? "").trim());
  return Number.isInteger(kids) && kids === 0;
}

const RELAUNCH_LIVENESS_SAMPLE_MS = 250;

export type RelaunchSafetyProbe = {
  resolvePane?: (name: string) => string | undefined;
  panePid?: (pane: string) => number | undefined;
  paneCommand?: (pane: string) => string | undefined;
  observe?: (pane: string) => ProcessObservation | undefined;
  sleep?: (ms: number) => void;
  now?: () => number;
};

function paneCurrentCommand(pane: string): string | undefined {
  const result = spawnSync(
    TMUX,
    ["display", "-p", "-t", pane, "#{pane_current_command}"],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || result.stdout === undefined) return undefined;
  const command = result.stdout.trim();
  return command || undefined;
}

/**
 * Fail-closed liveness evidence for the relaunch path.
 *
 * `localSessionIdle` remains available to its other callers, but relaunch must
 * not use its flaky child-count shellout. This probe uses the merged worker
 * attribution and process-tree CPU signal instead. Any unreadable pane, worker,
 * or CPU sample is deliberately projected to the hard skip floor.
 */
export function sessionRelaunchSafety(
  name: string,
  probe: RelaunchSafetyProbe = {},
): RelaunchSafety {
  try {
    const resolvePane = probe.resolvePane ?? resolveAgentPane;
    const readPanePid = probe.panePid ?? localSessionPanePid;
    const readPaneCommand = probe.paneCommand ?? paneCurrentCommand;
    const observe = probe.observe ?? paneProcessObservation;
    const sleep = probe.sleep ?? sleepBlocking;
    const now = probe.now ?? Date.now;
    const pane = resolvePane(name);
    if (!pane) {
      return {
        dead: false,
        activatable: false,
        indeterminate: true,
        activelyWorking: true,
        reason: "liveness indeterminate: agent pane is unreadable",
      };
    }
    const panePid = readPanePid(pane);
    const paneCommand = readPaneCommand(pane);
    if (panePid === undefined || paneCommand === undefined) {
      return decideRelaunchSafety({ paneCommand, panePid });
    }

    const startedAt = now();
    const first = observe(pane);
    sleep(RELAUNCH_LIVENESS_SAMPLE_MS);
    const second = observe(pane);
    return decideRelaunchSafety({
      paneCommand,
      panePid,
      firstWorkerPid: first?.worker?.pid,
      secondWorkerPid: second?.worker?.pid,
      firstCpuMs: first?.cpuMs,
      secondCpuMs: second?.cpuMs,
      elapsedMs: now() - startedAt,
    });
  } catch {
    return {
      dead: false,
      activatable: false,
      indeterminate: true,
      activelyWorking: true,
      reason: "liveness indeterminate: worker/CPU probe failed",
    };
  }
}

export type LocalSessionGatewayEnvStatus =
  | "current"
  | "missing"
  | "stale"
  | "unknown";

function directChildPids(pid: number): number[] {
  const children = spawnSync("ps", ["--ppid", String(pid), "-o", "pid="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (children.status !== 0 || !children.stdout) return [];
  return children.stdout
    .split("\n")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function readProcessEnvironment(pid: number): Record<string, string> | null {
  try {
    const raw = readFileSync(`/proc/${pid}/environ`, "utf8");
    const env: Record<string, string> = {};
    for (const part of raw.split("\0")) {
      const i = part.indexOf("=");
      if (i > 0) env[part.slice(0, i)] = part.slice(i + 1);
    }
    return env;
  } catch {
    return null;
  }
}

/**
 * Inspect the real CLI child process under the tmux wrapper and compare its
 * Anthropic gateway env with the token remote is about to use. Unknown is
 * deliberately non-actionable; callers should only repair missing/stale.
 */
export function localSessionGatewayEnvStatus(
  name: string,
  expected: { baseUrl: string; authToken: string },
): LocalSessionGatewayEnvStatus {
  const disp = spawnSync(TMUX, ["display", "-p", "-t", name, "#{pane_pid}"], {
    encoding: "utf8",
  });
  if (disp.status !== 0 || !disp.stdout) return "unknown";
  const panePid = Number.parseInt(disp.stdout.trim(), 10);
  if (!Number.isInteger(panePid) || panePid <= 0) return "unknown";
  const [childPid] = directChildPids(panePid);
  const env = readProcessEnvironment(childPid ?? panePid);
  if (!env) return "unknown";
  const baseUrl = env.ANTHROPIC_BASE_URL;
  const authToken = env.ANTHROPIC_AUTH_TOKEN;
  if (!baseUrl || !authToken) return "missing";
  if (baseUrl !== expected.baseUrl || authToken !== expected.authToken) {
    return "stale";
  }
  return "current";
}

/**
 * Relaunch a CLI inside an EXISTING session's main pane, in situ: send the
 * command to the idle shell (it runs at the prompt; when it exits the shell is
 * still there). Does NOT recreate windows or go through `remote run`/the guard.
 */
export function relaunchInSession(name: string, command: string): boolean {
  const r = spawnSync(TMUX, ["send-keys", "-t", name, command, "Enter"], {
    stdio: "ignore",
  });
  return r.status === 0;
}

/**
 * Is a tmux session ATTACHED right now (a client is connected)? Reads
 * `#{session_attached}` for the EXACT session ("=" prefix → no prefix match).
 * Returns true (CONSERVATIVE) on ANY doubt — missing/erroring tmux, unparseable
 * count — so the interactive throttle resume NEVER types into a pane we cannot
 * prove is detached. The throttle-phase-2 HARD GUARD lives here AND in the pure
 * planner; this is the live, last-line-of-defence re-check.
 */
export function sessionAttached(name: string): boolean {
  try {
    const r = spawnSync(
      TMUX,
      ["display", "-p", "-t", exactSessionTarget(name), "#{session_attached}"],
      { encoding: "utf8" },
    );
    if (r.status !== 0) return true; // can't tell → assume attached (never nudge)
    const n = Number((r.stdout ?? "").trim());
    if (!Number.isInteger(n)) return true; // unparseable → assume attached
    return n !== 0;
  } catch {
    return true; // tmux blew up → assume attached (never nudge)
  }
}

/**
 * Paste a LITERAL line into a session's main pane, then submit it with a real
 * Enter key event. Content reaches `tmux load-buffer -` on stdin, then a named
 * buffer is pasted: arbitrary text is never interpreted by a shell and never
 * appears in a process argv. Enter is a separate key-name event. Used for
 * interactive throttle nudges (single lines).
 */
export function sendKeysLiteral(name: string, keys: string): boolean {
  if (!loadAndPaste(name, keys, false)) return false;
  const enter = spawnSync(TMUX, ["send-keys", "-t", name, "Enter"], {
    stdio: "ignore",
  });
  return enter.status === 0;
}

function loadAndPaste(name: string, keys: string, bracketed: boolean): boolean {
  const buffer = `h2a-${process.pid}-${randomUUID()}`;
  const loaded = spawnSync(TMUX, ["load-buffer", "-b", buffer, "-"], {
    input: keys,
    encoding: "utf8",
    stdio: ["pipe", "ignore", "ignore"],
  });
  if (loaded.status !== 0) return false;
  const pasted = spawnSync(
    TMUX,
    [
      "paste-buffer",
      ...(bracketed ? ["-p"] : []),
      "-b",
      buffer,
      "-d",
      "-t",
      name,
    ],
    { stdio: "ignore" },
  );
  if (pasted.status !== 0) {
    spawnSync(TMUX, ["delete-buffer", "-b", buffer], { stdio: "ignore" });
    return false;
  }
  return true;
}

/**
 * Paste text as ONE block, WITHOUT submitting it.
 *
 * `-p` wraps the payload in bracketed-paste markers. Measured 2026-07-29 on
 * Claude Code 2.1.220: without `-p`, a multi-line brief is submitted line by
 * line — line 1 left as its own request while line 2 stayed in the composer.
 * With `-p` the whole block lands as a single entry that one Enter submits.
 */
export function pasteLiteralBlock(name: string, keys: string): boolean {
  return loadAndPaste(name, keys, true);
}

/** Submit whatever the composer currently holds (one real Enter key event). */
export function submitPane(name: string): boolean {
  const r = spawnSync(TMUX, ["send-keys", "-t", name, "Enter"], {
    stdio: "ignore",
  });
  return r.status === 0;
}

/**
 * Best-effort composer wipe. Ctrl-U only kills to the start of the CURRENT
 * line, so a multi-line composer needs several — measured: one C-u left a
 * multi-line brief in place, and retrying the paste then STACKED copies.
 * Delivery never depends on this succeeding; it types only once.
 */
export function clearPaneComposer(name: string): boolean {
  let ok = true;
  for (let i = 0; i < 4; i += 1) {
    const r = spawnSync(TMUX, ["send-keys", "-t", name, "C-u"], {
      stdio: "ignore",
    });
    ok = ok && r.status === 0;
  }
  return ok;
}

/**
 * VISIBLE text of one pane, or undefined when tmux cannot be read — unlike
 * `capturePane`, which flattens a failure into "". Delivery needs the
 * difference: an unreadable pane is not an empty one.
 */
export function capturePaneVisible(pane: string): string | undefined {
  const r = spawnSync(TMUX, ["capture-pane", "-p", "-t", pane], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (r.status !== 0 || r.stdout === undefined) return undefined;
  return r.stdout;
}

/**
 * CPU time (ms) of the process tree behind a pane — the liveness signal used to
 * tell a working agent from one parked on its placeholder.
 */
export function paneTreeCpuMs(pane: string): number | undefined {
  const pid = localSessionPanePid(pane);
  if (pid === undefined) return undefined;
  return readProcessTreeCpuMs(pid, procReaderDeps());
}

/** CPU + worker identity from one /proc snapshot at acquire time. */
export function paneProcessObservation(pane: string): ProcessObservation | undefined {
  const pid = localSessionPanePid(pane);
  if (pid === undefined) return undefined;
  return readProcessObservation(pid, procReaderDeps());
}

/**
 * The pid actually doing the work behind a pane.
 *
 * The pane's own pid is the launch WRAPPER: measured 2026-07-29, it reported 0s
 * of CPU after 37s while its `codex` child had burned 13s. Anything that judges
 * a lane by the reported pid alone — a supervisor, a status bar, a conductor —
 * is reading the wrong process, and gets a false answer in both directions.
 */
export function paneWorkerPid(pane: string): number | undefined {
  const pid = localSessionPanePid(pane);
  if (pid === undefined) return undefined;
  return readWorkerPid(pid, procReaderDeps());
}

/** Composite identity of the process actually doing the work behind a pane. */
export function paneWorkerAttribution(pane: string): WorkerAttribution | undefined {
  const pid = localSessionPanePid(pane);
  if (pid === undefined) return undefined;
  return readWorkerAttribution(pid, procReaderDeps());
}

/** Resolve a pane worker from a caller-owned fleet snapshot without another scan. */
export function paneWorkerAttributionFromView(
  pane: string,
  view: ProcView,
): WorkerAttribution | undefined {
  const pid = localSessionPanePid(pane);
  if (pid === undefined) return undefined;
  return resolveWorkerAttributionFromView(pid, view);
}

/** One /proc scan for the fleet-wide auditor and supervising pass. */
export function readFleetProcView(): ProcView {
  return readProcView(procReaderDeps());
}

function procReaderDeps(): ProcReaderDeps {
  return {
    listPids: () => {
      try {
        return readdirSync("/proc")
          .map((entry) => Number.parseInt(entry, 10))
          .filter((value) => Number.isInteger(value) && value > 0);
      } catch {
        return [];
      }
    },
    readStat: (target: number) => {
      try {
        return readFileSync(`/proc/${target}/stat`, "utf8");
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * Attach the real terminal straight into the Pod's tmux session via
 * `kubectl exec -it`. The local terminal talks to tmux directly (no WS proxy),
 * so scrollback + copy-to-local-clipboard (OSC52) work natively. Requires a
 * tmux-backed session (Pod started by the tmux-wrapping agent). Blocks until
 * detach/exit; returns the kubectl exit status.
 */
export function attachPodTmux(tunnel: TunnelConfig, sessionId: string): number {
  const env = { ...process.env };
  if (tunnel.kubeconfig) env.KUBECONFIG = expandHome(tunnel.kubeconfig);
  // The attach CLIENT must be UTF-8 or tmux transcodes accented output to "_"
  // for it: the Pod's default locale is empty (ASCII), so we force it on the
  // exec'd tmux client — `env LANG=C.UTF-8` (so tmux detects UTF-8) + `tmux -u`
  // (force UTF-8 regardless of detection). (capture-pane never transcodes, which
  // is why a capture test looked fine while the interactive attach showed "_".)
  const args = [
    "-n",
    tunnel.namespace,
    "exec",
    "-it",
    `session-${sessionId}`,
    "-c",
    "session-agent",
    "--",
    "env",
    "LANG=C.UTF-8",
    "LC_ALL=C.UTF-8",
    "tmux",
    "-u",
    "new-session",
    "-A",
    "-s",
    POD_TMUX_SESSION,
  ];
  // Long-lived `kubectl exec` streams corrupt over time ("tls: bad record MAC"
  // / "next reader: local error" from the SPDY/WS executor): the terminal fills
  // with garbage and the client dies, dumping the user back to their local
  // shell. The Pod's tmux session SURVIVES that, so we auto-reconnect into it
  // instead of leaving the user stranded — a clean detach (Ctrl-b d) exits the
  // tmux client with status 0 and we stop; any non-zero exit is a dropped
  // stream and we re-exec. If it dies almost instantly several times in a row
  // the Pod is likely gone, so we give up rather than spin forever.
  let quickFailures = 0;
  for (;;) {
    const startedAt = Date.now();
    const r = spawnSync("kubectl", args, { stdio: "inherit", env });
    const status = r.status ?? 0;
    if (status === 0) {
      // Clean detach (Ctrl-b d) or exit: the Pod session keeps running — tell
      // the user how to get back in.
      process.stderr.write(
        `[h2a] detached from ${sessionId} — re-attach: h2a attach ${sessionId} --exec\n`,
      );
      return 0;
    }
    const ranMs = Date.now() - startedAt;
    if (ranMs < 3000) {
      quickFailures += 1;
      if (quickFailures >= 5) {
        process.stderr.write(
          `[h2a] exec attach keeps failing immediately (status ${status}) — the Pod may be gone. ` +
            `Re-run \`h2a attach ${sessionId} --exec\` once it's back.\n`,
        );
        return status;
      }
    } else {
      quickFailures = 0; // a real session that ran a while then dropped
    }
    process.stderr.write(
      `[h2a] exec stream dropped (status ${status} — e.g. "tls: bad record MAC" on a long kubectl exec). ` +
        `Your Pod session is intact; reconnecting to its tmux… (Ctrl-C to stop)\n`,
    );
    spawnSync("sleep", ["1"], { stdio: "ignore" });
  }
}
