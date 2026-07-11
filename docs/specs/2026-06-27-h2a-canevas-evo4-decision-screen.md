# CANEVAS EVO-4 — the *decision focus screen* for h2a-org

**Status: spec / design-only.** No code, no plan. **Incremented 2026-07-10 with §7 (EVO-4b — the
unified local decision cockpit); §7 passed independent double-consensus (both GO).** Companion to
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

## 7. EVO-4b — the *unified local decision cockpit*

**Status: design-only increment** on EVO-4 (§0–§6). No plan. This section is honest about scope:
it is **not** a "transport swap" over the shipped `apps/focus` — it is a **new build** (a DS
`decision-canevas` view + an h2a-side local orchestrator + a client-side signing relay + a
registration ingress). The shipped `apps/focus` is a **single-repo, directives-only precursor**;
its current inject path (which forges an unauthenticated `focus:local-human` actor and shells the
h2a binary) is a **precursor to be re-architected here**, not the finished vehicle.

> **The gap (Fabien, 2026-07-10).** EVO-4 delivers **one** decision screen **per** decision. But
> locally a human juggles ~50 repos and decisions arrive from many workspaces; ad-hoc-per-decision
> pages **fragment** attention. *"Quand h2a tourne en local, il concentre au même endroit tous les
> dossiers de décision, la skill intègre cette présentation, je vocalise toujours sur la même UI
> pour toutes les décisions (et/ou le track report). Plusieurs empilées pour plusieurs repos → je
> swipe, et par repo."*

### 7.1 Scope honesty — what EVO-4b actually is

EVO-4b changes EVO-4 **step 4 (aggregated transport)** *and* touches **steps 5–6 (SIGNATURE)**
because it adds a Level-B client-side-signature **relay**. It is therefore NOT "only step 4".
Concretely it introduces four new pieces:

1. a **DS `decision-canevas` view** (the RENDU seam of §2 — does not exist in `apps/focus` today,
   which renders track *directives*, not canevas);
2. an **h2a-side local orchestrator** (`h2a cockpit`) that owns discovery, per-repo routing, the
   registration ingress, auth, and the signature **relay** — this is where all h2a-coupling and
   routing logic lives;
3. a **pure-RENDU DS app** (`apps/focus`) that talks to the orchestrator over a **typed local
   seam** and holds **no** h2a import, **no** routing, **no** decision logic, **no** minting;
4. a **client-side signing** path (browser holds/uses the human key; server never sees it).

### 7.2 Three-layer split, enforced (must-fix — both reviewers)

| Component | Layer | May | May NOT |
|---|---|---|---|
| `apps/focus` | **RENDU** | render canevas/report passed as data; POST user gestures to the orchestrator over the typed seam | import `h2a`; shell the h2a binary; choose a routing target; derive posture/COI; mint or hold a signature |
| `h2a cockpit` (local orchestrator) | **SÉMANTIQUE-adjacent orchestration** | discover workspaces; build/aggregate canevas via `h2a canevas`; resolve routing targets; relay a *client-signed* attestation; enforce auth | render pixels; mint a signature; act as a decision beneficiary (§7.5) |
| human's browser + key | **SIGNATURE** | sign client-side over the bound payload (§7.4) | delegate the key to any server/agent |

The invariant "DS MUST NOT import h2a" is **reasserted and made true**: the routing/target logic
that currently lives in `apps/focus`'s inject server (`liveSessionsForProject`, emitter-vs-freshest
selection) **moves into `h2a cockpit`**. The DS app only renders and forwards gestures.

### 7.3 Two co-tenants, never conflated (must-fix — peer)

The cockpit shows two **visually and semantically separate** surfaces per repo:

- **Track report** — a status view (the existing focus report). Read-only + **Level-A nudges only**
  (§7.4). It carries **no** signature affordance. It carries a **freshness stamp**
  (`reportHash`, `baselineCommit`, `generatedAt`, `dirty`, `expiresAt`); a stale card visibly
  invalidates (resolves QB5 as **required**, not open).
- **Decision canevas** — the EVO-4 artifact. It is the **only** surface that may carry a **sign**
  affordance, and only when the FACT/JUDGMENT gate passes (**never** for an Incomplete canevas).

Track *directives* (gate-blocked backlog items) are **status/nudge** objects — they are never a
signature affordance. Only a real `decision-canevas` can be signed.

### 7.4 Answer / *trancher* — two artifact types, mechanically separated (BLOCKING fix — both)

Two **distinct artifact types**, not two "levels" of one thing:

- **`nudge` (unsigned operator mandate).** What the shipped inject does, **re-scoped honestly**:
  an **unauthenticated** operator gesture that deposits a mandate into a **live** session's inbox.
  It is **not** a human signature and **not** `decider ≠ relay` — that claim is **dropped** for
  nudges. The forged `actor:'focus:local-human'` is **removed**; the envelope carries an explicit
  `answeredBy:"operator-nudge"` (non-human, non-attesting) identity. A `nudge` **MUST NOT** populate
  `comprehension[]`, quorum, `receipt`, `negotiate stabilize`, or `track decision add-artifact
  --kind h2a-decision-dossier`. It is for **reversible / decide-and-trace** items only.
- **`decision-attestation` (client-side signed).** The EVO-4 signature path: the human signs
  **client-side** over the **bound payload** (§7.4.1); `h2a cockpit` **only relays** it to
  `negotiate sign`/`stabilize`; it **never mints** it.

**Hard rule (closes QB3 — the blocking loophole).** Any present-decision **hard trigger**
(irreversible; frozen/public contract; auth/security/privacy; migration/retention;
cross-repo/owner/agent; meaningful cost/blast-radius; genuine equipoise; owner asks at stake level)
**MUST** route to a `decision-attestation`. A `nudge` is **forbidden** for a hard-trigger decision.
This is enforced by a **stakes classifier on the orchestrator's ingest** (the canevas carries its
present-decision trigger score; the ingest refuses to expose a nudge affordance on a hard-trigger
canevas) — **not** by UI prose. The UI must never visually blur "nudge sent" with "decision signed".

**Directive-locus rule (closes the classifier↔object mismatch — peer v2).** A `nudge` acts on a
track **directive** (a status/backlog item), which carries **no** trigger score; a
directive-nudge is therefore **inherently capped at decide-and-trace** (reversible) and can, by the
artifact-type bar above, **never** become a decision-of-record. A hard-stakes concern **cannot be
nudged**: it must be **promoted to a `decision-canevas`** (which carries the trigger score + the
FACT/JUDGMENT gate) and then routed to a `decision-attestation`. So the classifier on canevas
ingest and the artifact-type bar together leave **no path** for a hard trigger to be settled by a
nudge.

#### 7.4.1 Attestation binding (must-fix — both; closes cross-workspace misrelay QB4)

A `decision-attestation` signs over a payload that binds, at minimum:
`canevasHash` · destination `workspaceId` · `negotiationId` · signer **public key** · `presenterId`
+ `presenterBias` result · render **view-ref/version** · **relay target** · `nonce`/challenge ·
`issuedAt`/`expiresAt` · intended action. The **destination** (`negotiate sign` verify) **independently
re-verifies** every bound field against the *current* canevas — so the relay **cannot re-target** a
signature from repo A into repo B, and a stale/superseded canevas is rejected (`staleAttestations`).

### 7.5 New hazards the aggregation introduces — and their guards

1. **Aggregator-as-beneficiary (presenterBias escape — peer).** One `h2a cockpit` emits into N
   workspaces. The per-canevas `presenterBias` gate governs the **canevas presenter**, not the
   emitter. Guard (**required property**): the cockpit emitter **must not** be a beneficiary of any
   target decision — a **dedicated neutral relay identity** with no AGENTS role/stake; if the local
   instance has stakes in a repo's decision it **may not** be that decision's cockpit emitter.
   *Mechanism candidate (pending QB-c):* derive posture/COI over the emitter identity per target and
   refuse to emit where it has a declarable conflict.
2. **Standing forged-human endpoint (blast radius).** A long-lived localhost server with N-repo
   `inbox put` authority is reachable by any local process / browser tab / DNS-rebind. Guard:
   **auth token** (printed by `h2a cockpit serve` at startup, required on every register/nudge/relay
   call), **Origin/localhost checks**, **closed CORS** (no wildcard), **CSRF** defense, server
   **never** receives a private key, and **repo-provided dossier text is sanitized** (XSS/phishing)
   before render. "localhost/same-user" is **not** treated as a security boundary.
3. **Second cockpit racing to relay.** Guard (**required property**): **relay is idempotent** via
   the attestation `nonce` (multi-tab safe) — this, **not** any lock, is the safety property; a
   duplicate relay of the same signed attestation is a no-op at the destination. *Mechanism
   candidate (pending QB-a):* a **singleton** via lock/lease (lockfile + port registry + PID/TTL, or
   the conductor lease); a second instance is **deterministically** demoted to **read-only/attach**
   (never a second relayer), it does not fail-open.
4. **Stale canevas surviving a swipe.** Guard: each card carries **liveness**; a card whose
   negotiation moved (new counter/dissent/`staleAttestations`) **visibly invalidates** before any
   sign; standing cards never outlive their `canevasHash`.
5. **Multi-workspace WRITE (not "read").** Stated plainly: the cockpit **writes** (nudges + relayed
   attestations) into N workspaces; that write surface — not a read surface — is the crux of its
   threat model (§7.5.2/§7.5.3).

### 7.6 Discovery — two axes, never conflated (must-fix — peer)

- **Display discovery**: repos with a `.track` log on disk → their report + pending canevas are
  **listed** (read-only). Canonical identity = **`workspaceId`** (never a name substring; the shipped
  `includes(':name:')` collides). **Dedupe by `workspaceId`** — nested repos, symlinks, forks and
  detached worktrees collapse to one canonical workspace, never N phantom cards. A repo that is
  **moved / deleted / stale** is **dropped** from display (no phantom card survives). Default posture
  = **explicit allowlist**; a repo is included only by consent. Hostile-repo spoofing of another
  repo's identity is rejected.
- **Target discovery (for actions)**: **live sessions** via `h2a sessions`. A `nudge` on a repo with
  **no live session** shows "no live target" **honestly** (never a silent `delivered:false` no-op). A
  `decision-attestation` relays to the **negotiation** regardless of live session (it is a signature,
  not a live nudge).

### 7.7 Skill integration (`present-decision`)

The **full-dossier** path (present-decision Step 3) **registers** the built canevas with the running
`h2a cockpit` (authenticated ingest) instead of ad-hoc text/HTML; the cockpit renders it in the DS.
The *quick-ask* and *decide+trace* paths are unchanged; only the *full-dossier local render* is
unified. Registration ingress is **authenticated** (**required property**) — an arbitrary local
process cannot push a sign-affordance card in front of the human. *Granularity candidate (pending
QB-b):* a global startup token vs a **per-repo capability** so a caller can only register a canevas
for the repo it holds a capability for (a plain global token still lets any holder register for any
repo). Hosts without a local cockpit keep EVO-4 modes 1/2/4.

### 7.8 Comprehension floor on a swipe stack (must — ties to EVO-4 mode-4)

Swipe is **navigation only**. A `decision-attestation` on a swiped canevas **requires drilling into
the full canevas** with options/dissent/COI/attendus/premortem exposed and the FACT/JUDGMENT gate
passed, then an **explicit per-decision comprehension action** (mode-4-equivalent). **No**
collapsed-card signing, **no** bulk-sign, **no** "swipe = sign". An explicit **defer / need-fact /
ask-question** path is always present.

### 7.9 Open questions remaining for consensus (narrowed)

The required **safety properties** in §7.2–§7.8 are normative and settled. These questions resolve
only the **mechanism** behind three of them; **QB-b and QB-c MUST be settled before implementation**
(a global token / an unproven emitter-neutrality claim are not shippable), QB-a/QB-d may resolve at
plan time.

- **QB-a — Singleton mechanism**: lockfile+port-registry vs conductor-lease as the authority?
- **QB-b — Registration authNZ**: token only, or per-repo capability so a repo can only register its
  own canevas?
- **QB-c — Emitter neutrality proof**: how is "cockpit emitter has no stake in repo X" derived
  mechanically (posture/COI over the emitter identity per target)?
- **QB-d — Render contract version**: which `design views` version owns `decision-canevas` (pins the
  `view-ref` in §7.4.1) — inherits EVO-4 Q-C4.

---

**Next:** EVO-4b (§7) has passed independent **double-consensus** (gpt-5.5 + Opus, both **GO** on v3
after one GO-WITH-FIXES round; the blocking Level-A nudge loophole is closed). Before any plan:
settle **QB-b** (registration authZ granularity) and **QB-c** (emitter-neutrality mechanism) —
**gated before implementation** — then negotiate the `h2a cockpit` orchestrator + the DS
`decision-canevas` view with the design owner over h2a. Still design-only; no repo other than this
doc is touched.
