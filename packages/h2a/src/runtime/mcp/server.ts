import { createLocalStore, type LocalStore } from "../local-files/store.js";

import {
  handleAppendJournal,
  handleAttestComprehension,
  handleBlockageList,
  handleBlockageRaise,
  handleBlockageResolve,
  handleConflictPosture,
  handleConductor,
  handleConductorClaim,
  handleConductorRelease,
  handleConductorLaunchCheck,
  handleConductorLaunch,
  handleCounteroffer,
  handleDeclareConflitInteret,
  handleDiscoverInstances,
  handleDiscoverSessions,
  handleLoopCreate,
  handleLoopDone,
  handleLoopJoin,
  handleLoopList,
  handleLoopReport,
  handleLoopStatus,
  handleLoopStop,
  handleEscalate,
  handleInbox,
  handleNhiAttest,
  handleNhiExport,
  handleNhiInventory,
  handleNhiOffboard,
  handleNhiReport,
  handleOffer,
  handleOpenNegotiation,
  handleRegisterInstance,
  handleSessionClose,
  handleSessionOpen,
  handleSign,
  handleStabilize,
  type McpErrorResult,
  type McpToolResult
} from "./handlers.js";
import {
  NotificationDispatcher,
  type NotificationSink
} from "./notifications.js";
import {
  SessionRegistry,
  type SessionRegistryOptions
} from "./sessions.js";
import {
  H2A_CLI_MCP_TOOL_DESCRIPTORS,
  type McpToolDescriptor,
  type McpToolName
} from "./tools.js";

import { H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS } from "@sentropic/h2a";
import {
  executeH2aRun,
  handleH2aRun,
  type H2aRunExecutor
} from "./agent-launch.js";

export interface CreateMcpServerOptions {
  /** Filesystem root for the backing local-files store. */
  root: string;
  /** Workspace boundary captured when the local MCP server starts. */
  workspaceRoot?: string;
  /** Test seam for the canonical h2a run subprocess bridge. */
  runExecutor?: H2aRunExecutor;
  /**
   * Optional pre-built store. If omitted, the server creates one with
   * `createLocalStore({ root })`. Useful for tests that want to share state
   * with the CLI.
   */
  store?: LocalStore;
  /**
   * Optional SessionRegistry overrides. Disabled `autoHeartbeat` is the
   * sane default for in-process tests; the stdio transport enables it.
   */
  sessions?: SessionRegistryOptions;
  /**
   * Optional NotificationDispatcher overrides. The stdio transport installs
   * the sink; tests can drive `dispatcher.tick()` manually.
   */
  notifications?: {
    intervalMs?: number;
    sink?: NotificationSink;
  };
}

export interface McpServer {
  listTools(): McpToolDescriptor[];
  callTool(name: string, args: Record<string, unknown> | undefined): McpToolResult | McpErrorResult;
  /** Per-server SessionRegistry, exposed for transport-layer shutdown hooks. */
  readonly sessions: SessionRegistry;
  /** Per-server NotificationDispatcher (DEC-052). */
  readonly notifications: NotificationDispatcher;
}

/**
 * Build an in-process MCP server backed by the local-files runtime.
 *
 * This is intentionally NOT a JSON-RPC / stdio transport. It exposes a
 * minimal `{ listTools, callTool }` surface so the same dispatch can be
 * unit-tested today and wrapped in a real MCP transport in a later slice.
 */
export function createMcpServer(options: CreateMcpServerOptions): McpServer {
  const store = options.store ?? createLocalStore({ root: options.root });
  const sessions = new SessionRegistry(options.root, {
    autoHeartbeat: false,
    ...(options.sessions ?? {})
  });
  const notifications = new NotificationDispatcher(
    sessions,
    store,
    options.root,
    options.notifications?.sink,
    options.notifications?.intervalMs ??
      H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS
  );

  function callTool(
    name: string,
    args: Record<string, unknown> | undefined
  ): McpToolResult | McpErrorResult {
    const toolName = name as McpToolName;
    switch (toolName) {
      case "h2a_register_instance":
        return handleRegisterInstance(store, args as never);
      case "h2a_discover_instances":
        return handleDiscoverInstances(store, args as never);
      case "h2a_inbox":
        return handleInbox(store, args as never);
      case "h2a_append_journal":
        return handleAppendJournal(store, args as never);
      case "h2a_open_negotiation":
        return handleOpenNegotiation(store, args as never);
      case "h2a_offer":
        return handleOffer(store, args as never);
      case "h2a_counteroffer":
        return handleCounteroffer(store, args as never);
      case "h2a_sign":
        return handleSign(store, args as never);
      case "h2a_stabilize":
        return handleStabilize(store, args as never);
      case "h2a_attest_comprehension":
        return handleAttestComprehension(store, args as never);
      case "h2a_declare_conflit_interet":
        return handleDeclareConflitInteret(store, args as never);
      case "h2a_conflict_posture":
        return handleConflictPosture(store, args as never);
      case "h2a_escalate":
        return handleEscalate(store, args as never);
      case "h2a_session_open":
        return handleSessionOpen(sessions, args as never);
      case "h2a_session_close":
        return handleSessionClose(sessions, args as never);
      case "h2a_discover_sessions":
        return handleDiscoverSessions(sessions, args as never);
      case "h2a_nhi_report":
        return handleNhiReport(store, args as never);
      case "h2a_nhi_inventory":
        return handleNhiInventory(store, args as never);
      case "h2a_nhi_attest":
        return handleNhiAttest(store, args as never);
      case "h2a_nhi_offboard":
        return handleNhiOffboard(store, args as never);
      case "h2a_nhi_export":
        return handleNhiExport(store, args as never);
      case "h2a_blockage_raise":
        return handleBlockageRaise(store, args as never);
      case "h2a_blockage_list":
        return handleBlockageList(store, args as never);
      case "h2a_blockage_resolve":
        return handleBlockageResolve(store, args as never);
      case "h2a_conductor":
        return handleConductor(store.paths.root, args as never);
      case "h2a_conductor_claim":
        return handleConductorClaim(store.paths.root, args as never);
      case "h2a_conductor_release":
        return handleConductorRelease(store.paths.root, args as never);
      case "h2a_conductor_launch_check":
        return handleConductorLaunchCheck(store.paths.root, args as never);
      case "h2a_conductor_launch":
        return handleConductorLaunch(store.paths.root, args as never);
      case "h2a_loop_create":
        return handleLoopCreate(store.paths.root, args as never);
      case "h2a_loop_join":
        return handleLoopJoin(store.paths.root, args as never);
      case "h2a_loop_report":
        return handleLoopReport(store.paths.root, args as never);
      case "h2a_loop_done":
        return handleLoopDone(store.paths.root, args as never);
      case "h2a_loop_stop":
        return handleLoopStop(store.paths.root, args as never);
      case "h2a_loop_list":
        return handleLoopList(store.paths.root);
      case "h2a_loop_status":
        return handleLoopStatus(store.paths.root, args as never);
      case "h2a_run":
        return handleH2aRun(
          args,
          options.workspaceRoot ?? process.cwd(),
          options.runExecutor ?? executeH2aRun
        );
      default:
        return { error: `unknown tool: ${name}` };
    }
  }

  return {
    listTools: () => H2A_CLI_MCP_TOOL_DESCRIPTORS.slice(),
    callTool,
    sessions,
    notifications
  };
}
