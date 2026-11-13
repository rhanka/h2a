import { withWriterMutation } from "../handover/mutation.js";
/**
 * Identity binding registry + proof-of-possession (DEC-116 F1 security core;
 * stability unit RE-ANCHORED 2026-06-07 — supersedes the per-workspace choice).
 *
 * Reconnect de-collision binds the perennial identity to its stability unit
 * `(host, providerSessionId)` — the provider **conversation UUID**
 * (`CLAUDE_CODE_SESSION_ID`, the Codex session id, …). One identity per live
 * conversation: two concurrent conversations in the SAME workspace now get
 * DISTINCT ids (no shared inbox — the collision this re-anchor removes), and a
 * resume of the same conversation reclaims its id (the UUID survives resume).
 * `workspaceId` is recorded as metadata only — NOT the match key. Keying on it
 * (the prior design) collapsed concurrent agents in one repo onto one inbox; the
 * per-session granularity is intended now, with dead ids reaped via presence TTL
 * + discover=live-only rather than prevented. An agent with no readable
 * conversation UUID is given a per-workspace fallback id
 * (`fallback:<host>:<workspaceId>` by the caller), so that degenerate case keeps
 * the old per-workspace behavior.
 *
 * **RECLAIM requires proof-of-possession**: the connector must sign a fresh
 * nonce with the ed25519 key already bound to that identity (verified against
 * the instance's active keys). The provider session id is a spoofable *routing
 * hint* — never the authenticator. No valid signature → **MINT** a fresh
 * identity (so a process presenting a victim's id, without the key, gets a new
 * identity, not the victim's inbox). The read → decide → append runs in ONE lock
 * (no reclaim/mint race, F3).
 */

import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { commitBinding, pendingBindingWinner, bindingKeyHash } from "./binding-commit.js";
import { BindingCommitIntegrityError, BindingFenceStaleError, preparePossession, receiptMatches, withPossession } from "./possession.js";
import { ensureDurableDirectory } from "./durable.js";
import { LockTimeoutError } from "../local-files/locks.js";
import type { IdentityFenceOptions } from "../local-files/identity-fence.js";

import type {
  H2AActorRegistration,
  H2ASignature
} from "@sentropic/h2a";
import { signCanonical, verifyCanonical } from "../../signature.js";

import { localStorePaths } from "../local-files/index.js";
import {
  IDENTITY_BINDING_FENCE_PROTOCOL,
  withIdentityFence,
  withIdentityFenceSync,
  type IdentityFenceLease
} from "../local-files/identity-fence.js";
import { launchLookupKey, lookupLaunchRows } from "../local-files/launch-index.js";

/**
 * The one protocol accepted by the DEF identity-binding writer.  The cull
 * executor uses the same sentinel and refuses a writer inventory that cannot
 * prove this epoch-bearing protocol for every binding write path.
 */
export { IDENTITY_BINDING_FENCE_PROTOCOL };

export interface H2AIdentityBinding {
  readonly host: string;
  readonly providerSessionId: string;
  readonly workspaceId: string;
  /** The addressable handle `host:label:uuid12` — what the keyring + addressing key on. */
  readonly instance: string;
  /** The perennial agent UUID (its first 12 hex form `uuid12` in the instance). */
  readonly agentUuid: string;
  readonly at: string;
}

export interface IdentityBindingKey {
  readonly host: string;
  readonly providerSessionId: string;
  readonly workspaceId: string;
}

function identityDir(root: string): string {
  return join(localStorePaths(root).root, "identity");
}
function bindingsFile(root: string): string {
  return join(identityDir(root), "bindings.jsonl");
}
function bindingsLock(root: string): string {
  return join(identityDir(root), ".lock");
}

export function listBindings(root: string): H2AIdentityBinding[] {
  const f = bindingsFile(root);
  if (!existsSync(f)) return [];
  const out: H2AIdentityBinding[] = [];
  for (const line of readFileSync(f, "utf8").split("\n").slice(0, -1)) {
    if (!line.trim()) continue;
    try {
      const row=JSON.parse(line);
      if(row && typeof row==='object' && !Array.isArray(row))out.push(row as H2AIdentityBinding);
    } catch {
      // skip malformed
    }
  }
  return out;
}

/**
 * The latest binding for the identity's stability unit
 * `(host, providerSessionId)` (append-only → last wins), or undefined.
 *
 * The match is the provider **conversation UUID** (`CLAUDE_CODE_SESSION_ID`, the
 * Codex session id, or a `fallback:<host>:<workspaceId>` when none is readable).
 * `workspaceId` is recorded on the binding for audit but is NOT part of the
 * match: keying on it collapsed two concurrent conversations in one repo onto a
 * single id + inbox (the BR25 collision). Two conversations → two ids; a resumed
 * conversation reclaims its id (same UUID), still gated by proof-of-possession in
 * `reclaimOrMint`.
 */
export function findBinding(root: string, key: IdentityBindingKey): H2AIdentityBinding | undefined {
  const indexed = lookupLaunchRows<H2AIdentityBinding>(bindingsFile(root), "bindings", launchLookupKey(key.host, key.providerSessionId));
  if (indexed !== undefined) return indexed.at(-1);
  let found: H2AIdentityBinding | undefined;
  for (const b of listBindings(root)) {
    if (b.host === key.host && b.providerSessionId === key.providerSessionId) {
      found = b;
    }
  }
  return found;
}

/**
 * Verify a reclaim proof: `signature` over `nonce` must verify against ANY of
 * the agent's active public keys. Total — never throws.
 */
export function verifyReclaimProof(
  nonce: string,
  signature: H2ASignature,
  publicKeys: readonly string[]
): boolean {
  for (const pem of publicKeys) {
    try {
      if (verifyCanonical(nonce, signature, pem)) return true;
    } catch {
      // try the next active key
    }
  }
  return false;
}

export interface ReclaimOrMintDeps {
  /** PoP: true iff the connector proved possession of the bound instance's key. */
  verifyProof(binding: H2AIdentityBinding): boolean;
  /** Mint a fresh identity (new uuid + derived instance) when no reclaim. */
  mint(): { instance: string; agentUuid: string };
  now(): number;
}

export interface ReclaimOrMintResult {
  readonly action: "reclaim" | "mint";
  readonly instance: string;
  readonly agentUuid: string;
}

/**
 * Atomically (one lock) reclaim the existing binding iff it exists AND
 * proof-of-possession passes; otherwise mint a fresh identity and record the new
 * binding. Spoofing the id without the key → mint (a new identity), never a
 * reclaim of someone else's.
 */

export interface ReclaimOrMintOptions extends IdentityFenceOptions {
  readonly deadlineMs?: number;
  readonly beforePublish?: (result: ReclaimOrMintResult, heldLocks: { readonly identity: true }) => void;
}

function prepareTransaction(root: string, key: IdentityBindingKey, deps: ReclaimOrMintDeps,
  options: ReclaimOrMintOptions, memo: { value?: ReclaimOrMintResult }) {
  const binding = findBinding(root, key);
  let pending:H2AIdentityBinding|undefined;
  try{pending=pendingBindingWinner(identityDir(root),bindingKeyHash(key.host,key.providerSessionId)) as unknown as H2AIdentityBinding|undefined;}
  catch(e){if(!(e instanceof BindingCommitIntegrityError))throw e;return {binding,proof:undefined};}
  if(pending) {
    const proof=preparePossession(root,pending.instance);
    if(!proof)return {binding:pending,proof:undefined};
    return {binding:pending,proof};
  }
  const proof = binding && deps.verifyProof(binding) ? preparePossession(root, binding.instance) : undefined;
  if (binding && proof) return { binding, proof };
  memo.value ??= { action: 'mint', ...deps.mint() };
  options.beforePublish?.(memo.value, { identity: true });
  const mintedProof = preparePossession(root, memo.value.instance);
  if (!mintedProof) throw new BindingCommitIntegrityError('binding possession prerequisites missing');
  return { binding, proof: mintedProof };
}

function transact(root: string, key: IdentityBindingKey, deps: ReclaimOrMintDeps, memo: {value?: ReclaimOrMintResult},
  prepared: ReturnType<typeof prepareTransaction>, lease: IdentityFenceLease): ReclaimOrMintResult {
  if(!prepared.proof)throw new BindingFenceStaleError();
  const existing = findBinding(root, key);
  if (existing?.instance !== prepared.binding?.instance || !receiptMatches(root, prepared.proof)) throw new BindingFenceStaleError();
  if (existing && prepared.proof.instance === existing.instance) {
    return withPossession(root, prepared.proof, () => ({action:'reclaim',instance:existing.instance,agentUuid:existing.agentUuid}));
  }
  if (!memo.value) throw new BindingCommitIntegrityError('mint candidate unavailable');
  commitBinding(identityDir(root), {...key,instance:memo.value.instance,agentUuid:memo.value.agentUuid,at:new Date(deps.now()).toISOString()},
    lease.token!, prepared.proof, lease.stillHeld, lease.beginMutation, lease.endMutation);
  return memo.value;
}

export function reclaimOrMint(root: string, key: IdentityBindingKey, deps: ReclaimOrMintDeps,
  options: ReclaimOrMintOptions = {}): ReclaimOrMintResult {
  ensureDurableDirectory(identityDir(root));
  const end = performance.now() + (options.deadlineMs ?? options.timeoutMs ?? 5000);
  const memo: {value?: ReclaimOrMintResult} = {};
  options={...options,signal:options.signal ?? new AbortController().signal};
  for (;;) {
    try {
      const prepared = prepareTransaction(root, key, deps, options, memo);
      return withIdentityFenceSync(bindingsLock(root), lease => transact(root,key,deps,memo,prepared,lease),
      {...options, timeoutMs:Math.max(0,end-performance.now())}); }
    catch(e) {
      // The short registry wait is one preparation attempt within the original deadline.
      const contention = e instanceof LockTimeoutError && e.lockPath === join(root, "registry", ".lock");
      if ((!(e instanceof BindingFenceStaleError) && !contention) || performance.now() >= end) throw e;
    }
  }
}

export async function reclaimOrMintAsync(root: string, key: IdentityBindingKey, deps: ReclaimOrMintDeps,
  options: ReclaimOrMintOptions = {}): Promise<ReclaimOrMintResult> {
  ensureDurableDirectory(identityDir(root));
  const end = performance.now() + (options.deadlineMs ?? options.timeoutMs ?? 5000);
  const memo: {value?: ReclaimOrMintResult} = {};
  options={...options,signal:options.signal ?? new AbortController().signal};
  for (;;) {
    try {
      const prepared = prepareTransaction(root,key,deps,options,memo);
      return await withIdentityFence(bindingsLock(root), lease => transact(root,key,deps,memo,prepared,lease),
      {...options, timeoutMs:Math.max(0,end-performance.now())}); }
    catch(e) {
      const contention = e instanceof LockTimeoutError && e.lockPath === join(root, "registry", ".lock");
      if ((!(e instanceof BindingFenceStaleError) && !contention) || performance.now() >= end) throw e;
      await new Promise(r=>setTimeout(r,0));
    }
  }
}

// ── H4: RoleAgentAttestationV1 (r2 §8.1 H4; §2.4 level-1 anchor) ────────────

/**
 * The frozen format literal of the H4 role-agent attestation.
 */
export const H2A_ROLE_AGENT_ATTESTATION_V1_FORMAT = "h2a.role-agent-attestation/v1";

/**
 * H4 — role-agent attestation, the level-1 enrolment evidence stored by
 * cluster-mesh (r2 §8.1 H4). The anchor is the perennial
 * (`agentUuid`, `launchName`) pair (§2.4), NEVER the per-conversation instance
 * id: `attestingInstance` is correlation only. The signature is ed25519 over
 * the canonical bytes of the document EXCLUDING the `signature` field, by a
 * mandated instance key verifiable through the H2 registry reader. Re-attestation
 * is required on key rotation: a superseded `keySetRevision` refuses at the next
 * call (§2.7).
 */
export interface RoleAgentAttestationV1 {
  readonly format: typeof H2A_ROLE_AGENT_ATTESTATION_V1_FORMAT;
  readonly agentUuid: string;
  /** The L1 anchor (§2.4). */
  readonly launchName: string;
  /** The H1 policy key. */
  readonly actorLaunchName: string;
  readonly scope: string;
  /** Correlation; NOT the anchor. */
  readonly attestingInstance: string;
  readonly keySetRevision: string;
  readonly keyIds: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt?: string;
  readonly signerInstance: string;
  readonly signerKeyId: string;
  readonly signature: string;
}

export interface RoleAgentAttestationInput {
  readonly agentUuid: string;
  readonly launchName: string;
  readonly actorLaunchName: string;
  readonly scope: string;
  readonly attestingInstance: string;
  readonly keySetRevision: string;
  readonly keyIds: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt?: string;
  readonly signer: {
    readonly instance: string;
    readonly keyId: string;
    readonly privateKeyPem: string;
  };
}

export type RoleAgentAttestationVerdict =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "unknown_format"
        | "unknown_version"
        | "unknown_field"
        | "malformed_field"
        | "expired"
        | "bad_signature"
        | "signer_key_unavailable"
        | "key_set_revision_superseded";
    };

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`buildRoleAgentAttestationV1: ${field} must be a non-empty string`);
  }
  return value;
}

/**
 * The signed document of an attestation: every field EXCEPT `signature`, so the
 * canonical bytes are exactly what the signer signed.
 */
function attestationDocument(att: RoleAgentAttestationV1): Record<string, unknown> {
  return {
    format: att.format,
    agentUuid: att.agentUuid,
    launchName: att.launchName,
    actorLaunchName: att.actorLaunchName,
    scope: att.scope,
    attestingInstance: att.attestingInstance,
    keySetRevision: att.keySetRevision,
    keyIds: [...att.keyIds],
    issuedAt: att.issuedAt,
    ...(att.expiresAt !== undefined ? { expiresAt: att.expiresAt } : {}),
    signerInstance: att.signerInstance,
    signerKeyId: att.signerKeyId
  };
}

/**
 * Build and sign an H4 attestation. Pure: the caller supplies the signer's
 * private key (never stored, never exported); the returned attestation carries
 * only the signature value.
 */
export function buildRoleAgentAttestationV1(input: RoleAgentAttestationInput): RoleAgentAttestationV1 {
  requireNonEmptyString(input.agentUuid, "agentUuid");
  requireNonEmptyString(input.launchName, "launchName");
  requireNonEmptyString(input.actorLaunchName, "actorLaunchName");
  requireNonEmptyString(input.scope, "scope");
  requireNonEmptyString(input.attestingInstance, "attestingInstance");
  requireNonEmptyString(input.keySetRevision, "keySetRevision");
  requireNonEmptyString(input.issuedAt, "issuedAt");
  if (input.expiresAt !== undefined) requireNonEmptyString(input.expiresAt, "expiresAt");
  if (!Array.isArray(input.keyIds) || input.keyIds.length === 0) {
    throw new Error("buildRoleAgentAttestationV1: keyIds must be a non-empty array");
  }
  for (const keyId of input.keyIds) requireNonEmptyString(keyId, "keyIds entry");
  requireNonEmptyString(input.signer.instance, "signer.instance");
  requireNonEmptyString(input.signer.keyId, "signer.keyId");
  requireNonEmptyString(input.signer.privateKeyPem, "signer.privateKeyPem");

  const document = attestationDocument({
    format: H2A_ROLE_AGENT_ATTESTATION_V1_FORMAT,
    agentUuid: input.agentUuid,
    launchName: input.launchName,
    actorLaunchName: input.actorLaunchName,
    scope: input.scope,
    attestingInstance: input.attestingInstance,
    keySetRevision: input.keySetRevision,
    keyIds: [...input.keyIds],
    issuedAt: input.issuedAt,
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    signerInstance: input.signer.instance,
    signerKeyId: input.signer.keyId,
    signature: ""
  });
  const signature = signCanonical(document, {
    by: input.signer.instance,
    privateKeyPem: input.signer.privateKeyPem
  });
  return Object.freeze({ ...document, signature: signature.value } as RoleAgentAttestationV1);
}

/**
 * Classify a candidate attestation BEFORE any signature work. Every refusal is
 * named: a foreign `format` literal is an `unknown_version` refusal (M0 negative
 * vector VEC-NEG-UNKNOWN-VERSION); a document with no recognizable format at
 * all is `unknown_format`; an out-of-schema property is `unknown_field`; a
 * required field that is missing, empty or mistyped (including an empty or
 * non-string `keyIds` entry) is `malformed_field`.
 */
function roleAgentAttestationProblem(
  value: unknown
): "unknown_format" | "unknown_version" | "unknown_field" | "malformed_field" | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "unknown_format";
  }
  const v = value as Record<string, unknown>;
  if (typeof v.format !== "string") return "unknown_format";
  if (v.format !== H2A_ROLE_AGENT_ATTESTATION_V1_FORMAT) return "unknown_version";
  const expected = new Set([
    "format", "agentUuid", "launchName", "actorLaunchName", "scope",
    "attestingInstance", "keySetRevision", "keyIds", "issuedAt",
    "signerInstance", "signerKeyId", "signature"
  ]);
  if (v.expiresAt !== undefined) expected.add("expiresAt");
  const keys = Object.keys(v);
  if (keys.some((key) => !expected.has(key))) return "unknown_field";
  if (keys.length < expected.size) return "malformed_field";
  for (const field of [
    "format", "agentUuid", "launchName", "actorLaunchName", "scope",
    "attestingInstance", "keySetRevision", "issuedAt",
    "signerInstance", "signerKeyId", "signature"
  ]) {
    if (typeof v[field] !== "string" || (v[field] as string).length === 0) {
      return "malformed_field";
    }
  }
  if (v.expiresAt !== undefined && (typeof v.expiresAt !== "string" || (v.expiresAt as string).length === 0)) {
    return "malformed_field";
  }
  if (
    !Array.isArray(v.keyIds) ||
    v.keyIds.length === 0 ||
    v.keyIds.some((keyId) => typeof keyId !== "string" || keyId.length === 0)
  ) {
    return "malformed_field";
  }
  return null;
}

/**
 * Verify an H4 attestation against the H2 registry read port. The signer key is
 * resolved by (`signerInstance`, `signerKeyId`) through the consumer's own H2
 * reader (cluster-mesh side); only literal key resolution + signature +
 * key-set-revision checks live here. Every refusal is named — never a silent
 * acceptance. When the consumer supplies `now` (an ISO-8601 instant), an
 * attestation whose `expiresAt` is not strictly in the future refuses with
 * `expired`; an unparseable `expiresAt` or `now` refuses with `malformed_field`
 * (fail-closed on either side).
 */
export function verifyRoleAgentAttestationV1(
  attestation: unknown,
  deps: {
    resolveSignerKey(signerInstance: string, signerKeyId: string): string | undefined;
    /** When supplied, a mismatching key-set revision refuses (key rotation). */
    expectedKeySetRevision?: string;
    /**
     * Optional evaluation instant (ISO-8601). When absent the current time
     * applies — an expired `expiresAt` refuses with `expired` either way.
     * Must itself be parseable.
     */
    now?: string;
  }
): RoleAgentAttestationVerdict {
  const problem = roleAgentAttestationProblem(attestation);
  if (problem !== null) {
    return { ok: false, reason: problem };
  }
  const verified = attestation as RoleAgentAttestationV1;
  const publicKeyPem = deps.resolveSignerKey(verified.signerInstance, verified.signerKeyId);
  if (publicKeyPem === undefined) {
    return { ok: false, reason: "signer_key_unavailable" };
  }
  const signature: H2ASignature = {
    by: verified.signerInstance,
    alg: "ed25519",
    value: verified.signature
  };
  if (!verifyCanonical(attestationDocument(verified), signature, publicKeyPem)) {
    return { ok: false, reason: "bad_signature" };
  }
  if (
    deps.expectedKeySetRevision !== undefined &&
    deps.expectedKeySetRevision !== verified.keySetRevision
  ) {
    return { ok: false, reason: "key_set_revision_superseded" };
  }
  if (verified.expiresAt !== undefined) {
    const expiresMs = Date.parse(verified.expiresAt);
    if (Number.isNaN(expiresMs)) {
      return { ok: false, reason: "malformed_field" };
    }
    const nowMs = Date.parse(deps.now ?? new Date().toISOString());
    if (Number.isNaN(nowMs)) {
      return { ok: false, reason: "malformed_field" };
    }
    if (expiresMs <= nowMs) {
      return { ok: false, reason: "expired" };
    }
  }
  return { ok: true };
}

/**
 * The revision of a key set: a deterministic digest over the sorted key ids.
 * Key rotation (add or revoke) changes it, so a re-attestation is detectably
 * required (§2.7: a superseded `keySetRevision` refuses at the next call).
 */
export function computeKeySetRevision(keyIds: readonly string[]): string {
  if (!Array.isArray(keyIds)) {
    throw new Error("computeKeySetRevision: keyIds must be an array of strings");
  }
  const sorted = [...keyIds].sort();
  const digest = createHash("sha256").update(JSON.stringify(sorted), "utf8").digest("hex");
  return `sha256:${digest}`;
}

// ── Estate inventory (§2.4 estate migration / R2-P1-5) ───────────────────────

export interface EstateMemorialAgentEntry {
  readonly agentUuid: string;
  readonly launchName: string;
  readonly instances: readonly string[];
  /** Perennial binding rows backing this agent (the reclaim records). */
  readonly bindings: number;
}

export type EstateResolutionKind =
  | "registration_without_perennial_binding"
  | "launch_name_claimed_by_two_agents"
  | "agent_uuid_multi_launch_name"
  | "agent_without_launch_name";

export interface EstateResolutionItem {
  readonly kind: EstateResolutionKind;
  readonly detail: string;
  readonly agentUuids: readonly string[];
  readonly instances: readonly string[];
  readonly launchName?: string;
}

export interface EstateInventoryReportV1 {
  readonly format: "h2a.estate-inventory/v1";
  readonly memorialAgents: readonly EstateMemorialAgentEntry[];
  readonly resolutionQueue: readonly EstateResolutionItem[];
}

export type EstateRegistrationRow = Pick<
  H2AActorRegistration,
  "id" | "instance" | "agentUuid" | "name" | "createdAt"
>;

export interface EstateInventoryInput {
  /**
   * Registrations, as read from the local-files store. Synthetic inputs only —
   * this function never reads a real `~/.h2a` (callers pass arrays, and the
   * owner resolution it reports is decided by a human, never merged here).
   */
  readonly registrations: readonly EstateRegistrationRow[];
  /** Identity binding rows, as read from `listBindings`. */
  readonly bindings: readonly H2AIdentityBinding[];
}

/**
 * Pure estate-inventory collision detector (§2.4 estate migration; R2-P1-5):
 * one `MemorialAgent` per distinct `agentUuid` carrying a launch-name binding.
 * Registrations without a perennial binding, and launch names claimed by two
 * `agentUuid`s, go to an owner resolution queue — NEVER auto-merged: this
 * function produces a report only, has no write path, and resolves nothing.
 * Until resolved, a queued entry has no level-1 record.
 */
export function inventoryEstate(input: EstateInventoryInput): EstateInventoryReportV1 {
  const queue: EstateResolutionItem[] = [];
  const bindingCount = new Map<string, number>();
  for (const binding of input.bindings) {
    if (typeof binding.agentUuid !== "string" || binding.agentUuid.length === 0) continue;
    bindingCount.set(binding.agentUuid, (bindingCount.get(binding.agentUuid) ?? 0) + 1);
  }

  // Registrations grouped by their perennial anchor; un-anchored rows are queued.
  const byAgent = new Map<string, EstateRegistrationRow[]>();
  for (const reg of input.registrations) {
    if (typeof reg.agentUuid !== "string" || reg.agentUuid.length === 0) {
      queue.push({
        kind: "registration_without_perennial_binding",
        detail: `registration ${reg.id} carries no perennial agentUuid binding`,
        agentUuids: [],
        instances: [reg.instance]
      });
      continue;
    }
    const group = byAgent.get(reg.agentUuid) ?? [];
    group.push(reg);
    byAgent.set(reg.agentUuid, group);
    if (!bindingCount.has(reg.agentUuid)) {
      // Anchored on the registration, but no perennial binding row backs it:
      // no reclaim record exists, so the owner must resolve it.
      queue.push({
        kind: "registration_without_perennial_binding",
        detail: `registration ${reg.id} carries agentUuid ${reg.agentUuid} but has no perennial binding row`,
        agentUuids: [reg.agentUuid],
        instances: [reg.instance]
      });
    }
  }

  // Perennial ids that appear only in bindings (no registration at all).
  for (const agentUuid of bindingCount.keys()) {
    if (!byAgent.has(agentUuid)) {
      byAgent.set(agentUuid, []);
    }
  }

  // Resolve each agent's launch name (mint-time `name`; F5 forbids parsing the
  // instance handle back, so the registration record is the launch-name source).
  const launchNameOf = new Map<string, string>();
  const instancesOf = new Map<string, string[]>();
  for (const [agentUuid, regs] of byAgent) {
    const instances = [...new Set(regs.map((reg) => reg.instance))].sort();
    instancesOf.set(agentUuid, instances);
    const named = regs
      .filter((reg) => typeof reg.name === "string" && reg.name.length > 0)
      .sort((a, b) =>
        a.createdAt !== b.createdAt
          ? a.createdAt < b.createdAt
            ? -1
            : 1
          : a.id < b.id
            ? -1
            : 1
      );
    if (named.length === 0) {
      queue.push({
        kind: "agent_without_launch_name",
        detail: `agentUuid ${agentUuid} has no registration carrying a launch name`,
        agentUuids: [agentUuid],
        instances
      });
      continue;
    }
    // One agentUuid carrying TWO DISTINCT launch names is an owner conflict:
    // never auto-merged, never silently resolved to the earliest name. No
    // MemorialAgent is minted until the owner picks the launch name.
    const distinctNames = [...new Set(named.map((reg) => reg.name as string))];
    if (distinctNames.length > 1) {
      queue.push({
        kind: "agent_uuid_multi_launch_name",
        detail:
          `agentUuid ${agentUuid} carries ${distinctNames.length} distinct launch names: ` +
          distinctNames.map((name) => JSON.stringify(name)).join(", "),
        agentUuids: [agentUuid],
        instances
      });
      continue;
    }
    launchNameOf.set(agentUuid, named[0].name as string);
  }

  // Launch names claimed by two agentUuids: queued, never merged.
  const claimantsOf = new Map<string, string[]>();
  for (const [agentUuid, launchName] of launchNameOf) {
    const claimants = claimantsOf.get(launchName) ?? [];
    claimants.push(agentUuid);
    claimantsOf.set(launchName, claimants);
  }
  const conflicted = new Set<string>();
  for (const [launchName, claimants] of claimantsOf) {
    if (claimants.length < 2) continue;
    const agentUuids = [...claimants].sort();
    for (const agentUuid of agentUuids) conflicted.add(agentUuid);
    queue.push({
      kind: "launch_name_claimed_by_two_agents",
      detail: `launch name ${JSON.stringify(launchName)} is claimed by ${agentUuids.length} agentUuids: ${agentUuids.join(", ")}`,
      agentUuids,
      instances: agentUuids.flatMap((agentUuid) => instancesOf.get(agentUuid) ?? []).sort(),
      launchName
    });
  }

  const memorialAgents: EstateMemorialAgentEntry[] = [];
  for (const [agentUuid, launchName] of launchNameOf) {
    if (conflicted.has(agentUuid)) continue;
    memorialAgents.push({
      agentUuid,
      launchName,
      instances: instancesOf.get(agentUuid) ?? [],
      bindings: bindingCount.get(agentUuid) ?? 0
    });
  }
  memorialAgents.sort((a, b) => (a.agentUuid < b.agentUuid ? -1 : a.agentUuid > b.agentUuid ? 1 : 0));
  queue.sort((a, b) =>
    a.kind !== b.kind ? (a.kind < b.kind ? -1 : 1) : a.detail < b.detail ? -1 : 1
  );

  return {
    format: "h2a.estate-inventory/v1",
    memorialAgents,
    resolutionQueue: queue
  };
}
