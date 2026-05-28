# smart-contract.md — review r1-agy (2026-05-28)

Here is the review of the `evaluations/smart-contract.md` draft against the evaluation rubric:

### Findings

* **Scope bound to signature** · **severity:** High · **location:** Concept mapping table, row 3 (`SIGNATURE` + `MANDATE` relationship column) · **suggested fix:** Rephrase to clarify that a signature binds an actor acting under a `MANDATE` within a given scope; a scope is passive and never signs itself.
* **`MANDATAIRE` grouped into recourse/judgment layer** · **severity:** High · **location:** Concept mapping table, row 7 & "What stays off-chain (by design)", bullet 3 · **suggested fix:** Explicitly decouple `MANDATAIRE` from recourse/judgment, clarifying that recourse is handled by the `PRINCIPAL`/`EXECUTIF` layers and that a `MANDATAIRE` is an executing representative who never judges.
* **Vague auditing and lack of ownership mapping** · **severity:** Medium · **location:** Concept mapping table, row 4 (`ENFORCEMENT_PLAN` relationship column) · **suggested fix:** Clarify that the `ENFORCEMENT_PLAN` is audited exclusively by the `CONTROL` role, and that the executable on-chain contract (which may control assets/value) must map back to a governing `PRINCIPAL` who owns it.
* **Potential vocabulary inflation via custom reference types** · **severity:** Medium · **location:** "Interop — referencing an on-chain artifact" (`H2AChainRef`) & "References" (`H2ASysmlRef`) · **suggested fix:** Explicitly define these structures as external payload schemas stored within the standard `subject` field of a canonical `CONTRACT` or `ENGAGEMENT` envelope, rather than presenting them as new first-class h2a protocol artifacts.

revise
