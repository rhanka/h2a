# EVOL — Native dispatch conformance contract

Date: 2026-07-29. Revision 3 (2026-08-02), after two independent adversarial review legs and
the WP6 acceptance criteria. This revision preserves every revision-2 disposition; it changes the
form of the claims, not their technical choice.

Rung: **EVOL — paper only.** Authorizes no dispatch code, no engine work, no package change,
no publish, no cutover. §6 states what each later phase unlocks.
Work package: WP13. Track item: `01KWVNYNHVJGA8CCW566PG4WMH`.
Backbone: `docs/specs/2026-07-18-STUDY_h2a-native-agent-and-session-engine.md` §11;
`docs/specs/2026-07-13-SPEC_STUDY_native-agent-via-sentropic.md`.
Reviews reconciled: `docs/specs/reviews/2026-07-29-REVIEW-leg1-native-dispatch-evol.md`
(4 blocking, 4 major) and `-leg2-` (4 blocking, 8 major, 3 minor). §7 dispositions all 23.

## 0. Opposability protocol

This EVOL has one normative surface: the clause registers introduced in revision 3. Explanatory
prose, historical quotations, and code observations outside a register describe context only. A
ratification DEC may incorporate clause ids, but it adds no unregistered requirement.

Every registered clause has these fields:

| Field | Meaning |
|---|---|
| `CLAUSE` | The bounded requirement or explicit non-claim. |
| `PROOF` | A concrete artefact and a command or inspection path. `not-yet-written` means the named artefact does not exist in this checkout. |
| `ENFORCEMENT-LEVEL` | Exactly one rung: `structural` > `test` > `spec-line` > `habit`. |
| `LIMIT` | Where the guarantee stops; no clause implies more than this field says. |

`structural` means a named mechanism rejects the violation. `test` means a named test fails on
the violation. `spec-line` means the requirement is written but this checkout has no rejecting
mechanism. `habit` means practice only. `habit` is intentionally visible: it is not a synonym for
an implemented gate.

The paper-only boundary is itself a clause rather than an assertion in the heading:

| ID | CLAUSE | PROOF | ENFORCEMENT-LEVEL | LIMIT |
|---|---|---|---|---|
| EVOL-00 | This EVOL authorizes no executable dispatch, engine, package, publish, or cutover change. | This header and `git show -- docs/specs/2026-07-29-SPEC_EVOL_native-dispatch-successor-contract.md`. | `spec-line` | A reader can detect a contradictory paper claim, but the document cannot reject a code commit. |

### 0.1 Current-tree evidence snapshot (re-verified 2026-08-02)

| Observation | Concrete source / verification |
|---|---|
| The live front authority is the ordered `bin.ts` chain; runtime fallback is reached at its final `shouldDispatchRuntime(argv)` branch. | `packages/h2a/src/bin.ts:110-284`; inspect with `nl -ba packages/h2a/src/bin.ts | sed -n '110,284p'`. |
| The runtime predicate is first-token fallback: every non-native first token crosses its lazy boundary. | `packages/h2a/src/bin-routing.ts:31-49`; `node --test packages/h2a/test/bin-routing.test.js` exercises the current predicate. |
| Runtime `main()` migrates configuration before profile-menu or Commander parsing. | `packages/h2a-runtime/src/index.ts:2302-2318`; inspect with `nl -ba packages/h2a-runtime/src/index.ts | sed -n '2302,2318p'`. |
| An ordinary `run` selector resolves through `LOCAL_CLI[profile] ?? profile`; the existing `run` action creates a local tmux session and enrolls it. | `packages/h2a-runtime/src/index.ts:1946-2003,5344-5945`; creation and enrollment are at `:5728-5747` and `:5855-5868`. |
| The interactive wrapper drops a TTY pane to `/bin/bash -l` after its CLI exits. | `packages/h2a-runtime/src/tmux.ts:92-102`. |
| The legacy runtime `resume [slug]` command has its own registry/slug failure handling. | `packages/h2a-runtime/src/index.ts:4948-5341`. It is distinct from the frozen but unimplemented top-level spelling `h2a --resume`. |
| CI runs `scripts/check-public-contract.sh`, which compares MCP and CLI-verb goldens and the core anti-cycle, not bare/`--resume` dispatch behavior. | `.github/workflows/ci.yml:60-64`; `scripts/check-public-contract.sh:12-38`. Reproduce the coverage audit with `rg -n 'check-public-contract|h2a-public-contract-v1|--resume' .github scripts docs packages`. |

The source trace for an ordinary unknown `h2a run <selector>` is the baseline for §4.3: with no
structured option, the selector reaches `localCliCommand`; a previously absent slug passes the
existing-session check; `startLocalSession` creates tmux and persists its launch context; `enrollFromRun`
records the session; and `LOCAL_WRAPPER` leaves an interactive pane as a login shell. The default
single-run path forwards the tmux attach status (`packages/h2a-runtime/src/index.ts:5940-5953`,
`packages/h2a-runtime/src/tmux.ts:1860-1871`), whose normal detach is 0; it is not an independently
enforced exit invariant. This is source-trace verification, not an end-to-end invocation: executing
the shipped runtime would first run the config-home migration above.

## 0. What revision 2 changes, and why

Revision 1 framed this work as **breaking DEC-034** to obtain a native `h2a`. Review leg 2
found the document that revision 1 never cited:

> `docs/contracts/h2a-public-contract-v1.md:19` — status **CONTRAT GELÉ**, 2026-06-29:
> "grammaire actée : […] lancement `h2a run <cli> [--options]` ; **agent natif `h2a`
> (bare, interactif)** ; **`h2a --resume`**."
> Same file, header: "Toute évolution de ce contrat = décision irréversible-produit
> (réservée à Fabien). Tout diff sur ces surfaces doit échouer la CI sans bump de version
> explicite."

Verified verbatim in this checkout. That inverts the framing:

- Bare `h2a` as the native interactive agent is **already ratified**. The target is not a
  new breaking change to be sold; it is a **conformance gap** — the code prints help and
  exits 0, the frozen contract says native agent.
- The change-control clause **did not fire**. A frozen surface diverged from its contract
  and no CI failure recorded it. That is this repository's recurring pattern — a guard that
  is written but never triggers — and it is worth more than the grammar below.
- What still requires an owner product decision is therefore **narrow** (§1), not the whole
  document.

Revision 2 also drops three claims revision 1 made without the evidence to carry them, and
rewrites the parts two independent legs showed to be impossible as written. Nothing here is
weakened to look better: the count of things this document can promise went **down**.

## 1. What actually requires an owner decision — and what does not

**Already ratified (frozen contract v1). No new decision needed; conformance is owed:**
bare, no-argv `h2a` starts the native interactive agent; `h2a --resume` exists;
`h2a run <cli> [--options]` remains the explicit vendor launch form.

**Requires an owner product decision, because it diverges from or extends the frozen
contract:**

| # | Decision | Why it is the owner's |
|---|---|---|
| P1 | Exact, zero-operand `h2a run` also enters native | Not named in the frozen contract; changes a published error into a launch |
| P2 | `h2a run native` as the explicit spelling and option carrier | Adds a reserved selector to a frozen verb |
| P3 | Removing the unknown-token-as-executable behavior (§4.3) | A safety break with a measured blast radius the document cannot bound (§7/M3) |
| P4 | Whether the frozen contract itself is amended instead of honored | Reserved to the owner by the contract's own header |

P4 is the fork. This document assumes the contract is **honored** and specifies the
conformance path. If the owner amends it instead, §2–§6 are rewritten, not patched.

## 2. Dispatch — a two-stage contract, not one impossible authority

Revision 1 claimed "one pure classifier over `(argv, env, tty)` is the single authority"
while also stating that the optional runtime remains the authority for its own verbs. Leg 1
proved these cannot both hold: `(argv, env, tty)` contains no verb registry, so a core-pure
function cannot separate a recognized runtime verb from an unknown one without the core
allowlist the document rejects. Leg 2 added that the real dispatch authority today is
neither — it is the ordered 17-branch chain in `packages/h2a/src/bin.ts:112-298`, which
classifies on `argv[0]`, `argv[1]` **and** flag presence, and owns `--version` before
`bin-routing` is consulted.

**Stage A — core, pure, no I/O.** Decides: help spellings; the frozen-contract implicit
forms; `--resume`; selector-less option errors; and "delegate to stage B". It must be a
named exported function so fixtures can call it, and it must be reconciled with the
existing `bin.ts` chain rather than layered on top of it — the EVOL's realization phase
must state whether that chain is refactored into stage A or kept and fenced.

**Stage B — runtime, side-effect-free parse only.** A new versioned capability that
classifies a delegated first token **before** `main()` calls `migrateConfigHomeIfNeeded()`
(`packages/h2a-runtime/src/index.ts:2134-2149`). Today no such capability exists: the only
entry is `main(argv)`, which migrates config first. Until stage B exists, any promise that
an unknown verb "resolves the parser but migrates nothing" is unimplementable — revision 1
made that promise and it is withdrawn.

### 2.1 The classifier rows

Ordered; "None" means no runtime import, no config migration, no PATH probe, no network, no
engine probe, no session.

| # | Invocation | Outcome | Exit | Side effects |
|---:|---|---|---:|---|
| 1 | `h2a help`, `h2a --help`, `h2a -h` | Top-level help | 0 | None |
| 2 | `h2a --version`, `-v` | Existing version path (owned by the `bin.ts` chain today) | Existing | None |
| 3 | `h2a run --help`, `h2a run -h` | Run help, core-intercepted before the lazy boundary | 0 | None |
| 4 | `h2a run native --help`, `-h` | Native help | 0 | None |
| 5 | Existing core/meta verb, and Track-façade verbs (`report`, `item`, `focus`, …) | Existing route, in-process or spawn as today | Existing | Existing |
| 6 | Recognized non-run runtime verb (`ls`, `attach`, `stop`, `resume`, `delegate`, `jobs`, `workspace`, `install`) | Existing lazy dispatch | Existing | Existing |
| 7 | `h2a run <recognized vendor or retained alias> …` | Existing tmux/attach route (§3.2) | Existing | Existing |
| 8 | `h2a run native …` | Native; interactive unless an explicit machine form is given (§2.2) | §3 | Readiness before creation |
| 9 | `h2a --resume [<ref>]` | **Frozen-contract spelling.** Native resume | §3 | Readiness before attach |
| 10 | Exact bare `h2a` | Native interactive, subject to §2.3 | §3 | Guards, then readiness |
| 11 | Exact `h2a run` (P1) | Same flow as row 10 | §3 | Guards, then readiness |
| 12 | Leading option or terminator before any verb: `h2a --root <p> <verb>`, `h2a --`, combined shorts (`h2a -hv`) | Explicitly enumerated, not swept into "unknown verb" | per case | None for the help cases |
| 13 | `h2a run --<non-help-option>` / `h2a run --` with no selector | Usage error, stderr only | 1 | None |
| 14 | Unknown `run` selector | Usage error (§4.3) | 1 | Stage B only |
| 15 | Any other unmatched first token, **including option-like tokens** | Usage error | 1 | Stage B only |

Row 9 exists because leg 2 measured that `shouldDispatchRuntime(["--resume"])` is `true`
today: a spelling the frozen contract names is currently routed to Commander as an unknown
option. Revision 1 had no row for it and would have classified it as an unknown top-level
verb — failing its own completeness criterion.

Rows 12 and 15 exist because leg 2 measured that `h2a --root /tmp status`, `h2a --`, and
`h2a -hv` all cross the runtime boundary today and are not "unknown verbs" in any natural
reading. A catch-all that does not say "including option-like tokens and `--`" is not a
catch-all.

### 2.2 The native option grammar is NOT frozen here

Revision 1 said row 8 was "native grammar; interactive when no machine/headless form is
explicit" and froze nothing. Leg 1 showed the consequence: `h2a run native --headless`,
`--json`, `-p x` have no determined result, while the existing `run` parser already exposes
`--headless`, `--json`, `--model`, `--effort`, `--background`, `--prompt-stdin` and gateway
flags. Freezing a native option surface before the engine seam answers (§6, G1) would
invent flags the engine may not honor. **This EVOL therefore does not claim to freeze it**,
and the completeness claim is scoped to rows 1–15 minus row 8's option surface. That scope
limit is stated here rather than discovered later.

### 2.3 Guards — non-TTY is load-bearing, `CI` is not

Revision 1 led with `CI`. Leg 2 measured that `process.env.CI` has **zero precedent** in
`packages/*/src`, and that the load-bearing half is non-TTY. Revised: an implicit native
form requires `stdin.isTTY` **and** `stdout.isTTY`; a redirected `stderr` alone does not
disqualify. A nonempty `CI` additionally refuses the implicit forms under a pseudo-TTY.
Refusal writes one diagnostic to stderr, nothing to stdout, exits 1, never falls back to
help.

Leg 2's M2 stands and is recorded rather than argued away: **today's bare `h2a` is strictly
safer than the successor's** — core-only, help, exit 0, no import, no write. These guards
protect automation; nothing here protects an interactive human who runs `h2a` in an
arbitrary directory. That is a real cost of honoring the frozen contract, and it belongs in
front of the owner (§1, P4), not buried in a guard table.

## 3. Exits

| Exit | Meaning |
|---:|---|
| 0 | Help/version, clean native completion, explicit quit |
| 1 | Usage/selector error, or interactive safety refusal |
| 2 | Native readiness, authentication/admission, engine state, policy or budget failure, with a structured reason |
| 3 | Local I/O or OS failure |
| 64 | Runtime CLI API incompatibility at the lazy boundary |
| 127 | Module-not-found at the lazy boundary — **see below** |
| 128 + signal | Signal termination |

**127 does not mean "the optional runtime package is missing."** `packages/h2a/src/bin.ts:82-94`
tests only `err.code === "ERR_MODULE_NOT_FOUND"`, which is also produced when
`@sentropic/h2a-runtime` resolves but one of its transitive imports fails during evaluation.
Both report "install the runtime". Revision 1's availability table named 127 as evidence of
a specific state; that was an assertion wider than its evidence. The realization phase must
either discriminate on the failing specifier or publish 127 as the broad bucket it is.

### 3.2 Vendor routes — revision 1 cited the wrong function

Revision 1 justified vendor compatibility with `runProfile`. Leg 1 traced that `runProfile`
serves the **direct** profile commands (`h2a claude`, `h2a codex`), and only its local PTY
branch assigns `result.exit.exitCode`. `h2a run <profile>` is a different Commander action
(`index.ts:5177`) which starts a tmux session and by default assigns
`attachLocalSession(...)` to `process.exitCode` (`:5712`), with further distinct behavior in
its detached and structured branches. Compatibility must therefore be frozen **per route** —
`run <vendor>` interactive attach, detached/headless/structured, direct vendor local PTY,
direct vendor remote — each with its own golden fixture. One citation cannot carry four
contracts.

## 4. Compatibility, release and rollback — the honest shape

### 4.1 The lockstep set is the repository, not two packages

Revision 1 said "coordinated majors of `@sentropic/h2a` and `@sentropic/h2a-runtime`".
Verified in this checkout: `scripts/release.mjs` bumps **eight** manifests in one step —
root, root lock, `packages/h2a`, its two plugin manifests, `packages/h2a-cli`,
`packages/h2a-runtime`, and **`packages/track`** — and the release workflow hard-fails on an
`h2a-cli`/tag version mismatch. A successor major therefore forces a **collateral major on
`@sentropic/track`**, a package with its own consumers and nothing to do with CLI dispatch.
`h2a-cli` also still owns the `h2a` bin name. Either the release script gains independent
versioning first, or the EVOL must state plainly that shipping this costs a track major.

### 4.2 The rollback lever does not reach the largest breakage

`H2A_LEGACY_EMPTY_DISPATCH` restores the two empty forms. But bumping
`H2A_RUNTIME_CLI_API_VERSION` breaks **every heavy verb** — `ls`, `attach`, `stop`,
`resume`, `delegate`, `jobs`, `workspace`, `install` — for any mixed install, and npm does
not prevent the mix (`peerDependencies: "*"`, optional dependency). Advertising a rollback
that covers the small breakage while the release ships a larger unprotected one is
precisely an assurance wider than its evidence. Either the capability bump is dropped from
this change, or the compatibility strategy must cover the heavy-verb surface — and this
document does not currently know how.

Additionally, the "byte-for-byte, before any import" promise for exact `h2a run` is
withdrawn: both legs independently showed the current result is produced *by* the runtime
(127 with no runtime, 64 if incompatible, otherwise a possible config-migration write on
stderr followed by Commander's missing-argument error), so a pre-import branch cannot
reproduce it without doing the thing it forbids. Replacement: a **frozen, environment-
independent legacy output** for the two empty forms, explicitly labelled as not identical
to today's, and never pinned to a third-party error string.

### 4.3 The unknown-selector break — and what it really reaches

Revision 1 justified removing `LOCAL_CLI[profile] ?? profile` (`index.ts:1818`) as removing
arbitrary command execution. Two corrections:

- **The current baseline is worse than revision 1 described.** Leg 2 traced that there is no
  profile validation on that path: `localStartArgs` returns `[]` for an unknown token, the
  tmux session **is created and registered**, `h2a` exits 0, and `tmux.ts:99` drops the pane
  to `exec /bin/bash -l`. Verified. So a typo does not merely execute something — it
  registers a session whose pane is a login shell. Any fixture written against revision 1's
  description would have asserted the wrong baseline.
- **The break reaches persisted state, not only argv.** `localCliCommand` has a second call
  site (`index.ts:4981`) that takes the profile from the session registry (`entry.tool`), so
  removing the fallback also changes resumption of already-recorded sessions. That is why
  P3 is an owner decision, and why the document cannot bound its blast radius — especially
  under its own no-new-telemetry rule.

### 4.4 A claim withdrawn: the vendor picker is dead code

Revision 1 retired `profile-menu.ts::shouldShowProfileMenu` as a live implicit selector. Leg
2 measured mutual exclusivity: the menu requires `process.argv.length <= 2`, and the runtime
is only reached at `>= 3`. It is unreachable through the shipped bin. Removing it may still
be good hygiene; it is **not** a safety argument, and revision 1 spent safety weight on it.

## 5. Fixtures — two kinds, not one rule

Revision 1 applied a universal "must fail on `origin/main` first" rule. Leg 1 showed it is
wrong for at least three of the ten: fixture 7's core assertion (`resolveH2aRuntimeDispatch`
rejecting a version mismatch) **already exists and passes today**
(`packages/h2a/test/bin-routing.test.js:77-87`), fixture 4 is an unchanged-behavior
invariant that must pass on the base, and fixture 9 can pass without proving the escape
hatch was read.

Split accordingly:

**Base characterization (must pass before and after)** — vendor route behavior per §3.2;
existing heavy-verb dispatch; existing help spellings; the current unknown-selector baseline
of §4.3 recorded as a golden, so the successor's change to it is visible.

**Successor delta (must fail first, for a named reason)** — rows 9, 10, 11 producing one
identical launch intent; implicit forms refusing under non-TTY; `--resume` classified rather
than rejected as an unknown option; unknown selector no longer creating a session; stage B
classifying without config migration.

Each fixture must name the observable seam it asserts on. Revision 1 asserted "no import, no
migration, no session" against functions that cannot observe those events: `dispatchRuntime`
is private and reads module-scope `argv`. The realization phase must expose an injectable
front dispatcher, or the assertion is unwritable — a fixture that cannot fail is the same
defect as a guard that cannot fire.

## 6. Phased authorization — replacing self-blocking gates

Revision 1 forbade all code until G1–G6 held, while G4–G6 could only hold **after** code
shipped. Leg 1 named it: the document blocked itself. Phases, each unlocked by the previous:

| Phase | Unlocked by | Authorizes |
|---|---|---|
| 0 — paper | this EVOL, reconciled with both legs | nothing executable |
| 1 — seam | owner decision on §1 P1–P4; sentropic answers A1–A4 / Q1–Q5; a versioned seam with a frozen stop-reason-to-exit mapping | specifying stage B's capability |
| 2 — explicit route | phase 1 | implementing and testing `h2a run native` **additively**, changing no existing behavior |
| 3 — compatibility | phase 2 green; §4.1 release-set answer; §4.2 heavy-verb strategy | announcement-only release; help and diagnostics naming the coming change |
| 4 — candidate | phase 3 shipped for at least one release | building a cutover candidate behind the legacy lever |
| 5 — cutover | owner UAT **on that candidate build**, dated and recorded | flipping rows 10 and 11 atomically, and publishing |

Each phase's evidence must be a named artefact — a path or release id, an immutable ref, the
verification command and its result, and for phase 5 a dated owner acceptance. Leg 1's C8
was right that revision 1's gates could be satisfied by prose; a gate judged by narration is
a convention, not a gate.

**Phase 1 status, 2026-07-30:** open. A1–A4 were deposited to the architect on 2026-07-18 to
a target absent from today's registry, re-sent 2026-07-29 and acknowledged; answers are
committed but not yet rendered. Also open, and uncited by revision 1: §S3 of
`docs/specs/2026-07-17-STUDY_h2a-cli-coconception.md` is an unresolved sentropic
co-validation fork on **this exact question** — it argues for preserving bare `h2a` and
`h2a --resume` and making `run native` additive only after a runtime × placement matrix.
That fork is not superseded by the 2026-07-18 study and belongs in phase 1's list.

## 7. Adversarial review reconciliation

Two independent legs, both on commit `3b3fe85`, neither the author. Leg 2 was placed in a
worktree that did not contain leg 1's findings — structural blinding, not an instruction.
Leg 1: 4 blocking, 4 major, 0 suspected. Leg 2: 4 blocking, 8 major, 3 minor, 0 suspected.
**Zero findings rejected.** Disposition:

| Finding | Disposition in revision 2 |
|---|---|
| L1-C1 impossible single authority | Accepted — §2 two-stage contract; the unimplementable no-migration promise withdrawn |
| L1-C2 incomplete grammar | Accepted — rows 9, 12, 15; §2.2 explicitly does not freeze the native option surface |
| L1-C3 legacy hatch contradiction | Accepted — §4.2, byte-for-byte withdrawn, frozen output substituted |
| L1-C4 self-blocking gates | Accepted — §6 phases |
| L1-C5 fixtures not falsifiable | Accepted — §5 split, plus the seam-observability requirement |
| L1-C6 wrong vendor citation | Accepted — §3.2, per-route contracts |
| L1-C7 exit 127 not specific | Accepted — §3 |
| L1-C8 gates lack evidence predicates | Accepted — §6 evidence tuple |
| L2-B1 release set is four packages | Accepted — §4.1, including the collateral track major |
| L2-B2 rollback misses heavy verbs | Accepted — §4.2, stated as unsolved |
| L2-B3 frozen contract already enacts it | Accepted, and it **reframes the document** — §0, §1 |
| L2-B4 `--resume` missing | Accepted — row 9 |
| L2-M1 open S3 fork uncited | Accepted — §6 phase 1 |
| L2-M2 today's bare `h2a` is safer | Accepted — §2.3, surfaced to the owner rather than argued |
| L2-M3 D7 reaches persisted state | Accepted — §4.3 |
| L2-M4 row 9 baseline wrong | Accepted — §4.3, verified independently (`tmux.ts:99`) |
| L2-M5 fixture 9 impossible | Accepted — §4.2, merged with L1-C3 |
| L2-M6 `bin.ts` chain is the real authority | Accepted — §2 |
| L2-M7 picker is dead code | Accepted — §4.4, claim withdrawn |
| L2-M8 missing subjects | Accepted as a **known gap**: session identity, naming, slug collision in one cwd, `ls`/`attach`/`stop`, presence, reaping, and resume continuation for the implicitly created session are not specified here. Named so it cannot be mistaken for covered |
| L2-m1 citation derivation | Accepted — the `H2A_NATIVE_VERBS` derivation includes `TRACK_FACADE_VERBS` |
| L2-m2 diagnostics language | Open: new diagnostics are specified in English while the loader's are French. Not resolved here |
| L2-m3 env surface unrecorded | Accepted — any new env var is a diff against the frozen contract's documented surface and follows §1 |

**What the reviews did not cover.** Neither leg executed the `h2a` binary end to end — leg 2
declined because a session hook refuses `h2a` from a shell and `main()` mutates the real
config home, and leg 1's end-to-end probe was discarded because Node resolved the runtime to
the sibling checkout. Leg 1's build did not complete (a missing `@hono/node-ws` and a
`@sentropic/llm-gateway` export mismatch). Every behavioral claim above therefore rests on
source reading and a built dist, not on running the shipped command. That limit is inherited
by this revision and must be closed in phase 2.

## 8. Acceptance of this EVOL, as paper

- §0 cites the frozen contract verbatim and states the conformance reframing.
- §1 separates what is already ratified from the four decisions reserved to the owner.
- §2 states a two-stage contract that does not claim an impossible authority, and scopes its
  own completeness.
- §3, §4 withdraw revision 1's three unsupported claims — 127 specificity, `runProfile` as
  the vendor route, the picker as a live selector — rather than restating them.
- §5 distinguishes characterization from delta and names the seam each fixture needs.
- §6 phases authorization so no gate requires the work it forbids, and reports phase 1 open.
- §7 dispositions all 23 findings and names what the reviews could not reach.

---

## Appendix A — successor DEC, ready to append at ratification

> **## DEC-NNN — Native dispatch conformance contract**
>
> **Date**: TBD. **Refers**: `docs/contracts/h2a-public-contract-v1.md` (CONTRAT GELÉ,
> 2026-06-29), DEC-034, WP13, and this EVOL.
>
> **Finding**: the frozen public contract already enacts bare, interactive native `h2a` and
> `h2a --resume`. The shipped code prints help and exits 0, and routes `--resume` to the
> runtime as an unknown option. The contract's change-control clause — any diff on these
> surfaces must fail CI without an explicit version bump — did not fire. The primary defect
> is the unenforced clause, not the grammar.
>
> **Decision**: honor the frozen contract. Additionally ratify, as extensions: exact
> zero-operand `h2a run` entering the same native flow (P1); `h2a run native` as the explicit
> spelling (P2); and removal of the unknown-token-as-executable behavior (P3), whose current
> baseline registers a tmux session on a login shell and whose removal also reaches
> resumption of recorded sessions.
>
> **Consequence**: the release lockstep set includes `@sentropic/track` and
> `@sentropic/h2a-cli`; a runtime CLI capability bump breaks the whole heavy-verb surface in
> mixed installs and its compatibility strategy is unresolved; realization proceeds by the
> phases in EVOL §6, and no phase is entered before its predecessor's named evidence exists.
>
> **Not decided here**: whether the frozen contract is amended instead of honored (P4),
> which the contract reserves to the owner.
