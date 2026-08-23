import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { isOsTemporaryPath } from "../path-safety.js";

export const H2A_RUN_PROFILES = ["claude", "codex"] as const;
export type H2aRunProfile = (typeof H2A_RUN_PROFILES)[number];
export const H2A_RUN_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export type H2aRunEffort = (typeof H2A_RUN_EFFORTS)[number];
export const H2A_RUN_GATEWAYS = ["auto", "required", "off"] as const;
export type H2aRunGateway = (typeof H2A_RUN_GATEWAYS)[number];
export const H2A_RUN_API_VERSION = "h2a.run/v1";

export type H2aRunRequest = {
  profile: H2aRunProfile;
  name: string;
  workspace: string;
  prompt: string;
  background: true;
  gateway: H2aRunGateway;
  headless: boolean;
  h2aSidecar: boolean;
  model?: string;
  effort?: H2aRunEffort;
  /** Server-attested launch provenance; never supplied by the MCP caller. */
  delegation?: H2aRunDelegation;
};

export type H2aRunDelegation = {
  origin: "mcp:h2a_run";
  delegatorInstance: string;
  delegatorTmuxSession: string;
};

export type H2aRunExecutor = (request: H2aRunRequest) => unknown;

const ALLOWED_KEYS = new Set([
  "profile",
  "name",
  "workspace",
  "prompt",
  "background",
  "gateway",
  "headless",
  "h2aSidecar",
  "model",
  "effort",
]);
const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const MAX_PROMPT_BYTES = 65_536;

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function requiredString(
  args: Record<string, unknown>,
  field: string,
): string {
  const value = args[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`h2a_run: '${field}' must be a non-empty string`);
  }
  return value;
}

export function validateH2aRunRequest(
  args: Record<string, unknown> | undefined,
  workspaceRoot: string,
): H2aRunRequest {
  if (!args) throw new Error("h2a_run: missing arguments");
  const unknown = Object.keys(args).filter((key) => !ALLOWED_KEYS.has(key));
  if (unknown.length > 0) {
    throw new Error(`h2a_run: unknown field(s): ${unknown.join(", ")}`);
  }

  const profile = requiredString(args, "profile");
  if (!(H2A_RUN_PROFILES as readonly string[]).includes(profile)) {
    throw new Error("h2a_run: 'profile' must be claude|codex");
  }
  const name = requiredString(args, "name");
  if (!SAFE_NAME.test(name)) {
    throw new Error(
      "h2a_run: 'name' must be 1-64 letters, digits, '_' or '-'",
    );
  }
  const prompt = requiredString(args, "prompt");
  if (prompt.trim().length === 0 || prompt.includes("\0")) {
    throw new Error("h2a_run: 'prompt' must contain non-NUL text");
  }
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw new Error(`h2a_run: 'prompt' exceeds ${MAX_PROMPT_BYTES} UTF-8 bytes`);
  }
  if (args.background !== true) {
    throw new Error("h2a_run: 'background' must be true on the MCP surface");
  }

  const rawWorkspace = requiredString(args, "workspace");
  if (!isAbsolute(rawWorkspace)) {
    throw new Error("h2a_run: 'workspace' must be absolute");
  }
  let workspace: string;
  let root: string;
  try {
    workspace = realpathSync(rawWorkspace);
    root = realpathSync(workspaceRoot);
  } catch {
    throw new Error("h2a_run: workspace and MCP workspace root must exist");
  }
  if (!statSync(workspace).isDirectory()) {
    throw new Error("h2a_run: 'workspace' must be a directory");
  }
  if (!isWithin(root, workspace)) {
    throw new Error("h2a_run: workspace must stay within the MCP startup workspace");
  }
  if (isOsTemporaryPath(workspace)) {
    throw new Error("h2a_run: durable agent workspaces may not be under the OS temporary directory");
  }

  const gateway = args.gateway ?? "auto";
  if (
    typeof gateway !== "string" ||
    !(H2A_RUN_GATEWAYS as readonly string[]).includes(gateway)
  ) {
    throw new Error("h2a_run: 'gateway' must be auto|required|off");
  }
  if (profile === "codex" && gateway === "required") {
    throw new Error(
      "h2a_run: gateway 'required' is unsupported for codex (llm-mesh is Anthropic-compatible)",
    );
  }
  const headless = args.headless ?? false;
  if (typeof headless !== "boolean") {
    throw new Error("h2a_run: 'headless' must be boolean");
  }
  const h2aSidecar = args.h2aSidecar ?? !headless;
  if (typeof h2aSidecar !== "boolean") {
    throw new Error("h2a_run: 'h2aSidecar' must be boolean");
  }
  if (headless && h2aSidecar) {
    throw new Error("h2a_run: headless sessions cannot keep an h2a sidecar");
  }

  const model = args.model;
  if (model !== undefined && (typeof model !== "string" || !SAFE_MODEL.test(model))) {
    throw new Error("h2a_run: invalid 'model' token");
  }
  const effort = args.effort;
  if (
    effort !== undefined &&
    (typeof effort !== "string" ||
      !(H2A_RUN_EFFORTS as readonly string[]).includes(effort))
  ) {
    throw new Error("h2a_run: 'effort' must be low|medium|high|xhigh");
  }

  return {
    profile: profile as H2aRunProfile,
    name,
    workspace,
    prompt,
    background: true,
    gateway: gateway as H2aRunGateway,
    headless,
    h2aSidecar,
    ...(model !== undefined ? { model } : {}),
    ...(effort !== undefined ? { effort: effort as H2aRunEffort } : {}),
  };
}

export type H2aRunInvocation = {
  command: string;
  args: string[];
  cwd: string;
  input: string;
};

export function buildH2aRunInvocation(
  request: H2aRunRequest,
  bin = fileURLToPath(new URL("../../bin.js", import.meta.url)),
): H2aRunInvocation {
  return {
    command: process.execPath,
    args: [
      bin,
      "run",
      request.profile,
      request.workspace,
      "--no-attach",
      "--background",
      "--json",
      "--h2a-run-worker",
      "--name",
      request.name,
      "--prompt-stdin",
      request.h2aSidecar ? "--h2a" : "--no-h2a",
      ...(request.gateway === "required"
        ? ["--gw"]
        : request.gateway === "off"
          ? ["--no-gw"]
          : []),
      ...(request.model ? ["--model", request.model] : []),
      ...(request.effort ? ["--effort", request.effort] : []),
      ...(request.headless ? ["--headless"] : []),
    ],
    cwd: request.workspace,
    input: request.prompt,
  };
}

function contractResult(value: unknown, request: H2aRunRequest): unknown {
  if (!value || typeof value !== "object") {
    throw new Error("incompatible h2a runtime: launch output is not an object");
  }
  const result = value as Record<string, unknown>;
  const session = result.session as Record<string, unknown> | undefined;
  const expectedMode = request.headless ? "headless" : "interactive";
  const expectedGateway =
    request.gateway === "required"
      ? "gateway"
      : request.gateway === "off"
        ? "direct"
        : undefined;
  const attach = result.attach as Record<string, unknown> | null | undefined;
  // The native-terminal host (feat/native-terminal-host) keys a session by its
  // name, not a tmux pane, so a native `h2a.run.result` legitimately omits
  // `session.pane`. The tmux pane-id shape (`%N`) is therefore required only for
  // the tmux host; a pre-native runtime emits no `host` field and is treated as
  // tmux. An unrecognized host value is rejected rather than assumed.
  const host = session?.host;
  const isNative = host === "native";
  const hostOk = host === undefined || host === "native" || host === "tmux";
  const paneOk = isNative
    ? session === undefined ||
      session.pane === undefined ||
      typeof session.pane === "string"
    : Boolean(session) &&
      typeof session!.pane === "string" &&
      /^%\d+$/.test(session!.pane as string);
  if (
    result.kind !== "h2a.run.result" ||
    result.version !== 1 ||
    result.ok !== true ||
    result.apiVersion !== H2A_RUN_API_VERSION ||
    typeof result.runtimeVersion !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(result.runtimeVersion) ||
    result.state !== "started" ||
    !session ||
    session.id !== request.name ||
    !hostOk ||
    typeof session.tmuxSession !== "string" ||
    session.tmuxSession.length === 0 ||
    !paneOk ||
    session.profile !== request.profile ||
    session.workspace !== request.workspace ||
    session.mode !== expectedMode ||
    session.background !== true ||
    (session.gateway !== "gateway" && session.gateway !== "direct") ||
    (expectedGateway !== undefined && session.gateway !== expectedGateway) ||
    session.h2aSidecar !== request.h2aSidecar ||
    !Number.isInteger(session.pid) ||
    (session.pid as number) <= 0 ||
    (request.headless
      ? attach !== null
      : !attach ||
        attach.command !== "h2a" ||
        !Array.isArray(attach.args) ||
        attach.args.length !== 2 ||
        attach.args[0] !== "attach" ||
        attach.args[1] !== request.name)
  ) {
    throw new Error("incompatible h2a runtime: invalid h2a.run.result contract");
  }
  return value;
}

export function executeH2aRunWithSpawn(
  request: H2aRunRequest,
  spawn: typeof spawnSync,
): unknown {
  const invocation = buildH2aRunInvocation(request);
  const result = spawn(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    input: invocation.input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    timeout: 30_000,
    maxBuffer: 1_048_576,
  });
  if (result.error) {
    const timedOut = (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    if (timedOut) {
      return {
        error: "h2a_run: launch status unknown after runtime timeout",
        state: "unknown",
        launchId: request.name,
        retrySafe: false,
      };
    }
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = (result.stderr ?? "").trim().slice(-2_000);
    throw new Error(
      `h2a_run: h2a run failed (exit ${result.status ?? "?"})${detail ? `: ${detail}` : ""}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse((result.stdout ?? "").trim());
  } catch {
    throw new Error("incompatible h2a runtime: h2a run did not return JSON");
  }
  return contractResult(parsed, request);
}

export const executeH2aRun: H2aRunExecutor = (request) =>
  executeH2aRunWithSpawn(request, spawnSync);

/**
 * Server-owned attestation record for an MCP launch. It is written only after
 * the structured launcher has returned a valid started session; the runtime
 * CLI has no argument or environment channel through which a direct caller
 * can assert this origin.
 */
export function recordMcpRunDelegation(
  root: string,
  result: Record<string, unknown>,
  delegation: H2aRunDelegation | undefined,
): void {
  if (!delegation || result.ok !== true || result.state !== "started") return;
  const session = result.session;
  if (!session || typeof session !== "object") return;
  const tmuxSession = (session as { tmuxSession?: unknown }).tmuxSession;
  const workerPid = (session as { pid?: unknown }).pid;
  if (typeof tmuxSession !== "string" || tmuxSession.length === 0) return;
  if (typeof workerPid !== "number" || !Number.isInteger(workerPid) || workerPid <= 0) return;
  try {
    const registry = join(root, "registry");
    mkdirSync(registry, { recursive: true, mode: 0o700 });
    appendFileSync(
      join(registry, "mcp-delegations.jsonl"),
      `${JSON.stringify({
        version: 1,
        workerTmuxSession: tmuxSession,
        workerPid,
        origin: delegation.origin,
        delegatorInstance: delegation.delegatorInstance,
        delegatorTmuxSession: delegation.delegatorTmuxSession,
        recordedAt: new Date().toISOString(),
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  } catch {
    // A missing attestation is fail-closed as J?, but must not turn a worker
    // that already started into a launcher failure.
  }
}

export function handleH2aRun(
  args: Record<string, unknown> | undefined,
  workspaceRoot: string,
  execute: H2aRunExecutor = executeH2aRun,
  delegation?: H2aRunDelegation,
): Record<string, unknown> {
  try {
    const base = validateH2aRunRequest(args, workspaceRoot);
    // Provenance comes from the local MCP server's own auto-opened session,
    // never from a tool argument that a caller could merely assert.
    const request: H2aRunRequest = delegation
      ? { ...base, delegation }
      : base;
    const result = execute(request);
    if (!result || typeof result !== "object") {
      return { error: "h2a_run: launcher returned no structured result" };
    }
    return result as Record<string, unknown>;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
