/**
 * L6a (H) — explicit live workspace registration (composition seam).
 *
 * DESIGN (LIVE §2–3, §10, §12; owner decision Q4 = A):
 *  - Activation is EXPLICIT and once per worktree: bind, transcript upload,
 *    code-workspace creation and agent sessions are never inputs here, and
 *    nothing in this module observes sessions at all. Session end never
 *    unregisters; host restart replays durable declarations.
 *  - The durable declaration store is LOCAL h2a state (see
 *    ./live-declarations.ts); it is never the product workspace router and
 *    never projection-owned.
 *  - Identities are minted ONLY through the three canonical public
 *    derivations from the vendored neutral integration entry
 *    (../vendor/engram-live, see the core live/contracts.ts header), so
 *    H ids are byte-identical to the engram (E) side for identical inputs:
 *    equal fingerprints under different realpaths derive distinct clones,
 *    while linked worktrees sharing one common-dir derive the same clone.
 *    Missing/shallow history is explicit uncertainty, never a
 *    URL/fingerprint-only merge.
 *  - The public `ws:` worktree/project fingerprint is H's own preserved
 *    fingerprint (spec §12: keep the existing derivation byte-identical);
 *    the two helpers below are its only copy, forced by the core/runtime
 *    boundary (no static runtime→core import), and pinned byte-identical
 *    to core by live-registration.test.ts. They compute fingerprints, never
 *    opaque ids: every cloneId/worktreeId/declarationId comes from the
 *    package.
 *  - Local authority is a seam with NO fallback: a positive authorization
 *    without a verified principal is refused explicitly
 *    (`verified_principal_required`) before any neutral DTO is built — for
 *    reads as well as activation (spec §12). The default authority DENIES
 *    every operation explicitly (`local_authority_unavailable`) until L7a
 *    supplies verified local principals and the stable owner scope.
 *    Refusal is an error, never a successful empty result.
 *  - Removal and clone withdrawal stop work first (cancellation seam),
 *    then return the contract revocation (exact declarationId, tenant,
 *    clone/worktree attachment, declarationRevision, reason, full private
 *    purge request); committed history is never touched.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";

import {
  EXPLICIT_LIVE_CAPABILITY,
  INITIAL_DECLARATION_REVISION,
  NON_ACTIVATING_LIFECYCLE_KINDS,
  POLICY_VERSION,
  isIdentityUncertaintyState,
  isNonActivatingLifecycleKind,
  validateDeclarationRevocation,
  validateWorkspaceDeclaration,
} from "../vendor/engram-live/contracts.js";
import type {
  CloneIdentityDto,
  DeclarationRevocationDto,
  IdentityUncertaintyState,
  NonActivatingLifecycleKind,
  OidAlgorithm,
  RevocationReason,
  WorkspaceDeclarationDto,
  WorktreeIdentityDto,
} from "../vendor/engram-live/contracts.js";
import {
  deriveCloneIdentity,
  deriveDeclarationIdentity,
  deriveWorktreeIdentity,
} from "../vendor/engram-live/integration.js";

import {
  LIVE_DECLARATION_KIND,
  LIVE_DECLARATION_SCHEMA_VERSION,
  createLiveDeclarationStore,
  type LiveDeclarationRecord,
  type LiveDeclarationStore,
} from "./live-declarations.js";

// ---------------------------------------------------------------------------
// H-public `ws:` fingerprint (LIVE §12: preserved byte-identical).
// ---------------------------------------------------------------------------
//
// The ONLY runtime copy of the core derivation (core/runtime boundary
// forbids a static runtime→core import). Fingerprints only: opaque ids are
// minted exclusively through the canonical package derivations above.

export function normalizeRootCommits(shas: ReadonlyArray<string>): string {
  return [...new Set(shas.map((s) => s.trim()).filter((s) => s.length > 0))]
    .sort()
    .join(",");
}

export function computeDurableWorkspaceId(
  rootCommitSHA: string,
  worktreeRelPath: string,
): string {
  const hex = createHash("sha256")
    .update(`${rootCommitSHA}\n${worktreeRelPath}`, "utf8")
    .digest("hex");
  return `ws:${hex}`;
}

// ---------------------------------------------------------------------------
// Git identity probe (read-only, safe flags; never writes to the worktree)
// ---------------------------------------------------------------------------

export interface LiveWorkspaceProbe {
  /** Authorized root: resolved real path of the observed worktree. */
  readonly worktreeRealpath: string;
  /** Resolved git-dir (`.git/worktrees/<name>` for a linked worktree). */
  readonly gitDir: string;
  /** Resolved common-dir real path, shared by linked worktrees. */
  readonly commonDirRealpath: string;
  /** "" for the main worktree, else the linked-worktree name. */
  readonly worktreeName: string;
  /** Repository object format; undefined when Git cannot report it. */
  readonly oidAlgorithm?: OidAlgorithm;
  /** Normalized root commits; undefined when history is missing. */
  readonly rootCommits?: string;
  /** Preserved public `ws:` fingerprint; absent with missing_history. */
  readonly workspaceFingerprint?: string;
  /** Project fingerprint (empty main-worktree component); may be absent. */
  readonly projectFingerprint?: string;
  /** A `shallow` graft file exists in the common dir. */
  readonly shallow: boolean;
  /** Explicit identity/coverage uncertainty labels, never silent. */
  readonly identityUncertainty: readonly IdentityUncertaintyState[];
}

const resolveWithin = (base: string, path: string): string => {
  if (isAbsolute(path)) return path;
  return resolve(base, path);
};

const realpathOr = (path: string, fallback: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return fallback;
  }
};

/**
 * Probe a worktree's live identity with read-only Git plumbing. Every
 * invocation disables optional locks (`--no-optional-locks`, LIVE §7) and
 * never writes to the observed worktree, its index or its refs. Returns
 * undefined when the path is not a Git worktree; missing (unborn HEAD) or
 * shallow history is a successful probe with explicit uncertainty.
 */
export function probeLiveWorkspace(cwd: string): LiveWorkspaceProbe | undefined {
  const worktreeRealpath = realpathOr(cwd, resolve(cwd));
  const spawnOpts = {
    cwd: worktreeRealpath,
    stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
    timeout: 5000,
    windowsHide: true,
  };
  const run = (args: readonly string[]): string | undefined => {
    try {
      const out = execFileSync("git", ["--no-optional-locks", "-C", worktreeRealpath, ...args], spawnOpts)
        .toString("utf8")
        .trim();
      return out.length > 0 ? out : undefined;
    } catch {
      return undefined;
    }
  };

  // --- git-dir / common-dir (resolve relative outputs against the root) ---
  const gitDirRaw = run(["rev-parse", "--git-dir"]);
  const commonDirRaw = run(["rev-parse", "--git-common-dir"]);
  if (gitDirRaw === undefined || commonDirRaw === undefined) return undefined;
  const gitDir = realpathOr(resolveWithin(worktreeRealpath, gitDirRaw), gitDirRaw);
  const commonDirRealpath = realpathOr(
    resolveWithin(worktreeRealpath, commonDirRaw),
    commonDirRaw,
  );
  const worktreeName = gitDir === commonDirRealpath ? "" : basename(gitDir);

  // --- object format (required to mint a contract-valid clone identity) ---
  const objectFormat = run(["rev-parse", "--show-object-format"]);
  const oidAlgorithm: OidAlgorithm | undefined =
    objectFormat === "sha1" || objectFormat === "sha256" ? objectFormat : undefined;

  // --- root commits of this worktree's HEAD (absent on unborn HEAD) ---
  // HEAD-bound by design: this feeds the public per-worktree `ws:`
  // fingerprint only, never the clone key.
  const rootCommitLines = run(["rev-list", "--max-parents=0", "HEAD"]);
  const rootCommits = rootCommitLines === undefined ? undefined : normalizeRootCommits(rootCommitLines.split(/\r?\n/));

  // --- common-dir history roots (HEAD-independent clone key, spec §12) ---
  // The union of root commits over every ref in the shared common-dir,
  // identical from every worktree of the clone whatever its HEAD (an
  // orphan branch checked out in one worktree must not fork the clone).
  // HEAD itself is deliberately excluded: it is per-worktree state.
  const refTipLines = run(["for-each-ref", "--format=%(objectname)"]);
  const refTips =
    refTipLines === undefined
      ? []
      : refTipLines
          .split(/\r?\n/)
          .map((tip) => tip.trim())
          .filter((tip) => tip.length > 0);
  let cloneRootCommits: string | undefined;
  if (refTips.length > 0) {
    const cloneRootLines = run(["rev-list", "--max-parents=0", ...refTips]);
    cloneRootCommits =
      cloneRootLines === undefined
        ? undefined
        : normalizeRootCommits(cloneRootLines.split(/\r?\n/));
  }

  const shallow = existsSync(
    resolve(commonDirRealpath.startsWith("/") ? commonDirRealpath : resolveWithin(worktreeRealpath, commonDirRealpath), "shallow"),
  );

  const identityUncertainty: IdentityUncertaintyState[] = [];
  if (rootCommits === undefined) {
    identityUncertainty.push("missing_history");
  }
  // The clone fingerprint may be absent only under explicit
  // missing_history uncertainty (engram contract): when the common-dir
  // holds no ref history at all, say so even if this worktree's HEAD
  // somehow resolves.
  if (cloneRootCommits === undefined && !identityUncertainty.includes("missing_history")) {
    identityUncertainty.push("missing_history");
  }
  if (shallow) {
    identityUncertainty.push("shallow_history");
  }

  return {
    worktreeRealpath,
    gitDir,
    commonDirRealpath,
    worktreeName,
    ...(oidAlgorithm !== undefined ? { oidAlgorithm } : {}),
    ...(rootCommits !== undefined ? { rootCommits } : {}),
    ...(rootCommits !== undefined
      ? { workspaceFingerprint: computeDurableWorkspaceId(rootCommits, worktreeName) }
      : {}),
    ...(cloneRootCommits !== undefined
      ? { projectFingerprint: computeDurableWorkspaceId(cloneRootCommits, "") }
      : {}),
    shallow,
    identityUncertainty,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle classification (spec §12: these kinds never activate/remove)
// ---------------------------------------------------------------------------

/**
 * Classify a host lifecycle event against live declarations. Bind, upload,
 * code-workspace creation and session open/end never activate or remove a
 * declaration: the only outcome is "no-activation-change". Unknown kinds
 * are refused. Pinned to NON_ACTIVATING_LIFECYCLE_KINDS, never a copy.
 */
export function classifyLifecycleEvent(kind: NonActivatingLifecycleKind): "no-activation-change" {
  if (!isNonActivatingLifecycleKind(kind)) {
    throw new Error(`unknown lifecycle kind: ${String(kind)}`);
  }
  return "no-activation-change";
}

// ---------------------------------------------------------------------------
// Authority, work control and the registration service
// ---------------------------------------------------------------------------

export type LiveOperation =
  | "activate"
  | "list"
  | "status"
  | "resolve"
  | "remove"
  | "remove-clone"
  | "rebind"
  | "replay";

export interface LiveAuthorizationRequest {
  readonly operation: LiveOperation;
  /** Stable local scope `local:<host-owner-id>`; never a sentropic tenant. */
  readonly tenant: string;
  readonly path?: string;
  readonly declarationId?: string;
  readonly hostFingerprint?: string;
}

export interface LiveAuthorizationDecision {
  readonly ok: boolean;
  readonly reason?: string;
  readonly principal?: string;
}

export interface LiveAuthority {
  authorize(request: LiveAuthorizationRequest): LiveAuthorizationDecision;
}

/**
 * Default authority until L7a: deny everything explicitly. Local identity
 * verification is L7a work; until it exists, no declaration API is usable,
 * and denial is an error — never a successful empty result (A01).
 */
export const unverifiedLocalLiveAuthority: LiveAuthority = {
  authorize: () => ({ ok: false, reason: "local_authority_unavailable" }),
};

export interface LiveWorkScope {
  readonly declarationId: string;
  readonly cloneId: string;
}

/**
 * Cancellation/purge seam. Removal stops scheduled (delayed) work and
 * requests a purge of PRIVATE local snapshots and derived indexes only;
 * authorized committed history is never deleted by live (LIVE §10).
 */
export interface LiveWorkController {
  cancelScheduledWork(scope: LiveWorkScope): boolean;
  requestPrivatePurge(scope: LiveWorkScope): boolean;
  hasInFlightWork(scope: LiveWorkScope): boolean;
}

export const inertLiveWorkController: LiveWorkController = {
  cancelScheduledWork: () => false,
  requestPrivatePurge: () => false,
  hasInFlightWork: () => false,
};

export class LiveAccessRefused extends Error {
  constructor(
    readonly operation: LiveOperation,
    readonly reason: string,
  ) {
    super(`live ${operation} refused: ${reason}`);
    this.name = "LiveAccessRefused";
  }
}

export interface LiveRegistrationOptions {
  /** Durable h2a root (outside every observed worktree); injected, never a worktree. */
  readonly root: string;
  /**
   * Stable local scope `local:<host-owner-id>`; defaults to the OS owner.
   * PROVISIONAL until L7a supplies the verified owner scope — never a
   * sentropic tenant inferred from a workspace id.
   */
  readonly tenant?: string;
  /** Authority seam; defaults to {@link unverifiedLocalLiveAuthority} (L7a completes verification). */
  readonly authority?: LiveAuthority;
  /** Work-control seam; defaults to {@link inertLiveWorkController}. */
  readonly workController?: LiveWorkController;
  /** Injectable clock for deterministic timestamps. */
  readonly now?: () => string;
}

export interface ActivateLiveRequest {
  readonly path: string;
}

export interface RemoveLiveRequest {
  readonly path: string;
  /** Mandatory: every revocation names its reason (contract DTO). */
  readonly reason: RevocationReason;
}

export interface RemoveCloneLiveRequest {
  readonly cloneId: string;
  /** Mandatory: every revocation names its reason (contract DTO). */
  readonly reason: RevocationReason;
}

export interface RebindLiveRequest {
  readonly path: string;
  readonly sentropicWorkspaceId: string;
  readonly issuer: string;
}

export interface RemoveLiveResult {
  readonly removed: boolean;
  readonly canceledWork: boolean;
  readonly purgeRequested: boolean;
  /** The contract revocation, present exactly when a declaration was removed. */
  readonly revocation?: DeclarationRevocationDto;
}

export interface RemoveCloneLiveResult {
  /** Number of declarations revoked. */
  readonly removed: number;
  /** One contract revocation per revoked declaration, in declarationId order. */
  readonly revocations: readonly DeclarationRevocationDto[];
  readonly canceledWork: boolean;
  readonly purgeRequested: boolean;
}

export interface ResolvedLivePath {
  readonly declaration: LiveDeclarationRecord;
  readonly relativePath: string;
}

export interface LiveRegistration {
  readonly authority: LiveAuthority;
  probe(cwd: string): LiveWorkspaceProbe | undefined;
  /** Explicit activation, once per worktree; idempotent re-activation replays the existing declaration. */
  activate(request: ActivateLiveRequest): { declaration: LiveDeclarationRecord; created: boolean };
  list(): readonly LiveDeclarationRecord[];
  status(path: string): LiveDeclarationRecord | undefined;
  /** Path-resolution seam: the declaration covering `path`, with its relative path. */
  resolvePath(path: string): ResolvedLivePath | undefined;
  /** Stop work, cancel delayed jobs, revoke the declaration with its reason, request a private purge, then unregister. */
  remove(request: RemoveLiveRequest): RemoveLiveResult;
  /** Withdraw a whole clone: revoke EACH of its declarations, one revocation each. */
  removeClone(request: RemoveCloneLiveRequest): RemoveCloneLiveResult;
  /** Server/issuer-bound product live intent; requires fresh revalidation, bumps the binding revision. */
  rebind(request: RebindLiveRequest): LiveDeclarationRecord;
  /** Host-startup replay of durable declarations, without renewed activation. */
  replay(): readonly LiveDeclarationRecord[];
}

const defaultTenant = (): string => {
  const username = userInfo().username;
  return `local:${username && username.length > 0 ? username : "unknown"}`;
};

export function createLiveRegistration(
  options: LiveRegistrationOptions,
): LiveRegistration {
  const root = options.root;
  const tenant = options.tenant ?? defaultTenant();
  const authority = options.authority ?? unverifiedLocalLiveAuthority;
  const workController = options.workController ?? inertLiveWorkController;
  const now = options.now ?? (() => new Date().toISOString());
  const store: LiveDeclarationStore = createLiveDeclarationStore(root);

  const authorize = (
    operation: LiveOperation,
    detail: { path?: string; declarationId?: string; hostFingerprint?: string } = {},
  ): LiveAuthorizationDecision & { principal: string } => {
    const decision = authority.authorize({
      operation,
      tenant,
      ...(detail.path !== undefined ? { path: detail.path } : {}),
      ...(detail.declarationId !== undefined ? { declarationId: detail.declarationId } : {}),
      ...(detail.hostFingerprint !== undefined
        ? { hostFingerprint: detail.hostFingerprint }
        : {}),
    });
    if (!decision.ok) {
      throw new LiveAccessRefused(operation, decision.reason ?? "denied");
    }
    // No fabricated fallback: a positive authorization without a verified
    // principal is refused before any neutral DTO is built. The stable
    // owner scope and principal proof are L7a work — say so, don't invent.
    if (decision.principal === undefined || decision.principal.trim().length === 0) {
      throw new LiveAccessRefused(operation, "verified_principal_required");
    }
    return { ...decision, principal: decision.principal };
  };

  const resolveInputPath = (path: string): string => realpathOr(resolve(path), resolve(path));

  const findByAuthorizedRoot = (path: string): LiveDeclarationRecord | undefined => {
    const resolved = resolveInputPath(path);
    return store
      .list()
      .find(
        (record) =>
          record.declaration.authorizedRoots.includes(resolved) ||
          record.declaration.authorizedRoots.includes(realpathOr(resolved, resolved)),
      );
  };

  const buildRevocation = (
    record: LiveDeclarationRecord,
    reason: RevocationReason,
  ): DeclarationRevocationDto => {
    const revocation: DeclarationRevocationDto = {
      declarationId: record.declaration.declarationId,
      tenant: record.declaration.tenant,
      cloneId: record.declaration.cloneId,
      worktreeId: record.declaration.worktreeId,
      declarationRevision: record.declaration.declarationRevision,
      reason,
      requestPrivatePurge: {
        purgePrivateSnapshots: true,
        purgeDerivedIndexes: true,
        revokeDecryptability: true,
        preserveCommittedHistory: true,
      },
    };
    const checked = validateDeclarationRevocation(revocation);
    if (!checked.ok) {
      throw new Error(`invalid live declaration revocation: ${checked.errors.join("; ")}`);
    }
    return revocation;
  };

  return {
    authority,
    probe: probeLiveWorkspace,
    activate(request) {
      const decision = authorize("activate", { path: request.path });
      const probe = probeLiveWorkspace(request.path);
      if (probe === undefined) {
        throw new Error(`not a git worktree: ${request.path}`);
      }
      for (const state of probe.identityUncertainty) {
        if (!isIdentityUncertaintyState(state)) {
          throw new Error(`unknown identity uncertainty state: ${String(state)}`);
        }
      }
      if (probe.oidAlgorithm !== "sha1" && probe.oidAlgorithm !== "sha256") {
        throw new Error(
          `cannot mint a live clone identity for ${request.path}: repository object format is undetectable`,
        );
      }
      // Canonical identities: byte-identical to the engram side for
      // identical inputs (hostScope carries the local tenant scope, which
      // bounds the clone to one host).
      const clone: CloneIdentityDto = deriveCloneIdentity({
        hostScope: tenant,
        commonDirRealpath: probe.commonDirRealpath,
        ...(probe.projectFingerprint !== undefined
          ? { commonDirProjectFingerprint: probe.projectFingerprint }
          : {}),
        identityUncertainty: [...probe.identityUncertainty],
        oidAlgorithm: probe.oidAlgorithm,
      });
      const worktree: WorktreeIdentityDto = deriveWorktreeIdentity({
        hostScope: tenant,
        clone: { cloneId: clone.cloneId },
        worktreePath: probe.worktreeRealpath,
        gitDir: probe.gitDir,
        ...(probe.workspaceFingerprint !== undefined
          ? { worktreeFingerprint: probe.workspaceFingerprint }
          : {}),
        identityUncertainty: [...probe.identityUncertainty],
      });
      const identity = deriveDeclarationIdentity({
        hostScope: tenant,
        clone: { cloneId: clone.cloneId },
        worktree: { worktreeId: worktree.worktreeId },
      });
      const declaration: WorkspaceDeclarationDto = {
        tenant,
        principal: decision.principal,
        ...(probe.workspaceFingerprint !== undefined
          ? { hostFingerprint: probe.workspaceFingerprint }
          : {}),
        identityUncertainty: [...probe.identityUncertainty],
        declarationId: identity.declarationId,
        cloneId: identity.cloneId,
        worktreeId: identity.worktreeId,
        authorizedRoots: [probe.worktreeRealpath],
        liveCapability: EXPLICIT_LIVE_CAPABILITY,
        policyVersion: POLICY_VERSION,
        declarationRevision: INITIAL_DECLARATION_REVISION,
      };
      const checked = validateWorkspaceDeclaration(declaration);
      if (!checked.ok) {
        throw new Error(`invalid live workspace declaration: ${checked.errors.join("; ")}`);
      }
      const existing = store.get(declaration.declarationId);
      if (existing !== undefined) {
        // Once per worktree: replay the existing declaration, no revision bump.
        return { declaration: existing, created: false };
      }
      const timestamp = now();
      const record: LiveDeclarationRecord = {
        kind: LIVE_DECLARATION_KIND,
        schemaVersion: LIVE_DECLARATION_SCHEMA_VERSION,
        declaration,
        clone,
        worktree,
        createdAt: timestamp,
        activatedAt: timestamp,
        updatedAt: timestamp,
      };
      store.insert(record);
      return { declaration: record, created: true };
    },
    list() {
      authorize("list");
      return store.list();
    },
    status(path) {
      authorize("status", { path });
      return findByAuthorizedRoot(path);
    },
    resolvePath(path) {
      authorize("resolve", { path });
      const resolved = resolveInputPath(path);
      let best: ResolvedLivePath | undefined;
      let bestMatchedLength = -1;
      for (const record of store.list()) {
        for (const rootPath of record.declaration.authorizedRoots) {
          if (resolved !== rootPath && !resolved.startsWith(rootPath + "/")) continue;
          const relativePath = resolved === rootPath ? "" : resolved.slice(rootPath.length + 1);
          if (best === undefined || rootPath.length > bestMatchedLength) {
            best = { declaration: record, relativePath };
            bestMatchedLength = rootPath.length;
          }
        }
      }
      return best;
    },
    remove(request) {
      authorize("remove", { path: request.path });
      const record = findByAuthorizedRoot(request.path);
      if (record === undefined) {
        return { removed: false, canceledWork: false, purgeRequested: false };
      }
      const scope: LiveWorkScope = {
        declarationId: record.declaration.declarationId,
        cloneId: record.declaration.cloneId,
      };
      // Stop work and reject delayed jobs BEFORE unregistering; then purge
      // private local snapshots. Committed history is never touched here.
      const canceledWork = workController.cancelScheduledWork(scope);
      const purgeRequested = workController.requestPrivatePurge(scope);
      const revocation = buildRevocation(record, request.reason);
      store.remove(record.declaration.declarationId);
      return { removed: true, canceledWork, purgeRequested, revocation };
    },
    removeClone(request) {
      authorize("remove-clone");
      // Withdrawing a whole clone revokes EACH of its declarations, one
      // unambiguous revocation per declaration (contract §L6a).
      const targets = store
        .list()
        .filter((record) => record.declaration.cloneId === request.cloneId);
      const revocations: DeclarationRevocationDto[] = [];
      let canceledWork = false;
      let purgeRequested = false;
      for (const record of targets) {
        const scope: LiveWorkScope = {
          declarationId: record.declaration.declarationId,
          cloneId: record.declaration.cloneId,
        };
        canceledWork = workController.cancelScheduledWork(scope) || canceledWork;
        purgeRequested = workController.requestPrivatePurge(scope) || purgeRequested;
        revocations.push(buildRevocation(record, request.reason));
        store.remove(record.declaration.declarationId);
      }
      return { removed: revocations.length, revocations, canceledWork, purgeRequested };
    },
    rebind(request) {
      authorize("rebind", { path: request.path });
      const record = findByAuthorizedRoot(request.path);
      if (record === undefined) {
        throw new Error(`no live declaration for path: ${request.path}`);
      }
      const scope: LiveWorkScope = {
        declarationId: record.declaration.declarationId,
        cloneId: record.declaration.cloneId,
      };
      // In-flight collection/publication cannot be redirected by a rebind.
      if (workController.hasInFlightWork(scope)) {
        throw new LiveAccessRefused("rebind", "in_flight_work_cannot_be_redirected");
      }
      const nextBindingRevision = (record.declaration.bindingRevision ?? 0) + 1;
      return store.update(
        record.declaration.declarationId,
        record.declaration.declarationRevision,
        (current) => ({
          ...current,
          declaration: {
            ...current.declaration,
            serverWorkspaceId: request.sentropicWorkspaceId,
            serverIssuer: request.issuer,
            bindingRevision: nextBindingRevision,
            declarationRevision: current.declaration.declarationRevision + 1,
          },
          updatedAt: now(),
        }),
      );
    },
    replay() {
      authorize("replay");
      return store.list();
    },
  };
}

// Re-export the consumed lifecycle vocabulary for host compositors that
// classify events without importing the neutral package directly.
export { NON_ACTIVATING_LIFECYCLE_KINDS };
