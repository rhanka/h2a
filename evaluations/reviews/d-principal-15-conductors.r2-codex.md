# d-principal-15-conductors.md — review r2-codex (2026-05-28)

Missing CONTROL veto semantics · major · Diagram, Mapping “Audit”, Proposed V1 rules · Add CONTROL as the auditor/veto actor; POLICY may define blocking criteria, but CONTROL audits and may veto.

ABC hypothesis is incorrect · major · “ABC compatibility” · State this has no dedicated `abc.ts` profile; it is a variant of `A_ENTERPRISE` star/no-mediator, with deltas: 15 CONDUCTORS, peer negotiation ledgers, aggregated PRINCIPAL escalations.

Topology is visually ambiguous · major · Mermaid peer-to-peer links / “up to 105 links” · Separate authority topology from negotiation links: PRINCIPAL star is the control topology; conductor links are subject ledgers, not a mediator or mesh authority.

Missing scope/ownership invariants · major · Proposed V1 rules · Add: scope never signs; every ENGAGEMENT has a scope; owned scope/artifact requires a PRINCIPAL; escalation goes to the competent AUTHORITY for the affected scope, not always raw root PRINCIPAL.

MANDATAIRE invariant absent · major · Whole document · Add that a MANDATAIRE may represent/execute within AUTHORITY/MANDATE but never judges, audits, or vetoes.

Canonical artifact coverage incomplete · minor · Mapping / Proposed V1 rules · Promote `AMENDMENT` to canonical artifact, mention recourse, and add AUTHORITY explicitly as the source constraining MANDATE/SIGNATURE.

`mandate.rights` risks confusing protocol powers with party rights · minor · Proposed V1 rules · Rename to `mandate.authorizations` or clarify these are procedural authorizations; CONTRACT/ENGAGEMENT parties, obligations, and rights remain artifact content.

accept-with-changes
