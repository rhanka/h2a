# Architect visa on the RACI, and arbitration of WP7

- **Author** — `architect`, durable actor, WP6 (identity, auth & NHI; inter-lane coherence; package boundaries)
- **Date** — 2026-07-29
- **Baseline** — h2a `main` at 0.88.0, acceptance baseline `996d9ccd1011`, track store 685 events
- **Anchor decision** — `01KYQ89WANWD257Y3GCW7YM8BZ` (durable actor model, option A, outcome `go`, 2026-07-29)

This document delivers the two things the ratified actor model owes to the architect role, and
nothing else. The arbitration in Part 2 was registered in track as a *pending* orientation decision;
the owner then ruled on it the same day.

> **OUTCOME, 2026-07-29 22:02Z — decision `01KYQXRSCFPC8GQXSXNAF82YQ6` (`D8`): the owner selected
> option B, outcome `go`.** Applied as recommended, and only as recommended: the 8 leaves were
> reparented (WP2 ×3, WP5 ×2, WP9, WP12, WP14), `track validate` reports 0 integrity findings, and
> **the emptied WP7 container was NOT cancelled** — per the safety condition in §2.6. The affected
> actors' briefs (`coop`, `runtime`, `harness`, `portal`, `gateway`) were updated in the same pass,
> which §2.9's pre-mortem made a condition of applying B at all. Consequences to read knowingly: WP2
> is now 13/18, WP5 6/26, WP9 3/13, WP14 1/6 — WP2 and WP9 rose on inherited deliveries, not on new
> work. WP7 no longer renders in the report, since an empty container has nothing to show.
>
> Part 1's visa remains a *counter*, not an endorsement: it takes effect when its three conditions
> are in `docs/governance/RACI.md` and the three governance artefacts are committed.

Every load-bearing claim is tagged `[FACT]` (verifiable, source given) or `[JUDGMENT]` (my read).

---

## Part 1 — Visa on the RACI (mandatory advice)

### 1.1 Verdict

**Conditional endorsement** of the actor→WP assignment ratified on 2026-07-29, with one correction
(WP7 — Part 2), three conditions (§1.4) and one observation (§1.6).

The recorded dissent on WP4 stands. I do not re-litigate it: the owner ruled `conductor`, citing the
precedent of his other projects, and the dissent is written into the dossier so a future conflict
over the conductor's authority is read in that light. My visa concerns whether the chosen
counterweight — *"the conductor defines the RACI on the architect's advice"* — can actually bear
weight. Today it cannot, for two measured reasons.

### 1.2 The RACI is carried by nothing

- `[FACT]` **0 of the 14 WP containers carry `accountable` or `responsible`.** Source:
  `.track/events.jsonl`, all `item.created` payloads for WP1–WP14.
- `[FACT]` **2 of 189 items in the whole store carry either field.**
- `[FACT]` `track item new` accepts `--accountable <a>` and `--responsible <a,a>`. **No CLI verb
  sets them afterwards** — the item surface is `reparent | set-role | scope-declare | spec-amend |
  spec | realize | assign-code | show | ls` (`track --help`, 0.88.0). The 14 containers already
  exist, so the RACI **cannot be written onto them at all** in the current version.
- `[FACT]` The actor→WP map exists as prose inside one decision dossier's `context` string
  (`01KYQ89WANWD257Y3GCW7YM8BZ`).

`[JUDGMENT]` On the enforceability ladder — *structural > test > spec line > habit* — the RACI sits
at **spec line**, while it is being treated as settled governance that routes twelve actors. That is
an assertion wider than its evidence: the defect class this repository keeps reproducing.

**Where my guarantee stops.** I verified that the field is empty and unsettable. I did **not** verify
that `track report` or any other consumer would read the field if it were populated; making the RACI
structural may need a consumer as well as a writer.

### 1.3 The journal cannot attribute an actor

- `[FACT]` **All 685 events in the store are attributed `by: human:fabien.antoine@m4x.org`**, with
  `prov.auth: local-user` and `prov.transport: cli`. One single value, no exceptions.
- `[FACT]` No CLI flag sets the writer identity.

`[JUDGMENT]` Twelve durable actors have just been told to report through this journal. Every write
any of them makes will be signed as the owner. **A RACI whose accountability cannot be attributed in
the record is decorative**: it names who must answer, and the record cannot say who acted. This is
the same doctrine as the h2a bus `actor` field, which nothing verifies — identity is proven by
possession, not by a name, and refusing is better than resolving. WP6 owns this one; it is traced.

### 1.4 The three conditions of my visa

**C1 — Carry the RACI in the fields, not in prose.** Populate `accountable`/`responsible` on the 14
containers. Blocked today by the missing verb (§1.2); traced as a WP8 item, with the WP4 item
depending on it. Until then, any statement of the form "actor X is responsible for WP N" is a habit.

**C2 — Make the architect's advice a required artifact, not a habit.** The counterweight the owner
chose is advice, not ownership. Advice that is neither solicited nor recorded is the bottom rung of
the ladder, and it will be skipped exactly when it matters — under time pressure, on the conductor's
own authority. Minimum opposable form: **any change to WP ownership, to the actor→WP map, or to the
conductor's authority carries a track decision whose dossier includes the architect's advice —
refusable by the owner, not skippable.** This gives me no ownership of WP4; it makes the chosen
counterweight real instead of customary.

**C3 — Attribute the writer (§1.3).** Until an actor's writes are distinguishable from the owner's,
no per-actor progress figure can be read as that actor's work.

`[JUDGMENT]` C1 and C3 are prerequisites of *any* RACI, whoever owns WP4. C2 is the one that follows
from the owner's own ruling: he kept the operator as owner of the rules and named advice as the
safeguard, so the safeguard must be at least as opposable as the thing it guards.

### 1.5 What I do not contest

- `conductor` owning WP4 — owner's ruling, precedent cited, dissent recorded.
- `coop` holding WP1–WP3 as a single actor — the two legs split on this; the owner ruled the merge,
  and the three packages do share one incident memory (reachability).
- The actor-memory principle itself. It is the right criterion, and Part 2 applies it literally.

### 1.6 Observation O1 — `cyber` is an actor without a memory

- `[FACT]` The ratified model gives `cyber` **no WP**.
- `[FACT]` Its subject matter is currently tracked inside WP9: item `01KYJVQM5JMJ49MTKR2H4K12NK`,
  *"Harness: add a security/cyber discipline (vulnerability register + audit gate + exception
  expiry)"*.
- `[JUDGMENT]` The model's own principle is that owning a WP is what gives an actor a memory and a
  progress figure — *"that is what distinguishes an actor from a grouping of work packages"*.
  `cyber` has neither: its work is counted as harness's. Two coherent resolutions exist — state
  explicitly that cyber's memory **is** harness's package, or give cyber a package. Both are
  roster-level, therefore the owner's. I raise it; I do not decide it, and I do not open an item for
  it, because either resolution changes the roster.

---

## Part 2 — Arbitration of WP7 (decision dossier)

### 2.1 Decision asked

**What becomes of WP7 ("Infra, deploy & MCP")?** Four options: **A** status quo · **B** dissolve by
leaf destination *(recommended)* · **C** dissolve into runtime · **D** keep a slimmed WP7. Scope:
the WP7 container and its 8 leaves. Nothing else in the roster moves.

### 2.2 Context

**Facts.**

- `[FACT]` WP7 = `01KWWXCD5BN2G3D97S07HS5JMN`, currently **8 leaves**, reported **4/8 (50%)**.
- `[FACT]` **11 leaves have been parented to WP7 over its life; 3 have already left**, and they left
  to **three different packages**: EVO-12 gateway broker → WP12, *x2 gateway/Claude subagent-proxy
  bug* → WP14, *x9 our own CLI / gateway broker* → WP13. **None went to WP5.**
- `[FACT]` The ratified dossier records, in the same text, that runtime owns *"WP5, 7"* **and** that
  both consensus legs converged **2/2** on *"éclater et dissoudre WP7 (sa part MCP vers portal, son
  infra et son cluster vers runtime)"*. The ratified option is internally inconsistent on this line.
- `[FACT]` Item `01KYJ4FW5M3ET5241P67ECGSMT` (2026-07-27) left one divergence open for the owner:
  create a **new** integration WP versus **rename** WP7 into it — noting that only one of WP7's
  leaves is MCP-related. **That divergence is now resolved by fact**: WP12 *"MCP connector brokering
  & sharing"* exists and holds the integration subject, so the rename branch is moot.
- `[FACT]` WP5 already carries **31 leaves** in the log (the report projects 22 in its counter) —
  by a wide margin the largest package, at 27%.
- `[FACT]` WP7 has **no stored code** (no `item.code-assigned` event; only WP12, WP13 and WP14 have
  one). Its "7" is positional.

**Assumptions.** That the actor-memory criterion from the ratified dossier — *two perimeters that
remember the same incidents are one actor* — is the criterion to apply leaf by leaf. That is the
model's own principle, not one I am importing.

**Unknowns.** Whether the report's percentage consumer treats a reparented `done` leaf as a delivery
of its new package retroactively (it should, being a projection of the log, but I did not verify it).
Whether the owner wants historical `done` leaves to move at all (§2.6).

### 2.3 Stakes

Dossier-level, on three hard triggers: **cross-owner** (the mapping moves leaves between four
actors' packages — coop, runtime, harness, portal, gateway), **workpackage impact** (it changes four
packages' denominators and therefore their percentages), and **it modifies a settled decision** —
the ratified option A says runtime owns WP5 **and** WP7; dissolving WP7 changes runtime's charter to
WP5 alone.

`[JUDGMENT]` The cost of *not* deciding is the one already being paid: WP7's 50% is not a statement
about anything, because the package is not a subject. It is the only WP in the roster whose leaves
have historically migrated out to three different packages.

### 2.4 The leaf-level reading

Criterion applied to each leaf: **which actor re-reads this incident?**

| leaf | state | destination | why |
| --- | --- | --- | --- |
| Root unification — honor `H2A_ROOT` + doctor (0.60–62) | done | **WP2** coop | the incident is a split bus store: agents on different roots were unreachable. Reachability is coop's memory. |
| Sweep 6 leftover repo-local `.h2a` buses once agents reconnect | to-do | **WP2** coop | same bus, and the gate is *live presence* |
| *x1* — finish the cleanup of the 6 local `.h2a` buses | done | **WP2** coop | the same incident as the two above |
| Test bus isolation — stop tests polluting the shared bus | done | **WP9** harness | the durable rule is a test-environment rule; harness owns test gates |
| EVO-13 k8s ingester MCP-pod sidecar (RWX constraint) | to-do | **WP5** runtime | cluster substrate; the RWX node-pool capacity constraint is runtime's memory |
| h2a resource governance — cgroups, prioritisation, anti-OOM | to-do | **WP5** runtime | session and child-process lifecycle |
| *x4* — `h2a mcp` to register MCP connectors in the CLIs | to-do | **WP12** portal | verbatim WP12's charter |
| Terra xhigh by default + local Claude/Codex deploy | done | **WP14** gateway | model routing and presets. `[FACT]` the same subject already has an item in WP14 (`01KY7K95K4Y24ZQKTXQDD1EMNH`), so leaving this leaf in WP7 splits one subject across two packages. |

`[JUDGMENT]` **8 leaves, 5 destinations, 4 actors.** This is the decisive finding, and it is *not*
what the two legs concluded: they mapped WP7 to two destinations (MCP → portal, the rest → runtime).
Three of the eight leaves belong to **coop** and **harness**, neither of which the legs named. WP7
is not a theme that mixes two domains; it is a staging bin whose leaves have always drained
elsewhere, one at a time.

### 2.5 Options

| id | choice | strongest case FOR | strongest case AGAINST | cost | reversibility | what would make it win |
| --- | --- | --- | --- | --- | --- | --- |
| **A** | Status quo — WP7 stays, runtime owns WP5+WP7 | Matches the ratified option A verbatim; zero churn; no percentage moves; the owner has already ruled once today and may not want the roster touched again | WP7's 50% remains a number about nothing; 3 of its 8 leaves belong to actors who do not own WP7 and will not re-read it; the ratified text is left self-contradictory | none | n/a | if roster churn is itself the risk to minimise today, or if the owner wants one restructuring per week, not per day |
| **B** | **Dissolve by leaf destination** — 8 leaves → WP2 ×3, WP5 ×2, WP9, WP12, WP14; WP7 emptied now, cancelled only once reopen/code-release lands | Each leaf lands with the actor that re-reads it, which is the ratified model's own criterion; ends a 5-week drain that has already moved 3 leaves to 3 packages; no package becomes a bin; the reparent step alone is a plain event and reversible | 5 destinations is more moving parts than any leg proposed, and the mapping is mine alone — no independent leg has reviewed *this* table; it changes four packages' percentages at once, so several progress figures move for reasons unrelated to work delivered | 8 reparent events + 1 deferred cancellation | reparenting is reversible event-by-event; the deferred cancellation is the only sticky part | if the actor-memory criterion is the right one, applied literally |
| **C** | Dissolve into runtime — 7 leaves → WP5, 1 → WP12 (the legs' literal mapping) | It is exactly what the double consensus concluded, 2/2; simplest mapping; one owner (runtime) for all the plumbing | Reproduces the defect inside WP5: already 31 leaves at 27%, it becomes a 38-leaf bin and *its* percentage stops meaning anything; contradicted by history — WP7's leaves have never once migrated to WP5; puts bus hygiene under runtime while the bus is coop's | 8 reparent events | reversible | if minimising destinations matters more than the actor-memory criterion, or if the legs' authority should override my leaf reading |
| **D** | Keep a slimmed WP7 "machine substrate" — move only the MCP leaf (→WP12) and the gateway leaf (→WP14), keep 6 | Preserves a real subject (buses, root, doctor, k8s, cgroups) that item `01KYJ4FW…` argued *is* coherent plumbing; smallest change that fixes the "mixes two domains" complaint; keeps the roster contiguous with no dead position | The remaining 6 leaves still answer to three actors (coop ×3, runtime ×2, harness ×1), so the percentage stays unreadable — it fixes the label, not the defect; leaves runtime owning two packages whose boundary no actor uses | 2 reparent events | reversible | if the owner reads WP7 as a genuine substrate theme and wants a container for machine plumbing regardless of who remembers it |

### 2.6 Recommendation — **B**, with one safety condition

`[JUDGMENT]` **B.** The decisive fact is the drain: 3 of 11 leaves have already left WP7, to three
different packages, none of them WP5. That is five weeks of evidence that WP7 has no subject and
that its leaves know where they belong. Applying the ratified model's own criterion leaf by leaf
gives 5 destinations across 4 actors, which is the arithmetic proof that no single relabelling —
neither C nor D — can make this package mean something.

**Safety condition (the part that is not reversible).** Reparenting is a plain event, reversible one
by one. **Cancelling the WP7 container is not**, and today it is also unnecessary:

- `[FACT]` positional derivation counts cancelled containers, so cancelling WP7 leaves the roster
  reading WP1–WP6, WP8–WP14 with **position 7 pointing at nothing** (defect
  `01KYQ880PVWX23R8MDRXXSCAYC`).
- `[FACT]` WP7 has **no stored code**, so the code `WP7` itself stays re-assignable later — the hole
  is cosmetic, not permanent. This is narrower than the WP12/WP13 damage of this morning, where
  cancel-and-recreate required event surgery.
- `[JUDGMENT]` Therefore: **reparent now, cancel later.** Leave the emptied container inert until
  the ratified reopen capability and the code-release defect land (`01KYQ5KM21KEGWXTEAGRYB4STD`,
  `01KYQ880PVWX23R8MDRXXSCAYC`). An empty container renders as nothing to do; a botched
  cancellation costs event surgery.

**Historical leaves.** B moves the 4 `done` leaves as well as the 4 open ones. That is deliberate:
the memory of a delivery belongs to the actor who will re-read it. It also means WP2 gains 3
deliveries and WP9 gains 1, so **their percentages rise for reasons unrelated to work done today**.
If the owner prefers percentages that never move retroactively, the variant is to reparent the 4
open leaves only and keep WP7 as a historical container — that is option **D** in effect, and it
keeps the defect.

### 2.7 Reversibility and cost

Eight `track item reparent` calls, one per leaf; each is a single event and individually reversible
by reparenting back. No code changes, no tests, no release. The cancellation is deferred, so the
only sticky artefact is the empty WP7 container. Total effort: minutes. Rollback: minutes.

### 2.8 Attendus (the owner's validation criteria)

| criterion | source | covered by | gap |
| --- | --- | --- | --- |
| A WP's percentage must mean something | brief to `architect`: *"son avancement est aujourd'hui dénué de sens"* | §2.4, §2.6 | none for WP7; WP5 stays unreadable at 31 leaves — separate concern, not opened here |
| Do not widen scope mid-lane | COMMON.md | only WP7's 8 leaves move; nothing else is reparented | none |
| Do not decide what belongs to the owner | BRIEF-arch.md | registered as a *pending* orientation decision; nothing applied | none |
| Never declare done without owner UAT | COMMON.md | no item is closed by this document | none |
| Merge policy, no AI co-authoring, `.track` single-writer | COMMON.md | no merge, no commit made by this document; track writes from repo root | none |
| Double consensus on a design decision | repo standing rule | 2/2 legs exist on *dissolving* WP7; **my leaf-level table has had no independent review** | **open — §2.9** |

### 2.9 Self-audit

**Strongest case against my recommendation.** The two independent legs concluded C, not B. They were
two; I am one. `[FACT]` My leaf table has had no independent review, and I could not obtain one:
this session is instructed not to dispatch subagents. If the mapping is wrong on even two leaves,
B scatters work across packages that will not remember it, and re-collecting it costs more than
C's single bin ever would. C also has a virtue B lacks: one owner for all the plumbing means one
actor to ask when the plumbing breaks at 2 a.m., whereas B splits bus hygiene from cluster substrate
across two actors who must then coordinate.

**What would overturn B.** Any of: the owner reads bus-store hygiene as machine plumbing rather than
reachability (then coop's 3 leaves go to runtime and C is nearly right); the owner wants percentages
that never move retroactively (then D); an independent leg reviews the table and disagrees on ≥2
leaves; or the owner decides the roster is not to be touched again this week (then A, and the defect
is accepted knowingly, which is a legitimate call).

**Pre-mortem.** Six months later this failed because the leaves were scattered correctly but nobody
was told: the reparenting happened, four packages' percentages shifted, and no actor's briefing was
updated — so runtime kept looking for the cgroups item under WP7, coop never noticed it had
inherited the bus sweep, and the work stalled in the seam. The mapping was right and the handover
was never made. **Mitigation: whoever applies B updates the affected actors' briefs in the same
pass, or B is not applied.**

**Agent-interest disclosure.** What is easiest for me: **A** — status quo asks nothing of me and I
close my first action with a document. What is fastest: **C** — copy the legs' conclusion, borrow
their authority, no leaf-level work, no exposure if it is wrong. I recommend **B**, which is the
most work for me, the only one that is mine to be wrong about, and the only one that puts my name on
a mapping no independent leg has checked. `[JUDGMENT]` There is one way B flatters me: it
demonstrates the architect role doing something the two legs did not, which strengthens the case for
the architect's advice being required (my condition C2). The owner should discount §1.4-C2
accordingly, and read it on its own argument — that a safeguard must be as opposable as what it
guards — rather than on this document's usefulness.

**Owner interest, stated separately.** Value: a per-WP percentage the conductor can pilot on.
Integrity: a roster where each package is a subject somebody remembers. Risk: four percentages move
at once, and the WP7 position goes dead until reopen lands. Optionality: reparenting is reversible;
the deferred cancellation keeps the sticky step for later.

### 2.10 What I need from you

One choice: **A**, **B**, **C**, or **D** — or *defer* if you want an independent leg on the §2.4
table first. If **B**, the reparenting is 8 events and the emptied container stays inert; I will not
cancel WP7.

---

## Part 3 — A WP6 defect found while measuring: the durable workspace id has drifted

This is my own package, so it is stated here rather than merely traced.

- `[FACT]` `track workspace-id` at the repo root returns
  `ws:4471ea0ce44cda345ef053f51773215a5b6f0f09aa9f505bef086751f50fb8d2`.
- `[FACT]` **210 of the store's events — the entire WP1–WP14 roster — live under a different
  workspace**, `ws:89c45cc3e040949f1a1a034529722ee877150fd2a0e3da16a7f6e9d8e27f495d`. Four events
  live under the derived id, plus one under `ws:test`.
- `[FACT]` **Root cause, computed not hypothesised.** The id is
  `ws:sha256(rootCommitSHAs + "\n" + worktreeRelPath)` where *all* root commits are taken, sorted
  and comma-joined (`packages/track/src/workspace-id.ts:64-83`). This repo has **two** root commits:
  `ce2f385` (2026-05-18, *"chore: initialize h2a repository"*) and `e195823` (2026-06-03, *"docs:
  initial intention for @sentropic/track"*). `sha256("ce2f385…\n")` reproduces the roster workspace
  exactly; `sha256("ce2f385…,e195823…\n")` reproduces today's derived id exactly.
- `[FACT]` The second root arrived with `e83dd1d` — `git subtree add` of `packages/track/` on
  **2026-07-04**. Every derivation after that commit returns a different id.
- `[FACT]` The observable harm is already in the store: item `01KXBZ9XYPE2T7PYBBQF2NXA42`
  *"Enrollment Lot 0: a2a-cli client foundation"* (2026-07-12) was written under the derived id and
  renders in the report's **`hors WP`** bucket, parentless.

`[JUDGMENT]` The function is documented as *"PATH-independent and MACHINE-independent… salted ONLY
by the repo's root-commit SHA(s)… both of which travel with the repository"*. The salt is stable
against moving or cloning the repo, and **unstable against the repo absorbing another repo's
history** — which is precisely the direction h2a has been going (track absorbed, remote absorbed,
control-plane absorbed, and the single-plugin consolidation intends more). The guarantee is real but
narrower than its name: *durable* holds for the clone, not for the monorepo's history.

`[JUDGMENT]` This matters now, not eventually: twelve durable actors have just been briefed to write
to track. An actor that resolves its workspace the documented way — `track item new --workspace
$(track workspace-id)` — writes into the 4-event workspace and its work never appears under the
roster. The failure is silent: the write succeeds, `track validate` is unaffected, and the item
surfaces as `hors WP`. Traced as a WP6 item. Not fixed here: the fix is a track-side change and it
must not be improvised by me while WP8 owns the store.

**Interim instruction for every actor, until the item is closed** — pass the roster workspace
explicitly:

```
--workspace ws:89c45cc3e040949f1a1a034529722ee877150fd2a0e3da16a7f6e9d8e27f495d
```

Do **not** use `track workspace-id` in this repository.

---

## What this document changed

Nothing in the roster. It registers one pending orientation decision (WP7), states one conditional
visa with three conditions and one observation, and traces four defects: the RACI carried by no
field (WP4), the missing verb that blocks it (WP8), journal attribution that cannot distinguish an
actor (WP6), and the drifted workspace id (WP6).
