/** Strict wire data validation only. A valid message is never authority to collect or execute. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalJson, contentDigest, parseStrictJson } from "./session-content-json.js";
import type { ConfirmationChallenge } from "./session-content-confirmation.js";
export const capsuleDirectory = new URL("./fixtures/session-content/v2/", import.meta.url);
export type Owner = ConfirmationChallenge["owner"];
export type Project = ConfirmationChallenge["project"];
export type Source = ConfirmationChallenge["source"];
export type Retention = { mode: "unbounded" } | { mode: "duration"; durationSeconds: number };
export interface Provider { provider: "claude"; cliVersion: string; formatVersion: string; exporterVersion: string; importerVersion: string }
export interface Scope { authorityEpoch: string; owner: Owner; project: Project; source: Source; sessionId: string;
  sessionIncarnation: string; policyId: string; policyRevision: number; consentRevision: number; exclusionRevision: number; grantId: string; grantVersion: number }
export interface HistorySelector { lineageId: string; checkpointId: string | null; fromRecord: number | null; toRecord: number | null }
export interface Policy { id: string; revision: number; owner: Owner; project: Project; destination: string; sources: Source[];
  sessions: { selected: string[]; future: boolean }; channels: { terminalLive: boolean; terminalCache: boolean; nativeHistory: boolean };
  history: { mode: "none" | "existing-at-activation" | "selected"; selected: HistorySelector[] };
  retentionByChannel: { terminalCache: Retention; nativeHistory: Retention }; exclusionRevision: number }
export interface Lease { id: string; requestNonce: string; issuedAt: number; expiresAt: number }
export interface Retained { retainedId: string; originScopeDigest: string; acceptedAt: number; expiresAt: number | null }
export interface ArchiveAdmission { archive: "h2a.session-archive/1"; snapshotId: string; manifestHash: string; policyDigest: string;
  channel: "nativeHistory"; retention: Retention; retained: Retained; descriptorHash: string }
export interface Manifest { protocol: "h2a.session-content"; protocolVersion: 2; kind: "native-manifest"; scope: Scope;
  connectionId: string; leaseId: string; archive: "h2a.session-archive/1"; snapshotId: string; policyDigest: string; provider: Provider;
  ranges: { lineageId: string; checkpointId: string; fromRecord: number; toRecord: number; inventoryHash: string }[];
  files: { path: string; role: "records" | "artifact"; bytes: number; sha256: string }[]; complete: boolean; resumable: false; manifestHash: string }
type Schema = { $ref?: string; oneOf?: Schema[]; const?: unknown; enum?: unknown[]; type?: string; properties?: Record<string, Schema>;
  required?: string[]; additionalProperties?: boolean; items?: Schema; minItems?: number; maxItems?: number; uniqueItems?: boolean;
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number; pattern?: string };
const schema = JSON.parse(readFileSync(new URL("schema.json", capsuleDirectory), "utf8")) as Schema & { $defs: Record<string, Schema> };
function fail(): never { throw new Error("contract_refused"); }
export function same(a: unknown, b: unknown): boolean { return canonicalJson(a) === canonicalJson(b); }
function matches(s: Schema, x: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (s.$ref) { const target = schema.$defs[s.$ref.slice(8)]; return !!target && matches(target, x, depth + 1); }
  if (s.oneOf) return s.oneOf.filter(branch => matches(branch, x, depth + 1)).length === 1;
  if ("const" in s) return same(x, s.const);
  if (s.enum) return s.enum.some(v => same(x, v));
  if (s.type === "null") return x === null;
  if (s.type === "boolean") return typeof x === "boolean";
  if (s.type === "integer") return Number.isSafeInteger(x) && (x as number) >= (s.minimum ?? 0) && (x as number) <= (s.maximum ?? Number.MAX_SAFE_INTEGER);
  if (s.type === "string") return typeof x === "string" && x.length >= (s.minLength ?? 0) && x.length <= (s.maxLength ?? 4096) && (!s.pattern || new RegExp(s.pattern).test(x));
  if (s.type === "array") return Array.isArray(x) && x.length >= (s.minItems ?? 0) && x.length <= (s.maxItems ?? 256)
    && (!s.uniqueItems || new Set(x.map(canonicalJson)).size === x.length) && x.every(v => !!s.items && matches(s.items, v, depth + 1));
  if (s.type === "object") {
    if (!x || typeof x !== "object" || Array.isArray(x)) return false;
    const value = x as Record<string, unknown>;
    return (s.required ?? []).every(k => Object.hasOwn(value, k)) && Object.keys(value).every(k => !!s.properties?.[k] && matches(s.properties[k]!, value[k], depth + 1));
  }
  return false;
}
export function envelope<K extends string, T extends object>(kind: K, data: T): T & { protocol: "h2a.session-content"; protocolVersion: 2; kind: K } {
  return { protocol: "h2a.session-content", protocolVersion: 2, kind, ...data };
}
export function sha256(bytes: string | Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
export function without(value: object, key: string): Record<string, unknown> { const copy = { ...value } as Record<string, unknown>; delete copy[key]; return copy; }
export function retentionDeadline(retention: Retention, acceptedAt: number): number | null {
  const deadline = retention.mode === "unbounded" ? null : acceptedAt + retention.durationSeconds * 1000;
  if (deadline !== null && (!Number.isSafeInteger(deadline) || deadline <= acceptedAt)) fail(); return deadline;
}
export function validatePolicy(policy: Policy): void {
  if (!matches(schema.$defs.Policy!, policy)) fail();
  const destination = new URL(policy.destination), issuer = new URL(policy.owner.issuer);
  if (destination.protocol !== "https:" || destination.origin !== policy.destination || issuer.protocol !== "https:"
    || issuer.username || issuer.password || destination.username || destination.password) fail();
  if ((policy.history.mode === "selected") !== (policy.history.selected.length > 0)
    || (!policy.channels.nativeHistory && policy.history.mode !== "none") || (policy.channels.nativeHistory && policy.history.mode === "none")) fail();
  for (const h of policy.history.selected) if ((h.fromRecord === null) !== (h.toRecord === null)
    || (h.fromRecord !== null && h.toRecord !== null && h.toRecord < h.fromRecord)) fail();
  for (const retention of Object.values(policy.retentionByChannel)) retentionDeadline(retention, 0);
}
/** Used after strict JSON parsing for network inputs. Does not resolve authentication. */
export function validateContentMessage(value: unknown, expected?: { policyDigest: string }): void {
  // Reject encoded amplification before canonicalization or any decoded-buffer allocation.
  if(value&&typeof value==='object'){
    const candidate=value as Record<string,unknown>,payload=candidate.payloadB64;
    if((candidate.kind==='terminal-fragment'||candidate.kind==='native-part')&&typeof payload==='string'
      &&(payload.length>1048576||payload.length%4===1||Math.floor(payload.length*3/4)>262144))fail();
  }
  // Canonicalization rejects invalid Unicode/non-JSON values even for in-process callers.
  const serialized = canonicalJson(value);
  if (Buffer.byteLength(serialized) > 8 * 1024 * 1024 || !matches(schema, value)) fail();
  const v = value as Record<string, any>;
  if (expected && v.policyDigest !== undefined && v.policyDigest !== expected.policyDigest) fail();
  if (v.policy) { validatePolicy(v.policy); if (contentDigest("policy", v.policy) !== v.policyDigest) fail(); }
  if (v.kind === "confirmation-challenge") {
    const c = v.challenge;
    if (contentDigest("confirmation", c) !== v.challengeDigest || c.expiresAt <= c.issuedAt || c.expiresAt - c.issuedAt > 60000
      || (c.purpose === "remote-action") !== (c.target.kind === "action") || Buffer.from(c.random, "base64url").toString("base64url") !== c.random) fail();
  }
  if (v.lease && (v.lease.expiresAt <= v.lease.issuedAt || v.lease.expiresAt - v.lease.issuedAt > 60000)) fail();
  if (v.kind === "source-session" && (v.expiresAt <= v.issuedAt || v.expiresAt - v.issuedAt > 60000 || v.expiresAt > v.authSessionExpiresAt)) fail();
  if (v.kind === "source-ack") {
    if (v.status === "refused" ? v.boundary !== null || v.lease !== null || v.reason === null
      : v.operation === "revoke" ? v.status !== "applied" || v.boundary !== null || v.lease !== null
        : v.status !== "staged" || v.boundary === null || v.lease === null || v.reason !== null) fail();
  }
  if (v.kind === "grant-refresh" && (v.operation === "renew" ? !same(v.previousScope, v.nextScope)
    : !same(v.previousScope.source, v.nextScope.source) || v.nextScope.policyRevision <= v.previousScope.policyRevision)) fail();
  if (v.kind === "terminal-fragment" || v.kind === "native-part") {
    const bytes = Buffer.from(v.payloadB64, "base64url");
    if (bytes.toString("base64url") !== v.payloadB64 || bytes.length !== v.byteLength || sha256(bytes) !== v.payloadHash
      || v.byteOffset + v.byteLength > v.totalBytes || v.final !== (v.byteOffset + v.byteLength === v.totalBytes)
      || (v.kind === "terminal-fragment" ? v.totalBytes > 1048576 : v.totalBytes > 67108864)) fail();
  }
  if (v.kind === "native-manifest") {
    if (contentDigest("manifest", without(v, "manifestHash")) !== v.manifestHash || v.files.reduce((n: number, f: {bytes:number})=>n+f.bytes,0) > 268435456) fail();
    if (v.ranges.some((r: {fromRecord:number;toRecord:number})=>r.toRecord<r.fromRecord)) fail();
  }
  if (v.kind === "archive-admission") {
    const a = v.admission;
    if (contentDigest("archive-admission", without(a,"descriptorHash")) !== a.descriptorHash
      || retentionDeadline(a.retention,a.retained.acceptedAt) !== a.retained.expiresAt) fail();
  }
  if (v.kind === "ingest-ack" && v.archiveAdmission !== null) {
    validateContentMessage(envelope("archive-admission",{admission:v.archiveAdmission}));
    if (v.status === "refused" || v.coverage.kind !== "native" || v.archiveAdmission.snapshotId !== v.coverage.snapshotId
      || !same(v.retained,v.archiveAdmission.retained)) fail();
  }
  if (v.kind === "history-read" && v.retained.expiresAt !== null && v.readExpiresAt > v.retained.expiresAt) fail();
  if (v.kind === "import-result" && (v.status === "refused" ? v.localImportId !== null || v.reason === null : v.localImportId === null || v.reason !== null)) fail();
}
export function parseContentMessage(text: string): unknown { const value = parseStrictJson(text, 8 * 1024 * 1024); validateContentMessage(value); return value; }
