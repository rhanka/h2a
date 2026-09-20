import { createHash, generateKeyPairSync } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { hostname } from "node:os";
import { basename, join } from "node:path";

import {
  deriveInstanceId,
  deriveWorkspaceId,
  mintAgentUuid,
  signCanonical,
  type H2AActorRegistration,
  type H2AWorkspaceRef
} from "@sentropic/h2a";

import { createLocalStore } from "../local-files/store.js";
import { getActiveMcpTrace } from "../mcp/phase-trace.js";
import { findBinding, reclaimOrMint, reclaimOrMintAsync, verifyReclaimProof } from "./bindings.js";
import {
  decideLegacyAdoption,
  legacyAliasAlreadyAdopted,
  recordIdentityAlias
} from "./migration.js";
import { defaultProviderSessionReaders, readHostSessionName } from "./readers.js";
import { resolveProviderSession, type ProviderSessionReaders } from "./resolver.js";
import { durableWorkspaceId } from "./workspace-id.js";

/**
 * The CLOSED vocabulary an agent may DECLARE at registration.
 *
 * DISPLAY ONLY, and NON-AUTHORITATIVE. Self-reported by the agent, and it MUST
 * NEVER be an input to any authorization decision, anywhere — not in h2a, not in
 * a gateway, not in a UI. Authorization is the principal binding plus
 * server-side scoping; a capability string proves nothing. (Binding condition #3
 * of the session-exposure feed contract ratified 2026-07-24,
 * docs/superpowers/specs/2026-07-24-h2a-feed-contract-for-sentropic.md.)
 *
 * These values are written to `H2AActorRegistration.declaredCapabilities` and
 * NEVER to `capabilities` — the latter is the authority-bearing rights list read
 * by the subagent ceiling (`subagents.ts` `capabilities-exceed-parent`) and by
 * `canAttestComprehension`. Writing display vocabulary there would widen a
 * privilege ceiling as a side effect of a display feature, which is exactly the
 * defect the architect's 2026-07-25 split ruling removes. The two fields must
 * never be merged.
 *
 * Note why "no vocabulary member may ever equal a right string" is NOT a
 * sufficient guard, and is not relied upon here: the subagent ceiling is a
 * SUBSET check over the whole field, not a lookup of specific right strings — so
 * that invariant holds for these three values and the ceiling still widens.
 * Separation of fields is the mitigation; string choice is not.
 *
 * Closed on purpose: an unknown string is DROPPED rather than stored, so the
 * set a consumer can ever render stays enumerable and reviewable.
 */
export const H2A_DECLARED_CAPABILITIES = [
  /** The agent can open/hold h2a sessions (presence + heartbeat). */
  "h2a.session",
  /** The agent is reachable over an MCP channel. */
  "h2a.mcp",
  /** The agent can fan work out to subagents. */
  "h2a.subagents"
] as const;

export type H2ADeclaredCapability = (typeof H2A_DECLARED_CAPABILITIES)[number];

/**
 * What the CLI's own registration path declares. Narrower than the vocabulary
 * on purpose: these two are true of every h2a CLI agent by construction, while
 * `h2a.subagents` is host-specific and not knowable at this call site — an
 * over-claim would be a lie in a browser panel, so it is left to a host plugin
 * that actually knows.
 */
export const H2A_CLI_DECLARED_CAPABILITIES: readonly H2ADeclaredCapability[] = [
  "h2a.session",
  "h2a.mcp"
];

/**
 * Keep only members of the closed vocabulary, de-duplicated and in vocabulary
 * order, so what lands in the registry is never caller-shaped free text.
 */
export function sanitizeDeclaredCapabilities(
  capabilities: readonly string[] | undefined
): H2ADeclaredCapability[] {
  if (!capabilities || capabilities.length === 0) return [];
  return H2A_DECLARED_CAPABILITIES.filter((known) => capabilities.includes(known));
}

export interface ResolveLiveIdentityInput {
  readonly root: string;
  readonly host: string;
  readonly cwd: string;
  readonly explicitInstance?: string;
  readonly name?: string;
  readonly scopes?: readonly string[];
  /**
   * Capabilities the agent DECLARES at mint (display-only, non-authoritative —
   * see {@link H2A_DECLARED_CAPABILITIES}). Filtered against the closed
   * vocabulary; anything else is dropped. Written to the registration's
   * `declaredCapabilities`, never to the authority-bearing `capabilities`.
   * Absent → the field is omitted.
   */
  readonly declaredCapabilities?: readonly string[];
  readonly readers?: ProviderSessionReaders;
  readonly now?: () => number;
}

export interface ResolvedLiveIdentity {
  readonly instance: string;
  readonly host: string;
  readonly workspace?: H2AWorkspaceRef;
  readonly name?: string;
  readonly legacyInstance?: string;
  readonly action: "override" | "reclaim" | "mint";
  readonly providerSessionSource?: string;
  /**
   * The host-native provider session id actually read (Claude
   * CLAUDE_CODE_SESSION_ID / Codex thread id), when one was readable. Exposed so
   * the caller can build a heartbeat display-name refresher against the same
   * conversation this identity resolved from (spec
   * 2026-07-25-h2a-lane-addressing §D1b). Absent when no provider session was
   * readable — do NOT substitute the synthetic `fallback:` id here, it names no
   * transcript.
   */
  readonly providerSessionId?: string;
  readonly privateKeyPath?: string;
  readonly publicKeyPath?: string;
  readonly migrationNotice?: string;
}

function safeKeyName(instance: string): string {
  return instance.replace(/[:/]/g, "-");
}

export function identityKeyPaths(root: string, instance: string): { privateKeyPath: string; publicKeyPath: string } {
  const keysDir = join(root, "keys");
  return {
    privateKeyPath: join(keysDir, `${safeKeyName(instance)}.key.pem`),
    publicKeyPath: join(keysDir, `${safeKeyName(instance)}.pub.pem`)
  };
}

function readMachineId(): string {
  for (const path of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      const id = readFileSync(path, "utf8").trim();
      if (id.length > 0) return id;
    } catch {
      // try the next source
    }
  }
  return hostname() || "unknown-machine";
}

function realWorkspacePath(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
}

function labelFromCwd(cwd: string): string {
  return basename(cwd) || "workspace";
}

/**
 * Short, stable, NON-SECRET fingerprint of a public key: the first 16 hex chars
 * of its sha256. Used by the reclaim proof's nonce and by the enrollment
 * ceremony's owner-facing summary, so the owner can eyeball WHICH key was
 * proved without ever reading a PEM. It is a label, never an authority: nothing
 * may accept a fingerprint where it should verify a signature.
 */
export function publicKeyFingerprint(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem, "utf8").digest("hex").slice(0, 16);
}

function remoteBridgeInstance(providerSessionId: string): string {
  return providerSessionId.startsWith("remote:")
    ? providerSessionId
    : `remote:${providerSessionId}`;
}

function generateKeypair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString()
  };
}

function readKeypair(root: string, instance: string):
  | { privateKeyPem: string; publicKeyPem: string; privateKeyPath: string; publicKeyPath: string }
  | undefined {
  const paths = identityKeyPaths(root, instance);
  if (!existsSync(paths.privateKeyPath) || !existsSync(paths.publicKeyPath)) return undefined;
  return {
    privateKeyPem: readFileSync(paths.privateKeyPath, "utf8"),
    publicKeyPem: readFileSync(paths.publicKeyPath, "utf8"),
    ...paths
  };
}

function ensureKeypair(
  root: string,
  instance: string,
  adoptFromInstance?: string
): { publicKeyPem: string; privateKeyPath: string; publicKeyPath: string } {
  const existing = readKeypair(root, instance);
  if (existing) {
    return {
      publicKeyPem: existing.publicKeyPem,
      privateKeyPath: existing.privateKeyPath,
      publicKeyPath: existing.publicKeyPath
    };
  }

  const paths = identityKeyPaths(root, instance);
  mkdirSync(join(root, "keys"), { recursive: true });
  const adopted = adoptFromInstance ? readKeypair(root, adoptFromInstance) : undefined;
  if (adopted) {
    copyFileSync(adopted.privateKeyPath, paths.privateKeyPath);
    copyFileSync(adopted.publicKeyPath, paths.publicKeyPath);
    return { publicKeyPem: adopted.publicKeyPem, ...paths };
  }

  const generated = generateKeypair();
  writeFileSync(paths.privateKeyPath, generated.privateKeyPem, { encoding: "utf8", mode: 0o600 });
  writeFileSync(paths.publicKeyPath, generated.publicKeyPem, "utf8");
  return { publicKeyPem: generated.publicKeyPem, ...paths };
}

/**
 * F5: cheaply remove a mint-race LOSER's orphan keypair files. When a contender
 * pre-registered a mint candidate (keys + registration + alias) but then RECLAIMED
 * a different instance under the lock, its candidate keypair is unused — unlink it
 * so a stray private key does not linger (N-1 per same-conversation burst). The
 * APPEND-ONLY registration/alias rows are NOT cheaply removable (that is exactly
 * the registry growth L3 compaction addresses) and are left for L3. Best-effort:
 * a failure never affects the resolved identity.
 */
function cleanupOrphanKeypair(root: string, instance: string): void {
  const paths = identityKeyPaths(root, instance);
  for (const p of [paths.privateKeyPath, paths.publicKeyPath]) {
    try {
      unlinkSync(p);
    } catch {
      /* already gone / never written — fine */
    }
  }
}

function provesLocalKey(root: string, instance: string): boolean {
  const store = createLocalStore({ root });
  const keypair = readKeypair(root, instance);
  if (!keypair) return false;
  const activeKeys = store.listInstanceKeys(instance);
  if (activeKeys.length === 0) return false;
  const nonce = `identity-reclaim:${instance}:${publicKeyFingerprint(keypair.publicKeyPem)}`;
  try {
    const signature = signCanonical(nonce, { by: instance, privateKeyPem: keypair.privateKeyPem });
    return verifyReclaimProof(nonce, signature, activeKeys);
  } catch {
    return false;
  }
}

function ensureRegistered(input: {
  readonly root: string;
  readonly instance: string;
  readonly agentUuid: string;
  readonly workspace: H2AWorkspaceRef;
  readonly name: string;
  readonly publicKeyPem: string;
  readonly scopes: readonly string[];
  /** Declared, display-only capabilities; already sanitized by the caller. */
  readonly declaredCapabilities: readonly string[];
  readonly now: () => number;
  /**
   * L2 (async path): a SHORT registry-lock timeout so the registration attempt
   * does not hold the identity lock through a long registry wait — the caller
   * releases the identity lock and retries outside the section (brief lock rule
   * "acquisition registry immédiate ; s'il est occupé, relâcher identity").
   */
  readonly lockTimeoutMs?: number;
  /**
   * L2 (async mint path): skip the pre-check reads (`findInstance` /
   * `listInstanceKeys`, each a full registry parse) and go straight to the
   * idempotent `registerInstance` — its dedup runs INSIDE the registry lock, so
   * a contended attempt fails on the lock wait WITHOUT parsing the registry.
   * The registry parse then runs at most once, only when the lock is acquired.
   */
  readonly skipExistingCheck?: boolean;
}): void {
  const store = createLocalStore({
    root: input.root,
    ...(input.lockTimeoutMs !== undefined ? { lockTimeoutMs: input.lockTimeoutMs } : {})
  });
  const buildRegistration = (): H2AActorRegistration => ({
    id: input.instance,
    instance: input.instance,
    roles: ["AGENTS"],
    scopes: [...input.scopes],
    // AUTHORITY-BEARING and intentionally left EMPTY, exactly as before this
    // workstream: it is the subagent ceiling and the attestation right. A
    // display list must never be written here (architect ruling, 2026-07-25).
    capabilities: [],
    endpoints: [{ kind: "local-files", uri: `file://${input.root}` }],
    publicKeys: [input.publicKeyPem],
    acceptedPolicies: [],
    agentUuid: input.agentUuid,
    workspace: input.workspace,
    name: input.name,
    createdAt: new Date(input.now()).toISOString(),
    // The declared DISPLAY list, kept structurally apart from `capabilities`.
    ...(input.declaredCapabilities.length > 0
      ? { declaredCapabilities: [...input.declaredCapabilities] }
      : {})
  });
  if (input.skipExistingCheck) {
    store.registerInstance(buildRegistration());
    return;
  }
  const existing = store.findInstance(input.instance);
  if (!existing) {
    store.registerInstance(buildRegistration());
    return;
  }
  if (!store.listInstanceKeys(input.instance).includes(input.publicKeyPem)) {
    store.addInstanceKey(input.instance, input.publicKeyPem);
  }
}

export function resolveLiveIdentity(input: ResolveLiveIdentityInput): ResolvedLiveIdentity {
  // L0 identity spans: provider resolution, key prep, proof, enrollment, alias.
  // NEVER a PEM or a private path in an event — only the phase and its timing.
  const trace = getActiveMcpTrace();
  const step = <T>(name: string, fn: () => T): T => (trace ? trace.span(name, fn) : fn());
  const host = input.host || "agent";
  const label = labelFromCwd(input.cwd);
  if (input.explicitInstance) {
    return { instance: input.explicitInstance, host, action: "override" };
  }

  const readers = input.readers ?? defaultProviderSessionReaders;
  const provider = step("identity_provider", () =>
    resolveProviderSession({ host, cwd: input.cwd, readers })
  );
  const realPath = realWorkspacePath(input.cwd);
  const workspaceId =
    durableWorkspaceId(realPath) ??
    provider.workspaceHint ??
    deriveWorkspaceId({ machineId: readMachineId(), path: realPath });
  const workspace: H2AWorkspaceRef = {
    id: workspaceId,
    path: realPath,
    host,
    label
  };
  const legacyInstance = `${host}:${label}`;
  const now = input.now ?? Date.now;
  const scopes = input.scopes?.length ? input.scopes : ["scope:default"];
  // WP-6: prefer the host-native session name (Claude customTitle / Codex thread_name)
  // over the cwd label. The explicit `--name` flag always takes precedence.
  const hostName = input.name === undefined
    ? readHostSessionName({ host, cwd: input.cwd, sessionId: provider.providerSessionId })
    : undefined;
  const name = input.name ?? hostName ?? label;

  // The mint candidate is memoized so the SAME identity is pre-registered (below)
  // and then committed — a would-be reclaim discards it, but it is never re-minted.
  let mintMemo: { instance: string; agentUuid: string } | undefined;
  const mint = () => {
    if (mintMemo) return mintMemo;
    const agentUuid = mintAgentUuid();
    mintMemo = { agentUuid, instance: deriveInstanceId({ host, label: name, uuid: agentUuid }) };
    return mintMemo;
  };
  const mintRemote = () => {
    if (mintMemo) return mintMemo;
    const agentUuid = mintAgentUuid();
    mintMemo = {
      agentUuid,
      instance: provider.providerSessionId
        ? remoteBridgeInstance(provider.providerSessionId)
        : deriveInstanceId({ host, label: name, uuid: agentUuid })
    };
    return mintMemo;
  };

  // Re-anchor: the conversation UUID is the identity unit. When no provider
  // session id is readable, fall back to a per-workspace-STABLE id (no
  // timestamp) so that degenerate case keeps the old per-workspace reclaim
  // behavior instead of minting a fresh id on every connect.
  const providerSessionId =
    provider.providerSessionId ?? `fallback:${host}:${workspace.id}`;
  const key = { host, providerSessionId, workspaceId: workspace.id };
  const legacyDecision = decideLegacyAdoption({
    legacyAlreadyAdopted: legacyAliasAlreadyAdopted(input.root, legacyInstance),
    provedLegacyPossession: provesLocalKey(input.root, legacyInstance)
  });
  const declared = sanitizeDeclaredCapabilities(input.declaredCapabilities);

  // F2(b): publish keyring / registration / alias for an instance. Callers invoke
  // this BEFORE the binding append (window closure BY ORDER), so a concurrent
  // reader — CLI OR MCP — can never observe a binding whose keyring is not yet
  // provable and mint a duplicate for the same (host, providerSessionId).
  const publishIdentity = (
    resolvedInstance: string,
    agentUuid: string,
    action: "reclaim" | "mint",
    opts: { skipExistingCheck?: boolean } = {}
  ): { publicKeyPem: string; privateKeyPath: string; publicKeyPath: string } => {
    const adoptedFrom = action === "mint" && legacyDecision.adopt ? legacyInstance : undefined;
    const keypair = step("identity_keys", () => ensureKeypair(input.root, resolvedInstance, adoptedFrom));
    step("identity_register", () =>
      ensureRegistered({
        root: input.root,
        instance: resolvedInstance,
        agentUuid,
        workspace,
        name,
        publicKeyPem: keypair.publicKeyPem,
        scopes,
        // Declared at mint only: an already-registered instance keeps whatever it
        // declared then. Nothing downstream may treat this list as authority, so a
        // narrow/empty list is a display gap, never a permission gap.
        declaredCapabilities: declared,
        now,
        ...(opts.skipExistingCheck ? { skipExistingCheck: true } : {})
      })
    );
    step("identity_alias", () =>
      recordIdentityAlias(input.root, {
        instance: resolvedInstance,
        legacyInstance,
        adoptedKeyring: Boolean(adoptedFrom),
        at: new Date(now()).toISOString()
      })
    );
    return keypair;
  };

  let keypair: { publicKeyPem: string; privateKeyPath: string; publicKeyPath: string };
  let result: { action: "reclaim" | "mint"; instance: string; agentUuid: string };
  if (host === "remote") {
    result = { action: "mint" as const, ...mintRemote() };
    keypair = publishIdentity(result.instance, result.agentUuid, "mint", { skipExistingCheck: true });
  } else {
    // Proof of the observed binding, computed before the lock; the binding write
    // still re-verifies proof UNDER the lock (no cache here), so a reclaim is
    // authoritative even if the binding changed between this read and the lock.
    const preBinding = findBinding(input.root, key);
    const preProof = preBinding
      ? step("identity_proof", () => provesLocalKey(input.root, preBinding.instance))
      : false;
    let mintKeypair: typeof keypair | undefined;
    if (!(preBinding && preProof)) {
      // Mint likely: publish keyring / registration / alias BEFORE the binding.
      const cand = mint();
      mintKeypair = publishIdentity(cand.instance, cand.agentUuid, "mint", { skipExistingCheck: true });
    }
    result = step("identity_binding", () =>
      reclaimOrMint(input.root, key, {
        verifyProof: (binding) =>
          step("identity_proof", () => provesLocalKey(input.root, binding.instance)),
        mint,
        now
      })
    );
    if (result.action === "mint") {
      keypair = mintKeypair ?? publishIdentity(result.instance, result.agentUuid, "mint", { skipExistingCheck: true });
    } else {
      // F5: we pre-registered a mint candidate but raced into a reclaim — unlink
      // the unused candidate's orphan keypair (append-only rows left for L3).
      if (mintKeypair && mintMemo && mintMemo.instance !== result.instance) {
        cleanupOrphanKeypair(input.root, mintMemo.instance);
      }
      keypair = publishIdentity(result.instance, result.agentUuid, "reclaim");
    }
  }
  trace?.phase("identity_action", { code: result.action });

  const existingBinding = findBinding(input.root, key);

  return {
    instance: result.instance,
    host,
    workspace,
    name,
    legacyInstance,
    action: result.action,
    providerSessionSource: provider.source,
    ...(provider.providerSessionId !== undefined
      ? { providerSessionId: provider.providerSessionId }
      : {}),
    privateKeyPath: keypair.privateKeyPath,
    publicKeyPath: keypair.publicKeyPath,
    migrationNotice:
      result.action === "mint" || !existingBinding
        ? `identity migration: ${result.instance} reads legacy ${legacyInstance}; ${legacyDecision.reason}`
        : undefined
  };
}

export interface ResolveLiveIdentityAsyncOptions {
  /** Cooperative cancellation propagated to the identity-lock wait. */
  readonly signal?: AbortSignal;
  /** Remaining budget (ms) bounding the identity-lock wait for this attempt. */
  readonly deadlineMs?: number;
  /**
   * Short registry-lock timeout for the registration write so a contended
   * attempt fails fast and releases the identity lock (instead of holding it
   * through a long registry wait), letting the worker retry outside the section.
   */
  readonly registryLockTimeoutMs?: number;
  /**
   * Memo shared across the worker's retry attempts so the mint CANDIDATE
   * (uuid + derived instance + its keypair) is generated ONCE — a retry reuses
   * the same candidate instead of minting (and generating a keypair) again.
   */
  readonly mintMemo?: { value?: { instance: string; agentUuid: string } };
  /**
   * Cache of the expensive OUTSIDE-lock reads (provider, proof, legacy decision —
   * each a full registry parse) shared across the worker's retry attempts, so a
   * contended retry does NOT re-parse the ~17 MB registry. Safe: the
   * authoritative reclaim/mint decision is re-made UNDER the lock (fresh
   * `findBinding` + a `verifyProof` that recomputes when the binding changed).
   */
  readonly prepCache?: { prepared?: unknown };
  /**
   * 0-based attempt index within the worker's retry loop. Only the FIRST attempt
   * (0) may trust a POSITIVE cached proof (it is ms-fresh vs. the pre-read); any
   * retry recomputes the proof under the lock, and a NEGATIVE cached proof is
   * ALWAYS recomputed under the lock (F2: a keyring published by a racing writer
   * between the pre-read and the lock must be seen, or a duplicate is minted).
   */
  readonly attempt?: number;
}

interface AsyncPrepared {
  readonly provider: ReturnType<typeof resolveProviderSession>;
  readonly workspace: H2AWorkspaceRef;
  readonly legacyInstance: string;
  readonly scopes: readonly string[];
  readonly name: string;
  readonly key: { readonly host: string; readonly providerSessionId: string; readonly workspaceId: string };
  readonly preBinding: ReturnType<typeof findBinding>;
  readonly preProof: boolean;
  readonly legacyDecision: ReturnType<typeof decideLegacyAdoption>;
  readonly declared: readonly H2ADeclaredCapability[];
}

/**
 * L2 async resolution used ONLY by the identity worker child.
 *
 * Same result and same security invariants as {@link resolveLiveIdentity}, with
 * two deliberate reductions that are safe to make off the parent's event loop:
 *
 *  1. **Proof outside the lock.** The existing binding is read and its
 *     proof-of-possession (keypair read + registry keyring parse + signature) is
 *     computed BEFORE the identity lock is taken, then re-checked under the lock
 *     against the binding actually found — so the ~17 MB registry parse and the
 *     ed25519 sign do NOT run inside the critical section on the reconnect
 *     (reclaim) hot path. If the binding raced (its instance changed under the
 *     lock), the proof for that row is recomputed inline (rare, correct).
 *  2. **Binding published last.** On a mint, the keyring / registration / alias
 *     are published inside the held lock BEFORE the binding row is appended, so
 *     no concurrent worker can see a binding whose keyring is not yet provable
 *     and mint a duplicate.
 *
 * The lock WAIT is asynchronous (cancellable between polls); a transaction
 * already entered under the lock still finishes cooperatively.
 */
export async function resolveLiveIdentityAsync(
  input: ResolveLiveIdentityInput,
  options: ResolveLiveIdentityAsyncOptions = {}
): Promise<ResolvedLiveIdentity> {
  const host = input.host || "agent";
  if (input.explicitInstance) {
    return { instance: input.explicitInstance, host, action: "override" };
  }
  const now = input.now ?? Date.now;
  // L0 (#249) spans, relocated to the worker: the ambient trace here is the
  // worker's `identity-child` trace, so provider/keys/register/alias/proof spans
  // fire on the worker's stderr instead of being lost off the parent loop.
  const trace = getActiveMcpTrace();
  const step = <T>(name: string, fn: () => T): T => (trace ? trace.span(name, fn) : fn());

  // Expensive OUTSIDE-lock reads are computed ONCE and cached across the worker's
  // retry attempts (a contended retry must not re-parse the ~17 MB registry).
  const cache = (options.prepCache ?? {}) as { prepared?: AsyncPrepared };
  if (!cache.prepared) {
    const label = labelFromCwd(input.cwd);
    const readers = input.readers ?? defaultProviderSessionReaders;
    const provider = step("identity_provider", () =>
      resolveProviderSession({ host, cwd: input.cwd, readers })
    );
    const realPath = realWorkspacePath(input.cwd);
    const workspaceId =
      durableWorkspaceId(realPath) ??
      provider.workspaceHint ??
      deriveWorkspaceId({ machineId: readMachineId(), path: realPath });
    const workspace: H2AWorkspaceRef = { id: workspaceId, path: realPath, host, label };
    const legacyInstance = `${host}:${label}`;
    const scopes = input.scopes?.length ? input.scopes : ["scope:default"];
    const hostName =
      input.name === undefined
        ? readHostSessionName({ host, cwd: input.cwd, sessionId: provider.providerSessionId })
        : undefined;
    const name = input.name ?? hostName ?? label;
    const providerSessionId = provider.providerSessionId ?? `fallback:${host}:${workspace.id}`;
    const key = { host, providerSessionId, workspaceId: workspace.id };
    // The binding read (small file) + its proof-of-possession (keypair read +
    // registry keyring parse + ed25519 sign) done OUTSIDE the lock.
    const preBinding = findBinding(input.root, key);
    const preProof = preBinding
      ? step("identity_proof", () => provesLocalKey(input.root, preBinding.instance))
      : false;
    const legacyDecision = decideLegacyAdoption({
      legacyAlreadyAdopted: legacyAliasAlreadyAdopted(input.root, legacyInstance),
      provedLegacyPossession: provesLocalKey(input.root, legacyInstance)
    });
    cache.prepared = {
      provider,
      workspace,
      legacyInstance,
      scopes,
      name,
      key,
      preBinding,
      preProof,
      legacyDecision,
      declared: sanitizeDeclaredCapabilities(input.declaredCapabilities)
    };
  }
  const P = cache.prepared;

  const mint = () => {
    if (options.mintMemo?.value) return options.mintMemo.value;
    const agentUuid = mintAgentUuid();
    const minted = { agentUuid, instance: deriveInstanceId({ host, label: P.name, uuid: agentUuid }) };
    if (options.mintMemo) options.mintMemo.value = minted;
    return minted;
  };
  const mintRemote = () => {
    if (options.mintMemo?.value) return options.mintMemo.value;
    const agentUuid = mintAgentUuid();
    const minted = {
      agentUuid,
      instance: P.provider.providerSessionId
        ? remoteBridgeInstance(P.provider.providerSessionId)
        : deriveInstanceId({ host, label: P.name, uuid: agentUuid })
    };
    if (options.mintMemo) options.mintMemo.value = minted;
    return minted;
  };

  const publishIdentity = (
    resolvedInstance: string,
    agentUuid: string,
    action: "reclaim" | "mint",
    opts: { skipExistingCheck?: boolean } = {}
  ): { publicKeyPem: string; privateKeyPath: string; publicKeyPath: string } => {
    const adoptedFrom = action === "mint" && P.legacyDecision.adopt ? P.legacyInstance : undefined;
    const keypair = step("identity_keys", () => ensureKeypair(input.root, resolvedInstance, adoptedFrom));
    step("identity_register", () =>
      ensureRegistered({
        root: input.root,
        instance: resolvedInstance,
        agentUuid,
        workspace: P.workspace,
        name: P.name,
        publicKeyPem: keypair.publicKeyPem,
        scopes: P.scopes,
        declaredCapabilities: P.declared,
        now,
        ...(options.registryLockTimeoutMs !== undefined
          ? { lockTimeoutMs: options.registryLockTimeoutMs }
          : {}),
        ...(opts.skipExistingCheck ? { skipExistingCheck: true } : {})
      })
    );
    step("identity_alias", () =>
      recordIdentityAlias(input.root, {
        instance: resolvedInstance,
        legacyInstance: P.legacyInstance,
        adoptedKeyring: Boolean(adoptedFrom),
        at: new Date(now()).toISOString()
      })
    );
    return keypair;
  };

  let keypair: { publicKeyPem: string; privateKeyPath: string; publicKeyPath: string };
  let result: { action: "reclaim" | "mint"; instance: string; agentUuid: string };

  if (host === "remote") {
    result = { action: "mint" as const, ...mintRemote() };
    keypair = publishIdentity(result.instance, result.agentUuid, "mint", { skipExistingCheck: true });
  } else {
    const willReclaim = Boolean(P.preBinding && P.preProof);
    let mintKeypair: typeof keypair | undefined;
    if (!willReclaim) {
      // Mint likely: publish keyring / registration / alias BEFORE the binding
      // append — window closure BY ORDER (a reader can only observe the binding
      // after its keyring is durable). Done OUTSIDE the tiny identity-lock
      // section; a contended attempt fails here on the SHORT registry timeout
      // (no registry parse, since the dedup runs inside the lock) and the worker
      // retries WITHOUT re-parsing (this prep is cached) and WITHOUT the identity
      // lock held.
      const cand = mint();
      mintKeypair = publishIdentity(cand.instance, cand.agentUuid, "mint", { skipExistingCheck: true });
    }
    // The critical section is now TINY: fresh findBinding + (reclaim | append).
    // No registry parse, no keygen, no proof sign under the identity lock on the
    // hot path. `reclaimOrMint*` remains the UNIQUE binding append.
    result = await reclaimOrMintAsync(
      input.root,
      P.key,
      {
        // F2 TOCTOU: trust the cached proof ONLY when it is a POSITIVE proof, for
        // the SAME binding, on the FIRST attempt (ms-fresh vs the pre-read).
        // Otherwise recompute the proof UNDER the lock:
        //  - negative cache: a racing (sync-order) writer may have published the
        //    keyring after our pre-read; not re-checking mints a DUPLICATE binding.
        //  - positive on a retry: a key may have been revoked during contention.
        //  - a changed binding: the cache is for a different row.
        verifyProof: (binding) => {
          const trustCache =
            (options.attempt ?? 0) === 0 &&
            binding.instance === P.preBinding?.instance &&
            P.preProof === true;
          return trustCache
            ? true
            : step("identity_proof", () => provesLocalKey(input.root, binding.instance));
        },
        mint,
        now
      },
      {
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {})
      }
    );
    if (result.action === "mint") {
      keypair =
        mintKeypair ??
        publishIdentity(result.instance, result.agentUuid, "mint", { skipExistingCheck: true });
    } else {
      // Reclaim (or raced into a reclaim): ensure the keyring/registration exist
      // (idempotent). Any pre-registered mint candidate we did not use is an
      // orphan registration with no binding — allowed (never a keyless binding).
      // F5: unlink the unused candidate's orphan KEYPAIR (cheap); the append-only
      // registration/alias rows are left for L3 compaction.
      if (mintKeypair && options.mintMemo?.value && options.mintMemo.value.instance !== result.instance) {
        cleanupOrphanKeypair(input.root, options.mintMemo.value.instance);
      }
      keypair = publishIdentity(result.instance, result.agentUuid, "reclaim");
    }
  }

  const existingBinding = findBinding(input.root, P.key);

  return {
    instance: result.instance,
    host,
    workspace: P.workspace,
    name: P.name,
    legacyInstance: P.legacyInstance,
    action: result.action,
    providerSessionSource: P.provider.source,
    ...(P.provider.providerSessionId !== undefined
      ? { providerSessionId: P.provider.providerSessionId }
      : {}),
    privateKeyPath: keypair.privateKeyPath,
    publicKeyPath: keypair.publicKeyPath,
    migrationNotice:
      result.action === "mint" || !existingBinding
        ? `identity migration: ${result.instance} reads legacy ${P.legacyInstance}; ${P.legacyDecision.reason}`
        : undefined
  };
}
