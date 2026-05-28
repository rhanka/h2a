# smart-contract.md — review r2-codex (2026-05-28)

- `txHash` does not freeze contract state · high · `H2AChainRef.txHash` and “immutable triple” language · Treat `txHash` as an anchor to a deployment/call only; add `blockHash`/`blockNumber`, confirmations/finality, and `codeHash` or state proof if state pinning is required.
- ABI verification is overstated · high · `content-integrity` paragraph · RPC can read runtime bytecode, not canonical ABI; verify `codeHash`/runtime bytecode and treat `abiHash` as metadata from a trusted source.
- Public-chain disclosure claim is too absolute · med · controlled disclosure row · Replace “all data visible / cannot” with “public on-chain calldata/state is transparent by default; privacy requires extra mechanisms such as commitments, encryption, ZK, private/L2 systems.”
- `MANDATAIRE` is grouped with recourse/judgment · med · “What stays off-chain,” bullet 3 · Separate `MANDATAIRE` as a mandated actor; recourse/amendment/judgment must remain with `PRINCIPAL`/`EXECUTIF`, with `CONTROL` only auditing.
- Vocabulary introduces reference types as if first-class h2a artifacts · med · `H2AChainRef`, `verifyEnvelopeChainRef`, `chainRef` · State these are external payload/adaptor schemas embedded in canonical `CONTRACT`/`ENGAGEMENT` content, not new h2a artifacts.
- Compatibility hypothesis overclaims “direct analogues” and “governed by” · med · Compatibility hypothesis · Say h2a governs the off-chain commitments and authorities around a contract; on-chain execution remains governed by code, keys, and chain rules.
- Mermaid matches the text structurally but overstates delegation · low · diagram edge `ENFORCEMENT_PLAN delegates execution to` · Change to “references / audits on-chain execution target” unless an authorized actor and `PRINCIPAL` ownership path are explicit.

revise
