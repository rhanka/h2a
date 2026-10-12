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
 *  - Clone identity: host scope + common-dir project fingerprint (public
 *    `ws:` derivation, empty main-worktree component) + common-dir realpath.
 *    Equal fingerprints in two clones stay distinct; linked worktrees share
 *    one clone. Missing/shallow history is explicit uncertainty, never a
 *    URL/fingerprint-only merge.
 *  - Local authority is a seam: the default authority DENIES every operation
 *    explicitly (`local_authority_unavailable`) until L7a supplies verified
 *    local principals. Refusal is an error, never a successful empty result.
 *  - Removal stops work first (cancellation seam), then requests a private
 *    purge of local snapshots; committed history is never touched.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";

import {
  LIVE_CAPABILITY,
  LIVE_DECLARATION_KIND,
  LIVE_DECLARATION_POLICY_VERSION,
  LIVE_DECLARATION_SCHEMA_VERSION,
  LIVE_IDENTITY_UNCERTAINTY_MISSING_HISTORY,
  LIVE_IDENTITY_UNCERTAINTY_SHALLOW_HISTORY,
  createLiveDeclarationStore,
  type LiveDeclarationRecord,
  type LiveDeclarationStore,
} from "./live-declarations.js";

// ---------------------------------------------------------------------------
// Git identity probe (read-only, safe flags; never writes to the worktree)
// ---------------------------------------------------------------------------

/**
 * Byte-identical mirror of the pure `ws:` derivation
 * (`@sentropic/h2a` identity/workspace-id.ts and conductor-launch.ts). The
 * core/runtime boundary forbids a static runtime→core import, so the runtime
 * keeps a copy; live-registration.test.ts cross-checks the derivations
 * against the data-pure core contract.
 */
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

const sha256Hex = (payload: string): string =>
  createHash("sha256").update(payload, "utf8").digest("hex");

export interface LiveWorkspaceProbe {
  /** Authorized root: resolved real path of the observed worktree. */
  readonly worktreeRealpath: string;
  /** Resolved git-dir (`.git/worktrees/<name>` for a linked worktree). */
  readonly gitDir: string;
  /** Resolved common-dir real path, shared by linked worktrees. */
  readonly commonDirRealpath: string;
  /** "" for the main worktree, else the linked-worktree name. */
  readonly worktreeName: string;
  /** Normalized root commits; undefined when history is missing. */
  readonly rootCommits?: string;
  /** Preserved public `ws:` fingerprint; absent with missing_history. */
  readonly workspaceFingerprint?: string;
  /** Project fingerprint (empty main-worktree component); may be absent. */
  readonly projectFingerprint?: string;
  /** A `shallow` graft file exists in the common dir. */
  readonly shallow: boolean;
  /** Explicit identity/coverage uncertainty labels, never silent. */
  readonly identityUncertainty: readonly string[];
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

  // --- root commits (absent on unborn HEAD) ---
  const rootCommitLines = run(["rev-list", "--max-parents=0", "HEAD"]);
  const rootCommits = rootCommitLines === undefined ? undefined : normalizeRootCommits(rootCommitLines.split(/\r?\n/));

  const shallow = existsSync(
    resolve(commonDirRealpath.startsWith("/") ? commonDirRealpath : resolveWithin(worktreeRealpath, commonDirRealpath), "shallow"),
  );

  const identityUncertainty: string[] = [];
  if (rootCommits === undefined) {
    identityUncertainty.push(LIVE_IDENTITY_UNCERTAINTY_MISSING_HISTORY);
  }
  if (shallow) {
    identityUncertainty.push(LIVE_IDENTITY_UNCERTAINTY_SHALLOW_HISTORY);
  }

  return {
    worktreeRealpath,
    gitDir,
    commonDirRealpath,
    worktreeName,
    ...(rootCommits !== undefined ? { rootCommits } : {}),
    ...(rootCommits !== undefined
      ? { workspaceFingerprint: computeDurableWorkspaceId(rootCommits, worktreeName) }
      : {}),
    ...(rootCommits !== undefined
      ? { projectFingerprint: computeDurableWorkspaceId(rootCommits, "") }
      : {}),
    shallow,
    identityUncertainty,
  };
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
  | "rebind"
  | "replay";

export interface LiveAuthorizationRequest {
  readonly operation: LiveOperation;
  readonly hostScope: string;
  readonly path?: string;
  readonly declarationId?: string;
  readonly workspaceFingerprint?: string;
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
  /** Stable local scope `local:<host-owner-id>`; defaults to the OS owner. */
  readonly hostScope?: string;
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
  /** Stop work, cancel delayed jobs, request a private purge, then unregister. */
  remove(request: RemoveLiveRequest): RemoveLiveResult;
  /** Server/issuer-bound product live intent; requires fresh revalidation, bumps the binding revision. */
  rebind(request: RebindLiveRequest): LiveDeclarationRecord;
  /** Host-startup replay of durable declarations, without renewed activation. */
  replay(): readonly LiveDeclarationRecord[];
}

const defaultHostScope = (): string => {
  const username = userInfo().username;
  return `local:${username && username.length > 0 ? username : "unknown"}`;
};

export function createLiveRegistration(
  options: LiveRegistrationOptions,
): LiveRegistration {
  const root = options.root;
  const hostScope = options.hostScope ?? defaultHostScope();
  const authority = options.authority ?? unverifiedLocalLiveAuthority;
  const workController = options.workController ?? inertLiveWorkController;
  const now = options.now ?? (() => new Date().toISOString());
  const store: LiveDeclarationStore = createLiveDeclarationStore(root);

  const authorize = (
    operation: LiveOperation,
    detail: { path?: string; declarationId?: string; workspaceFingerprint?: string } = {},
  ): LiveAuthorizationDecision => {
    const decision = authority.authorize({
      operation,
      hostScope,
      ...(detail.path !== undefined ? { path: detail.path } : {}),
      ...(detail.declarationId !== undefined ? { declarationId: detail.declarationId } : {}),
      ...(detail.workspaceFingerprint !== undefined
        ? { workspaceFingerprint: detail.workspaceFingerprint }
        : {}),
    });
    if (!decision.ok) {
      throw new LiveAccessRefused(operation, decision.reason ?? "denied");
    }
    return decision;
  };

  // Deterministic opaque identities, mirrored from the data-pure core
  // contract (see live-declarations.ts header).
  const cloneIdOf = (probe: LiveWorkspaceProbe): string =>
    "clone:" +
    sha256Hex(`${hostScope}\n${probe.commonDirRealpath}\n${probe.projectFingerprint ?? ""}`);
  const declarationIdOf = (probe: LiveWorkspaceProbe): string =>
    "decl:" +
    sha256Hex(`${hostScope}\n${probe.commonDirRealpath}\n${probe.workspaceFingerprint ?? ""}`);

  const resolveInputPath = (path: string): string => realpathOr(resolve(path), resolve(path));

  const findByAuthorizedRoot = (path: string): LiveDeclarationRecord | undefined => {
    const resolved = resolveInputPath(path);
    return store
      .list()
      .find(
        (record) =>
          record.authorizedRoots.includes(resolved) ||
          record.authorizedRoots.includes(realpathOr(resolved, resolved)),
      );
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
      const declarationId = declarationIdOf(probe);
      const existing = store.get(declarationId);
      if (existing !== undefined) {
        // Once per worktree: replay the existing declaration, no revision bump.
        return { declaration: existing, created: false };
      }
      const timestamp = now();
      const declaration: LiveDeclarationRecord = {
        kind: LIVE_DECLARATION_KIND,
        schemaVersion: LIVE_DECLARATION_SCHEMA_VERSION,
        declarationId,
        hostScope,
        ...(decision.principal !== undefined ? { principal: decision.principal } : {}),
        worktree: {
          worktreeId: "wt:" + sha256Hex(`${hostScope}\n${probe.gitDir}`),
          path: probe.worktreeRealpath,
          gitDir: probe.gitDir,
          ...(probe.workspaceFingerprint !== undefined
            ? { workspaceFingerprint: probe.workspaceFingerprint }
            : {}),
        },
        clone: {
          cloneId: cloneIdOf(probe),
          commonDirRealpath: probe.commonDirRealpath,
          ...(probe.projectFingerprint !== undefined
            ? { projectFingerprint: probe.projectFingerprint }
            : {}),
          identityUncertainty: [...probe.identityUncertainty],
        },
        authorizedRoots: [probe.worktreeRealpath],
        capability: LIVE_CAPABILITY,
        policyVersion: LIVE_DECLARATION_POLICY_VERSION,
        revision: 1,
        createdAt: timestamp,
        activatedAt: timestamp,
        updatedAt: timestamp,
      };
      store.insert(declaration);
      return { declaration, created: true };
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
      for (const record of store.list()) {
        for (const rootPath of record.authorizedRoots) {
          if (resolved !== rootPath && !resolved.startsWith(rootPath + "/")) continue;
          const relativePath = resolved === rootPath ? "" : resolved.slice(rootPath.length + 1);
          if (best === undefined || rootPath.length > best.declaration.authorizedRoots[0]!.length) {
            best = { declaration: record, relativePath };
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
        declarationId: record.declarationId,
        cloneId: record.clone.cloneId,
      };
      // Stop work and reject delayed jobs BEFORE unregistering; then purge
      // private local snapshots. Committed history is never touched here.
      const canceledWork = workController.cancelScheduledWork(scope);
      const purgeRequested = workController.requestPrivatePurge(scope);
      store.remove(record.declarationId);
      return { removed: true, canceledWork, purgeRequested };
    },
    rebind(request) {
      authorize("rebind", { path: request.path });
      const record = findByAuthorizedRoot(request.path);
      if (record === undefined) {
        throw new Error(`no live declaration for path: ${request.path}`);
      }
      const scope: LiveWorkScope = {
        declarationId: record.declarationId,
        cloneId: record.clone.cloneId,
      };
      // In-flight collection/publication cannot be redirected by a rebind.
      if (workController.hasInFlightWork(scope)) {
        throw new LiveAccessRefused("rebind", "in_flight_work_cannot_be_redirected");
      }
      const nextBindingRevision = (record.binding?.bindingRevision ?? 0) + 1;
      return store.update(record.declarationId, record.revision, (current) => ({
        ...current,
        binding: {
          sentropicWorkspaceId: request.sentropicWorkspaceId,
          issuer: request.issuer,
          bindingRevision: nextBindingRevision,
        },
        updatedAt: now(),
      }));
    },
    replay() {
      authorize("replay");
      return store.list();
    },
  };
}
