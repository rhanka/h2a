import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";

import {
  H2A_ARTIFACT_KINDS,
  H2A_AUTHORITY_MATRIX,
  H2A_DECLARATION_INTERET_BODY_KIND,
  appendJournalEntry,
  assertValidNegotiationState,
  canSignArtifactKind,
  computeHash,
  createJournalEntry,
  deriveDecisionDossier as deriveDecisionDossierCore,
  derivePostureConflit,
  derivePostureConfiance as derivePostureConfianceCore,
  evaluatePresenterBias,
  isH2AEnvelope,
  validateH2AEnvelope,
  isH2ADeclarationInteret,
  validateSubagentBinding,
  verifyCanonical,
  verifyJournalChain,
  type H2AActorRegistration,
  type H2AOrgMembershipGrant,
  type H2ASubagentBinding,
  type H2AArtifactKind,
  type H2AEnvelope,
  type H2AJournalEntry,
  type H2AJournalPayload,
  type H2ANegotiationRecord,
  type H2ADecisionDossier,
  type H2ADeclarationInteret,
  type H2APostureConfianceResult,
  type H2APostureConflitResult,
  type H2APresenterBias,
  type H2ARole,
  type H2ASignature
} from "@sentropic/h2a";

import { withLockSync } from "./locks.js";
import { withLeaseSync } from "./lease.js";
import {
  inboxDir,
  inboxDirRaw,
  localStorePaths,
  negotiationDir,
  negotiationJournalFile,
  outboxDir,
  outboxDirRaw,
  safePathSegment,
  type LocalStorePaths
} from "./paths.js";
import {
  H2A_STORE_SCHEMA_FILE,
  H2A_STORE_SCHEMA_VERSION,
  StoreSchemaMismatchError,
  readCliPackageVersion,
  type H2AStoreSchemaSentinel
} from "./schema.js";
import { listIdentityAliases, mergeInboxDedup } from "../identity/migration.js";

export interface CreateLocalStoreOptions {
  root: string;
  /**
   * Timeout (ms) for acquiring any per-store advisory file lock. Defaults to
   * 5000. Tests use a much smaller value to exercise the timeout path
   * without slowing the suite. DEC-036.
   */
  lockTimeoutMs?: number;
  /**
   * Read-only escape hatch: if the on-disk `.h2a-schema.json` declares a
   * version we don't recognize, proceed anyway with a stderr warning. Never
   * rewrites the sentinel. Intended for inspection tooling. DEC-036.
   */
  allowVersionMismatch?: boolean;
  /**
   * Locking strategy for critical sections (DEC-066):
   * - `"pid"` (default) — same-machine advisory lock with PID-staleness
   *   recovery (DEC-036). Zero-config, correct for the common single-machine
   *   case.
   * - `"lease"` — time-based lease lock (DEC-065) safe across hosts/Pods on a
   *   shared ReadWriteMany store (Scenario B of DEC-056). No PID assumption.
   */
  lockMode?: "pid" | "lease";
  /**
   * Lease duration (ms) when `lockMode === "lease"`. Must exceed the longest
   * critical section plus inter-host clock skew. Default 30000.
   */
  leaseMs?: number;
}

/**
 * An append-only audit event for a subagent (DEC-071). Distinct from the
 * parent fan-in (DEC-070), which reflects *current* inbox state: the audit log
 * is the permanent history of what happened to a subagent and survives an
 * inbox pop.
 */
export interface H2ASubagentAuditEvent {
  subagent: string;
  type: "registered" | "routed" | "revoked";
  at: string;
  envelopeId?: string;
  mailbox?: "inbox" | "outbox";
  reason?: string;
}

export type H2ASubagentStatus = "active" | "revoked";

/**
 * An append-only keyring event for an instance (DEC-078). Keys can be added
 * (and, from DEC-079, revoked) without rewriting the append-only instance
 * registration, enabling key rotation: add a new key, both verify during the
 * overlap, then revoke the old one.
 */
export interface H2AKeyEvent {
  instance: string;
  publicKey: string;
  type: "added" | "revoked";
  at: string;
}

// DEC-089: an append-only record of a coordinated NHI offboarding — what the
// decommission revoked, for the auditor (NHI1). The revocations themselves live
// in keys.jsonl / subagent-audit.jsonl; this is the single "offboarded at T" mark.
export interface H2AOffboardTombstone {
  instance: string;
  reason?: string;
  revokedKeys: number;
  revokedSubagents: string[];
  at: string;
}

export interface H2ADerivedDecisionDossier {
  negotiationId: string;
  dossier: H2ADecisionDossier;
  dossierHash: string;
  presenterBias?: H2APresenterBias;
  advisoryEvent?: H2AJournalEntry<unknown>;
}

export interface LocalStore {
  paths: LocalStorePaths;
  registerInstance(reg: H2AActorRegistration): void;
  listInstances(): H2AActorRegistration[];
  findInstance(id: string): H2AActorRegistration | undefined;
  addInstanceKey(instanceId: string, publicKeyPem: string): void;
  listInstanceKeys(instanceId: string): string[];
  listKeyEvents(): H2AKeyEvent[];
  revokeInstanceKey(instanceId: string, publicKeyPem: string): void;
  /** DEC-109 org provisioning: append a role/scope membership grant (keyed-only). */
  grantOrgMembership(grant: H2AOrgMembershipGrant): void;
  listOrgMembership(): H2AOrgMembershipGrant[];
  offboardInstance(instanceId: string, reason?: string): H2AOffboardTombstone;
  listOffboards(): H2AOffboardTombstone[];
  registerSubagent(binding: H2ASubagentBinding): void;
  listSubagents(): H2ASubagentBinding[];
  findSubagent(id: string): H2ASubagentBinding | undefined;
  listSubagentsOf(parentInstance: string): H2ASubagentBinding[];
  openNegotiation(record: H2ANegotiationRecord): H2ANegotiationRecord;
  readNegotiation(id: string): H2ANegotiationRecord | undefined;
  updateNegotiationStatus(
    id: string,
    status: H2ANegotiationRecord["status"]
  ): H2ANegotiationRecord;
  appendNegotiationEvent<TBody = unknown>(
    negotiationId: string,
    payload: H2AJournalPayload<TBody>
  ): H2AJournalEntry<TBody>;
  readNegotiationJournal(negotiationId: string): H2AJournalEntry<unknown>[];
  declareConflitInteret(
    negotiationId: string,
    declaration: H2ADeclarationInteret,
    options?: { eventId?: string }
  ): H2AJournalEntry<H2ADeclarationInteret>;
  derivePosturesConflit(negotiationId: string): H2APostureConflitResult[];
  deriveDecisionDossier(
    negotiationId: string,
    options?: { presenter?: string; advisoryGate?: boolean; eventId?: string }
  ): H2ADerivedDecisionDossier;
  derivePostureConfiance(negotiationId: string): H2APostureConfianceResult;
  stabilizeNegotiation(
    negotiationId: string,
    options?: { eventId?: string }
  ): {
    record: H2ANegotiationRecord;
    artifactHash: string;
    signers: string[];
    finalEvent: H2AJournalEntry<unknown>;
    advisoryEvents: H2AJournalEntry<unknown>[];
    artifactPath: string;
  };
  putInboxMessage(actor: string, envelope: H2AEnvelope): void;
  readInbox(actor: string): H2AEnvelope[];
  popInboxMessage(actor: string, envelopeId: string): H2AEnvelope | undefined;
  putOutboxMessage(actor: string, envelope: H2AEnvelope): void;
  readOutbox(actor: string): H2AEnvelope[];
  routeToSubagent(
    subagentId: string,
    envelope: H2AEnvelope,
    mailbox?: "inbox" | "outbox"
  ): void;
  readSubagentInboxes(
    parentInstance: string
  ): Array<{ subagent: string; envelopes: H2AEnvelope[] }>;
  readSubagentAudit(subagentId: string): H2ASubagentAuditEvent[];
  readSubagentAuditOf(parentInstance: string): H2ASubagentAuditEvent[];
  subagentStatus(subagentId: string): H2ASubagentStatus;
  revokeSubagent(subagentId: string, reason?: string): void;
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

/**
 * Compute the immutable on-disk target for a stabilized artifact (DEC-031, DEC-033).
 * `CONTRACT`/`POLICY`/`ENGAGEMENT` get their own subtree keyed by `artifact.id`;
 * anything else (AMENDMENT/MANDATE/AUTHORITY/ENFORCEMENT_PLAN/unknown) falls
 * back to `<root>/artifacts/<artifactHash>.json` so write-once semantics still
 * apply (DEC-033).
 */
function resolveStabilizedArtifactPath(
  paths: LocalStorePaths,
  artifact: unknown,
  artifactHash: string
): string {
  const a = (typeof artifact === "object" && artifact !== null
    ? (artifact as { kind?: unknown; id?: unknown })
    : {});
  const kind = typeof a.kind === "string" ? a.kind : undefined;
  const id = typeof a.id === "string" ? a.id : undefined;

  // DEC-062: sanitize ids through safePathSegment so Windows mkdir
  // accepts them (`nego:codex` would otherwise be a forbidden path).
  if (kind === "CONTRACT" && id) {
    return join(paths.contracts, safePathSegment(id), "contract.json");
  }
  if (kind === "POLICY" && id) {
    return join(paths.policies, `${safePathSegment(id)}.json`);
  }
  if (kind === "ENGAGEMENT" && id) {
    return join(paths.engagements, safePathSegment(id), "charter.json");
  }
  // Fallback: hash-addressed under <root>/artifacts/. We replace ":" so the
  // canonical "sha256:<hex>" prefix maps to a portable filename.
  const safeHash = artifactHash.replace(/:/g, "_");
  return join(paths.artifacts, `${safeHash}.json`);
}

function ensureLayout(paths: LocalStorePaths): void {
  ensureDir(paths.root);
  ensureDir(paths.registry);
  ensureDir(paths.contracts);
  ensureDir(paths.policies);
  ensureDir(paths.engagements);
  ensureDir(paths.artifacts);
  ensureDir(paths.negotiations);
  ensureDir(paths.inbox);
  ensureDir(paths.outbox);
}

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const content = readFileSync(file, "utf8");
  if (content.length === 0) return [];
  const lines = content.split("\n");
  const out: T[] = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    out.push(JSON.parse(line) as T);
  }
  return out;
}

function appendJsonl(file: string, value: unknown): void {
  appendFileSync(file, `${JSON.stringify(value)}\n`, { encoding: "utf8" });
}

/**
 * Initialize or validate the schema sentinel for a store root (DEC-036).
 * Returns silently on success; throws `StoreSchemaMismatchError` if the
 * on-disk version is unknown and `allowVersionMismatch` is false.
 */
function ensureSchemaSentinel(
  root: string,
  options: { allowVersionMismatch: boolean }
): void {
  const sentinelPath = join(root, H2A_STORE_SCHEMA_FILE);
  if (!existsSync(sentinelPath)) {
    const payload: H2AStoreSchemaSentinel = {
      version: H2A_STORE_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      createdBy: readCliPackageVersion()
    };
    writeFileSync(sentinelPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return;
  }

  let parsed: Partial<H2AStoreSchemaSentinel>;
  try {
    parsed = JSON.parse(readFileSync(sentinelPath, "utf8")) as Partial<H2AStoreSchemaSentinel>;
  } catch (err) {
    throw new StoreSchemaMismatchError(
      "<unparseable>",
      H2A_STORE_SCHEMA_VERSION,
      root
    );
  }
  const found = typeof parsed.version === "string" ? parsed.version : "<missing>";
  if (found === H2A_STORE_SCHEMA_VERSION) return;

  if (options.allowVersionMismatch) {
    process.stderr.write(
      `h2a store: schema version mismatch at ${root} (found "${found}", expected "${H2A_STORE_SCHEMA_VERSION}"); proceeding read-only because allowVersionMismatch=true (DEC-036)\n`
    );
    return;
  }
  throw new StoreSchemaMismatchError(found, H2A_STORE_SCHEMA_VERSION, root);
}

/**
 * Resolve the effective lock strategy (DEC-066 / DEC-067). Explicit option
 * wins; otherwise fall back to `H2A_LOCK_MODE` env so a K8s tenant Deployment
 * (Scenario B) can turn on the lease lock for every store-creation site —
 * `mcp-serve` and the one-shot CLI verbs — without threading a flag through
 * each call. Unknown env values fall through to the `"pid"` default.
 */
function resolveLockMode(
  explicit: CreateLocalStoreOptions["lockMode"]
): "pid" | "lease" {
  if (explicit) return explicit;
  const env = process.env.H2A_LOCK_MODE;
  return env === "lease" || env === "pid" ? env : "pid";
}

/** Read `H2A_LEASE_MS` env as a positive integer, else undefined (DEC-067). */
function envLeaseMs(): number | undefined {
  const raw = process.env.H2A_LEASE_MS;
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function createLocalStore(options: CreateLocalStoreOptions): LocalStore {
  const paths = localStorePaths(options.root);
  ensureLayout(paths);
  ensureSchemaSentinel(paths.root, {
    allowVersionMismatch: options.allowVersionMismatch === true
  });

  if (!existsSync(paths.instances)) {
    writeFileSync(paths.instances, "", { encoding: "utf8" });
  }

  const lockTimeoutMs = options.lockTimeoutMs ?? 5000;
  const lockMode = resolveLockMode(options.lockMode);
  const leaseMs = options.leaseMs ?? envLeaseMs() ?? 30000;
  const lockOpts =
    lockMode === "lease"
      ? { timeoutMs: lockTimeoutMs, leaseMs }
      : { timeoutMs: lockTimeoutMs };

  // DEC-066: route every critical section through the chosen strategy. `pid`
  // is the same-machine default (DEC-036); `lease` is the cross-host primitive
  // (DEC-065) for a shared RWX store. Both share the `(path, fn, opts)` shape;
  // the lease handle arg is simply ignored by the store's sync sections.
  function lock<T>(
    lockPath: string,
    fn: () => T,
    opts: typeof lockOpts
  ): T {
    return lockMode === "lease"
      ? withLeaseSync(lockPath, fn, opts)
      : withLockSync(lockPath, fn, opts);
  }

  const registryLock = join(paths.registry, ".lock");
  const negotiationLock = (id: string): string => join(negotiationDir(paths, id), ".lock");
  const inboxLock = (actor: string): string => join(inboxDir(paths, actor), ".lock");
  const outboxLock = (actor: string): string => join(outboxDir(paths, actor), ".lock");

  function listInstances(): H2AActorRegistration[] {
    return readJsonl<H2AActorRegistration>(paths.instances);
  }

  function findInstance(id: string): H2AActorRegistration | undefined {
    return listInstances().find((entry) => entry.id === id);
  }

  function registerInstance(reg: H2AActorRegistration): void {
    lock(
      registryLock,
      () => {
        if (findInstance(reg.id)) {
          throw new Error(`Instance already registered: ${reg.id}`);
        }
        appendJsonl(paths.instances, reg);
      },
      lockOpts
    );
  }

  // DEC-078: the active public keys for an instance = the keys baked into its
  // registration PLUS keys added to the keyring, MINUS any revoked. Derived
  // from append-only sources so a rotation never rewrites a registration.
  function listInstanceKeys(instanceId: string): string[] {
    const fromRegistration = findInstance(instanceId)?.publicKeys ?? [];
    const events = readJsonl<H2AKeyEvent>(paths.keys).filter(
      (e) => e.instance === instanceId
    );
    const revoked = new Set(
      events.filter((e) => e.type === "revoked").map((e) => e.publicKey)
    );
    const active = new Set<string>();
    for (const pem of fromRegistration) active.add(pem);
    for (const e of events) {
      if (e.type === "added") active.add(e.publicKey);
    }
    for (const pem of revoked) active.delete(pem);
    return [...active];
  }

  // DEC-087: raw keyring events (added/revoked, append-only) for posture
  // derivation — `auditNhiPosture` reads these to age active keys (NHI7).
  function listKeyEvents(): H2AKeyEvent[] {
    return readJsonl<H2AKeyEvent>(paths.keys);
  }

  function addInstanceKey(instanceId: string, publicKeyPem: string): void {
    lock(
      registryLock,
      () => {
        if (!findInstance(instanceId)) {
          throw new Error(`Instance not registered: ${instanceId}`);
        }
        if (listInstanceKeys(instanceId).includes(publicKeyPem)) {
          throw new Error(`Key already registered for ${instanceId}`);
        }
        appendJsonl(paths.keys, {
          instance: instanceId,
          publicKey: publicKeyPem,
          type: "added",
          at: new Date().toISOString()
        });
      },
      lockOpts
    );
  }

  // DEC-079: revoke a key (rotate-out). Appends a `revoked` event; the
  // `listInstanceKeys` union already subtracts it, so the verifier stops
  // accepting it. Rejects revoking a key that is not currently active.
  function revokeInstanceKey(instanceId: string, publicKeyPem: string): void {
    lock(
      registryLock,
      () => {
        if (!listInstanceKeys(instanceId).includes(publicKeyPem)) {
          throw new Error(`Key not active for ${instanceId}`);
        }
        appendJsonl(paths.keys, {
          instance: instanceId,
          publicKey: publicKeyPem,
          type: "revoked",
          at: new Date().toISOString()
        });
      },
      lockOpts
    );
  }

  // DEC-109: append-only org-membership grants, layered over registrations like
  // the DEC-078 keyring. A grant only augments an already-registered instance
  // (keyed-only); the `effectiveOrgInstances` union surfaces it to diff/discover.
  function listOrgMembership(): H2AOrgMembershipGrant[] {
    return readJsonl<H2AOrgMembershipGrant>(paths.orgMembership);
  }

  function grantOrgMembership(grant: H2AOrgMembershipGrant): void {
    lock(
      registryLock,
      () => {
        if (!listInstances().some((r) => r.instance === grant.instance)) {
          throw new Error(`Instance not registered: ${grant.instance}`);
        }
        appendJsonl(paths.orgMembership, grant);
      },
      lockOpts
    );
  }

  function listSubagents(): H2ASubagentBinding[] {
    return readJsonl<H2ASubagentBinding>(paths.subagents);
  }

  function findSubagent(id: string): H2ASubagentBinding | undefined {
    return listSubagents().find((entry) => entry.id === id);
  }

  function listSubagentsOf(parentInstance: string): H2ASubagentBinding[] {
    return listSubagents().filter((b) => b.parentInstance === parentInstance);
  }

  // DEC-071: append-only per-subagent audit log. Callers append under the
  // registry lock (low-volume, co-located with the binding registry).
  function appendSubagentAudit(event: H2ASubagentAuditEvent): void {
    appendJsonl(paths.subagentAudit, event);
  }

  function readSubagentAudit(subagentId: string): H2ASubagentAuditEvent[] {
    return readJsonl<H2ASubagentAuditEvent>(paths.subagentAudit).filter(
      (e) => e.subagent === subagentId
    );
  }

  function readSubagentAuditOf(parentInstance: string): H2ASubagentAuditEvent[] {
    const ids = new Set(listSubagentsOf(parentInstance).map((b) => b.id));
    return readJsonl<H2ASubagentAuditEvent>(paths.subagentAudit).filter((e) =>
      ids.has(e.subagent)
    );
  }

  // DEC-072: a subagent's lifecycle status is *derived* from the append-only
  // audit log rather than stored mutably — a `revoked` event flips it. This
  // keeps `subagents.jsonl` append-only (no in-place binding edit) and reuses
  // the slice-4 audit as the single source of truth.
  function subagentStatus(subagentId: string): H2ASubagentStatus {
    const events = readSubagentAudit(subagentId);
    return events.some((e) => e.type === "revoked") ? "revoked" : "active";
  }

  // DEC-072: takeover at subagent granularity. Revoking deactivates a subagent
  // (future routing is refused); its pending inbox stays readable by the parent
  // via the fan-in (DEC-070), which is how the parent reclaims its work.
  function revokeSubagent(subagentId: string, reason?: string): void {
    lock(
      registryLock,
      () => {
        if (!findSubagent(subagentId)) {
          throw new Error(`Subagent not registered: ${subagentId}`);
        }
        if (subagentStatus(subagentId) === "revoked") {
          throw new Error(`Subagent already revoked: ${subagentId}`);
        }
        appendSubagentAudit({
          subagent: subagentId,
          type: "revoked",
          at: new Date().toISOString(),
          ...(reason ? { reason } : {})
        });
      },
      lockOpts
    );
  }

  // DEC-089: coordinated NHI offboarding. Revokes every active key and every
  // active subagent of the instance (each via the already-locked revoke
  // primitives — no nested lock), then appends a tombstone. Re-running is safe:
  // it revokes only what is still active, so a second call records 0/empty.
  function offboardInstance(instanceId: string, reason?: string): H2AOffboardTombstone {
    if (!findInstance(instanceId)) {
      throw new Error(`Instance not registered: ${instanceId}`);
    }
    const activeKeys = listInstanceKeys(instanceId);
    for (const pem of activeKeys) revokeInstanceKey(instanceId, pem);
    const activeSubs = listSubagentsOf(instanceId).filter(
      (b) => subagentStatus(b.id) === "active"
    );
    for (const b of activeSubs) revokeSubagent(b.id, reason ?? "offboard");
    const tombstone: H2AOffboardTombstone = {
      instance: instanceId,
      ...(reason ? { reason } : {}),
      revokedKeys: activeKeys.length,
      revokedSubagents: activeSubs.map((b) => b.id),
      at: new Date().toISOString()
    };
    lock(registryLock, () => appendJsonl(paths.offboard, tombstone), lockOpts);
    return tombstone;
  }

  function listOffboards(): H2AOffboardTombstone[] {
    return readJsonl<H2AOffboardTombstone>(paths.offboard);
  }

  // DEC-068: subagent bindings share the registry lock with instance
  // registration — both are low-volume registry appends, so one lock keeps the
  // two files mutually consistent (a binding's parent must already be present).
  function registerSubagent(binding: H2ASubagentBinding): void {
    lock(
      registryLock,
      () => {
        const parent = findInstance(binding.parentInstance);
        if (!parent) {
          throw new Error(
            `Subagent parent not registered: ${binding.parentInstance}`
          );
        }
        const validation = validateSubagentBinding(binding, parent);
        if (!validation.ok) {
          throw new Error(
            `Invalid subagent binding (${binding.id}): ${validation.errors.join(", ")}`
          );
        }
        if (findSubagent(binding.id)) {
          throw new Error(`Subagent already registered: ${binding.id}`);
        }
        appendJsonl(paths.subagents, binding);
        appendSubagentAudit({
          subagent: binding.id,
          type: "registered",
          at: new Date().toISOString()
        });
      },
      lockOpts
    );
  }

  function negotiationStateFile(id: string): string {
    return `${negotiationDir(paths, id)}/state.json`;
  }

  function openNegotiation(record: H2ANegotiationRecord): H2ANegotiationRecord {
    assertValidNegotiationState(record.status);
    ensureDir(negotiationDir(paths, record.id));
    return lock(
      negotiationLock(record.id),
      () => {
        const file = negotiationStateFile(record.id);
        if (existsSync(file)) {
          throw new Error(`Negotiation already open: ${record.id}`);
        }
        writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
        return record;
      },
      lockOpts
    );
  }

  function readNegotiation(id: string): H2ANegotiationRecord | undefined {
    const file = negotiationStateFile(id);
    if (!existsSync(file)) return undefined;
    return JSON.parse(readFileSync(file, "utf8")) as H2ANegotiationRecord;
  }

  function updateNegotiationStatus(
    id: string,
    status: H2ANegotiationRecord["status"]
  ): H2ANegotiationRecord {
    assertValidNegotiationState(status);
    ensureDir(negotiationDir(paths, id));
    return lock(
      negotiationLock(id),
      () => {
        const current = readNegotiation(id);
        if (!current) {
          throw new Error(`Negotiation not found: ${id}`);
        }
        const updated: H2ANegotiationRecord = { ...current, status };
        writeFileSync(
          negotiationStateFile(id),
          `${JSON.stringify(updated, null, 2)}\n`,
          "utf8"
        );
        return updated;
      },
      lockOpts
    );
  }

  function readNegotiationJournalUnlocked(
    negotiationId: string
  ): H2AJournalEntry<unknown>[] {
    const file = negotiationJournalFile(paths, negotiationId);
    if (!existsSync(file)) return [];
    const entries = readJsonl<H2AJournalEntry<unknown>>(file);
    const check = verifyJournalChain(entries);
    if (!check.ok) {
      throw new Error(
        `Negotiation ${negotiationId}: corrupt journal chain at index ${check.index}: ${check.reason}`
      );
    }
    return entries;
  }

  function readNegotiationJournal(
    negotiationId: string
  ): H2AJournalEntry<unknown>[] {
    return readNegotiationJournalUnlocked(negotiationId);
  }

  function appendNegotiationEvent<TBody>(
    negotiationId: string,
    payload: H2AJournalPayload<TBody>
  ): H2AJournalEntry<TBody> {
    ensureDir(negotiationDir(paths, negotiationId));
    return lock(
      negotiationLock(negotiationId),
      () => {
        const file = negotiationJournalFile(paths, negotiationId);
        const existing = readNegotiationJournalUnlocked(negotiationId);
        const previous = existing[existing.length - 1];
        const entry = previous
          ? appendJournalEntry(previous, payload)
          : createJournalEntry(payload);
        appendJsonl(file, entry);
        return entry;
      },
      lockOpts
    );
  }

  function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  function addScopeValue(scopes: Set<string>, value: unknown): void {
    if (typeof value === "string" && value.length > 0) {
      scopes.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) addScopeValue(scopes, item);
      return;
    }
    const nested = asPlainRecord(value);
    if (nested) addScopeValue(scopes, nested.scope);
  }

  function collectDecisionScopes(
    record: H2ANegotiationRecord,
    entries: readonly H2AJournalEntry<unknown>[],
    artifact?: unknown
  ): string[] {
    const scopes = new Set<string>([record.scope]);
    const addArtifactScopes = (candidate: unknown): void => {
      const body = asPlainRecord(candidate);
      if (!body) return;
      addScopeValue(scopes, body.scope);
      addScopeValue(scopes, body.aval);
      addScopeValue(scopes, body.scopeAval);
    };
    for (const entry of entries) {
      const body = asPlainRecord(entry.body);
      if (body && "artifact" in body) addArtifactScopes(body.artifact);
    }
    addArtifactScopes(artifact);
    return [...scopes];
  }

  function collectDeclarations(
    entries: readonly H2AJournalEntry<unknown>[]
  ): H2ADeclarationInteret[] {
    return entries
      .map((entry) => entry.body)
      .filter(isH2ADeclarationInteret);
  }

  function collectControleFlags(
    entries: readonly H2AJournalEntry<unknown>[]
  ): string[] {
    const subjects = new Set<string>();
    for (const entry of entries) {
      if (entry.actor.role !== "CONTROL") continue;
      const body = asPlainRecord(entry.body);
      if (!body) continue;
      const subject = body.subject;
      if (typeof subject !== "string" || subject.length === 0) continue;
      if (
        body.kind === "postureConflit" ||
        body.kind === "conflitInteret" ||
        body.postureConflit === "conflit-declarable" ||
        body.conflitInteret === true
      ) {
        subjects.add(subject);
      }
    }
    return [...subjects];
  }

  function derivePosturesConflitFor(
    record: H2ANegotiationRecord,
    entries: readonly H2AJournalEntry<unknown>[],
    artifact?: unknown
  ): H2APostureConflitResult[] {
    const declarations = collectDeclarations(entries);
    const controleFlags = collectControleFlags(entries);
    const subjects: string[] = [];
    const seen = new Set<string>();
    const addSubject = (subject: string): void => {
      if (seen.has(subject)) return;
      seen.add(subject);
      subjects.push(subject);
    };

    for (const signer of record.requiredSigners ?? []) addSubject(signer);
    for (const declaration of declarations) addSubject(declaration.subject);
    for (const subject of controleFlags) addSubject(subject);

    const decisionScopes = collectDecisionScopes(record, entries, artifact);
    return subjects.map((subject) =>
      derivePostureConflit(subject, {
        declarations,
        ownScopes: findInstance(subject)?.scopes ?? [],
        decisionScopes,
        signers: record.requiredSigners ?? [],
        controleFlags
      })
    );
  }

  function findInstanceBySubject(subject: string): H2AActorRegistration | undefined {
    return listInstances().find(
      (entry) => entry.id === subject || entry.instance === subject
    );
  }

  function subjectScopesBySubject(): Record<string, readonly string[]> {
    const out: Record<string, readonly string[]> = {};
    for (const registration of listInstances()) {
      const scopes = registration.scopes ?? [];
      out[registration.id] = scopes;
      out[registration.instance] = scopes;
    }
    return out;
  }

  function publicKeysBySubject(): Record<string, readonly string[]> {
    const out: Record<string, readonly string[]> = {};
    for (const registration of listInstances()) {
      const keys = listInstanceKeys(registration.id);
      out[registration.id] = keys;
      out[registration.instance] = keys;
    }
    return out;
  }

  function deriveDecisionDossierFor(
    record: H2ANegotiationRecord,
    entries: readonly H2AJournalEntry<unknown>[],
    artifact?: unknown
  ): H2ADecisionDossier {
    const recordForDossier =
      artifact === undefined
        ? record
        : { ...record, currentArtifactHash: computeHash(artifact) };
    return deriveDecisionDossierCore({
      record: recordForDossier,
      journal: entries,
      subjectScopes: subjectScopesBySubject(),
      controleFlags: collectControleFlags(entries)
    });
  }

  function derivePostureConfianceFor(
    record: H2ANegotiationRecord,
    entries: readonly H2AJournalEntry<unknown>[],
    artifact?: unknown
  ): H2APostureConfianceResult {
    return derivePostureConfianceCore({
      record,
      journal: entries,
      dossier: deriveDecisionDossierFor(record, entries, artifact),
      publicKeys: publicKeysBySubject(),
      subjectScopes: subjectScopesBySubject(),
      decisionScopes: collectDecisionScopes(record, entries, artifact)
    });
  }

  function deriveDecisionDossier(
    negotiationId: string,
    options: { presenter?: string; advisoryGate?: boolean; eventId?: string } = {}
  ): H2ADerivedDecisionDossier {
    const record = readNegotiation(negotiationId);
    if (!record) {
      throw new Error(`Negotiation not found: ${negotiationId}`);
    }
    const entries = readNegotiationJournalUnlocked(negotiationId);
    const declarations = collectDeclarations(entries);
    const controleFlags = collectControleFlags(entries);
    const subjectScopes = subjectScopesBySubject();
    const dossier = deriveDecisionDossierCore({
      record,
      journal: entries,
      subjectScopes,
      controleFlags
    });
    const result: H2ADerivedDecisionDossier = {
      negotiationId,
      dossier,
      dossierHash: computeHash(dossier)
    };

    if (!options.presenter) {
      return result;
    }

    const presenterRegistration = findInstanceBySubject(options.presenter);
    const presenterBias = evaluatePresenterBias(options.presenter, {
      declarations,
      ownScopes: presenterRegistration?.scopes ?? [],
      decisionScopes: collectDecisionScopes(record, entries),
      signers: record.requiredSigners ?? [],
      controleFlags
    });
    if (!presenterBias.biased || options.advisoryGate !== true) {
      return { ...result, presenterBias };
    }

    const advisoryEvent = appendNegotiationEvent(negotiationId, {
      id: options.eventId ?? `evt-presenterBias-${Date.now().toString(36)}`,
      type: "escalate",
      actor: { instance: "h2a-cli", role: "MANDATAIRE", scope: record.scope },
      body: {
        kind: "escalation",
        channel: "alert",
        payload: {
          kind: "presenterBias",
          subject: presenterBias.subject,
          postureConflit: presenterBias.posture.postureConflit,
          criteres: presenterBias.posture.criteres,
          disclosureMode: presenterBias.posture.disclosureMode,
          masqueImpactCollectif: presenterBias.posture.masqueImpactCollectif,
          requiredBodyKind: H2A_DECLARATION_INTERET_BODY_KIND,
          disposition: "route-escalate"
        }
      },
      createdAt: new Date().toISOString()
    });
    return { ...result, presenterBias, advisoryEvent };
  }

  function derivePostureConfiance(negotiationId: string): H2APostureConfianceResult {
    const record = readNegotiation(negotiationId);
    if (!record) {
      throw new Error(`Negotiation not found: ${negotiationId}`);
    }
    return derivePostureConfianceFor(record, readNegotiationJournalUnlocked(negotiationId));
  }

  function declareConflitInteret(
    negotiationId: string,
    declaration: H2ADeclarationInteret,
    options: { eventId?: string } = {}
  ): H2AJournalEntry<H2ADeclarationInteret> {
    if (!isH2ADeclarationInteret(declaration)) {
      throw new Error(
        `${H2A_DECLARATION_INTERET_BODY_KIND}: invalid declaration body`
      );
    }
    const record = readNegotiation(negotiationId);
    if (!record) {
      throw new Error(`Negotiation not found: ${negotiationId}`);
    }
    const registration = findInstance(declaration.subject);
    const role = (registration?.roles?.[0] ?? "CONDUCTOR") as H2ARole;
    const scope = registration?.scopes?.[0] ?? record.scope;
    return appendNegotiationEvent(negotiationId, {
      id: options.eventId ?? `evt-declaration-interet-${Date.now().toString(36)}`,
      type: "event",
      actor: { instance: declaration.subject, role, scope },
      body: declaration,
      createdAt: declaration.at
    });
  }

  function derivePosturesConflit(negotiationId: string): H2APostureConflitResult[] {
    const record = readNegotiation(negotiationId);
    if (!record) {
      throw new Error(`Negotiation not found: ${negotiationId}`);
    }
    return derivePosturesConflitFor(record, readNegotiationJournalUnlocked(negotiationId));
  }

  function stabilizeNegotiation(
    negotiationId: string,
    options: { eventId?: string } = {}
  ) {
    ensureDir(negotiationDir(paths, negotiationId));
    return lock(
      negotiationLock(negotiationId),
      () => {
        const record = readNegotiation(negotiationId);
        if (!record) {
          throw new Error(`Negotiation not found: ${negotiationId}`);
        }
        if (record.status === "stabilized") {
          throw new Error(`Negotiation already stabilized: ${negotiationId}`);
        }
        if (!Array.isArray(record.requiredSigners) || record.requiredSigners.length === 0) {
          throw new Error(`Negotiation ${negotiationId} has no requiredSigners`);
        }

        const entries = readNegotiationJournalUnlocked(negotiationId);

        const byHash = new Map<string, Map<string, H2ASignature>>();
        for (const entry of entries) {
          const body = (entry as { body?: { kind?: string; artifactHash?: string; signature?: H2ASignature } }).body;
          if (!body || body.kind !== "signature") continue;
          if (typeof body.artifactHash !== "string" || !body.signature) continue;

          const signer = entry.actor.instance;
          const sig = body.signature;
          if (sig.by !== signer) {
            throw new Error(
              `Negotiation ${negotiationId}: signature by ${sig.by} does not match actor.instance ${signer}`
            );
          }

          const registration = findInstance(signer);
          if (!registration) {
            throw new Error(`Negotiation ${negotiationId}: signer ${signer} is not registered`);
          }
          const keys = registration.publicKeys ?? [];
          if (keys.length === 0) {
            throw new Error(
              `Negotiation ${negotiationId}: signer ${signer} has no publicKeys in the registry`
            );
          }

          const verified = keys.some((pem) =>
            verifyCanonical({ artifactHash: body.artifactHash }, sig, pem)
          );
          if (!verified) {
            throw new Error(
              `Negotiation ${negotiationId}: signature by ${signer} fails verification against registered keys`
            );
          }

          const bucket = byHash.get(body.artifactHash) ?? new Map<string, H2ASignature>();
          bucket.set(signer, sig);
          byHash.set(body.artifactHash, bucket);
        }

        const required = new Set(record.requiredSigners);
        let winningHash: string | undefined;
        for (const [hash, bucket] of byHash) {
          const have = new Set(bucket.keys());
          const allPresent = [...required].every((id) => have.has(id));
          if (allPresent) {
            winningHash = hash;
            break;
          }
        }

        if (!winningHash) {
          const summary = [...byHash].map(
            ([hash, bucket]) => `${hash} signed by ${[...bucket.keys()].join(",")}`
          );
          throw new Error(
            `Negotiation ${negotiationId}: no artifactHash has the full quorum (${record.requiredSigners.join(",")}). Collected: ${summary.join(" | ")}`
          );
        }

        // Walk back through the journal to find the offer/counter event whose body.artifact
        // hashes to the winning artifactHash. We then persist that artifact JSON to its
        // immutable target file (DEC-031 + DEC-033).
        let winningArtifact: unknown | undefined;
        for (const entry of entries) {
          const body = (entry as { body?: { artifact?: unknown } }).body;
          if (!body || body.artifact === undefined) continue;
          if (computeHash(body.artifact) === winningHash) {
            winningArtifact = body.artifact;
            break;
          }
        }
        if (winningArtifact === undefined) {
          throw new Error(
            `stabilizeNegotiation: no offer/counter event matches the winning artifactHash ${winningHash}`
          );
        }

        // Authority check (DEC-035): every signer of the winning artifactHash
        // must hold at least one role allowed by H2A_AUTHORITY_MATRIX for the
        // artifact's declared kind. Unknown/missing kinds emit a stderr warning
        // and skip the check (V1 permissive on extension).
        const winningKind = (typeof winningArtifact === "object" && winningArtifact !== null
          ? ((winningArtifact as { kind?: unknown }).kind as unknown)
          : undefined);
        const knownKind =
          typeof winningKind === "string" &&
          (H2A_ARTIFACT_KINDS as readonly string[]).includes(winningKind)
            ? (winningKind as H2AArtifactKind)
            : undefined;

        if (knownKind) {
          const signersBucket = byHash.get(winningHash);
          if (signersBucket) {
            for (const signer of signersBucket.keys()) {
              const reg = findInstance(signer);
              const roles: H2ARole[] = (reg?.roles ?? []) as H2ARole[];
              const allowed = roles.some((role) => canSignArtifactKind(role, knownKind));
              if (!allowed) {
                throw new Error(
                  `Negotiation ${negotiationId}: signer ${signer} is not authorized to sign artifact kind ${knownKind} (roles: [${roles.join(",")}]); allowed roles: [${H2A_AUTHORITY_MATRIX[knownKind].roles.join(",")}]`
                );
              }
            }
          }
        } else {
          process.stderr.write(
            `h2a stabilize: negotiation ${negotiationId} artifact ${winningHash} has no recognizable kind; skipping authority check (DEC-035)\n`
          );
        }

        const artifactPath = resolveStabilizedArtifactPath(paths, winningArtifact, winningHash);
        ensureDir(dirname(artifactPath));
        try {
          writeFileSync(
            artifactPath,
            `${JSON.stringify(winningArtifact, null, 2)}\n`,
            { encoding: "utf8", flag: "wx" }
          );
        } catch (err) {
          const e = err as NodeJS.ErrnoException;
          if (e.code === "EEXIST") {
            throw new Error(
              `stabilizeNegotiation: stabilized artifact already on disk at ${artifactPath}`
            );
          }
          throw err;
        }

        // Inline append + status update (we already hold the per-negotiation
        // lock, so we cannot recurse into the wrapped helpers).
        const journalFile = negotiationJournalFile(paths, negotiationId);
        let entriesForAppend = readNegotiationJournalUnlocked(negotiationId);
        const advisoryEvents: H2AJournalEntry<unknown>[] = [];
        const posturesConflit = derivePosturesConflitFor(
          record,
          entriesForAppend,
          winningArtifact
        ).filter(
          (posture) =>
            posture.postureConflit === "conflit-declarable" &&
            record.requiredSigners.includes(posture.subject)
        );
        for (const [index, posture] of posturesConflit.entries()) {
          const previousAdvisory = entriesForAppend[entriesForAppend.length - 1];
          const advisoryPayload: H2AJournalPayload<unknown> = {
            id: `evt-postureConflit-${index}-${Date.now().toString(36)}`,
            type: "escalate",
            actor: { instance: "h2a-cli", role: "MANDATAIRE", scope: record.scope },
            body: {
              kind: "escalation",
              channel: "alert",
              payload: {
                kind: "postureConflit",
                subject: posture.subject,
                postureConflit: posture.postureConflit,
                criteres: posture.criteres,
                disclosureMode: posture.disclosureMode,
                masqueImpactCollectif: posture.masqueImpactCollectif,
                requiredBodyKind: H2A_DECLARATION_INTERET_BODY_KIND,
                disposition: "route-escalate"
              }
            },
            createdAt: new Date().toISOString()
          };
          const advisoryEvent = previousAdvisory
            ? appendJournalEntry(previousAdvisory, advisoryPayload)
            : createJournalEntry(advisoryPayload);
          appendJsonl(journalFile, advisoryEvent);
          advisoryEvents.push(advisoryEvent);
          entriesForAppend = [...entriesForAppend, advisoryEvent];
        }

        const postureConfiance = derivePostureConfianceFor(
          record,
          entriesForAppend,
          winningArtifact
        );
        if (postureConfiance.postureConfiance !== "etablie") {
          const previousAdvisory = entriesForAppend[entriesForAppend.length - 1];
          const advisoryPayload: H2AJournalPayload<unknown> = {
            id: `evt-postureConfiance-${Date.now().toString(36)}`,
            type: "escalate",
            actor: { instance: "h2a-cli", role: "MANDATAIRE", scope: record.scope },
            body: {
              kind: "escalation",
              channel: "alert",
              payload: {
                kind: "postureConfiance",
                postureConfiance: postureConfiance.postureConfiance,
                dossierHash: postureConfiance.dossierHash,
                attentionAttested: postureConfiance.attentionAttested,
                noUndisclosedCollectiveConflict:
                  postureConfiance.noUndisclosedCollectiveConflict,
                missingAttestations: postureConfiance.missingAttestations,
                staleAttestations: postureConfiance.staleAttestations,
                undisclosedConflicts: postureConfiance.undisclosedConflicts,
                disclosedConflicts: postureConfiance.disclosedConflicts,
                reasons: postureConfiance.reasons,
                disposition: "advisory-only"
              }
            },
            createdAt: new Date().toISOString()
          };
          const advisoryEvent = previousAdvisory
            ? appendJournalEntry(previousAdvisory, advisoryPayload)
            : createJournalEntry(advisoryPayload);
          appendJsonl(journalFile, advisoryEvent);
          advisoryEvents.push(advisoryEvent);
          entriesForAppend = [...entriesForAppend, advisoryEvent];
        }

        const previous = entriesForAppend[entriesForAppend.length - 1];
        const finalPayload: H2AJournalPayload<unknown> = {
          id: options.eventId ?? `evt-stabilize-${Date.now().toString(36)}`,
          type: "event",
          actor: { instance: "h2a-cli", role: "MANDATAIRE", scope: record.scope },
          body: {
            kind: "stabilized",
            artifactHash: winningHash,
            signers: record.requiredSigners,
            artifactPath
          },
          createdAt: new Date().toISOString()
        };
        const finalEvent = previous
          ? appendJournalEntry(previous, finalPayload)
          : createJournalEntry(finalPayload);
        appendJsonl(journalFile, finalEvent);

        const updated: H2ANegotiationRecord = {
          ...record,
          status: "stabilized",
          currentArtifactHash: winningHash
        };
        writeFileSync(
          negotiationStateFile(negotiationId),
          `${JSON.stringify(updated, null, 2)}\n`,
          "utf8"
        );

        return {
          record: updated,
          artifactHash: winningHash,
          signers: record.requiredSigners,
          finalEvent,
          advisoryEvents,
          artifactPath
        };
      },
      lockOpts
    );
  }

  function envelopeFile(dir: string, envelopeId: string): string {
    // DEC-062: envelope ids can contain `:` (e.g. `env:hello`), sanitize.
    return join(dir, `${safePathSegment(envelopeId)}.json`);
  }

  function readEnvelopesFrom(dir: string): H2AEnvelope[] {
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    const out: H2AEnvelope[] = [];
    for (const file of files) {
      const parsed = JSON.parse(readFileSync(join(dir, file), "utf8"));
      if (isH2AEnvelope(parsed)) {
        out.push(parsed as H2AEnvelope);
      }
    }
    return out;
  }

  function putInboxMessage(actor: string, envelope: H2AEnvelope): void {
    const validation = validateH2AEnvelope(envelope);
    if (!validation.ok) {
      throw new Error("putInboxMessage: invalid H2A envelope — " + validation.errors.join("; "));
    }
    const dir = inboxDir(paths, actor);
    ensureDir(dir);
    lock(
      inboxLock(actor),
      () => {
        writeFileSync(envelopeFile(dir, envelope.id), JSON.stringify(envelope, null, 2), "utf8");
      },
      lockOpts
    );
  }

  // Every dir an actor's inbox may live in: its canonical (case-folded) dir plus
  // the raw pre-fix dir, for the actor and each legacy identity alias. Reading
  // the raw form recovers envelopes deposited before the case-fold fix; writes
  // always target the canonical dir, so the raw dirs drain as messages are popped.
  function inboxSourceDirs(actor: string): string[] {
    // A legacy alias (`host:<cwd-leaf>`) is shared by every agent that ever
    // connected in that workspace, so a later (de-collisioned) peer must NOT
    // read the OWNER's legacy inbox. Owner = the FIRST claimant of that
    // legacyInstance (earliest alias `at`). `adoptedKeyring` can't gate this — a
    // fresh first connect has adoptedKeyring:false too. This keeps the legit
    // "read your own migrated inbox" while closing the cross-read.
    const allAliases = listIdentityAliases(paths.root);
    const ownedLegacy = allAliases
      .filter((a) => a.instance === actor)
      .filter((a) => {
        const claimants = allAliases.filter((x) => x.legacyInstance === a.legacyInstance);
        const earliest = claimants.reduce((m, x) => (x.at < m.at ? x : m), claimants[0]);
        return earliest.instance === actor;
      })
      .map((a) => a.legacyInstance);
    const dirs = new Set<string>();
    for (const handle of [actor, ...ownedLegacy]) {
      dirs.add(inboxDir(paths, handle));
      dirs.add(inboxDirRaw(paths, handle));
    }
    return [...dirs];
  }

  function readInbox(actor: string): H2AEnvelope[] {
    return mergeInboxDedup(inboxSourceDirs(actor).map((dir) => readEnvelopesFrom(dir)));
  }

  function popInboxMessage(actor: string, envelopeId: string): H2AEnvelope | undefined {
    const dirs = inboxSourceDirs(actor);
    for (const dir of dirs) ensureDir(dir);
    return lock(
      inboxLock(actor),
      () => {
        // Delete the id from EVERY source dir (canonical + raw + alias), not just
        // the first: the same envelope can sit in the canonical and the raw/legacy
        // dir at once, and a single-delete leaves the copy to resurface on the
        // next read. Return the first copy found.
        let found: H2AEnvelope | undefined;
        for (const dir of dirs) {
          const file = envelopeFile(dir, envelopeId);
          if (!existsSync(file)) continue;
          if (found === undefined) {
            found = JSON.parse(readFileSync(file, "utf8")) as H2AEnvelope;
          }
          unlinkSync(file);
        }
        return found;
      },
      lockOpts
    );
  }

  function putOutboxMessage(actor: string, envelope: H2AEnvelope): void {
    const validation = validateH2AEnvelope(envelope);
    if (!validation.ok) {
      throw new Error("putOutboxMessage: invalid H2A envelope — " + validation.errors.join("; "));
    }
    const dir = outboxDir(paths, actor);
    ensureDir(dir);
    lock(
      outboxLock(actor),
      () => {
        writeFileSync(envelopeFile(dir, envelope.id), JSON.stringify(envelope, null, 2), "utf8");
      },
      lockOpts
    );
  }

  function readOutbox(actor: string): H2AEnvelope[] {
    // canonical + raw fallback (like the inbox) so pre-case-fold outbox copies
    // stay visible; deduped by envelope id.
    const dirs = new Set([outboxDir(paths, actor), outboxDirRaw(paths, actor)]);
    return mergeInboxDedup([...dirs].map((dir) => readEnvelopesFrom(dir)));
  }

  // DEC-070: validated routing to a subagent address. Unlike the raw mailbox
  // put (which accepts any actor string), this asserts the subagent binding is
  // registered before delivery, so an envelope can never be routed to a
  // subagent that does not exist. Mailbox dirs are already safePathSegment-safe
  // for the `~` separator (DEC-062/068), so the address routes unchanged.
  function routeToSubagent(
    subagentId: string,
    envelope: H2AEnvelope,
    mailbox: "inbox" | "outbox" = "inbox"
  ): void {
    if (!findSubagent(subagentId)) {
      throw new Error(`Subagent not registered: ${subagentId}`);
    }
    if (subagentStatus(subagentId) === "revoked") {
      throw new Error(`Subagent revoked: ${subagentId}`);
    }
    if (mailbox === "outbox") putOutboxMessage(subagentId, envelope);
    else putInboxMessage(subagentId, envelope);
    lock(
      registryLock,
      () =>
        appendSubagentAudit({
          subagent: subagentId,
          type: "routed",
          at: new Date().toISOString(),
          envelopeId: envelope.id,
          mailbox
        }),
      lockOpts
    );
  }

  // DEC-070: parent fan-in — every registered subagent of a parent plus its
  // inbox, so the parent (or an auditor) sees what was routed to each subagent.
  // This is the "individually auditable" half of DEC-008's V2 goal.
  function readSubagentInboxes(
    parentInstance: string
  ): Array<{ subagent: string; envelopes: H2AEnvelope[] }> {
    return listSubagentsOf(parentInstance).map((b) => ({
      subagent: b.id,
      envelopes: readInbox(b.id)
    }));
  }

  return {
    paths,
    registerInstance,
    listInstances,
    findInstance,
    addInstanceKey,
    listInstanceKeys,
    listKeyEvents,
    revokeInstanceKey,
    grantOrgMembership,
    listOrgMembership,
    offboardInstance,
    listOffboards,
    registerSubagent,
    listSubagents,
    findSubagent,
    listSubagentsOf,
    openNegotiation,
    readNegotiation,
    updateNegotiationStatus,
    appendNegotiationEvent,
    readNegotiationJournal,
    declareConflitInteret,
    derivePosturesConflit,
    deriveDecisionDossier,
    derivePostureConfiance,
    stabilizeNegotiation,
    putInboxMessage,
    readInbox,
    popInboxMessage,
    putOutboxMessage,
    readOutbox,
    routeToSubagent,
    readSubagentInboxes,
    readSubagentAudit,
    readSubagentAuditOf,
    subagentStatus,
    revokeSubagent
  };
}
