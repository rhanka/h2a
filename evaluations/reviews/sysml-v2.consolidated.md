# sysml-v2.md — review (1/3, partial)

> 2026-05-28. Only **R1 (agy)** completed (`accept-with-changes`); **R2 (codex) exited 1** and R3 (claude) deferred — review CLIs flaky. (agy also wrote a stray revised copy to its own scratch — ignored.) Complementary eval; findings verified vs source.

## Applied (valid)
- **Cross-reference the shipped S1-S4 interop** (agy, high): §3 now carries a "specified & shipped" status note pointing at `docs/sysml-interop.md` (DEC-081) and the implemented modules — `H2ASysmlRef` (S1/DEC-097), resolve/hash (S2/DEC-098), `verifyEnvelopeSysmlRef`+`h2a sysml verify` (S3/DEC-099), `sysmlQueryScope` (S4/DEC-100) — and maps the §3 "Gaps/open" onto how S1-S4 address them (content verification, identity↔auth, granularity, branch/merge out of V1).
- **Mermaid label quoting** (agy, med): quoted the `V&V` node label (`&` is risky unquoted in a Mermaid node label).

## Deferred (low value / speculative)
- Adding SysML mappings for AMENDMENT/SUBAGENTS/veto/recourse/mandate.rights, and splitting the party/obligation/rights row — speculative metamodel additions on a mature complementary eval; deferred. (No false positives to reject this round; the rubric pre-cleared the canonical terms.)
