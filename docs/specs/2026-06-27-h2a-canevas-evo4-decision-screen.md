# CANEVAS EVO-4 — the *decision focus screen* for h2a-org

**Status: spec / design-only.** No code, no plan. Companion to
`present-decision` (the agent→human *method*), `2026-06-27-h2a-design-knowledge-integration.md`
(the embeddable-view contract = the *render seam*), and `evolution-intentions.md` §EVO-4.

> **The gap (Fabien).** *"Je n'ai jamais vu le moindre écran focus pour la moindre décision."*
> The mechanics already exist (dossier, presenter-bias, comprehension attestation, signed
> quorum) but there is **no clean, reusable surface** that takes a decision/ADR, presents it
> to a human by a **non-conflicted** party with **dissent attached**, and captures a **real
> signature**. EVO-4's canevas is that surface.

Read read-only this session: `present-decision/SKILL.md`; `cli-contract.ts` (nego / dossier /
confiance / declare-interest / conflict-posture / attest-comprehension); `decision-dossier.ts`
+ `confiance.ts` (the core derivations); the design-knowledge integration doc (view contract).

---

## 0. What a "canevas" is

In the integration doc, a **canvas/canevas** = a DS-rendered embeddable view (track report,
h2a screen, graphify output). The **decision canevas** is one such canvas, specialised: the
*screen that presents one decision to one human for signature*. It is a **composition**, not a
new engine — it binds three layers that already exist (§2) behind one stable hash.

---

## 1. The `decision-canevas` model (SÉMANTIQUE — owned by h2a-org)

A typed artifact, canonical-hashable (`canevasHash`), assembled from the
**present-decision** 8-section method *and* the h2a core derivations:

| Field | Source / backing primitive |
|---|---|
| `decisionAsked` — one sentence, option IDs, exact scope | present-decision §1; negotiation `id` + `scope` |
| `options[]` — `{id, choice, steelmanFor, strongestAgainst, cost, reversibility, whatWouldMakeItWin}` | present-decision §4 (count-symmetry / steelman every option incl. rejected) |
| `recommendation` — one option (or *defer*) + decisive judgment | present-decision §5 |
| `stakes` — affected repos / WPs / contracts / users; why dossier-level | present-decision §3 |
| `attendus[]` — the PRINCIPAL's validation criteria `{criterion, source, coveredBy, gap}` | present-decision §7; seeded from `track report` attendus |
| `coiDisclosures[]` — per signer/subject conflict posture | `deriveDecisionDossier().items[]` (`postureConflit`, `disclosureMode`, `masqueImpactCollectif`, ranked `reasons[]`) |
| `dissent[]` — attached dissent of any harmed party | `derivePostureConfiance().disclosedConflicts[]` + any `negotiate counter` from the lésé |
| `presenter` — the **non-conflicted** presenting party + its `presenterBias` gate result | `evaluatePresenterBias(presenter)` (§4) |
| `presenterInterestDisclosure` — what is easiest/faster for the presenter | present-decision self-audit (agent-interest disclosure) |
| `premortem` — "six months later this failed because…" | present-decision self-audit |
| `requiredSigners[]` — PRINCIPAL + non-h2a quorum | negotiation `record.requiredSigners` |
| `receipt` — signature receipt once stabilized | `negotiate stabilize` (quorum + signatures verified) |

Every load-bearing claim carries a `FACT|JUDGMENT` tag (present-decision self-audit gate). The
canevas is **Incomplete** until the gate passes — the surface refuses to *present* an
Incomplete canevas (it may only *ask for the missing fact/criterion*).

`canevasHash = computeHash(canevas)` is the anchor the human attests against (§4).

---

## 2. Three-layer separation (the non-negotiable boundary)

| Layer | Owns | Lives in | Never does |
|---|---|---|---|
| **SÉMANTIQUE** | the `decision-canevas` model + COI/confiance derivations | **h2a-org** (`@sentropic/h2a` core + `h2a canevas` orchestrator) | render pixels; mint a signature |
| **RENDU** | the focus *screen* (Svelte embeddable view) | **design-system** (`design views` contract, `--st-*` tokens, `ThemeProvider`) | import `h2a`; hold decision logic; own the model |
| **SIGNATURE** | the human attestation + quorum | the **human's key** via `attest-comprehension` + `negotiate sign` | be produced by an agent on the human's behalf |

This mirrors the integration doc's anti-cycle invariant: **DS MUST NOT import h2a**; the arrow
is `h2a → design`. The canevas SÉMANTIQUE is passed to a DS `decision-canevas` view *as data*;
the screen renders, it does not decide. The `rendered-view` records `source-dossier-hash =
canevasHash`, so the screen the human read is provably the model they signed.

---

## 3. Flow (draft → signed receipt)

```
1. draft        agent assembles the canevas (present-decision method) from the negotiation
2. re-frame     a NON-CONFLICTED presenter is assigned; presenterBias gate must be CLEAN
3. render       canevas → DS decision-canevas view (stable view-ref, source-dossier-hash=canevasHash)
4. read         human reads the focus screen (one of the 4 EVO-4 delivery modes below)
5. attest       human signs a comprehension-attestation over canevasHash — with THEIR key
6. co-sign      non-h2a quorum negotiate-sign the artifact; confiance derived
7. stabilize    quorum + signatures verified → write-once receipt
8. record       track decision add-artifact (decider = the human, NOT the relay channel)
```

**The 4 EVO-4 delivery modes are all step 4 (RENDU/transport), never step 5 (SIGNATURE):**
1. **Native Q&A** — host modal-ask (`AskUserQuestion`) captures the choice (present-decision §5).
2. **Plugin Q&A** — for a host without native ask (codex), the plugin drives the Q/R.
3. **Ad-hoc web page + MCP-as-API** — DS-rendered canevas served; the human signs *client-side
   with their key*; the MCP server only **relays** the signed attestation (it must **not** mint
   it). This is the EVO-4 "web page, feedback via the MCP server as API" mode.
4. **Attentive spec-review** (Tiptap + Sentropic DS) — per-paragraph validation; comprehension
   is *real* because the human engages paragraph-by-paragraph, not a single rubber-stamp.

**Decider ≠ relay (standing rule).** The attester (who comprehended, signed with their key) is
recorded as the decider; the bridge/MCP that transported the write is never recorded as the
human decider (present-decision §6 / `h2a durable bugs`).

---

## 4. Mechanical anti-COI guarantees

These are enforced by the model, not by good behaviour:

1. **Presenter ≠ beneficiary.** `evaluatePresenterBias(presenter)` returns `biased` iff the
   presenter's `postureConflit === "conflit-declarable"` against the decision scope. On the
   canevas surface this **escalates from advisory to blocking**: `canevas present` refuses
   (exit 2) a biased presenter and emits a `presenterBias` event. The beneficiary AGENTS can
   never be the presenter; the presenter is a MANDATAIRE/ATTENTION-style neutral or a CONDUCTOR
   (and SCOPE never signs).
2. **Dissent is mandatory when a party is lésé.** `derivePostureConfiance` surfaces
   `disclosedConflicts[]`; any of these (plus a harmed party's `negotiate counter`) MUST be
   attached as `dissent[]`. A hidden collective-impact conflict (`undisclosedConflicts`) forces
   `postureConfiance = non-etablie` — the canevas cannot reach a clean signature with concealed
   dissent. Disclosure is proportional to collective impact (EVO-9 INTÉRÊT invariant), never a
   forced full disclosure.
3. **The agent cannot fabricate the human signature.** `attest-comprehension` requires the
   signer's **private key**, which the agent does not hold; `comprehension verify` checks it
   against the human's public key. The CLI does not let an agent mint `comprehension[]`
   (present-decision §6, hard rule). The MCP-as-API path is a **transport for an
   already-signed** attestation, never a server-side minter.
4. **Confiance gate before receipt.** `negotiate stabilize` only succeeds with a real quorum of
   valid signatures; `derivePostureConfiance` must be `etablie` (attention attested for every
   decider against the *current* `canevasHash` — `staleAttestations` empty — and no undisclosed
   collective conflict) or **`reservee` with the dissent disclosed**. `non-etablie` blocks.

---

## 5. CLI surface candidate — `h2a canevas …`

A thin **orchestrator** over existing `nego` primitives + the `design views` render seam +
`track decision`. It introduces no new trust engine.

| Verb | Does | Composes |
|---|---|---|
| `h2a canevas open <neg> --presenter <id>` | build + persist the `decision-canevas`; assign presenter; run self-audit + **presenterBias gate** (refuse biased presenter) | `nego dossier --presenter --advisory-gate`, `conflict-posture` |
| `h2a canevas show <canevas>` | print the SÉMANTIQUE model (`--json`) | local read |
| `h2a canevas present <canevas>` | emit the RENDU (DS `decision-canevas` view, stable `view-ref`, `source-dossier-hash=canevasHash`); notify the PRINCIPAL (inbox/wake); record `track decision add-artifact --kind rendered-view` | `design views`, `nego confiance` |
| `h2a canevas sign <canevas>` | **human-driven**: wraps the human's `attest-comprehension --dossier <canevasHash> --private-key <human-key>` + collects quorum `negotiate sign`, then `stabilize`; the agent **cannot** pass the human's key | `attest-comprehension`, `negotiate sign/stabilize` |
| `h2a canevas status <canevas>` | derive `postureConfiance` + signature receipt | `nego confiance`, `comprehension list` |

After stabilization, `canevas` records `track decision add-artifact --kind h2a-decision-dossier
--negotiation-ref <neg> --dossier-hash <canevasHash>` with the **real** comprehension evidence —
never a faked one.

**Why a dedicated `canevas` namespace** (recommended): (a) the *object* is a decision focus
**screen**, distinct from the negotiation — one negotiation may yield 0..n canevas
presentations; (b) it *composes* three domains (`nego` + `design` + `track`) that no single
existing namespace owns; (c) "canevas" already names the DS-rendered focus screen in the
integration doc, so the grammar stays object-first/host-agnostic.

**Alternatives considered.** `h2a nego canevas <…>` — keeps it under the negotiation namespace;
simpler roster but couples the screen to one negotiation and hides the render/track composition.
`h2a decide <…>` — reads well but collides with `present-decision`'s "decide+trace" path and
over-claims (the human decides, not `h2a`). Preference: `h2a canevas`, with `nego canevas` as an
acceptable fallback if the owners prefer to avoid a new top-level namespace.

---

## 6. Open questions for double consensus

- **Q-C1 — Gate severity.** Confirm `presenterBias` flips advisory→**blocking** on the canevas
  surface (refuse to present a biased presenter), vs staying advisory + loud.
- **Q-C2 — Quorum identity.** "Non-h2a quorum" = which keyed identities? PRINCIPAL + named human
  stakeholders only? How do we register a human co-signer's key without making them an h2a agent?
- **Q-C3 — MCP-as-API trust boundary.** Confirm the web-page mode signs **client-side** and the
  MCP server only relays; spec the replay/freshness checks so a relayed attestation can't be
  re-minted or replayed.
- **Q-C4 — Render contract version.** Which `design views` version owns the `decision-canevas`
  view? Pin it as the single render contract (integration-doc Q-D2) so `source-dossier-hash`
  binding is stable across DS releases.
- **Q-C5 — `canevas` vs `nego canevas` vs `decide`** (§5) — owners' call.
- **Q-C6 — Dissent obligation threshold.** What "collective impact" level makes attaching a
  party's dissent mandatory vs optional (ties to EVO-9 INTÉRÊT "disclosure proportional to
  impact")?
- **Q-C7 — Codex/agy Q&A parity.** Mode-2 plugin-driven Q/R feasibility per host (ties to
  EVO-1 capability matrix) — does every host reach a *real* comprehension before signing?

---

**Next:** double-consensus review (Codex + Opus independent passes), then negotiate the
`h2a canevas` surface + the DS `decision-canevas` view with the design owner over h2a before any
plan. Design-only; no repo other than this doc is touched.
