# foundations (VOCABULARY.md + SPEC.md) — review (1/3, note-only)

> 2026-05-28. Only **R1 (agy)** completed (`accept-with-changes`); R2 (codex) exited 1, R3 (claude) deferred. **These are FROZEN docs** — per the review rules, nothing was modified; every finding was checked against source and is recorded here for the maintainer. The review **confirms the foundations are internally coherent**; the "findings" are mostly reviewer-context gaps (the reviewer lacks the DEC log / `@sentropic/h2a` types).

## Rejected — false positives (verified vs source)
- **"Standardize role to `AGENT` (singular)"** — `H2A_ROLES` is `["PRINCIPAL","EXECUTIF","CONDUCTOR","AGENTS","CONTROL","MANDATAIRE"]` (`packages/h2a/src/types.ts`): the canonical role **is `AGENTS` (plural)**. The doc is correct.
- **"Remove `engagement` from SCOPE examples (§2) — scope/engagement conflation"** — `engagement` is listed as a *domain of application* (a scope), which is consistent with "an `ENGAGEMENT` *has* a scope" (the engagement scope). No conflation.
- **"`../sentropic/` + br23/br25 leak in SPEC REQ-019"** — this is intentional project context (the sister-repo/harness integration the user themselves references for EVO-4 build-location). Not a leak.

## Noted only (NOT changed — frozen docs)
- **DEC ref in §1.3.bis SUBAGENTS = `DEC-008`** (agy: should be DEC-068). §1.3 AGENTS also cites DEC-008 — DEC-008 is plausibly the *vocabulary-introduction* decision (where AGENTS + the SUBAGENTS reservation were defined), while DEC-068 is the subagent *implementation*. Not a proven error → left as-is; **maintainer to confirm** against the DEC log whether §1.3.bis should additionally cite DEC-068.
- Glossary completeness (add ENGAGEMENT/SIGNATURE/AMENDMENT/ENFORCEMENT_PLAN to the §2 substrate list), CONTROL↔AGENTS diagram connector, §7.5 contractual-stack narrative, "executive"/"arbiter" synonyms-considered — all stylistic/structural suggestions on a frozen doc; recorded for a future foundations revision, **not applied** here.
- `src/{project}/h2a/...` path in SPEC REQ-059 — concrete local-files layout; left as-is (matches the shipped store).

**Verdict applied**: foundations confirmed coherent; no edits to the frozen docs this pass. R2/R3 to recomplete when the review CLIs are reliable.
