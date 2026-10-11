// Test-only entry, excluded from src/ and from the published binary.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hostLogSinkDiagnostics } from "../../src/native-terminal/crash-safe-log.js";
import { NativeTerminalHost } from "../../src/native-terminal/host.js";

const [mode, diagnosticsPath, ...hostArgs] = process.argv.slice(2);
process.stderr.emit("error", Object.assign(new Error("injected dead stderr"), { code: "EPIPE" }));
process.on("exit", () => writeFileSync(diagnosticsPath!, JSON.stringify(hostLogSinkDiagnostics())));
if (mode === "shutdown") {
  NativeTerminalHost.prototype.stopAll = () => { throw new Error("injected shutdown failure"); };
}
const entry = fileURLToPath(new URL("../../src/native-terminal/process.ts", import.meta.url));
process.argv = [process.execPath, entry, ...hostArgs];
if (mode === "startup") process.argv.push("--injected-invalid-argument");
await import(entry);
