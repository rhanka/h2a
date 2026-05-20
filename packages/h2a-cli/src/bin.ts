#!/usr/bin/env node

import { runCli, runMcpServe } from "./cli.js";

const argv = process.argv.slice(2);

// `mcp-serve` is an async long-running JSON-RPC loop on real stdin; the
// synchronous `runCli` cannot represent it. We dispatch directly here.
if (argv[0] === "mcp-serve") {
  const flags: Record<string, string> = {};
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  runMcpServe(flags).then(
    (rc) => {
      process.exitCode = rc;
    },
    (err) => {
      process.stderr.write(`h2a mcp-serve: fatal: ${(err as Error).message}\n`);
      process.exitCode = 1;
    }
  );
} else {
  process.exitCode = runCli(argv);
}
