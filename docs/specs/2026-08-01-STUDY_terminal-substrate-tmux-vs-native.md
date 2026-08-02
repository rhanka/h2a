# STUDY — Terminal substrate: tmux, or a native equivalent?

- **Author** — `arch` (WP6). **Measurements** — `runtime` (WP5), cited as his throughout.
- **Date** — 2026-08-01
- **Commissioned by** — the owner, routed via `runtime`; tracked item `01KYTQQ9MRE6RD1TZ8X8CAE7KH`
- **Recommendation** — **keep tmux as the terminal.** Build native only where it pays: a process
  ledger, which is a missing field on the session lease, not a second registry.
- **Built half** — `docs/specs/2026-08-01-DESIGN_session-lease-worker-attribution.md`, committed at
  `8f697b01` (PR #133). This study is the reasoning; that document is the design it authorises.

Every load-bearing claim is tagged `[FACT]` (measured, with its owner named) or `[JUDGMENT]` (my
read). No measurement in this study is mine: they are `runtime`'s, taken on 2026-08-01, and I cite
them as his. Where I verified something myself, I say so.

---

## 1. The question was mal posée, and reposing it shrinks it

The owner asked, verbatim: *is tmux really the best way to wrap, in the end? could h2a not natively
manage a tmux equivalent in node?* That is a question about **means**. The question that decides is
upstream:

> **Is the terminal the session, or a view of the session?**

The difference is the whole weight of the decision:

- if the terminal **is the session**, the substrate holds durable state, its survival is critical,
  and replacing it is a deep change;
- if the terminal **is a view**, the substrate holds a display and an attachment, its survival is
  comfortable but not critical, and replacing it is a tooling choice.

`[FACT — runtime, M3]` **The terminal is already a view.** Conversation state lives in a file at the
CLI host, not in tmux and not (yet) at sentropic: the measured transcripts are per-project `.jsonl`
files (e.g. 445 KB for one lane), and `claude --resume <uuid>` reloads that file. tmux holds a
display and an attachment. The de-facto authoritative holder today is the CLI host.

`[JUDGMENT]` **A correction I owe.** I first argued this was already settled by the WP13 governing
contract — *sentropic owns the running loop; the engine's executionId is the authoritative session
identity*. `runtime`'s measurement shows the contract describes the **target**, not today's state.
My conclusion held; my reason was wrong. I had cited an intended state as if it were the current
one. The conclusion is now stronger than it was: the terminal is a view **by measurement**, not by
a contract yet to land.

`[JUDGMENT]` **The real risk of the native option follows from this.** It is not that a native
terminal would be worse than tmux. It is that it could **become the session again** — two engines to
maintain, which the WP13 study names as its riskiest hypothesis, and which this project has already
paid for elsewhere. If native is built, the binding design constraint is not *be better than tmux*,
it is **stay a view**.

---

## 2. What decides, criterion by criterion

| # | criterion | verdict |
|---|---|---|
| C1 | survival across the supervisor's death | tmux gives it free |
| C2 | ownership of the process tree | the one real argument for native |
| C3 | control of the status bar | a weak argument; do not decide on it |
| C4 | hot pivot to k8s | shrinks once C0 is settled |
| C5 | the silent failure | independent of substrate |

### C1 — Survival. tmux gives it free, and structurally.

`[FACT — runtime, M1]` What survives the death of an h2a process: the tmux **server**, every pane,
the running claude/codex CLIs, and their in-flight work. Proof given: pane pids parent to the tmux
server; the `mcp-serve` processes have other parents and are ancestors of no pane. What falls: the
MCP bus (wake injection, inbox delivery), the presence heartbeat, the status-bar writer — **no
durable state, only the coordination plane**.

`[JUDGMENT]` A native node terminal keeps this property only by maintaining a separate, detachable,
long-lived server — at which point tmux has been rewritten. So C1 is not a preference: it is a
structural asymmetry.

### C2 — Process-tree ownership. The one argument for native that holds.

`[FACT — runtime, M5]` The working child **cannot** be attributed to its lane without walking
`/proc`. `pane_pid` returns the pane's immediate process — the bash wrapper — while the real worker
is a grandchild. tmux exposes only `pane_pid`; there is no tmux command for the process subtree.

`[JUDGMENT]` This is why the session pool was miscounted three times by name, and why both the
conductor and runtime spent a day walking `/proc`. Attribution is the precondition of the slot cap
and of the session lease. So native buys something real here — and it is not the display.

### C3 — The status bar is a weak argument, and it was a stated motivation.

`[JUDGMENT]` Deciding *what to show* and knowing how to *compute* it is durable work: that
information must be rendered somewhere whatever the substrate. Only the *rendering into a tmux bar*
is throwaway. "We would control the bar better" is therefore a reason to repair the renderer, not to
replace the substrate. Had this criterion carried the decision, we would have optimised the cheapest
part.

### C4 — The hot pivot shrinks once C0 is settled.

`[JUDGMENT]` Migrating a **view** is a far smaller problem than migrating a **session**. Study 3
should shrink accordingly. If it does *not* shrink, that is itself the finding: it would mean the
terminal holds state it should not hold, and that becomes the principal result of this study rather
than a note in it.

### C5 — The silent failure is a criterion, not a bug. And it is substrate-independent.

`[FACT — runtime, M2]` The status-surface install is locally transactional: it snapshots values,
moves a marker `@h2a_status_surface` from INSTALLING to v1, rolls back and returns `false` on any
failed set. **A success boolean exists at install time.** But that marker is read only by install
and uninstall themselves; a grep across `packages/` finds **no downstream consumer** and no fleet
auditor that re-reads live sessions to confirm the surface is present.

`[JUDGMENT]` So the silence is **structural, not accidental**: the confirmation exists and has no
reader. It would reproduce in a native substrate. **Repair the reader, not the substrate.**

`[JUDGMENT]` And this is the most reusable result of the study, because the shape is not specific to
the bar:

> **A locally-correct result that nobody consumes downstream.**

The same shape produced: a journal appended without being made durable; a gate whose verdict no
consumer reads; a cap correctly computed and never applied. This repository mass-produces it.

---

## 3. Recommendation

**Keep tmux as the terminal.** Three measurements converge, and none depends on an intention:

- `[FACT — M3]` the conversation state is not in the terminal, so replacing it puts no durable state
  at stake and gains none;
- `[FACT — M1]` tmux gives survival free and structurally;
- `[FACT — M4]` removal costs **six functional surfaces** — launch, attach, restore, liveness probe,
  wake/prompt delivery, enumeration/identity — out of seven. Only the status bar is cosmetic.

`[JUDGMENT]` Replacing tmux would buy one cosmetic surface and pay six functional ones. That is not a
close call; it is an order of magnitude.

**Build native where it actually pays.** `runtime`'s framing, which I endorse: *the native thing is
not a terminal, it is a ledger of processes.* That dissolves the owner's question instead of
answering it — the question bundled two objects, the **view** and the **registry**, and the ambiguity
came from there.

**And the ledger is not a new object.** `[FACT — runtime]` `SessionLeaseStore`
(`packages/h2a-runtime/src/session-lease.ts`) already exists, machine-scoped, beside `registry.json`
and *not* under any `.track/`, with clockless reader-computed abandonment and a per-acquisition
generation token. **I verified this premise myself on `origin/main`** before signing: the file is
there, 485 lines, header `MACHINE-SCOPED session lease store`. The ledger is therefore a **missing
field** on that lease, not a second registry — building it separately would create two readers that
diverge, which is the failure this repository keeps paying for.

`[JUDGMENT]` One honesty note on my own contribution: two days earlier I "arbitrated" that a session
lease should be machine-scoped and take the shape of track's lease store. The measurement shows it
**already was**. I described an existing design; I did not decide one. That is a confirmation, and it
should not be cited as a decision.

---

## 4. Where this stops

| guarantee | rung | where it stops |
|---|---|---|
| The terminal is a view | **measured** (M3) | true while the CLI host holds the transcript. If WP13 lands and sentropic owns the loop, the thing to re-evaluate is not tmux but **what the pane is attached to**. |
| tmux survival | **structural** (M1) | measured on this host, with one tmux server. |
| Removal cost = 6 functional surfaces | **measured** (M4) | an inventory of call sites, not a proof that each is exercised. |
| Attribution needs `/proc` | **measured** (M5) | true of tmux's exposed interface; a future tmux could change it. |
| The silent failure is structural | **measured** (M2) | grep-based absence of a consumer; a consumer added elsewhere since would falsify it. |
| The ledger is a field, not a registry | **measured** | ~~design only; nothing is built yet~~ — **corrected 2026-08-02, see below.** Built and on `main` as `6f4433b2`. |

**CORRECTION, 2026-08-02.** The row above originally read *"authorised by the design doc at
`8f697b01`; nothing is built yet."* **That was false at publication, not merely aged.** The worker
attribution landed on `main` as `6f4433b2` (*feat(runtime): session-lease worker attribution — #106
extension (R1-R4)*) at 2026-08-01 11:07:45 -0400; this study merged as `92b529c2` later the same day,
so the implementation had been on `main` for roughly two and a half hours when I published the claim
that nothing was built. `git merge-base --is-ancestor 6f4433b2 92b529c2` confirms it. The lease now
carries `bootId`, `machine`, `pid` and `startTime` in source — verified with positive controls
(`ttlMs`, `heartbeatAt`, `token` all present, so the probe discriminates).

`[JUDGMENT]` The error is the one this study itself warns about in §1: **I cited a state without
re-measuring it at delivery.** Writing "nothing is built yet" is a claim about *now*, and *now* moved
between drafting and merging. The rule I take from it, and it generalises past this document: a
"where this stops" table asserts the present tense, so every row in one must be re-measured at the
moment of publication, not at the moment of drafting. Nothing else in the study depends on this row —
the recommendation rests on M1/M3/M4, which are untouched.

**What would overturn the recommendation.** Evidence that one of the six functional surfaces is
already broken or not actually carried by tmux (the removal cost drops); or a hot-pivot requirement
that makes a tmux attachment non-migratable where a native one would be (that is Study 3's object).

**What I did not verify.** None of runtime's `file:line` citations, thresholds, or process ids. They
are his measurements, taken on 2026-08-01, and this study rests on them. I verified exactly one
thing myself — that `session-lease.ts` is on `origin/main` — because it is the load-bearing premise
of the built half. If a single one of the other measurements is wrong, the corresponding row above
moves, and I would rather say that than imply an audit I did not perform.

---

## 5. Consequence for work already in flight

`[JUDGMENT]` `runtime`'s in-progress fix to the tmux status bar is **not** a transition measure. The
substrate stays; the fix is a durable investment. I told him not to suspend it while this study ran,
and the recommendation confirms that call rather than merely permitting it.
