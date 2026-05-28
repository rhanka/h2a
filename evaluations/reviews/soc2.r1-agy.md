# soc2.md — review r1-agy (2026-05-28)

### Expert Review Findings

* **Service Auditor Misclassified as AUTHORITY** · **High** · Where h2a sits (Mermaid), Mapping table, Certification common questions #5, Compatibility hypothesis · The CPA/service auditor is incorrectly modeled as an external `AUTHORITY` or `AUTHORITY/CONTROL`. The invariant dictates: *"a certification/service auditor is an external CONTROL that audits (the imposing party is an external AUTHORITY)"*. Model the CPA strictly as an external `CONTROL` role, and the AICPA (or Trust Services Criteria framework itself) as the external `AUTHORITY` that imposes the `POLICY`. Update the nearest profile delta to `A_ENTERPRISE` + external `CONTROL` (CPA) + external `AUTHORITY` (AICPA).
* **SOC 2 Framed as Certification & Pass-Fail** · **Medium** · Subtitle, Certification common questions (heading + Q1/Q4), Compatibility hypothesis · SOC 2 is described as a "certification" that a service organization "passes". SOC 2 is an attestation/examination by a CPA that results in a professional opinion report, not a pass/fail certification. Replace all instances of "certification" with "attestation" or "examination". Replace "passes a SOC 2 examination" with "obtains an unmodified opinion". Rename the FAQ heading to "Attestation/Examination common questions".
* **ENGAGEMENT Lacks Explicit Scope** · **Medium** · Mapping table, Contracts vs policies section, Compatibility hypothesis · The invariant *"ENGAGEMENT has a scope"* is not explicitly addressed. Redefine `ENGAGEMENT` to specify that it must be bound to a defined system/organizational scope (the system boundaries of the SOC 2 description of the system under examination).
* **Omission of Recourse Mechanism** · **Low** · Mapping table, Contracts vs policies section · The canonical `recourse` mechanism is omitted despite its high relevance for handling control failures, exceptions, or Complementary User Entity Control (CUEC) non-compliance. Explicitly incorporate `recourse` into the `ENFORCEMENT_PLAN` or `CONTRACT` to define the escalation path for exceptions.

***

### Summary of Work
I performed a comprehensive review of the `evaluations/soc2.md` document against vocabulary fidelity, invariant compliance, SOC 2/AICPA standards, gap honesty, Mermaid syntax, and compatibility profiles. The primary findings indicate a high-severity violation of the auditor invariant (modeling the service auditor as an `AUTHORITY` instead of an external `CONTROL` who reports to an external `AUTHORITY`) and a medium-severity framing issue (representing the SOC 2 attestation as a pass/fail certification).

revise
