# a-enterprise.md — review r1-agy (2026-05-28)

Here is the expert review of the `evaluations/a-enterprise.md` document mapped against the h2a protocol evaluation rubrics:

### Findings

* **Non-Canonical Vocabulary** · **High** · `evaluations/a-enterprise.md` (Diagram labels, Mapping Table, Contracts vs policies, and 15-CONDUCTORS section) · Replace non-canonical terms like `PARTY`, `RIGHTS`, `BINDING`, and `OBLIGATION`/`OBLIGATIONS` with canonical equivalents. For example, represent Investors/Shareholders as roles (like `PRINCIPAL`), map `RIGHTS` to `AUTHORITY` or `MANDATE` parameters, replace `BINDING` with a `CONTRACT`/`POLICY` rule, and map taxes to recurring `ENGAGEMENT`s.
* **Control Role Veto Power** · **High** · `evaluations/a-enterprise.md` (Diagram `CTRL` node and Mapping Table `Internal CONTROL` row) · Remove "veto" from `CONTROL`'s listed functions. To satisfy the invariant that *CONTROL only audits*, all operational actions or interventions must be routed as audit failures and escalated to the competent `PRINCIPAL` or `EXECUTIF` to execute.
* **Missing Profile ID & Delta** · **High** · `evaluations/a-enterprise.md` (Compatibility hypothesis section) · Provide the nearest built-in profile ID (e.g., `profile:corp-hierarchy`) and outline the exact architectural delta needed to support this use-case instead of a high-level description.
* **Scope Signing Contracts** · **Medium** · `evaluations/a-enterprise.md` (Diagram `SUP`/`CLI` nodes, Mapping Table) · Correct the invariant violation where scopes (`SUP`/`CLI` external mini-orgs) are signing `CONTRACT`s. Introduce corresponding external `PRINCIPAL` roles representing those scopes to sign the agreements.
* **Missing Global Principal** · **Medium** · `evaluations/a-enterprise.md` (Diagram and Mapping Table) · Introduce a root `PRINCIPAL` role (such as the Board or Shareholders collectively) to own the umbrella enterprise scope. Under h2a invariants, anything owned needs a `PRINCIPAL` (the `EXECUTIF` role governs but does not own the scope).
* **Incomplete Grid Coverage** · **Medium** · `evaluations/a-enterprise.md` (Mapping and Contracts sections) · Expand the mapping to cover missing elements of the 10-question grid, specifically addressing **Deadlocks** (resolution mechanisms), **Escalations** (concrete routing paths and escalation targets), and **Authority** delegation flows.
* **Topology Mismatch** · **Medium** · `evaluations/a-enterprise.md` (Topology header and Compatibility hypothesis) · Adjust the declared topology from a pure `hierarchy` to a `hybrid` or `federated mesh` to properly reflect the independent peer-to-peer relationships with external suppliers/clients and regulators.
* **Improper Policy Granularity** · **Low** · `evaluations/a-enterprise.md` (Contracts vs policies) · Reclassify specific individual employment constraints (e.g., employee confidentiality, working hours) as clauses inside the `CONTRACT` rather than separate `POLICY` artifacts, reserving `POLICY` for cross-cutting, organization-wide rules.

revise
