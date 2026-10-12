import { centralHttpRequest } from "./mcp-central-http.js";
/** Stdio bridge with in-place recovery. This module must stay independent of the CLI/store. */
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { centralMcpMarkerPath, parseCentralMcpEndpoint, readCentralClientMarker, type CentralMcpMarker, type CentralMcpPathsOptions } from "./mcp-central-discovery.js";
import type { CentralMcpAttachment } from "./mcp-central-context.js";

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };
export interface CentralMcpStdioBridgeOptions extends CentralMcpPathsOptions {
  endpoint: string;
  stdin: Readable;
  stdout: Writable;
  signal?: AbortSignal;
  workspaceRoot?: string;
  attachment?: CentralMcpAttachment;
  /** Optional restart orchestration; never switches a live connection to stdio. */
  ensure?: () => Promise<void>;
}

function isRpc(value: unknown): value is Rpc {
  return typeof value === "object" && value !== null && (value as Rpc).jsonrpc === "2.0";
}

function messages(body: string, type: string | null): Rpc[] {
  if (!body.trim()) return [];
  if (type?.includes("text/event-stream")) return body.split(/\r?\n\r?\n/).flatMap(event => {
    const data = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data) return [];
    try {
      const parsed = JSON.parse(data);
      return (Array.isArray(parsed) ? parsed : [parsed]).filter(isRpc);
    } catch { return []; }
  });
  try {
    const parsed = JSON.parse(body);
    return (Array.isArray(parsed) ? parsed : [parsed]).filter(isRpc);
  } catch { return []; }
}

// A lost reply to a mutation has an unknown outcome. Never replay it.
function replayable(message: Rpc): boolean {
  if (message.method === "initialize" || message.method === "tools/list" || message.method === "ping") return true;
  return message.method === "tools/call" && message.params?.name === "h2a_identity_status";
}

/** A central failure returns an RPC error while leaving the host's stdio open. */
export async function bridgeCentralMcpStdio(options: CentralMcpStdioBridgeOptions): Promise<void> {
  let marker = readCentralClientMarker(centralMcpMarkerPath(options));
  if (marker.endpoint !== parseCentralMcpEndpoint(options.endpoint)) throw new Error("central MCP marker does not match requested endpoint");
  let sessionId: string | undefined;
  let initialize: Rpc | undefined;
  let broken = false;
  let recovering: Promise<void> | undefined;
  let stopped = false;
  let active = 0;
  let attached = false;
  let eventController: AbortController | undefined;
  let eventSession: string | undefined;
  let queuedBytes = 0;
  let writer = Promise.resolve();
  const controller = new AbortController();
  const write = (message: Rpc) => {
    if (!isRpc(message)) return;
    const line = JSON.stringify(message) + "\n";
    queuedBytes += Buffer.byteLength(line);
    if (queuedBytes > 8 * 1024 * 1024) { controller.abort(); return; }
    writer = writer.then(() => new Promise<void>((resolve, reject) => {
      options.stdout.write(line, error => error ? reject(error) : resolve());
    })).finally(() => { queuedBytes -= Buffer.byteLength(line); });
    void writer.catch(() => controller.abort());
  };
  const post = async (message: Rpc, current: CentralMcpMarker): Promise<Rpc[]> => {
    const outgoing = message.method === "initialize" ? { ...message, params: {
      protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "h2a-central-shim", version: "2" }, ...message.params
    } } : message;
    const response = await centralHttpRequest(current.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${current.token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "x-h2a-workspace": encodeURIComponent(options.workspaceRoot ?? process.cwd()), ...(options.attachment ? { "x-h2a-attachment": Buffer.from(JSON.stringify(options.attachment)).toString("base64url") } : {}), ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
      body: JSON.stringify(outgoing),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(55_000)])
    });
    if (!response.ok) { await response.text(); throw new Error(`central MCP HTTP ${response.status}`); }
    if (current.generation === marker.generation) {
      sessionId = response.headers.get("mcp-session-id") ?? sessionId;
      if (sessionId) attached = true;
      if (options.attachment && response.headers.get("x-h2a-instance")) options.attachment.expectedInstance = response.headers.get("x-h2a-instance")!;
    }
    if (response.status === 202 || response.status === 204) {
      await response.text();
      return [];
    }
    return messages(await response.text(), response.headers.get("content-type"));
  };
  const notifications = () => {
    if (!sessionId || stopped || eventSession === sessionId) return;
    eventController?.abort();
    eventController = new AbortController();
    eventSession = sessionId;
    const current = marker;
    const currentSession = sessionId;
    const signal = AbortSignal.any([controller.signal, eventController.signal]);
    void (async () => {
      const response = await centralHttpRequest(current.endpoint, { headers: { authorization: `Bearer ${current.token}`, accept: "text/event-stream", "mcp-session-id": currentSession }, signal });
      if (!response.ok) { await response.text(); throw new Error("central notification stream unavailable"); }
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) throw new Error("central notification budget exceeded");
        let match;
        while ((match = /\r?\n\r?\n/.exec(buffer))) {
          const event = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          for (const next of messages(event + "\n\n", "text/event-stream")) if (next.id === undefined && next.method) write(next);
        }
      }
    })().catch(() => { if (!signal.aborted) broken = true; }).finally(() => { if (eventSession === currentSession) eventSession = undefined; });
  };
  const recover = (skipHandshake = false): Promise<void> => {
    recovering ??= (async () => {
      await options.ensure?.();
      marker = readCentralClientMarker(centralMcpMarkerPath(options));
      eventController?.abort();
      eventSession = undefined;
      sessionId = undefined;
      if (options.attachment && attached) options.attachment.resume = true;
      if (initialize && !skipHandshake) {
        await post(initialize, marker);
        await post({ jsonrpc: "2.0", method: "notifications/initialized" }, marker);
      }
      broken = false;
      notifications();
    })().finally(() => { recovering = undefined; });
    return recovering;
  };
  const forward = async (message: Rpc) => {
    const isInit = message.method === "initialize";
    try {
      if (broken) await recover(isInit);
      const replies = await post(message, marker);
      if (isInit) initialize = message;
      for (const next of replies) write(next);
      notifications();
    } catch (error) {
      broken = true;
      if (controller.signal.aborted) return;
      if (replayable(message)) {
        try {
          await recover(isInit);
          const replies = await post(message, marker);
          if (isInit) initialize = message;
          for (const next of replies) write(next);
          notifications();
          return;
        } catch { /* surface unavailable; the next call can retry */ }
      }
      if (message.id !== undefined) write({ jsonrpc: "2.0", id: message.id, error: { code: -32011, message: (error as Error).message, data: { code: replayable(message) ? "central_unavailable" : "outcome_unknown", retrySafe: replayable(message) } } });
    }
  };
  const reader = createInterface({ input: options.stdin, crlfDelay: Infinity });
  let leasing = false;
  const lease = setInterval(() => {
    if (!sessionId || stopped || leasing) return;
    leasing = true;
    void (async () => {
      if (broken) { await recover(); return; }
      const response = await centralHttpRequest(new URL(`/_h2a-central/lease/${sessionId}`, marker.endpoint), {
        headers: { authorization: `Bearer ${marker.token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)])
      });
      if (!response.ok) { await response.text(); throw new Error("central attachment lease unavailable"); }
      const status = await response.json() as { state?: string; instance?: string };
      if (options.attachment && status.state === "identity_ready" && status.instance) options.attachment.expectedInstance = status.instance;
      notifications();
    })().catch(() => { broken = true; }).finally(() => { leasing = false; });
  }, 5000);
  lease.unref();
  const stop = () => { if (stopped) return; stopped = true; controller.abort(); reader.close(); options.stdin.pause(); };
  const onAbort = () => stop();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) stop();
  reader.on("line", line => {
    if (stopped) return;
    let message: Rpc;
    try { message = JSON.parse(line) as Rpc; } catch { write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); return; }
    if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0" || (message.method !== undefined && typeof message.method !== "string")) {
      write({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } });
      return;
    }
    if (active >= 32 || Buffer.byteLength(line) > 4 * 1024 * 1024) {
      if (message.id !== undefined) write({ jsonrpc: "2.0", id: message.id, error: { code: -32011, message: "central bridge request budget exceeded" } });
      return;
    }
    active++;
    void forward(message).finally(() => { active--; });
  });
  await new Promise<void>(resolve => { reader.once("close", resolve); if (stopped) resolve(); });
  stop();
  clearInterval(lease);
  eventController?.abort();
  options.signal?.removeEventListener("abort", onAbort);
  await writer.catch(() => {});
  if (sessionId) {
    try { const response = await centralHttpRequest(marker.endpoint, { method: "DELETE", headers: { authorization: `Bearer ${marker.token}`, "mcp-session-id": sessionId }, signal: AbortSignal.timeout(1000) }); await response.text(); } catch { /* lease expiry handles a dead owner */ }
  }
}
