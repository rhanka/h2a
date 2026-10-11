// Test-only entry, outside src/ and the packaged production build. No identity
// spoofing or fault-injection switch is added to the production CLI.
import { Server } from "node:net";
import { basename } from "node:path";
import { hostLogSinkDiagnostics } from "../../src/native-terminal/crash-safe-log.js";
import { runNativeTerminalHostProcess } from "../../src/native-terminal/process.js";
import { isStagedSocketName } from "../../src/native-terminal/server.js";

let listener: Server | undefined;
const socketPath = process.argv[process.argv.indexOf("--socket") + 1]!;
const emit = Server.prototype.emit;
Server.prototype.emit = function (event, ...args) {
  if (event === "listening") {
    const address = this.address();
    if (typeof address === "string" && isStagedSocketName(basename(address), socketPath, process.pid)) listener = this;
  }
  return emit.call(this, event, ...args);
};
process.on("message", (message: { codes?: Array<string | null>; uncaught?: boolean }) => {
  if (message.uncaught) {
    setImmediate(() => { throw new Error("unguarded test fault"); });
    return;
  }
  if (!listener) throw new Error("test listener not captured");
  for (const code of message.codes ?? []) {
    const error = new Error("injected listener fault");
    if (code !== null) Object.assign(error, { code });
    listener.emit("error", error);
  }
  process.send?.({ kind: "fault-diagnostics", ...hostLogSinkDiagnostics() });
});
// IPC must not prevent the production graceful-stop path from exiting.
process.channel?.unref();
await runNativeTerminalHostProcess(process.argv);
