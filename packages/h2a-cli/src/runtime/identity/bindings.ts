/**
 * Identity binding registry + proof-of-possession (DEC-116, F1 — the
 * load-bearing security fix).
 *
 * Reconnect de-collision binds the perennial identity to its stability unit
 * `(host, workspaceId)` — one identity per workspace per host, reused across
 * every provider session and fan-out (`providerSessionId` is recorded as a hint
 * but is NOT a match key; keying on it minted a fresh id per session, the
 * proliferation this fix removes). **RECLAIM requires proof-of-possession**: the
 * connector must sign a fresh nonce with the ed25519 key already bound to that
 * identity (verified against the instance's active keys). The provider session
 * id is a spoofable *routing hint* — never the authenticator. No valid
 * signature → **MINT** a fresh identity (so a process presenting a victim's
 * id/workspace, without the key, gets a new identity, not the victim's inbox).
 * The read → decide → append runs in ONE lock (no reclaim/mint race, F3).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { verifyCanonical, type H2ASignature } from "@sentropic/h2a";

import { localStorePaths, withLockSync } from "../local-files/index.js";

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
 * The latest binding for the identity's stability unit `(host, workspaceId)`
 * (append-only → last wins), or undefined.
 *
 * `providerSessionId` is intentionally NOT part of the match: it is an ephemeral
 * routing hint (e.g. `CLAUDE_CODE_SESSION_ID`, fresh per conversation and per
 * fan-out). Matching on it would mint a new perennial id for every session,
 * which is exactly the per-session proliferation DEC-116 exists to prevent. The
 * id is therefore perennial **per workspace per host**; reclaim across sessions
 * is still gated by proof-of-possession in `reclaimOrMint`.
 */
export function findBinding(root: string, key: IdentityBindingKey): H2AIdentityBinding | undefined {
  let found: H2AIdentityBinding | undefined;
  for (const b of listBindings(root)) {
    if (b.host === key.host && b.workspaceId === key.workspaceId) {
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
  });
}
