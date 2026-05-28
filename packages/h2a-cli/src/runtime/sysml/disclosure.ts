/**
 * DEC-100 — SysML v2 interop S4 (spec §5, DEC-081). Map an h2a disclosure mode
 * (DEC-045) onto a SysML v2 **query scope**: what a CONTROL / recipient may read
 * through the API, expressed abstractly (the concrete API params / SysML `view`
 * id are repo-specific — this is the policy→scope decision, not the wire call).
 *
 * Pure + total over the six disclosure modes.
 */

import type { H2ADisclosureMode } from "@sentropic/h2a";

/** How much of the referenced element the recipient may read. */
export type H2ASysmlQueryDetail = "none" | "attestation" | "metadata" | "redacted" | "full";

export interface H2ASysmlQueryScope {
  readonly mode: H2ADisclosureMode;
  /** Whether the adapter should fetch element content at all. */
  readonly fetch: boolean;
  readonly detail: H2ASysmlQueryDetail;
  /** Suggested SysML view id (viewpoint/view mechanism) when a filtered query applies. */
  readonly view?: string;
  readonly note: string;
}

const SCOPES: Record<H2ADisclosureMode, H2ASysmlQueryScope> = {
  denied: {
    mode: "denied",
    fetch: false,
    detail: "none",
    note: "no access — the recipient may not query the model"
  },
  "hash-only": {
    mode: "hash-only",
    fetch: false,
    detail: "none",
    note: "compare the embedded elementHash only; no content query"
  },
  attestation: {
    mode: "attestation",
    fetch: false,
    detail: "attestation",
    note: "the signed envelope (with elementHash) is the attestation; no content query"
  },
  "evidence-package": {
    mode: "evidence-package",
    fetch: true,
    detail: "metadata",
    note: "fetch element metadata + hash for an evidence package (not full content)"
  },
  "redacted-view": {
    mode: "redacted-view",
    fetch: true,
    detail: "redacted",
    view: "redacted",
    note: "query a SysML redacted view (sensitive members excluded)"
  },
  "full-view": {
    mode: "full-view",
    fetch: true,
    detail: "full",
    view: "full",
    note: "query the full element"
  }
};

/** Total: every disclosure mode maps to a query scope. */
export function sysmlQueryScope(mode: H2ADisclosureMode): H2ASysmlQueryScope {
  return SCOPES[mode];
}
