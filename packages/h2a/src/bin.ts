#!/usr/bin/env node
/** Route MCP shims before importing the CLI, SDK, store or runtime. */
import { canonicalCentralRoot, centralRoutingEnabled, shouldUseCentralMcp } from "./runtime/mcp-central-policy.js";
import { runCentralShim } from "./runtime/mcp-central-shim.js";
import { readCentralMcpMarker } from "./runtime/mcp-central-discovery.js";
import { inspectFirstInitialize } from "./runtime/mcp-central-initialize.js";
import { qualifiedClaudeInitialize } from "./runtime/mcp-central-qualification.js";

const argv = process.argv.slice(2);
// Qualified Claude attachments default to central; explicit opt-outs remain authoritative.
const centralByDefault = true;
const flags: Record<string, string> = {};
for (let i = 1; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const key = argv[i].slice(2);
  const value = argv[i + 1];
  flags[key] = value !== undefined && !value.startsWith("--") ? argv[++i] : "true";
}

try {
  const isMcp = argv[0] === "mcp-serve" || argv[0] === "mcp-central-connect";
  // Structured sidecars must acknowledge their readiness challenge without
  // waiting for a host request. Other structural exclusions need no peeking.
  const inspect = isMcp && flags.host === "claude" && Boolean(process.env.CLAUDE_CODE_SESSION_ID?.trim()) &&
    !flags.instance && flags.backend !== "cluster-mesh" && process.env.H2A_MESSAGE_BACKEND !== "cluster-mesh" &&
    !process.env.H2A_MCP_READY_FILE && !process.env.H2A_MCP_READY_NONCE &&
    process.env.H2A_MCP_CENTRAL !== "0" && process.env.H2A_MCP_CENTRAL !== "false";
  const initialize = inspect ? await inspectFirstInitialize(process.stdin) : undefined;
  if (inspect && !qualifiedClaudeInitialize(initialize)) {
    process.stderr.write("h2a mcp: claude_version_unqualified; using stdio\n");
  }
  if (argv[0] === "mcp-serve" && shouldUseCentralMcp(flags, process.env, centralByDefault, initialize)) {
    process.exitCode = await runCentralShim(flags, canonicalCentralRoot());
  } else if (argv[0] === "mcp-central-connect") {
    // Legacy v1 connectors without explicit host qualification remain in stdio
    // until explicitly repaired. Unqualified hosts, missing markers, missing
    // Claude session ID, and opt-outs decide stdio before reading marker.
    const hasClaudeId = Boolean(process.env.CLAUDE_CODE_SESSION_ID?.trim());
    const isExplicitClaude = flags.host === "claude";

    if (!isExplicitClaude || !hasClaudeId || !qualifiedClaudeInitialize(initialize) || !centralRoutingEnabled(process.env, centralByDefault)) {
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
  } else if (argv[0] === "central" && ["status", "stop", "residues"].includes(argv[1])) {
    const { centralOperator, centralResidueReport } = await import("./runtime/mcp-central-operator.js");
    const result = argv[1] === "residues"
      ? centralResidueReport(flags.workspace ?? process.cwd(), flags["agy-config"], { repair: flags.repair === "true", allowTracked: flags["allow-tracked"] === "true" })
      : await centralOperator(argv[1] as "status" | "stop", flags["runtime-base"] ? { runtimeBase: flags["runtime-base"] } : {});
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    await import("./bin-heavy.js");
  }
} catch (error) {
  process.stderr.write(`h2a ${argv[0] ?? ""}: ${(error as Error).message}\n`);
  process.exitCode = 1;
}
