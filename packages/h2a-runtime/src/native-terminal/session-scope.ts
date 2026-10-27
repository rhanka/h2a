import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, resolve } from "node:path";
import { isolateNativeTerminalSession } from "./host-scope.js";

// Runs INSIDE the PTY guardian, before executing any user CLI. Moving the
// child here preserves its process group and the guardian's host-death trap.
// Never execute a worker inside a protected host scope if its own move fails.
const isolation = await isolateNativeTerminalSession();
if (!isolation.isolated) {
  process.stderr.write(`[h2a] session memory isolation failed (${isolation.reason}); CLI was not started\n`);
  process.exit(1);
}
const [command, ...args] = process.argv.slice(2);
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
