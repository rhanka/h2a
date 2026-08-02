# The five h2a surface invariants (`surface/I1` … `surface/I5`)

- **Author** — `arch` (WP6). **First committed** — 2026-08-02.
- **Status** — **AGREED BETWEEN LANES, NOT RATIFIED BY THE OWNER.** See §0; that distinction is the
  point of this document existing at all.
- **Canonical identifiers** — always `surface/I<n>`. A bare `I5` is **not** an identifier here. See §1.

---

## 0. Why this file exists, and what its authority is

`[JUDGMENT]` These five invariants were formulated by the architect, relayed by `runtime` (WP5) on
2026-08-01, reformulated on the same day after `runtime` showed that one of them was written as a
remedy rather than a principle, and relayed onward to a third lane. **They were never committed.**

That was a defect, and it was found by the lane it was being used against. On 2026-08-02 the WP13
lane was asked to cite "invariant I5" in a specification it was reworking *for enforceability*. It
refused, on the grounds that it could not resolve the identifier — and it was right. Measured on that
date across the 200 most recent commits of all refs, in both languages: the wording of I5 returned
**zero** blobs (`look like a success`, `deposited-awaiting`, and the French equivalents), while a
control phrase known to be present returned **194**. The absence was measured, not assumed.

`[JUDGMENT]` So an invariant set used as authority over other lanes' work was, itself, unresolvable
prose — **exactly the defect it is used to diagnose**. This file removes that. It does not upgrade the
invariants' standing, and it deliberately does not pretend to:

> **Enforceability rung of this document: AGREED BETWEEN LANES (2026-08-01), one rung above habit.**
> It is not owner-ratified, no test enforces it, and nothing structural rejects a violation. Citing it
> settles *what was agreed*, never *what is guaranteed*.

Repairing an over-wide claim by making a second one would be the same error twice.

---

## 1. The identifiers are qualified, and that is not a formality

`[MEASURED 2026-08-02]` The repository already contains an `I5`. It belongs to WP11's memory-seam
document (`docs/specs/2026-08-01-memory-seam-storage-options-vagueB.md`) and it states something
else — *fail-closed: every option declares its behaviour when the backend can't honour it*. Two
different propositions, one bare identifier, two owners.

`[JUDGMENT]` The first draft of this file ignored that, and an independent review caught it. The irony
is exact and worth recording rather than quietly fixing: **a document whose subject is a claim made
wider than its proof was itself about to install an ambiguous identifier** — the addressing-by-name
defect these invariants exist to prevent.

> **Rule, and it generalises past this file: an identifier that two documents can claim is not an
> identifier.** It is a hint that reads like a reference.

The same form was traced hours earlier on a different surface: one npm name, `@sentropic/focus`,
declared by two repositories at the same version, with three copies of the code and nothing keeping
them identical (tracked as `01KZ06QG3VNVFDY5ETY65FDSB4`). Same shape, different medium.

**Therefore:** cite these as `surface/I1` … `surface/I5`, never bare. WP11's remains WP11's under its
own qualification. **Where this stops:** the qualification removes the ambiguity of *reference*; it
does not stop anyone from minting a third `I5` elsewhere. Nothing enforces the convention — its rung
is the same as this document's.

---

## 2. The invariants

**`surface/I1` — one identifier crosses the boundary, and it is not a conversation id.**
A surface exposes a single durable identity. An identifier that changes when a conversation changes
must never be the thing another party holds on to.

**`surface/I2` — the surface states, operation by operation, what is MEASURED versus taken on trust.**
A field that reports an observation and a field that reports a claim must be distinguishable by the
caller, not by folklore.

**`surface/I3` — every object is marked HOLDER or VIEW.**
A renderer never persists; a view never wins an authority dispute.

**`surface/I4` — capabilities are declared in the EXISTING vocabulary.**
Do not open a second one. An unknown capability is dropped, not silently admitted.

**`surface/I5` — a failure must never look like a success.**
Every operation declares what it does when the counterparty is unreachable, and its return must let
the caller distinguish **done / deposited-awaiting / not-done**. Refusing is the default *where
honest acceptance is impossible*. Forbidden: a synchronous act disguised as a deposit, or a deposit
presented as a completion.

`[JUDGMENT]` `surface/I5` was first written as *"default = refuse"*. That version was a **remedy**, and
it would have forbidden a legitimate design — the dormant deposit-for-wake that eleven lanes rely on.
The reformulation above is a **principle**. The difference is not stylistic and it is the most useful
thing in this file: *an invariant written as a remedy forbids valid designs; written as a principle,
it sorts them.*

---

## 3. What `surface/I5` has actually caught

`[JUDGMENT]` The case for keeping these as principles rather than checklists is that a principle makes
a whole class **searchable**. Between 2026-08-01 and 2026-08-02 it surfaced four defects on four
independent surfaces, none of which a locally-numbered requirement would have connected:

| # | surface | the failure that looked like a success | status |
|---|---|---|---|
| 1 | bus send | a deposit to a dormant agent was named `deliver` | fixed, merged `7919bb83` |
| 2 | `doctor --repair` | the mirror case: `ok=false` on deliberately preserved regions — success dressed as failure | raised, PR #94 |
| 3 | bus envelope | `to` is decorative: the transport routes on the call parameter and never reads it, so an envelope lands in a box other than its declared addressee with a truthful `deliver` | traced |
| 4 | WP13 dispatch | an unknown dispatch mode creates and registers a tmux session, exits 0, and leaves the pane on a login shell — three success signals for a dispatch that dispatched nothing | in rework |

Case 4 is the WP13 lane's own measurement, cited as theirs; it was not re-run here. Independently
corroborated from this side only in that `dispatchMode` / `dispatch_mode` appears **nowhere** in
`packages/*/src` (control: `dispatch` appears 16× in `cli.ts`), so no field exists to reject against.

`[JUDGMENT]` Case 2 matters most for reading the invariant correctly: it is **symmetric**. A tool that
cries failure when it succeeded trains its reader to ignore it — and they ignore it on the day the
failure is real. The remedy has the same shape in both directions: a single outcome field that
collapses two distinct states must be **split**, with the detail living in a structured list rather
than in the outcome bit.

---

## 4. Measured state, and where each measurement stops

`[MEASURED 2026-08-02, at publication]` `surface/I1` and `surface/I4` were re-measured on `origin/main`
at the moment of committing, because a table like this asserts the present tense:

- **`surface/I1` — violated.** `packages/h2a/src/runtime/identity/bindings.ts:46-50`:
  `IdentityBindingKey` is `{host, providerSessionId, workspaceId}`, and `findBinding` (:89-92) matches
  on `host` + `providerSessionId` only. `providerSessionId` changes per conversation, so a new
  conversation mints. **The key contains precisely what changes.** Repair belongs to WP5 (`runtime`).
- **`surface/I4` — satisfied.** `packages/h2a/src/runtime/identity/live.ts:60` declares a single closed
  vocabulary `H2A_DECLARED_CAPABILITIES`; `:69` derives the type from it; `:91` filters unknown
  capabilities out rather than admitting them.

`[SNAPSHOT 2026-08-01 — NOT re-measured today, and I say so rather than implying an audit]`
`surface/I2`, `surface/I3` and `surface/I5` were assessed on 2026-08-01 by `runtime` (WP5) and the
plugins lane, with file and line cited at the time: I2 satisfied at the sites traversed; I3
**partial** — the discipline exists but no structural per-object marker does, so its rung is *habit*,
not *structural*; I5 satisfied at the send path under the corrected wording. Those three rows may have
moved since. Anyone citing them should re-measure first — the same rule this file applies to itself.

**Where the invariants stop, collectively.** Nothing rejects a violation. There is no test, no schema,
no CI gate that enforces any of the five. Their rung is *agreed*, and an agreement holds exactly as
long as the parties remember it — which is why the honest first step was to write them down rather
than to claim more for them.

---

## 5. How to use this file

`[JUDGMENT]` When a lane reports "a guard is missing here", check first whether it is a violation of
one of the five, and **name it by the invariant rather than by a local requirement number**. A numbered
requirement is satisfied locally and then forgotten; a named invariant sorts the next case too. That
is the entire practical value of writing them down — and it only works because the identifier now
resolves, and resolves to exactly one thing.

Conversely: do not cite an invariant to win an argument about something it does not cover. The five
above are the whole set. There is no `surface/I6`.
