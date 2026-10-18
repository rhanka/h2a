import {
  NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS,
  type NativeTerminalOperation,
} from "./protocol.js";

/**
 * Internal owner/frontend protocol version (lot B1, decision D16).
 *
 * The owner boundary forwards every v1 client operation unchanged. The
 * protocol is versioned and negotiated independently of client protocol
 * v1 so a frontend and an owner from different builds fail closed
 * instead of guessing.
 */
export const OWNER_PROTOCOL_VERSION = 1 as const;

/** Capability advertising end-to-end D21 write identities (lot B3). */
export const OWNER_WRITE_IDENTITY_CAPABILITY = "write-identity-v1" as const;

export type OwnerProtocolRequest = Readonly<{
  version: typeof OWNER_PROTOCOL_VERSION;
  id: string;
  operation: NativeTerminalOperation;
  params?: Readonly<Record<string, unknown>>;
}>;

const OWNER_OPERATIONS: ReadonlySet<string> = new Set<NativeTerminalOperation>([
  "ping",
  "create",
  "list",
  "state",
  "read-output",
  "attach-observer",
  "acquire-controller",
  "acquire-controller-if-no-recent-human",
  "release-controller",
  "write",
  "resize",
  "stop",
  "stop-if-incarnation",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Stable identity of one controller write, minted by the client
 * (attach/drive), never per transport attempt (decision D21).
 */
export type OwnerWriteIdentity = Readonly<{
  sessionId: string;
  incarnation: string;
  controllerEpoch: number;
  seq: number;
}>;

/** Owner-acknowledged contiguous applied frontier per controller (D21). */
export type OwnerAppliedFrontier = Readonly<{
  controllerId: string;
  epoch: number;
  frontier: number;
}>;

function requiredIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS
  ) {
    throw new TypeError(
      `${label} must be a non-empty string of at most ${NATIVE_TERMINAL_MAX_IDENTIFIER_CHARS} characters`,
    );
  }
  return value;
}

function requiredNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

export function parseOwnerWriteIdentity(value: unknown): OwnerWriteIdentity {
  const record = isRecord(value) ? value : undefined;
  if (!record) throw new TypeError("write identity must be an object");
  return Object.freeze({
    sessionId: requiredIdentifier(record.sessionId, "write identity session id"),
    incarnation: requiredIdentifier(record.incarnation, "write identity incarnation"),
    controllerEpoch: requiredNonNegativeInteger(record.controllerEpoch, "write identity controller epoch"),
    seq: requiredNonNegativeInteger(record.seq, "write identity sequence"),
  });
}

/** Returns the stable write identity carried by write params, if any. */
export function extractWriteIdentity(
  params: Readonly<Record<string, unknown>> | undefined,
): OwnerWriteIdentity | undefined {
  const candidate = params?.["writeIdentity"];
  if (candidate === undefined) return undefined;
  return parseOwnerWriteIdentity(candidate);
}

/** Returns the applied frontier carried by write params, if any. */
export function extractAppliedFrontier(
  params: Readonly<Record<string, unknown>> | undefined,
): OwnerAppliedFrontier | undefined {
  const candidate = params?.["appliedFrontier"];
  if (candidate === undefined) return undefined;
  if (!isRecord(candidate)) throw new TypeError("applied frontier must be an object");
  return Object.freeze({
    controllerId: requiredIdentifier(candidate.controllerId, "applied frontier controller id"),
    epoch: requiredNonNegativeInteger(candidate.epoch, "applied frontier epoch"),
    frontier: requiredNonNegativeInteger(candidate.frontier, "applied frontier"),
  });
}

export type OwnerCapabilities = Readonly<{ writeIdentity: boolean }>;

/**
 * Negotiates the owner-protocol capability set. Unknown capabilities
 * fail closed (D16): they are never silently ignored.
 */
export function negotiateOwnerCapabilities(
  offered: ReadonlyArray<string>,
): OwnerCapabilities {
  for (const capability of offered) {
    if (capability !== OWNER_WRITE_IDENTITY_CAPABILITY) {
      throw new TypeError(`unsupported owner-protocol capability: ${capability}`);
    }
  }
  return Object.freeze({
    writeIdentity: offered.includes(OWNER_WRITE_IDENTITY_CAPABILITY),
  });
}

/** Typed error raised when the owner side of the boundary is absent. */
export class OwnerProtocolAbsentError extends Error {
  constructor(detail = "terminal owner side is absent") {
    super(detail);
    this.name = "OwnerProtocolAbsentError";
  }
}

/** Fails closed with {@link OwnerProtocolAbsentError} when no owner side exists. */
export function assertOwnerChannelPresent<TChannel>(channel: TChannel | null | undefined): TChannel {
  if (channel === null || channel === undefined) {
    throw new OwnerProtocolAbsentError();
  }
  return channel;
}

/** Serializes one owner-protocol request frame (newline-delimited JSON). */
export function encodeOwnerFrame(request: OwnerProtocolRequest): string {
  if (request.version !== OWNER_PROTOCOL_VERSION) {
    throw new TypeError("unsupported owner-protocol version");
  }
  if (!OWNER_OPERATIONS.has(request.operation)) {
    throw new TypeError("unknown terminal operation");
  }
  return `${JSON.stringify(request)}\n`;
}

/**
 * Parses one owner-protocol frame. Unknown versions and truncated
 * frames are rejected before any dispatch happens.
 */
export function decodeOwnerFrame(
  frame: string,
  dispatch?: (request: OwnerProtocolRequest) => unknown,
): OwnerProtocolRequest {
  const line = frame.endsWith("\n") ? frame.slice(0, -1) : frame;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new TypeError("truncated or invalid owner-protocol frame");
  }
  if (!isRecord(parsed)) throw new TypeError("owner-protocol frame must be an object");
  if (parsed.version !== OWNER_PROTOCOL_VERSION) {
    throw new TypeError("unsupported owner-protocol version");
  }
  if (typeof parsed.id !== "string" || parsed.id.length === 0) {
    throw new TypeError("owner-protocol frame id must be a non-empty string");
  }
  if (typeof parsed.operation !== "string" || !OWNER_OPERATIONS.has(parsed.operation)) {
    throw new TypeError("unknown terminal operation");
  }
  if (parsed.params !== undefined && !isRecord(parsed.params)) {
    throw new TypeError("owner-protocol frame params must be an object");
  }
  const request = parsed as OwnerProtocolRequest;
  dispatch?.(request);
  return request;
}

export type { NativeTerminalOperation };
