/**
 * Pure restore plan transformation and per-tab layout decisioning (S0).
 *
 * This module has ZERO host readers, ZERO filesystem I/O, ZERO terminal
 * launchers, and ZERO writers: callers supply a `RestorePlanSnapshot` /
 * `HostViewSnapshot` captured once up-front, and receive deterministic
 * windows, per-session classifications, and per-tab launch decisions.
 */

import type { LayoutConfig } from "./config.js";
import {
  isManagedLocalKind,
  looksLikeConversationUuid,
  resolveManagedHost,
  type ManagedHostProbeResult,
  type RawRow,
  type RegistryEntry,
} from "./registry.js";
import type { SessionClass } from "./session-class.js";
import {
  localSessionName,
  managedSessionCandidates,
  slugify,
  type LocalSession,
} from "./tmux.js";

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
  /** Provenance of the gateway pin ("explicit" only; legacy rows omit it). */
  gatewayProvenance?: "explicit";
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
  /** Provenance of the gateway pin; only "explicit" pins are re-emitted. */
  gatewayProvenance?: "explicit";
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
export type RemoteTab = { id: string; label: string; cwd: string };

/** Out-of-registry facts allowed to classify a legacy session as human. */
export type LegacySessionEvidence = {
  readonly home: string;
  readonly liveTmuxSessions: ReadonlyArray<
    Pick<LocalSession, "name" | "path" | "profile">
  >;
  /** A caller that obtained an explicit human confirmation may name its entry. */
  readonly humanConfirmedIds?: ReadonlySet<string>;
};

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

export type RestoreClassificationOutcome =
  | "selected"
  | "explicit-overflow"
  | "shared-overflow"
  | "refused";

export type RestoreRefusalReason =
  | "registry-unreadable"
  | "delegated"
  | "non-human"
  | "outside-src"
  | "unresolved-conversation"
  | "claimed-by-run-entry"
  | "host-unknown"
  | "duplicate-conversation"
  | "unclassified-scan"
  | "dual-host-ambiguous"
  | "remote-backed"
  | "per-project-scan-cap"
  | "group-filter";

export type RestoreSessionClassification =
  | {
      readonly outcome: "selected";
      readonly key: string;
      readonly label: string;
      readonly project?: string | undefined;
      readonly windowTitle: string;
      readonly tab: LayoutTab;
      readonly session?: DiscoveredSession | undefined;
    }
  | {
      readonly outcome: "explicit-overflow";
      readonly key: string;
      readonly label: string;
      readonly project?: string | undefined;
      readonly groupTitle: string;
      readonly reason: "explicit-group-cap";
      readonly tab: LayoutTab;
      readonly session?: DiscoveredSession | undefined;
    }
  | {
      readonly outcome: "shared-overflow";
      readonly key: string;
      readonly label: string;
      readonly project: string;
      readonly reason: "shared-pool-cap";
      readonly tab: LayoutTab;
      readonly session: DiscoveredSession;
    }
  | {
      readonly outcome: "refused";
      readonly key: string;
      readonly label: string;
      readonly project?: string | undefined;
      readonly reason: RestoreRefusalReason;
      readonly detail?: string | undefined;
      readonly session?: DiscoveredSession | undefined;
    };

export type RestorePlanSnapshot = {
  readonly home: string;
  readonly config: LayoutConfig;
  readonly registryRead:
    | {
        readonly state: "ok";
        readonly entries: readonly RegistryEntry[];
        readonly unreadable?: readonly RawRow[] | undefined;
      }
    | { readonly state: "unknown"; readonly reason: string };
  readonly scanned: readonly DiscoveredSession[];
  readonly hostView: HostViewSnapshot;
  readonly evidence: LegacySessionEvidence;
  readonly customTitleFor?:
    | ((cwd: string, convId: string) => string | undefined)
    | undefined;
  readonly remoteTabs?: readonly RemoteTab[] | undefined;
};

export type RestorePlanOptions = {
  readonly group?: string | undefined;
};

export type RestorePlanResult = {
  readonly ok: boolean;
  readonly refusalReason?: "registry-unreadable" | undefined;
  readonly refusalDetail?: string | undefined;
  readonly windows: LayoutWindow[];
  readonly total: number;
  readonly dropped: number;
  readonly classifications: RestoreSessionClassification[];
  readonly reconciledConvIdUpdates: ReadonlyMap<string, string>;
  readonly unresolvedSkipEntries: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly convId: string | undefined;
  }>;
  readonly ambiguousDualHostNames: readonly string[];
  readonly remoteBackedLabels: readonly string[];
  readonly remoteBackedCount: number;
};

export type TabLaunchDecision =
  | {
      readonly kind: "attach";
      readonly tab: LayoutTab;
      readonly command: string;
      readonly attachSession?: string | undefined;
      readonly remote?: boolean | undefined;
      readonly notice?: undefined;
    }
  | {
      readonly kind: "launch";
      readonly tab: LayoutTab;
      readonly command: string;
      readonly notice?: undefined;
    }
  | {
      readonly kind: "skip-live";
      readonly tab: LayoutTab;
      readonly reason: "already-controlled" | "already-attached";
      readonly notice?: string | undefined;
    }
  | {
      readonly kind: "refuse";
      readonly tab: LayoutTab;
      readonly reason:
        | "ambiguous-owner"
        | "native-host-unknown"
        | "controller-visibility-unknown"
        | "attach-live-gone"
        | "ambiguous-slug";
      readonly skippedLive?: boolean | undefined;
      readonly notice: string;
    };

export type LayoutLaunchPlanWindow = {
  readonly title: string;
  readonly decisions: TabLaunchDecision[];
  readonly activeTabs: Array<{ tab: LayoutTab; command: string }>;
};

export type LayoutLaunchPlan = {
  readonly warnings: string[];
  readonly windows: LayoutLaunchPlanWindow[];
  readonly skippedLive: string[];
};

export type LayoutLaunchOptions = {
  readonly reattach?: boolean | undefined;
  readonly forceGateway?: ("gateway" | "direct") | undefined;
};

/** Project identity is the whole workspace path below ~/src, never its root. */
export function projectForCwd(src: string, cwd: string): string | undefined {
  const prefix = `${src}/`;
  if (!cwd.startsWith(prefix)) return undefined;
  const project = cwd.slice(prefix.length);
  return project || undefined;
}

export function titleMatches(title: string, query: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return norm(title) === norm(query);
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
  return "background";
}

export function reconcileRunConvIdsPure(
  entries: readonly RegistryEntry[],
  customTitleFor: (cwd: string, convId: string) => string | undefined,
  evidence: LegacySessionEvidence,
): ConvIdResolution {
  type HookConv = {
    convId: string;
    title: string | undefined;
    lastSeenAt: string;
  };
  const hooksByCwd = new Map<string, HookConv[]>();
  for (const e of entries) {
    if (e.kind !== "local" || e.source !== "hook" || e.tool !== "claude")
      continue;
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
    if (deriveLegacySessionClass(r, evidence) !== "human") continue;
    const hooks = hooksByCwd.get(r.cwd) ?? [];

    if (looksLikeConversationUuid(r.convId)) {
      resolvedSid.set(r.id, r.convId!);
      claimedConvIds.add(r.convId!);
      continue;
    }
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
    if (!r.convId || r.convId === r.label || r.convId === r.id) {
      unresolvedRunIds.add(r.id);
      continue;
    }
    if (r.tool === "claude" && hooks.length > 0) {
      unresolvedRunIds.add(r.id);
      continue;
    }
    resolvedSid.set(r.id, r.convId);
    claimedConvIds.add(r.convId);
  }

  return { resolvedSid, unresolvedRunIds, claimedConvIds };
}

/**
 * Adapt the ONE `HostViewSnapshot` to the plan's ManagedLiveLookup probe
 * surface: every plan decision of one restore reads the same batch snapshot.
 */
export function managedLiveLookupFromSnapshot(
  view: HostViewSnapshot,
): ManagedLiveLookup {
  return (kind, names) => {
    if (kind === "local-native") {
      if (!view.native.known) return { state: "unknown" };
      const running = view.native.sessions;
      if (
        names.some(
          (name) =>
            running.filter((session) => session.name === name).length > 1,
        )
      ) {
        return { state: "unknown" };
      }
      const hit = names.find((name) =>
        running.some((session) => session.name === name),
      );
      return hit !== undefined
        ? { state: "live", name: hit }
        : view.native.complete === false
          ? { state: "unknown" }
          : { state: "dead" };
    }
    if (!view.tmux.known) return { state: "unknown" };
    const sessions = view.tmux.sessions;
    const hit = names.find((name) =>
      sessions.some((session) => session.name === name),
    );
    return hit !== undefined ? { state: "live", name: hit } : { state: "dead" };
  };
}

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

function discoveredKey(s: DiscoveredSession): string {
  if (s.registryId !== undefined) return `registry:${s.registryId}`;
  return `scan:${s.project}:${s.sid || s.label || String(s.mtimeMs)}`;
}

export function registrySessionsPure(
  home: string,
  entries: readonly RegistryEntry[],
  resolution: ConvIdResolution | undefined,
  evidence: LegacySessionEvidence,
  liveView?: ManagedLiveLookup,
  unreadable: readonly RawRow[] = [],
): {
  sessions: DiscoveredSession[];
  refusals: RestoreSessionClassification[];
} {
  const src = `${home.replace(/\/+$/, "")}/src`;
  const out: DiscoveredSession[] = [];
  const refusals: RestoreSessionClassification[] = [];
  const probes = managedHostProbes(liveView);
  const registryReadForResolve = { state: "ok" as const, entries: [...entries], unreadable };

  for (const e of entries) {
    const key = `registry:${e.id}`;
    const label = e.label ?? e.id;
    const projectMaybe = projectForCwd(src, e.cwd);

    if (e.kind === "remote") {
      refusals.push({
        outcome: "refused",
        key,
        label,
        ...(projectMaybe !== undefined ? { project: projectMaybe } : {}),
        reason: "remote-backed",
      });
      continue;
    }
    if (
      e.delegationOrigin !== undefined ||
      e.delegatorInstance !== undefined ||
      e.delegatorTmuxSession !== undefined ||
      e.parent !== undefined
    ) {
      refusals.push({
        outcome: "refused",
        key,
        label,
        ...(projectMaybe !== undefined ? { project: projectMaybe } : {}),
        reason: "delegated",
      });
      continue;
    }
    if (deriveLegacySessionClass(e, evidence) !== "human") {
      refusals.push({
        outcome: "refused",
        key,
        label,
        ...(projectMaybe !== undefined ? { project: projectMaybe } : {}),
        reason: "non-human",
      });
      continue;
    }
    if (!e.cwd.startsWith(`${src}/`) || !projectMaybe) {
      refusals.push({
        outcome: "refused",
        key,
        label,
        reason: "outside-src",
      });
      continue;
    }

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
      if (live === undefined || live.state !== "live") {
        refusals.push({
          outcome: "refused",
          key,
          label,
          project: projectMaybe,
          reason: "unresolved-conversation",
        });
        continue;
      }
      attachLiveName = live.name;
    }

    if (
      resolution &&
      e.kind === "local" &&
      e.source === "hook" &&
      e.convId !== undefined &&
      resolution.claimedConvIds.has(e.convId)
    ) {
      refusals.push({
        outcome: "refused",
        key,
        label,
        project: projectMaybe,
        reason: "claimed-by-run-entry",
      });
      continue;
    }

    const seen = Date.parse(e.lastSeenAt);
    const sid =
      attachLiveName !== undefined
        ? ""
        : (resolution?.resolvedSid.get(e.id) ?? e.convId ?? "");
    const session: DiscoveredSession = {
      project: projectMaybe,
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
    if (e.gatewayProvenance !== undefined)
      session.gatewayProvenance = e.gatewayProvenance;
    if (e.bare !== undefined) session.bare = e.bare;

    if (isManagedLocalKind(e.kind)) {
      const hostRes = resolveManagedHost(
        e.tmuxSession ?? localSessionName(e.id),
        registryReadForResolve,
        probes,
      );
      if (hostRes.state === "unknown") {
        refusals.push({
          outcome: "refused",
          key,
          label,
          project: projectMaybe,
          reason: "host-unknown",
          session,
        });
        continue;
      }
      if (hostRes.state === "recorded" || hostRes.state === "discovered") {
        session.hostKind = hostRes.kind;
        session.managedName = attachLiveName ?? hostRes.name;
      } else if (hostRes.state === "ambiguous") {
        session.hostAmbiguous = true;
        session.hostKind = e.kind;
        session.managedName =
          attachLiveName ?? e.tmuxSession ?? localSessionName(e.id);
      }
    }
    if (attachLiveName !== undefined) session.attachLive = true;
    out.push(session);
  }

  return { sessions: out, refusals };
}

export function mergeDiscoveredDetailed(
  registry: readonly DiscoveredSession[],
  scanned: readonly DiscoveredSession[],
): {
  merged: DiscoveredSession[];
  duplicates: DiscoveredSession[];
} {
  const combined = [
    ...registry,
    ...scanned.map((s) => ({ ...s, origin: "scan" as const })),
  ];
  const deduped: DiscoveredSession[] = [];
  const duplicates: DiscoveredSession[] = [];
  const indexByResumeId = new Map<string, number>();

  for (const session of combined) {
    if (session.sid.length === 0) {
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
    if (
      (prior.origin !== "registry" && session.origin === "registry") ||
      (prior.origin === session.origin && session.mtimeMs > prior.mtimeMs)
    ) {
      duplicates.push(prior);
      deduped[priorIndex] = session;
    } else {
      duplicates.push(session);
    }
  }
  return { merged: deduped, duplicates };
}

export function mergeDiscovered(
  registry: DiscoveredSession[],
  scanned: DiscoveredSession[],
): DiscoveredSession[] {
  return mergeDiscoveredDetailed(registry, scanned).merged;
}

/** Raw scanner candidates are unclassified by construction and cannot restore. */
export function isRestorableDiscoveredSession(
  session: Pick<DiscoveredSession, "restoreClass">,
): boolean {
  return session.restoreClass === "human";
}

export function sessionIdentitySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

function projLatest(arr: DiscoveredSession[]): number {
  return arr.reduce((m, s) => Math.max(m, s.mtimeMs), 0);
}

/**
 * Group discovered sessions into terminal windows per the layout config,
 * returning both the exact legacy `{ windows, dropped }` shape AND a full
 * per-session classification (`selected`, `explicit-overflow`,
 * `shared-overflow`, `refused`).
 */
export function groupSessionsWithClassification(
  sessions: readonly DiscoveredSession[],
  cfg: LayoutConfig,
): {
  windows: LayoutWindow[];
  dropped: number;
  classifications: RestoreSessionClassification[];
} {
  const byProject = new Map<string, DiscoveredSession[]>();
  for (const s of sessions) {
    const arr = byProject.get(s.project) ?? [];
    arr.push(s);
    byProject.set(s.project, arr);
  }

  const classifications: RestoreSessionClassification[] = [];

  type SlotEntry = { session: DiscoveredSession; tab: LayoutTab };
  const slotsFor = (project: string): SlotEntry[] => {
    const cap = cfg.multiSession[project] ?? cfg.multiSessionDefault;
    const limit = cap <= 0 ? Number.POSITIVE_INFINITY : cap;
    const all = (byProject.get(project) ?? [])
      .slice()
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    const registryBacked = all.filter((s) => s.origin === "registry");
    const scannedAll = all.filter((s) => s.origin !== "registry");
    const scanned = scannedAll.slice(0, limit);
    for (const droppedScan of scannedAll.slice(limit)) {
      classifications.push({
        outcome: "refused",
        key: discoveredKey(droppedScan),
        label: droppedScan.label ?? droppedScan.project,
        project: droppedScan.project,
        reason: "per-project-scan-cap",
        session: droppedScan,
      });
    }
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
      if (s.gatewayProvenance !== undefined)
        tab.gatewayProvenance = s.gatewayProvenance;
      if (s.bare !== undefined) tab.bare = s.bare;
      if (s.hostKind !== undefined) tab.hostKind = s.hostKind;
      if (s.managedName !== undefined) tab.managedName = s.managedName;
      if (s.attachLive !== undefined) tab.attachLive = s.attachLive;
      return { session: s, tab };
    });
  };

  const grouped = new Set<string>();
  const windows: LayoutWindow[] = [];

  for (const g of cfg.groups) {
    if (g.remote) continue;
    const tabs: LayoutTab[] = [];
    for (const project of g.projects ?? []) {
      grouped.add(project);
      for (const { session, tab } of slotsFor(project)) {
        if (tabs.length >= cfg.maxPerWindow) {
          classifications.push({
            outcome: "explicit-overflow",
            key: discoveredKey(session),
            label: tab.label,
            project: session.project,
            groupTitle: g.title,
            reason: "explicit-group-cap",
            tab,
            session,
          });
          continue;
        }
        tabs.push(tab);
        classifications.push({
          outcome: "selected",
          key: discoveredKey(session),
          label: tab.label,
          project: session.project,
          windowTitle: g.title,
          tab,
          session,
        });
      }
    }
    if (tabs.length > 0) windows.push({ title: g.title, tabs });
  }

  const remaining = [...byProject.entries()]
    .filter(([p]) => !grouped.has(p))
    .sort((a, b) => projLatest(b[1]) - projLatest(a[1]))
    .map(([p]) => p);
  const sharedSlots: SlotEntry[] = [];
  for (const project of remaining) sharedSlots.push(...slotsFor(project));

  const shared: LayoutTab[][] = Array.from(
    { length: Math.max(1, cfg.sharedWindows) },
    () => [],
  );
  const maxShared = cfg.sharedWindows * cfg.maxPerWindow;
  let placed = 0;
  for (const { session, tab } of sharedSlots) {
    if (placed >= maxShared) {
      classifications.push({
        outcome: "shared-overflow",
        key: discoveredKey(session),
        label: tab.label,
        project: session.project,
        reason: "shared-pool-cap",
        tab,
        session,
      });
      continue;
    }
    const winIdx = placed % cfg.sharedWindows;
    shared[winIdx]!.push(tab);
    classifications.push({
      outcome: "selected",
      key: discoveredKey(session),
      label: tab.label,
      project: session.project,
      windowTitle: `fenêtre partagée ${winIdx + 1}`,
      tab,
      session,
    });
    placed++;
  }
  const dropped = sharedSlots.length - placed;
  shared.forEach((tabs, i) => {
    if (tabs.length > 0)
      windows.push({ title: `fenêtre partagée ${i + 1}`, tabs });
  });

  return { windows, dropped, classifications };
}

export function groupSessions(
  sessions: DiscoveredSession[],
  cfg: LayoutConfig,
): { windows: LayoutWindow[]; dropped: number } {
  const { windows, dropped } = groupSessionsWithClassification(sessions, cfg);
  return { windows, dropped };
}

/**
 * Pure restore plan computed entirely from caller-supplied snapshots.
 * Performs ZERO reads, ZERO writes, and ZERO launches.
 */
export function buildRestorePlan(
  snapshot: RestorePlanSnapshot,
  opts: RestorePlanOptions = {},
): RestorePlanResult {
  if (snapshot.registryRead.state === "unknown") {
    return {
      ok: false,
      refusalReason: "registry-unreadable",
      refusalDetail: snapshot.registryRead.reason,
      windows: [],
      total: 0,
      dropped: 0,
      classifications: [],
      reconciledConvIdUpdates: new Map(),
      unresolvedSkipEntries: [],
      ambiguousDualHostNames: [],
      remoteBackedLabels: [],
      remoteBackedCount: 0,
    };
  }

  const cfg = snapshot.config;
  const remoteTabs = snapshot.remoteTabs ?? [];
  const registryEntries = snapshot.registryRead.entries;
  const unreadable = snapshot.registryRead.unreadable ?? [];
  const customTitleFor = snapshot.customTitleFor ?? (() => undefined);

  const resolution = reconcileRunConvIdsPure(
    registryEntries,
    customTitleFor,
    snapshot.evidence,
  );

  const reconciledConvIdUpdates = new Map<string, string>();
  for (const [id, sid] of resolution.resolvedSid) {
    const e = registryEntries.find((x) => x.id === id);
    if (
      e &&
      isManagedLocalKind(e.kind) &&
      e.source === "run" &&
      e.convId !== sid
    ) {
      reconciledConvIdUpdates.set(id, sid);
    }
  }

  const liveView = managedLiveLookupFromSnapshot(snapshot.hostView);
  const { sessions: fromRegistry, refusals: registryRefusals } =
    registrySessionsPure(
      snapshot.home,
      registryEntries,
      resolution,
      snapshot.evidence,
      liveView,
      unreadable,
    );

  const { merged: allDiscovered, duplicates } = mergeDiscoveredDetailed(
    fromRegistry,
    snapshot.scanned,
  );

  const classifications: RestoreSessionClassification[] = [...registryRefusals];
  for (const dup of duplicates) {
    classifications.push({
      outcome: "refused",
      key: discoveredKey(dup),
      label: dup.label ?? dup.project,
      project: dup.project,
      reason: "duplicate-conversation",
      session: dup,
    });
  }

  const attachLiveIds = new Set(
    allDiscovered.flatMap((s) =>
      s.attachLive === true && s.registryId !== undefined
        ? [s.registryId]
        : [],
    ),
  );
  const unresolvedSkipEntries: Array<{
    id: string;
    label: string;
    convId: string | undefined;
  }> = [];
  for (const id of resolution.unresolvedRunIds) {
    if (attachLiveIds.has(id)) continue;
    const e = registryEntries.find((x) => x.id === id);
    if (!e) continue;
    unresolvedSkipEntries.push({
      id: e.id,
      label: e.label ?? e.id,
      convId: e.convId,
    });
  }

  const preDualLocal: DiscoveredSession[] = [];
  for (const s of allDiscovered) {
    if (isRestorableDiscoveredSession(s)) {
      preDualLocal.push(s);
    } else {
      classifications.push({
        outcome: "refused",
        key: discoveredKey(s),
        label: s.label ?? s.project,
        project: s.project,
        reason: "unclassified-scan",
        session: s,
      });
    }
  }

  const { kept: allLocal, ambiguousNames } =
    dropDualHostIdentities(preDualLocal);
  for (const s of preDualLocal) {
    if (s.hostAmbiguous === true) {
      classifications.push({
        outcome: "refused",
        key: discoveredKey(s),
        label: s.label ?? s.project,
        project: s.project,
        reason: "dual-host-ambiguous",
        session: s,
      });
    }
  }

  const { kept: sessions, dropped: remoteBacked } = dropRemoteBackedLocals(
    allLocal,
    remoteTabs,
  );
  for (const s of remoteBacked) {
    classifications.push({
      outcome: "refused",
      key: discoveredKey(s),
      label: s.label ?? s.project,
      project: s.project,
      reason: "remote-backed",
      session: s,
    });
  }

  const {
    windows: localWindows,
    dropped,
    classifications: groupClassifications,
  } = groupSessionsWithClassification(sessions, cfg);
  classifications.push(...groupClassifications);
  const localByTitle = new Map(localWindows.map((w) => [w.title, w]));

  const remoteByTitle = new Map<string, LayoutWindow>();
  let remoteClassified = false;
  for (const g of cfg.groups) {
    if (!g.remote) continue;
    const selectedRemote = remoteTabs.slice(0, cfg.maxPerWindow);
    const overflowRemote = remoteTabs.slice(cfg.maxPerWindow);
    const tabs: LayoutTab[] = selectedRemote.map((t) => ({
      label: t.label,
      cwd: t.cwd,
      remoteId: t.id,
    }));
    if (tabs.length > 0) remoteByTitle.set(g.title, { title: g.title, tabs });
    if (!remoteClassified) {
      remoteClassified = true;
      selectedRemote.forEach((t, idx) => {
        classifications.push({
          outcome: "selected",
          key: `remote:${t.id}`,
          label: t.label,
          windowTitle: g.title,
          tab: tabs[idx]!,
        });
      });
      for (const t of overflowRemote) {
        classifications.push({
          outcome: "explicit-overflow",
          key: `remote:${t.id}`,
          label: t.label,
          groupTitle: g.title,
          reason: "explicit-group-cap",
          tab: { label: t.label, cwd: t.cwd, remoteId: t.id },
        });
      }
    }
  }

  let windows: LayoutWindow[] = [];
  for (const g of cfg.groups) {
    const w = g.remote ? remoteByTitle.get(g.title) : localByTitle.get(g.title);
    if (w) windows.push(w);
  }
  for (const w of localWindows) {
    if (!cfg.groups.some((g) => g.title === w.title)) windows.push(w);
  }

  let finalClassifications = classifications;
  if (opts.group) {
    const groupQuery = opts.group;
    windows = windows.filter((w) => titleMatches(w.title, groupQuery));
    finalClassifications = classifications.map((entry) => {
      if (
        entry.outcome === "selected" &&
        !titleMatches(entry.windowTitle, groupQuery)
      ) {
        return {
          outcome: "refused" as const,
          key: entry.key,
          label: entry.label,
          ...(entry.project !== undefined ? { project: entry.project } : {}),
          reason: "group-filter" as const,
          detail: entry.windowTitle,
          ...(entry.session !== undefined ? { session: entry.session } : {}),
        };
      }
      return entry;
    });
  }

  const total = windows.reduce((n, w) => n + w.tabs.length, 0);

  return {
    ok: true,
    windows,
    total,
    dropped,
    classifications: finalClassifications,
    reconciledConvIdUpdates,
    unresolvedSkipEntries,
    ambiguousDualHostNames: ambiguousNames,
    remoteBackedLabels: [
      ...new Set(remoteBacked.map((s) => s.label ?? s.project)),
    ],
    remoteBackedCount: remoteBacked.length,
  };
}

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
    return `h2a attach ${q(tab.remoteId)} --exec`;
  }
  const slug = slugify(tab.label);
  if (tab.attachLive) {
    return `h2a attach ${q(tab.managedName ?? localSessionName(slug))}`;
  }
  const pinned =
    tab.gatewayMode === "direct"
      ? "direct"
      : tab.gatewayProvenance === "explicit"
        ? tab.gatewayMode
        : undefined;
  const posture = opts.forceGateway ?? pinned;
  const gwFlag =
    posture === "gateway" ? " --gw" : posture === "direct" ? " --no-gw" : "";
  const nativePin =
    tab.hostKind === "local-native" ? "H2A_SESSION_HOST=native " : "";
  const tmuxPin = tab.hostKind === "local-tmux" ? " --tmux" : "";
  const bareFlag =
    tab.bare === true ? " --bare" : tab.bare === false ? " --no-bare" : "";
  const runCmd = (extra: string) =>
    `${nativePin}h2a run ${q(tab.tool ?? "shell")} ${q(tab.cwd)} ` +
    (tab.sid ? `--resume ${q(tab.sid)} ` : "") +
    `--name ${q(tab.label)}${gwFlag}${bareFlag}${tmuxPin}${extra}`;
  if (opts.attachSession) {
    return `h2a attach ${q(opts.attachSession)}`;
  }
  if (liveSlugs.has(slug)) {
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
  return new Map([...namesBySlug].filter(([, names]) => names.length > 1));
}

type LayoutDecisionContext = {
  readonly hostView: HostViewSnapshot;
  readonly tmuxKnown: boolean;
  readonly tmuxReason: string | undefined;
  readonly tmuxSessions: ReadonlyArray<LocalSession>;
  readonly nativeSessionsByName:
    | ReadonlyMap<string, { controlled: boolean | undefined }>
    | undefined;
  readonly ambiguousNativeNames: ReadonlySet<string>;
  readonly liveSessions: ReadonlyArray<{
    name: string;
    slug: string;
    attached: boolean;
  }>;
  readonly ambiguousLiveNames: ReadonlyMap<string, string[]>;
  readonly includeAttached: boolean;
  readonly tabOpts: { forceGateway?: "gateway" | "direct" };
};

function createLayoutDecisionContext(
  hostView: HostViewSnapshot,
  opts: LayoutLaunchOptions = {},
): LayoutDecisionContext {
  const tmuxKnown = hostView.tmux.known;
  const tmuxReason = hostView.tmux.known ? undefined : hostView.tmux.reason;
  const tmuxSessions: ReadonlyArray<LocalSession> = hostView.tmux.known
    ? hostView.tmux.sessions
    : [];
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
  const ambiguousNativeNames = new Set(
    hostView.native.known
      ? hostView.native.sessions
          .filter(
            (session, index, sessions) =>
              sessions.findIndex((other) => other.name === session.name) !==
              index,
          )
          .map((session) => session.name)
      : [],
  );
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
    if (name.startsWith("h2a-"))
      ambiguousLiveNames.set(name.slice(4), [name, name]);
  }
  const includeAttached = opts.reattach === true;
  const tabOpts = opts.forceGateway ? { forceGateway: opts.forceGateway } : {};
  return {
    hostView,
    tmuxKnown,
    tmuxReason,
    tmuxSessions,
    nativeSessionsByName,
    ambiguousNativeNames,
    liveSessions,
    ambiguousLiveNames,
    includeAttached,
    tabOpts,
  };
}

function decideTabWithContext(
  t: LayoutTab,
  ctx: LayoutDecisionContext,
): TabLaunchDecision {
  if (t.remoteId) {
    return {
      kind: "attach",
      tab: t,
      command: tabCommand(t),
      remote: true,
    };
  }
  const slug = slugify(t.label);

  if (t.hostKind === "local-native") {
    const exact = t.managedName ?? `h2a-${slug}`;
    if (ctx.ambiguousNativeNames.has(exact)) {
      return {
        kind: "refuse",
        tab: t,
        reason: "ambiguous-owner",
        notice: `[h2a] restore: ambiguous-owner for "${t.label}"; refusing attach or recreation\n`,
      };
    }
    if (
      ctx.nativeSessionsByName === undefined ||
      (ctx.hostView.native.known &&
        ctx.hostView.native.complete === false &&
        !ctx.nativeSessionsByName.has(exact))
    ) {
      return {
        kind: "refuse",
        tab: t,
        reason: "native-host-unknown",
        notice: `[h2a] restore: native host state UNKNOWN — "${t.label}" neither relaunched nor attached (fail closed)\n`,
      };
    }
    const view = ctx.nativeSessionsByName.get(exact);
    if (view !== undefined) {
      if (view.controlled === true) {
        return {
          kind: "skip-live",
          tab: t,
          reason: "already-controlled",
          ...(ctx.includeAttached
            ? {
                notice: `[h2a] restore: "${t.label}" is already controlled in a terminal; not opening a second controller\n`,
              }
            : {}),
        };
      }
      if (view.controlled === undefined) {
        return {
          kind: "refuse",
          tab: t,
          reason: "controller-visibility-unknown",
          notice: `[h2a] restore: controller visibility UNKNOWN for running native session "${t.label}"; attach manually: h2a attach ${exact}\n`,
        };
      }
      return {
        kind: "attach",
        tab: t,
        attachSession: exact,
        command: tabCommand(t, new Set([slug]), { attachSession: exact }),
      };
    }
    if (t.attachLive) {
      return {
        kind: "refuse",
        tab: t,
        reason: "attach-live-gone",
        notice: `[h2a] restore: "${t.label}" was live at plan time but is gone; no resolved conversation exists to relaunch it\n`,
      };
    }
    return {
      kind: "launch",
      tab: t,
      command: tabCommand(t, new Set(), ctx.tabOpts),
    };
  }

  if (t.hostKind === "local-tmux") {
    const exact = t.managedName ?? `h2a-${slug}`;
    if (!ctx.tmuxKnown) {
      return {
        kind: "attach",
        tab: t,
        attachSession: exact,
        command: tabCommand(t, new Set([slug]), { attachSession: exact }),
      };
    }
    const liveTmux = ctx.tmuxSessions.find((session) => session.name === exact);
    if (liveTmux) {
      if (!ctx.includeAttached && liveTmux.attached) {
        return {
          kind: "skip-live",
          tab: t,
          reason: "already-attached",
        };
      }
      return {
        kind: "attach",
        tab: t,
        attachSession: exact,
        command: tabCommand(t, new Set([slug]), { attachSession: exact }),
      };
    }
    if (t.attachLive) {
      return {
        kind: "refuse",
        tab: t,
        reason: "attach-live-gone",
        notice: `[h2a] restore: "${t.label}" was live at plan time but is gone; no resolved conversation exists to relaunch it\n`,
      };
    }
    return {
      kind: "launch",
      tab: t,
      command: tabCommand(t, new Set(), ctx.tabOpts),
    };
  }

  // Legacy tabs without a recorded host: slug-union view (scan).
  if (!ctx.tmuxKnown) {
    const exact = `h2a-${slug}`;
    return {
      kind: "attach",
      tab: t,
      attachSession: exact,
      command: tabCommand(t, new Set([slug]), { attachSession: exact }),
    };
  }
  const names = ctx.ambiguousLiveNames.get(slug);
  if (names) {
    const sorted = [...names].sort();
    return {
      kind: "refuse",
      tab: t,
      reason: "ambiguous-slug",
      skippedLive: true,
      notice:
        `[h2a] restore skipped "${t.label}": local session slug is ambiguous (${sorted.join(", ")}); ` +
        `attach explicitly with h2a attach ${sorted[0]} or h2a attach ${sorted[1]}\n`,
    };
  }
  const liveSession = ctx.liveSessions.find((session) => session.slug === slug);
  if (liveSession && !ctx.includeAttached && liveSession.attached) {
    return {
      kind: "skip-live",
      tab: t,
      reason: "already-attached",
    };
  }
  if (
    !liveSession &&
    (ctx.nativeSessionsByName === undefined ||
      (ctx.hostView.native.known && ctx.hostView.native.complete === false))
  ) {
    return {
      kind: "refuse",
      tab: t,
      reason: "native-host-unknown",
      notice: `[h2a] restore: native host state UNKNOWN — "${t.label}" not launched (fail closed)\n`,
    };
  }
  if (liveSession) {
    return {
      kind: "attach",
      tab: t,
      attachSession: liveSession.name,
      command: tabCommand(t, new Set([slug]), {
        attachSession: liveSession.name,
      }),
    };
  }
  return {
    kind: "launch",
    tab: t,
    command: tabCommand(t, new Set(), ctx.tabOpts),
  };
}

/** Pure per-tab launch/attach/skip/refuse decision from one `HostViewSnapshot`. */
export function decideLayoutTab(
  tab: LayoutTab,
  hostView: HostViewSnapshot,
  opts: LayoutLaunchOptions = {},
): TabLaunchDecision {
  const ctx = createLayoutDecisionContext(hostView, opts);
  return decideTabWithContext(tab, ctx);
}

/** Pure per-window launch plan extracted from `launchLayout`. */
export function planLayoutLaunch(
  windows: readonly LayoutWindow[],
  hostView: HostViewSnapshot,
  opts: LayoutLaunchOptions = {},
): LayoutLaunchPlan {
  const ctx = createLayoutDecisionContext(hostView, opts);
  const warnings: string[] = [];
  if (!ctx.tmuxKnown) {
    warnings.push(
      `[h2a] legacy tmux view state unavailable${ctx.tmuxReason ? ` (${ctx.tmuxReason})` : ""}; ` +
        "opening attach tabs rather than relaunching local sessions\n",
    );
  }
  const skippedLive: string[] = [];
  const plannedWindows: LayoutLaunchPlanWindow[] = [];

  for (const win of windows) {
    const decisions: TabLaunchDecision[] = [];
    const activeTabs: Array<{ tab: LayoutTab; command: string }> = [];
    for (const t of win.tabs) {
      const decision = decideTabWithContext(t, ctx);
      decisions.push(decision);
      if (decision.kind === "attach" || decision.kind === "launch") {
        activeTabs.push({ tab: t, command: decision.command });
      } else if (
        decision.kind === "skip-live" ||
        decision.skippedLive === true
      ) {
        skippedLive.push(t.label);
      }
    }
    plannedWindows.push({ title: win.title, decisions, activeTabs });
  }

  return { warnings, windows: plannedWindows, skippedLive };
}
