import { profileUsesLlmMeshGateway } from "./protocol-local.js";

export type NativeRestartGatewayOption = "on" | "off";
export type NativeRestartGatewayMode = "auto" | "gateway" | "direct";
export type NativeRestartGatewayDisplay = "on" | "off" | "n/a";

export type NativeRestartRequest = Readonly<{
  target?: string;
  all?: boolean;
  gateway?: NativeRestartGatewayOption;
  relaunchMcp?: string;
  soft?: boolean;
  allowHard?: boolean;
  continueOnError?: boolean;
  includeSelf?: boolean;
  dryRun?: boolean;
  currentSession?: string;
}>;

export type NativeRestartCandidate = Readonly<{
  id: string;
  label?: string;
  name: string;
  kind: string;
  role?: string;
  endedAt?: string;
  profile: string;
  cwd: string;
  convId?: string;
  sessionClass?: "human" | "background";
  gatewayMode?: "gateway" | "direct";
  /** Provenance of the gateway pin ("explicit" only; legacy rows omit it). */
  gatewayProvenance?: "explicit";
  /** Pinned Claude `--bare` choice, carried from the registry row so a restart reproduces it. */
  bare?: boolean;
}>;

export type NativeRestartSnapshot =
  | Readonly<{
      state: "live";
      generation: string;
      incarnation: string;
      controlled: boolean;
      pid?: number;
      latestSeq?: number;
      socketPath?: string;
    }>
  | Readonly<{ state: "dead" }>
  | Readonly<{ state: "unknown" }>;

export type NativeRestartInstructionOutcome =
  | "driven"
  | "deferred"
  | "unresolved"
  | "failed";

export type NativeRestartHealthCheckResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: string }>;

export type NativeRestartHealthCheckContext = Readonly<{
  soft: boolean;
  gatewayMode: NativeRestartGatewayMode;
  restartResult?: unknown;
}>;

export interface NativeRestartDependencies<Prepared = unknown> {
  listSessions(): readonly NativeRestartCandidate[];
  snapshot(session: NativeRestartCandidate): NativeRestartSnapshot;
  checkGatewayModels?(): void | Promise<void>;
  prepare(
    session: NativeRestartCandidate,
    snapshot: Extract<NativeRestartSnapshot, { state: "live" }>,
    gatewayMode: NativeRestartGatewayMode,
  ): Prepared | Promise<Prepared>;
  restart(
    session: NativeRestartCandidate,
    snapshot: Extract<NativeRestartSnapshot, { state: "live" }>,
    gatewayMode: NativeRestartGatewayMode,
    prepared: Prepared,
  ): unknown | Promise<unknown>;
  softRestart?(
    session: NativeRestartCandidate,
    snapshot: Extract<NativeRestartSnapshot, { state: "live" }>,
    gatewayMode: NativeRestartGatewayMode,
    prepared: Prepared,
  ): unknown | Promise<unknown>;
  healthCheck?(
    session: NativeRestartCandidate,
    snapshot: Extract<NativeRestartSnapshot, { state: "live" }>,
    context: NativeRestartHealthCheckContext,
  ): NativeRestartHealthCheckResult | Promise<NativeRestartHealthCheckResult>;
  drive(
    session: NativeRestartCandidate,
    instruction: string,
  ): NativeRestartInstructionOutcome | Promise<NativeRestartInstructionOutcome>;
}

export type NativeRestartFailure =
  | "restart-failed"
  | "host-soft-restart-unsupported"
  | "health-check-failed"
  | "instruction-deferred"
  | "instruction-unresolved"
  | "instruction-failed";

export type NativeRestartSkipReason =
  | "no-gateway-lever"
  | "self-session";

export type NativeRestartStrategy =
  | "soft"
  | "hard"
  | "hard-fallback";

export type NativeRestartSessionResult = Readonly<{
  id: string;
  name: string;
  host?: string;
  requested: "restart" | "inject" | "restart-and-inject";
  state: "completed" | "failed" | "not-attempted" | "skipped" | "dry-run";
  gatewayBefore?: NativeRestartGatewayDisplay;
  gatewayMode: NativeRestartGatewayMode;
  restarted: boolean;
  instructionSubmitted: boolean;
  strategy?: NativeRestartStrategy;
  ptyPreserved?: boolean;
  skipReason?: NativeRestartSkipReason;
  failure?: NativeRestartFailure;
  detail?: string;
}>;

export type NativeRestartResult = Readonly<{
  kind: "h2a.restart.result";
  version: 1;
  ok: boolean;
  scope: "session" | "all";
  soft?: boolean;
  dryRun?: boolean;
  sessions: readonly NativeRestartSessionResult[];
}>;

export class NativeRestartError extends Error {
  readonly code:
    | "invalid-request"
    | "ambiguous-session"
    | "session-not-found"
    | "session-not-live"
    | "host-state-unknown"
    | "no-live-sessions"
    | "duplicate-session"
    | "registry-unreadable"
    | "gateway-models-unavailable"
    | "gateway-preparation-failed";

  constructor(code: NativeRestartError["code"], message: string) {
    super(message);
    this.name = "NativeRestartError";
    this.code = code;
  }
}

const MCP_NAME = /^[A-Za-z0-9._:-]{1,64}$/u;

export function nativeMcpRelaunchInstruction(name: string): string {
  if (!MCP_NAME.test(name)) {
    throw new NativeRestartError(
      "invalid-request",
      "--relaunch-mcp must contain 1-64 characters from A-Z, a-z, 0-9, dot, underscore, colon or hyphen",
    );
  }
  return `[h2a restart] Relaunch or attach MCP server "${name}" in this live CLI now, then verify one of its tools before reporting success.`;
}

function validateRequest(request: NativeRestartRequest): void {
  const hasTarget = request.target !== undefined && request.target.trim().length > 0;
  const hasAll = request.all === true;
  if (hasTarget === hasAll) {
    throw new NativeRestartError(
      "invalid-request",
      "restart requires exactly one session name or --all",
    );
  }
  if (
    request.gateway !== undefined &&
    request.gateway !== "on" &&
    request.gateway !== "off"
  ) {
    throw new NativeRestartError(
      "invalid-request",
      "--gw must be exactly on or off",
    );
  }
  if (request.allowHard === true && request.soft !== true) {
    throw new NativeRestartError(
      "invalid-request",
      "--allow-hard requires --soft",
    );
  }
  if (request.relaunchMcp !== undefined) {
    nativeMcpRelaunchInstruction(request.relaunchMcp);
  }
}

function gatewayMode(
  session: NativeRestartCandidate,
  requested: NativeRestartGatewayOption | undefined,
): NativeRestartGatewayMode {
  if (requested === "on") return "gateway";
  if (requested === "off") return "direct";
  // A pinned direct posture is honored verbatim (it can only keep the session
  // off the gateway). A legacy gateway pin without provenance never selects
  // the gateway on its own.
  if (session.gatewayMode === "direct") return "direct";
  if (session.gatewayProvenance !== "explicit") return "auto";
  return session.gatewayMode ?? "auto";
}

function gatewayBeforeDisplay(
  session: NativeRestartCandidate,
): NativeRestartGatewayDisplay {
  if (!profileUsesLlmMeshGateway(session.profile)) return "n/a";
  if (
    session.gatewayMode === "gateway" &&
    session.gatewayProvenance === "explicit"
  ) {
    return "on";
  }
  return "off";
}

function gatewayAfterDisplay(
  row: NativeRestartSessionResult,
): NativeRestartGatewayDisplay {
  const before = row.gatewayBefore ?? "off";
  if (before === "n/a") return "n/a";
  if (
    row.state === "skipped" ||
    row.state === "not-attempted" ||
    (row.state === "failed" && !row.restarted)
  ) {
    return before;
  }
  return row.gatewayMode === "gateway" ? "on" : "off";
}

function isSelfSession(
  session: NativeRestartCandidate,
  currentSession: string | undefined,
): boolean {
  if (!currentSession || currentSession.trim().length === 0) return false;
  return session.name === currentSession || session.id === currentSession;
}

function skipReasonFor(
  session: NativeRestartCandidate,
  request: NativeRestartRequest,
): NativeRestartSkipReason | undefined {
  if (
    request.all === true &&
    request.includeSelf !== true &&
    isSelfSession(session, request.currentSession)
  ) {
    return "self-session";
  }
  if (
    request.gateway !== undefined &&
    !profileUsesLlmMeshGateway(session.profile)
  ) {
    return "no-gateway-lever";
  }
  return undefined;
}

function isSoftRestartUnsupportedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "host-soft-restart-unsupported"
  );
}

function selectSessions(
  request: NativeRestartRequest,
  candidates: readonly NativeRestartCandidate[],
): NativeRestartCandidate[] {
  const managed = candidates.filter(
    (session) =>
      session.kind === "local-native" &&
      session.role === undefined &&
      session.endedAt === undefined,
  );
  if (request.target !== undefined) {
    const target = request.target;
    const matches = managed.filter(
      (session) =>
        session.id === target ||
        session.label === target ||
        session.name === target,
    );
    if (matches.length === 0) {
      throw new NativeRestartError(
        "session-not-found",
        `managed native session not found: ${target}`,
      );
    }
    if (matches.length !== 1) {
      throw new NativeRestartError(
        "ambiguous-session",
        `managed native session is ambiguous: ${target}`,
      );
    }
    return matches;
  }

  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const session of managed) {
    if (seenIds.has(session.id) || seenNames.has(session.name)) {
      throw new NativeRestartError(
        "duplicate-session",
        `duplicate managed native session: ${session.id}`,
      );
    }
    seenIds.add(session.id);
    seenNames.add(session.name);
  }
  return managed.slice().sort((left, right) => left.id.localeCompare(right.id));
}

function requestedAction(
  request: NativeRestartRequest,
): NativeRestartSessionResult["requested"] {
  if (request.relaunchMcp === undefined) return "restart";
  return request.gateway === undefined && request.soft !== true
    ? "inject"
    : "restart-and-inject";
}

function includeExtendedMetadata(request: NativeRestartRequest): boolean {
  return (
    request.all === true ||
    request.soft === true ||
    request.dryRun === true
  );
}

/**
 * Execute a native-session restart plan through injected effects. Selection,
 * tri-state liveness, `--gw on` model-availability verification, and every
 * gateway preparation complete before the first destructive call. Once effects
 * begin, the result keeps prior successes, skips non-applicable rows with a
 * named reason, and marks the untouched suffix explicitly if a session fails
 * (unless `--continue` is passed).
 */
export async function executeNativeRestart<Prepared>(
  request: NativeRestartRequest,
  dependencies: NativeRestartDependencies<Prepared>,
): Promise<NativeRestartResult> {
  validateRequest(request);
  const selected = selectSessions(request, dependencies.listSessions());
  const live: Array<{
    session: NativeRestartCandidate;
    snapshot: Extract<NativeRestartSnapshot, { state: "live" }>;
    skipReason: NativeRestartSkipReason | undefined;
  }> = [];
  for (const session of selected) {
    const snapshot = dependencies.snapshot(session);
    if (snapshot.state === "unknown") {
      throw new NativeRestartError(
        "host-state-unknown",
        `native host state is unknown for ${session.id}`,
      );
    }
    if (snapshot.state === "dead") {
      if (request.target !== undefined) {
        throw new NativeRestartError(
          "session-not-live",
          `native session is not live: ${session.id}`,
        );
      }
      continue;
    }
    live.push({
      session,
      snapshot,
      skipReason: skipReasonFor(session, request),
    });
  }
  if (live.length === 0) {
    throw new NativeRestartError(
      "no-live-sessions",
      "no live managed native CLI sessions matched restart",
    );
  }

  // `--gw on` must verify that the local gateway serves at least one model on
  // `/v1/models` BEFORE preparing tokens or touching any session.
  if (
    request.gateway === "on" &&
    dependencies.checkGatewayModels !== undefined
  ) {
    try {
      await dependencies.checkGatewayModels();
    } catch (error) {
      if (error instanceof NativeRestartError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new NativeRestartError(
        "gateway-models-unavailable",
        detail || "local llm-mesh gateway serves no models on /v1/models",
      );
    }
  }

  const action = requestedAction(request);
  const shouldRestart = action !== "inject";
  const extended = includeExtendedMetadata(request);

  if (request.dryRun === true) {
    const dryRunRows: NativeRestartSessionResult[] = live.map(
      ({ session, skipReason }) => ({
        id: session.id,
        name: session.name,
        host: session.profile,
        requested: action,
        state: skipReason !== undefined ? "skipped" : "dry-run",
        gatewayBefore: gatewayBeforeDisplay(session),
        gatewayMode:
          skipReason !== undefined
            ? "direct"
            : gatewayMode(session, request.gateway),
        restarted: false,
        instructionSubmitted: false,
        ...(skipReason !== undefined ? { skipReason } : {}),
      }),
    );
    return {
      kind: "h2a.restart.result",
      version: 1,
      ok: true,
      scope: request.all === true ? "all" : "session",
      ...(request.soft === true ? { soft: true } : {}),
      dryRun: true,
      sessions: dryRunRows,
    };
  }

  const preparedByIndex = new Map<number, Prepared>();
  if (shouldRestart) {
    for (let index = 0; index < live.length; index += 1) {
      const item = live[index]!;
      if (item.skipReason !== undefined) continue;
      try {
        preparedByIndex.set(
          index,
          await dependencies.prepare(
            item.session,
            item.snapshot,
            gatewayMode(item.session, request.gateway),
          ),
        );
      } catch {
        throw new NativeRestartError(
          "gateway-preparation-failed",
          `restart preflight failed for ${item.session.id}`,
        );
      }
    }
  }

  const rows: NativeRestartSessionResult[] = live.map(
    ({ session, skipReason }) => ({
      id: session.id,
      name: session.name,
      ...(extended || skipReason !== undefined ? { host: session.profile } : {}),
      requested: action,
      state: skipReason !== undefined ? "skipped" : "not-attempted",
      ...(extended || skipReason !== undefined
        ? { gatewayBefore: gatewayBeforeDisplay(session) }
        : {}),
      gatewayMode:
        skipReason !== undefined
          ? "direct"
          : gatewayMode(session, request.gateway),
      restarted: false,
      instructionSubmitted: false,
      ...(skipReason !== undefined ? { skipReason } : {}),
    }),
  );

  let stopped = false;
  const instruction = request.relaunchMcp === undefined
    ? undefined
    : nativeMcpRelaunchInstruction(request.relaunchMcp);

  for (let index = 0; index < live.length; index += 1) {
    const item = live[index]!;
    if (item.skipReason !== undefined) continue;
    if (stopped && request.continueOnError !== true) break;

    const row = rows[index]!;
    let restarted = false;
    let strategy: NativeRestartStrategy | undefined;
    let ptyPreserved: boolean | undefined;
    let restartResult: unknown;

    if (shouldRestart) {
      const prepared = preparedByIndex.get(index)!;
      if (request.soft === true) {
        try {
          if (dependencies.softRestart === undefined) {
            throw Object.assign(
              new Error("host-soft-restart-unsupported: soft restart handler unavailable"),
              { code: "host-soft-restart-unsupported" },
            );
          }
          restartResult = await dependencies.softRestart(
            item.session,
            item.snapshot,
            row.gatewayMode,
            prepared,
          );
          restarted = true;
          strategy = "soft";
          ptyPreserved = true;
        } catch (error) {
          if (isSoftRestartUnsupportedError(error)) {
            if (request.allowHard === true) {
              try {
                restartResult = await dependencies.restart(
                  item.session,
                  item.snapshot,
                  row.gatewayMode,
                  prepared,
                );
                restarted = true;
                strategy = "hard-fallback";
                ptyPreserved = false;
              } catch (hardError) {
                rows[index] = {
                  ...row,
                  state: "failed",
                  failure: "restart-failed",
                  ...(hardError instanceof Error && hardError.message
                    ? { detail: hardError.message }
                    : {}),
                };
                stopped = true;
                continue;
              }
            } else {
              rows[index] = {
                ...row,
                state: "failed",
                failure: "host-soft-restart-unsupported",
                ...(error instanceof Error && error.message
                  ? { detail: error.message }
                  : {}),
              };
              stopped = true;
              continue;
            }
          } else {
            rows[index] = {
              ...row,
              state: "failed",
              failure: "restart-failed",
              ...(error instanceof Error && error.message
                ? { detail: error.message }
                : {}),
            };
            stopped = true;
            continue;
          }
        }
      } else {
        try {
          restartResult = await dependencies.restart(
            item.session,
            item.snapshot,
            row.gatewayMode,
            prepared,
          );
          restarted = true;
          if (extended) {
            strategy = "hard";
            ptyPreserved = false;
          }
        } catch {
          rows[index] = {
            ...row,
            state: "failed",
            failure: "restart-failed",
          };
          stopped = true;
          continue;
        }
      }
    }

    if (restarted && dependencies.healthCheck !== undefined) {
      let health: NativeRestartHealthCheckResult;
      try {
        health = await dependencies.healthCheck(item.session, item.snapshot, {
          soft: strategy === "soft",
          gatewayMode: row.gatewayMode,
          ...(restartResult !== undefined ? { restartResult } : {}),
        });
      } catch (error) {
        health = {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      if (!health.ok) {
        rows[index] = {
          ...row,
          state: "failed",
          restarted: true,
          ...(strategy !== undefined ? { strategy } : {}),
          ...(ptyPreserved !== undefined ? { ptyPreserved } : {}),
          failure: "health-check-failed",
          detail: health.reason,
        };
        stopped = true;
        continue;
      }
    }

    if (instruction !== undefined) {
      let outcome: NativeRestartInstructionOutcome;
      try {
        outcome = await dependencies.drive(item.session, instruction);
      } catch {
        outcome = "failed";
      }
      if (outcome !== "driven") {
        rows[index] = {
          ...row,
          state: "failed",
          restarted,
          ...(strategy !== undefined ? { strategy } : {}),
          ...(ptyPreserved !== undefined ? { ptyPreserved } : {}),
          failure: outcome === "deferred"
            ? "instruction-deferred"
            : outcome === "unresolved"
              ? "instruction-unresolved"
              : "instruction-failed",
        };
        stopped = true;
        continue;
      }
    }

    rows[index] = {
      ...row,
      state: "completed",
      restarted,
      instructionSubmitted: instruction !== undefined,
      ...(strategy !== undefined ? { strategy } : {}),
      ...(ptyPreserved !== undefined ? { ptyPreserved } : {}),
    };
  }

  return {
    kind: "h2a.restart.result",
    version: 1,
    ok: rows.every(
      (row) =>
        row.state === "completed" ||
        row.state === "skipped" ||
        row.state === "dry-run",
    ),
    scope: request.all === true ? "all" : "session",
    ...(request.soft === true ? { soft: true } : {}),
    sessions: rows,
  };
}

function describeRowOutcome(
  row: NativeRestartSessionResult,
  softRequested: boolean,
): string {
  if (row.state === "dry-run") {
    const verb =
      row.requested === "inject"
        ? "inject"
        : softRequested
          ? "soft-restart"
          : "hard-restart";
    return `dry-run (would ${verb})`;
  }
  if (row.state === "skipped") {
    return `skipped (${row.skipReason ?? "skipped"})`;
  }
  if (row.state === "not-attempted") {
    return "not-attempted";
  }
  if (row.state === "failed") {
    const code = row.failure ?? "failed";
    return row.detail && !row.detail.includes(code)
      ? `failed (${code}: ${row.detail})`
      : `failed (${code})`;
  }
  // completed
  if (row.strategy === "soft") {
    return row.instructionSubmitted
      ? "soft-restarted (pty kept) + mcp-instructed"
      : "soft-restarted (pty kept)";
  }
  if (row.strategy === "hard-fallback") {
    return "hard-restarted (fallback: host-soft-restart-unsupported)";
  }
  if (row.restarted) {
    return row.instructionSubmitted
      ? "hard-restarted + mcp-instructed"
      : "hard-restarted";
  }
  return row.instructionSubmitted ? "mcp-instructed" : "completed";
}

/**
 * Render the final restart summary table with columns:
 * SESSION | HOST | GW (before → after) | RESULT.
 * Credential-free by construction (never sees or prints tokens).
 */
export function formatNativeRestartTable(result: NativeRestartResult): string {
  const softRequested = result.soft === true;
  const rows = result.sessions.map((row) => {
    const before = row.gatewayBefore ?? "off";
    const after = gatewayAfterDisplay(row);
    return {
      session: row.id,
      host: row.host ?? "unknown",
      gw: `${before} → ${after}`,
      result: describeRowOutcome(row, softRequested),
    };
  });

  const headers = {
    session: "SESSION",
    host: "HOST",
    gw: "GW",
    result: "RESULT",
  };
  const wSession = Math.max(headers.session.length, ...rows.map((r) => r.session.length));
  const wHost = Math.max(headers.host.length, ...rows.map((r) => r.host.length));
  const wGw = Math.max(headers.gw.length, ...rows.map((r) => r.gw.length));

  const lines = [
    `${headers.session.padEnd(wSession)}  ${headers.host.padEnd(wHost)}  ${headers.gw.padEnd(wGw)}  ${headers.result}`,
    ...rows.map(
      (r) =>
        `${r.session.padEnd(wSession)}  ${r.host.padEnd(wHost)}  ${r.gw.padEnd(wGw)}  ${r.result}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}
