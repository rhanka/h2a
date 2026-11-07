// R23 seat source of record: every bench seat is sourced from the llm-mesh
// account store — the enrolled account decides, never the OS keyring and
// never a MISTRAL_API_KEY requirement. This module is the single authority
// mapping a bench CLI to its mesh provider and resolving the seat bytes:
// - vibe (mistral-vibe): bytes come from the mesh account itself, through
//   the public facade acquire/release pair (target mistral, transport
//   mistral-vibe — the pair the mesh uses to serve the minted key, see the
//   POLL_ENROLLMENT_SERVING_IDS map mesh-side). The key travels only into
//   the harness seat file; the lease is released immediately after.
// - claude (claude-code), codex, muse, agy (cloud-code): bytes stay the
//   live CLI login files (the allowlisted stores the mesh CLI-import legs
//   read for muse/claude-code, the live owner logins otherwise — the mesh
//   holds no CLI-file projection for OAuth/device families and no export
//   API at all), gated on the mesh enrollment.
// A CLI with no enrolled account refuses names-only as
// seat-not-enrolled-in-llm-mesh:<cli> with the exact enroll command (this
// module never enrolls). An unreadable mesh store refuses as
// llm-mesh-store-unreachable:<cli> with the store cause.
import { hostname } from 'node:os';

// Neither the published enrollment command nor the consumer envelope contract
// supports this CLI yet. Never synthesize an owner command or alias its identity.
export const OPENCODE_SEAT_CONTRACT = Object.freeze({
  reason: 'llm-mesh-seat-contract-unavailable:opencode', enrollmentCommand: null,
});

// Bench CLI -> mesh enrollment provider + the exact owner enroll command.
// Provider ids follow the mesh accountTransportProviderIds contract
// (codex, cloud-code, claude-code, muse, mistral-vibe).
export const MESH_SEAT_PROVIDERS = Object.freeze({
  claude: Object.freeze({ provider: 'claude-code', enroll: 'h2a llm-mesh account enroll claude-code' }),
  codex: Object.freeze({ provider: 'codex', enroll: 'h2a llm-mesh account enroll codex' }),
  muse: Object.freeze({ provider: 'muse', enroll: 'h2a llm-mesh account enroll muse' }),
  agy: Object.freeze({ provider: 'cloud-code', enroll: 'h2a llm-mesh account enroll cloud-code' }),
  vibe: Object.freeze({ provider: 'mistral-vibe', enroll: 'h2a llm-mesh account enroll mistral-vibe' }),
});

// The serving pair the mesh uses for the vibe-minted key (mesh-side
// POLL_ENROLLMENT_SERVING_IDS: mistral-vibe -> [mistral, mistral-vibe]).
export const VIBE_SERVING_IDS = Object.freeze({
  targetProviderId: 'mistral', transportProviderId: 'mistral-vibe',
});

// Mesh owner scope: the same convention the h2a llm-mesh CLI uses
// (H2A_LLM_MESH_OWNER_SCOPE, else the local cli:<hostname> scope).
export function meshOwnerScope(env = process.env) {
  return env.H2A_LLM_MESH_OWNER_SCOPE?.trim() || `cli:${hostname()}`;
}

// Public facade entry point, re-exported from the mesh modules — never
// re-implemented here. The store is the one h2a uses at runtime:
// EncryptedFileKeyring at SENTROPIC_LLM_MESH_KEYRING_DIR ??
// ~/.sentropic/llm-mesh-keyring, opened through the same createLlmMeshFacade
// API the gateway uses (mode cli + legacyAccountOwnerScopeRef, like the h2a
// CLI facade wiring). keyringDir makes the store explicit and wins over the
// environment; without it the runtime default applies untouched. The config
// resolver honours H2A_LLM_MESH_CONFIG_JSON (scoped object or whole blob).
export async function createMeshSeatFacade({ ownerScope, keyringDir } = {}) {
  let createLlmMeshFacade = null;
  let EncryptedFileKeyring = null;
  try {
    ({ createLlmMeshFacade } = await import('@sentropic/llm-mesh/facade'));
    ({ EncryptedFileKeyring } = await import('@sentropic/llm-mesh/node'));
  } catch {
    throw new Error('llm-mesh-facade-unavailable');
  }
  const scope = ownerScope ?? meshOwnerScope();
  // Re-exported keyring, never re-implemented: an explicit dir pins the
  // runtime store; undefined keeps the runtime default (env, else owner
  // ~/.sentropic/llm-mesh-keyring) exactly as the h2a gateway opens it.
  const keyring = keyringDir ? new EncryptedFileKeyring(keyringDir) : undefined;
  return createLlmMeshFacade({
    configResolver: {
      async resolveConfig(configRef) {
        const raw = process.env.H2A_LLM_MESH_CONFIG_JSON;
        if (!raw) return {};
        try {
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
          const scoped = parsed[configRef];
          return scoped && typeof scoped === 'object' && !Array.isArray(scoped) ? scoped : parsed;
        } catch {
          return {};
        }
      },
    },
    mode: 'cli',
    legacyAccountOwnerScopeRef: scope,
    ...(keyring ? { keyring } : {}),
  });
}

// Names-only projection of the exact mesh call that failed: the first stack
// frame inside the mesh account service. Never secret-adjacent (a class and
// method name only), it lets the conductor report the upstream write-on-read
// (EncryptedFileKeyring.readMasterKey) instead of a bare EROFS.
export function meshCallOf(error) {
  const stack = error?.stack ?? '';
  for (const line of String(stack).split('\n')) {
    const match = line.match(/(EncryptedFileKeyring|LocalAccountTransportService)\.(\w+)/);
    if (match) return `${match[1]}.${match[2]}`;
  }
  return null;
}

// Require the enrolled mesh account for a bench CLI. Returns the public
// account reference plus the gate verdict. Refuses names-only when the
// account is missing (with the exact enroll command) or when the store
// itself is unreadable (with the store cause, e.g. EROFS).
export async function requireMeshAccount({ cli, facade, ownerScope }) {
  const mapping = MESH_SEAT_PROVIDERS[cli];
  if (!mapping) throw new Error(`seat-unknown:${cli}`);
  let accounts = null;
  try {
    accounts = await facade.listAccounts({ ownerScope });
  } catch (error) {
    const refusal = new Error(`llm-mesh-store-unreachable:${cli}`);
    refusal.cause = error?.code ?? 'unknown';
    const meshCall = meshCallOf(error);
    if (meshCall) refusal.meshCall = meshCall;
    throw refusal;
  }
  const account = (accounts ?? []).find((entry) => entry?.providerId === mapping.provider) ?? null;
  if (!account?.accountId) {
    const refusal = new Error(`seat-not-enrolled-in-llm-mesh:${cli}`);
    refusal.enroll = mapping.enroll;
    throw refusal;
  }
  return { accountId: account.accountId, provider: mapping.provider,
    enroll: mapping.enroll, meshGate: 'enrolled' };
}

// Project the vibe-minted key out of the mesh account: acquire the serving
// pair, take the access token, release the lease. The access token is the
// only material read; anything else (headers, metadata) is never projected.
// Wraps failures names-only; the lease is released whatever happens.
export async function acquireVibeKey({ facade, ownerScope, accountId }) {
  let acquisition = null;
  try {
    acquisition = await facade.acquire({ accountId, ownerScopeRef: ownerScope,
      targetProviderId: VIBE_SERVING_IDS.targetProviderId,
      transportProviderId: VIBE_SERVING_IDS.transportProviderId });
  } catch {
    throw new Error('llm-mesh-acquire-failed:vibe');
  }
  try {
    const key = `${acquisition?.material?.accessToken ?? ''}`.trim();
    if (!key || /[\r\n]/.test(key)) throw new Error('mesh-seat-unprojectable:vibe');
    return key;
  } finally {
    try { await acquisition?.release?.(); } catch { /* best-effort: the lease expires */ }
  }
}
