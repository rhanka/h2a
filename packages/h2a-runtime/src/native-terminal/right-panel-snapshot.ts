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
import { loadRegistry, type RawRow, type RegistryEntry } from "../registry.js";
import {
  discoverSessions,
  isRestorableDiscoveredSession,
  managedLiveLookupFromSnapshot,
  readConversationCustomTitle,
  reconcileRunConvIds,
  registrySessions,
  type DiscoveredSession,
  type LegacySessionEvidence,
} from "../restore.js";
import {
  buildRestorePlan,
  decideLayoutTab,
  planLayoutLaunch,
  resumeArgvVerified,
  tabRunInvocation,
  type LayoutTab,
  type RestorePlanResult,
  type TabLaunchDecision,
} from "../restore-plan.js";
import {
  projectDelegatedExecutions,
  readMcpAttestationsFromStore,
} from "../status-projection.js";
import { localSessionAgentPanePid } from "../tmux.js";
import { NativeTerminalClient } from "./client.js";
import {
  collectNativeInventory,
  resolveNativeOwner,
  type NativeInventory,
  type NativeInventoryClient,
} from "./fleet.js";
import { NATIVE_TERMINAL_PROTOCOL_VERSION } from "./protocol.js";
import {
  buildRightPanelSnapshot,
  classifyDossierRef,
  decisionSeenKey,
  decisionsFromTrackDecisions,
  type RightPanelDecision,
  type RightPanelDelegatedChild,
  type RightPanelDossierLinkClass,
  type RightPanelDraftCapabilityState,
  type RightPanelDraftRecoveryState,
  type RightPanelProjectDecisionsDegraded,
  type RightPanelRestorableRow,
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
        project: source.project,
        journalOfRecord: source.trackDir,
        source: base.isOwnerGate ? "owner-gate" : "track",
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
  /** S2: the registry `convId` equals the plan-resolved `sid`. */
  resumeConversationVerified?: boolean | undefined;
  compatGuard: boolean;
  draftCapability: RightPanelDraftCapabilityState;
  draftRecovery: RightPanelDraftRecoveryState;
  delegatedNames?: readonly string[];
  delegatedChildren?: readonly RightPanelDelegatedChild[];
  delegatedDegraded?: boolean;
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
    mtimeMs: s.mtimeMs,
    ...(s.resumeConversationVerified !== undefined
      ? { resumeConversationVerified: s.resumeConversationVerified }
      : {}),
    ...(s.delegatedNames !== undefined ? { delegatedNames: s.delegatedNames } : {}),
    ...(s.delegatedChildren !== undefined ? { delegatedChildren: s.delegatedChildren } : {}),
    ...(s.delegatedDegraded !== undefined ? { delegatedDegraded: s.delegatedDegraded } : {}),
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

/**
 * S2 transcript-scan cache (plan 09-S2): the `discoverSessions` transcript
 * scan serves the single « restaurable » expander, at most once per 60 s of
 * injected clock. The station provides it; `h2a attach` does not, and its
 * panel stays unchanged (S1.9).
 */
export class TranscriptScanCache {
  #lastAtMs: number | undefined;
  #lastScanned: DiscoveredSession[] = [];

  read(
    nowMs: number,
    maxAgeMs: number,
    home: string,
    reader: (maxAgeMs: number, home: string) => DiscoveredSession[],
  ): DiscoveredSession[] {
    if (this.#lastAtMs !== undefined && nowMs - this.#lastAtMs < 60_000) {
      return this.#lastScanned;
    }
    this.#lastAtMs = nowMs;
    this.#lastScanned = reader(maxAgeMs, home);
    return this.#lastScanned;
  }
}

export type BuildLiveRightPanelSnapshotOptions = Readonly<{
  currentSessionId: string;
  home?: string;
  config?: RemoteCliConfig;
  registryPath?: string;
  h2aRoot?: string;
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
  seenDecisionKeys?: ReadonlySet<string>;
  collectNative?: () => Promise<NativeInventory<NativeInventoryClient>>;
  listTmux?: () => Promise<HostViewSnapshot["tmux"]>;
  trackCache?: TrackJournalCache;
  trackSources?: readonly TrackProjectSource[];
  draftDoubles?: RightPanelDraftDoubles;
  /** S2: when present, the loader computes the station restore plan. */
  scanCache?: TranscriptScanCache;
  /** S2: transcript-scan reader (the station default is `discoverSessions`). */
  scanReader?: (maxAgeMs: number, home: string) => DiscoveredSession[];
  /** S2: gateway posture passed to the station plan decisions. */
  forceGateway?: "gateway" | "direct";
}>;

function extractOwnerGateSession(title: string): string | undefined {
  const match = /\((?:session\s+)?([A-Za-z0-9_.:-]+)\)/i.exec(title);
  return match?.[1];
}

const OWNER_INBOX_DIR_RE = /^(?:owner|human(?:__.*)?|principal)$/i;
const OWNER_INSTANCE_RE = /^(?:owner|human(?::.*)?|principal)$/i;

function sanitizeSingleLine(raw: string, maxChars = 160): string {
  const cleaned = raw
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const scalars = Array.from(cleaned);
  return scalars.length > maxChars
    ? `${scalars.slice(0, maxChars - 1).join("")}…`
    : cleaned;
}

function extractH2aQuestionText(body: Record<string, unknown>): string {
  const payload = body.payload;
  if (typeof payload === "string" && payload.trim()) return sanitizeSingleLine(payload);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const p = payload as { question?: unknown; text?: unknown; title?: unknown };
    if (typeof p.question === "string" && p.question.trim()) return sanitizeSingleLine(p.question);
    if (typeof p.text === "string" && p.text.trim()) return sanitizeSingleLine(p.text);
    if (typeof p.title === "string" && p.title.trim()) return sanitizeSingleLine(p.title);
  }
  if (typeof body.question === "string" && body.question.trim()) {
    return sanitizeSingleLine(body.question);
  }
  if (typeof body.text === "string" && body.text.trim()) {
    return sanitizeSingleLine(body.text);
  }
  if (typeof body.title === "string" && body.title.trim()) {
    return sanitizeSingleLine(body.title);
  }
  return "(h2a question)";
}

/**
 * Read-only scan of `<h2aRoot>/inbox/` for h2a-message question sources
 * (`PANEL §4.3`, `PANEL:451`, `14-L1.md` Étape 3):
 * - Admits `escalate` envelopes and owner-addressed `question` envelopes.
 * - Zero writes, bounded 64 KiB reads, deduplicated by envelope id.
 * - Matches `actor.instance` to a unique live session without guessing.
 */
function readH2aMessageQuestions(
  h2aRoot: string | undefined,
  liveCandidates: readonly {
    readonly id: string;
    readonly project: string;
    readonly instances: readonly string[];
  }[],
): { questions: RightPanelDecision[]; degraded: boolean } {
  if (!h2aRoot || !existsSync(h2aRoot)) {
    return { questions: [], degraded: false };
  }
  const inboxRoot = join(h2aRoot, "inbox");
  if (!existsSync(inboxRoot)) {
    return { questions: [], degraded: false };
  }
  const seenIds = new Set<string>();
  const questions: RightPanelDecision[] = [];
  let degraded = false;

  try {
    const dirEntries = readdirSync(inboxRoot, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (!entry.isDirectory()) continue;
      const recipientDir = entry.name;
      const dirPath = join(inboxRoot, recipientDir);
      let files: string[];
      try {
        files = readdirSync(dirPath);
      } catch {
        degraded = true;
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const text = readBoundedUtf8(join(dirPath, file));
        if (text === undefined) {
          degraded = true;
          continue;
        }
        try {
          const env = JSON.parse(text) as {
            protocol?: unknown;
            id?: unknown;
            type?: unknown;
            actor?: { instance?: unknown; role?: unknown; scope?: unknown };
            target?: { instance?: unknown; role?: unknown; scope?: unknown };
            body?: unknown;
            createdAt?: unknown;
          };
          if (
            env.protocol !== "sentropic.h2a" ||
            typeof env.id !== "string" ||
            env.id.length === 0 ||
            typeof env.type !== "string" ||
            !env.body ||
            typeof env.body !== "object" ||
            Array.isArray(env.body) ||
            typeof env.createdAt !== "string" ||
            !Number.isFinite(Date.parse(env.createdAt))
          ) {
            degraded = true;
            continue;
          }
          if (seenIds.has(env.id)) continue;

          const body = env.body as Record<string, unknown>;
          const isEscalate = env.type === "escalate";
          const isQuestionBody =
            body.kind === "question" ||
            body.type === "question" ||
            env.type === "question";
          const addressedToOwner =
            OWNER_INBOX_DIR_RE.test(recipientDir) ||
            env.target?.role === "PRINCIPAL" ||
            (typeof env.target?.instance === "string" &&
              OWNER_INSTANCE_RE.test(env.target.instance));

          if (!isEscalate && !(isQuestionBody && addressedToOwner)) {
            continue;
          }

          seenIds.add(env.id);
          const title = extractH2aQuestionText(body);
          const actorInstance =
            typeof env.actor?.instance === "string" ? env.actor.instance : undefined;
          let sessionId: string | undefined;
          let workspace: string | undefined =
            typeof env.actor?.scope === "string" && env.actor.scope.trim()
              ? env.actor.scope.trim()
              : undefined;
          if (actorInstance) {
            const matches = liveCandidates.filter(
              (c) => c.id === actorInstance || c.instances.includes(actorInstance),
            );
            if (matches.length === 1) {
              sessionId = matches[0]!.id;
              workspace = matches[0]!.project;
            }
          }
          questions.push({
            id: env.id,
            title,
            kind: "question",
            outcome: "pending",
            source: "h2a-message",
            createdAt: env.createdAt,
            ...(sessionId ? { sessionId } : {}),
            ...(workspace ? { workspace } : {}),
            revisionKey: `h2a-msg:${env.id}:${env.createdAt}:${title}`,
          });
        } catch {
          degraded = true;
        }
      }
    }
  } catch {
    degraded = true;
  }

  return { questions, degraded };
}

function delegatedLabelOf(entry: RegistryEntry | undefined, fallbackId: string): string {
  const raw = entry?.label ?? entry?.tmuxSession ?? fallbackId;
  return sanitizeSingleLine(raw, 64) || fallbackId;
}

/**
 * S2 classement du plan → ligne (plan 09-S2, table fermée). Every dead
 * session of the plan lands under `restorable` with one reason each; only
 * the launch decisions the station may take carry relaunch tokens.
 */
function stationRestorableFromPlan(args: {
  layoutCfg: LayoutConfig;
  plan: RestorePlanResult;
  hostView: HostViewSnapshot;
  forceGateway?: "gateway" | "direct";
}): Map<string, RightPanelRestorableRow[]> {
  const { layoutCfg, plan, hostView, forceGateway } = args;
  const launchOpts = forceGateway ? { forceGateway } : {};
  const titleOfProject = (project: string | undefined): string => {
    if (project !== undefined) {
      for (const group of layoutCfg.groups) {
        if (group.remote) continue;
        if (group.projects?.includes(project)) return group.title;
      }
    }
    return "other";
  };

  const decisionByTab = new Map<LayoutTab, TabLaunchDecision>();
  for (const window of planLayoutLaunch(plan.windows, hostView, launchOpts).windows) {
    for (const decision of window.decisions) decisionByTab.set(decision.tab, decision);
  }

  const relaunchTokens = (
    tab: LayoutTab,
  ): RightPanelRestorableRow["relaunch"] => {
    const tokens = tabRunInvocation(tab, launchOpts);
    if (!tokens) return undefined;
    return {
      args: [...tokens.args, "--no-attach"],
      env: [...tokens.env],
      cwd: tokens.cwd,
      ...(tab.managedName !== undefined ? { name: tab.managedName } : {}),
    };
  };

  const byTitle = new Map<string, RightPanelRestorableRow[]>();
  const push = (title: string, row: RightPanelRestorableRow): void => {
    const list = byTitle.get(title) ?? [];
    list.push(row);
    byTitle.set(title, list);
  };

  for (const classification of plan.classifications) {
    const key = classification.key;
    const label = classification.label;
    const project = classification.project;
    if (classification.outcome === "selected") {
      if (classification.tab.remoteId !== undefined || classification.tab.attachLive === true) {
        // Remote tabs open outside the station; attach-live tabs are live lines.
        continue;
      }
      const decision = decisionByTab.get(classification.tab);
      if (decision?.kind === "attach" && hostView.tmux.known === false) {
        // Under an unknown tmux view no attach decision names a provable live
        // line (local-tmux tabs and legacy tabs without a recorded host alike):
        // motif, never a gesture. With a known view an attach decision names
        // a live line, never a row.
        push(titleOfProject(classification.project), {
          key, label, project, reason: "unknown-view", state: "ended",
        });
        continue;
      }
      if (decision?.kind !== "launch") {
        if (
          decision?.kind === "refuse" &&
          (decision.reason === "native-host-unknown" || decision.reason === "attach-live-gone")
        ) {
          push(titleOfProject(classification.project), { key, label, project, reason: "unknown-view", state: "ended" });
        } else if (decision?.kind === "refuse" && decision.reason === "ambiguous-owner") {
          push(titleOfProject(classification.project), { key, label, project, reason: "dual-host", state: "ended" });
        } else if (decision?.kind === "refuse" && decision.reason === "ambiguous-slug") {
          // Same family as a dual-host identity: no recorded host can be picked.
          push(titleOfProject(classification.project), { key, label, project, reason: "dual-host", state: "ended" });
        }
        // attach, skip-live and defer decisions are live lines, never rows.
        continue;
      }
      const session = classification.session;
      if (!session?.tool || !resumeArgvVerified(session.tool)) {
        push(titleOfProject(classification.project), {
          key, label, project, reason: "resume-argv-unverified", state: "ended",
        });
        continue;
      }
      const relaunch = relaunchTokens(classification.tab);
      if (!relaunch) {
        // A launch without a resolvable sid: motif, never a guessed identifier.
        push(titleOfProject(classification.project), {
          key, label, project, reason: "unresolved-conversation", state: "ended",
        });
        continue;
      }
      push(titleOfProject(classification.project), {
        key, label, project, reason: "launch", state: "queued", relaunch,
      });
      continue;
    }
    if (
      classification.outcome === "explicit-overflow" ||
      classification.outcome === "shared-overflow"
    ) {
      const title =
        classification.outcome === "explicit-overflow"
          ? classification.groupTitle
          : titleOfProject(classification.project);
      const session = classification.session;
      let relaunch: RightPanelRestorableRow["relaunch"];
      if (
        decideLayoutTab(classification.tab, hostView, launchOpts).kind === "launch" &&
        session?.tool &&
        resumeArgvVerified(session.tool)
      ) {
        relaunch = relaunchTokens(classification.tab) ?? undefined;
      }
      // Beyond the cap the gesture stays, but the launch file takes only
      // `launch` rows: a capped row with tokens waits for its D2 gesture
      // (`deferred`), one without tokens is listed without a gesture (`ended`).
      push(title, {
        key, label, project, reason: "launch-cap",
        state: relaunch !== undefined ? "deferred" : "ended",
        ...(relaunch !== undefined ? { relaunch } : {}),
      });
      continue;
    }
    // Refused rows: the seven of the last table row are never listed.
    const reason = ((): string | undefined => {
      switch (classification.reason) {
        case "unresolved-conversation":
          return "unresolved-conversation";
        case "dual-host-ambiguous":
          return "dual-host";
        case "host-unknown":
          return "unknown-view";
        case "unclassified-scan":
        case "per-project-scan-cap":
          // The plan code is displayed as-is (`nt/station.ts:930`).
          return classification.reason;
        default:
          return undefined;
      }
    })();
    if (reason === undefined) continue;
    push(titleOfProject(classification.project), { key, label, project, reason, state: "ended" });
  }
  return byTitle;
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

  let nativeInventory: NativeInventory<NativeInventoryClient>;
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
          // S2: the facet enters the photo through `applicationForeground`,
          // as in the parent photo (`rt/restore.ts:310`).
          .map((s) => ({
            name: s.id,
            controlled: s.controlled,
            socketPath: s.socketPath,
            ...(typeof s.applicationFacet === "string"
              ? {
                  applicationFacet: s.applicationFacet,
                  applicationIncarnation: s.applicationIncarnation ?? null,
                  foregroundProcessGroup: s.foregroundProcessGroup ?? null,
                  foregroundRevision: s.foregroundRevision ?? 0,
                }
              : {}),
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
      /** S2: the registry `convId` equals the plan-resolved `sid`. */
      resumeConversationVerified: boolean;
      workStatus?: string;
      instances: string[];
    };

    const liveCandidates: LiveCandidate[] = [];
    const seenSessionIds = new Set<string>();
    const convIdByRegistryId = new Map<string, string | undefined>(
      registryEntries.map((entry) => [entry.id, entry.convId]),
    );

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
      // S2 D1 guard: the restart path resumes with the registry `convId`,
      // so the gesture is offered only when it equals the plan-resolved `sid`.
      const registryConvId =
        session.registryId !== undefined
          ? convIdByRegistryId.get(session.registryId)
          : undefined;
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
        resumeConversationVerified:
          registryConvId !== undefined &&
          registryConvId !== "" &&
          session.sid !== "" &&
          registryConvId === session.sid,
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

    // Resolve Track journals of record for EVERY project represented in live sessions
    // (or explicit `opts.trackSources`), deduplicated by `(project, trackDir)`.
    // Missing/unreadable stores are NEVER silently omitted (`PANEL §4.3`, L1.4):
    // they emit a per-project `decisionsDegraded` entry while other stores stay intact.
    const trackSources: TrackProjectSource[] = (() => {
      if (opts.trackSources !== undefined) return [...opts.trackSources];
      const byKey = new Map<string, TrackProjectSource>();
      for (const c of liveCandidates) {
        const resolved = resolveJournalOfRecord(
          c.project,
          c.cwd,
          config?.rightPanel?.trackDirs,
        );
        const key = `${c.project}\u0000${resolved.trackDir}`;
        if (!byKey.has(key)) {
          byKey.set(key, {
            project: c.project,
            trackDir: resolved.trackDir,
            repoRoot: resolved.repoRoot,
          });
        }
      }
      return [...byKey.values()];
    })();

    const trackCache =
      opts.trackCache ?? new TrackJournalCache({ env });
    const trackResults = await Promise.all(
      trackSources.map(async (src) => ({
        source: src,
        result: await trackCache.readDecisions(src),
      })),
    );

    const allAttributions: TrackDecisionWithAttribution[] = [];
    const decisionsDegraded: RightPanelProjectDecisionsDegraded[] = [];
    for (const { source, result } of trackResults) {
      if (result.degraded) {
        degraded = true;
        decisionsDegraded.push({
          project: source.project,
          trackDir: source.trackDir,
          reason: result.reason ?? "unreadable",
        });
      }
      allAttributions.push(...result.attributions);
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

    // h2a-message question sources (`PANEL §4.3`, `PANEL:451`, L1 Étape 3).
    const h2aQuestions = readH2aMessageQuestions(h2aRoot, liveCandidates);
    if (h2aQuestions.degraded) degraded = true;
    for (const q of h2aQuestions.questions) {
      decisions.push(q);
    }

    // F9-provenanced delegated executions per live parent session (`PANEL §4.2`, §4.4, L1.2).
    const mcpAttestations = readMcpAttestationsFromStore(h2aRoot);
    const registryById = new Map<string, RegistryEntry>(
      registryEntries.map((e) => [e.id, e]),
    );
    const nativePidBySession = new Map<string, number>();
    for (const ns of nativeInventory.sessions) {
      if (ns.status === "running" && typeof ns.pid === "number" && ns.pid > 0) {
        nativePidBySession.set(ns.id, ns.pid);
      }
    }
    const resolveNativeWorkerPid = (workerSession: string): number | undefined => {
      const fromHost = nativePidBySession.get(workerSession);
      if (fromHost !== undefined) return fromHost;
      const workerRow = registryEntries.find(
        (e) =>
          e.kind === "local-native" &&
          e.endedAt === undefined &&
          e.tmuxSession === workerSession &&
          e.pid !== undefined &&
          isPidAlive(e.pid),
      );
      return workerRow?.pid;
    };
    const hasActiveDelegationCandidates = registryEntries.some(
      (e) =>
        (e.sessionClass === "background" || e.role === "job") &&
        e.jobState !== "done" &&
        !(
          e.sessionClass === "background" &&
          e.endedAt !== undefined &&
          e.jobState !== "failed"
        ),
    );
    const liveTmuxSessions = tmuxView.known ? tmuxView.sessions : [];
    let unattributedDelegatedDegraded = false;

    // Derive per-session status (`PANEL §4.2` first-match-wins) & Step 5 / L1 fields.
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

      const ownerInstance = c.instances.length === 1 ? c.instances[0] : undefined;
      let delegatedChildren: RightPanelDelegatedChild[] = [];
      let delegatedDegraded = false;
      if (hasActiveDelegationCandidates || !mcpAttestations.known) {
        const projected = projectDelegatedExecutions(
          registryEntries,
          registryRead.state === "ok",
          liveTmuxSessions,
          c.id,
          ownerInstance,
          mcpAttestations.values,
          mcpAttestations.known,
          localSessionAgentPanePid,
          resolveNativeWorkerPid,
        );
        delegatedChildren = projected.executions.map((exec) => ({
          id: exec.id,
          label: delegatedLabelOf(registryById.get(exec.id), exec.id),
          tool: exec.tool,
          state: exec.state,
          origin: exec.origin,
        }));
        delegatedDegraded = projected.degraded;
        if (delegatedDegraded) unattributedDelegatedDegraded = true;
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
        resumeConversationVerified: c.resumeConversationVerified,
        compatGuard: opts.draftDoubles?.compatGuardForSession?.(c.id) ?? false,
        draftCapability:
          opts.draftDoubles?.draftCapabilityForSession?.(c.id) ??
          "refused-no-capability",
        draftRecovery: opts.draftDoubles?.draftRecoveryForSession?.(c.id) ?? "none",
        delegatedNames: delegatedChildren.map((ch) => ch.label),
        delegatedChildren,
        delegatedDegraded,
      };
    });

    // S2: one plan, one photo, in the station process. The scan reader is the
    // transcript scan, cached by the station-provided `scanCache`; without it
    // the snapshot carries no restorable row and the attach panel is unchanged.
    let restorableByTitle = new Map<string, RightPanelRestorableRow[]>();
    let restorablePlanRefused: string | undefined;
    if (opts.scanCache !== undefined) {
      if (registryRead.state === "unknown") {
        restorablePlanRefused = registryRead.reason;
      } else {
        const maxAgeMs = layoutCfg.maxAgeHours * 3600 * 1000;
        const scanned = opts.scanCache.read(
          nowMs,
          maxAgeMs,
          home,
          opts.scanReader ?? discoverSessions,
        );
        const plan = buildRestorePlan(
          {
            home,
            config: layoutCfg,
            registryRead: {
              state: "ok",
              entries: registryEntries,
              unreadable: registryUnreadable,
            },
            scanned,
            hostView,
            evidence,
            customTitleFor: (cwd, convId) =>
              readConversationCustomTitle(home, cwd, convId),
            remoteTabs: [],
          },
          {},
        );
        if (!plan.ok) {
          restorablePlanRefused = plan.refusalDetail ?? "unknown";
        } else {
          restorableByTitle = stationRestorableFromPlan({
            layoutCfg,
            plan,
            hostView,
            ...(opts.forceGateway !== undefined
              ? { forceGateway: opts.forceGateway }
              : {}),
          });
        }
      }
    }

    const groups = groupPanelSessions(liveSessions, layoutCfg);
    if (restorableByTitle.size > 0) {
      // A tab exists only when it carries a live line or a restorable row:
      // attach the station plan rows, keep config order, deduplicate titles,
      // drop config groups with neither, and sort `other` last.
      const byTitle = new Map(groups.map((workspace) => [workspace.title, workspace]));
      const liveTitles = new Set(byTitle.keys());
      const configTitles = layoutCfg.groups
        .filter((group) => !group.remote)
        .map((group) => group.title);
      const orderedTitles = [
        ...configTitles.filter((title) => liveTitles.has(title) || restorableByTitle.has(title)),
        ...[...restorableByTitle.keys()]
          .filter((title) => !liveTitles.has(title) && !configTitles.includes(title))
          .sort((a, b) =>
            a === "other" ? 1 : b === "other" ? -1 : a.localeCompare(b, "en"),
          ),
      ];
      const merged: RightPanelWorkspace[] = [];
      for (const title of orderedTitles) {
        const workspace = byTitle.get(title) ?? { title, sessions: [] };
        const restorable = restorableByTitle.get(title);
        merged.push(
          restorable !== undefined ? { ...workspace, restorable } : workspace,
        );
        byTitle.delete(title);
      }
      for (const workspace of byTitle.values()) {
        const restorable = restorableByTitle.get(workspace.title);
        merged.push(
          restorable !== undefined ? { ...workspace, restorable } : workspace,
        );
      }
      groups.length = 0;
      groups.push(...merged);
    }
    return buildRightPanelSnapshot({
      currentSessionId: opts.currentSessionId,
      groups,
      decisions,
      ...(decisionsDegraded.length > 0 ? { decisionsDegraded } : {}),
      ...(unattributedDelegatedDegraded ? { unattributedDelegatedDegraded: true } : {}),
      ...(restorablePlanRefused !== undefined ? { restorablePlanRefused } : {}),
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
  readonly #currentSessionId: string | (() => string | undefined) | undefined;
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
    /** A function follows the displayed session of a station across switches. */
    currentSessionId?: string | (() => string | undefined);
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
    const currentSessionId =
      typeof this.#currentSessionId === "function"
        ? this.#currentSessionId()
        : this.#currentSessionId;
    this.#snapshot = buildRightPanelSnapshot({
      ...(currentSessionId ? { currentSessionId } : {}),
      groups: this.#snapshot.workspaces,
      decisions: this.#snapshot.decisions,
      ...(this.#snapshot.decisionsDegraded
        ? { decisionsDegraded: this.#snapshot.decisionsDegraded }
        : {}),
      ...(this.#snapshot.unattributedDelegatedDegraded
        ? { unattributedDelegatedDegraded: true }
        : {}),
      // S2: the station plan refusal survives a seen-marking rebuild.
      ...(this.#snapshot.restorablePlanRefused !== undefined
        ? { restorablePlanRefused: this.#snapshot.restorablePlanRefused }
        : {}),
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
