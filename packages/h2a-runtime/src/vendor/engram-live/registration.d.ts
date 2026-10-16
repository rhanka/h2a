import { type CloneIdentityDto, type DeclarationRevocationDto, type IdentityUncertaintyState, type NonActivatingLifecycleKind, type OidAlgorithm, type RevocationReason, type WorkspaceDeclarationDto, type WorktreeIdentityDto } from "./contracts.js";
/** Input for an explicit live declaration (revision starts at INITIAL_DECLARATION_REVISION). */
export interface CreateLiveDeclarationInput {
    readonly tenant: string;
    readonly principal: string;
    readonly hostFingerprint?: string;
    readonly identityUncertainty: readonly IdentityUncertaintyState[];
    readonly declarationId: string;
    readonly cloneId: string;
    readonly worktreeId: string;
    readonly authorizedRoots: readonly string[];
    readonly liveCapability: "live";
    readonly policyVersion: string;
    readonly serverWorkspaceId?: string;
    readonly serverIssuer?: string;
    readonly bindingRevision?: number;
}
/** Patchable declaration fields. Identity (tenant, principal,
 * hostFingerprint, the declarationId/cloneId/worktreeId triangle,
 * liveCapability, declarationRevision) is immutable across revisions. */
export interface LiveDeclarationPatch {
    readonly authorizedRoots?: readonly string[];
    readonly policyVersion?: string;
    readonly serverWorkspaceId?: string;
    readonly serverIssuer?: string;
    readonly bindingRevision?: number;
}
/** Input for deriving a clone identity from host-resolved components. */
export interface DeriveCloneIdentityInput {
    readonly hostScope: string;
    readonly commonDirRealpath: string;
    readonly commonDirProjectFingerprint?: string;
    readonly identityUncertainty?: readonly IdentityUncertaintyState[];
    readonly oidAlgorithm: OidAlgorithm;
}
/** Input for deriving a worktree identity under an already derived clone. */
export interface DeriveWorktreeIdentityInput {
    readonly hostScope: string;
    readonly clone: Pick<CloneIdentityDto, "cloneId">;
    readonly worktreePath: string;
    readonly gitDir: string;
    readonly worktreeFingerprint?: string;
    readonly identityUncertainty?: readonly IdentityUncertaintyState[];
}
/** Input for deriving the identity of one declaration under a clone/worktree. */
export interface DeriveDeclarationIdentityInput {
    readonly hostScope: string;
    readonly clone: Pick<CloneIdentityDto, "cloneId">;
    readonly worktree: Pick<WorktreeIdentityDto, "worktreeId">;
}
/** Opaque declaration identity: the declaration and its clone/worktree attachment. */
export interface DeclarationIdentityDto {
    readonly declarationId: string;
    readonly cloneId: string;
    readonly worktreeId: string;
}
/**
 * Create the initial live declaration for one workspace. Requires the
 * explicit "live" capability and the full identity triangle
 * (declarationId/cloneId/worktreeId, minted by the canonical derivation
 * below): any other opt-in value (bind, upload, session kinds) is refused,
 * so no lifecycle event can implicitly activate live. The declaration
 * revision starts at the frozen INITIAL_DECLARATION_REVISION.
 */
export declare function createLiveDeclaration(input: CreateLiveDeclarationInput): WorkspaceDeclarationDto;
/**
 * Revise a declaration as a pure revision increment. The revision grows by
 * exactly one; tenant, principal, hostFingerprint, the identity triangle
 * and the live capability are immutable. The product binding is the
 * complete (serverWorkspaceId, serverIssuer, bindingRevision) triplet.
 * A revision outside the binding (roots, policy version) PRESERVES the
 * binding: no renewal is imposed. Only a change of serverWorkspaceId or
 * serverIssuer, or an explicit bindingRevision revalidation, renews the
 * binding — and then strictly increasingly: the first binding carries
 * exactly INITIAL_BINDING_REVISION, and every rebind/revalidation carries
 * a strictly greater bindingRevision; binding revisions never go
 * backwards. The host must additionally refuse to redirect in-flight
 * collection/publication when a rebind lands.
 */
export declare function reviseLiveDeclaration(previous: WorkspaceDeclarationDto, patch: LiveDeclarationPatch): WorkspaceDeclarationDto;
/**
 * Revoke exactly one declaration as a pure private-purge request. The
 * returned DTO names the single target by its opaque declarationId and
 * carries the declaration's cloneId/worktreeId attachment and revision, so
 * the recipient can never confuse two declarations of one tenant that
 * happen to share public fingerprints or revisions. The host stops work,
 * rejects delayed jobs and purges private snapshots, derived indexes and
 * decryptability, while preserving authorized committed history.
 * Revocation deletes no committed facts.
 */
export declare function revokeLiveDeclaration(declaration: WorkspaceDeclarationDto, reason: RevocationReason): DeclarationRevocationDto;
/**
 * Derive the clone identity for one common-dir — the ONE canonical clone
 * derivation. The key components (hostScope, normalized common-dir
 * realpath, common-dir project fingerprint) serialize through
 * canonicalIdKey (unambiguous, NUL-refusing) and hash to the opaque
 * cloneId: equal fingerprints under different realpaths derive distinct
 * clones, while linked worktrees sharing one common-dir derive the same
 * clone. The fingerprint may be absent only under explicit
 * "missing_history" uncertainty; the hostScope + realpath components keep
 * clones distinct even then (LIVE §12). The realpath stays host-local;
 * only cloneId is shared. Deterministic and free of I/O.
 */
export declare function deriveCloneIdentity(input: DeriveCloneIdentityInput): CloneIdentityDto;
/**
 * Derive the identity of one worktree under an already derived clone —
 * the ONE canonical worktree derivation. Worktrees of one clone share
 * cloneId and keep an isolated host-scoped worktreeId plus per-worktree
 * git-dir, fingerprint and path. The worktree fingerprint may be absent
 * only under explicit "missing_history" uncertainty (LIVE §12).
 */
export declare function deriveWorktreeIdentity(input: DeriveWorktreeIdentityInput): WorktreeIdentityDto;
/**
 * Derive the identity of one declaration — the ONE canonical declaration
 * derivation. One declaration per activated worktree: the declarationId
 * binds the host scope, the clone and the worktree, so two worktrees of
 * one clone (and two clones of one project) derive distinct declarationIds
 * even without fingerprints. Stable across every revision of the same
 * declaration. Deterministic and free of I/O.
 */
export declare function deriveDeclarationIdentity(input: DeriveDeclarationIdentityInput): DeclarationIdentityDto;
/**
 * Decide whether two clone references denote the same clone, by canonical
 * identifier only: the cloneId minted by the shared canonical derivation is
 * the clone identity, so the comparison is an equivalence (transitive and
 * consistent between full DTOs and opaque references). Throws when either
 * reference lacks a cloneId — equality is never guessed from components.
 */
export declare function isSameClone(a: Pick<CloneIdentityDto, "cloneId">, b: Pick<CloneIdentityDto, "cloneId">): boolean;
/**
 * Classify a host lifecycle event against live declarations. Bind, upload,
 * code-workspace creation and session open/end never activate or remove a
 * declaration: the only outcome is "no-activation-change". Unknown kinds
 * are refused.
 */
export declare function classifyLifecycleEvent(kind: NonActivatingLifecycleKind): "no-activation-change";
