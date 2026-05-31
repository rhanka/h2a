import {
  H2A_ARTIFACT_KINDS,
  H2A_ROLES,
  type H2AArtifactKind,
  type H2ARole
} from "./types.js";

export const H2A_ATTESTER_COMPREHENSION_RIGHT = "attester-comprehension" as const;

export type H2AAuthorityMatrixKind =
  | H2AArtifactKind
  | typeof H2A_ATTESTER_COMPREHENSION_RIGHT;

/**
 * V1 signing authority matrix (DEC-035).
 *
 * Maps each canonical {@link H2AArtifactKind} to the set of roles allowed
 * to produce a binding signature on that artifact kind. This is the
 * executable counterpart of DEC-004 (governance) and DEC-018/DEC-023
 * (CONTRACT vs ENFORCEMENT_PLAN ownership).
 *
 * `MANDATAIRE` deliberately appears only for `SIGNATURE` — DEC-005 and
 * DEC-024 keep the mandataire as a *presenter* of decisions, not a binder.
 * The `SIGNATURE` row admits every role because that kind is the audit
 * trace of a signing act produced by whoever signed.
 */
export const H2A_AUTHORITY_MATRIX: Readonly<
  Record<H2AAuthorityMatrixKind, { roles: readonly H2ARole[]; notes?: string }>
> = Object.freeze({
  CONTRACT: {
    roles: Object.freeze(["PRINCIPAL", "EXECUTIF", "CONDUCTOR"]) as readonly H2ARole[],
    notes:
      "CONTRACT is the binding normative container; PRINCIPAL/EXECUTIF/CONDUCTOR are the only signers (DEC-018)."
  },
  POLICY: {
    roles: Object.freeze(["PRINCIPAL", "EXECUTIF", "CONTROL"]) as readonly H2ARole[],
    notes:
      "POLICY is adopted by PRINCIPAL/EXECUTIF or imposed by CONTROL (DEC-016, DEC-023)."
  },
  ENGAGEMENT: {
    roles: Object.freeze(["PRINCIPAL", "EXECUTIF", "CONDUCTOR"]) as readonly H2ARole[],
    notes:
      "ENGAGEMENT charter signing follows the contract chain — PRINCIPAL/EXECUTIF/CONDUCTOR (DEC-003)."
  },
  AMENDMENT: {
    roles: Object.freeze([
      "PRINCIPAL",
      "EXECUTIF",
      "CONDUCTOR",
      "CONTROL"
    ]) as readonly H2ARole[],
    notes:
      "Amendments can come from the contract chain (PRINCIPAL/EXECUTIF/CONDUCTOR) or be imposed by CONTROL (DEC-004)."
  },
  MANDATE: {
    roles: Object.freeze(["PRINCIPAL", "EXECUTIF"]) as readonly H2ARole[],
    notes:
      "Mandates are issued by the executive function (PRINCIPAL or EXECUTIF) — DEC-021."
  },
  AUTHORITY: {
    roles: Object.freeze(["PRINCIPAL", "EXECUTIF"]) as readonly H2ARole[],
    notes:
      "Authority records (instance/quorum) are constituted by the executive function (DEC-021)."
  },
  SIGNATURE: {
    roles: Object.freeze([...H2A_ROLES]) as readonly H2ARole[],
    notes:
      "SIGNATURE is the audit trace of a signing act and is admissible from any role that can sign anything."
  },
  ENFORCEMENT_PLAN: {
    roles: Object.freeze(["PRINCIPAL", "EXECUTIF", "CONTROL"]) as readonly H2ARole[],
    notes:
      "Enforcement plans are produced by CONTROL under PRINCIPAL/EXECUTIF authority (DEC-023)."
  },
  [H2A_ATTESTER_COMPREHENSION_RIGHT]: {
    roles: Object.freeze(["PRINCIPAL", "EXECUTIF", "MANDATAIRE", "AGENTS"]) as readonly H2ARole[],
    notes:
      "Comprehension attestations are non-binding: PRINCIPAL/EXECUTIF/MANDATAIRE attest natively, while AGENTS require the attester-comprehension mandate right."
  }
});

// Sanity check: every canonical kind has an entry. Catches future drift if
// H2A_ARTIFACT_KINDS grows but the matrix is not updated in lockstep.
for (const kind of H2A_ARTIFACT_KINDS) {
  if (!(kind in H2A_AUTHORITY_MATRIX)) {
    throw new Error(`H2A_AUTHORITY_MATRIX is missing an entry for kind ${kind}`);
  }
}

export function canSignArtifactKind(role: H2ARole, kind: H2AArtifactKind): boolean {
  const entry = H2A_AUTHORITY_MATRIX[kind];
  if (!entry) return false;
  return entry.roles.includes(role);
}

export function assertCanSignArtifactKind(role: H2ARole, kind: H2AArtifactKind): void {
  if (!canSignArtifactKind(role, kind)) {
    const allowed = H2A_AUTHORITY_MATRIX[kind]?.roles ?? [];
    throw new Error(
      `H2A authority: role ${role} is not allowed to sign artifact kind ${kind} (allowed: [${allowed.join(",")}])`
    );
  }
}
