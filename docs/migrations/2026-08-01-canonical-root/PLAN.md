# Migration note — canonical h2a root (decision 01KYRBCJ, option A)

**Owner of the act:** coop (WP2, presence). **Identity visa:** arch (WP6). **Store/runtime GO on
pin removal:** runtime (WP5). **Item:** 01KYQYJNDC48T6707T47BBYXJZ. Written 2026-08-01, pre-execution.

## What A is, and what it is not

Option A = "remove `--root` from `~/.claude.json` so every host resolves the same default
(`~/h2a-workspace/.h2a`); the pinned store `/home/antoinefa/src/a2a-cli` becomes legacy." It is
**not** a config edit — the pinned store carries live, exclusive data:

- **804** inbox envelopes exclusive to the pin (dedup by id) — incl. cond 272, runtime 75, both
  reading the pin **right now**;
- **380** keys, **190** identity aliases exclusive to the pin;
- every actor's mail and identity is **split** across both roots.

Removing the pin naively orphans the mail and loses the keys/aliases. So A is a **multi-step
migration**, reversible-first, pin removal last.

## Ordered plan (reversible first — arch's correction)

0. **Snapshot** both roots (tar) — the rollback.
1. **Re-measure** at execution time (mail keeps arriving on the pin).
2. **Preserve mail verbatim at its original address** (append-only, idempotent, re-playable). The
   pairing pin-id<->default-id has **no reliable signal** (presence is ephemeral+incomplete;
   legacyInstance is ambiguous to thousands — `claude:geo` -> 8436), a direct consequence of
   per-session identity re-anchoring. So the safety goal (no mail lost) does NOT re-address and does
   NOT pair: pin-id-X's mail stays at pin-id-X's address under the default, inert until an edge exists.
   Split by dir type (measured):
   - **61 full-id dirs (767 env): verbatim-preserve.** A full id `host__label__hex` is one specific
     instance; same name on both roots = same actor; merge is dedup-by-id, safe.
   - **12 legacy-label dirs (77 env, e.g. `graphify-conductor` 62): PRESERVE but do NOT auto-merge.**
     A bare label can be claimed by several actors (cross-read guard), so merging into a default
     legacy dir could join two actors' mail. Preserve them un-merged; their routing is a
     principal-attestation act (below), never an auto-merge.
   NOT presence (ephemeral; re-registers).
3. **Routing edge — OUT OF THE MIGRATION CRITICAL PATH; a separate PRINCIPAL ATTESTATION.** To let a
   live actor read its old pin-id mail, an edge `{instance: default-id, legacyInstance: pin-id, at}`
   via `recordIdentityAlias`. It needs the pin-id<->default-id link, which is **not derivable** — so it
   is **not computed, it is CONFERRED by the principal** (the operator, who possesses both), one at a
   time, with evidence. The note records it as **"principal attestation," never "pairing established"**:
   a future reader must see the link was conferred, not calculated (arch: an agent self-attesting is
   refused; the principal conferring an actor's identity proves nothing, it founds — no infinite
   regression). arch visas each such edge when it is made, not as part of the migration.
4. **Key switch (last, irreversible): MOVE the 380 pin keys to default + keep pin as backup.**
   NOT duplicate (arch: no doubling of secret exposure on an unenforced host).
5. **Verify superset** — recount every id/key/alias; one miss => STOP. Final re-scan of the pin
   immediately before removal (runtime: `pop` deletes on read, so late mail must be caught).
6. **Remove the pin** (GATED: runtime GO + arch visa) — last step. Then **quarantine** the pinned
   store read-only, never delete (owner rule).

## Four verified facts (all measured, controls passed)

1. **Reason next to conclusion.** The key relocation is safe **because no read restriction exists
   today between the two stores** (this host has no landlock, seccomp unapplied, both roots under one
   user) — **NOT** because keyrings are distinct. The day enforcement arrives, the same move becomes a
   widening. A conclusion must not survive its premise.

2. **Anteriority (the "first-claimant" race).** Verified: **0** legacyInstance values are full
   instance ids — they are all labels. Routine connects are *structurally incapable* of claiming a
   full pin-id as legacy; only a deliberate migration edge can. Today the field is free.
   **Precondition:** re-verify no instance has claimed `pin-id` as legacyInstance **immediately before
   writing the edge**, and record the result here.

3. **Q3 loss list (two columns).**
   - **CAUSED (blocking): EMPTY, verified both directions.** All 380 pin keys move (none left behind),
     and the pin key-name set ∩ default key-name set = **0** (no move overwrites a default key).
   - **REVEALED (non-blocking, NOT a property of this migration — arch's package): DISQUALIFIED as
     a global claim.** Measured **0** across 11 negotiation journals (control passed: 11 read, 2
     participants) — but **0 `body.kind=signature` entries were present in that surface**, so the zero
     means "in the swept surface there was no signature to lose," NOT "nobody lost proof." The
     surface where proof-of-possession actually lives — **signed envelopes** (every h2a envelope
     exchanged carries a signature) — was **NOT swept**. REVEALED is a fact about the world, not
     caused by this migration; arch takes the signed-envelope sweep in its package (WP6), on its own
     slot or via runtime. This migration's obligation is the CAUSED column, which is empty and
     verified both directions.

4. **Overwrite check, BOTH surfaces, BOTH directions.**
   - Key names: pin ∩ default = **0** — the move overwrites no default key.
   - Inbox dir names: pin ∩ default = **33**, of which **32 are full ids** (same actor, safe
     dedup-merge) and **1 is a legacy label** (`claude__aclp-am`, **0 env** — trivially safe). No
     full-id dir merges two different actors. The 12 legacy-label dirs are handled by (2) above, not
     auto-merged. "Empty by construction" is re-posed at each surface, not assumed to generalise.

**Free strength of the verbatim cut (measured):** 11 pin-ids have no live default twin, and some may
have **never had a default identity** (actors that only existed under the pin). Any pairing-based plan
would have had to special-case or lose them; verbatim preservation keeps their mail at its address,
waiting, with no special case.

## Orthogonality to the coming identity fix (`findBinding`/`bindings`) — measured

This migration touches **inbox** (verbatim preserve), **keys** (move), **aliases** (attestation
edges) — and **NEVER `bindings.jsonl` / `findBinding`**. Measured: inbox routing reads
`listIdentityAliases` (aliases.jsonl), not bindings (`store.ts`); recipient resolution (`paths.ts`)
reads neither; `bindings.jsonl` is read only by `findBinding` in identity resolution (`live.ts`),
which is the identity fix's territory. So the earlier plan's "union the 190 pin-exclusive bindings"
is **DROPPED** — mail preservation does not need it. The 190 pin bindings are **left to the identity
fix (WP5)**, which owns `findBinding`. The two workstreams are orthogonal: this migration writes
inbox/keys/aliases; the fix rewrites bindings lookup. Neither invalidates the other.

## Fail-safes

Snapshot before; verify superset before removal; final re-scan before removal; any doubt on
completeness => do not remove the pin; never delete the pinned store (quarantine); no byte written
before arch's visa + runtime's GO.
