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

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { verifyCanonical, type H2ASignature } from "@sentropic/h2a";

import { localStorePaths, withLockSync } from "../local-files/index.js";

/**
 * The one protocol accepted by the DEF identity-binding writer.  The cull
 * executor uses the same sentinel and refuses a writer inventory that cannot
 * prove this epoch-bearing protocol for every binding write path.
 */
export const IDENTITY_BINDING_FENCE_PROTOCOL = "identity-binding-fence-v1";

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
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as H2AIdentityBinding);
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
export function reclaimOrMint(
  root: string,
  key: IdentityBindingKey,
  deps: ReclaimOrMintDeps
): ReclaimOrMintResult {
  mkdirSync(identityDir(root), { recursive: true });
  return withLockSync(bindingsLock(root), () => {
    const existing = findBinding(root, key);
    if (existing && deps.verifyProof(existing)) {
      return { action: "reclaim", instance: existing.instance, agentUuid: existing.agentUuid };
    }
    const minted = deps.mint();
    appendFileSync(
      bindingsFile(root),
      `${JSON.stringify({ ...key, instance: minted.instance, agentUuid: minted.agentUuid, at: new Date(deps.now()).toISOString() } satisfies H2AIdentityBinding)}\n`,
      "utf8"
    );
    return { action: "mint", instance: minted.instance, agentUuid: minted.agentUuid };
  }, {
    ownerMetadata: {
      protocol: IDENTITY_BINDING_FENCE_PROTOCOL,
      fenceEpoch: randomUUID()
    },
    // A cull fence is fail-closed.  Reclaiming an apparently stale sentinel
    // would turn an ambiguous owner/fence state into a concurrent write.
    reclaimStale: false
  });
}
