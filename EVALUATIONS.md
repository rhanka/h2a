# Compatibility evaluations — organizational models

> **Moved**: this document was split into a use-case library (one file per model, with a Mermaid diagram) on 2026-05-25, and translated to English on 2026-05-26.
>
> → **[`evaluations/`](./evaluations/README.md)**: index, common grid, Q9 CONTRACT/POLICY/ENGAGEMENT, counter-audit, cross-cutting synthesis.

## Use-cases

| # | Use-case | Topology | File |
|---|---|---|---|
| A | Traditional enterprise | hierarchy | [evaluations/a-enterprise.md](./evaluations/a-enterprise.md) |
| B | Multi-organization ecosystem | peer federation | [evaluations/b-ecosystem.md](./evaluations/b-ecosystem.md) |
| C | Government / citizen | public authority | [evaluations/c-government-citizen.md](./evaluations/c-government-citizen.md) |
| D | 1 PRINCIPAL / 15 CONDUCTORS (no mediator) | star, no mediator | [evaluations/d-principal-15-conductors.md](./evaluations/d-principal-15-conductors.md) |
| E | Agentic-delivery squad (contracted roles) | agile train + squads | [evaluations/e-agentic-squad.md](./evaluations/e-agentic-squad.md) |

Machine-readable source of the A/B/C mapping: `H2A_ABC_MODEL_PROFILES` + `auditAbcModelCompatibility` (`packages/h2a/src/abc.ts`, DEC-041).
