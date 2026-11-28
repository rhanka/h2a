/**
 * Core verified CLI session-identity substrate (pure `node:*`, zero external deps).
 *
 * Implements the closed 51-key `SESSION_IDENTITY_SCRUB_KEYS` table, strict runtime
 * directory resolution (`/run/user/<uid>/h2a`, D16 receipt, or injected/tmp),
 * atomic 0600 session fiches/secrets/sidecars/handoffs/daemon receipts, `/proc`
 * Proof-2 host CLI parsing, descendant `h2a-session-*.scope` lookup, and Codex
 * `--no-daemon` capability probing and argument rewriting.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const SESSION_REF_ENV = "H2A_SESSION_REF";
export const SESSION_PROOF_PATH_ENV = "H2A_SESSION_PROOF_PATH";
export const SESSION_CLASS_ENV = "H2A_SESSION_CLASS";
export const RUN_LAUNCH_ID_ENV = "H2A_RUN_LAUNCH_ID";
export const RUN_LAUNCH_TOKEN_ENV = "H2A_RUN_LAUNCH_TOKEN";
export const IDENTITY_RUNTIME_DIR_ENV = "H2A_IDENTITY_RUNTIME_DIR";
export const IDENTITY_GUARD_ENFORCE_ENV = "H2A_IDENTITY_GUARD_ENFORCE";

export const SESSION_KEY_RE = /^[a-zA-Z0-9_-]{16,64}$/;
export const CANONICAL_LOGIN_RE = /^[a-z0-9-]+:[a-z0-9._-]+:[a-f0-9]{12}$/;
export const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const D16_LINUX_RECEIPT_PATH = "/run/h2a-test/receipt.json";
const MAX_JSON_FILE_BYTES = 1_048_576;
const MAX_SECRET_BYTES = 128;
const DAEMON_LAUNCH_DEFAULT_TTL_MS = 30_000;
const CLOCK_SKEW_TOLERANCE_MS = 5_000;
const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms: number): void {
  Atomics.wait(SLEEP_BUFFER, 0, 0, ms);
}

/**
 * Closed exact 51-name list of session-identity and internal plumbing variables
 * scrubbed from inherited environments and `tmux show-environment -g`.
 * Never use prefix wildcards or non-env constants here; owner settings live outside.
 */
export const SESSION_IDENTITY_SCRUB_KEYS = [
  // 1. h2a session identity (14 exact names)
  "H2A_SESSION_REF",
  "H2A_SESSION_PROOF_PATH",
  "H2A_SESSION_CLASS",
  "H2A_SESSION_TOKEN",
  "H2A_NATIVE_PTY_SESSION",
  "H2A_NATIVE_TERMINAL",
  "H2A_NATIVE_FOREGROUND_ROLE",
  "H2A_INSTANCE",
  "H2A_AGENT_SESSION_ID",
  "H2A_SCOPE_SESSION",
  "H2A_JOB_ID",
  "REMOTE_JOB_ID",
  "SESSION_ID",
  "SESSION_WORKSPACE_ID",
  // 2. h2a invocation / internal plumbing (16 exact names)
  "H2A_RUN_LAUNCH_ID",
  "H2A_RUN_LAUNCH_TOKEN",
  "H2A_MCP_READY_FILE",
  "H2A_MCP_READY_NONCE",
  "H2A_NATIVE_TARGET_SESSION",
  "H2A_HEADLESS_TARGET",
  "H2A_CORE_ENTRY",
  "H2A_DIRECT_ROUTING_SCRUB",
  "H2A_STATION_WINDOW",
  "H2A_OPERATOR_BREAK_HOP",
  "H2A_UPGRADE_REEXECED",
  "H2A_ATTACH_RESET_RECEIPT",
  "H2A_CLIENT_RECOVERY_GUARD_ACTIVE",
  "H2A_SUBPROCESS_ATTACH_MOD",
  "H2A_SUBPROCESS_ATTACH_BASE",
  "H2A_SUBPROCESS_ATTACH_ID",
  // 3. Third-party Claude Code session markers (16 exact names)
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_CHILD_NOTES_DIR",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_BRIDGE_SESSION_ID",
  "CLAUDE_CODE_LAUNCHED_BY_SESSION_IDS",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_PID",
  "CLAUDE_PLUGIN_DATA",
  "CLAUDE_EFFORT",
  "CLAUDE_PROJECT_DIR",
  "AI_AGENT",
  // 4. Third-party Codex session markers (5 exact names)
  "CODEX_THREAD_ID",
  "CODEX_COMPANION_SESSION_ID",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
  "CODEX_WORKSPACE_ROOT",
] as const;

export type SessionIdentityScrubKey = (typeof SESSION_IDENTITY_SCRUB_KEYS)[number];
export const SESSION_IDENTITY_SCRUB_KEY_SET: ReadonlySet<string> = new Set(
  SESSION_IDENTITY_SCRUB_KEYS,
);

/**
 * Scrub only `SESSION_IDENTITY_SCRUB_KEYS` (minus optional `exclude`) from a
 * copied inherited environment. Always apply BEFORE setting per-call child vars.
 */
export function scrubSessionIdentityEnv(
  env: Readonly<Record<string, string | undefined>>,
  options: { readonly exclude?: ReadonlySet<string> | undefined } = {},
): Record<string, string> {
  const cleaned: Record<string, string> = {};
  const exclude = options.exclude;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (SESSION_IDENTITY_SCRUB_KEY_SET.has(key) && !exclude?.has(key)) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

/** Closed table of supported host CLI binary names for Proof 2 (`/proc`). */
export const HOST_CLI_BINARY_NAMES = [
  "claude",
  "codex",
  "codex-linux-sandbox",
  "gemini",
  "agy",
  "antigravity",
  "vibe",
  "mistral-vibe",
  "opencode",
  "hermes",
  "muse",
  "muse-code",
] as const;

const HOST_CLI_MAP: Readonly<Record<string, string>> = {
  claude: "claude",
  codex: "codex",
  "codex-linux-sandbox": "codex",
  gemini: "gemini",
  agy: "agy",
  antigravity: "agy",
  vibe: "vibe",
  "mistral-vibe": "vibe",
  opencode: "opencode",
  hermes: "hermes",
  muse: "muse",
  "muse-code": "muse",
};

const INTERPRETER_BASENAME_RE = /^(?:node(?:js)?|bun|deno|py(?:thon(?:\d+(?:\.\d+)*)?)?)$/i;
const SCRIPT_EXT_RE = /\.(?:[mc]?js|ts)$/i;

export function normalizeHostCliName(rawName: string): string | undefined {
  return HOST_CLI_MAP[rawName.trim().toLowerCase()];
}

export interface HostCliDetection {
  readonly host: string;
  readonly rawName: string;
  readonly matchedBy: "exe" | "argv0" | "argv1-script";
  readonly isCodexAppServer: boolean;
}

/**
 * Proof-2 OR rule on one ancestor process:
 *  1. basename(exe) in closed host table;
 *  2. OR basename(argv[0]) in closed host table;
 *  3. OR when exe/argv[0] is an interpreter (node/bun/deno/py*), basename(argv[1])
 *     minus script extension (.js/.mjs/.cjs/.ts) in closed host table.
 * Never inspects free tokens argv[2..n].
 */
export function parseHostCliFromProcess(
  exePath: string | undefined,
  argv: readonly string[],
): HostCliDetection | undefined {
  const argv0 = argv[0];
  const argv1 = argv[1];
  const isCodexAppServer =
    (normalizeHostCliName(exePath ? basename(exePath) : "") === "codex" ||
      normalizeHostCliName(argv0 ? basename(argv0) : "") === "codex") &&
    argv1 === "app-server";

  if (exePath) {
    const exeBase = basename(exePath);
    const host = normalizeHostCliName(exeBase);
    if (host !== undefined) {
      return { host, rawName: exeBase, matchedBy: "exe", isCodexAppServer };
    }
  }
  if (argv0) {
    const arg0Base = basename(argv0);
    const host = normalizeHostCliName(arg0Base);
    if (host !== undefined) {
      return { host, rawName: arg0Base, matchedBy: "argv0", isCodexAppServer };
    }
  }
  const exeBase = exePath ? basename(exePath) : "";
  const arg0Base = argv0 ? basename(argv0) : "";
  if (
    argv1 &&
    (INTERPRETER_BASENAME_RE.test(exeBase) || INTERPRETER_BASENAME_RE.test(arg0Base))
  ) {
    const stripped = basename(argv1).replace(SCRIPT_EXT_RE, "");
    const host = normalizeHostCliName(stripped);
    if (host !== undefined) {
      return {
        host,
        rawName: stripped,
        matchedBy: "argv1-script",
        isCodexAppServer: host === "codex" && argv[2] === "app-server",
      };
    }
  }
  return undefined;
}

export interface ProcStatInfo {
  readonly pid: number;
  readonly comm: string;
  readonly ppid: number;
  readonly startTime: string;
}

export function readBootId(procRoot = "/proc"): string | undefined {
  if (process.platform !== "linux" && procRoot === "/proc") return undefined;
  try {
    const val = readFileSync(join(procRoot, "sys/kernel/random/boot_id"), "utf8").trim();
    return val.length > 0 ? val : undefined;
  } catch {
    return undefined;
  }
}

export function readMachineId(
  paths: readonly string[] = ["/etc/machine-id", "/var/lib/dbus/machine-id"],
): string {
  for (const path of paths) {
    try {
      const val = readFileSync(path, "utf8").trim();
      if (val.length > 0) return val;
    } catch {
      // try fallback
    }
  }
  return hostname() || "unknown-machine";
}

export function readPidNamespaceId(pid: number | "self" = "self", procRoot = "/proc"): string | undefined {
  if (process.platform !== "linux" && procRoot === "/proc") return undefined;
  try {
    const target = readlinkSync(join(procRoot, String(pid), "ns", "pid"));
    const match = /\[(\d+)\]/.exec(target);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Parse Linux `/proc/<pid>/stat`, anchoring on the LAST `") "` so spaces or
 * parentheses inside `comm` cannot shift field 22 (`starttime`).
 */
export function parseProcStatText(raw: string): ProcStatInfo | undefined {
  const closeIdx = raw.lastIndexOf(") ");
  if (closeIdx === -1) return undefined;
  const openIdx = raw.indexOf(" (");
  if (openIdx === -1 || openIdx > closeIdx) return undefined;
  const pid = Number(raw.slice(0, openIdx).trim());
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  const comm = raw.slice(openIdx + 2, closeIdx);
  const rest = raw.slice(closeIdx + 2).trim().split(/\s+/);
  // rest[0]=state (field 3), rest[1]=ppid (field 4), ..., rest[19]=starttime (field 22)
  const ppidRaw = rest[1];
  const startTime = rest[19];
  if (!ppidRaw || !startTime || !/^\d+$/.test(startTime)) return undefined;
  const ppid = Number(ppidRaw);
  if (!Number.isInteger(ppid) || ppid < 0) return undefined;
  return { pid, comm, ppid, startTime };
}

export function readProcStat(pid: number, procRoot = "/proc"): ProcStatInfo | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    return parseProcStatText(readFileSync(join(procRoot, String(pid), "stat"), "utf8"));
  } catch {
    return undefined;
  }
}

export function readProcExe(pid: number, procRoot = "/proc"): string | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    return readlinkSync(join(procRoot, String(pid), "exe"));
  } catch {
    return undefined;
  }
}

export function readProcArgv(pid: number, procRoot = "/proc"): string[] {
  if (!Number.isInteger(pid) || pid <= 0) return [];
  try {
    const raw = readFileSync(join(procRoot, String(pid), "cmdline"));
    if (raw.length === 0) return [];
    const tokens = raw.toString("utf8").split("\0");
    while (tokens.length > 0 && tokens[tokens.length - 1] === "") tokens.pop();
    return tokens;
  } catch {
    return [];
  }
}

export function readProcCgroup(pid: number | "self", procRoot = "/proc"): string | undefined {
  try {
    const text = readFileSync(join(procRoot, String(pid), "cgroup"), "utf8");
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

export function readProcUptimeSeconds(procRoot = "/proc"): number | undefined {
  try {
    const raw = readFileSync(join(procRoot, "uptime"), "utf8").trim();
    const first = raw.split(/\s+/)[0];
    if (!first) return undefined;
    const secs = Number(first);
    return Number.isFinite(secs) && secs >= 0 ? secs : undefined;
  } catch {
    return undefined;
  }
}

export function isProcessAlive(pid: number, expectedStartTime: string, procRoot = "/proc"): boolean {
  const info = readProcStat(pid, procRoot);
  return info !== undefined && info.startTime === expectedStartTime;
}

const SESSION_SCOPE_UNIT_RE = /\/(h2a-session-[^/\s]+\.scope)$/m;

export function extractSessionScopeUnit(cgroupText: string): string | null {
  const match = SESSION_SCOPE_UNIT_RE.exec(cgroupText);
  return match?.[1] ?? null;
}

export function listDescendantPids(rootPid: number, procRoot = "/proc"): number[] {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return [];
  const childrenByParent = new Map<number, number[]>();
  try {
    for (const entry of readdirSync(procRoot)) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      const stat = readProcStat(pid, procRoot);
      if (!stat) continue;
      const list = childrenByParent.get(stat.ppid);
      if (list) list.push(pid);
      else childrenByParent.set(stat.ppid, [pid]);
    }
  } catch {
    return [];
  }
  const descendants: number[] = [];
  const queue: number[] = [...(childrenByParent.get(rootPid) ?? [])];
  const seen = new Set<number>([rootPid]);
  while (queue.length > 0 && descendants.length < 256) {
    const pid = queue.shift();
    if (pid === undefined || seen.has(pid)) continue;
    seen.add(pid);
    descendants.push(pid);
    for (const child of childrenByParent.get(pid) ?? []) {
      if (!seen.has(child)) queue.push(child);
    }
  }
  return descendants;
}

/**
 * Read `/proc/<workerPid>/cgroup` on descendants of `leaderPid` (NEVER `leaderPid`
 * itself, which lives in `h2a-native-*.scope`) up to `timeoutMs` (default 1000 ms)
 * when systemd session-scope isolation is expected.
 */
export function readDescendantSessionScopeUnit(
  leaderPid: number,
  options: {
    readonly procRoot?: string | undefined;
    readonly timeoutMs?: number | undefined;
    readonly pollIntervalMs?: number | undefined;
    readonly expectScope?: boolean | undefined;
  } = {},
): string | null {
  const procRoot = options.procRoot ?? "/proc";
  if (options.expectScope === false) return null;
  const timeoutMs = Math.max(0, options.timeoutMs ?? 1_000);
  const pollMs = Math.max(5, options.pollIntervalMs ?? 20);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const descendants = listDescendantPids(leaderPid, procRoot);
    for (const workerPid of descendants) {
      const cgroup = readProcCgroup(workerPid, procRoot);
      if (!cgroup) continue;
      const scope = extractSessionScopeUnit(cgroup);
      if (scope !== null) return scope;
    }
    if (Date.now() >= deadline) return null;
    sleepSync(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
}

export class SessionRuntimeError extends Error {
  readonly code: string;
  constructor(code: string, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "SessionRuntimeError";
    this.code = code;
  }
}

export interface D16ReceiptLite {
  readonly version: 1;
  readonly backend: "bwrap" | "sandbox-exec";
  readonly root: string;
  readonly uid: number;
  readonly nonce: string;
  readonly writablePaths?: readonly string[] | undefined;
}

export function isWithinDir(targetPath: string, rootPath: string): boolean {
  const rel = relative(resolve(rootPath), resolve(targetPath));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function resolveEffectiveNoFollowLast(candidate: string): string {
  const abs = resolve(candidate);
  let cursor = abs;
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      lstatSync(cursor);
      const realBase = realpathSync(cursor);
      const suffix = relative(cursor, abs);
      return suffix ? join(realBase, suffix) : realBase;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  return abs;
}

/**
 * Lightweight self-contained check of a valid active D16 sandbox receipt.
 * Never depends on external workspace packages so `@sentropic/h2a` remains a leaf.
 */
export function readValidD16Receipt(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: { readonly platform?: NodeJS.Platform | undefined; readonly uid?: number | undefined } = {},
): D16ReceiptLite | undefined {
  const marker = env["H2A_TEST_STATE_ROOT"];
  if (!marker || !isAbsolute(marker)) return undefined;
  if (env["H2A_TEST_STATE_BARRIER"] !== "1") return undefined;
  const nonce = env["H2A_TEST_SANDBOX_NONCE"];
  if (!nonce || !/^[0-9a-f]{32,}$/.test(nonce)) return undefined;

  const platform = options.platform ?? process.platform;
  const envReceipt = env["H2A_TEST_STATE_RECEIPT"];
  let receiptPath: string;
  if (platform === "linux") {
    if (envReceipt !== undefined && envReceipt !== D16_LINUX_RECEIPT_PATH) return undefined;
    receiptPath = D16_LINUX_RECEIPT_PATH;
  } else {
    if (!envReceipt || !isAbsolute(envReceipt) || isWithinDir(envReceipt, marker)) return undefined;
    receiptPath = envReceipt;
  }

  let parsed: Record<string, unknown>;
  try {
    const lst = lstatSync(receiptPath);
    if (!lst.isFile() || lst.isSymbolicLink()) return undefined;
    const obj = JSON.parse(readFileSync(receiptPath, "utf8")) as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined;
    parsed = obj as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const uid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : 0);
  if (
    parsed["version"] !== 1 ||
    (parsed["backend"] !== "bwrap" && parsed["backend"] !== "sandbox-exec") ||
    typeof parsed["root"] !== "string" ||
    !isAbsolute(parsed["root"]) ||
    typeof parsed["rootDev"] !== "string" ||
    typeof parsed["rootIno"] !== "string" ||
    parsed["uid"] !== uid ||
    parsed["nonce"] !== nonce
  ) {
    return undefined;
  }

  try {
    const rootStat = lstatSync(parsed["root"]);
    if (
      !rootStat.isDirectory() ||
      rootStat.isSymbolicLink() ||
      String(rootStat.dev) !== parsed["rootDev"] ||
      String(rootStat.ino) !== parsed["rootIno"]
    ) {
      return undefined;
    }
    const resolvedMarker = resolveEffectiveNoFollowLast(marker);
    const resolvedRoot = resolveEffectiveNoFollowLast(parsed["root"]);
    if (!isWithinDir(resolvedMarker, resolvedRoot)) return undefined;
  } catch {
    return undefined;
  }

  const writablePaths: string[] = [];
  for (const key of ["aliases", "writableMounts"] as const) {
    const entries = parsed[key];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as Record<string, unknown>)["visible"] === "string"
      ) {
        const vis = (entry as Record<string, unknown>)["visible"] as string;
        if (isAbsolute(vis) && !writablePaths.includes(vis)) {
          writablePaths.push(vis);
        }
      }
    }
  }

  return {
    version: 1,
    backend: parsed["backend"] as "bwrap" | "sandbox-exec",
    root: parsed["root"],
    uid,
    nonce,
    ...(writablePaths.length > 0 ? { writablePaths } : {}),
  };
}

export const HOST_QUALIFICATION_ROOT = "/run/h2a-qualification";
export const HOST_QUALIFICATION_RESERVATION_ENV = "H2A_HOST_QUALIFICATION_RESERVATION";

export interface HostQualificationReservationLite {
  readonly version: 1;
  readonly stageRoot: string;
}

/**
 * Verify a root-owned host-qualification reservation created by
 * `scripts/test-host-qualification.mjs` on a disposable CI VM.
 * Requires uid 0 ownership on both `/run/h2a-qualification` and the reservation file
 * so an unprivileged UID 1000 agent can never forge it.
 */
export function readValidHostQualificationReservation(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: {
    readonly platform?: NodeJS.Platform | undefined;
    readonly uid?: number | undefined;
    readonly procRoot?: string | undefined;
  } = {},
): HostQualificationReservationLite | undefined {
  const platform = options.platform ?? process.platform;
  if (platform !== "linux") return undefined;
  const uid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : 0);
  const procRoot = options.procRoot ?? "/proc";
  const reservationPath = env[HOST_QUALIFICATION_RESERVATION_ENV]?.trim();
  if (!reservationPath || !isAbsolute(reservationPath)) return undefined;
  const resolvedResPath = resolve(reservationPath);
  if (dirname(resolvedResPath) !== HOST_QUALIFICATION_ROOT) return undefined;

  try {
    const dirStat = lstatSync(HOST_QUALIFICATION_ROOT);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink() || dirStat.uid !== 0) {
      return undefined;
    }
    const fileStat = lstatSync(resolvedResPath);
    if (
      !fileStat.isFile() ||
      fileStat.isSymbolicLink() ||
      fileStat.uid !== 0 ||
      fileStat.size <= 0 ||
      fileStat.size > 16_384
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  let parsed: Record<string, unknown>;
  try {
    const raw = JSON.parse(readFileSync(resolvedResPath, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    parsed = raw as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const currentBootId = readBootId(procRoot);
  if (
    parsed["version"] !== 1 ||
    typeof parsed["bootId"] !== "string" ||
    !currentBootId ||
    parsed["bootId"] !== currentBootId ||
    parsed["runnerUid"] !== uid ||
    typeof parsed["stageRoot"] !== "string" ||
    !isAbsolute(parsed["stageRoot"]) ||
    typeof parsed["stageDev"] !== "string" ||
    typeof parsed["stageIno"] !== "string"
  ) {
    return undefined;
  }

  try {
    const stageStat = lstatSync(parsed["stageRoot"]);
    if (
      !stageStat.isDirectory() ||
      stageStat.isSymbolicLink() ||
      stageStat.uid !== uid ||
      String(stageStat.dev) !== parsed["stageDev"] ||
      String(stageStat.ino) !== parsed["stageIno"]
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return {
    version: 1,
    stageRoot: parsed["stageRoot"],
  };
}

export function hasSandboxOrQualificationRuntime(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: {
    readonly platform?: NodeJS.Platform | undefined;
    readonly uid?: number | undefined;
    readonly procRoot?: string | undefined;
  } = {},
): boolean {
  return Boolean(
    readValidD16Receipt(env, options) || readValidHostQualificationReservation(env, options),
  );
}

export function verifyOrCreatePrivateDir(
  dir: string,
  expectedUid: number,
  options: { readonly createIfMissing?: boolean | undefined; readonly strictMode0700?: boolean | undefined } = {},
): void {
  let info;
  try {
    info = lstatSync(dir);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT" || !options.createIfMissing) {
      throw new SessionRuntimeError(
        err.code === "EROFS" || err.code === "EACCES"
          ? "session-runtime-dir-unwritable"
          : "session-runtime-dir-unavailable",
        `runtime directory unavailable: ${dir}`,
        error,
      );
    }
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      info = lstatSync(dir);
      if (info.isDirectory() && !info.isSymbolicLink() && info.uid === expectedUid && (info.mode & 0o777) !== 0o700) {
        chmodSync(dir, 0o700);
        info = lstatSync(dir);
      }
    } catch (mkErr) {
      const code = (mkErr as NodeJS.ErrnoException).code;
      throw new SessionRuntimeError(
        code === "EROFS" || code === "EACCES"
          ? "session-runtime-dir-unwritable"
          : "session-runtime-dir-unavailable",
        `cannot initialize runtime directory ${dir}`,
        mkErr,
      );
    }
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new SessionRuntimeError(
      "session-runtime-dir-unsafe",
      `runtime directory must be a non-symlink directory: ${dir}`,
    );
  }
  if (info.uid !== expectedUid) {
    throw new SessionRuntimeError(
      "session-runtime-dir-unsafe",
      `runtime directory owner mismatch (${info.uid} !== ${expectedUid}): ${dir}`,
    );
  }
  const mode = info.mode & 0o777;
  if (options.strictMode0700 !== false && mode !== 0o700) {
    throw new SessionRuntimeError(
      "session-runtime-dir-unsafe",
      `runtime directory permissions must be 0700 (got ${mode.toString(8)}): ${dir}`,
    );
  }
  if ((mode & 0o077) !== 0) {
    throw new SessionRuntimeError(
      "session-runtime-dir-unsafe",
      `runtime directory permissions must not allow group/other access: ${dir}`,
    );
  }
}

export interface SessionRuntimeResolution {
  readonly dir: string;
  readonly mode: "production" | "d16" | "host-qualification" | "isolated-tmp" | "injected";
  readonly uid: number;
  readonly d16Receipt?: D16ReceiptLite | undefined;
}

function resolveConfinedRuntimeSubdir(rootDir: string, requested: string | undefined): string {
  let target = join(rootDir, "runtime", "h2a");
  if (requested && isAbsolute(requested)) {
    try {
      const eff = resolveEffectiveNoFollowLast(requested);
      if (isWithinDir(eff, resolveEffectiveNoFollowLast(rootDir))) {
        target = eff;
      }
    } catch {
      // ignore invalid override and keep confined default
    }
  }
  return target;
}

/**
 * Resolve `<runtimeDir>` strictly according to DESIGN § 1.2.B:
 *  - In-process `sessionRuntimeDir` (for direct Vitest / unit tests only)
 *  - Valid D16 receipt -> `<d16.root>/runtime/h2a` (never touches `/run/user/<uid>/h2a`)
 *  - Valid root-owned host-qualification reservation -> `<stageRoot>/runtime/h2a`
 *  - Verified isolated `/tmp` root -> optional `H2A_IDENTITY_RUNTIME_DIR` inside `/tmp`
 *  - Production -> fixed `/run/user/<uid>/h2a` (NEVER honors `XDG_RUNTIME_DIR` or
 *    `H2A_IDENTITY_RUNTIME_DIR`).
 */
export function resolveSessionRuntimeDir(
  options: {
    readonly env?: Readonly<Record<string, string | undefined>> | undefined;
    readonly sessionRuntimeDir?: string | undefined;
    readonly isolatedTmpRoot?: string | undefined;
    readonly createIfMissing?: boolean | undefined;
    readonly uid?: number | undefined;
    readonly platform?: NodeJS.Platform | undefined;
    readonly procRoot?: string | undefined;
  } = {},
): SessionRuntimeResolution {
  const uid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : 0);
  const env = options.env ?? process.env;
  const createIfMissing = options.createIfMissing ?? false;

  if (options.sessionRuntimeDir) {
    if (!isAbsolute(options.sessionRuntimeDir)) {
      throw new SessionRuntimeError(
        "session-runtime-dir-unsafe",
        `injected sessionRuntimeDir must be absolute: ${options.sessionRuntimeDir}`,
      );
    }
    verifyOrCreatePrivateDir(options.sessionRuntimeDir, uid, { createIfMissing });
    return { dir: options.sessionRuntimeDir, mode: "injected", uid };
  }

  const d16Receipt = readValidD16Receipt(env, { platform: options.platform, uid });
  if (d16Receipt) {
    const requested = env[IDENTITY_RUNTIME_DIR_ENV]?.trim();
    const target = resolveConfinedRuntimeSubdir(d16Receipt.root, requested);
    verifyOrCreatePrivateDir(target, uid, { createIfMissing });
    return { dir: target, mode: "d16", uid, d16Receipt };
  }

  const qualReservation = readValidHostQualificationReservation(env, {
    platform: options.platform,
    uid,
    procRoot: options.procRoot,
  });
  if (qualReservation) {
    const requested = env[IDENTITY_RUNTIME_DIR_ENV]?.trim();
    const target = resolveConfinedRuntimeSubdir(qualReservation.stageRoot, requested);
    verifyOrCreatePrivateDir(target, uid, { createIfMissing });
    return { dir: target, mode: "host-qualification", uid };
  }

  if (options.isolatedTmpRoot) {
    let fixedTmp: string;
    try {
      fixedTmp = realpathSync("/tmp");
    } catch {
      throw new SessionRuntimeError("session-runtime-dir-unavailable", "cannot resolve /tmp");
    }
    const requested = env[IDENTITY_RUNTIME_DIR_ENV]?.trim();
    let target = join(options.isolatedTmpRoot, "runtime", "h2a");
    if (requested && isAbsolute(requested)) {
      try {
        const eff = resolveEffectiveNoFollowLast(requested);
        if (isWithinDir(eff, fixedTmp)) {
          target = eff;
        }
      } catch {
        // fall back inside isolatedTmpRoot
      }
    }
    const effTarget = resolveEffectiveNoFollowLast(target);
    if (!isWithinDir(effTarget, fixedTmp)) {
      throw new SessionRuntimeError(
        "isolated-root-symlink-escape",
        `isolated runtime dir escapes ${fixedTmp}: ${target}`,
      );
    }
    verifyOrCreatePrivateDir(effTarget, uid, { createIfMissing });
    return { dir: effTarget, mode: "isolated-tmp", uid };
  }

  const prodDir = `/run/user/${uid}/h2a`;
  verifyOrCreatePrivateDir(prodDir, uid, { createIfMissing, strictMode0700: true });
  return { dir: prodDir, mode: "production", uid };
}

export function writeBufferAtomic0600(filePath: string, data: Buffer | string): void {
  const dir = dirname(filePath);
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  verifyOrCreatePrivateDir(dir, uid, { createIfMissing: true });
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  let fd: number | undefined;
  try {
    fd = openSync(
      tmpPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    let offset = 0;
    while (offset < buf.length) {
      offset += writeSync(fd, buf, offset, buf.length - offset);
    }
    chmodSync(tmpPath, 0o600);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      /* ignore cleanup error */
    }
    throw err;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
  try {
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export function writeJsonAtomic0600(filePath: string, payload: unknown): void {
  writeBufferAtomic0600(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

export type VerifiedReadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: "missing" | "unsafe" | "corrupt" | "io"; readonly errnoCode?: string | undefined };

export function readVerifiedJson0600<T = Record<string, unknown>>(
  filePath: string,
  expectedUid: number = typeof process.getuid === "function" ? process.getuid() : 0,
): VerifiedReadResult<T> {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const st = fstatSync(fd);
    if (!st.isFile() || st.uid !== expectedUid || (st.mode & 0o777) !== 0o600) {
      return { ok: false, reason: "unsafe" };
    }
    if (st.size <= 0 || st.size > MAX_JSON_FILE_BYTES) {
      return { ok: false, reason: "corrupt" };
    }
    const buf = Buffer.alloc(st.size);
    let readTotal = 0;
    while (readTotal < st.size) {
      const n = readSync(fd, buf, readTotal, st.size - readTotal, readTotal);
      if (n <= 0) break;
      readTotal += n;
    }
    const raw = buf.subarray(0, readTotal).toString("utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "corrupt" };
    }
    return { ok: true, value: parsed as T };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ok: false, reason: "missing", errnoCode: code };
    if (code === "ELOOP") return { ok: false, reason: "unsafe", errnoCode: code };
    if (err instanceof SyntaxError) return { ok: false, reason: "corrupt" };
    return { ok: false, reason: "io", errnoCode: code };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

export type SessionClass = "human" | "background";
export type InvocationMode = "interactive" | "headless";
export type SessionCreatedBy = "launcher" | "session-start";

export interface SessionFiche {
  readonly version: 1;
  readonly sessionKey: string;
  readonly actorId: string;
  readonly agentUuid: string;
  readonly host: string;
  readonly invocationMode: InvocationMode;
  readonly createdBy: SessionCreatedBy;
  readonly hostSessionId: string | null;
  readonly cliPid: number | null;
  readonly cliStartTime: string | null;
  readonly sessionClass: SessionClass;
  readonly delegatorInstance: string | null;
  readonly delegatorSessionKey: string | null;
  readonly secretSha256: string;
  readonly leaderPid: number;
  readonly leaderStartTime: string;
  readonly bootId: string;
  readonly pidNamespace: string;
  readonly machineId: string;
  readonly scopeUnit: string | null;
  readonly issuedAt: string;
}

export interface SessionSidecar {
  readonly version: 1;
  readonly sessionKey: string;
  readonly sidecarPid: number;
  readonly sidecarStartTime: string;
  readonly bootId: string;
  readonly pidNamespace: string;
  readonly machineId: string;
  readonly issuedAt: string;
}

export interface RelaunchHandoff {
  readonly version: 1;
  readonly sessionKey: string;
  readonly actorId: string;
  readonly agentUuid: string;
  readonly host: string;
  readonly invocationMode: InvocationMode;
  readonly sessionClass: SessionClass;
  readonly delegatorInstance: string | null;
  readonly delegatorSessionKey: string | null;
  readonly hostSessionId: string | null;
  readonly jobId?: string | undefined;
  readonly secretPath: string;
  readonly secretSha256: string;
  readonly issuedAt: string;
}

export type DaemonLaunchKind = "mcp-central" | "mcp-stdio" | "native-station" | "loop-engine";

export interface DaemonLaunchReceipt {
  readonly version: 1;
  readonly launchId: string;
  readonly daemonKind: DaemonLaunchKind;
  readonly daemonPid: number;
  readonly daemonStartTime: string;
  readonly bootId: string;
  readonly pidNamespace: string;
  readonly machineId: string;
  readonly launchTokenSha256: string;
  readonly allowedVerb: string;
  readonly targetProfile?: string | undefined;
  readonly targetWorkspace?: string | undefined;
  readonly delegatorInstance: string;
  readonly delegationOrigin: string;
  readonly sessionClass: SessionClass;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export function sessionFichePath(runtimeDir: string, sessionKey: string): string {
  return join(runtimeDir, "sessions", `${sessionKey}.json`);
}

export function sessionSidecarPath(runtimeDir: string, sessionKey: string): string {
  return join(runtimeDir, "sessions", `${sessionKey}.sidecar.json`);
}

export function sessionLockPath(runtimeDir: string, sessionKey: string): string {
  return join(runtimeDir, "sessions", `${sessionKey}.lock`);
}

export function sessionSecretPath(runtimeDir: string, sessionKey: string): string {
  return join(runtimeDir, "session-secrets", `${sessionKey}.secret`);
}

export function relaunchHandoffPath(runtimeDir: string, sessionKey: string): string {
  return join(runtimeDir, "relaunch-handoffs", `${sessionKey}.json`);
}

export function daemonLaunchPath(runtimeDir: string, launchId: string): string {
  return join(runtimeDir, "daemon-launches", `${launchId}.json`);
}

export function generateSessionKey(): string {
  return randomBytes(18).toString("base64url");
}

/**
 * Create a 32-byte CSPRNG session secret file (`0600`) and return its path
 * and SHA-256 digest without exposing the raw secret in memory beyond writing.
 */
export function mintSessionKeyAndSecret(
  runtimeDir: string,
  sessionKey: string = generateSessionKey(),
): { readonly sessionKey: string; readonly secretPath: string; readonly secretSha256: string } {
  if (!SESSION_KEY_RE.test(sessionKey)) {
    throw new SessionRuntimeError("invalid-session-key", `invalid sessionKey: ${sessionKey}`);
  }
  const secretPath = sessionSecretPath(runtimeDir, sessionKey);
  const raw = randomBytes(32);
  try {
    const secretSha256 = createHash("sha256").update(raw).digest("hex");
    writeBufferAtomic0600(secretPath, raw);
    return { sessionKey, secretPath, secretSha256 };
  } finally {
    raw.fill(0);
  }
}

export function verifySessionSecretFile(
  secretPath: string,
  expectedSha256: string,
  expectedUid: number = typeof process.getuid === "function" ? process.getuid() : 0,
): boolean {
  if (!/^[0-9a-f]{64}$/i.test(expectedSha256)) return false;
  let fd: number | undefined;
  let buf: Buffer | undefined;
  try {
    fd = openSync(secretPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const st = fstatSync(fd);
    if (!st.isFile() || st.uid !== expectedUid || (st.mode & 0o777) !== 0o600) return false;
    if (st.size <= 0 || st.size > MAX_SECRET_BYTES) return false;
    buf = Buffer.alloc(st.size);
    let readTotal = 0;
    while (readTotal < st.size) {
      const n = readSync(fd, buf, readTotal, st.size - readTotal, readTotal);
      if (n <= 0) break;
      readTotal += n;
    }
    const actualDigest = createHash("sha256").update(buf.subarray(0, readTotal)).digest();
    const expectedDigest = Buffer.from(expectedSha256, "hex");
    if (actualDigest.length !== expectedDigest.length) return false;
    return timingSafeEqual(actualDigest, expectedDigest);
  } catch {
    return false;
  } finally {
    if (buf !== undefined) buf.fill(0);
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

export function isValidSessionFicheShape(value: unknown): value is SessionFiche {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const f = value as Record<string, unknown>;
  return (
    f["version"] === 1 &&
    typeof f["sessionKey"] === "string" &&
    SESSION_KEY_RE.test(f["sessionKey"]) &&
    typeof f["actorId"] === "string" &&
    f["actorId"].length > 0 &&
    typeof f["agentUuid"] === "string" &&
    f["agentUuid"].length > 0 &&
    typeof f["host"] === "string" &&
    f["host"].length > 0 &&
    (f["invocationMode"] === "interactive" || f["invocationMode"] === "headless") &&
    (f["createdBy"] === "launcher" || f["createdBy"] === "session-start") &&
    (f["hostSessionId"] === null || typeof f["hostSessionId"] === "string") &&
    (f["cliPid"] === null || (typeof f["cliPid"] === "number" && Number.isInteger(f["cliPid"]))) &&
    (f["cliStartTime"] === null || typeof f["cliStartTime"] === "string") &&
    (f["sessionClass"] === "human" || f["sessionClass"] === "background") &&
    (f["delegatorInstance"] === null || typeof f["delegatorInstance"] === "string") &&
    (f["delegatorSessionKey"] === null || typeof f["delegatorSessionKey"] === "string") &&
    typeof f["secretSha256"] === "string" &&
    /^[0-9a-f]{64}$/i.test(f["secretSha256"]) &&
    typeof f["leaderPid"] === "number" &&
    Number.isInteger(f["leaderPid"]) &&
    f["leaderPid"] > 0 &&
    typeof f["leaderStartTime"] === "string" &&
    f["leaderStartTime"].length > 0 &&
    typeof f["bootId"] === "string" &&
    typeof f["pidNamespace"] === "string" &&
    typeof f["machineId"] === "string" &&
    (f["scopeUnit"] === null || typeof f["scopeUnit"] === "string") &&
    typeof f["issuedAt"] === "string"
  );
}

export function isValidSessionSidecarShape(value: unknown): value is SessionSidecar {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const s = value as Record<string, unknown>;
  return (
    s["version"] === 1 &&
    typeof s["sessionKey"] === "string" &&
    SESSION_KEY_RE.test(s["sessionKey"]) &&
    typeof s["sidecarPid"] === "number" &&
    Number.isInteger(s["sidecarPid"]) &&
    s["sidecarPid"] > 0 &&
    typeof s["sidecarStartTime"] === "string" &&
    s["sidecarStartTime"].length > 0 &&
    typeof s["bootId"] === "string" &&
    typeof s["pidNamespace"] === "string" &&
    typeof s["machineId"] === "string" &&
    typeof s["issuedAt"] === "string"
  );
}

export function writeSessionFiche(runtimeDir: string, fiche: SessionFiche): string {
  const path = sessionFichePath(runtimeDir, fiche.sessionKey);
  writeJsonAtomic0600(path, fiche);
  return path;
}

export function writeSessionSidecar(runtimeDir: string, sidecar: SessionSidecar): string {
  const path = sessionSidecarPath(runtimeDir, sidecar.sessionKey);
  writeJsonAtomic0600(path, sidecar);
  return path;
}

export function writeRelaunchHandoff(runtimeDir: string, handoff: RelaunchHandoff): string {
  const path = relaunchHandoffPath(runtimeDir, handoff.sessionKey);
  writeJsonAtomic0600(path, handoff);
  return path;
}

export function readSessionFiche(
  runtimeDir: string,
  sessionKey: string,
  expectedUid?: number,
): SessionFiche | undefined {
  if (!SESSION_KEY_RE.test(sessionKey)) return undefined;
  const res = readVerifiedJson0600(sessionFichePath(runtimeDir, sessionKey), expectedUid);
  if (!res.ok || !isValidSessionFicheShape(res.value)) return undefined;
  return res.value;
}

export function readSessionSidecar(
  runtimeDir: string,
  sessionKey: string,
  expectedUid?: number,
): SessionSidecar | undefined {
  if (!SESSION_KEY_RE.test(sessionKey)) return undefined;
  const res = readVerifiedJson0600(sessionSidecarPath(runtimeDir, sessionKey), expectedUid);
  if (!res.ok || !isValidSessionSidecarShape(res.value)) return undefined;
  return res.value;
}

export function consumeRelaunchHandoff(
  runtimeDir: string,
  sessionKey: string,
  expectedUid?: number,
): RelaunchHandoff | undefined {
  if (!SESSION_KEY_RE.test(sessionKey)) return undefined;
  const path = relaunchHandoffPath(runtimeDir, sessionKey);
  const res = readVerifiedJson0600<RelaunchHandoff>(path, expectedUid);
  try {
    unlinkSync(path);
  } catch {
    /* best-effort delete */
  }
  if (!res.ok || res.value.sessionKey !== sessionKey) return undefined;
  return res.value;
}

export function purgeSessionArtifacts(runtimeDir: string, sessionKey: string): void {
  if (!SESSION_KEY_RE.test(sessionKey)) return;
  for (const path of [
    sessionFichePath(runtimeDir, sessionKey),
    sessionSidecarPath(runtimeDir, sessionKey),
    sessionLockPath(runtimeDir, sessionKey),
    sessionSecretPath(runtimeDir, sessionKey),
    relaunchHandoffPath(runtimeDir, sessionKey),
  ]) {
    try {
      rmSync(path, { force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

export function listSessionFiches(runtimeDir: string, expectedUid?: number): SessionFiche[] {
  const dir = join(runtimeDir, "sessions");
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const fiches: SessionFiche[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json") || name.endsWith(".sidecar.json")) continue;
    const key = name.slice(0, -5);
    const fiche = readSessionFiche(runtimeDir, key, expectedUid);
    if (fiche) fiches.push(fiche);
  }
  return fiches;
}

export function listSessionSidecars(runtimeDir: string, expectedUid?: number): SessionSidecar[] {
  const dir = join(runtimeDir, "sessions");
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const sidecars: SessionSidecar[] = [];
  for (const name of entries) {
    if (!name.endsWith(".sidecar.json")) continue;
    const key = name.slice(0, -".sidecar.json".length);
    const sc = readSessionSidecar(runtimeDir, key, expectedUid);
    if (sc) sidecars.push(sc);
  }
  return sidecars;
}

/**
 * Purge orphaned session artifacts in the host PID namespace whose `bootId`
 * differs or whose `(leaderPid, leaderStartTime)` is dead.
 */
export function sweepOrphanSessionFiches(
  runtimeDir: string,
  options: {
    readonly procRoot?: string | undefined;
    readonly currentBootId?: string | undefined;
    readonly currentPidNamespace?: string | undefined;
    readonly isPidAlive?: ((pid: number, startTime: string) => boolean) | undefined;
    readonly expectedUid?: number | undefined;
  } = {},
): string[] {
  const procRoot = options.procRoot ?? "/proc";
  const currentBootId = options.currentBootId ?? readBootId(procRoot);
  const currentPidNs = options.currentPidNamespace ?? readPidNamespaceId("self", procRoot);
  const aliveFn =
    options.isPidAlive ?? ((pid: number, startTime: string) => isProcessAlive(pid, startTime, procRoot));

  const sessionsDir = join(runtimeDir, "sessions");
  let entries: string[];
  try {
    entries = readdirSync(sessionsDir);
  } catch {
    return [];
  }

  const purged: string[] = [];
  for (const name of entries) {
    if (name.endsWith(".tmp")) {
      try {
        const tmpFile = join(sessionsDir, name);
        const st = lstatSync(tmpFile);
        if (st.isSymbolicLink() || Date.now() - st.mtimeMs >= 60_000) {
          rmSync(tmpFile, { force: true });
        }
      } catch {
        /* ignore */
      }
      continue;
    }
    if (!name.endsWith(".json") || name.endsWith(".sidecar.json")) continue;
    const key = name.slice(0, -5);
    const fiche = readSessionFiche(runtimeDir, key, options.expectedUid);
    if (!fiche) continue;
    const staleBoot = currentBootId !== undefined && fiche.bootId !== currentBootId;
    const deadInSameNs =
      !staleBoot &&
      currentPidNs !== undefined &&
      fiche.pidNamespace === currentPidNs &&
      !aliveFn(fiche.leaderPid, fiche.leaderStartTime);
    if (staleBoot || deadInSameNs) {
      purgeSessionArtifacts(runtimeDir, fiche.sessionKey);
      purged.push(fiche.sessionKey);
    }
  }
  return purged;
}

export function waitForSessionFiche(
  runtimeDir: string,
  sessionKey: string,
  options: { readonly timeoutMs?: number | undefined; readonly expectedUid?: number | undefined } = {},
): SessionFiche | undefined {
  if (!SESSION_KEY_RE.test(sessionKey)) return undefined;
  const timeoutMs = Math.max(0, options.timeoutMs ?? 10_000);
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  for (;;) {
    const fiche = readSessionFiche(runtimeDir, sessionKey, options.expectedUid);
    if (fiche) return fiche;
    const now = Date.now();
    if (now >= deadline) return undefined;
    const interval = now - startedAt < 1_000 ? 20 : 50;
    sleepSync(Math.min(interval, deadline - now));
  }
}

export function issueDaemonLaunchReceipt(
  runtimeDir: string,
  input: {
    readonly daemonKind: DaemonLaunchKind;
    readonly allowedVerb: string;
    readonly delegatorInstance: string;
    readonly delegationOrigin: string;
    readonly sessionClass: SessionClass;
    readonly targetProfile?: string | undefined;
    readonly targetWorkspace?: string | undefined;
    readonly ttlMs?: number | undefined;
    readonly daemonPid?: number | undefined;
    readonly procRoot?: string | undefined;
    readonly now?: number | undefined;
    readonly launchToken?: string | undefined;
  },
): { readonly launchId: string; readonly launchToken: string; readonly receiptPath: string; readonly receipt: DaemonLaunchReceipt } {
  const procRoot = input.procRoot ?? "/proc";
  const now = input.now ?? Date.now();
  const pid = input.daemonPid ?? process.pid;
  const stat = readProcStat(pid, procRoot);
  const bootId = readBootId(procRoot) ?? "nonlinux-boot";
  const pidNamespace = readPidNamespaceId("self", procRoot) ?? "nonlinux-pidns";
  const machineId = readMachineId();
  const launchId = randomBytes(16).toString("base64url");
  const launchToken = input.launchToken || randomBytes(32).toString("base64url");
  const launchTokenSha256 = createHash("sha256").update(launchToken, "utf8").digest("hex");
  const ttlMs = Math.min(Math.max(1_000, input.ttlMs ?? DAEMON_LAUNCH_DEFAULT_TTL_MS), 60_000);

  const receipt: DaemonLaunchReceipt = {
    version: 1,
    launchId,
    daemonKind: input.daemonKind,
    daemonPid: pid,
    daemonStartTime: stat?.startTime ?? "0",
    bootId,
    pidNamespace,
    machineId,
    launchTokenSha256,
    allowedVerb: input.allowedVerb,
    ...(input.targetProfile !== undefined ? { targetProfile: input.targetProfile } : {}),
    ...(input.targetWorkspace !== undefined ? { targetWorkspace: input.targetWorkspace } : {}),
    delegatorInstance: input.delegatorInstance,
    delegationOrigin: input.delegationOrigin,
    sessionClass: input.sessionClass,
    issuedAt: now,
    expiresAt: now + ttlMs,
  };
  const receiptPath = daemonLaunchPath(runtimeDir, launchId);
  writeJsonAtomic0600(receiptPath, receipt);
  return { launchId, launchToken, receiptPath, receipt };
}

export function deleteDaemonLaunchReceipt(runtimeDir: string, launchId: string): void {
  if (!SESSION_KEY_RE.test(launchId)) return;
  try {
    rmSync(daemonLaunchPath(runtimeDir, launchId), { force: true });
  } catch {
    /* best-effort cleanup */
  }
}

export function consumeDaemonLaunchReceipt(
  runtimeDir: string,
  input: {
    readonly launchId: string;
    readonly launchToken: string;
    readonly verb: string;
    readonly ancestorPids: ReadonlyArray<{ readonly pid: number; readonly startTime: string }>;
    readonly procRoot?: string | undefined;
    readonly now?: number | undefined;
    readonly expectedUid?: number | undefined;
  },
): { readonly ok: true; readonly receipt: DaemonLaunchReceipt } | { readonly ok: false; readonly reason: string } {
  if (!SESSION_KEY_RE.test(input.launchId) || !input.launchToken) {
    return { ok: false, reason: "malformed-launch-credentials" };
  }
  const path = daemonLaunchPath(runtimeDir, input.launchId);
  const claimPath = `${path}.claiming.${process.pid}.${randomBytes(4).toString("hex")}`;
  try {
    renameSync(path, claimPath);
  } catch {
    return { ok: false, reason: "receipt-missing-or-already-consumed" };
  }
  try {
    const read = readVerifiedJson0600<DaemonLaunchReceipt>(claimPath, input.expectedUid);
    if (!read.ok) return { ok: false, reason: `receipt-${read.reason}` };
    const receipt = read.value;
    if (
      receipt.version !== 1 ||
      receipt.launchId !== input.launchId ||
      receipt.allowedVerb !== input.verb
    ) {
      return { ok: false, reason: "receipt-verb-or-id-mismatch" };
    }
    const now = input.now ?? Date.now();
    if (receipt.issuedAt > now + CLOCK_SKEW_TOLERANCE_MS || now >= receipt.expiresAt || receipt.expiresAt - receipt.issuedAt > 60_000) {
      return { ok: false, reason: "receipt-expired-or-clock-skew" };
    }
    const procRoot = input.procRoot ?? "/proc";
    const curBoot = readBootId(procRoot) ?? "nonlinux-boot";
    const curMachine = readMachineId();
    if (receipt.bootId !== curBoot || receipt.machineId !== curMachine) {
      return { ok: false, reason: "receipt-host-mismatch" };
    }
    const actualSha = createHash("sha256").update(input.launchToken, "utf8").digest();
    const expectedSha = Buffer.from(receipt.launchTokenSha256, "hex");
    if (
      expectedSha.length !== actualSha.length ||
      !timingSafeEqual(actualSha, expectedSha)
    ) {
      return { ok: false, reason: "receipt-token-mismatch" };
    }
    const matchedAncestor = input.ancestorPids.some(
      (anc) => anc.pid === receipt.daemonPid && anc.startTime === receipt.daemonStartTime,
    );
    if (!matchedAncestor) {
      return { ok: false, reason: "receipt-daemon-not-ancestor" };
    }
    return { ok: true, receipt };
  } finally {
    try {
      unlinkSync(claimPath);
    } catch {
      /* best-effort cleanup */
    }
  }
}

// --- Codex --no-daemon argument rewriting and probe via bash -lc ---

const CODEX_VALUE_FLAGS = new Set([
  "-c",
  "--config",
  "-i",
  "--image",
  "-m",
  "--model",
  "-p",
  "--profile",
  "-s",
  "--sandbox",
  "-a",
  "--ask-for-approval",
  "-C",
  "--cd",
  "--add-dir",
  "--enable",
  "--disable",
  "--local-provider",
  "--color",
  "-o",
  "--output-last-message",
  "--output-schema",
]);

const CODEX_NON_DAEMON_SUBCOMMANDS = new Set([
  "exec",
  "e",
  "login",
  "logout",
  "mcp",
  "mcp-server",
  "app-server",
  "plugin",
  "sandbox",
  "debug",
  "completion",
  "features",
  "cloud",
  "apply",
  "review",
  "help",
]);

/**
 * Rewrite a Codex `args` array (excluding binary `codex`) so local interactive/
 * resume/fork invocations carry at most one `--no-daemon` when `enabled` is true,
 * and `exec` / non-session subcommands (or `enabled: false`) carry zero.
 */
export function applyCodexNoDaemon(
  args: readonly string[],
  options: { readonly enabled: boolean },
): string[] {
  const deduped = args.filter((token) => token !== "--no-daemon");
  if (!options.enabled) return deduped;

  let i = 0;
  let subcmdIdx = -1;
  while (i < deduped.length) {
    const token = deduped[i]!;
    if (token === "--") {
      if (i + 1 < deduped.length) subcmdIdx = i + 1;
      break;
    }
    if (token.startsWith("-")) {
      const eqIdx = token.indexOf("=");
      const flagName = eqIdx === -1 ? token : token.slice(0, eqIdx);
      if (eqIdx === -1 && CODEX_VALUE_FLAGS.has(flagName)) {
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    subcmdIdx = i;
    break;
  }

  if (subcmdIdx !== -1) {
    const firstPos = deduped[subcmdIdx]!;
    if (CODEX_NON_DAEMON_SUBCOMMANDS.has(firstPos)) {
      return deduped;
    }
    if (firstPos === "resume" || firstPos === "fork") {
      return [
        ...deduped.slice(0, subcmdIdx + 1),
        "--no-daemon",
        ...deduped.slice(subcmdIdx + 1),
      ];
    }
  }
  return ["--no-daemon", ...deduped];
}

const codexNoDaemonSupportCache = new Map<string, boolean>();

function resolveCommandViaLoginShell(command: string, pathEnv: string): string | undefined {
  if (command.includes("/")) return command;
  try {
    const res = spawnSync(
      "/bin/bash",
      ["-lc", 'command -v -- "$1"', "bash", command],
      {
        encoding: "utf8",
        timeout: 3_000,
        env: { ...process.env, PATH: pathEnv },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    if (res.status !== 0) return undefined;
    const out = (res.stdout ?? "").trim().split(/\r?\n/)[0]?.trim();
    return out && out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

export function clearCodexNoDaemonCache(): void {
  codexNoDaemonSupportCache.clear();
}

/**
 * Probe whether `command` (default `"codex"`) supports `--no-daemon`.
 * When `command` is a bare name without `/`, resolves its target path via
 * `bash -lc "command -v -- <command>"` so non-interactive subshells pick up
 * login PATH identically to interactive panes. Cached per resolved path.
 */
export function codexSupportsNoDaemon(
  command = "codex",
  options: {
    readonly pathEnv?: string | undefined;
    readonly resolveBinary?: ((cmd: string, pathEnv: string) => string | undefined) | undefined;
    readonly probeHelp?: ((resolvedPath: string) => string | undefined) | undefined;
  } = {},
): boolean {
  const pathEnv = options.pathEnv ?? process.env["PATH"] ?? "";
  const resolved = options.resolveBinary
    ? options.resolveBinary(command, pathEnv)
    : resolveCommandViaLoginShell(command, pathEnv);
  if (!resolved) return false;

  const canCache = options.resolveBinary === undefined && options.probeHelp === undefined;
  const cacheKey = `${pathEnv}\0${resolved}`;
  if (canCache && codexNoDaemonSupportCache.has(cacheKey)) {
    return codexNoDaemonSupportCache.get(cacheKey)!;
  }

  let helpText: string | undefined;
  if (options.probeHelp) {
    helpText = options.probeHelp(resolved);
  } else {
    try {
      const res = spawnSync(resolved, ["--help"], {
        encoding: "utf8",
        timeout: 3_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      helpText = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    } catch {
      helpText = undefined;
    }
  }
  const supported = helpText !== undefined && /(?:^|\s)--no-daemon\b/.test(helpText);
  if (canCache) {
    codexNoDaemonSupportCache.set(cacheKey, supported);
  }
  return supported;
}
