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
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  isLiveFacetRow,
  launchLayout,
  resolveOccupiedHumanRefusals,
  tabCommand,
  type HostViewSnapshot,
  type SessionFacetRow,
} from "./launch-layout.js";
import { humanOutputText } from "./human-output.js";

import {
  getLayoutConfig,
  resolveConfigPath,
  type LayoutConfig,
  type LayoutGroup,
} from "./config.js";
// Lot LG (D13) — re-exported so group-config validation lives next to the
// grouping it guards (the `restore-groups` suite imports both from here).
export { normalizeLayoutGroups, validateLayoutGroups } from "./config.js";
import { encodeCwd } from "./convsync.js";
import {
  classifyRestoreFacet,
  isManagedLocalKind,
  loadRegistry,
  looksLikeConversationUuid,
  persistReconciledConvIds,
  persistRestoreFacets,
  resolveManagedHost,
  type ManagedHostProbeResult,
  type RawRow,
  type RegistryEntry,
  type RestoreFacet,
} from "./registry.js";
import {
  listLocalSessions,
  listLocalSessionsWithDiagnostics,
  localSessionName,
  managedSessionCandidates,
  slugify,
  type LocalSession,
} from "./tmux.js";
import type { SessionClass } from "./session-class.js";
import { listNativeSessions } from "./native-host.js";
import { guardTestStateWrite } from "./test-state-guard.js";

// Compatibility re-exports: the layout renderer lives in launch-layout.ts —
// a module WITHOUT reader access (F3) — but callers keep importing it here.
export {
  ambiguousLiveSessionNames,
  launchLayout,
  tabCommand,
  type HostViewSnapshot,
} from "./launch-layout.js";
import {
  decideInPlaceResume,
  type HostProcessSnapshot,
} from "./launch-layout.js";

export type DiscoveredSession = {
  project: string;
  mtimeMs: number;
  tool: "claude" | "codex" | "agy" | "muse" | "vibe";
  sid: string;
  cwd: string;
  /** "registry" = enrolled live session (reliable); "scan" = mtime guess. */
  origin?: "registry" | "scan";
  /** Preferred tab label (registry entries carry a reliable one). */
  label?: string;
  /** Pinned llm-mesh gateway posture (from an explicit --gw/--no-gw at launch). */
  gatewayMode?: "gateway" | "direct";
  bare?: boolean;
  /**
   * Persisted local terminal host of a registry-backed session
   * (isManagedLocalKind). Under tmux abandonment a NON-LIVE session's
   * replacement is created on the NATIVE host either way, but the recorded
   * kind still drives the drain view (live legacy tmux stays attach-only).
   */
  hostKind?: "local-tmux" | "local-native";
  /**
   * Resolver verdict (rule 3), stamped at plan time: `resolveManagedHost`
   * returned `ambiguous` for this exact managed identity — it is recorded on
   * BOTH local hosts and no act may pick one. `dropDualHostIdentities` acts
   * on THIS stamp; nothing downstream re-decides the dual-host rule.
   */
  hostAmbiguous?: boolean;
  /** Registry row id backing this session (registry origin only). */
  registryId?: string;
  /**
   * EXACT managed session name of a registry-backed managed row. Carried so
   * layout rendering acts on the exact identity — it must never re-derive a
   * live target from `slugify(label)` across hosts.
   */
  managedName?: string;
  /**
   * §4.1 attach-live plan: the row is LIVE on its persisted host and its
   * conversation id is unresolved — restore re-enters it by exact managed
   * name only. No resume id exists; a run/replace must never be emitted.
   */
  attachLive?: boolean;
  /**
   * Positive restore marker. Registry entries are explicitly `human`; a raw
   * transcript scan is always `unclassified` because it carries no role/class.
   */
  restoreClass: "human" | "unclassified";
  /**
   * Lot LG (D13) — registry tags for tag-matcher groups (passthrough from
   * the registry row; scans carry none).
   */
  tags?: string[];
};

export type LayoutTab = {
  cwd: string;
  label: string;
  /** local resume (claude/codex tmux) */
  tool?: string;
  sid?: string;
  /** SCW session attached via `remote attach <id> --exec` */
  remoteId?: string;
  /** discovery provenance, shown as [registry]/[guess] in --dry-run */
  origin?: "registry" | "scan";
  /** Pinned llm-mesh gateway posture; re-emitted as --gw/--no-gw on restore. */
  gatewayMode?: "gateway" | "direct";
  bare?: boolean;
  /** Persisted local host; drives the drain view + native replacement pin. */
  hostKind?: "local-tmux" | "local-native";
  /** Exact managed session name (registry-backed tabs). */
  managedName?: string;
  /** Attach-only tab for a live managed row without a resolved conversation. */
  attachLive?: boolean;
};

export type LayoutWindow = { title: string; tabs: LayoutTab[] };

/** A pre-resolved SCW tab for a remote group (built by the caller from `remote ls`). */
export type RemoteTab = {
  id: string;
  label: string;
  cwd: string;
  /**
   * Lot L5 (D12c) — durable restore facet when the control plane reports
   * one. Absent = unclassified remote row (admitted as today until the
   * server reports facets); `secondary` rows are excluded from the default
   * plan and restored only with the opt-in.
   */
  restoreFacet?: RestoreFacet;
};

/**
 * Lot L5 (D12c) — remote-tab selection per group (D12). Secondary remote
 * rows are excluded from the default plan; the explicit opt-in admits them.
 * Unclassified rows (no facet reported) are admitted as today.
 */
export function selectRemoteTabsForGroups(
  tabs: ReadonlyArray<RemoteTab>,
  opts: { includeSecondary?: boolean } = {},
): RemoteTab[] {
  if (opts.includeSecondary === true) return tabs.slice();
  return tabs.filter((t) => t.restoreFacet !== "secondary");
}

/**
 * Lot LG (D13) — fill `remote: true` groups from the SCW tabs, first match
 * wins, exactly one group per tab. A remote group with NO matchers is an
 * explicit catch-all for the tabs no matcher group claimed (local groups
 * keep their own shared-window fallback instead). Tabs claimed by no remote
 * group are left unassigned — the caller reports them, never drops them
 * silently.
 */
export function assignRemoteTabsToGroups(
  tabs: ReadonlyArray<RemoteTab>,
  groups: ReadonlyArray<LayoutGroup>,
): Map<string, RemoteTab[]> {
  const assigned = new Map<string, RemoteTab[]>();
  const placed = new Set<RemoteTab>();
  const put = (title: string, t: RemoteTab): void => {
    const arr = assigned.get(title) ?? [];
    arr.push(t);
    assigned.set(title, arr);
    placed.add(t);
  };
  const matches = (t: RemoteTab, g: LayoutGroup): boolean => {
    if ((g.projects ?? []).includes(t.label)) return true;
    for (const raw of g.cwdPrefixes ?? []) {
      const prefix = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
      if (t.cwd === prefix || t.cwd.startsWith(`${prefix}/`)) return true;
    }
    return false;
  };
  for (const g of groups) {
    if (g.remote !== true) continue;
    const hasMatchers =
      (g.projects?.length ?? 0) > 0 || (g.cwdPrefixes?.length ?? 0) > 0;
    for (const t of tabs) {
      if (placed.has(t)) continue;
      // A matcher-less remote group is the explicit catch-all; otherwise
      // only a matcher hit claims the tab.
      if (!hasMatchers || matches(t, g)) put(g.title, t);
    }
  }
  return assigned;
}

/** Project identity is the whole workspace path below ~/src, never its root. */
function projectForCwd(src: string, cwd: string): string | undefined {
  const prefix = `${src}/`;
  if (!cwd.startsWith(prefix)) return undefined;
  const project = cwd.slice(prefix.length);
  return project || undefined;
}

/**
 * Discover claude + codex sessions under ~/src/* newer than maxAgeMs.
 *
 * Lot LG (D13) — `extraRoots` (a local group's `cwdPrefixes` matchers)
 * extends the scan beyond `~/src`: transcript dirs of every discovery root
 * are walked, and rows under a group root are exempt from the age cutoff
 * (the group explicitly asked for that fleet). With no extra roots the walk
 * and the admission are byte-identical to the ~/src-only scan.
 */
export function discoverSessions(
  maxAgeMs: number,
  home: string = homedir(),
  extraRoots: readonly string[] = [],
): DiscoveredSession[] {
  const src = join(home, "src");
  const cutoff = Date.now() - maxAgeMs;
  const out: DiscoveredSession[] = [];
  // Discovery roots, longest first so a nested group root beats its parent.
  // `~/src` stays first when lengths tie (it is the default base).
  const scanBases = [
    src,
    ...new Set(
      extraRoots
        .map((r) => (r.length > 1 ? r.replace(/\/+$/, "") : r))
        .filter((r) => r.length > 0 && r !== src),
    ),
  ].sort((a, b) => b.length - a.length || (a === src ? -1 : 1));
  const baseForCwd = (cwd: string): string | undefined =>
    scanBases.find((base) => cwd === base || cwd.startsWith(`${base}/`));

  // --- claude: <home>/.claude/projects/<encode(<base>/<proj>)…>/<sid>.jsonl ---
  const claudeRoot = join(home, ".claude", "projects");
  const claudePrefixes = scanBases.map((base) => ({
    base,
    prefix: `${encodeCwd(base)}-`,
  }));
  if (existsSync(claudeRoot)) {
    for (const dirName of readdirSync(claudeRoot)) {
      const hit = claudePrefixes.find(({ prefix }) =>
        dirName.startsWith(prefix),
      );
      if (!hit) continue;
      // claude encodes the full cwd as "/"→"-"; the remainder after the
      // base prefix IS the project for a direct child of that base. Keep it
      // whole (project names contain "-": sent-tech-design-system) and skip
      // anything that isn't an existing dir (sub-paths encode ambiguously
      // and the workdir wouldn't exist anyway).
      const encodedProject = dirName.slice(hit.prefix.length);
      const fallbackCwd = join(hit.base, encodedProject);
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
        if (!st) continue;
        // Claude's transcript records its real cwd. Prefer it so a nested job
        // worktree is not collapsed into its repository root by the lossy
        // slash→dash directory encoding. Old transcripts retain the prior
        // direct-child fallback when no cwd is available.
        const meta = firstLineJson(file);
        const transcriptCwd = meta?.cwd ?? meta?.payload?.cwd;
        const cwd =
          typeof transcriptCwd === "string" &&
          baseForCwd(transcriptCwd) !== undefined
            ? transcriptCwd
            : fallbackCwd;
        const base = baseForCwd(cwd);
        if (!base) continue;
        // Group roots are exempt from the age cutoff; ~/src keeps it.
        if (st.mtimeMs < cutoff && base === src) continue;
        const cst = safeStat(cwd);
        if (!cst || !statSync(cwd).isDirectory()) continue;
        const project = projectForCwd(base, cwd);
        if (!project) continue;
        out.push({
          project,
          mtimeMs: st.mtimeMs,
          tool: "claude",
          sid: f.replace(/\.jsonl$/, ""),
          // ~/src rows keep the canonical join (as before); group-root rows
          // keep their real cwd (no canonical base exists outside ~/src).
          cwd: base === src ? join(src, project) : cwd,
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
      if (!st) continue;
      const meta = firstLineJson(file);
      const cwd: string | undefined = meta?.payload?.cwd;
      const id: string | undefined = meta?.payload?.id;
      if (!cwd || !id) continue;
      const cwdBase = baseForCwd(cwd);
      if (!cwdBase) continue;
      // Group roots are exempt from the age cutoff; ~/src keeps it.
      if (st.mtimeMs < cutoff && cwdBase === src) continue;
      const project = projectForCwd(cwdBase, cwd);
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

/** Out-of-registry facts allowed to classify a legacy session as human. */
export type LegacySessionEvidence = {
  readonly home: string;
  readonly liveTmuxSessions: ReadonlyArray<
    Pick<LocalSession, "name" | "path" | "profile">
  >;
  /** A caller that obtained an explicit human confirmation may name its entry. */
  readonly humanConfirmedIds?: ReadonlySet<string>;
};

/** Snapshot the external evidence once, rather than trusting a registry default. */
export function legacySessionEvidence(
  home: string = homedir(),
  liveTmuxSessions: ReadonlyArray<
    Pick<LocalSession, "name" | "path" | "profile">
  > = listLocalSessions(),
): LegacySessionEvidence {
  return { home, liveTmuxSessions };
}

function hasClaudeTranscript(e: RegistryEntry, home: string): boolean {
  if (e.tool !== "claude" || !e.convId) return false;
  try {
    const stat = statSync(
      join(home, ".claude", "projects", encodeCwd(e.cwd), `${e.convId}.jsonl`),
    );
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function hasCodexTranscript(e: RegistryEntry, home: string): boolean {
  if (e.tool !== "codex" || !e.convId) return false;
  for (const file of walk(join(home, ".codex", "sessions"))) {
    if (!file.endsWith(".jsonl")) continue;
    const meta = firstLineJson(file);
    if (meta?.payload?.cwd === e.cwd && meta?.payload?.id === e.convId) {
      return true;
    }
  }
  return false;
}

function hasLegacyTranscript(e: RegistryEntry, home: string): boolean {
  return hasClaudeTranscript(e, home) || hasCodexTranscript(e, home);
}

function hasLiveTmuxEvidence(
  e: RegistryEntry,
  liveTmuxSessions: LegacySessionEvidence["liveTmuxSessions"],
): boolean {
  return (
    e.tmuxSession !== undefined &&
    liveTmuxSessions.some(
      (session) =>
        session.name === e.tmuxSession &&
        session.path === e.cwd &&
        session.profile === e.tool,
    )
  );
}

/**
 * Classify a legacy registry record from evidence held outside the registry.
 * Absence is not proof of a human: anything inconclusive is background.
 */
export function deriveLegacySessionClass(
  e: RegistryEntry,
  evidence: LegacySessionEvidence,
): SessionClass {
  if (e.endedAt !== undefined || e.role === "job") return "background";
  if (e.sessionClass !== undefined) return e.sessionClass;
  if (evidence.humanConfirmedIds?.has(e.id)) return "human";
  if (hasLegacyTranscript(e, evidence.home)) return "human";
  if (hasLiveTmuxEvidence(e, evidence.liveTmuxSessions)) return "human";
  return "background";
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

/**
 * Outcome of reconciling `run` local-tmux entries against the `hook` entries
 * that carry the real conversation id for the SAME live session.
 */
export type ConvIdResolution = {
  /** run entry id → the real conversation id to emit as the resume sid. */
  resolvedSid: Map<string, string>;
  /** run entry ids with NO resolvable conversation id — restore must SKIP these
   *  (never emit a broken `--resume <label>`), noting an attach hint instead. */
  unresolvedRunIds: Set<string>;
  /** conversation ids OWNED by a run entry — the matching hook entry is a dup of
   *  the same conversation and must not ALSO surface as an anonymous tab. */
  claimedConvIds: Set<string>;
};

/**
 * Reconcile `run` ↔ `hook` registry entries for the same live/known session.
 *
 * Root cause: `h2a run` enrolls a `source:"run"`, `kind:"local-tmux"` entry
 * whose `convId` is the LABEL (e.g. `llm-mesh`), while the Claude SessionStart
 * hook enrolls a SEPARATE `source:"hook"`, `kind:"local"` entry that holds the
 * REAL conversation uuid but no label. Nothing joins them, so restore emits
 * `claude --resume llm-mesh` (fails) and the hook entry looks anonymous.
 *
 * Join-key strategy (highest priority first):
 *  1. the run entry ALREADY carries a real conversation uuid → trust it (it was
 *     captured at launch, e.g. from an explicit `--resume <uuid>`);
 *  2. same `cwd` + the run entry's `label` equals a hook conversation's
 *     `customTitle` (read from its `.jsonl`) → adopt that hook's convId;
 *  3. a canonical-broken convId (missing, or `=== label`, or `=== id`) with no
 *     match → UNRESOLVED (skip);
 *  4. a claude session whose cwd HAS known conversations but none matched, and
 *     whose convId is not a real uuid → UNRESOLVED (an untrustworthy label);
 *  5. otherwise (no transcript knowledge, e.g. codex, or a never-scanned cwd)
 *     trust the recorded convId rather than drop a live session.
 *
 * Pure: `customTitleFor(cwd, convId)` is injected (production reads the jsonl via
 * `readConversationCustomTitle`; tests pass a stub map), so the whole join is
 * unit-testable with plain registry entries.
 */
export function reconcileRunConvIds(
  entries: readonly RegistryEntry[],
  customTitleFor: (cwd: string, convId: string) => string | undefined,
  evidence: LegacySessionEvidence = legacySessionEvidence(),
): ConvIdResolution {
  // Hook conversations per cwd — their convId IS the real conversation uuid, and
  // the transcript records the human-facing label as `customTitle`.
  type HookConv = { convId: string; title: string | undefined; lastSeenAt: string };
  const hooksByCwd = new Map<string, HookConv[]>();
  for (const e of entries) {
    if (e.kind !== "local" || e.source !== "hook" || e.tool !== "claude") continue;
    if (!looksLikeConversationUuid(e.convId)) continue;
    const list = hooksByCwd.get(e.cwd) ?? [];
    list.push({
      convId: e.convId!,
      title: customTitleFor(e.cwd, e.convId!),
      lastSeenAt: e.lastSeenAt,
    });
    hooksByCwd.set(e.cwd, list);
  }

  const resolvedSid = new Map<string, string>();
  const unresolvedRunIds = new Set<string>();
  const claimedConvIds = new Set<string>();

  for (const r of entries) {
    if (!isManagedLocalKind(r.kind) || r.source !== "run") continue;
    // Delegated jobs / background launches are never restored as human tabs, so
    // don't reconcile (and don't emit a spurious skip note) for them.
    if (!isHumanFacingSession(r, evidence)) continue;
    const hooks = hooksByCwd.get(r.cwd) ?? [];

    // 1. The run entry already carries a real conversation uuid — trust it.
    if (looksLikeConversationUuid(r.convId)) {
      resolvedSid.set(r.id, r.convId!);
      claimedConvIds.add(r.convId!);
      continue;
    }
    // 2. Join to a hook conversation whose customTitle equals this label.
    if (r.label !== undefined) {
      const matches = hooks.filter((h) => h.title === r.label);
      if (matches.length > 0) {
        const chosen = matches
          .slice()
          .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0]!;
        resolvedSid.set(r.id, chosen.convId);
        claimedConvIds.add(chosen.convId);
        continue;
      }
    }
    // 3. Canonical-broken convId (the LABEL was written as the id, or none).
    if (!r.convId || r.convId === r.label || r.convId === r.id) {
      unresolvedRunIds.add(r.id);
      continue;
    }
    // 4. A claude session whose cwd HAS known conversations but none matched the
    //    label, and whose convId is not a real uuid, is untrustworthy → skip.
    if (r.tool === "claude" && hooks.length > 0) {
      unresolvedRunIds.add(r.id);
      continue;
    }
    // 5. No transcript knowledge (codex, or a cwd we never scanned): trust the
    //    recorded convId as-is rather than dropping a live session.
    resolvedSid.set(r.id, r.convId);
    claimedConvIds.add(r.convId);
  }

  return { resolvedSid, unresolvedRunIds, claimedConvIds };
}

/**
 * One host-probe lookup consumed by the restore PLAN (attach-live gate).
 * "unknown" is a probe failure — never proof of death.
 */
export type ManagedLiveLookup = (
  kind: "local-tmux" | "local-native",
  names: readonly string[],
) =>
  | { state: "live"; name: string }
  | { state: "dead" }
  | { state: "unknown" };

/**
 * THE one host-inventory read of a restore: BOTH inventories captured once,
 * so the plan gate AND the layout render (launchLayout, which has no reader
 * of its own — F3) see the SAME probe state. A failed native inventory read
 * is carried as `known: false` — an UNKNOWN view, never an empty one.
 */
export function captureHostViewSnapshot(): HostViewSnapshot {
  const tmux = listLocalSessionsWithDiagnostics();
  const native: HostViewSnapshot["native"] = (() => {
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
          })),
      };
    } catch {
      return { known: false as const };
    }
  })();
  return {
    tmux: tmux.known
      ? { known: true, sessions: tmux.sessions }
      : { known: false, ...(tmux.reason !== undefined ? { reason: tmux.reason } : {}) },
    native,
  };
}

/**
 * Adapt the ONE `HostViewSnapshot` to the plan's ManagedLiveLookup probe
 * surface: every plan decision of one restore reads the same batch snapshot.
 * A `known: false` inventory yields "unknown" for that host's sessions —
 * restore must fail closed on it, never treat it as death.
 */
export function managedLiveLookupFromSnapshot(
  view: HostViewSnapshot,
): ManagedLiveLookup {
  return (kind, names) => {
    if (kind === "local-native") {
      if (!view.native.known) return { state: "unknown" };
      const running = view.native.sessions;
      if (names.some(name => running.filter(session => session.name === name).length > 1)) return { state: "unknown" };
      const hit = names.find((name) =>
        running.some((session) => session.name === name),
      );
      return hit !== undefined ? { state: "live", name: hit }
        : view.native.complete === false ? { state: "unknown" } : { state: "dead" };
    }
    if (!view.tmux.known) return { state: "unknown" };
    const sessions = view.tmux.sessions;
    const hit = names.find((name) =>
      sessions.some((session) => session.name === name),
    );
    return hit !== undefined ? { state: "live", name: hit } : { state: "dead" };
  };
}

/**
 * Adapt the plan's ONE `ManagedLiveLookup` snapshot to `resolveManagedHost`'s
 * injected probe surface, so every per-session host decision of a restore
 * reads the SAME batch snapshot — the resolver is consulted per session but
 * never re-probes a host per session (no TOCTOU across the batch). A plan
 * built WITHOUT a snapshot (legacy callers) must never probe live hosts from
 * inside discovery either: its probes answer "unknown" (fail closed), never
 * a real probe.
 */
function managedHostProbes(liveView: ManagedLiveLookup | undefined): {
  native: (name: string) => ManagedHostProbeResult;
  tmux: (name: string) => ManagedHostProbeResult;
} {
  const probe =
    (kind: "local-native" | "local-tmux") =>
    (name: string): ManagedHostProbeResult => {
      if (!liveView) return "unknown";
      const r = liveView(kind, [name]);
      if (r.state === "live") return "live";
      return r.state === "dead" ? "dead" : "unknown";
    };
  return { native: probe("local-native"), tmux: probe("local-tmux") };
}

/**
 * REGISTRY-FIRST discovery: durable registry entries (local kinds) mapped to
 * discovered sessions. label/cwd/convId come straight from enrolment, no
 * mtime guessing. `entries` is injectable for tests (defaults to listLive()).
 *
 * `resolution` (from `reconcileRunConvIds`) rewires convIds so a named `run`
 * session resumes on its REAL conversation uuid, drops a run session that has no
 * resolvable conversation (so restore never emits `--resume <label>`), and
 * dedups the `hook` twin of a conversation already represented by a run session.
 * Omitted (the plain 2-arg call) → legacy behaviour, one session per entry.
 *
 * `liveView` (one host-probe snapshot) upgrades the unresolved-convId gate to
 * the §4.1 state machine: a LIVE managed row is never lost to a broken
 * conversation id — it becomes an ATTACH-LIVE session keyed on its persisted
 * kind + exact managed name. Without it (legacy callers), every unresolved
 * row is skipped as before.
 *
 * `unreadable` (PART A/A2) is `loadRegistry()`'s raw rows that FAILED
 * validation, from the SAME snapshot `entries` was drawn from. Passed through
 * to `resolveManagedHost` so a valid row + an unreadable TWIN of the same
 * identity poisons that ONE identity's host resolution (never emitted as an
 * attach/relaunch target) instead of silently trusting the valid row alone.
 * Defaults to `[]` so every existing plain-array test caller is unaffected.
 */
/**
 * Lot L5 (D12b) — where the default plan accounts the rows it excludes by
 * provenance. `secondary` rows restore only with the opt-in; `unclassified`
 * rows (no facet, no delegation) are listed separately and never
 * auto-restored.
 */
export type RestoreExclusions = {
  secondary: string[];
  unclassified: string[];
};

export type RegistrySessionsOpts = {
  /** Collect the excluded rows by name (dry-run/opt-in reporting). */
  collectExcluded?: RestoreExclusions;
  /** Admit `secondary` rows (explicit opt-in). Unclassified stay excluded. */
  includeSecondary?: boolean;
  /**
   * Lot LG (D13) — extra admission roots for registry rows outside the
   * default `~/src` scan root (a group `cwdPrefixes` matcher admits them).
   * The project derives against the matched root.
   */
  admissionRoots?: string[];
};

export function registrySessions(
  home: string = homedir(),
  // No default read: restore() owns the ONE registry read and refuses on an
  // unknown read state before any plan is built (F2/F3).
  entries: RegistryEntry[],
  resolution?: ConvIdResolution,
  evidence: LegacySessionEvidence = legacySessionEvidence(home),
  liveView?: ManagedLiveLookup,
  unreadable: readonly RawRow[] = [],
  opts: RegistrySessionsOpts = {},
): DiscoveredSession[] {
  const src = join(home, "src");
  const out: DiscoveredSession[] = [];
  // ONE probe surface for every host decision of this plan, adapted from the
  // single batch snapshot (or fail-closed "unknown" probes without one).
  const probes = managedHostProbes(liveView);
  // The registry READ RESULT `resolveManagedHost` consults below (A1/A2):
  // the SAME `entries` this loop already iterates, plus the unreadable rows
  // from that identical read, so a per-identity poison check sees them.
  const registryReadForResolve = { state: "ok" as const, entries, unreadable };
  for (const e of entries) {
    if (e.kind === "remote") continue; // remote groups are filled from SCW
    // Only human dev sessions are restorable — never delegated jobs or explicit
    // background launches (they had no human in front of them).
    if (!isHumanFacingSession(e, evidence)) continue;
    // Lot L5 (D12) — provenance gate: the default plan admits only
    // positively-classified primaries. Secondary rows are accounted and
    // restore only with the opt-in; unclassified rows are listed separately
    // and never auto-restored (transcript/legacy evidence never proves a
    // primary). A persisted facet wins; otherwise the one-time pure
    // classification decides (restore() persists it).
    const facet = e.restoreFacet ?? classifyRestoreFacet(e);
    if (facet !== "primary") {
      const name = e.label ?? e.id;
      if (facet === "secondary") {
        if (opts.includeSecondary === true) {
          // Explicit opt-in: fall through, admitted below.
        } else {
          opts.collectExcluded?.secondary.push(name);
          continue;
        }
      } else {
        opts.collectExcluded?.unclassified.push(name);
        continue;
      }
    }
    // Lot LG (D13) — admission roots: a configured `cwdPrefixes` group
    // matcher admits registry rows outside the default `~/src` scan root.
    // The project derives against the matched root, so `<root>/<proj>`
    // restores as project `<proj>`.
    let projectBase: string | undefined;
    if (e.cwd.startsWith(`${src}/`)) {
      projectBase = src;
    } else {
      const root = (opts.admissionRoots ?? []).find((candidate) => {
        const base =
          candidate.length > 1 ? candidate.replace(/\/+$/, "") : candidate;
        return e.cwd === base || e.cwd.startsWith(`${base}/`);
      });
      if (root !== undefined)
        projectBase = root.length > 1 ? root.replace(/\/+$/, "") : root;
    }
    if (projectBase === undefined) continue;
    // §4.1 unresolved-convId gate: skip ONLY when the row is dead/absent (or
    // its host state is unprovable — an unknown probe is no death
    // certificate, but with no identity there is nothing safe to launch
    // either; restore() emits the attach-hint note). A LIVE managed row is
    // NEVER lost to a broken conversation id: the process exists and is
    // re-enterable by its persisted kind + exact managed name alone.
    let attachLiveName: string | undefined;
    if (
      resolution &&
      isManagedLocalKind(e.kind) &&
      e.source === "run" &&
      resolution.unresolvedRunIds.has(e.id)
    ) {
      const candidates = e.tmuxSession
        ? [e.tmuxSession]
        : managedSessionCandidates(e.id);
      const live = liveView?.(e.kind, candidates);
      if (live === undefined || live.state !== "live") continue;
      attachLiveName = live.name;
    }
    // A hook conversation already owned by a run session (same real convId, but
    // the run entry carries the label + tmux name) must not ALSO appear as an
    // anonymous project tab — that is the duplicate the reconciliation removes.
    if (
      resolution &&
      e.kind === "local" &&
      e.source === "hook" &&
      e.convId !== undefined &&
      resolution.claimedConvIds.has(e.convId)
    ) {
      continue;
    }
    const project = projectForCwd(projectBase, e.cwd);
    if (!project) continue;
    const seen = Date.parse(e.lastSeenAt);
    // An attach-live row has NO resolved conversation: its sid stays empty so
    // no path can ever render a broken `--resume <label>` from it.
    const sid =
      attachLiveName !== undefined
        ? ""
        : (resolution?.resolvedSid.get(e.id) ?? e.convId ?? "");
    const session: DiscoveredSession = {
      project,
      mtimeMs: Number.isFinite(seen) ? seen : Date.now(),
      tool: e.tool,
      sid,
      cwd: e.cwd,
      origin: "registry",
      registryId: e.id,
      restoreClass: "human",
    };
    if (e.label !== undefined) session.label = e.label;
    if (e.gatewayMode !== undefined) session.gatewayMode = e.gatewayMode;
    if (e.bare !== undefined) session.bare = e.bare;
    // WHICH host serves this tab is decided by the ONE symmetric resolver
    // (resolveManagedHost) over this plan's registry read, with the plan's
    // single probe snapshot injected — restore never re-implements the
    // host-choice rules (F1/F2) and never re-probes a host per session. For
    // a current managed row the resolver lands on its persisted kind + exact
    // managed name (probes only ever run for an identity with no matching
    // row). A `kind:"local"` hook entry has no terminal host.
    if (isManagedLocalKind(e.kind)) {
      const resolution = resolveManagedHost(
        e.tmuxSession ?? localSessionName(e.id),
        // The WHOLE read (A2), not the bare `entries` array: an unreadable
        // twin of this identity must poison the resolution — no tab emitted,
        // no relaunch/attach target derived from the valid row alone.
        registryReadForResolve,
        probes,
      );
      if (resolution.state === "unknown") {
        // Fail closed (resolver rule 4): an unattributable host is no
        // license to guess one via the slug-union fallback — emit no tab.
        continue;
      }
      if (
        resolution.state === "recorded" ||
        resolution.state === "discovered"
      ) {
        session.hostKind = resolution.kind;
        session.managedName = attachLiveName ?? resolution.name;
      } else if (resolution.state === "ambiguous") {
        // Rule 3 verdict, stamped for the plan filter
        // (dropDualHostIdentities); kind + name are kept for the skip
        // report only — no act may serve this tab on either host.
        session.hostAmbiguous = true;
        session.hostKind = e.kind;
        session.managedName =
          attachLiveName ?? e.tmuxSession ?? localSessionName(e.id);
      }
      // "missing": an identity the resolver pins to NO host is emitted
      // unhosted — a relaunch follows the product default host, exactly as
      // the act path treats a missing identity (a brand-new session).
    }
    if (attachLiveName !== undefined) session.attachLive = true;
    out.push(session);
  }
  return out;
}

/**
 * Merge discovery sources by resume UUID, never by project or agent ref. One
 * registry row must not make distinct conversations under that project vanish,
 * while two refs for the same UUID must never emit two resume commands.
 */
export function mergeDiscovered(
  registry: DiscoveredSession[],
  scanned: DiscoveredSession[],
): DiscoveredSession[] {
  const merged = [
    ...registry,
    ...scanned
      .map((s) => ({ ...s, origin: "scan" as const })),
  ];
  const deduped: DiscoveredSession[] = [];
  const indexByResumeId = new Map<string, number>();
  const seenAttachIdentity = new Set<string>();
  for (const session of merged) {
    // An empty sid is an attach-only live row, not a resume request.
    if (session.sid.length === 0) {
      // Lot L1b — resume-UUID dedup never sees attach-only rows, so two
      // enrolled rows for ONE live terminal (run-enrolled + hook-enrolled
      // twins) would emit two attach tabs. Dedup by TERMINAL identity
      // instead: the managed session name, falling back to project+cwd.
      const identity =
        session.managedName ?? JSON.stringify([session.project, session.cwd]);
      if (seenAttachIdentity.has(identity)) continue;
      seenAttachIdentity.add(identity);
      deduped.push(session);
      continue;
    }
    const priorIndex = indexByResumeId.get(session.sid);
    if (priorIndex === undefined) {
      indexByResumeId.set(session.sid, deduped.length);
      deduped.push(session);
      continue;
    }
    const prior = deduped[priorIndex]!;
    // Registry ownership beats a scan guess. Between duplicate rows from the
    // same source, retain the most recently observed owner of the UUID.
    if (
      (prior.origin !== "registry" && session.origin === "registry") ||
      (prior.origin === session.origin && session.mtimeMs > prior.mtimeMs)
    ) deduped[priorIndex] = session;
  }
  return deduped;
}

/** Raw scanner candidates are unclassified by construction and cannot restore. */
export function isRestorableDiscoveredSession(
  session: Pick<DiscoveredSession, "restoreClass">,
): boolean {
  return session.restoreClass === "human";
}

/**
 * Identity slug used to dedup a LOCAL discovered session against a REMOTE tab
 * (bug #3). Both sides are reduced to lowercase alnum runs so "Sentropic
 * Remote"/"sentropic-remote"/"sentropic_remote" collapse to one key. A `#N`
 * fan-out suffix is kept distinct (it is a different session).
 */
export function sessionIdentitySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Bug #3 — a session that was MOVED to a remote Pod keeps reappearing as a fresh
 * LOCAL tmux because the local conversation files (claude .jsonl / codex
 * rollout) and any stale local registry entry survive the move, so the local
 * discovery still emits a tab for that project. Drop every local discovered
 * session whose project/label identity is already covered by a REMOTE tab: the
 * remote group owns it, and re-launching it locally would spawn a ghost
 * duplicate. Match is by identity slug of the local `label` (else `project`)
 * against the remote tab `label` — the remote tab's cwd is the Pod path (often
 * absent locally) so cwd can't be the key; the friendly name is. Pure; the
 * remote-backed locals are returned separately so the caller can report them.
 */
export function dropRemoteBackedLocals(
  locals: DiscoveredSession[],
  remoteTabs: ReadonlyArray<{ label: string }>,
): { kept: DiscoveredSession[]; dropped: DiscoveredSession[] } {
  if (remoteTabs.length === 0) return { kept: locals, dropped: [] };
  const remoteKeys = new Set(
    remoteTabs.map((t) => sessionIdentitySlug(t.label)),
  );
  const kept: DiscoveredSession[] = [];
  const dropped: DiscoveredSession[] = [];
  for (const s of locals) {
    const key = sessionIdentitySlug(s.label ?? s.project);
    if (remoteKeys.has(key)) dropped.push(s);
    else kept.push(s);
  }
  return { kept, dropped };
}

/**
 * Dual-host identity fails CLOSED (resolver rule 3): sessions of BOTH managed
 * kinds for one exact managed name cannot be attributed to a host — neither
 * an attach nor a replacement may pick one by luck. The verdict is NOT
 * decided here: it was stamped per session at plan time from
 * `resolveManagedHost` returning `ambiguous` (`hostAmbiguous`); this filter
 * only acts on that stamp and never counts kinds itself, so the dual-host
 * rule lives in exactly ONE place. Pure; the caller reports the ambiguous
 * names.
 */
export function dropDualHostIdentities(sessions: DiscoveredSession[]): {
  kept: DiscoveredSession[];
  ambiguousNames: string[];
} {
  const ambiguous = new Set<string>();
  for (const s of sessions) {
    if (s.hostAmbiguous === true && s.managedName !== undefined) {
      ambiguous.add(s.managedName);
    }
  }
  return {
    kept: sessions.filter((s) => s.hostAmbiguous !== true),
    ambiguousNames: [...ambiguous].sort(),
  };
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

/**
 * Group discovered sessions into terminal windows per the layout config:
 *   - explicit groups first (their projects leave the shared pool),
 *   - the rest round-robin into `sharedWindows` windows,
 *   - capped at `maxPerWindow` tabs each,
 *   - keeping the N most recent sessions per project (`multiSession`, def 1).
 */
/**
 * Lot LG (D13) — per-group explicit-window cap overflow, accounted per group
 * (never silently dropped): dropped tabs stay with their group, named.
 */
export type GroupCapDrop = {
  group: string;
  cap: number;
  dropped: number;
  names: string[];
};

export type GroupedSessions = {
  windows: LayoutWindow[];
  dropped: number;
  /** Explicit non-remote groups that received no tab (when groups exist). */
  emptyGroups: string[];
  /** Sessions admitted but matching no explicit group (shared pool). */
  unmatched: string[];
  /** Per-explicit-group cap overflow, in config order. */
  groupCapDrops: GroupCapDrop[];
};

/** Normalize one matcher prefix (no globs anywhere in LG matching). */
function normalizeCwdPrefix(prefix: string): string {
  return prefix.length > 1 ? prefix.replace(/\/+$/, "") : prefix;
}

/** Exact / path-prefix match for one cwd against one configured prefix. */
function cwdMatchesPrefix(cwd: string, prefix: string): boolean {
  const norm = normalizeCwdPrefix(prefix);
  return cwd === norm || cwd.startsWith(`${norm}/`);
}

/**
 * Lot LG (D13) — one explicit local group's hit predicate. `excludeProjects`
 * vetoes first; then any matcher hits: project equality (checked first),
 * cwd-prefix locality (nested worktrees included), tool equality, tag
 * any-of. A group with no matchers matches nothing locally (reported empty).
 */
export function groupMatchesSession(
  s: Pick<DiscoveredSession, "project" | "cwd" | "tool"> &
    Partial<Pick<DiscoveredSession, "tags">>,
  g: LayoutGroup,
): boolean {
  if (g.excludeProjects !== undefined && g.excludeProjects.includes(s.project)) {
    return false;
  }
  if ((g.projects ?? []).includes(s.project)) return true;
  for (const prefix of g.cwdPrefixes ?? []) {
    if (cwdMatchesPrefix(s.cwd, prefix)) return true;
  }
  if ((g.tools ?? []).includes(s.tool)) return true;
  const tags = g.tags ?? [];
  if (tags.length > 0 && (s.tags ?? []).some((t) => tags.includes(t))) return true;
  return false;
}

export function groupSessions(
  sessions: DiscoveredSession[],
  cfg: LayoutConfig,
): GroupedSessions {
  // newest-first per project, capped per project
  const byProject = new Map<string, DiscoveredSession[]>();
  for (const s of sessions) {
    const arr = byProject.get(s.project) ?? [];
    arr.push(s);
    byProject.set(s.project, arr);
  }
  const tabFor = (s: DiscoveredSession, i: number): LayoutTab => {
    const tab: LayoutTab = {
      cwd: s.cwd,
      label: s.label ?? (i === 0 ? s.project : `${s.project}#${i + 1}`),
      tool: s.tool,
      sid: s.sid,
    };
    if (s.origin !== undefined) tab.origin = s.origin;
    if (s.gatewayMode !== undefined) tab.gatewayMode = s.gatewayMode;
    if (s.bare !== undefined) tab.bare = s.bare;
    if (s.hostKind !== undefined) tab.hostKind = s.hostKind;
    if (s.managedName !== undefined) tab.managedName = s.managedName;
    if (s.attachLive !== undefined) tab.attachLive = s.attachLive;
    return tab;
  };
  const slotsFor = (
    project: string,
  ): Array<{ session: DiscoveredSession; tab: LayoutTab }> => {
    // Per-project cap: explicit override, else the global default. <= 0 = no
    // limit (every live session of the project gets a tab) — `remote restore`
    // then sweeps the WHOLE fleet, duplicates included.
    //
    // The cap ONLY tames the mtime-guessing SCAN fallback, where several rollout
    // files can point at ONE conversation, so keeping only the newest guess is
    // right. REGISTRY-backed sessions are each a DISTINCT, verified-live session
    // keyed by its own identity (tmux slug / convId), so every one is preserved:
    // a repo like `sentropic` legitimately runs several concurrent human sessions
    // and restore must bring back each, not collapse them to one tab.
    const cap = cfg.multiSession[project] ?? cfg.multiSessionDefault;
    const limit = cap <= 0 ? Number.POSITIVE_INFINITY : cap;
    const all = (byProject.get(project) ?? [])
      .slice()
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    const registryBacked = all.filter((s) => s.origin === "registry");
    const scanned = all.filter((s) => s.origin !== "registry").slice(0, limit);
    const arr = [...registryBacked, ...scanned].sort(
      (a, b) => b.mtimeMs - a.mtimeMs,
    );
    return arr.map((s, i) => ({ session: s, tab: tabFor(s, i) }));
  };

  // Lot LG (D13) — first match wins, exactly one window per session. Sessions
  // taken by an explicit group (placed or cap-dropped) never reach another
  // window or the shared pool — a project listed in two groups is placed
  // once, in the first matching group.
  const taken = new Set<DiscoveredSession>();
  const windows: LayoutWindow[] = [];
  const groupCapDrops: GroupCapDrop[] = [];
  const hasExplicitGroups = cfg.groups.some((g) => !g.remote);

  for (const g of cfg.groups) {
    if (g.remote) continue; // remote groups are filled from SCW by the caller
    // A non-positive global cap means "no limit" (same rule as slotsFor) —
    // only an explicit per-group maxTabs ever caps an explicit window.
    const cap =
      g.maxTabs ??
      (cfg.maxPerWindow <= 0 ? Number.POSITIVE_INFINITY : cfg.maxPerWindow);
    const tabs: LayoutTab[] = [];
    const droppedNames: string[] = [];
    const take = (s: DiscoveredSession, tab: LayoutTab): void => {
      if (taken.has(s)) return;
      taken.add(s);
      if (tabs.length < cap) tabs.push(tab);
      else droppedNames.push(tab.label);
    };
    // Named projects first, in config order (byte-identical to the
    // projects-only layout for matcher-less configs)...
    for (const project of g.projects ?? []) {
      for (const { session: s, tab } of slotsFor(project)) take(s, tab);
      // ...sessions of a named project that the per-project cap cut are still
      // the group's (legacy silent rule), never shared-pool candidates.
      for (const s of byProject.get(project) ?? []) taken.add(s);
    }
    // ...then the other matchers (cwd prefix, tool, tags) in session order.
    for (const s of sessions) {
      if (taken.has(s)) continue;
      if ((g.projects ?? []).includes(s.project)) continue;
      if (!groupMatchesSession(s, g)) continue;
      take(s, tabFor(s, 0));
    }
    if (tabs.length > 0) windows.push({ title: g.title, tabs });
    if (droppedNames.length > 0) {
      groupCapDrops.push({
        group: g.title,
        cap,
        dropped: droppedNames.length,
        names: droppedNames,
      });
    }
  }

  // remaining projects, most-recent project first, round-robin into shared wins
  const remaining = [...byProject.entries()]
    .filter(([, arr]) => arr.some((s) => !taken.has(s)))
    .sort((a, b) => projLatest(b[1]) - projLatest(a[1]))
    .map(([p]) => p);
  const sharedSlots: Array<{ session: DiscoveredSession; tab: LayoutTab }> = [];
  for (const project of remaining) {
    for (const entry of slotsFor(project)) {
      if (!taken.has(entry.session)) sharedSlots.push(entry);
    }
  }

  const shared: LayoutWindow[] = Array.from(
    { length: Math.max(1, cfg.sharedWindows) },
    () => ({ title: "", tabs: [] }),
  );
  const maxShared = cfg.sharedWindows * cfg.maxPerWindow;
  let placed = 0;
  for (const entry of sharedSlots) {
    if (placed >= maxShared) break;
    taken.add(entry.session);
    shared[placed % cfg.sharedWindows]!.tabs.push(entry.tab);
    placed++;
  }
  const dropped = sharedSlots.length - placed;
  shared.forEach((win, i) => {
    if (win.tabs.length > 0)
      windows.push({
        title: `${humanOutputText("restore.sharedWindow")} ${i + 1}`,
        tabs: win.tabs,
      });
  });

  const emptyGroups = hasExplicitGroups
    ? cfg.groups
        .filter((g) => !g.remote)
        .map((g) => g.title)
        .filter((title) => !windows.some((w) => w.title === title))
    : [];
  const unmatched = hasExplicitGroups
    ? sharedSlots.map((entry) => entry.tab.label)
    : [];
  return { windows, dropped, emptyGroups, unmatched, groupCapDrops };
}

function projLatest(arr: DiscoveredSession[]): number {
  return arr.reduce((m, s) => Math.max(m, s.mtimeMs), 0);
}


/**
 * Lot L1a — one run-scoped restore ledger entry. Machine values only; the
 * human lines render at print time through the locale catalog, so the record
 * is never an impl-chosen default location away from the caller's path.
 */
export type RestoreLedgerEntry = {
  session: string;
  outcome: "launched" | "blocked" | "skipped" | "failed" | "already-active" | "deferred";
  window?: string;
  reason?: string;
  remedy?: string;
  at: string;
};

/**
 * Lot L6 (D14) — observed outcome counts recomputed from the D2 ledger.
 * The totals line reports these, never the planned tab count.
 */
export type RestoreLedgerSummary = {
  launched: number;
  blocked: number;
  skipped: number;
  failed: number;
  /** Lot L1b — observed in-place outcomes (attach/defer, never inject). */
  "already-active": number;
  deferred: number;
};

/** Count the observed outcomes in one ledger (machine values in/out). */
export function summarizeRestoreLedger(
  entries: ReadonlyArray<RestoreLedgerEntry>,
): RestoreLedgerSummary {
  const summary: RestoreLedgerSummary = {
    launched: 0,
    blocked: 0,
    skipped: 0,
    failed: 0,
    "already-active": 0,
    deferred: 0,
  };
  for (const entry of entries) summary[entry.outcome] += 1;
  return summary;
}

/** Observed launch counts carried back by `restore()` (additive). */
export type RestoreObserved = {
  planned: number;
  opened: number;
  skippedLive: number;
  blocked: number;
};

/** Everything the human plan report renders (machine values + counts). */
export type RestorePlanView = {
  windows: LayoutWindow[];
  total: number;
  dropped: number;
  excludedSecondary: string[];
  excludedUnclassified: string[];
  facetUpdates: Array<[string, string]>;
  dryRun: boolean;
  observed: RestoreObserved;
  /**
   * Lot LG (D13) — explicit-group plan account: per-group cap overflow
   * (in config order), groups that received no tab, sessions matching no
   * group. Empty/absent = nothing to report (goldens stay byte-identical).
   */
  groupCapDrops?: GroupCapDrop[];
  emptyGroups?: string[];
  unmatched?: string[];
};

/**
 * Lot L6 (D14) — render the whole human plan through the locale catalog.
 * Static words come from the catalog; titles, labels, cwds, counts and
 * commands pass through untranslated. One run = one language.
 */
export function renderRestorePlan(
  view: RestorePlanView,
  locale?: string,
): string[] {
  const lines: string[] = [];
  for (const w of view.windows) {
    lines.push(`  ${w.title} (${w.tabs.length}):`);
    for (const t of w.tabs) {
      const what = t.remoteId
        ? `SCW:${t.remoteId}`
        : `${t.tool} (local) [${t.origin === "registry" ? "registry" : "guess"}]`;
      lines.push(`    - ${t.label}  ${what}  ${t.cwd}`);
    }
  }
  if (view.dropped > 0)
    lines.push(
      `  (! ${view.dropped} ${humanOutputText("restore.capDropped", locale)})`,
    );
  if (view.excludedSecondary.length > 0)
    lines.push(
      `  (! ${view.excludedSecondary.length} ${humanOutputText("restore.excludedSecondary", locale)} — ${humanOutputText("restore.optinHint", locale)} ${view.excludedSecondary.join(", ")})`,
    );
  if (view.excludedUnclassified.length > 0)
    lines.push(
      `  (! ${view.excludedUnclassified.length} ${humanOutputText("restore.excludedUnclassified", locale)} ${view.excludedUnclassified.join(", ")})`,
    );
  if (view.dryRun && view.facetUpdates.length > 0)
    lines.push(
      `  (! ${humanOutputText("restore.wouldClassifyPrefix", locale)} ${view.facetUpdates.length} ${humanOutputText("restore.wouldClassifyBody", locale)} ${view.facetUpdates.map(([id, facet]) => `${id}=${facet}`).join(", ")})`,
    );
  // Lot LG (D13) — the explicit-group plan account, through the catalog.
  for (const d of view.groupCapDrops ?? []) {
    lines.push(
      `  (! ${d.group}: ${d.dropped} ${humanOutputText("restore.groupCapDropped", locale)} ${d.cap}: ${d.names.join(", ")})`,
    );
  }
  if ((view.emptyGroups ?? []).length > 0)
    lines.push(
      `  (! ${humanOutputText("restore.emptyGroups", locale)}: ${view.emptyGroups!.join(", ")})`,
    );
  if ((view.unmatched ?? []).length > 0)
    lines.push(
      `  (! ${humanOutputText("restore.unmatchedSessions", locale)}: ${view.unmatched!.join(", ")})`,
    );
  lines.push(renderRestoreTotals(view.observed, view.dryRun, locale));
  return lines;
}

/** The observed totals line (D2 ledger + launch counts, never the plan). */
export function renderRestoreTotals(
  observed: RestoreObserved,
  dryRun: boolean,
  locale?: string,
): string {
  const line =
    `${humanOutputText("restore.summaryTitle", locale)} ` +
    `${observed.opened} ${humanOutputText("restore.count.opened", locale)}, ` +
    `${observed.blocked} ${humanOutputText("restore.count.blocked", locale)}, ` +
    `${observed.skippedLive} ${humanOutputText("restore.count.skipped", locale)} ` +
    `(${observed.planned} ${humanOutputText("restore.count.planned", locale)})`;
  return dryRun ? `${line} (dry-run)` : line;
}

/**
 * Lot L6 (D14) — machine form of the D2 ledger for `restore --json`.
 * Field names are machine values, never localised.
 */
export function buildRestoreJsonReport(input: {
  windows: LayoutWindow[];
  total: number;
  observed: RestoreObserved;
  ledger: RestoreLedgerEntry[];
  dryRun: boolean;
  group?: string;
}): {
  ok: boolean;
  dryRun: boolean;
  group?: string;
  windows: LayoutWindow[];
  total: number;
  observed: RestoreObserved;
  ledger: RestoreLedgerEntry[];
} {
  return {
    ok: true,
    dryRun: input.dryRun,
    ...(input.group !== undefined ? { group: input.group } : {}),
    windows: input.windows,
    total: input.total,
    observed: input.observed,
    ledger: input.ledger,
  };
}

export type RestoreOptions = {
  dryRun?: boolean;
  /** Launch only the group whose title matches (exact or slug-normalized). */
  group?: string;
  /**
   * Lot L5 (D12) — admit `secondary` (delegated) rows. Unclassified rows
   * stay excluded: promotion is explicit, never an opt-in side effect.
   */
  includeSecondary?: boolean;
  /**
   * Lot L1a: receives every blocked/skipped ledger entry (occupied-human
   * refusals). The caller owns persistence — restore() never picks a record
   * path itself.
   */
  onLedgerEntry?: (entry: RestoreLedgerEntry) => void;
  /**
   * Lot L1b — host-observed subtrees of live managed terminals, already
   * fetched by the caller (omit = no host observation; attach-live rows keep
   * the L1a attach-only path with no ledger entry). Powers the OBSERVED
   * already-active/deferred ledger outcomes only — restore() never types
   * into these sessions (the D6(iii) adapter does not exist in this RC).
   */
  nativeSubtrees?: ReadonlyArray<{
    name: string;
    processes: ReadonlyArray<HostProcessSnapshot>;
  }>;
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

function titleMatches(title: string, query: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return norm(title) === norm(query);
}

/** Full restore: discover (local) + inject SCW (remote) -> order -> filter -> launch. */
export function restore(
  opts: RestoreOptions = {},
): {
  windows: LayoutWindow[];
  total: number;
  dropped: number;
  /** Lot L6 (D14): observed launch counts (planned/opened/skipped/blocked). */
  observed: RestoreObserved;
} {
  const cfg = getLayoutConfig();
  const stderr = opts.stderr ?? process.stderr;

  // Remote tabs resolved by the caller from `remote ls` (fill `remote: true`
  // groups). Computed up-front so they can ALSO dedup the local discovery.
  // Lot L5 (D12c): secondary remote tabs are excluded from the default plan.
  const remoteTabs = selectRemoteTabsForGroups(opts.remoteTabs ?? [], {
    ...(opts.includeSecondary === true ? { includeSecondary: true } : {}),
  });

  // Local windows (groups + shared) — durable registry rows are the truth.
  // Liveness cannot be a pre-classification filter: a dead tmux session is the
  // very thing restore exists to relaunch.
  //
  // Reconcile run↔hook entries first: a `run` session enrolled with its LABEL as
  // convId is joined to the `hook` conversation carrying the real uuid, so it
  // resumes correctly (and each named session of a repo keeps its own uuid).
  const home = homedir();
  const registryRead = loadRegistry();
  if (registryRead.state === "unknown") {
    // Restore LAUNCHES sessions: with an unreadable registry the plan cannot
    // dedup or host-attribute anything — a launch here could fabricate a
    // second writer over a live-but-unprovable session. Fail closed: no
    // windows, nothing launched (F2/F3).
    stderr.write(
      `[h2a] restore refused: the local registry is unreadable (${registryRead.reason}); nothing was launched (fail closed).\n`,
    );
    return {
      windows: [],
      total: 0,
      dropped: 0,
      observed: { planned: 0, opened: 0, skippedLive: 0, blocked: 0 },
    };
  }
  const registryEntries = registryRead.entries;
  const evidence = legacySessionEvidence(home);
  const resolution = reconcileRunConvIds(
    registryEntries,
    (cwd, convId) => readConversationCustomTitle(home, cwd, convId),
    evidence,
  );
  // Persist the resolved conversation ids back onto the run entries so the state
  // is EMITTED, not re-derived (a transcript scan) on every restore. Skipped on
  // --dry-run so a preview stays side-effect-free.
  if (!opts.dryRun) {
    try {
      const updates = new Map<string, string>();
      for (const [id, sid] of resolution.resolvedSid) {
        const e = registryEntries.find((x) => x.id === id);
        if (e && isManagedLocalKind(e.kind) && e.source === "run" && e.convId !== sid) {
          updates.set(id, sid);
        }
      }
      persistReconciledConvIds(updates);
    } catch {
      // best-effort: a persistence hiccup must never break restore
    }
  }
  // Lot LG (D13) — admission roots for discovery: a LOCAL group's
  // `cwdPrefixes` matcher admits rows outside the default `~/src` scan root
  // (remote groups are SCW-filled and contribute nothing here). The scan
  // covers the group roots too, exempt from the age cutoff (a group
  // explicitly asks for that fleet); the registry read below admits the
  // same roots.
  const admissionRoots = cfg.groups.flatMap((g) =>
    g.remote === true ? [] : (g.cwdPrefixes ?? []),
  );
  const scanned = discoverSessions(
    cfg.maxAgeHours * 3600 * 1000,
    home,
    admissionRoots,
  );
  // ONE host-inventory snapshot for the whole restore (§4.1 / F3): the
  // attach-live gate, the skip notes below AND the layout render consume
  // this same capture — launchLayout has no reader of its own to diverge on.
  const hostView = captureHostViewSnapshot();
  const liveView = managedLiveLookupFromSnapshot(hostView);
  // Lot L5 (D12b) — one-time legacy classification by evidence, persisted
  // once (same pattern as reconciled convIds). Only rows WITHOUT a facet
  // are stamped; an explicit facet is never overwritten. Skipped on
  // --dry-run (a preview stays side-effect-free) but REPORTED below.
  const facetUpdates = new Map<string, RestoreFacet>();
  for (const e of registryEntries) {
    if (e.restoreFacet !== undefined) continue;
    const facet = classifyRestoreFacet(e);
    if (facet !== undefined) facetUpdates.set(e.id, facet);
  }
  if (!opts.dryRun && facetUpdates.size > 0) {
    try {
      persistRestoreFacets(facetUpdates);
    } catch {
      // best-effort: a persistence hiccup must never break restore
    }
  }
  const excluded: RestoreExclusions = { secondary: [], unclassified: [] };
  const allDiscovered = mergeDiscovered(
    registrySessions(
      home,
      registryEntries,
      resolution,
      evidence,
      liveView,
      // PART A/A2: the unreadable rows from this SAME read, so a valid row +
      // an unreadable twin poisons that one identity's host resolution.
      registryRead.unreadable,
      {
        collectExcluded: excluded,
        ...(opts.includeSecondary === true ? { includeSecondary: true } : {}),
        ...(admissionRoots.length > 0 ? { admissionRoots } : {}),
      },
    ),
    scanned,
  );
  // Never emit a broken `--resume <label>`. A LIVE unresolved row was kept by
  // the §4.1 gate as an attach-live tab; only the dead/unprovable remainder
  // is skipped, with an explicit attach hint instead of a silent drop.
  const attachLiveIds = new Set(
    allDiscovered.flatMap((s) =>
      s.attachLive === true && s.registryId !== undefined ? [s.registryId] : [],
    ),
  );
  for (const id of resolution.unresolvedRunIds) {
    if (attachLiveIds.has(id)) continue;
    const e = registryEntries.find((x) => x.id === id);
    if (!e) continue;
    const label = e.label ?? e.id;
    stderr.write(
      `[h2a] restore skipped "${label}": ${humanOutputText("restore.unresolvedConvId")} ` +
        `(convId ${e.convId ? `"${e.convId}"` : "missing"} ${humanOutputText("restore.notARealConversation")}); ` +
        `${humanOutputText("restore.ledger.remedyAttach")} h2a attach ${slugify(label)}\n`,
    );
  }
  // Transcript scans lack a durable human/job marker. They are deliberately
  // represented as `unclassified` and filtered here, before grouping/capping.
  const preDualLocal = allDiscovered.filter(isRestorableDiscoveredSession);
  const { kept: allLocal, ambiguousNames } =
    dropDualHostIdentities(preDualLocal);
  for (const name of ambiguousNames) {
    stderr.write(
      `[h2a] restore skipped "${name}": ${humanOutputText("restore.dualHost")}\n`,
    );
  }
  // Bug #3: a session moved to a remote Pod must NOT also be re-launched as a
  // ghost LOCAL tmux. Drop locals already covered by a remote tab.
  const { kept: sessions, dropped: remoteBacked } = dropRemoteBackedLocals(
    allLocal,
    remoteTabs,
  );
  if (remoteBacked.length > 0) {
    stderr.write(
      `[h2a] ${remoteBacked.length} ${humanOutputText("restore.remoteBacked")}: ${[
        ...new Set(remoteBacked.map((s) => s.label ?? s.project)),
      ].join(", ")}\n`,
    );
  }
  // Lot L1a foreground-facet contract — hard occupied-human refusal. A
  // restorable row that is a live-agent-cli AND provably live on its
  // persisted host (this plan's snapshot) is never relaunched over the live
  // human CLI: it gets a blocked ledger entry with a per-session `h2a
  // attach` remedy and leaves the launch set. Attach-live rows keep their
  // attach-only path (exempt here); dead/unknown rows are untouched.
  const facetRows: SessionFacetRow[] = [];
  for (const s of sessions) {
    if (s.attachLive === true) continue;
    if (s.hostKind === undefined || s.managedName === undefined) continue;
    if (liveView(s.hostKind, [s.managedName]).state !== "live") continue;
    const row: SessionFacetRow = {
      session: s.label ?? s.project,
      tool: s.tool,
      kind: s.hostKind,
    };
    if (s.hostKind === "local-tmux") row.tmuxLive = true;
    else row.pidAlive = true;
    if (s.label !== undefined) row.label = s.label;
    facetRows.push(row);
  }
  const occupiedRefusals = resolveOccupiedHumanRefusals(
    facetRows,
    isLiveFacetRow,
  );
  const refusedSessions = new Set(
    occupiedRefusals.map((r) => r.session),
  );
  for (const r of occupiedRefusals) {
    const entry: RestoreLedgerEntry = {
      session: r.session,
      outcome: "blocked",
      reason: "occupied-human",
      remedy: r.remedy,
      at: new Date().toISOString(),
    };
    opts.onLedgerEntry?.(entry);
    stderr.write(
      `[h2a] restore refused "${r.session}": ` +
        `${humanOutputText("restore.ledger.occupiedHuman")} — ` +
        `${humanOutputText("restore.ledger.remedyAttach")} ${r.remedy}\n`,
    );
  }
  // Lot L1b — OBSERVED in-place outcomes for attach-live primaries. When the
  // caller hands restore() the host-observed subtree of a live terminal, the
  // row is observed, not just attached: a verified foreground CLI records one
  // `already-active` ledger outcome (the session is already up); a foreground
  // shell records `deferred` (`needs-adapter` — the D6(iii) managed-shell
  // adapter does not exist in this RC, so nothing is typed, nothing killed).
  // Anything else (unknown foreground, ambiguous owners, or no subtree at
  // all) keeps today's attach-only path with no ledger entry — old hosts stay
  // L1a-compatible. Attach-live rows carry no resolved conversation (empty
  // sid), so the subtree alone attributes the foreground.
  if (opts.nativeSubtrees !== undefined && opts.nativeSubtrees.length > 0) {
    const subtreeByName = new Map(
      opts.nativeSubtrees.map((s) => [s.name, s.processes] as const),
    );
    for (const s of sessions) {
      if (s.attachLive !== true || s.managedName === undefined) continue;
      const processes = subtreeByName.get(s.managedName);
      if (processes === undefined) continue;
      const at = new Date().toISOString();
      const decision = decideInPlaceResume({
        session: s.label ?? s.project,
        hostProcesses: processes,
      });
      if (decision?.outcome === "attach") {
        opts.onLedgerEntry?.({
          session: s.label ?? s.project,
          outcome: "already-active",
          at,
        });
      } else if (decision?.outcome === "deferred") {
        opts.onLedgerEntry?.({
          session: s.label ?? s.project,
          outcome: "deferred",
          reason: "needs-adapter",
          at,
        });
      }
    }
  }
  const launchable =
    refusedSessions.size === 0
      ? sessions
      : sessions.filter((s) => !refusedSessions.has(s.label ?? s.project));
  const {
    windows: localWindows,
    dropped,
    emptyGroups,
    unmatched: unmatchedLocal,
    groupCapDrops,
  } = groupSessions(launchable, cfg);
  const localByTitle = new Map(localWindows.map((w) => [w.title, w]));

  // Remote windows: each `remote: true` group is filled with its OWN slice
  // of the SCW tabs (first match wins, never the same tab twice). A remote
  // group with no matchers is the explicit catch-all; tabs claimed by no
  // remote group join the unmatched plan names instead of vanishing.
  const remoteAssigned = assignRemoteTabsToGroups(remoteTabs, cfg.groups);
  const claimedRemote = new Set<RemoteTab>();
  for (const claimed of remoteAssigned.values()) {
    for (const t of claimed) claimedRemote.add(t);
  }
  const unmatchedRemote = remoteTabs
    .filter((t) => !claimedRemote.has(t))
    .map((t) => t.label);
  const remoteByTitle = new Map<string, LayoutWindow>();
  for (const g of cfg.groups) {
    if (!g.remote) continue;
    const cap =
      g.maxTabs ??
      (cfg.maxPerWindow <= 0 ? Number.POSITIVE_INFINITY : cfg.maxPerWindow);
    const claimed = remoteAssigned.get(g.title) ?? [];
    const kept = claimed.slice(0, cap);
    const tabs: LayoutTab[] = kept.map((t) => ({
      label: t.label,
      cwd: t.cwd,
      remoteId: t.id,
    }));
    if (tabs.length > 0) remoteByTitle.set(g.title, { title: g.title, tabs });
    if (claimed.length > kept.length) {
      groupCapDrops.push({
        group: g.title,
        cap,
        dropped: claimed.length - kept.length,
        names: claimed.slice(kept.length).map((t) => t.label),
      });
    }
  }

  // Order: follow cfg.groups (local or remote), then any shared windows.
  let windows: LayoutWindow[] = [];
  for (const g of cfg.groups) {
    const w = g.remote ? remoteByTitle.get(g.title) : localByTitle.get(g.title);
    if (w) windows.push(w);
  }
  for (const w of localWindows) {
    if (!cfg.groups.some((g) => g.title === w.title)) windows.push(w);
  }

  // Scope to a single group/batch if requested.
  if (opts.group) windows = windows.filter((w) => titleMatches(w.title, opts.group!));

  const total = windows.reduce((n, w) => n + w.tabs.length, 0);
  // Lot L6 (D14) — observed launch counts, captured from the launcher instead
  // of re-planned: the totals line reports these, never the planned tabs.
  let opened = 0;
  let skippedLiveLaunch = 0;
  if (!opts.dryRun && total > 0) {
    const launched = launchLayout(windows, hostView, stderr, {
      ...(opts.reattach ? { reattach: true } : {}),
      ...(opts.forceGateway ? { forceGateway: opts.forceGateway } : {}),
    });
    opened = launched.opened;
    skippedLiveLaunch = launched.skippedLive.length;
    // Auto-record the launched layout (inspect with `remote layout show`).
    try {
      writeLastLayout(windows, opts.group);
    } catch {
      // best-effort: the windows are open regardless
    }
  }
  const observed: RestoreObserved = {
    planned: total,
    opened,
    skippedLive: skippedLiveLaunch,
    blocked: occupiedRefusals.length,
  };
  // Lot L6 (D14) — the whole human plan renders through the locale catalog
  // (one run = one language), including the L5 exclusion account.
  // Lot LG (D13) — plus the explicit-group plan account below it.
  for (const line of renderRestorePlan(
    {
      windows,
      total,
      // A group-scoped plan hides the unscoped cap note, as before.
      dropped: opts.group ? 0 : dropped,
      excludedSecondary: excluded.secondary,
      excludedUnclassified: excluded.unclassified,
      facetUpdates: [...facetUpdates],
      dryRun: opts.dryRun ?? false,
      observed,
      // A group-scoped plan shows only its own cap account, as before.
      groupCapDrops: opts.group
        ? groupCapDrops.filter((d) => titleMatches(d.group, opts.group!))
        : groupCapDrops,
      emptyGroups: opts.group ? [] : emptyGroups,
      unmatched: opts.group ? [] : [...unmatchedLocal, ...unmatchedRemote],
    },
  )) {
    stderr.write(`${line}\n`);
  }
  return { windows, total, dropped, observed };
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
  // Lot L0: mutation-point guard — named error, zero bytes outside the
  // marked test root. Inert outside a marked test run.
  guardTestStateWrite(path);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
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
