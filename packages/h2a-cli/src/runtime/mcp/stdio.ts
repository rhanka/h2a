import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import { createMcpServer, type McpServer } from "./server.js";

/**
 * Minimal subset of the JSON-RPC 2.0 spec we accept on the wire. The spec
 * allows `id` to be a string, number, or null; we keep it loose since we
 * only echo it back.
 */
interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: unknown;
  result: unknown;
}

interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: unknown;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export interface RunMcpStdioOptions {
  /** Filesystem root for the local-files store. */
  root: string;
  /** Readable stream of newline-delimited JSON-RPC requests. */
  stdin: Readable;
  /** Writable stream for newline-delimited JSON-RPC responses. */
  stdout: Writable;
  /** Writable stream for diagnostics (never used for protocol traffic). */
  stderr: Writable;
}

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_NAME = "@sentropic/h2a-cli";
const SERVER_VERSION = "0.1.1";

function writeResponse(stdout: Writable, response: JsonRpcResponse): void {
  stdout.write(`${JSON.stringify(response)}\n`);
}

function errorResponse(
  id: unknown,
  code: number,
  message: string,
  data?: unknown
): JsonRpcErrorResponse {
  const error: JsonRpcErrorResponse["error"] = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

function successResponse(id: unknown, result: unknown): JsonRpcSuccessResponse {
  return { jsonrpc: "2.0", id, result };
}

function handleMethod(
  server: McpServer,
  method: string,
  params: unknown
): unknown {
  if (method === "initialize") {
    return {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      capabilities: { tools: {} }
    };
  }
  if (method === "tools/list") {
    return { tools: server.listTools() };
  }
  if (method === "tools/call") {
    const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
    const name = typeof p.name === "string" ? p.name : "";
    const args =
      p.arguments && typeof p.arguments === "object"
        ? (p.arguments as Record<string, unknown>)
        : {};
    const result = server.callTool(name, args);
    const isError = Boolean(
      result && typeof result === "object" && "error" in (result as object)
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError
    };
  }
  // Sentinel: the caller will map this to JSON-RPC -32601.
  throw new MethodNotFoundError(method);
}

class MethodNotFoundError extends Error {
  constructor(public readonly method: string) {
    super(`Method not found: ${method}`);
    this.name = "MethodNotFoundError";
  }
}

/**
 * Run the MCP server over a JSON-RPC 2.0 newline-delimited stdio transport.
 *
 * Reads requests from `stdin`, writes responses to `stdout` (one per line),
 * uses `stderr` for diagnostics only. Resolves once `stdin` reaches EOF.
 * A malformed line or a tool-dispatch throw never crashes the loop: each
 * is reported as a structured JSON-RPC error response.
 */
export function runMcpStdio(options: RunMcpStdioOptions): Promise<void> {
  const { root, stdin, stdout, stderr } = options;
  // The stdio transport carries live agent sessions; enable autoHeartbeat so
  // the presence file stays fresh while this mcp-serve process is alive.
  const server = createMcpServer({
    root,
    sessions: { autoHeartbeat: true }
  });

  const rl = createInterface({ input: stdin, crlfDelay: Infinity });
  (stdin as Readable & { ref?: () => void }).ref?.();
  stdin.resume();

  function shutdown(): void {
    try {
      server.sessions.closeAll("closed");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stderr.write(`h2a mcp-serve: shutdown error: ${message}\n`);
    }
  }

  return new Promise<void>((resolve, reject) => {
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;

      let request: JsonRpcRequest;
      try {
        request = JSON.parse(trimmed) as JsonRpcRequest;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeResponse(stdout, errorResponse(null, -32700, "Parse error", message));
        return;
      }

      if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
        writeResponse(
          stdout,
          errorResponse(request.id ?? null, -32600, "Invalid Request")
        );
        return;
      }

      try {
        const result = handleMethod(server, request.method, request.params);
        writeResponse(stdout, successResponse(request.id ?? null, result));
      } catch (err) {
        if (err instanceof MethodNotFoundError) {
          writeResponse(
            stdout,
            errorResponse(
              request.id ?? null,
              -32601,
              `Method not found: ${err.method}`
            )
          );
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        stderr.write(`h2a mcp-serve: internal error: ${message}\n`);
        writeResponse(
          stdout,
          errorResponse(request.id ?? null, -32603, `Internal error: ${message}`)
        );
      }
    });

    rl.on("close", () => {
      shutdown();
      resolve();
    });
    rl.on("error", (err) => {
      shutdown();
      reject(err);
    });
  });
}
