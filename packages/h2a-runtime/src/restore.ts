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
  launchLayout,
  tabCommand,
  type HostViewSnapshot,
} from "./launch-layout.js";

import {
  getLayoutConfig,
  resolveConfigPath,
  type LayoutConfig,
} from "./config.js";
import { encodeCwd } from "./convsync.js";
import {
  isManagedLocalKind,
  loadRegistry,
  looksLikeConversationUuid,
  persistReconciledConvIds,
  resolveManagedHost,
  type ManagedHostProbeResult,
  type RawRow,
  type RegistryEntry,
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

// Compatibility re-exports: the layout renderer lives in launch-layout.ts —
// a module WITHOUT reader access (F3) — but callers keep importing it here.
export {
  ambiguousLiveSessionNames,
  launchLayout,
  tabCommand,
  type HostViewSnapshot,
} from "./launch-layout.js";

export type DiscoveredSession = {
  project: string;
  mtimeMs: number;
  tool: "claude" | "codex" | "agy";
  sid: string;
  cwd: string;
  /** "registry" = enrolled live session (reliable); "scan" = mtime guess. */
  origin?: "registry" | "scan";
  /** Preferred tab label (registry entries carry a reliable one). */
  label?: string;
  /** Pinned llm-mesh gateway posture (from an explicit --gw/--no-gw at launch). */
  gatewayMode?: "gateway" | "direct";
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
  /** Persisted local host; drives the drain view + native replacement pin. */
  hostKind?: "local-tmux" | "local-native";
  /** Exact managed session name (registry-backed tabs). */
  managedName?: string;
  /** Attach-only tab for a live managed row without a resolved conversation. */
  attachLive?: boolean;
};

export type LayoutWindow = { title: string; tabs: LayoutTab[] };

/** A pre-resolved SCW tab for a remote group (built by the caller from `remote ls`). */
export type RemoteTab = { id: string; label: string; cwd: string };

/** Project identity is the whole workspace path below ~/src, never its root. */
function projectForCwd(src: string, cwd: string): string | undefined {
  const prefix = `${src}/`;
  if (!cwd.startsWith(prefix)) return undefined;
  const project = cwd.slice(prefix.length);
  return project || undefined;
}

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
      return {
        known: true as const,
        sessions: listNativeSessions()
          .filter((session) => session.status === "running")
          .map((session) => ({
            name: session.id,
            controlled: session.controlled,
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
      const hit = names.find((name) =>
        running.some((session) => session.name === name),
      );
      return hit !== undefined ? { state: "live", name: hit } : { state: "dead" };
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
export function registrySessions(
  home: string = homedir(),
  // No default read: restore() owns the ONE registry read and refuses on an
  // unknown read state before any plan is built (F2/F3).
  entries: RegistryEntry[],
  resolution?: ConvIdResolution,
  evidence: LegacySessionEvidence = legacySessionEvidence(home),
  liveView?: ManagedLiveLookup,
  unreadable: readonly RawRow[] = [],
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
    if (!e.cwd.startsWith(`${src}/`)) continue;
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
    const project = projectForCwd(src, e.cwd);
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
 * Merge discovery sources by session identity, never by project. One live
 * registry row must not make every other conversation under that project vanish.
 */
export function mergeDiscovered(
  registry: DiscoveredSession[],
  scanned: DiscoveredSession[],
): DiscoveredSession[] {
  const known = new Set(registry.map((s) => `${s.tool}\u0000${s.sid}\u0000${s.cwd}`));
  return [
    ...registry,
    ...scanned
      .filter((s) => !known.has(`${s.tool}\u0000${s.sid}\u0000${s.cwd}`))
      .map((s) => ({ ...s, origin: "scan" as const })),
  ];
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
export function groupSessions(
  sessions: DiscoveredSession[],
  cfg: LayoutConfig,
): { windows: LayoutWindow[]; dropped: number } {
  // newest-first per project, capped per project
  const byProject = new Map<string, DiscoveredSession[]>();
  for (const s of sessions) {
    const arr = byProject.get(s.project) ?? [];
    arr.push(s);
    byProject.set(s.project, arr);
  }
  const slotsFor = (project: string): LayoutTab[] => {
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
    return arr.map((s, i) => {
      const tab: LayoutTab = {
        cwd: s.cwd,
        label: s.label ?? (i === 0 ? s.project : `${s.project}#${i + 1}`),
        tool: s.tool,
        sid: s.sid,
      };
      if (s.origin !== undefined) tab.origin = s.origin;
      if (s.gatewayMode !== undefined) tab.gatewayMode = s.gatewayMode;
      if (s.hostKind !== undefined) tab.hostKind = s.hostKind;
      if (s.managedName !== undefined) tab.managedName = s.managedName;
      if (s.attachLive !== undefined) tab.attachLive = s.attachLive;
      return tab;
    });
  };

  const grouped = new Set<string>();
  const windows: LayoutWindow[] = [];

  for (const g of cfg.groups) {
    if (g.remote) continue; // remote groups are filled from SCW by the caller
    const tabs: LayoutTab[] = [];
    for (const project of g.projects ?? []) {
      grouped.add(project);
      for (const slot of slotsFor(project)) {
        if (tabs.length >= cfg.maxPerWindow) break;
        tabs.push(slot);
      }
    }
    if (tabs.length > 0) windows.push({ title: g.title, tabs });
  }

  // remaining projects, most-recent project first, round-robin into shared wins
  const remaining = [...byProject.entries()]
    .filter(([p]) => !grouped.has(p))
    .sort((a, b) => projLatest(b[1]) - projLatest(a[1]))
    .map(([p]) => p);
  const sharedSlots: LayoutTab[] = [];
  for (const project of remaining) sharedSlots.push(...slotsFor(project));

  const shared: LayoutTab[][] = Array.from(
    { length: Math.max(1, cfg.sharedWindows) },
    () => [],
  );
  const maxShared = cfg.sharedWindows * cfg.maxPerWindow;
  let placed = 0;
  for (const slot of sharedSlots) {
    if (placed >= maxShared) break;
    shared[placed % cfg.sharedWindows]!.push(slot);
    placed++;
  }
  const dropped = sharedSlots.length - placed;
  shared.forEach((tabs, i) => {
    if (tabs.length > 0)
      windows.push({ title: `fenêtre partagée ${i + 1}`, tabs });
  });

  return { windows, dropped };
}

function projLatest(arr: DiscoveredSession[]): number {
  return arr.reduce((m, s) => Math.max(m, s.mtimeMs), 0);
}


export type RestoreOptions = {
  dryRun?: boolean;
  /** Launch only the group whose title matches (exact or slug-normalized). */
  group?: string;
  /** Pre-resolved SCW tabs (from `remote ls`), used to fill `remote: true` groups. */
  remoteTabs?: RemoteTab[];
  /**
   * When true, open a new terminal tab even for sessions already live in tmux.
   * Default (false): sessions already in tmux are skipped — no redundant tab.
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
): { windows: LayoutWindow[]; total: number; dropped: number } {
  const cfg = getLayoutConfig();
  const stderr = opts.stderr ?? process.stderr;

  // Remote tabs resolved by the caller from `remote ls` (fill `remote: true`
  // groups). Computed up-front so they can ALSO dedup the local discovery.
  const remoteTabs = opts.remoteTabs ?? [];

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
    return { windows: [], total: 0, dropped: 0 };
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
  const scanned = discoverSessions(cfg.maxAgeHours * 3600 * 1000);
  // ONE host-inventory snapshot for the whole restore (§4.1 / F3): the
  // attach-live gate, the skip notes below AND the layout render consume
  // this same capture — launchLayout has no reader of its own to diverge on.
  const hostView = captureHostViewSnapshot();
  const liveView = managedLiveLookupFromSnapshot(hostView);
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
      `[h2a] restore skipped "${label}": no resolved conversation id ` +
        `(convId ${e.convId ? `"${e.convId}"` : "missing"} is not a real conversation); ` +
        `attach it live with h2a attach ${slugify(label)}\n`,
    );
  }
  // Transcript scans lack a durable human/job marker. They are deliberately
  // represented as `unclassified` and filtered here, before grouping/capping.
  const preDualLocal = allDiscovered.filter(isRestorableDiscoveredSession);
  const { kept: allLocal, ambiguousNames } =
    dropDualHostIdentities(preDualLocal);
  for (const name of ambiguousNames) {
    stderr.write(
      `[h2a] restore skipped "${name}": recorded on BOTH local hosts (local-tmux AND local-native); ` +
        "clean up the conflicting registry rows before restoring it\n",
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
      `[h2a] ${remoteBacked.length} session(s) déjà sur le contrôle distant — pas de relance locale: ${[
        ...new Set(remoteBacked.map((s) => s.label ?? s.project)),
      ].join(", ")}\n`,
    );
  }
  const { windows: localWindows, dropped } = groupSessions(sessions, cfg);
  const localByTitle = new Map(localWindows.map((w) => [w.title, w]));

  // Remote windows: each `remote: true` group is filled with the SCW tabs.
  const remoteByTitle = new Map<string, LayoutWindow>();
  for (const g of cfg.groups) {
    if (!g.remote) continue;
    const tabs: LayoutTab[] = remoteTabs
      .slice(0, cfg.maxPerWindow)
      .map((t) => ({ label: t.label, cwd: t.cwd, remoteId: t.id }));
    if (tabs.length > 0) remoteByTitle.set(g.title, { title: g.title, tabs });
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
  if (!opts.dryRun && total > 0) {
    launchLayout(windows, hostView, stderr, {
      ...(opts.reattach ? { reattach: true } : {}),
      ...(opts.forceGateway ? { forceGateway: opts.forceGateway } : {}),
    });
    // Auto-record the launched layout (inspect with `remote layout show`).
    try {
      writeLastLayout(windows, opts.group);
    } catch {
      // best-effort: the windows are open regardless
    }
  }
  return { windows, total, dropped };
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
