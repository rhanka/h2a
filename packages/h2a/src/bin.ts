#!/usr/bin/env node
/** Route MCP shims before importing the CLI, SDK, store or runtime. */
import { readFileSync } from "node:fs";
import {
  setGlobalVerifiedCallerContext,
  verifyCallerIdentity,
} from "./runtime/identity/caller-guard.js";
import { routeSelectedEntrypoint } from "./runtime/handover/selection.js";

const argv = process.argv.slice(2);
// Qualified Claude attachments default to central; explicit opt-outs remain authoritative.
const centralByDefault = true;

try {
  if (await routeSelectedEntrypoint(import.meta.url)) { /* same-process selected entry owns execution */ }
  else if (argv[0] === "--version" || argv[0] === "-v" || argv[0] === "version") {
    process.stdout.write(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version + "\n");
    process.exitCode = 0;
  } else {
  const guard = verifyCallerIdentity({ argv });
  if (!guard.ok) {
    process.stderr.write(`h2a: ${guard.reasonCode}: ${guard.message}\n`);
    if (guard.hint) process.stderr.write(`hint: ${guard.hint}\n`);
    process.exitCode = guard.exitCode;
  } else {
  setGlobalVerifiedCallerContext({
    verified: guard.ok,
    mode: guard.mode,
    isAgent: guard.mode === "agent",
    isH2aShell: guard.mode === "h2a-shell",
    isOwner: guard.mode === "owner",
    isScript: guard.mode === "script",
    parentFicheRejected: guard.parentFicheRejected,
    isForeignPidNamespace: guard.isForeignPidNamespace,
    actorId: guard.actorId,
    sessionKey: guard.sessionFiche?.sessionKey ?? null,
    agentUuid: guard.sessionFiche?.agentUuid ?? null,
    host: guard.sessionFiche?.host ?? null,
    delegatorInstance: guard.sessionFiche?.delegatorInstance ?? guard.daemonReceipt?.delegatorInstance ?? null,
    delegatorSessionKey: guard.sessionFiche?.delegatorSessionKey ?? null,
    verificationMode: guard.verificationMode,
    sessionFiche: guard.sessionFiche,
  });
  const guardedArgv = guard.forwardedArgv;
  process.argv = [process.argv[0]!, process.argv[1]!, ...guardedArgv];
  const flags: Record<string, string> = {};
  for (let i = 1; i < guardedArgv.length; i++) {
    if (!guardedArgv[i].startsWith("--")) continue;
    const key = guardedArgv[i].slice(2);
    const value = guardedArgv[i + 1];
    flags[key] = value !== undefined && !value.startsWith("--") ? guardedArgv[++i] : "true";
  }

  const { canonicalCentralRoot, centralRoutingEnabled, shouldUseCentralMcp } = await import("./runtime/mcp-central-policy.js");
  const { runCentralShim } = await import("./runtime/mcp-central-shim.js");
  const { readCentralMcpMarker } = await import("./runtime/mcp-central-discovery.js");
  const { inspectFirstInitialize } = await import("./runtime/mcp-central-initialize.js");
  const { isSupportedCentralHost, qualifiedHostInitialize } = await import("./runtime/mcp-central-qualification.js");
  if (guardedArgv[0] === "mcp-central-precheck") {
    const { readPrecheckManifest } = await import("./runtime/handover/precheck.js");
    const trial = readPrecheckManifest(flags["image-root"], flags["manifest-digest"]);
    const { startCentralMcpServer } = await import("./runtime/mcp-central.js");
    const started = await startCentralMcpServer({ root: flags.root, runtimeBase: flags["runtime-base"],
      physicalPrefix: flags["image-root"], precheck: true });
    if (started.kind !== "started") throw new Error("precheck_not_fresh");
    process.stdout.write(JSON.stringify({ precheckReady: true, manifestDigest: flags["manifest-digest"],
      buildId: trial.manifest.buildId, processIdentity: trial.processIdentity }) + "\n");
    await started.stop();
  } else {
  const isMcp = guardedArgv[0] === "mcp-serve" || guardedArgv[0] === "mcp-central-connect";
  // Structured sidecars must acknowledge their readiness challenge without
  // waiting for a host request. Other structural exclusions need no peeking.
  const hasNativeSession = flags.host === "claude" ? Boolean(process.env.CLAUDE_CODE_SESSION_ID?.trim()) : isSupportedCentralHost(flags.host);
  const inspect = isMcp && hasNativeSession &&
    !flags.instance && flags.backend !== "cluster-mesh" && process.env.H2A_MESSAGE_BACKEND !== "cluster-mesh" &&
    !process.env.H2A_MCP_READY_FILE && !process.env.H2A_MCP_READY_NONCE &&
    process.env.H2A_MCP_CENTRAL !== "0" && process.env.H2A_MCP_CENTRAL !== "false";
  const initialize = inspect ? await inspectFirstInitialize(process.stdin) : undefined;
  if (inspect && !qualifiedHostInitialize(flags.host, initialize)) {
    process.stderr.write(`h2a mcp: ${flags.host}_version_unqualified; using stdio\n`);
  }
  if (guardedArgv[0] === "mcp-serve" && shouldUseCentralMcp(flags, process.env, centralByDefault, initialize)) {
    process.exitCode = await runCentralShim(flags, canonicalCentralRoot());
  } else if (guardedArgv[0] === "mcp-central-connect") {
    // Legacy v1 connectors without explicit host qualification remain in stdio
    // until explicitly repaired. Unqualified hosts, missing markers, missing
    // host session binding, and opt-outs decide stdio before reading marker.
    // Claude binds its native conversation id; other supported hosts bind
    // their routed host tag until H6 measures real native session signals.
    const hasHostSession = flags.host === "claude"
      ? Boolean(process.env.CLAUDE_CODE_SESSION_ID?.trim())
      : isSupportedCentralHost(flags.host);
    const isSupportedHost = isSupportedCentralHost(flags.host);

    if (!isSupportedHost || !hasHostSession || !qualifiedHostInitialize(flags.host, initialize) || !centralRoutingEnabled(process.env, centralByDefault)) {
      process.argv[2] = "mcp-serve";
      await import("./bin-heavy.js");
    } else {
      const paths = flags["runtime-base"] ? { runtimeBase: flags["runtime-base"] } : {};
      let marker: ReturnType<typeof readCentralMcpMarker> | undefined;
      try {
        marker = readCentralMcpMarker(paths);
      } catch {
        marker = undefined;
      }
      if (!marker) {
        process.argv[2] = "mcp-serve";
        await import("./bin-heavy.js");
      } else {
        const effectiveFlags = {
          ...flags,
          endpoint: marker.endpoint
        };
        if (!shouldUseCentralMcp(effectiveFlags, process.env, centralByDefault, initialize)) {
          process.argv[2] = "mcp-serve";
          await import("./bin-heavy.js");
        } else {
          process.exitCode = await runCentralShim(effectiveFlags, canonicalCentralRoot());
        }
      }
    }
  } else if (guardedArgv[0] === "central" && ["status", "stop", "residues", "compact"].includes(guardedArgv[1])) {
    try {
      if (guardedArgv[1] === "stop" && flags.force !== undefined) throw new Error("central stop has no force mode");
      const { centralCompact, centralOperator, centralOperatorExitCode, centralResidueReport, parseCentralCompactArgs } = await import("./runtime/mcp-central-operator.js");
      const result = guardedArgv[1] === "compact"
        ? centralCompact({ ...parseCentralCompactArgs(guardedArgv.slice(2)), env: process.env })
        : guardedArgv[1] === "residues"
        ? centralResidueReport(flags.workspace ?? process.cwd(), flags["agy-config"], { repair: flags.repair === "true", allowTracked: flags["allow-tracked"] === "true" })
        : await centralOperator(guardedArgv[1] as "status" | "stop", flags["runtime-base"] ? { runtimeBase: flags["runtime-base"] } : {});
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      process.exitCode = centralOperatorExitCode(result);
    } catch (centralErr) {
      let centralExit = (centralErr as { exitCode?: number })?.exitCode;
      if (centralExit === undefined && !(centralErr as Error).message.includes("no force mode")) {
        try {
          const { centralFailureExitCode } = await import("./runtime/mcp-central-operator.js");
          centralExit = centralFailureExitCode(centralErr);
        } catch {
          centralExit = 1;
        }
      }
      guard.recordGrantOutcome?.(centralExit ?? 1);
      throw centralErr;
    }
    guard.recordGrantOutcome?.(typeof process.exitCode === "number" ? process.exitCode : 0);
  } else {
    await import("./bin-heavy.js");
  }
  }
  }
  }
} catch (error) {
  process.stderr.write(`h2a ${argv[0] ?? ""}: ${(error as Error).message}\n`);
  if (argv[0] === "central" && !(error as Error).message.includes("no force mode")) {
    const { centralFailureExitCode } = await import("./runtime/mcp-central-operator.js");
    process.exitCode = centralFailureExitCode(error);
  } else process.exitCode = 1;
}
