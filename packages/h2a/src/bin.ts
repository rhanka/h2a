#!/usr/bin/env node
/** Route MCP shims before importing the CLI, SDK, store or runtime. */
import { canonicalCentralRoot, shouldUseCentralMcp } from "./runtime/mcp-central-policy.js";
import { runCentralShim } from "./runtime/mcp-central-shim.js";

const argv = process.argv.slice(2);
const flags: Record<string, string> = {};
for (let i = 1; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const key = argv[i].slice(2);
  const value = argv[i + 1];
  flags[key] = value !== undefined && !value.startsWith("--") ? argv[++i] : "true";
}

try {
  if (argv[0] === "mcp-serve" && shouldUseCentralMcp(flags, process.env, true)) {
    process.exitCode = await runCentralShim(flags, canonicalCentralRoot());
  } else if (argv[0] === "mcp-central-connect") {
    // Explicit v1 connectors remain readable; new Claude connectors carry the
    // same causal context as mcp-serve. Unqualified named hosts use stdio.
    if (flags.host && !shouldUseCentralMcp(flags, process.env, true)) {
      process.argv[2] = "mcp-serve";
      await import("./bin-heavy.js");
    } else {
      process.exitCode = await runCentralShim(flags, canonicalCentralRoot());
    }
  } else if (argv[0] === "central" && ["status", "stop", "residues"].includes(argv[1])) {
    const { centralOperator, centralResidueReport } = await import("./runtime/mcp-central-operator.js");
    const result = argv[1] === "residues"
      ? centralResidueReport(flags.workspace ?? process.cwd(), flags["agy-config"])
      : await centralOperator(argv[1] as "status" | "stop", flags["runtime-base"] ? { runtimeBase: flags["runtime-base"] } : {});
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    await import("./bin-heavy.js");
  }
} catch (error) {
  process.stderr.write(`h2a ${argv[0] ?? ""}: ${(error as Error).message}\n`);
  process.exitCode = 1;
}
