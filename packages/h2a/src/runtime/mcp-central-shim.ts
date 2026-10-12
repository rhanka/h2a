/** Lightweight CLI shim. Identity resolution and signing belong to the central. */
import { isAbsolute } from "node:path";
import { bridgeCentralMcpStdio } from "./mcp-central-client.js";
import { captureCentralAttachment } from "./mcp-central-context.js";
import { centralMcpMarkerPath, readCentralClientMarker } from "./mcp-central-discovery.js";
import { ensureCentralForShim } from "./mcp-central-start.js";

export async function runCentralShim(flags: Record<string, string>, root: string): Promise<number> {
  if (flags["runtime-base"] && !isAbsolute(flags["runtime-base"])) throw new Error("--runtime-base must be an absolute path");
  const controller = new AbortController();
  const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGHUP"];
  const onSignal = () => { controller.abort(); setTimeout(() => process.exit(process.exitCode ?? 0), 750).unref(); };
  for (const signal of signals) process.once(signal, onSignal);
  try {
    const paths = flags["runtime-base"] ? { runtimeBase: flags["runtime-base"] } : {};
    let marker: ReturnType<typeof readCentralClientMarker> | undefined;
    try {
      marker = readCentralClientMarker(centralMcpMarkerPath(paths));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    if (!marker && !flags.endpoint) {
      marker = await ensureCentralForShim(true, paths);
    }
    const endpoint = marker?.endpoint ?? flags.endpoint;
    if (!endpoint) throw new Error("no central MCP endpoint available");
    const qualified = flags.host === "claude" && Boolean(process.env.CLAUDE_CODE_SESSION_ID?.trim());
    await bridgeCentralMcpStdio({
      endpoint,
      ...paths, stdin: process.stdin, stdout: process.stdout, signal: controller.signal,
      workspaceRoot: process.cwd(),
      ...(qualified ? {
        attachment: captureCentralAttachment(root, process.cwd(), flags, process.env),
        ensure: async () => { await ensureCentralForShim(true, paths); }
      } : {})
    });
    return 0;
  } finally { for (const signal of signals) process.removeListener(signal, onSignal); }
}
