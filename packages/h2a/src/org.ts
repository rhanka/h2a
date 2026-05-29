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

import { computeHash } from "./canonical.js";
import { createEnvelope } from "./envelope.js";
import { H2A_ROLES, type H2AEnvelope, type H2ARole } from "./types.js";

/** One instance's place in the org: its role + the scopes it sits in. */
export interface H2AOrgInstance {
  readonly instance: string;
  readonly role: H2ARole;
  readonly scopes: readonly string[];
  /** Rights the instance's mandate would carry (informational at this slice). */
  readonly mandateRights?: readonly string[];
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
  | "edge-unknown-instance";

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
 *    (`edge-unknown-instance`).
 */
export function validateOrgManifest(manifest: H2AOrgManifest): H2AOrgValidationResult {
  const errors = new Set<H2AOrgValidationError>();
  const validRoles = new Set<string>(H2A_ROLES);

  const seen = new Set<string>();
  const declared = new Set<string>();
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
