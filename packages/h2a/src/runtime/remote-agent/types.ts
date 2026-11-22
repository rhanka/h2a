/**
 * LH-00 / LH-07 local fixture types for link, instance, catalogue and terminal records.
 *
 * These are h2a-owned stand-ins for the trunk contract until the published
 * library subpath lands (DB-01). They never import the private terminal
 * vocabulary package.
 */

import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { canonicalize } from "../../canonical.js";

export const TRUNK_PROTOCOL_VERSION = 1 as const;
export const TRUNK_RECORD_MAX_BYTES = 32768 as const;
export const TRUNK_TERMINAL_TEXT_MAX_BYTES = 16384 as const;
export const CATALOGUE_MAX_ROWS = 512 as const;
export const CATALOGUE_ROW_MAX_BYTES = 512 as const;
export const CATALOGUE_SNAPSHOT_MAX_BYTES = 262144 as const;
export const TERMINAL_INPUT_MAX_BYTES = 4096 as const;
export const TERMINAL_OUTPUT_COALESCE_BYTES = 16384 as const;

export interface TrunkEnvelope {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: string;
  readonly ch: number;
  readonly s: number;
}

// WET-2 clause 17: the signature covers the full challenge (`nonce`, `meshId`,
// `endpoint`, `tenantId`, `serverTime`) plus the auth fields, so a challenge
// relayed to another tenant, mesh or endpoint never verifies.
export interface TrunkChallenge {
  readonly nonce: string;
  readonly meshId: string;
  readonly tenantId: string;
  readonly endpoint: string;
  readonly serverTime: number;
  readonly nodeId: string;
  readonly enrolmentRef: string;
}

export interface TrunkAuthPayload {
  readonly nonce: string;
  readonly meshId: string;
  readonly tenantId: string;
  readonly endpoint: string;
  readonly serverTime: number;
  readonly nodeId: string;
  readonly enrolmentRef: string;
  readonly protocolVersions: readonly number[];
  readonly clientTime: number;
}

export interface TrunkNegotiatedLimits {
  readonly maxCreditRecords?: number;
  readonly maxCreditBytes?: number;
  readonly maxCatalogueRecordBytes?: number;
}

export interface TrunkHelloRecord extends TrunkEnvelope {
  readonly t: "hello";
  readonly protocolVersions: readonly number[];
  readonly nonce: string;
  readonly meshId: string;
  readonly endpoint: string;
  readonly tenantId: string;
  readonly serverTime: number;
}

export interface TrunkAuthRecord extends TrunkEnvelope {
  readonly t: "auth";
  readonly nodeId: string;
  readonly enrolmentRef: string;
  readonly protocolVersions: readonly number[];
  readonly clientTime: number;
  readonly signature: string;
}

export interface TrunkReadyRecord extends TrunkEnvelope {
  readonly t: "ready";
  readonly linkGeneration: number;
  readonly serverTime: number;
  readonly bindNonce: string;
  readonly revokedInstances: readonly string[];
  readonly limits?: TrunkNegotiatedLimits;
}

export interface InstanceBindRecord extends TrunkEnvelope {
  readonly t: "instance.bind";
  readonly instanceId: string;
  readonly instancePublicKey: string;
  readonly instanceFingerprint: string;
  readonly bindNonce: string;
  readonly sig: string;
}

export interface InstanceBoundRecord extends TrunkEnvelope {
  readonly t: "instance.bound";
  readonly instanceId: string;
  readonly status: "live" | "refused";
  readonly reason?: string;
  readonly bindNonce: string;
}

export interface InstanceRevokedRecord extends TrunkEnvelope {
  readonly t: "instance.revoked";
  readonly instanceId: string;
  readonly revokedAt: number;
  readonly revokedBy: string;
}

export type TrunkInstanceRecord =
  | InstanceBindRecord
  | InstanceBoundRecord
  | InstanceRevokedRecord;

export type TrunkLinkRecord =
  | TrunkHelloRecord
  | TrunkAuthRecord
  | TrunkReadyRecord
  | (TrunkEnvelope & { readonly t: "ping"; readonly at: number })
  | (TrunkEnvelope & { readonly t: "pong"; readonly at: number })
  | (TrunkEnvelope & { readonly t: "revoked"; readonly reason?: string })
  | (TrunkEnvelope & { readonly t: "superseded"; readonly reason?: string })
  | (TrunkEnvelope & { readonly t: "kill"; readonly reason?: string })
  | (TrunkEnvelope & { readonly t: "bye" })
  | (TrunkEnvelope & { readonly t: "err"; readonly code: string; readonly retryable: boolean; readonly retryAfterMs?: number });

export type InventoryHostKind = "native" | "tmux" | "unknown";
export type CatalogueInstanceStatus = "live" | "revoked";
export type CatalogueOperabilityReason =
  | "not-shared"
  | "not-operable-tmux"
  | "open-with-h2a-to-operate";

export interface CatalogueSessionRow {
  readonly sessionId: string;
  readonly instance?: string;
  readonly instanceId?: string;
  readonly instanceStatus?: CatalogueInstanceStatus;
  readonly host?: string;
  readonly name?: string;
  readonly workspaceLabel?: string;
  readonly startedAt?: string;
  readonly heartbeatAt?: string;
  readonly state: string;
  readonly workStatus?: string;
  readonly hostKind: InventoryHostKind;
  readonly operable: boolean;
  readonly excluded?: boolean;
  readonly operabilityReason?: CatalogueOperabilityReason;
}

export interface CatalogueInstanceStatusUpdate {
  readonly sessionId: string;
  readonly instanceId: string;
  readonly instanceStatus: CatalogueInstanceStatus;
}

export type CatalogueRowStatusUpdate = CatalogueInstanceStatusUpdate;

export type CatalogueRowUpdate = CatalogueSessionRow | CatalogueInstanceStatusUpdate;

export interface CatalogueSnapshot {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "cat.snapshot";
  readonly ch: number;
  readonly s: number;
  readonly at: number;
  readonly rows: readonly CatalogueSessionRow[];
  readonly truncatedRows?: number;
}

export interface CatalogueDelta {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "cat.delta";
  readonly ch: number;
  readonly s: number;
  readonly at: number;
  readonly adds: readonly CatalogueSessionRow[];
  readonly updates: readonly CatalogueRowUpdate[];
  readonly removes: readonly string[];
}

export interface CatalogueWatchStart {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "watch.start";
  readonly ch: number;
  readonly s: number;
}

export interface CatalogueWatchStop {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "watch.stop";
  readonly ch: number;
  readonly s: number;
}

export type TrunkCatalogueRecord = CatalogueSnapshot | CatalogueDelta | CatalogueWatchStart | CatalogueWatchStop;

export type TerminalMode = "observe" | "control";
export type TerminalStatus = "running" | "stopping" | "exited" | string;
export type ControlState = "granted" | "refused-recent-human" | "refused-held" | "taken-back" | "idle-released" | "lost-link" | "released";

export interface TermOpen {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "term.open";
  readonly ch: number;
  readonly s: number;
  readonly sid: string;
  readonly mode: TerminalMode;
  readonly afterSeq: number | null;
  readonly receivedSegBytes: number;
  readonly cols?: number;
  readonly rows?: number;
}

export interface TermOpened {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "term.opened";
  readonly ch: number;
  readonly s: number;
  readonly sid: string;
  readonly generation: string;
  readonly incarnation: string;
  readonly status: TerminalStatus;
  readonly latestSeq: number;
  readonly gap?: { readonly fromSeq: number; readonly toSeq: number } | null;
  readonly modePrefix?: string;
  readonly controllerEpoch?: number;
  readonly holderKind: "none" | "human" | "automation" | "remote";
  readonly size: { readonly cols: number; readonly rows: number };
}

export interface TermOut {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "term.out";
  readonly ch: number;
  readonly s: number;
  readonly sid: string;
  readonly incarnation: string;
  readonly firstSeq: number;
  readonly lastSeq: number;
  readonly seg?: number;
  readonly segLast?: boolean;
  readonly dataB64: string;
}

export interface TermGap {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "term.gap";
  readonly ch: number;
  readonly s: number;
  readonly sid: string;
  readonly fromSeq: number;
  readonly toSeq: number;
}

export interface TermIn {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "term.in";
  readonly ch: number;
  readonly s: number;
  readonly sid: string;
  readonly generation: string;
  readonly incarnation: string;
  readonly epoch: number;
  readonly inSeq: number;
  readonly origin: "user" | "terminal-reply";
  readonly dataB64: string;
}

export interface TermInAck {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "term.in.ack";
  readonly ch: number;
  readonly s: number;
  readonly sid: string;
  readonly inSeq: number;
  readonly result: "applied" | "refused" | "uncertain";
  readonly reason?: string;
}

export interface TermCtl {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "term.ctl";
  readonly ch: number;
  readonly s: number;
  readonly sid: string;
  readonly action: "acquire" | "release";
}

export interface TermCtlState {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "term.ctl.state";
  readonly ch: number;
  readonly s: number;
  readonly sid: string;
  readonly state: ControlState;
  readonly epoch?: number;
}

export interface TermResize {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "term.resize";
  readonly ch: number;
  readonly s: number;
  readonly sid: string;
  readonly cols: number;
  readonly rows: number;
}

export interface TermStop {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "term.stop";
  readonly ch: number;
  readonly s: number;
  readonly sid: string;
  readonly incarnation: string;
}

export interface TermExit {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "term.exit";
  readonly ch: number;
  readonly s: number;
  readonly sid: string;
  readonly incarnation: string;
  readonly exitCode?: number;
  readonly signal?: number;
}

export interface TermClose {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "term.close";
  readonly ch: number;
  readonly s: number;
  readonly sid: string;
}

// Credit is accounted per allocated channel; the record's own `ch` names it.
export interface CreditRecord {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "credit";
  readonly ch: number;
  readonly s: number;
  readonly receivedThroughSeq: number;
  readonly receivedThroughBytes: number;
  readonly sendLimitSeq: number;
  readonly sendLimitBytes: number;
}

export interface TrunkErrorRecord {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "err";
  readonly ch: number;
  readonly s: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
}

export interface TrunkExtensionRecord extends TrunkEnvelope {
  readonly t: `x-${string}`;
  readonly [key: string]: unknown;
}

export type TrunkTerminalRecord =
  | TermOpen
  | TermOpened
  | TermOut
  | TermGap
  | TermIn
  | TermInAck
  | TermCtl
  | TermCtlState
  | TermResize
  | TermStop
  | TermExit
  | TermClose
  | CreditRecord
  | TrunkErrorRecord;

export type TrunkRecord =
  | TrunkLinkRecord
  | TrunkInstanceRecord
  | TrunkCatalogueRecord
  | TrunkTerminalRecord
  | TrunkExtensionRecord;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isSafeNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function isSafePosInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isStringArray(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isPosIntArray(v: unknown): v is readonly number[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => isSafePosInt(x));
}

export function isTrunkRecord(value: unknown): value is TrunkRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  if (rec["v"] !== TRUNK_PROTOCOL_VERSION) return false;
  if (!isNonEmptyString(rec["t"])) return false;
  if (!isSafeNonNegInt(rec["ch"])) return false;
  if (!isSafePosInt(rec["s"])) return false;
  const t = rec["t"];
  const ch = rec["ch"];

  // Extension types (`x-*`) are accepted after validating envelope, ch and s.
  if (t.startsWith("x-")) {
    return true;
  }

  switch (t) {
    case "hello":
      return (
        ch === 0 &&
        isPosIntArray(rec["protocolVersions"]) &&
        isNonEmptyString(rec["nonce"]) &&
        isNonEmptyString(rec["meshId"]) &&
        isNonEmptyString(rec["endpoint"]) &&
        isNonEmptyString(rec["tenantId"]) &&
        isFiniteNumber(rec["serverTime"])
      );
    case "auth":
      return (
        ch === 0 &&
        isNonEmptyString(rec["nodeId"]) &&
        isNonEmptyString(rec["enrolmentRef"]) &&
        isPosIntArray(rec["protocolVersions"]) &&
        isFiniteNumber(rec["clientTime"]) &&
        isNonEmptyString(rec["signature"])
      );
    case "ready":
      return (
        ch === 0 &&
        isSafePosInt(rec["linkGeneration"]) &&
        isFiniteNumber(rec["serverTime"]) &&
        isNonEmptyString(rec["bindNonce"]) &&
        isStringArray(rec["revokedInstances"]) &&
        (rec["limits"] === undefined || (typeof rec["limits"] === "object" && rec["limits"] !== null && !Array.isArray(rec["limits"])))
      );
    case "ping":
    case "pong":
      return ch === 0 && isFiniteNumber(rec["at"]);
    case "revoked":
    case "superseded":
    case "kill":
      return ch === 0 && (rec["reason"] === undefined || typeof rec["reason"] === "string");
    case "bye":
      return ch === 0;
    case "err":
      return (
        isNonEmptyString(rec["code"]) &&
        typeof rec["retryable"] === "boolean" &&
        (rec["retryAfterMs"] === undefined || isSafeNonNegInt(rec["retryAfterMs"]))
      );
    case "instance.bind":
      return (
        ch === 0 &&
        isNonEmptyString(rec["instanceId"]) &&
        isNonEmptyString(rec["instancePublicKey"]) &&
        isNonEmptyString(rec["instanceFingerprint"]) &&
        isNonEmptyString(rec["bindNonce"]) &&
        isNonEmptyString(rec["sig"])
      );
    case "instance.bound":
      return (
        ch === 0 &&
        isNonEmptyString(rec["instanceId"]) &&
        (rec["status"] === "live" || rec["status"] === "refused") &&
        (rec["reason"] === undefined || typeof rec["reason"] === "string") &&
        isNonEmptyString(rec["bindNonce"])
      );
    case "instance.revoked":
      return (
        ch === 0 &&
        isNonEmptyString(rec["instanceId"]) &&
        isFiniteNumber(rec["revokedAt"]) &&
        isNonEmptyString(rec["revokedBy"])
      );
    case "watch.start":
    case "watch.stop":
      return ch === 1;
    case "cat.snapshot":
      return (
        ch === 1 &&
        isFiniteNumber(rec["at"]) &&
        Array.isArray(rec["rows"]) &&
        (rec["truncatedRows"] === undefined || isSafeNonNegInt(rec["truncatedRows"]))
      );
    case "cat.delta":
      return (
        ch === 1 &&
        isFiniteNumber(rec["at"]) &&
        Array.isArray(rec["adds"]) &&
        Array.isArray(rec["updates"]) &&
        isStringArray(rec["removes"])
      );
    case "credit":
      return (
        ch >= 1 &&
        isSafeNonNegInt(rec["receivedThroughSeq"]) &&
        isSafeNonNegInt(rec["receivedThroughBytes"]) &&
        isSafeNonNegInt(rec["sendLimitSeq"]) &&
        isSafeNonNegInt(rec["sendLimitBytes"])
      );
    case "term.open":
      return (
        ch >= 2 &&
        isNonEmptyString(rec["sid"]) &&
        (rec["mode"] === "observe" || rec["mode"] === "control") &&
        (rec["afterSeq"] === null || isSafeNonNegInt(rec["afterSeq"])) &&
        isSafeNonNegInt(rec["receivedSegBytes"]) &&
        (rec["cols"] === undefined || isSafePosInt(rec["cols"])) &&
        (rec["rows"] === undefined || isSafePosInt(rec["rows"]))
      );
    case "term.opened":
      return (
        ch >= 2 &&
        isNonEmptyString(rec["sid"]) &&
        isNonEmptyString(rec["generation"]) &&
        isNonEmptyString(rec["incarnation"]) &&
        isNonEmptyString(rec["status"]) &&
        isSafeNonNegInt(rec["latestSeq"]) &&
        (rec["holderKind"] === "none" || rec["holderKind"] === "human" || rec["holderKind"] === "automation" || rec["holderKind"] === "remote") &&
        typeof rec["size"] === "object" && rec["size"] !== null
      );
    case "term.out":
      return (
        ch >= 2 &&
        isNonEmptyString(rec["sid"]) &&
        isNonEmptyString(rec["incarnation"]) &&
        isSafeNonNegInt(rec["firstSeq"]) &&
        isSafeNonNegInt(rec["lastSeq"]) &&
        typeof rec["dataB64"] === "string"
      );
    case "term.gap":
      return ch >= 2 && isNonEmptyString(rec["sid"]) && isSafeNonNegInt(rec["fromSeq"]) && isSafeNonNegInt(rec["toSeq"]);
    case "term.in":
      return (
        ch >= 2 &&
        isNonEmptyString(rec["sid"]) &&
        isNonEmptyString(rec["generation"]) &&
        isNonEmptyString(rec["incarnation"]) &&
        isSafeNonNegInt(rec["epoch"]) &&
        isSafePosInt(rec["inSeq"]) &&
        (rec["origin"] === "user" || rec["origin"] === "terminal-reply") &&
        typeof rec["dataB64"] === "string"
      );
    case "term.in.ack":
      return (
        ch >= 2 &&
        isNonEmptyString(rec["sid"]) &&
        isSafePosInt(rec["inSeq"]) &&
        (rec["result"] === "applied" || rec["result"] === "refused" || rec["result"] === "uncertain")
      );
    case "term.ctl":
      return ch >= 2 && isNonEmptyString(rec["sid"]) && (rec["action"] === "acquire" || rec["action"] === "release");
    case "term.ctl.state":
      return ch >= 2 && isNonEmptyString(rec["sid"]) && isNonEmptyString(rec["state"]);
    case "term.resize":
      return ch >= 2 && isNonEmptyString(rec["sid"]) && isSafePosInt(rec["cols"]) && isSafePosInt(rec["rows"]);
    case "term.stop":
      return ch >= 2 && isNonEmptyString(rec["sid"]) && isNonEmptyString(rec["incarnation"]);
    case "term.exit":
      return (
        ch >= 2 &&
        isNonEmptyString(rec["sid"]) &&
        isNonEmptyString(rec["incarnation"]) &&
        (rec["exitCode"] === undefined || typeof rec["exitCode"] === "number") &&
        (rec["signal"] === undefined || typeof rec["signal"] === "number")
      );
    case "term.close":
      return ch >= 2 && isNonEmptyString(rec["sid"]);
    default:
      return false;
  }
}

/** Stable JSON for signing: reuses the repo's `canonicalize` (sorted keys,
 * `undefined` values omitted, non-finite numbers rejected). */
export function canonicalTrunkJson(value: unknown): string {
  return canonicalize(value);
}

function asPrivateKey(privateKeyPem: string | KeyObject): KeyObject {
  return typeof privateKeyPem === "string" ? createPrivateKey(privateKeyPem) : privateKeyPem;
}

function asPublicKey(publicKeyPem: string | KeyObject): KeyObject {
  return typeof publicKeyPem === "string" ? createPublicKey(publicKeyPem) : publicKeyPem;
}

/** Shared Ed25519 signing over raw canonical bytes, base64-encoded. */
export function signTrunkBytes(bytes: Uint8Array, privateKeyPem: string | KeyObject): string {
  return sign(null, bytes, asPrivateKey(privateKeyPem)).toString("base64");
}

/** Shared Ed25519 verification over raw canonical bytes. */
export function verifyTrunkBytes(
  bytes: Uint8Array,
  signatureBase64: string,
  publicKeyPem: string | KeyObject
): boolean {
  try {
    return verify(null, bytes, asPublicKey(publicKeyPem), Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

/** Ed25519 signature over the canonical JSON of an auth payload, base64-encoded. */
export function signTrunkAuthPayload(payload: TrunkAuthPayload | Record<string, unknown>, privateKeyPem: string | KeyObject): string {
  const bytes = Buffer.from(canonicalTrunkJson(payload), "utf8");
  return signTrunkBytes(bytes, privateKeyPem);
}

export function verifyTrunkAuthPayload(
  payload: TrunkAuthPayload | Record<string, unknown>,
  signatureBase64: string,
  publicKeyPem: string | KeyObject
): boolean {
  try {
    const bytes = Buffer.from(canonicalTrunkJson(payload), "utf8");
    return verifyTrunkBytes(bytes, signatureBase64, publicKeyPem);
  } catch {
    return false;
  }
}
