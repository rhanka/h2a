# nhi.md — review R3 (claude / opus 4.7)

_Run 2026-05-27, headless (`claude -p --model opus`), rubric from BACKLOG.md._

```
FINDINGS:
- [med] Compatibility hypothesis — lists NHI1 (offboarding) and NHI9 (reuse) among items h2a is "strong" on, but the table marks both "✅ partial"; this is an internal overclaim — reconcile (call them partial in the hypothesis too).
- [med] NHI7 row "✅ strong" — Gaps section says h2a stores no secrets and consumes externally-provisioned keys, so h2a offers rotation *primitives* but doesn't enforce TTL/cadence; downgrade to "strong mechanism, prevention depends on operator" or partial.
- [med] SP 800-207 claim — 800-207 discusses NPEs but does not formally declare NHI "unsolved at the spec level / an open challenge"; soften to "notes NPE authentication/audit as a concern."
- [med] Coverage legend inconsistent — mixes "✅ strong", "✅ partial", "~ by design", "~ partial", "~" with no key; add an explicit legend so ✅ vs ~ vs partial is unambiguous.
- [low] CSA wording — OWASP owns the Top 10; CSA endorsed it. "standardized by the Cloud Security Alliance" overstates; change to "endorsed by CSA" (the "standardizing" phrasing is CSA's blog title, not ownership).
- [low] Mermaid — node B label embeds `{instance,role,scope,rights}` inside `[...]`; braces can break Mermaid parsing. Wrap in quotes: `B["...{instance,role,scope,rights}..."]`. Also note the diagram shows only 5/10 risks (by design, but state it).
- [low] Vocabulary — lowercase "mandate" and "authority matrix" vs canonical MANDATE/AUTHORITY; "D_SAFE" is non-canonical. Normalize or define on first use.
- [low] References — confirm the OWASP `/2025/` URL subpath resolves; the ~100:1 ratio is vendor-dependent (cited figures range 10:1–100:1) — cite a source or soften.

VERDICT: accept-with-changes

(Note: per your instructions I did REVIEW ONLY and used no tools — OWASP NHI Top 10 item names all check out as accurate, and CSF 2.0's six functions including the new "govern" are correct; the flagged items are consistency/overclaim and sourcing refinements, not factual errors in the NHI list itself.)
```
