# d-principal-15-conductors.md — consolidated review (2/3)

> 2026-05-28 — R1 agy (`revise`), R2 codex (`accept-with-changes`). R3 (claude) deferred. Mature eval; findings verified vs source.

## Applied (valid)
- **No dedicated profile → variant of A_ENTERPRISE + delta** (both): added an explicit statement (no own abc.ts profile; star/no-mediator variant of A_ENTERPRISE; deltas = 15 conductors, peer negotiation ledgers ≠ mesh authority, aggregated PRINCIPAL escalations) — also resolves the topology-ambiguity finding (star = authority; C↔C = negotiation) in the same edit.

## Rejected (false-positive — verified vs source)
- "Invented rights / rename `mandate.rights` to authorizations" (agy, codex) — **`H2AMandate.rights: string[]` IS the canonical field** (`packages/h2a/src/types.ts`); `negotiate/propose/accept/sign/escalate/audit` are legitimate rights values. **Kept.**
- "MANDATAIRE role/invariant missing" (agy, codex) — this case is explicitly **no-mediator**; a MANDATAIRE is not applicable here. **Not added.**
- "Disconnected EP node / connect conductors to EP" (agy) — EP **is** connected (`EP -.-> P`); the rest is a stylistic preference. **No change.**
- Restating scope/ownership/scope-never-signs invariants in a use-case doc — optional; the README/SPEC hold the invariants. **Deferred.**

CONTROL-veto: noted in the added paragraph ("a CONTROL may additionally veto") without disturbing the eval's POLICY-blocking mechanism.
