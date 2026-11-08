/**
 * The minimal MCP client of the publish path, on the sentropic MCP resource server (Streamable
 * HTTP, JSON-RPC over POST), with the stored bearer token: `tools/list` and `tools/call`.
 *
 * The token is only ever sent to the server it is bound to (assertServerBound). A session is
 * initialize → notifications/initialized, then any number of calls; a server that does not run
 * sessions (the sentropic registry dispatch answers statelessly) is served the same way,
 * because an initialize that is not answered with a result simply leaves no session id.
 *
 * WORKSPACE RULE: the sentropic workspace travels as `params.workspaceRef`, next to `name` and
 * `arguments`. Without it the server falls back to a default workspace of its own choosing (the
 * most recent one, with no tenant or role filter), so a publish could land elsewhere or be
 * refused: a tools/call of a workspace-bound tool is NEVER sent without a workspaceRef. Host
 * tools (workspaces_list) bind no workspace and the server ignores a workspaceRef there; the
 * caller still passes the bound one when there is one.
 *
 * Errors carry the HTTP status, the RFC 6750 `error` code of the challenge, or a JSON-RPC
 * error code — never a body, and never a server message that is not a plain code.
 */

import { assertServerBound, type SentropicAuthToken } from "./auth-token.js";
import { readBoundedText, sendRequest, type FetchLike } from "./oauth-pkce.js";
import {
  SentropicLoginRequiredError,
  SentropicPublishError,
  SentropicWorkspaceAccessError,
  safeErrorCode,
} from "./publish-errors.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MAX_PAGES = 10;

/** The host tool that lists the workspaces the account can read (sentropic train 1b). */
export const WORKSPACES_LIST_TOOL = "workspaces_list";

/** Tools that bind no workspace; every other tool acts on the workspace of `workspaceRef`. */
export const HOST_TOOLS: ReadonlySet<string> = new Set([WORKSPACES_LIST_TOOL]);

/** JSON-RPC 2.0 Internal error. */
export const JSONRPC_INTERNAL_ERROR = -32603;

/** A failed MCP request that is not a refusal of the credential: its HTTP status and JSON-RPC code. */
export class McpRequestError extends SentropicPublishError {
  constructor(message: string, readonly httpStatus: number, readonly rpcCode: number | undefined) {
    super("mcp", message);
    this.name = "McpRequestError";
  }
}

export interface McpConnectOptions {
  readonly fetch: FetchLike;
  readonly mcpUrl: string;
  readonly token: SentropicAuthToken;
  readonly clientVersion: string;
}

export interface McpToolCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  /** The bound sentropic workspace. Required for every tool outside HOST_TOOLS. */
  readonly workspaceRef: string | undefined;
}

export interface McpToolResult {
  /** The tool ran and reported a failure of its own (result.isError). */
  readonly isError: boolean;
  /** The JSON object of the first text content, when there is one. */
  readonly payload: Record<string, unknown> | undefined;
}

export interface McpSession {
  /** The RAW tool names (compare them as is; print them through printableToolName). */
  listTools(workspaceRef: string | undefined): Promise<string[]>;
  callTool(call: McpToolCall): Promise<McpToolResult>;
}

interface SessionState {
  id?: string;
  protocolVersion?: string;
}

interface RpcAnswer {
  readonly status: number;
  readonly sessionId: string | undefined;
  readonly message: Record<string, unknown> | undefined;
  readonly challenge: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The RFC 6750 `error="…"` of a WWW-Authenticate challenge, as a safe code. */
function challengeCode(header: string | null): string | undefined {
  if (!header) return undefined;
  const match = /error="([^"]*)"/u.exec(header);
  return match ? safeErrorCode(match[1]) : undefined;
}

function parseMessages(text: string, contentType: string): unknown[] {
  if (contentType.includes("text/event-stream")) {
    const out: unknown[] = [];
    for (const event of text.split(/\r?\n\r?\n/u)) {
      const data = event
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /u, ""))
        .join("\n");
      if (!data) continue;
      try {
        out.push(JSON.parse(data));
      } catch {
        /* an unreadable event is skipped; its bytes are never quoted */
      }
    }
    return out;
  }
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value : [value];
  } catch {
    return [];
  }
}

async function rpc(opts: McpConnectOptions, body: Record<string, unknown>, session: SessionState): Promise<RpcAnswer> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${opts.token.accessToken}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (session.id) headers["mcp-session-id"] = session.id;
  if (session.protocolVersion) headers["mcp-protocol-version"] = session.protocolVersion;
  const res = await sendRequest(
    opts.fetch,
    opts.mcpUrl,
    { method: "POST", headers, body: JSON.stringify(body) },
    "MCP resource server",
    "mcp",
  );
  const text = (await readBoundedText(res)) ?? "";
  const messages = parseMessages(text, res.headers.get("content-type") ?? "");
  const message = messages.find((m): m is Record<string, unknown> => isRecord(m) && m.id === body.id);
  return {
    status: res.status,
    sessionId: res.headers.get("mcp-session-id") ?? undefined,
    message,
    challenge: challengeCode(res.headers.get("www-authenticate")),
  };
}

function rpcErrorCode(message: Record<string, unknown> | undefined): string | undefined {
  const error = message?.error;
  if (!isRecord(error)) return undefined;
  if (typeof error.message === "string") {
    const code = safeErrorCode(error.message);
    if (code !== "unrecognized") return code;
  }
  return typeof error.code === "number" ? `JSON-RPC ${error.code}` : "unrecognized";
}

/**
 * A refused answer as a typed error. `workspaceRef` is the workspace the request was about:
 * an access_denied then means this account cannot use THAT workspace now.
 */
function refusal(answer: RpcAnswer, workspaceRef: string | undefined, step: string): Error {
  if (answer.status === 401) {
    return new SentropicLoginRequiredError(
      `the sentropic resource server rejected the token (${answer.challenge ?? rpcErrorCode(answer.message) ?? "invalid_token"})`,
    );
  }
  const code = answer.challenge ?? rpcErrorCode(answer.message) ?? `HTTP ${answer.status}`;
  if (answer.status === 403) {
    if (code === "insufficient_scope") {
      return new SentropicLoginRequiredError(
        "the token lacks a scope the resource server requires (insufficient_scope); the h2a-cli client must be allowed the MCP scopes",
      );
    }
    if (code === "access_denied" && workspaceRef !== undefined) return new SentropicWorkspaceAccessError(workspaceRef, "access_denied");
    if (code === "access_denied") {
      return new SentropicLoginRequiredError(
        "the resource server refused this sentropic credential (access_denied): it may be revoked, or carry no tenant " +
          "(an account in several organizations signs in with `--tenant <id>`)",
      );
    }
    return new McpRequestError(`the resource server refused ${step} (${code})`, answer.status, rpcCodeOf(answer.message));
  }
  return new McpRequestError(`${step} failed on the resource server (${code})`, answer.status, rpcCodeOf(answer.message));
}

function rpcCodeOf(message: Record<string, unknown> | undefined): number | undefined {
  const error = message?.error;
  return isRecord(error) && typeof error.code === "number" ? error.code : undefined;
}

/** A tool name fit for a terminal: no control or escape characters. */
export function printableToolName(name: string): string {
  return /^[A-Za-z0-9_.:/-]{1,128}$/u.test(name) ? name : "<unprintable tool name>";
}

/** The JSON object of the first text content of a tools/call result. Never throws. */
function textPayload(content: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") continue;
    try {
      const value: unknown = JSON.parse(item.text);
      return isRecord(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** initialize + notifications/initialized with the stored token; then list and call tools. */
export async function openMcpSession(opts: McpConnectOptions): Promise<McpSession> {
  assertServerBound(opts.token, opts.mcpUrl);
  const session: SessionState = {};
  let nextId = 1;

  const init = await rpc(opts, {
    jsonrpc: "2.0",
    id: nextId++,
    method: "initialize",
    params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "h2a", version: opts.clientVersion } },
  }, session);
  if (init.status === 401 || init.status === 403) throw refusal(init, undefined, "initialize");
  const result = init.message?.result;
  if (init.status >= 200 && init.status < 300 && isRecord(result)) {
    if (init.sessionId) session.id = init.sessionId;
    if (typeof result.protocolVersion === "string") session.protocolVersion = result.protocolVersion;
    const ack = await rpc(opts, { jsonrpc: "2.0", method: "notifications/initialized" }, session);
    if (ack.status === 401 || ack.status === 403) throw refusal(ack, undefined, "initialize");
  }

  return {
    async listTools(workspaceRef) {
      const names: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const params: Record<string, unknown> = {};
        if (workspaceRef !== undefined) params.workspaceRef = workspaceRef;
        if (cursor !== undefined) params.cursor = cursor;
        const answer = await rpc(opts, { jsonrpc: "2.0", id: nextId++, method: "tools/list", params }, session);
        if (answer.status < 200 || answer.status >= 300 || answer.message?.error !== undefined) {
          throw refusal(answer, workspaceRef, "tools/list");
        }
        const listed = answer.message?.result;
        if (!isRecord(listed) || !Array.isArray(listed.tools)) {
          throw new SentropicPublishError("mcp", "tools/list returned no tool list");
        }
        for (const tool of listed.tools) {
          if (isRecord(tool) && typeof tool.name === "string") names.push(tool.name);
        }
        cursor = typeof listed.nextCursor === "string" && listed.nextCursor ? listed.nextCursor : undefined;
        if (cursor === undefined) break;
      }
      return names;
    },

    async callTool(call) {
      const host = HOST_TOOLS.has(call.name);
      if (!host && call.workspaceRef === undefined) {
        throw new SentropicPublishError(
          "binding",
          `${printableToolName(call.name)} acts on a workspace and this workspace is not bound: run \`h2a sentropic bind <workspace-id>\` ` +
            "first; nothing was sent",
        );
      }
      // The workspace travels in params, next to name and arguments.
      const params: Record<string, unknown> = { name: call.name, arguments: call.arguments };
      if (call.workspaceRef !== undefined) params.workspaceRef = call.workspaceRef;
      const step = printableToolName(call.name);
      const answer = await rpc(opts, { jsonrpc: "2.0", id: nextId++, method: "tools/call", params }, session);
      if (answer.status < 200 || answer.status >= 300 || answer.message?.error !== undefined) {
        throw refusal(answer, host ? undefined : call.workspaceRef, step);
      }
      const result = answer.message?.result;
      if (!isRecord(result)) throw new SentropicPublishError("mcp", `${step} returned no result`);
      const payload = textPayload(result.content);
      const isError = result.isError === true;
      // A revocation between bind and call: the tool itself answers access_denied.
      if (isError && !host && call.workspaceRef !== undefined && safeErrorCode(payload?.error) === "access_denied") {
        throw new SentropicWorkspaceAccessError(call.workspaceRef, "access_denied");
      }
      return { isError, payload };
    },
  };
}
