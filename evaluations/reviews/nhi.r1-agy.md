# nhi.md — review R1 (agy / Antigravity, Gemini 3.5 High)

_Run 2026-05-27, headless (`agy -p`), rubric from BACKLOG.md._

```
FINDINGS:
[high] Vocabulary — Use of non-canonical terms like "subagent", lowercase "mandate", "contracted-role", and "authority matrix" — Replace with canonical roles (`AGENTS`) and uppercase artifacts (`MANDATE`, `CONTRACT`, `AUTHORITY`, `SIGNATURE`).
[med] Table (NHI6 / NHI8) — Overclaiming K8s tenant and localhost binding as protocol features rather than reference implementation features — Clarify these as reference implementation specifics or bind them to the `ENFORCEMENT_PLAN` or `POLICY` artifacts.
[low] Mermaid Diagram — Node B contains unquoted curly braces `{}` and subset symbol `⊆` which can cause parser errors in some renderers — Wrap the label for node B in double quotes: `B["mandate {instance,role,scope,rights}<br/>+ AGENTS caps ⊆ parent"]`.
[low] References — The OWASP project URL has a trailing "/2025/" that may result in a 404 error — Change to canonical URL `https://owasp.org/www-project-non-human-identities-top-10/`.

VERDICT: accept-with-changes
```
