import { createHash, generateKeyPairSync } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
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
import { findBinding, reclaimOrMint, verifyReclaimProof } from "./bindings.js";
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
  readonly privateKeyPath?: string;
  readonly publicKeyPath?: string;
  readonly migrationNotice?: string;
}

function safeKeyName(instance: string): string {
  return instance.replace(/[:/]/g, "-");
}

function keyPaths(root: string, instance: string): { privateKeyPath: string; publicKeyPath: string } {
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
  const paths = keyPaths(root, instance);
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

  const paths = keyPaths(root, instance);
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
}): void {
  const store = createLocalStore({ root: input.root });
  const existing = store.findInstance(input.instance);
  if (!existing) {
    const registration: H2AActorRegistration = {
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
    };
    store.registerInstance(registration);
    return;
  }
  if (!store.listInstanceKeys(input.instance).includes(input.publicKeyPem)) {
    store.addInstanceKey(input.instance, input.publicKeyPem);
  }
}

export function resolveLiveIdentity(input: ResolveLiveIdentityInput): ResolvedLiveIdentity {
  const host = input.host || "agent";
  const label = labelFromCwd(input.cwd);
  if (input.explicitInstance) {
    return { instance: input.explicitInstance, host, action: "override" };
  }

  const readers = input.readers ?? defaultProviderSessionReaders;
  const provider = resolveProviderSession({ host, cwd: input.cwd, readers });
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

  const mint = () => {
    const agentUuid = mintAgentUuid();
    return {
      agentUuid,
      instance: deriveInstanceId({ host, label: name, uuid: agentUuid })
    };
  };
  const mintRemote = () => {
    const agentUuid = mintAgentUuid();
    return {
      agentUuid,
      instance: provider.providerSessionId
        ? remoteBridgeInstance(provider.providerSessionId)
        : deriveInstanceId({ host, label: name, uuid: agentUuid })
    };
  };

  // Re-anchor: the conversation UUID is the identity unit. When no provider
  // session id is readable, fall back to a per-workspace-STABLE id (no
  // timestamp) so that degenerate case keeps the old per-workspace reclaim
  // behavior instead of minting a fresh id on every connect.
  const providerSessionId =
    provider.providerSessionId ?? `fallback:${host}:${workspace.id}`;
  const result =
    host === "remote"
      ? { action: "mint" as const, ...mintRemote() }
      : reclaimOrMint(
          input.root,
          { host, providerSessionId, workspaceId: workspace.id },
          {
            verifyProof: (binding) => provesLocalKey(input.root, binding.instance),
            mint,
            now
          }
        );

  const existingBinding = findBinding(input.root, {
    host,
    providerSessionId,
    workspaceId: workspace.id
  });
  const legacyDecision = decideLegacyAdoption({
    legacyAlreadyAdopted: legacyAliasAlreadyAdopted(input.root, legacyInstance),
    provedLegacyPossession: provesLocalKey(input.root, legacyInstance)
  });
  const adoptedFrom =
    result.action === "mint" && legacyDecision.adopt ? legacyInstance : undefined;
  const keypair = ensureKeypair(input.root, result.instance, adoptedFrom);
  ensureRegistered({
    root: input.root,
    instance: result.instance,
    agentUuid: result.agentUuid,
    workspace,
    name,
    publicKeyPem: keypair.publicKeyPem,
    scopes,
    // Declared at mint only: an already-registered instance keeps whatever it
    // declared then. Nothing downstream may treat this list as authority, so a
    // narrow/empty list is a display gap, never a permission gap.
    declaredCapabilities: sanitizeDeclaredCapabilities(input.declaredCapabilities),
    now
  });
  recordIdentityAlias(input.root, {
    instance: result.instance,
    legacyInstance,
    adoptedKeyring: Boolean(adoptedFrom),
    at: new Date(now()).toISOString()
  });

  return {
    instance: result.instance,
    host,
    workspace,
    name,
    legacyInstance,
    action: result.action,
    providerSessionSource: provider.source,
    privateKeyPath: keypair.privateKeyPath,
    publicKeyPath: keypair.publicKeyPath,
    migrationNotice:
      result.action === "mint" || !existingBinding
        ? `identity migration: ${result.instance} reads legacy ${legacyInstance}; ${legacyDecision.reason}`
        : undefined
  };
}
