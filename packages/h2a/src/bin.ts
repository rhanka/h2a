#!/usr/bin/env node

import {
  cmdKeepalive,
  runCli,
  runDriveServe,
  runMcpServe,
  runRemoteSend,
  runRemoteServe,
  runMirrorServe,
  runMirrorPush,
  runDrumbeatRelanceInbox,
  runDrumbeatWatch,
  runSysmlVerify
} from "./cli.js";

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

// P5: verbes remote délégués au runtime LOURD, chargé en LAZY (import dynamique).
// @sentropic/h2a ne dépend JAMAIS de @sentropic/h2a-runtime (ni node-pty/aws-sdk) :
// le runtime est un package séparé, installé à part. Petit lot d'abord (consensus).
const REMOTE_RUNTIME_VERBS = new Set([
  "run", "attach", "stop", "logs", "workspace", "resume"
]);

async function dispatchRemote(): Promise<number> {
  // Spécifieur via variable typée `string` : tsc ne résout PAS statiquement ce
  // package optionnel (sinon TS2307 car h2a n'en dépend pas — règle d'or).
  const REMOTE_RUNTIME_PKG: string = "@sentropic/h2a-runtime";
  let rt: { dispatch?: (argv: readonly string[]) => Promise<number> };
  try {
    rt = (await import(REMOTE_RUNTIME_PKG)) as {
      dispatch?: (argv: readonly string[]) => Promise<number>;
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ERR_MODULE_NOT_FOUND") {
      process.stderr.write(
        `h2a ${argv[0]}: ce verbe requiert le runtime remote (sessions / k8s / tunnel).\n` +
          "  Installe-le : npm i -g @sentropic/h2a-runtime\n"
      );
      return 127;
    }
    throw err;
  }
  if (typeof rt.dispatch !== "function") {
    process.stderr.write("h2a: @sentropic/h2a-runtime n'expose pas dispatch().\n");
    return 1;
  }
  // dispatch = main(argv) : commander attend le style process.argv ([node, script, …]).
  return rt.dispatch(process.argv);
}

// `mcp-serve` and `remote serve/send` are async (long-running loop or network);
// the synchronous `runCli` cannot represent them, so we dispatch directly here.
if (argv[0] === "mcp-serve") {
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
} else if (argv[0] !== undefined && REMOTE_RUNTIME_VERBS.has(argv[0])) {
  runAsync(`remote:${argv[0]}`, dispatchRemote());
} else {
  process.exitCode = runCli(argv);
}
