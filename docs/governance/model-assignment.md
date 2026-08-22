# Model assignment for spec, review and build

Owner directive, 2026-08-20. Track item `01M0GT68VZZ06ANK889AKHC4A1`.
Owned by the harness lane; the conductor tracks and dispatches, it does not decide here.

This file says which models may write a spec, which may review it, which may build,
and in what order. It also says **where each rule stops** — a rule whose enforcement
is not stated is a habit wearing the clothes of a guarantee.

---

## A · Spec and review

**Permitted models — this list is exhaustive.**

| | model |
|---|---|
| prime | `gpt-5.6-sol` at `xhigh` |
| second | `claude-fable-5` |
| third | `gemini-3.7` |

**Excluded, without exception:** every `opus`, every `spark`, `gpt-5.5`, and any `gemini`
below `3.7`.

The permitted list above is exhaustive, so anything absent from it is already excluded —
`gpt-5.5` is named here anyway because it is the model that actually got through. On
2026-08-22 a review leg was launched on `gpt-5.5` for the MCP-central work, and nothing
refused it. Naming a model in the exclusion list does not refuse it either (see section C);
it only removes the excuse of ambiguity.

Priority is prime → fallback: reach for `sol xhigh` first; use `fable-5` when it is
unavailable; use `gemini-3.7` when neither is. Availability means *reachable now*, not
*preferred* — a fallback taken for convenience is a fallback taken wrongly.

**Consensus is two legs out of three**, and two rules bound it:

1. **The builder is never a reviewer.** Whoever produced the artefact cannot be a leg on it.
2. **At least one leg must be a DIFFERENT model from the one that produced the artefact.**

### Why rule 2 exists, and why it is not about any model being weak

On 2026-08-20, **four passes by `fable`** let a Base64 bypass through the cluster-mesh
spec. `sol` found it on the first look.

The lesson is not that `fable` is weak. It is that **two legs sharing a model share its
blind spots** — they return two signatures and one verification. This is the same shape
as two defects already measured in this repository:

- *two agents agreeing is not a measurement* — it can be one claim travelling twice;
- *two runs on the same host are not two measurements* — the independent observer
  inherited the observed environment, and the deciding variable was a `PATH`.

Here the shared variable is **the model**. Independence of the reviewer is worth nothing
when the reviewer shares the thing that decides.

**Conductor's recommendation, ratified here by the harness lane** (the owner has not
ruled on it; this is the accountable lane exercising its mandate, and it is reversible).

### Where rule 2 stops — read this before quoting it

**Nothing records which model produced which leg** — measured, not supposed. Full scan of
`.track/events.jsonl`, 2026-08-20, all 1 333 events:

- **fourteen** top-level keys and no others: `aggregate`, `aggregateId`, `at`, `by`,
  `clientToken`, `cmd`, `cmdId`, `contentHash`, `id`, `payload`, `prevHash`, `prov`,
  `seq`, `type`. **No model, effort or reasoning field exists anywhere.**
- `by` holds **one single value across all 1 333 events** — the human identity. Not a
  per-actor value, let alone a per-model one.
- `prov` — the field where attribution would naturally live — carries only `auth`,
  `proposed` and `transport`, in two shapes (`cli`, `import`). It does not name the actor.

Every actor also commits under one git identity.

So a cross-model leg is **asserted, never verified** — a measured fact, not a caution.

And the remedy is smaller than it looks: `prov` already exists and is already written on
every event. Raising this rule from convention to attestation means adding the producing
and reviewing model to a record that is already there, not inventing a new one.

Worse, and measured on the harness lane itself: **an agent cannot reliably observe the
model serving it.** A session may hold two conflicting statements — its system context
naming one model, a local command having selected another — with no means of
introspection to settle it. Both of this lane's review legs on PR #542 and PR #223 were
delivered with that ambiguity stated out loud rather than papered over.

Therefore:

- a leg declares its model; it does **not** claim to have observed it;
- the declaration is usable when it is enough to establish **distinctness** — two models
  that are both *not* the producer's satisfy rule 2 whichever of the two is really serving;
- when distinctness cannot be established, the leg is **not attestable**, and a third
  leg on a different model is required. Saying so costs one leg; hiding it costs the
  whole consensus.

This rule is at the **spec-line** rung. What would raise it: an attestation field that
records the producing and reviewing model per artefact. Until that exists, this section
is a convention, and it is written here as one.

### Gateway legs

Review legs run **no-gw** (gateway off) and must be attestable. A session routed through
the gateway cannot attest its model: the gateway remaps `claude-*` and the served model
is not the requested one. A leg produced under the gateway is not a leg.

---

## B · Build

| | model |
|---|---|
| prime | `gpt-5.6-terra` at `xhigh` |
| second | `gemini-3.7` at `high` |
| third | `opus-5` at `xhigh` |

**Simple builds**, only when nothing above is available: `gpt-5.3-spark` at `xhigh`, or
`sonnet-5`.

**The builder is never a reviewer, and never a leg of consensus** — on its own work, in
either direction. This is the same rule as in section A and it is repeated deliberately:
the build list and the review list overlap (`gemini-3.7`, and `opus-5` is a permitted
builder while being an excluded reviewer), so "it is on a list" never authorises a leg.

---

## C · What this document does not decide

- **Routing.** Which target actually serves a request is the routing contract's business,
  not this file's. This file says who may be *asked*; the contract says what is *served*.
- **Model capability.** Nothing here asserts a model is good at a task. It assigns
  authority, not competence.
- **Enforcement.** No check reads this file. Every rule in it is applied by the actors
  who read it. That is the honest statement of its rung, and it is the reason section A
  spells out where its own key rule stops.
