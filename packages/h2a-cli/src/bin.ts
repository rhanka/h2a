#!/usr/bin/env node

import { runCli, runMcpServe, runRemoteSend, runRemoteServe } from "./cli.js";

const argv = process.argv.slice(2);

function parseFlagsFrom(start: number): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = start; i < argv.length; i++) {
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
  return flags;
}

function runAsync(label: string, promise: Promise<number>): void {
  promise.then(
    (rc) => {
      process.exitCode = rc;
    },
    (err) => {
      process.stderr.write(`h2a ${label}: fatal: ${(err as Error).message}\n`);
      process.exitCode = 1;
    }
  );
}

// `mcp-serve` and `remote serve/send` are async (long-running loop or network);
// the synchronous `runCli` cannot represent them, so we dispatch directly here.
if (argv[0] === "mcp-serve") {
  runAsync("mcp-serve", runMcpServe(parseFlagsFrom(1)));
} else if (argv[0] === "remote" && argv[1] === "serve") {
  runAsync("remote serve", runRemoteServe(parseFlagsFrom(2)));
} else if (argv[0] === "remote" && argv[1] === "send") {
  runAsync("remote send", runRemoteSend(parseFlagsFrom(2)));
} else {
  process.exitCode = runCli(argv);
}
