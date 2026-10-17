// @sentropic/engram-live/contracts — built, data-pure contract export
// (spec/SPEC_LIVE_GIT_INDEXING.md §3, §11; plan/09 L1b).
//
// This module is data-pure: DTOs, constants and validators only. It takes no
// imports at all — neither node: builtins, host types, model modules nor
// storage drivers. The executable factory lives in ./integration.js; hosts
// import only this contract at the adapter boundary and lazily load the
// factory when they compose live (§3).
export const CONTRACT_NAME = "@sentropic/engram-live/contracts";
export const CONTRACT_VERSION = 1;
export const PRODUCER_NAME = "engram-live";
export const POLICY_VERSION = "live-git-indexing/1";
export const CAPABILITY_IDS = [
    "refs",
    "history-dag",
    "github-pr",
    "index-snapshot",
    "working-tree",
    "diffs",
    "code-analysis",
    "retention-requests",
    "reconciliation",
    "publication",
];
/** The lot that implements each capability; part of the advertised contract. */
export const CAPABILITY_PLANNED_LOTS = {
    "refs": "L2a",
    "history-dag": "L2b",
    "github-pr": "P1",
    "index-snapshot": "L4a",
    "working-tree": "L4a",
    "diffs": "L4b",
    "code-analysis": "L5",
    "retention-requests": "R1",
    "reconciliation": "L6b",
    "publication": "L6b",
};
export const NOT_IMPLEMENTED_REASON = "engram-live L1b supplies the package/factory seams and grammar loading only; this capability is explicitly unavailable until its lot lands";
export function describeCapabilities() {
    return CAPABILITY_IDS.map((capability) => ({
        capability,
        state: "unavailable",
        reason: NOT_IMPLEMENTED_REASON,
        plannedLot: CAPABILITY_PLANNED_LOTS[capability],
    }));
}
export const COVERAGE_AXES = [
    "refs",
    "dag",
    "pr-metadata",
    "object-availability",
    "pr-attribution",
    "ast",
    "index",
    "working-tree",
    "remote-publication",
];
/** Languages with a pinned, packaged tree-sitter WASM grammar (L1b matrix). */
export const ADVERTISED_LANGUAGES = [
    "c",
    "cpp",
    "go",
    "java",
    "javascript",
    "php",
    "python",
    "ruby",
    "rust",
    "typescript",
    "tsx",
];
export const GRAMMAR_UNAVAILABLE_REASON = "no packaged grammar is pinned for this language; AST coverage is explicitly unavailable";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function isPositiveInteger(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function hasNul(value) {
    return typeof value === "string" && value.includes("\0");
}
/** Opaque scoped id as minted by the canonical derivation (prefixed, NUL-free). */
function isOpaqueId(value, prefix) {
    return isNonEmptyString(value) && !hasNul(value) && value.startsWith(prefix);
}
function isUncertaintyList(value) {
    return Array.isArray(value) && value.every((state) => isIdentityUncertaintyState(state));
}
// Exact-key enforcement (L6a): every DTO validator rejects unknown keys so
// a misspelled or smuggled field can never pass as a valid declaration,
// clone, worktree, batch or revocation.
function rejectUnknownKeys(value, allowed, path, errors) {
    // Opaque refusal: unknown keys are caller-supplied data and may carry
    // private text, so the key itself is never interpolated into diagnostics.
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) {
            void key;
            errors.push(`${path} carries an unknown key: refused`);
            return;
        }
    }
}
const LIVE_SCOPE_KEYS = ["tenant", "clone", "worktree"];
/**
 * Strict opaque scope identifiers (L4b M1: no free text toward the sink).
 * Lowercase alphanumerics plus `.`, `_`, `:` and `-` only: private code with
 * spaces, parentheses or braces never validates as an identifier.
 */
const STRICT_SCOPE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
function isStrictScopeId(value) {
    return typeof value === "string" && STRICT_SCOPE_ID.test(value);
}
/** Strict opaque batch/generation/key identifiers: prefixed, charset-closed. */
export function isStrictBatchId(value, prefix) {
    return isStrictScopeId(value) && value.startsWith(prefix) && value.length > prefix.length;
}
/**
 * Fixed-width generation identifiers (L4b-2 m9): `gen:` plus exactly
 * GENERATION_ID_WIDTH zero-padded decimal digits. Lexicographic order is
 * numeric order (`gen:0000000010` > `gen:0000000009`), so a newer delivery
 * is never durably rejected as stale. Producers mint monotone ids per
 * target; the host keeps only the highest accepted generation per target.
 */
export const GENERATION_ID_WIDTH = 10;
export function isStrictGenerationId(value) {
    return typeof value === "string" && new RegExp(`^gen:[0-9]{${GENERATION_ID_WIDTH}}$`).test(value);
}
export function validateLiveScope(scope) {
    if (!isRecord(scope))
        return { ok: false, errors: ["scope must be an object"] };
    const errors = [];
    rejectUnknownKeys(scope, LIVE_SCOPE_KEYS, "scope", errors);
    if (!isStrictScopeId(scope.tenant))
        errors.push("scope.tenant must be a strict opaque identifier");
    if (!isStrictScopeId(scope.clone))
        errors.push("scope.clone must be a strict opaque identifier");
    if (scope.worktree !== undefined && !isStrictScopeId(scope.worktree)) {
        errors.push("scope.worktree, when present, must be a strict opaque identifier");
    }
    return { ok: errors.length === 0, errors };
}
const WORKSPACE_DECLARATION_KEYS = [
    "tenant",
    "principal",
    "hostFingerprint",
    "identityUncertainty",
    "declarationId",
    "cloneId",
    "worktreeId",
    "authorizedRoots",
    "liveCapability",
    "policyVersion",
    "declarationRevision",
    "serverWorkspaceId",
    "serverIssuer",
    "bindingRevision",
];
export function validateWorkspaceDeclaration(declaration) {
    if (!isRecord(declaration))
        return { ok: false, errors: ["declaration must be an object"] };
    const errors = [];
    rejectUnknownKeys(declaration, WORKSPACE_DECLARATION_KEYS, "declaration", errors);
    if (!isNonEmptyString(declaration.tenant) || hasNul(declaration.tenant)) {
        errors.push("declaration.tenant must be a non-empty string without NUL");
    }
    if (!isNonEmptyString(declaration.principal) || hasNul(declaration.principal)) {
        errors.push("declaration.principal must be a non-empty string without NUL");
    }
    if (!isUncertaintyList(declaration.identityUncertainty)) {
        errors.push(`declaration.identityUncertainty must be an array of uncertainty states (${IDENTITY_UNCERTAINTY_STATES.join(", ")})`);
    }
    if (declaration.hostFingerprint !== undefined) {
        if (!isNonEmptyString(declaration.hostFingerprint) || hasNul(declaration.hostFingerprint)) {
            errors.push("declaration.hostFingerprint, when present, must be a non-empty string without NUL");
        }
    }
    else if (!isUncertaintyList(declaration.identityUncertainty) ||
        !declaration.identityUncertainty.includes("missing_history")) {
        errors.push('declaration.hostFingerprint is absent: identityUncertainty must explicitly contain "missing_history" (LIVE §12)');
    }
    if (!isOpaqueId(declaration.declarationId, ID_PREFIXES.declaration)) {
        errors.push(`declaration.declarationId must be a non-empty opaque id starting with "${ID_PREFIXES.declaration}"`);
    }
    if (!isOpaqueId(declaration.cloneId, ID_PREFIXES.clone)) {
        errors.push(`declaration.cloneId must be a non-empty opaque id starting with "${ID_PREFIXES.clone}"`);
    }
    if (!isOpaqueId(declaration.worktreeId, ID_PREFIXES.worktree)) {
        errors.push(`declaration.worktreeId must be a non-empty opaque id starting with "${ID_PREFIXES.worktree}"`);
    }
    if (!Array.isArray(declaration.authorizedRoots) || declaration.authorizedRoots.length === 0) {
        errors.push("declaration.authorizedRoots must be a non-empty array");
    }
    else if (declaration.authorizedRoots.some((path) => !isNonEmptyString(path) || hasNul(path))) {
        errors.push("declaration.authorizedRoots entries must be non-empty strings without NUL");
    }
    if (declaration.liveCapability !== "live") {
        errors.push('declaration.liveCapability must be the explicit string "live" (bind/upload is not activation)');
    }
    if (declaration.policyVersion !== POLICY_VERSION) {
        errors.push(`declaration.policyVersion must be the fixed live policy version "${POLICY_VERSION}"`);
    }
    if (!isPositiveInteger(declaration.declarationRevision) ||
        declaration.declarationRevision < INITIAL_DECLARATION_REVISION) {
        errors.push(`declaration.declarationRevision must be an integer >= ${INITIAL_DECLARATION_REVISION}`);
    }
    const hasServerWorkspace = declaration.serverWorkspaceId !== undefined;
    const hasServerIssuer = declaration.serverIssuer !== undefined;
    const hasBindingRevision = declaration.bindingRevision !== undefined;
    if (hasServerWorkspace && (!isNonEmptyString(declaration.serverWorkspaceId) || hasNul(declaration.serverWorkspaceId))) {
        errors.push("declaration.serverWorkspaceId, when present, must be a non-empty string without NUL");
    }
    if (hasServerIssuer && (!isNonEmptyString(declaration.serverIssuer) || hasNul(declaration.serverIssuer))) {
        errors.push("declaration.serverIssuer, when present, must be a non-empty string without NUL");
    }
    if (hasBindingRevision && (!isPositiveInteger(declaration.bindingRevision) ||
        declaration.bindingRevision < INITIAL_BINDING_REVISION)) {
        errors.push(`declaration.bindingRevision, when present, must be an integer >= ${INITIAL_BINDING_REVISION}`);
    }
    // Product live intent binds the complete server/issuer/revision triplet
    // (spec §12): a workspace without its issuer or binding revision, an
    // issuer or revision without the workspace, is not a valid product
    // binding. Absence of all three is a valid local-only declaration
    // requiring no enrollment.
    if ((hasServerWorkspace || hasServerIssuer || hasBindingRevision) &&
        !(hasServerWorkspace && hasServerIssuer && hasBindingRevision)) {
        errors.push("the product binding must be the complete serverWorkspaceId + serverIssuer + bindingRevision triplet: a partial binding is not a valid product intent");
    }
    return { ok: errors.length === 0, errors };
}
const FACT_BATCH_KEYS = [
    "scope",
    "producerName",
    "contractVersion",
    "policyVersion",
    "generationId",
    "batchId",
    "batchDigest",
    "facts",
];
function validateBatchFact(fact, index) {
    const path = `batch.facts[${index}]`;
    if (!isRecord(fact))
        return { ok: false, errors: [`${path} must be an object`] };
    // Sink-bound fact control: every L4b-shaped fact is re-validated at the
    // batch boundary, so a diff carrying transient clair can never ride into
    // a sink inside an otherwise valid envelope. Facts of unknown shape
    // belong to other lots and pass through structurally.
    if ("files" in fact) {
        const checked = validateLocalDiffShape(fact, true);
        if (!checked.ok)
            return { ok: false, errors: checked.errors.map((error) => `${path}: ${error}`) };
        return { ok: true, errors: [] };
    }
    if ("snapshotId" in fact) {
        const checked = validateLocalSnapshot(fact);
        if (!checked.ok)
            return { ok: false, errors: checked.errors.map((error) => `${path}: ${error}`) };
        return { ok: true, errors: [] };
    }
    if ("axis" in fact && "state" in fact && "reason" in fact) {
        const checked = validateLocalCoverage(fact);
        if (!checked.ok)
            return { ok: false, errors: checked.errors.map((error) => `${path}: ${error}`) };
        return { ok: true, errors: [] };
    }
    return { ok: true, errors: [] };
}
export function validateFactBatch(batch) {
    if (!isRecord(batch))
        return { ok: false, errors: ["batch must be an object"] };
    const errors = [];
    rejectUnknownKeys(batch, FACT_BATCH_KEYS, "batch", errors);
    const scope = validateLiveScope(batch.scope);
    if (!scope.ok)
        errors.push(...scope.errors.map((error) => `batch.scope: ${error}`));
    if (batch.producerName !== PRODUCER_NAME)
        errors.push(`batch.producerName must be "${PRODUCER_NAME}"`);
    if (batch.contractVersion !== CONTRACT_VERSION) {
        errors.push(`batch.contractVersion must be ${CONTRACT_VERSION}`);
    }
    if (batch.policyVersion !== CONTENT_POLICY_VERSION) {
        errors.push(`batch.policyVersion must be "${CONTENT_POLICY_VERSION}"`);
    }
    if (!isStrictGenerationId(batch.generationId))
        errors.push(`batch.generationId must be a fixed-width generation id ("gen:" plus ${GENERATION_ID_WIDTH} zero-padded digits)`);
    if (!isStrictBatchId(batch.batchId, "batch:"))
        errors.push("batch.batchId must be a strict opaque batch id");
    if (typeof batch.batchDigest !== "string" || !/^[0-9a-f]{64}$/.test(batch.batchDigest)) {
        errors.push("batch.batchDigest must be a 64 character lowercase hex digest");
    }
    if (!Array.isArray(batch.facts)) {
        errors.push("batch.facts must be an array");
    }
    else {
        batch.facts.forEach((fact, index) => {
            const checked = validateBatchFact(fact, index);
            if (!checked.ok)
                errors.push(...checked.errors);
        });
    }
    return { ok: errors.length === 0, errors };
}
// Same identity, same bytes is idempotent; same identity, different bytes is
// refused (spec §3). Pure decision over validated batches.
export function classifyDuplicateBatch(previous, next) {
    if (previous.batchId !== next.batchId) {
        throw new Error("classifyDuplicateBatch compares the same batch identity only");
    }
    return previous.batchDigest === next.batchDigest ? "idempotent" : "refused";
}
// — L6a: explicit host declarations and clone identity
// (spec/SPEC_LIVE_GIT_INDEXING.md §§2–3, 10, 12; plan/09 L6a; owner Q4 A).
//
// Consumer contract for the h2a (H) and cluster-mesh/sentropic (S) seats.
// H owns durable local declarations plus clone/worktree resolution
// (live-registration.ts, live-declarations.ts, data-pure DTOs); S owns the
// registration persistence, product declarations and migrations; engram
// owns only this data-pure contract and the pure functions in
// ./registration.js. Read this block before implementing either host side.
//
// - Explicit opt-in, once per workspace, through h2a/cluster-mesh. Only
//   liveCapability "live" (EXPLICIT_LIVE_CAPABILITY) activates collection.
//   Bind, upload, code-workspace creation, session opening or session
//   ending never activate or remove a declaration
//   (NON_ACTIVATING_LIFECYCLE_KINDS). Replay of a stored declaration after
//   projection loss resumes work without renewed activation.
// - Engram neutrality: this module takes no imports of any kind (no h2a,
//   no sentropic, no storage driver, no network); registration.ts adds pure
//   functions with no host state, no storage and no network. Durable state
//   belongs to the hosts — local h2a state outside source roots plus
//   app-operated product persistence — independent of the live projection.
// - Opaque identity triangle: every declaration carries a declarationId
//   (unique per declaration, stable across revisions) attached to its
//   cloneId and worktreeId. A revocation names exactly one declaration;
//   withdrawing a whole clone means revoking each of its declarations,
//   each revocation naming its exact declarationId.
// - Workspace fingerprint vs clone identity: the public h2a `ws:`
//   fingerprint stays on the declaration (hostFingerprint) and is never
//   the sole clone key. The clone key is the (hostScope, common-dir
//   realpath, common-dir project fingerprint) triple. Two clones with an
//   equal project fingerprint remain distinct; linked worktrees sharing one
//   common-dir share one clone with isolated worktree identities. The
//   common-dir realpath is host-local and never published to sentropic:
//   share only the opaque cloneId.
// - Identity uncertainty (LIVE §12): a repo without history (unborn HEAD)
//   or with grafted (shallow) history declares explicit uncertainty
//   states; a fingerprint may be absent only under "missing_history".
//   Uncertainty never merges clones: the hostScope + common-dir realpath
//   key components keep them distinct.
// - Revisions increment by exactly one, preserve tenant/principal/
//   hostFingerprint, and preserve the product binding unless the binding
//   itself changes: a revision outside the binding (roots, policy version)
//   keeps it, while a changed serverWorkspaceId or serverIssuer — or an
//   explicit revalidation — requires a strictly increasing
//   bindingRevision (the first binding carries exactly 1). The host must
//   additionally refuse to redirect in-flight collection/publication on
//   rebind.
// - Revocation is a private-purge request: the host stops work, rejects
//   delayed jobs, and purges private snapshots, derived indexes and
//   decryptability, while preserving authorized committed history. Purging
//   never deletes committed facts.
//
// FROZEN L6a CONVENTIONS — both seats align on these values:
// - POLICY_VERSION ("live-git-indexing/1") is the one policy name stamped
//   on every live declaration; h2a's provisional "live-git-1" retires.
// - INITIAL_DECLARATION_REVISION (1): the explicit activation itself is
//   the first revision; there is no revision-0 declaration.
// - INITIAL_BINDING_REVISION (1): the first product binding carries 1,
//   and every rebind/revalidation carries a strictly greater
//   bindingRevision.
// - Identity uncertainty vocabulary: "missing_history", "shallow_history"
//   (the labels H already produces under LIVE §12).
// - Opaque ids are minted ONLY through the canonical derivation below
//   (canonicalIdKey + the sha256 minting in ./registration.js): the same
//   inputs give H, S and E byte-identical cloneId/worktreeId/
//   declarationId. MIGRATION (H): identifiers already persisted by h2a
//   were hashed from newline-joined "hostScope\nrealpath\nfingerprint"
//   (clone), "hostScope\ngitDir" (worktree) and
//   "hostScope\ncommonDirRealpath\nws:" (declaration); that scheme is
//   ambiguous and diverges from this contract. Re-derive every persisted
//   id with the canonical derivation and rewrite the local h2a store; no
//   old id has crossed to sentropic (L6a is not consumed yet), so the
//   migration is a purely local rewrite with no product-side replay.
/** The only capability value that activates live collection (Q4 A). */
export const EXPLICIT_LIVE_CAPABILITY = "live";
/**
 * Lifecycle kinds that never activate or remove a live declaration:
 * enrollment bind, transcript upload, code-workspace creation and agent
 * session open/end are distinct capabilities (spec §12).
 */
export const NON_ACTIVATING_LIFECYCLE_KINDS = [
    "bind",
    "upload",
    "code-workspace-create",
    "session-open",
    "session-end",
];
export function isNonActivatingLifecycleKind(value) {
    return (typeof value === "string" &&
        NON_ACTIVATING_LIFECYCLE_KINDS.includes(value));
}
export const OID_ALGORITHMS = ["sha1", "sha256"];
export const REVOCATION_REASONS = ["workspace-remove", "owner-request", "policy-withdrawn"];
export function isRevocationReason(value) {
    return (typeof value === "string" &&
        REVOCATION_REASONS.includes(value));
}
/**
 * Explicit identity-coverage uncertainty states (LIVE §12). A repo with no
 * history (unborn HEAD) declares "missing_history"; a grafted (shallow)
 * history declares "shallow_history" while keeping its fingerprints, whose
 * coverage stays uncertain. An absent fingerprint is valid only under
 * "missing_history"; uncertainty never merges clones.
 */
export const IDENTITY_UNCERTAINTY_STATES = ["missing_history", "shallow_history"];
export function isIdentityUncertaintyState(value) {
    return (typeof value === "string" &&
        IDENTITY_UNCERTAINTY_STATES.includes(value));
}
/** First declaration revision: the explicit activation is revision 1. */
export const INITIAL_DECLARATION_REVISION = 1;
/** First product binding revision; every rebind carries a strictly greater one. */
export const INITIAL_BINDING_REVISION = 1;
/** The three opaque id kinds minted by the canonical derivation. */
export const ID_KINDS = ["clone", "worktree", "declaration"];
/** Opaque id prefixes; a valid id of a kind starts with its prefix. */
export const ID_PREFIXES = {
    clone: "clone:",
    worktree: "wt:",
    declaration: "decl:",
};
export function isIdKind(value) {
    return (typeof value === "string" &&
        ID_KINDS.includes(value));
}
/**
 * THE canonical identity serialization shared by every live opaque id
 * (cloneId, worktreeId, declarationId). Both seats and engram mint ids
 * from this exact function, so the same identity components always give
 * the same id on every side. The serialization is unambiguous: a JSON
 * array of the kind plus the components in order, so no component value
 * can shift a boundary. NUL is refused outright in every component, so the
 * ambiguous couples ("a\0b", "c") vs ("a", "b\0c") can never be
 * constructed. Pure and total over valid inputs; throws on malformed
 * components so no silent normalization can produce a colliding key.
 */
export function canonicalIdKey(kind, components) {
    if (!isIdKind(kind)) {
        throw new Error(`canonicalIdKey requires a known id kind (${ID_KINDS.join(", ")})`);
    }
    for (const component of components) {
        if (typeof component !== "string") {
            throw new Error("canonicalIdKey requires string components");
        }
        if (component.includes("\0")) {
            throw new Error("canonicalIdKey refuses NUL in identity components");
        }
    }
    return JSON.stringify([kind, ...components]);
}
const CLONE_IDENTITY_KEYS = [
    "hostScope",
    "commonDirRealpath",
    "commonDirProjectFingerprint",
    "cloneId",
    "oidAlgorithm",
    "identityUncertainty",
];
const WORKTREE_IDENTITY_KEYS = [
    "cloneId",
    "worktreeId",
    "worktreePath",
    "gitDir",
    "worktreeFingerprint",
    "identityUncertainty",
];
// — L2b: roots, retained DAG and OID completion
// (spec/SPEC_LIVE_GIT_INDEXING.md §§3–4, 6; plan/09 L2b). Data-pure DTOs,
// constants and validators only; the engine lives in ./history.js and the
// ref/repository models in ./refs.js and ./repository.js. Every fact and
// lookup below is scoped by clone and qualified by OID algorithm.
/**
 * The follow-up window for branch activity (spec §4). It selects followed
 * branches only; it never limits commit count, commit age, retained DAG
 * facts or already acquired PR history, and it never prunes anything.
 */
export const ACTIVITY_WINDOW_DAYS = 30;
/** Hex length of an OID under one algorithm. */
export function oidHexLength(algorithm) {
    return algorithm === "sha1" ? 40 : 64;
}
/** Strict algorithm-qualified OID check: lowercase hex of the algorithm's exact length. */
export function isValidQualifiedOid(value) {
    return ((value.algorithm === "sha1" || value.algorithm === "sha256") &&
        new RegExp(`^[0-9a-f]{${oidHexLength(value.algorithm)}}$`).test(value.oid));
}
export function validateQualifiedOid(value) {
    if (!isRecord(value))
        return { ok: false, errors: ["qualifiedOid must be an object"] };
    const errors = [];
    if (value.algorithm !== "sha1" && value.algorithm !== "sha256") {
        errors.push('qualifiedOid.algorithm must be "sha1" or "sha256"');
    }
    if (typeof value.oid !== "string" || !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(value.oid)) {
        errors.push("qualifiedOid.oid must be a 40 or 64 character lowercase hex string");
    }
    else if ((value.algorithm === "sha1" || value.algorithm === "sha256") &&
        value.oid.length !== oidHexLength(value.algorithm)) {
        errors.push(`qualifiedOid.oid must have exactly ${oidHexLength(value.algorithm)} hex characters under ${value.algorithm}`);
    }
    return { ok: errors.length === 0, errors };
}
const RAW_REF_OBSERVATION_KEYS = [
    "refName", "oid", "observedAt", "absent", "tipCommitterUnixSeconds",
];
export function validateRawRefObservation(value) {
    if (!isRecord(value))
        return { ok: false, errors: ["ref observation must be an object"] };
    const errors = [];
    rejectUnknownKeys(value, RAW_REF_OBSERVATION_KEYS, "ref observation", errors);
    if (!isNonEmptyString(value.refName) || hasNul(value.refName) || !value.refName.startsWith("refs/")) {
        errors.push("ref observation.refName must be a non-empty full ref name starting with \"refs/\" and without NUL");
    }
    if (typeof value.oid !== "string" || !/^[0-9a-f]{0,64}$/.test(value.oid)) {
        errors.push("ref observation.oid must be a lowercase hex string");
    }
    if (typeof value.observedAt !== "number" || !Number.isSafeInteger(value.observedAt) || value.observedAt <= 0) {
        errors.push("ref observation.observedAt must be a positive safe integer (milliseconds)");
    }
    if (value.absent !== undefined && typeof value.absent !== "boolean") {
        errors.push("ref observation.absent, when present, must be a boolean");
    }
    if (value.absent === true && value.oid !== "") {
        errors.push("ref observation.oid must be empty on an absent (deletion) observation");
    }
    if (value.tipCommitterUnixSeconds !== undefined &&
        (typeof value.tipCommitterUnixSeconds !== "number" || !Number.isSafeInteger(value.tipCommitterUnixSeconds))) {
        errors.push("ref observation.tipCommitterUnixSeconds, when present, must be an integer (unix seconds)");
    }
    return { ok: errors.length === 0, errors };
}
const PRIVATE_PURGE_REQUEST_KEYS = [
    "purgePrivateSnapshots",
    "purgeDerivedIndexes",
    "revokeDecryptability",
    "preserveCommittedHistory",
];
const DECLARATION_REVOCATION_KEYS = [
    "declarationId",
    "tenant",
    "cloneId",
    "worktreeId",
    "declarationRevision",
    "reason",
    "requestPrivatePurge",
];
/**
 * Lexical normalization applied to the host-resolved common-dir realpath
 * before key derivation: trailing slashes are stripped (the filesystem
 * root alone is kept). The host resolves symlinks to the realpath before
 * calling; this function performs no I/O.
 */
export function normalizeCommonDirRealpath(realpath) {
    if (realpath.length > 1) {
        const stripped = realpath.replace(/\/+$/, "");
        return stripped.length === 0 ? "/" : stripped;
    }
    return realpath;
}
export function validateCloneIdentity(identity) {
    if (!isRecord(identity))
        return { ok: false, errors: ["cloneIdentity must be an object"] };
    const errors = [];
    rejectUnknownKeys(identity, CLONE_IDENTITY_KEYS, "cloneIdentity", errors);
    if (!isNonEmptyString(identity.hostScope) || hasNul(identity.hostScope)) {
        errors.push("cloneIdentity.hostScope must be a non-empty string without NUL");
    }
    if (!isNonEmptyString(identity.commonDirRealpath) || hasNul(identity.commonDirRealpath)) {
        errors.push("cloneIdentity.commonDirRealpath must be a non-empty string without NUL");
    }
    if (identity.commonDirProjectFingerprint !== undefined &&
        (!isNonEmptyString(identity.commonDirProjectFingerprint) || hasNul(identity.commonDirProjectFingerprint))) {
        errors.push("cloneIdentity.commonDirProjectFingerprint, when present, must be a non-empty string without NUL");
    }
    else if (identity.commonDirProjectFingerprint === undefined &&
        (!isUncertaintyList(identity.identityUncertainty) ||
            !identity.identityUncertainty.includes("missing_history"))) {
        errors.push('cloneIdentity.commonDirProjectFingerprint is absent: identityUncertainty must explicitly contain "missing_history" (LIVE §12)');
    }
    if (!isOpaqueId(identity.cloneId, ID_PREFIXES.clone)) {
        errors.push(`cloneIdentity.cloneId must be a non-empty opaque id starting with "${ID_PREFIXES.clone}"`);
    }
    if (identity.oidAlgorithm !== "sha1" && identity.oidAlgorithm !== "sha256") {
        errors.push('cloneIdentity.oidAlgorithm must be "sha1" or "sha256"');
    }
    if (!isUncertaintyList(identity.identityUncertainty)) {
        errors.push(`cloneIdentity.identityUncertainty must be an array of uncertainty states (${IDENTITY_UNCERTAINTY_STATES.join(", ")})`);
    }
    return { ok: errors.length === 0, errors };
}
export function validateWorktreeIdentity(identity) {
    if (!isRecord(identity))
        return { ok: false, errors: ["worktreeIdentity must be an object"] };
    const errors = [];
    rejectUnknownKeys(identity, WORKTREE_IDENTITY_KEYS, "worktreeIdentity", errors);
    if (!isOpaqueId(identity.cloneId, ID_PREFIXES.clone)) {
        errors.push(`worktreeIdentity.cloneId must be a non-empty opaque id starting with "${ID_PREFIXES.clone}"`);
    }
    if (!isOpaqueId(identity.worktreeId, ID_PREFIXES.worktree)) {
        errors.push(`worktreeIdentity.worktreeId must be a non-empty opaque id starting with "${ID_PREFIXES.worktree}"`);
    }
    if (!isNonEmptyString(identity.worktreePath) || hasNul(identity.worktreePath)) {
        errors.push("worktreeIdentity.worktreePath must be a non-empty string without NUL");
    }
    if (!isNonEmptyString(identity.gitDir) || hasNul(identity.gitDir)) {
        errors.push("worktreeIdentity.gitDir must be a non-empty string without NUL");
    }
    if (identity.worktreeFingerprint !== undefined &&
        (!isNonEmptyString(identity.worktreeFingerprint) || hasNul(identity.worktreeFingerprint))) {
        errors.push("worktreeIdentity.worktreeFingerprint, when present, must be a non-empty string without NUL");
    }
    else if (identity.worktreeFingerprint === undefined &&
        (!isUncertaintyList(identity.identityUncertainty) ||
            !identity.identityUncertainty.includes("missing_history"))) {
        errors.push('worktreeIdentity.worktreeFingerprint is absent: identityUncertainty must explicitly contain "missing_history" (LIVE §12)');
    }
    if (!isUncertaintyList(identity.identityUncertainty)) {
        errors.push(`worktreeIdentity.identityUncertainty must be an array of uncertainty states (${IDENTITY_UNCERTAINTY_STATES.join(", ")})`);
    }
    return { ok: errors.length === 0, errors };
}
export function validatePrivatePurgeRequest(request) {
    if (!isRecord(request))
        return { ok: false, errors: ["requestPrivatePurge must be an object"] };
    const errors = [];
    rejectUnknownKeys(request, PRIVATE_PURGE_REQUEST_KEYS, "requestPrivatePurge", errors);
    if (request.purgePrivateSnapshots !== true) {
        errors.push("requestPrivatePurge.purgePrivateSnapshots must be true (revocation always purges private snapshots)");
    }
    if (request.purgeDerivedIndexes !== true) {
        errors.push("requestPrivatePurge.purgeDerivedIndexes must be true (revocation always purges derived indexes)");
    }
    if (request.revokeDecryptability !== true) {
        errors.push("requestPrivatePurge.revokeDecryptability must be true (revocation always revokes decryptability)");
    }
    if (request.preserveCommittedHistory !== true) {
        errors.push("requestPrivatePurge.preserveCommittedHistory must be true (revocation never deletes committed history)");
    }
    return { ok: errors.length === 0, errors };
}
// — R1: private retention of every ingested root
// (spec/SPEC_LIVE_GIT_INDEXING.md §4, A02/A04; plan/09 R1). Data-pure DTOs,
// constants and validators only; the engine lives in ./retention.js.
//
// Consumer contract for the h2a (H) seat. H owns the private Git object
// store (live-object-store.ts) and the retention handoff (delegate.ts);
// engram owns only this data-pure contract plus the pure derivation in
// ./retention.js. Read this block before implementing the host side.
//
// - Private retention: every ingested root (default branch even when old,
//   active local/remote branches, PR heads of all states, detached worktree
//   HEADs, previously ingested roots) requires one scoped durable receipt.
//   No commit-count or commit-age limit exists; nothing is ever erased here.
// - Requests carry ONLY the algorithm-qualified OID plus its scope and
//   provenance signal: no file content, no plaintext, no patch, no derived
//   text. Uncommitted plaintext is never added to the private store.
// - Receipts are scoped by tenant + clone (never by worktree, never global)
//   and durable: the host records them through the injected port before any
//   reconstructible-coverage claim. A missing receipt is an explicit
//   object-availability gap, never a silent current claim.
// - Acquisition (H) uses pinned OIDs and private refs, without writing into
//   the observed clone, without borrowing an alternates store that may be
//   GC'd, and without invoking repository-controlled programs. If removal
//   wins the acquisition race, H reports the gap instead of inventing
//   retention. Quotas pause further work without deleting protected roots.
// - Receipts expose an opaque coordinated-backup reference (backupRef) for
//   L8 backup coordination; P1 reuses this facility for PR roots. No raw
//   private pack is published to Postgres through this contract.
/** The coverage axis retention reports on: object availability, never DAG currency. */
export const RETENTION_COVERAGE_AXIS = "object-availability";
const RETENTION_REQUEST_KEYS = [
    "scope",
    "algorithm",
    "oid",
    "firstSignal",
    "refName",
    "requestedAt",
];
const RETENTION_RECEIPT_KEYS = [
    "scope",
    "algorithm",
    "oid",
    "receivedAt",
    "backupRef",
];
const RETENTION_SIGNALS = [
    "default-branch",
    "active-window",
    "pr-head",
    "worktree-head",
    "previously-ingested",
];
function isRetentionScope(scope) {
    return validateLiveScope(scope).ok;
}
export function validateRetentionRequest(request) {
    if (!isRecord(request))
        return { ok: false, errors: ["retention request must be an object"] };
    const errors = [];
    rejectUnknownKeys(request, RETENTION_REQUEST_KEYS, "retention request", errors);
    const scope = validateLiveScope(request.scope);
    if (!scope.ok)
        errors.push(...scope.errors.map((error) => `retention request.scope: ${error}`));
    else if (isRetentionScope(request.scope) && request.scope.worktree !== undefined) {
        errors.push("retention request.scope must be clone-scoped: worktree must be absent (retention is per tenant + clone)");
    }
    if (request.algorithm !== "sha1" && request.algorithm !== "sha256") {
        errors.push('retention request.algorithm must be "sha1" or "sha256"');
    }
    if (typeof request.oid !== "string" || !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(request.oid)) {
        errors.push("retention request.oid must be a 40 or 64 character lowercase hex string");
    }
    else if ((request.algorithm === "sha1" || request.algorithm === "sha256") &&
        request.oid.length !== oidHexLength(request.algorithm)) {
        errors.push(`retention request.oid must have exactly ${oidHexLength(request.algorithm)} hex characters under ${request.algorithm}`);
    }
    if (typeof request.firstSignal !== "string" || !RETENTION_SIGNALS.includes(request.firstSignal)) {
        errors.push(`retention request.firstSignal must be one of ${RETENTION_SIGNALS.join(", ")}`);
    }
    if (request.refName !== null &&
        (!isNonEmptyString(request.refName) || hasNul(request.refName) || !request.refName.startsWith("refs/"))) {
        errors.push('retention request.refName must be null or a non-empty full ref name starting with "refs/" without NUL');
    }
    if (typeof request.requestedAt !== "number" || !Number.isSafeInteger(request.requestedAt) || request.requestedAt <= 0) {
        errors.push("retention request.requestedAt must be a positive safe integer (milliseconds)");
    }
    return { ok: errors.length === 0, errors };
}
export function validateRetentionReceipt(receipt) {
    if (!isRecord(receipt))
        return { ok: false, errors: ["retention receipt must be an object"] };
    const errors = [];
    rejectUnknownKeys(receipt, RETENTION_RECEIPT_KEYS, "retention receipt", errors);
    const scope = validateLiveScope(receipt.scope);
    if (!scope.ok)
        errors.push(...scope.errors.map((error) => `retention receipt.scope: ${error}`));
    else if (isRetentionScope(receipt.scope) && receipt.scope.worktree !== undefined) {
        errors.push("retention receipt.scope must be clone-scoped: worktree must be absent (retention is per tenant + clone)");
    }
    if (receipt.algorithm !== "sha1" && receipt.algorithm !== "sha256") {
        errors.push('retention receipt.algorithm must be "sha1" or "sha256"');
    }
    if (typeof receipt.oid !== "string" || !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(receipt.oid)) {
        errors.push("retention receipt.oid must be a 40 or 64 character lowercase hex string");
    }
    else if ((receipt.algorithm === "sha1" || receipt.algorithm === "sha256") &&
        receipt.oid.length !== oidHexLength(receipt.algorithm)) {
        errors.push(`retention receipt.oid must have exactly ${oidHexLength(receipt.algorithm)} hex characters under ${receipt.algorithm}`);
    }
    if (typeof receipt.receivedAt !== "number" || !Number.isSafeInteger(receipt.receivedAt) || receipt.receivedAt <= 0) {
        errors.push("retention receipt.receivedAt must be a positive safe integer (milliseconds)");
    }
    if (!isNonEmptyString(receipt.backupRef) || hasNul(receipt.backupRef)) {
        errors.push("retention receipt.backupRef must be a non-empty string without NUL (opaque L8 coordination reference)");
    }
    return { ok: errors.length === 0, errors };
}
export function validateDeclarationRevocation(revocation) {
    if (!isRecord(revocation))
        return { ok: false, errors: ["revocation must be an object"] };
    const errors = [];
    rejectUnknownKeys(revocation, DECLARATION_REVOCATION_KEYS, "revocation", errors);
    if (!isOpaqueId(revocation.declarationId, ID_PREFIXES.declaration)) {
        errors.push(`revocation.declarationId must be a non-empty opaque id starting with "${ID_PREFIXES.declaration}"`);
    }
    if (!isNonEmptyString(revocation.tenant) || hasNul(revocation.tenant)) {
        errors.push("revocation.tenant must be a non-empty string without NUL");
    }
    if (!isOpaqueId(revocation.cloneId, ID_PREFIXES.clone)) {
        errors.push(`revocation.cloneId must be a non-empty opaque id starting with "${ID_PREFIXES.clone}"`);
    }
    if (!isOpaqueId(revocation.worktreeId, ID_PREFIXES.worktree)) {
        errors.push(`revocation.worktreeId must be a non-empty opaque id starting with "${ID_PREFIXES.worktree}"`);
    }
    if (!isPositiveInteger(revocation.declarationRevision) ||
        revocation.declarationRevision < INITIAL_DECLARATION_REVISION) {
        errors.push(`revocation.declarationRevision must be an integer >= ${INITIAL_DECLARATION_REVISION}`);
    }
    if (!isRevocationReason(revocation.reason)) {
        errors.push(`revocation.reason must be one of ${REVOCATION_REASONS.join(", ")}`);
    }
    const purge = validatePrivatePurgeRequest(revocation.requestPrivatePurge);
    if (!purge.ok)
        errors.push(...purge.errors.map((error) => `revocation.${error}`));
    return { ok: errors.length === 0, errors };
}
// — P1: all-state GitHub PR synchronization (spec/SPEC_LIVE_GIT_INDEXING.md
// §§3–5; plan/09 P1). Data-pure DTOs, constants and validators only; the
// engines live in ./pr-sync.js (pagination/overlap/sweeps, neutral PR/object
// jobs) and ./pr-attribution.js (pinned historical attribution).
//
// Consumer contracts for the H: (h2a transport) and S: (cluster-mesh mapping)
// seats. H owns the approved installed `gh`/Git executor, host-controlled
// credentials, private object acquisition into service-owned refs and
// retention; S owns adapter mappings/receipts when the L3 contract needs
// PR-specific typed fields. Read this block before implementing either side.
//
// - PRs of every state (open, closed, merged) plus drafts (open + isDraft)
//   are indexed, with no count or age limit and nothing erased: a state
//   change, a force-push or a merge strategy change is a new pinned
//   observation, never a substitution or deletion of the previous one.
// - The GitHub transport is INJECTED (GithubPrTransportPort is implemented by
//   the host test fake here and by the H executor in production): engram
//   performs no network call, persists no token, and never invokes a
//   repository-selected credential helper or executable. Tokens never enter
//   facts, logs or rows: PR_FACT_FORBIDDEN_KEYS are rejected by validation.
// - No end of list without proof: a page with hasMore false must carry
//   endProof "end-of-list"; a page with hasMore true must carry a non-empty
//   nextCursor. A truncated or unproven sweep fails the pass with an
//   explicit gap instead of completing.
// - Metadata and objects advance independently: a metadata cursor success
//   never completes a failed object job, and metadata receipts never
//   acknowledge failed private acquisition (canAcknowledgePrObjects in
//   ./pr-sync.js, consumed by the S mapping).
// - Attribution is pinned history, not ancestry: pinPrAttribution in
//   ./pr-attribution.js requires observed head/base bounds plus merge-base
//   evidence for "complete"; unknown bounds stay "partial" while the
//   acquired ancestry remains available. No REST commit array proves
//   exhaustiveness; merge, squash and rebase stay distinguished.
// - Private acquisition contract for H: acquire only the observed head OID
//   into PRIVATE_PR_REF_PREFIX service refs inside the private store, verify
//   the acquired target against the observed OID, and report a moving head
//   as another observation. Never move refs or touch the user clone index.
/** Every PR state indexed by live (drafts are open + isDraft true). */
export const PULL_REQUEST_STATES = ["open", "closed", "merged"];
export function isPullRequestState(value) {
    return (typeof value === "string" &&
        PULL_REQUEST_STATES.includes(value));
}
/** Merge strategies stay distinguished; unknown means not yet evidenced. */
export const PULL_REQUEST_MERGE_STRATEGIES = ["merge", "squash", "rebase", "unknown"];
export function isPullRequestMergeStrategy(value) {
    return (typeof value === "string" &&
        PULL_REQUEST_MERGE_STRATEGIES.includes(value));
}
/** Transport failure kinds: each preserves last success with stale coverage. */
export const PR_SYNC_ERROR_KINDS = ["offline", "auth_required", "rate_limited", "unavailable", "protocol"];
export function isPrSyncErrorKind(value) {
    return (typeof value === "string" &&
        PR_SYNC_ERROR_KINDS.includes(value));
}
/** Neutral object-job lifecycle, independent of the metadata cursor. */
export const PR_OBJECT_JOB_STATES = ["pending", "acquired", "failed"];
export function isPrObjectJobState(value) {
    return (typeof value === "string" &&
        PR_OBJECT_JOB_STATES.includes(value));
}
/** PR coverage axes (spec §12): metadata, objects and attribution separate. */
export const PR_COVERAGE_AXES = ["pr-metadata", "object-availability", "pr-attribution"];
/** Explicit end-of-list proof: the only accepted complete-sweep terminator. */
export const PR_END_PROOF = "end-of-list";
/** Service-owned refs for private PR acquisition (H executor, never the clone). */
export const PRIVATE_PR_REF_PREFIX = "refs/live-private/pr/";
/** Keys that must never enter a PR fact (tokens stay out of rows/logs). */
export const PR_FACT_FORBIDDEN_KEYS = ["token", "credential", "secret", "authorization"];
const GITHUB_REPOSITORY_KEYS = ["owner", "repo"];
export function validateGithubRepository(value) {
    if (!isRecord(value))
        return { ok: false, errors: ["github repository must be an object"] };
    const errors = [];
    rejectUnknownKeys(value, GITHUB_REPOSITORY_KEYS, "github repository", errors);
    if (!isNonEmptyString(value.owner) || hasNul(value.owner)) {
        errors.push("github repository.owner must be a non-empty string without NUL");
    }
    if (!isNonEmptyString(value.repo) || hasNul(value.repo)) {
        errors.push("github repository.repo must be a non-empty string without NUL");
    }
    return { ok: errors.length === 0, errors };
}
const PULL_REQUEST_FACT_KEYS = [
    "repositoryOwner",
    "repositoryRepo",
    "number",
    "state",
    "isDraft",
    "updatedAt",
    "headOid",
    "headRef",
    "baseOid",
    "baseRef",
    "mergeOid",
    "mergeStrategy",
];
export function validatePullRequestFact(value) {
    if (!isRecord(value))
        return { ok: false, errors: ["PR fact must be an object"] };
    const errors = [];
    rejectUnknownKeys(value, PULL_REQUEST_FACT_KEYS, "PR fact", errors);
    for (const forbidden of PR_FACT_FORBIDDEN_KEYS) {
        if (forbidden in value)
            errors.push(`PR fact must never carry "${forbidden}" (tokens stay out of facts/logs/rows)`);
    }
    if (!isNonEmptyString(value.repositoryOwner) || hasNul(value.repositoryOwner)) {
        errors.push("PR fact.repositoryOwner must be a non-empty string without NUL");
    }
    if (!isNonEmptyString(value.repositoryRepo) || hasNul(value.repositoryRepo)) {
        errors.push("PR fact.repositoryRepo must be a non-empty string without NUL");
    }
    if (typeof value.number !== "number" || !Number.isSafeInteger(value.number) || value.number <= 0) {
        errors.push("PR fact.number must be a positive safe integer");
    }
    if (!isPullRequestState(value.state)) {
        errors.push(`PR fact.state must be one of ${PULL_REQUEST_STATES.join(", ")}`);
    }
    if (typeof value.isDraft !== "boolean") {
        errors.push("PR fact.isDraft must be a boolean (drafts are open + isDraft true)");
    }
    if (typeof value.updatedAt !== "number" || !Number.isSafeInteger(value.updatedAt) || value.updatedAt <= 0) {
        errors.push("PR fact.updatedAt must be a positive safe integer (milliseconds)");
    }
    const head = validateQualifiedOid(value.headOid);
    if (!head.ok)
        errors.push(...head.errors.map((error) => `PR fact.headOid: ${error}`));
    if (!isNonEmptyString(value.headRef) || hasNul(value.headRef)) {
        errors.push("PR fact.headRef must be a non-empty string without NUL");
    }
    const base = validateQualifiedOid(value.baseOid);
    if (!base.ok)
        errors.push(...base.errors.map((error) => `PR fact.baseOid: ${error}`));
    if (!isNonEmptyString(value.baseRef) || hasNul(value.baseRef)) {
        errors.push("PR fact.baseRef must be a non-empty string without NUL");
    }
    if (value.mergeOid !== undefined && value.mergeOid !== null) {
        const merge = validateQualifiedOid(value.mergeOid);
        if (!merge.ok)
            errors.push(...merge.errors.map((error) => `PR fact.mergeOid: ${error}`));
    }
    if (value.mergeStrategy !== undefined && !isPullRequestMergeStrategy(value.mergeStrategy)) {
        errors.push(`PR fact.mergeStrategy, when present, must be one of ${PULL_REQUEST_MERGE_STRATEGIES.join(", ")}`);
    }
    return { ok: errors.length === 0, errors };
}
const PR_PAGE_KEYS = ["items", "nextCursor", "hasMore", "endProof", "etag"];
export function validatePrPage(value) {
    if (!isRecord(value))
        return { ok: false, errors: ["PR page must be an object"] };
    const errors = [];
    rejectUnknownKeys(value, PR_PAGE_KEYS, "PR page", errors);
    if (!Array.isArray(value.items)) {
        errors.push("PR page.items must be an array");
    }
    else {
        value.items.forEach((item, index) => {
            const checked = validatePullRequestFact(item);
            if (!checked.ok)
                errors.push(...checked.errors.map((error) => `PR page.items[${index}]: ${error}`));
        });
    }
    if (value.nextCursor !== null && !isNonEmptyString(value.nextCursor)) {
        errors.push("PR page.nextCursor must be a non-empty string or null");
    }
    if (typeof value.hasMore !== "boolean") {
        errors.push("PR page.hasMore must be a boolean");
    }
    // No end of list without proof, and no contradictory terminator: a page
    // is complete only with hasMore false, the explicit end-of-list proof and
    // a null nextCursor. A continuation cursor beside an end proof, or an end
    // proof on a continuing page, is a protocol failure, never a completion.
    if (value.hasMore === false && value.endProof !== PR_END_PROOF) {
        errors.push(`PR page with hasMore false must carry endProof "${PR_END_PROOF}" (no silent end of list)`);
    }
    if (value.hasMore === false && value.nextCursor !== null) {
        errors.push("PR page with hasMore false must carry nextCursor null (a continuation cursor beside an end proof is contradictory)");
    }
    if (value.hasMore === true && !isNonEmptyString(value.nextCursor)) {
        errors.push("PR page with hasMore true must carry a non-empty nextCursor");
    }
    if (value.hasMore === true && value.endProof !== undefined) {
        errors.push("PR page with hasMore true must not carry an endProof (a continuation excludes the end-of-list proof)");
    }
    if (value.etag !== undefined && value.etag !== null && !isNonEmptyString(value.etag)) {
        errors.push("PR page.etag, when present, must be a non-empty string or null");
    }
    return { ok: errors.length === 0, errors };
}
const PR_SYNC_CURSOR_KEYS = [
    "repositoryOwner",
    "repositoryRepo",
    "updatedAtCursor",
    "lastSuccessAt",
    "lastEtag",
    "etagsByCursor",
    "sweepKind",
    "pendingRetry",
];
export function validatePrSyncCursor(value) {
    if (!isRecord(value))
        return { ok: false, errors: ["PR cursor must be an object"] };
    const errors = [];
    rejectUnknownKeys(value, PR_SYNC_CURSOR_KEYS, "PR cursor", errors);
    if (!isNonEmptyString(value.repositoryOwner) || hasNul(value.repositoryOwner)) {
        errors.push("PR cursor.repositoryOwner must be a non-empty string without NUL");
    }
    if (!isNonEmptyString(value.repositoryRepo) || hasNul(value.repositoryRepo)) {
        errors.push("PR cursor.repositoryRepo must be a non-empty string without NUL");
    }
    if (value.updatedAtCursor !== null &&
        (typeof value.updatedAtCursor !== "number" || !Number.isSafeInteger(value.updatedAtCursor) || value.updatedAtCursor <= 0)) {
        errors.push("PR cursor.updatedAtCursor must be a positive safe integer or null");
    }
    if (value.lastSuccessAt !== null &&
        (typeof value.lastSuccessAt !== "number" || !Number.isSafeInteger(value.lastSuccessAt) || value.lastSuccessAt <= 0)) {
        errors.push("PR cursor.lastSuccessAt must be a positive safe integer or null");
    }
    if (value.lastEtag !== null && value.lastEtag !== undefined && !isNonEmptyString(value.lastEtag)) {
        errors.push("PR cursor.lastEtag must be a non-empty string or null");
    }
    if (value.etagsByCursor !== undefined && value.etagsByCursor !== null) {
        if (!isRecord(value.etagsByCursor)) {
            errors.push("PR cursor.etagsByCursor, when present, must be a record of non-empty ETag strings or null");
        }
        else {
            for (const [key, etag] of Object.entries(value.etagsByCursor)) {
                if (!isNonEmptyString(etag) || hasNul(etag)) {
                    errors.push(`PR cursor.etagsByCursor[${key}] must be a non-empty string without NUL`);
                }
            }
        }
    }
    if (value.sweepKind !== "incremental" && value.sweepKind !== "full") {
        errors.push('PR cursor.sweepKind must be "incremental" or "full"');
    }
    if (value.pendingRetry !== undefined && value.pendingRetry !== null) {
        if (!isRecord(value.pendingRetry)) {
            errors.push("PR cursor.pendingRetry, when present, must be an object or null");
        }
        else {
            if (!isPrSyncErrorKind(value.pendingRetry.kind)) {
                errors.push(`PR cursor.pendingRetry.kind must be one of ${PR_SYNC_ERROR_KINDS.join(", ")}`);
            }
            if (typeof value.pendingRetry.attempts !== "number" || !Number.isSafeInteger(value.pendingRetry.attempts) || value.pendingRetry.attempts <= 0) {
                errors.push("PR cursor.pendingRetry.attempts must be a positive safe integer");
            }
            if (typeof value.pendingRetry.nextAfter !== "number" || !Number.isSafeInteger(value.pendingRetry.nextAfter)) {
                errors.push("PR cursor.pendingRetry.nextAfter must be a safe integer");
            }
        }
    }
    return { ok: errors.length === 0, errors };
}
const PR_OBJECT_JOB_KEYS = [
    "repositoryOwner",
    "repositoryRepo",
    "prNumber",
    "headOid",
    "state",
    "attempts",
    "lastError",
    "acquiredOid",
    "totalCommits",
    "acquiredCommits",
];
export function validatePrObjectJob(value) {
    if (!isRecord(value))
        return { ok: false, errors: ["PR object job must be an object"] };
    const errors = [];
    rejectUnknownKeys(value, PR_OBJECT_JOB_KEYS, "PR object job", errors);
    if (!isNonEmptyString(value.repositoryOwner) || hasNul(value.repositoryOwner)) {
        errors.push("PR object job.repositoryOwner must be a non-empty string without NUL");
    }
    if (!isNonEmptyString(value.repositoryRepo) || hasNul(value.repositoryRepo)) {
        errors.push("PR object job.repositoryRepo must be a non-empty string without NUL");
    }
    if (typeof value.prNumber !== "number" || !Number.isSafeInteger(value.prNumber) || value.prNumber <= 0) {
        errors.push("PR object job.prNumber must be a positive safe integer");
    }
    const head = validateQualifiedOid(value.headOid);
    if (!head.ok)
        errors.push(...head.errors.map((error) => `PR object job.headOid: ${error}`));
    if (!isPrObjectJobState(value.state)) {
        errors.push(`PR object job.state must be one of ${PR_OBJECT_JOB_STATES.join(", ")}`);
    }
    if (typeof value.attempts !== "number" || !Number.isSafeInteger(value.attempts) || value.attempts < 0) {
        errors.push("PR object job.attempts must be a non-negative safe integer");
    }
    if (value.lastError !== undefined && value.lastError !== null && !isPrSyncErrorKind(value.lastError)) {
        errors.push(`PR object job.lastError, when present, must be one of ${PR_SYNC_ERROR_KINDS.join(", ")}`);
    }
    if (value.acquiredOid !== undefined && value.acquiredOid !== null) {
        const acquired = validateQualifiedOid(value.acquiredOid);
        if (!acquired.ok)
            errors.push(...acquired.errors.map((error) => `PR object job.acquiredOid: ${error}`));
    }
    for (const field of ["totalCommits", "acquiredCommits"]) {
        const count = value[field];
        if (count !== undefined && count !== null &&
            (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)) {
            errors.push(`PR object job.${field}, when present, must be a non-negative safe integer (no cap, exact count)`);
        }
    }
    return { ok: errors.length === 0, errors };
}
const PR_ATTRIBUTION_KEYS = [
    "repositoryOwner",
    "repositoryRepo",
    "prNumber",
    "baseOid",
    "headOid",
    "mergeBaseOids",
    "mergeOid",
    "mergeStrategy",
    "status",
    "reason",
];
export function validatePrAttribution(value) {
    if (!isRecord(value))
        return { ok: false, errors: ["PR attribution must be an object"] };
    const errors = [];
    rejectUnknownKeys(value, PR_ATTRIBUTION_KEYS, "PR attribution", errors);
    if (!isNonEmptyString(value.repositoryOwner) || hasNul(value.repositoryOwner)) {
        errors.push("PR attribution.repositoryOwner must be a non-empty string without NUL");
    }
    if (!isNonEmptyString(value.repositoryRepo) || hasNul(value.repositoryRepo)) {
        errors.push("PR attribution.repositoryRepo must be a non-empty string without NUL");
    }
    if (typeof value.prNumber !== "number" || !Number.isSafeInteger(value.prNumber) || value.prNumber <= 0) {
        errors.push("PR attribution.prNumber must be a positive safe integer");
    }
    // An unknown base stays an explicit null and is always partial; only an
    // observed base bound can support a complete attribution.
    if (value.baseOid === null) {
        if (value.status === "complete") {
            errors.push('PR attribution with baseOid null must stay "partial" (an unknown bound is never complete)');
        }
    }
    else {
        const base = validateQualifiedOid(value.baseOid);
        if (!base.ok)
            errors.push(...base.errors.map((error) => `PR attribution.baseOid: ${error}`));
    }
    const head = validateQualifiedOid(value.headOid);
    if (!head.ok)
        errors.push(...head.errors.map((error) => `PR attribution.headOid: ${error}`));
    if (!Array.isArray(value.mergeBaseOids)) {
        errors.push("PR attribution.mergeBaseOids must be an array");
    }
    else {
        value.mergeBaseOids.forEach((oid, index) => {
            const checked = validateQualifiedOid(oid);
            if (!checked.ok)
                errors.push(...checked.errors.map((error) => `PR attribution.mergeBaseOids[${index}]: ${error}`));
        });
        if (value.status === "complete" && value.mergeBaseOids.length === 0) {
            errors.push('PR attribution with status "complete" requires at least one merge-base OID (no proof-less completeness)');
        }
    }
    if (value.mergeOid !== undefined && value.mergeOid !== null) {
        const merge = validateQualifiedOid(value.mergeOid);
        if (!merge.ok)
            errors.push(...merge.errors.map((error) => `PR attribution.mergeOid: ${error}`));
    }
    if (!isPullRequestMergeStrategy(value.mergeStrategy)) {
        errors.push(`PR attribution.mergeStrategy must be one of ${PULL_REQUEST_MERGE_STRATEGIES.join(", ")}`);
    }
    if (value.status !== "complete" && value.status !== "partial") {
        errors.push('PR attribution.status must be "complete" or "partial"');
    }
    if (!isNonEmptyString(value.reason)) {
        errors.push("PR attribution.reason must be a non-empty string");
    }
    return { ok: errors.length === 0, errors };
}
const PRIVATE_ACQUISITION_KEYS = [
    "repositoryOwner",
    "repositoryRepo",
    "prNumber",
    "headOid",
    "serviceRef",
];
export function validatePrivateObjectAcquisitionRequest(value) {
    if (!isRecord(value))
        return { ok: false, errors: ["private acquisition request must be an object"] };
    const errors = [];
    rejectUnknownKeys(value, PRIVATE_ACQUISITION_KEYS, "private acquisition request", errors);
    if (!isNonEmptyString(value.repositoryOwner) || hasNul(value.repositoryOwner)) {
        errors.push("private acquisition request.repositoryOwner must be a non-empty string without NUL");
    }
    if (!isNonEmptyString(value.repositoryRepo) || hasNul(value.repositoryRepo)) {
        errors.push("private acquisition request.repositoryRepo must be a non-empty string without NUL");
    }
    if (typeof value.prNumber !== "number" || !Number.isSafeInteger(value.prNumber) || value.prNumber <= 0) {
        errors.push("private acquisition request.prNumber must be a positive safe integer");
    }
    const head = validateQualifiedOid(value.headOid);
    if (!head.ok)
        errors.push(...head.errors.map((error) => `private acquisition request.headOid: ${error}`));
    if (!isNonEmptyString(value.serviceRef) || hasNul(value.serviceRef)) {
        errors.push("private acquisition request.serviceRef must be a non-empty string without NUL");
    }
    else if (!value.serviceRef.startsWith(PRIVATE_PR_REF_PREFIX)) {
        errors.push(`private acquisition request.serviceRef must stay under "${PRIVATE_PR_REF_PREFIX}" (private store only, never the user clone)`);
    }
    return { ok: errors.length === 0, errors };
}
// — L4b: diffs and encrypted latest local content
// (spec/SPEC_LIVE_GIT_INDEXING.md §§8, 10, A08/A09; plan/09 L4b; owner Q2 B).
// Data-pure DTOs, constants and validators only; the engines live in
// ./diffs.js (neutral derivation), ./content-policy.js (deterministic
// pre-persistence secret/path policy) and ./snapshots.js (latest-only
// staging through the injected protection/store/sink ports).
//
// Consumer contract for the S seat (cluster-mesh protected-payload/sqlite)
// and the H seat (h2a live-key-provider). S and H implement the durable and
// cryptographic sides; engram owns only this data-pure contract plus the
// pure derivation. Read this block before implementing either host side.
//
// - Neutral snapshots/diff/hunk/range facts with versioned normalization
//   (LOCAL_DIFF_NORMALIZER_VERSION): staged, unstaged and conflict-stage
//   diffs are distinct kinds with immutable recorded endpoints
//   (staged = HEAD → index, unstaged = index → worktree, conflict =
//   index → index with separate stage 1/2/3 OIDs). An optional cumulative
//   HEAD → worktree view is never produced here: only the three L4b kinds
//   validate.
// - Deterministic pre-persistence secret/path policy (CONTENT_POLICY_VERSION),
//   applied to EVERY surface — patch text, symbol names, citation quotes,
//   search snippets, context excerpts — before any batch is assembled or
//   stored. Persist-then-mask is structurally refused: the sink-bound
//   validator (validateSealedLocalDiff) rejects transient open hunk lines.
// - Latest authorized encrypted state only (Q2 B): replacement is indexed
//   by target and generation at the sink (L4b M2) — the sink keeps only the
//   highest accepted generation per target, durably rejects any delivery at
//   or below the held generation, and retires every older generation when it
//   accepts a newer one; no list/history accessor exists on the port by
//   construction. Snapshots carry no predecessor pointer. The target
//   includes the diff kind (L4b-2): staged, unstaged and conflict snapshots
//   hold distinct targets, and generation ids are fixed-width numeric
//   (`gen:` plus GENERATION_ID_WIDTH digits) so lexicographic order is
//   numeric order.
// - Without a protection key: allowed metadata/ranges only, explicit
//   content_unavailable (CONTENT_UNAVAILABLE) coverage, and the revocation
//   private-purge request (L6a DeclarationRevocationDto) purges private
//   snapshots, derived indexes and decryptability while preserving
//   authorized committed history.
// - .gitignore is never a secrecy guarantee: no gitignore input exists
//   anywhere in this contract or in the engines; a negation cannot unblock
//   a protected path.
// - Binaries, oversized files, filtered paths, protected paths, symlinks,
//   gitlinks, deletions and unstable captures are explicit exclusions or
//   coverage, never invented text hunks.
/** Versioned local-diff normalization evidence (spec §8: rename detection and thresholds are versioned evidence). */
export const LOCAL_DIFF_NORMALIZER_VERSION = "local-diff-normalizer/1";
/** Versioned deterministic content-policy rules stamped on every L4b fact. */
export const CONTENT_POLICY_VERSION = "live-content-policy/1";
/** Explicit coverage marker when no protection key authorizes local content. */
export const CONTENT_UNAVAILABLE = "content_unavailable";
/** Files larger than this are excluded before any content read (matches the L4a capture bound). */
export const LOCAL_MAX_FILE_BYTES = 1_048_576;
/** The three distinct local comparisons (spec §8; GitNexus staged/unstaged/reference distinction). */
export const LOCAL_DIFF_KINDS = ["staged", "unstaged", "conflict"];
export function isLocalDiffKind(value) {
    return (typeof value === "string" &&
        LOCAL_DIFF_KINDS.includes(value));
}
/** Immutable recorded endpoint of one local comparison. */
export const LOCAL_DIFF_ENDPOINT_LABELS = ["HEAD", "index", "worktree", "empty-tree", "oid"];
/** Why a path carries metadata only, never an invented text hunk. */
export const LOCAL_EXCLUSION_REASONS = [
    "binary",
    "oversized",
    "unknown-size",
    "filtered",
    "protected",
    "symlink",
    "gitlink",
    "unstable-capture",
    "deleted",
];
/**
 * Closed withheld reasons (L4b M1: no free text toward the sink).
 * Secret-rule values name the matched deterministic rule only; the secret
 * itself never appears. `withheld-no-protection-key` is the no-key
 * downgrade of a single hunk.
 */
export const LOCAL_WITHHELD_REASONS = [
    "withheld-secret-aws-access-key",
    "withheld-secret-github-token",
    "withheld-secret-private-key-block",
    "withheld-secret-credential-assignment",
    "withheld-secret-credentialed-url",
    "withheld-secret-unknown",
    "withheld-no-protection-key",
];
export function isLocalWithheldReason(value) {
    return typeof value === "string" && LOCAL_WITHHELD_REASONS.includes(value);
}
/** Closed withheld reason for a matched deterministic secret rule (the secret itself never appears). */
export function withheldReasonForSecretRule(rule) {
    const candidate = `withheld-secret-${rule ?? "unknown"}`;
    return isLocalWithheldReason(candidate) ? candidate : "withheld-secret-unknown";
}
/** Closed seal algorithm allowlist (L4b M1: the S seat extends this list by contract amendment). */
export const LOCAL_SEAL_ALGORITHMS = ["fake-seal/1"];
export function isLocalSealAlgorithm(value) {
    return typeof value === "string" && LOCAL_SEAL_ALGORITHMS.includes(value);
}
/**
 * Strict opaque key reference (L4b M1: host key custody identifier, never
 * free text). Charset-closed; the H seat mints values within this charset.
 */
export function isStrictKeyRef(value) {
    return isStrictScopeId(value);
}
/**
 * Closed coverage reasons (L4b M1: no free sentence toward the sink).
 * Values carrying `content_unavailable` mark the explicit no-content
 * downgrade (CONTENT_UNAVAILABLE).
 */
export const LOCAL_COVERAGE_REASONS = [
    "content_unavailable:no-key",
    "content_unavailable:unstable-capture",
    "content_unavailable:unknown-size",
    "content_unavailable:conflict-inventory-mismatch",
    "content_unavailable:policy-withheld",
    "partial:no-snapshot-payload",
    "current:sealed-latest",
];
export function isLocalCoverageReason(value) {
    return typeof value === "string" && LOCAL_COVERAGE_REASONS.includes(value);
}
/** Closed snapshot metadata-only reasons (L4b M1: the no-key downgrade reason; L4b-2: the secret-exclusion reason). */
export const LOCAL_SNAPSHOT_METADATA_REASONS = [
    "metadata:unstable-capture",
    "metadata:no-key",
    "metadata:no-payload",
    "metadata:policy-withheld",
];
export function isLocalSnapshotMetadataReason(value) {
    return (typeof value === "string" && LOCAL_SNAPSHOT_METADATA_REASONS.includes(value));
}
/** Strict snapshot identity: `lsnap:` plus the 64 hex characters minted at staging. */
export function isStrictSnapshotId(value) {
    return typeof value === "string" && /^lsnap:[0-9a-f]{64}$/.test(value);
}
export const LOCAL_FILE_STATUSES = ["added", "modified", "deleted", "conflict"];
/** Explicit index/working-tree coverage (spec §12; A04/A09). */
export const LOCAL_COVERAGE_CAUSES = ["unstable-capture", "missing-key", "policy-withheld"];
const LOCAL_DIFF_ENDPOINT_KEYS = ["label", "oid"];
const LOCAL_HUNK_KEYS = [
    "startBefore",
    "countBefore",
    "startAfter",
    "countAfter",
    "payload",
];
const OPEN_LINES_PAYLOAD_KEYS = ["state", "lines"];
const SEALED_HUNK_PAYLOAD_KEYS = ["state", "algorithm", "keyRef", "ciphertext"];
const WITHHELD_PAYLOAD_KEYS = ["state", "reason"];
const LOCAL_FILE_CHANGE_KEYS = [
    "path",
    "previousPath",
    "status",
    "oldMode",
    "newMode",
    "oldOid",
    "newOid",
    "added",
    "deleted",
    "exclusion",
    "stageOids",
    "hunks",
];
const LOCAL_DIFF_KEYS = [
    "scope",
    "worktreeId",
    "kind",
    "base",
    "tip",
    "comparedParent",
    "mergeBase",
    "normalizerVersion",
    "policyVersion",
    "files",
    "coverage",
];
const LOCAL_COVERAGE_KEYS = ["axis", "state", "reason", "cause"];
const LOCAL_SNAPSHOT_KEYS = [
    "scope",
    "worktreeId",
    "snapshotId",
    "kind",
    "diffKind",
    "capturedAt",
    "diffDigest",
    "sealed",
    "policyVersion",
];
const SEALED_SNAPSHOT_PAYLOAD_KEYS = ["state", "algorithm", "keyRef", "ciphertext"];
const METADATA_SNAPSHOT_PAYLOAD_KEYS = ["state", "reason"];
function isHexOid(value) {
    return typeof value === "string" && (/^[0-9a-f]{40}$/.test(value) || /^[0-9a-f]{64}$/.test(value));
}
function isPathBytes(value) {
    return value instanceof Uint8Array;
}
export function validateLocalDiffEndpoint(endpoint) {
    if (!isRecord(endpoint))
        return { ok: false, errors: ["diff endpoint must be an object"] };
    const errors = [];
    rejectUnknownKeys(endpoint, LOCAL_DIFF_ENDPOINT_KEYS, "diff endpoint", errors);
    if (typeof endpoint.label !== "string" ||
        !LOCAL_DIFF_ENDPOINT_LABELS.includes(endpoint.label)) {
        errors.push(`diff endpoint.label must be one of ${LOCAL_DIFF_ENDPOINT_LABELS.join(", ")}`);
    }
    if (endpoint.label === "worktree" || endpoint.label === "empty-tree") {
        if (endpoint.oid !== null) {
            errors.push("diff endpoint.oid must be null for the worktree and empty-tree endpoints");
        }
    }
    else if (!isHexOid(endpoint.oid)) {
        errors.push("diff endpoint.oid must be a 40 or 64 character lowercase hex string");
    }
    return { ok: errors.length === 0, errors };
}
function validateLocalHunkPayload(payload, sealed) {
    if (!isRecord(payload))
        return { ok: false, errors: ["hunk payload must be an object"] };
    const errors = [];
    // Per-variant exact keys (sink-bound proof): a "sealed" payload carrying
    // a foreign "lines" key is clair under seal and never validates, in either
    // mode. Shared key sets across variants are what let clair pass.
    if (payload.state === "open-lines") {
        rejectUnknownKeys(payload, OPEN_LINES_PAYLOAD_KEYS, "hunk payload", errors);
        if (sealed) {
            errors.push("hunk payload \"open-lines\" is transient pre-persistence evidence and never reaches a sink or a store");
        }
        else if (!Array.isArray(payload.lines) ||
            payload.lines.some((line) => typeof line !== "string" || line.includes("\0"))) {
            errors.push("hunk payload.lines must be an array of NUL-free strings");
        }
    }
    else if (payload.state === "sealed") {
        rejectUnknownKeys(payload, SEALED_HUNK_PAYLOAD_KEYS, "hunk payload", errors);
        if (!isLocalSealAlgorithm(payload.algorithm)) {
            errors.push(`hunk payload.algorithm must be one of ${LOCAL_SEAL_ALGORITHMS.join(", ")}`);
        }
        if (!isStrictKeyRef(payload.keyRef)) {
            errors.push("hunk payload.keyRef must be a strict opaque key reference");
        }
        if (!(payload.ciphertext instanceof Uint8Array) || payload.ciphertext.length === 0) {
            errors.push("hunk payload.ciphertext must be a non-empty byte array");
        }
        if ("lines" in payload) {
            errors.push("hunk payload.lines is clair and never coexists with a sealed state");
        }
    }
    else if (payload.state === "withheld") {
        rejectUnknownKeys(payload, WITHHELD_PAYLOAD_KEYS, "hunk payload", errors);
        if (!isLocalWithheldReason(payload.reason)) {
            errors.push(`hunk payload.reason must be one of ${LOCAL_WITHHELD_REASONS.join(", ")}`);
        }
    }
    else {
        errors.push('hunk payload.state must be "open-lines", "sealed" or "withheld"');
    }
    return { ok: errors.length === 0, errors };
}
function validateLocalHunk(hunk, path, sealed) {
    if (!isRecord(hunk))
        return { ok: false, errors: [`${path} must be an object`] };
    const errors = [];
    rejectUnknownKeys(hunk, LOCAL_HUNK_KEYS, path, errors);
    for (const bound of ["startBefore", "countBefore", "startAfter", "countAfter"]) {
        const value = hunk[bound];
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
            errors.push(`${path}.${bound} must be a non-negative safe integer (immutable range bound)`);
        }
    }
    const payload = validateLocalHunkPayload(hunk.payload, sealed);
    if (!payload.ok)
        errors.push(...payload.errors.map((error) => `${path}.${error}`));
    return { ok: errors.length === 0, errors };
}
function validateLocalFileChange(file, path, sealed) {
    if (!isRecord(file))
        return { ok: false, errors: [`${path} must be an object`] };
    const errors = [];
    rejectUnknownKeys(file, LOCAL_FILE_CHANGE_KEYS, path, errors);
    if (!isPathBytes(file.path) || file.path.length === 0) {
        errors.push(`${path}.path must be non-empty raw path bytes`);
    }
    if (file.previousPath !== null && (!isPathBytes(file.previousPath) || file.previousPath.length === 0)) {
        errors.push(`${path}.previousPath must be null or non-empty raw path bytes`);
    }
    if (typeof file.status !== "string" ||
        !LOCAL_FILE_STATUSES.includes(file.status)) {
        errors.push(`${path}.status must be one of ${LOCAL_FILE_STATUSES.join(", ")}`);
    }
    for (const mode of ["oldMode", "newMode"]) {
        if (typeof file[mode] !== "string" || !/^[0-7]{6}$/.test(file[mode])) {
            errors.push(`${path}.${mode} must be a six-digit octal file mode`);
        }
    }
    for (const oid of ["oldOid", "newOid"]) {
        if (!isHexOid(file[oid]) && file[oid] !== "0".repeat(40) && file[oid] !== "0".repeat(64)) {
            errors.push(`${path}.${oid} must be a hex OID or the zero OID`);
        }
    }
    if (file.added !== null && (typeof file.added !== "number" || !Number.isSafeInteger(file.added) || file.added < 0)) {
        errors.push(`${path}.added must be null or a non-negative safe integer (null for binary/non-textual content)`);
    }
    if (file.deleted !== null && (typeof file.deleted !== "number" || !Number.isSafeInteger(file.deleted) || file.deleted < 0)) {
        errors.push(`${path}.deleted must be null or a non-negative safe integer (null for binary/non-textual content)`);
    }
    if (file.exclusion !== undefined) {
        if (typeof file.exclusion !== "string" ||
            !LOCAL_EXCLUSION_REASONS.includes(file.exclusion)) {
            errors.push(`${path}.exclusion must be one of ${LOCAL_EXCLUSION_REASONS.join(", ")}`);
        }
        if (Array.isArray(file.hunks) && file.hunks.length > 0) {
            errors.push(`${path} is excluded: excluded files carry metadata only, never text hunks`);
        }
        if (file.added !== null || file.deleted !== null) {
            errors.push(`${path} is excluded: excluded files carry null numstat counts, never invented counts`);
        }
    }
    if (file.stageOids !== undefined) {
        if (!isRecord(file.stageOids)) {
            errors.push(`${path}.stageOids must be an object keyed by conflict stage`);
        }
        else {
            // Opaque refusal: the rejected stage key is caller-supplied data and
            // may itself carry private text, so it is never interpolated.
            for (const stage of Object.keys(file.stageOids)) {
                if (stage !== "1" && stage !== "2" && stage !== "3") {
                    errors.push(`${path}.stageOids carries an unknown conflict stage: only conflict stages 1/2/3 exist`);
                }
                else if (!isHexOid(file.stageOids[stage])) {
                    errors.push(`${path}.stageOids holds a non-OID value: every present stage must be a hex OID`);
                }
            }
        }
    }
    if (!Array.isArray(file.hunks)) {
        errors.push(`${path}.hunks must be an array`);
    }
    else {
        file.hunks.forEach((hunk, index) => {
            const checked = validateLocalHunk(hunk, `${path}.hunks[${index}]`, sealed);
            if (!checked.ok)
                errors.push(...checked.errors);
        });
    }
    return { ok: errors.length === 0, errors };
}
export function validateLocalCoverage(coverage) {
    if (!isRecord(coverage))
        return { ok: false, errors: ["diff coverage must be an object"] };
    const errors = [];
    rejectUnknownKeys(coverage, LOCAL_COVERAGE_KEYS, "diff coverage", errors);
    if (coverage.axis !== "index" && coverage.axis !== "working-tree") {
        errors.push('diff coverage.axis must be "index" or "working-tree"');
    }
    if (typeof coverage.state !== "string" ||
        !["current", "pending", "partial", "stale", "unavailable"].includes(coverage.state)) {
        errors.push("diff coverage.state must be an explicit coverage state, never an empty success");
    }
    if (!isLocalCoverageReason(coverage.reason)) {
        errors.push(`diff coverage.reason must be one of ${LOCAL_COVERAGE_REASONS.join(", ")}`);
    }
    if (coverage.cause !== undefined &&
        (typeof coverage.cause !== "string" ||
            !LOCAL_COVERAGE_CAUSES.includes(coverage.cause))) {
        errors.push(`diff coverage.cause must be one of ${LOCAL_COVERAGE_CAUSES.join(", ")}`);
    }
    return { ok: errors.length === 0, errors };
}
function checkLocalDiffEndpoints(kind, base, tip) {
    if (kind === "staged" && (base.label !== "HEAD" || tip.label !== "index")) {
        return ['a "staged" diff is HEAD → index only: staged, unstaged and conflict stages never share endpoints'];
    }
    if (kind === "unstaged" && (base.label !== "index" || tip.label !== "worktree")) {
        return ['an "unstaged" diff is index → worktree only: staged, unstaged and conflict stages never share endpoints'];
    }
    if (kind === "conflict" && (base.label !== "index" || tip.label !== "index")) {
        return ['a "conflict" diff is index → index with stage 1/2/3 OIDs only'];
    }
    return [];
}
function validateLocalDiffShape(diff, sealed) {
    if (!isRecord(diff))
        return { ok: false, errors: ["local diff must be an object"] };
    const errors = [];
    rejectUnknownKeys(diff, LOCAL_DIFF_KEYS, "local diff", errors);
    const scope = validateLiveScope(diff.scope);
    if (!scope.ok)
        errors.push(...scope.errors.map((error) => `local diff.scope: ${error}`));
    if (!isStrictBatchId(diff.worktreeId, ID_PREFIXES.worktree)) {
        errors.push(`local diff.worktreeId must be a strict opaque id starting with "${ID_PREFIXES.worktree}"`);
    }
    const kindOk = isLocalDiffKind(diff.kind);
    if (!kindOk) {
        errors.push(`local diff.kind must be one of ${LOCAL_DIFF_KINDS.join(", ")} (no cumulative HEAD → worktree view validates here)`);
    }
    const base = validateLocalDiffEndpoint(diff.base);
    if (!base.ok)
        errors.push(...base.errors.map((error) => `local diff.base: ${error}`));
    const tip = validateLocalDiffEndpoint(diff.tip);
    if (!tip.ok)
        errors.push(...tip.errors.map((error) => `local diff.tip: ${error}`));
    if (kindOk && base.ok && tip.ok) {
        errors.push(...checkLocalDiffEndpoints(diff.kind, diff.base, diff.tip));
    }
    if (diff.comparedParent !== undefined && diff.comparedParent !== null &&
        (typeof diff.comparedParent !== "number" || !Number.isSafeInteger(diff.comparedParent) || diff.comparedParent < 0)) {
        errors.push("local diff.comparedParent, when present, must be null or a non-negative safe integer");
    }
    if (diff.mergeBase !== undefined && diff.mergeBase !== null && !isHexOid(diff.mergeBase)) {
        errors.push("local diff.mergeBase, when present, must be null or a hex OID");
    }
    if (diff.normalizerVersion !== LOCAL_DIFF_NORMALIZER_VERSION) {
        errors.push(`local diff.normalizerVersion must be "${LOCAL_DIFF_NORMALIZER_VERSION}" (normalization is versioned evidence)`);
    }
    if (diff.policyVersion !== CONTENT_POLICY_VERSION) {
        errors.push(`local diff.policyVersion must be "${CONTENT_POLICY_VERSION}"`);
    }
    if (!Array.isArray(diff.files)) {
        errors.push("local diff.files must be an array");
    }
    else {
        diff.files.forEach((file, index) => {
            const checked = validateLocalFileChange(file, `local diff.files[${index}]`, sealed);
            if (!checked.ok)
                errors.push(...checked.errors);
        });
    }
    if (diff.coverage !== undefined) {
        const coverage = validateLocalCoverage(diff.coverage);
        if (!coverage.ok)
            errors.push(...coverage.errors.map((error) => `local diff.${error}`));
    }
    return { ok: errors.length === 0, errors };
}
/** Structural validation of a derived (possibly transient) local diff. */
export function validateLocalDiff(diff) {
    return validateLocalDiffShape(diff, false);
}
/**
 * Sink/store-bound validation: transient "open-lines" hunk payloads are
 * refused, so persist-then-mask cannot validate. Seal through the injected
 * host protection port first, or withhold explicitly.
 */
export function validateSealedLocalDiff(diff) {
    return validateLocalDiffShape(diff, true);
}
function validateSealedSnapshotPayload(payload) {
    if (!isRecord(payload))
        return { ok: false, errors: ["snapshot sealed payload must be an object"] };
    const errors = [];
    if (payload.state === "sealed") {
        rejectUnknownKeys(payload, SEALED_SNAPSHOT_PAYLOAD_KEYS, "snapshot sealed payload", errors);
        if (!isLocalSealAlgorithm(payload.algorithm)) {
            errors.push(`snapshot sealed payload.algorithm must be one of ${LOCAL_SEAL_ALGORITHMS.join(", ")}`);
        }
        if (!isStrictKeyRef(payload.keyRef)) {
            errors.push("snapshot sealed payload.keyRef must be a strict opaque key reference (host key custody, never in the database)");
        }
        if (!(payload.ciphertext instanceof Uint8Array) || payload.ciphertext.length === 0) {
            errors.push("snapshot sealed payload.ciphertext must be a non-empty byte array");
        }
        if ("lines" in payload || "reason" in payload) {
            errors.push("a sealed snapshot payload carries ciphertext only, never clair or downgrade reasons");
        }
    }
    else if (payload.state === "metadata-only") {
        rejectUnknownKeys(payload, METADATA_SNAPSHOT_PAYLOAD_KEYS, "snapshot sealed payload", errors);
        if (!isLocalSnapshotMetadataReason(payload.reason)) {
            errors.push(`snapshot sealed payload.reason must be one of ${LOCAL_SNAPSHOT_METADATA_REASONS.join(", ")}`);
        }
    }
    else {
        errors.push('snapshot sealed payload.state must be "sealed" or "metadata-only"');
    }
    return { ok: errors.length === 0, errors };
}
/** Structural validation of the latest authorized local state (Q2 B). */
export function validateLocalSnapshot(snapshot) {
    if (!isRecord(snapshot))
        return { ok: false, errors: ["local snapshot must be an object"] };
    const errors = [];
    rejectUnknownKeys(snapshot, LOCAL_SNAPSHOT_KEYS, "local snapshot", errors);
    const scope = validateLiveScope(snapshot.scope);
    if (!scope.ok)
        errors.push(...scope.errors.map((error) => `local snapshot.scope: ${error}`));
    if (!isStrictBatchId(snapshot.worktreeId, ID_PREFIXES.worktree)) {
        errors.push(`local snapshot.worktreeId must be a strict opaque id starting with "${ID_PREFIXES.worktree}"`);
    }
    if (!isStrictSnapshotId(snapshot.snapshotId)) {
        errors.push("local snapshot.snapshotId must be a strict lsnap hex snapshot id");
    }
    if (snapshot.kind !== "index" && snapshot.kind !== "working-tree") {
        errors.push('local snapshot.kind must be "index" or "working-tree"');
    }
    if (!isLocalDiffKind(snapshot.diffKind)) {
        errors.push('local snapshot.diffKind must be one of "staged", "unstaged", "conflict" (staged and conflict hold distinct index targets)');
    }
    // MINEUR 2 (Opus tour 2): kind/diffKind pairing — `unstaged` goes with
    // `working-tree` only; `staged`/`conflict` go with `index` only.
    if ((snapshot.kind === "index" || snapshot.kind === "working-tree") &&
        isLocalDiffKind(snapshot.diffKind)) {
        const coherent = (snapshot.diffKind === "unstaged" && snapshot.kind === "working-tree") ||
            (snapshot.diffKind !== "unstaged" && snapshot.kind === "index");
        if (!coherent) {
            errors.push('local snapshot.kind/diffKind mismatch: "unstaged" pairs with "working-tree" only, "staged"/"conflict" pair with "index" only');
        }
    }
    if (typeof snapshot.capturedAt !== "number" || !Number.isSafeInteger(snapshot.capturedAt) || snapshot.capturedAt <= 0) {
        errors.push("local snapshot.capturedAt must be a positive safe integer (milliseconds)");
    }
    if (typeof snapshot.diffDigest !== "string" || !/^[0-9a-f]{64}$/.test(snapshot.diffDigest)) {
        errors.push("local snapshot.diffDigest must be a 64 character lowercase hex digest of the screened diff");
    }
    const sealed = validateSealedSnapshotPayload(snapshot.sealed);
    if (!sealed.ok)
        errors.push(...sealed.errors.map((error) => `local snapshot.${error}`));
    if (snapshot.policyVersion !== CONTENT_POLICY_VERSION) {
        errors.push(`local snapshot.policyVersion must be "${CONTENT_POLICY_VERSION}"`);
    }
    return { ok: errors.length === 0, errors };
}
