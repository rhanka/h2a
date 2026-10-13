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
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { commitBinding, pendingBindingWinner, bindingKeyHash } from "./binding-commit.js";
import { BindingCommitIntegrityError, BindingFenceStaleError, preparePossession, receiptMatches, withPossession } from "./possession.js";
import { ensureDurableDirectory } from "./durable.js";
import { LockTimeoutError } from "../local-files/locks.js";
import type { IdentityFenceOptions } from "../local-files/identity-fence.js";

import { verifyCanonical, type H2ASignature } from "@sentropic/h2a";

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
