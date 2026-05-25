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
  appendJournalEntry,
  assertValidNegotiationState,
  canSignArtifactKind,
  computeHash,
  createJournalEntry,
  isH2AEnvelope,
  validateSubagentBinding,
  verifyCanonical,
  verifyJournalChain,
  type H2AActorRegistration,
  type H2ASubagentBinding,
  type H2AArtifactKind,
  type H2AEnvelope,
  type H2AJournalEntry,
  type H2AJournalPayload,
  type H2ANegotiationRecord,
  type H2ARole,
  type H2ASignature
} from "@sentropic/h2a";

import { withLockSync } from "./locks.js";
import { withLeaseSync } from "./lease.js";
import {
  inboxDir,
  localStorePaths,
  negotiationDir,
  negotiationJournalFile,
  outboxDir,
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
  type: "registered" | "routed";
  at: string;
  envelopeId?: string;
  mailbox?: "inbox" | "outbox";
}

export interface LocalStore {
  paths: LocalStorePaths;
  registerInstance(reg: H2AActorRegistration): void;
  listInstances(): H2AActorRegistration[];
  findInstance(id: string): H2AActorRegistration | undefined;
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
  stabilizeNegotiation(
    negotiationId: string,
    options?: { eventId?: string }
  ): {
    record: H2ANegotiationRecord;
    artifactHash: string;
    signers: string[];
    finalEvent: H2AJournalEntry<unknown>;
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
        const entriesForAppend = readNegotiationJournalUnlocked(negotiationId);
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
    if (!isH2AEnvelope(envelope)) {
      throw new Error("putInboxMessage: payload is not a valid H2A envelope");
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

  function readInbox(actor: string): H2AEnvelope[] {
    return readEnvelopesFrom(inboxDir(paths, actor));
  }

  function popInboxMessage(actor: string, envelopeId: string): H2AEnvelope | undefined {
    const dir = inboxDir(paths, actor);
    ensureDir(dir);
    return lock(
      inboxLock(actor),
      () => {
        const file = envelopeFile(dir, envelopeId);
        if (!existsSync(file)) return undefined;
        const envelope = JSON.parse(readFileSync(file, "utf8")) as H2AEnvelope;
        unlinkSync(file);
        return envelope;
      },
      lockOpts
    );
  }

  function putOutboxMessage(actor: string, envelope: H2AEnvelope): void {
    if (!isH2AEnvelope(envelope)) {
      throw new Error("putOutboxMessage: payload is not a valid H2A envelope");
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
    return readEnvelopesFrom(outboxDir(paths, actor));
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
    registerSubagent,
    listSubagents,
    findSubagent,
    listSubagentsOf,
    openNegotiation,
    readNegotiation,
    updateNegotiationStatus,
    appendNegotiationEvent,
    readNegotiationJournal,
    stabilizeNegotiation,
    putInboxMessage,
    readInbox,
    popInboxMessage,
    putOutboxMessage,
    readOutbox,
    routeToSubagent,
    readSubagentInboxes,
    readSubagentAudit,
    readSubagentAuditOf
  };
}
