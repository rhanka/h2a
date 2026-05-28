/**
 * DEC-097 — SysML v2 interop, slice S1 (spec: docs/sysml-interop.md, DEC-081).
 * The pure model reference: `H2ASysmlRef` pins a SysML v2 element at an
 * immutable commit. Embedded in an ENGAGEMENT/CONTRACT body it is ordinary
 * signed content (DEC-035/073) — signing the envelope pins the model state
 * *"I commit to {project, commit, element}"* without h2a moving any bytes.
 *
 * Pure + total: no I/O. The fetch/re-hash/verify adapter is S2 (cli runtime);
 * here are only the type, a total validator, a type guard, and equality.
 */

export const H2A_SYSML_REF_KIND = "sysmlv2";

export interface H2ASysmlRef {
  readonly kind: typeof H2A_SYSML_REF_KIND;
  /** Repository base URL (omit if implied by context). */
  readonly apiBase?: string;
  /** Project id. */
  readonly project: string;
  /** Immutable Commit id — freezes the state. */
  readonly commit: string;
  /** Optional Element id (omit = whole project at commit). */
  readonly element?: string;
  /** Optional canonical hash of the element (content integrity, §4). */
  readonly elementHash?: string;
}

export type H2ASysmlRefValidationError =
  | "kind-not-sysmlv2"
  | "project-missing"
  | "commit-missing"
  | "apiBase-empty"
  | "element-empty"
  | "elementHash-empty";

export interface H2ASysmlRefValidation {
  readonly ok: boolean;
  readonly errors: readonly H2ASysmlRefValidationError[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Total validation of a ref: required `kind`/`project`/`commit`; optional
 * `apiBase`/`element`/`elementHash` must be non-empty strings when present.
 */
export function validateSysmlRef(ref: H2ASysmlRef): H2ASysmlRefValidation {
  const errors: H2ASysmlRefValidationError[] = [];
  if (ref.kind !== H2A_SYSML_REF_KIND) errors.push("kind-not-sysmlv2");
  if (!isNonEmptyString(ref.project)) errors.push("project-missing");
  if (!isNonEmptyString(ref.commit)) errors.push("commit-missing");
  if (ref.apiBase !== undefined && !isNonEmptyString(ref.apiBase)) errors.push("apiBase-empty");
  if (ref.element !== undefined && !isNonEmptyString(ref.element)) errors.push("element-empty");
  if (ref.elementHash !== undefined && !isNonEmptyString(ref.elementHash)) {
    errors.push("elementHash-empty");
  }
  return { ok: errors.length === 0, errors };
}

/** Type guard for untyped input (e.g. a ref pulled from an envelope body). */
export function isH2ASysmlRef(value: unknown): value is H2ASysmlRef {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    r.kind === H2A_SYSML_REF_KIND &&
    isNonEmptyString(r.project) &&
    isNonEmptyString(r.commit) &&
    (r.apiBase === undefined || typeof r.apiBase === "string") &&
    (r.element === undefined || typeof r.element === "string") &&
    (r.elementHash === undefined || typeof r.elementHash === "string")
  );
}

/**
 * Strict structural equality over all fields (incl. `apiBase` and
 * `elementHash`). Two refs to the same {project, commit, element} on different
 * mirrors, or with/without a content hash, are deliberately **not** equal —
 * see the reversible decision in docs/loop-decisions.md (a looser
 * `sameModelState` predicate can be added later if needed).
 */
export function sysmlRefEquals(a: H2ASysmlRef, b: H2ASysmlRef): boolean {
  return (
    a.kind === b.kind &&
    a.project === b.project &&
    a.commit === b.commit &&
    a.apiBase === b.apiBase &&
    a.element === b.element &&
    a.elementHash === b.elementHash
  );
}
