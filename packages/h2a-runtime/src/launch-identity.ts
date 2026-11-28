/**
 * Launcher-side verified session identity helpers (`h2a-runtime`).
 *
 * Bridges host launch primitives (`native-host.ts`, `tmux.ts`, `session-exec-wrapper.ts`)
 * and `h2a-runtime` CLI entry points (`index.ts`) with the core session substrate
 * (`session-auth.ts`):
 *  - explicit `LaunchSessionIdentity` contract (`reuse` | `mint` | `none-shell`),
 *  - durable `<host>:<slug>:<uuid12>` + Ed25519 keypair minting under `storeRoot`,
 *  - orphan sweep + pre-spawn `sessionKey`/`secret` generation + launcher fiche/sidecar
 *    publication anchored on `leaderPid` / descendant `h2a-session-*.scope`,
 *  - shell prelude waiting up to 10s for the launcher-published fiche before execing
 *    the host CLI (failing closed without dropping to an interactive login shell).
 */

import { generateKeyPairSync, randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { withFileLock } from "./file-lock.js";
import {
  CANONICAL_LOGIN_RE,
  mintSessionKeyAndSecret,
  purgeSessionArtifacts,
  readBootId,
  readDescendantSessionScopeUnit,
  readMachineId,
  readPidNamespaceId,
  readProcStat,
  readSessionFiche,
  readSessionSidecar,
  hasSandboxOrQualificationRuntime,
  resolveSessionRuntimeDir,
  SESSION_CLASS_ENV,
  SESSION_PROOF_PATH_ENV,
  SESSION_REF_ENV,
  sessionSecretPath,
  listSessionFiches,
  sweepOrphanSessionFiches,
  UUID_V4_RE,
  verifySessionSecretFile,
  writeBufferAtomic0600,
  writeRelaunchHandoff,
  writeSessionFiche,
  writeSessionSidecar,
  type InvocationMode,
  type SessionClass,
  type SessionFiche,
  type SessionSidecar,
} from "./session-auth.js";
import { guardTestStateWrite } from "./test-state-guard.js";

export type LaunchSessionIdentity =
  | {
      readonly kind: "reuse";
      readonly host: string;
      readonly actorId: string;
      readonly agentUuid: string;
      readonly sessionClass: SessionClass;
      readonly invocationMode: InvocationMode;
      readonly hostSessionId?: string | null | undefined;
      readonly delegatorInstance?: string | null | undefined;
      readonly delegatorSessionKey?: string | null | undefined;
    }
  | {
      readonly kind: "mint";
      readonly host: string;
      readonly label: string;
      readonly sessionClass: SessionClass;
      readonly invocationMode: InvocationMode;
      readonly hostSessionId?: string | null | undefined;
      readonly delegatorInstance?: string | null | undefined;
      readonly delegatorSessionKey?: string | null | undefined;
    }
  | {
      readonly kind: "none-shell";
      readonly sessionClass?: SessionClass | undefined;
    };

export interface MintedActorIdentity {
  readonly actorId: string;
  readonly agentUuid: string;
}

export interface MintLaunchActorInput {
  readonly host: string;
  readonly label: string;
  readonly storeRoot?: string | undefined;
  readonly agentUuid?: string | undefined;
}

export type LaunchActorIdentityMinter = (input: MintLaunchActorInput) => MintedActorIdentity;

let customActorIdentityMinter: LaunchActorIdentityMinter | undefined;

export function registerLaunchActorIdentityMinter(
  minter: LaunchActorIdentityMinter | undefined,
): void {
  customActorIdentityMinter = minter;
}

function normalizeHostSlug(host: string): string {
  const cleaned = host
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "agent";
}

function normalizeLabelSlug(label: string): string {
  const cleaned = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/^-+|-+$/g, "");
  return cleaned || "agent";
}

export function deriveCanonicalActorId(host: string, label: string, agentUuid: string): string {
  const hostSlug = normalizeHostSlug(host);
  const labelSlug = normalizeLabelSlug(label);
  const uuidHex = agentUuid.replace(/-/g, "").slice(0, 12).toLowerCase();
  const candidate = `${hostSlug}:${labelSlug}:${uuidHex}`;
  if (!CANONICAL_LOGIN_RE.test(candidate)) {
    return `${hostSlug}:agent:${uuidHex.padEnd(12, "0").slice(0, 12)}`;
  }
  return candidate;
}

export function resolveIdentityStoreRoot(
  storeRoot?: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const explicit = storeRoot?.trim();
  if (explicit) return explicit;
  const fromEnv = env["H2A_ROOT"]?.trim();
  if (fromEnv) return fromEnv;
  return join(homedir(), "h2a-workspace", ".h2a");
}

function instancesFileContainsId(instancesPath: string, actorId: string): boolean {
  if (!existsSync(instancesPath)) return false;
  try {
    const raw = readFileSync(instancesPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as { id?: unknown };
        if (parsed.id === actorId) return true;
      } catch {
        /* tolerate torn legacy lines during scan */
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Default actor identity minter: builds `<host>:<slug>:<uuid12>` + v4 `agentUuid`,
 * writes 0600 Ed25519 key files under `<storeRoot>/keys/`, and appends the
 * registration row to `<storeRoot>/registry/instances.jsonl` under a file lock.
 */
export function defaultMintLaunchActorIdentity(input: MintLaunchActorInput): MintedActorIdentity {
  const agentUuid = input.agentUuid && UUID_V4_RE.test(input.agentUuid)
    ? input.agentUuid.toLowerCase()
    : randomUUID();
  const actorId = deriveCanonicalActorId(input.host, input.label, agentUuid);
  const storeRoot = resolveIdentityStoreRoot(input.storeRoot);
  const keysDir = join(storeRoot, "keys");
  const registryDir = join(storeRoot, "registry");
  const instancesPath = join(registryDir, "instances.jsonl");
  const keysPath = join(registryDir, "keys.jsonl");
  const keyBase = actorId.replace(/[:/]/g, "-");
  const privKeyPath = join(keysDir, `${keyBase}.key.pem`);
  const pubKeyPath = join(keysDir, `${keyBase}.pub.pem`);

  for (const guarded of [storeRoot, keysDir, registryDir, instancesPath, keysPath, privKeyPath, pubKeyPath, `${instancesPath}.lock`]) {
    guardTestStateWrite(guarded);
  }

  mkdirSync(keysDir, { recursive: true, mode: 0o700 });
  mkdirSync(registryDir, { recursive: true, mode: 0o700 });

  let publicKeyPem: string;
  if (existsSync(privKeyPath) && existsSync(pubKeyPath)) {
    publicKeyPem = readFileSync(pubKeyPath, "utf8");
  } else {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    publicKeyPem = publicKey;
    writeBufferAtomic0600(privKeyPath, privateKey);
    writeBufferAtomic0600(pubKeyPath, publicKeyPem);
    try {
      chmodSync(pubKeyPath, 0o644);
    } catch {
      /* ignore */
    }
  }

  withFileLock(instancesPath, () => {
    if (instancesFileContainsId(instancesPath, actorId)) return;
    const nowIso = new Date().toISOString();
    const registration = {
      id: actorId,
      instance: actorId,
      roles: ["agent"],
      scopes: ["default"],
      capabilities: [],
      endpoints: [{ kind: "local-files", uri: storeRoot }],
      publicKeys: [publicKeyPem],
      acceptedPolicies: [],
      createdAt: nowIso,
      agentUuid,
      name: input.label,
    };
    appendFileSync(instancesPath, `${JSON.stringify(registration)}\n`, "utf8");
    const keyEvent = {
      type: "added",
      instance: actorId,
      publicKey: publicKeyPem,
      at: nowIso,
    };
    appendFileSync(keysPath, `${JSON.stringify(keyEvent)}\n`, "utf8");
  });

  return { actorId, agentUuid };
}

export function mintLaunchActorIdentity(input: MintLaunchActorInput): MintedActorIdentity {
  return customActorIdentityMinter
    ? customActorIdentityMinter(input)
    : defaultMintLaunchActorIdentity(input);
}

export type PreparedSessionIdentity =
  | { readonly kind: "none-shell"; readonly sessionClass: SessionClass }
  | {
      readonly kind: "verified";
      readonly runtimeDir: string;
      readonly sessionKey: string;
      readonly secretPath: string;
      readonly secretSha256: string;
      readonly actorId: string;
      readonly agentUuid: string;
      readonly host: string;
      readonly sessionClass: SessionClass;
      readonly invocationMode: InvocationMode;
      readonly hostSessionId: string | null;
      readonly delegatorInstance: string | null;
      readonly delegatorSessionKey: string | null;
      readonly jobId?: string | undefined;
    };

export function resolveRuntimeDirForLauncher(options: {
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly sessionRuntimeDir?: string | undefined;
  readonly isolatedTmpRoot?: string | undefined;
} = {}): string {
  const env = options.env ?? process.env;
  const allowCreate = Boolean(
    options.sessionRuntimeDir ||
      options.isolatedTmpRoot ||
      hasSandboxOrQualificationRuntime(env),
  );
  return resolveSessionRuntimeDir({
    env,
    sessionRuntimeDir: options.sessionRuntimeDir,
    isolatedTmpRoot: options.isolatedTmpRoot,
    createIfMissing: allowCreate,
  }).dir;
}

/**
 * Prepare a new session launch BEFORE spawning the wrapper/process:
 *  - sweeps orphan fiches in the runtime directory,
 *  - resolves or mints `(actorId, agentUuid)`,
 *  - generates a fresh `sessionKey` and 0600 CSPRNG secret.
 * Throws fail-closed if the runtime directory is unavailable or unsafe.
 */
export function prepareSessionIdentityLaunch(
  identity: LaunchSessionIdentity | undefined,
  options: {
    readonly jobId?: string | undefined;
    readonly sessionRuntimeDir?: string | undefined;
    readonly isolatedTmpRoot?: string | undefined;
    readonly storeRoot?: string | undefined;
    readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  } = {},
): PreparedSessionIdentity {
  if (!identity || identity.kind === "none-shell") {
    return {
      kind: "none-shell",
      sessionClass: identity?.sessionClass ?? "human",
    };
  }

  const runtimeDir = resolveRuntimeDirForLauncher({
    env: options.env,
    sessionRuntimeDir: options.sessionRuntimeDir,
    isolatedTmpRoot: options.isolatedTmpRoot,
  });

  sweepOrphanSessionFiches(runtimeDir);

  let actorId: string;
  let agentUuid: string;
  if (identity.kind === "reuse") {
    actorId = identity.actorId;
    agentUuid = identity.agentUuid;
  } else {
    const minted = mintLaunchActorIdentity({
      host: identity.host,
      label: identity.label,
      storeRoot: options.storeRoot,
    });
    actorId = minted.actorId;
    agentUuid = minted.agentUuid;
  }

  const mintedSecret = mintSessionKeyAndSecret(runtimeDir);

  return {
    kind: "verified",
    runtimeDir,
    sessionKey: mintedSecret.sessionKey,
    secretPath: mintedSecret.secretPath,
    secretSha256: mintedSecret.secretSha256,
    actorId,
    agentUuid,
    host: identity.host,
    sessionClass: identity.sessionClass,
    invocationMode: identity.invocationMode,
    hostSessionId: identity.hostSessionId ?? null,
    delegatorInstance: identity.delegatorInstance ?? null,
    delegatorSessionKey: identity.delegatorSessionKey ?? null,
    ...(options.jobId !== undefined ? { jobId: options.jobId } : {}),
  };
}

export function applyVerifiedSessionEnv(
  env: Record<string, string>,
  prepared: Extract<PreparedSessionIdentity, { readonly kind: "verified" }>,
): void {
  env[SESSION_CLASS_ENV] = prepared.sessionClass;
  env[SESSION_REF_ENV] = prepared.sessionKey;
  env[SESSION_PROOF_PATH_ENV] = prepared.secretPath;
  if (prepared.jobId) {
    env["REMOTE_JOB_ID"] = prepared.jobId;
  }
}

export function cleanupFailedSessionIdentityLaunch(
  prepared: PreparedSessionIdentity | undefined,
): void {
  if (!prepared || prepared.kind !== "verified") return;
  purgeSessionArtifacts(prepared.runtimeDir, prepared.sessionKey);
}

export function writeLauncherRelaunchHandoff(
  prepared: Extract<PreparedSessionIdentity, { readonly kind: "verified" }>,
): string {
  return writeRelaunchHandoff(prepared.runtimeDir, {
    version: 1,
    sessionKey: prepared.sessionKey,
    actorId: prepared.actorId,
    agentUuid: prepared.agentUuid,
    host: prepared.host,
    invocationMode: prepared.invocationMode,
    sessionClass: prepared.sessionClass,
    delegatorInstance: prepared.delegatorInstance,
    delegatorSessionKey: prepared.delegatorSessionKey,
    hostSessionId: prepared.hostSessionId,
    ...(prepared.jobId !== undefined ? { jobId: prepared.jobId } : {}),
    secretPath: prepared.secretPath,
    secretSha256: prepared.secretSha256,
    issuedAt: new Date().toISOString(),
  });
}

export function publishLauncherSessionFiche(
  prepared: Extract<PreparedSessionIdentity, { readonly kind: "verified" }>,
  input: {
    readonly leaderPid: number;
    readonly leaderStartTime?: string | undefined;
    readonly cliPid?: number | null | undefined;
    readonly cliStartTime?: string | null | undefined;
    readonly expectScope: boolean;
    readonly scopeTimeoutMs?: number | undefined;
    readonly procRoot?: string | undefined;
  },
): SessionFiche {
  const procRoot = input.procRoot ?? "/proc";
  const leaderStartTime =
    input.leaderStartTime ?? readProcStat(input.leaderPid, procRoot)?.startTime ?? "0";
  const cliPid = input.cliPid ?? null;
  const cliStartTime =
    cliPid !== null
      ? input.cliStartTime ?? readProcStat(cliPid, procRoot)?.startTime ?? null
      : null;
  const scopeUnit = input.expectScope
    ? readDescendantSessionScopeUnit(input.leaderPid, {
        procRoot,
        expectScope: true,
        timeoutMs: input.scopeTimeoutMs ?? 1_000,
      })
    : null;
  const fiche: SessionFiche = {
    version: 1,
    sessionKey: prepared.sessionKey,
    actorId: prepared.actorId,
    agentUuid: prepared.agentUuid,
    host: prepared.host,
    invocationMode: prepared.invocationMode,
    createdBy: "launcher",
    hostSessionId: prepared.hostSessionId,
    cliPid,
    cliStartTime,
    sessionClass: prepared.sessionClass,
    delegatorInstance: prepared.delegatorInstance,
    delegatorSessionKey: prepared.delegatorSessionKey,
    secretSha256: prepared.secretSha256,
    leaderPid: input.leaderPid,
    leaderStartTime,
    bootId: readBootId(procRoot) ?? "nonlinux-boot",
    pidNamespace: readPidNamespaceId("self", procRoot) ?? "nonlinux-pidns",
    machineId: readMachineId(),
    scopeUnit,
    issuedAt: new Date().toISOString(),
  };
  writeSessionFiche(prepared.runtimeDir, fiche);
  return fiche;
}

export function publishLauncherSidecar(
  sessionKey: string,
  sidecarPid: number,
  options: {
    readonly sidecarStartTime?: string | undefined;
    readonly sessionRuntimeDir?: string | undefined;
    readonly isolatedTmpRoot?: string | undefined;
    readonly procRoot?: string | undefined;
  } = {},
): SessionSidecar {
  const procRoot = options.procRoot ?? "/proc";
  const runtimeDir = resolveRuntimeDirForLauncher({
    sessionRuntimeDir: options.sessionRuntimeDir,
    isolatedTmpRoot: options.isolatedTmpRoot,
  });
  const sidecarStartTime =
    options.sidecarStartTime ?? readProcStat(sidecarPid, procRoot)?.startTime ?? "0";
  const sidecar: SessionSidecar = {
    version: 1,
    sessionKey,
    sidecarPid,
    sidecarStartTime,
    bootId: readBootId(procRoot) ?? "nonlinux-boot",
    pidNamespace: readPidNamespaceId("self", procRoot) ?? "nonlinux-pidns",
    machineId: readMachineId(),
    issuedAt: new Date().toISOString(),
  };
  writeSessionSidecar(runtimeDir, sidecar);
  return sidecar;
}

export function carryForwardNativeSidecarIfAny(
  oldSessionKey: string | undefined,
  newSessionKey: string,
  options: {
    readonly sessionRuntimeDir?: string | undefined;
    readonly isolatedTmpRoot?: string | undefined;
  } = {},
): SessionSidecar | undefined {
  if (!oldSessionKey) return undefined;
  const runtimeDir = resolveRuntimeDirForLauncher({
    sessionRuntimeDir: options.sessionRuntimeDir,
    isolatedTmpRoot: options.isolatedTmpRoot,
  });
  const existing = readSessionSidecar(runtimeDir, oldSessionKey);
  if (!existing) return undefined;
  const carried: SessionSidecar = {
    ...existing,
    sessionKey: newSessionKey,
    issuedAt: new Date().toISOString(),
  };
  writeSessionSidecar(runtimeDir, carried);
  return carried;
}

const VERIFIED_CALLER_CONTEXT_SYMBOL = Symbol.for("h2a.verifiedCallerContext");

interface StoredVerifiedCallerContext {
  readonly verified?: boolean;
  readonly isAgent?: boolean;
  readonly actorId?: string | null;
  readonly sessionKey?: string | null;
}

export function writeRuntimeIdentitySecurityEvent(input: {
  readonly reasonCode: string;
  readonly commandVerb: string;
  readonly message: string;
  readonly actorId?: string | null;
  readonly sessionKey?: string | null;
  readonly host?: string | null;
  readonly sessionClass?: SessionClass | null;
  readonly delegatorInstance?: string | null;
  readonly alert?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): void {
  const env = input.env ?? process.env;
  const xdgState = env["XDG_STATE_HOME"]?.trim();
  const home = env["HOME"]?.trim() || homedir();
  const dir = join(xdgState && xdgState.length > 0 ? xdgState : join(home, ".local", "state"), "h2a");
  const at = new Date().toISOString();
  const auditRow = {
    at,
    stage: "cli",
    outcome: "denied",
    reasonCode: input.reasonCode,
    verificationMode: "proc-lineage",
    codexThreadAudit: null,
    grantId: null,
    grantAct: null,
    claimedLogin: input.actorId ?? null,
    verifiedLogin: input.actorId ?? null,
    sessionKey: input.sessionKey ?? null,
    host: input.host ?? null,
    sessionClass: input.sessionClass ?? null,
    delegatorInstance: input.delegatorInstance ?? null,
    commandVerb: input.commandVerb,
    callerPid: process.pid,
    leaderPid: null,
    scopeUnit: null,
    isTty: process.stdin.isTTY === true,
  };
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(join(dir, "cli-identity-audit.jsonl"), `${JSON.stringify(auditRow)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    process.stderr.write(`[h2a-audit-fallback] ${JSON.stringify(auditRow)}\n`);
  }
  if (input.alert) {
    const alertRow = {
      at,
      kind: "cli-identity-alert",
      reasonCode: input.reasonCode,
      commandVerb: input.commandVerb,
      claimedLogin: input.actorId ?? null,
      verifiedLogin: input.actorId ?? null,
      callerPid: process.pid,
      message: input.message,
    };
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      appendFileSync(join(dir, "owner-alerts.jsonl"), `${JSON.stringify(alertRow)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    } catch {
      process.stderr.write(`[h2a-alert-fallback] ${JSON.stringify(alertRow)}\n`);
    }
  }
}

export function resolveCurrentCallerSessionContext(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: {
    readonly sessionRuntimeDir?: string | undefined;
    readonly isolatedTmpRoot?: string | undefined;
    readonly procRoot?: string | undefined;
  } = {},
): {
  readonly sessionKey: string | null;
  readonly actorId: string | null;
  readonly isAgent: boolean;
} {
  if (!options.sessionRuntimeDir && !options.isolatedTmpRoot && env === process.env) {
    const globalCtx = (globalThis as Record<symbol, StoredVerifiedCallerContext | undefined>)[
      VERIFIED_CALLER_CONTEXT_SYMBOL
    ];
    if (globalCtx?.verified) {
      return {
        sessionKey: globalCtx.sessionKey ?? null,
        actorId: globalCtx.actorId ?? null,
        isAgent: globalCtx.isAgent === true,
      };
    }
  }
  const sessionKey = env[SESSION_REF_ENV]?.trim();
  const procRoot = options.procRoot ?? "/proc";
  const currentBootId = readBootId(procRoot) ?? "nonlinux-boot";
  const currentPidNs = readPidNamespaceId("self", procRoot) ?? "nonlinux-pidns";
  try {
    const runtimeDir = resolveSessionRuntimeDir({
      env,
      sessionRuntimeDir: options.sessionRuntimeDir,
      isolatedTmpRoot: options.isolatedTmpRoot,
      createIfMissing: false,
    }).dir;
    const fiches = listSessionFiches(runtimeDir);
    // 1. Prefer verified /proc lineage ancestor matching a live fiche + valid 0600 secret.
    let curPid = process.pid;
    const seen = new Set<number>();
    for (let hop = 0; hop < 64 && curPid > 0 && !seen.has(curPid); hop++) {
      seen.add(curPid);
      const st = readProcStat(curPid, procRoot);
      if (!st) break;
      const match = fiches.find(
        (f) =>
          f.bootId === currentBootId &&
          f.pidNamespace === currentPidNs &&
          f.leaderPid === curPid &&
          f.leaderStartTime === st.startTime,
      );
      if (match) {
        const secOk = verifySessionSecretFile(
          sessionSecretPath(runtimeDir, match.sessionKey),
          match.secretSha256,
        );
        if (secOk) {
          return { sessionKey: match.sessionKey, actorId: match.actorId, isAgent: true };
        }
      }
      if (st.ppid <= 0 || curPid === 1) break;
      curPid = st.ppid;
    }
    // 2. Bounded pidns-session-ref fallback when isolated PID namespace differs and secret matches.
    if (sessionKey) {
      const fiche = readSessionFiche(runtimeDir, sessionKey);
      if (
        fiche &&
        fiche.bootId === currentBootId &&
        fiche.pidNamespace !== currentPidNs
      ) {
        const secOk = verifySessionSecretFile(
          sessionSecretPath(runtimeDir, fiche.sessionKey),
          fiche.secretSha256,
        );
        if (secOk) {
          return { sessionKey, actorId: fiche.actorId, isAgent: true };
        }
      }
    }
    return { sessionKey: sessionKey ?? null, actorId: null, isAgent: false };
  } catch {
    return { sessionKey: sessionKey ?? null, actorId: null, isAgent: false };
  }
}

export function checkCallerOwnsTargetSession(input: {
  readonly commandVerb: string;
  readonly targetLabel: string;
  readonly targetDelegatorInstance: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly sessionRuntimeDir?: string;
}): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  const caller = resolveCurrentCallerSessionContext(input.env ?? process.env, {
    ...(input.sessionRuntimeDir ? { sessionRuntimeDir: input.sessionRuntimeDir } : {}),
  });
  if (!caller.isAgent || !caller.actorId) {
    return { ok: true };
  }
  if (input.targetDelegatorInstance === caller.actorId) {
    return { ok: true };
  }
  const message =
    `session-not-owned-by-caller: refusing \`h2a ${input.commandVerb} ${input.targetLabel}\` ` +
    `(target delegator="${input.targetDelegatorInstance ?? "none"}", caller="${caller.actorId}")`;
  writeRuntimeIdentitySecurityEvent({
    reasonCode: "session-not-owned-by-caller",
    commandVerb: input.commandVerb,
    message,
    actorId: caller.actorId,
    sessionKey: caller.sessionKey,
    delegatorInstance: input.targetDelegatorInstance ?? null,
    alert: true,
    ...(input.env !== undefined ? { env: input.env } : {}),
  });
  return { ok: false, message };
}

export function findActiveSessionKey(input: {
  readonly actorId?: string | undefined;
  readonly hostSessionId?: string | undefined;
  readonly sessionRuntimeDir?: string | undefined;
}): string | undefined {
  if (!input.actorId && !input.hostSessionId) return undefined;
  try {
    const runtimeDir = resolveSessionRuntimeDir({
      sessionRuntimeDir: input.sessionRuntimeDir,
      createIfMissing: false,
    }).dir;
    const fiches = listSessionFiches(runtimeDir);
    const match = fiches.find(
      (f) =>
        (input.actorId !== undefined && f.actorId === input.actorId) ||
        (input.hostSessionId !== undefined && f.hostSessionId === input.hostSessionId),
    );
    return match?.sessionKey;
  } catch {
    return undefined;
  }
}

/**
 * Bounded 10s bash wait inserted at the top of `LOCAL_WRAPPER`,
 * `STRUCTURED_LOCAL_WRAPPER`, `HEADLESS_WRAPPER`, and `agy-headless.ts`
 * when `H2A_SESSION_REF` is set: refuses to start the CLI or fall back to an
 * interactive login shell if the launcher-published fiche is still absent.
 */
export const WAIT_FOR_FICHE_SHELL_PRELUDE =
  'if [ -n "${H2A_SESSION_REF:-}" ]; then ' +
  '_h2a_rt=""; ' +
  'if [ -n "${H2A_SESSION_PROOF_PATH:-}" ]; then _h2a_rt="$(dirname -- "$(dirname -- "${H2A_SESSION_PROOF_PATH}")")"; fi; ' +
  'if [ -z "${_h2a_rt}" ]; then _h2a_rt="/run/user/$(id -u)/h2a"; fi; ' +
  '_h2a_fiche="${_h2a_rt}/sessions/${H2A_SESSION_REF}.json"; ' +
  '_h2a_n=0; ' +
  'while [ ! -f "${_h2a_fiche}" ] && [ "${_h2a_n}" -lt 200 ]; do sleep 0.05; _h2a_n=$((_h2a_n + 1)); done; ' +
  'if [ ! -f "${_h2a_fiche}" ]; then ' +
  'echo "[h2a] session fiche missing after 10s for ${H2A_SESSION_REF}" >&2; ' +
  'rm -f -- "${H2A_SESSION_PROOF_PATH:-}" >/dev/null 2>&1 || true; ' +
  'exit 2; ' +
  'fi; ' +
  'unset _h2a_rt _h2a_fiche _h2a_n; ' +
  'fi';
