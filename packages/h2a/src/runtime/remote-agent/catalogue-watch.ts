/**
 * Watched catalogue projector and local open/share gate (LH-06).
 *
 * Joins asynchronous native terminal host inventory with local presence files
 * (excluding internal `*.h2a` MCP companion PTYs and mirrored presences),
 * applies the mirror allowlist + display scalar filter, enforces account-level
 * exclusions, bounds snapshots to <= 512 rows / <= 512 B/row / <= 256 KiB,
 * coalesces deltas in a fixed 250 ms window, polls every 2 s without overlap,
 * schedules exact 15 000 ms presence expiry timers between polls, and gates
 * `resolveOpen` and `withShareAllowed` for LH-08.
 */

import type { H2ASession } from "../../session.js";
import { listPresenceWithDiagnostics } from "../local-files/presence.js";
import { classifyLaunchHost } from "./fleet-inventory.js";
import type { CatalogueInstanceStatus, CatalogueSessionRow } from "./types.js";
import {
  isCanonicalCatalogueSid,
  isInternalCompanionNativeId,
  nativeCatalogueSid,
  presenceCatalogueSid,
  projectBoundedCatalogue,
  projectJoinedCatalogueRow
} from "./catalogue.js";
import { wireInstanceId } from "./wire-ids.js";
import { planCatalogueUpdate, type CatalogueProjection } from "./catalogue-plan.js";
import {
  isSidExcluded,
  linkExclusionAlias,
  readExclusions,
  withExclusionShareAllowed,
  writeCatalogueIdsIndex,
  type ShareAllowedResult
} from "./exclusions.js";

export const CATALOGUE_DEFAULT_POLL_INTERVAL_MS = 2_000 as const;
export const CATALOGUE_DEFAULT_COALESCE_WINDOW_MS = 250 as const;
export const CATALOGUE_DEFAULT_PRESENCE_FRESHNESS_MS = 15_000 as const;

export interface RemoteNativeSessionSnapshot {
  readonly id: string;
  readonly generation: string;
  readonly incarnation: string;
  readonly pid?: number;
  readonly status: "running" | "stopping" | "exited";
  readonly socketPath: string;
  readonly exit?: { readonly exitCode: number; readonly signal?: number } | null;
  readonly cols?: number;
  readonly rows?: number;
  readonly controlled?: boolean;
  readonly holderKind?: "none" | "human" | "automation" | "remote";
}

export interface RemoteNativeInventory {
  readonly complete: boolean;
  readonly sessions: readonly RemoteNativeSessionSnapshot[];
}

export type RemoteNativeInventoryReader = (options: {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly signal?: AbortSignal;
}) => Promise<RemoteNativeInventory>;

export interface CatalogueTimerHandle {
  unref?: () => void;
}

export interface CatalogueClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): CatalogueTimerHandle;
  clearTimeout(handle: CatalogueTimerHandle): void;
}

export interface CatalogueAuditEvent {
  readonly kind: "catalogue-truncated";
  readonly truncatedRows: number;
  readonly at: number;
}

export type CatalogueUnavailableReason = "exit" | "excluded";

export interface CatalogueUnavailableEvent {
  readonly sid: string;
  readonly reason: CatalogueUnavailableReason;
  readonly generation?: string;
  readonly incarnation?: string;
  readonly exit?: { readonly exitCode: number; readonly signal?: number } | null;
}

export type CatalogueEmitMessage = CatalogueProjection;

export interface ResolvedOpenTarget {
  readonly ok: true;
  readonly sid: string;
  readonly nativeId: string;
  readonly socketPath: string;
  readonly generation: string;
  readonly incarnation: string;
}

export interface RefusedOpenTarget {
  readonly ok: false;
  readonly sid: string;
  readonly reason: "unknown-session" | "excluded" | "not-operable" | "exclusion-state-unavailable";
}

export type ResolveOpenResult = ResolvedOpenTarget | RefusedOpenTarget;

export interface CatalogueProjectorOptions {
  readonly root: string;
  readonly configDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly readNativeInventory?: RemoteNativeInventoryReader;
  readonly readPresences?: (root: string) => readonly H2ASession[];
  readonly clock?: CatalogueClock;
  readonly pollIntervalMs?: number;
  readonly coalesceWindowMs?: number;
  readonly presenceFreshnessMs?: number;
  readonly onAudit?: (event: CatalogueAuditEvent) => void;
  readonly ch?: number;
}

export interface CatalogueProjector {
  startWatch(emit: (message: CatalogueEmitMessage) => void): void;
  stopWatch(): void;
  applyRevokedInstances(ids: Iterable<string>): void;
  setInstanceStatus(instanceId: string, status: CatalogueInstanceStatus): void;
  resolveOpen(sid: string): Promise<ResolveOpenResult>;
  withShareAllowed(sid: string, enqueue: () => void): ShareAllowedResult;
  onUnavailable(callback: (event: CatalogueUnavailableEvent) => void): () => void;
  getProjection(): CatalogueProjection | null;
}

const DEFAULT_CLOCK: CatalogueClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimeout: (handle) => {
    clearTimeout(handle as NodeJS.Timeout);
  }
};

/**
 * Lazy runtime import via a `string`-typed specifier so `@sentropic/h2a`
 * preserves its leaf-package contract (checked by `check-public-contract.sh`).
 */
export async function defaultListNativeInventoryForRemote(options: {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly signal?: AbortSignal;
}): Promise<RemoteNativeInventory> {
  const packageName: string = "@sentropic/h2a-runtime";
  const runtime = (await import(packageName)) as {
    listNativeInventoryForRemote?: RemoteNativeInventoryReader;
  };
  if (typeof runtime.listNativeInventoryForRemote !== "function") {
    throw new Error("runtime native inventory reader is unavailable");
  }
  return runtime.listNativeInventoryForRemote(options);
}

function defaultReadPresences(root: string): readonly H2ASession[] {
  return listPresenceWithDiagnostics(root, { includeExpired: true, sweep: false }).sessions;
}

interface EvaluatedPresence {
  readonly session: H2ASession;
  readonly beatMs: number;
  readonly validBeat: boolean;
  readonly fresh: boolean;
}

function evaluatePresence(
  session: H2ASession,
  now: number,
  freshnessMs: number
): EvaluatedPresence {
  const beatMs = Date.parse(session.heartbeatAt);
  const validBeat = Number.isFinite(beatMs) && beatMs <= now;
  const notClosed = session.state !== "closed" && session.state !== "expired";
  const fresh = validBeat && notClosed && now - beatMs < freshnessMs;
  return { session, beatMs, validBeat, fresh };
}

function compareEvaluatedPresence(a: EvaluatedPresence, b: EvaluatedPresence): number {
  if (a.fresh !== b.fresh) return a.fresh ? -1 : 1;
  if (a.validBeat !== b.validBeat) return a.validBeat ? -1 : 1;
  if (a.validBeat && b.validBeat && a.beatMs !== b.beatMs) {
    return b.beatMs - a.beatMs;
  }
  return a.session.sessionId < b.session.sessionId
    ? -1
    : a.session.sessionId > b.session.sessionId
      ? 1
      : 0;
}

interface PrivateTargetEntry {
  readonly nativeId: string;
  readonly socketPath: string;
  readonly generation: string;
  readonly incarnation: string;
  readonly status: "running" | "stopping" | "exited";
  readonly ambiguous: boolean;
}

interface LiveNativeRecord {
  readonly generation: string;
  readonly incarnation: string;
  readonly socketPath: string;
  readonly status: "running" | "stopping";
}

export function createCatalogueProjector(
  options: CatalogueProjectorOptions
): CatalogueProjector {
  const root = options.root;
  const configDir = options.configDir;
  const env = options.env;
  const readNativeInventory = options.readNativeInventory ?? defaultListNativeInventoryForRemote;
  const readPresences = options.readPresences ?? defaultReadPresences;
  const clock = options.clock ?? DEFAULT_CLOCK;
  const pollIntervalMs = options.pollIntervalMs ?? CATALOGUE_DEFAULT_POLL_INTERVAL_MS;
  const coalesceWindowMs = options.coalesceWindowMs ?? CATALOGUE_DEFAULT_COALESCE_WINDOW_MS;
  const presenceFreshnessMs = options.presenceFreshnessMs ?? CATALOGUE_DEFAULT_PRESENCE_FRESHNESS_MS;
  const onAudit = options.onAudit;
  const ch = options.ch ?? 1;

  let watching = false;
  let watchCycleId = 0;
  let emitFn: ((message: CatalogueEmitMessage) => void) | null = null;
  let activeAbort: AbortController | null = null;
  let pollTimer: CatalogueTimerHandle | null = null;
  let expiryTimer: CatalogueTimerHandle | null = null;
  let coalesceTimer: CatalogueTimerHandle | null = null;
  let pollInFlight = false;

  const revokedInstances = new Set<string>();
  const unavailableListeners = new Set<(event: CatalogueUnavailableEvent) => void>();

  let lastNativeInventory: RemoteNativeInventory = { complete: false, sessions: [] };
  const knownLiveNatives = new Map<string, LiveNativeRecord>();
  const notifiedExitIncarnations = new Set<string>();
  const exitedTombstones = new Map<string, { readonly generation: string; readonly incarnation: string }>();
  const knownExcludedSids = new Set<string>();
  const privateIndex = new Map<string, PrivateTargetEntry>();
  const knownNonNativeSids = new Set<string>();
  const sidAliases = new Map<string, readonly string[]>();

  let lastPublishedProjection: CatalogueProjection | null = null;
  let lastAuditedTruncatedRows = 0;
  let latestProjection: CatalogueProjection | null = null;

  function emitUnavailable(event: CatalogueUnavailableEvent): void {
    for (const listener of [...unavailableListeners]) {
      listener(event);
    }
  }

  function emitExitOnce(
    nativeId: string,
    generation: string,
    incarnation: string,
    exit?: { readonly exitCode: number; readonly signal?: number } | null
  ): void {
    const key = `${nativeId}\0${generation}\0${incarnation}`;
    if (notifiedExitIncarnations.has(key)) return;
    notifiedExitIncarnations.add(key);
    emitUnavailable({
      sid: nativeCatalogueSid(nativeId),
      reason: "exit",
      generation,
      incarnation,
      ...(exit !== undefined ? { exit } : {})
    });
  }

  function clearTimer(handle: CatalogueTimerHandle | null): null {
    if (handle !== null) clock.clearTimeout(handle);
    return null;
  }

  function emitTruncationAuditIfChanged(projection: CatalogueProjection, at: number): void {
    if (projection.truncatedRows !== lastAuditedTruncatedRows) {
      lastAuditedTruncatedRows = projection.truncatedRows;
      onAudit?.({ kind: "catalogue-truncated", truncatedRows: projection.truncatedRows, at });
    }
  }

  function flushCoalesced(cycleId: number): void {
    coalesceTimer = null;
    if (!watching || cycleId !== watchCycleId || !emitFn || !latestProjection || !lastPublishedProjection) {
      return;
    }
    const plan = planCatalogueUpdate(lastPublishedProjection, latestProjection);
    if (plan.kind === "none") return;
    const at = clock.now();
    lastPublishedProjection = latestProjection;
    emitTruncationAuditIfChanged(latestProjection, at);
    emitFn(latestProjection);
  }

  function publishOrSchedule(projection: CatalogueProjection, at: number, cycleId: number): void {
    if (!watching || cycleId !== watchCycleId || !emitFn) return;
    latestProjection = projection;

    if (lastPublishedProjection === null) {
      lastPublishedProjection = projection;
      emitTruncationAuditIfChanged(projection, at);
      emitFn(projection);
      return;
    }

    const plan = planCatalogueUpdate(lastPublishedProjection, projection);
    if (plan.kind !== "none" && coalesceTimer === null) {
      const armedCycle = cycleId;
      coalesceTimer = clock.setTimeout(() => flushCoalesced(armedCycle), coalesceWindowMs);
    }
  }

  function scheduleNextExpiryTimer(
    evaluatedPresences: readonly EvaluatedPresence[],
    now: number,
    cycleId: number
  ): void {
    expiryTimer = clearTimer(expiryTimer);
    if (!watching || cycleId !== watchCycleId) return;
    let soonestDelayMs: number | null = null;
    for (const ev of evaluatedPresences) {
      if (!ev.fresh) continue;
      const delayMs = ev.beatMs + presenceFreshnessMs - now;
      if (delayMs >= 0 && (soonestDelayMs === null || delayMs < soonestDelayMs)) {
        soonestDelayMs = delayMs;
      }
    }
    if (soonestDelayMs === null) return;
    expiryTimer = clock.setTimeout(() => {
      expiryTimer = null;
      if (!watching || cycleId !== watchCycleId) return;
      reprojectFromPresences(cycleId);
    }, soonestDelayMs);
  }

  function evaluateAndProject(
    inventory: RemoteNativeInventory,
    rawPresences: readonly H2ASession[],
    now: number,
    cycleId: number,
    isNativePoll: boolean
  ): void {
    if (!watching || cycleId !== watchCycleId) return;

    // 1. Filter out internal MCP companion PTYs (`*.h2a`) before join/sid/index/count.
    const nativesById = new Map<string, RemoteNativeSessionSnapshot[]>();
    for (const session of inventory.sessions) {
      if (isInternalCompanionNativeId(session.id)) continue;
      const list = nativesById.get(session.id);
      if (list) list.push(session);
      else nativesById.set(session.id, [session]);
    }

    // 2. Filter out imported/mirrored presences and presences naming `*.h2a` companions.
    const evaluatedAll: EvaluatedPresence[] = [];
    const presencesByNativeId = new Map<string, EvaluatedPresence[]>();
    const nonNativePresences: EvaluatedPresence[] = [];

    for (const p of rawPresences) {
      if (p.mirroredAt !== undefined) continue;
      const targetNative = p.launchContext?.nativePty?.session;
      if (targetNative && isInternalCompanionNativeId(targetNative)) continue;
      const ev = evaluatePresence(p, now, presenceFreshnessMs);
      evaluatedAll.push(ev);
      if (targetNative) {
        const list = presencesByNativeId.get(targetNative);
        if (list) list.push(ev);
        else presencesByNativeId.set(targetNative, [ev]);
      } else {
        nonNativePresences.push(ev);
      }
    }

    // Pick single winning presence per nativeId.
    const winnerByNativeId = new Map<string, EvaluatedPresence>();
    for (const [nativeId, list] of presencesByNativeId.entries()) {
      list.sort(compareEvaluatedPresence);
      winnerByNativeId.set(nativeId, list[0]!);
    }

    // 3. Read exclusions; promote p- exclusion to carry n- alias before rendering operable.
    let exclRes = readExclusions({ configDir, env });
    if (exclRes.ok) {
      for (const [nativeId, winner] of winnerByNativeId.entries()) {
        if (!exclRes.ok) break;
        const nSid = nativeCatalogueSid(nativeId);
        const pSid = presenceCatalogueSid(winner.session.sessionId);
        if (isSidExcluded(exclRes.file, pSid) && !isSidExcluded(exclRes.file, nSid)) {
          exclRes = linkExclusionAlias(pSid, nSid, {
            configDir,
            env,
            now: () => clock.now()
          });
        }
      }
    }

    // 4. Native lifecycle tracking & exit notifications (only during real native polls).
    if (isNativePoll) {
      for (const [nativeId, prev] of [...knownLiveNatives.entries()]) {
        const matches = nativesById.get(nativeId) ?? [];
        if (matches.length === 1) {
          const cur = matches[0]!;
          if (cur.status === "exited") {
            emitExitOnce(nativeId, prev.generation, prev.incarnation, cur.exit);
            exitedTombstones.set(nativeId, {
              generation: cur.generation,
              incarnation: cur.incarnation
            });
            knownLiveNatives.delete(nativeId);
          } else if (
            cur.generation !== prev.generation ||
            cur.incarnation !== prev.incarnation
          ) {
            emitExitOnce(nativeId, prev.generation, prev.incarnation);
            exitedTombstones.delete(nativeId);
            knownLiveNatives.set(nativeId, {
              generation: cur.generation,
              incarnation: cur.incarnation,
              socketPath: cur.socketPath,
              status: cur.status
            });
          } else {
            knownLiveNatives.set(nativeId, {
              generation: cur.generation,
              incarnation: cur.incarnation,
              socketPath: cur.socketPath,
              status: cur.status
            });
          }
        } else if (matches.length === 0) {
          if (inventory.complete) {
            emitExitOnce(nativeId, prev.generation, prev.incarnation);
            exitedTombstones.set(nativeId, {
              generation: prev.generation,
              incarnation: prev.incarnation
            });
            knownLiveNatives.delete(nativeId);
          }
          // Incomplete inventory: do NOT emit exit, keep knownLiveNatives entry suspended.
        }
      }

      for (const [nativeId, matches] of nativesById.entries()) {
        if (knownLiveNatives.has(nativeId)) continue;
        if (matches.length === 1) {
          const cur = matches[0]!;
          if (cur.status === "running" || cur.status === "stopping") {
            const tomb = exitedTombstones.get(nativeId);
            if (!tomb || tomb.generation !== cur.generation || tomb.incarnation !== cur.incarnation) {
              exitedTombstones.delete(nativeId);
              knownLiveNatives.set(nativeId, {
                generation: cur.generation,
                incarnation: cur.incarnation,
                socketPath: cur.socketPath,
                status: cur.status
              });
            }
          } else if (cur.status === "exited") {
            exitedTombstones.set(nativeId, {
              generation: cur.generation,
              incarnation: cur.incarnation
            });
          }
        }
      }
    }

    // 5. Build projected rows and refresh private index.
    privateIndex.clear();
    knownNonNativeSids.clear();
    sidAliases.clear();

    const rows: CatalogueSessionRow[] = [];
    const admissibleSids: string[] = [];
    const candidateNativeIds = new Set<string>([
      ...knownLiveNatives.keys(),
      ...nativesById.keys(),
      ...winnerByNativeId.keys()
    ]);

    const wasInitialPoll = lastPublishedProjection === null;

    for (const nativeId of candidateNativeIds) {
      if (isInternalCompanionNativeId(nativeId)) continue;
      const matches = nativesById.get(nativeId) ?? [];
      const winner = winnerByNativeId.get(nativeId);
      const liveRec = knownLiveNatives.get(nativeId);
      const nSid = nativeCatalogueSid(nativeId);
      const pSid = winner ? presenceCatalogueSid(winner.session.sessionId) : undefined;
      if (pSid) sidAliases.set(nSid, [pSid]);

      // Suppressed exited PTY: residual presence never resurrects it.
      if (exitedTombstones.has(nativeId) && !liveRec) {
        continue;
      }

      const excluded = exclRes.ok
        ? isSidExcluded(exclRes.file, nSid, pSid ? [pSid] : [])
        : false;
      const rawInstanceId = winner?.session.instance;
      const instanceWireId = rawInstanceId ? wireInstanceId(rawInstanceId) : undefined;
      const instanceStatus: CatalogueInstanceStatus | undefined =
        instanceWireId !== undefined
          ? (revokedInstances.has(instanceWireId) ? "revoked" : "live")
          : undefined;

      if (matches.length > 1) {
        // Ambiguous owner across multiple sockets: visible, NOT operable.
        privateIndex.set(nSid, {
          nativeId,
          socketPath: "",
          generation: "",
          incarnation: "",
          status: "running",
          ambiguous: true
        });
        admissibleSids.push(nSid);
        rows.push(
          projectJoinedCatalogueRow({
            sessionId: nSid,
            hostKind: "native",
            operable: false,
            excluded,
            state: winner && winner.fresh ? winner.session.state : "running",
            presence: winner?.session,
            presenceFresh: winner?.fresh ?? false,
            instanceStatus
          })
        );
      } else if (matches.length === 1 && (matches[0]!.status === "running" || matches[0]!.status === "stopping")) {
        const cur = matches[0]!;
        privateIndex.set(nSid, {
          nativeId,
          socketPath: cur.socketPath,
          generation: cur.generation,
          incarnation: cur.incarnation,
          status: cur.status,
          ambiguous: false
        });
        admissibleSids.push(nSid);
        const operable = cur.status === "running" && exclRes.ok;
        const state =
          cur.status === "stopping"
            ? "stopping"
            : winner && winner.fresh
              ? winner.session.state
              : "running";
        rows.push(
          projectJoinedCatalogueRow({
            sessionId: nSid,
            hostKind: "native",
            operable,
            excluded,
            state,
            presence: winner?.session,
            presenceFresh: winner?.fresh ?? false,
            instanceStatus,
            socketPath: cur.socketPath
          })
        );
      } else if (matches.length === 0 && liveRec) {
        // Missing during incomplete inventory: keep suspended (not operable), no exit.
        privateIndex.set(nSid, {
          nativeId,
          socketPath: liveRec.socketPath,
          generation: liveRec.generation,
          incarnation: liveRec.incarnation,
          status: liveRec.status,
          ambiguous: false
        });
        admissibleSids.push(nSid);
        rows.push(
          projectJoinedCatalogueRow({
            sessionId: nSid,
            hostKind: "native",
            operable: false,
            excluded,
            state: winner && winner.fresh ? winner.session.state : liveRec.status,
            presence: winner?.session,
            presenceFresh: winner?.fresh ?? false,
            instanceStatus,
            socketPath: liveRec.socketPath
          })
        );
      } else if (matches.length === 0 && !liveRec && winner && winner.fresh) {
        // Presence naming a native target before host discovery: uses `n-` sid, inoperable.
        knownNonNativeSids.add(nSid);
        admissibleSids.push(nSid);
        rows.push(
          projectJoinedCatalogueRow({
            sessionId: nSid,
            hostKind: "native",
            operable: false,
            excluded,
            state: winner.session.state,
            presence: winner.session,
            presenceFresh: true,
            instanceStatus
          })
        );
      } else {
        continue;
      }

      if (excluded) {
        if (!knownExcludedSids.has(nSid)) {
          knownExcludedSids.add(nSid);
          if (!wasInitialPoll) {
            const target = privateIndex.get(nSid);
            emitUnavailable({
              sid: nSid,
              reason: "excluded",
              ...(target && target.generation ? { generation: target.generation } : {}),
              ...(target && target.incarnation ? { incarnation: target.incarnation } : {})
            });
          }
        }
      } else {
        knownExcludedSids.delete(nSid);
      }
    }

    for (const ev of nonNativePresences) {
      if (!ev.fresh) continue;
      const pSid = presenceCatalogueSid(ev.session.sessionId);
      knownNonNativeSids.add(pSid);
      admissibleSids.push(pSid);
      const hostKind = classifyLaunchHost(ev.session.launchContext);
      const excluded = exclRes.ok ? isSidExcluded(exclRes.file, pSid) : false;
      const instanceStatus: CatalogueInstanceStatus =
        ev.session.instance && revokedInstances.has(wireInstanceId(ev.session.instance))
          ? "revoked"
          : "live";
      rows.push(
        projectJoinedCatalogueRow({
          sessionId: pSid,
          hostKind,
          operable: false,
          excluded,
          state: ev.session.state,
          presence: ev.session,
          presenceFresh: true,
          instanceStatus
        })
      );
    }

    // 6. Persist admissible sid index on complete native inventory.
    if (isNativePoll && inventory.complete) {
      try {
        writeCatalogueIdsIndex(admissibleSids, { configDir, env });
      } catch {
        // Non-fatal: catalogue publication still continues.
      }
    }

    // 7. Apply bounded projection (<= 512 rows, counted omissions) and publish/coalesce.
    const projection = projectBoundedCatalogue(rows);
    publishOrSchedule(projection, now, cycleId);

    // 8. Schedule exact expiry timer for the soonest fresh heartbeat.
    scheduleNextExpiryTimer(evaluatedAll, now, cycleId);
  }

  function reprojectFromPresences(cycleId: number): void {
    if (!watching || cycleId !== watchCycleId) return;
    let presences: readonly H2ASession[] = [];
    try {
      presences = readPresences(root);
    } catch {
      presences = [];
    }
    evaluateAndProject(lastNativeInventory, presences, clock.now(), cycleId, false);
  }

  function scheduleNextPoll(cycleId: number): void {
    pollTimer = clearTimer(pollTimer);
    if (!watching || cycleId !== watchCycleId) return;
    pollTimer = clock.setTimeout(() => {
      pollTimer = null;
      void runPollCycle(cycleId);
    }, pollIntervalMs);
  }

  async function runPollCycle(cycleId: number): Promise<void> {
    if (!watching || cycleId !== watchCycleId || pollInFlight) return;
    pollInFlight = true;
    const signal = activeAbort?.signal;
    try {
      const inventory = await readNativeInventory({ env, signal });
      if (!watching || cycleId !== watchCycleId || signal?.aborted) return;
      lastNativeInventory = inventory;
      let presences: readonly H2ASession[] = [];
      try {
        presences = readPresences(root);
      } catch {
        presences = [];
      }
      evaluateAndProject(inventory, presences, clock.now(), cycleId, true);
    } catch {
      if (!watching || cycleId !== watchCycleId || signal?.aborted) return;
      // Failed inventory read is treated as incomplete (never proves death).
      lastNativeInventory = { complete: false, sessions: [] };
      let presences: readonly H2ASession[] = [];
      try {
        presences = readPresences(root);
      } catch {
        presences = [];
      }
      evaluateAndProject(lastNativeInventory, presences, clock.now(), cycleId, true);
    } finally {
      pollInFlight = false;
      if (watching && cycleId === watchCycleId) {
        scheduleNextPoll(cycleId);
      }
    }
  }

  function startWatch(emit: (message: CatalogueEmitMessage) => void): void {
    if (watching) return;
    watching = true;
    watchCycleId += 1;
    const cycleId = watchCycleId;
    emitFn = emit;
    activeAbort = new AbortController();
    lastPublishedProjection = null;
    latestProjection = null;
    lastAuditedTruncatedRows = 0;
    pollInFlight = false;
    void runPollCycle(cycleId);
  }

  function stopWatch(): void {
    watchCycleId += 1;
    watching = false;
    emitFn = null;
    pollTimer = clearTimer(pollTimer);
    expiryTimer = clearTimer(expiryTimer);
    coalesceTimer = clearTimer(coalesceTimer);
    if (activeAbort) {
      activeAbort.abort();
      activeAbort = null;
    }
    pollInFlight = false;
    lastPublishedProjection = null;
    latestProjection = null;
    lastAuditedTruncatedRows = 0;
  }

  function applyRevokedInstances(ids: Iterable<string>): void {
    revokedInstances.clear();
    for (const id of ids) {
      if (typeof id === "string" && id.length > 0) revokedInstances.add(id);
    }
    if (watching && latestProjection) {
      reprojectFromPresences(watchCycleId);
    }
  }

  function setInstanceStatus(instanceId: string, status: CatalogueInstanceStatus): void {
    if (status === "revoked") revokedInstances.add(instanceId);
    else revokedInstances.delete(instanceId);

    if (!watching || !latestProjection) return;
    const updatedRows = latestProjection.rows.map((row) =>
      row.instanceId === instanceId && row.instanceStatus !== status
        ? { ...row, instanceStatus: status }
        : row
    );
    const projection: CatalogueProjection = {
      rows: updatedRows,
      truncatedRows: latestProjection.truncatedRows
    };
    publishOrSchedule(projection, clock.now(), watchCycleId);
  }

  async function resolveOpen(sid: string): Promise<ResolveOpenResult> {
    if (!isCanonicalCatalogueSid(sid)) {
      return { ok: false, sid, reason: "unknown-session" };
    }

    const target = privateIndex.get(sid);
    const isKnownNonNative = knownNonNativeSids.has(sid);

    if (!target && !isKnownNonNative) {
      return { ok: false, sid, reason: "unknown-session" };
    }
    if (target && isInternalCompanionNativeId(target.nativeId)) {
      return { ok: false, sid, reason: "unknown-session" };
    }

    // Check exclusions BEFORE touching any native socket.
    const aliases = sidAliases.get(sid) ?? [];
    const preExcl = readExclusions({ configDir, env });
    if (!preExcl.ok) {
      return { ok: false, sid, reason: "exclusion-state-unavailable" };
    }
    if (isSidExcluded(preExcl.file, sid, aliases)) {
      return { ok: false, sid, reason: "excluded" };
    }

    if (!target || target.ambiguous || target.status !== "running") {
      return { ok: false, sid, reason: "not-operable" };
    }

    // Fresh complete asynchronous inventory verification.
    let freshInventory: RemoteNativeInventory;
    try {
      freshInventory = await readNativeInventory({ env });
    } catch {
      return { ok: false, sid, reason: "not-operable" };
    }
    if (!freshInventory.complete) {
      return { ok: false, sid, reason: "not-operable" };
    }

    const matches = freshInventory.sessions.filter(
      (s) => !isInternalCompanionNativeId(s.id) && s.id === target.nativeId
    );
    if (matches.length !== 1) {
      return { ok: false, sid, reason: "not-operable" };
    }
    const owner = matches[0]!;
    if (
      owner.status !== "running" ||
      owner.generation !== target.generation ||
      owner.incarnation !== target.incarnation
    ) {
      return { ok: false, sid, reason: "not-operable" };
    }

    // Re-read exclusions before returning the private target.
    const postExcl = readExclusions({ configDir, env });
    if (!postExcl.ok) {
      return { ok: false, sid, reason: "exclusion-state-unavailable" };
    }
    if (isSidExcluded(postExcl.file, sid, aliases)) {
      return { ok: false, sid, reason: "excluded" };
    }

    return {
      ok: true,
      sid,
      nativeId: owner.id,
      socketPath: owner.socketPath,
      generation: owner.generation,
      incarnation: owner.incarnation
    };
  }

  function withShareAllowed(sid: string, enqueue: () => void): ShareAllowedResult {
    const aliases = sidAliases.get(sid) ?? [];
    return withExclusionShareAllowed({ sid, aliases, configDir, env }, enqueue);
  }

  function onUnavailable(callback: (event: CatalogueUnavailableEvent) => void): () => void {
    unavailableListeners.add(callback);
    return () => {
      unavailableListeners.delete(callback);
    };
  }

  function getProjection(): CatalogueProjection | null {
    return latestProjection;
  }

  return {
    startWatch,
    stopWatch,
    applyRevokedInstances,
    setInstanceStatus,
    resolveOpen,
    withShareAllowed,
    onUnavailable,
    getProjection
  };
}
