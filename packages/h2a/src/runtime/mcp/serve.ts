import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { H2AWorkspaceRef } from "@sentropic/h2a";
import { buildDriveDriver, nativePtyBackchannelDriver, nativePtyWakeTarget } from "../drive/cli-driver.js";
import { chainDriver, localTmuxDriver, type H2ADriverKind } from "../drive/index.js";
import { createRelauncherRuntime } from "../drumbeat/relaunchers.js";
import type { AttachmentParticipant } from "../handover/participants.js";
import {
  H2A_CLI_DECLARED_CAPABILITIES,
  createHostSessionNameRefresher,
  defaultHostNameReaders
} from "../identity/index.js";
import { createLocalStore } from "../local-files/index.js";
import { messageBackend } from "../send.js";
import {
  H2A_AUTO_UPGRADE_CHECK_TTL_MS,
  H2A_REEXEC_GUARD_ENV,
  H2A_UPGRADE_CHECK_TTL_MS,
  describeBootUpgrade,
  runBootUpgrade
} from "../upgrade/index.js";
import { executeH2aRunWithAsyncSpawn, type H2aRunExecutor } from "./agent-launch.js";
import {
  getActiveMcpTrace,
  H2A_MCP_READY_FILE_ENV,
  H2A_MCP_READY_NONCE_ENV,
  runMcpStdio,
  type McpIdentityRequest,
  type ResolvedIdentityMessage,
  type RunMcpStdioOptions
} from "./index.js";

/**
 * Resolve the h2a store root, with its provenance.
 *
 * Precedence: explicit `--root` flag → `H2A_ROOT` env → the shared global
 * default `~/h2a-workspace/.h2a`.
 */
export function resolveRootInfo(
  flags: Record<string, string>,
  cwd: () => string
): { root: string; source: "flag" | "env" | "default" } {
  if (flags.root) return { root: flags.root, source: "flag" };
  const env = process.env.H2A_ROOT;
  if (env && env.length > 0) return { root: env, source: "env" };
  return { root: join(homedir(), "h2a-workspace", ".h2a"), source: "default" };
}

/** Resolve the h2a store root path for CLI and MCP commands. */
export function resolveRoot(flags: Record<string, string>, cwd: () => string): string {
  return resolveRootInfo(flags, cwd).root;
}

/**
 * Warn once to stderr when implicit root resolution selects the shared bus
 * while a repo-local `.h2a` exists under `cwd()`.
 */
export function warnIfCwdRootFallback(
  flags: Record<string, string>,
  cwd: () => string,
  streams: { stderr: Pick<NodeJS.WritableStream, "write"> }
): void {
  const info = resolveRootInfo(flags, cwd);
  if (info.source === "flag") return;
  const cwdLocal = join(cwd(), ".h2a");
  try {
    if (!existsSync(cwdLocal)) return;
    const resolvedLocal = realpathSync(cwdLocal);
    const resolvedRoot = (() => {
      try { return realpathSync(info.root); } catch { return info.root; }
    })();
    if (resolvedLocal === resolvedRoot) return;
    streams.stderr.write(
      `h2a: a repo-local .h2a exists here but I'm using the shared bus ${info.root}. ` +
        `Pass --root ${cwdLocal} if you meant the local one.\n`
    );
  } catch {
    // silently ignore filesystem errors
  }
}

/** Capture deferred identity resolution arguments for async MCP activation. */
export function buildMcpIdentityRequest(
  flags: Record<string, string>,
  cwd: () => string
): McpIdentityRequest {
  const host = flags.host ?? "agent";
  return {
    root: resolveRoot(flags, cwd),
    host,
    cwd: cwd(),
    declaredCapabilities: [...H2A_CLI_DECLARED_CAPABILITIES],
    ...(flags.instance !== undefined ? { explicitInstance: flags.instance } : {}),
    ...(flags.name !== undefined ? { name: flags.name } : {}),
    ...(flags.scope !== undefined ? { scopes: [flags.scope] } : {})
  };
}

/** Run `h2a mcp-serve` stdio transport or attach it inside central MCP. */
export async function runMcpServe(
  flags: Record<string, string>,
  io: {
    stdin: NodeJS.ReadableStream;
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    cwd?: () => string;
    /** Test seam for the internal structured-readiness environment. */
    env?: NodeJS.ProcessEnv;
    /**
     * Test seam for boot upgrade ordering: managed root the H4 automatic
     * pass adopts from.
     */
    upgradeManagedRoot?: string;
    /** Graceful-shutdown signal; bin.ts wires SIGTERM/SIGINT/SIGHUP to it. */
    signal?: AbortSignal;
    /** Internal central attachment adapter. */
    sharedStore?: ReturnType<typeof createLocalStore>;
    participant?: AttachmentParticipant;
    onServer?: RunMcpStdioOptions["onServer"];
    reclaimOnly?: boolean;
    expectedInstance?: string;
    centralAttachment?: boolean;
    runExecutor?: H2aRunExecutor;
  } = {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr
  }
): Promise<number> {
  const trace = getActiveMcpTrace();
  trace?.phase("mcp_serve_enter");
  const cwd = io.cwd ?? (() => process.cwd());
  warnIfCwdRootFallback(flags, cwd, { stderr: io.stderr });
  const root = trace
    ? trace.span("root_resolve", () => resolveRoot(flags, cwd))
    : resolveRoot(flags, cwd);
  const readinessEnv = io.env ?? process.env;
  const identityRequest = flags["auto-open"] !== undefined ? {
    ...buildMcpIdentityRequest(flags, cwd),
    providerEnv: Object.fromEntries(Object.entries(readinessEnv).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    ...(io.reclaimOnly ? { reclaimOnly: true } : {}),
    ...(io.expectedInstance ? { expectedInstance: io.expectedInstance } : {})
  } : undefined;
  const readyFile = readinessEnv[H2A_MCP_READY_FILE_ENV];
  const readyNonce = readinessEnv[H2A_MCP_READY_NONCE_ENV];
  let readiness: { file: string; nonce: string } | undefined;
  if (readyFile !== undefined || readyNonce !== undefined) {
    if (
      !readyFile ||
      !isAbsolute(readyFile) ||
      readyFile.includes("\0") ||
      !readyNonce ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        readyNonce
      )
    ) {
      io.stderr.write("h2a mcp-serve: invalid internal readiness challenge\n");
      return 1;
    }
    readiness = { file: readyFile, nonce: readyNonce };
  }

  const wantAutoUpgrade = flags["auto-upgrade"] !== undefined;
  const wantCheckOnly = flags["upgrade-check"] !== undefined;
  if (
    (wantAutoUpgrade || wantCheckOnly) && !io.centralAttachment &&
    process.env[H2A_REEXEC_GUARD_ENV] === undefined
  ) {
    try {
      const ttlMs = wantAutoUpgrade ? H2A_AUTO_UPGRADE_CHECK_TTL_MS : H2A_UPGRADE_CHECK_TTL_MS;
      if (io.upgradeManagedRoot !== undefined) {
        setImmediate(() => {
          try {
            const result = runBootUpgrade({
              root,
              ttlMs,
              mode: wantAutoUpgrade ? "auto" : "check",
              managedRoot: io.upgradeManagedRoot
            });
            const notice = describeBootUpgrade(result);
            if (notice !== null) io.stderr.write(`${notice}\n`);
          } catch {
            // best-effort: a check/upgrade failure must never affect serving.
          }
        });
      } else {
        const worker = spawn(
          process.execPath,
          [
            fileURLToPath(new URL("../upgrade/boot-worker.js", import.meta.url)),
            root,
            String(ttlMs),
            wantAutoUpgrade ? "auto" : "check"
          ],
          {
            detached: true,
            stdio: ["ignore", "ignore", "inherit"]
          }
        );
        worker.once("error", () => {});
        worker.unref();
        trace?.phase("upgrade_launch", { code: wantAutoUpgrade ? "auto" : "check" });
      }
    } catch {
      // best-effort: worker launch failure must never block serving.
    }
  }

  const WAKE_KINDS: readonly string[] = ["logging", "native", "local-tmux", "headless", "auto"];
  const nativeSessionId = nativePtyWakeTarget(readinessEnv);
  let wakeKind: string | undefined;
  if (flags.wake !== undefined && !WAKE_KINDS.includes(flags.wake)) {
    io.stderr.write(
      "h2a mcp-serve: --wake must be one of logging|native|local-tmux|headless|auto; ignored\n"
    );
  } else if (flags.wake === "headless") {
    io.stderr.write(
      "h2a mcp-serve: --wake headless is unsafe (it would spawn a NEW agent on inbox arrival, not wake this one); use auto. ignored\n"
    );
  } else if (flags.wake !== undefined && identityRequest === undefined) {
    io.stderr.write("h2a mcp-serve: --wake requires --auto-open; ignored\n");
  } else if (flags.wake !== undefined) {
    wakeKind = flags.wake;
  }

  const buildAutoOpen = (identity: ResolvedIdentityMessage): NonNullable<
    RunMcpStdioOptions["autoOpen"]
  > => {
    const host = flags.host;
    if (identity.migrationNotice) {
      io.stderr.write(`h2a mcp-serve: ${identity.migrationNotice}\n`);
    }
    const refreshableHost = host === "claude" || host === "codex";
    const refreshDisplayName =
      flags.name === undefined && identity.providerSessionId !== undefined && refreshableHost
        ? createHostSessionNameRefresher({
            host,
            cwd: cwd(),
            sessionId: identity.providerSessionId,
            readers: readinessEnv.HOME
              ? { ...defaultHostNameReaders, homedir: () => readinessEnv.HOME! }
              : defaultHostNameReaders
          })
        : undefined;
    const workspace = identity.workspace as H2AWorkspaceRef | undefined;
    return {
      instance: identity.instance,
      ...(host ? { host } : {}),
      ...(workspace !== undefined ? { workspace } : {}),
      ...(identity.name !== undefined ? { name: identity.name } : {}),
      ...(refreshDisplayName ? { refreshDisplayName } : {}),
      ...(flags.scope ? { scopes: [flags.scope] } : {}),
      ...(flags.instance === undefined ? { delegationEligible: true as const } : {})
    };
  };

  const buildWake = (
    privateKeyPem: string,
    _instance: string,
    host: string | undefined
  ): NonNullable<RunMcpStdioOptions["wake"]> | undefined => {
    if (wakeKind === undefined) return undefined;
    try {
      const log = (line: string) => io.stderr.write(`${line}\n`);
      const driver =
        wakeKind === "auto"
          ? chainDriver(nativePtyBackchannelDriver(log, readinessEnv), localTmuxDriver({ log, runtime: createRelauncherRuntime(readinessEnv) }))
          : buildDriveDriver(
              nativeSessionId !== undefined && wakeKind === "local-tmux"
                ? "native"
                : (wakeKind as H2ADriverKind),
              log,
              readinessEnv
            );
      void host;
      return {
        driver,
        privateKeyPem,
        ...(nativeSessionId !== undefined ? { nativeSessionId } : {})
      };
    } catch (err) {
      io.stderr.write(`h2a mcp-serve: --wake disabled: ${(err as Error).message}\n`);
      return undefined;
    }
  };

  try {
    const backend = messageBackend(flags.backend ?? readinessEnv.H2A_MESSAGE_BACKEND);
    const modulePath = readinessEnv.H2A_CLUSTER_MESH_MODULE;
    if (backend === "cluster-mesh") {
      if (!identityRequest) throw new Error("cluster-mesh requires --auto-open and a local signing key");
      if (!modulePath || !isAbsolute(modulePath)) throw new Error("cluster-mesh requires an absolute H2A_CLUSTER_MESH_MODULE");
    }
    const bindMessaging: NonNullable<RunMcpStdioOptions["identityActivation"]>["bindMessaging"] = backend === "cluster-mesh"
      ? async (signer, signal) => {
          const { loadClusterMeshMessaging } = await import("../cluster-mesh-messaging.js");
          signal.throwIfAborted();
          return loadClusterMeshMessaging(createLocalStore({ root, initialize: false }), signer, modulePath);
        }
      : undefined;
    trace?.phase("transport_enter");
    await runMcpStdio({
      root,
      messageBackend: backend,
      workspaceRoot: cwd(),
      sessionEnv: readinessEnv,
      ...(io.sharedStore ? { store: io.sharedStore } : {}),
      ...(io.participant ? { participant: io.participant } : {}),
      ...(io.centralAttachment ? { centralAttachment: true } : {}),
      ...(io.onServer ? { onServer: io.onServer } : {}),
      ...(io.runExecutor ? { runExecutor: io.runExecutor } : io.centralAttachment ? {
        runExecutor: request => executeH2aRunWithAsyncSpawn(request, spawn, undefined, readinessEnv)
      } : {}),
      stdin: io.stdin as never,
      stdout: io.stdout as never,
      stderr: io.stderr as never,
      ...(identityRequest
        ? { identityRequest, identityActivation: { buildAutoOpen, buildWake, ...(bindMessaging ? { bindMessaging } : {}) } }
        : {}),
      ...(readiness ? { readiness } : {}),
      ...(io.signal ? { signal: io.signal } : {})
    });
    return 0;
  } catch (err) {
    io.stderr.write(`h2a mcp-serve: ${(err as Error).message}\n`);
    return 1;
  }
}
