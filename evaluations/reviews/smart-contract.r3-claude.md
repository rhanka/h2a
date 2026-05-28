# smart-contract.md — review r3-claude (2026-05-28)

I have the document (provided inline) plus the two prior triple-reviews for context. The h2a repo itself isn't in this working dir, so I cannot verify the DEC-### citations or the `sysml-v2.md`/`H2ASysmlRef` cross-references against source — flagging that as a caveat below. Here is my independent review.

## Findings

1. **`txHash` does not "freeze the state"** · **high** · `H2AChainRef.txHash` comment ("freezes the state") + "immutable triple" framing · A txHash anchors a single transaction (e.g. deployment/call); contract state stays mutable and evolves with later txs. Add `blockNumber`/`blockHash` + confirmations/finality, and a `codeHash`/storage-proof if state pinning is actually intended. Note this contradicts the Gaps section's own reorg caveat — internal inconsistency.

2. **ABI is not on-chain / not RPC-verifiable** · **high** · content-integrity paragraph ("re-reads the on-chain code/ABI via an RPC and checks `abiHash`") · `eth_getCode` returns runtime *bytecode*, not the ABI (ABI is off-chain metadata). The proposed integrity check is unsound as written. Verify `codeHash`/runtime bytecode on-chain; treat `abiHash` as trusted off-chain metadata, not a chain-derived check.

3. **MANDATAIRE grouped with recourse/amendment** · **med-high** · "What stays off-chain," bullet 3 (PRINCIPAL/EXECUTIF/MANDATAIRE layer) · Violates "MANDATAIRE never judges." MANDATAIRE executes; recourse/amendment/judgment sit with PRINCIPAL/EXECUTIF, CONTROL only audits. Decouple MANDATAIRE from the recourse layer.

4. **On-chain referent has no PRINCIPAL ownership path** · **med** · ENFORCEMENT_PLAN row + diagram edge · Invariant: anything owned (and an on-chain contract may control value) needs a governing PRINCIPAL; CONTROL only audits. The doc delegates execution on-chain without naming who *owns* the referent. State the ownership path.

5. **Reference types read as first-class h2a artifacts** · **med** · `H2AChainRef` / `verifyEnvelopeChainRef` / `chainRef` · Vocabulary fidelity: make these explicitly external payload/adapter schemas embedded in a canonical `CONTRACT`/`ENGAGEMENT` `subject`, not new h2a artifacts. The hypothesis already says "no new role or artifact" — align the interop section's wording with that.

6. **Public-chain disclosure stated too absolutely** · **low-med** · controlled-disclosure row ("all data visible" / "a public chain cannot") · Ignores privacy mechanisms (commitments, encryption, ZK, private/permissioned chains, L2). Soften to "public chains are transparent by default; privacy requires extra mechanisms."

7. **Hypothesis overclaims "governed by" / "direct analogues"** · **low-med** · Compatibility hypothesis · On-chain execution is governed by code/keys/consensus; h2a governs the off-chain authority *around* it and references it. Several rows are partial (~), so "direct analogues" overstates. Reword to "governs the off-chain commitments/authority that reference the contract."

8. **Diagram overstates delegation; one dangling node** · **low** · Mermaid edge `ENFORCEMENT_PLAN delegates execution to` (text says "plans/audits… chain self-executes") and node `D` (controlled disclosure) is declared but unconnected · Reword edge to "references / audits execution target"; either connect or drop `D`. (Syntax itself is valid and renders.)

9. **Nonce vs finality conflated** · **low** · terminal-states/anti-replay row · Nonce = replay/ordering; finality = settlement/reorg resistance. Anti-replay (DEC-074) maps to nonce, not finality. Minor precision fix.

**Caveat:** DEC-035/045/068/073/074 and the `sysml-v2.md §3` / `H2ASysmlRef` precedent could not be checked against source (repo absent here) — confirm at triple-review.

Two genuine factual errors (1, 2) plus invariant issues (3, 4) need correction before this is sound; the reference-not-bridge core and "no new role/artifact" stance are good. Concurs with the prior two reviewers.

revise
