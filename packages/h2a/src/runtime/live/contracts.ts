/**
 * Live Git Indexing — L6a (H): h2a-side core contract view.
 *
 * The neutral contract FROZE at @sentropic/engram-live 0.1.0 (graphify
 * 70ebdfee, PR rhanka/engram#359): H no longer carries its own declaration
 * vocabulary, validators or identity derivations. This module re-exports the
 * consumed contract surface — the underlying contracts.js takes zero imports,
 * so this re-export stays data-pure (types, constants and deterministic
 * validation only; no I/O, no host state) — and adds only H-core-owned pure
 * policy (isLocalLiveTenant below).
 *
 * PRE-RELEASE CONSUMPTION (spec §11): @sentropic/engram-live is not
 * published yet — and it is os-bounded (linux), so even a digest-pinned
 * packed prerelease consumed through a `file:` dependency breaks
 * cross-platform install and packed redistribution (smoke). H therefore
 * vendors the portable contract entry (dist/contracts.js, extracted
 * byte-identical from the pinned tarball built from graphify@70ebdfee;
 * provenance and per-file integrity pinned by the GUARD test in h2a-runtime
 * live-registration.test.ts) under ../../vendor/engram-live, with no
 * external dependency and no neighboring checkout imported: at publication
 * time this becomes an exact registry version pin. The
 * derivations (deriveCloneIdentity / deriveWorktreeIdentity /
 * deriveDeclarationIdentity) live in the /integration entry and are consumed
 * by the runtime side only — core never imports the factory entry, keeping
 * copyable DTOs separate from factory imports per spec §3.
 *
 * RETIRED H VOCABULARY (L6a realignment; L6a is not consumed yet, so the
 * break is local-only, no migration replay):
 * - hostScope -> tenant (the value stays a `local:<id>` scope)
 * - capability -> liveCapability (the value stays "live")
 * - revision -> declarationRevision
 * - workspaceFingerprint -> hostFingerprint (declaration level)
 * - policy "live-git-1" -> POLICY_VERSION "live-git-indexing/1"
 * - nested binding {sentropicWorkspaceId, issuer, bindingRevision} ->
 *   flat serverWorkspaceId / serverIssuer / bindingRevision
 * - nested clone {cloneId, commonDirRealpath, projectFingerprint} ->
 *   CloneIdentityDto {hostScope, commonDirRealpath,
 *   commonDirProjectFingerprint, cloneId, oidAlgorithm}
 * - nested worktree {worktreeId, path, workspaceFingerprint} ->
 *   WorktreeIdentityDto {cloneId, worktreeId, worktreePath, gitDir,
 *   worktreeFingerprint}
 * - newline-joined sha256 identity derivations -> the three canonical
 *   public derivations (runtime side, see above).
 */
export {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  EXPLICIT_LIVE_CAPABILITY,
  IDENTITY_UNCERTAINTY_STATES,
  INITIAL_BINDING_REVISION,
  INITIAL_DECLARATION_REVISION,
  NON_ACTIVATING_LIFECYCLE_KINDS,
  POLICY_VERSION,
  isIdentityUncertaintyState,
  isNonActivatingLifecycleKind,
  isRevocationReason,
  validateCloneIdentity,
  validateDeclarationRevocation,
  validatePrivatePurgeRequest,
  validateWorkspaceDeclaration,
  validateWorktreeIdentity,
} from "../../vendor/engram-live/contracts.js";
export type {
  CloneIdentityDto,
  DeclarationRevocationDto,
  IdentityUncertaintyState,
  NonActivatingLifecycleKind,
  OidAlgorithm,
  PrivatePurgeRequestDto,
  RevocationReason,
  ValidationResult,
  WorkspaceDeclarationDto,
  WorktreeIdentityDto,
} from "../../vendor/engram-live/contracts.js";

/**
 * H tenant guard: the live tenant is ALWAYS a stable local scope
 * `local:<host-owner-id>`, never a sentropic tenant inferred from a
 * workspace id. The verified owner scope and principal proof are L7a work;
 * until then the tenant default is provisional (see the runtime
 * live-registration service).
 */
export function isLocalLiveTenant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("local:") &&
    value.trim().length > "local:".length &&
    !value.includes("\0")
  );
}
