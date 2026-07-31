/**
 * `remote restore` — relaunch recent local dev sessions (claude/codex) in their
 * layout, each tab a remote-managed tmux session (durable, live-named).
 *
 * This OWNS the launcher logic in the CLI (discovery + grouping + layout +
 * terminal launch), so `~/bin/resume-dev-sessions` is just `exec remote
 * restore`. SCW sessions and persisted positions come later.
 */

import { spawn } from "node:child_process";
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
  getLayoutConfig,
  resolveConfigPath,
  type LayoutConfig,
} from "./config.js";
import {
  loadRegistry,
  looksLikeConversationUuid,
  persistReconciledConvIds,
  type RegistryEntry,
} from "./registry.js";
import { listLocalSessions, slugify, type LocalSession } from "./tmux.js";

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
};

export type LayoutWindow = { title: string; tabs: LayoutTab[] };

/** A pre-resolved SCW tab for a remote group (built by the caller from `remote ls`). */
export type RemoteTab = { id: string; label: string; cwd: string };

/** claude encodes a cwd into its project-dir name by replacing "/" with "-". */
function encodeCwd(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

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

/**
 * Restore gate: may this registry record become a dev tab?
 *
 * An ended record never can. A record carrying an explicit class is judged on
 * that class — which is the whole point of stamping it, and keeps a background
 * launch or a delegated job out.
 *
 * A record with NO class is a LEGACY record, and this is where the gate has to
 * be careful in both directions. Enrollment has required a class since the
 * classification landed (registry.ts refuses an enrollment without one), so an
 * unclassified record can only predate it. Judging those closed took out every
 * session enrolled before that day: measured, restore returned an EMPTY list for
 * three live named sessions of one repo, which is exactly what the owner
 * observed as "restore does not restore my multi-session projects" — the filter
 * was tightened to opt-in while nothing back-filled the class.
 *
 * So legacy records fall back to the discriminator that existed when they were
 * written: a delegated job is never human, anything else was a session someone
 * launched. That is narrower than it looks — it cannot readmit a NEW background
 * session, because a new record always carries its class.
 */
export function isHumanFacingSession(
  e: Pick<RegistryEntry, "sessionClass" | "endedAt" | "role">,
): boolean {
  if (e.endedAt !== undefined) return false;
  if (e.sessionClass === "human") return true;
  if (e.sessionClass === "background") return false;
  return e.role !== "job";
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
    if (r.kind !== "local-tmux" || r.source !== "run") continue;
    // Delegated jobs / background launches are never restored as human tabs, so
    // don't reconcile (and don't emit a spurious skip note) for them.
    if (!isHumanFacingSession(r)) continue;
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
 * REGISTRY-FIRST discovery: durable registry entries (local kinds) mapped to
 * discovered sessions. label/cwd/convId come straight from enrolment, no
 * mtime guessing. `entries` is injectable for tests (defaults to listLive()).
 *
 * `resolution` (from `reconcileRunConvIds`) rewires convIds so a named `run`
 * session resumes on its REAL conversation uuid, drops a run session that has no
 * resolvable conversation (so restore never emits `--resume <label>`), and
 * dedups the `hook` twin of a conversation already represented by a run session.
 * Omitted (the plain 2-arg call) → legacy behaviour, one session per entry.
 */
export function registrySessions(
  home: string = homedir(),
  entries: RegistryEntry[] = loadRegistry(),
  resolution?: ConvIdResolution,
): DiscoveredSession[] {
  const src = join(home, "src");
  const out: DiscoveredSession[] = [];
  for (const e of entries) {
    if (e.kind === "remote") continue; // remote groups are filled from SCW
    // Only human dev sessions are restorable — never delegated jobs or explicit
    // background launches (they had no human in front of them).
    if (!isHumanFacingSession(e)) continue;
    if (!e.cwd.startsWith(`${src}/`)) continue;
    // A run session whose conversation id could not be resolved is skipped here
    // (restore() emits the attach-hint note) — never a broken `--resume <label>`.
    if (
      resolution &&
      e.kind === "local-tmux" &&
      e.source === "run" &&
      resolution.unresolvedRunIds.has(e.id)
    ) {
      continue;
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
    const sid = resolution?.resolvedSid.get(e.id) ?? e.convId ?? "";
    const session: DiscoveredSession = {
      project,
      mtimeMs: Number.isFinite(seen) ? seen : Date.now(),
      tool: e.tool,
      sid,
      cwd: e.cwd,
      origin: "registry",
      restoreClass: "human",
    };
    if (e.label !== undefined) session.label = e.label;
    if (e.gatewayMode !== undefined) session.gatewayMode = e.gatewayMode;
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

/**
 * Per-tab command: SCW via `attach --exec`; a LOCAL session that is already
 * live → `remote attach <slug>` (do NOT `remote run -r`, which the single-writer
 * guard refuses while that session still holds the conversation — this is what
 * broke a `restore` over still-detached sessions); otherwise create it via
 * `remote run … --resume …` (which attaches by default). `liveSlugs` = slugs of
 * currently-live local tmux sessions (empty for the reproducible layout snapshot).
 */
export function tabCommand(
  tab: LayoutTab,
  liveSlugs: ReadonlySet<string> = new Set(),
  opts: { forceGateway?: "gateway" | "direct" } = {},
): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  if (tab.remoteId) {
    // SCW: attach straight into the Pod's tmux (live, copy-friendly).
    return `h2a attach ${q(tab.remoteId)} --exec`;
  }
  const slug = slugify(tab.label);
  // Effective gateway posture: an explicit `restore --gw/--no-gw` OVERRIDES the
  // per-instance pin; otherwise honour the pinned gatewayMode (absent = default).
  const posture = opts.forceGateway ?? tab.gatewayMode;
  const gwFlag =
    posture === "gateway" ? " --gw" : posture === "direct" ? " --no-gw" : "";
  const runCmd = (extra: string) =>
    `h2a run ${q(tab.tool ?? "shell")} ${q(tab.cwd)} ` +
    (tab.sid ? `--resume ${q(tab.sid)} ` : "") +
    `--name ${q(tab.label)}${gwFlag}${extra}`;
  if (liveSlugs.has(slug)) {
    // Already running. Normally we just attach (no redundant relaunch, no guard
    // fight). But a forced posture (restore --gw/--no-gw) must actually SWITCH a
    // live session — a reattach can't change a running process's gateway env.
    // `remote run` has NO --replace and refuses to clobber a live session, so
    // relaunch via `remote resume --replace`: it kills the running tmux session,
    // resumes the conversation in the forced posture (--no-gw scrubs the gateway
    // env), and --attach reopens the terminal onto it.
    if (!opts.forceGateway) return `h2a attach ${q(slug)}`;
    return `h2a resume ${q(slug)} --replace --attach${gwFlag}`;
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
 * Default behaviour (reattach=false): sessions already live in tmux are SKIPPED —
 * no new terminal tab is opened for them. The assumption is that if a tmux session
 * exists, the user either has a terminal showing it or intentionally left it running.
 * Use reattach=true (--reattach flag) to reopen a terminal tab for every session
 * regardless of its current tmux state.
 */
export function launchLayout(
  windows: LayoutWindow[],
  stderr: NodeJS.WriteStream = process.stderr,
  opts: { reattach?: boolean; forceGateway?: "gateway" | "direct" } = {},
): { opened: number; skippedLive: string[] } {
  const liveSessions = listLocalSessions();
  const liveSlugs = new Set(liveSessions.map((s) => s.slug));
  const ambiguousLiveNames = ambiguousLiveSessionNames(liveSessions);
  const skippedLive: string[] = [];
  let opened = 0;
  // A forced posture must reach EVERY session (live ones get relaunched), so it
  // includes already-live tabs just like --reattach.
  const includeLive = opts.reattach || opts.forceGateway !== undefined;
  const tabOpts = opts.forceGateway ? { forceGateway: opts.forceGateway } : {};

  for (const win of windows) {
    // Filter tabs: skip local sessions already in tmux (attach would be redundant).
    // Remote (k8s) tabs are always included — we can't probe pod health here.
    const activeTabs = win.tabs.filter((t) => {
      if (t.remoteId) return true;
      const slug = slugify(t.label);
      const names = ambiguousLiveNames.get(slug);
      if (names) {
        skippedLive.push(t.label);
        stderr.write(
          `[h2a] restore skipped "${t.label}": local tmux slug is ambiguous (${names.sort().join(", ")}); ` +
            `attach explicitly with h2a attach ${names.sort()[0]} or h2a attach ${names.sort()[1]}\n`,
        );
        return false;
      }
      if (!includeLive && liveSlugs.has(slug)) {
        skippedLive.push(t.label);
        return false;
      }
      return true;
    });

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
        .map((t) => `${t.cwd}\t${tabCommand(t, liveSlugs, tabOpts)}`)
        .join("\n") + "\n";
    writeFileSync(mapPath, body, "utf8");

    const args: string[] = [];
    activeTabs.forEach((tab, i) => {
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
    const child = spawn("gnome-terminal", args, {
      stdio: ["ignore", "ignore", "pipe"],
      detached: true,
      env: process.env,
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.write(`[h2a] gnome-terminal: ${chunk.toString().trim()}\n`);
    });
    child.unref();
    opened += activeTabs.length;
  }

  if (skippedLive.length > 0) {
    stderr.write(
      `[h2a] ${skippedLive.length} session(s) déjà actives ignorées` +
      ` (--reattach pour les rouvrir quand même): ${skippedLive.join(", ")}\n`,
    );
  }

  return { opened, skippedLive };
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
   * Force the llm-mesh gateway posture for the WHOLE restore, overriding every
   * session's pinned gatewayMode. Live sessions on the wrong posture are
   * relaunched (--replace) so the switch actually takes effect.
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
  const registryEntries = loadRegistry();
  const resolution = reconcileRunConvIds(registryEntries, (cwd, convId) =>
    readConversationCustomTitle(home, cwd, convId),
  );
  // Persist the resolved conversation ids back onto the run entries so the state
  // is EMITTED, not re-derived (a transcript scan) on every restore. Skipped on
  // --dry-run so a preview stays side-effect-free.
  if (!opts.dryRun) {
    try {
      const updates = new Map<string, string>();
      for (const [id, sid] of resolution.resolvedSid) {
        const e = registryEntries.find((x) => x.id === id);
        if (e && e.kind === "local-tmux" && e.source === "run" && e.convId !== sid) {
          updates.set(id, sid);
        }
      }
      persistReconciledConvIds(updates);
    } catch {
      // best-effort: a persistence hiccup must never break restore
    }
  }
  // Never emit a broken `--resume <label>`: note the un-resumable named sessions
  // with an explicit attach hint instead of silently dropping (or mis-running) them.
  for (const id of resolution.unresolvedRunIds) {
    const e = registryEntries.find((x) => x.id === id);
    if (!e) continue;
    const label = e.label ?? e.id;
    stderr.write(
      `[h2a] restore skipped "${label}": no resolved conversation id ` +
        `(convId ${e.convId ? `"${e.convId}"` : "missing"} is not a real conversation); ` +
        `attach it live with h2a attach ${slugify(label)}\n`,
    );
  }
  const scanned = discoverSessions(cfg.maxAgeHours * 3600 * 1000);
  const allDiscovered = mergeDiscovered(
    registrySessions(home, registryEntries, resolution),
    scanned,
  );
  // Transcript scans lack a durable human/job marker. They are deliberately
  // represented as `unclassified` and filtered here, before grouping/capping.
  const allLocal = allDiscovered.filter(isRestorableDiscoveredSession);
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
    launchLayout(windows, stderr, {
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
