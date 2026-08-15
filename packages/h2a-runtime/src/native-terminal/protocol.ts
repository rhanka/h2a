import type {
  NativeTerminalControllerLease,
  NativeTerminalCreateOptions,
} from "./host.js";

export const NATIVE_TERMINAL_PROTOCOL_VERSION = 1 as const;
export const NATIVE_TERMINAL_MAX_REPLAY_BYTES_PER_SESSION = 4 * 1024 * 1024;
// JSON escaping can expand one replay byte to six wire bytes (for example NUL).
export const NATIVE_TERMINAL_MAX_FRAME_BYTES = 32 * 1024 * 1024;
export const NATIVE_TERMINAL_DEFAULT_MAX_SESSIONS = 256;
export const NATIVE_TERMINAL_MAX_SESSIONS = 256;
export const NATIVE_TERMINAL_DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
/**
 * Interactive replay reads may legitimately serialize a multi-megabyte
 * scrollback. Keep the short generic control timeout above, but give the
 * terminal-follow path its own budget before it reconnects and resumes.
 */
export const NATIVE_TERMINAL_INTERACTIVE_READ_TIMEOUT_MS = 30_000;
export const NATIVE_TERMINAL_HEALTH_TIMEOUT_MS = 1_000;
export const NATIVE_TERMINAL_MAX_ERROR_MESSAGE_CHARS = 1_024;
export const NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS = 128;
export const NATIVE_TERMINAL_MAX_CONNECTIONS = 64;
export const NATIVE_TERMINAL_MAX_PENDING_RESPONSES_PER_CONNECTION = 64;
export const NATIVE_TERMINAL_MAX_PENDING_RESPONSE_BYTES_PER_CONNECTION =
  NATIVE_TERMINAL_MAX_FRAME_BYTES;
export const NATIVE_TERMINAL_MAX_PENDING_RESPONSE_BYTES_TOTAL =
  2 * NATIVE_TERMINAL_MAX_FRAME_BYTES;

export const NATIVE_TERMINAL_STOP_SIGNALS = [
  "SIGHUP",
  "SIGINT",
  "SIGTERM",
  "SIGKILL",
] as const;
export type NativeTerminalStopSignal =
  (typeof NATIVE_TERMINAL_STOP_SIGNALS)[number];

export function isNativeTerminalStopSignal(
  value: unknown,
): value is NativeTerminalStopSignal {
  return (
    typeof value === "string" &&
    (NATIVE_TERMINAL_STOP_SIGNALS as readonly string[]).includes(value)
  );
}

export type NativeTerminalOperation =
  | "ping"
  | "create"
  | "list"
  | "state"
  | "read-output"
  | "attach-observer"
  | "acquire-controller"
  | "release-controller"
  | "write"
  | "resize"
  | "stop";

export type NativeTerminalRequest = Readonly<{
  version: typeof NATIVE_TERMINAL_PROTOCOL_VERSION;
  id: string;
  operation: NativeTerminalOperation;
  params?: Readonly<Record<string, unknown>>;
}>;

export type NativeTerminalSuccessResponse = Readonly<{
  version: typeof NATIVE_TERMINAL_PROTOCOL_VERSION;
  id: string;
  ok: true;
  result: unknown;
}>;

export type NativeTerminalErrorResponse = Readonly<{
  version: typeof NATIVE_TERMINAL_PROTOCOL_VERSION;
  id: string;
  ok: false;
  error: Readonly<{
    code: "invalid-request" | "operation-failed";
    message: string;
  }>;
}>;

export type NativeTerminalResponse =
  | NativeTerminalSuccessResponse
  | NativeTerminalErrorResponse;

export type NativeTerminalPing = Readonly<{
  generation: string;
  hostPid: number;
  protocolVersion: typeof NATIVE_TERMINAL_PROTOCOL_VERSION;
}>;

export type NativeTerminalCreateParams = NativeTerminalCreateOptions;
export type NativeTerminalLeaseParams = Readonly<{
  lease: NativeTerminalControllerLease;
}>;

export class NativeTerminalRemoteError extends Error {
  readonly code: NativeTerminalErrorResponse["error"]["code"];

  constructor(error: NativeTerminalErrorResponse["error"]) {
    super(error.message);
    this.name = "NativeTerminalRemoteError";
    this.code = error.code;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseNativeTerminalResponse(
  value: unknown,
): NativeTerminalResponse {
  if (!isRecord(value)) throw new TypeError("response must be an object");
  if (value.version !== NATIVE_TERMINAL_PROTOCOL_VERSION) {
    throw new TypeError("unsupported terminal protocol version");
  }
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.length > NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS
  ) {
    throw new TypeError(
      `response id must be a non-empty string of at most ${NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS} characters`,
    );
  }
  if (value.ok === true) {
    if (!Object.prototype.hasOwnProperty.call(value, "result")) {
      throw new TypeError("successful response must include a result");
    }
    return value as NativeTerminalSuccessResponse;
  }
  if (value.ok !== false) {
    throw new TypeError("response ok must be a boolean");
  }
  if (!isRecord(value.error)) {
    throw new TypeError("error response must include an error object");
  }
  if (
    value.error.code !== "invalid-request" &&
    value.error.code !== "operation-failed"
  ) {
    throw new TypeError("terminal response error code is invalid");
  }
  if (
    typeof value.error.message !== "string" ||
    value.error.message.length === 0 ||
    value.error.message.length > NATIVE_TERMINAL_MAX_ERROR_MESSAGE_CHARS
  ) {
    throw new TypeError(
      `terminal response error message must contain 1-${NATIVE_TERMINAL_MAX_ERROR_MESSAGE_CHARS} characters`,
    );
  }
  return value as NativeTerminalErrorResponse;
}

export function parseNativeTerminalRequest(value: unknown): NativeTerminalRequest {
  if (!isRecord(value)) throw new TypeError("request must be an object");
  if (value.version !== NATIVE_TERMINAL_PROTOCOL_VERSION) {
    throw new TypeError("unsupported terminal protocol version");
  }
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.length > NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS
  ) {
    throw new TypeError(
      `request id must be a non-empty string of at most ${NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS} characters`,
    );
  }
  const operations: ReadonlySet<string> = new Set<NativeTerminalOperation>([
    "ping",
    "create",
    "list",
    "state",
    "read-output",
    "attach-observer",
    "acquire-controller",
    "release-controller",
    "write",
    "resize",
    "stop",
  ]);
  if (typeof value.operation !== "string" || !operations.has(value.operation)) {
    throw new TypeError("unknown terminal operation");
  }
  if (value.params !== undefined && !isRecord(value.params)) {
    throw new TypeError("request params must be an object");
  }
  return value as NativeTerminalRequest;
}
