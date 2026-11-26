/**
 * Owner-only trust baseline, approval, refusal, and audit CLI (`h2a trust`).
 *
 * Security invariants (Q1-A, Q2-C):
 * - Refuses in non-TTY terminals or inside ANY h2a session (`H2A_SESSION_CLASS`
 *   set, `H2A_NATIVE_TERMINAL=1`, etc.) for all state-mutating operations.
 * - Requires owner to retype the folder basename before approving/refusing.
 * - Acquires double flock (`~/.local/state/h2a/trust-write.lock` -> `/run/user/<uid>/agy-start.lock`)
 *   and creates `settings.json.bak-<ts>` (`0600`) + atomic write before mutation.
 * - Never trusts `$HOME` or `/`; `init-baseline` never deletes absent entries without
 *   explicit agreement.
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { createInterface } from "node:readline/promises";
import { basename, join, resolve } from "node:path";
import { Command } from "commander";

import {
  agySettingsPath,
  appendJsonlPrivate,
  canonicalizeWorkspacePath,
  collectTrustAlertsReadOnly,
  h2aTrustApprovalsPath,
  h2aTrustAuditPath,
  h2aTrustWriteLockPath,
  isUnsupportedTrustRoot,
  OnboardingLaunchError,
  resolveAgyStartLockPath,
  resolveFlockTool,
  safeRealpath,
  writeFileAtomicPrivate,
  type TrustAuditEvent,
  type TrustOwnerAlert,
} from "./onboarding-core.js";
import { SESSION_CLASS_ENV } from "./session-class.js";
import { formatTrustOwnerAlertLine } from "./trust-alerts.js";

export interface TrustCliDeps {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly stdinIsTTY?: boolean;
  readonly stdoutIsTTY?: boolean;
  readonly promptLine?: (prompt: string) => Promise<string>;
  readonly startLockPath?: string;
  readonly flockCandidates?: readonly string[];
  readonly stdout?: (chunk: string) => void;
  readonly stderr?: (chunk: string) => void;
  readonly now?: () => number;
}

export function isInsideH2aSessionEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (env[SESSION_CLASS_ENV]?.trim()) return true;
  if (env["H2A_NATIVE_TERMINAL"] === "1") return true;
  if (env["H2A_NATIVE_PTY_SESSION"]?.trim()) return true;
  if (env["H2A_SESSION_TOKEN"]?.trim()) return true;
  if (env["H2A_JOB_ID"]?.trim()) return true;
  return false;
}

function defaultPromptLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return rl.question(prompt).finally(() => rl.close());
}

function openPrivateWriteLock(lockPath: string, expectedUid: number): number {
  const dir = resolve(lockPath, "..");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dirInfo = lstatSync(dir);
  if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink() || dirInfo.uid !== expectedUid) {
    throw new OnboardingLaunchError({
      code: "cli-trust-config-unreadable",
      phase: "onboarding",
      message: `unsafe trust lock parent directory: ${dir}`,
      retrySafe: true,
    });
  }
  const fd = openSync(
    lockPath,
    fsConstants.O_CREAT | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.uid !== expectedUid) {
      throw new OnboardingLaunchError({
        code: "cli-trust-config-unreadable",
        phase: "onboarding",
        message: `trust lock ${lockPath} is not a regular file owned by uid ${expectedUid}`,
        retrySafe: true,
      });
    }
    return fd;
  } catch (err) {
    closeSync(fd);
    throw err;
  }
}

function acquireFlockExclusiveSync(fd: number, lockPath: string, flockTool: string): void {
  const r = spawnSync(flockTool, ["--exclusive", "--timeout", "10.000", "3"], {
    stdio: ["ignore", "ignore", "ignore", fd],
    env: {},
  });
  if (r.status !== 0) {
    throw new OnboardingLaunchError({
      code: "cli-start-lock-timeout",
      phase: "start-queue",
      message: `failed to acquire lock ${lockPath} before timeout`,
      retrySafe: true,
    });
  }
}

export function withTrustMutationLocksSync<T>(
  deps: TrustCliDeps,
  fn: () => T,
): T {
  const env = deps.env ?? process.env;
  const uid = process.getuid?.() ?? 0;
  const flockTool = resolveFlockTool(deps.flockCandidates, uid);
  const writeLockPath = h2aTrustWriteLockPath(env);
  const startLockPath = deps.startLockPath ?? resolveAgyStartLockPath(uid);

  const writeFd = openPrivateWriteLock(writeLockPath, uid);
  let startFd: number | undefined;
  try {
    acquireFlockExclusiveSync(writeFd, writeLockPath, flockTool);
    // Validate and hold agy-start.lock without sleeping or modifying start spacing timestamp.
    const startParent = resolve(startLockPath, "..");
    let parentInfo: ReturnType<typeof lstatSync>;
    try {
      parentInfo = lstatSync(startParent);
    } catch (error) {
      throw new OnboardingLaunchError({
        code: "cli-start-lock-unavailable",
        phase: "start-queue",
        message: `start lock directory unavailable (${startParent}): ${error instanceof Error ? error.message : String(error)}`,
        retrySafe: true,
      });
    }
    if (
      !parentInfo.isDirectory() ||
      parentInfo.isSymbolicLink() ||
      parentInfo.uid !== uid ||
      (parentInfo.mode & 0o777) !== 0o700
    ) {
      throw new OnboardingLaunchError({
        code: "cli-start-lock-unavailable",
        phase: "start-queue",
        message: `start lock parent ${startParent} has unsafe ownership or mode`,
        retrySafe: true,
      });
    }
    startFd = openSync(
      startLockPath,
      fsConstants.O_CREAT | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW,
      0o600,
    );
    const startInfo = fstatSync(startFd);
    if (!startInfo.isFile() || startInfo.uid !== uid) {
      throw new OnboardingLaunchError({
        code: "cli-start-lock-unavailable",
        phase: "start-queue",
        message: `start lock ${startLockPath} has unsafe type or ownership`,
        retrySafe: true,
      });
    }
    acquireFlockExclusiveSync(startFd, startLockPath, flockTool);
    return fn();
  } finally {
    if (startFd !== undefined) {
      try {
        closeSync(startFd);
      } catch {
        /* ignore */
      }
    }
    try {
      closeSync(writeFd);
    } catch {
      /* ignore */
    }
  }
}

export function assertOwnerTerminalAccess(deps: TrustCliDeps = {}): void {
  const env = deps.env ?? process.env;
  const stdinIsTTY = deps.stdinIsTTY ?? (process.stdin.isTTY === true);
  const stdoutIsTTY = deps.stdoutIsTTY ?? (process.stdout.isTTY === true);
  if (isInsideH2aSessionEnv(env)) {
    throw new OnboardingLaunchError({
      code: "cli-workspace-not-trusted",
      phase: "onboarding",
      message: "refusing `h2a trust`: command is restricted to the owner's terminal and forbidden inside any h2a session",
      hint: "run `h2a trust` directly from your standalone host terminal",
      retrySafe: false,
    });
  }
  if (!stdinIsTTY || !stdoutIsTTY) {
    throw new OnboardingLaunchError({
      code: "cli-workspace-not-trusted",
      phase: "onboarding",
      message: "refusing `h2a trust`: interactive owner TTY required (stdin and stdout must be terminals)",
      hint: "run `h2a trust` directly from your interactive terminal",
      retrySafe: false,
    });
  }
}

function readSettingsRawStrict(settingsFile: string): Record<string, unknown> {
  if (!existsSync(settingsFile)) return {};
  const raw = readFileSync(settingsFile, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OnboardingLaunchError({
      code: "cli-trust-config-unreadable",
      phase: "onboarding",
      message: `${settingsFile} must be a JSON object`,
      retrySafe: true,
    });
  }
  const obj = parsed as Record<string, unknown>;
  if (
    "trustedWorkspaces" in obj &&
    obj["trustedWorkspaces"] !== undefined &&
    (!Array.isArray(obj["trustedWorkspaces"]) || !obj["trustedWorkspaces"].every((x) => typeof x === "string"))
  ) {
    throw new OnboardingLaunchError({
      code: "cli-trust-config-unreadable",
      phase: "onboarding",
      message: `${settingsFile} trustedWorkspaces must be string[]`,
      retrySafe: true,
    });
  }
  return obj;
}

function readApprovalsMutable(approvalsFile: string): {
  version: 1;
  agy: { subtrees: string[]; exact: string[]; refused: string[] };
} {
  if (!existsSync(approvalsFile)) {
    return { version: 1, agy: { subtrees: [], exact: [], refused: [] } };
  }
  const raw = readFileSync(approvalsFile, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OnboardingLaunchError({
      code: "cli-trust-config-unreadable",
      phase: "onboarding",
      message: `${approvalsFile} must be a JSON object`,
      retrySafe: true,
    });
  }
  const agy = (parsed as Record<string, unknown>)["agy"] as Record<string, unknown> | undefined;
  const arr = (k: string): string[] => {
    const v = agy?.[k];
    if (v === undefined) return [];
    if (!Array.isArray(v) || !v.every((x): x is string => typeof x === "string")) {
      throw new OnboardingLaunchError({
        code: "cli-trust-config-unreadable",
        phase: "onboarding",
        message: `${approvalsFile} agy.${k} must be string[]`,
        retrySafe: true,
      });
    }
    return [...v];
  };
  return {
    version: 1,
    agy: { subtrees: arr("subtrees"), exact: arr("exact"), refused: arr("refused") },
  };
}

function backupSettingsIfPresent(settingsFile: string, nowMs: number): string | undefined {
  if (!existsSync(settingsFile)) return undefined;
  const content = readFileSync(settingsFile, "utf8");
  const backupPath = `${settingsFile}.bak-${nowMs}`;
  writeFileAtomicPrivate(backupPath, content);
  return backupPath;
}

function emitAlertsHeader(deps: TrustCliDeps): readonly TrustOwnerAlert[] {
  const env = deps.env ?? process.env;
  const stderr = deps.stderr ?? ((s: string) => { process.stderr.write(s); });
  const { alerts } = collectTrustAlertsReadOnly(env);
  for (const alert of alerts) {
    stderr(`[h2a trust] ${formatTrustOwnerAlertLine(alert)}\n`);
  }
  return alerts;
}

export async function runTrustAgyCommand(
  targetDir: string,
  options: { readonly refuse?: boolean; readonly exact?: boolean } = {},
  deps: TrustCliDeps = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? ((s: string) => { process.stdout.write(s); });
  const stderr = deps.stderr ?? ((s: string) => { process.stderr.write(s); });
  const promptLine = deps.promptLine ?? defaultPromptLine;
  const nowMs = (deps.now ?? Date.now)();

  emitAlertsHeader(deps);
  assertOwnerTerminalAccess(deps);

  const realDir = canonicalizeWorkspacePath(targetDir);
  if (isUnsupportedTrustRoot(realDir, env)) {
    throw new OnboardingLaunchError({
      code: "cli-trust-unsupported-cwd",
      phase: "onboarding",
      message: `refusing to trust protected root directory ${realDir} ($HOME and / can never be trusted)`,
      hint: "pass a specific project directory instead",
      retrySafe: false,
    });
  }

  const expectedName = basename(realDir);
  const verb = options.refuse ? "REFUSE" : "APPROVE";
  const scopeLabel = options.refuse
    ? "refusal (never trusted even via ancestor subtree)"
    : options.exact
      ? "exact directory only"
      : "directory and internal subdirectories (Q2-C)";
  stdout(`Target: ${realDir}\nScope:  ${scopeLabel}\n`);
  const reply = (await promptLine(`Type folder name "${expectedName}" to ${verb} agy trust: `)).trim();
  if (reply !== expectedName) {
    stderr(`[h2a trust] confirmation mismatch (expected "${expectedName}"); aborted with no changes.\n`);
    return 1;
  }

  const settingsFile = agySettingsPath(env);
  const approvalsFile = h2aTrustApprovalsPath(env);
  const auditFile = h2aTrustAuditPath(env);
  const ts = new Date(nowMs).toISOString();

  withTrustMutationLocksSync(deps, () => {
    const settingsObj = readSettingsRawStrict(settingsFile);
    const approvals = readApprovalsMutable(approvalsFile);
    const existingList = Array.isArray(settingsObj["trustedWorkspaces"])
      ? [...(settingsObj["trustedWorkspaces"] as string[])]
      : [];

    if (options.refuse) {
      approvals.agy.subtrees = approvals.agy.subtrees.filter((p) => (safeRealpath(p) ?? resolve(p)) !== realDir);
      approvals.agy.exact = approvals.agy.exact.filter((p) => (safeRealpath(p) ?? resolve(p)) !== realDir);
      if (!approvals.agy.refused.includes(realDir)) approvals.agy.refused.push(realDir);
      const filteredSettings = existingList.filter((p) => (safeRealpath(p) ?? resolve(p)) !== realDir);
      let settingsWritten = false;
      if (filteredSettings.length !== existingList.length) {
        backupSettingsIfPresent(settingsFile, nowMs);
        settingsObj["trustedWorkspaces"] = filteredSettings;
        writeFileAtomicPrivate(settingsFile, `${JSON.stringify(settingsObj, null, 2)}\n`);
        settingsWritten = true;
      }
      writeFileAtomicPrivate(approvalsFile, `${JSON.stringify(approvals, null, 2)}\n`);
      const ev: TrustAuditEvent = {
        id: randomUUID(),
        timestamp: ts,
        cli: "agy",
        action: "refuse",
        path: realDir,
        actor: "owner-tty",
        settingsWritten,
      };
      appendJsonlPrivate(auditFile, ev);
      return;
    }

    approvals.agy.refused = approvals.agy.refused.filter((p) => (safeRealpath(p) ?? resolve(p)) !== realDir);
    if (options.exact) {
      approvals.agy.subtrees = approvals.agy.subtrees.filter((p) => (safeRealpath(p) ?? resolve(p)) !== realDir);
      if (!approvals.agy.exact.includes(realDir)) approvals.agy.exact.push(realDir);
    } else {
      approvals.agy.exact = approvals.agy.exact.filter((p) => (safeRealpath(p) ?? resolve(p)) !== realDir);
      if (!approvals.agy.subtrees.includes(realDir)) approvals.agy.subtrees.push(realDir);
    }
    const nextSettingsList = Array.from(new Set([...existingList, realDir]));
    backupSettingsIfPresent(settingsFile, nowMs);
    settingsObj["trustedWorkspaces"] = nextSettingsList;
    writeFileAtomicPrivate(settingsFile, `${JSON.stringify(settingsObj, null, 2)}\n`);
    writeFileAtomicPrivate(approvalsFile, `${JSON.stringify(approvals, null, 2)}\n`);
    const ev: TrustAuditEvent = {
      id: randomUUID(),
      timestamp: ts,
      cli: "agy",
      action: "approve",
      path: realDir,
      scope: options.exact ? "exact" : "subtree",
      actor: "owner-tty",
      settingsWritten: true,
    };
    appendJsonlPrivate(auditFile, ev);
  });

  stdout(`[h2a trust] ${options.refuse ? "refused" : "approved"} agy workspace trust: ${realDir}\n`);
  return 0;
}

export async function runTrustInitBaselineCommand(
  deps: TrustCliDeps = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? ((s: string) => { process.stdout.write(s); });
  const stderr = deps.stderr ?? ((s: string) => { process.stderr.write(s); });
  const promptLine = deps.promptLine ?? defaultPromptLine;
  const nowMs = (deps.now ?? Date.now)();

  emitAlertsHeader(deps);
  assertOwnerTerminalAccess(deps);

  const settingsFile = agySettingsPath(env);
  const approvalsFile = h2aTrustApprovalsPath(env);
  const auditFile = h2aTrustAuditPath(env);
  const ts = new Date(nowMs).toISOString();

  const initialSettings = readSettingsRawStrict(settingsFile);
  const configured = Array.isArray(initialSettings["trustedWorkspaces"])
    ? [...(initialSettings["trustedWorkspaces"] as string[])]
    : [];

  const validPaths: string[] = [];
  const absentPaths: string[] = [];
  const protectedPaths: string[] = [];
  for (const rawEntry of configured) {
    const resolved = resolve(rawEntry);
    if (!existsSync(resolved)) {
      absentPaths.push(rawEntry);
      continue;
    }
    let real: string;
    try {
      real = realpathSync(resolved);
    } catch {
      absentPaths.push(rawEntry);
      continue;
    }
    if (isUnsupportedTrustRoot(real, env)) {
      protectedPaths.push(rawEntry);
      continue;
    }
    validPaths.push(real);
  }

  for (const prot of protectedPaths) {
    stderr(`[h2a trust] protected root (${prot}) will not be granted subtree inheritance\n`);
  }

  let removeAbsent = false;
  if (absentPaths.length > 0) {
    stdout(`Found ${absentPaths.length} absent path(s) in ${settingsFile}:\n`);
    for (const p of absentPaths) stdout(`  - ${p}\n`);
    const ans = (await promptLine("Remove these absent paths from settings.json? [y/N]: ")).trim().toLowerCase();
    removeAbsent = ans === "y" || ans === "yes";
    if (!removeAbsent) {
      stdout("[h2a trust] keeping absent paths untouched in settings.json.\n");
    }
  }

  withTrustMutationLocksSync(deps, () => {
    const settingsObj = readSettingsRawStrict(settingsFile);
    const approvals = readApprovalsMutable(approvalsFile);
    const existingList = Array.isArray(settingsObj["trustedWorkspaces"])
      ? [...(settingsObj["trustedWorkspaces"] as string[])]
      : [];

    for (const real of validPaths) {
      if (!approvals.agy.exact.includes(real) && !approvals.agy.subtrees.includes(real)) {
        approvals.agy.exact.push(real);
      }
      const ev: TrustAuditEvent = {
        id: randomUUID(),
        timestamp: ts,
        cli: "agy",
        action: "baseline-import",
        path: real,
        scope: "exact",
        actor: "owner-tty",
        settingsWritten: false,
      };
      appendJsonlPrivate(auditFile, ev);
    }

    if (removeAbsent && absentPaths.length > 0) {
      const absentSet = new Set(absentPaths);
      backupSettingsIfPresent(settingsFile, nowMs);
      settingsObj["trustedWorkspaces"] = existingList.filter((item) => !absentSet.has(item));
      writeFileAtomicPrivate(settingsFile, `${JSON.stringify(settingsObj, null, 2)}\n`);
      for (const removed of absentPaths) {
        appendJsonlPrivate(auditFile, {
          id: randomUUID(),
          timestamp: ts,
          cli: "agy",
          action: "remove",
          path: resolve(removed),
          actor: "owner-tty",
          settingsWritten: true,
        } satisfies TrustAuditEvent);
      }
    }

    writeFileAtomicPrivate(approvalsFile, `${JSON.stringify(approvals, null, 2)}\n`);
  });

  stdout(
    `[h2a trust] baseline initialized (${validPaths.length} imported` +
      `${removeAbsent ? `, ${absentPaths.length} absent removed` : absentPaths.length > 0 ? `, ${absentPaths.length} absent kept` : ""}).\n`,
  );
  return 0;
}

export async function runTrustAuditCommand(
  options: { readonly ack?: string; readonly json?: boolean } = {},
  deps: TrustCliDeps = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? ((s: string) => { process.stdout.write(s); });
  const stderr = deps.stderr ?? ((s: string) => { process.stderr.write(s); });
  const nowMs = (deps.now ?? Date.now)();
  const auditFile = h2aTrustAuditPath(env);

  if (options.ack) {
    assertOwnerTerminalAccess(deps);
    const alerts = collectTrustAlertsReadOnly(env).alerts;
    const match = alerts.find((a) => a.id === options.ack);
    if (!match) {
      stderr(`[h2a trust] alert id "${options.ack}" not found among active alerts.\n`);
      return 1;
    }
    const ts = new Date(nowMs).toISOString();
    withTrustMutationLocksSync(deps, () => {
      appendJsonlPrivate(auditFile, {
        id: randomUUID(),
        timestamp: ts,
        cli: "agy",
        action: "ack",
        path: match.path ?? "",
        actor: "owner-tty",
        ackedAlertId: match.id,
      } satisfies TrustAuditEvent);
    });
    stdout(`[h2a trust] acknowledged alert ${match.id}\n`);
    return 0;
  }

  const alerts = collectTrustAlertsReadOnly(env).alerts;
  let events: TrustAuditEvent[] = [];
  if (existsSync(auditFile)) {
    const raw = readFileSync(auditFile, "utf8");
    events = raw
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as TrustAuditEvent);
  }
  if (options.json) {
    stdout(`${JSON.stringify({ alerts, events: events.slice(-50) }, null, 2)}\n`);
    return 0;
  }
  if (alerts.length === 0) {
    stdout("[h2a trust] no active trust alerts.\n");
  } else {
    stdout(`Active trust alerts (${alerts.length}):\n`);
    for (const a of alerts) stdout(`  ${formatTrustOwnerAlertLine(a)}\n`);
  }
  stdout(`Audit entries recorded: ${events.length}\n`);
  for (const ev of events.slice(-10)) {
    stdout(`  ${ev.timestamp} ${ev.action} ${ev.cli} ${ev.path}${ev.ackedAlertId ? ` (ack ${ev.ackedAlertId})` : ""}\n`);
  }
  return 0;
}

export function registerTrustCommand(program: Command, deps: TrustCliDeps = {}): void {
  const trust = program
    .command("trust")
    .description(
      "Owner-only CLI workspace trust approvals, baseline import, and audit log (restricted to interactive owner terminals).",
    );

  trust
    .command("agy <dir>")
    .description("Approve or refuse agy workspace trust for <dir> (with Q2-C subtree scope unless --exact)")
    .option("--refuse", "explicitly refuse <dir> so neither exact nor parent approvals cover it")
    .option("--exact", "approve only <dir> instead of its internal subdirectories")
    .action(async (dir: string, opts: { refuse?: boolean; exact?: boolean }) => {
      try {
        process.exitCode = await runTrustAgyCommand(dir, opts, deps);
      } catch (err) {
        process.stderr.write(`[h2a trust] ${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = 1;
      }
    });

  trust
    .command("init-baseline")
    .description("Import existing settings.json trustedWorkspaces into the owner audit baseline")
    .action(async () => {
      try {
        process.exitCode = await runTrustInitBaselineCommand(deps);
      } catch (err) {
        process.stderr.write(`[h2a trust] ${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = 1;
      }
    });

  trust
    .command("audit")
    .description("Show active out-of-band trust alerts and audit history, or acknowledge an alert")
    .option("--ack <id>", "acknowledge an active out-of-band alert id (owner terminal only)")
    .option("--json", "output JSON summary")
    .action(async (opts: { ack?: string; json?: boolean }) => {
      try {
        process.exitCode = await runTrustAuditCommand(opts, deps);
      } catch (err) {
        process.stderr.write(`[h2a trust] ${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = 1;
      }
    });
}
