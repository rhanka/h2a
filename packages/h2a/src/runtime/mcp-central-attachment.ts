/**
 * Reuse stdio's identity/presence/wake activation behind a per-attachment
 * HTTP transport, with tool dispatch routed through the composed Sentropic
 * registry plan (round 2, lazy on first call so the light-shim static graph
 * stays mesh-free). The route only admits or denies: execution stays in
 * this attachment's server, so identity, workspace, store and participant
 * fencing are unchanged from H1.
 */
import { PassThrough, Writable } from "node:stream";
import type { Notification } from "@modelcontextprotocol/sdk/types.js";
import { runMcpServe } from "../cli.js";
import type { createLocalStore } from "./local-files/index.js";
import { createMcpServer, type McpServer } from "./mcp/server.js";
import type { H2aRunExecutor } from "./mcp/agent-launch.js";
import { CENTRAL_ATTACHMENT_ENV, type CentralMcpAttachment } from "./mcp-central-context.js";
import type { AttachmentParticipant } from "./handover/participants.js";

export type CentralAttachmentHandle = { mcp: McpServer; close(): Promise<void> };

/**
 * Install the Sentropic-registry dispatch route on an attachment server.
 * The registry module (and its mesh packages) loads LAZILY on the first
 * tool call: the light-shim fixture tree ships no nested `node_modules`,
 * so a static import here would break every shim child at startup even
 * though the shim path never dispatches. The raw dispatch is captured
 * synchronously at install time, so the later wrapper can never recurse
 * into itself.
 */
function installRegistryDispatch(mcp: McpServer, options: { root: string; workspaceRoot: string }): void {
  const rawCallTool = mcp.callTool.bind(mcp) as McpServer["callTool"];
  let delegate: McpServer["callTool"] | undefined;
  let pending: Promise<McpServer["callTool"]> | undefined;
  const stub = ((name: string, args: Record<string, unknown> | undefined) => {
    // H1 internals read `h2a_identity_status` SYNCHRONOUSLY
    // (`handover/participants.js identity()`, freeze/checkpoint path): the
    // raw call is sync for the status tool, while any plan route is async by
    // construction. The status read is side-effect-free, identity-scoped and
    // admitted in every view, so it keeps the exact historical sync bytes;
    // every other tool routes through the composed plan below.
    if (name === "h2a_identity_status") return rawCallTool(name, args);
    return (async () => {
      pending ??= (async () => {
        const { wrapMcpServerWithDaemonRegistry } = await import("../registry/sentropic-daemon.js");
        return wrapMcpServerWithDaemonRegistry({ callTool: rawCallTool }, options).callTool;
      })();
      delegate ??= await pending;
      return delegate(name, args);
    })();
  }) as McpServer["callTool"];
  mcp.callTool = stub;
}

export function openCentralAttachment(
  root: string,
  workspace: string,
  store: ReturnType<typeof createLocalStore>,
  context: CentralMcpAttachment | undefined,
  notify: (notification: Notification) => Promise<void>,
  runExecutor?: H2aRunExecutor,
  participant?: AttachmentParticipant
): CentralAttachmentHandle {
  if (!context) {
    const mcp = createMcpServer({ root, workspaceRoot: workspace, store, ...(participant ? { participant } : {}), ...(runExecutor ? { runExecutor } : {}) });
    participant?.bind(mcp);
    installRegistryDispatch(mcp, { root, workspaceRoot: workspace });
    return { mcp, async close() {
      mcp.notifications.stop();
      if (participant?.transferred()) mcp.sessions.suspend();
      else mcp.sessions.closeAll("closed");
    } };
  }
  const input = new PassThrough();
  const controller = new AbortController();
  let mcp: McpServer | undefined;
  const output = new Writable({ write(chunk: Buffer, _encoding, done) {
    try {
      const deliveries: Promise<void>[] = [];
      for (const line of chunk.toString("utf8").split("\n").filter(Boolean)) {
        const message = JSON.parse(line) as Notification;
        if (message.method) deliveries.push(notify(message));
      }
      void Promise.all(deliveries).then(() => done(), done);
    } catch (error) { done(error as Error); }
  } });
  const daemonEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !(CENTRAL_ATTACHMENT_ENV as readonly string[]).includes(key) &&
    !key.startsWith("H2A_NATIVE_") && !key.startsWith("H2A_MCP_READY_")
  ));
  const serving = runMcpServe({ ...context.flags, root, host: context.host }, {
    stdin: input, stdout: output, stderr: process.stderr,
    cwd: () => workspace,
    env: { ...daemonEnvironment, ...context.env, H2A_ROOT: root },
    sharedStore: store,
    ...(participant ? { participant } : {}),
    centralAttachment: true,
    reclaimOnly: context.resume,
    expectedInstance: context.expectedInstance,
    signal: controller.signal,
    onServer(server) { mcp = server; participant?.bind(server); },
    ...(runExecutor ? { runExecutor } : {})
  });
  if (!mcp) { controller.abort(); input.end(); throw new Error("central attachment activation failed"); }
  installRegistryDispatch(mcp, { root, workspaceRoot: workspace });
  return { mcp, async close() {
    controller.abort();
    input.end();
    await serving;
    output.destroy();
  } };
}
