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
 * Q-02 (record size bound, settled in spec r6 section 7.1): trunk-owned
 * `TRUNK_RECORD_MAX_BYTES = 32768` with base64-carried terminal bytes
 * (`dataB64`, ≤ 16384 raw bytes for `term.out`, ≤ 4096 for `term.in`).
 * Q-03 (sequence, channel, epoch, settled in spec r6 sections 7.1–7.3):
 * `term.out` carries required `firstSeq`/`lastSeq` (+ `seg`/`segLast` for one
 * oversized chunk, never `seq`); resume is `afterSeq` (+ `afterSeqBytes`) in
 * `term.open`; `granted` carries `epoch`; `term.opened`, `resume` and
 * `term.in` carry `generation`; `term.in.ack` carries `uncertain`; channels
 * are allocated by `ch` in `term.open` (0 link, 1 catalogue, ≥ 2 terminal).
 * Q-06 (fingerprint encoding): the fingerprint is an opaque fixture string
 * in LH-00; no byte encoding is fixed here.
 */

import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { canonicalize } from "../../canonical.js";

export const TRUNK_PROTOCOL_VERSION = 1 as const;
// Q-02 (settled, spec r6 section 7.1): the trunk carries its own record bound,
// 32768 encoded bytes — the relay's 8192 cap is not reused. Terminal bytes are
// carried base64 (`dataB64`): `term.out` ≤ 16384 raw bytes (21848 base64 chars,
// envelope ≤ 512 → still under 32768), `term.in` ≤ 4096 raw bytes, every other
// record schema-bounded to ≤ 8192 encoded bytes. The encoder splits and never
// throws; escape-dense vectors are an RM-C gate.
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
  readonly afterSeqBytes: number;
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
