/**
 * The minimal MCP client that proves the publish path: `tools/list` on the sentropic MCP
 * resource server (Streamable HTTP, JSON-RPC over POST), with the stored bearer token.
 *
 * The token is only ever sent to the server it is bound to (assertServerBound). The sequence is
 * initialize → notifications/initialized → tools/list; a server that does not run sessions
 * (the sentropic registry dispatch answers tools/list statelessly) is served the same way,
 * because an initialize that is not answered with a result simply leaves no session id. The
 * sentropic workspace travels as `params.workspaceRef`, which the resource server checks
 * against the caller's membership.
 *
 * Errors carry the HTTP status, the RFC 6750 `error` code of the challenge, or a JSON-RPC
 * error code — never a body, and never a server message that is not a plain code.
 */

import { assertServerBound, type SentropicAuthToken } from "./auth-token.js";
import { readBoundedText, sendRequest, type FetchLike } from "./oauth-pkce.js";
import { SentropicLoginRequiredError, SentropicPublishError, safeErrorCode } from "./publish-errors.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MAX_PAGES = 10;

export interface McpCallOptions {
  readonly fetch: FetchLike;
  readonly mcpUrl: string;
  readonly token: SentropicAuthToken;
  /** The bound sentropic workspace; undefined lets the server use the account's default. */
  readonly workspaceId?: string;
  readonly clientVersion: string;
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

async function rpc(
  opts: McpCallOptions,
  body: Record<string, unknown>,
  session: { id?: string; protocolVersion?: string },
): Promise<RpcAnswer> {
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

function refusal(answer: RpcAnswer, workspaceId: string | undefined, step: string): Error {
  if (answer.status === 401) {
    return new SentropicLoginRequiredError(
      `the sentropic resource server rejected the token (${answer.challenge ?? rpcErrorCode(answer.message) ?? "invalid_token"})`,
    );
  }
  const code = answer.challenge ?? rpcErrorCode(answer.message) ?? `HTTP ${answer.status}`;
  if (answer.status === 403) {
    if (code === "insufficient_scope") {
      return new SentropicLoginRequiredError(
        "the token lacks a scope the resource server requires (insufficient_scope); the client must be allowed the publish scopes",
      );
    }
    return new SentropicPublishError(
      "mcp",
      `the resource server refused ${workspaceId ? `workspace ${workspaceId}` : "the request"} (${code}); check the binding (\`h2a sentropic bind\`) and the account's membership`,
    );
  }
  return new SentropicPublishError("mcp", `${step} failed on the resource server (${code})`);
}

/** A tool name fit for a terminal: no control or escape characters. */
function printableToolName(name: string): string {
  return /^[A-Za-z0-9_.:/-]{1,128}$/u.test(name) ? name : "<unprintable tool name>";
}

/** `tools/list` with the stored token; returns the tool names (printable form). */
export async function mcpListTools(opts: McpCallOptions): Promise<string[]> {
  assertServerBound(opts.token, opts.mcpUrl);
  const session: { id?: string; protocolVersion?: string } = {};

  const init = await rpc(opts, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "h2a", version: opts.clientVersion } },
  }, session);
  if (init.status === 401 || init.status === 403) throw refusal(init, opts.workspaceId, "initialize");
  const result = init.message?.result;
  if (init.status >= 200 && init.status < 300 && isRecord(result)) {
    if (init.sessionId) session.id = init.sessionId;
    if (typeof result.protocolVersion === "string") session.protocolVersion = result.protocolVersion;
    const ack = await rpc(opts, { jsonrpc: "2.0", method: "notifications/initialized" }, session);
    if (ack.status === 401 || ack.status === 403) throw refusal(ack, opts.workspaceId, "initialize");
  }

  const names: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, unknown> = {};
    if (opts.workspaceId !== undefined) params.workspaceRef = opts.workspaceId;
    if (cursor !== undefined) params.cursor = cursor;
    const answer = await rpc(opts, { jsonrpc: "2.0", id: 2 + page, method: "tools/list", params }, session);
    if (answer.status < 200 || answer.status >= 300) throw refusal(answer, opts.workspaceId, "tools/list");
    if (answer.message?.error !== undefined) throw refusal(answer, opts.workspaceId, "tools/list");
    const listed = answer.message?.result;
    if (!isRecord(listed) || !Array.isArray(listed.tools)) {
      throw new SentropicPublishError("mcp", "tools/list returned no tool list");
    }
    for (const tool of listed.tools) {
      if (isRecord(tool) && typeof tool.name === "string") names.push(printableToolName(tool.name));
    }
    cursor = typeof listed.nextCursor === "string" && listed.nextCursor ? listed.nextCursor : undefined;
    if (cursor === undefined) break;
  }
  return names;
}
