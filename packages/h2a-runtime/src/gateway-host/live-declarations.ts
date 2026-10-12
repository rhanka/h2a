/**
 * L6a (H) — durable local store for explicit live workspace declarations.
 *
 * DESIGN (LIVE §2, §12):
 *  - The declaration store is LOCAL h2a state under the injected h2a root
 *    (<root>/live/declarations.json), outside every observed worktree and
 *    its git-dir/common-dir. It is authoritative independently of the live
 *    projection: losing the projection never loses registrations, and the
 *    store is never a projection-owned surface.
 *  - Writes are atomic (0600, tmp+rename) through the gateway-host private
 *    metadata writer; a corrupt store fails EXPLICITLY, it never silently
 *    restarts empty (that would erase desired live registrations).
 *  - Update is revision-guarded: a stale writer is refused with
 *    revision_conflict and never clobbers a newer revision.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writePrivateMetadata } from "./config-file.js";

/**
 * Mirror of the data-pure core DTO (`@sentropic/h2a`
 * `src/runtime/live/contracts.ts`). The core/runtime boundary forbids a
 * static runtime→core import (core reaches runtime through string specifiers),
 * so the runtime keeps a byte-compatible copy, cross-checked by
 * live-registration.test.ts against the core source until the neutral
 * engram contract lands.
 */
export const LIVE_DECLARATION_KIND = "h2a-live-declaration";
export const LIVE_DECLARATION_SCHEMA_VERSION = 1;
export const LIVE_DECLARATION_POLICY_VERSION = "live-git-1";
export const LIVE_CAPABILITY = "live";
export const LIVE_IDENTITY_UNCERTAINTY_MISSING_HISTORY = "missing_history";
export const LIVE_IDENTITY_UNCERTAINTY_SHALLOW_HISTORY = "shallow_history";

export interface LiveWorktreeRecord {
  readonly worktreeId: string;
  readonly path: string;
  readonly gitDir: string;
  readonly workspaceFingerprint?: string;
}

export interface LiveCloneRecord {
  readonly cloneId: string;
  readonly commonDirRealpath: string;
  readonly projectFingerprint?: string;
  readonly identityUncertainty: readonly string[];
}

export interface LiveSentropicBindingRecord {
  readonly sentropicWorkspaceId: string;
  readonly issuer: string;
  readonly bindingRevision: number;
}

export interface LiveDeclarationRecord {
  readonly kind: typeof LIVE_DECLARATION_KIND;
  readonly schemaVersion: typeof LIVE_DECLARATION_SCHEMA_VERSION;
  readonly declarationId: string;
  readonly hostScope: string;
  readonly principal?: string;
  readonly worktree: LiveWorktreeRecord;
  readonly clone: LiveCloneRecord;
  readonly authorizedRoots: readonly string[];
  readonly capability: typeof LIVE_CAPABILITY;
  readonly policyVersion: string;
  readonly revision: number;
  readonly binding?: LiveSentropicBindingRecord;
  readonly createdAt: string;
  readonly activatedAt: string;
  readonly updatedAt: string;
}

interface LiveDeclarationsFile {
  readonly kind: "h2a-live-declarations";
  readonly version: 1;
  readonly declarations: LiveDeclarationRecord[];
}

const isDeclarationRecord = (value: unknown): value is LiveDeclarationRecord => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<LiveDeclarationRecord>;
  return (
    record.kind === LIVE_DECLARATION_KIND &&
    typeof record.declarationId === "string" &&
    record.declarationId.length > 0 &&
    typeof record.worktree === "object" &&
    record.worktree !== null &&
    typeof record.clone === "object" &&
    record.clone !== null &&
    typeof record.revision === "number"
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
    if (!isDeclarationRecord(entry)) {
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
   * `expectedRevision` with `revision_conflict`, stamps the next revision and
   * persists atomically. The callback returns the next record body; the store
   * owns the revision arithmetic.
   */
  update(
    declarationId: string,
    expectedRevision: number,
    mutate: (record: LiveDeclarationRecord) => Omit<LiveDeclarationRecord, "revision">,
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
        a.declarationId < b.declarationId ? -1 : a.declarationId > b.declarationId ? 1 : 0,
      );
    },
    get(declarationId) {
      return load().find((record) => record.declarationId === declarationId);
    },
    findByPath(path) {
      return load().find((record) => record.authorizedRoots.includes(path));
    },
    insert(record) {
      const declarations = load();
      if (declarations.some((existing) => existing.declarationId === record.declarationId)) {
        throw new Error(
          `live declaration already exists: ${record.declarationId}`,
        );
      }
      persist([...declarations, record]);
    },
    update(declarationId, expectedRevision, mutate) {
      const declarations = load();
      const index = declarations.findIndex(
        (record) => record.declarationId === declarationId,
      );
      if (index === -1) {
        throw new Error(`unknown live declaration: ${declarationId}`);
      }
      const current = declarations[index]!;
      if (current.revision !== expectedRevision) {
        throw new Error(
          `revision_conflict: live declaration ${declarationId} is at revision ` +
            `${current.revision}, stale writer held ${expectedRevision}`,
        );
      }
      const body = mutate(current);
      if (body.declarationId !== declarationId) {
        throw new Error(`update must not change declarationId: ${declarationId}`);
      }
      const next: LiveDeclarationRecord = { ...body, revision: expectedRevision + 1 };
      const updated = [
        ...declarations.slice(0, index),
        next,
        ...declarations.slice(index + 1),
      ];
      persist(updated);
      return next;
    },
    remove(declarationId) {
      const declarations = load();
      const remaining = declarations.filter(
        (record) => record.declarationId !== declarationId,
      );
      if (remaining.length === declarations.length) return false;
      persist(remaining);
      return true;
    },
  };
}
