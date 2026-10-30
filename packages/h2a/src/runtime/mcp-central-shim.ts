/** Lightweight CLI shim. Identity resolution and signing belong to the central. */
import { isAbsolute } from "node:path";
import { bridgeCentralMcpStdio } from "./mcp-central-client.js";
import { captureCentralAttachment } from "./mcp-central-context.js";
import { ensureCentralForShim } from "./mcp-central-start.js";
import { isSupportedCentralHost } from "./mcp-central-qualification.js";
import type { BridgeLock } from "../registry/bridge-lock.js";

export async function runCentralShim(flags: Record<string, string>, root: string,
  registry?: { lock?: BridgeLock; tools: ReadonlyArray<unknown> }): Promise<number> {
  if (flags["runtime-base"] && !isAbsolute(flags["runtime-base"])) throw new Error("--runtime-base must be an absolute path");
  const controller = new AbortController();
  const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGHUP"];
  const onSignal = () => { controller.abort(); setTimeout(() => process.exit(process.exitCode ?? 0), 750).unref(); };
  for (const signal of signals) process.once(signal, onSignal);
  try {
    const paths = flags["runtime-base"] ? { runtimeBase: flags["runtime-base"] } : {};
    // Discovery errors still reject the bridge's connection state. Local MCP
    // initialization precedes that state; only ENOENT can permit autostart.
    // The legacy --endpoint hint never overrides the selected publication.
    // Claude binds its native conversation id; other supported hosts bind
    // their routed host tag until H6 measures real native session signals.
    const qualified = isSupportedCentralHost(flags.host) &&
      (flags.host !== "claude" || Boolean(process.env.CLAUDE_CODE_SESSION_ID?.trim()));
    const registryDigest = registry?.lock
      ? (await import("../registry/bridge-lock.js")).bridgeLockDigest(registry.lock) : undefined;
    await bridgeCentralMcpStdio({
      ...paths, stdin: process.stdin, stdout: process.stdout, signal: controller.signal,
      workspaceRoot: process.cwd(),
      ...(registry ? { registryTools: registry.tools } : {}),
      ...(qualified ? {
        attachment: captureCentralAttachment(root, process.cwd(), {
          ...flags, ...(registryDigest ? { "registry-lock-digest": registryDigest } : {})
        }, process.env),
        ensure: async () => { await ensureCentralForShim(true, paths); }
      } : {})
    });
    return 0;
  } finally { for (const signal of signals) process.removeListener(signal, onSignal); }
}
