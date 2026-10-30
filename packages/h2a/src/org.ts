/**
 * EVO-7 — Coach mode, slice 1: the pure **org model**. A coach (a `CONDUCTOR`
 * or transversal advisor) helps assign roles and shape who-talks-to-whom across
 * many instances; the *personal organization* is committed to a repo so it is
 * durable, reviewable and diffable. This module is the pure core: it owns the
 * already-parsed org declaration (`H2AOrgManifest` — instances → roles → scopes
 * → comm edges), a total `validateOrgManifest`, and a builder for the signed
 * ratification artifact. No filesystem and no YAML parsing — committed
 * `org.h2a.yaml` parsing and live provisioning are later CLI slices.
 *
 * Topology = `SCOPE` membership: who-may-message-whom is gated by which
 * instances share which scope (presence/`discover` is already scope-filtered).
 * `commEdges` are informational hints only; the actual gate is scope membership.
 *
 * KEY CONSTRAINT — the coach **proposes, does not impose**. A role/scope
 * assignment is never a unilateral coach write: it runs the existing
 * negotiation + signature lifecycle. The coach (a `CONDUCTOR`) signs an
 * `org-proposal` envelope; affected agents may counter / give input; the owning
 * `PRINCIPAL` then emits an `org-ratified` envelope signed by them. Only the
 * ratified manifest is provisioned (provisioning is a later CLI slice, not in
 * this core module). The org-assignment thus introduces no new artifact kind —
 * it is a signed `event` envelope carrying a manifest (parity with the NHI
 * attestation, DEC-088), verified with the standard `verifyEnvelopeSignature`.
 */

import { canonicalize, computeHash } from "./canonical.js";
import { createEnvelope, isH2AEnvelope, verifyEnvelopeSignature } from "./envelope.js";
import { signCanonical, verifyCanonical } from "./signature.js";
import { H2A_ROLES, type H2AEnvelope, type H2ARole } from "./types.js";

/**
 * CLI pass-through ceiling (r2 §2.6 pass-through vocabulary): the explicit
 * record naming what a run without a memorial agent may use in this org
 * actor's scope. Absent a recorded ceiling, pass-through is refused — there
 * is no implicit pass-through.
 */
export interface H2ACliPassThroughCeiling {
  readonly allowedCliKinds: readonly string[];
  readonly allowedModels?: readonly string[];
  readonly effortCeiling?: string;
}

/**
 * Memorial-agent declaration (r2 §2.4, Q-C): the versioned `org.h2a.yaml`
 * schema extension. Per org actor: the durable launch name (the L1 anchor
 * component with `agentUuid`), the `agentUuid` enrolment reference or
 * enrolment request, the H1 policy reference, the role-memory purpose grant,
 * the sub-agent purpose opt-in and the CLI pass-through ceiling. A
 * declaration names org actors (bare launch names), never a per-conversation
 * instance id.
 */
export interface H2AOrgMemorialAgentDeclaration {
  /** Durable launch name (`h2a run --name`); never a per-conversation instance id. */
  readonly launchName: string;
  /** agentUuid enrolment reference or enrolment request token, once enrolled. */
  readonly agentUuid?: string;
  /** Reference to the signed `RoleScopePolicyV1` (H1) covering this actor. */
  readonly policyRef?: string;
  /** Role-memory purpose reference; present means role memory is requested. */
  readonly memoryPurpose?: string;
  /**
   * Sub-agent purpose policy. Memory purpose is never inherited implicitly:
   * absent or `"none"` refuses sub-agent memory calls (`purpose_not_granted`);
   * only `"inherit"` opts in.
   */
  readonly subAgentMemory?: "none" | "inherit";
  /** CLI pass-through ceiling for runs without a memorial agent. */
  readonly cliPassThrough?: H2ACliPassThroughCeiling;
}

/** One instance's place in the org: its role + the scopes it sits in. */
export interface H2AOrgInstance {
  readonly instance: string;
  readonly role: H2ARole;
  readonly scopes: readonly string[];
  /** Rights the instance's mandate would carry (informational at this slice). */
  readonly mandateRights?: readonly string[];
  /** Optional memorial-agent declaration (H2A-ORG-H1, r2 §2.4). */
  readonly memorialAgent?: H2AOrgMemorialAgentDeclaration;
}

/** A who-may-message-whom hint. Informational — actual gating is scope membership. */
export interface H2AOrgCommEdge {
  readonly from: string;
  readonly to: string;
}

/**
 * The committable org declaration: instances → roles → scopes → comm edges,
 * rooted at a single org `scope`. This is the already-parsed object; the
 * committed `org.h2a.yaml` form is a later CLI concern.
 */
export interface H2AOrgManifest {
  /** The org's root scope. */
  readonly scope: string;
  readonly version?: string;
  readonly instances: ReadonlyArray<H2AOrgInstance>;
  /** Optional who-may-message-whom hints (informational). */
  readonly commEdges?: ReadonlyArray<H2AOrgCommEdge>;
}

/** Validation error codes for an org manifest (total — never thrown). */
export type H2AOrgValidationError =
  | "no-principal"
  | "duplicate-instance"
  | "instance-empty"
  | "instance-no-scope"
  | "instance-bad-role"
  | "edge-unknown-instance"
  | "memorial-agent-bad-launch-name"
  | "memorial-agent-duplicate-launch-name"
  | "memorial-agent-bad-purpose"
  | "memorial-agent-bad-subagent-policy"
  | "memorial-agent-bad-passthrough"
  | "memorial-agent-bad-declaration";

export interface H2AOrgValidationResult {
  readonly ok: boolean;
  readonly errors: H2AOrgValidationError[];
}

/**
 * Validate an org manifest against the h2a invariants. Total: never throws,
 * returns the (deduped, stable-ordered) set of error codes.
 *
 * Invariants enforced:
 *  - every instance id is non-empty (`instance-empty`) and unique
 *    (`duplicate-instance`);
 *  - every `role` is a canonical {@link H2A_ROLES} member (`instance-bad-role`);
 *  - every instance lists at least one scope (`instance-no-scope`);
 *  - at least one `PRINCIPAL` is declared — anything owned needs a PRINCIPAL
 *    (`no-principal`);
 *  - every {@link H2AOrgCommEdge} references declared instances
 *    (`edge-unknown-instance`);
 *  - every memorial-agent declaration names a bare, non-empty launch name
 *    unique within the manifest (`memorial-agent-bad-launch-name`,
 *    `memorial-agent-duplicate-launch-name` — a declaration names org actors,
 *    never a per-conversation instance id, and a launch name claimed twice is
 *    a collision to resolve, never auto-merged);
 *  - declaration scalars are non-empty when present
 *    (`memorial-agent-bad-purpose`, `memorial-agent-bad-declaration`);
 *  - the sub-agent purpose policy comes from the closed
 *    `"none" | "inherit"` vocabulary (`memorial-agent-bad-subagent-policy`);
 *  - a declared pass-through ceiling carries at least one CLI kind and
 *    well-formed optional fields (`memorial-agent-bad-passthrough`).
 */
export function validateOrgManifest(manifest: H2AOrgManifest): H2AOrgValidationResult {
  const errors = new Set<H2AOrgValidationError>();
  const validRoles = new Set<string>(H2A_ROLES);

  const seen = new Set<string>();
  const declared = new Set<string>();
  const launchNames = new Set<string>();
  let hasPrincipal = false;

  for (const inst of manifest.instances) {
    const id = inst.instance;
    if (typeof id !== "string" || id.length === 0) {
      errors.add("instance-empty");
    } else {
      if (seen.has(id)) {
        errors.add("duplicate-instance");
      }
      seen.add(id);
      declared.add(id);
    }

    if (!validRoles.has(inst.role)) {
      errors.add("instance-bad-role");
    } else if (inst.role === "PRINCIPAL") {
      hasPrincipal = true;
    }

    if (!inst.scopes || inst.scopes.length === 0) {
      errors.add("instance-no-scope");
    }

    const ma = inst.memorialAgent;
    if (ma === undefined) {
      continue;
    }
    if (typeof ma !== "object" || ma === null) {
      errors.add("memorial-agent-bad-declaration");
      continue;
    }
    if (typeof ma.launchName !== "string" || ma.launchName === "" || ma.launchName.includes(":")) {
      errors.add("memorial-agent-bad-launch-name");
    } else if (launchNames.has(ma.launchName)) {
      errors.add("memorial-agent-duplicate-launch-name");
    } else {
      launchNames.add(ma.launchName);
    }
    if (ma.agentUuid !== undefined && (typeof ma.agentUuid !== "string" || ma.agentUuid === "")) {
      errors.add("memorial-agent-bad-declaration");
    }
    if (ma.policyRef !== undefined && (typeof ma.policyRef !== "string" || ma.policyRef === "")) {
      errors.add("memorial-agent-bad-declaration");
    }
    if (ma.memoryPurpose !== undefined && (typeof ma.memoryPurpose !== "string" || ma.memoryPurpose === "")) {
      errors.add("memorial-agent-bad-purpose");
    }
    if (ma.subAgentMemory !== undefined && ma.subAgentMemory !== "none" && ma.subAgentMemory !== "inherit") {
      errors.add("memorial-agent-bad-subagent-policy");
    }
    const ceiling = ma.cliPassThrough;
    if (ceiling !== undefined) {
      const kindsOk =
        typeof ceiling === "object" &&
        ceiling !== null &&
        Array.isArray(ceiling.allowedCliKinds) &&
        ceiling.allowedCliKinds.length > 0 &&
        ceiling.allowedCliKinds.every((k) => typeof k === "string" && k !== "");
      const modelsOk =
        ceiling.allowedModels === undefined ||
        (Array.isArray(ceiling.allowedModels) &&
          ceiling.allowedModels.every((m) => typeof m === "string" && m !== ""));
      const effortOk =
        ceiling.effortCeiling === undefined ||
        (typeof ceiling.effortCeiling === "string" && ceiling.effortCeiling !== "");
      if (!kindsOk || !modelsOk || !effortOk) {
        errors.add("memorial-agent-bad-passthrough");
      }
    }
  }

  if (!hasPrincipal) {
    errors.add("no-principal");
  }

  for (const edge of manifest.commEdges ?? []) {
    if (!declared.has(edge.from) || !declared.has(edge.to)) {
      errors.add("edge-unknown-instance");
    }
  }

  return { ok: errors.size === 0, errors: [...errors] };
}

/**
 * The two body kinds of the org-assignment lifecycle: the coach's `org-proposal`
 * and the PRINCIPAL's `org-ratified`. Only the ratified manifest is provisioned.
 */
export const H2A_ORG_PROPOSAL_BODY_KIND = "org-proposal";
export const H2A_ORG_RATIFIED_BODY_KIND = "org-ratified";

export type H2AOrgAssignmentKind =
  | typeof H2A_ORG_PROPOSAL_BODY_KIND
  | typeof H2A_ORG_RATIFIED_BODY_KIND;

export interface H2AOrgAssignmentBody {
  readonly kind: H2AOrgAssignmentKind;
  readonly manifest: H2AOrgManifest;
}

export interface H2AOrgAssignmentActor {
  readonly instance: string;
  readonly role: H2ARole;
  readonly scope: string;
}

/**
 * Build the canonical *unsigned* envelope carrying an org assignment. No new
 * artifact kind — a plain `event` envelope whose body carries the manifest under
 * a `kind` tag, so a recipient verifies it with the standard
 * `verifyEnvelopeSignature`. The caller signs it: a coach/`CONDUCTOR` signs the
 * `org-proposal`, the owning `PRINCIPAL` signs the `org-ratified`. Core never
 * signs, so the private key never enters core. Only the ratified manifest is
 * provisioned (a later CLI slice).
 */
export function orgAssignmentEnvelope(input: {
  readonly manifest: H2AOrgManifest;
  readonly actor: H2AOrgAssignmentActor;
  readonly kind?: H2AOrgAssignmentKind;
  readonly createdAt?: string;
}): H2AEnvelope<H2AOrgAssignmentBody> {
  const body: H2AOrgAssignmentBody = {
    kind: input.kind ?? H2A_ORG_PROPOSAL_BODY_KIND,
    manifest: input.manifest
  };
  const createdAt = input.createdAt ?? new Date().toISOString();
  const id = `org-${computeHash({ by: input.actor.instance, body, createdAt }).slice(0, 16)}`;
  return createEnvelope<H2AOrgAssignmentBody>({
    id,
    type: "event",
    actor: {
      instance: input.actor.instance,
      role: input.actor.role,
      scope: input.actor.scope
    },
    body,
    createdAt
  });
}

/** A live registry entry, reduced to the fields the org diff reconciles against. */
export interface H2AOrgRegisteredInstance {
  readonly instance: string;
  readonly roles: readonly string[];
  readonly scopes: readonly string[];
}

/** One reconciliation finding between the declared manifest and the live registry. */
export interface H2AOrgDiffEntry {
  readonly instance: string;
  readonly declaredRole?: string;
  readonly registeredRoles?: readonly string[];
  readonly declaredScopes?: readonly string[];
  readonly registeredScopes?: readonly string[];
  /** Declared scopes the registered instance is not (yet) a member of. */
  readonly missingScopes?: readonly string[];
}

/**
 * Drift between a declared org manifest and the live registry. `inSync` is true
 * iff all four finding buckets are empty (the live estate matches the declared
 * org exactly). Read-only — describing drift, never reconciling it.
 */
export interface H2AOrgDiff {
  readonly scope: string;
  /** Declared instances present and fully consistent (role + scopes). */
  readonly matched: string[];
  /** Declared but not registered. */
  readonly missing: H2AOrgDiffEntry[];
  /** Registered but not declared. */
  readonly undeclared: H2AOrgDiffEntry[];
  /** Registered, but its declared role is not among its registered roles. */
  readonly roleMismatch: H2AOrgDiffEntry[];
  /** Registered, but missing one or more declared scopes. */
  readonly scopeGaps: H2AOrgDiffEntry[];
  readonly inSync: boolean;
}

/**
 * Reconcile a declared org manifest against the live registry instances. Pure +
 * total: the CLI gathers `listInstances()` and hands the reduced rows in. This
 * is the read-only precursor to provisioning — it reports what provisioning
 * *would* change, without changing anything.
 */
export function diffOrgManifest(
  manifest: H2AOrgManifest,
  registered: readonly H2AOrgRegisteredInstance[]
): H2AOrgDiff {
  const byInstance = new Map<string, H2AOrgRegisteredInstance>();
  for (const r of registered) byInstance.set(r.instance, r);

  const matched: string[] = [];
  const missing: H2AOrgDiffEntry[] = [];
  const roleMismatch: H2AOrgDiffEntry[] = [];
  const scopeGaps: H2AOrgDiffEntry[] = [];
  const declared = new Set<string>();

  for (const inst of manifest.instances) {
    declared.add(inst.instance);
    const reg = byInstance.get(inst.instance);
    if (!reg) {
      missing.push({
        instance: inst.instance,
        declaredRole: inst.role,
        declaredScopes: inst.scopes
      });
      continue;
    }
    let consistent = true;
    if (!reg.roles.includes(inst.role)) {
      consistent = false;
      roleMismatch.push({
        instance: inst.instance,
        declaredRole: inst.role,
        registeredRoles: reg.roles
      });
    }
    const missingScopes = inst.scopes.filter((s) => !reg.scopes.includes(s));
    if (missingScopes.length > 0) {
      consistent = false;
      scopeGaps.push({
        instance: inst.instance,
        declaredScopes: inst.scopes,
        registeredScopes: reg.scopes,
        missingScopes
      });
    }
    if (consistent) matched.push(inst.instance);
  }

  const undeclared: H2AOrgDiffEntry[] = [];
  for (const reg of registered) {
    if (!declared.has(reg.instance)) {
      undeclared.push({ instance: reg.instance, registeredRoles: reg.roles, registeredScopes: reg.scopes });
    }
  }

  const inSync =
    missing.length === 0 &&
    roleMismatch.length === 0 &&
    scopeGaps.length === 0 &&
    undeclared.length === 0;

  return { scope: manifest.scope, matched, missing, undeclared, roleMismatch, scopeGaps, inSync };
}

/**
 * An append-only org-membership grant (provisioning, DEC-109). Mirrors the
 * DEC-078 keyring: role/scope membership is layered over a registration via a
 * separate event log (`registry/org-membership.jsonl`) — never a registration
 * rewrite — so provisioning a ratified org is additive and idempotent. A grant
 * only ever *augments* an already-registered (keyed) instance; it never conjures
 * an identity (reconcile keyed-only — the resolved provisioning fork).
 */
export interface H2AOrgMembershipGrant {
  readonly instance: string;
  readonly role: string;
  readonly scope: string;
  /** The actor that granted it (e.g. the ratifying PRINCIPAL). */
  readonly by?: string;
  readonly at: string;
}

/**
 * The *effective* registry view: each registered instance's roles + scopes,
 * unioned across all its registration rows AND any membership grants. Grants to
 * an unregistered instance are ignored (keyed-only). Pure — the CLI gathers
 * `listInstances()` + `listOrgMembership()` and hands them in; `diffOrgManifest`
 * then reconciles the manifest against this view, so a provisioned org reads
 * back in-sync without ever rewriting a registration.
 */
export function effectiveOrgInstances(
  registrations: readonly H2AOrgRegisteredInstance[],
  grants: readonly H2AOrgMembershipGrant[]
): H2AOrgRegisteredInstance[] {
  const acc = new Map<string, { roles: Set<string>; scopes: Set<string> }>();
  for (const r of registrations) {
    const entry = acc.get(r.instance) ?? { roles: new Set<string>(), scopes: new Set<string>() };
    for (const role of r.roles) entry.roles.add(role);
    for (const scope of r.scopes) entry.scopes.add(scope);
    acc.set(r.instance, entry);
  }
  for (const g of grants) {
    const entry = acc.get(g.instance);
    if (!entry) continue; // keyed-only: never materialize an unregistered instance
    entry.roles.add(g.role);
    entry.scopes.add(g.scope);
  }
  return [...acc.entries()].map(([instance, { roles, scopes }]) => ({
    instance,
    roles: [...roles],
    scopes: [...scopes]
  }));
}

// ---------------------------------------------------------------------------
// H2A-ORG-H1 — the signed role/scope policy (r2 §2.6 vocabulary in its §8.1
// H1 wire shape). This is the h2a-side contract mirror: h2a authors and signs
// these documents; the final type re-import swaps this mirror for the
// published `@sentropic/cluster-mesh` contract at H2A-354-CUTOVER. Signatures
// are ed25519 over the canonical bytes of the document excluding the
// `signature` field, by a mandated instance key; unknown fields, unknown
// versions, stale revisions and bad signatures refuse with a named reason.
// ---------------------------------------------------------------------------

export const H2A_ROLE_SCOPE_POLICY_FORMAT = "h2a.role-scope-policy/v1";
export const H2A_ROLE_SCOPE_POLICY_REVOCATION_FORMAT = "h2a.role-scope-policy-revocation/v1";

/** Decision-authority classes from the role-structure spec (D0/D1/D2). */
export type H2APolicySigningClass = "D0" | "D1" | "D2";
/** The two engram memory scope kinds (r2 §2.5). */
export type H2APolicyMemoryScope = "role" | "repo";

/**
 * H1 — signed role/scope policy, exactly one document per (actor, scope) key.
 * Governance roles are asserted for audit display only; the key is
 * (actorLaunchName, scope) and multiplicity never unions policies.
 */
export interface RoleScopePolicyV1 {
  readonly format: typeof H2A_ROLE_SCOPE_POLICY_FORMAT;
  readonly policyId: string;
  readonly actorLaunchName: string;
  readonly scope: string;
  readonly governanceRoles: readonly string[];
  readonly allowedCliKinds: readonly string[];
  readonly allowedModels: readonly string[];
  readonly effortCeiling?: string;
  readonly mcpRights: {
    readonly tools: readonly string[];
    readonly connectorClasses: readonly string[];
  };
  readonly memoryScopes: readonly H2APolicyMemoryScope[];
  readonly driveConsentClass: string;
  readonly signingClass: H2APolicySigningClass;
  readonly validFrom: string;
  readonly validUntil?: string;
  readonly revision: number;
  readonly supersedes?: string;
  readonly signerInstance: string;
  readonly signerKeyId: string;
  readonly signature: string;
}

/** The signing view of a policy: the document without its `signature` field. */
export type UnsignedRoleScopePolicyV1 = Omit<RoleScopePolicyV1, "signature">;

/** H1 — signed revocation of every policy revision up to `revokedRevision`. */
export interface RoleScopePolicyRevocationV1 {
  readonly format: typeof H2A_ROLE_SCOPE_POLICY_REVOCATION_FORMAT;
  readonly actorLaunchName: string;
  readonly scope: string;
  readonly revokedRevision: number;
  readonly revokedAt: string;
  readonly reason: string;
  readonly signerInstance: string;
  readonly signerKeyId: string;
  readonly signature: string;
}

export type UnsignedRoleScopePolicyRevocationV1 = Omit<RoleScopePolicyRevocationV1, "signature">;

/** Named refusals for H1 verification (r2 §8.1: refuse, never repair). */
export type H2APolicyRefusalReason =
  | "not-an-object"
  | "unknown-version"
  | "unknown-field"
  | "missing-field"
  | "bad-field"
  | "stale-revision"
  | "bad-signature";

export interface H2APolicyVerification {
  readonly ok: boolean;
  readonly reason?: H2APolicyRefusalReason;
  /** Human-readable detail; never a substitute for the machine reason. */
  readonly error?: string;
}

export interface RoleScopePolicyInput {
  readonly actorLaunchName: string;
  readonly scope: string;
  readonly governanceRoles?: readonly string[];
  readonly allowedCliKinds?: readonly string[];
  readonly allowedModels?: readonly string[];
  readonly effortCeiling?: string;
  readonly mcpRights?: {
    readonly tools?: readonly string[];
    readonly connectorClasses?: readonly string[];
  };
  readonly memoryScopes?: readonly H2APolicyMemoryScope[];
  readonly driveConsentClass: string;
  readonly signingClass: H2APolicySigningClass;
  readonly validFrom: string;
  readonly validUntil?: string;
  readonly revision: number;
  readonly supersedes?: string;
  readonly signerInstance: string;
  readonly signerKeyId: string;
}

function requireNonEmptyString(value: string | undefined, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`buildRoleScopePolicyV1: ${field} must be a non-empty string`);
  }
  return value;
}

function copyStringList(value: readonly string[] | undefined, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry !== "")) {
    throw new Error(`buildRoleScopePolicyV1: ${field} must be a list of non-empty strings`);
  }
  return [...value];
}

/**
 * Deterministic builder for the unsigned policy document: identical input
 * yields an identical document, including the derived `policyId` (a sha256
 * over the format, the (actor, scope) key and the revision — so each
 * revision of one key carries its own stable id). Throws on
 * contract-violating input; the caller (CLI) has already run
 * {@link validateOrgManifest} over the declaration the fields come from.
 */
export function buildRoleScopePolicyV1(input: RoleScopePolicyInput): UnsignedRoleScopePolicyV1 {
  const actorLaunchName = requireNonEmptyString(input.actorLaunchName, "actorLaunchName");
  const scope = requireNonEmptyString(input.scope, "scope");
  const driveConsentClass = requireNonEmptyString(input.driveConsentClass, "driveConsentClass");
  const validFrom = requireNonEmptyString(input.validFrom, "validFrom");
  const signerInstance = requireNonEmptyString(input.signerInstance, "signerInstance");
  const signerKeyId = requireNonEmptyString(input.signerKeyId, "signerKeyId");
  if (input.validUntil !== undefined) requireNonEmptyString(input.validUntil, "validUntil");
  if (input.supersedes !== undefined) requireNonEmptyString(input.supersedes, "supersedes");
  if (input.effortCeiling !== undefined) requireNonEmptyString(input.effortCeiling, "effortCeiling");
  if (!Number.isInteger(input.revision) || input.revision < 1) {
    throw new Error("buildRoleScopePolicyV1: revision must be an integer >= 1");
  }
  if (input.signingClass !== "D0" && input.signingClass !== "D1" && input.signingClass !== "D2") {
    throw new Error('buildRoleScopePolicyV1: signingClass must be "D0", "D1" or "D2"');
  }
  const memoryScopes = copyStringList(input.memoryScopes, "memoryScopes");
  if (!memoryScopes.every((s) => s === "role" || s === "repo")) {
    throw new Error('buildRoleScopePolicyV1: memoryScopes entries must be "role" or "repo"');
  }
  const mcpTools = copyStringList(input.mcpRights?.tools, "mcpRights.tools");
  const mcpConnectorClasses = copyStringList(
    input.mcpRights?.connectorClasses,
    "mcpRights.connectorClasses"
  );
  const policyId = computeHash({
    format: H2A_ROLE_SCOPE_POLICY_FORMAT,
    actorLaunchName,
    scope,
    revision: input.revision
  });
  return {
    format: H2A_ROLE_SCOPE_POLICY_FORMAT,
    policyId,
    actorLaunchName,
    scope,
    governanceRoles: copyStringList(input.governanceRoles, "governanceRoles"),
    allowedCliKinds: copyStringList(input.allowedCliKinds, "allowedCliKinds"),
    allowedModels: copyStringList(input.allowedModels, "allowedModels"),
    ...(input.effortCeiling !== undefined ? { effortCeiling: input.effortCeiling } : {}),
    mcpRights: { tools: mcpTools, connectorClasses: mcpConnectorClasses },
    memoryScopes,
    driveConsentClass,
    signingClass: input.signingClass,
    validFrom,
    ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
    revision: input.revision,
    ...(input.supersedes !== undefined ? { supersedes: input.supersedes } : {}),
    signerInstance,
    signerKeyId
  };
}

export interface RoleScopePolicyRevocationInput {
  readonly actorLaunchName: string;
  readonly scope: string;
  readonly revokedRevision: number;
  readonly revokedAt: string;
  readonly reason: string;
  readonly signerInstance: string;
  readonly signerKeyId: string;
}

/** Deterministic builder for the unsigned revocation document. */
export function buildRoleScopePolicyRevocationV1(
  input: RoleScopePolicyRevocationInput
): UnsignedRoleScopePolicyRevocationV1 {
  const actorLaunchName = requireNonEmptyString(input.actorLaunchName, "actorLaunchName");
  const scope = requireNonEmptyString(input.scope, "scope");
  const revokedAt = requireNonEmptyString(input.revokedAt, "revokedAt");
  const reason = requireNonEmptyString(input.reason, "reason");
  const signerInstance = requireNonEmptyString(input.signerInstance, "signerInstance");
  const signerKeyId = requireNonEmptyString(input.signerKeyId, "signerKeyId");
  if (!Number.isInteger(input.revokedRevision) || input.revokedRevision < 1) {
    throw new Error("buildRoleScopePolicyRevocationV1: revokedRevision must be an integer >= 1");
  }
  return {
    format: H2A_ROLE_SCOPE_POLICY_REVOCATION_FORMAT,
    actorLaunchName,
    scope,
    revokedRevision: input.revokedRevision,
    revokedAt,
    reason,
    signerInstance,
    signerKeyId
  };
}

/** Options for the H1 signer: the mandated instance's key. */
export interface H2APolicySignOptions {
  readonly by: string;
  readonly privateKeyPem: string;
}

/**
 * Sign a policy: ed25519 over the canonical bytes of the document excluding
 * the `signature` field. The signer must be the document's own
 * `signerInstance` — a signature by anyone else is a mismatch, not a policy.
 */
export function signRoleScopePolicyV1(
  unsigned: UnsignedRoleScopePolicyV1,
  options: H2APolicySignOptions
): RoleScopePolicyV1 {
  if (options.by !== unsigned.signerInstance) {
    throw new Error(
      `signRoleScopePolicyV1: signer "${options.by}" does not match signerInstance "${unsigned.signerInstance}"`
    );
  }
  const signature = signCanonical(unsigned, options);
  return { ...unsigned, signature: signature.value };
}

/** Sign a revocation with the same rule as {@link signRoleScopePolicyV1}. */
export function signRoleScopePolicyRevocationV1(
  unsigned: UnsignedRoleScopePolicyRevocationV1,
  options: H2APolicySignOptions
): RoleScopePolicyRevocationV1 {
  if (options.by !== unsigned.signerInstance) {
    throw new Error(
      `signRoleScopePolicyRevocationV1: signer "${options.by}" does not match signerInstance "${unsigned.signerInstance}"`
    );
  }
  const signature = signCanonical(unsigned, options);
  return { ...unsigned, signature: signature.value };
}

const POLICY_V1_REQUIRED_FIELDS = [
  "format",
  "policyId",
  "actorLaunchName",
  "scope",
  "governanceRoles",
  "allowedCliKinds",
  "allowedModels",
  "mcpRights",
  "memoryScopes",
  "driveConsentClass",
  "signingClass",
  "validFrom",
  "revision",
  "signerInstance",
  "signerKeyId",
  "signature"
] as const;
const POLICY_V1_OPTIONAL_FIELDS = ["effortCeiling", "validUntil", "supersedes"] as const;
const REVOCATION_V1_REQUIRED_FIELDS = [
  "format",
  "actorLaunchName",
  "scope",
  "revokedRevision",
  "revokedAt",
  "reason",
  "signerInstance",
  "signerKeyId",
  "signature"
] as const;

function checkPolicyFieldSet(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[]
): { reason: H2APolicyRefusalReason; error: string } | undefined {
  const missing = required.filter((field) => !(field in value));
  if (missing.length > 0) {
    return { reason: "missing-field", error: `missing field(s): ${missing.join(", ")}` };
  }
  const unknown = Object.keys(value).filter(
    (field) => !required.includes(field) && !optional.includes(field)
  );
  if (unknown.length > 0) {
    return { reason: "unknown-field", error: `unknown field(s): ${unknown.join(", ")}` };
  }
  return undefined;
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry !== "");
}

function checkPolicyShape(
  value: Record<string, unknown>,
  kind: "policy" | "revocation"
): { reason: H2APolicyRefusalReason; error: string } | undefined {
  const nonEmpty = [
    "policyId",
    "actorLaunchName",
    "scope",
    "driveConsentClass",
    "validFrom",
    "validUntil",
    "supersedes",
    "effortCeiling",
    "revokedAt",
    "reason",
    "signerInstance",
    "signerKeyId",
    "signature"
  ];
  for (const field of nonEmpty) {
    if (field in value && (typeof value[field] !== "string" || (value[field] as string) === "")) {
      return { reason: "bad-field", error: `${field} must be a non-empty string` };
    }
  }
  if (kind === "policy") {
    for (const field of ["governanceRoles", "allowedCliKinds", "allowedModels", "memoryScopes"]) {
      if (!isStringList(value[field])) {
        return { reason: "bad-field", error: `${field} must be a list of non-empty strings` };
      }
    }
    const memoryScopes = value.memoryScopes as readonly string[];
    if (!memoryScopes.every((s) => s === "role" || s === "repo")) {
      return { reason: "bad-field", error: 'memoryScopes entries must be "role" or "repo"' };
    }
    const signingClass = value.signingClass;
    if (signingClass !== "D0" && signingClass !== "D1" && signingClass !== "D2") {
      return { reason: "bad-field", error: 'signingClass must be "D0", "D1" or "D2"' };
    }
    const rights = value.mcpRights;
    if (
      typeof rights !== "object" ||
      rights === null ||
      !isStringList((rights as Record<string, unknown>).tools) ||
      !isStringList((rights as Record<string, unknown>).connectorClasses)
    ) {
      return {
        reason: "bad-field",
        error: "mcpRights must carry tools and connectorClasses lists of non-empty strings"
      };
    }
  }
  const revisionField = kind === "policy" ? "revision" : "revokedRevision";
  const revision = value[revisionField];
  if (!Number.isInteger(revision) || (revision as number) < 1) {
    return { reason: "stale-revision", error: `${revisionField} must be an integer >= 1` };
  }
  return undefined;
}

function verifySignedPolicyLike(
  value: unknown,
  kind: "policy" | "revocation",
  expectedFormat: string,
  publicKeyPem: string
): H2APolicyVerification {
  if (typeof value !== "object" || value === null) {
    return { ok: false, reason: "not-an-object", error: "the document must be a JSON object" };
  }
  const record = value as Record<string, unknown>;
  if (record.format !== expectedFormat) {
    return {
      ok: false,
      reason: "unknown-version",
      error: `format must be "${expectedFormat}" (saw ${JSON.stringify(record.format)})`
    };
  }
  const fieldSet =
    kind === "policy"
      ? checkPolicyFieldSet(record, POLICY_V1_REQUIRED_FIELDS, POLICY_V1_OPTIONAL_FIELDS)
      : checkPolicyFieldSet(record, REVOCATION_V1_REQUIRED_FIELDS, []);
  if (fieldSet) {
    return { ok: false, ...fieldSet };
  }
  const shape = checkPolicyShape(record, kind);
  if (shape) {
    return { ok: false, ...shape };
  }
  const { signature, ...view } = record;
  const verified = verifyCanonical(
    view,
    { by: record.signerInstance as string, alg: "ed25519", value: signature as string },
    publicKeyPem
  );
  if (!verified) {
    return { ok: false, reason: "bad-signature", error: "the signature does not verify" };
  }
  return { ok: true };
}

/**
 * Total verifier for a signed {@link RoleScopePolicyV1}. Checks the wire shape
 * exactly (unknown fields and versions refuse), the revision floor and the
 * ed25519 signature over the canonical bytes excluding `signature`.
 */
export function verifyRoleScopePolicyV1(value: unknown, publicKeyPem: string): H2APolicyVerification {
  return verifySignedPolicyLike(value, "policy", H2A_ROLE_SCOPE_POLICY_FORMAT, publicKeyPem);
}

/** Total verifier for a signed {@link RoleScopePolicyRevocationV1}. */
export function verifyRoleScopePolicyRevocationV1(
  value: unknown,
  publicKeyPem: string
): H2APolicyVerification {
  return verifySignedPolicyLike(
    value,
    "revocation",
    H2A_ROLE_SCOPE_POLICY_REVOCATION_FORMAT,
    publicKeyPem
  );
}

/** Named outcomes of {@link isRoleScopePolicyRevoked}. */
export type H2APolicyRevocationReason =
  | "bad-policy"
  | "bad-revocation"
  | "wrong-policy"
  | "stale-revocation";

export interface H2APolicyRevocationCheck {
  readonly revoked: boolean;
  readonly reason?: H2APolicyRevocationReason;
}

/**
 * Whether a verified revocation document covers a verified policy: same
 * (actor, scope) key and `revokedRevision >= revision`. Anything else — a
 * policy or revocation that does not verify, a revocation for another key,
 * a revocation below the policy revision — leaves the policy standing, with
 * the named reason. Never widens a refusal into a revocation.
 */
export function isRoleScopePolicyRevoked(
  policy: unknown,
  revocation: unknown,
  publicKeyPem: string
): H2APolicyRevocationCheck {
  const policyCheck = verifyRoleScopePolicyV1(policy, publicKeyPem);
  if (!policyCheck.ok) {
    return { revoked: false, reason: "bad-policy" };
  }
  const revocationCheck = verifyRoleScopePolicyRevocationV1(revocation, publicKeyPem);
  if (!revocationCheck.ok) {
    return { revoked: false, reason: "bad-revocation" };
  }
  const p = policy as RoleScopePolicyV1;
  const r = revocation as RoleScopePolicyRevocationV1;
  if (r.actorLaunchName !== p.actorLaunchName || r.scope !== p.scope) {
    return { revoked: false, reason: "wrong-policy" };
  }
  if (r.revokedRevision < p.revision) {
    return { revoked: false, reason: "stale-revocation" };
  }
  return { revoked: true };
}

// ---------------------------------------------------------------------------
// H2A-ORG-H1 — the provision ratification gate. r2 §2.4: `h2a org provision`
// accepting any file that passes `validateOrgManifest` without checking
// ratification is a defect on the critical path; provisioning requires a
// verified `org-ratified` envelope signed by the owning PRINCIPAL. The check
// is mechanical — no approval step, screen or queue sits behind it (Q10).
// ---------------------------------------------------------------------------

/** Named refusals for the ratification gate. */
export type H2AOrgRatificationRefusal =
  | "not-an-envelope"
  | "wrong-kind"
  | "wrong-actor-role"
  | "invalid-manifest"
  | "manifest-mismatch"
  | "actor-not-declared-principal"
  | "signer-not-registered"
  | "bad-signature";

export type H2AOrgRatificationResult =
  | {
      readonly ok: true;
      readonly envelope: H2AEnvelope<H2AOrgAssignmentBody>;
      readonly actor: string;
    }
  | {
      readonly ok: false;
      readonly refusal: H2AOrgRatificationRefusal;
    };

/**
 * Total verifier of a ratified org envelope against the committed manifest:
 * (1) it is an h2a envelope whose body is an `org-ratified` assignment;
 * (2) its actor is a PRINCIPAL; (3) its manifest passes the org invariants and
 * is exactly the committed manifest (an unsigned or unratified edit of the
 * committed file creates no rights); (4) the ratifier is a declared PRINCIPAL
 * of that manifest; (5) the signature verifies against a registered key of
 * the ratifier. Pure — the caller gathers the registered keys.
 */
export function verifyOrgRatification(input: {
  readonly envelope: unknown;
  readonly committedManifest: H2AOrgManifest;
  readonly publicKeysFor: (instance: string) => readonly string[];
}): H2AOrgRatificationResult {
  const envelope = input.envelope;
  if (!isH2AEnvelope<H2AOrgAssignmentBody>(envelope)) {
    return { ok: false, refusal: "not-an-envelope" };
  }
  const body = envelope.body as Partial<H2AOrgAssignmentBody> | undefined;
  if (envelope.type !== "event" || body?.kind !== H2A_ORG_RATIFIED_BODY_KIND) {
    return { ok: false, refusal: "wrong-kind" };
  }
  if (envelope.actor.role !== "PRINCIPAL") {
    return { ok: false, refusal: "wrong-actor-role" };
  }
  const manifest = body.manifest;
  const structurallyOk =
    typeof manifest === "object" &&
    manifest !== null &&
    Array.isArray((manifest as H2AOrgManifest).instances) &&
    (manifest as H2AOrgManifest).instances.every(
      (inst) => typeof inst === "object" && inst !== null
    );
  if (!structurallyOk || !validateOrgManifest(manifest as H2AOrgManifest).ok) {
    return { ok: false, refusal: "invalid-manifest" };
  }
  if (canonicalize(manifest) !== canonicalize(input.committedManifest)) {
    return { ok: false, refusal: "manifest-mismatch" };
  }
  const declaredPrincipal = (manifest as H2AOrgManifest).instances.some(
    (inst) => inst.instance === envelope.actor.instance && inst.role === "PRINCIPAL"
  );
  if (!declaredPrincipal) {
    return { ok: false, refusal: "actor-not-declared-principal" };
  }
  const keys = input.publicKeysFor(envelope.actor.instance);
  if (keys.length === 0) {
    return { ok: false, refusal: "signer-not-registered" };
  }
  const verified = keys.some((pem) =>
    verifyEnvelopeSignature(envelope, pem, { by: envelope.actor.instance })
  );
  if (!verified) {
    return { ok: false, refusal: "bad-signature" };
  }
  return { ok: true, envelope, actor: envelope.actor.instance };
}
