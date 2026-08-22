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

**Consensus is two legs, on two DIFFERENT models drawn from the three permitted above**,
and three rules bound it:

1. **The builder is never a reviewer.** Whoever produced the artefact cannot be a leg on it.
2. **The two legs must be different models from each other.** Not "at least one differs
   from the producer" — that wording permitted exactly what this section condemns: two
   legs both on `gemini-3.7` reviewing a `terra` build would satisfy it while returning
   two signatures and one verification.
3. **Every leg must be drawn from the permitted list.** Being different from the producer
   is not enough on its own: a model that is outside the pool but happens to differ from
   the producer would otherwise pass the filter — which is precisely the `gpt-5.5` vector.

Read together: two legs, both in the pool, different from each other and from the builder.

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

Git does not carry it either, though not for the reason a first draft of this file
claimed. Measured: `git log` shows **eight distinct author identities**, not one. But
1 481 of the 1 487 commits are the human's three addresses, and the remaining five
identities are variants of "Codex" (`codex@local.invalid`, `codex@openai.com`,
`codex@example.com`, `Codex Operator`) which name a **tool, never a model or an effort**.
So the conclusion survives its own correction, and is stronger for it: even where an
agent does commit under its own identity, that identity does not say which model ran.

So a cross-model leg is **asserted, never verified** — a measured fact, not a caution.

And the remedy is smaller than it looks: `prov` already exists and is already written on
every event. Raising this rule from convention to attestation means adding the producing
and reviewing model to a record that is already there, not inventing a new one.

Worse, and measured on the harness lane itself: **an agent cannot reliably observe the
model serving it.** A session may hold two conflicting statements — its system context
naming one model, a local command having selected another — with no means of
introspection to settle it. This lane delivered two review legs with that ambiguity
stated out loud rather than papered over: `rhanka/sentropic#542` (LLM routing integrity
contract) and `rhanka/h2a#223` (its runtime consumer). Both are named with their
repository, because "#542" alone points at nothing in this one.

Therefore:

- a leg declares its model; it does **not** claim to have observed it;
- a declaration is usable only when it establishes **both** things at once:
  **membership** — every candidate the declaration leaves open is inside the permitted
  list — **and distinctness** from the other leg and from the builder. Distinctness alone
  is not enough. A model outside the pool is trivially distinct from the producer, and
  admitting it on that basis is exactly how a `gpt-5.5` leg gets accepted;
- an ambiguous declaration is therefore usable only if **every** model it could mean is
  permitted. This is not hypothetical, and the example is this lane's own: both legs
  cited above were declared as "`claude-opus-5` or `claude-opus-4.8`, neither of which is
  the other leg's model". That establishes distinctness — and **fails membership**, since
  every `opus` is excluded from review. By the rule as now written, **those two legs were
  not attestable**, and they were accepted on distinctness alone. That is the same hole
  the `gpt-5.5` leg went through, found in this lane's own work rather than someone
  else's;
- when either condition cannot be established, the leg is **not attestable**, and another
  leg is required. Saying so costs one leg; hiding it costs the whole consensus.

This rule is at the **spec-line** rung. What would raise it: an attestation field that
records the producing and reviewing model per artefact. Until that exists, this section
is a convention, and it is written here as one.

### Gateway legs

Review legs run **no-gw** (gateway off) and must be attestable. A session routed through
the gateway cannot attest its model: the gateway remaps `claude-*` and the served model
is not the requested one. A leg produced under the gateway is not a leg.

### A leg that says "build green" must have built the way CI builds

**`npm ci`** at the repository root — the literal command, not "a clean install", because
`npm install` over an existing `node_modules` is defensible-sounding and is not the same
thing — then `npm run build` / `npm run typecheck`. A tree assembled any other way makes
the types of a peer dependency present that `npm ci` would not, so it hides exactly the
class of defect a build is supposed to catch: peer-dependency wiring, project references,
lazy type-resolution of peers.

Hand-linked `node_modules` is only the vector that was caught. Others produce the same
masking and are worth naming, because each of them looks harmless in isolation:

- `npm link`, and `npm install` layered over a tree that already has the peer;
- `NODE_PATH` pointing anywhere outside the checkout;
- **a worktree nested under an ancestor that has its own `node_modules`** — Node walks up
  until it finds one, so a worktree missing its own install silently resolves against the
  parent repository's, with no signal at all. This is not hypothetical here: this lane's
  worktree sits under a checkout that has `node_modules`, and it was verified by resolving
  `vitest` and `typescript` and confirming both land inside the worktree, not the parent;
- stale `dist/*.d.ts` from an earlier build, which satisfy a type-resolution that a fresh
  build would fail.

Measured on `rhanka/h2a#231`: **both** review legs and the preliminary pass built in a
hand-linked worktree and all three reported 20/20 green. Clean CI failed deterministically
on `packages/h2a/src/runtime/mcp-central.ts:72` — a literal-specifier
`import("@sentropic/h2a-runtime")` makes `tsc` type-resolve a lazy peer (TS2307), which
breaks the rule that `@sentropic/h2a` never type-resolves `@sentropic/h2a-runtime`. Three
independent verifications, one shared environment, zero verification.

This is the same shape as the rest of this section, with the shared variable moved again:
it was the model in rule 2, a `PATH` in the host case, and here it is the **install**.
The harness lane produced its own instance while writing this file — seven test failures
that looked like pre-existing breakage were caused by handing one suite's `TMPDIR` to
every suite. What separated the two was changing one variable at a time, not judging
which story was more plausible.

**Where this stops:** nothing verifies that a leg built cleanly. Like every rule in this
section it is declared, not enforced — the clean CI run at the SHA is the only oracle, so
a leg's build claim is worth exactly as much as the CI conclusion it can point to.

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
