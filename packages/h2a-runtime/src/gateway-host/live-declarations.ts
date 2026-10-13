/**
 * L6a (H) — durable local store for explicit live workspace declarations.
 *
 * DESIGN (LIVE §2, §12):
 *  - The declaration store is LOCAL h2a state under the injected h2a root
 *    (<root>/live/declarations.json), outside every observed worktree and
 *    its git-dir/common-dir. It is authoritative independently of the live
 *    projection: losing the projection never loses registrations, and the
 *    store is never a projection-owned surface.
 *  - Each record wraps the EXACT neutral WorkspaceDeclarationDto (flat
 *    identity triangle declarationId/cloneId/worktreeId, tenant,
 *    liveCapability, declarationRevision, flat product binding) plus the
 *    full local CloneIdentityDto/WorktreeIdentityDto (host-local realpath,
 *    git-dir and paths needed to operate; only the opaque ids cross to
 *    sentropic). Every write is validated with the engram validators — the
 *    runtime keeps no mirror of the contract, it imports
 *    @sentropic/engram-live/contracts (digest-pinned prerelease, see the
 *    core live/contracts.ts header).
 *  - Writes are atomic (0600, tmp+rename) through the gateway-host private
 *    metadata writer; a corrupt store fails EXPLICITLY, it never silently
 *    restarts empty (that would erase desired live registrations). A
 *    pre-realignment (nested, `live-git-1`) store file is rejected
 *    EXPLICITLY as unsupported — never silently migrated, never silently
 *    read: L6a is not consumed yet, so no migration replay exists and the
 *    operator removes the file to start fresh.
 *  - Update is revision-guarded ATOMICALLY: the caller composes the next
 *    record through the contract rules (declarationRevision + 1, immutable
 *    identity triangle, binding renewal-or-preserved); the store verifies
 *    the guard, the triangle, the binding monotonicity (first binding
 *    exactly INITIAL_BINDING_REVISION, then strictly greater) and the
 *    final DTOs, then re-verifies the durable revision and persists under
 *    ONE exclusive lock. A stale writer is refused with the typed
 *    LiveRevisionConflict, never clobbering; a declaration removed after
 *    the read is never resurrected. Insert and remove hold the same lock,
 *    so every read-check-write (including removals) is serialized.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  INITIAL_BINDING_REVISION,
  validateCloneIdentity,
  validateWorkspaceDeclaration,
  validateWorktreeIdentity,
} from "@sentropic/engram-live/contracts";
import type {
  CloneIdentityDto,
  WorkspaceDeclarationDto,
  WorktreeIdentityDto,
} from "@sentropic/engram-live/contracts";

import { writePrivateMetadata } from "./config-file.js";

export const LIVE_DECLARATION_KIND = "h2a-live-declaration";
export const LIVE_DECLARATION_SCHEMA_VERSION = 1;

/**
 * Typed revision conflict: the durable declaration moved (or vanished)
 * under a writer holding a stale base revision. The message keeps the
 * `revision_conflict` marker; the name and the revision fields let callers
 * branch on it without parsing text.
 */
export class LiveRevisionConflict extends Error {
  readonly declarationId: string;
  readonly expectedDeclarationRevision: number;
  /** Current durable revision; undefined when the declaration is gone. */
  readonly actualDeclarationRevision: number | undefined;

  constructor(
    declarationId: string,
    expectedDeclarationRevision: number,
    actualDeclarationRevision: number | undefined,
  ) {
    super(
      actualDeclarationRevision === undefined
        ? `revision_conflict: live declaration ${declarationId} was removed; stale writer held declaration revision ${expectedDeclarationRevision}`
        : `revision_conflict: live declaration ${declarationId} is at declaration revision ` +
            `${actualDeclarationRevision}, stale writer held ${expectedDeclarationRevision}`,
    );
    this.name = "LiveRevisionConflict";
    this.declarationId = declarationId;
    this.expectedDeclarationRevision = expectedDeclarationRevision;
    this.actualDeclarationRevision = actualDeclarationRevision;
  }
}

// ---------------------------------------------------------------------------
// Exclusive store lock (synchronous, no dependency).
// ---------------------------------------------------------------------------
//
// Every mutation (insert/update/remove) holds this lock from its read to
// its persisted rename, so no stale revision can slip between the guard
// check and the write — across processes as well as across store
// instances. The lock is an atomically created directory; acquisition
// retries briefly, recovers abandoned locks by age, then fails explicitly
// (never silently proceeding unlocked). Re-entry by the SAME process only
// bumps a counter: the pre-persist re-verification inside update() still
// rejects a same-process interleaving, so re-entrancy never hides a
// conflict. Reads stay lock-free: the tmp+rename persistence is atomic,
// so readers always observe one whole committed file.

const STORE_LOCK_DIRNAME = ".declarations.lock";
const STORE_LOCK_TIMEOUT_MS = 5_000;
const STORE_LOCK_STALE_MS = 10_000;
const STORE_LOCK_POLL_MS = 5;

/** Lock re-entry counters for this process, keyed by lock directory. */
const storeLocksHeld = new Map<string, number>();

const lockDirFor = (root: string): string => join(root, "live", STORE_LOCK_DIRNAME);

const sleepSync = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

function acquireStoreLock(root: string): void {
  const dir = lockDirFor(root);
  mkdirSync(join(root, "live"), { recursive: true });
  const held = storeLocksHeld.get(dir) ?? 0;
  if (held > 0) {
    storeLocksHeld.set(dir, held + 1);
    return;
  }
  const deadline = Date.now() + STORE_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, "pid"), `${process.pid}\n`, { mode: 0o600 });
      storeLocksHeld.set(dir, 1);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    // A lock older than the stale threshold belongs to a crashed holder
    // (critical sections are milliseconds): clear it and retry.
    try {
      if (Date.now() - statSync(dir).mtimeMs > STORE_LOCK_STALE_MS) {
        rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // The directory vanished under us; the next iteration retries.
    }
    if (Date.now() >= deadline) {
      throw new Error(`live declarations store busy: cannot acquire lock at ${dir}`);
    }
    sleepSync(STORE_LOCK_POLL_MS);
  }
}

function releaseStoreLock(root: string): void {
  const dir = lockDirFor(root);
  const held = storeLocksHeld.get(dir) ?? 0;
  if (held > 1) {
    storeLocksHeld.set(dir, held - 1);
    return;
  }
  storeLocksHeld.delete(dir);
  rmSync(dir, { recursive: true, force: true });
}

function withStoreLock<T>(root: string, fn: () => T): T {
  acquireStoreLock(root);
  try {
    return fn();
  } finally {
    releaseStoreLock(root);
  }
}

export interface LiveDeclarationRecord {
  readonly kind: typeof LIVE_DECLARATION_KIND;
  readonly schemaVersion: typeof LIVE_DECLARATION_SCHEMA_VERSION;
  /** The exact neutral DTO; validated with validateWorkspaceDeclaration on every write. */
  readonly declaration: WorkspaceDeclarationDto;
  /** Full local clone identity (commonDirRealpath stays host-local; only cloneId is shared). */
  readonly clone: CloneIdentityDto;
  /** Full local worktree identity. */
  readonly worktree: WorktreeIdentityDto;
  readonly createdAt: string;
  /** Activation timestamp; replay after restart never renews it. */
  readonly activatedAt: string;
  readonly updatedAt: string;
}

interface LiveDeclarationsFile {
  readonly kind: "h2a-live-declarations";
  readonly version: 1;
  readonly declarations: LiveDeclarationRecord[];
}

/** Structural validation of a record: envelope, triangle consistency, then the engram validators. */
const validateRecord = (record: LiveDeclarationRecord): string | undefined => {
  if (record.kind !== LIVE_DECLARATION_KIND) return "unexpected declaration kind";
  if (record.schemaVersion !== LIVE_DECLARATION_SCHEMA_VERSION) {
    return "unsupported declaration schema version";
  }
  const declaration = validateWorkspaceDeclaration(record.declaration);
  if (!declaration.ok) return `invalid declaration: ${declaration.errors.join("; ")}`;
  if (record.clone.cloneId !== record.declaration.cloneId) {
    return "clone/worktree attachment mismatch: clone.cloneId differs from declaration.cloneId";
  }
  if (record.worktree.cloneId !== record.declaration.cloneId) {
    return "clone/worktree attachment mismatch: worktree.cloneId differs from declaration.cloneId";
  }
  if (record.worktree.worktreeId !== record.declaration.worktreeId) {
    return "clone/worktree attachment mismatch: worktree.worktreeId differs from declaration.worktreeId";
  }
  const clone = validateCloneIdentity(record.clone);
  if (!clone.ok) return `invalid clone identity: ${clone.errors.join("; ")}`;
  const worktree = validateWorktreeIdentity(record.worktree);
  if (!worktree.ok) return `invalid worktree identity: ${worktree.errors.join("; ")}`;
  for (const field of ["createdAt", "activatedAt", "updatedAt"] as const) {
    if (typeof record[field] !== "string" || record[field].length === 0) {
      return `missing ${field}`;
    }
  }
  return undefined;
};

const isRecord = (value: unknown): value is LiveDeclarationRecord => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<LiveDeclarationRecord>;
  if (
    record.kind !== LIVE_DECLARATION_KIND ||
    record.schemaVersion !== LIVE_DECLARATION_SCHEMA_VERSION ||
    typeof record.declaration !== "object" ||
    record.declaration === null ||
    typeof record.clone !== "object" ||
    record.clone === null ||
    typeof record.worktree !== "object" ||
    record.worktree === null ||
    typeof record.declaration.declarationId !== "string"
  ) {
    return false;
  }
  return validateRecord(record as LiveDeclarationRecord) === undefined;
};

/** Pre-realignment entries (nested shape, top-level hostScope/revision, no neutral DTO) are never read as records. */
const isLegacyRecord = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    "hostScope" in record ||
    ("declarationId" in record && !("declaration" in record))
  );
};

/** Durable declarations live under the injected h2a root, never a worktree. */
export function liveDeclarationsPath(root: string): string {
  return join(root, "live", "declarations.json");
}

const readStoreFile = (root: string): LiveDeclarationsFile => {
  const path = liveDeclarationsPath(root);
  if (!existsSync(path)) {
    return { kind: "h2a-live-declarations", version: 1, declarations: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    // Explicit failure: a corrupt declaration store must never be treated
    // as an empty registry (LIVE §12: database loss must not erase live
    // registrations; silent loss is worse).
    throw new Error(
      `live declarations store unreadable at ${path}: ${(error as Error).message}`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Partial<LiveDeclarationsFile>).kind !== "h2a-live-declarations" ||
    (parsed as Partial<LiveDeclarationsFile>).version !== 1 ||
    !Array.isArray((parsed as Partial<LiveDeclarationsFile>).declarations)
  ) {
    throw new Error(`live declarations store invalid at ${path}`);
  }
  const file = parsed as LiveDeclarationsFile;
  for (const entry of file.declarations) {
    if (isLegacyRecord(entry)) {
      throw new Error(
        `live declarations store uses the pre-realignment L6a format at ${path}: ` +
          `remove the file to start fresh (L6a is not consumed yet; no migration replay exists)`,
      );
    }
    if (!isRecord(entry)) {
      throw new Error(
        `live declarations store contains a malformed declaration at ${path}`,
      );
    }
  }
  return file;
};

const writeStoreFile = (root: string, file: LiveDeclarationsFile): void => {
  writePrivateMetadata(liveDeclarationsPath(root), file);
};

export interface LiveDeclarationStore {
  /** All durable declarations, deterministically ordered. */
  list(): readonly LiveDeclarationRecord[];
  get(declarationId: string): LiveDeclarationRecord | undefined;
  /** First declaration whose authorized root covers `path`. */
  findByPath(path: string): LiveDeclarationRecord | undefined;
  insert(record: LiveDeclarationRecord): void;
  /**
   * Revision-guarded mutation: re-reads the durable store, refuses a stale
   * `expectedDeclarationRevision` with `revision_conflict`, verifies the
   * composed next record (declarationRevision exactly + 1, immutable
   * identity triangle, binding renewal-or-preserved with first binding
   * exactly INITIAL_BINDING_REVISION then strictly greater, valid DTOs)
   * and persists atomically. The callback returns the fully composed next
   * record; the store owns the guard, never silent arithmetic.
   */
  update(
    declarationId: string,
    expectedDeclarationRevision: number,
    mutate: (record: LiveDeclarationRecord) => LiveDeclarationRecord,
  ): LiveDeclarationRecord;
  remove(declarationId: string): boolean;
}

/**
 * A store instance is a thin read-through over the durable file: every
 * operation re-reads, so two instances (or two processes) on the same root
 * observe each other's committed writes.
 */
export function createLiveDeclarationStore(root: string): LiveDeclarationStore {
  const load = (): LiveDeclarationRecord[] => readStoreFile(root).declarations;
  const persist = (declarations: readonly LiveDeclarationRecord[]): void => {
    writeStoreFile(root, {
      kind: "h2a-live-declarations",
      version: 1,
      declarations: [...declarations],
    });
  };
  return {
    list() {
      return [...load()].sort((a, b) =>
        a.declaration.declarationId < b.declaration.declarationId
          ? -1
          : a.declaration.declarationId > b.declaration.declarationId
            ? 1
            : 0,
      );
    },
    get(declarationId) {
      return load().find((record) => record.declaration.declarationId === declarationId);
    },
    findByPath(path) {
      return load().find((record) => record.declaration.authorizedRoots.includes(path));
    },
    insert(record) {
      const problem = validateRecord(record);
      if (problem !== undefined) {
        throw new Error(`invalid live declaration record: ${problem}`);
      }
      withStoreLock(root, () => {
        const declarations = load();
        if (
          declarations.some(
            (existing) => existing.declaration.declarationId === record.declaration.declarationId,
          )
        ) {
          throw new Error(
            `live declaration already exists: ${record.declaration.declarationId}`,
          );
        }
        persist([...declarations, record]);
      });
    },
    update(declarationId, expectedDeclarationRevision, mutate) {
      return withStoreLock(root, () => {
        const declarations = load();
        const index = declarations.findIndex(
          (record) => record.declaration.declarationId === declarationId,
        );
        if (index === -1) {
          throw new Error(`unknown live declaration: ${declarationId}`);
        }
        const current = declarations[index]!;
        if (current.declaration.declarationRevision !== expectedDeclarationRevision) {
          throw new LiveRevisionConflict(
            declarationId,
            expectedDeclarationRevision,
            current.declaration.declarationRevision,
          );
        }
        const next = mutate(current);
        if (next.declaration.declarationId !== declarationId) {
          throw new Error(`update must not change declarationId: ${declarationId}`);
        }
        if (next.declaration.declarationRevision !== expectedDeclarationRevision + 1) {
          throw new Error(
            `update must advance declarationRevision by exactly one: held ${expectedDeclarationRevision}`,
          );
        }
        for (
          const field of [
            "tenant",
            "principal",
            "hostFingerprint",
            "cloneId",
            "worktreeId",
            "liveCapability",
          ] as const
        ) {
          if (next.declaration[field] !== current.declaration[field]) {
            throw new Error(
              `update must not change declaration identity field "${field}": ${declarationId}`,
            );
          }
        }
        // Binding renewal-or-preserved: a workspace/issuer/revision change
        // renews the binding (complete triplet, first binding exactly
        // INITIAL_BINDING_REVISION, then strictly greater); any other
        // mutation preserves it.
        const previous = current.declaration;
        const candidate = next.declaration;
        const workspaceChanged = candidate.serverWorkspaceId !== previous.serverWorkspaceId;
        const issuerChanged = candidate.serverIssuer !== previous.serverIssuer;
        const revisionTouched = candidate.bindingRevision !== previous.bindingRevision;
        if (workspaceChanged || issuerChanged || revisionTouched) {
          if (
            candidate.serverWorkspaceId === undefined ||
            candidate.serverIssuer === undefined ||
            candidate.bindingRevision === undefined
          ) {
            throw new Error(
              `update must carry the complete serverWorkspaceId + serverIssuer + bindingRevision triplet when the binding changes: ${declarationId}`,
            );
          }
          if (previous.bindingRevision === undefined) {
            if (candidate.bindingRevision !== INITIAL_BINDING_REVISION) {
              throw new Error(
                `update must carry bindingRevision ${INITIAL_BINDING_REVISION} for the first product binding: ${declarationId}`,
              );
            }
          } else if (candidate.bindingRevision <= previous.bindingRevision) {
            throw new Error(
              `update must carry a strictly increasing bindingRevision: ${declarationId}`,
            );
          }
        }
        const problem = validateRecord(next);
        if (problem !== undefined) {
          throw new Error(`invalid updated live declaration record: ${problem}`);
        }
        // Atomic compare-and-write under the same lock: re-read the durable
        // file and refuse when the declaration moved (a concurrent writer
        // committed inside mutate()) or vanished (an interleaved removal).
        // The merge applies onto the FRESH list, so unrelated concurrent
        // records are never dropped; a stale write never clobbers and a
        // removed declaration never resurrects.
        const fresh = load();
        const refetch = fresh.find(
          (record) => record.declaration.declarationId === declarationId,
        );
        if (refetch === undefined) {
          throw new LiveRevisionConflict(
            declarationId,
            expectedDeclarationRevision,
            undefined,
          );
        }
        if (refetch.declaration.declarationRevision !== expectedDeclarationRevision) {
          throw new LiveRevisionConflict(
            declarationId,
            expectedDeclarationRevision,
            refetch.declaration.declarationRevision,
          );
        }
        persist(
          fresh.map((record) =>
            record.declaration.declarationId === declarationId ? next : record,
          ),
        );
        return next;
      });
    },
    remove(declarationId) {
      return withStoreLock(root, () => {
        const declarations = load();
        const remaining = declarations.filter(
          (record) => record.declaration.declarationId !== declarationId,
        );
        if (remaining.length === declarations.length) return false;
        persist(remaining);
        return true;
      });
    },
  };
}
