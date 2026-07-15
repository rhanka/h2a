#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  cmdKeepalive,
  runCli,
  runDriveServe,
  runMcpServe,
  runRemoteSend,
  runRemoteServe,
  runMirrorServe,
  runMirrorPush,
  runCanevasServeCli,
  runTrackMcpServe,
  runDrumbeatRelanceInbox,
  runDrumbeatWatch,
  runLoopEngineCli,
  runSysmlVerify
} from "./cli.js";
import {
  resolveH2aRuntimeDispatch,
  shouldDispatchRuntime
} from "./bin-routing.js";
import { runFocusServeCli } from "./runtime/focus/serve.js";

const argv = process.argv.slice(2);

function readOwnVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

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

// Parité ② (double-consensus 2026-07-03) : `h2a` = LE driver global. Tout
// premier-mot NON h2a-natif (cf. bin-routing.ts) est un verbe du runtime lourd
// et part en LAZY vers @sentropic/h2a-runtime. @sentropic/h2a ne dépend JAMAIS du
// runtime (règle d'or) : import dynamique à spécifieur-string, seule frontière.

async function dispatchRuntime(): Promise<number> {
  // Spécifieur via variable typée `string` : tsc ne résout PAS statiquement ce
  // package optionnel (sinon TS2307 car h2a n'en dépend pas — règle d'or).
  const H2A_RUNTIME_PKG: string = "@sentropic/h2a-runtime";
  let rt: unknown;
  try {
    rt = await import(H2A_RUNTIME_PKG);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ERR_MODULE_NOT_FOUND") {
      process.stderr.write(
        `h2a ${argv[0]}: ce verbe requiert le runtime h2a (sessions / k8s / tunnel).\n` +
          "  Installe-le : npm i -g @sentropic/h2a-runtime\n"
      );
      return 127;
    }
    throw err;
  }
  let dispatch;
  try {
    dispatch = resolveH2aRuntimeDispatch(rt);
  } catch (err) {
    process.stderr.write(
      `h2a ${argv[0]}: runtime incompatible — ${(err as Error).message}.\n` +
        "  Mets à jour ensemble : npm i -g @sentropic/h2a@latest @sentropic/h2a-runtime@latest\n"
    );
    return 64;
  }
  // dispatchH2a = main(argv) : commander attend process.argv ([node, script, …]).
  return dispatch(process.argv);
}

// `mcp-serve` and `h2a remote serve/send` are async (long-running loop or network);
// the synchronous `runCli` cannot represent them, so we dispatch directly here.
if (argv[0] === "--version" || argv[0] === "-v" || argv[0] === "version") {
  process.stdout.write(`${readOwnVersion()}\n`);
  process.exitCode = 0;
} else if (argv[0] === "mcp-serve") {
  // Graceful shutdown: a host kill (or orderly stop) cleans presence
  // immediately (sessions → `closed`) rather than leaving it to expire as
  // false-live. We override the default signal terminate, so we MUST guarantee
  // the process still exits — hence the unref'd fallback timer.
  const ac = new AbortController();
  const onSignal = (sig: NodeJS.Signals): void => {
    process.stderr.write(`h2a mcp-serve: received ${sig}, shutting down gracefully\n`);
    ac.abort();
    setTimeout(() => process.exit(process.exitCode ?? 0), 750).unref();
  };
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as NodeJS.Signals[]) {
    process.once(sig, () => onSignal(sig));
  }
  runAsync(
    "mcp-serve",
    runMcpServe(parseFlagsFrom(1), {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      signal: ac.signal
    })
  );
} else if (argv[0] === "track-mcp") {
  // Consolidation ④-S2 — native track MCP server (long-running stdio) served
  // IN-PROCESS via @sentropic/track. Graceful shutdown like mcp-serve so a host
  // kill stops it cleanly; the unref'd fallback timer guarantees the exit.
  const ac = new AbortController();
  const onSignal = (sig: NodeJS.Signals): void => {
    process.stderr.write(`h2a track-mcp: received ${sig}, shutting down gracefully\n`);
    ac.abort();
    setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
  };
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as NodeJS.Signals[]) {
    process.once(sig, () => onSignal(sig));
  }
  runAsync(
    "track-mcp",
    runTrackMcpServe(parseFlagsFrom(1), { stderr: process.stderr, signal: ac.signal })
  );
} else if (argv[0] === "remote" && argv[1] === "serve") {
  runAsync("remote serve", runRemoteServe(parseFlagsFrom(2)));
} else if (argv[0] === "remote" && argv[1] === "send") {
  runAsync("remote send", runRemoteSend(parseFlagsFrom(2)));
} else if (argv[0] === "remote" && argv[1] === "mirror-serve") {
  runAsync("remote mirror-serve", runMirrorServe(parseFlagsFrom(2)));
} else if (argv[0] === "remote" && argv[1] === "mirror") {
  runAsync("remote mirror", runMirrorPush(parseFlagsFrom(2)));
} else if (argv[0] === "drive" && argv[1] === "serve") {
  runAsync("drive serve", runDriveServe(parseFlagsFrom(2)));
} else if (argv[0] === "drumbeat" && argv[1] === "relance-inbox") {
  runAsync("drumbeat relance-inbox", runDrumbeatRelanceInbox(parseFlagsFrom(2)));
} else if (argv[0] === "drumbeat" && argv[1] === "watch") {
  runAsync("drumbeat watch", runDrumbeatWatch(parseFlagsFrom(2)));
} else if (argv[0] === "sysml" && argv[1] === "verify") {
  runAsync("sysml verify", runSysmlVerify(parseFlagsFrom(2)));
} else if (argv[0] === "keepalive") {
  runAsync("keepalive", cmdKeepalive(parseFlagsFrom(1), { stdout: process.stdout, stderr: process.stderr }));
} else if (argv[0] === "focus" && (argv[1] === "serve" || argv[1] === "web")) {
  // Intercept the production web server before the bare `focus` facade can delegate to `track focus`.
  // Every other `h2a focus ...` invocation keeps the existing Track behavior unchanged.
  const ac = new AbortController();
  const onSignal = (sig: NodeJS.Signals): void => {
    process.stderr.write(`h2a focus ${argv[1]}: received ${sig}, stopping\n`);
    ac.abort(sig);
    const exitCode = sig === "SIGINT" ? 130 : sig === "SIGHUP" ? 129 : 143;
    setTimeout(() => process.exit(process.exitCode ?? exitCode), 2500).unref();
  };
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as NodeJS.Signals[]) {
    process.once(sig, () => onSignal(sig));
  }
  runAsync(
    `focus ${argv[1]}`,
    runFocusServeCli(argv, { stdout: process.stdout, stderr: process.stderr }, ac.signal)
  );
} else if (argv[0] === "canevas" && argv[1] === "serve") {
  // Canevas ③ read-only server (long-running) → graceful shutdown like mcp-serve.
  const ac = new AbortController();
  const onSignal = (sig: NodeJS.Signals): void => {
    process.stderr.write(`h2a canevas serve: received ${sig}, stopping\n`);
    ac.abort();
    setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
  };
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as NodeJS.Signals[]) {
    process.once(sig, () => onSignal(sig));
  }
  runAsync(
    "canevas serve",
    runCanevasServeCli(argv, { stdout: process.stdout, stderr: process.stderr }, ac.signal)
  );
} else if (argv[0] === "loop" && (argv[1] === "tick" || argv[1] === "watch" || argv[1] === "run")) {
  // Objective-loop tick/watch are async (lazy runtime import + periodic loop).
  // `watch` is long-running → wire graceful shutdown like mcp-serve so an abort
  // stops the loop cleanly (no orphaned timer).
  const ac = new AbortController();
  if ((argv[1] === "watch" || argv[1] === "run")) {
    const onSignal = (sig: NodeJS.Signals): void => {
      process.stderr.write(`h2a loop watch: received ${sig}, stopping\n`);
      ac.abort();
      setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
    };
    for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as NodeJS.Signals[]) {
      process.once(sig, () => onSignal(sig));
    }
  }
  runAsync(
    `loop ${argv[1]}`,
    runLoopEngineCli(argv, { stdout: process.stdout, stderr: process.stderr }, ac.signal)
  );
} else if (shouldDispatchRuntime(argv)) {
  runAsync(`runtime:${argv[0]}`, dispatchRuntime());
} else {
  process.exitCode = runCli(argv);
}
