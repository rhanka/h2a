export type NativeRestartGatewayOption = "on" | "off";
export type NativeRestartGatewayMode = "auto" | "gateway" | "direct";

export type NativeRestartRequest = Readonly<{
  target?: string;
  all?: boolean;
  gateway?: NativeRestartGatewayOption;
  relaunchMcp?: string;
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
}>;

export type NativeRestartSnapshot =
  | Readonly<{
      state: "live";
      generation: string;
      incarnation: string;
      controlled: boolean;
    }>
  | Readonly<{ state: "dead" }>
  | Readonly<{ state: "unknown" }>;

export type NativeRestartInstructionOutcome =
  | "driven"
  | "deferred"
  | "unresolved"
  | "failed";

export interface NativeRestartDependencies<Prepared = unknown> {
  listSessions(): readonly NativeRestartCandidate[];
  snapshot(session: NativeRestartCandidate): NativeRestartSnapshot;
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
  ): void | Promise<void>;
  drive(
    session: NativeRestartCandidate,
    instruction: string,
  ): NativeRestartInstructionOutcome | Promise<NativeRestartInstructionOutcome>;
}

export type NativeRestartFailure =
  | "restart-failed"
  | "instruction-deferred"
  | "instruction-unresolved"
  | "instruction-failed";

export type NativeRestartSessionResult = Readonly<{
  id: string;
  name: string;
  requested: "restart" | "inject" | "restart-and-inject";
  state: "completed" | "failed" | "not-attempted";
  gatewayMode: NativeRestartGatewayMode;
  restarted: boolean;
  instructionSubmitted: boolean;
  failure?: NativeRestartFailure;
}>;

export type NativeRestartResult = Readonly<{
  kind: "h2a.restart.result";
  version: 1;
  ok: boolean;
  scope: "session" | "all";
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
  return session.gatewayMode ?? "auto";
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
  return request.gateway === undefined ? "inject" : "restart-and-inject";
}

/**
 * Execute a native-session restart plan through injected effects. Selection,
 * tri-state liveness and every gateway preparation complete before the first
 * destructive call. Once effects begin, the result keeps prior successes and
 * marks the untouched suffix explicitly if a session fails.
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
    live.push({ session, snapshot });
  }
  if (live.length === 0) {
    throw new NativeRestartError(
      "no-live-sessions",
      "no live managed native CLI sessions matched restart",
    );
  }

  const action = requestedAction(request);
  const shouldRestart = action !== "inject";
  const prepared: Prepared[] = [];
  if (shouldRestart) {
    for (const item of live) {
      try {
        prepared.push(
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

  const rows: NativeRestartSessionResult[] = live.map(({ session }) => ({
    id: session.id,
    name: session.name,
    requested: action,
    state: "not-attempted",
    gatewayMode: gatewayMode(session, request.gateway),
    restarted: false,
    instructionSubmitted: false,
  }));
  let stopped = false;
  const instruction = request.relaunchMcp === undefined
    ? undefined
    : nativeMcpRelaunchInstruction(request.relaunchMcp);

  for (let index = 0; index < live.length; index += 1) {
    if (stopped) break;
    const item = live[index]!;
    const row = rows[index]!;
    let restarted = false;
    if (shouldRestart) {
      try {
        await dependencies.restart(
          item.session,
          item.snapshot,
          row.gatewayMode,
          prepared[index]!,
        );
        restarted = true;
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
    };
  }

  return {
    kind: "h2a.restart.result",
    version: 1,
    ok: rows.every((row) => row.state === "completed"),
    scope: request.all === true ? "all" : "session",
    sessions: rows,
  };
}
