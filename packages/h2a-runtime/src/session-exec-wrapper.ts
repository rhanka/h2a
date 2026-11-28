/**
 * Dedicated wrapper for `--tmux` persistent-shell launches (`LOCAL_WRAPPER` new
 * unstructured panes, `relaunch` retype into an existing pane, and `h2a resume`
 * in place). Anchors the active session fiche on `wrapper.pid` (never on
 * `pane_pid`), consumes `relaunch-handoffs/<sessionKey>.json`, scrubs ONLY
 * `SESSION_IDENTITY_SCRUB_KEYS` from the inherited pane environment BEFORE
 * setting child session env vars (including `REMOTE_JOB_ID`), and purges all
 * session artifacts in `finally`.
 */

import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  consumeRelaunchHandoff,
  isValidSessionFicheShape,
  purgeSessionArtifacts,
  readBootId,
  readMachineId,
  readPidNamespaceId,
  readProcStat,
  resolveSessionRuntimeDir,
  scrubSessionIdentityEnv,
  SESSION_CLASS_ENV,
  SESSION_KEY_RE,
  SESSION_PROOF_PATH_ENV,
  SESSION_REF_ENV,
  verifySessionSecretFile,
  writeSessionFiche,
  type SessionFiche,
} from "./session-auth.js";

const DIRECT_ROUTING_SCRUB_ENV = "H2A_DIRECT_ROUTING_SCRUB";
const APPLICATION_ROLE_ENV = "H2A_NATIVE_FOREGROUND_ROLE";

function sessionExecWrapperEntryPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const sibling = join(here, "session-exec-wrapper.js");
  if (existsSync(sibling)) return sibling;
  if (basename(here) === "src") {
    const built = join(dirname(here), "dist", "session-exec-wrapper.js");
    if (existsSync(built)) return built;
  }
  return sibling;
}

export function buildSessionExecWrapperCommandLine(args: {
  readonly sessionKey: string;
  readonly relaunchHint: string;
  readonly command: string;
  readonly commandArgs: readonly string[];
  readonly noShell?: boolean | undefined;
}): string[] {
  const script = sessionExecWrapperEntryPath();
  return [
    process.execPath,
    script,
    args.sessionKey,
    args.relaunchHint,
    args.noShell ? "1" : "0",
    args.command,
    ...args.commandArgs,
  ];
}

export async function runSessionExecWrapper(argv: readonly string[]): Promise<number> {
  const [sessionKey, relaunchHint, noShellFlag, command, ...cmdArgs] = argv;
  if (!sessionKey || !SESSION_KEY_RE.test(sessionKey) || !command) {
    process.stderr.write("[h2a] session-exec-wrapper: invalid invocation arguments\n");
    return 2;
  }

  let runtimeDir: string;
  try {
    runtimeDir = resolveSessionRuntimeDir({ createIfMissing: false }).dir;
  } catch (err) {
    process.stderr.write(
      `[h2a] session-exec-wrapper: runtime dir unavailable: ${(err as Error).message}\n`,
    );
    return 2;
  }

  const handoff = consumeRelaunchHandoff(runtimeDir, sessionKey);
  if (!handoff) {
    process.stderr.write(
      `[h2a] session-exec-wrapper: handoff missing or invalid for session ${sessionKey}\n`,
    );
    purgeSessionArtifacts(runtimeDir, sessionKey);
    return 2;
  }

  const expectedUid = typeof process.getuid === "function" ? process.getuid() : 0;
  const handoffWithSha = handoff as typeof handoff & { readonly secretSha256?: string };
  if (
    !handoffWithSha.secretSha256 ||
    !verifySessionSecretFile(handoff.secretPath, handoffWithSha.secretSha256, expectedUid)
  ) {
    process.stderr.write(
      `[h2a] session-exec-wrapper: session secret missing or invalid for ${sessionKey}\n`,
    );
    purgeSessionArtifacts(runtimeDir, sessionKey);
    return 2;
  }

  const wrapperPid = process.pid;
  const wrapperStartTime = readProcStat(wrapperPid)?.startTime ?? "0";
  const bootId = readBootId() ?? "nonlinux-boot";
  const pidNamespace = readPidNamespaceId("self") ?? "nonlinux-pidns";
  const machineId = readMachineId();

  // Scrub ONLY the closed 51-key table from inherited pane env, BEFORE setting child vars.
  const childEnv = scrubSessionIdentityEnv(process.env);
  if (process.env[DIRECT_ROUTING_SCRUB_ENV] === "1") {
    delete childEnv["ANTHROPIC_BASE_URL"];
    delete childEnv["ANTHROPIC_AUTH_TOKEN"];
    childEnv[DIRECT_ROUTING_SCRUB_ENV] = "1";
  } else if (process.env[DIRECT_ROUTING_SCRUB_ENV] === "0") {
    childEnv[DIRECT_ROUTING_SCRUB_ENV] = "0";
  }
  childEnv[SESSION_CLASS_ENV] = handoff.sessionClass;
  childEnv[SESSION_REF_ENV] = handoff.sessionKey;
  childEnv[SESSION_PROOF_PATH_ENV] = handoff.secretPath;
  if (handoff.jobId) {
    childEnv["REMOTE_JOB_ID"] = handoff.jobId;
  }

  const baseFiche: SessionFiche = {
    version: 1,
    sessionKey: handoff.sessionKey,
    actorId: handoff.actorId,
    agentUuid: handoff.agentUuid,
    host: handoff.host,
    invocationMode: handoff.invocationMode,
    createdBy: "launcher",
    hostSessionId: handoff.hostSessionId,
    cliPid: null,
    cliStartTime: null,
    sessionClass: handoff.sessionClass,
    delegatorInstance: handoff.delegatorInstance,
    delegatorSessionKey: handoff.delegatorSessionKey,
    secretSha256: handoffWithSha.secretSha256,
    leaderPid: wrapperPid,
    leaderStartTime: wrapperStartTime,
    bootId,
    pidNamespace,
    machineId,
    scopeUnit: null,
    issuedAt: new Date().toISOString(),
  };

  if (!isValidSessionFicheShape(baseFiche)) {
    purgeSessionArtifacts(runtimeDir, sessionKey);
    process.stderr.write("[h2a] session-exec-wrapper: malformed fiche metadata\n");
    return 2;
  }

  let exitCode = 1;
  try {
    writeSessionFiche(runtimeDir, baseFiche);
    if (childEnv["H2A_NATIVE_TERMINAL"] === "1") {
      childEnv[APPLICATION_ROLE_ENV] = `cli:${wrapperPid}`;
    }

    exitCode = await new Promise<number>((resolveExit) => {
      const child = spawn(command, cmdArgs, {
        stdio: "inherit",
        env: childEnv,
        shell: false,
      });
      if (child.pid !== undefined) {
        const cliStart = readProcStat(child.pid)?.startTime ?? null;
        try {
          writeSessionFiche(runtimeDir, {
            ...baseFiche,
            cliPid: child.pid,
            cliStartTime: cliStart,
          });
        } catch {
          /* keep baseFiche */
        }
      }
      const forward = (sig: NodeJS.Signals) => {
        try {
          child.kill(sig);
        } catch {
          /* ignore */
        }
      };
      for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
        process.on(sig, forward);
      }
      const cleanupSignals = () => {
        for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
          process.removeListener(sig, forward);
        }
      };
      child.on("error", (err) => {
        cleanupSignals();
        process.stderr.write(`[h2a] failed to execute ${command}: ${err.message}\n`);
        resolveExit(127);
      });
      child.on("close", (code, sig) => {
        cleanupSignals();
        if (code !== null) resolveExit(code);
        else resolveExit(sig === "SIGINT" ? 130 : sig === "SIGHUP" ? 129 : 143);
      });
    });
  } finally {
    purgeSessionArtifacts(runtimeDir, sessionKey);
  }

  if (noShellFlag !== "1") {
    if (handoff.sessionClass === "background") {
      process.stderr.write(
        `\n[h2a] ${command} exited (code ${exitCode}) — delegated (background) session ended on ${process.cwd()}.\n`,
      );
      process.stderr.write(
        "Delegated session (background) ended without active fiche: relaunch from an owner terminal outside any h2a session (or Ctrl-D to end this pane).\n",
      );
    } else if (relaunchHint) {
      process.stderr.write(
        `\n[h2a] ${command} exited (code ${exitCode}) — shell on ${process.cwd()}.\n`,
      );
      process.stderr.write(
        `[h2a] relaunch: ${relaunchHint}   (or Ctrl-D to end this session)\n`,
      );
    }
  }
  try {
    rmSync(handoff.secretPath, { force: true });
  } catch {
    /* already purged */
  }
  return exitCode;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1]
) {
  runSessionExecWrapper(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`[h2a] session-exec-wrapper fatal: ${(err as Error).message}\n`);
      process.exitCode = 2;
    },
  );
}
