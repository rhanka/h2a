import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { NativeTerminalClient } from "./client.js";
import {
  defaultOwnerHostProbe,
  reconcileDeadHostOrphans,
  type NativeTerminalOwnerHostProbe,
  type NativeTerminalReapOutcome,
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
    this.#socketPath = options.socketPath;
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
    } catch {
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
   * One pass per connection HAND-OUT, not per request: `client()` returns its
   * cached client after a plain ping, so this runs when a connection is newly
   * established — startup, and each host replacement — never on the hot path.
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
   * that PROVED an owner dead and then could not confirm its reap is positive
   * evidence that a PTY group has outlived its host and is STILL ALIVE:
   * `reapOrphan` short-circuits to `reaped` whenever the OS already reports
   * the group empty, so a `reap-timed-out`, or a `reap-refused` carrying a
   * cause (`recycled`, `membership-unprovable`, `pgid-mismatch`,
   * `unsupported-process-groups`), is never "the group was already gone".
   * Publishing a replacement host, or adopting a competitor's, on that socket
   * would resume terminal work over that group — the invisible-orphan bug
   * this whole mechanism exists to close. So any such outcome whose row is
   * attributed to THIS socket throws, whether or not the dead owner was ever
   * this supervisor's child.
   *
   * A CAUSE-LESS `reap-refused` is deliberately excluded: it means only that
   * the pgid could not be resolved, which is exactly what the loser of a race
   * between two reconcile passes sees once the winner confirmed the reap and
   * pruned the row. Treating that as a surviving group would convert a
   * successful concurrent containment into an outage.
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
   *    the session, pgid and owner pid needed to resolve it by hand.
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
      if (options.requireReapedForOwnerPid !== undefined) throw error;
      return;
    }
    if (summary.status === "refused") {
      // An unreadable registry is an absence of information, not evidence of
      // a surviving group: it stays best-effort unless this supervisor owes a
      // specific proof for its own killed host.
      if (options.requireReapedForOwnerPid === undefined) return;
      throw new Error(
        `forced native-terminal host reap could not inspect durable PTY groups: ${summary.reason}`,
      );
    }
    if (options.requireReapedForOwnerPid !== undefined) {
      const unconfirmed = summary.outcomes.find(
        (outcome) =>
          "ownerPid" in outcome &&
          outcome.ownerPid === options.requireReapedForOwnerPid &&
          outcome.status !== "reaped",
      );
      if (unconfirmed !== undefined) {
        throw new Error(
          `forced native-terminal host reap did not confirm owner pid=${options.requireReapedForOwnerPid} session ${unconfirmed.sessionId}: ${unconfirmed.status}`,
        );
      }
    }
    // Checked after the owner-specific proof above so this supervisor's own
    // killed host keeps its precise diagnostic; this one covers every OTHER
    // proven-dead owner of the same socket.
    for (const outcome of summary.outcomes) {
      if (
        outcome.status !== "reap-refused" &&
        outcome.status !== "reap-timed-out"
      ) continue;
      if (outcome.ownerSocketPath !== this.#socketPath) continue;
      // A refusal with NO cause did not observe a surviving group at all: the
      // pgid simply could not be resolved, which is what a supervisor racing
      // another one sees after the OTHER pass confirmed the reap and pruned
      // the row (reconcile prunes on "reaped" only). Blocking there would
      // turn a successful concurrent containment into an outage.
      if (outcome.status === "reap-refused" && outcome.cause === undefined) {
        continue;
      }
      throw new Error(
        `native terminal socket ${this.#socketPath} is contained: session ${outcome.sessionId} pgid=${outcome.pgid} owned by proven-dead host pid=${outcome.ownerPid} was not confirmed reaped (${outcome.status}${outcome.status === "reap-refused" ? `/${outcome.cause}` : ""}); refusing to start or adopt a host over a surviving PTY group`,
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
