/**
 * Live Git Indexing — L6a (H): data-pure live-declaration DTOs (h2a side).
 *
 * DESIGN (LIVE SPEC §3 WorkspaceDeclaration/Clone/Worktree, §12):
 *  - A live declaration is durable LOCAL h2a state, created only by explicit
 *    activation (owner decision Q4 = A). Bind, transcript upload, code-workspace
 *    creation and agent sessions are never implicit activation and never
 *    withdraw a declaration.
 *  - The declaration is stored under the injected h2a root, outside every
 *    observed worktree and its git-dir/common-dir (LIVE §2).
 *  - Clone identity is NEVER a URL/fingerprint-only key: it binds the
 *    common-dir project fingerprint (the public `ws:` derivation with the
 *    empty main-worktree component) to the host scope and the common-dir
 *    realpath. Two clones with equal `ws:` fingerprints stay distinct; linked
 *    worktrees share exactly one clone.
 *  - The public `ws:` worktree fingerprint is preserved unchanged and stays a
 *    declaration/worktree attribute, never the sole clone key.
 *  - Missing (unborn HEAD) or shallow history yields EXPLICIT identity
 *    uncertainty; it never merges clones by remote URL or a missing
 *    fingerprint.
 *
 * This module is data-pure: types, constants and deterministic derivations
 * only, no I/O and no host/runtime imports (LIVE §3 "H2a's copyable DTOs
 * remain data-pure"). The neutral `@sentropic/engram-live/contracts` export is
 * still moving; the assumptions this h2a contract makes are isolated here so
 * they stay easy to reconcile:
 *  - A01/A09/A17 assumption: the declaration carries a worktree-specific
 *    identity plus a clone identity; one declaration per activated worktree.
 *  - Field names and the uncertainty vocabulary below are h2a-local until
 *    the neutral contract freezes its WorkspaceDeclaration shape.
 *  - `principal` is the host-verified local principal reference; local
 *    verification itself is L7a work and stays outside this module.
 */
import { createHash } from "node:crypto";

import { computeDurableWorkspaceId } from "../identity/workspace-id.js";

export const LIVE_DECLARATION_KIND = "h2a-live-declaration";
export const LIVE_DECLARATION_SCHEMA_VERSION = 1;
/** Versioned collection policy stamped on every declaration (LIVE §3). */
export const LIVE_DECLARATION_POLICY_VERSION = "live-git-1";
/** Explicit live capability; distinct from bind and upload consent. */
export const LIVE_CAPABILITY = "live";
/** Unborn/missing history: no root commits, no `ws:` fingerprint. */
export const LIVE_IDENTITY_UNCERTAINTY_MISSING_HISTORY = "missing_history";
/** Grafted (shallow) history: fingerprints computed, coverage uncertain. */
export const LIVE_IDENTITY_UNCERTAINTY_SHALLOW_HISTORY = "shallow_history";

export interface LiveWorktreeIdentity {
  /** Opaque, host-scoped worktree identity (NOT the public `ws:` value). */
  readonly worktreeId: string;
  /** Authorized root: resolved real path of the observed worktree. */
  readonly path: string;
  /** Resolved git-dir (`.git/worktrees/<name>` for a linked worktree). */
  readonly gitDir: string;
  /** Preserved public `ws:` fingerprint; absent with missing_history. */
  readonly workspaceFingerprint?: string;
}

export interface LiveCloneIdentity {
  /** Opaque, host-scoped clone key. Never URL/fingerprint-only. */
  readonly cloneId: string;
  /** Resolved common-dir real path; shared by all linked worktrees. */
  readonly commonDirRealpath: string;
  /**
   * Project fingerprint from the common-dir history with the EMPTY
   * main-worktree component. Equal in two clones of one project; the clone
   * key stays distinct through host scope + common-dir realpath.
   */
  readonly projectFingerprint?: string;
  /** Explicit identity/coverage uncertainty labels, never silent. */
  readonly identityUncertainty: readonly string[];
}

export interface LiveSentropicBinding {
  /** Server-bound sentropic workspace the live intent is bound to. */
  readonly sentropicWorkspaceId: string;
  /** Issuer/server the enrollment token (and this binding) is bound to. */
  readonly issuer: string;
  /** Monotonic binding-record revision; bumps on revalidation+rebind. */
  readonly bindingRevision: number;
}

export interface LiveWorkspaceDeclaration {
  readonly kind: typeof LIVE_DECLARATION_KIND;
  readonly schemaVersion: typeof LIVE_DECLARATION_SCHEMA_VERSION;
  /** Opaque, deterministic: host scope + common-dir realpath + `ws:`. */
  readonly declarationId: string;
  /** Stable local scope, `local:<host-owner-id>`; never a sentropic tenant. */
  readonly hostScope: string;
  /** Host-verified local principal reference, when the authority supplies one. */
  readonly principal?: string;
  readonly worktree: LiveWorktreeIdentity;
  readonly clone: LiveCloneIdentity;
  /** Authorized roots this declaration covers (its worktree path today). */
  readonly authorizedRoots: readonly string[];
  readonly capability: typeof LIVE_CAPABILITY;
  readonly policyVersion: string;
  /** Declaration revision; monotonic, one per applied mutation. */
  readonly revision: number;
  /** Optional product live intent; requires revalidation to change. */
  readonly binding?: LiveSentropicBinding;
  readonly createdAt: string;
  /** Activation timestamp; replay after restart never renews it. */
  readonly activatedAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Pure derivations
// ---------------------------------------------------------------------------

const sha256Hex = (payload: string): string =>
  createHash("sha256").update(payload, "utf8").digest("hex");

/**
 * Project fingerprint for clone identity: the common-dir history with the
 * empty main-worktree component (LIVE §12). Byte-equal for every worktree,
 * linked or main, of one clone.
 */
export function deriveLiveProjectFingerprint(rootCommitSha: string): string {
  return computeDurableWorkspaceId(rootCommitSha, "");
}

/**
 * Clone key = host scope + common-dir realpath + project fingerprint.
 * Realpath keeps two equal-`ws:` clones distinct; common-dir keeps linked
 * worktrees together. A missing fingerprint never merges clones: the
 * realpath still keys them apart, and the uncertainty is explicit.
 */
export function deriveLiveCloneIdentity(input: {
  readonly hostScope: string;
  readonly commonDirRealpath: string;
  readonly projectFingerprint?: string;
  readonly identityUncertainty?: readonly string[];
}): LiveCloneIdentity {
  const cloneId =
    "clone:" +
    sha256Hex(
      `${input.hostScope}\n${input.commonDirRealpath}\n${input.projectFingerprint ?? ""}`,
    );
  return {
    cloneId,
    commonDirRealpath: input.commonDirRealpath,
    ...(input.projectFingerprint !== undefined
      ? { projectFingerprint: input.projectFingerprint }
      : {}),
    identityUncertainty: [...(input.identityUncertainty ?? [])],
  };
}

/** Worktree identity: git-dir is unique per linked worktree on a host. */
export function deriveLiveWorktreeIdentity(input: {
  readonly hostScope: string;
  readonly path: string;
  readonly gitDir: string;
  readonly workspaceFingerprint?: string;
}): LiveWorktreeIdentity {
  return {
    worktreeId: "wt:" + sha256Hex(`${input.hostScope}\n${input.gitDir}`),
    path: input.path,
    gitDir: input.gitDir,
    ...(input.workspaceFingerprint !== undefined
      ? { workspaceFingerprint: input.workspaceFingerprint }
      : {}),
  };
}

/** One declaration per activated worktree, keyed without host absolute paths leaking into sentropic surfaces. */
export function deriveLiveDeclarationId(input: {
  readonly hostScope: string;
  readonly commonDirRealpath: string;
  readonly workspaceFingerprint?: string;
}): string {
  return (
    "decl:" +
    sha256Hex(
      `${input.hostScope}\n${input.commonDirRealpath}\n${input.workspaceFingerprint ?? ""}`,
    )
  );
}

/**
 * Structural validation. Returns the first problem, or undefined when the
 * value is a well-formed live declaration. Data-pure: no I/O, no authority.
 */
export function validateLiveDeclaration(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return "declaration is not an object";
  }
  const record = value as Partial<LiveWorkspaceDeclaration>;
  if (record.kind !== LIVE_DECLARATION_KIND) {
    return "unexpected declaration kind";
  }
  if (record.schemaVersion !== LIVE_DECLARATION_SCHEMA_VERSION) {
    return "unsupported declaration schema version";
  }
  if (typeof record.declarationId !== "string" || record.declarationId.length === 0) {
    return "missing declarationId";
  }
  if (typeof record.hostScope !== "string" || record.hostScope.length === 0) {
    return "missing hostScope";
  }
  const worktree = record.worktree;
  if (
    typeof worktree !== "object" ||
    worktree === null ||
    typeof worktree.worktreeId !== "string" ||
    typeof worktree.path !== "string" ||
    worktree.path.length === 0 ||
    typeof worktree.gitDir !== "string"
  ) {
    return "invalid worktree identity";
  }
  const clone = record.clone;
  if (
    typeof clone !== "object" ||
    clone === null ||
    typeof clone.cloneId !== "string" ||
    clone.cloneId.length === 0 ||
    typeof clone.commonDirRealpath !== "string" ||
    !Array.isArray(clone.identityUncertainty)
  ) {
    return "invalid clone identity";
  }
  if (
    worktree.workspaceFingerprint === undefined &&
    !clone.identityUncertainty.includes(LIVE_IDENTITY_UNCERTAINTY_MISSING_HISTORY)
  ) {
    return "missing workspace fingerprint without explicit missing_history uncertainty";
  }
  if (
    !Array.isArray(record.authorizedRoots) ||
    record.authorizedRoots.length === 0 ||
    record.authorizedRoots.some((root) => typeof root !== "string" || root.length === 0)
  ) {
    return "invalid authorized roots";
  }
  if (record.capability !== LIVE_CAPABILITY) {
    return "declaration does not carry the live capability";
  }
  if (typeof record.policyVersion !== "string" || record.policyVersion.length === 0) {
    return "missing policy version";
  }
  if (
    typeof record.revision !== "number" ||
    !Number.isInteger(record.revision) ||
    record.revision < 1
  ) {
    return "invalid declaration revision";
  }
  const binding = record.binding;
  if (
    binding !== undefined &&
    (typeof binding !== "object" ||
      binding === null ||
      typeof binding.sentropicWorkspaceId !== "string" ||
      binding.sentropicWorkspaceId.length === 0 ||
      typeof binding.issuer !== "string" ||
      binding.issuer.length === 0 ||
      typeof binding.bindingRevision !== "number" ||
      !Number.isInteger(binding.bindingRevision) ||
      binding.bindingRevision < 1)
  ) {
    return "invalid sentropic binding";
  }
  for (const field of ["createdAt", "activatedAt", "updatedAt"] as const) {
    if (typeof record[field] !== "string" || record[field].length === 0) {
      return `missing ${field}`;
    }
  }
  return undefined;
}
