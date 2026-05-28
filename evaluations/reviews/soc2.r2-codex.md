# soc2.md — review r2-codex (2026-05-28)

- SOC 2 framed as certification/pass-fail · high · opening quote; “Certification common questions” · Replace “certification,” “passes,” and “pass” framing with “CPA attestation/examination” and “receives a SOC 2 report/opinion.”

- Service auditor role is mis-modeled · high · Common questions #5; Compatibility hypothesis · CPA service auditor should be external `CONTROL` only. The imposing party/framework/customer/regulator may be external `AUTHORITY`.

- h2a evidence is overclaimed · high · intro; Mapping “Report period”/“Operating-effectiveness evidence”; Common questions #2; Gaps; Compatibility · Say h2a records signed evidence/control events over the period. It does not itself prove technical operation/effectiveness; CPA testing supports the opinion.

- `CONTROL` wording blurs role vs system action · medium · Mapping “Trust Services Criteria”; Compatibility “signed POLICY + CONTROL” · Use “`POLICY` clauses audited by external/internal `CONTROL`; h2a records the audit,” not “h2a audits” or “signed CONTROL.”

- Confidentiality/Privacy fit is overstated · medium · Mapping “Confidentiality / Privacy”; Common questions #3; Compatibility · Controlled disclosure supports evidence sharing and can evidence related controls, but it does not directly satisfy Privacy/Confidentiality TSC. Mark as `~`, not `✅`.

- Mermaid edge is semantically and syntactically risky · low · `EVID -. "is the journal over PER" .-> H` · Use `EVID -.->|"journal records evidence over PER"| H`; avoids parser fragility and removes the “evidence is the journal” overclaim.

revise
