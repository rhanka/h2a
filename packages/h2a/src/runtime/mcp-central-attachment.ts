/** Reuse stdio's identity/presence/wake activation behind a per-attachment HTTP transport. */
import { PassThrough, Writable } from "node:stream";
import type { Notification } from "@modelcontextprotocol/sdk/types.js";
import { runMcpServe } from "../cli.js";
import type { createLocalStore } from "./local-files/index.js";
import { createMcpServer, type McpServer } from "./mcp/server.js";
import type { H2aRunExecutor } from "./mcp/agent-launch.js";
import type { CentralMcpAttachment } from "./mcp-central-context.js";

export type CentralAttachmentHandle = { mcp: McpServer; close(): Promise<void> };

export function openCentralAttachment(
  root: string,
  workspace: string,
  store: ReturnType<typeof createLocalStore>,
  context: CentralMcpAttachment | undefined,
  notify: (notification: Notification) => void,
  runExecutor?: H2aRunExecutor
): CentralAttachmentHandle {
  if (!context) {
    const mcp = createMcpServer({ root, workspaceRoot: workspace, store, ...(runExecutor ? { runExecutor } : {}) });
    return { mcp, async close() { mcp.notifications.stop(); mcp.sessions.closeAll("closed"); } };
  }
  const input = new PassThrough();
  const controller = new AbortController();
  let mcp: McpServer | undefined;
  const output = new Writable({ write(chunk: Buffer, _encoding, done) {
    try {
      for (const line of chunk.toString("utf8").split("\n").filter(Boolean)) {
        const message = JSON.parse(line) as Notification;
        if (message.method) notify(message);
      }
      done();
    } catch (error) { done(error as Error); }
  } });
  const serving = runMcpServe({ ...context.flags, root, host: "claude" }, {
    stdin: input, stdout: output, stderr: process.stderr,
    cwd: () => workspace,
    env: { ...process.env, ...context.env, H2A_ROOT: root },
    sharedStore: store,
    centralAttachment: true,
    reclaimOnly: context.resume,
    expectedInstance: context.expectedInstance,
    signal: controller.signal,
    onServer(server) { mcp = server; },
    ...(runExecutor ? { runExecutor } : {})
  });
  if (!mcp) { controller.abort(); input.end(); throw new Error("central attachment activation failed"); }
  return { mcp, async close() {
    controller.abort();
    input.end();
    await serving;
    output.destroy();
  } };
}
