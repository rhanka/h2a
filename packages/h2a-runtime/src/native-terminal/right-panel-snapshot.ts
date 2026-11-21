/**
 * Live read-only snapshot projection for the native right panel (L0.5a,
 * PANEL §4.2, §4.3, §4.5, §11; r4 §5 OQ-19(b)).
 *
 * Rules:
 * - Zero `restore()` calls (never writes or launches), zero `spawnSync` calls.
 * - Reads native host inventory in-process via `collectNativeInventory` /
 *   `resolveNativeOwner` (`nt/fleet.ts`) and reuses pure restore helpers
 *   (`registrySessions`, `reconcileRunConvIds`, `managedLiveLookupFromSnapshot`).
 * - Resolves the sibling `track` binary asynchronously via `execFile` (no shell,
 *   separate args, 5 s timeout) and caches results per `(events.jsonl size, mtimeNs)`,
 *   coalescing concurrent reads and publishing only still-current revisions.
 * - No `@sentropic/track` or `@sentropic/h2a` package import: works in isolated
 *   `@sentropic/h2a-runtime` installs even when `track` is absent (degrading only
 *   the Track source).
 */

import { execFile as execFileCb } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_LAYOUT,
  readRemoteConfig,
  type LayoutConfig,
  type RemoteCliConfig,
} from "../config.js";
import type { HostViewSnapshot } from "../launch-layout.js";
import { loadRegistry } from "../registry.js";
import {
  isRestorableDiscoveredSession,
  managedLiveLookupFromSnapshot,
  readConversationCustomTitle,
  reconcileRunConvIds,
  registrySessions,
  type DiscoveredSession,
  type LegacySessionEvidence,
} from "../restore.js";
import { NativeTerminalClient } from "./client.js";
import {
  collectNativeInventory,
  resolveNativeOwner,
  type NativeInventory,
} from "./fleet.js";
import { NATIVE_TERMINAL_PROTOCOL_VERSION } from "./protocol.js";
import {
  buildRightPanelSnapshot,
  classifyDossierRef,
  decisionSeenKey,
  decisionsFromTrackDecisions,
  type RightPanelDecision,
  type RightPanelDossierLinkClass,
  type RightPanelDraftCapabilityState,
  type RightPanelDraftRecoveryState,
  type RightPanelSession,
  type RightPanelSessionStatus,
  type RightPanelSnapshot,
  type RightPanelWorkspace,
  type TrackDecisionRow,
} from "./right-panel.js";
import {
  inspectPrivateNativeTerminalSocket,
  knownNativeTerminalSocketPaths,
  sameNativeTerminalSocket,
} from "./socket-path.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SIBLING_CLI_TIMEOUT_MS = 5_000;
const BOUNDED_READ_MAX_BYTES = 64 * 1024;
const DEFAULT_PRESENCE_EXPIRY_MS = 90_000;
const INSTANCE_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,255}$/;
const ITEM_LINK_KINDS = new Set(["artifact", "spec", "decision"]);

export type SiblingBinaryTarget = Readonly<{
  command: string;
  prefixArgs: readonly string[];
}>;

export type SiblingExecResult =
  | { readonly ok: true; readonly stdout: string; readonly stderr: string }
  | {
      readonly ok: false;
      readonly reason: "enoent" | "timeout" | "nonzero" | "invalid-json" | "error";
      readonly exitCode?: number | null;
      readonly message: string;
    };

export type SiblingExecFn = (
  command: string,
  args: readonly string[],
  options: {
    readonly timeoutMs: number;
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
  },
) => Promise<SiblingExecResult>;

/**
 * Resolve the sibling `track` executable without shell expansion or package
 * dependency. Reusable by lots 16–20 (`02-L0.5a` Step 4).
 */
export function resolveTrackBinaryTarget(
  env: NodeJS.ProcessEnv = process.env,
): SiblingBinaryTarget {
  const entry = env.H2A_TRACK_ENTRY?.trim();
  if (entry) {
    return { command: process.execPath, prefixArgs: [entry] };
  }
  const explicitBin = env.H2A_TRACK_BIN?.trim();
  if (explicitBin) {
    return { command: explicitBin, prefixArgs: [] };
  }
  if (env.H2A_TRACK_DISABLE_SIBLING !== "1") {
    const candidates = [
      resolve(HERE, "../../../track/dist/cli/bin.js"),
      resolve(HERE, "../../../../track/dist/cli/bin.js"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return { command: process.execPath, prefixArgs: [candidate] };
      }
    }
  }
  return { command: "track", prefixArgs: [] };
}

/** Async `execFile` runner (no shell, separate args, 5 s timeout). */
export function defaultSiblingExec(
  command: string,
  args: readonly string[],
  options: {
    readonly timeoutMs: number;
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
  },
): Promise<SiblingExecResult> {
  return new Promise((resolveResult) => {
    execFileCb(
      command,
      [...args],
      {
        timeout: options.timeoutMs,
        cwd: options.cwd,
        env: options.env,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolveResult({
            ok: true,
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? ""),
          });
          return;
        }
        const err = error as NodeJS.ErrnoException & {
          killed?: boolean;
          signal?: string | null;
          code?: string | number;
        };
        if (err.code === "ENOENT") {
          resolveResult({
            ok: false,
            reason: "enoent",
            message: err.message,
          });
          return;
        }
        if (err.killed || err.signal === "SIGTERM" || err.code === "ETIMEDOUT") {
          resolveResult({
            ok: false,
            reason: "timeout",
            message: err.message,
          });
          return;
        }
        if (typeof err.code === "number") {
          resolveResult({
            ok: false,
            reason: "nonzero",
            exitCode: err.code,
            message: String(stderr || err.message),
          });
          return;
        }
        resolveResult({
          ok: false,
          reason: "error",
          message: err.message,
        });
      },
    );
  });
}

/**
 * Resolve a project's Track journal of record (`PANEL §4.3`):
 * 1. Explicit `rightPanel.trackDirs[project]` override.
 * 2. Repository main checkout (resolving linked worktree `.git` file via
 *    `gitdir` + `commondir` so a stale worktree `.track` is never treated as
 *    authoritative).
 */
export function resolveJournalOfRecord(
  project: string,
  projectCwd: string,
  trackDirs?: Readonly<Record<string, string>>,
): { readonly trackDir: string; readonly repoRoot: string; readonly eventsPath: string } {
  const configured = trackDirs?.[project]?.trim();
  if (configured) {
    const abs = isAbsolute(configured) ? configured : resolve(projectCwd, configured);
    return {
      trackDir: abs,
      repoRoot: dirname(abs),
      eventsPath: join(abs, "events.jsonl"),
    };
  }

  let cursor = resolve(projectCwd);
  for (;;) {
    const dotGit = join(cursor, ".git");
    try {
      const st = statSync(dotGit);
      if (st.isDirectory()) {
        const trackDir = join(cursor, ".track");
        return {
          trackDir,
          repoRoot: cursor,
          eventsPath: join(trackDir, "events.jsonl"),
        };
      }
      if (st.isFile()) {
        const raw = readFileSync(dotGit, "utf8");
        const match = /^gitdir:\s*(.+)$/m.exec(raw);
        if (match && match[1]) {
          const gitDir = resolve(cursor, match[1].trim());
          let commonDir = resolve(gitDir, "../..");
          try {
            const commonRaw = readFileSync(join(gitDir, "commondir"), "utf8").trim();
            if (commonRaw) commonDir = resolve(gitDir, commonRaw);
          } catch {
            // Fall back to standard `<main>/.git/worktrees/<name>` parent.
          }
          const mainRoot = dirname(commonDir);
          const trackDir = join(mainRoot, ".track");
          return {
            trackDir,
            repoRoot: mainRoot,
            eventsPath: join(trackDir, "events.jsonl"),
          };
        }
      }
    } catch {
      // Keep walking up.
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  const fallbackTrack = join(projectCwd, ".track");
  return {
    trackDir: fallbackTrack,
    repoRoot: projectCwd,
    eventsPath: join(fallbackTrack, "events.jsonl"),
  };
}

function statEventsRevision(trackDir: string): string | undefined {
  try {
    const st = statSync(join(trackDir, "events.jsonl"), { bigint: true });
    if (!st.isFile()) return undefined;
    return `${st.size}:${st.mtimeNs}`;
  } catch {
    return undefined;
  }
}

export type TrackCachedJsonResult<T> =
  | { readonly ok: true; readonly data: T; readonly revision: string }
  | {
      readonly ok: false;
      readonly reason:
        | "missing-journal"
        | "enoent"
        | "timeout"
        | "nonzero"
        | "invalid-json"
        | "error";
      readonly message: string;
    };

export type TrackProjectSource = Readonly<{
  project: string;
  trackDir: string;
  repoRoot: string;
  workspace?: string;
}>;

export type TrackDecisionWithAttribution = Readonly<{
  decision: RightPanelDecision;
  /** Candidate actor ids from decision `accountable` and DECIDES target items' RACI. */
  actorIds: readonly string[];
  workspace?: string;
}>;

export type TrackJournalDecisionsResult = Readonly<{
  decisions: readonly RightPanelDecision[];
  attributions: readonly TrackDecisionWithAttribution[];
  degraded: boolean;
  reason?: string;
  revision?: string;
}>;

type GraphExportShape = {
  edges?: readonly {
    source?: string;
    from?: string;
    target?: string;
    to?: string;
    relation?: string;
    relation_type?: string;
  }[];
};

type ItemShowShape = {
  id?: string;
  accountable?: string;
  responsible?: readonly string[];
  links?: readonly { kind?: string; locator?: string }[];
};

type FocusJsonShape = {
  nodes?: readonly { kind?: string; state?: string }[];
};

/**
 * Revision-keyed async cache over the sibling `track` binary (`02-L0.5a` Step 4,
 * reusable by lots 16–20).
 *
 * - First read populates the cache; subsequent reads at the same `(size, mtimeNs)`
 *   of `events.jsonl` launch ZERO subprocesses.
 * - Concurrent requests for the same `(trackDir, args, revision)` share one
 *   in-flight Promise.
 * - Stale completions (where `events.jsonl` changed while the subprocess ran)
 *   never overwrite the cache.
 */
export class TrackJournalCache {
  readonly #target: SiblingBinaryTarget;
  readonly #exec: SiblingExecFn;
  readonly #timeoutMs: number;
  readonly #env: NodeJS.ProcessEnv | undefined;

  readonly #jsonCache = new Map<string, { revision: string; data: unknown }>();
  readonly #jsonInFlight = new Map<string, Promise<TrackCachedJsonResult<unknown>>>();

  readonly #decisionsCache = new Map<
    string,
    { revision: string; result: TrackJournalDecisionsResult }
  >();
  readonly #decisionsInFlight = new Map<string, Promise<TrackJournalDecisionsResult>>();

  constructor(opts?: {
    target?: SiblingBinaryTarget;
    exec?: SiblingExecFn;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
  }) {
    this.#env = opts?.env;
    this.#target = opts?.target ?? resolveTrackBinaryTarget(opts?.env ?? process.env);
    this.#exec = opts?.exec ?? defaultSiblingExec;
    this.#timeoutMs = opts?.timeoutMs ?? SIBLING_CLI_TIMEOUT_MS;
  }

  clear(): void {
    this.#jsonCache.clear();
    this.#jsonInFlight.clear();
    this.#decisionsCache.clear();
    this.#decisionsInFlight.clear();
  }

  async runCachedJson<T>(params: {
    readonly trackDir: string;
    readonly args: readonly string[];
    readonly cwd?: string;
  }): Promise<TrackCachedJsonResult<T>> {
    const revision = statEventsRevision(params.trackDir);
    if (revision === undefined) {
      return {
        ok: false,
        reason: "missing-journal",
        message: `missing events.jsonl in ${params.trackDir}`,
      };
    }

    const cacheKey = `${params.trackDir}\u0000${params.args.join("\u0000")}`;
    const cached = this.#jsonCache.get(cacheKey);
    if (cached && cached.revision === revision) {
      return { ok: true, data: cached.data as T, revision };
    }

    const flightKey = `${cacheKey}\u0000${revision}`;
    const existing = this.#jsonInFlight.get(flightKey);
    if (existing) {
      return (await existing) as TrackCachedJsonResult<T>;
    }

    const work = (async (): Promise<TrackCachedJsonResult<unknown>> => {
      const fullArgs = [
        ...this.#target.prefixArgs,
        ...params.args,
        "--track-dir",
        params.trackDir,
      ];
      const execRes = await this.#exec(this.#target.command, fullArgs, {
        timeoutMs: this.#timeoutMs,
        ...(params.cwd ? { cwd: params.cwd } : {}),
        ...(this.#env ? { env: this.#env } : {}),
      });
      if (!execRes.ok) {
        return {
          ok: false,
          reason: execRes.reason,
          message: execRes.message,
        };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(execRes.stdout);
      } catch (err) {
        return {
          ok: false,
          reason: "invalid-json",
          message: `invalid JSON from track: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      // Publish to cache ONLY if the revision is still current.
      if (statEventsRevision(params.trackDir) === revision) {
        this.#jsonCache.set(cacheKey, { revision, data: parsed });
      }
      return { ok: true, data: parsed, revision };
    })().finally(() => {
      this.#jsonInFlight.delete(flightKey);
    });

    this.#jsonInFlight.set(flightKey, work);
    return (await work) as TrackCachedJsonResult<T>;
  }

  async readDecisions(source: TrackProjectSource): Promise<TrackJournalDecisionsResult> {
    const revision = statEventsRevision(source.trackDir);
    if (revision === undefined) {
      return {
        decisions: [],
        attributions: [],
        degraded: true,
        reason: "missing-journal",
      };
    }

    const cacheKey = `${source.trackDir}\u0000${source.workspace ?? "*"}`;
    const cached = this.#decisionsCache.get(cacheKey);
    if (cached && cached.revision === revision) {
      return cached.result;
    }

    const flightKey = `${cacheKey}\u0000${revision}`;
    const existing = this.#decisionsInFlight.get(flightKey);
    if (existing) return existing;

    const work = this.#loadDecisionsForRevision(source, revision, cacheKey).finally(() => {
      this.#decisionsInFlight.delete(flightKey);
    });
    this.#decisionsInFlight.set(flightKey, work);
    return work;
  }

  async #loadDecisionsForRevision(
    source: TrackProjectSource,
    revision: string,
    cacheKey: string,
  ): Promise<TrackJournalDecisionsResult> {
    const lsArgs = [
      "decision",
      "ls",
      ...(source.workspace ? ["--workspace", source.workspace] : []),
      "--format",
      "json",
    ];
    const lsRes = await this.runCachedJson<unknown>({
      trackDir: source.trackDir,
      args: lsArgs,
      cwd: source.repoRoot,
    });
    if (!lsRes.ok || !Array.isArray(lsRes.data)) {
      return {
        decisions: [],
        attributions: [],
        degraded: true,
        reason: lsRes.ok ? "invalid-json" : lsRes.reason,
      };
    }

    const rawRows = (lsRes.data as TrackDecisionRow[]).filter(
      (r) => r && typeof r.id === "string" && (r.outcome === "pending" || r.outcome === "deferred"),
    );
    const baseDecisions = decisionsFromTrackDecisions(rawRows, {
      repoRoot: source.repoRoot,
    });

    // Determine which decisions need DECIDES -> item show enrichment (missing link or missing accountable)
    // or focus enrichment (missing openQuestionCount).
    const rawById = new Map(rawRows.map((r) => [r.id, r]));
    const needsItemEnrichment = baseDecisions.filter((d) => {
      const raw = rawById.get(d.id);
      return !d.dossierLink || !raw?.accountable;
    });

    const decidesTargets = new Map<string, string[]>();
    if (needsItemEnrichment.length > 0) {
      const graphRes = await this.runCachedJson<GraphExportShape>({
        trackDir: source.trackDir,
        args: ["export-graph"],
        cwd: source.repoRoot,
      });
      if (graphRes.ok && Array.isArray(graphRes.data?.edges)) {
        for (const edge of graphRes.data.edges) {
          const rel = edge.relation ?? edge.relation_type;
          if (rel !== "DECIDES") continue;
          const from = edge.from ?? edge.source;
          const to = edge.to ?? edge.target;
          if (!from || !to) continue;
          const list = decidesTargets.get(from) ?? [];
          if (!list.includes(to)) list.push(to);
          decidesTargets.set(from, list);
        }
      }
    }

    const itemCache = new Map<string, ItemShowShape | null>();
    const loadItem = async (itemId: string): Promise<ItemShowShape | null> => {
      if (itemCache.has(itemId)) return itemCache.get(itemId)!;
      const itemRes = await this.runCachedJson<ItemShowShape | null>({
        trackDir: source.trackDir,
        args: ["item", "show", itemId],
        cwd: source.repoRoot,
      });
      const val = itemRes.ok && itemRes.data && typeof itemRes.data === "object" ? itemRes.data : null;
      itemCache.set(itemId, val);
      return val;
    };

    const enrichedDecisions: RightPanelDecision[] = [];
    const attributions: TrackDecisionWithAttribution[] = [];

    for (const base of baseDecisions) {
      const raw = rawById.get(base.id);
      let dossierLink = base.dossierLink;
      let dossierLinkClass: RightPanelDossierLinkClass | undefined = base.dossierLinkClass;
      let kind = base.kind;
      const actorIds: string[] = [];
      if (raw?.accountable) actorIds.push(raw.accountable);

      const targetIds = decidesTargets.get(base.id) ?? [];
      for (const targetId of targetIds) {
        const item = await loadItem(targetId);
        if (!item) continue;
        if (typeof item.accountable === "string" && item.accountable) {
          actorIds.push(item.accountable);
        }
        if (Array.isArray(item.responsible)) {
          for (const resp of item.responsible) {
            if (typeof resp === "string" && resp) actorIds.push(resp);
          }
        }
        // Priority 2 (`PANEL §4.3`): target item links[] with kind in {artifact, spec, decision}.
        if (!dossierLink && Array.isArray(item.links)) {
          for (const link of item.links) {
            if (
              typeof link.kind === "string" &&
              ITEM_LINK_KINDS.has(link.kind) &&
              typeof link.locator === "string" &&
              link.locator.trim().length > 0
            ) {
              const classified = classifyDossierRef(link.locator, source.repoRoot);
              dossierLink = classified.link;
              dossierLinkClass = classified.linkClass;
              break;
            }
          }
        }
      }

      // If `openQuestionCount` was absent from `decision ls`, consult `track focus --format json`.
      if (raw && raw.openQuestionCount === undefined && kind !== "question" && raw.workspace) {
        const focusRes = await this.runCachedJson<FocusJsonShape>({
          trackDir: source.trackDir,
          args: ["focus", base.id, "--workspace", raw.workspace, "--format", "json"],
          cwd: source.repoRoot,
        });
        if (
          focusRes.ok &&
          Array.isArray(focusRes.data?.nodes) &&
          focusRes.data.nodes.some((n) => n.kind === "question" && n.state === "open")
        ) {
          kind = "question";
        }
      }

      const finalDecision: RightPanelDecision = {
        ...base,
        kind,
        ...(dossierLink ? { dossierLink } : {}),
        ...(dossierLinkClass ? { dossierLinkClass } : {}),
        revisionKey: `${base.id}:${base.outcome ?? "pending"}:${base.title}:${dossierLink ?? ""}:${kind}`,
      };
      enrichedDecisions.push(finalDecision);
      attributions.push({
        decision: finalDecision,
        actorIds: [...new Set(actorIds)],
        ...(raw?.workspace ? { workspace: raw.workspace } : {}),
      });
    }

    const result: TrackJournalDecisionsResult = {
      decisions: enrichedDecisions,
      attributions,
      degraded: false,
      revision,
    };
    if (statEventsRevision(source.trackDir) === revision) {
      this.#decisionsCache.set(cacheKey, { revision, result });
    }
    return result;
  }
}

function readBoundedUtf8(filePath: string, maxBytes = BOUNDED_READ_MAX_BYTES): string | undefined {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return undefined;
  }
  try {
    const buf = Buffer.allocUnsafe(maxBytes + 1);
    const bytesRead = readSync(fd, buf, 0, maxBytes + 1, 0);
    if (bytesRead > maxBytes) return undefined;
    return buf.subarray(0, bytesRead).toString("utf8");
  } catch {
    return undefined;
  } finally {
    try {
      closeSync(fd);
    } catch {
      // best effort
    }
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type PresenceWorkRecord = {
  instance: string;
  workStatus?: string;
  nativeSession?: string;
  tmuxSession?: string;
};

function readPresenceWorkRecords(
  h2aRoot: string | undefined,
  nowMs: number,
  env: NodeJS.ProcessEnv,
): { records: PresenceWorkRecord[]; degraded: boolean; known: boolean } {
  if (!h2aRoot || !existsSync(h2aRoot)) {
    return { records: [], degraded: false, known: false };
  }
  const presenceDir = join(h2aRoot, "presence");
  const records: PresenceWorkRecord[] = [];
  let degraded = false;

  const envExpiry = Number.parseInt(env.H2A_SESSION_EXPIRY_MS ?? "", 10);
  const expiryMs =
    Number.isFinite(envExpiry) && envExpiry > 0
      ? envExpiry
      : DEFAULT_PRESENCE_EXPIRY_MS;

  if (existsSync(presenceDir)) {
    try {
      for (const file of readdirSync(presenceDir)) {
        if (!file.endsWith(".json")) continue;
        const text = readBoundedUtf8(join(presenceDir, file));
        if (text === undefined) {
          degraded = true;
          continue;
        }
        try {
          const raw = JSON.parse(text) as {
            instance?: unknown;
            state?: unknown;
            heartbeatAt?: unknown;
            pid?: unknown;
            mirroredAt?: unknown;
            workStatus?: unknown;
            launchContext?: {
              nativePty?: { session?: unknown };
              tmux?: { session?: unknown };
            };
          };
          if (
            typeof raw.instance !== "string" ||
            !INSTANCE_TOKEN_RE.test(raw.instance) ||
            typeof raw.heartbeatAt !== "string"
          ) {
            degraded = true;
            continue;
          }
          const heartbeatMs = Date.parse(raw.heartbeatAt);
          if (!Number.isFinite(heartbeatMs)) {
            degraded = true;
            continue;
          }
          if (raw.state === "closed" || raw.state === "expired") continue;
          if (nowMs - heartbeatMs > expiryMs) continue;
          if (
            !raw.mirroredAt &&
            typeof raw.pid === "number" &&
            (!Number.isInteger(raw.pid) || raw.pid <= 0 || !isPidAlive(raw.pid))
          ) {
            continue;
          }
          records.push({
            instance: raw.instance,
            ...(typeof raw.workStatus === "string" ? { workStatus: raw.workStatus } : {}),
            ...(typeof raw.launchContext?.nativePty?.session === "string"
              ? { nativeSession: raw.launchContext.nativePty.session }
              : {}),
            ...(typeof raw.launchContext?.tmux?.session === "string"
              ? { tmuxSession: raw.launchContext.tmux.session }
              : {}),
          });
        } catch {
          degraded = true;
        }
      }
    } catch {
      degraded = true;
    }
  }

  return { records, degraded, known: true };
}

export type PanelLiveSession = Readonly<{
  id: string;
  label: string;
  project: string;
  cwd: string;
  tool: string;
  mtimeMs: number;
  status: RightPanelSessionStatus;
  displayedHere: boolean;
  controlledElsewhere: boolean;
  compatGuard: boolean;
  draftCapability: RightPanelDraftCapabilityState;
  draftRecovery: RightPanelDraftRecoveryState;
}>;

/**
 * De-capped, stable meta-workspace grouping (`PANEL §4.2`, `02-L0.5a` Step 1):
 * - One tab per non-remote `LayoutConfig.groups` entry in config order, UNCAPPED
 *   (no `maxPerWindow` truncation).
 * - All ungrouped projects in ONE stable `other` tab, ordered by project name
 *   (never reshuffled by recency).
 * - Each live session appears in at most one tab.
 */
export function groupPanelSessions(
  sessions: readonly PanelLiveSession[],
  cfg: LayoutConfig,
): RightPanelWorkspace[] {
  const byProject = new Map<string, PanelLiveSession[]>();
  for (const s of sessions) {
    const arr = byProject.get(s.project) ?? [];
    arr.push(s);
    byProject.set(s.project, arr);
  }

  const toRow = (s: PanelLiveSession): RightPanelSession => ({
    id: s.id,
    label: s.label,
    status: s.status,
    displayedHere: s.displayedHere,
    controlledElsewhere: s.controlledElsewhere,
    compatGuard: s.compatGuard,
    draftCapability: s.draftCapability,
    draftRecovery: s.draftRecovery,
    project: s.project,
    tool: s.tool,
  });

  const sortWithinProject = (arr: readonly PanelLiveSession[]): PanelLiveSession[] =>
    arr
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label, "en") || a.id.localeCompare(b.id, "en"));

  const groupedProjects = new Set<string>();
  const workspaces: RightPanelWorkspace[] = [];

  for (const g of cfg.groups) {
    if (g.remote) continue;
    const rows: RightPanelSession[] = [];
    for (const project of g.projects ?? []) {
      groupedProjects.add(project);
      const projSessions = byProject.get(project);
      if (!projSessions) continue;
      for (const s of sortWithinProject(projSessions)) {
        rows.push(toRow(s));
      }
    }
    if (rows.length > 0) {
      workspaces.push({ title: g.title, sessions: rows });
    }
  }

  const ungroupedProjects = [...byProject.keys()]
    .filter((p) => !groupedProjects.has(p))
    .sort((a, b) => a.localeCompare(b, "en"));

  if (ungroupedProjects.length > 0) {
    const otherRows: RightPanelSession[] = [];
    for (const project of ungroupedProjects) {
      for (const s of sortWithinProject(byProject.get(project)!)) {
        otherRows.push(toRow(s));
      }
    }
    workspaces.push({ title: "other", sessions: otherRows });
  }

  return workspaces;
}

async function connectReadOnlyHost(socketPath: string): Promise<NativeTerminalClient> {
  const identity = await inspectPrivateNativeTerminalSocket(socketPath);
  const client = await NativeTerminalClient.connect(socketPath);
  try {
    const ping = await client.ping();
    if (
      ping.protocolVersion !== NATIVE_TERMINAL_PROTOCOL_VERSION ||
      !ping.generation?.trim() ||
      !Number.isSafeInteger(ping.hostPid) ||
      ping.hostPid <= 0 ||
      !sameNativeTerminalSocket(
        identity,
        await inspectPrivateNativeTerminalSocket(socketPath),
      )
    ) {
      throw new Error("native host handshake invalid");
    }
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}

async function collectDefaultNativeInventory(): Promise<NativeInventory> {
  return collectNativeInventory(knownNativeTerminalSocketPaths(), connectReadOnlyHost);
}

function resolveLayoutFromConfig(config: RemoteCliConfig | undefined): LayoutConfig {
  const raw = config?.layout ?? {};
  return {
    maxAgeHours:
      typeof raw.maxAgeHours === "number" && Number.isFinite(raw.maxAgeHours)
        ? raw.maxAgeHours
        : DEFAULT_LAYOUT.maxAgeHours,
    maxPerWindow:
      typeof raw.maxPerWindow === "number"
        ? raw.maxPerWindow
        : DEFAULT_LAYOUT.maxPerWindow,
    sharedWindows:
      typeof raw.sharedWindows === "number"
        ? raw.sharedWindows
        : DEFAULT_LAYOUT.sharedWindows,
    multiSession:
      raw.multiSession && typeof raw.multiSession === "object"
        ? raw.multiSession
        : DEFAULT_LAYOUT.multiSession,
    multiSessionDefault:
      typeof raw.multiSessionDefault === "number"
        ? raw.multiSessionDefault
        : DEFAULT_LAYOUT.multiSessionDefault,
    groups: Array.isArray(raw.groups) ? raw.groups : DEFAULT_LAYOUT.groups,
  };
}

export type RightPanelDraftDoubles = Readonly<{
  compatGuardForSession?: (sessionId: string) => boolean;
  draftCapabilityForSession?: (sessionId: string) => RightPanelDraftCapabilityState;
  draftRecoveryForSession?: (sessionId: string) => RightPanelDraftRecoveryState;
}>;

export type BuildLiveRightPanelSnapshotOptions = Readonly<{
  currentSessionId: string;
  home?: string;
  config?: RemoteCliConfig;
  registryPath?: string;
  h2aRoot?: string;
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
  seenDecisionKeys?: ReadonlySet<string>;
  collectNative?: () => Promise<NativeInventory>;
  listTmux?: () => Promise<HostViewSnapshot["tmux"]>;
  trackCache?: TrackJournalCache;
  trackSources?: readonly TrackProjectSource[];
  draftDoubles?: RightPanelDraftDoubles;
}>;

function extractOwnerGateSession(title: string): string | undefined {
  const match = /\((?:session\s+)?([A-Za-z0-9_.:-]+)\)/i.exec(title);
  return match?.[1];
}

/**
 * Build the live right-panel snapshot in-process without calling `restore()` or
 * `spawnSync`. Never throws out of attach: unreadable sources degrade cleanly.
 */
export async function buildLiveRightPanelSnapshot(
  opts: BuildLiveRightPanelSnapshotOptions,
): Promise<RightPanelSnapshot> {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const nowMs = opts.nowMs ?? Date.now();
  let degraded = false;

  let config: RemoteCliConfig | undefined = opts.config;
  if (config === undefined) {
    try {
      config = readRemoteConfig();
    } catch {
      config = undefined;
      degraded = true;
    }
  }
  const layoutCfg = resolveLayoutFromConfig(config);

  const registryRead = loadRegistry(opts.registryPath);
  if (registryRead.state === "unknown") {
    degraded = true;
  }
  const registryEntries = registryRead.state === "ok" ? registryRead.entries : [];
  const registryUnreadable = registryRead.state === "ok" ? registryRead.unreadable : [];

  let nativeInventory: NativeInventory;
  try {
    nativeInventory = await (opts.collectNative ?? collectDefaultNativeInventory)();
  } catch {
    nativeInventory = { complete: false, sessions: [], hosts: [] };
    degraded = true;
  }

  let tmuxView: HostViewSnapshot["tmux"] = { known: true, sessions: [] };
  if (opts.listTmux) {
    try {
      tmuxView = await opts.listTmux();
    } catch {
      tmuxView = { known: false, reason: "tmux read failed" };
      degraded = true;
    }
  }

  try {
    if (!nativeInventory.complete) degraded = true;

    const hostView: HostViewSnapshot = {
      tmux: tmuxView,
      native: {
        known: true,
        complete: nativeInventory.complete,
        sessions: nativeInventory.sessions
          .filter((s) => s.status === "running")
          .map((s) => ({
            name: s.id,
            controlled: s.controlled,
            socketPath: s.socketPath,
          })),
      },
    };
    const liveView = managedLiveLookupFromSnapshot(hostView);
    const evidence: LegacySessionEvidence = {
      home,
      liveTmuxSessions: tmuxView.known ? tmuxView.sessions : [],
    };
    const resolution = reconcileRunConvIds(
      registryEntries,
      (cwd, convId) => readConversationCustomTitle(home, cwd, convId),
      evidence,
    );
    const discovered = registrySessions(
      home,
      registryEntries,
      resolution,
      evidence,
      liveView,
      registryUnreadable,
    ).filter(isRestorableDiscoveredSession);

    const h2aRoot = opts.h2aRoot ?? env.H2A_ROOT;
    const presence = readPresenceWorkRecords(h2aRoot, nowMs, env);
    if (presence.degraded) degraded = true;

    // Map session id -> presence work records (for status derivation & §7.3 actor matching).
    const presenceBySession = new Map<string, PresenceWorkRecord[]>();
    for (const rec of presence.records) {
      for (const sid of [rec.nativeSession, rec.tmuxSession]) {
        if (!sid) continue;
        const list = presenceBySession.get(sid) ?? [];
        list.push(rec);
        presenceBySession.set(sid, list);
      }
    }

    // Filter discovered human sessions down to positively LIVE sessions using
    // `resolveNativeOwner` (`nt/fleet.ts`) for native sessions.
    type LiveCandidate = {
      id: string;
      label: string;
      project: string;
      cwd: string;
      tool: string;
      mtimeMs: number;
      ambiguous: boolean;
      displayedHere: boolean;
      controlledElsewhere: boolean;
      workStatus?: string;
      instances: string[];
    };

    const liveCandidates: LiveCandidate[] = [];
    const seenSessionIds = new Set<string>();

    const pushCandidate = (
      session: DiscoveredSession,
      id: string,
      ambiguous: boolean,
      controlled: boolean,
    ): void => {
      if (seenSessionIds.has(id)) return;
      seenSessionIds.add(id);
      const recs = presenceBySession.get(id) ?? [];
      const workStatus = recs.find((r) => r.workStatus)?.workStatus;
      liveCandidates.push({
        id,
        label: session.label ?? session.project,
        project: session.project,
        cwd: session.cwd,
        tool: session.tool,
        mtimeMs: session.mtimeMs,
        ambiguous,
        displayedHere: id === opts.currentSessionId,
        controlledElsewhere: controlled && id !== opts.currentSessionId,
        ...(workStatus ? { workStatus } : {}),
        instances: recs.map((r) => r.instance),
      });
    };

    for (const session of discovered) {
      if (session.hostAmbiguous) {
        const id = session.managedName ?? session.registryId ?? session.sid;
        pushCandidate(session, id, true, false);
        continue;
      }
      if (session.hostKind === "local-native" && session.managedName) {
        const owner = resolveNativeOwner(session.managedName, nativeInventory);
        if (owner.state === "found" && owner.session.status === "running") {
          pushCandidate(
            session,
            session.managedName,
            false,
            owner.session.controlled === true,
          );
        } else if (owner.state === "ambiguous-owner") {
          pushCandidate(session, session.managedName, true, false);
        } else if (owner.state === "unknown") {
          degraded = true;
        }
        continue;
      }
      if (session.hostKind === "local-tmux" && session.managedName) {
        if (
          tmuxView.known &&
          tmuxView.sessions.some((s) => s.name === session.managedName)
        ) {
          pushCandidate(session, session.managedName, false, false);
        }
      }
    }

    // Resolve Track journals of record for projects represented in live sessions
    // (or explicit `opts.trackSources`), deduplicated by `trackDir`.
    const trackSources: TrackProjectSource[] = (() => {
      if (opts.trackSources !== undefined) return [...opts.trackSources];
      const byTrackDir = new Map<string, TrackProjectSource>();
      for (const c of liveCandidates) {
        const resolved = resolveJournalOfRecord(
          c.project,
          c.cwd,
          config?.rightPanel?.trackDirs,
        );
        if (!existsSync(resolved.eventsPath)) continue;
        if (!byTrackDir.has(resolved.trackDir)) {
          byTrackDir.set(resolved.trackDir, {
            project: c.project,
            trackDir: resolved.trackDir,
            repoRoot: resolved.repoRoot,
          });
        }
      }
      return [...byTrackDir.values()];
    })();

    const trackCache =
      opts.trackCache ?? new TrackJournalCache({ env });
    const trackResults = await Promise.all(
      trackSources.map((src) => trackCache.readDecisions(src)),
    );

    const allAttributions: TrackDecisionWithAttribution[] = [];
    for (const res of trackResults) {
      if (res.degraded) degraded = true;
      allAttributions.push(...res.attributions);
    }

    // Resolve decision -> live session per `PANEL §7.3` tiers (b)/(c) without guessing.
    const ownerGateSessions = new Set<string>();
    const pendingDecisionSessions = new Set<string>();
    const decisions: RightPanelDecision[] = [];

    for (const attr of allAttributions) {
      let resolvedSessionId = attr.decision.sessionId;

      if (!resolvedSessionId && attr.decision.isOwnerGate) {
        const named = extractOwnerGateSession(attr.decision.title);
        if (named) {
          const matches = liveCandidates.filter(
            (c) => c.id === named || c.label === named || c.instances.includes(named),
          );
          if (matches.length === 1) resolvedSessionId = matches[0]!.id;
        }
      }

      // Tier (b): exact unique live session matching decision accountable or target item RACI.
      if (!resolvedSessionId && attr.actorIds.length > 0) {
        const actorSet = new Set(attr.actorIds);
        const matches = liveCandidates.filter(
          (c) =>
            actorSet.has(c.id) ||
            c.instances.some((inst) => actorSet.has(inst)),
        );
        if (matches.length === 1) {
          resolvedSessionId = matches[0]!.id;
        }
      }

      // Tier (c): exact unique live session in the decision's workspace.
      if (!resolvedSessionId && attr.workspace) {
        const matches = liveCandidates.filter((c) => c.project === attr.workspace);
        if (matches.length === 1) {
          resolvedSessionId = matches[0]!.id;
        }
      }

      const finalDecision: RightPanelDecision = resolvedSessionId
        ? { ...attr.decision, sessionId: resolvedSessionId }
        : attr.decision;
      decisions.push(finalDecision);

      if (resolvedSessionId && finalDecision.outcome !== "deferred") {
        if (finalDecision.isOwnerGate) {
          ownerGateSessions.add(resolvedSessionId);
        } else {
          pendingDecisionSessions.add(resolvedSessionId);
        }
      }
    }

    // Derive per-session status (`PANEL §4.2` first-match-wins) & Step 5 fields.
    const liveSessions: PanelLiveSession[] = liveCandidates.map((c) => {
      let status: RightPanelSessionStatus;
      if (c.ambiguous) {
        status = "unknown";
      } else if (ownerGateSessions.has(c.id)) {
        status = "question";
      } else if (pendingDecisionSessions.has(c.id)) {
        status = "decision";
      } else if (c.workStatus === "blocked" || c.workStatus === "out-of-tokens") {
        status = "blocked";
      } else if (c.workStatus === "paused") {
        status = "paused";
      } else if (c.workStatus === "working") {
        status = "running";
      } else if (presence.degraded) {
        status = "unknown";
      } else {
        status = "idle";
      }

      return {
        id: c.id,
        label: c.label,
        project: c.project,
        cwd: c.cwd,
        tool: c.tool,
        mtimeMs: c.mtimeMs,
        status,
        displayedHere: c.displayedHere,
        controlledElsewhere: c.controlledElsewhere,
        compatGuard: opts.draftDoubles?.compatGuardForSession?.(c.id) ?? false,
        draftCapability:
          opts.draftDoubles?.draftCapabilityForSession?.(c.id) ??
          "refused-no-capability",
        draftRecovery: opts.draftDoubles?.draftRecoveryForSession?.(c.id) ?? "none",
      };
    });

    const groups = groupPanelSessions(liveSessions, layoutCfg);
    return buildRightPanelSnapshot({
      currentSessionId: opts.currentSessionId,
      groups,
      decisions,
      ...(opts.seenDecisionKeys ? { seenDecisionKeys: opts.seenDecisionKeys } : {}),
      degraded,
    });
  } finally {
    // Always close any native host sockets opened for this snapshot read.
    for (const host of nativeInventory.hosts) {
      host.client?.close();
    }
  }
}

/**
 * Non-blocking ≤ 1 Hz snapshot refresher for `runAttach`:
 * - Rendering and keyboard input NEVER await subprocesses.
 * - Tracks in-memory seen pending decisions when the owner opens the panel.
 * - Serializes/coalesces concurrent refresh calls and discards completions
 *   after `dispose()`.
 */
export class RightPanelSnapshotRefresher {
  readonly #currentSessionId: string | undefined;
  readonly #load: (seenDecisionKeys: ReadonlySet<string>) => Promise<RightPanelSnapshot>;
  readonly #now: () => number;
  readonly #minIntervalMs: number;
  readonly #onUpdate: ((snapshot: RightPanelSnapshot) => void) | undefined;
  readonly #seenDecisionKeys = new Set<string>();
  #snapshot: RightPanelSnapshot;
  #lastRefreshAt: number | undefined;
  #inFlight: Promise<RightPanelSnapshot> | undefined;
  #disposed = false;
  #generation = 0;

  constructor(opts: {
    currentSessionId?: string;
    load: (seenDecisionKeys: ReadonlySet<string>) => Promise<RightPanelSnapshot>;
    initialSnapshot: RightPanelSnapshot;
    now: () => number;
    minIntervalMs?: number;
    onUpdate?: (snapshot: RightPanelSnapshot) => void;
  }) {
    this.#currentSessionId = opts.currentSessionId;
    this.#load = opts.load;
    this.#snapshot = opts.initialSnapshot;
    this.#now = opts.now;
    this.#minIntervalMs = opts.minIntervalMs ?? 1_000;
    this.#onUpdate = opts.onUpdate;
  }

  getSnapshot(): RightPanelSnapshot {
    return this.#snapshot;
  }

  /** Record all currently-known pending decisions as seen when the panel opens. */
  markCurrentDecisionsSeen(): RightPanelSnapshot {
    for (const d of this.#snapshot.decisions) {
      if (d.outcome !== "deferred") {
        this.#seenDecisionKeys.add(decisionSeenKey(d));
      }
    }
    this.#snapshot = buildRightPanelSnapshot({
      ...(this.#currentSessionId ? { currentSessionId: this.#currentSessionId } : {}),
      groups: this.#snapshot.workspaces,
      decisions: this.#snapshot.decisions,
      seenDecisionKeys: this.#seenDecisionKeys,
      degraded: this.#snapshot.degraded,
    });
    return this.#snapshot;
  }

  maybeRefresh(force = false): Promise<RightPanelSnapshot> | undefined {
    if (this.#disposed) return undefined;
    const nowMs = this.#now();
    if (
      !force &&
      this.#lastRefreshAt !== undefined &&
      nowMs - this.#lastRefreshAt < this.#minIntervalMs
    ) {
      return undefined;
    }
    if (this.#inFlight) return this.#inFlight;
    this.#lastRefreshAt = nowMs;
    const gen = ++this.#generation;
    const work = this.#load(new Set(this.#seenDecisionKeys))
      .then((next) => {
        if (this.#disposed || gen !== this.#generation) return this.#snapshot;
        this.#snapshot = next;
        this.#onUpdate?.(next);
        return next;
      })
      .catch(() => this.#snapshot)
      .finally(() => {
        if (this.#inFlight === work) this.#inFlight = undefined;
      });
    this.#inFlight = work;
    return work;
  }

  dispose(): void {
    this.#disposed = true;
    this.#generation += 1;
  }
}
