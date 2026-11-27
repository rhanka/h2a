import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, resolve } from "node:path";
import { isolateNativeTerminalSession, type SessionScopeOptions } from "./host-scope.js";

function parseScopeArgv(argv: readonly string[]): {
  scopeOptions: SessionScopeOptions;
  command: string | undefined;
  args: string[];
} {
  let memoryPolicy: "default" | "agy" | undefined;
  let sessionClass: "human" | "background" | undefined;
  let slice: "app.slice" | "h2a-agents.slice" | undefined;
  let oomPreference: "avoid" | "none" | undefined;
  let idx = 2;
  while (idx < argv.length) {
    const token = argv[idx]!;
    if (token === "--") {
      idx++;
      break;
    }
    if (token.startsWith("--memory-policy=")) {
      const val = token.slice("--memory-policy=".length);
      if (val !== "default" && val !== "agy") throw new Error(`invalid memory policy: ${val}`);
      memoryPolicy = val;
      idx++;
      continue;
    }
    if (token.startsWith("--session-class=")) {
      const val = token.slice("--session-class=".length);
      if (val !== "human" && val !== "background") throw new Error(`invalid session class: ${val}`);
      sessionClass = val;
      idx++;
      continue;
    }
    if (token.startsWith("--slice=")) {
      const val = token.slice("--slice=".length);
      if (val !== "app.slice" && val !== "h2a-agents.slice") throw new Error(`invalid memory slice: ${val}`);
      slice = val;
      idx++;
      continue;
    }
    if (token.startsWith("--oom-pref=")) {
      const val = token.slice("--oom-pref=".length);
      if (val !== "avoid" && val !== "none") throw new Error(`invalid oom preference: ${val}`);
      oomPreference = val;
      idx++;
      continue;
    }
    break;
  }
  const [command, ...args] = argv.slice(idx);
  return {
    scopeOptions: {
      ...(memoryPolicy !== undefined ? { memoryPolicy } : {}),
      ...(sessionClass !== undefined ? { sessionClass } : {}),
      ...(slice !== undefined ? { slice } : {}),
      ...(oomPreference !== undefined ? { oomPreference } : {}),
    },
    command,
    args,
  };
}

const { scopeOptions, command, args } = parseScopeArgv(process.argv);

// Runs INSIDE the PTY guardian, before executing any user CLI. Moving the
// child here preserves its process group and the guardian's host-death trap.
// Never execute a worker inside a protected host scope if its own move fails.
const isolation = await isolateNativeTerminalSession(scopeOptions);
if (!isolation.isolated) {
  process.stderr.write(`[h2a] session memory isolation failed (${isolation.reason}); CLI was not started\n`);
  process.exit(1);
}
if (!command) throw new Error("missing session command");
const candidates = isAbsolute(command) || command.includes("/")
  ? [resolve(command)]
  : (process.env.PATH ?? "").split(delimiter).map(dir => resolve(dir, command));
const executable = candidates.find(path => {
  try { accessSync(path, constants.X_OK); return true; } catch { return false; }
});
if (!executable) throw new Error(`session executable not found: ${command}`);
if (!process.execve) throw new Error("isolated native sessions require Node >=22.16 with execve support");
process.execve(executable, [command, ...args], process.env as Record<string, string>);
