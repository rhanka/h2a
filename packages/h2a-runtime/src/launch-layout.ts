/**
 * Terminal-layout rendering for `remote restore` — split out of restore.ts so
 * the F3 invariant is a MODULE-BOUNDARY property, not a review rule:
 *
 *   launchLayout decides every view/launch from the ONE `HostViewSnapshot`
 *   it receives AS A PARAMETER. This module must NOT import any live host
 *   reader (listNativeSessions, listLocalSessions*, nativeSession*, probe*):
 *   you can't call what you don't have, so a divergence between plan time
 *   and launch time can never be re-read here — and an error or divergence
 *   NEVER becomes permission to launch (`live -> empty` yields attach or
 *   refuse, never `h2a run` fabricating a second writer on a live
 *   conversation). Only PURE name helpers may be imported from tmux.js.
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { localSessionName, slugify, type LocalSession } from "./tmux.js";
import type { LayoutTab, LayoutWindow } from "./restore.js";
import type { RegistryTool } from "./registry.js";
import { humanOutputText } from "./human-output.js";

/**
 * The ONE host inventory snapshot a restore plan runs on: BOTH inventories
 * read once by the caller (restore.ts owns the readers), so the plan gate and
 * the layout render see the SAME state. A failed inventory read is carried as
 * `known: false` — an UNKNOWN view, never an empty one.
 */
export type HostViewSnapshot = {
  readonly tmux:
    | { readonly known: true; readonly sessions: ReadonlyArray<LocalSession> }
    | { readonly known: false; readonly reason?: string };
  readonly native:
    | {
        readonly known: true;
        readonly complete?: boolean;
        /** RUNNING native sessions only, with the controller-visibility bit. */
        readonly sessions: ReadonlyArray<{
          readonly name: string;
          readonly controlled: boolean | undefined;
          readonly socketPath?: string | undefined;
        }>;
      }
    | { readonly known: false };
};

/**
 * Per-tab command for an ABSENT local session: create it via `remote run …
 * --resume …` (which attaches by default). Live sessions are deliberately
 * handled by `launchLayout`, which knows their exact tmux names and whether they
 * have a client attached; it emits `tmux attach -t <exact-name>` and never
 * relaunches them.
 */
export function tabCommand(
  tab: LayoutTab,
  liveSlugs: ReadonlySet<string> = new Set(),
  opts: {
    forceGateway?: "gateway" | "direct";
    /** Exact existing tmux name — attach directly, never replace/relaunch it. */
    attachSession?: string;
  } = {},
): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  if (tab.remoteId) {
    // SCW: attach straight into the Pod's tmux (live, copy-friendly).
    return `h2a attach ${q(tab.remoteId)} --exec`;
  }
  const slug = slugify(tab.label);
  if (tab.attachLive) {
    // §4.1 attach-live: a live managed row whose conversation id is
    // unresolved re-enters by EXACT managed name only. No resume id exists,
    // so no run/replace command may ever be rendered for it.
    return `h2a attach ${q(tab.managedName ?? localSessionName(slug))}`;
  }
  // Effective gateway posture: an explicit `restore --gw/--no-gw` OVERRIDES the
  // per-instance pin; otherwise honour the pinned gatewayMode (absent = default).
  const posture = opts.forceGateway ?? tab.gatewayMode;
  const gwFlag =
    posture === "gateway" ? " --gw" : posture === "direct" ? " --no-gw" : "";
  // Persisted-host pin — the gatewayMode pattern applied to the terminal
  // host: a NON-LIVE session is re-created on the host its registry record
  // names, never on the current default. A recorded native session survives
  // the fleet-wide H2A_SESSION_HOST=tmux valve via the env pin (any other
  // value selects native — resolveSessionHostKind), where it fails closed if
  // the native host is unavailable rather than silently re-routing; a
  // recorded tmux session survives the native default via --tmux. Tabs
  // without a recorded host (scan fallback) keep following the default.
  const nativePin =
    tab.hostKind === "local-native" ? "H2A_SESSION_HOST=native " : "";
  const tmuxPin = tab.hostKind === "local-tmux" ? " --tmux" : "";
  const bareFlag = tab.bare === true ? " --bare" : tab.bare === false ? " --no-bare" : "";
  const runCmd = (extra: string) =>
    `${nativePin}h2a run ${q(tab.tool ?? "shell")} ${q(tab.cwd)} ` +
    (tab.sid ? `--resume ${q(tab.sid)} ` : "") +
    `--name ${q(tab.label)}${gwFlag}${bareFlag}${tmuxPin}${extra}`;
  if (opts.attachSession) {
    // `h2a attach` resolves the exact managed name and honors the session's
    // RECORDED host (tmux attach for tmux sessions, the native bridge for
    // native-PTY sessions) — a raw `tmux attach -t` here would strand every
    // native session behind a "no such session" error.
    return `h2a attach ${q(opts.attachSession)}`;
  }
  if (liveSlugs.has(slug)) {
    // Compatibility for direct callers that only know a unique slug.  Restore
    // itself always supplies the exact name above, avoiding prefix collisions.
    // Crucially, a gateway override never turns a live session into --replace:
    // restore must preserve its process and conversation.
    return `h2a attach ${q(slug)}`;
  }
  return runCmd("");
}

/** Group collision candidates before restore emits bare-slug attach/resume commands. */
export function ambiguousLiveSessionNames(
  sessions: readonly Pick<LocalSession, "name" | "slug">[],
): Map<string, string[]> {
  const namesBySlug = new Map<string, string[]>();
  for (const session of sessions) {
    const names = namesBySlug.get(session.slug) ?? [];
    names.push(session.name);
    namesBySlug.set(session.slug, names);
  }
  return new Map(
    [...namesBySlug].filter(([, names]) => names.length > 1),
  );
}

// gnome-terminal applies ONE trailing `-- command` to EVERY tab of an
// invocation (you cannot give each tab its own `--`). So all tabs run the same
// dispatcher; each claims (under flock) the first map line matching its $PWD
// and runs that tab's command — exactly how ~/bin/resume-dev-sessions worked.
const DISPATCHER = `map="$1"
lock="$map.lock"
exec 9>"$lock"; flock 9
line=$(awk -F'\\t' -v c="$PWD" '$1==c{print;exit}' "$map")
if [ -n "$line" ]; then
  awk -F'\\t' -v c="$PWD" 'BEGIN{d=0} d==0 && $1==c {d=1; next} {print}' "$map" > "$map.tmp" && mv "$map.tmp" "$map"
fi
flock -u 9
cmd=$(printf '%s' "$line" | cut -f2-)
if [ -n "$cmd" ]; then eval "$cmd"; else echo "[h2a] rien a reprendre pour $PWD" >&2; fi
exec bash -l`;

let mapCounter = 0;

function runDir(): string {
  const base = process.env.XDG_RUNTIME_DIR
    ? join(process.env.XDG_RUNTIME_DIR, "sentropic-remote")
    : join(homedir(), ".config", "sentropic", "remote-cli", "run");
  mkdirSync(base, { recursive: true });
  return base;
}

/**
 * Launch the layout in gnome-terminal: one window per group, one tab per session.
 *
 * Default behaviour: a live session with a visible tmux client or an exclusive
 * native controller is skipped. A live tmux session with zero clients, or a live
 * native session with `controlled:false`, receives exactly one host-agnostic
 * `h2a attach` tab. `--reattach` may duplicate a visible tmux view but never a
 * native controller: the native host's single-writer lease stays authoritative.
 * An absent session is launched as before. This is deliberately a view decision,
 * not a liveness decision.
 *
 * Every decision reads the `hostView` PARAMETER — the plan's one snapshot —
 * never a live host (F3: this module has no reader to call).
 */
export function launchLayout(
  windows: LayoutWindow[],
  hostView: HostViewSnapshot,
  stderr: NodeJS.WriteStream = process.stderr,
  opts: { reattach?: boolean; forceGateway?: "gateway" | "direct" } = {},
): { opened: number; skippedLive: string[] } {
  const tmuxKnown = hostView.tmux.known;
  const tmuxReason = hostView.tmux.known ? undefined : hostView.tmux.reason;
  const tmuxSessions: ReadonlyArray<LocalSession> = hostView.tmux.known
    ? hostView.tmux.sessions
    : [];
  // Native view by EXACT session name, carrying the controller-visibility
  // bit. A failed inventory read is an UNKNOWN view (undefined map) — never
  // "no sessions": launching a replacement onto an unprovable host state
  // could create a second writer, so unknown fails closed below.
  const nativeSessionsByName:
    | ReadonlyMap<string, { controlled: boolean | undefined }>
    | undefined = hostView.native.known
    ? new Map(
        hostView.native.sessions.map((session) => [
          session.name,
          { controlled: session.controlled },
        ]),
      )
    : undefined;
  const ambiguousNativeNames = new Set(hostView.native.known
    ? hostView.native.sessions.filter((session, index, sessions) =>
      sessions.findIndex(other => other.name === session.name) !== index).map(session => session.name)
    : []);
  // Slug-union view for LEGACY tabs without a recorded host (scan fallback)
  // ONLY — a tab that carries its persisted hostKind + exact managed name is
  // rendered from that identity and never chooses a host from a merged slug
  // list. A CONTROLLED native session counts as attached (already visible).
  const nativeLive: Array<{ name: string; slug: string; attached: boolean }> =
    nativeSessionsByName !== undefined
      ? [...nativeSessionsByName.entries()]
          .filter(
            ([name]) => name.startsWith("h2a-") && !name.endsWith(".h2a"),
          )
          .map(([name, view]) => ({
            name,
            slug: name.slice("h2a-".length),
            attached: view.controlled === true,
          }))
      : [];
  const liveSessions = [
    ...tmuxSessions,
    ...nativeLive.filter(
      (native) => !tmuxSessions.some((s) => s.name === native.name),
    ),
  ];
  const ambiguousLiveNames = ambiguousLiveSessionNames(liveSessions);
  for (const name of ambiguousNativeNames) {
    if (name.startsWith("h2a-")) ambiguousLiveNames.set(name.slice(4), [name, name]);
  }
  const skippedLive: string[] = [];
  let opened = 0;
  // A gateway override can configure a NEW process but must never replace a live
  // one. `--reattach` may duplicate a tmux view; it never duplicates a native
  // controller, whose exclusive lease is a host-level safety contract.
  const includeAttached = opts.reattach === true;
  const tabOpts = opts.forceGateway ? { forceGateway: opts.forceGateway } : {};

  if (!tmuxKnown) {
    // We cannot reliably tell "attached" from "orphaned".  Prefer a harmless
    // duplicate/failing attach over `h2a run` possibly racing a live tmux
    // session; a restore command must never reclaim a view by killing its work.
    stderr.write(
      `[h2a] legacy tmux view state unavailable${tmuxReason ? ` (${tmuxReason})` : ""}; ` +
        "opening attach tabs rather than relaunching local sessions\n",
    );
  }

  for (const win of windows) {
    // Remote (k8s) tabs are always included — we can't probe pod health here.
    // Local tabs carry their finalized command because a live orphan must attach
    // to its exact tmux name, while an absent session must be launched.
    const activeTabs: Array<{ tab: LayoutTab; command: string }> = [];
    for (const t of win.tabs) {
      if (t.remoteId) {
        activeTabs.push({ tab: t, command: tabCommand(t) });
        continue;
      }
      const slug = slugify(t.label);

      // --- Tabs WITH a recorded host: exact-identity, single-host render. ---
      // The host decision was made by the plan (persisted kind + exact
      // managed name); this block only renders the view for THAT host.
      if (t.hostKind === "local-native") {
        const exact = t.managedName ?? `h2a-${slug}`;
        if (ambiguousNativeNames.has(exact)) {
          stderr.write(
            `[h2a] restore: ${humanOutputText("restore.ambiguousOwner")} "${t.label}"; ${humanOutputText("restore.refuseAttachRecreate")}\n`,
          );
          continue;
        }
        if (nativeSessionsByName === undefined ||
          (hostView.native.known && hostView.native.complete === false && !nativeSessionsByName.has(exact))) {
          stderr.write(
            `[h2a] restore: ${humanOutputText("restore.unknownHostNoAttach")} — "${t.label}"\n`,
          );
          continue;
        }
        const view = nativeSessionsByName.get(exact);
        if (view !== undefined) {
          if (view.controlled === true) {
            // running && controlled → already visible. Even --reattach must
            // not open a competing controller (single-controller model).
            skippedLive.push(t.label);
            if (includeAttached) {
              stderr.write(
                `[h2a] restore: "${t.label}" is already controlled in a terminal; not opening a second controller\n`,
              );
            }
            continue;
          }
          if (view.controlled === undefined) {
            // running && view unknown (host predates the visibility bit):
            // preserve the process, report, never relaunch.
            stderr.write(
              `[h2a] restore: ${humanOutputText("restore.controllerUnknown")} "${t.label}"; ${humanOutputText("restore.attachManually")}: h2a attach ${exact}\n`,
            );
            continue;
          }
          // running && !controlled → exactly one exact-name attach.
          activeTabs.push({
            tab: t,
            command: tabCommand(t, new Set([slug]), { attachSession: exact }),
          });
          continue;
        }
        // Dead/absent on a KNOWN native view.
        if (t.attachLive) {
          stderr.write(
            `[h2a] restore: "${t.label}" ${humanOutputText("restore.vanishedLive")}\n`,
          );
          continue;
        }
        activeTabs.push({ tab: t, command: tabCommand(t, new Set(), tabOpts) });
        continue;
      }
      if (t.hostKind === "local-tmux") {
        const exact = t.managedName ?? `h2a-${slug}`;
        if (!tmuxKnown) {
          // Conservative: a harmless exact attach, never a relaunch race.
          activeTabs.push({
            tab: t,
            command: tabCommand(t, new Set([slug]), { attachSession: exact }),
          });
          continue;
        }
        const liveTmux = tmuxSessions.find(
          (session) => session.name === exact,
        );
        if (liveTmux) {
          // DRAIN view: the live legacy process is attach-only — dispatched
          // to its persisted host via `h2a attach`; never replaced, and no
          // tmux session is ever created here.
          if (!includeAttached && liveTmux.attached) {
            skippedLive.push(t.label);
            continue;
          }
          activeTabs.push({
            tab: t,
            command: tabCommand(t, new Set([slug]), { attachSession: exact }),
          });
          continue;
        }
        if (t.attachLive) {
          stderr.write(
            `[h2a] restore: "${t.label}" ${humanOutputText("restore.vanishedLive")}\n`,
          );
          continue;
        }
        // Dead recorded tmux row: re-created on its recorded host via the
        // --tmux pin (tabCommand). Which host a dead tmux session should be
        // relaunched on is a REOPENED policy question — this keeps the #199
        // behavior as-is.
        activeTabs.push({ tab: t, command: tabCommand(t, new Set(), tabOpts) });
        continue;
      }

      // --- Legacy tabs without a recorded host: slug-union view (scan). ---
      if (!tmuxKnown) {
        activeTabs.push({
          tab: t,
          command: tabCommand(t, new Set([slug]), { attachSession: `h2a-${slug}` }),
        });
        continue;
      }
      const names = ambiguousLiveNames.get(slug);
      if (names) {
        skippedLive.push(t.label);
        stderr.write(
          `[h2a] restore skipped "${t.label}": ${humanOutputText("restore.ambiguousSlug")} (${names.sort().join(", ")}); ` +
            `${humanOutputText("restore.attachExplicitly")} h2a attach ${names.sort()[0]} ${humanOutputText("restore.wordOr")} h2a attach ${names.sort()[1]}\n`,
        );
        continue;
      }

      const liveSession = liveSessions.find((session) => session.slug === slug);
      if (liveSession && !includeAttached && liveSession.attached) {
        skippedLive.push(t.label);
        continue;
      }
      if (!liveSession && (nativeSessionsByName === undefined ||
        (hostView.native.known && hostView.native.complete === false))) {
        // The tab would LAUNCH — but the native host state is unknown, so a
        // homonymous live native session cannot be ruled out. Fail closed.
        stderr.write(
          `[h2a] restore: ${humanOutputText("restore.unknownHost")} — "${t.label}"\n`,
        );
        continue;
      }
      activeTabs.push({
        tab: t,
        command: liveSession
          ? tabCommand(t, new Set([slug]), { attachSession: liveSession.name })
          : tabCommand(t, new Set(), tabOpts),
      });
    }

    if (activeTabs.length === 0) {
      // All sessions in this window are already active — no tab needed.
      continue;
    }

    // Map keyed by per-tab working directory -> the tab's command. Tabs sharing
    // a cwd (several sessions of one project) each claim a distinct line FIFO.
    const slug = win.title.replace(/[^a-zA-Z0-9]+/g, "-");
    const mapPath = join(
      runDir(),
      `restore-${process.pid}-${slug}-${mapCounter++}.map`,
    );
    const body =
      activeTabs
        .map(({ tab, command }) => `${tab.cwd}\t${command}`)
        .join("\n") + "\n";
    writeFileSync(mapPath, body, "utf8");

    const args: string[] = [];
    activeTabs.forEach(({ tab }, i) => {
      args.push(
        i === 0 ? "--window" : "--tab",
        `--working-directory=${tab.cwd}`,
        `--title=${tab.label}`,
      );
    });
    // ONE shared dispatcher command for all tabs of this window.
    args.push("--", "bash", "-lc", DISPATCHER, "remote-restore", mapPath);

    stderr.write(
      `[h2a] ${humanOutputText("restore.windowOpened")} "${win.title}" (${activeTabs.length} ${humanOutputText("restore.count.tabs")})\n`,
    );
    // Surface gnome-terminal errors (e.g. "Failed to get screen…") instead of
    // silently claiming the window opened.
    const { GNOME_TERMINAL_SCREEN: _drop, ...childEnv } = process.env;
    const child = spawn("gnome-terminal", args, {
      stdio: ["ignore", "ignore", "pipe"],
      detached: true,
      env: childEnv,
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.write(`[h2a] gnome-terminal: ${chunk.toString().trim()}\n`);
    });
    child.unref();
    opened += activeTabs.length;
  }

  if (skippedLive.length > 0) {
    stderr.write(
      `[h2a] ${skippedLive.length} ${humanOutputText("restore.skippedLive")}` +
      ` (${humanOutputText("restore.skippedLiveHint")}): ${skippedLive.join(", ")}\n`,
    );
  }

  return { opened, skippedLive };
}

// ---------------------------------------------------------------------------
// Lot L1a — foreground-facet contract.
//
// The facet vocabulary is OWNED here (this module stays pure: no host
// readers, F3): conv-guard.ts annotates conflict owners through
// deriveSessionFacet, and restore.ts's registry×2 merge consumes
// getRestoreCandidates/resolveOccupiedHumanRefusals so a session filtered to
// a live agent tool is never treated as an inert attach target. Unknown tools
// stay `unknown` — never promoted to a live facet (fail closed).
// ---------------------------------------------------------------------------

/** Foreground facet of one restore row: what a human (or transcript) holds. */
export type SessionFacet =
  | "live-agent-cli"
  | "shell"
  | "consumable-transcript"
  | "unknown";

/**
 * Lot L1b (D6 i) — ONE host-observed process in a managed session's subtree.
 * Evidence, never a verdict: the host reports what it sees (no guessing, no
 * output parsing), the DECISION in this module matches it against the
 * enrolled row. `command` is argv[0] (fallback: comm); `args` the full argv
 * (capped by the host); `startedAtMs` the process start time (the
 * application incarnation the in-place decision binds to); `ppid` the parent
 * (lineage membership, not ordering). Absent on old hosts and whenever the
 * tree is unattestable — callers treat absence as UNKNOWN, never as empty.
 */
export interface HostProcessSnapshot {
  readonly pid: number;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly startedAtMs: number;
  readonly ppid: number;
}

/** Interpreter binaries whose real application is argv[1] (structural, not behavioral). */
const INTERPRETER_BINARIES: ReadonlySet<string> = new Set([
  "node",
  "bun",
  "deno",
]);

function binaryBasename(command: string): string {
  const base = command.split("/").pop() ?? command;
  return base.toLowerCase();
}

/**
 * Lot L1b — the application a host-observed process runs: argv[0]'s binary,
 * or argv[1]'s when argv[0] is a bare interpreter (installed CLIs are
 * scripts; `node /…/claude --resume …` IS claude). Pure, structural.
 */
export function primaryBinaryName(proc: Pick<HostProcessSnapshot, "command" | "args">): string {
  const first = binaryBasename(proc.command);
  if (INTERPRETER_BINARIES.has(first)) {
    const second = proc.args[1];
    if (second !== undefined) return binaryBasename(second);
  }
  return first;
}

/**
 * Lot L1b — match ONE host-observed process against the enrolled row:
 * a known agent binary holding the row's conversation (when the row names
 * one) is the live CLI; a second attribution for the same conversation is
 * ambiguity, never a second owner. Returns the match plus the application
 * incarnation (process start), or null when nothing attributable runs.
 */
export function matchRowConversation(
  row: Pick<SessionFacetRow, "convId">,
  processes: ReadonlyArray<HostProcessSnapshot>,
): HostProcessSnapshot | "ambiguous" | null {
  const convId = row.convId;
  const hits = processes.filter(
    (p) =>
      AGENT_CLI_TOOLS.has(primaryBinaryName(p)) &&
      (convId === undefined || p.args.includes(convId)),
  );
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0]!;
  // Same conversation twice (CLI + helper sharing argv) is one owner only
  // when every hit carries the row's conversation; anything less is refusal.
  if (convId !== undefined && hits.every((p) => p.args.includes(convId))) {
    return hits.slice().sort((a, b) => a.startedAtMs - b.startedAtMs)[0]!;
  }
  return "ambiguous";
}

/** Lot L1b — an interactive shell (never a `-c` script runner) in the subtree. */
export function matchInteractiveShell(
  processes: ReadonlyArray<HostProcessSnapshot>,
): HostProcessSnapshot | null {
  const shells = processes.filter(
    (p) =>
      SHELL_TOOLS.has(primaryBinaryName(p)) &&
      !p.args.includes("-c") &&
      !p.args.includes("-e"),
  );
  if (shells.length === 0) return null;
  return shells.slice().sort((a, b) => a.startedAtMs - b.startedAtMs)[0]!;
}

/**
 * Agent CLI tools — the only tools that can hold a live foreground session.
 * Mirrors RegistryTool (registry.ts); a named tool outside this set is never
 * a live agent, no matter the liveness probes.
 */
const AGENT_CLI_TOOLS: ReadonlySet<string> = new Set<string>([
  "claude",
  "codex",
  "agy",
  "muse",
  "vibe",
] satisfies readonly RegistryTool[]);

/** Plain interactive shells: attached, never resumed or relaunched as agents. */
const SHELL_TOOLS: ReadonlySet<string> = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "ksh",
  "shell",
]);

/** One restore row as the facet contract sees it. */
export interface SessionFacetRow {
  /** Stable session handle (registry label, managed name, or project). */
  session: string;
  /** Agent CLI tool, shell name, or anything else (fail closed → unknown). */
  tool?: string;
  /** Persisted terminal host kind, when known. */
  kind?: string;
  /** Live on its tmux / native host (plan snapshot bits). */
  tmuxLive?: boolean;
  pidAlive?: boolean;
  /** Out-of-band liveness proof (e.g. a convId match on a remote session). */
  live?: boolean;
  /** Transcript path backing a consumable (dead) row. */
  transcriptPath?: string;
  /** Human label, preserved through the cohort mapping. */
  label?: string;
  /**
   * Lot L1b — the enrolled conversation, when the row names one. The host
   * evidence matches against it; a row without one attributes any single
   * agent binary in the subtree.
   */
  convId?: string;
  /**
   * Lot L1b — host-side foreground evidence (subtree snapshot). When
   * present it TAKES PRECEDENCE over the registry tool and the plan
   * snapshot bits: the host speaks of what runs NOW. Absent on old hosts
   * (existing tool/bit rules apply, L1a-compatible).
   */
  hostProcesses?: ReadonlyArray<HostProcessSnapshot>;
}

/** Liveness as the facet contract sees it: any proven-live bit suffices. */
export function isLiveFacetRow(
  row: Pick<SessionFacetRow, "tmuxLive" | "pidAlive" | "live">,
): boolean {
  return row.tmuxLive === true || row.pidAlive === true || row.live === true;
}

/**
 * Derive the foreground facet of one row. Agent tool + proven live =
 * live-agent-cli; agent tool + transcript but nothing live =
 * consumable-transcript; shells stay shells; anything else (unknown tool,
 * dead agent without transcript) is unknown — never promoted.
 */
export function deriveSessionFacet(row: SessionFacetRow): SessionFacet {
  // Lot L1b — host-side foreground evidence takes precedence: the host
  // reports what runs NOW, so a stale registry tool or a stale liveness bit
  // never promotes (a vim foreground is not a live CLI; a live shell is a
  // shell even when the row says claude). Absent on old hosts → L1a rules.
  if (row.hostProcesses !== undefined) {
    const cli = matchRowConversation(row, row.hostProcesses);
    if (cli !== null && cli !== "ambiguous") return "live-agent-cli";
    if (matchInteractiveShell(row.hostProcesses) !== null) return "shell";
    return "unknown";
  }
  const tool = row.tool;
  if (tool !== undefined && AGENT_CLI_TOOLS.has(tool)) {
    if (isLiveFacetRow(row)) return "live-agent-cli";
    if (row.transcriptPath !== undefined) return "consumable-transcript";
    return "unknown";
  }
  if (tool !== undefined && SHELL_TOOLS.has(tool)) return "shell";
  return "unknown";
}

/**
 * Lot L1b (D2/D6 i) — the in-place resume DECISION for one live managed row
 * with host-side foreground evidence. The decision never types anything:
 * - a verified foreground CLI holding the row's conversation → `attach`
 *   (the session is already active; the ledger records `already-active`);
 * - a foreground shell → `deferred` (`needs-adapter`: the D6(iii)
 *   managed-shell attestation does not exist in this RC, so no keystroke
 *   may be composed — D2 makes the shortfall visible per session);
 * - anything else (unknown foreground, ambiguous owners) → `refused`.
 * The caller (restore) turns `attach` into an attach tab, `deferred` into a
 * deferred ledger entry, `refused` into the occupied-human refusal path.
 * Without host evidence (`hostProcesses` absent) there is no decision
 * (`null` — the caller keeps the L1a behavior).
 */
export type InPlaceDecision =
  | {
      readonly outcome: "attach";
      readonly facet: "live-agent-cli";
      /** Application incarnation the attach binds to (foreground start). */
      readonly appIncarnation: number;
      readonly via: string;
    }
  | {
      readonly outcome: "deferred";
      readonly reason: "needs-adapter";
      readonly facet: "shell";
      readonly appIncarnation: number;
    }
  | {
      readonly outcome: "refused";
      readonly reason: "unknown-foreground" | "ambiguous-cli";
      readonly facet: "unknown";
    };

export function decideInPlaceResume(
  row: Pick<SessionFacetRow, "session" | "convId" | "hostProcesses" | "label">,
): InPlaceDecision | null {
  if (row.hostProcesses === undefined) return null;
  const cli = matchRowConversation(row, row.hostProcesses);
  if (cli === "ambiguous") {
    return { outcome: "refused", reason: "ambiguous-cli", facet: "unknown" };
  }
  if (cli !== null) {
    return {
      outcome: "attach",
      facet: "live-agent-cli",
      appIncarnation: cli.startedAtMs,
      via: `h2a attach ${row.label ?? row.session}`,
    };
  }
  const shell = matchInteractiveShell(row.hostProcesses);
  if (shell !== null) {
    return {
      outcome: "deferred",
      reason: "needs-adapter",
      facet: "shell",
      appIncarnation: shell.startedAtMs,
    };
  }
  return { outcome: "refused", reason: "unknown-foreground", facet: "unknown" };
}

/** One facet-ed restore candidate: facet plus the labels the cohort keeps. */
export interface FacetCandidate {
  session: string;
  facet: SessionFacet;
  tool?: string;
  label?: string;
  transcriptPath?: string;
}

/**
 * Facet a whole side-window cohort (B1): one candidate per row, labels and
 * transcript anchors preserved — the catalog facet labels resolve at print
 * time, so the rows themselves stay machine values.
 */
export function getRestoreCandidates(
  rows: ReadonlyArray<SessionFacetRow>,
): FacetCandidate[] {
  return rows.map((row) => {
    const candidate: FacetCandidate = {
      session: row.session,
      facet: deriveSessionFacet(row),
    };
    if (row.tool !== undefined) candidate.tool = row.tool;
    if (row.label !== undefined) candidate.label = row.label;
    if (row.transcriptPath !== undefined) {
      candidate.transcriptPath = row.transcriptPath;
    }
    return candidate;
  });
}

/** One side-window already holding a session (attach-next affinity input). */
export interface LaunchedWindowRef {
  sid?: string;
  session?: string;
  windowName: string;
}

/**
 * `attach-next` affinity: the window that already holds the session wins;
 * otherwise the first candidate window; undefined when there is no window.
 */
export function resolveAttachNextTarget(
  session: string,
  launched: ReadonlyArray<LaunchedWindowRef>,
  candidates: ReadonlyArray<string>,
): string | undefined {
  const hit = launched.find(
    (ref) => ref.session === session || ref.sid === session,
  );
  if (hit !== undefined) return hit.windowName;
  return candidates[0];
}

/** One resume snapshot backing a session (resume-identity input). */
export interface ResumeSnapshotRow {
  snapshotId: string;
  session: string;
  alive: boolean;
  startedAt: string;
}

/**
 * Collapse duplicate resume snapshots to ONE exact identity: live first,
 * then newest startedAt, then the smallest snapshotId (deterministic
 * tiebreak). An empty list is unusable — throw, never invent an identity.
 */
export function resolveResumeCandidate(
  snapshots: ReadonlyArray<ResumeSnapshotRow>,
): ResumeSnapshotRow {
  if (snapshots.length === 0) {
    throw new Error(
      "resolveResumeCandidate: no usable resume snapshot (empty snapshot list)",
    );
  }
  const ranked = snapshots.slice().sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? 1 : -1;
    if (a.snapshotId === b.snapshotId) return 0;
    return a.snapshotId < b.snapshotId ? -1 : 1;
  });
  return ranked[0]!;
}

/** One hard occupied-human refusal: never relaunch over a live human CLI. */
export interface OccupiedHumanRefusal {
  session: string;
  /** Per-session remedy naming the attach command for this session. */
  remedy: string;
}

/**
 * Hard occupied-human gate: every live-agent-cli row the caller proves live
 * is refused with a per-session `h2a attach <slug>` remedy. Shells,
 * consumable transcripts and unknown rows never refuse here.
 */
export function resolveOccupiedHumanRefusals(
  rows: ReadonlyArray<SessionFacetRow>,
  isLive: (row: SessionFacetRow) => boolean,
): OccupiedHumanRefusal[] {
  return rows
    .filter((row) => deriveSessionFacet(row) === "live-agent-cli" && isLive(row))
    .map((row) => ({
      session: row.session,
      remedy: `h2a attach ${slugify(row.label ?? row.session)}`,
    }));
}
