/**
 * `remote restore` — relaunch recent local dev sessions (claude/codex) in their
 * layout, each tab a remote-managed tmux session (durable, live-named).
 *
 * This OWNS the launcher logic in the CLI (discovery + grouping + layout +
 * terminal launch), so `~/bin/resume-dev-sessions` is just `exec remote
 * restore`. SCW sessions and persisted positions come later.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { guardTestStateMove, guardTestStateWrite } from "./test-state-guard.js";

import {
  launchLayout,
  launchLayoutWithOutcomes,
  planLayoutLaunch,
  tabCommand,
  type HostViewSnapshot,
  type TabLaunchOutcome,
} from "./launch-layout.js";
import {
  buildRestorePlan,
  deriveLegacySessionClass,
  dropDualHostIdentities,
  dropRemoteBackedLocals,
  groupSessions,
  groupSessionsWithClassification,
  isRestorableDiscoveredSession,
  managedLiveLookupFromSnapshot,
  mergeDiscovered,
  projectForCwd,
  reconcileRunConvIdsPure,
  registrySessionsPure,
  sessionIdentitySlug,
  summarizeRestoreLedger,
  type ConvIdResolution,
  type DiscoveredSession,
  type LayoutTab,
  type LayoutWindow,
  type LegacySessionEvidence,
  type ManagedLiveLookup,
  type RegistryConflictNote,
  type RemoteTab,
  type RestoreLedgerEntry,
  type RestoreLedgerOutcome,
  type RestoreObservedTotals,
} from "./restore-plan.js";

import {
  getLayoutConfig,
  resolveConfigPath,
  type LayoutConfig,
} from "./config.js";
import { encodeCwd } from "./convsync.js";
import {
  loadRegistry,
  persistReconciledConvIds,
  type RawRow,
  type RegistryEntry,
} from "./registry.js";
import {
  listLocalSessions,
  listLocalSessionsWithDiagnostics,
  slugify,
  type LocalSession,
} from "./tmux.js";
import { listNativeSessions } from "./native-host.js";
import { applicationForeground } from "./native-terminal/protocol.js";
import { withAttachTerminalRecovery } from "./native-terminal/attach-recovery.js";
import { STATION_STATE_FILE_NAME } from "./native-terminal/station-state.js";
import { humanOutputText } from "./human-output.js";
import type { RestorePlanResult, RestoreRefusalReason } from "./restore-plan.js";

// Compatibility re-exports: the layout renderer lives in launch-layout.ts and
// the pure restore plan lives in restore-plan.ts (neither has host readers).
export {
  ambiguousLiveSessionNames,
  decideLayoutTab,
  launchLayout,
  launchLayoutWithOutcomes,
  planLayoutLaunch,
  tabCommand,
  type HostViewSnapshot,
  type LaunchLayoutDetailedResult,
  type TabLaunchDecision,
  type TabLaunchOutcome,
} from "./launch-layout.js";
export {
  buildRestorePlan,
  deriveLegacySessionClass,
  dropDualHostIdentities,
  dropRemoteBackedLocals,
  groupSessions,
  groupSessionsWithClassification,
  isRestorableDiscoveredSession,
  managedLiveLookupFromSnapshot,
  mergeDiscovered,
  sessionIdentitySlug,
  summarizeRestoreLedger,
  type ConvIdResolution,
  type DiscoveredSession,
  type LayoutTab,
  type LayoutWindow,
  type LegacySessionEvidence,
  type ManagedLiveLookup,
  type RegistryConflictNote,
  type RemoteTab,
  type RestoreClassificationOutcome,
  type RestoreLedgerEntry,
  type RestoreLedgerOutcome,
  type RestoreObservedTotals,
  type RestorePlanOptions,
  type RestorePlanResult,
  type RestorePlanSnapshot,
  type RestoreRefusalReason,
  type RestoreSessionClassification,
} from "./restore-plan.js";

/** Discover claude + codex sessions under ~/src/* newer than maxAgeMs. */
export function discoverSessions(
  maxAgeMs: number,
  home: string = homedir(),
): DiscoveredSession[] {
  const src = join(home, "src");
  const cutoff = Date.now() - maxAgeMs;
  const out: DiscoveredSession[] = [];

  // --- claude: <home>/.claude/projects/<encode(~/src/<proj>)…>/<sid>.jsonl ---
  const claudeRoot = join(home, ".claude", "projects");
  const claudePrefix = `${encodeCwd(src)}-`;
  if (existsSync(claudeRoot)) {
    for (const dirName of readdirSync(claudeRoot)) {
      if (!dirName.startsWith(claudePrefix)) continue;
      // claude encodes the full cwd as "/"→"-"; the remainder after the
      // ~/src/ prefix IS the project for a direct child of ~/src. Keep it
      // whole (project names contain "-": sent-tech-design-system) and skip
      // anything that isn't an existing ~/src/<project> dir (sub-paths encode
      // ambiguously and the workdir wouldn't exist anyway).
      const encodedProject = dirName.slice(claudePrefix.length);
      const fallbackCwd = join(src, encodedProject);
      const dir = join(claudeRoot, dirName);
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const f of entries) {
        if (!f.endsWith(".jsonl")) continue;
        const file = join(dir, f);
        const st = safeStat(file);
        if (!st || st.mtimeMs < cutoff) continue;
        // Claude's transcript records its real cwd. Prefer it so a nested job
        // worktree is not collapsed into its repository root by the lossy
        // slash→dash directory encoding. Old transcripts retain the prior
        // direct-child fallback when no cwd is available.
        const meta = firstLineJson(file);
        const transcriptCwd = meta?.cwd ?? meta?.payload?.cwd;
        const cwd =
          typeof transcriptCwd === "string" && transcriptCwd.startsWith(`${src}/`)
            ? transcriptCwd
            : fallbackCwd;
        const cst = safeStat(cwd);
        if (!cst || !statSync(cwd).isDirectory()) continue;
        const project = projectForCwd(src, cwd);
        if (!project) continue;
        out.push({
          project,
          mtimeMs: st.mtimeMs,
          tool: "claude",
          sid: f.replace(/\.jsonl$/, ""),
          cwd: join(src, project),
          restoreClass: "unclassified",
        });
      }
    }
  }

  // --- codex: <home>/.codex/sessions/**/rollout-*.jsonl (cwd+id in line 1) ---
  const codexRoot = join(home, ".codex", "sessions");
  if (existsSync(codexRoot)) {
    for (const file of walk(codexRoot)) {
      const base = file.split("/").pop() ?? "";
      if (!base.startsWith("rollout-") || !base.endsWith(".jsonl")) continue;
      const st = safeStat(file);
      if (!st || st.mtimeMs < cutoff) continue;
      const meta = firstLineJson(file);
      const cwd: string | undefined = meta?.payload?.cwd;
      const id: string | undefined = meta?.payload?.id;
      if (!cwd || !id || !cwd.startsWith(`${src}/`)) continue;
      const project = projectForCwd(src, cwd);
      if (!project) continue;
      out.push({
        project,
        mtimeMs: st.mtimeMs,
        tool: "codex",
        sid: id,
        cwd,
        restoreClass: "unclassified",
      });
    }
  }

  return out;
}

/** Snapshot the external evidence once, rather than trusting a registry default. */
export function legacySessionEvidence(
  home: string = homedir(),
  liveTmuxSessions: ReadonlyArray<
    Pick<LocalSession, "name" | "path" | "profile">
  > = listLocalSessions(),
): LegacySessionEvidence {
  return { home, liveTmuxSessions };
}

/** Restore gate: only explicit or externally proven human sessions are restorable. */
export function isHumanFacingSession(
  e: RegistryEntry,
  evidence: LegacySessionEvidence = legacySessionEvidence(),
): boolean {
  return deriveLegacySessionClass(e, evidence) === "human";
}

/**
 * Last `customTitle` recorded in a claude conversation transcript — i.e. the
 * human-facing session name the SessionStart hook could NOT capture (the hook
 * only sees `session_id`). The transcript is
 * `<home>/.claude/projects/<encode(cwd)>/<convId>.jsonl`; each rename appends a
 * `{"type":"custom-title","customTitle":…}` line, so the LAST one wins. This is
 * the durable label→conversation-uuid bridge that lets `restore` join a `run`
 * entry (which recorded the LABEL as its convId) to the `hook` entry that holds
 * the real conversation uuid. Best-effort: undefined when the transcript is
 * absent/unreadable or the conversation was never titled.
 */
export function readConversationCustomTitle(
  home: string,
  cwd: string,
  convId: string,
): string | undefined {
  const file = join(
    home,
    ".claude",
    "projects",
    encodeCwd(cwd),
    `${convId}.jsonl`,
  );
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return undefined; // no transcript / unreadable
  }
  let title: string | undefined;
  for (const line of raw.split("\n")) {
    // Cheap pre-filter: only parse the (rare) custom-title lines.
    if (!line.includes('"custom-title"')) continue;
    try {
      const obj = JSON.parse(line) as { type?: string; customTitle?: unknown };
      if (obj.type === "custom-title" && typeof obj.customTitle === "string") {
        title = obj.customTitle;
      }
    } catch {
      // ignore a malformed transcript line — keep the last good title
    }
  }
  return title;
}

export function reconcileRunConvIds(
  entries: readonly RegistryEntry[],
  customTitleFor: (cwd: string, convId: string) => string | undefined,
  evidence: LegacySessionEvidence = legacySessionEvidence(),
): ConvIdResolution {
  return reconcileRunConvIdsPure(entries, customTitleFor, evidence);
}

/**
 * THE one host-inventory read of a restore: BOTH inventories captured once,
 * so the plan gate AND the layout render (launchLayout, which has no reader
 * of its own — F3) see the SAME probe state. A failed native inventory read
 * is carried as `known: false` — an UNKNOWN view, never an empty one.
 */
export function captureHostViewSnapshot() {
  const tmux = listLocalSessionsWithDiagnostics();
  const native = (() => {
    try {
      const sessions = listNativeSessions();
      return {
        known: true as const,
        complete: sessions.complete !== false,
        sessions: sessions
          .filter((session) => session.status === "running")
          .map((session) => ({
            name: session.id,
            controlled: session.controlled,
            socketPath: session.socketPath,
            ...applicationForeground(session),
          })),
      };
    } catch {
      return { known: false as const };
    }
  })();
  return {
    tmux: tmux.known
      ? { known: true as const, sessions: tmux.sessions }
      : { known: false as const, ...(tmux.reason !== undefined ? { reason: tmux.reason } : {}) },
    native,
  };
}

export function registrySessions(
  home: string = homedir(),
  entries: RegistryEntry[],
  resolution?: ConvIdResolution,
  evidence: LegacySessionEvidence = legacySessionEvidence(home),
  liveView?: ManagedLiveLookup,
  unreadable: readonly RawRow[] = [],
): DiscoveredSession[] {
  return registrySessionsPure(
    home,
    entries,
    resolution,
    evidence,
    liveView,
    unreadable,
  ).sessions;
}

function safeStat(p: string): { mtimeMs: number } | undefined {
  try {
    return statSync(p);
  } catch {
    return undefined;
  }
}

function firstLineJson(file: string): any {
  try {
    const buf = readFileSync(file, "utf8");
    const nl = buf.indexOf("\n");
    return JSON.parse(nl === -1 ? buf : buf.slice(0, nl));
  } catch {
    return undefined;
  }
}

function* walk(root: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

export type RestoreOptions = {
  dryRun?: boolean;
  /** Launch only the group whose title matches (exact or slug-normalized). */
  group?: string;
  /** Pre-resolved SCW tabs (from `remote ls`), used to fill `remote: true` groups. */
  remoteTabs?: RemoteTab[];
  /**
   * When true, open another view for already-visible tmux sessions. Native PTYs
   * remain single-controller: an uncontrolled live PTY is attached exactly once,
   * while a controlled live PTY is reported and skipped even with this flag.
   */
  reattach?: boolean;
  /**
   * Force the llm-mesh gateway posture for sessions launched by this restore.
   * Existing sessions keep their running posture and are only attached, never
   * replaced to apply this override.
   */
  forceGateway?: "gateway" | "direct";
  stderr?: NodeJS.WriteStream;
};

export type RestoreResult = {
  windows: LayoutWindow[];
  total: number;
  dropped: number;
  ledger: RestoreLedgerEntry[];
  observedTotals: RestoreObservedTotals;
  exitCode: number;
  registryConflicts: readonly RegistryConflictNote[];
};

function formatCatalogMessage(
  key: string,
  vars: Record<string, string | number>,
): string {
  let msg = humanOutputText(key);
  for (const [k, v] of Object.entries(vars)) {
    msg = msg.split(`{${k}}`).join(String(v));
  }
  return msg;
}

function nonSelectedPrimaryOutcome(
  c: RestorePlanResult["classifications"][number],
): RestoreLedgerOutcome | undefined {
  if (c.outcome === "explicit-overflow") return `excluded:${c.reason}`;
  if (c.outcome === "shared-overflow") return `excluded:${c.reason}`;
  if (c.outcome !== "refused") return undefined;
  switch (c.reason) {
    case "unresolved-conversation":
    case "host-unknown":
      return `deferred:${c.reason}`;
    case "dual-host-ambiguous":
      return `failed:${c.reason}`;
    case "remote-backed":
    case "group-filter":
      return `excluded:${c.reason}`;
    default:
      return undefined;
  }
}

/** Full restore: discover (local) + inject SCW (remote) -> order -> filter -> launch. */
export function restore(opts: RestoreOptions = {}): RestoreResult {
  const cfg = getLayoutConfig();
  const stderr = opts.stderr ?? process.stderr;
  const remoteTabs = opts.remoteTabs ?? [];
  const home = homedir();
  const registryRead = loadRegistry();
  if (registryRead.state === "unknown") {
    stderr.write(
      `[h2a] restore refused: the local registry is unreadable (${registryRead.reason}); nothing was launched (fail closed).\n`,
    );
    const ledger: RestoreLedgerEntry[] = [];
    return {
      windows: [],
      total: 0,
      dropped: 0,
      ledger,
      observedTotals: summarizeRestoreLedger(ledger),
      exitCode: 1,
      registryConflicts: [],
    };
  }
  const evidence = legacySessionEvidence(home);
  const scanned = discoverSessions(cfg.maxAgeHours * 3600 * 1000);
  const hostView = captureHostViewSnapshot();

  const plan = buildRestorePlan(
    {
      home,
      config: cfg,
      registryRead,
      scanned,
      hostView,
      evidence,
      customTitleFor: (cwd, convId) =>
        readConversationCustomTitle(home, cwd, convId),
      remoteTabs,
    },
    { group: opts.group },
  );

  // Persist the resolved conversation ids back onto the run entries so the state
  // is EMITTED, not re-derived (a transcript scan) on every restore. Skipped on
  // --dry-run so a preview stays side-effect-free.
  if (!opts.dryRun) {
    try {
      persistReconciledConvIds(plan.reconciledConvIdUpdates);
    } catch {
      // best-effort: a persistence hiccup must never break restore
    }
  }

  for (const conflict of plan.registryConflicts) {
    stderr.write(
      `[h2a] ${formatCatalogMessage("restore.conflict.managedName", {
        label: conflict.label,
        managedName: conflict.managedName,
        runId: conflict.runId,
        hookId: conflict.hookId,
      })}\n`,
    );
  }
  for (const skip of plan.unresolvedSkipEntries) {
    stderr.write(
      `[h2a] restore skipped "${skip.label}": no resolved conversation id ` +
        `(convId ${skip.convId ? `"${skip.convId}"` : "missing"} is not a real conversation); ` +
        `attach it live with h2a attach ${slugify(skip.label)}\n`,
    );
  }
  for (const name of plan.ambiguousDualHostNames) {
    stderr.write(
      `[h2a] restore skipped "${name}": recorded on BOTH local hosts (local-tmux AND local-native); ` +
        "clean up the conflicting registry rows before restoring it\n",
    );
  }
  if (plan.remoteBackedCount > 0) {
    stderr.write(
      `[h2a] ${plan.remoteBackedCount} session(s) déjà sur le contrôle distant — pas de relance locale: ${plan.remoteBackedLabels.join(", ")}\n`,
    );
  }

  const { windows, total, dropped } = plan;
  for (const w of windows) {
    stderr.write(`  ${w.title} (${w.tabs.length}):\n`);
    for (const t of w.tabs) {
      const what = t.remoteId
        ? `SCW:${t.remoteId}`
        : `${t.tool} (local) [${t.origin === "registry" ? "registry" : "guess"}]`;
      stderr.write(`    - ${t.label}  ${what}  ${t.cwd}\n`);
    }
  }
  if (dropped > 0 && !opts.group)
    stderr.write(`  (! ${dropped} session(s) ignorée(s), plafond atteint)\n`);

  const launchOpts = {
    ...(opts.reattach ? { reattach: true } : {}),
    ...(opts.forceGateway ? { forceGateway: opts.forceGateway } : {}),
  };

  let tabOutcomes: TabLaunchOutcome[] = [];
  if (!opts.dryRun && total > 0) {
    const launched = launchLayoutWithOutcomes(windows, hostView, stderr, launchOpts);
    tabOutcomes = launched.tabOutcomes;
    if (launched.opened > 0) {
      // Auto-record the launched layout (inspect with `remote layout show`).
      try {
        writeLastLayout(windows, opts.group);
      } catch {
        // best-effort: the windows are open regardless
      }
    }
  } else if (total > 0) {
    const dryPlan = planLayoutLaunch(windows, hostView, launchOpts);
    for (const warning of dryPlan.warnings) {
      stderr.write(warning);
    }
    tabOutcomes = dryPlan.windows.flatMap((w) =>
      w.decisions.map((decision) => ({
        tab: decision.tab,
        decision,
        outcome:
          decision.kind === "attach" || decision.kind === "launch"
            ? ("deferred:dry-run" as const)
            : decision.ledgerOutcome,
      })),
    );
  }

  const selectedKeyByTab = new Map<LayoutTab, string>();
  for (const c of plan.classifications) {
    if (c.outcome === "selected") selectedKeyByTab.set(c.tab, c.key);
  }
  const ledger: RestoreLedgerEntry[] = tabOutcomes.map((item, idx) => ({
    key:
      selectedKeyByTab.get(item.tab) ??
      (item.tab.remoteId
        ? `remote:${item.tab.remoteId}`
        : `tab:${item.tab.managedName ?? item.tab.label}:${idx}`),
    label: item.tab.label,
    ...(item.tab.managedName !== undefined
      ? { managedName: item.tab.managedName }
      : {}),
    outcome: item.outcome,
  }));

  for (const c of plan.classifications) {
    const outcome = nonSelectedPrimaryOutcome(c);
    if (outcome === undefined) continue;
    const managedName = "session" in c ? c.session?.managedName : undefined;
    ledger.push({
      key: c.key,
      label: c.label,
      ...(managedName !== undefined ? { managedName } : {}),
      outcome,
    });
  }

  const observedTotals = summarizeRestoreLedger(ledger);
  const hasBlockerOrFailure = ledger.some(
    (entry) =>
      entry.outcome.startsWith("failed:") ||
      entry.outcome.startsWith("deferred:"),
  );
  const exitCode = opts.dryRun ? (plan.ok ? 0 : 1) : hasBlockerOrFailure ? 1 : 0;

  return {
    windows,
    total,
    dropped,
    ledger,
    observedTotals,
    exitCode,
    registryConflicts: plan.registryConflicts,
  };
}

// ---------------------------------------------------------------------------
// layout-last.json — auto-recorded snapshot of the last launched layout
// ---------------------------------------------------------------------------

export type LastLayout = {
  at: string;
  group?: string;
  windows: Array<{
    title: string;
    tabs: Array<{ cwd: string; label: string; cmd: string }>;
  }>;
};

export function lastLayoutPath(): string {
  return join(dirname(resolveConfigPath()), "layout-last.json");
}

/** Persist the just-launched layout to <configDir>/layout-last.json (atomic). */
export function writeLastLayout(
  windows: LayoutWindow[],
  group?: string,
): void {
  const data: LastLayout = {
    at: new Date().toISOString(),
    ...(group !== undefined ? { group } : {}),
    windows: windows.map((w) => ({
      title: w.title,
      tabs: w.tabs.map((t) => ({
        cwd: t.cwd,
        label: t.label,
        cmd: tabCommand(t),
      })),
    })),
  };
  const path = lastLayoutPath();
  guardTestStateWrite(dirname(path));
  guardTestStateWrite(path);
  const tmp = `${path}.tmp.${process.pid}`;
  guardTestStateWrite(tmp);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  guardTestStateMove(tmp, path);
  renameSync(tmp, path);
}

/** Read the recorded layout, or undefined when none was launched yet. */
export function readLastLayout(): LastLayout | undefined {
  try {
    const parsed = JSON.parse(readFileSync(lastLayoutPath(), "utf8"));
    if (!parsed || typeof parsed !== "object") return undefined;
    return parsed as LastLayout;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// `h2a restore --station` — the single-terminal station (panel lot S1)
// ---------------------------------------------------------------------------

/** Station state, next to `layout-last.json` (atomic, owner-only, tolerant). */
export function stationStatePath(): string {
  return join(dirname(resolveConfigPath()), STATION_STATE_FILE_NAME);
}

export type RestoreStationPlan =
  | { readonly ok: true; readonly live: number; readonly dead: number }
  | { readonly ok: false; readonly reason: string };

/**
 * Refusals that name a dead session restore knows about. An unknown host view
 * or an identity present on two hosts is not "dead": it is never counted (I7).
 */
const STATION_DEAD_REFUSALS: ReadonlySet<RestoreRefusalReason> = new Set([
  "unresolved-conversation",
  "per-project-scan-cap",
  "unclassified-scan",
]);

/**
 * Live and dead sessions of the pure restore plan. Before S2 the station
 * neither lists nor relaunches a dead session: it displays their number. An
 * unknown host view never reads as dead sessions.
 */
export function summarizeStationPlan(
  plan: Pick<RestorePlanResult, "ok" | "refusalDetail" | "classifications">,
  hostView: HostViewSnapshot,
): RestoreStationPlan {
  if (!plan.ok) return { ok: false, reason: plan.refusalDetail ?? "unknown" };
  if (!hostView.native.known) return { ok: true, live: 0, dead: 0 };
  const native = new Set(hostView.native.sessions.map((session) => session.name));
  const tmux = new Set(
    hostView.tmux.known ? hostView.tmux.sessions.map((session) => session.name) : [],
  );
  let live = 0;
  let dead = 0;
  for (const classification of plan.classifications) {
    if (classification.outcome === "refused") {
      if (!STATION_DEAD_REFUSALS.has(classification.reason)) continue;
      // The plan refuses a dead registry row whose conversation is unresolved
      // without building a session for it: it is dead all the same.
      if (classification.session === undefined) {
        dead += 1;
        continue;
      }
    }
    const session = classification.session;
    if (session === undefined) continue;
    const name = session.managedName;
    const isLive =
      name !== undefined &&
      (session.hostKind === "local-tmux" ? tmux.has(name) : native.has(name));
    if (isLive) live += 1;
    else dead += 1;
  }
  return { ok: true, live, dead };
}

/** The same plan as `restore()`, read-only: nothing is written or launched. */
export function planRestoreStation(): RestoreStationPlan {
  const home = homedir();
  const registryRead = loadRegistry();
  if (registryRead.state === "unknown") return { ok: false, reason: registryRead.reason };
  const cfg = getLayoutConfig();
  const hostView = captureHostViewSnapshot();
  const plan = buildRestorePlan(
    {
      home,
      config: cfg,
      registryRead,
      scanned: discoverSessions(cfg.maxAgeHours * 3600 * 1000),
      hostView,
      evidence: legacySessionEvidence(home),
      customTitleFor: (cwd, convId) => readConversationCustomTitle(home, cwd, convId),
      remoteTabs: [],
    },
    {},
  );
  return summarizeStationPlan(plan, hostView);
}

/**
 * Internal op entry of the station bridge. Same resolution as the attach
 * launcher of native-host.ts (its helper is private to that module): the
 * sibling `op.js` in dist, or the compiled twin when executing from src.
 */
function stationBridgeEntryPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const sibling = join(here, "native-terminal", "op.js");
  if (existsSync(sibling)) return sibling;
  if (basename(here) === "src") {
    const built = join(dirname(here), "dist", "native-terminal", "op.js");
    if (existsSync(built)) return built;
  }
  return sibling;
}

/** Guard process + bridge, as `h2a attach`: the guard survives a killed bridge. */
function launchStationBridge(args: readonly string[]): number {
  const result = withAttachTerminalRecovery((env) =>
    spawnSync(process.execPath, [stationBridgeEntryPath(), ...args], {
      stdio: "inherit",
      env,
    }),
  );
  return result.status ?? 1;
}

export type RestoreStationOptions = {
  /** Accepted, not used before S2 (it becomes the initial tab there). */
  group?: string;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  stderr?: { write(chunk: string): unknown };
  plan?: () => RestoreStationPlan;
  launch?: (args: readonly string[]) => number;
  statePath?: string;
  locale?: string;
};

/**
 * `h2a restore --station`: every live native session in this terminal, with
 * the side panel. TTY only in S1: without one the refusal is clear and has no
 * effect (no inventory, no plan, no file). Returns the process exit code.
 */
export function restoreStation(opts: RestoreStationOptions = {}): number {
  const stderr = opts.stderr ?? process.stderr;
  const say = (key: string, vars: Record<string, string> = {}): void => {
    const text = humanOutputText(key, opts.locale).replace(
      /\{(\w+)\}/g,
      (match, name: string) => vars[name] ?? match,
    );
    stderr.write(`[h2a] ${text}\n`);
  };
  const stdinIsTTY = opts.stdinIsTTY ?? process.stdin.isTTY === true;
  const stdoutIsTTY = opts.stdoutIsTTY ?? process.stdout.isTTY === true;
  if (!stdinIsTTY || !stdoutIsTTY) {
    say("station.refusal.notTty");
    return 1;
  }
  if (opts.group !== undefined) say("station.notice.groupIgnored", { group: opts.group });
  const plan = (opts.plan ?? planRestoreStation)();
  if (!plan.ok) {
    stderr.write(
      `[h2a] restore refused: the local registry is unreadable (${plan.reason}); nothing was launched (fail closed).\n`,
    );
    return 1;
  }
  return (opts.launch ?? launchStationBridge)([
    "station",
    "--state-file",
    opts.statePath ?? stationStatePath(),
    "--dead-count",
    String(plan.dead),
  ]);
}
