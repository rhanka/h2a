# Evaluation axis — `confiance` (trust model)

This axis evaluates the **EVO-9 trust model** (`VALEUR`, `ATTENTION`, `INTÉRÊT`, `MUTUALISATION`, `CONFIANCE`; framing in `docs/superpowers/specs/2026-05-30-evo9-trust-concepts-framing.md`) against real-world evidence, so the model is **calibrated, not invented**.

Why `confiance` and not `interest`: CONFIANCE is the umbrella concept (it unifies ATTENTION + INTÉRÊT and is the differentiator vs `iii`). Conflict-of-interest is one facet of it, so its case material lives **inside** this axis rather than as a separate `interest/` axis. (If the PRINCIPAL prefers the narrower `interest`, it is a one-word rename.)

## Contents

- [`conflict-of-interest-cases.md`](./conflict-of-interest-cases.md) — documented, public corruption / conflict-of-interest cases analysed against the EVO-9 INTÉRÊT mechanism (the 3-criterion disclosure trigger + proportional disclosure). Grounds the detection + attention-ranking on what *actually* breaks trust.

## How this axis is used

Each case is analysed under a fixed template (below) and the model's would-be behaviour is recorded: does the disclosure trigger fire? at which criterion? what proportional disclosure mode? what does it teach about thresholds and attention-ranking? The findings calibrate the `INTÉRÊT`/`CONFIANCE` spec before and during implementation — the same way `evaluations/nhi.md` grounded the NHI work against the OWASP NHI Top 10.

## Note on evaluations reorganisation

The PRINCIPAL asked to organise `evaluations/` **by axis** (sub-directories). This `confiance/` folder is the first axis-folder. Proposed mapping for the existing flat files (to be confirmed before moving, since `BACKLOG.md` + `reviews/` cross-reference them):

- `scenarios/` ← `a-enterprise.md`, `b-ecosystem.md`, `c-government-citizen.md`, `d-principal-15-conductors.md`, `e-agentic-squad.md`
- `standards/` ← `nhi.md`, `nhi-landscape.md`, `sysml-v2.md`
- `confiance/` ← (this axis, new)
- `BACKLOG.md`, `reviews/` stay at the root of `evaluations/`.
