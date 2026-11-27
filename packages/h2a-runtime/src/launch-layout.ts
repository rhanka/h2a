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
import { scrubSessionIdentityEnv } from "./session-auth.js";

import {
  ambiguousLiveSessionNames,
  decideLayoutTab,
  planLayoutLaunch,
  tabCommand,
  type HostViewSnapshot,
  type LayoutLaunchOptions,
  type LayoutLaunchPlan,
  type LayoutTab,
  type LayoutWindow,
  type RestoreLedgerOutcome,
  type TabLaunchDecision,
} from "./restore-plan.js";

export {
  ambiguousLiveSessionNames,
  decideLayoutTab,
  planLayoutLaunch,
  tabCommand,
  type HostViewSnapshot,
  type LayoutLaunchOptions,
  type LayoutLaunchPlan,
  type RestoreLedgerOutcome,
  type TabLaunchDecision,
};

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

export type StationWindowLaunch = {
  readonly cwd: string;
  readonly title: string;
  readonly command: string;
};

/**
 * S6: open ONE gnome-terminal window hosting the station (`h2a restore`
 * without a TTY but with a proven display). Same run directory, same
 * dispatcher chain, same child environment and same error relay as the tab
 * launcher; the dispatch file holds a single `<cwd>\t<command>` line and
 * the invocation carries a single `--window`, never `--tab`.
 * A synchronous spawn failure is relayed on stderr and rethrown so the
 * caller exits non-zero.
 */
export function launchStationWindow(
  window: StationWindowLaunch,
  stderr: NodeJS.WriteStream = process.stderr,
): void {
  const mapPath = join(runDir(), `station-${process.pid}-${mapCounter++}.map`);
  writeFileSync(mapPath, `${window.cwd}\t${window.command}\n`, "utf8");
  const args = [
    "--window",
    `--working-directory=${window.cwd}`,
    `--title=${window.title}`,
    "--",
    "bash",
    "-lc",
    DISPATCHER,
    "remote-restore",
    mapPath,
  ];
  try {
    // Surface gnome-terminal errors (e.g. "Failed to get screen…") instead of
    // silently claiming the window opened.
    const childEnv = scrubSessionIdentityEnv(process.env);
    delete childEnv["GNOME_TERMINAL_SCREEN"];
    const child = spawn("gnome-terminal", args, {
      stdio: ["ignore", "ignore", "pipe"],
      detached: true,
      env: childEnv,
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.write(`[h2a] gnome-terminal: ${chunk.toString().trim()}\n`);
    });
    child.unref();
  } catch (error) {
    stderr.write(`[h2a] gnome-terminal: ${(error as Error).message}\n`);
    throw error;
  }
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
export type TabLaunchOutcome = {
  readonly tab: LayoutTab;
  readonly decision: TabLaunchDecision;
  readonly outcome: RestoreLedgerOutcome;
};

export type LaunchLayoutDetailedResult = {
  readonly opened: number;
  readonly skippedLive: string[];
  readonly warnings: string[];
  readonly tabOutcomes: TabLaunchOutcome[];
};

/**
 * Apply `planLayoutLaunch` decisions without reading any live host, and return
 * per-tab observed outcomes so `restore()` can assemble its D2 ledger.
 */
export function launchLayoutWithOutcomes(
  windows: LayoutWindow[],
  hostView: HostViewSnapshot,
  stderr: NodeJS.WriteStream = process.stderr,
  opts: { reattach?: boolean; forceGateway?: "gateway" | "direct" } = {},
): LaunchLayoutDetailedResult {
  const plan = planLayoutLaunch(windows, hostView, opts);
  for (const warning of plan.warnings) {
    stderr.write(warning);
  }

  let opened = 0;
  const tabOutcomes: TabLaunchOutcome[] = [];

  for (const win of plan.windows) {
    for (const decision of win.decisions) {
      if (decision.notice) {
        stderr.write(decision.notice);
      }
    }

    const activeTabs = win.activeTabs;
    if (activeTabs.length === 0) {
      for (const decision of win.decisions) {
        tabOutcomes.push({
          tab: decision.tab,
          decision,
          outcome: decision.ledgerOutcome,
        });
      }
      continue;
    }

    let windowSpawned = false;
    try {
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
      const childEnv = scrubSessionIdentityEnv(process.env);
      delete childEnv["GNOME_TERMINAL_SCREEN"];
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
      windowSpawned = true;
    } catch (error) {
      stderr.write(
        `[h2a] gnome-terminal: ${(error as Error).message}\n`,
      );
    }

    for (const decision of win.decisions) {
      const isAction = decision.kind === "attach" || decision.kind === "launch";
      tabOutcomes.push({
        tab: decision.tab,
        decision,
        outcome: isAction && !windowSpawned ? "failed:launch-error" : decision.ledgerOutcome,
      });
    }
  }

  if (plan.skippedLive.length > 0) {
    stderr.write(
      `[h2a] ${plan.skippedLive.length} session(s) déjà visibles ou contrôlées ignorées` +
      ` (--reattach rouvre seulement les vues pouvant être attachées sans second contrôleur): ${plan.skippedLive.join(", ")}\n`,
    );
  }

  return {
    opened,
    skippedLive: plan.skippedLive,
    warnings: plan.warnings,
    tabOutcomes,
  };
}

export function launchLayout(
  windows: LayoutWindow[],
  hostView: HostViewSnapshot,
  stderr: NodeJS.WriteStream = process.stderr,
  opts: { reattach?: boolean; forceGateway?: "gateway" | "direct" } = {},
): { opened: number; skippedLive: string[] } {
  const { opened, skippedLive } = launchLayoutWithOutcomes(
    windows,
    hostView,
    stderr,
    opts,
  );
  return { opened, skippedLive };
}
