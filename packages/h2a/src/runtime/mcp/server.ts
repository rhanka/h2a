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
  handleSend,
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
import {
  TRACK_READ_TOOL_DESCRIPTORS,
  callTrackReadTool
} from "@sentropic/track/mcp";

import { H2A_SESSION_DEFAULT_HEARTBEAT_INTERVAL_MS } from "@sentropic/h2a";
import {
  executeH2aRun,
  handleH2aRun,
  recordMcpRunDelegation,
  type H2aRunDelegation,
  type H2aRunExecutor
} from "./agent-launch.js";
import type { H2ASendSigner, H2AMessageBackend } from "../send.js";
import type { H2aClusterMeshMessaging } from "../cluster-mesh-messaging.js";
import { createDiscoveryPager, type DiscoveryPager } from "./discovery-pagination.js";
import { createPayloadStore, type PayloadStore } from "./payload-store.js";
import { resolveFrameBudget, type FrameBudget } from "./frame-budget.js";
import { PAYLOAD_MAX_READ_BYTES } from "./payload-store.js";

export interface CreateMcpServerOptions {
  /** Filesystem root for the backing local-files store. */
  root: string;
  /** Workspace boundary captured when the local MCP server starts. */
  workspaceRoot?: string;
  /** Test seam for the canonical h2a run subprocess bridge. */
  runExecutor?: H2aRunExecutor;
  /** Trusted context of this MCP sidecar, read only when a launch occurs. */
  delegationContext?: () => H2aRunDelegation | undefined;
  /**
   * Optional pre-built store. If omitted, the server creates one with
   * `createLocalStore({ root })`. Useful for tests that want to share state
   * with the CLI.
   */
  store?: LocalStore;
  /** Trusted local sidecar identity used by h2a_send; never supplied by tool args. */
  sendContext?: H2ASendSigner;
  messageBackend?: H2AMessageBackend;
  clusterMesh?: H2aClusterMeshMessaging;
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
  /** L1: frame budget override (tests). Defaults to `resolveFrameBudget()`. */
  frameBudget?: FrameBudget;
}

/** L1: optional per-call transport context (reserved for exact-id budgeting). */
export interface McpCallContext {
  readonly budget?: FrameBudget;
}

export interface McpServer {
  listTools(): McpToolDescriptor[];
  callTool(
    name: string,
    args: Record<string, unknown> | undefined,
    context?: McpCallContext
  ): McpToolResult | McpErrorResult | McpTransportResult | Promise<McpToolResult | McpErrorResult | McpTransportResult>;
  /** Per-server SessionRegistry, exposed for transport-layer shutdown hooks. */
  readonly sessions: SessionRegistry;
  /** Per-server NotificationDispatcher (DEC-052). */
  readonly notifications: NotificationDispatcher;
  /** L1: per-root durable store for oversize output recovery. */
  readonly payloadStore: PayloadStore;
  /** L1: the frame budget bounding every emission of this server. */
  readonly frameBudget: FrameBudget;
}

/** A tool result already formatted for the MCP transport (used by Track reads). */
export interface McpTransportResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function isMcpTransportResult(value: unknown): value is McpTransportResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "content" in value &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

const TRACK_READ_TOOL_NAMES = new Set<string>(TRACK_READ_TOOL_DESCRIPTORS.map((tool) => tool.name));

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

  // L1: per-root recovery store + per-server paginating discovery pager. The
  // pager carries a random per-instance HMAC secret + epoch, so a cursor from a
  // restarted server fails `cursor_stale` (never a silent first page).
  const frameBudget = options.frameBudget ?? resolveFrameBudget();
  const payloadStore = createPayloadStore(options.root);
  const discoveryPager: DiscoveryPager = createDiscoveryPager(store, {
    budget: frameBudget,
    payloadStore
  });

  function callTool(
    name: string,
    args: Record<string, unknown> | undefined,
    _context?: McpCallContext
  ): ReturnType<McpServer["callTool"]> {
    if (TRACK_READ_TOOL_NAMES.has(name)) {
      try {
        const result = callTrackReadTool(
          { cwd: options.workspaceRoot ?? process.cwd() },
          name as (typeof TRACK_READ_TOOL_DESCRIPTORS)[number]["name"],
          args ?? {}
        );
        return {
          content: [
            { type: "text", text: result.text },
            ...(result.hint !== undefined ? [{ type: "text" as const, text: result.hint }] : [])
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error)
            }
          ],
          isError: true
        };
      }
    }
    const toolName = name as McpToolName;
    switch (toolName) {
      case "h2a_register_instance":
        return handleRegisterInstance(store, args as never);
      case "h2a_discover_instances":
        return handleDiscoverInstances(store, args as never, discoveryPager);
      case "h2a_read_payload":
        return handleReadPayload(payloadStore, args, frameBudget);
      case "h2a_inbox":
        return handleInbox(store, args as never);
      case "h2a_send":
        return handleSend(store, options.sendContext, args as never, {
          backend: options.messageBackend, clusterMesh: options.clusterMesh
        });
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
        return handleDiscoverSessions(sessions, args as never, store.listInstances());
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
        {
          const delegation = options.delegationContext?.();
          const result = handleH2aRun(
          args,
          options.workspaceRoot ?? process.cwd(),
          options.runExecutor ?? executeH2aRun,
            delegation,
          );
          recordMcpRunDelegation(store.paths.root, result, delegation);
          return result;
        }
      default:
        return { error: `unknown tool: ${name}` };
    }
  }

  return {
    listTools: () => H2A_CLI_MCP_TOOL_DESCRIPTORS.slice(),
    callTool,
    sessions,
    notifications,
    payloadStore,
    frameBudget
  };
}

/**
 * L1 `h2a_read_payload`: chunked, read-only recovery of an oversize output's
 * INTACT bytes (base64), so "recover" never points at another too-big response.
 * Tenant-confined by the per-root store; needs no signing identity. It never
 * re-runs an effectful tool — it returns already-produced bytes.
 */
function handleReadPayload(
  payloadStore: PayloadStore,
  args: Record<string, unknown> | undefined,
  budget: FrameBudget
): McpTransportResult {
  const toolError = (code: string, message: string): McpTransportResult => ({
    content: [{ type: "text", text: JSON.stringify({ code, message }) }],
    isError: true
  });
  const ref = args?.ref;
  if (typeof ref !== "string" || ref.length === 0) {
    return toolError("payload_not_found", "ref is required");
  }
  const rawOffset = args?.offset;
  if (rawOffset !== undefined && (typeof rawOffset !== "number" || !Number.isInteger(rawOffset) || rawOffset < 0)) {
    return toolError("invalid_offset", "offset must be a non-negative integer");
  }
  const rawMax = args?.maxBytes;
  if (
    rawMax !== undefined &&
    (typeof rawMax !== "number" || !Number.isInteger(rawMax) || rawMax < 1 || rawMax > PAYLOAD_MAX_READ_BYTES)
  ) {
    return toolError("invalid_offset", "maxBytes must be an integer between 1 and 65536");
  }
  const offset = typeof rawOffset === "number" ? rawOffset : 0;
  const requested = typeof rawMax === "number" ? rawMax : PAYLOAD_MAX_READ_BYTES;
  // maxBytes is a MAXIMUM: reduce the chunk further so the FINAL serialized frame
  // (base64 ≈ 4/3 expansion + the JSON envelope, double-encoded into content
  // text) stays within the budget — a recovery read must never itself overflow.
  const budgetChunk = Math.max(1, Math.floor((budget.maxBytes - 4096) * 3 / 4));
  const maxBytes = Math.max(1, Math.min(requested, budgetChunk));
  const result = payloadStore.readPayload(ref, offset, maxBytes);
  if ("error" in result) {
    return toolError(result.error, `payload read failed: ${result.error}`);
  }
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}
