# smart-contract.md — consolidated triple-review

> Three independent headless reviews on 2026-05-28 — R1 agy/Antigravity, R2 codex/gpt, R3 claude/opus. **All three verdicts: `revise`.** Run sequentially from a neutral tmp dir with the doc inline (autonomous loop, rate-limit-careful). All accepted changes below were applied to `evaluations/smart-contract.md`.

## Consensus findings → action

| # | Finding (reviewers) | Severity | Applied change |
|---|---|---|---|
| 1 | **`txHash` does not freeze contract state** — it anchors one tx; state stays mutable; contradicts the doc's own reorg caveat (R2, R3) | high | `H2AChainRef` now carries `blockNumber?`/`blockHash?` + a `codeHash?`; "immutable triple" softened to "anchor a deployment/call (+ block for finality)"; reorg caveat reconciled. |
| 2 | **ABI is not RPC-verifiable** — `eth_getCode` returns runtime bytecode, not the ABI (R2, R3) | high | content-integrity now checks **`codeHash`/runtime bytecode** on-chain; `abiHash` reframed as trusted off-chain metadata, not a chain-derived check. |
| 3 | **MANDATAIRE grouped with recourse/judgment** — violates "MANDATAIRE never judges" (R1, R2, R3) | high | Off-chain bullet + mapping row reworded: recourse/amendment/judgment sit with **PRINCIPAL/EXECUTIF**, CONTROL only audits; MANDATAIRE is an executing representative. |
| 4 | **Signature implied bound to a scope** — a scope never signs (R1) | high | Mapping row 3 reworded: a **mandated actor** signs under a `MANDATE` within a scope; the scope is passive. |
| 5 | **`H2AChainRef`/`verifyEnvelopeChainRef` read as first-class h2a artifacts** (R1, R2, R3) | med | Interop section states they are **external payload/adapter schemas** carried in a canonical `CONTRACT`/`ENGAGEMENT` `subject` — not new h2a artifacts (aligns with "no new role or artifact"). |
| 6 | **On-chain referent has no PRINCIPAL ownership path** — anything owned needs a PRINCIPAL (R2, R3) | med | ENFORCEMENT_PLAN row + off-chain section now name the **owning PRINCIPAL** of the referent; CONTROL only audits. |
| 7 | **Public-chain disclosure stated too absolutely** (R2, R3) | med | "all data visible / cannot" → "**transparent by default; privacy needs extra mechanisms** (commitments, encryption, ZK, private/L2)". |
| 8 | **Hypothesis overclaims "direct analogues" / "governed by"** (R2, R3) | med | Hypothesis softened: h2a **governs the off-chain commitments/authority that reference** the contract; on-chain execution stays governed by code/keys/consensus; analogues are partial. |
| 9 | **Mermaid edge overstates delegation; node `D` dangling** (R2, R3) | low | Edge `delegates execution to` → "**references / audits**"; the disclosure node connected to the auditor. |
| 10 | **Nonce vs finality conflated** — anti-replay maps to nonce, not finality (R3) | low | Row reworded: anti-replay (DEC-074) ↔ **nonce/ordering**; finality is a separate settlement property. |

## Mechanism note
First autonomous-loop triple-review: the three slots (`agy -p`, `codex exec`, `claude -p --model opus` via stdin) were run **sequentially** (not parallel) from `/tmp/h2a-rev` to limit rate-limit pressure; all three completed. R3 flagged it could not verify DEC-### / `sysml-v2.md` cross-refs (repo absent in its sandbox) — those were checked here against source and are correct. Two genuine factual errors (1, 2) were caught — the review materially improved the draft.
