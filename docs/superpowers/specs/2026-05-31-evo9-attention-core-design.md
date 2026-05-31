# EVO-9 — ATTENTION comprehension-core — design (buildable)

**Date**: 2026-05-31 · **Status**: design, validated by claude:a2a-cli — **ready to delegate** (build = a codex worker) · **Refers**: `docs/superpowers/specs/2026-05-30-evo9-trust-concepts-framing.md` (stabilized sequence + Opus review), DEC-088 (signed attestation pattern), DEC-035 (`H2A_AUTHORITY_MATRIX` / MANDATE), DEC-112 (VALEUR + MUTUALISATION).

## Scope (this slice only)

The **bias-free comprehension core** — the first ATTENTION slice, low-risk, a true DEC-088 clone. Per the stabilized sequence (Opus review F2/F4): **VALEUR + MUTUALISATION (shipped) → `ATTENTION comprehension-core` (this) → INTÉRÊT → ATTENTION dossier-layer → CONFIANCE**.

**In scope**: a signed *comprehension attestation* — "I have comprehended the content hashing to H" — bidirectional (human decider **and** agent), as a non-binding signed `event`.

**Explicitly OUT of scope** (depends on INTÉRÊT, lands later): the risk-ranked **dossier** derivation, the **presenter non-bias** gate, dossier-relative-to-interest framing, any ranking by a model of harm. This slice carries **no** interest computation.

## Honesty semantic (the load-bearing definition)

A comprehension attestation asserts **"comprehension of hash H"**, *not* "no blind spot" and *not* "I agree". It is a tamper-evident, signed claim that the attester has seen and understood the exact content whose canonical hash is `H`. It binds the attester to a specific artifact state — nothing more. This keeps the engine out of judging *whether* comprehension is adequate (it never adjudicates).

## Design — declare → derive → attest

### Core (`@sentropic/h2a`, pure)
- **Body kind** `comprehension-attestation`:
  ```
  H2AComprehensionAttestation = {
    kind: "comprehension-attestation",
    subject: string,        // the instance attesting comprehension
    dossierHash: string,    // sha256 (hashCanonical) of the presented material
    at: string              // ISO timestamp
  }
  ```
- **Pure helpers**: `buildComprehensionAttestation(input)`, total guard `isComprehensionAttestation(value)`, and `H2A_COMPREHENSION_ATTESTATION_BODY_KIND`. The `dossierHash` is computed with the existing canonical hash (`hashCanonical` / the SHA-256 used for artifacts) over whatever material is presented — the core does not define the dossier, only that comprehension is *of a hash*.
- **Verification**: `verifyComprehensionAttestation(envelope, publicKeys)` = shape guard + `verifyCanonical(body, signature, pem)` against the attester's active keys. Total (never throws).

### Non-binding guardrail (Fork D, tightened — the semantic core)
The attestation rides in a signed `event` envelope that:
- carries **no `artifactKind`**, and
- contributes **nothing** to the stabilization signer set.

`stabilizeNegotiation` MUST ignore `comprehension-attestation` events when computing quorum/signers. This is the guardrail that lets an **AGENT** attest comprehension (giving the PRINCIPAL cryptographic proof the agent understood) **without** becoming a signatory on engagements — preserving the "AGENTS non-signatory" invariant. Mechanically nothing frozen changes (`SIGNATURE` already maps to all 6 roles); the guardrail is **semantic + enforced by a test**.

### MANDATE right `attester-comprehension`
A narrow right in the authority model permitting an AGENT to emit a comprehension-attestation. Bidirectional: humans (PRINCIPAL/EXECUTIF/MANDATAIRE) attest natively; an agent attests **only** when granted `attester-comprehension`. Reuses `H2A_AUTHORITY_MATRIX` (additive entry), no frozen-surface break.

### Surface (`@sentropic/h2a-cli`)
- CLI verb `h2a attest-comprehension --instance <id> --dossier <file|hash> --private-key <pem>` → builds + signs + puts the event envelope (to a target inbox / negotiation journal as an event).
- Optional MCP tool `h2a_attest_comprehension` mirroring the verb (same pattern as the other tools).
- A read/verify path: `h2a comprehension list/verify` (who attested comprehension of which hash).

## Test plan (`node:test`)
1. build → guard → sign → `verifyComprehensionAttestation` round-trip (valid).
2. tampered `dossierHash` (or body) → verify fails.
3. an AGENT **with** `attester-comprehension` may emit; **without** it, refused.
4. **guardrail**: a `comprehension-attestation` event in a negotiation does **NOT** count toward the stabilization signer set / quorum (the load-bearing test).
5. bidirectional: a human role and an agent (mandated) both produce valid attestations.

## Invariants honored
- Advisory / no veto, no legitimacy judgment (the engine records comprehension-of-hash; it never rules comprehension adequate).
- Tokens: `comprehension-attestation` (body kind), `attester-comprehension` (MANDATE right) — neutral, collision-free, no franglais.
- Additive: new body kind + pure helpers + one authority-matrix entry + CLI/MCP surface. Nothing frozen breaks.

## Delegation note (for the orchestrator)
Buildable as one coherent codex WP once a worker frees up. **Boundaries**: `@sentropic/h2a` (body kind + helpers + authority entry), `@sentropic/h2a-cli` (verb + optional MCP tool + verify path), tests. Pure-first; DEC-118 (EVO-9 slice 2: ATTENTION comprehension-core). Do **not** add any risk-ranking / dossier / interest logic (that is the post-INTÉRÊT layer).
