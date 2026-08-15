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
        /** RUNNING native sessions only, with the controller-visibility bit. */
        readonly sessions: ReadonlyArray<{
          readonly name: string;
          readonly controlled: boolean | undefined;
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
  const runCmd = (extra: string) =>
    `${nativePin}h2a run ${q(tab.tool ?? "shell")} ${q(tab.cwd)} ` +
    (tab.sid ? `--resume ${q(tab.sid)} ` : "") +
    `--name ${q(tab.label)}${gwFlag}${tmuxPin}${extra}`;
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
        if (nativeSessionsByName === undefined) {
          stderr.write(
            `[h2a] restore: native host state UNKNOWN — "${t.label}" neither relaunched nor attached (fail closed)\n`,
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
              `[h2a] restore: controller visibility UNKNOWN for running native session "${t.label}"; attach manually: h2a attach ${exact}\n`,
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
            `[h2a] restore: "${t.label}" was live at plan time but is gone; no resolved conversation exists to relaunch it\n`,
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
            `[h2a] restore: "${t.label}" was live at plan time but is gone; no resolved conversation exists to relaunch it\n`,
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
          `[h2a] restore skipped "${t.label}": local session slug is ambiguous (${names.sort().join(", ")}); ` +
            `attach explicitly with h2a attach ${names.sort()[0]} or h2a attach ${names.sort()[1]}\n`,
        );
        continue;
      }

      const liveSession = liveSessions.find((session) => session.slug === slug);
      if (liveSession && !includeAttached && liveSession.attached) {
        skippedLive.push(t.label);
        continue;
      }
      if (!liveSession && nativeSessionsByName === undefined) {
        // The tab would LAUNCH — but the native host state is unknown, so a
        // homonymous live native session cannot be ruled out. Fail closed.
        stderr.write(
          `[h2a] restore: native host state UNKNOWN — "${t.label}" not launched (fail closed)\n`,
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
      `[h2a] fenêtre "${win.title}" (${activeTabs.length} onglet(s))\n`,
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
      `[h2a] ${skippedLive.length} session(s) déjà visibles ou contrôlées ignorées` +
      ` (--reattach rouvre seulement les vues pouvant être attachées sans second contrôleur): ${skippedLive.join(", ")}\n`,
    );
  }

  return { opened, skippedLive };
}
