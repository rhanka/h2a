/**
 * Native-PTY-backed session management — the tmux.ts twin for sessions hosted
 * by the native terminal host (native-terminal/*) instead of a tmux server.
 *
 * Shape contract: every function here is SYNCHRONOUS and tmux-shaped, so the
 * session verbs in index.ts can branch between hosts without changing their
 * own structure. The async unix-socket protocol is bridged by shelling out to
 * the compiled one-shot entrypoint (native-terminal/op.js), exactly the way
 * tmux.ts shells out to the `tmux` binary. The native host process itself is
 * the long-lived "server" (the tmux-server twin): it is spawned on first use,
 * survives CLI exits, and owns every PTY.
 *
 * Sessions reuse the h2a-<slug> naming contract from tmux.ts so slugs,
 * addressing and registry entries stay uniform across hosts.
 */
import { spawnSync, execFile } from "node:child_process";
import type { ClaudeNativeDeliveryDeps } from "./claude-native-driver.js";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { nativePtyRequirements } from "./pty.js";
import {
  HEADLESS_TERMINAL_SIZE,
  HEADLESS_WRAPPER,
  LOCAL_WRAPPER,
  STRUCTURED_LOCAL_WRAPPER,
  localRelaunchCommand,
  localSessionName,
  procReaderDeps,
  slugify,
  createStructuredReadinessChallenge,
  cleanupStructuredReadinessChallenge,
  probeStructuredReadiness,
} from "./tmux.js";
import { readProcessTreeCpuMs, readWorkerPid, parseProcStat } from "./proc-cpu.js";
import { sleepSync, type PromptDeliveryDeps } from "./prompt-delivery.js";
import { SESSION_CLASS_ENV, type SessionClass } from "./session-class.js";
import { withAttachTerminalRecovery } from "./native-terminal/attach-recovery.js";

const OP_TIMEOUT_MS = 15_000;
let launchDeadline: number | undefined;
/** Confined to one CLI run action; guard subprocesses keep their independent cleanup budget. */
export function setNativeLaunchDeadline(deadline: number): () => void {
  const previous = launchDeadline;
  launchDeadline = deadline;
  return () => { launchDeadline = previous; };
}
const H2A_NATIVE_TARGET_SESSION_ENV = "H2A_NATIVE_TARGET_SESSION";

export type SessionHostKind = "native" | "local-tmux";

/**
 * Which host runs a NEW session's terminal. The native PTY host is the
 * default; `--tmux` (per command) or H2A_SESSION_HOST=tmux (fleet-wide safety
 * valve) selects tmux. Existing sessions are NEVER re-routed here — verbs that
 * act on a recorded session honor its registry kind instead.
 */
export function resolveSessionHostKind(
  opts: { readonly tmux?: boolean },
  env: Readonly<Record<string, string | undefined>> = process.env,
): SessionHostKind {
  if (opts.tmux === true) return "local-tmux";
  if ((env["H2A_SESSION_HOST"] ?? "").toLowerCase() === "tmux") {
    return "local-tmux";
  }
  return "native";
}

/** Companion native session that hosts the h2a MCP sidecar for `name`. */
export function nativeSidecarName(name: string): string {
  return `${name}.h2a`;
}

export type NativeSessionState = {
  readonly socketPath?: string;
  readonly id: string;
  readonly generation: string;
  readonly incarnation: string;
  readonly pid: number;
  readonly status: "running" | "stopping" | "exited";
  readonly exit: { readonly exitCode: number; readonly signal?: number } | null;
  /**
   * Controller-visibility bit (never the controller's identity): true when an
   * exclusive input controller is attached. OPTIONAL because an older running
   * host does not report it — consumers must treat absence as an UNKNOWN view
   * and fail closed (report, don't relaunch), never as "uncontrolled".
   */
  readonly controlled?: boolean;
};

export type NativeStartResult = {
  readonly name: string;
  readonly slug: string;
  readonly pid: number;
};

function opEntryPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const sibling = join(here, "native-terminal", "op.js");
  if (existsSync(sibling)) return sibling;
  // Under vitest this module executes from src/, where only op.ts lives — the
  // runnable entrypoint is the COMPILED twin in dist/. Production always runs
  // from dist/ and takes the first branch (its sibling op.js exists), so this
  // fallback is reachable only from a src/ execution context. When neither
  // exists, return the sibling path so the spawn fails with the same loud
  // MODULE_NOT_FOUND as before (an unbuilt tree must not fail silently).
  if (basename(here) === "src") {
    const built = join(dirname(here), "dist", "native-terminal", "op.js");
    if (existsSync(built)) return built;
  }
  return sibling;
}

/** node-pty loadable + containment binaries present. Pure preflight. */
export function nativeHostAvailable():
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string } {
  return nativePtyRequirements();
}

function runOp(
  args: ReadonlyArray<string>,
  options: { allowFailure?: boolean; onCreateAttempt?: (() => void) | undefined; socketPath?: string | undefined } = {},
): { status: number; payload: unknown } {
  options.onCreateAttempt?.();
  const timeout = launchDeadline === undefined ? OP_TIMEOUT_MS : Math.min(OP_TIMEOUT_MS, Math.floor(launchDeadline - Date.now()));
  if (timeout <= 0) throw new Error("native launch deadline expired");
  const r = spawnSync(process.execPath, [opEntryPath(), ...args, ...(options.socketPath ? ["--socket", options.socketPath] : [])], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  });
  if (r.error) {
    throw new Error(
      `native host operation ${args.join(" ")} failed: ${r.error.message}`,
      { cause: r.error },
    );
  }
  const status = r.status ?? 1;
  let payload: unknown;
  const stdout = (r.stdout ?? "").trim();
  if (stdout.length > 0) {
    try {
      payload = JSON.parse(stdout.split("\n").pop()!);
    } catch {
      payload = undefined;
    }
  }
  if (status !== 0 && options.allowFailure !== true) {
    const diagnostic = payload as ConstructorParameters<typeof NativeLaunchAdmissionError>[0] | undefined;
    if (args[0] === "ensure-host" && diagnostic?.code === "native-inventory-unknown") throw new NativeLaunchAdmissionError(diagnostic);
    const detail = (r.stderr ?? "").trim() || (r.stdout ?? "").trim();
    throw new Error(`native host operation ${args[0]} failed: ${detail}`);
  }
  return { status, payload };
}

/** Spawn-or-adopt the per-user host; returns its identity. */
export function ensureNativeHost(options: { fenced?: boolean; inputFenced?: boolean } = {}): { hostPid: number; socketPath: string; generation: string; launchFence: boolean; launchInputFence: boolean } {
  const { payload } = runOp(["ensure-host", ...(options.fenced ? ["--fenced", "true"] : []), ...(options.inputFenced ? ["--input-fenced", "true"] : [])]);
  const record = payload as { hostPid?: number; socketPath?: string; generation?: string; launchFence?: boolean; launchInputFence?: boolean } | undefined;
  if (!record || typeof record.hostPid !== "number" || typeof record.socketPath !== "string" || typeof record.generation !== "string") {
    throw new Error("native host did not report a valid identity");
  }
  return { hostPid: record.hostPid, socketPath: record.socketPath, generation: record.generation, launchFence: record.launchFence === true, launchInputFence: record.launchInputFence === true };
}

export type NativeLaunchOwnership = { name: string; generation: string; incarnation: string; socketPath: string };

/** Certified pre-create refusal. It cannot erase an earlier component create. */
export class NativeLaunchAdmissionError extends Error {
  constructor(readonly diagnostic: { code: "native-name-collision" | "native-inventory-unknown"; id?: string; socketPath?: string; hosts?: unknown }) {
    super(`Launch refused before creation: ${diagnostic.code}${diagnostic.id ? ` (${diagnostic.id})` : ""}. No session was created by this attempt.`);
  }
  toRunFailure(launchId: string) {
    return { kind: "h2a.run.failure", version: 1, state: "not-started", launchId,
      phase: "admission", creationAttempted: false, retrySafe: true, ...this.diagnostic };
  }
}

function admitNativeCreation(name: string, sidecar?: string, launchSocket?: string): void {
  const { payload } = runOp(["admit", "--id", name, ...(sidecar ? ["--sidecar", sidecar] : []),
    ...(launchSocket ? ["--launch-socket", launchSocket] : [])]);
  const diagnostic = payload as { admitted?: boolean; code?: "native-name-collision" | "native-inventory-unknown" } | undefined;
  if (diagnostic?.admitted === true) return;
  throw new NativeLaunchAdmissionError(diagnostic?.code ? diagnostic as ConstructorParameters<typeof NativeLaunchAdmissionError>[0]
    : { code: "native-inventory-unknown" });
}

export type NativeHostCapabilityFailure = {
  kind: "h2a.run.failure";
  version: 1;
  state: "not-started";
  code: "native-host-capability-mismatch";
  launchId: string;
  phase: "host-selection";
  creationAttempted: false;
  retrySafe: true;
  missingCapabilities: ["launchFence" | "launchInputFence"];
  host: { socketPath: string; generation: string; hostPid: number };
  recovery: { action: "select-compatible-generation"; automaticRetry: false };
};

/** Evidence for this component only; callers must rule out earlier creates. */
export class NativeHostCapabilityMismatchError extends Error {
  constructor(readonly host: NativeHostCapabilityFailure["host"], readonly capability: "launchFence" | "launchInputFence" = "launchFence") {
    super(`Launch refused before creation: host ${host.generation} on ${host.socketPath} does not provide ${capability}. ` +
      "No session was created by this attempt. Its existing sessions remain active. " +
      "Use automatic generation selection with the corrected runtime; if this socket was explicitly imposed, " +
      "remove that constraint only for the new launch. No restart of the existing host is necessary.");
    this.name = "NativeHostCapabilityMismatchError";
  }

  toRunFailure(launchId: string): NativeHostCapabilityFailure {
    return {
      kind: "h2a.run.failure", version: 1, state: "not-started",
      code: "native-host-capability-mismatch", launchId, phase: "host-selection",
      creationAttempted: false, retrySafe: true, missingCapabilities: [this.capability],
      host: this.host, recovery: { action: "select-compatible-generation", automaticRetry: false },
    };
  }
}

export function preflightNativeLaunch(name: string, sidecar = nativeSidecarName(name), ownerSocket?: string, inputFenced = false): ReturnType<typeof ensureNativeHost> {
  const selected = ownerSocket ? runOp(["ensure-host"], { socketPath: ownerSocket }).payload as ReturnType<typeof ensureNativeHost>
    : ensureNativeHost({ fenced: true, inputFenced });
  const { launchFence, hostPid, socketPath, generation } = selected;
  if (!launchFence) throw new NativeHostCapabilityMismatchError({ generation, hostPid, socketPath });
  if (inputFenced && !selected.launchInputFence) throw new NativeHostCapabilityMismatchError({ generation, hostPid, socketPath }, "launchInputFence");
  admitNativeCreation(name, sidecar, socketPath);
  return selected;
}

function prepareNativeOwnership(name: string, beforeCreate?: (value: NativeLaunchOwnership) => void, sidecar?: string, ownerSocket?: string, inputFenced = false): string[] {
  if (!beforeCreate) return [];
  const selected = sidecar !== undefined ? preflightNativeLaunch(name, sidecar, ownerSocket, inputFenced)
    : ownerSocket ? runOp(["ensure-host"], { socketPath: ownerSocket }).payload as ReturnType<typeof ensureNativeHost>
    : ensureNativeHost({ fenced: true, inputFenced });
  const { generation, launchFence, hostPid, socketPath } = selected;
  if (!launchFence) throw new NativeHostCapabilityMismatchError({ generation, hostPid, socketPath });
  if (inputFenced && !selected.launchInputFence) throw new NativeHostCapabilityMismatchError({ generation, hostPid, socketPath }, "launchInputFence");
  if (sidecar === undefined) admitNativeCreation(name, undefined, socketPath);
  const incarnation = randomUUID();
  beforeCreate({ name, generation, incarnation, socketPath });
  return ["--socket", socketPath, "--generation", generation, "--incarnation", incarnation,
    ...(sidecar ? ["--sidecar", sidecar] : [])];
}

export function listNativeSessions(): ReadonlyArray<NativeSessionState> & { readonly complete?: boolean } {
  const { payload } = runOp(["list"]);
  const record = payload as { sessions?: ReadonlyArray<NativeSessionState>; complete?: boolean } | undefined;
  return Object.assign([...(record?.sessions ?? [])], { complete: record?.complete === true });
}

/**
 * 3-state session probe (F2). The lie this type removes: a failed `state` op
 * used to flatten into `undefined`/`alive=false` — indistinguishable from a
 * PROVEN dead/absent session, which let destructive acts read an op failure
 * as a death certificate. The states:
 *  - "found": a reachable host answered with the session's state;
 *  - "absent": POSITIVE proof of absence — a reachable host does not know
 *    the session across every known reachable endpoint;
 *  - "unknown": the op failed (spawn error, timeout, protocol failure) —
 *    NEVER proof of death, including ENOENT/ECONNREFUSED on a known endpoint;
 *    destructive callers must fail closed on it.
 * The classification happens IN-BAND in the `probe` op (op.ts), where the
 * error codes live — never by parsing a generic failure on this side.
 */
export type NativeStateProbe =
  | { readonly state: "found"; readonly session: NativeSessionState }
  | { readonly state: "absent" }
  | { readonly state: "unknown"; readonly reason: string; readonly code?: "ambiguous-owner"; readonly sockets?: readonly string[] };

export function nativeSessionState(name: string, socketPath?: string): NativeStateProbe {
  let result: { status: number; payload: unknown };
  try {
    result = runOp(["probe", "--id", name], { allowFailure: true, socketPath });
  } catch (error) {
    // Spawn-level failure (timeout, ENOMEM, …): nothing was proven.
    return {
      state: "unknown",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const record = result.payload as
    | { verdict?: string; state?: NativeSessionState; reason?: string; code?: string; sockets?: string[] }
    | undefined;
  if (result.status !== 0 || record === undefined) {
    return { state: "unknown", reason: "native probe op returned no verdict" };
  }
  if ((record.verdict === "live" || record.verdict === "dead") && record.state) {
    return { state: "found", session: record.state };
  }
  if (record.verdict === "dead") return { state: "absent" };
  return {
    state: "unknown",
    reason: record.reason ?? "native probe op returned no verdict",
    ...(record.code === "ambiguous-owner" ? { code: "ambiguous-owner" as const,
      ...(record.sockets ? { sockets: record.sockets } : {}) } : {}),
  };
}

/**
 * 3-state liveness (F2): `true` / `false` are POSITIVE verdicts; "unknown"
 * is a probe failure that destructive paths must refuse on. Never throws.
 */
export function nativeSessionLiveness(name: string): true | false | "unknown" {
  const probe = nativeSessionState(name);
  if (probe.state === "found") return probe.session.status === "running";
  if (probe.state === "absent") return false;
  return "unknown";
}

export function nativeSessionPid(name: string): number | undefined {
  // A pid is a read, not an act: absent AND unknown both yield undefined
  // (there is no pid to report either way); acts must not key off this.
  const probe = nativeSessionState(name);
  return probe.state === "found" && probe.session.status !== "exited"
    ? probe.session.pid
    : undefined;
}

export type NativeLaunchMetadata = {
  readonly requireLaunchInputFence?: boolean;
  beforeCreate?: (value: NativeLaunchOwnership) => void;
  onCreateAttempt?: () => void;
  readonly label?: string;
  readonly resumeId?: string;
  readonly sessionClass?: SessionClass;
  readonly terminateOnAgentExit?: boolean;
  readonly refuseExisting?: boolean;
  readonly env?: Readonly<Record<string, string>>;
};

/**
 * startLocalSession twin. Runs the SAME bash wrapper contract as the tmux
 * path (LOCAL_WRAPPER drop-to-shell / STRUCTURED_LOCAL_WRAPPER exec-only), so
 * agent exit semantics are identical across hosts.
 */
export function startNativeSession(
  profile: string,
  command: string,
  cwd: string,
  args: ReadonlyArray<string> = [],
  label?: string,
  metadata: NativeLaunchMetadata = {},
): NativeStartResult {
  const slug = slugify(label ?? cwd);
  const name = localSessionName(slug);
  const existing = nativeSessionState(name);
  if (existing.state === "unknown" && !metadata.beforeCreate) {
    // An unprovable host state must never be read as absence: creating here
    // could fabricate a twin over a live session (fail closed).
    throw new Error(
      `native session ${slug}: host state is unknown (${existing.reason}); refusing to create over an unprovable session`,
    );
  }
  if (existing.state === "found" && existing.session.status !== "exited") {
    if (metadata.refuseExisting) {
      if (metadata.beforeCreate) throw new NativeLaunchAdmissionError({ code: "native-name-collision", id: name,
        ...(existing.session.socketPath ? { socketPath: existing.session.socketPath } : {}) });
      throw new Error(`native session ${slug} already exists; no agent was started`);
    }
    return { name, slug, pid: existing.session.pid };
  }
  const agentCommand = metadata.terminateOnAgentExit
    ? ["/bin/bash", "-lc", STRUCTURED_LOCAL_WRAPPER, command, ...args]
    : [
        "/bin/bash",
        "-lc",
        LOCAL_WRAPPER,
        localRelaunchCommand(
          profile,
          cwd,
          label,
          metadata.resumeId ? ["--resume", metadata.resumeId] : [],
        ),
        command,
        ...args,
      ];
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env["TERM"] = "xterm-256color";
  // The launch runtime may still be connected to an older protocol-v1 host.
  env["H2A_NATIVE_TERMINAL"] = "1";
  Object.assign(env, metadata.env);
  if (metadata.sessionClass !== undefined) {
    env[SESSION_CLASS_ENV] = metadata.sessionClass;
  }
  // Env goes through a file: it can exceed argv limits and must not leak into
  // process listings.
  const envDir = mkdtempSync(join(tmpdir(), "h2a-native-env-"));
  const envFile = join(envDir, "env.json");
  try {
    writeFileSync(envFile, JSON.stringify(env), { mode: 0o600 });
    const ownershipArgs = prepareNativeOwnership(name, metadata.beforeCreate, nativeSidecarName(name), undefined, metadata.requireLaunchInputFence);
    const { payload } = runOp([
      "create",
      ...ownershipArgs,
      "--id",
      name,
      "--cwd",
      cwd,
      "--cols",
      String(HEADLESS_TERMINAL_SIZE.cols),
      "--rows",
      String(HEADLESS_TERMINAL_SIZE.rows),
      "--env-file",
      envFile,
      "--",
      ...agentCommand,
    ], { onCreateAttempt: metadata.onCreateAttempt });
    const state = payload as NativeSessionState | undefined;
    if (!state || typeof state.pid !== "number") {
      throw new Error(`native host did not return a session state for ${slug}`);
    }
    return { name, slug, pid: state.pid };
  } finally {
    rmSync(envDir, { recursive: true, force: true });
  }
}

/** sendKeysLiteral twin: raw keystrokes, no interpretation. */
export function nativeSendKeysLiteral(name: string, text: string, socketPath?: string): boolean {
  const { status } = runOp(
    ["write", "--id", name, "--b64", Buffer.from(text, "utf8").toString("base64")],
    { allowFailure: true, socketPath },
  );
  return status === 0;
}

/** paste-buffer -p twin: the text lands as ONE bracketed block. */
export function nativePasteBlock(name: string, text: string, socketPath?: string): boolean {
  const { status } = runOp(
    ["paste", "--id", name, "--b64", Buffer.from(text, "utf8").toString("base64")],
    { allowFailure: true, socketPath },
  );
  return status === 0;
}

/** The Enter that submits a composed block. */
export function nativeSendEnter(name: string, socketPath?: string): boolean {
  const { status } = runOp(["enter", "--id", name], { allowFailure: true, socketPath });
  return status === 0;
}

/**
 * capturePane twin: returns the rendered current screen, including cursor
 * positioning and erasures, just like tmux capture-pane.
 */
export function nativeCapture(name: string, bytes = 16_384, socketPath?: string): string | undefined {
  const { status, payload } = runOp(
    ["capture", "--id", name, "--bytes", String(bytes)],
    { allowFailure: true, socketPath },
  );
  if (status !== 0) return undefined;
  const record = payload as { text?: string } | undefined;
  return typeof record?.text === "string" ? record.text : undefined;
}

/** kill-session twin: SIGTERM with SIGKILL escalation inside the op. */
export function killNativeSession(name: string, socketPath?: string): boolean {
  const { status } = runOp(["kill", "--id", name], { allowFailure: true, socketPath });
  return status === 0;
}

/**
 * Stop exactly the native session incarnation observed during restart
 * preflight. The host performs both fence comparisons atomically before it
 * invalidates an attached controller or emits a signal.
 */
export function killNativeSessionIfIncarnation(
  name: string,
  generation: string,
  incarnation: string,
  socketPath?: string,
  inputEpoch?: number,
): boolean {
  const { status } = runOp(
    [
      "kill-if-incarnation",
      "--id",
      name,
      "--generation",
      generation,
      "--incarnation",
      incarnation,
      ...(inputEpoch === undefined ? [] : ["--epoch", String(inputEpoch)]),
    ],
    { allowFailure: true, socketPath },
  );
  return status === 0;
}

export type NativeDriveInstructionOutcome =
  | "driven"
  | "deferred"
  | "unresolved"
  | "failed";

/**
 * Local PTY drive primitive used by `h2a drive --driver native` and by the
 * restart command's live-option injection. This is not the signed inter-agent
 * drive envelope: it reuses the native host's registry resolution plus its
 * controller/activity guard and returns only the measured submission outcome.
 */
export function driveNativeInstruction(
  target: string,
  instruction: string,
): NativeDriveInstructionOutcome {
  const { status, payload } = runOp(
    [
      "drive",
      "--target",
      target,
      "--b64",
      Buffer.from(instruction, "utf8").toString("base64"),
    ],
    { allowFailure: true },
  );
  if (status !== 0) return "failed";
  const outcome = (payload as { outcome?: unknown } | undefined)?.outcome;
  return outcome === "driven" ||
    outcome === "deferred" ||
    outcome === "unresolved" ||
    outcome === "failed"
    ? outcome
    : "failed";
}

/**
 * Kill a session AND its h2a sidecar companion (the tmux twin gets this for
 * free because the sidecar is a window inside the killed session).
 */
export function killNativeSessionTree(name: string): boolean {
  const main = nativeSessionState(name);
  if (main.state === "unknown") return false;
  const killed = main.state === "found" && killNativeSession(name, main.session.socketPath);
  // Best-effort companion cleanup: only a POSITIVELY-found sidecar is
  // killed; absent needs nothing and unknown proves nothing to act on.
  const sidecar = nativeSessionState(nativeSidecarName(name));
  if (sidecar.state === "found") {
    killNativeSession(nativeSidecarName(name), sidecar.session.socketPath);
  }
  return killed;
}

/**
 * startHeadlessSession twin: run-once agent under HEADLESS_WRAPPER, writing
 * result.json + output.log, session ends when the wrapper finishes. The
 * prompt rides a 0600 file consumed and unlinked by the wrapper — identical
 * contract to the tmux path.
 */
export function startNativeHeadlessSession(
  profile: string,
  command: string,
  cwd: string,
  args: ReadonlyArray<string>,
  resultJson: string,
  outputLog: string,
  label: string,
  promptInput?: string,
  refuseExisting = false,
  sessionClass?: SessionClass,
  onCreateAttempt?: () => void,
  beforeCreate?: (value: NativeLaunchOwnership) => void,
): NativeStartResult & { promptFile?: string } {
  const slug = slugify(label);
  const name = localSessionName(slug);
  const existing = nativeSessionState(name);
  if (existing.state === "unknown" && !beforeCreate) {
    // Same fail-closed rule as startNativeSession: an unprovable host state
    // is never permission to create a possible twin.
    throw new Error(
      `native session ${slug}: host state is unknown (${existing.reason}); refusing to create over an unprovable session`,
    );
  }
  if (existing.state === "found" && existing.session.status !== "exited") {
    if (refuseExisting) {
      if (beforeCreate) throw new NativeLaunchAdmissionError({ code: "native-name-collision", id: name,
        ...(existing.session.socketPath ? { socketPath: existing.session.socketPath } : {}) });
      throw new Error(`native session ${slug} already exists; no agent was started`);
    }
    return { name, slug, pid: existing.session.pid };
  }
  const promptFile = promptInput === undefined ? "" : `${resultJson}.prompt`;
  if (promptInput !== undefined) {
    writeFileSync(promptFile, promptInput, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  }
  const agentCommand = [
    "/bin/bash",
    "-lc",
    HEADLESS_WRAPPER,
    resultJson,
    outputLog,
    promptFile,
    command,
    ...args,
  ];
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env["TERM"] = "xterm-256color";
  if (sessionClass !== undefined) env[SESSION_CLASS_ENV] = sessionClass;
  const envDir = mkdtempSync(join(tmpdir(), "h2a-native-env-"));
  const envFile = join(envDir, "env.json");
  try {
    writeFileSync(envFile, JSON.stringify(env), { mode: 0o600 });
    const { payload } = runOp([
      "create",
      ...prepareNativeOwnership(name, beforeCreate, nativeSidecarName(name)),
      "--id",
      name,
      "--cwd",
      cwd,
      "--cols",
      String(HEADLESS_TERMINAL_SIZE.cols),
      "--rows",
      String(HEADLESS_TERMINAL_SIZE.rows),
      "--env-file",
      envFile,
      "--",
      ...agentCommand,
    ], { onCreateAttempt });
    const state = payload as NativeSessionState | undefined;
    if (!state || typeof state.pid !== "number") {
      throw new Error(`native host did not return a session state for ${slug}`);
    }
    return { name, slug, pid: state.pid, ...(promptFile ? { promptFile } : {}) };
  } finally {
    rmSync(envDir, { recursive: true, force: true });
  }
}

/**
 * startH2aWindow twin: the h2a MCP sidecar runs in a COMPANION native session
 * (`<name>.h2a`) instead of a tmux window. Lifecycle: killNativeSessionTree
 * stops it with its main session.
 */
export function startNativeH2aSidecar(
  name: string,
  cwd: string,
  h2aCommand: string,
  options: { verified?: boolean; beforeCreate?: (value: NativeLaunchOwnership) => void; onCreateAttempt?: () => void } = {},
): boolean {
  const sidecar = nativeSidecarName(name);
  const parent = nativeSessionState(name);
  const ownerSocket = parent.state === "found" ? parent.session.socketPath : undefined;
  const existing = nativeSessionState(sidecar);
  if (existing.state === "unknown") {
    // Unprovable sidecar state: report failure without creating a possible
    // twin (the caller treats false as "sidecar unavailable").
    return false;
  }
  if (existing.state === "found" && existing.session.status === "running") {
    if (options.beforeCreate) return false; // Never claim an existing sidecar.
    return true;
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env["TERM"] = "xterm-256color";
  // Native twin of the tmux wrapper's TMUX_PANE override: the sidecar owns a
  // different PTY, so publish the main agent session as its wake target. The
  // core keeps the signed envelope addressed to the perennial agent identity
  // and uses this value only for the native host write.
  env[H2A_NATIVE_TARGET_SESSION_ENV] = name;
  // The MCP sidecar is a separate native session, so it cannot infer which
  // interactive terminal owns it. Publish the stable owner for presence/ticks.
  env["H2A_NATIVE_PTY_SESSION"] = name;
  const envDir = mkdtempSync(join(tmpdir(), "h2a-native-env-"));
  const envFile = join(envDir, "env.json");
  const challenge = options.verified ? createStructuredReadinessChallenge() : undefined;
  if (challenge) {
    env["H2A_MCP_READY_FILE"] = challenge.file;
    env["H2A_MCP_READY_NONCE"] = challenge.nonce;
  }
  try {
    writeFileSync(envFile, JSON.stringify(env), { mode: 0o600 });
    runOp([
      "create",
      ...(options.beforeCreate ? prepareNativeOwnership(sidecar, options.beforeCreate, undefined, ownerSocket)
        : ownerSocket ? ["--socket", ownerSocket] : []),
      "--id",
      sidecar,
      "--cwd",
      cwd,
      "--cols",
      "120",
      "--rows",
      "30",
      "--env-file",
      envFile,
      "--",
      "/bin/bash",
      "-lc",
      // Match the structured tmux wrapper: the MCP process must replace the
      // shell so its readiness ACK names the PID owned by this incarnation.
      challenge ? `exec ${h2aCommand}` : h2aCommand,
    ], { onCreateAttempt: options.onCreateAttempt });
    if (challenge) {
      // Readiness is the correlated post-identity ACK, not an arbitrary crash
      // observation window. Pin the component owner throughout the wait.
      const deadline = Date.now() + 20_000;
      const initial = nativeSessionState(sidecar, ownerSocket);
      if (initial.state !== "found" || initial.session.status !== "running") return false;
      const owned = initial.session;
      let nextOwnerCheck = Date.now() + 1_000;
      while (Date.now() < deadline) {
        // Linux's crash-containment guardian is the PTY leader; the MCP
        // process runs below it. Prove that the ACK's PID is a live descendant
        // in that same process group, without walking the global /proc inventory.
        const ready = probeStructuredReadiness(challenge, owned.pid,
          (pid) => nativeReadinessPidMatches(pid, owned.pid));
        if (ready.state === "invalid") return false;
        if (ready.state === "ready") {
          const currentParent = nativeSessionState(name, ownerSocket);
          const currentSidecar = nativeSessionState(sidecar, ownerSocket);
          return parent.state === "found" && currentParent.state === "found" &&
            currentParent.session.status === "running" &&
            currentParent.session.generation === parent.session.generation &&
            currentParent.session.incarnation === parent.session.incarnation &&
            currentSidecar.state === "found" && currentSidecar.session.status === "running" &&
            currentSidecar.session.generation === owned.generation &&
            currentSidecar.session.incarnation === owned.incarnation &&
            currentSidecar.session.pid === owned.pid;
        }
        // Poll the correlated file cheaply; spawning a fresh op.js process on
        // every 50 ms tick amplified CPU/I/O contention during a launch burst.
        // The pinned owner is checked periodically and again on the ACK path.
        if (Date.now() >= nextOwnerCheck) {
          const state = nativeSessionState(sidecar, ownerSocket);
          if (state.state !== "found" || state.session.status !== "running" ||
            state.session.generation !== owned.generation || state.session.incarnation !== owned.incarnation ||
            state.session.pid !== owned.pid) return false;
          nextOwnerCheck = Date.now() + 1_000;
        }
        sleepSync(50);
      }
      return false;
    }
    const state = nativeSessionState(sidecar, ownerSocket);
    return state.state === "found" && state.session.status === "running";
  } catch {
    return false;
  } finally {
    rmSync(envDir, { recursive: true, force: true });
    if (challenge) cleanupStructuredReadinessChallenge(challenge);
  }
}

function nativeReadinessPidMatches(pid: number, ownerPid: number): boolean {
  if (pid === ownerPid) return true;
  if (process.platform !== "linux") return false;
  const seen = new Set<number>();
  try {
    while (pid > 1 && seen.size < 64 && !seen.has(pid)) {
      seen.add(pid);
      const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = raw.slice(raw.lastIndexOf(")") + 1).trim().split(/\s+/);
      const parsed = parseProcStat(raw);
      if (!parsed || fields[0] === "Z" || fields[0] === "X" || Number(fields[2]) !== ownerPid) return false;
      if (parsed.ppid === ownerPid) return true;
      pid = parsed.ppid;
    }
  } catch { /* absent/unreadable process is not a readiness proof */ }
  return false;
}

/**
 * Foreground interactive attach on the CURRENT terminal (tmux attach twin).
 * Blocks until the session exits or the user detaches with Ctrl-\.
 */
export function attachNativeSession(name: string, socketPath?: string): number {
  const r = withAttachTerminalRecovery((env) =>
    spawnSync(process.execPath, [opEntryPath(), "attach", "--id", name, ...(socketPath ? ["--socket", socketPath] : [])], {
      stdio: "inherit", env,
    }));
  return r.status ?? 1;
}

/** clearPaneComposer twin: C-u wipes the composer line (best-effort). */
export function nativeClearComposer(name: string): boolean {
  return nativeSendKeysLiteral(name, "");
}

/** paneTreeCpuMs twin, keyed by session name instead of tmux pane. */
export function nativeTreeCpuMs(name: string): number | undefined {
  const pid = nativeSessionPid(name);
  if (pid === undefined) return undefined;
  return readProcessTreeCpuMs(pid, procReaderDeps());
}

/** paneWorkerPid twin: the pid actually doing the work under the wrapper. */
export function nativeWorkerPid(name: string): number | undefined {
  const pid = nativeSessionPid(name);
  if (pid === undefined) return undefined;
  return readWorkerPid(pid, procReaderDeps());
}

/**
 * PromptDeliveryDeps for a native session — deliverInitialPrompt() runs the
 * SAME measured protocol as on tmux; only the transport differs. The "pane"
 * key given to deliverInitialPrompt must be the session NAME.
 */
export function nativePromptDeliveryDeps(sleep: (ms: number) => void): PromptDeliveryDeps {
  const owners = new Map<string, string>();
  const owner = (name: string): string => {
    const pinned = owners.get(name);
    if (pinned) return pinned;
    const probe = nativeSessionState(name);
    if (probe.state !== "found" || !probe.session.socketPath) throw new Error(`native prompt owner is unproven for ${name}`);
    owners.set(name, probe.session.socketPath);
    return probe.session.socketPath;
  };
  return {
    capturePane: (name) => nativeCapture(name, 16_384, owner(name)),
    clearComposer: (name) => nativeSendKeysLiteral(name, "\u0015", owner(name)),
    pasteBlock: (name, text) => nativePasteBlock(name, text, owner(name)),
    submit: (name) => nativeSendEnter(name, owner(name)),
    cpuMs: (name) => {
      const probe = nativeSessionState(name, owner(name));
      return probe.state === "found" ? readProcessTreeCpuMs(probe.session.pid, procReaderDeps()) : undefined;
    },
    sleep,
    now: () => Date.now(),
  };
}

/** One bounded async op per observation, pinned to the reserved incarnation. */
export function nativeClaudeDeliveryDeps(owned: NativeLaunchOwnership, deadline: number, onInputEpoch?: (epoch: number) => void,
  previousPollCompletedAt?: number): ClaudeNativeDeliveryDeps {
  let epoch = 0;
  // The synchronous PID probe belongs to this same observation budget. Seed
  // from its completion so child startup jitter cannot create an early burst.
  let nextCapture = previousPollCompletedAt === undefined ? 0 : previousPollCompletedAt + 275;
  const operation = (op: string, extra: string[] = []): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
    const remaining = Math.floor(deadline - Date.now());
    if (remaining <= 0) { reject(new Error("launch observation deadline expired")); return; }
    execFile(process.execPath, [opEntryPath(), op, "--id", owned.name, "--socket", owned.socketPath,
      "--generation", owned.generation, "--incarnation", owned.incarnation, "--epoch", String(epoch), ...extra],
    { timeout: remaining, maxBuffer: 65536, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        // execFile's message contains argv, including a base64-encoded brief.
        // Receipts retain a bounded reason, never the input payload.
        const lost = /launch .*input epoch|launch changed during observation/i.test(stderr);
        reject(new Error(lost ? "launch ownership or input epoch changed" : `native ${op} failed or timed out`)); return;
      }
      try { resolve(JSON.parse(stdout.trim())); } catch { reject(new Error(`native ${op} returned an invalid observation`)); }
    });
  });
  const write = async (op: string, extra: string[] = []) => {
    const result = await operation(op, extra);
    if (result.ok !== true) return false;
    epoch += 2; // The acquired controller is released by this one-shot op.
    onInputEpoch?.(epoch);
    return true;
  };
  return {
    capturePane: async () => {
      if (nextCapture > Date.now()) await new Promise(resolve => setTimeout(resolve,
        Math.min(nextCapture - Date.now(), Math.max(0, deadline - Date.now()))));
      nextCapture = Date.now() + 275;
      return String((await operation("capture")).text);
    },
    clearComposer: () => write("write", ["--b64", Buffer.from("\u0015").toString("base64")]),
    pasteBlock: (_name, text) => write("paste", ["--b64", Buffer.from(text).toString("base64")]),
    submit: () => write("enter"),
    now: () => Date.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  };
}
