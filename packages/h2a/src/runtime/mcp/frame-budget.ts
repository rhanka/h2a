/**
 * Universal MCP output-emission policy (lot L1).
 *
 * EVERY frame written to a client — a success result, a JSON-RPC error, a parse
 * error, `initialize`, `tools/list`, a preformatted Track result, AND every
 * server-pushed notification — passes through this policy so no single write can
 * exceed the negotiated byte budget. The budget is measured on the EXACT bytes
 * finally emitted: one `JSON.stringify` of the whole message (its inner MCP text
 * is already stringified), a trailing `\n`, then `Buffer.byteLength(..,"utf8")`.
 *
 * Substantiated budget (see build brief): the frozen frame ceiling is 1 MiB.
 * `initialize` (~153 B) and `tools/list` (~30.8 kB) fit with >4x margin; a
 * 200-record discovery page (~130-170 kB) fits with >6x. The full historical
 * discover result (19,185,053 B) exceeds BOTH this ceiling AND Claude's
 * 16,777,216 B cap — so the contract is pagination + chunked read-recovery +
 * an explicit oversize refusal, NEVER a raised cap and NEVER a silent truncation
 * that could cut a UTF-8 codepoint or corrupt JSON.
 */

import type { PayloadRecoveryRef } from "./payload-store.js";

/** Frozen frame ceiling. Substantiated at 1 MiB; never raised toward the 16 MiB cap. */
export const MCP_MAX_FRAME_BYTES = 1_048_576;

/** Technical floor: a budget below this cannot hold a fixed bounded error. */
export const MCP_MIN_FRAME_BYTES = 16 * 1024;

/** Env override (never above the ceiling; never below the floor). */
export const MCP_FRAME_BUDGET_ENV = "H2A_MCP_MAX_FRAME_BYTES";

/** Overflow notice method for an oversize notification (a notice, not a payload). */
export const MCP_OVERFLOW_NOTIFICATION_METHOD = "notifications/h2a/overflow";

/** Max UTF-8 bytes an incoming request `id` string may carry (kept correlatable). */
export const MCP_MAX_REQUEST_ID_BYTES = 128;

export interface FrameBudget {
  readonly maxBytes: number;
}

export interface EncodedFrame {
  /** The single JSON serialization of the whole message (no newline). */
  readonly json: string;
  /** The exact bytes written to the wire, including the trailing `\n`. */
  readonly line: string;
  /** `Buffer.byteLength(line, "utf8")` — the calibration ground truth. */
  readonly bytes: number;
}

export type JsonRpcId = string | number | null;

/**
 * Resolve the effective budget. An explicit/env value is clamped to
 * `[MCP_MIN_FRAME_BYTES, MCP_MAX_FRAME_BYTES]`. A value below the floor is a
 * bootstrap misconfiguration; we clamp UP to the floor so a fixed bounded error
 * can always be emitted rather than crashing the transport.
 */
export function resolveFrameBudget(
  env: Record<string, string | undefined> = process.env
): FrameBudget {
  const raw = env[MCP_FRAME_BUDGET_ENV];
  if (raw !== undefined) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) {
      return { maxBytes: Math.min(MCP_MAX_FRAME_BYTES, Math.max(MCP_MIN_FRAME_BYTES, n)) };
    }
  }
  return { maxBytes: MCP_MAX_FRAME_BYTES };
}

/**
 * Encode a message as the exact bytes finally emitted. A SINGLE `JSON.stringify`
 * — the inner MCP `content[].text` is already a string. Throws only on a cyclic
 * / non-serializable value; the caller converts that into a bounded -32603.
 */
export function encodeFrame(message: unknown): EncodedFrame {
  const json = JSON.stringify(message);
  if (typeof json !== "string") {
    // JSON.stringify(undefined) === undefined: treat as non-serializable.
    throw new TypeError("frame is not JSON-serializable");
  }
  const line = `${json}\n`;
  return { json, line, bytes: Buffer.byteLength(line, "utf8") };
}

/** UTF-8 byte length of a string id. */
function idByteLength(id: string): number {
  return Buffer.byteLength(id, "utf8");
}

/**
 * Validate an incoming JSON-RPC `id` BEFORE execution: a finite JSON number,
 * `null`, or a UTF-8 string ≤128 bytes. Anything else (a huge string, an object,
 * an array) cannot be correlated within budget → the caller answers -32600 with
 * `id:null`. Absent id (a notification) is handled by the caller, not here.
 */
export function isAcceptableRequestId(id: unknown): id is JsonRpcId {
  if (id === null) return true;
  if (typeof id === "number") return Number.isFinite(id);
  if (typeof id === "string") return idByteLength(id) <= MCP_MAX_REQUEST_ID_BYTES;
  return false;
}

export interface JsonRpcErrorFrameObject {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
}

/** -32600 Invalid Request with `id:null` (an unusable incoming id). */
export function buildInvalidRequestId(): JsonRpcErrorFrameObject {
  return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
}

/** -32010 response_too_large: a produced result exceeded the byte budget. */
export function buildResponseTooLargeError(
  id: JsonRpcId,
  info: { budgetBytes: number; actualBytes: number; recovery?: PayloadRecoveryRef | undefined }
): JsonRpcErrorFrameObject {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32010,
      message: "MCP response exceeds the configured byte budget",
      data: {
        code: "response_too_large",
        budgetBytes: info.budgetBytes,
        actualBytes: info.actualBytes,
        ...(info.recovery ? { recovery: info.recovery } : {}),
        retryOriginal: false
      }
    }
  };
}

/** -32603 serialization_failed: the value could not be serialized (e.g. cyclic). */
export function buildSerializationFailedError(id: JsonRpcId): JsonRpcErrorFrameObject {
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32603, message: "Internal error", data: { code: "serialization_failed" } }
  };
}

/**
 * Bound a full JSON-RPC RESPONSE object to the budget. Returns the frame to
 * actually write — the original when it fits, else a fixed bounded -32010 (with
 * a recovery ref when `recover` persisted the intact bytes), else a bounded
 * -32603 when the value cannot even be serialized. The bounded error is small
 * and always fits a valid budget (≥16 KiB).
 */
export function boundResponseFrame(
  id: JsonRpcId,
  responseObject: unknown,
  budget: FrameBudget,
  recover?: (intactJson: string, intactBytes: number) => PayloadRecoveryRef | undefined
): EncodedFrame {
  let encoded: EncodedFrame;
  try {
    encoded = encodeFrame(responseObject);
  } catch {
    return encodeFrame(buildSerializationFailedError(id));
  }
  if (encoded.bytes <= budget.maxBytes) return encoded;
  // Persist the intact original bytes BEFORE emitting the bounded refusal, so
  // recovery via h2a_read_payload returns the real result and never re-runs an
  // effectful tool. A persistence failure simply drops the recovery ref.
  let recovery: PayloadRecoveryRef | undefined;
  if (recover) {
    try {
      recovery = recover(encoded.json, encoded.bytes);
    } catch {
      recovery = undefined;
    }
  }
  const errorFrame = encodeFrame(
    buildResponseTooLargeError(id, {
      budgetBytes: budget.maxBytes,
      actualBytes: encoded.bytes,
      recovery
    })
  );
  // A valid budget (≥16 KiB) always holds this fixed error; the recovery ref is
  // ~200 B, so even with it the frame is well under the floor.
  return errorFrame;
}

export interface CallToolResultShape {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
  [k: string]: unknown;
}

/**
 * Bound an SDK CallToolResult before the SDK serializes it (central / hosted
 * transports). Models the emitted JSON-RPC frame; an oversize result is replaced
 * with a bounded error result carrying a recovery ref, so the SDK never emits a
 * frame over budget. A small reserve covers the id delta and SSE/HTTP framing;
 * the stdio path's universal guard remains the exact backstop there.
 */
export function boundCallToolResult(
  result: CallToolResultShape,
  budget: FrameBudget,
  recover?: (intactJson: string, intactBytes: number) => PayloadRecoveryRef | undefined
): CallToolResultShape {
  const limit = Math.max(MCP_MIN_FRAME_BYTES, budget.maxBytes - 1024);
  let intact: EncodedFrame;
  try {
    intact = encodeFrame({ jsonrpc: "2.0", id: 0, result });
  } catch {
    return {
      content: [{ type: "text", text: JSON.stringify({ code: "serialization_failed" }) }],
      isError: true
    };
  }
  if (intact.bytes <= limit) return result;
  let recovery: PayloadRecoveryRef | undefined;
  if (recover) {
    try {
      recovery = recover(JSON.stringify(result), intact.bytes);
    } catch {
      recovery = undefined;
    }
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          code: "response_too_large",
          message: "MCP response exceeds the configured byte budget",
          budgetBytes: budget.maxBytes,
          actualBytes: intact.bytes,
          ...(recovery ? { recovery } : {}),
          retryOriginal: false
        })
      }
    ],
    isError: true
  };
}

export interface NotificationFrameOutcome {
  /** The frame to write (the original, an overflow notice, or a recovery-unavailable notice). */
  readonly frame: EncodedFrame;
  /**
   * Whether the dispatcher may advance its snapshot: true when the original fit
   * OR the intact bytes were persisted (a recoverable overflow notice went out);
   * false when persistence was impossible (the source event is NOT acknowledged).
   */
  readonly accepted: boolean;
  /** Byte size of the original notification when it overflowed. */
  readonly originalBytes?: number;
}

/** Build the bounded overflow notice for an oversize notification. */
export function buildOverflowNotification(info: {
  originalMethod: string;
  topic?: string | undefined;
  bytes: number;
  recovery: PayloadRecoveryRef;
}): { jsonrpc: "2.0"; method: string; params: Record<string, unknown> } {
  return {
    jsonrpc: "2.0",
    method: MCP_OVERFLOW_NOTIFICATION_METHOD,
    params: {
      code: "notification_too_large",
      originalMethod: info.originalMethod,
      ...(info.topic ? { topic: info.topic } : {}),
      bytes: info.bytes,
      recovery: {
        ref: info.recovery.ref,
        sha256: info.recovery.sha256,
        totalBytes: info.recovery.totalBytes,
        expiresAt: info.recovery.expiresAt
      }
    }
  };
}

/** Build the bounded recovery-unavailable notice (persistence was impossible). */
export function buildRecoveryUnavailableNotification(info: {
  originalMethod: string;
  topic?: string | undefined;
  bytes: number;
  cause: string;
}): { jsonrpc: "2.0"; method: string; params: Record<string, unknown> } {
  return {
    jsonrpc: "2.0",
    method: MCP_OVERFLOW_NOTIFICATION_METHOD,
    params: {
      code: "recovery_unavailable",
      originalMethod: info.originalMethod,
      ...(info.topic ? { topic: info.topic } : {}),
      bytes: info.bytes,
      cause: info.cause,
      delivered: false
    }
  };
}

/**
 * Bound a NOTIFICATION frame. Notifications carry no id, so an overflow yields a
 * bounded NOTICE (never a JSON-RPC response). Returns `undefined` only when the
 * notification itself cannot be serialized (dropped; the caller logs).
 */
export function boundNotificationFrame(
  notification: unknown,
  meta: { method: string; topic?: string | undefined },
  budget: FrameBudget,
  recover?: (intactJson: string, intactBytes: number) => PayloadRecoveryRef | undefined
): NotificationFrameOutcome | undefined {
  let encoded: EncodedFrame;
  try {
    encoded = encodeFrame(notification);
  } catch {
    return undefined;
  }
  if (encoded.bytes <= budget.maxBytes) return { frame: encoded, accepted: true };

  let recovery: PayloadRecoveryRef | undefined;
  let cause = "unknown";
  if (recover) {
    try {
      recovery = recover(encoded.json, encoded.bytes);
    } catch (err) {
      cause = (err as { cause?: string }).cause ?? (err as Error).message ?? "persist_failed";
    }
  }
  if (recovery) {
    return {
      frame: encodeFrame(
        buildOverflowNotification({
          originalMethod: meta.method,
          topic: meta.topic,
          bytes: encoded.bytes,
          recovery
        })
      ),
      accepted: true,
      originalBytes: encoded.bytes
    };
  }
  return {
    frame: encodeFrame(
      buildRecoveryUnavailableNotification({
        originalMethod: meta.method,
        topic: meta.topic,
        bytes: encoded.bytes,
        cause
      })
    ),
    accepted: false,
    originalBytes: encoded.bytes
  };
}
