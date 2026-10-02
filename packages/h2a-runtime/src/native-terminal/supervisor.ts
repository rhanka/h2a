import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { NativeTerminalClient } from "./client.js";
import {
  defaultOwnerHostProbe,
  reconcileDeadHostOrphans,
  type NativeTerminalOwnerHostProbe,
  type NativeTerminalReapOutcome,
  type NativeTerminalReapRefusalCause,
  type NativeTerminalReconcileOutcome,
} from "./host.js";
import {
  NATIVE_TERMINAL_DEFAULT_MAX_SESSIONS,
  NATIVE_TERMINAL_DEFAULT_REQUEST_TIMEOUT_MS,
  NATIVE_TERMINAL_HEALTH_TIMEOUT_MS,
  NATIVE_TERMINAL_MAX_REPLAY_BYTES_PER_SESSION,
  NATIVE_TERMINAL_MAX_SESSIONS,
  NATIVE_TERMINAL_PROTOCOL_VERSION,
  type NativeTerminalPing,
  type NativeTerminalStopSignal,
} from "./protocol.js";

/**
 * A supervisor REFUSED to hand out, publish or adopt a host because a durable
 * PTY group attributed to its socket is known to have outlived its host — the
 * socket-scoped fail-closed containment verdict (see
 * `NativeTerminalHostSupervisor#reconcileDeadHostOrphans`).
 *
 * Typed, and distinct from every startup/connection failure, because it is a
 * VERDICT rather than a hiccup: a caller that retries a lost connection must
 * NOT retry this. The supervisor's own retry paths rethrow it immediately
 * instead of treating it as "the host is not ready yet", so it never becomes a
 * reconcile storm, and it is never recorded as a spawn failure (nothing failed
 * to start — starting anything is exactly what was refused).
 */
export class NativeTerminalContainmentError extends Error {
  readonly socketPath: string;
  readonly sessionId: string | undefined;
  readonly ownerPid: number | undefined;
  readonly pgid: number | undefined;
  readonly outcomeStatus: string | undefined;
  /** `reapOrphan`'s refusal cause, when the verdict came from a refusal. */
  readonly refusalCause: NativeTerminalReapRefusalCause | undefined;

  constructor(
    message: string,
    details: {
      socketPath: string;
      sessionId?: string;
      ownerPid?: number;
      pgid?: number;
      outcomeStatus?: string;
      refusalCause?: NativeTerminalReapRefusalCause;
    },
  ) {
    super(message);
    this.name = "NativeTerminalContainmentError";
    this.socketPath = details.socketPath;
    this.sessionId = details.sessionId;
    this.ownerPid = details.ownerPid;
    this.pgid = details.pgid;
    this.outcomeStatus = details.outcomeStatus;
    this.refusalCause = details.refusalCause;
  }
}

/**
 * Whether a reconcile outcome discharges the proof THIS supervisor owes for a
 * host it force-killed itself. Deliberately stricter than the socket-scoped
 * rule below: on this path, anything short of "the group is gone" keeps failing
 * closed — an absence of information included — because the obligation exists
 * precisely because we destroyed the only process that could have cleaned up.
 *
 * Exactly two kinds of outcome end it: a confirmed reap, and a refusal whose
 * cause PROVED the original group gone — a recycled pgid number (reported by
 * reconcile as `pruned-recycled-pgid`) or a row written under a previous boot
 * of this same machine (`pruned-stale-boot-row`); see
 * `NativeTerminalReconcileOutcome`. The two raw refusals are accepted too, as
 * defence in depth for a reap that returns them directly.
 */
function dischargesOwnedHostProof(outcome: NativeTerminalReconcileOutcome): boolean {
  return (
    outcome.status === "reaped" ||
    outcome.status === "pruned-recycled-pgid" ||
    outcome.status === "pruned-stale-boot-row" ||
    (outcome.status === "reap-refused" &&
      (outcome.cause === "recycled" || outcome.cause === "stale-boot"))
  );
}

/**
 * Whether a `reap-refused` cause is positive evidence that a PTY group
 * outlived its host and is STILL ALIVE. `reapOrphan` short-circuits to
 * `reaped` whenever the OS already reports the group empty, so:
 *
 *  - `membership-unprovable` / `unsupported-process-groups` — the group was
 *    observed alive and could not be proven to be (or killed as) this
 *    session's: blocking evidence.
 *  - `pgid-mismatch` — taken BEFORE any liveness probe, and only after
 *    reconcile re-read the row once (see `reconcileDeadHostOrphans`); it
 *    survives that re-read only while the row keeps being rewritten under a
 *    proven-dead owner, which is not a state to hand a terminal out in.
 *  - `recycled` — the OPPOSITE of a survivor: the pgid number is held by an
 *    unrelated live leader, which proves the original group is gone. Reconcile
 *    already reports it as `pruned-recycled-pgid`; this stays defence in depth
 *    for an injected or legacy reap that returns the refusal directly.
 *  - `stale-boot` — the OPPOSITE of a survivor too, and for a stronger reason:
 *    the row was written before this boot, in this reader's own pid namespace
 *    on this same machine, and a reboot ends every process of the boot before
 *    it. Reconcile reports it as `pruned-stale-boot-row`; same defence in
 *    depth as `recycled`.
 *  - `foreign-frame` — the pgid number answered ALIVE here, but the row was
 *    written in a frame this reader cannot prove is its own (another or an
 *    unknown pid namespace, or another boot of a machine not proven to be this
 *    one — e.g. another machine sharing this registry). Not a proof of a
 *    survivor, but not a proof of anything else either: the row's own group
 *    may be alive where it was written, and this reader cannot decide it, so
 *    it blocks — the fail-closed side of an undecidable verdict.
 *  - NO cause — the pgid could not be resolved at all, which is what the loser
 *    of a race between two reconcile passes sees once the winner confirmed the
 *    reap and pruned the row. An absence of information, not a survivor.
 */
function provesASurvivingGroup(
  cause: NativeTerminalReapRefusalCause | undefined,
): boolean {
  return (
    cause === "membership-unprovable" ||
    cause === "foreign-frame" ||
    cause === "unsupported-process-groups" ||
    cause === "pgid-mismatch"
  );
}

/**
 * Cause-specific recovery line carried by a containment verdict. NEVER tells
 * an operator to kill a pgid that was not proven to belong to the dead host:
 * `membership-unprovable` is precisely the state where that group may be an
 * unrelated process, so it asks for inspection first. Every hint also names
 * how the block lifts on its own (a later pass finding the group empty), so a
 * refusal is never a dead end.
 */
function recoveryHint(
  outcome: Readonly<{
    sessionId: string;
    pgid: number;
    status: "reap-refused" | "reap-timed-out" | "reap-failed";
    cause?: NativeTerminalReapRefusalCause;
    ownerDeathUnproven?: true;
  }>,
): string {
  const inspect = `Inspect it first: ps -o pid,pgid,stat,args -g ${outcome.pgid}.`;
  const lifts =
    `The block lifts as soon as any later pass finds pgid=${outcome.pgid} empty and prunes the durable row for session ${outcome.sessionId}.`;
  /** The one recovery that never waits on a third party: drop the row itself. */
  const byHand =
    `If inspection shows pgid=${outcome.pgid} is NOT this session's PTY tree, do not wait for that unrelated process to exit: remove the durable row for session ${outcome.sessionId} from the registry by hand (its id is "native-terminal-pty:${outcome.sessionId}").`;
  if (outcome.status === "reap-failed") {
    const owner = outcome.ownerDeathUnproven === true
      ? `The OWNING HOST's own liveness was never proven either (its probe failed), so this row's owner is not known to be dead.`
      : `The owning host is proven dead.`;
    return `The evaluation of this row FAILED before proving anything (the durable store or a probe failed), so the group was never identified and nothing was signalled: it may be alive. ${owner} Fix the durable store first, then retry. ${inspect} ${lifts}`;
  }
  if (outcome.status === "reap-timed-out") {
    return `The group WAS proven to be this session's PTY tree and did not die within the force-kill timeout (an unkillable or uninterruptible-sleep member). ${inspect} ${lifts}`;
  }
  switch (outcome.cause) {
    case "membership-unprovable":
      return `The group at pgid=${outcome.pgid} is alive but could NOT be proven to be this session's PTY tree, so it may belong to an unrelated process: do NOT signal it on the strength of this message. ${inspect} ${byHand} ${lifts}`;
    case "foreign-frame":
      // No `inspect`/`byHand` here: both rest on a local `ps`, and this row's
      // pids name a DIFFERENT process space than this reader's, so a local
      // "that is not our tree" would lead to deleting the only record of a
      // group that may be alive where the row was written.
      return `The durable row for session ${outcome.sessionId} was written in a different pid namespace, boot or machine than this reader's (its pgidPidNamespace/pgidBootId/pgidMachineId fields name it), so whatever answers at pgid=${outcome.pgid} HERE cannot be identified as that row's group and nothing was signalled: a local ps of it proves nothing either way, and it must NOT be signalled. Check the group from the machine and pid namespace that wrote the row; remove the row (id "native-terminal-pty:${outcome.sessionId}") by hand only once that frame no longer exists or its group is confirmed gone there. ${lifts}`;
    case "pgid-mismatch":
      return `The durable row for session ${outcome.sessionId} is being rewritten while its owner is proven dead, so no group was identified and nothing was signalled. Retry once the writer settles; ${lifts}`;
    case "unsupported-process-groups":
      return `This platform has no POSIX process groups, so neither a group kill nor a group-empty proof exists here; nothing was signalled.`;
    default:
      return `Nothing was signalled. ${inspect} ${lifts}`;
  }
}

const NATIVE_TERMINAL_SPAWN_BACKOFF_BASE_MS = 250;
const NATIVE_TERMINAL_SPAWN_BACKOFF_MAX_MS = 5_000;
const NATIVE_TERMINAL_STARTUP_TIMEOUT_MS = 5_000;
const NATIVE_TERMINAL_SPAWN_TERMINATION_GRACE_MS = 1_000;
const NATIVE_TERMINAL_MAX_STARTUP_DIAGNOSTIC_BYTES = 4_096;

export type NativeTerminalHostSpawn = (options: {
  socketPath: string;
  generation: string;
  replayBytesPerSession: number;
  maxSessions: number;
  /** Durable pgid store; defaults to the real registry path when omitted. */
  registryPath?: string;
}) => ChildProcess;

function defaultSpawnHost(options: {
  socketPath: string;
  generation: string;
  replayBytesPerSession: number;
  maxSessions: number;
  registryPath?: string;
}): ChildProcess {
  const entry = fileURLToPath(new URL("./process.js", import.meta.url));
  const child = spawn(process.execPath, [
    entry,
    "--socket",
    options.socketPath,
    "--generation",
    options.generation,
    "--replay-bytes",
    String(options.replayBytesPerSession),
    "--max-sessions",
    String(options.maxSessions),
    ...(options.registryPath !== undefined
      ? ["--registry-path", options.registryPath]
      : []),
  ], {
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: process.env,
  });
  (child.stderr as NodeJS.ReadableStream & { unref?(): void } | null)?.unref?.();
  child.unref();
  return child;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function childExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function childGone(child: ChildProcess): boolean {
  if (childExited(child)) return true;
  if (child.pid === undefined) return false;
  try {
    process.kill(child.pid, 0);
    return false;
  } catch (error) {
    // Only ESRCH proves absence. EPERM means that a process exists but is not
    // signalable by this caller, so its ownership must remain intact.
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (childExited(child)) return true;
  return Promise.race([
    once(child, "exit").then(() => true),
    delay(timeoutMs).then(() => false),
  ]);
}

async function connectHealthy(
  socketPath: string,
  requestTimeoutMs: number,
): Promise<Readonly<{
  client: NativeTerminalClient;
  ping: NativeTerminalPing;
}>> {
  const client = await NativeTerminalClient.connect(socketPath, {
    connectTimeoutMs: NATIVE_TERMINAL_HEALTH_TIMEOUT_MS,
    requestTimeoutMs,
  });
  try {
    const ping = await client.ping(NATIVE_TERMINAL_HEALTH_TIMEOUT_MS);
    if (
      ping.protocolVersion !== NATIVE_TERMINAL_PROTOCOL_VERSION
      || typeof ping.generation !== "string"
      || ping.generation.trim().length === 0
      || !Number.isSafeInteger(ping.hostPid)
      || ping.hostPid <= 0
    ) {
      throw new Error("native terminal host returned an invalid ping");
    }
    return { client, ping };
  } catch (error) {
    client.close();
    throw error;
  }
}

export class NativeTerminalHostSupervisor {
  readonly #socketPath: string;
  readonly #generationFactory: () => string;
  readonly #replayBytesPerSession: number;
  readonly #maxSessions: number;
  readonly #requestTimeoutMs: number;
  readonly #spawnHost: NativeTerminalHostSpawn;
  readonly #now: () => number;
  readonly #startupTimeoutMs: number;
  readonly #spawnTerminationGraceMs: number;
  readonly #registryPath: string | undefined;
  readonly #ownerProbe: NativeTerminalOwnerHostProbe;
  readonly #reapOrphan:
    | ((
        sessionId: string,
        pgid: number,
        signal: NativeTerminalStopSignal,
        expected?: { groupToken?: string },
      ) => Promise<NativeTerminalReapOutcome>)
    | undefined;
  readonly #log: (line: string) => void;
  #client: NativeTerminalClient | undefined;
  #connecting: Promise<NativeTerminalClient> | undefined;
  #spawned: ChildProcess | undefined;
  // Only a child that completed the native-terminal health handshake can have
  // accepted a create request and therefore own a persisted PTY process group.
  #spawnedReachedHealth = false;
  #spawnError: Error | undefined;
  #spawnDiagnostic = "";
  #consecutiveSpawnFailures = 0;
  #nextSpawnAllowedAt = 0;
  #lastSpawnFailure: Error | undefined;
  #lastSpawnGeneration: string | undefined;
  // A health-checked host that has disappeared may have left a PTY guardian
  // (or, after that guardian's own parent-death race, its reparented
  // descendants) behind. Keep its identity until #containDeadOwnedHost has
  // positively reaped every durable group it owned — NOT merely until the
  // next takeover: an adoption is just as much a hand-out of this socket.
  // Clearing #spawned alone would discard the fact that this is containment
  // work rather than an ordinary best-effort stale-registry sweep.
  #pendingDeadOwnedHostPid: number | undefined;

  constructor(options: {
    socketPath: string;
    replayBytesPerSession: number;
    maxSessions?: number;
    requestTimeoutMs?: number;
    spawnHost?: NativeTerminalHostSpawn;
    generationFactory?: () => string;
    now?: () => number;
    startupTimeoutMs?: number;
    spawnTerminationGraceMs?: number;
    /** Durable pgid store forwarded to a spawned host; defaults to the real registry path. */
    registryPath?: string;
    /** Injectable so tests never touch a real /proc; defaults to the real probe. */
    ownerProbe?: NativeTerminalOwnerHostProbe;
    /** Injectable so tests never send real signals; defaults to a throwaway
     * NativeTerminalHost's real reapOrphan (see reconcileDeadHostOrphans). */
    reapOrphan?: (
      sessionId: string,
      pgid: number,
      signal: NativeTerminalStopSignal,
      expected?: { groupToken?: string },
    ) => Promise<NativeTerminalReapOutcome>;
    /** Diagnostic sink for the orphan-reconcile pass; defaults to prefixed stderr. */
    log?: (line: string) => void;
  }) {
    if (
      !Number.isSafeInteger(options.replayBytesPerSession)
      || options.replayBytesPerSession <= 0
      || options.replayBytesPerSession > NATIVE_TERMINAL_MAX_REPLAY_BYTES_PER_SESSION
    ) {
      throw new RangeError(
        `replayBytesPerSession must be between 1 and ${NATIVE_TERMINAL_MAX_REPLAY_BYTES_PER_SESSION}`,
      );
    }
    const maxSessions =
      options.maxSessions ?? NATIVE_TERMINAL_DEFAULT_MAX_SESSIONS;
    if (
      !Number.isSafeInteger(maxSessions) ||
      maxSessions <= 0 ||
      maxSessions > NATIVE_TERMINAL_MAX_SESSIONS
    ) {
      throw new RangeError(
        `maxSessions must be between 1 and ${NATIVE_TERMINAL_MAX_SESSIONS}`,
      );
    }
    const requestTimeoutMs =
      options.requestTimeoutMs ?? NATIVE_TERMINAL_DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new RangeError(
        "requestTimeoutMs must be a positive safe integer",
      );
    }
    const startupTimeoutMs =
      options.startupTimeoutMs ?? NATIVE_TERMINAL_STARTUP_TIMEOUT_MS;
    const spawnTerminationGraceMs =
      options.spawnTerminationGraceMs ??
      NATIVE_TERMINAL_SPAWN_TERMINATION_GRACE_MS;
    for (const [label, value] of [
      ["startupTimeoutMs", startupTimeoutMs],
      ["spawnTerminationGraceMs", spawnTerminationGraceMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive safe integer`);
      }
    }
    // NORMALIZED once, here, because this string is not only a connect target
    // but also the IDENTITY a durable row is attributed to (see the
    // socket-scoped rule in #reconcileDeadHostOrphans). Two spellings of the
    // same socket — a doubled separator, a "." segment, a relative path —
    // would otherwise compare unequal and fail OPEN. The host normalizes the
    // spelling it records the same way (see NativeTerminalHost), and the
    // comparison normalizes the row's value too, so a row written by an older
    // host is still attributed correctly.
    this.#socketPath = resolve(options.socketPath);
    this.#generationFactory = options.generationFactory ?? randomUUID;
    this.#replayBytesPerSession = options.replayBytesPerSession;
    this.#maxSessions = maxSessions;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#spawnHost = options.spawnHost ?? defaultSpawnHost;
    this.#now = options.now ?? Date.now;
    this.#startupTimeoutMs = startupTimeoutMs;
    this.#spawnTerminationGraceMs = spawnTerminationGraceMs;
    this.#registryPath = options.registryPath;
    this.#ownerProbe = options.ownerProbe ?? defaultOwnerHostProbe;
    this.#reapOrphan = options.reapOrphan;
    this.#log =
      options.log ??
      ((line) => {
        process.stderr.write(`[h2a-pty-supervisor] ${line}\n`);
      });
  }

  get spawnedPid(): number | undefined {
    this.#clearGoneSpawn();
    return this.#spawned?.pid;
  }

  async client(): Promise<NativeTerminalClient> {
    if (this.#client) {
      try {
        await this.#client.ping(NATIVE_TERMINAL_HEALTH_TIMEOUT_MS);
        return this.#client;
      } catch {
        this.#client.close();
        this.#client = undefined;
      }
    }
    this.#connecting ??= this.#connectOrStart().finally(() => {
      this.#connecting = undefined;
    });
    this.#client = await this.#connecting;
    return this.#client;
  }

  disconnect(): void {
    this.#client?.close();
    this.#client = undefined;
  }

  async #connectOrStart(): Promise<NativeTerminalClient> {
    try {
      const connected = await connectHealthy(
        this.#socketPath,
        this.#requestTimeoutMs,
      );
      return await this.#adoptHealthyConnection(connected);
    } catch (error) {
      // A containment verdict is NOT a connection failure. The adoption above
      // can reach one, and treating it as "nothing answered" would start
      // takeover — which, on a pass that no longer carries blocking evidence,
      // spawns a replacement host beside the perfectly healthy one whose
      // adoption was just refused. Surface the verdict instead; the caller owes
      // a proof, not a retry.
      if (error instanceof NativeTerminalContainmentError) throw error;
      // TAKEOVER preflight. A lost connection is the UNKNOWN, never proof
      // that the previous host died, so this pass reaps only entries whose
      // owning host is independently PROVEN dead. It runs BEFORE the backoff
      // and generation checks because containment is not restart work: a
      // backed-off caller must still not be told "come back later" while one
      // of this socket's proven-dead owners is unconfirmed.
      await this.#containDeadOwnedHost();
      if (!this.#spawned || this.#spawned.exitCode !== null || this.#spawned.signalCode !== null) {
        const now = this.#now();
        if (now < this.#nextSpawnAllowedAt) {
          const remaining = this.#nextSpawnAllowedAt - now;
          throw new Error(
            `native terminal host restart backoff active for ${remaining}ms after: ${this.#lastSpawnFailure?.message ?? "startup failure"}`,
          );
        }
        const generation = this.#generationFactory();
        if (generation.trim().length === 0) {
          throw new Error("native terminal host generation must not be empty");
        }
        if (generation === this.#lastSpawnGeneration) {
          throw new Error("native terminal host generation must change after a restart");
        }
        this.#lastSpawnGeneration = generation;
        // We are about to spawn a REPLACEMENT host. The containment pass
        // above has already run — and, had it found an unconfirmed
        // proven-dead owner of THIS socket, has already thrown — so reaching
        // this line is the positive statement "no durable group attributed to
        // this socket is known to have survived its dead owner".
        this.#spawnError = undefined;
        this.#spawnDiagnostic = "";
        this.#spawned = this.#spawnHost({
          socketPath: this.#socketPath,
          generation,
          replayBytesPerSession: this.#replayBytesPerSession,
          maxSessions: this.#maxSessions,
          ...(this.#registryPath !== undefined ? { registryPath: this.#registryPath } : {}),
        });
        this.#spawnedReachedHealth = false;
        const spawned = this.#spawned;
        spawned.stderr?.setEncoding("utf8");
        spawned.stderr?.on("data", (chunk: string | Buffer) => {
          const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
          this.#spawnDiagnostic = (
            this.#spawnDiagnostic + text
          ).slice(-NATIVE_TERMINAL_MAX_STARTUP_DIAGNOSTIC_BYTES);
        });
        spawned.once("error", (error) => {
          if (this.#spawned === spawned) this.#spawnError = error;
        });
      }
    }

    let lastError: unknown;
    const startupDeadline = Date.now() + this.#startupTimeoutMs;
    while (Date.now() < startupDeadline) {
      try {
        const connected = await connectHealthy(
          this.#socketPath,
          this.#requestTimeoutMs,
        );
        return await this.#adoptHealthyConnection(connected);
      } catch (error) {
        // Same discrimination as the takeover preflight above, and the reason
        // this loop must make it: retrying a containment verdict runs one
        // reconcile pass per iteration (a pass that reaps a live group can take
        // the whole force-kill timeout), then reports the verdict as a startup
        // failure and reaps a host that is healthy. Surface it now — and abandon
        // an owned launch that never became usable, rather than leak it.
        if (error instanceof NativeTerminalContainmentError) {
          await this.#abandonUnhealthyOwnedSpawn();
          throw error;
        }
        lastError = error;
      }
      if (this.#spawnError) {
        const error = new Error(
          `native terminal host failed to start: ${this.#spawnError.message}`,
        );
        this.#recordSpawnFailure(error);
        throw error;
      }
      if (this.#spawned?.exitCode !== null || this.#spawned.signalCode !== null) {
        if (this.#spawnedReachedHealth) {
          // This host completed a health handshake before it died, so it is
          // not a failed replacement. It exited after #clearGoneSpawn's
          // first observation; complete its required containment pass before
          // starting takeover again.
          this.#clearGoneSpawn();
          if (this.#pendingDeadOwnedHostPid === undefined) {
            throw new Error("known healthy native terminal host exited without a pid");
          }
          await this.#containDeadOwnedHost();
          return this.#connectOrStart();
        }
        const diagnostic = this.#spawnDiagnostic.trim();
        const error = new Error(
          `native terminal host exited before accepting connections (${this.#spawned?.exitCode ?? this.#spawned?.signalCode ?? "unknown"})${diagnostic ? `: ${diagnostic}` : ""}`,
        );
        this.#recordSpawnFailure(error);
        throw error;
      }
      await delay(25);
    }
    const error = new Error(
      `native terminal host did not become ready: ${String(lastError)}`,
    );
    const spawned = this.#spawned;
    if (spawned && !childExited(spawned)) {
      try {
        await this.#terminateOwnedSpawn(spawned);
      } catch (terminationError) {
        // A containment verdict raised while reaping this child outranks the
        // readiness failure: it names the session, pgid and owner an operator
        // needs, and it must not be recorded as one more startup failure.
        if (terminationError instanceof NativeTerminalContainmentError) {
          throw terminationError;
        }
        const combined = new Error(
          `${error.message}; failed to reap owned child: ${String(terminationError)}`,
        );
        this.#recordSpawnFailure(combined);
        throw combined;
      }
    }
    this.#recordSpawnFailure(error);
    throw error;
  }

  async #adoptHealthyConnection(connected: Readonly<{
    client: NativeTerminalClient;
    ping: NativeTerminalPing;
  }>): Promise<NativeTerminalClient> {
    const spawned = this.#spawned;
    if (
      spawned &&
      !childExited(spawned) &&
      spawned.pid === connected.ping.hostPid
    ) {
      this.#spawnedReachedHealth = true;
    }
    if (
      spawned &&
      !childExited(spawned) &&
      spawned.pid !== connected.ping.hostPid
    ) {
      try {
        await this.#terminateOwnedSpawn(spawned);
      } catch (error) {
        connected.client.close();
        // Reaping the loser can itself hit the containment gate (a forced kill
        // requires the proof). That verdict must reach the caller as itself:
        // wrapped in an adoption message it would look like a retryable
        // adoption hiccup and be retried.
        if (error instanceof NativeTerminalContainmentError) throw error;
        throw new Error(
          `native terminal host adoption could not reap losing owned child: ${String(error)}`,
        );
      }
    }
    // A healthy connection is the LAST gate before a caller can use this
    // socket again, and it is reached by two paths that both bypass the
    // takeover preflight: this host may be a replacement a COMPETING
    // supervisor published while our own health-checked child was still
    // alive, and our child may have died only afterwards. Containment
    // therefore runs here too, on the same helper — an owned child that has
    // already exited is never silently discarded (that would drop the only
    // attribution turning the next pass into required containment), and a
    // rejected containment closes this candidate rather than hand out a
    // working terminal over an unreaped PTY group.
    try {
      await this.#containDeadOwnedHost();
    } catch (error) {
      connected.client.close();
      throw error;
    }
    this.#resetSpawnBackoff();
    return connected.client;
  }

  /**
   * Give up on an owned spawn that never completed a health handshake, because
   * this call is about to reject instead of waiting for it: a child nobody will
   * ever connect to must not be left behind.
   *
   * A child that DID reach health is deliberately left alone. It is a published,
   * healthy host serving this socket — not the thing a containment verdict
   * objects to — and reaping it would only turn one containment obligation into
   * two (its own durable rows would then have a dead owner) while destroying a
   * host the socket can reuse the moment the block lifts. Nothing is handed out
   * either way: the verdict still rejects.
   *
   * Termination failures are logged, never substituted for the verdict that is
   * about to be thrown.
   */
  async #abandonUnhealthyOwnedSpawn(): Promise<void> {
    const spawned = this.#spawned;
    if (!spawned || childExited(spawned) || this.#spawnedReachedHealth) return;
    try {
      await this.#terminateOwnedSpawn(spawned);
    } catch (error) {
      this.#log(
        `failed to reap the owned native-terminal host abandoned on a containment refusal: ${String(error)}`,
      );
    }
  }

  async #terminateOwnedSpawn(spawned: ChildProcess): Promise<void> {
    if (this.#spawned !== spawned) return;
    const spawnedReachedHealth = this.#spawnedReachedHealth;
    let forceKilled = false;
    if (!childExited(spawned)) {
      spawned.kill("SIGTERM");
      if (
        !await waitForChildExit(spawned, this.#spawnTerminationGraceMs)
      ) {
        spawned.kill("SIGKILL");
        forceKilled = true;
        if (
          !await waitForChildExit(spawned, this.#spawnTerminationGraceMs)
        ) {
          // Node can observe the OS process as gone before it delivers the
          // ChildProcess "exit" event. After escalation, ESRCH is therefore
          // sufficient proof that there is no owned host left to reap.
          if (!childGone(spawned)) {
            throw new Error("owned native terminal host did not exit after SIGKILL");
          }
        }
      }
    }
    if (this.#spawned === spawned) {
      this.#spawned = undefined;
      this.#spawnedReachedHealth = false;
    }
    if (forceKilled && spawnedReachedHealth) {
      // A SIGKILLed host cannot run process.ts's forceStopAll(). The PTY
      // guardian's parent-death signal covers its direct child, but a
      // descendant can reparent before that child processes the signal. Reap
      // the durably recorded process groups from this still-live supervisor:
      // kill(-pgid, SIGKILL) reaches every member, including reparented ones.
      if (spawned.pid === undefined) {
        throw new Error("forced native-terminal host reap cannot identify the killed host pid");
      }
      // Record the pid BEFORE requiring its reap: if this pass cannot confirm
      // it, the obligation must outlive this call instead of dying with the
      // local variable, so a later connection re-requires the same proof.
      this.#pendingDeadOwnedHostPid ??= spawned.pid;
      await this.#containDeadOwnedHost();
    }
  }

  /**
   * The ONE containment gate. Every path that can hand a client to a caller —
   * takeover preflight, the readiness loop's healthy-host-died branch, and
   * the adoption of any healthy connection — goes through this helper rather
   * than through its own copy of the rule, because the defect it closes was
   * exactly a path that consulted `#pendingDeadOwnedHostPid` too late (or not
   * at all).
   *
   * Two obligations, both discharged by the single reconcile pass below:
   *
   *  - OUR OWN dead host: `#clearGoneSpawn` records the pid of a child that
   *    completed a health handshake and has since disappeared. That pid is a
   *    REQUIREMENT, not a hint: the pass must report `reaped` for every row
   *    it owns, and the pending pid is cleared ONLY after that succeeds — so
   *    a refused or timed-out reap keeps failing closed on every later call
   *    instead of being forgotten by the first one.
   *  - ANY proven-dead owner of THIS socket, whoever started it (see
   *    `#reconcileDeadHostOrphans`). A competing supervisor's host is not our
   *    child, so no pending pid exists for it, yet handing out a terminal on
   *    this socket while its PTY group is known to have outlived its host is
   *    the same containment failure.
   *
   * One pass per connection HAND-OUT, not per request: within one supervisor,
   * `client()` returns its cached client after a plain ping, so this runs when
   * a connection is newly established — startup, and each host replacement.
   * Production, however, builds a FRESH supervisor per `create` /
   * `ensure-host` op process (see op.ts), so every such op runs one full pass,
   * including the destructive reaps of other sockets' proven-dead rows. The
   * cost is O(durable rows) per op, which is why the in-memory
   * `#pendingDeadOwnedHostPid` cannot be the durable half of the rule: it
   * never outlives one op process, and the socket-scoped verdict re-derived
   * from the store is what holds across invocations.
   */
  async #containDeadOwnedHost(): Promise<void> {
    this.#clearGoneSpawn();
    const ownerPid = this.#pendingDeadOwnedHostPid;
    await this.#reconcileDeadHostOrphans(
      ownerPid === undefined ? {} : { requireReapedForOwnerPid: ownerPid },
    );
    // Discharge exactly the obligation this pass proved. `#clearGoneSpawn` is
    // also reachable synchronously from the `spawnedPid` getter, so an owned
    // host that died DURING the await above can have recorded a new pending
    // pid that nothing has reaped yet; a blanket clear here would silently
    // drop it.
    if (this.#pendingDeadOwnedHostPid === ownerPid) {
      this.#pendingDeadOwnedHostPid = undefined;
    }
  }

  #clearGoneSpawn(): void {
    if (this.#spawned && childGone(this.#spawned)) {
      if (this.#spawnedReachedHealth && this.#spawned.pid !== undefined) {
        this.#pendingDeadOwnedHostPid ??= this.#spawned.pid;
      }
      this.#spawned = undefined;
      this.#spawnedReachedHealth = false;
    }
  }

  /**
   * Run one `reconcileDeadHostOrphans` pass against the shared registry
   * (see host.ts for the full contract). A reconcile HICCUP — the registry
   * unreadable, the pass itself throwing — stays best-effort: an absence of
   * information must never prevent spawning the replacement host that
   * takeover already needs. What follows is about the opposite, a completed
   * pass that returned positive evidence. After this supervisor has
   * forcibly SIGKILLed its OWN host, though, an unconfirmed row belonging to
   * that host is a containment failure, not a cleanup hiccup; surface it to
   * the caller rather than claim forced reaping completed.
   *
   * SOCKET-SCOPED FAIL-CLOSED PUBLICATION. The same is true one step wider,
   * and this is what makes the guarantee hold ACROSS supervisors rather than
   * only inside the one that happened to own the dead host. A completed pass
   * that PROVED an owner dead and then reported an outcome carrying positive
   * evidence that the PTY group is STILL ALIVE (`reap-timed-out`, or a
   * `reap-refused` whose cause `provesASurvivingGroup` — see that predicate
   * for the per-cause reasoning), or an outcome that proves NOTHING AT ALL
   * about that group (`reap-failed`: this row's own evaluation threw, so the
   * group was never identified and the row is still there), must not be
   * followed by a hand-out:
   * publishing a replacement host, or adopting a competitor's, on that socket
   * would resume terminal work over that group — the invisible-orphan bug this
   * whole mechanism exists to close. So any such outcome whose row is
   * attributed to THIS socket throws a `NativeTerminalContainmentError`,
   * whether or not the dead owner was ever this supervisor's child.
   *
   * The excluded outcomes are excluded because they carry no such evidence,
   * and the difference is never guessed:
   *  - a CAUSE-LESS `reap-refused` means only that the pgid could not be
   *    resolved, which is exactly what the loser of a race between two
   *    reconcile passes sees once the winner confirmed the reap and pruned the
   *    row. Treating that as a surviving group would convert a successful
   *    concurrent containment into an outage. Note the contrast with
   *    `reap-failed`, which is NOT excluded: there the row is still in the
   *    store and its evaluation failed outright, so nothing explains the
   *    missing proof;
   *  - `recycled` PROVES the original group is gone rather than surviving (an
   *    unrelated live leader now holds that pgid number), so reconcile prunes
   *    the row and reports `pruned-recycled-pgid`. Blocking there would strand
   *    a socket on a stale row AND point an operator at an unrelated process
   *    group.
   *
   * Two limits are deliberate and declared rather than papered over:
   *  - A row with no `ownerSocketPath` (written before that attribution
   *    existed) cannot be proven to belong to this socket, so it keeps the
   *    pre-existing best-effort behaviour instead of blocking every socket in
   *    the store — the same "never manufacture a verdict from missing data"
   *    asymmetry `defaultOwnerHostProbe` and `#verifyGroupLeaderIdentity`
   *    already apply. Containment for legacy rows is therefore `partial`.
   *  - The block is not self-clearing: it lifts when the group is actually
   *    reaped (by any supervisor's later pass) and the row is pruned, and
   *    until then this socket has NO native terminal. That is the intended
   *    trade — availability for an unkillable or unidentifiable PTY tree is
   *    exactly what must not be silently granted — and every refusal names
   *    the session, pgid and owner pid needed to resolve it by hand, plus a
   *    cause-specific recovery line (`recoveryHint`) that asks an operator to
   *    INSPECT a group before acting whenever that group was not proven to be
   *    the dead host's.
   */
  async #reconcileDeadHostOrphans(options: {
    requireReapedForOwnerPid?: number;
  } = {}): Promise<void> {
    let summary;
    try {
      summary = await reconcileDeadHostOrphans({
        ...(this.#registryPath !== undefined ? { registryPath: this.#registryPath } : {}),
        ownerProbe: this.#ownerProbe,
        ...(this.#reapOrphan !== undefined ? { reap: this.#reapOrphan } : {}),
        log: this.#log,
      });
    } catch (error) {
      this.#log(
        `native-terminal orphan reconcile failed: ${String(error)}`,
      );
      if (options.requireReapedForOwnerPid === undefined) return;
      // The pass itself failed while this supervisor owed a specific proof for
      // a host IT killed. That is a containment failure, not a hiccup — and it
      // must be TYPED: a raw error here reaches the readiness loop as "the host
      // is not ready yet" and is retried every poll interval until the
      // deadline (the reconcile-storm shape), instead of being surfaced once.
      // Defence in depth: `reconcileDeadHostOrphans` now contains every
      // per-entry failure itself, so this path is not reachable through any
      // injected seam.
      if (error instanceof NativeTerminalContainmentError) throw error;
      throw new NativeTerminalContainmentError(
        `forced native-terminal host reap could not complete its durable PTY inspection: ${String(error)}`,
        {
          socketPath: this.#socketPath,
          ownerPid: options.requireReapedForOwnerPid,
          outcomeStatus: "reconcile-threw",
        },
      );
    }
    if (summary.status === "refused") {
      // An unreadable registry is an absence of information, not evidence of
      // a surviving group: it stays best-effort unless this supervisor owes a
      // specific proof for its own killed host.
      if (options.requireReapedForOwnerPid === undefined) return;
      throw new NativeTerminalContainmentError(
        `forced native-terminal host reap could not inspect durable PTY groups: ${summary.reason}`,
        {
          socketPath: this.#socketPath,
          ownerPid: options.requireReapedForOwnerPid,
          outcomeStatus: "registry-unreadable",
        },
      );
    }
    if (options.requireReapedForOwnerPid !== undefined) {
      const unconfirmed = summary.outcomes.find(
        (outcome) =>
          "ownerPid" in outcome &&
          outcome.ownerPid === options.requireReapedForOwnerPid &&
          !dischargesOwnedHostProof(outcome),
      );
      if (unconfirmed !== undefined) {
        throw new NativeTerminalContainmentError(
          `forced native-terminal host reap did not confirm owner pid=${options.requireReapedForOwnerPid} session ${unconfirmed.sessionId}: ${unconfirmed.status}`,
          {
            socketPath: this.#socketPath,
            sessionId: unconfirmed.sessionId,
            outcomeStatus: unconfirmed.status,
            ownerPid: options.requireReapedForOwnerPid,
            ...("pgid" in unconfirmed ? { pgid: unconfirmed.pgid } : {}),
            ...("cause" in unconfirmed && unconfirmed.cause !== undefined
              ? { refusalCause: unconfirmed.cause }
              : {}),
          },
        );
      }
    }
    // Checked after the owner-specific proof above so this supervisor's own
    // killed host keeps its precise diagnostic; this one covers every OTHER
    // proven-dead owner of the same socket.
    for (const outcome of summary.outcomes) {
      if (
        outcome.status !== "reap-refused" &&
        outcome.status !== "reap-timed-out" &&
        outcome.status !== "reap-failed"
      ) continue;
      if (
        outcome.ownerSocketPath === undefined ||
        resolve(outcome.ownerSocketPath) !== this.#socketPath
      ) continue;
      if (outcome.status === "reap-refused" && !provesASurvivingGroup(outcome.cause)) {
        continue;
      }
      // A `reap-failed` taken before the owner probe answered proves nothing
      // about the owner either — the containment is identical, but the message
      // must not assert a death nobody proved.
      const ownership =
        outcome.status === "reap-failed" && outcome.ownerDeathUnproven === true
          ? `owned by host pid=${outcome.ownerPid} (whose own death was never proven)`
          : `owned by proven-dead host pid=${outcome.ownerPid}`;
      throw new NativeTerminalContainmentError(
        `native terminal socket ${this.#socketPath} is contained: session ${outcome.sessionId} pgid=${outcome.pgid} ${ownership} was not confirmed reaped (${outcome.status}${outcome.status === "reap-refused" && outcome.cause !== undefined ? `/${outcome.cause}` : ""}); refusing to start or adopt a host over a surviving PTY group. ${recoveryHint(outcome)}`,
        {
          socketPath: this.#socketPath,
          sessionId: outcome.sessionId,
          outcomeStatus: outcome.status,
          ownerPid: outcome.ownerPid,
          pgid: outcome.pgid,
          ...(outcome.status === "reap-refused" && outcome.cause !== undefined
            ? { refusalCause: outcome.cause }
            : {}),
        },
      );
    }
  }

  #recordSpawnFailure(error: Error): void {
    this.#consecutiveSpawnFailures += 1;
    const delayMs = Math.min(
      NATIVE_TERMINAL_SPAWN_BACKOFF_BASE_MS *
        2 ** (this.#consecutiveSpawnFailures - 1),
      NATIVE_TERMINAL_SPAWN_BACKOFF_MAX_MS,
    );
    this.#nextSpawnAllowedAt = this.#now() + delayMs;
    this.#lastSpawnFailure = error;
  }

  #resetSpawnBackoff(): void {
    this.#consecutiveSpawnFailures = 0;
    this.#nextSpawnAllowedAt = 0;
    this.#lastSpawnFailure = undefined;
  }
}
