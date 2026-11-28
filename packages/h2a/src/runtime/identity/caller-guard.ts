/**
 * Fail-closed CLI caller identity verification guard for Lot 1.1+1.2 (`bin.ts` & `bin-heavy.ts`).
 *
 * Keeps purely to `node:*` built-ins plus light core leaf modules (`agent-policy`,
 * `session-auth`, `owner-grants`) so static shim import tests (`mh-l1-routing.test.js`)
 * stay clean and fast.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import {
  resolveVerbAgentPolicy,
  type OwnerGrantActId,
  type ResolvedAgentVerbPolicy,
} from "../../agent-policy.js";
import {
  consumeOwnerGrantForAct,
  type OwnerGrant,
} from "./owner-grants.js";
import {
  CANONICAL_LOGIN_RE,
  consumeDaemonLaunchReceipt,
  extractSessionScopeUnit,
  isWithinDir,
  listSessionFiches,
  listSessionSidecars,
  parseHostCliFromProcess,
  readBootId,
  readMachineId,
  readPidNamespaceId,
  readProcArgv,
  readProcCgroup,
  readProcExe,
  readProcStat,
  readProcUptimeSeconds,
  readSessionFiche,
  readSessionSidecar,
  readValidD16Receipt,
  readValidHostQualificationReservation,
  resolveSessionRuntimeDir,
  RUN_LAUNCH_ID_ENV,
  RUN_LAUNCH_TOKEN_ENV,
  SESSION_CLASS_ENV,
  SESSION_KEY_RE,
  SESSION_PROOF_PATH_ENV,
  SESSION_REF_ENV,
  sessionSecretPath,
  verifySessionSecretFile,
  IDENTITY_GUARD_ENFORCE_ENV,
  type DaemonLaunchReceipt,
  type D16ReceiptLite,
  type HostQualificationReservationLite,
  type SessionClass,
  type SessionFiche,
  type SessionSidecar,
} from "./session-auth.js";

export const VERIFIED_CALLER_CONTEXT_SYMBOL = Symbol.for("h2a.verifiedCallerContext");
const MAX_PROC_HOPS = 64;
const MAX_SYMLINK_DEPTH = 6;
const MAX_SYMLINK_ENTRIES = 4096;
const MAX_ROLLOUT_HOPS = 8;

const PROOF4_ENV_KEYS = [
  SESSION_CLASS_ENV,
  SESSION_REF_ENV,
  SESSION_PROOF_PATH_ENV,
  "H2A_NATIVE_PTY_SESSION",
  "REMOTE_JOB_ID",
  "CLAUDE_CODE_SESSION_ID",
  "CODEX_THREAD_ID",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
] as const;

const FORBIDDEN_SECRET_ARG_FLAGS = new Set([
  "--session-secret",
  "--secret",
  "--session-proof",
  "--grant",
  "--grant-token",
  "--grant-secret",
]);

const INTERMEDIATE_SHELL_NAMES = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "ash"]);

export type CallerMode =
  | "internal"
  | "daemon-receipt"
  | "agent"
  | "h2a-shell"
  | "owner"
  | "script"
  | "d16-bypass"
  | "isolated-tmp";

export type VerificationMode =
  | "proc-lineage"
  | "pidns-session-ref"
  | "sidecar-anchor"
  | "daemon-receipt"
  | "internal"
  | "owner"
  | "script";

export type CodexThreadAuditTag =
  | "same-or-child-thread"
  | "interactive-other-thread"
  | "exec-on-interactive"
  | "rollout-absent"
  | null;

export interface VerifiedCallerContext {
  readonly verified: boolean;
  readonly mode: CallerMode;
  readonly isAgent: boolean;
  readonly isH2aShell: boolean;
  readonly isOwner: boolean;
  readonly isScript: boolean;
  readonly parentFicheRejected: boolean;
  readonly isForeignPidNamespace: boolean;
  readonly actorId: string | null;
  readonly sessionKey: string | null;
  readonly agentUuid: string | null;
  readonly host: string | null;
  readonly delegatorInstance: string | null;
  readonly delegatorSessionKey: string | null;
  readonly verificationMode: VerificationMode;
  readonly sessionFiche: SessionFiche | null;
}

export interface AuditRecord {
  readonly at: string;
  readonly stage: "hook" | "cli" | "mcp";
  readonly outcome: "allowed" | "denied" | "audit-only" | "failed";
  readonly reasonCode: string;
  readonly verificationMode: VerificationMode;
  readonly codexThreadAudit: CodexThreadAuditTag;
  readonly grantId: string | null;
  readonly grantAct: OwnerGrantActId | null;
  readonly claimedLogin: string | null;
  readonly verifiedLogin: string | null;
  readonly sessionKey: string | null;
  readonly host: string | null;
  readonly sessionClass: SessionClass | null;
  readonly delegatorInstance: string | null;
  readonly commandVerb: string;
  readonly callerPid: number;
  readonly leaderPid: number | null;
  readonly scopeUnit: string | null;
  readonly isTty: boolean;
  readonly exitCode?: number | undefined;
}

export interface CallerGuardSuccess {
  readonly ok: true;
  readonly mode: CallerMode;
  readonly verificationMode: VerificationMode;
  readonly forwardedArgv: readonly string[];
  readonly policy: ResolvedAgentVerbPolicy;
  readonly claimedLogin: string | null;
  readonly actorId: string | null;
  readonly sessionFiche: SessionFiche | null;
  readonly sidecar: SessionSidecar | null;
  readonly daemonReceipt: DaemonLaunchReceipt | null;
  readonly parentFicheRejected: boolean;
  readonly isForeignPidNamespace: boolean;
  readonly isLaneScope: boolean;
  readonly consumedGrant: OwnerGrant | null;
  readonly runtimeDir: string | null;
  readonly recordGrantOutcome?: (exitCode: number) => void;
}

export interface CallerGuardFailure {
  readonly ok: false;
  readonly exitCode: 1 | 2 | 3;
  readonly reasonCode: string;
  readonly message: string;
  readonly hint?: string | undefined;
  readonly auditWritten: boolean;
  readonly alertWritten: boolean;
}

export type CallerGuardResult = CallerGuardSuccess | CallerGuardFailure;

export interface VerifyCallerIdentityOptions {
  readonly argv: readonly string[];
  readonly cwd?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly stdinIsTTY?: boolean | undefined;
  readonly stdoutIsTTY?: boolean | undefined;
  readonly pid?: number | undefined;
  readonly procRoot?: string | undefined;
  readonly sessionRuntimeDir?: string | undefined;
  readonly hostPidNamespace?: string | undefined;
  readonly codexSessionsDir?: string | undefined;
  readonly uid?: number | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly now?: () => number;
  readonly stderr?: (chunk: string) => void;
}

interface ProcAncestorEntry {
  readonly pid: number;
  readonly startTime: string;
  readonly ppid: number;
  readonly exe?: string | undefined;
  readonly argv: readonly string[];
  readonly hostCli: { readonly host: string; readonly matchedBy: string } | undefined;
}

function resolveHomeDir(env: Readonly<Record<string, string | undefined>>): string {
  const raw = env["HOME"]?.trim();
  return raw && raw.length > 0 ? raw : homedir();
}

function resolveStateBaseDir(env: Readonly<Record<string, string | undefined>>): string {
  const raw = env["XDG_STATE_HOME"]?.trim();
  return raw && raw.length > 0 ? raw : join(resolveHomeDir(env), ".local", "state");
}

function statePaths(env: Readonly<Record<string, string | undefined>>): {
  readonly dir: string;
  readonly auditPath: string;
  readonly alertsPath: string;
} {
  const dir = join(resolveStateBaseDir(env), "h2a");
  return {
    dir,
    auditPath: join(dir, "cli-identity-audit.jsonl"),
    alertsPath: join(dir, "owner-alerts.jsonl"),
  };
}

function appendPrivateJsonl(
  filePath: string,
  payload: unknown,
  stderrWrite: (chunk: string) => void,
  fallbackPrefix: string,
): boolean {
  const line = `${JSON.stringify(payload)}\n`;
  try {
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      const dStat = lstatSync(dir);
      if (dStat.isDirectory() && !dStat.isSymbolicLink() && (dStat.mode & 0o077) !== 0) {
        chmodSync(dir, 0o700);
      }
    } catch {
      /* best effort */
    }
    appendFileSync(filePath, line, { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(filePath, 0o600);
    } catch {
      /* best effort */
    }
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EROFS" || code === "EACCES" || code === "EPERM" || fallbackPrefix) {
      stderrWrite(`${fallbackPrefix}${JSON.stringify(payload)}\n`);
    }
    return false;
  }
}

export function writeCliIdentityAudit(
  record: AuditRecord,
  env: Readonly<Record<string, string | undefined>>,
  stderrWrite: (chunk: string) => void,
  skipPersist: boolean,
): boolean {
  if (skipPersist) return false;
  const { auditPath } = statePaths(env);
  return appendPrivateJsonl(auditPath, record, stderrWrite, "[h2a-audit-fallback] ");
}

export function writeOwnerIdentityAlert(
  alert: Record<string, unknown>,
  env: Readonly<Record<string, string | undefined>>,
  stderrWrite: (chunk: string) => void,
  skipPersist: boolean,
): boolean {
  if (skipPersist) return false;
  const { alertsPath } = statePaths(env);
  return appendPrivateJsonl(alertsPath, alert, stderrWrite, "[h2a-alert-fallback] ");
}

/** Extract global `--as <login>` anywhere outside `--` and preserve for `coach`. */
export function extractGlobalAsFlag(argv: readonly string[]):
  | {
      readonly ok: true;
      readonly asLogin: string | null;
      readonly stripAsFromArgv: (keepAs: boolean) => readonly string[];
    }
  | {
      readonly ok: false;
      readonly reasonCode: "missing-login" | "cli-identity-mismatch";
      readonly message: string;
    } {
  let asLogin: string | null = null;
  const skipIndices = new Set<number>();

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok === "--") break;
    if (tok === "--as") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        return {
          ok: false,
          reasonCode: "missing-login",
          message: "option --as requires a canonical login value (<host>:<slug>:<uuid12>)",
        };
      }
      if (asLogin !== null && asLogin !== next) {
        return {
          ok: false,
          reasonCode: "cli-identity-mismatch",
          message: `conflicting --as values supplied ("${asLogin}" vs "${next}")`,
        };
      }
      asLogin = next;
      skipIndices.add(i);
      skipIndices.add(i + 1);
      i++;
    } else if (tok.startsWith("--as=")) {
      const val = tok.slice(5);
      if (!val) {
        return {
          ok: false,
          reasonCode: "missing-login",
          message: "option --as requires a non-empty canonical login value",
        };
      }
      if (asLogin !== null && asLogin !== val) {
        return {
          ok: false,
          reasonCode: "cli-identity-mismatch",
          message: `conflicting --as values supplied ("${asLogin}" vs "${val}")`,
        };
      }
      asLogin = val;
      skipIndices.add(i);
    }
  }

  return {
    ok: true,
    asLogin,
    stripAsFromArgv: (keepAs: boolean) => {
      const stripped = argv.filter((_, idx) => !skipIndices.has(idx));
      if (!keepAs || !asLogin) return stripped;
      return stripped.length >= 2
        ? [stripped[0]!, stripped[1]!, "--as", asLogin, ...stripped.slice(2)]
        : [...stripped, "--as", asLogin];
    },
  };
}

function collectProcChain(startPid: number, procRoot: string): ProcAncestorEntry[] {
  const entries: ProcAncestorEntry[] = [];
  const seen = new Set<number>();
  let curPid = startPid;
  let childStartTimeBigInt: bigint | undefined;

  for (let hop = 0; hop < MAX_PROC_HOPS && curPid > 0 && !seen.has(curPid); hop++) {
    seen.add(curPid);
    const st = readProcStat(curPid, procRoot);
    if (!st) break;
    let curStartBig: bigint | undefined;
    try {
      curStartBig = BigInt(st.startTime);
    } catch {
      curStartBig = undefined;
    }
    if (
      hop > 0 &&
      childStartTimeBigInt !== undefined &&
      curStartBig !== undefined &&
      curStartBig > childStartTimeBigInt
    ) {
      // Kernel PID reuse detected (parent started AFTER child) — stop walking.
      break;
    }
    const exe = readProcExe(curPid, procRoot);
    const argv = readProcArgv(curPid, procRoot);
    const hostCli = parseHostCliFromProcess(exe, argv);
    entries.push({
      pid: curPid,
      startTime: st.startTime,
      ppid: st.ppid,
      exe,
      argv,
      hostCli: hostCli ? { host: hostCli.host, matchedBy: hostCli.matchedBy } : undefined,
    });
    if (st.ppid <= 0 || curPid === 1) break;
    childStartTimeBigInt = curStartBig;
    curPid = st.ppid;
  }
  return entries;
}

function isIntermediateShell(entry: ProcAncestorEntry): boolean {
  const exeBase = entry.exe ? basename(entry.exe) : "";
  const arg0Base = entry.argv[0] ? basename(entry.argv[0]).replace(/^-/, "") : "";
  return INTERMEDIATE_SHELL_NAMES.has(exeBase) || INTERMEDIATE_SHELL_NAMES.has(arg0Base);
}

function collapseHostCliChain(
  ancestors: readonly ProcAncestorEntry[],
): Array<{ readonly pid: number; readonly index: number; readonly host: string }> {
  const collapsed: Array<{ readonly pid: number; readonly index: number; readonly host: string }> = [];
  let prevHost: string | undefined;
  let sawShellSinceLast = false;

  for (let i = 1; i < ancestors.length; i++) {
    const entry = ancestors[i]!;
    if (entry.hostCli) {
      if (!sawShellSinceLast && prevHost === entry.hostCli.host) {
        // Consecutive identical host CLI without intermediate shell (e.g. wrapper -> versioned bin).
        continue;
      }
      collapsed.push({ pid: entry.pid, index: i, host: entry.hostCli.host });
      prevHost = entry.hostCli.host;
      sawShellSinceLast = false;
    } else if (isIntermediateShell(entry)) {
      sawShellSinceLast = true;
    }
  }
  return collapsed;
}

function hasCodexAppServerAncestor(ancestors: readonly ProcAncestorEntry[]): boolean {
  for (let i = 1; i < ancestors.length; i++) {
    const entry = ancestors[i]!;
    if (entry.hostCli?.host !== "codex") continue;
    const args = entry.argv.slice(1);
    const nonFlag = args.find((tok) => !tok.startsWith("-") && !tok.endsWith(".js") && !tok.endsWith(".mjs"));
    if (nonFlag === "app-server" || args.includes("app-server")) return true;
  }
  return false;
}

function readProc1Comm(procRoot: string): string | undefined {
  try {
    return readFileSync(join(procRoot, "1", "comm"), "utf8").trim();
  } catch {
    const exe = readProcExe(1, procRoot);
    return exe ? basename(exe) : undefined;
  }
}

function detectForeignPidNamespace(input: {
  readonly currentPidNs: string | undefined;
  readonly hostPidNamespace: string | undefined;
  readonly procRoot: string;
  readonly fiches: readonly SessionFiche[];
  readonly currentBootId: string;
}): boolean {
  if (input.hostPidNamespace && input.currentPidNs) {
    return input.currentPidNs !== input.hostPidNamespace;
  }
  if (input.currentPidNs) {
    if (
      input.fiches.some(
        (f) => f.bootId === input.currentBootId && f.pidNamespace !== input.currentPidNs,
      )
    ) {
      return true;
    }
  }
  if (process.platform === "linux" && input.procRoot === "/proc") {
    const comm1 = readProc1Comm(input.procRoot);
    if (comm1 && comm1 !== "systemd" && comm1 !== "init" && existsSync("/run/systemd/system")) {
      return true;
    }
  }
  return false;
}

function inspectCodexThreadAudit(
  env: Readonly<Record<string, string | undefined>>,
  fiche: SessionFiche,
  codexSessionsDir?: string,
): CodexThreadAuditTag {
  if (fiche.host !== "codex") return null;
  const threadId = env["CODEX_THREAD_ID"]?.trim();
  if (!threadId) return null;
  if (fiche.hostSessionId && threadId === fiche.hostSessionId) {
    return "same-or-child-thread";
  }
  const baseDir = codexSessionsDir ?? join(resolveHomeDir(env), ".codex", "sessions");
  if (!existsSync(baseDir)) return "rollout-absent";

  const metaByThread = new Map<
    string,
    { readonly source?: string; readonly originator?: string; readonly parentThreadId?: string }
  >();
  const scanQueue: Array<{ readonly dir: string; readonly depth: number }> = [{ dir: baseDir, depth: 0 }];
  let scanned = 0;

  while (scanQueue.length > 0 && scanned < 1024) {
    const cur = scanQueue.shift()!;
    let entries: string[];
    try {
      entries = readdirSync(cur.dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (++scanned > 1024) break;
      const full = join(cur.dir, name);
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (cur.depth < 4) scanQueue.push({ dir: full, depth: cur.depth + 1 });
        continue;
      }
      if (!name.endsWith(".jsonl") || !name.includes(threadId)) continue;
      try {
        const firstLine = readFileSync(full, "utf8").split(/\r?\n/, 1)[0];
        if (!firstLine) continue;
        const parsed = JSON.parse(firstLine) as {
          type?: string;
          payload?: {
            id?: string;
            source?: string | { thread_spawn?: { parent_thread_id?: string } };
            originator?: string;
          };
        };
        if (parsed.type === "session_meta" && parsed.payload?.id) {
          const src = parsed.payload.source;
          metaByThread.set(parsed.payload.id, {
            source: typeof src === "string" ? src : src ? "subagent" : undefined,
            originator: parsed.payload.originator,
            parentThreadId:
              typeof src === "object" && src?.thread_spawn?.parent_thread_id
                ? src.thread_spawn.parent_thread_id
                : undefined,
          });
        }
      } catch {
        /* best effort audit only */
      }
    }
  }

  const rootMeta = metaByThread.get(threadId);
  if (!rootMeta) return "rollout-absent";

  if (fiche.invocationMode === "interactive" && (rootMeta.source === "exec" || rootMeta.originator === "codex_exec")) {
    return "exec-on-interactive";
  }

  let curParent = rootMeta.parentThreadId;
  for (let hop = 0; hop < MAX_ROLLOUT_HOPS && curParent; hop++) {
    if (fiche.hostSessionId && curParent === fiche.hostSessionId) {
      return "same-or-child-thread";
    }
    curParent = metaByThread.get(curParent)?.parentThreadId;
  }

  return "interactive-other-thread";
}

export function scanPathForSymlinkEscape(targetPath: string, boundaryReal: string): string | undefined {
  let fixedBoundary: string;
  try {
    fixedBoundary = realpathSync(boundaryReal);
  } catch {
    return `boundary unavailable: ${boundaryReal}`;
  }

  // Check path components from root down to existing prefix.
  const abs = resolve(targetPath);
  const parts = abs.split("/").filter(Boolean);
  let cur = "/";
  for (const part of parts) {
    cur = join(cur, part);
    let st;
    try {
      st = lstatSync(cur);
    } catch {
      break;
    }
    if (st.isSymbolicLink()) {
      try {
        const real = realpathSync(cur);
        if (!isWithinDir(real, fixedBoundary)) {
          return `symlink escapes isolated boundary: ${cur} -> ${real}`;
        }
      } catch {
        return `dangling or unreadable symlink at ${cur}`;
      }
    }
  }

  if (!existsSync(abs)) {
    // Walk up to nearest existing parent directory to ensure target lies within boundary.
    let probe = abs;
    while (!existsSync(probe) && probe !== dirname(probe)) {
      probe = dirname(probe);
    }
    try {
      const realParent = realpathSync(probe);
      if (!isWithinDir(realParent, fixedBoundary)) {
        return `path resolves outside isolated root: ${abs} (${realParent})`;
      }
    } catch {
      return `unresolvable path parent: ${probe}`;
    }
    return undefined;
  }

  try {
    const topReal = realpathSync(abs);
    if (!isWithinDir(topReal, fixedBoundary)) {
      return `path resolves outside isolated root: ${abs} -> ${topReal}`;
    }
  } catch {
    return `unresolvable path: ${abs}`;
  }

  let seen = 0;
  const queue: Array<{ readonly dir: string; readonly depth: number }> = [];
  try {
    const st = lstatSync(abs);
    if (st.isDirectory()) queue.push({ dir: abs, depth: 0 });
  } catch {
    return undefined;
  }

  while (queue.length > 0) {
    const item = queue.shift()!;
    let names: string[];
    try {
      names = readdirSync(item.dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (++seen > MAX_SYMLINK_ENTRIES) {
        return `isolated root scan exceeded ${MAX_SYMLINK_ENTRIES} entries`;
      }
      const full = join(item.dir, name);
      let lst;
      try {
        lst = lstatSync(full);
      } catch {
        continue;
      }
      if (lst.isSymbolicLink()) {
        try {
          const resolved = realpathSync(full);
          if (!isWithinDir(resolved, fixedBoundary)) {
            return `symlink escapes isolated boundary: ${full} -> ${resolved}`;
          }
        } catch {
          try {
            const rawLink = readlinkSync(full);
            const resolvedLink = isAbsolute(rawLink) ? resolve(rawLink) : resolve(dirname(full), rawLink);
            if (!isWithinDir(resolvedLink, fixedBoundary)) {
              return `dangling symlink escapes isolated boundary: ${full} -> ${resolvedLink}`;
            }
          } catch {
            return `unreadable symlink at ${full}`;
          }
        }
        continue;
      }
      if (lst.isDirectory()) {
        if (item.depth + 1 > MAX_SYMLINK_DEPTH) continue;
        queue.push({ dir: full, depth: item.depth + 1 });
      }
    }
  }
  return undefined;
}

function parseSimpleCliFlags(argv: readonly string[]): {
  readonly values: Record<string, string>;
  readonly present: Set<string>;
} {
  const values: Record<string, string> = {};
  const present = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (tok === "--") break;
    if (!tok.startsWith("--") || tok.length <= 2) continue;
    const eq = tok.indexOf("=");
    if (eq !== -1) {
      const k = tok.slice(2, eq);
      present.add(`--${k}`);
      values[k] = tok.slice(eq + 1);
      continue;
    }
    const k = tok.slice(2);
    present.add(`--${k}`);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values[k] = next;
      i++;
    } else {
      values[k] = "true";
    }
  }
  return { values, present };
}

function validateCentralCompactArgsPure(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--dry-run" || arg === "--restore" || arg === "--json") continue;
    if (arg === "--root" || arg === "--runtime-base") {
      const val = args[++i];
      if (!val || val.startsWith("--")) return `central compact: ${arg} requires a value`;
      continue;
    }
    if (arg.startsWith("--")) return `central compact: unknown flag ${arg}`;
    return `central compact: unexpected argument ${arg}`;
  }
  if (args.includes("--dry-run") && args.includes("--restore")) {
    return "central compact: cannot combine --dry-run and --restore";
  }
  return undefined;
}

function validateCentralStopArgsPure(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json" || arg === "--force") continue;
    if (arg === "--root" || arg === "--runtime-base") {
      const val = args[++i];
      if (!val || val.startsWith("--")) return `central stop: ${arg} requires a value`;
      continue;
    }
    if (arg.startsWith("--")) return `central stop: unknown flag ${arg}`;
    return `central stop: unexpected argument ${arg}`;
  }
  return undefined;
}

function argvContainsRawSecret(
  argv: readonly string[],
  secretPath: string | null,
): boolean {
  for (const tok of argv) {
    if (FORBIDDEN_SECRET_ARG_FLAGS.has(tok.split("=")[0]!)) {
      return true;
    }
  }
  if (!secretPath) return false;
  try {
    const st = statSync(secretPath);
    if (!st.isFile() || st.size <= 0 || st.size > 128) return false;
    const raw = readFileSync(secretPath);
    try {
      const hex = raw.toString("hex");
      const utf = raw.toString("utf8").trim();
      for (const tok of argv) {
        if (tok.length >= 32 && (tok.includes(hex) || (utf.length >= 16 && tok.includes(utf)))) {
          return true;
        }
      }
    } finally {
      raw.fill(0);
    }
  } catch {
    /* secret check continues in verifySessionSecretFile */
  }
  return false;
}

function findNearestTrackDir(cwd: string): string | undefined {
  let cur = resolve(cwd);
  for (;;) {
    const cand = join(cur, ".track");
    if (existsSync(cand)) return cand;
    const parent = dirname(cur);
    if (parent === cur) return undefined;
    cur = parent;
  }
}

export function setGlobalVerifiedCallerContext(ctx: VerifiedCallerContext): void {
  (globalThis as Record<symbol, VerifiedCallerContext | undefined>)[
    VERIFIED_CALLER_CONTEXT_SYMBOL
  ] = ctx;
}

export function getGlobalVerifiedCallerContext(): VerifiedCallerContext | undefined {
  return (globalThis as Record<symbol, VerifiedCallerContext | undefined>)[
    VERIFIED_CALLER_CONTEXT_SYMBOL
  ];
}

export function verifyCallerIdentity(
  options: VerifyCallerIdentityOptions,
): CallerGuardResult {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const procRoot = options.procRoot ?? "/proc";
  const pid = options.pid ?? process.pid;
  const uid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : 0);
  const platform = options.platform ?? process.platform;
  const nowFn = options.now ?? Date.now;
  const stdinIsTTY = options.stdinIsTTY ?? (process.stdin.isTTY === true);
  const stdoutIsTTY = options.stdoutIsTTY ?? (process.stdout.isTTY === true);
  const stderrWrite = options.stderr ?? ((chunk: string) => { process.stderr.write(chunk); });

  const fail = (input: {
    readonly exitCode?: 1 | 2 | 3;
    readonly reasonCode: string;
    readonly message: string;
    readonly hint?: string;
    readonly alert: boolean;
    readonly policyVerb: string;
    readonly verificationMode: VerificationMode;
    readonly claimedLogin?: string | null;
    readonly fiche?: SessionFiche | null;
    readonly codexThreadAudit?: CodexThreadAuditTag;
    readonly grantAct?: OwnerGrantActId | null;
    readonly skipPersist?: boolean;
  }): CallerGuardFailure => {
    const at = new Date(nowFn()).toISOString();
    const record: AuditRecord = {
      at,
      stage: "cli",
      outcome: "denied",
      reasonCode: input.reasonCode,
      verificationMode: input.verificationMode,
      codexThreadAudit: input.codexThreadAudit ?? null,
      grantId: null,
      grantAct: input.grantAct ?? null,
      claimedLogin: input.claimedLogin ?? null,
      verifiedLogin: input.fiche?.actorId ?? null,
      sessionKey: input.fiche?.sessionKey ?? null,
      host: input.fiche?.host ?? null,
      sessionClass: input.fiche?.sessionClass ?? null,
      delegatorInstance: input.fiche?.delegatorInstance ?? null,
      commandVerb: input.policyVerb,
      callerPid: pid,
      leaderPid: input.fiche?.leaderPid ?? null,
      scopeUnit: input.fiche?.scopeUnit ?? null,
      isTty: stdinIsTTY,
    };
    const skip = input.skipPersist ?? false;
    const auditWritten = writeCliIdentityAudit(record, env, stderrWrite, skip);
    const alertWritten = input.alert
      ? writeOwnerIdentityAlert(
          {
            at,
            kind: "cli-identity-alert",
            reasonCode: input.reasonCode,
            commandVerb: input.policyVerb,
            claimedLogin: input.claimedLogin ?? null,
            verifiedLogin: input.fiche?.actorId ?? null,
            callerPid: pid,
            message: input.message,
          },
          env,
          stderrWrite,
          skip,
        )
      : false;
    return {
      ok: false,
      exitCode: input.exitCode ?? 2,
      reasonCode: input.reasonCode,
      message: input.message,
      ...(input.hint ? { hint: input.hint } : {}),
      auditWritten,
      alertWritten,
    };
  };

  // Extract global --as <login> before verb resolution.
  const asParse = extractGlobalAsFlag(options.argv);
  if (!asParse.ok) {
    const tentative = options.argv.find((t) => !t.startsWith("-")) ?? "--unknown";
    return fail({
      reasonCode: asParse.reasonCode,
      message: asParse.message,
      alert: asParse.reasonCode === "cli-identity-mismatch",
      policyVerb: tentative,
      verificationMode: "owner",
    });
  }

  const normalizedForPolicy = asParse.stripAsFromArgv(false);
  const policy = resolveVerbAgentPolicy(normalizedForPolicy);
  const keepAsFlag =
    normalizedForPolicy[0] === "coach" && normalizedForPolicy[1] === "propose";
  const forwardedArgv = asParse.stripAsFromArgv(keepAsFlag);
  const { values: parsedFlags } = parseSimpleCliFlags(forwardedArgv);

  const d16Enforced = env[IDENTITY_GUARD_ENFORCE_ENV] === "1";
  const d16Receipt: D16ReceiptLite | undefined = d16Enforced
    ? undefined
    : readValidD16Receipt(env, { platform, uid });
  const qualReceipt: HostQualificationReservationLite | undefined =
    d16Enforced || d16Receipt
      ? undefined
      : readValidHostQualificationReservation(env, { platform, uid, procRoot });
  const bypassRoot = d16Receipt?.root ?? qualReceipt?.stageRoot;

  const resolvedRoot = parsedFlags["root"] ?? env["H2A_ROOT"] ?? undefined;
  const resolvedTrackDir = parsedFlags["track-dir"] ?? env["TRACK_DIR"] ?? findNearestTrackDir(cwd);

  const d16CoversExplicitPaths = (() => {
    if (!bypassRoot) return false;
    try {
      const rootBoundary = realpathSync(bypassRoot);
      const extraBoundaries: string[] = [];
      if (d16Receipt) {
        try {
          extraBoundaries.push(realpathSync("/tmp"));
        } catch {
          /* ignore */
        }
        for (const wp of d16Receipt.writablePaths ?? []) {
          try {
            extraBoundaries.push(realpathSync(wp));
          } catch {
            /* path might not exist yet on all invocations */
          }
        }
      }
      const inBypassBoundary = (candidate: string): boolean => {
        const resolvedCandidate = resolve(candidate);
        if (isWithinDir(resolvedCandidate, rootBoundary)) return true;
        return extraBoundaries.some((b) => isWithinDir(resolvedCandidate, b));
      };
      if (qualReceipt && !resolvedRoot && !parsedFlags["track-dir"]) {
        const homeDir = env["HOME"];
        if (!homeDir || !isWithinDir(resolve(homeDir), rootBoundary)) {
          return false;
        }
      }
      if (resolvedRoot && !inBypassBoundary(resolvedRoot)) {
        return false;
      }
      if (parsedFlags["track-dir"] && !inBypassBoundary(parsedFlags["track-dir"])) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  })();

  // Safe isolated runtime dir / production runtime dir resolution.
  let fixedTmpRoot: string | undefined;
  try {
    fixedTmpRoot = realpathSync("/tmp");
  } catch {
    fixedTmpRoot = undefined;
  }

  const computeIsolatedTmpRoot = (): { readonly matched: boolean; readonly escapeError?: string } => {
    if (!fixedTmpRoot) return { matched: false };
    const isTrackVerb = forwardedArgv[0] !== undefined && [
      "query", "report", "snapshot", "decision", "demand", "item", "accept",
      "blocker", "consolidate", "priority", "branch", "ingest", "restructure",
    ].includes(forwardedArgv[0]);
    const targetCandidate = isTrackVerb ? resolvedTrackDir : resolvedRoot;
    if (!targetCandidate) return { matched: false };
    if (!isWithinDir(resolve(targetCandidate), fixedTmpRoot)) return { matched: false };
    if (forwardedArgv[0] === "send" && (parsedFlags["backend"] === "cluster-mesh" || env["H2A_MESSAGE_BACKEND"] === "cluster-mesh")) {
      return { matched: false };
    }
    const rootEsc = scanPathForSymlinkEscape(targetCandidate, fixedTmpRoot);
    if (rootEsc) return { matched: true, escapeError: rootEsc };
    if (resolvedRoot && isWithinDir(resolve(resolvedRoot), fixedTmpRoot)) {
      const storeEsc = scanPathForSymlinkEscape(resolvedRoot, fixedTmpRoot);
      if (storeEsc) return { matched: true, escapeError: storeEsc };
    }
    if (isTrackVerb && resolvedTrackDir) {
      const trackEsc = scanPathForSymlinkEscape(resolvedTrackDir, fixedTmpRoot);
      if (trackEsc) return { matched: true, escapeError: trackEsc };
    }
    return { matched: true };
  };

  let runtimeDir: string | null = null;
  const isolatedRootForRuntime =
    !d16Receipt &&
    resolvedRoot &&
    fixedTmpRoot &&
    isWithinDir(resolve(resolvedRoot), fixedTmpRoot)
      ? resolvedRoot
      : undefined;

  const tryResolveRuntimeDir = (createIfMissing = false): string | null => {
    try {
      return resolveSessionRuntimeDir({
        env,
        sessionRuntimeDir: options.sessionRuntimeDir,
        ...(isolatedRootForRuntime ? { isolatedTmpRoot: isolatedRootForRuntime } : {}),
        createIfMissing,
        uid,
        platform,
      }).dir;
    } catch {
      return null;
    }
  };

  // Pre-collect host/proc context.
  const ancestors = collectProcChain(pid, procRoot);
  const collapsedHostClis = collapseHostCliChain(ancestors);
  const nearestHostCli = collapsedHostClis[0];
  const isCodexManagedDaemon = hasCodexAppServerAncestor(ancestors);
  const currentBootId = readBootId(procRoot) ?? "nonlinux-boot";
  const currentPidNs = readPidNamespaceId("self", procRoot) ?? "nonlinux-pidns";
  const currentMachineId = readMachineId();
  const cgroupText = readProcCgroup("self", procRoot) ?? "";
  const currentScopeUnit = extractSessionScopeUnit(cgroupText);
  const isLaneScope = /(?:^|\/)h2a-lane-[^/\s]+\.scope(?:\s|$)/m.test(cgroupText);
  const proof3Cgroup =
    /(?:h2a-session-[^/\s]+\.scope|h2a-lane-[^/\s]+\.scope|h2a-agents\.slice)/m.test(cgroupText);

  runtimeDir = tryResolveRuntimeDir(false);
  const allFiches = runtimeDir ? listSessionFiches(runtimeDir, uid) : [];
  const allSidecars = runtimeDir ? listSessionSidecars(runtimeDir, uid) : [];
  const isForeignPidNamespace = detectForeignPidNamespace({
    currentPidNs,
    hostPidNamespace: options.hostPidNamespace,
    procRoot,
    fiches: allFiches,
    currentBootId,
  });

  // 1. Check Proof 1 `/proc` lineage fiche matching.
  let lineageFiche: { readonly fiche: SessionFiche; readonly index: number } | undefined;
  for (let i = 1; i < ancestors.length; i++) {
    const anc = ancestors[i]!;
    const match = allFiches.find(
      (f) =>
        f.bootId === currentBootId &&
        f.pidNamespace === currentPidNs &&
        f.leaderPid === anc.pid &&
        f.leaderStartTime === anc.startTime,
    );
    if (match) {
      lineageFiche = { fiche: match, index: i };
      break;
    }
  }

  let validFiche: SessionFiche | null = null;
  let parentFicheRejected = false;
  let pidLineageMismatch = false;
  let verificationMode: VerificationMode = "owner";

  if (lineageFiche) {
    const lf = lineageFiche.fiche;
    const hostClisBelowLeader = collapsedHostClis.filter((c) => c.index <= lineageFiche.index);
    if (lf.cliPid !== null) {
      if (nearestHostCli && nearestHostCli.pid === lf.cliPid) {
        validFiche = lf;
        verificationMode = "proc-lineage";
      } else {
        parentFicheRejected = true;
      }
    } else if (
      nearestHostCli &&
      nearestHostCli.index <= lineageFiche.index &&
      nearestHostCli.host === lf.host &&
      hostClisBelowLeader.length === 1
    ) {
      validFiche = lf;
      verificationMode = "proc-lineage";
    } else {
      parentFicheRejected = true;
    }
  }

  // Sidecar discovery for MCP transports when outside leader lineage.
  let matchedSidecar: SessionSidecar | null = null;
  if (policy.isInternalMcpTransport && !validFiche) {
    for (let i = 0; i < ancestors.length; i++) {
      const anc = ancestors[i]!;
      const sc = allSidecars.find(
        (s) =>
          s.bootId === currentBootId &&
          s.pidNamespace === currentPidNs &&
          s.sidecarPid === anc.pid &&
          s.sidecarStartTime === anc.startTime,
      );
      if (sc && runtimeDir) {
        matchedSidecar = sc;
        const scFiche = readSessionFiche(runtimeDir, sc.sessionKey, uid);
        if (scFiche && scFiche.bootId === currentBootId) {
          validFiche = scFiche;
          verificationMode = "sidecar-anchor";
        }
        break;
      }
    }
    if (!validFiche && !matchedSidecar && runtimeDir) {
      const ref = env[SESSION_REF_ENV]?.trim();
      if (ref && SESSION_KEY_RE.test(ref)) {
        const sc = allSidecars.find((s) => s.sessionKey === ref);
        const scFiche = readSessionFiche(runtimeDir, ref, uid);
        if (sc && scFiche) {
          matchedSidecar = sc;
          validFiche = scFiche;
          verificationMode = "sidecar-anchor";
        }
      }
    }
  }

  // 1b. Bounded `pidns-session-ref` fallback when Proof 1 finds no fiche.
  const envSessionRef = env[SESSION_REF_ENV]?.trim();
  if (!validFiche && !parentFicheRejected && envSessionRef) {
    if (!SESSION_KEY_RE.test(envSessionRef)) {
      pidLineageMismatch = true;
    } else if (runtimeDir) {
      const refFiche = readSessionFiche(runtimeDir, envSessionRef, uid);
      if (refFiche) {
        if (currentPidNs === refFiche.pidNamespace) {
          // Copied H2A_SESSION_REF inside the host PID namespace is never valid without /proc lineage.
          pidLineageMismatch = true;
        } else if (refFiche.bootId !== currentBootId || refFiche.machineId !== currentMachineId) {
          pidLineageMismatch = true;
        } else if (
          collapsedHostClis.length !== 1 ||
          collapsedHostClis[0]!.host !== refFiche.host
        ) {
          parentFicheRejected = true;
        } else {
          validFiche = refFiche;
          verificationMode = "pidns-session-ref";
        }
      }
    }
  }

  // 2. Daemon-internal receipt (evaluated before Proof 4 non-TTY markers).
  const launchId = env[RUN_LAUNCH_ID_ENV]?.trim();
  const launchToken = env[RUN_LAUNCH_TOKEN_ENV]?.trim();
  if ((launchId || launchToken) && !stdinIsTTY && !policy.isInternalMcpTransport) {
    if (!launchId || !launchToken) {
      return fail({
        reasonCode: "daemon-receipt-invalid",
        message: "incomplete daemon launch receipt environment credentials",
        alert: true,
        policyVerb: policy.commandVerb,
        verificationMode: "daemon-receipt",
      });
    }
    if (!runtimeDir) {
      return fail({
        reasonCode: "daemon-receipt-invalid",
        message: "session runtime directory unavailable for daemon launch receipt verification",
        alert: true,
        policyVerb: policy.commandVerb,
        verificationMode: "daemon-receipt",
      });
    }
    const receiptRes = consumeDaemonLaunchReceipt(runtimeDir, {
      launchId,
      launchToken,
      verb: forwardedArgv[0] ?? policy.commandVerb,
      ancestorPids: ancestors.map((a) => ({ pid: a.pid, startTime: a.startTime })),
      procRoot,
      now: nowFn(),
      expectedUid: uid,
    });
    if (!receiptRes.ok) {
      return fail({
        reasonCode: "daemon-receipt-invalid",
        message: `daemon launch receipt rejected (${receiptRes.reason})`,
        alert: true,
        policyVerb: policy.commandVerb,
        verificationMode: "daemon-receipt",
      });
    }
    const receipt = receiptRes.receipt;
    if (receipt.daemonKind !== "mcp-stdio") {
      // Non-mcp-stdio daemons must not descend from an agent host CLI.
      const daemonIdx = ancestors.findIndex((a) => a.pid === receipt.daemonPid);
      const cliAboveDaemon =
        daemonIdx >= 0 && collapsedHostClis.some((c) => c.index >= daemonIdx);
      if (cliAboveDaemon) {
        return fail({
          reasonCode: "daemon-receipt-invalid",
          message: "daemon launch receipt originated from inside an agent lineage",
          alert: true,
          policyVerb: policy.commandVerb,
          verificationMode: "daemon-receipt",
        });
      }
    }
    writeCliIdentityAudit(
      {
        at: new Date(nowFn()).toISOString(),
        stage: "cli",
        outcome: "allowed",
        reasonCode: "daemon-receipt-verified",
        verificationMode: "daemon-receipt",
        codexThreadAudit: null,
        grantId: null,
        grantAct: null,
        claimedLogin: null,
        verifiedLogin: receipt.delegatorInstance,
        sessionKey: null,
        host: null,
        sessionClass: receipt.sessionClass,
        delegatorInstance: receipt.delegatorInstance,
        commandVerb: policy.commandVerb,
        callerPid: pid,
        leaderPid: receipt.daemonPid,
        scopeUnit: null,
        isTty: stdinIsTTY,
      },
      env,
      stderrWrite,
      false,
    );
    return {
      ok: true,
      mode: "daemon-receipt",
      verificationMode: "daemon-receipt",
      forwardedArgv,
      policy,
      claimedLogin: null,
      actorId: receipt.delegatorInstance,
      sessionFiche: null,
      sidecar: null,
      daemonReceipt: receipt,
      parentFicheRejected: false,
      isForeignPidNamespace,
      isLaneScope,
      consumedGrant: null,
      runtimeDir,
    };
  }

  // 3. Evaluate internal entry exemptions.
  if (policy.agentPolicy === "internal") {
    if (policy.isInternalMcpTransport) {
      const explicitInstance = parsedFlags["instance"];
      if (parentFicheRejected && explicitInstance) {
        return fail({
          reasonCode: "fiche-parent-rejected",
          message: `MCP transport refused: --instance "${explicitInstance}" cannot borrow a rejected parent session fiche`,
          alert: true,
          policyVerb: policy.commandVerb,
          verificationMode: "internal",
          claimedLogin: explicitInstance,
        });
      }
      if (!validFiche) {
        writeCliIdentityAudit(
          {
            at: new Date(nowFn()).toISOString(),
            stage: "cli",
            outcome: "audit-only",
            reasonCode: parentFicheRejected ? "fiche-parent-rejected" : "fiche-absent",
            verificationMode: "internal",
            codexThreadAudit: null,
            grantId: null,
            grantAct: null,
            claimedLogin: explicitInstance ?? null,
            verifiedLogin: null,
            sessionKey: null,
            host: null,
            sessionClass: null,
            delegatorInstance: null,
            commandVerb: policy.commandVerb,
            callerPid: pid,
            leaderPid: null,
            scopeUnit: null,
            isTty: stdinIsTTY,
          },
          env,
          stderrWrite,
          Boolean(d16CoversExplicitPaths),
        );
      }
      return {
        ok: true,
        mode: "internal",
        verificationMode: validFiche ? verificationMode : "internal",
        forwardedArgv,
        policy,
        claimedLogin: asParse.asLogin,
        actorId: validFiche?.actorId ?? null,
        sessionFiche: validFiche,
        sidecar: matchedSidecar,
        daemonReceipt: null,
        parentFicheRejected,
        isForeignPidNamespace,
        isLaneScope,
        consumedGrant: null,
        runtimeDir,
      };
    }

    if (policy.isPresenceReapWithoutInstance) {
      const iso = computeIsolatedTmpRoot();
      if (iso.escapeError) {
        return fail({
          reasonCode: "isolated-root-symlink-escape",
          message: iso.escapeError,
          alert: true,
          policyVerb: policy.commandVerb,
          verificationMode: "internal",
        });
      }
      if (!d16CoversExplicitPaths && !(iso.matched && !d16Enforced) && isForeignPidNamespace) {
        return fail({
          reasonCode: "presence-reap-pidns-forbidden",
          message: "refusing `h2a presence-reap` inside an isolated PID namespace (host PID namespace required)",
          alert: false,
          policyVerb: policy.commandVerb,
          verificationMode: "internal",
        });
      }
      return {
        ok: true,
        mode: "internal",
        verificationMode: "internal",
        forwardedArgv,
        policy,
        claimedLogin: null,
        actorId: validFiche?.actorId ?? null,
        sessionFiche: validFiche,
        sidecar: null,
        daemonReceipt: null,
        parentFicheRejected,
        isForeignPidNamespace,
        isLaneScope,
        consumedGrant: null,
        runtimeDir,
      };
    }

    if (policy.isHookCommand) {
      if (validFiche && parsedFlags["instance"] && parsedFlags["instance"] !== validFiche.actorId) {
        writeCliIdentityAudit(
          {
            at: new Date(nowFn()).toISOString(),
            stage: "hook",
            outcome: "audit-only",
            reasonCode: "hook-static-instance",
            verificationMode,
            codexThreadAudit: null,
            grantId: null,
            grantAct: null,
            claimedLogin: parsedFlags["instance"] ?? null,
            verifiedLogin: validFiche.actorId,
            sessionKey: validFiche.sessionKey,
            host: validFiche.host,
            sessionClass: validFiche.sessionClass,
            delegatorInstance: validFiche.delegatorInstance,
            commandVerb: policy.commandVerb,
            callerPid: pid,
            leaderPid: validFiche.leaderPid,
            scopeUnit: validFiche.scopeUnit,
            isTty: stdinIsTTY,
          },
          env,
          stderrWrite,
          Boolean(d16CoversExplicitPaths),
        );
      }
      return {
        ok: true,
        mode: "internal",
        verificationMode: "internal",
        forwardedArgv,
        policy,
        claimedLogin: parsedFlags["instance"] ?? null,
        actorId: validFiche?.actorId ?? null,
        sessionFiche: validFiche,
        sidecar: null,
        daemonReceipt: null,
        parentFicheRejected,
        isForeignPidNamespace,
        isLaneScope,
        consumedGrant: null,
        runtimeDir,
      };
    }

    if (policy.isStatusWatchHostOnly) {
      if (!lineageFiche && !parentFicheRejected && !nearestHostCli) {
        return {
          ok: true,
          mode: "internal",
          verificationMode: "internal",
          forwardedArgv,
          policy,
          claimedLogin: asParse.asLogin,
          actorId: null,
          sessionFiche: null,
          sidecar: null,
          daemonReceipt: null,
          parentFicheRejected: false,
          isForeignPidNamespace,
          isLaneScope,
          consumedGrant: null,
          runtimeDir,
        };
      }
      // Inside agent lineage/host CLI: fall through as normal agent read requiring --as.
    } else {
      return {
        ok: true,
        mode: "internal",
        verificationMode: "internal",
        forwardedArgv,
        policy,
        claimedLogin: asParse.asLogin,
        actorId: null,
        sessionFiche: validFiche,
        sidecar: null,
        daemonReceipt: null,
        parentFicheRejected,
        isForeignPidNamespace,
        isLaneScope,
        consumedGrant: null,
        runtimeDir,
      };
    }
  }

  // Re-normalize policy when status --watch fell out of host-only internal.
  const effectivePolicy: ResolvedAgentVerbPolicy =
    policy.isStatusWatchHostOnly
      ? { ...policy, agentPolicy: "allow", isStatusWatchHostOnly: false }
      : policy;

  // 4. Determine Proof 4 & caller context (`h2a-shell` vs `agent` vs `owner` vs `script`).
  const hasAgentOnlyEnv = Boolean(
    env["H2A_SESSION_REF"]?.trim() ||
      env["H2A_SESSION_PROOF_PATH"]?.trim() ||
      env["REMOTE_JOB_ID"]?.trim() ||
      env["CLAUDE_CODE_SESSION_ID"]?.trim() ||
      env["CODEX_THREAD_ID"]?.trim() ||
      env["CODEX_SANDBOX"]?.trim() ||
      env["CODEX_SANDBOX_NETWORK_DISABLED"]?.trim() ||
      env["H2A_SESSION_CLASS"] === "background",
  );
  const proof4Env = PROOF4_ENV_KEYS.some((k) => Boolean(env[k]?.trim()));

  const isH2aShell =
    !validFiche &&
    !parentFicheRejected &&
    !nearestHostCli &&
    !pidLineageMismatch &&
    stdinIsTTY &&
    env[SESSION_CLASS_ENV] === "human" &&
    !hasAgentOnlyEnv;

  const isAgentContext =
    !isH2aShell &&
    Boolean(validFiche || parentFicheRejected || nearestHostCli || proof3Cgroup || proof4Env || pidLineageMismatch);

  // 5. Handle h2a-shell (`r6` + `Ajout`: allow TTY relaunch & reads, forbid owner-only, owner-authorized, actor writes).
  if (isH2aShell) {
    if (d16CoversExplicitPaths && !d16Enforced) {
      return {
        ok: true,
        mode: "d16-bypass",
        verificationMode: "owner",
        forwardedArgv,
        policy: effectivePolicy,
        claimedLogin: asParse.asLogin,
        actorId: null,
        sessionFiche: null,
        sidecar: null,
        daemonReceipt: null,
        parentFicheRejected: false,
        isForeignPidNamespace,
        isLaneScope,
        consumedGrant: null,
        runtimeDir,
      };
    }
    if (effectivePolicy.agentPolicy === "owner-only") {
      return fail({
        reasonCode: "owner-only-command",
        message: `refusing \`h2a ${effectivePolicy.commandVerb}\` inside h2a-shell (${SESSION_CLASS_ENV}=human); run from an interactive owner terminal outside h2a`,
        alert: true,
        policyVerb: effectivePolicy.commandVerb,
        verificationMode: "owner",
        claimedLogin: asParse.asLogin,
      });
    }
    if (effectivePolicy.agentPolicy === "owner-authorized") {
      return fail({
        reasonCode: "owner-authorization-required",
        message: `refusing \`h2a ${effectivePolicy.commandVerb}\` inside h2a-shell; run from an interactive owner terminal outside h2a`,
        alert: true,
        policyVerb: effectivePolicy.commandVerb,
        verificationMode: "owner",
        claimedLogin: asParse.asLogin,
        grantAct: effectivePolicy.ownerAuthorizedAct ?? null,
      });
    }
    if (!effectivePolicy.h2aShellAllowed) {
      const msg =
        effectivePolicy.agentPolicy === "unclassified"
          ? `refusing unclassified command \`h2a ${effectivePolicy.commandVerb}\` inside h2a-shell`
          : `refusing actor write/privileged command \`h2a ${effectivePolicy.commandVerb}\` inside h2a-shell`;
      return fail({
        reasonCode:
          effectivePolicy.agentPolicy === "unclassified"
            ? "unclassified-verb-denied"
            : "owner-only-command",
        message: msg,
        alert: true,
        policyVerb: effectivePolicy.commandVerb,
        verificationMode: "owner",
        claimedLogin: asParse.asLogin,
      });
    }
    return {
      ok: true,
      mode: "h2a-shell",
      verificationMode: "owner",
      forwardedArgv,
      policy: effectivePolicy,
      claimedLogin: asParse.asLogin,
      actorId: null,
      sessionFiche: null,
      sidecar: null,
      daemonReceipt: null,
      parentFicheRejected: false,
      isForeignPidNamespace,
      isLaneScope,
      consumedGrant: null,
      runtimeDir,
    };
  }

  // 6. Owner interactive mode & Script/service mode (outside agent context & h2a-shell).
  if (!isAgentContext) {
    if (stdinIsTTY) {
      const needsStdoutTty =
        forwardedArgv[0] === "trust" ||
        forwardedArgv[0] === "authorize" ||
        (forwardedArgv[0] === "remote" &&
          ["enrol", "up", "on", "revoke"].includes(forwardedArgv[1] ?? ""));
      if (needsStdoutTty && !stdoutIsTTY) {
        return fail({
          reasonCode: "owner-only-command",
          message: `refusing \`h2a ${effectivePolicy.commandVerb}\`: both stdin and stdout must be interactive owner terminals`,
          alert: false,
          policyVerb: effectivePolicy.commandVerb,
          verificationMode: "owner",
        });
      }
      return {
        ok: true,
        mode: "owner",
        verificationMode: "owner",
        forwardedArgv,
        policy: effectivePolicy,
        claimedLogin: asParse.asLogin,
        actorId: null,
        sessionFiche: null,
        sidecar: null,
        daemonReceipt: null,
        parentFicheRejected: false,
        isForeignPidNamespace,
        isLaneScope,
        consumedGrant: null,
        runtimeDir,
      };
    }

    // Non-TTY script / service mode outside session.
    if (d16CoversExplicitPaths && !d16Enforced) {
      return {
        ok: true,
        mode: "d16-bypass",
        verificationMode: "script",
        forwardedArgv,
        policy: effectivePolicy,
        claimedLogin: null,
        actorId: null,
        sessionFiche: null,
        sidecar: null,
        daemonReceipt: null,
        parentFicheRejected: false,
        isForeignPidNamespace,
        isLaneScope,
        consumedGrant: null,
        runtimeDir,
      };
    }

    if (effectivePolicy.agentPolicy === "unclassified") {
      return fail({
        reasonCode: "unclassified-verb-denied",
        message: `refusing unclassified command \`h2a ${effectivePolicy.commandVerb}\` in non-interactive script mode`,
        hint: "for tests, run under sandbox confinement: node scripts/test-sandbox.mjs -- <command>",
        alert: true,
        policyVerb: effectivePolicy.commandVerb,
        verificationMode: "script",
      });
    }

    if (effectivePolicy.isolatedRootSafe && effectivePolicy.privateKeyFlags.length === 0) {
      const iso = computeIsolatedTmpRoot();
      if (iso.escapeError) {
        return fail({
          reasonCode: "isolated-root-symlink-escape",
          message: iso.escapeError,
          alert: true,
          policyVerb: effectivePolicy.commandVerb,
          verificationMode: "script",
        });
      }
      if (iso.matched && !d16Enforced) {
        return {
          ok: true,
          mode: "isolated-tmp",
          verificationMode: "script",
          forwardedArgv,
          policy: effectivePolicy,
          claimedLogin: null,
          actorId: null,
          sessionFiche: null,
          sidecar: null,
          daemonReceipt: null,
          parentFicheRejected: false,
          isForeignPidNamespace,
          isLaneScope,
          consumedGrant: null,
          runtimeDir,
        };
      }
    }

    if (effectivePolicy.scriptServiceAllowed) {
      if (forwardedArgv[0] === "remote" && forwardedArgv[1] === "mirror") {
        const keyPath = parsedFlags["private-key"];
        const inst = parsedFlags["instance"];
        if (!keyPath || !inst || !resolvedRoot || resolve(keyPath) !== resolve(join(resolvedRoot, "keys", `${inst}.key.pem`))) {
          return fail({
            reasonCode: "private-key-mismatch",
            message: `h2a remote mirror service requires canonical --private-key <root>/keys/${inst ?? "<instance>"}.key.pem`,
            alert: true,
            policyVerb: effectivePolicy.commandVerb,
            verificationMode: "script",
            claimedLogin: inst ?? null,
          });
        }
      }
      return {
        ok: true,
        mode: "script",
        verificationMode: "script",
        forwardedArgv,
        policy: effectivePolicy,
        claimedLogin: null,
        actorId: null,
        sessionFiche: null,
        sidecar: null,
        daemonReceipt: null,
        parentFicheRejected: false,
        isForeignPidNamespace,
        isLaneScope,
        consumedGrant: null,
        runtimeDir,
      };
    }

    return fail({
      reasonCode: "owner-only-command",
      message: `refusing \`h2a ${effectivePolicy.commandVerb}\` in non-interactive mode outside a verified session`,
      hint: "run in an interactive owner terminal, or for tests use node scripts/test-sandbox.mjs -- <command>",
      alert: false,
      policyVerb: effectivePolicy.commandVerb,
      verificationMode: "script",
    });
  }

  // 7. Agent Context — evaluate D16 bypass ONLY when H2A_IDENTITY_GUARD_ENFORCE != 1.
  if (d16CoversExplicitPaths && !d16Enforced) {
    return {
      ok: true,
      mode: "d16-bypass",
      verificationMode: validFiche ? verificationMode : "script",
      forwardedArgv,
      policy: effectivePolicy,
      claimedLogin: asParse.asLogin,
      actorId: validFiche?.actorId ?? null,
      sessionFiche: validFiche,
      sidecar: null,
      daemonReceipt: null,
      parentFicheRejected,
      isForeignPidNamespace,
      isLaneScope,
      consumedGrant: null,
      runtimeDir,
    };
  }

  // 8. Evaluate agentPolicy BEFORE isolated `/tmp` mode (`DESIGN-r18.md:117-121, 289`).
  if (effectivePolicy.agentPolicy === "owner-only") {
    return fail({
      reasonCode: "owner-only-command",
      message: effectivePolicy.matchedOwnerOnlyFlag
        ? `refusing \`h2a ${effectivePolicy.commandVerb}\` (${effectivePolicy.matchedOwnerOnlyFlag} is owner-only)`
        : `refusing owner-only command \`h2a ${effectivePolicy.commandVerb}\` inside agent session`,
      hint: "run this command directly from an interactive owner terminal, or for tests use node scripts/test-sandbox.mjs -- <command>",
      alert: true,
      policyVerb: effectivePolicy.commandVerb,
      verificationMode: validFiche ? verificationMode : "proc-lineage",
      claimedLogin: asParse.asLogin,
      fiche: validFiche,
    });
  }

  if (effectivePolicy.agentPolicy === "unclassified") {
    return fail({
      reasonCode: "unclassified-verb-denied",
      message: `refusing unclassified command \`h2a ${effectivePolicy.commandVerb}\` inside agent session`,
      hint: "for tests use node scripts/test-sandbox.mjs -- <command>",
      alert: true,
      policyVerb: effectivePolicy.commandVerb,
      verificationMode: validFiche ? verificationMode : "proc-lineage",
      claimedLogin: asParse.asLogin,
      fiche: validFiche,
    });
  }

  // 9. Isolated `/tmp` mode (strictly AFTER agentPolicy; closed isolatedRootSafe list only).
  if (
    effectivePolicy.isolatedRootSafe &&
    effectivePolicy.privateKeyFlags.length === 0 &&
    !d16Enforced
  ) {
    const iso = computeIsolatedTmpRoot();
    if (iso.escapeError) {
      return fail({
        reasonCode: "isolated-root-symlink-escape",
        message: iso.escapeError,
        alert: true,
        policyVerb: effectivePolicy.commandVerb,
        verificationMode: validFiche ? verificationMode : "proc-lineage",
        claimedLogin: asParse.asLogin,
        fiche: validFiche,
      });
    }
    if (iso.matched) {
      return {
        ok: true,
        mode: "isolated-tmp",
        verificationMode: validFiche ? verificationMode : "proc-lineage",
        forwardedArgv,
        policy: effectivePolicy,
        claimedLogin: asParse.asLogin,
        actorId: validFiche?.actorId ?? null,
        sessionFiche: validFiche,
        sidecar: null,
        daemonReceipt: null,
        parentFicheRejected,
        isForeignPidNamespace,
        isLaneScope,
        consumedGrant: null,
        runtimeDir,
      };
    }
  }

  // 10. Require active, own-lineage verified session fiche.
  if (!validFiche) {
    if (isCodexManagedDaemon && !isForeignPidNamespace) {
      return fail({
        reasonCode: "codex-managed-daemon-unsupported",
        message: "codex app-server managed daemon sessions are unsupported for verified h2a CLI calls; launch Codex via `h2a run codex` (--no-daemon)",
        alert: false,
        policyVerb: effectivePolicy.commandVerb,
        verificationMode: "proc-lineage",
        claimedLogin: asParse.asLogin,
      });
    }
    if (pidLineageMismatch) {
      return fail({
        reasonCode: "pid-lineage-mismatch",
        message: "session proof reference does not match caller process PID lineage or host identity",
        alert: true,
        policyVerb: effectivePolicy.commandVerb,
        verificationMode: "proc-lineage",
        claimedLogin: asParse.asLogin,
      });
    }
    if (parentFicheRejected) {
      return fail({
        reasonCode: "fiche-parent-rejected",
        message: "caller is running inside a subagent/nested host CLI and may not inherit the parent session's fiche",
        hint: "launch a dedicated sub-session with `h2a run` / `h2a delegate` for its own session identity",
        alert: true,
        policyVerb: effectivePolicy.commandVerb,
        verificationMode: isForeignPidNamespace ? "pidns-session-ref" : "proc-lineage",
        claimedLogin: asParse.asLogin,
      });
    }
    if (isForeignPidNamespace && !envSessionRef) {
      return fail({
        reasonCode: "sandbox-pidns-missing-ref",
        message: `sandboxed session is missing ${SESSION_REF_ENV} for pidns-session-ref verification`,
        hint: "for tests use node scripts/test-sandbox.mjs -- <command>",
        alert: false,
        policyVerb: effectivePolicy.commandVerb,
        verificationMode: "pidns-session-ref",
        claimedLogin: asParse.asLogin,
      });
    }
    return fail({
      reasonCode: "agent-session-unprovisioned",
      message: "no active h2a session fiche belongs to this process lineage; refusing CLI access",
      hint: "run inside an `h2a run` / `h2a delegate` session, or for tests use node scripts/test-sandbox.mjs -- <command>",
      alert: false,
      policyVerb: effectivePolicy.commandVerb,
      verificationMode: isForeignPidNamespace ? "pidns-session-ref" : "proc-lineage",
      claimedLogin: asParse.asLogin,
    });
  }

  if (!runtimeDir) {
    return fail({
      reasonCode: "agent-session-unprovisioned",
      message: "session runtime directory is unavailable",
      alert: false,
      policyVerb: effectivePolicy.commandVerb,
      verificationMode,
      claimedLogin: asParse.asLogin,
      fiche: validFiche,
    });
  }

  // 11. Cumulative checks once own fiche is resolved.
  const secretPath = sessionSecretPath(runtimeDir, validFiche.sessionKey);

  // Check 1: Zero secret in argv.
  if (argvContainsRawSecret(options.argv, secretPath)) {
    return fail({
      reasonCode: "secret-in-argv-forbidden",
      message: "session secrets and authorization tokens must never appear in CLI arguments",
      alert: true,
      policyVerb: effectivePolicy.commandVerb,
      verificationMode,
      claimedLogin: asParse.asLogin,
      fiche: validFiche,
    });
  }

  // Check 2: Cross-check H2A_SESSION_REF & H2A_SESSION_PROOF_PATH if set.
  if (envSessionRef && envSessionRef !== validFiche.sessionKey) {
    return fail({
      reasonCode: verificationMode === "pidns-session-ref" ? "pid-lineage-mismatch" : "nested-session-spoof",
      message: `${SESSION_REF_ENV} does not match the caller's verified session fiche`,
      alert: true,
      policyVerb: effectivePolicy.commandVerb,
      verificationMode,
      claimedLogin: asParse.asLogin,
      fiche: validFiche,
    });
  }
  const envProofPath = env[SESSION_PROOF_PATH_ENV]?.trim();
  if (envProofPath && resolve(envProofPath) !== resolve(secretPath)) {
    return fail({
      reasonCode: verificationMode === "pidns-session-ref" ? "pid-lineage-mismatch" : "nested-session-spoof",
      message: `${SESSION_PROOF_PATH_ENV} does not match the expected 0600 session secret path`,
      alert: true,
      policyVerb: effectivePolicy.commandVerb,
      verificationMode,
      claimedLogin: asParse.asLogin,
      fiche: validFiche,
    });
  }

  // Check 3: Verify 0600 session secret file with Buffer + timingSafeEqual + fill(0).
  const secretOk = verifySessionSecretFile(secretPath, validFiche.secretSha256, uid);
  if (!secretOk) {
    return fail({
      reasonCode: "cli-session-secret-invalid",
      message: "session secret verification failed",
      alert: true,
      policyVerb: effectivePolicy.commandVerb,
      verificationMode,
      claimedLogin: asParse.asLogin,
      fiche: validFiche,
    });
  }

  // Check 4: Cgroup scopeUnit cross-check if fiche recorded one.
  if (validFiche.scopeUnit !== null && currentScopeUnit !== validFiche.scopeUnit) {
    return fail({
      reasonCode: "pid-lineage-mismatch",
      message: `cgroup scopeUnit mismatch (expected ${validFiche.scopeUnit}, got ${currentScopeUnit ?? "none"})`,
      alert: true,
      policyVerb: effectivePolicy.commandVerb,
      verificationMode,
      claimedLogin: asParse.asLogin,
      fiche: validFiche,
    });
  }

  // Check 4bis (audit-only in Lot 1 before 18(f)): Codex thread rollout attribution.
  const codexThreadAudit = inspectCodexThreadAudit(
    env,
    validFiche,
    options.codexSessionsDir,
  );

  // Check 5: Q1-A `--as <login>` required and must equal fiche.actorId (`H2A_INSTANCE` ignored).
  if (!asParse.asLogin) {
    return fail({
      reasonCode: "missing-login",
      message: `--as <login> is required in agent context (retry as: h2a --as ${validFiche.actorId} ${forwardedArgv.join(" ")})`,
      alert: false,
      policyVerb: effectivePolicy.commandVerb,
      verificationMode,
      fiche: validFiche,
      codexThreadAudit,
    });
  }
  if (!CANONICAL_LOGIN_RE.test(asParse.asLogin) || asParse.asLogin !== validFiche.actorId) {
    return fail({
      reasonCode: "cli-identity-mismatch",
      message: `--as "${asParse.asLogin}" does not match verified session actor "${validFiche.actorId}"`,
      alert: true,
      policyVerb: effectivePolicy.commandVerb,
      verificationMode,
      claimedLogin: asParse.asLogin,
      fiche: validFiche,
      codexThreadAudit,
    });
  }

  // Check 6: Caller flags and `--private-key` concordance.
  for (const callerFlag of effectivePolicy.callerFlags) {
    const key = callerFlag.slice(2);
    const val = parsedFlags[key];
    if (val !== undefined && val !== validFiche.actorId) {
      return fail({
        reasonCode: "cli-identity-mismatch",
        message: `${callerFlag} "${val}" cannot impersonate another actor (verified caller is ${validFiche.actorId})`,
        alert: true,
        policyVerb: effectivePolicy.commandVerb,
        verificationMode,
        claimedLogin: val,
        fiche: validFiche,
        codexThreadAudit,
      });
    }
  }
  if (
    effectivePolicy.commandVerb === "subagent route" &&
    parsedFlags["to"] !== undefined &&
    !parsedFlags["to"].startsWith(`${validFiche.actorId}~`)
  ) {
    return fail({
      reasonCode: "cli-identity-mismatch",
      message: `subagent route --to "${parsedFlags["to"]}" must belong to verified parent ${validFiche.actorId}`,
      alert: true,
      policyVerb: effectivePolicy.commandVerb,
      verificationMode,
      claimedLogin: parsedFlags["to"],
      fiche: validFiche,
      codexThreadAudit,
    });
  }
  if (
    effectivePolicy.commandVerb === "subagent revoke" &&
    parsedFlags["id"] !== undefined &&
    !parsedFlags["id"].startsWith(`${validFiche.actorId}~`)
  ) {
    return fail({
      reasonCode: "cli-identity-mismatch",
      message: `subagent revoke --id "${parsedFlags["id"]}" must belong to verified parent ${validFiche.actorId}`,
      alert: true,
      policyVerb: effectivePolicy.commandVerb,
      verificationMode,
      claimedLogin: parsedFlags["id"],
      fiche: validFiche,
      codexThreadAudit,
    });
  }

  for (const pkFlag of effectivePolicy.privateKeyFlags) {
    const key = pkFlag.slice(2);
    const val = parsedFlags[key];
    if (val !== undefined) {
      const storeRoot = resolve(resolvedRoot ?? join(resolveHomeDir(env), "h2a-workspace", ".h2a"));
      const expectedKeyPath = join(storeRoot, "keys", `${validFiche.actorId}.key.pem`);
      const normalize = (p: string): string => {
        try {
          return realpathSync(resolve(p));
        } catch {
          return resolve(p);
        }
      };
      if (normalize(val) !== normalize(expectedKeyPath)) {
        return fail({
          reasonCode: "private-key-mismatch",
          message: `${pkFlag} must point to caller's canonical key ${expectedKeyPath}`,
          alert: true,
          policyVerb: effectivePolicy.commandVerb,
          verificationMode,
          claimedLogin: asParse.asLogin,
          fiche: validFiche,
          codexThreadAudit,
        });
      }
    }
  }

  // Check 7: presence-reap --instance forbidden in foreign PID namespace.
  if (effectivePolicy.isPresenceReapWithInstance && isForeignPidNamespace) {
    return fail({
      reasonCode: "presence-reap-pidns-forbidden",
      message: "refusing `h2a presence-reap` inside an isolated PID namespace",
      alert: false,
      policyVerb: effectivePolicy.commandVerb,
      verificationMode,
      claimedLogin: asParse.asLogin,
      fiche: validFiche,
      codexThreadAudit,
    });
  }

  // Check 8: Q2-2 owner-authorized (`central stop` | `central compact`) — validate args + disallowed flags BEFORE claiming grant (NB-2).
  let consumedGrant: OwnerGrant | null = null;
  if (effectivePolicy.agentPolicy === "owner-authorized" && effectivePolicy.ownerAuthorizedAct) {
    const act = effectivePolicy.ownerAuthorizedAct;
    const subArgs = forwardedArgv.slice(2);
    const usageErr =
      act === "central-compact"
        ? validateCentralCompactArgsPure(subArgs)
        : validateCentralStopArgsPure(subArgs);
    if (usageErr) {
      return fail({
        exitCode: 1,
        reasonCode: "owner-authorization-invalid-args",
        message: usageErr,
        alert: false,
        policyVerb: effectivePolicy.commandVerb,
        verificationMode,
        claimedLogin: asParse.asLogin,
        fiche: validFiche,
        codexThreadAudit,
        grantAct: act,
      });
    }
    if (effectivePolicy.matchedPreGrantDisallowedFlag) {
      return fail({
        reasonCode: "owner-only-command",
        message: `${effectivePolicy.matchedPreGrantDisallowedFlag} is forbidden on owner-authorized \`${effectivePolicy.commandVerb}\` in agent context`,
        alert: false,
        policyVerb: effectivePolicy.commandVerb,
        verificationMode,
        claimedLogin: asParse.asLogin,
        fiche: validFiche,
        codexThreadAudit,
        grantAct: act,
      });
    }

    const consumeRes = consumeOwnerGrantForAct(runtimeDir, {
      act,
      actorId: validFiche.actorId,
      now: nowFn(),
      bootId: currentBootId,
      machineId: currentMachineId,
      uptimeSec: readProcUptimeSeconds(procRoot),
      expectedUid: uid,
    });
    if (!consumeRes.ok) {
      if (consumeRes.code === "owner-authorization-unconsumable") {
        return fail({
          reasonCode: "owner-authorization-unconsumable",
          message: `cannot consume one-shot owner authorization for ${act} (${consumeRes.detail}); retry from an owner terminal or writable grant store`,
          alert: false,
          policyVerb: effectivePolicy.commandVerb,
          verificationMode,
          claimedLogin: asParse.asLogin,
          fiche: validFiche,
          codexThreadAudit,
          grantAct: act,
        });
      }
      const laneHint = isLaneScope
        ? "this isolated bwrap lane hides host owner-grants by design; no host grant is visible here"
        : `ask the owner to authorize it from their interactive terminal: h2a authorize ${act} --for ${validFiche.actorId} --ttl 10m`;
      return fail({
        reasonCode: "owner-authorization-required",
        message: `\`h2a ${effectivePolicy.commandVerb}\` requires a one-shot owner authorization (${laneHint})`,
        alert: true,
        policyVerb: effectivePolicy.commandVerb,
        verificationMode,
        claimedLogin: asParse.asLogin,
        fiche: validFiche,
        codexThreadAudit,
        grantAct: act,
      });
    }
    consumedGrant = consumeRes.grant;
  }

  // Record success audit (and return grant outcome recorder for NB-7).
  const baseAudit: AuditRecord = {
    at: new Date(nowFn()).toISOString(),
    stage: "cli",
    outcome: "allowed",
    reasonCode: consumedGrant ? "owner-grant-consumed" : "agent-identity-verified",
    verificationMode,
    codexThreadAudit,
    grantId: consumedGrant?.grantId ?? null,
    grantAct: consumedGrant?.act ?? null,
    claimedLogin: asParse.asLogin,
    verifiedLogin: validFiche.actorId,
    sessionKey: validFiche.sessionKey,
    host: validFiche.host,
    sessionClass: validFiche.sessionClass,
    delegatorInstance: validFiche.delegatorInstance,
    commandVerb: effectivePolicy.commandVerb,
    callerPid: pid,
    leaderPid: validFiche.leaderPid,
    scopeUnit: validFiche.scopeUnit,
    isTty: stdinIsTTY,
  };
  writeCliIdentityAudit(baseAudit, env, stderrWrite, false);

  const recordGrantOutcome = consumedGrant
    ? (exitCode: number) => {
        writeCliIdentityAudit(
          {
            ...baseAudit,
            at: new Date(nowFn()).toISOString(),
            outcome: exitCode === 0 ? "allowed" : "failed",
            reasonCode: "owner-grant-outcome",
            exitCode,
          },
          env,
          stderrWrite,
          false,
        );
      }
    : undefined;

  return {
    ok: true,
    mode: "agent",
    verificationMode,
    forwardedArgv,
    policy: effectivePolicy,
    claimedLogin: asParse.asLogin,
    actorId: validFiche.actorId,
    sessionFiche: validFiche,
    sidecar: matchedSidecar,
    daemonReceipt: null,
    parentFicheRejected,
    isForeignPidNamespace,
    isLaneScope,
    consumedGrant,
    runtimeDir,
    ...(recordGrantOutcome ? { recordGrantOutcome } : {}),
  };
}

/** Digest helper exported for audit correlation tests (non-secret). */
export function sha256HexPrefix(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

export interface McpSessionAnchor {
  readonly actorId: string;
  readonly agentUuid: string;
  readonly sessionKey: string;
}

export interface McpIdentitySecurityEventInput {
  readonly outcome: "denied" | "audit-only" | "allowed";
  readonly reasonCode: string;
  readonly host?: string | null;
  readonly claimedLogin?: string | null;
  readonly verifiedLogin?: string | null;
  readonly sessionKey?: string | null;
  readonly message: string;
  readonly alert: boolean;
  readonly commandVerb?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly pid?: number;
  readonly now?: () => number;
  readonly stderr?: (chunk: string) => void;
}

/** Record an MCP-stage identity mismatch / security event to cli-identity-audit and optional owner-alerts. */
export function recordMcpIdentitySecurityEvent(
  input: McpIdentitySecurityEventInput,
): void {
  const env = input.env ?? process.env;
  const at = new Date((input.now ?? Date.now)()).toISOString();
  const pid = input.pid ?? process.pid;
  const stderrWrite = input.stderr ?? ((chunk: string) => { process.stderr.write(chunk); });
  const commandVerb = input.commandVerb ?? "mcp-serve";
  writeCliIdentityAudit(
    {
      at,
      stage: "mcp",
      outcome: input.outcome,
      reasonCode: input.reasonCode,
      verificationMode: "internal",
      codexThreadAudit: null,
      grantId: null,
      grantAct: null,
      claimedLogin: input.claimedLogin ?? null,
      verifiedLogin: input.verifiedLogin ?? null,
      sessionKey: input.sessionKey ?? null,
      host: input.host ?? null,
      sessionClass: null,
      delegatorInstance: null,
      commandVerb,
      callerPid: pid,
      leaderPid: null,
      scopeUnit: null,
      isTty: false,
    },
    env,
    stderrWrite,
    false,
  );
  if (input.alert) {
    writeOwnerIdentityAlert(
      {
        at,
        kind: "cli-identity-alert",
        reasonCode: input.reasonCode,
        commandVerb,
        claimedLogin: input.claimedLogin ?? null,
        verifiedLogin: input.verifiedLogin ?? null,
        callerPid: pid,
        message: input.message,
      },
      env,
      stderrWrite,
      false,
    );
  }
}

export interface McpTransportAnchorOptions {
  readonly pid?: number;
  readonly processPid?: number;
  readonly root?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly procRoot?: string;
  readonly sessionRuntimeDir?: string;
  readonly isolatedTmpRoot?: string;
  readonly explicitInstance?: string;
  readonly host?: string;
  readonly expectedInstance?: string;
  readonly centralAttachment?: boolean;
  readonly uid?: number;
  readonly platform?: NodeJS.Platform;
  readonly now?: () => number;
  readonly waitTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly stderr?: (chunk: string) => void;
}

export type McpTransportAnchorResult =
  | {
      readonly ok: true;
      readonly anchor?: McpSessionAnchor;
      readonly verificationMode: "proc-lineage" | "sidecar-anchor" | "pidns-session-ref" | "fiche-absent";
      readonly parentFicheRejected: boolean;
    }
  | {
      readonly ok: false;
      readonly exitCode: 2;
      readonly reasonCode: "fiche-parent-rejected" | "sidecar-anchor-timeout";
      readonly message: string;
    };

/**
 * Resolve verified MCP transport anchor in strict DESIGN § 1.2.D1 order:
 *  (1) own `/proc` leaderPid fiche -> sessionAnchor
 *  (2) rejected parent fiche -> never inherit; explicit `--instance` -> exit 2 (`fiche-parent-rejected` + alert)
 *  (3) sidecar outside `leaderPid`: with `H2A_SESSION_REF`, poll `.sidecar.json` up to 10s -> else `sidecar-anchor-timeout`; without ref, single scan
 *  (4) no fiche -> start (`fiche-absent`, 0 alert)
 */
export async function resolveMcpTransportAnchorAsync(
  options: McpTransportAnchorOptions = {},
): Promise<McpTransportAnchorResult> {
  const env = options.env ?? process.env;
  const procRoot = options.procRoot ?? "/proc";
  const anchorPid = options.pid ?? process.pid;
  const localProcessPid = options.processPid ?? process.pid;
  const uid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : 0);
  const platform = options.platform ?? process.platform;
  const nowFn = options.now ?? Date.now;
  const stderrWrite = options.stderr ?? ((chunk: string) => { process.stderr.write(chunk); });

  const resolvedRoot = options.root ?? env["H2A_ROOT"] ?? undefined;
  let fixedTmpRoot: string | undefined;
  try {
    fixedTmpRoot = realpathSync("/tmp");
  } catch {
    fixedTmpRoot = undefined;
  }
  const isolatedTmpRoot =
    options.isolatedTmpRoot ??
    (resolvedRoot && fixedTmpRoot && isWithinDir(resolve(resolvedRoot), fixedTmpRoot)
      ? resolvedRoot
      : undefined);

  const tryDir = (): string | null => {
    try {
      return resolveSessionRuntimeDir({
        env,
        sessionRuntimeDir: options.sessionRuntimeDir,
        ...(isolatedTmpRoot ? { isolatedTmpRoot } : {}),
        createIfMissing: false,
        uid,
        platform,
      }).dir;
    } catch {
      return null;
    }
  };

  const currentBootId = readBootId(procRoot) ?? "nonlinux-boot";
  const currentPidNs = readPidNamespaceId("self", procRoot) ?? "nonlinux-pidns";
  const currentMachineId = readMachineId();
  const ancestors = collectProcChain(anchorPid, procRoot);
  const processAncestors =
    localProcessPid !== anchorPid ? collectProcChain(localProcessPid, procRoot) : ancestors;
  const sidecarSearchAncestors =
    localProcessPid !== anchorPid ? [...processAncestors, ...ancestors] : ancestors;
  const collapsedHostClis = collapseHostCliChain(ancestors);
  const nearestHostCli = collapsedHostClis[0];
  const envSessionRef = env[SESSION_REF_ENV]?.trim();

  const runtimeDir0 = tryDir();
  const allFiches = runtimeDir0 ? listSessionFiches(runtimeDir0, uid) : [];

  // Step (1): Proof 1 `/proc` lineage fiche matching.
  let lineageFiche: { readonly fiche: SessionFiche; readonly index: number } | undefined;
  const startIndex = anchorPid !== localProcessPid ? 0 : 1;
  for (let i = startIndex; i < ancestors.length; i++) {
    const anc = ancestors[i]!;
    const match = allFiches.find(
      (f) =>
        f.bootId === currentBootId &&
        f.pidNamespace === currentPidNs &&
        f.leaderPid === anc.pid &&
        f.leaderStartTime === anc.startTime,
    );
    if (match) {
      lineageFiche = { fiche: match, index: i };
      break;
    }
  }

  let parentFicheRejected = false;
  if (lineageFiche && runtimeDir0) {
    const lf = lineageFiche.fiche;
    const hostClisBelowLeader = collapsedHostClis.filter((c) => c.index <= lineageFiche.index);
    const cliMatches =
      lf.cliPid !== null
        ? Boolean(nearestHostCli && nearestHostCli.pid === lf.cliPid)
        : Boolean(
            nearestHostCli &&
            nearestHostCli.index <= lineageFiche.index &&
            nearestHostCli.host === lf.host &&
            hostClisBelowLeader.length === 1,
          );
    if (cliMatches) {
      if (verifySessionSecretFile(sessionSecretPath(runtimeDir0, lf.sessionKey), lf.secretSha256, uid)) {
        return {
          ok: true,
          anchor: {
            actorId: lf.actorId,
            agentUuid: lf.agentUuid,
            sessionKey: lf.sessionKey,
          },
          verificationMode: "proc-lineage",
          parentFicheRejected: false,
        };
      }
      parentFicheRejected = true;
    } else {
      parentFicheRejected = true;
    }
  }

  // Step (2): Rejected parent fiche -> never inherit parent anchor; explicit --instance -> exit 2 + alert.
  if (parentFicheRejected && options.explicitInstance) {
    const message = `MCP transport refused: --instance "${options.explicitInstance}" cannot borrow a rejected parent session fiche`;
    recordMcpIdentitySecurityEvent({
      outcome: "denied",
      reasonCode: "fiche-parent-rejected",
      host: options.host ?? null,
      claimedLogin: options.explicitInstance,
      verifiedLogin: lineageFiche?.fiche.actorId ?? null,
      sessionKey: lineageFiche?.fiche.sessionKey ?? null,
      message,
      alert: true,
      env,
      pid: localProcessPid,
      now: nowFn,
      stderr: stderrWrite,
    });
    return {
      ok: false,
      exitCode: 2,
      reasonCode: "fiche-parent-rejected",
      message,
    };
  }

  // Helper to resolve a verified sidecar match against process lineage (or foreign-pidns shim in central mode).
  const findMatchingSidecarAnchor = (runtimeDir: string, refOnly?: string): {
    readonly anchor: McpSessionAnchor;
    readonly mode: "sidecar-anchor" | "pidns-session-ref";
  } | undefined => {
    const sidecars = refOnly
      ? (() => {
          if (!SESSION_KEY_RE.test(refOnly)) return [];
          const one = readSessionSidecar(runtimeDir, refOnly, uid);
          return one ? [one] : [];
        })()
      : listSessionSidecars(runtimeDir, uid);

    for (const sc of sidecars) {
      if (sc.bootId !== currentBootId) continue;
      if (sc.pidNamespace === currentPidNs) {
        const matchedAnc = sidecarSearchAncestors.find(
          (a) => a.pid === sc.sidecarPid && a.startTime === sc.sidecarStartTime,
        );
        if (!matchedAnc) continue;
      } else if (!options.centralAttachment && !envSessionRef) {
        continue;
      }
      const scFiche = readSessionFiche(runtimeDir, sc.sessionKey, uid);
      if (!scFiche || scFiche.bootId !== currentBootId || scFiche.machineId !== currentMachineId) continue;
      if (!verifySessionSecretFile(sessionSecretPath(runtimeDir, scFiche.sessionKey), scFiche.secretSha256, uid)) {
        continue;
      }
      if (sc.pidNamespace !== currentPidNs && !options.centralAttachment) {
        if (collapsedHostClis.length > 0 && (collapsedHostClis.length !== 1 || collapsedHostClis[0]!.host !== scFiche.host)) {
          continue;
        }
      }
      return {
        anchor: {
          actorId: scFiche.actorId,
          agentUuid: scFiche.agentUuid,
          sessionKey: scFiche.sessionKey,
        },
        mode: sc.pidNamespace !== currentPidNs ? "pidns-session-ref" : "sidecar-anchor",
      };
    }

    // Foreign PID namespace without sidecar (e.g. direct containerized child with live fiche).
    if (refOnly && SESSION_KEY_RE.test(refOnly)) {
      const refFiche = readSessionFiche(runtimeDir, refOnly, uid);
      if (
        refFiche &&
        refFiche.bootId === currentBootId &&
        refFiche.machineId === currentMachineId &&
        refFiche.pidNamespace !== currentPidNs &&
        verifySessionSecretFile(sessionSecretPath(runtimeDir, refFiche.sessionKey), refFiche.secretSha256, uid)
      ) {
        return {
          anchor: {
            actorId: refFiche.actorId,
            agentUuid: refFiche.agentUuid,
            sessionKey: refFiche.sessionKey,
          },
          mode: "pidns-session-ref",
        };
      }
    }
    return undefined;
  };

  // Step (3): Sidecar discovery outside leaderPid.
  if (!parentFicheRejected) {
    if (envSessionRef) {
      const envTimeoutMs = Number.parseInt(env["H2A_SIDECAR_ANCHOR_TIMEOUT_MS"] ?? "", 10);
      const waitTimeoutMs =
        options.waitTimeoutMs ??
        (Number.isFinite(envTimeoutMs) && envTimeoutMs >= 0 ? envTimeoutMs : 10_000);
      const pollMs =
        options.pollIntervalMs ?? Math.min(100, Math.max(10, Math.floor(waitTimeoutMs / 5)));
      const deadline = nowFn() + waitTimeoutMs;
      for (;;) {
        const dir = tryDir();
        if (dir) {
          const hit = findMatchingSidecarAnchor(dir, envSessionRef);
          if (hit) {
            return {
              ok: true,
              anchor: hit.anchor,
              verificationMode: hit.mode,
              parentFicheRejected: false,
            };
          }
        }
        if (nowFn() >= deadline) break;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, pollMs));
      }
      const message = `timed out waiting for verified sidecar session anchor (${envSessionRef})`;
      recordMcpIdentitySecurityEvent({
        outcome: "denied",
        reasonCode: "sidecar-anchor-timeout",
        host: options.host ?? null,
        claimedLogin: options.explicitInstance ?? null,
        verifiedLogin: null,
        sessionKey: SESSION_KEY_RE.test(envSessionRef) ? envSessionRef : null,
        message,
        alert: true,
        env,
        pid: localProcessPid,
        now: nowFn,
        stderr: stderrWrite,
      });
      return {
        ok: false,
        exitCode: 2,
        reasonCode: "sidecar-anchor-timeout",
        message,
      };
    }

    if (runtimeDir0) {
      const singleScanHit = findMatchingSidecarAnchor(runtimeDir0);
      if (singleScanHit) {
        return {
          ok: true,
          anchor: singleScanHit.anchor,
          verificationMode: singleScanHit.mode,
          parentFicheRejected: false,
        };
      }
    }
  }

  // Step (4): No fiche -> start cleanly (`fiche-absent`, zero alert).
  recordMcpIdentitySecurityEvent({
    outcome: "audit-only",
    reasonCode: parentFicheRejected ? "fiche-parent-rejected" : "fiche-absent",
    host: options.host ?? null,
    claimedLogin: options.explicitInstance ?? null,
    verifiedLogin: null,
    sessionKey: null,
    message: parentFicheRejected
      ? "MCP transport ignoring rejected parent fiche and running without session anchor"
      : "MCP transport starting without session anchor (fiche-absent)",
    alert: false,
    env,
    pid: localProcessPid,
    now: nowFn,
    stderr: stderrWrite,
  });

  return {
    ok: true,
    verificationMode: "fiche-absent",
    parentFicheRejected,
  };
}
