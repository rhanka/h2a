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
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
} from "./tmux.js";
import { readProcessTreeCpuMs, readWorkerPid } from "./proc-cpu.js";
import { sleepSync, type PromptDeliveryDeps } from "./prompt-delivery.js";
import { SESSION_CLASS_ENV, type SessionClass } from "./session-class.js";

const OP_TIMEOUT_MS = 15_000;

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
  readonly id: string;
  readonly pid: number;
  readonly status: "running" | "stopping" | "exited";
  readonly exit: { readonly exitCode: number; readonly signal?: number } | null;
};

export type NativeStartResult = {
  readonly name: string;
  readonly slug: string;
  readonly pid: number;
};

function opEntryPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "native-terminal", "op.js");
}

/** node-pty loadable + containment binaries present. Pure preflight. */
export function nativeHostAvailable():
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string } {
  return nativePtyRequirements();
}

function runOp(
  args: ReadonlyArray<string>,
  options: { allowFailure?: boolean } = {},
): { status: number; payload: unknown } {
  const r = spawnSync(process.execPath, [opEntryPath(), ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: OP_TIMEOUT_MS,
  });
  if (r.error) {
    throw new Error(
      `native host operation ${args.join(" ")} failed: ${r.error.message}`,
      { cause: r.error },
    );
  }
  const status = r.status ?? 1;
  if (status !== 0 && options.allowFailure !== true) {
    const detail = (r.stderr ?? "").trim() || (r.stdout ?? "").trim();
    throw new Error(`native host operation ${args[0]} failed: ${detail}`);
  }
  let payload: unknown;
  const stdout = (r.stdout ?? "").trim();
  if (stdout.length > 0) {
    try {
      payload = JSON.parse(stdout.split("\n").pop()!);
    } catch {
      payload = undefined;
    }
  }
  return { status, payload };
}

/** Spawn-or-adopt the per-user host; returns its identity. */
export function ensureNativeHost(): { hostPid: number; socketPath: string } {
  const { payload } = runOp(["ensure-host"]);
  const record = payload as { hostPid?: number; socketPath?: string } | undefined;
  if (!record || typeof record.hostPid !== "number" || typeof record.socketPath !== "string") {
    throw new Error("native host did not report a valid identity");
  }
  return { hostPid: record.hostPid, socketPath: record.socketPath };
}

export function listNativeSessions(): ReadonlyArray<NativeSessionState> {
  const { payload } = runOp(["list"]);
  const record = payload as { sessions?: ReadonlyArray<NativeSessionState> } | undefined;
  return record?.sessions ?? [];
}

export function nativeSessionState(name: string): NativeSessionState | undefined {
  const { status, payload } = runOp(["state", "--id", name], { allowFailure: true });
  if (status !== 0) return undefined;
  return payload as NativeSessionState;
}

export function nativeSessionAlive(name: string): boolean {
  const state = nativeSessionState(name);
  return state !== undefined && state.status === "running";
}

export function nativeSessionPid(name: string): number | undefined {
  const state = nativeSessionState(name);
  return state !== undefined && state.status !== "exited" ? state.pid : undefined;
}

export type NativeLaunchMetadata = {
  readonly label?: string;
  readonly resumeId?: string;
  readonly sessionClass?: SessionClass;
  readonly terminateOnAgentExit?: boolean;
  readonly refuseExisting?: boolean;
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
  if (existing !== undefined && existing.status !== "exited") {
    if (metadata.refuseExisting) {
      throw new Error(`native session ${slug} already exists; no agent was started`);
    }
    return { name, slug, pid: existing.pid };
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
  if (metadata.sessionClass !== undefined) {
    env[SESSION_CLASS_ENV] = metadata.sessionClass;
  }
  // Env goes through a file: it can exceed argv limits and must not leak into
  // process listings.
  const envDir = mkdtempSync(join(tmpdir(), "h2a-native-env-"));
  const envFile = join(envDir, "env.json");
  try {
    writeFileSync(envFile, JSON.stringify(env), { mode: 0o600 });
    const { payload } = runOp([
      "create",
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
    ]);
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
export function nativeSendKeysLiteral(name: string, text: string): boolean {
  const { status } = runOp(
    ["write", "--id", name, "--b64", Buffer.from(text, "utf8").toString("base64")],
    { allowFailure: true },
  );
  return status === 0;
}

/** paste-buffer -p twin: the text lands as ONE bracketed block. */
export function nativePasteBlock(name: string, text: string): boolean {
  const { status } = runOp(
    ["paste", "--id", name, "--b64", Buffer.from(text, "utf8").toString("base64")],
    { allowFailure: true },
  );
  return status === 0;
}

/** The Enter that submits a composed block. */
export function nativeSendEnter(name: string): boolean {
  const { status } = runOp(["enter", "--id", name], { allowFailure: true });
  return status === 0;
}

/**
 * capturePane twin. IMPORTANT semantic difference: tmux returns the RENDERED
 * screen; this returns the ANSI-stripped tail of the output stream. For probe
 * matching (prompt echo, modal text) the stream tail carries the same visible
 * text — full-screen-repaint TUIs re-emit their frame into the tail.
 */
export function nativeCapture(name: string, bytes = 16_384): string | undefined {
  const { status, payload } = runOp(
    ["capture", "--id", name, "--bytes", String(bytes)],
    { allowFailure: true },
  );
  if (status !== 0) return undefined;
  const record = payload as { text?: string } | undefined;
  return typeof record?.text === "string" ? record.text : undefined;
}

/** kill-session twin: SIGTERM with SIGKILL escalation inside the op. */
export function killNativeSession(name: string): boolean {
  const { status } = runOp(["kill", "--id", name], { allowFailure: true });
  return status === 0;
}

/**
 * Kill a session AND its h2a sidecar companion (the tmux twin gets this for
 * free because the sidecar is a window inside the killed session).
 */
export function killNativeSessionTree(name: string): boolean {
  const killed = killNativeSession(name);
  if (nativeSessionState(nativeSidecarName(name)) !== undefined) {
    killNativeSession(nativeSidecarName(name));
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
): NativeStartResult & { promptFile?: string } {
  const slug = slugify(label);
  const name = localSessionName(slug);
  const existing = nativeSessionState(name);
  if (existing !== undefined && existing.status !== "exited") {
    if (refuseExisting) {
      throw new Error(`native session ${slug} already exists; no agent was started`);
    }
    return { name, slug, pid: existing.pid };
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
    ]);
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
  options: { verified?: boolean } = {},
): boolean {
  const sidecar = nativeSidecarName(name);
  const existing = nativeSessionState(sidecar);
  if (existing !== undefined && existing.status === "running") return true;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env["TERM"] = "xterm-256color";
  const envDir = mkdtempSync(join(tmpdir(), "h2a-native-env-"));
  const envFile = join(envDir, "env.json");
  try {
    writeFileSync(envFile, JSON.stringify(env), { mode: 0o600 });
    runOp([
      "create",
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
      h2aCommand,
    ]);
  } catch {
    return false;
  } finally {
    rmSync(envDir, { recursive: true, force: true });
  }
  if (options.verified) {
    // The sidecar must still be alive once it had time to crash on startup.
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const state = nativeSessionState(sidecar);
      if (state === undefined || state.status === "exited") return false;
      sleepSync(200);
    }
  }
  const state = nativeSessionState(sidecar);
  return state !== undefined && state.status === "running";
}

/**
 * Foreground interactive attach on the CURRENT terminal (tmux attach twin).
 * Blocks until the session exits or the user detaches with Ctrl-\.
 */
export function attachNativeSession(name: string): number {
  const r = spawnSync(process.execPath, [opEntryPath(), "attach", "--id", name], {
    stdio: "inherit",
  });
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
  return {
    capturePane: (name) => nativeCapture(name),
    clearComposer: (name) => nativeClearComposer(name),
    pasteBlock: (name, text) => nativePasteBlock(name, text),
    submit: (name) => nativeSendEnter(name),
    cpuMs: (name) => nativeTreeCpuMs(name),
    sleep,
    now: () => Date.now(),
  };
}
