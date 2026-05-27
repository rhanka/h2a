# nhi.md — review R2 (codex / gpt-5.5)

_Run 2026-05-27, headless (`codex exec`), rubric from BACKLOG.md._

```
FINDINGS:
[high] Standards landscape — SP 800-207 likely does not use “NHI” nor list “AI agents/API keys/OAuth apps”; “explicitly flags NPE/NHI as an open challenge” overstates — say it discusses NPEs in ZTA and leaves NPE governance as an implementation challenge.
[med] NHI4/NHI5/NHI7 coverage — “strong” overclaims for a coordination protocol because key custody, IAM binding, policy enforcement, and rotation completion are external — downgrade to partial/strong-with-assumptions.
[med] NHI6 row — “Insecure Cloud Deployment Config” coverage from K8s/loopback defaults is narrow and renderer-specific — mark partial and explicitly not cloud posture management.
[med] NHI9 row — “discourage shared/reused NHIs” is not prevention or detection of reuse outside h2a — keep partial and state h2a only gives distinct protocol identities.
[low] Vocabulary fidelity — uses non-canonical “subagent”, “registry”, “journal”, “keyring”, “authority matrix”, “contracted-role model” — replace with canonical h2a terms or define as non-artifact mechanisms.
[low] Diagram — Mermaid is syntactically plausible, but node labels use non-canonical mechanism names and omit NHI2/3/6/9/10 — align labels with MANDATE/AUTHORITY/SIGNATURE/ENFORCEMENT_PLAN or label as illustrative.
[low] References — OWASP/CSA reference is plausible, CSF 2.0 functions are correct, but “relayed/standardized by CSA” is imprecise — describe CSA as introducing/endorsing, not standardizing.
[low] Compatibility hypothesis — “identity governance layer” may imply IAM/inventory ownership — qualify as protocol-level coordination/provenance layer within an NHI program.

VERDICT: accept-with-changes
```
