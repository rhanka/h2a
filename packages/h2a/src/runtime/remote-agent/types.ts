/**
 * LH-00 local fixture types for link, catalogue and terminal records.
 *
 * These are h2a-owned stand-ins for the trunk contract until the published
 * library subpath lands (DB-01). They never import the private terminal
 * vocabulary package.
 *
 * Q-18 (name alignment): the `cat.*` / `term.*` / `err` names below are
 * ALIGNED WITH the vocabulary package event names (`terminal.*`), never a
 * one-to-one copy. DB-01 records whether the package is published as the
 * shared source or kept private beside these local types.
 *
 * Q-02 (record size bound): the two size constants mirror the relay framing
 * bounds as documentation only; LH-00 fixtures do NOT enforce them, so a
 * later fold that re-derives the bound from the payload class (including
 * escape-dense vectors) stays a tightening, not a fixture rewrite.
 * Q-03 (sequence, channel, epoch): terminal output carries `firstSeq` /
 * `lastSeq` as OPTIONAL companions to `seq`, and opened records carry an
 * OPTIONAL `generation`, so the fold can require them without breaking
 * fixtures that only set the r5 fields.
 * Q-06 (fingerprint encoding): the fingerprint is an opaque fixture string
 * in LH-00; no byte encoding is fixed here.
 */

import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

export const TRUNK_PROTOCOL_VERSION = 1 as const;
export const TRUNK_RECORD_MAX_BYTES = 8192 as const;
export const TRUNK_TERMINAL_TEXT_MAX_BYTES = 16384 as const;
export const CATALOGUE_SNAPSHOT_MAX_BYTES = 262144 as const;
export const TERMINAL_INPUT_MAX_BYTES = 4096 as const;
export const TERMINAL_OUTPUT_COALESCE_BYTES = 16384 as const;

export interface TrunkEnvelope {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: string;
  readonly ch: number;
  readonly s: number;
}

export interface TrunkChallenge {
  readonly nonce: string;
  readonly tenantId: string;
  readonly endpoint: string;
  readonly serverTime: number;
  readonly nodeId: string;
  readonly enrolmentRef: string;
}

export interface TrunkAuthPayload {
  readonly nonce: string;
  readonly nodeId: string;
  readonly enrolmentRef: string;
  readonly protocolVersions: readonly number[];
  readonly clientTime: number;
}

export type TrunkLinkRecord = TrunkEnvelope & (
  | { readonly t: "hello" }
  | { readonly t: "auth"; readonly nodeId: string; readonly enrolmentRef: string; readonly protocolVersions: readonly number[]; readonly clientTime: number; readonly signature: string }
  | { readonly t: "ready"; readonly linkGeneration: number; readonly serverTime: number }
  | { readonly t: "ping"; readonly at: number }
  | { readonly t: "pong"; readonly at: number }
  | { readonly t: "revoked"; readonly reason?: string }
  | { readonly t: "superseded"; readonly reason?: string }
  | { readonly t: "kill"; readonly reason?: string }
  | { readonly t: "bye" }
  | { readonly t: "err"; readonly code: string; readonly retryable: boolean }
);

export type InventoryHostKind = "native" | "tmux" | "unknown";

export interface CatalogueSessionRow {
  readonly sessionId: string;
  readonly instance: string;
  readonly host?: string;
  readonly name?: string;
  readonly startedAt: string;
  readonly heartbeatAt: string;
  readonly state: string;
  readonly workStatus?: string;
  readonly hostKind: InventoryHostKind;
  readonly operable: boolean;
  readonly excluded?: boolean;
}

export interface CatalogueSnapshot {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "cat.snapshot";
  readonly ch: number;
  readonly s: number;
  readonly at: number;
  readonly rows: readonly CatalogueSessionRow[];
}

export interface CatalogueDelta {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "cat.delta";
  readonly ch: number;
  readonly s: number;
  readonly at: number;
  readonly adds: readonly CatalogueSessionRow[];
  readonly updates: readonly CatalogueSessionRow[];
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
export type ControlState = "granted" | "refused-recent-human" | "taken-back" | "idle-released" | "lost-link";

export interface TermOpen {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "term.open";
  readonly ch: number;
  readonly s: number;
  readonly sid: string;
  readonly mode: TerminalMode;
  readonly fromSeq?: number | null;
  readonly cols?: number;
  readonly rows?: number;
}

export interface TermOpened {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "term.opened";
  readonly ch: number;
  readonly s: number;
  readonly sid: string;
  readonly incarnation: string;
  readonly generation?: string;
  readonly status: TerminalStatus;
  readonly latestSeq: number;
  readonly gap?: { readonly fromSeq: number; readonly toSeq: number } | null;
  readonly modePrefix?: string;
  readonly controllerEpoch?: number;
}

export interface TermOut {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "term.out";
  readonly ch: number;
  readonly s: number;
  readonly sid: string;
  readonly incarnation: string;
  readonly seq: number;
  readonly firstSeq?: number;
  readonly lastSeq?: number;
  readonly data: string;
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
  readonly incarnation: string;
  readonly epoch: number;
  readonly inSeq: number;
  readonly data: string;
}

export interface TermInAck {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "term.in.ack";
  readonly ch: number;
  readonly s: number;
  readonly sid: string;
  readonly inSeq: number;
  readonly result: "applied" | "refused";
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
}

export interface TermClose {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "term.close";
  readonly ch: number;
  readonly s: number;
  readonly sid: string;
}

export interface CreditRecord {
  readonly v: typeof TRUNK_PROTOCOL_VERSION;
  readonly t: "credit";
  readonly ch: number;
  readonly s: number;
  readonly channel: number;
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

export type TrunkRecord = TrunkLinkRecord | TrunkCatalogueRecord | TrunkTerminalRecord;

export function isTrunkRecord(value: unknown): value is TrunkRecord {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return rec["v"] === TRUNK_PROTOCOL_VERSION && typeof rec["t"] === "string" && typeof rec["ch"] === "number" && typeof rec["s"] === "number";
}

/** Stable JSON for signing: object keys sorted recursively (JCS-like for plain JSON). */
export function canonicalTrunkJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalTrunkJson(item)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalTrunkJson(obj[key])}`).join(",")}}`;
}

function asPrivateKey(privateKeyPem: string | KeyObject): KeyObject {
  return typeof privateKeyPem === "string" ? createPrivateKey(privateKeyPem) : privateKeyPem;
}

function asPublicKey(publicKeyPem: string | KeyObject): KeyObject {
  return typeof publicKeyPem === "string" ? createPublicKey(publicKeyPem) : publicKeyPem;
}

/** Ed25519 signature over the canonical JSON of an auth payload, base64-encoded. */
export function signTrunkAuthPayload(payload: TrunkAuthPayload | Record<string, unknown>, privateKeyPem: string | KeyObject): string {
  const bytes = Buffer.from(canonicalTrunkJson(payload), "utf8");
  return sign(null, bytes, asPrivateKey(privateKeyPem)).toString("base64");
}

export function verifyTrunkAuthPayload(
  payload: TrunkAuthPayload | Record<string, unknown>,
  signatureBase64: string,
  publicKeyPem: string | KeyObject
): boolean {
  try {
    const bytes = Buffer.from(canonicalTrunkJson(payload), "utf8");
    return verify(null, bytes, asPublicKey(publicKeyPem), Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}
