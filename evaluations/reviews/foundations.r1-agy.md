# foundations (VOCABULARY.md + SPEC.md) — review r1-agy (2026-05-28)

- Decision Reference Drift · Minor · `VOCABULARY.md` §1.3.bis · Change `DEC-008` in the heading of §1.3.bis to `DEC-068` to resolve the mismatch with the status header.
- Scope-Engagement Conflation · Major · `VOCABULARY.md` §2 & §5 · Remove `engagement` from the list of example scopes in the definition of `SCOPE` in §2 to align with the explicit separations in §5 and `SPEC.md` REQ-061.
- Missing Glossary Definitions · Medium · `VOCABULARY.md` §2 · Add formal definitions for core canonical substrate concepts (`ENGAGEMENT`, `SIGNATURE`, `AMENDMENT`, `ENFORCEMENT_PLAN`) to the substrate definitions list in §2.
- PRINCIPAL/EXECUTIF Naming Confusion · Minor · `VOCABULARY.md` §1.1 · Remove `executive` from the synonyms considered for `PRINCIPAL` to avoid confusion with the separate, distinct `EXECUTIF` role defined in §1.2.bis.
- MANDATAIRE Neutrality Contradiction · Minor · `VOCABULARY.md` §1.5 · Remove `arbiter` from the synonyms considered for `MANDATAIRE` to resolve the contradiction with its core non-arbitration rule in §1.5 and `SPEC.md` REQ-069.
- CONTROL Interaction Discrepancy · Medium · `VOCABULARY.md` §3 · Add a dotted/conditional connector between `CONTROL` and `AGENTS` in the default flow diagram to match the lateral flow text ("CONTROL ↔ any actor") and align with §6 Open Question 3.
- Contractual Stack Narrative Gap · Medium · `VOCABULARY.md` §7.5 · Add a narrative subsection defining the `[ACTIONS + JOURNALS + EVIDENCE]` layer, or align the diagram block names directly with the text divisions (§7.1 to §7.4).
- Sister Repo and Branch Leakage · Major · `SPEC.md` REQ-019 · Remove the relative path `../sentropic/` and git branches `br23`/`br25` from the specification text, replacing them with a purely functional description of the harness integration interface.
- Source Code Path Leakage · Medium · `SPEC.md` REQ-059 · Remove the specific file layout path `src/{project}/h2a/...` from the requirement, defining only the abstract requirements for the offline local-files transport behavior.
- Pluralization Role Drift · Medium · `VOCABULARY.md` §1.3 & `SPEC.md` REQ-013/REQ-014 · Standardize the canonical role name as `AGENT` (singular) to align with standard role schemas (e.g. `{instance, role, scope}`) and standard singular requirement text, using plural forms only in descriptive contexts.

accept-with-changes
