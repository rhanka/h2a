/** Lightweight consumer. No business runtime. */
import type { Readable, Writable } from "node:stream";
import type { CentralMcpPathsOptions } from "./mcp-central-discovery.js";
import type { CentralMcpAttachment } from "./mcp-central-context.js";
export interface CentralMcpStdioBridgeOptions extends CentralMcpPathsOptions {
  endpoint?: string; stdin: Readable; stdout: Writable; signal?: AbortSignal;
  workspaceRoot?: string; attachment?: CentralMcpAttachment; ensure?: () => Promise<void>;
  registryTools?: ReadonlyArray<unknown>;
}
import { bridgeCentralMcpStdio as runBridge } from "./handover/shim-bridge.js";
export function bridgeCentralMcpStdio(options: CentralMcpStdioBridgeOptions): Promise<void> { return runBridge(options); }
