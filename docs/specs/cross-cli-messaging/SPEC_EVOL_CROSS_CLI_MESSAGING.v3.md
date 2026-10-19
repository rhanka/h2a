# SPEC EVOL — Remediation of live cross-CLI messaging and its test matrix

| Field | Value |
| --- | --- |
| Kind | EVOL remediation spec, **version 3**. No code in this lot. |
| Supersedes | Version 2 of this spec, SHA-256 `8f2ef6efb27796eea97c45703d040b676428920ec53d52330efde303af3137a9` (the exact document both final spec reviews cite) |
| Branch under remediation | `origin/feat/live-cross-cli-messaging`, head `97f93e72`, 17 commits over base `54e7ffd7` (0.98.6) |
| Worktree inspected | `/home/antoinefa/src/h2a/tmp/worktrees/xcli` (v1); v2 verified its anchors read-only against `origin/feat/live-cross-cli-messaging` and `origin/main` |
| Reference `origin/main` at review time | `d0b1afa3` (includes PR #348 seat L2-s, merge `7670fbed6`) |
| Reviews applied | v1: `rvxclia-last.md` (Astra max) and `rvxclis-last.md` (Sol 6.1 xhigh) on the branch, both **NON-FUSIONNABLE**. v2: `rvxsa-last.md` (Astra max) and `rvxss-last.md` (Sol max) on v1 of this spec, both **CORRECTIONS-REQUISES** — 3×P1 + 6×P2 (Astra), 3×P1 + 3×P2 (Sol), merged into 10 distinct corrections in §4.1. v3: `cfxca-last.md` (Astra max, 2 remaining P1) and `cfxcs-last.md` (Sol max, 1 duplicate P1) on v2, both **CORRECTIONS-REQUISES**; only those 2 distinct P1 are revised |
| Owner decision 18/10 | « Spec d'abord ». Two independent spec reviews, then code under lock v1 |
| Language | This spec is in English. The v1 companion `summary.md` is in French and is **stale** wherever v2 changes a default (notably D1 and the merge gate); `SPEC_EVOL_CROSS_CLI_MESSAGING.v3-changes.md` is the French change record for v3 |
| Output of this lot | This file and the French changes table. No code, no commit, no push, no test run of the repo suite |

This spec defines the remediation that makes the branch mergeable and then
qualifiable with real CLIs. It does not implement anything. Every statement
that proposes a new behaviour, threshold, or trade-off is marked
**PROPOSITION:**. Everything else is either an owner decision quoted verbatim,
a fact read from the branch or from `origin/main`, or a review finding with
its file and line. A **PROPOSITION** is not an owner decision and must not be
implemented as if it were one.

## 0. Rules that bind every lot in this spec

Owner rules, 2026-10-11, restated because each lot below assumes them:

- Confinement: never reach the real native host, `/run/user/*/h2a-nt`,
  `~/.config/sentropic/h2a`, `~/.local/state/h2a`, the installed dist, or any
  process not started by the lot itself. Never run the installed `h2a` binary.
  Never kill by pattern (`pkill -f`, `killall`); stop only owned PIDs.
- Tests use temporary dirs only (`mkdtemp`, `XDG_RUNTIME_DIR` in a created temp
  dir). A test that silently skips because real state is absent counts as
  FAILED. The declared non-test manifest (owner decision 12/10) is the only
  exception, and it must remain byte-identical unless the owner changes it.
- Targeted test files only (`vitest run <file>`, `node --test <file>`). The full
  repo suite runs once, at integration, under the conductor.
- Commits: conventional English subject, no attribution trailer of any kind.
  No Python anywhere in shipped code, tests, or CI jobs (see §8 for the exact
  vendor-runtime boundary, owner QO4). Do not touch `main`. Push only the own
  branch, fast-forward or `--force-with-lease` after a rebase, never bare
  force. Branch updates are by rebase on `main`, never by merging `main` into
  the branch (owner rule 30/07, recalled 17/10). PR merges into `main` are
  merge commits, never squash.
- Never claim green without the command and its output. Each regression needs
  red-before / green-after proof.
- Node minimum is 22 (owner 12/10). CI covers Node 22 and 24. Platform order
  is Linux, then macOS, then Windows (owner 12/10).
- Transient sandbox error « bwrap: No permissions to create a new namespace »:
  retry the same command a few times with a short pause before concluding
  anything.

## 1. Owner requests, verbatim

The remediation exists to satisfy these sentences. Section and lot references
are added; the wording is unchanged.

> « depuis un temps infini j'ai besoin des fonctions live de discussion entre
> session comme sendmessage, mais ENTRE cli (message live de agy a claude etc)
> est-ce que ca fonctionne la »

Satisfaction criterion: a per-pair measured answer (§3), not a general claim.
Today the factual answer is: **1/36 real, Claude → Claude; no real pair between
different CLIs is qualified** (both reviews, branch resume doc). Any other
wording would be unsupported.

> « vas falloir que tu impléente des tests sur TOUTES les cli, poru TOUTES les
> fonctions, y compris les messages cross cli (TOUTES combinaisons) dans le
> CI CD comment proposes tu de faire »

Satisfaction criterion: a function inventory crossed with all CLIs and all
ordered pairs, wired into CI/CD (§5, §7). The current branch covers one probe
per pair in simulation only. That does not satisfy this sentence.

> « Ca mqneu de profondeur ce status … les test de send inter cli... tjs pas
> ok » (18/10 ~20:40)

Satisfaction criterion: the status shows, per pair and per function, the proof
level reached (simulated, config-oracle, real probe, real function) and the
named blocker where proof stops (§5.5). A single green check is not a status.

Logins for tests (18/10 ~20:40): « Tes sièges actuels, quota partagé » —
2 Claude, 1 Codex, 2 Muse, 1 agy; campaign quota cap; isolated temporary
HOMEs; only authorised login files; wiped at the end (§6).

Dual-use seats (16/10 ~15:50, verbatim): « attention : les sieges servent aux
tests gw / aux tests cli (a2a inter cli) — il faut donc bien des sieges
enrôlables CLI ET LLM-MESH Claude, codex, muse, vibe, agy/cloud-code sinon on
n'a qu'une partie des tests en matrice ». Satisfaction criterion: one seat
model serves both consumers; this spec consumes the seat contract of PR #348
and sentropic L1, it does not invent a second one (§2.3, §6.1).

Historical owner decisions that still govern the design:

- 12/10 matrix decision: real CLIs with simulated models first; otherwise real
  models through seats enrolled in CLI mode, carried in a GitHub secret
  refreshed by a cron, re-enrolled when the device refresh is lost. Pairs are
  N×N everywhere (message, unavailability, loop, negotiation) with real
  binaries. Nothing is announced without proof: an unproven function or pair
  is not announced as supported.
- 13/10 enrollment decision: OAuth by default, plus import `--cli` and import
  `--token`, for all seats including Claude. The 12/10 « CLI mode, not OAuth »
  wording applies only to the test matrix.
- QO4 (11/10): « l'essentiel est que nous on livre 0 python. je vois pas
  pourquoi faire un mcp et des skill vibe oblige à faire du python » — the
  vendor Python runtime of Vibe is admitted; everything we ship (installer,
  MCP, skills, tests, CI) stays at 0 Python. §8 turns on this sentence.

## 2. Capital: what exists, what it proves, what it does not prove

### 2.1 The branch harness (facts)

The branch adds a qualification harness and three product fixes. File facts
below were read directly.

- `scripts/qualify-cross-cli.mjs` runs one isolated cell per ordered pair.
  Each cell builds the checkout sources in `mkdtemp` (`xcli-lab.mjs`
  `sourceBuild`), compiles the unchanged `node-pty` source directly with
  `g++` (no `node-gyp`, no Python, no install scripts), spawns a private
  native host, launches receiver then sender with distinct workspaces,
  identities, `HOME`/`XDG`/store/socket/registry, and witnesses the MCP
  traffic through `scripts/xcli-proxy.mjs`. Nested `h2a` calls resolve to a
  shim over the checkout build. `H2A_UPGRADE_REEXECED=1` blocks background
  installation. Startup screens are classified from a closed vocabulary;
  terminal queries before the idle barrier are emulated with
  `@xterm/headless` (`scripts/xcli-terminal.mjs`) and then frozen
  irreversibly for the receiver.
- `scripts/xcli-lab.mjs` holds the closed CLI list
  `['claude', 'codex', 'agy', 'gemini', 'muse', 'vibe']`, the fixed probe and
  reply markers, the private environment builder, the auth-only login copy
  (`copyLogin`), the private Muse program copy (`privateExecutable`), the
  Python-entrypoint check (`pythonEntrypoint`), and the classifier
  (`classify`, `matrix`).
- `scripts/xcli-simulated-model.mjs` is a deterministic model substitute. It
  drives the real h2a MCP, ignores MCP notifications, and reads its inbox
  only after verifying a signed product wake on its PTY
  (`parseSignedDriveInstruction`, `verifySignedDriveInstruction`, replay
  guard). It emulates the six CLI config layouts; it does not emulate their
  parsers or models.
- `.github/workflows/cross-cli-messaging.yml` runs three job families on Node
  22 and 24: `simulated-messaging` (harness unit tests, then
  `qualify-cross-cli.mjs --simulated` over 36 pairs, then
  `xcli-ci-check.mjs`), `native-configuration-oracles` (real Claude/Codex
  config parsers without login or model call, plus runtime suites inside a
  private PID namespace), and `source-consumers` (native and hosts source
  suites, also in a private PID namespace).
- Product fixes on the branch: native wake submission in two distinct input
  bursts (`680cf7d8`), Muse required settings schema `schema_version: 1`
  (`5181af1a`, `packages/h2a/src/hosts/muse.ts`), and PID-namespace
  confinement for historical-host tests (`185d9e1c`, `727c8160`,
  `packages/h2a/test/helpers/private-pid-namespace.mjs`).

Measured capital, as archived by the branch and re-verified by both reviews:

- Simulated: 36/36 `simulated-OK` on Node 22 and 24 (CI run `38909510272` on
  `2f4568a9`, eight jobs green). This proves the h2a path and the harness
  invariants. It proves nothing about the six real products.
- Real: **1/36 `measured-OK`, Claude → Claude** (60 s budget; the 30 s budget
  was consumed by a 27 s send plus the 5 s inbox poll). Phase-1 table
  (`docs/2026-10-15-cross-cli-phase1.md`) records 0 OK, 5 KO, 31 blocked;
  the 16/10 resume adds the Claude → Claude green plus targeted replays:
  Codex → Codex KO (MCP not loaded before deadline), AGY → Claude KO (both
  MCPs loaded, no AGY send in 60 s), AGY → AGY blocked
  (`authentication-required`), Muse → Claude KO, Muse → Muse blocked
  (`cli-exited-before-ready`), Claude → Gemini blocked
  (`authentication-required`). 29 other cells were not replayed.
- Harness unit tests: 14/14 in both reviews. Runtime targeted run 18/19 then
  1/1 on isolated replay in the Astra review; the intermittence cause is
  stated as not established. This spec treats that intermittence as an open
  item (Lot L2), not as a pass.

### 2.2 What the branch changes in the product surface

The branch diff over base `54e7ffd7` touches, outside `docs/` and `scripts/`:
`packages/h2a/src/hosts/claude.ts`, `codex.ts`, `muse.ts`,
`packages/h2a/src/cli.ts`, `packages/h2a-runtime/src/delegate.ts`,
`h2a-jobs.ts`, `index.ts`, `registry.ts`, `restore.ts`,
`native-terminal/op.ts`, `drive.functional.test.ts`,
`upgrade.functional.test.ts`, `packages/h2a/test/hosts-integration.test.js`,
and `packages/h2a/test/helpers/private-pid-namespace.mjs`. The remediation
must keep these changes reviewable per lot; the rebase (§10) must not fold
them into harness commits.

### 2.3 The seat model on `origin/main` (PR #348) and its limits

`origin/main` carries PR #348, « synthetic five-CLI seat materialization
(L2-s) »: `packages/h2a-runtime/src/cli-seat-*.ts` (codecs, fixtures,
materialization, enrollment), `packages/h2a/test/cli-seat-direct-matrix.test.js`,
`scripts/e2e-cli-seats-direct.mjs`, and `docs/cli-seat-l2s.md`. Facts that
constrain this spec:

- L2-s exercises **invented credentials**. It is not a live enrollment
  implementation and proves no native CLI behaviour. Its budget and keyring
  adapters are synthetic fixtures. It emits no live receipt.
- `scripts/e2e-cli-seats-direct.mjs` is an explicit refusal stub: exit 2 for
  valid live arguments until a later lot implements and verifies both L1 and
  L2a receipts.
- The live import boundary (`importSeatBundle({ bundle, ownerScope })`,
  `parseCliSeatProfile`, `parseTokenSeatEnvelope`) is specified against
  sentropic PR #681, pinned to `7293130e`. At the last publication check in
  `docs/cli-seat-l2s.md`, PR #681 was still open and the published npm
  packages (`@sentropic/llm-mesh@0.26.1`, `cluster-mesh@0.18.0`) did not
  expose that API. The h2a side fails closed with `seat-import-unavailable`.
  Rebasing cannot supply a missing upstream API.
- Enrollment modes on main route `--from cli|token` (aliases `--cli`,
  `--token`) for all five CLI providers exclusively through the L1 facade.
  `--from cli` requires a private `0600` L1 `CliSeatProfileInput` JSON record
  selected by a trusted caller. `--from token` reads the consumer
  `SeatBundle` over bounded stdin or masked input (48 KiB, never argv).
  Refresh-bearing projections are refused before import; importing a
  replacement never refreshes. OAuth still uses the product circuit.

Consequence for this spec: the qualification harness currently copies login
files directly (`copyLogin`). The target state consumes seats through the L1
facade. Until L1 is published, direct login-file copy inside isolated temp
HOMEs is the only available real-qualification path, and it must be labelled
as an interim path that L1 publication supersedes (Lot L8). The spec must not
claim seat enrollment where only file copy ran.

### 2.4 Divergence from current `main`

Merge base is `54e7ffd7`. `git merge-tree --write-tree origin/main HEAD`
exits 1 with content conflicts in exactly three files (both reviews confirm):
`BRANCH.md`, `packages/h2a/src/hosts/muse.ts`,
`packages/h2a/test/hosts-integration.test.js`. §10 gives the resolution
contract per file. No other file conflicts at review time; the rebase lot
must re-run `merge-tree` against the then-current `origin/main` and treat any
new conflict as a stop-and-report event, not as material to resolve by
guessing.

## 3. What « works » means per pair (the branch's measured-OK criteria)

This section is the contract. It restates the branch's own criteria
(`docs/cross-cli-qualification.md`, `xcli-lab.mjs` `classify`,
`qualify-cross-cli.mjs` worker) and adds the wake-evidence hardening that
finding F1 requires. Nothing here weakens a branch criterion.

### 3.1 Statuses

| Status | Meaning. Exit code of the campaign is 0 only if every requested cell is OK for its mode; otherwise 2 |
| --- | --- |
| `measured-OK` | Real CLIs. All eight stages in §3.2 observed `true`, no `blocker`, no `cleanupFailed` |
| `measured-KO` | Real CLIs. At least one observed stage failed within the qualification budget |
| `blocked` | Login, onboarding/trust, environment, model-readiness, forbidden or missing executable, or unproven cleanup. A blocked cell proves no functionality |
| `simulated-OK` / `simulated-KO` | Simulated models. Never promotable to a `measured-*` status |

`--simulated` forbids `--auth-home`. Simulated evidence must never be
presented as real support (owner 12/10: nothing announced without proof).

### 3.2 The eight stages of a `measured-OK` cell

`classify` requires every one of `senderMcp`, `receiverMcp`, `sent`,
`delivered`, `received`, `woke`, `replied`, `replyDelivered` to be `true`,
with no `blocker`. In words, for an ordered pair (sender CLI, receiver CLI)
running as **two distinct sessions with two distinct identities** (diagonal
included):

1. **MCP loaded, both sides.** MCP `initialize` succeeded and `tools/list`
   published `h2a_identity_status`, `h2a_inbox`, `h2a_send` on each side,
   witnessed by `xcli-proxy.mjs`.
2. **Identities ready.** Each side reached `identity_ready` with signing
   available. The receiver then finished its turn and became inactive.
3. **Idle barrier.** The receiver was observed inactive for the barrier
   interval (current implementation: pane ready, wake armed, and 2 s quiet,
   held for 2 s) **before** the sender was launched. The barrier timestamp
   and the receiver instance are recorded (`receiver-idle-barrier`). After
   the barrier, the receiver terminal is frozen: no further terminal response
   may be sent to it, and the proof verifier rejects any later harness input.
4. **Signed send.** The sender called `h2a_send` exactly once, to the exact
   receiver instance, with the exact probe text. The witnessed envelope ID,
   `from`, and `to` come from the product response, not from model text.
5. **Durable exact delivery.** The store contains, under the receiver
   instance, an envelope with that ID, the exact probe body, and
   `actor.instance` equal to the witnessed sender instance.
6. **Live receive.** The receiver CLI itself called `h2a_inbox`
   (`action read` or `pop`) with its own instance, at or after the send, and
   the returned set contains that exact envelope (ID, `from`, `to`, probe
   kind).
7. **Autonomous wake.** Stage 6 happened **without any new harness input**
   after the barrier, and — after Lot L3 — with positive wake evidence per
   §3.3. A read that periodic polling could explain does not satisfy this
   stage.
8. **Signed reply delivered.** After the receive, the receiver called
   `h2a_send` to the sender instance with the exact reply text, and the store
   contains that reply envelope under the sender instance with the exact
   body and `actor.instance` equal to the receiver instance.

Plus, in every case: **verified cleanup**, in two separable parts (§6.6):
(a) owned processes stopped through the fenced private-host path;
(b) **secret wipe** — copied logins and CLI transcripts removed and their
absence re-checked. Part (b) is attempted and proven even when part (a)
fails: a process-cleanup failure never justifies keeping credentials on
disk. Only already-filtered, closed-vocabulary diagnostics may survive a
cell (they live in the returned row, not in the cell root); the cell root
itself is **never** « preserved for diagnosis » while it still contains
login copies or transcripts. A cell with `cleanupFailed` is `blocked` and
the campaign stops; a cell whose secret wipe is unproven is `blocked` with
the distinct code `secret-wipe-unproven`, the campaign stops, and the
§6.6 confinement-recovery procedure applies. A cell whose cleanup is
merely unproven — lost worker included (Lot L5) — is also `blocked`.

Durable delivery alone (stage 5) is explicitly not « works »: the harness's
own unit test pins that delivery without live receive and reply classifies
`measured-KO`.

### 3.3 Autonomous-wake evidence (hardening required by finding F1)

Current code (`qualify-cross-cli.mjs:294`): `woke = received &&
noPostSendHarnessInput`. The Sol review reproduces a false positive: a fake
model that ignores the wake and polls its inbox periodically yields
`simulated-OK`, `woke:true`, reply delivered, with four reads before the idle
barrier. The current negative control (`--drop-simulated-wake`) only covers a
model that never reads. It does not cover a polling model.

Two v2 spec reviews (Astra P1, Sol P1) show that the v1 hardening proposed
here — an `inbox-wake ok` event ordered before the first post-wake read, with
zero reads between barrier and wake — **still accepts a slow poller**: a
receiver that ignores the wake and whose first periodic read happens to land
after the wake event satisfies every ordering condition. The reason is
structural, and the sources state it plainly: `inbox-wake … → drive ok`
(`packages/h2a/src/runtime/drive/inbox-wake.ts`, logged at its line 75,
witnessed by `xcli-proxy.mjs`) attests that the product driver **injected**
the signed wake line into the receiver PTY. It does not attest that the
receiver CLI **consumed** that line as the cause of its next turn. Ordering
evidence alone therefore cannot carry stage 7, and v2 replaces it with a
withheld-wake protocol that separates the two candidate causes in time.

Product facts the protocol rests on (read at `97f93e72`):

- The receiver's own `mcp-serve` detects fresh envelopes on its notification
  tick (`packages/h2a/src/runtime/mcp/notifications.ts`: `onInboxArrival`
  fires every tick while the inbox is non-empty; interval
  `H2A_NOTIFY_INTERVAL_MS` → heartbeat fallback in
  `packages/h2a/src/runtime/mcp/stdio.ts`) and calls the inbox-wake handler,
  which signs a drive line (`[h2a-wake reason=inbox from=… topic=… at=…]`,
  `packages/h2a/src/wake.ts`) addressed to the receiver instance itself and
  injects it through the native driver into the receiver PTY.
- The handler advances its `seen` set **only on a successful drive**; on
  `drive → false` the envelope stays fresh and the next tick retries. A
  withheld wake is therefore not lost: releasing the withholding lets the
  unchanged product emit the wake on a later tick.
- The harness owns the private native host that carries the drive, and the
  receiver prompt already tells the model not to poll — a prompt is an
  instruction, not evidence, and stage 7 must hold even if a model polls
  anyway.

**PROPOSITION:** stage 7 requires the following three-phase protocol in
every cell that claims `measured-OK` (real) or `simulated-OK` wake credit.
All timestamps and counts are witnessed by `xcli-proxy.mjs` / the worker,
never by model text.

1. **Silent baseline (barrier → send).** After the idle barrier, the harness
   delays the sender launch by a baseline window `W0`. Any receiver inbox
   read during `W0` (inbox still empty) is counted and reported; it proves
   a polling receiver with period ≤ `W0` and disqualifies wake credit for
   the cell (`woke:false`, classified failure, not a blocker invented after
   the fact). Reads before the barrier are counted and reported, never
   ignored (v1 requirement, kept).
2. **Withheld wake (durable delivery → release).** The probe is sent and
   durable delivery (stage 5) is witnessed while the harness **withholds**
   the product drive at the private native host (the drive request is
   refused/deferred so the handler sees `drive → false` and retries per
   tick; no product code changes, no fault injected into the model, the
   signed line never reaches the PTY). During this window `W1` the exact
   probe envelope is already readable in the inbox. **Zero** qualifying
   reads may occur: a receiver that reads the probe during `W1` read it
   without the wake — polling is proven and the cell fails stage 7 even if
   it later replies.
3. **Released wake (release → qualifying read).** The harness releases the
   drive. Stage 7 then requires, cumulatively: the `inbox-wake ok` event
   after release; the PTY input journal shows the **signed product wake
   line** (correlated `from` = witnessed sender instance, topic and
   timestamp of this cell's probe) as the only post-barrier input to the
   receiver (frozen terminal: no harness key, no terminal response);
   the qualifying inbox read is the **first** receiver read after release,
   occurs within a bounded delay `D` of the wake injection, and returns
   the exact probe envelope; `noPostSendHarnessInput` stays `true`.

Window sizing (numbers are **PROPOSITION:**, ratified with D2; relations are
normative): `W0` and `W1` must each cover at least the longest polling
period the qualification claims to exclude, and `D` must be short against
both (target: `D ≤ W1/3`). The default cell budget rises accordingly for
cells claiming wake credit (§3.5 amended by Lot L3: baseline + withheld +
released phases are inside the per-cell budget, and a cell that cannot fit
`W0 + W1 + D` inside its budget cannot claim stage 7 — it is `blocked`
with `wake-window-unfunded`, never silently shortened into a green). The
notification-tick interval actually in force for the cell is recorded,
because it bounds the earliest post-release wake.

What this proves and what it does not (stated plainly, per §12 discipline):

- A deterministic poller with period ≤ `W1` is **excluded**: it would have
  read the already-delivered probe during the withheld phase.
- A poller with period > `W1` whose tick coincides with the released phase
  is not excluded by one cell. **Replication count or non-commensurate
  release offsets alone earn no stage-7 credit**: finite acceptance windows
  can overlap. At least 3 cells per receiver family/version must pass the
  protocol with harness-chosen, recorded release delays, and the batch must
  satisfy this additional separation condition on **actual witnessed
  times**, all measured relative to each cell's idle barrier: for two
  distinct repetitions `i` and `j`, the whole acceptance window
  `A_i = [wake_i, wake_i + D]` must lie strictly inside the withheld window
  `B_j = [delivery_j, release_j)`. Thus `delivery_j < wake_i` and
  `wake_i + D < release_j`, with margins exceeding the recorded timestamp
  uncertainty. Intended release offsets are not a substitute for the
  observed wake injections. The later withheld window must be funded in
  that cell's budget (§3.5); it must not be shortened to obtain a pass.
  Until the full batch passes this check and every cell's phases 1–3,
  **none** of its cells earns stage-7 credit. Missing separation yields
  `woke:false`, stage-7 failure (exit 2), code
  `wake-phase-separation-unproven`; F1 stays open for those observations.
  A wake-ignoring poller with the same barrier-relative periodic schedule
  across repetitions cannot pass: its read in `A_i` also occurs during
  `B_j` and fails phase 2 in repetition `j`. This is an experimental
  exclusion of that fixed schedule, not a proof about a closed product's
  internals: polling whose phase varies between sessions, drifts, or adapts
  to the protocol remains `not covered`. Evidence wording is
  `wake: withheld-protocol, periods ≤ W1 excluded, N separated replications;
  varying-phase polling not excluded`, never « wake consumed, proven
  absolutely ».
- If the drive cannot be withheld for a family (transport not carried by
  the private native host, no refusal point), that family gets **no**
  stage-7 credit by ordering alone: its cells are `blocked`
  (`wake-withhold-unavailable`) until a withhold point exists. v1's
  ordering-only criteria are retained as necessary conditions inside
  phase 3, never as sufficient ones.

**PROPOSITION:** negative controls, all mandatory in the PR lane at tier S,
each asserting failure at stage 7 (exit 2) rather than a green:

- (a) wake dropped for the whole cell — delivery holds, no read, no reply
  (exists: `--drop-simulated-wake`);
- (b) **polling fixtures across periods and phases** — the simulated
  receiver ignores the wake and polls with periods
  {1 s, 5 s, 15 s, 45 s, 90 s} × phase offsets {0, P/3, 2P/3} relative to
  the barrier, including the slow-poller case whose **first** read lands
  after the wake event (the exact v2-review counterexample). Every
  combination must fail stage 7: periods ≤ `W1` by reading during baseline
  or withheld phase, longer periods by failing the post-release delay
  bound or reading in the separated replication's withheld window. The
  fixture keeps its period and barrier-relative polling phase unchanged
  across replications;
- (b2) **overlapping-window counterexample from the final Astra review** —
  `W0 = W1 = 10 s`, `D = 3 s`, actual wake injections at
  21 / 21.414 / 21.732 s after the barrier, and a first polling read at 23 s
  in every repetition, with all wakes ignored and no earlier read. All
  three reads meet the old delay bound: the acceptance windows overlap on
  `[21.732, 24] s`. That batch must now fail stage 7 (exit 2,
  `woke:false`, `wake-phase-separation-unproven`), not count as three
  successful wake replications. A second run with the same polling schedule
  and a later withheld window containing the whole earlier acceptance
  window must fail phase 2 by observing the polling read while wake is
  still withheld;
- (c) withheld-forever twin of a passing simulated cell — same scripted
  receiver, wake never released: no qualifying read, proving the passing
  cell's read was not produced by the script alone;
- (d) replayed wake — the same signed line delivered twice produces at
  most one qualifying read (kept from v1).

For simulated cells the simulated model's signed-wake verification
(addressed instance, signature, replay guard, instruction shape) remains
mandatory and unchanged; the harness-side protocol above applies on top,
so simulation and real cells share one wake definition. §5.3 is amended
accordingly: withholding the **transport** of the wake at the
harness-owned host is part of the real qualification protocol, not a
fault injected into a real model.

### 3.4 Pair arithmetic (read this before quoting any denominator)

| Universe | Count | What it needs |
| --- | --- | --- |
| Six CLI families (`claude`, `codex`, `agy`, `gemini`, `muse`, `vibe`), ordered pairs, diagonal with two distinct sessions | **36** | Seats or logins for all six families |
| Four families covered by the owner's current seats (`claude`, `codex`, `muse`, `agy`), ordered profile pairs | **16** | The six current seats (2 Claude, 1 Codex, 2 Muse, 1 agy) |
| Six seats, ordered pairs of distinct seats | **30** | Same six seats, counted per seat (Claude A→B and B→A are two directions) |

Rules: never quote « 1/36 » as « inter-CLI works ». The single real green is
the diagonal Claude → Claude. Diagonal cells for families with one seat
(Codex, AGY) run two sessions sharing one seat's authentication but with
distinct HOMEs, workspaces, and identities; the report must say so, because
quota and rate limits then hit one account twice per cell. Gemini and Vibe
cells (20 of 36 involve at least one of them; 11 involve Vibe) stay
`blocked` until seats exist (Vibe additionally until Lot L7 lands; the Python boundary itself is settled by QO4, §8.2). Claiming 36-pair coverage
before that would contradict the owner's proof rule.

### 3.5 Budgets

Facts: the branch default cell budget is 30 s, which covers the unchanged 20 s
product identity deadline plus the idle barrier. The real Claude green needed
a 60 s model window (27 s send + 5 s product inbox poll), and the KO was
reproduced at 60 s before the fix, so the green does not rest on the timeout
alone. Product identity deadlines and guards are unchanged by the harness.

**PROPOSITION:** real cells use a 60 s per-cell budget by default, bounded to
[1000, 180000] ms as today, with the watchdog at `2 × timeout + 45 s`.
Simulated cells stay at 30 s. Any budget change is reported with the cell;
a green obtained only by raising a budget past a previously reproduced KO at
the same budget is invalid and must be re-measured. **v2 addition:** a cell
claiming stage-7 wake credit must additionally fund the §3.3 phases
(`W0 + W1 + D`) inside its budget; where the ratified windows exceed the
default 60 s, the per-cell budget is raised explicitly for wake-claiming
cells and reported per cell — the windows are never silently shrunk to fit
60 s (`wake-window-unfunded` instead, §3.3).

## 4. Consolidated review findings (single source for the lots)

Both reviews conclude **NON-FUSIONNABLE** on `97f93e72` against
`origin/main=d0b1afa3`. The table merges them without dropping any item.
Severity is the higher of the two reviews where they differ. Each finding maps
to exactly one primary lot in §9; lots also name secondary files.

| ID | Sev | Finding (short) | Anchor |
| --- | --- | --- | --- |
| F1 | P1 | Autonomous-wake false positive: `woke` follows from any post-send inbox read; a polling fake model passes `simulated-OK` with reply. Negative control does not cover polling | `scripts/qualify-cross-cli.mjs:294` |
| F2 | P1 | General gate broken: the historical-host fixture now requires the private PID namespace launcher, but `npm test`, general CI, and release invoke Vitest directly. Reproduced: `historical host requires the private PID namespace launcher`. The cross-CLI workflow has the confinement; the global entries do not | `packages/h2a-runtime/src/native-terminal/upgrade.functional.test.ts:346`; `scripts/run-test-gates.mjs:192` |
| F3 | P1 | CI does not satisfy the owner request: CI runs only `--simulated` plus Claude/Codex config oracles. Updated balance: 1/36 real (Claude → Claude), no real inter-CLI pair. The matrix does not exercise all h2a functions | `.github/workflows/cross-cli-messaging.yml:41` |
| F4 | P1 | Three content conflicts with current `origin/main`. `merge-tree` exits 1. The Muse resolution must keep both the required schema and main's registry-migration rules | `BRANCH.md`; `packages/h2a/src/hosts/muse.ts:31`; `packages/h2a/test/hosts-integration.test.js` |
| F5 | P2 | Free-form data retained in evidence: `request.args.instance` is stored without validation even on failure; a dummy probe archives a secret marker verbatim. Retained identifiers must be limited to known cell instances and other retained fields filtered. (No token pattern found in the 102 examined evidence documents; the no-leak guarantee is still insufficient.) | `scripts/xcli-proxy.mjs:88` |
| F6 | P2 | Login copy follows symlinks in intermediate components: only the last component is checked; `.codex` can point outside the authorised HOME. The `.claude.json` read also follows a direct link. Both reproduced with dummy files. The full resolved path must be controlled before any read | `scripts/xcli-lab.mjs:132`, `:143` |
| F7 | P2 | Dead worker does not stop the campaign: invalid or absent worker JSON becomes `blocked` / `qualification-worker-failed` without `cleanupFailed`. The campaign continues while descendant stop and login-copy removal are unproven | `scripts/qualify-cross-cli.mjs:443` |
| F8 | P2 | Python filter is not a reliable ban: a `python3.14` shebang and a shell wrapper launching Python pass. Checking only the first launcher does not control its descendants. Reproduced without executing the fixtures | `scripts/xcli-lab.mjs:205` |
| F9 | P2 | Seat selection insufficient: one `authHome` feeds both roles, so Claude A → Claude B and Muse A → Muse B cannot be expressed. AGY reuses Gemini paths without a demonstrated reusable AGY login. Vibe has no authorised auth file | `scripts/qualify-cross-cli.mjs:126`; `scripts/xcli-lab.mjs:119` |
| F10 | P3 | Entry documentation stale: the qualification doc still announces zero successful real cells. It must point to the Claude → Claude result without implying other pairs are qualified | `docs/cross-cli-qualification.md:4` |

### 4.1 Spec-v2 corrections (reviews of v1 of this spec)

Both v2 reviews (`rvxsa-last.md` Astra max, `rvxss-last.md` Sol max, on v1
SHA-256 `13ae1e0b…defef8`) returned **CORRECTIONS-REQUISES**. Their 15 items
merge into 10 distinct corrections. Each was re-verified against the sources
read-only (branch `97f93e72`, `origin/main`, owner decision record) before
being applied; none was found factually wrong on its core claim. Three of
them ask for a signal or a gate whose literal form the sources do not
provide; those are applied in a bounded, explicitly-labelled form and the
bound is stated where the correction lands (see « applied as »).

| ID | Sev | Source reviews | Correction (short) | Applied as |
| --- | --- | --- | --- | --- |
| V2-1 | P1 | Astra P1, Sol P1 | §3.3 ordering still accepts a slow poller; `drive ok` attests injection, not consumption | §3.3 rewritten: withheld-wake three-phase protocol, multi-period/multi-phase polling controls, guarantee bound stated. Lot L3 |
| V2-2 | P1 | Astra P1, Sol P1 | « All functions, all combinations » has no executable lots; loop/negotiation deferred to unnamed follow-ups; « representative triples » ≠ N×N | §5.1 denominators made exact; new Lots L12–L15 with files, scenarios, RED and acceptance per function group; partial milestone vs final F3 satisfaction distinguished in §5.4 |
| V2-3 | P1 | Astra P1, Sol P1 | Closure criteria contradict F3: `blocked` campaign accepted as L11 GREEN, §13 « merge-ready » without real campaigns, no mandatory no-secrets check of a trusted-campaign receipt for the candidate SHA | §7.1 receipt check + merge/release gates; L11 GREEN rewritten; §13 milestone renamed, no merge without an exact-SHA receipt. Lot L11 |
| V2-4 | P2 | Astra P2, Sol P2 | §6.4 « turn counter » counts MCP calls, displays them, stops nothing; a model consumes without MCP calls | §6.4 rewritten: capped unit = launched model session debited pre-spawn, plus MCP-call and wall-clock caps; preflights and retries debited; persistent campaign ledger across resumes; no uniform model-turn signal exists in the sources, stated as a per-family `source-gap`. Lot L8 |
| V2-5 | P2 | Astra P2, Sol P2 | L5/§6.6 still allow keeping logins after failure (« preserve the root ») | §3.2, §6.6, Lot L5 rewritten: secret wipe separated from process recovery, unconditional and separately proven; only filtered diagnostics survive; `secret-wipe-unproven` + confinement recovery |
| V2-6 | P2 | Astra P2 | L4 shape-only instance exception lets an instance-shaped canary through | §6.3, Lot L4: no retained identifier without correlation to a witnessed cell identity — shape is never sufficient; instance-shaped canary added to the RED |
| V2-7 | P2 | Astra P2, Sol P2 | L6 cleanup-time inspection misses transient Python descendants | §8.3, Lot L6: whole-cell execution observation required, with a transient-descendant RED at several lifetimes; where no event-grade observation exists the guarantee is explicitly bounded and F8 stays `partial` |
| V2-8 | P2 | Astra P2 | D1 re-opens QO4, an already-taken owner decision; V-A wrongly the default | §8.2, §13: QO4 recorded as the standing rule (V-B); an execution ban (V-A) demoted to a new, separate proposition; « no non-Python Vibe backend exists » kept as an explicit finding. Lot L7 no longer waits on D1 |
| V2-9 | P2 | Astra P2 | L2 RED/GREEN bypasses the fixed entry (direct Vitest cannot go green by editing `run-test-gates.mjs`) | Lot L2 rewritten: RED/GREEN drive `runGates()` with the real `h2a-runtime` step and its execution proof; the direct-Vitest invocation kept as the negative control for the PID guard |
| V2-10 | P1/P2 (merged) | Astra P1+P2, Sol P1+P2 | Cross-cutting: numbers that size the new gates (`W0/W1/D`, session caps, replication counts) must not be silently invented | Marked **PROPOSITION:** at each site, ratified under D2 (§13); relations and refusals normative, values not yet owner-approved |

Review verification facts to preserve (do not regress): 14/14 harness tests,
5 native-pilot tests (Sol), simulated Claude → Codex replay green, both
archived 36/36 simulated matrices re-verified, GitHub targeted run green on
`2f4568a9`, Claude fixture copy retains only authorised items in `0600` with
separate HOMEs, no token pattern in 102 evidence files, no owner login used
by the reviewers. The Astra runtime intermittence (18/19, then 1/1 isolated)
remains unexplained and is tracked in Lot L2.

Steps to a real qualification, as converged by both reviews: fix the findings
and rebase; describe the six seats explicitly with pinned versions and
isolated authentication prechecks; unblock each real CLI (Codex startup/MCP,
Muse output after Trust, AGY login); run the right matrices (16, then 36);
treat Vibe without a fake workaround; add functional coverage and a real CI
job on a trusted ephemeral runner where any mandatory missing, blocked, or
failed function or pair blocks merge and release. §5–§11 expand exactly these
steps.

## 5. Test matrix: ALL functions × ALL CLIs × ALL combinations

The owner asked for tests on all CLIs, for all functions, including cross-CLI
messages in all combinations, inside CI/CD. This section defines the matrix
so that « all » is a countable set, not a slogan.

### 5.1 Function inventory (the rows)

**PROPOSITION:** the inventory is machine-derived, never hand-copied, from
two sources at the tested SHA:

- **MCP tools** published by `packages/h2a/src/mcp.ts` (`tools/list`). At
  inspection time the `h2a_*` tool names are: `h2a_identity_status`,
  `h2a_send`, `h2a_inbox`, `h2a_discover_instances`,
  `h2a_discover_sessions`, `h2a_register_instance`, `h2a_session_open`,
  `h2a_session_close`, `h2a_run`, `h2a_read_payload`, `h2a_sign`,
  `h2a_append_journal`, `h2a_open_negotiation`, `h2a_offer`,
  `h2a_counteroffer`, `h2a_stabilize`, `h2a_loop_create`, `h2a_loop_join`,
  `h2a_loop_report`, `h2a_loop_status`, `h2a_loop_list`, `h2a_loop_done`,
  `h2a_loop_stop`, `h2a_conductor`, `h2a_conductor_claim`,
  `h2a_conductor_launch`, `h2a_conductor_launch_check`,
  `h2a_conductor_release`, `h2a_drive_consent_request`,
  `h2a_drive_consent_respond`, `h2a_drive_consent_cosign`,
  `h2a_drive_consent_status`, `h2a_drive_consent_revoke`, `h2a_escalate`,
  `h2a_blockage_raise`, `h2a_blockage_list`, `h2a_blockage_resolve`,
  `h2a_attest_comprehension`, `h2a_conflict_posture`,
  `h2a_declare_conflit_interet`, `h2a_nhi_inventory`, `h2a_nhi_attest`,
  `h2a_nhi_report`, `h2a_nhi_export`, `h2a_nhi_offboard`. This list is
  evidence at one SHA; the gate must fail if `tools/list` grows or shrinks
  without the matrix manifest changing in the same commit.
- **CLI verbs** from `packages/h2a/src/cli-command-map.ts` (`h2a explain`
  groups) and the runtime entrypoint groups. The matrix cares about verbs a
  session can invoke cross-CLI (send, inbox actions including `pop` and
  name resolution, sessions list/resume/stop, host setup/status, upgrade
  refusal paths). Purely local rendering verbs stay in their existing suites.

Each inventory entry is classified once:

| Class | Meaning | Crossed with (exact denominator per tier) |
| --- | --- | --- |
| `per-cli` | One session suffices (identity, discovery read, inbox empty-read, config render) | Each CLI family: 6 at S/C, seated families at R |
| `per-pair` | Two roles, ordered (send/wake/reply, drive consent round-trip, session resume addressing a peer) | Each ordered pair: **36** at S; seated ordered pairs (16 profile pairs today) at R. No sampling |
| `multi` | Three or more parties, or two asymmetric roles over durable shared state (negotiation, loop, conductor claim/release, consent cosign) | At S: ordered **role pairs in full** (initiator×responder, creator×participant, claimant×releaser = 36 each) **and** ordered triples in full where a third distinct party is intrinsic (6×5×4 = **120**; simulation makes exhaustiveness cheap, « representative » subsets are not accepted at S). At R2: ordered role pairs in full over seated families; intrinsic-third-party rows run every seated family in **each** of the three roles against every seated counterpart pair for the other two roles — the matrix manifest states the exact triple denominator per row, and any reduction below the full seated triple product is recorded in the manifest as a named, owner-visible bound under D2, never as silent « representative » coverage |
| `refusal` | Must fail closed (unsigned wake, replayed wake, unknown instance, unavailable peer) | Each CLI family, then each ordered pair (36 at S) |

The reviews name, beyond the current probe: name resolution, other inbox
actions, sessions, negotiations, resume, discovery, wake, delegation, stop.
The 12/10 owner decision adds the four N×N scenarios: **message,
unavailability, loop, negotiation**. **PROPOSITION:** these four scenarios
are the first mandatory `per-pair` / `multi` rows after the probe; the full
MCP list then ratchets in per §5.4. No function is « covered » because its
tool appears in `tools/list`; coverage means the behaviour was executed and
witnessed.

**PROPOSITION:** every manifest row names its **scenario** (entry point,
roles, witnessed success condition, refusal twin where applicable) in the
manifest itself. A row without a named scenario cannot be declared
mandatory and is reported `not covered — scenario undefined`, so the
manifest gate (§5.4) can fail on an inventory row that exists on paper but
has no executable definition. Lots L12–L15 (§9) own the scenario definitions
group by group; until a group's lot lands, its rows stay in that state.

### 5.2 Proof tiers (the columns)

| Tier | Runner | Logins | What it proves | When it blocks |
| --- | --- | --- | --- | --- |
| S — simulated full cross product | GitHub-hosted, Node 22 + 24 | None. `--auth-home` forbidden | Real MCP, signatures, inbox, session resolution, PTY wake path with deterministic models. Config layouts emulated; parsers and models not qualified | Every PR and push to the branch |
| C — real-config oracles | GitHub-hosted, Node 22 + 24 | None, no model call | Each real CLI binary parses the h2a-rendered MCP config at its native path and format. Today: Claude and Codex. Target: all six families | Every PR and push to the branch |
| R1 — real probe per pair | Protected ephemeral runner (§7) | Owner seats, temp HOMEs | §3 eight stages with real models | Manual campaign, scheduled campaign, and release gate on the exact SHA |
| R2 — real functions | Protected ephemeral runner (§7) | Owner seats, temp HOMEs | Mandatory inventory rows beyond the probe, with real models | Same as R1, once a row is declared mandatory |

Simulated evidence never satisfies an R tier. A tier-C pass never satisfies
R1. The status report (§5.5) shows tiers separately so depth is visible,
which answers the 18/10 status complaint.

### 5.3 Negative and refusal cases (mandatory, not optional)

- Wake dropped: durable delivery holds, no live read, no reply → KO (tier S,
  exists).
- Wake **withheld at the harness-owned private host** (§3.3 phases 2–3):
  part of the qualification protocol at tiers S **and** R. Withholding
  refuses/defers the drive transport so the unchanged product retries; it
  injects nothing into a real model and manufactures no model behaviour.
  The v1 wording that put real-tier wake control « out of scope » is
  withdrawn: without a withhold point a family earns no stage-7 credit.
- Polling receiver across periods and phases (§3.3 controls (b)/(b2),
  including the overlapping-window counterexample): read and reply may
  occur → stage 7 still fails (tier S, Lot L3; at tier R the same bounded
  exclusion requires the withheld phase and the batch separation check).
- Unavailable peer (12/10 scenario): send to a stopped or unknown instance
  fails closed with a classified error; no silent durable-only « success »
  is reported as live delivery (tiers S and R2, Lot L12).
- Unsigned, mis-addressed, or replayed wake: rejected (tier S; the simulated
  model already verifies signature, addressee, and replay guard).
- Quota and authentication screens: classified `blocked`
  (`provider-quota`, `authentication-required`), never retried into a green
  (tier R, classified by `blockingScreen`).
- Campaign cap reached (§6.4): the next launch — cell, preflight, or retry —
  is refused **before** spawn and the cell is `blocked`
  (`campaign-cap-exhausted`); a resume never resets the ledger (Lot L8).
- Cleanup unproven (dead worker, surviving descendant, surviving login copy):
  `blocked`, campaign stops; login copies specifically are governed by the
  unconditional secret wipe in §6.6 (tiers S and R, Lot L5).
- Transient Python descendant (§8.3): a short-lived descendant interpreter
  that exits before cleanup must still be detected by the cell execution
  journal, or the cell reports the bounded guarantee — never a silent pass
  (Lot L6).
- Instance-shaped canary (§6.3): an arbitrary value that merely matches the
  instance *shape* is retained nowhere (Lot L4).

### 5.4 The ratchet (how « ALL » becomes true without lying on day one)

**PROPOSITION:** a versioned matrix manifest lists every inventory row with
its class and its current mandatory tier. Rules:

1. A row declared mandatory at tier T blocks the gate while its status is
   missing, `blocked`, `measured-KO`, or `simulated-KO`. There is no
   skip-green. This implements the reviews' requirement that any mandatory
   missing, blocked, or failed function or pair blocks merge and release,
   and the owner's proof rule.
2. A row not yet mandatory is reported as `not covered` with its named
   blocker. It does not block, and it must not be announced as supported.
3. Rows only move up (none → S → C → R1/R2 mandatory). Moving a row down
   requires an owner decision recorded in the manifest commit.
4. Order: probe at S/C/R1 first (Lots L1–L11), then unavailability
   (Lot L12), loop (Lot L13), negotiation (Lot L14) — the remaining three
   12/10 N×N scenarios — then the remaining MCP rows grouped by class
   (Lot L15). Tier S always runs the full declared cross product; tiers R
   run the full mandatory set per campaign (§6.4 sequences cells to fit
   the campaign caps without sampling away a mandatory row — if the caps
   cannot fit the mandatory set, the campaign is `blocked`, not
   partial-green).

Two milestones must never be confused (v2 correction V2-2):

- **Partial milestone — « branch remediated, qualification open ».** Lots
  L1–L11 green: the branch is rebased, its findings fixed, the probe is
  mandatory at S/C and campaign-proven at R1 for the seated pairs. This
  milestone satisfies **neither** the « all functions, all combinations »
  owner sentence **nor** F3 in full. Loop, negotiation, unavailability at
  R2, and the remaining inventory rows are still `not covered` at that
  point, and every status surface must keep saying so (§5.5, §12).
- **Final F3 satisfaction.** Every inventory row (§5.1) is mandatory at S
  with its full cross product green, and every row the owner has ratcheted
  to R1/R2 is green in a trusted-lane campaign receipt for the candidate
  SHA (§7.1), with no mandatory row missing, `blocked`, or KO. Lots
  L12–L15 are the only path from the partial milestone to this state; no
  wording in any lot may announce F3 closed before them. If the owner
  decides to ship at the partial milestone, that is a new, explicit owner
  decision recorded against this paragraph — the spec does not pre-authorise
  it by silence.

This is the only reading under which « TOUTES les fonctions, TOUTES
combinaisons » and « quota partagé, plafond par campagne » are both true:
the full cross product runs in simulation on every change, and the real
mandatory set runs in full per campaign or the campaign reports blocked.

### 5.5 Status output (depth, per the 18/10 complaint)

**PROPOSITION:** each run emits one table per tier with, per cell: sender,
receiver, function row, status, the eight stage booleans where applicable,
blocker or failure code, CLI versions, seat IDs (never secrets), elapsed
time, campaign cap-ledger totals (§6.4), and the evidence file reference. The
entry document (`docs/cross-cli-qualification.md`, Lot L10) links to the
latest table per tier and states the real balance in the form
« N/16 profile pairs at R1, N/36 at R1, 0 inter-CLI pairs unless measured ».
A status that aggregates tiers into one colour is non-conforming.

## 6. Real qualification with the owner's seats

Owner basis (18/10): current seats, shared quota — 2 Claude, 1 Codex,
2 Muse, 1 agy — campaign cap, isolated temporary HOMEs, only authorised
login files, wiped at the end. This section makes that sentence executable.
All numeric caps below are **PROPOSITION:** values to be ratified by the owner
before the first real campaign (Decision D2, §13). The mechanisms (counting,
stop rules, isolation) are normative; the numbers are not yet owner-approved.

### 6.1 Seat manifest (fixes F9)

Current code passes one `--auth-home` to both roles
(`qualify-cross-cli.mjs:126` calls `copyLogin(cli, authHome, …)` per role).
Claude A → Claude B is therefore inexpressible, and the campaign cannot prove
which seat served which role.

**PROPOSITION:** replace the single `authHome` with an explicit seat manifest
consumed by the harness. One entry per seat:

| Field | Rule |
| --- | --- |
| `seatId` | Stable opaque ID (`claude-a`, `claude-b`, `codex`, `muse-a`, `muse-b`, `agy`). Appears in evidence. Never a secret |
| `family` | One of the six CLI families. `agy` and `gemini` are distinct families; AGY must not silently reuse Gemini auth paths as proof (F9) |
| `authSource` | Interim: directory holding only the authorised login files for this seat. Target: L1 seat reference (`--from cli` profile or `--from token` bundle per PR #348), once published (Lot L8) |
| `cliVersion` | Exact `--version` output, recorded per campaign. A version change invalidates prior R-tier evidence for that family |
| `binaryDigest` | SHA-256 of the resolved executable (and, for Muse, of the private program copy, as today) |

Pair selection names seats, not just families:
`--pair claude-a:claude-b`, `--pair muse-a:claude-b`. Each role copies login
material only from its own seat entry, into its own temp HOME. Diagonal cells
on a single-seat family (Codex, AGY) reuse the one seat for both roles and
must record `sharedSeat: true`. AGY entries must name an AGY login source
distinct from Gemini files; until a reusable AGY login location is
demonstrated, every AGY cell is `blocked` with
`authentication-required`, as the branch already classifies the AGY login
selection screen. Vibe entries carry no authorised auth file today
(`authFiles.vibe = []`); no Vibe R-tier cell runs until Lot L7 lands and an
auth source exists.

Dual use (16/10): the same manifest IDs are the seat IDs the gateway tests
use. The harness must not invent a parallel seat vocabulary. Where PR #348
already defines a consumer envelope field for the same concept, reuse its
name; where it does not, the manifest field is harness-local and marked as
such.

### 6.2 Isolation (normative; mostly existing, tightened by Lots L4–L6)

- One `mkdtemp` qualification root per campaign; one cell dir per pair;
  `HOME`, `XDG_*`, `TMPDIR`, store root, native socket, and registry inside
  the cell root, mode `0700` (existing `environment()`). `XDG_RUNTIME_DIR`
  points into the cell. Ambient sockets, hooks, daemon endpoints, provider
  base URLs, and API keys are absent from the child environment (pinned by
  the existing environment test; keep it).
- Source build in `mkdtemp`; `node-pty` compiled from its unchanged source
  with `g++` and the selected Node headers; no install scripts, no
  `node-gyp`, no Python, no installed `h2a`. Every nested `h2a` invocation
  resolves through the per-role shim to the checkout build via the witness
  proxy. Source and harness digests are recorded per campaign (existing).
- Private native host per cell; owned-process view limited to pinned private
  processes (`H2A_TEST_PROC_ROOT`, `H2A_TEST_OWNED_PROC_ROOT`). Stop only
  fenced (generation + incarnation checked) owned PIDs. Historical-host
  suites additionally run inside the private PID namespace launcher
  (`xcli-in-pid-namespace.mjs`); the fixture refuses to run without proof of
  the namespace change, with no fallback to the outer procfs (Lot L2 wires
  the global entries to the same launcher).
- Login copy: auth-only allowlist per family (existing `authFiles`), copied
  `0600`, then deleted with the cell. Hooks, plugins, commands, and user MCP
  settings are never copied (existing; keep). For Claude, only the three
  login-metadata fields already extracted from `.claude.json` may cross
  (`oauthAccount`, `hasCompletedOnboarding`, `lastOnboardingVersion` with
  its version-shape check). After Lot L4, every source path is fully
  resolved and proven inside the seat's authorised root before any byte is
  read; any symlink in any component refuses the copy.
- Startup interaction: only normal startup UI in the empty temp workspace
  (existing `startupKey` vocabulary). No bypass flags, no persisted trust
  edits, no input after the idle barrier. The Muse launcher runs from a
  private program copy so installation-side mutable state is never consumed
  or modified (existing; keep its red/green fixture test).
- Without a seat manifest, no existing login is read at all (existing
  no-`--auth-home` behaviour, generalised). A missing seat file is
  `blocked`, never a fallback to the owner's real HOME.

### 6.3 No secret leaks (normative; tightened by Lot L4)

Evidence contains no raw RPC, no model text, no provider stderr free text, no
tokens: only closed-vocabulary events, technical identifiers, and correlated
booleans (existing principle). Concretely:

- `xcli-proxy.mjs` retains, per tool, only the fields listed in Lot L4, and
  every retained instance identifier must equal one of the two known cell
  instances (sender or receiver identity for this cell, as witnessed by a
  correlated `identity` event or handed over by the worker after
  readiness); any other value is dropped or refused, including on failing
  calls (fixes F5, line 88). **No identifier is ever retained on shape
  alone**: before a cell identity is witnessed, instance fields are simply
  not persisted (v2 correction V2-6 — a value that merely matches the
  instance shape is arbitrary caller data, and a token-pattern scan
  downstream does not repair retaining it). The proxy forwards original
  RPC bytes unchanged; filtering applies only to what it **retains**, never
  to what it forwards.
- Screen evidence is limited to the closed `startupFacts` vocabulary,
  fixed choice styles, and boolean signals (existing). Raw screens, raw
  stderr, and unparsed diagnostics are never persisted (existing).
- **PROPOSITION:** a canary test injects unique dummy secrets as an inbox
  `instance` argument, as model-visible text, and as stderr noise, then
  asserts the canary strings appear nowhere in the cell evidence, the
  campaign JSON, or the Markdown table. One canary is deliberately
  **instance-shaped** (matches the harness instance pattern but is
  correlated to no witnessed identity) and is sent **before** any identity
  is witnessed, including on a failing call — the exact case the v1
  shape exception would have kept. The test uses temp dirs and dummy
  servers only (pattern of `xcli-proxy.test.mjs`); it must fail on current
  code (red) and pass after Lot L4 (green).
- **PROPOSITION:** before any evidence file is committed or uploaded, a
  token-pattern scan (Node, no Python) over every produced JSON/Markdown
  file must pass. The reviews scanned 102 files and found no token pattern;
  the scan turns that one-off check into a gate. A scan hit blocks
  publication of the evidence and classifies the campaign `blocked`.

### 6.4 Campaign caps (mechanism normative, numbers PROPOSITION)

Each real cell runs two model sessions. A 16-pair R1 campaign therefore runs
32 model sessions; a 30-direction seat campaign runs 60; a 36-pair campaign
runs 72. Each session spends model turns on identity polling, the send or
reply turn, and any startup screens. Quota is shared with the owner's other
work, so the campaign must be able to stop cleanly and resume per cell
(existing `--pair` replay already allows cell-by-cell execution).

**Correction V2-4 — what unit is actually capped.** The v1 « turn counter »
counted witnessed MCP calls and printed them. MCP calls are neither model
turns nor a measure of consumption: a model can spend many turns without a
single MCP call, and the counter stopped nothing — the only real stop was
`provider-quota`, i.e. provider exhaustion itself. A uniform, reliable
model-turn signal does **not** exist in the harness sources today: no usage
or turn count is witnessed by `xcli-proxy.mjs`, and vendor transcripts are
private state that §6.3 forbids persisting or parsing as evidence. Pretending
to cap « model turns » across six closed products on that basis would be an
unfounded claim. The capped units are therefore the observable, enforceable
ones below; a per-family structured usage signal, where a CLI exposes one
without reading transcripts, is an inventory item for Lot L8 and stays a
named `source-gap` per family until demonstrated.

**PROPOSITION:** the harness enforces three composite caps per campaign.
The campaign stops launching when **any** cap would be exceeded:

- **Launched-session cap (primary unit).** One unit = one launched model
  session (one role of one cell, one §6.5 preflight that reaches a model,
  one retry). The unit is **debited before spawn**: a launch whose debit
  would exceed the cap is refused before any process starts, and the cell
  is `blocked` (`campaign-cap-exhausted`). Preflights, retries, and
  re-runs of a cell are debited exactly like first attempts — there is no
  un-debited path to a model. Retry policy itself is unchanged: at most
  one retry, only for classified infrastructure failures, never for
  `measured-KO`, `blocked`, `provider-quota`, or
  `authentication-required`.
- **MCP-call cap per session (runaway brake).** Witnessed MCP tool calls
  per launched session are counted live by the proxy; crossing the cap
  terminates that session (owned PID only) and classifies the cell
  `measured-KO` (`mcp-call-cap-exceeded`). This bounds tool-call loops. It
  does **not** bound silent model reasoning, and the evidence must say so.
- **Wall-clock caps.** Per launched session (the existing watchdog, now
  also debited into the campaign total) and per campaign. A session that
  consumes without calling MCP is bounded only by this cap plus its one
  debited session unit; that bound is the stated limit of the mechanism,
  not a hidden gap.

Enforcement mechanics (normative):

- a **persistent campaign ledger** (one file in the campaign root, `0600`,
  filtered fields only: per-seat debited sessions, per-session MCP-call
  counts, wall-clock spent, per-cell attempt counts) is written before
  each spawn and read on start. A **resume** (`--pair` replay, campaign
  restart after cancellation) loads the ledger and continues debiting —
  resuming never resets a counter. A campaign started without its ledger
  is a **new** campaign with a new root, reported as such (§7.4);
- **pre-launch check**: before every spawn — first cell, preflight, or
  retry — the harness verifies the pending unit fits all three caps;
  on refusal nothing is spawned, no seat is touched, and the refusal is
  witnessed in evidence;
- **stop rules**: any cap refusal stops further launches campaign-wide
  (remaining mandatory cells `blocked`, reason `campaign-cap-exhausted`);
  first `provider-quota` screen additionally stops all further cells on
  that seat (it remains a safety net, no longer the mechanism); first
  `cleanupFailed` / `secret-wipe-unproven` (lost worker included, Lot L5)
  stops the whole campaign; `SIGTERM`/`SIGINT` cancels the active cell and
  marks the rest `qualification-cancelled` (existing);
- **ordering**: cheapest discriminating cells first — diagonal same-family
  cells, then pairs touching an unproven family, then the remainder — so a
  cap stop still leaves maximal information. Ordering never drops a
  mandatory cell from the report; unrun mandatory cells are `blocked`;
- the status table (§5.5) prints, per seat: sessions debited / cap, MCP
  calls, wall-clock spent / cap, and the registry of refused launches.
  Display is in addition to enforcement, never instead of it.

**PROPOSITION:** default campaign scope is the 16 profile pairs (R1). The
30-direction seat run, R2 rows, and §3.3's phase-shifted wake replications
(each replication is itself debited sessions) are separate, explicitly
requested campaigns whose ledgers state their own caps. No campaign runs
overnight unattended against shared quota without owner-ratified numeric
caps (Decision D2).

### 6.5 Preflights (before any model turn is spent)

**PROPOSITION:** per seat, before its first cell: (a) binary resolves on the
campaign PATH, version recorded, digest recorded; (b) Python-entrypoint
guard passes for our launch chain and any vendor runtime is labelled per §8.2/§8.3 (Lot L6); (c) tier-C config oracle for that family
passes on the same SHA (real parser, no login, no model); (d) an isolated
authentication precheck in a throwaway HOME with only the seat's authorised
files proves the login is accepted without spending a messaging cell
(the branch's Muse `exec` preflight pattern, with outputs discarded and
private state deleted, is the model). A failed preflight blocks that seat's
cells with the preflight's classified reason. Preflights never read the
owner's real HOME beyond the seat's authorised files, and never run the
installed `h2a`.

### 6.6 Cleanup proof (normative; secret wipe separated — correction V2-5)

Cleanup has two independent obligations, and conflating them is what let
v1 (and the current branch code, which records `privateCleanupRoot` and
skips removal exactly when `cleanupFailed` is set) keep credentials on disk
after a failure:

1. **Process recovery.** Both sessions stopped through the fenced path or
   observed exited with unchanged generation/incarnation; private host
   exited; `stopPrivateNativeProcesses` and per-role
   `waitForPrivateNativeProcesses` succeeded. Bounded recovery may stop
   only PIDs proven owned by that cell (pinned private-process records);
   it must never pattern-kill.
2. **Secret wipe.** Every copied login file and every CLI-owned transcript
   inside the cell is removed, and absence is re-checked file by file
   against the recorded copy list (`credentialsCopied` per role). This
   obligation is **unconditional**: it is attempted even when process
   recovery fails, when the worker is lost, and on cancellation. Filtered
   diagnostics (closed-vocabulary row evidence, already returned to the
   parent in memory / per-cell JSON) are the only things allowed to
   survive; « preserve the root for diagnosis » is deleted as an option
   wherever the root still holds login copies or transcripts. A root may
   be kept for diagnosis only **after** the wipe is proven, and what
   remains then contains no credentials by construction.

A cell is complete only when both obligations are proven and
`cleanup-complete` (with separate `processRecovery` and `secretWipe`
booleans) was witnessed. Failure shapes:

- process recovery failed, wipe proven → `cleanupFailed`, `blocked`
  (`owned-process-cleanup-failed`), campaign stops; the secret state is
  still reported as wiped, separately;
- wipe failed or unproven → `blocked` (`secret-wipe-unproven`), campaign
  stops, and **confinement recovery** applies: the surviving paths are
  listed by name only (never content) in the campaign report; on an
  ephemeral campaign runner the runner's post-job destruction is the
  recovery and its proof is recorded (§7.2); in a conductor-local run the
  report names the exact temp root and the campaign cannot be resumed or
  reported complete until a wipe re-check over that root passes or the
  root is destroyed by the conductor. No subsequent cell runs while a
  wipe is unproven;
- worker died without parseable JSON (F7): today that path fabricates a
  `blocked` row without `cleanupFailed` and continues
  (`qualify-cross-cli.mjs:443`). Lot L5 treats it as **both** obligations
  unproven: the parent runs bounded process recovery from the cell's
  pinned records, then runs the secret wipe itself over the known copy
  list, and classifies by the outcome of those two checks — never by
  assuming either succeeded.

## 7. CI/CD path: where real logins run, where only simulation runs

Owner basis: 12/10 (real CLIs with simulated models first; otherwise real
models via CLI-mode seats in a GitHub secret refreshed by a cron, re-enrolled
when the device refresh is lost) and the second verbatim request (all tests
in CI/CD). Review basis: a real job on a trusted ephemeral runner with
per-seat secrets, bounded concurrency, cleanup on cancellation, filtered
evidence; manual/periodic; any mandatory missing, blocked, or failed
function or pair blocks merge/release. The design below reconciles both.
Runner placement is a **PROPOSITION** (Decision D3).

### 7.1 Three lanes, one receipt check (correction V2-3)

| Lane | Trigger | Secrets | Tiers | Gate |
| --- | --- | --- | --- | --- |
| PR lane (existing workflow, extended) | Every PR, every push to the branch | None. Fork-safe | S full cross product + C oracles + harness unit tests + PID-namespace runtime/source consumers + **receipt check** (below) | Blocks merge on red. Says nothing about real models by itself — real-model claims enter only through the receipt check |
| Real campaign lane (new, manual + scheduled) — the **trusted lane** | `workflow_dispatch` with an explicit seat set, on a protected ref; weekly schedule; pre-merge run on the frozen candidate head; release preparation | Per-seat, environment-scoped, never on forks, never on `pull_request` from untrusted refs | R1 mandatory pairs (+ R2 rows as ratcheted, Lots L12–L15), preflights, campaign caps (§6.4), §3.3 wake protocol | Emits the **campaign receipt**. A campaign whose mandatory set is not fully green emits a receipt that records the non-green cells — and that receipt **fails** the receipt check. It is evidence of an open qualification, never a pass |
| Release lane (existing release flow, gated) | Tag / release workflow | Same as campaign lane for its qualification step | Reuses the campaign receipt for the exact release SHA; re-runs the campaign if the SHA differs | No passing receipt for the exact SHA → no release. Global `npm test` must also pass via Lot L2 wiring |

**The receipt and its no-secrets check (normative).** The trusted campaign
lane publishes one filtered receipt per campaign (existing
`xcli-export-evidence` pattern, `0600`, uploader-owned; no secrets, no raw
state) binding: candidate `sha`, `harnessDigests`, seat manifest digest,
per-family CLI `version` + `binaryDigest`, matrix manifest version, the
mandatory row set, and per-cell statuses with stage booleans, blocker
codes, cap ledger totals, and cleanup booleans (§5.5, §6.6). The PR lane
runs a **receipt check** with no secrets present
(**PROPOSITION:** `node scripts/xcli-receipt-check.mjs`, following the
`xcli-*` naming) that verifies a presented receipt against the candidate:

- `sha` equals the candidate head exactly — any later commit invalidates
  the receipt (that is the cost of exactness, stated not hidden);
- harness digests, seat-manifest digest, CLI versions/digests, and matrix
  manifest version match the candidate tree (a receipt from before a
  version or manifest change is **stale** and refused);
- the mandatory set in the receipt equals the mandatory set the matrix
  manifest declares for both merge and release: all mandatory R1 + ratcheted R2 rows
  at the candidate SHA, with **every** mandatory cell `measured-OK`. A receipt with a missing, `blocked`, `measured-KO`, or
  simulated-only mandatory cell is refused. Simulated evidence can never
  satisfy the check;
- cleanup booleans are proven for every cell (§6.6) and no
  `secret-wipe-unproven` appears anywhere in the campaign.

**Where the check is required (normative).** The receipt check is a
**required status check on the pull request that merges this branch into
`main`**, and on the release lane. It is green there only with a passing
trusted-lane receipt for the frozen candidate head — which means the
pre-merge flow is: freeze the head, run the trusted campaign on that exact
ref, present the receipt, merge only if the check passes; any new commit
restarts the flow. On lot pull requests **into the feature branch**, the
check runs in report-only mode and prints `qualification: open` with the
current per-tier balance — it must never be configured as required there,
and its report-only output must never be worded as merge-readiness.
Rationale for the split: requiring a full real campaign for every lot
commit would spend shared quota per push and still prove nothing extra,
while requiring it nowhere before `main` is exactly the v1 defect. Before
Lot L11 delivers the trusted lane, **the branch does not merge into
`main` at all** — there is no interim local-receipt path to merge. A
conductor-local campaign (§7.2 staging) produces diagnostic evidence for
L9/L12–L15; it never produces a merge receipt.

Tested refusals (Lot L11 RED set, dummy receipts in temp dirs, no secrets):
receipt absent; receipt for another SHA; receipt stale (digest or version
mismatch); receipt with a `blocked` mandatory cell; receipt incomplete
(mandatory row absent); simulated receipt presented for an R gate; receipt
with an unproven secret wipe. Each must fail the check with a distinct
classified code; a well-formed all-green fixture for the exact SHA must
pass. Specifically test `--gate merge` with R1 entirely green and an
already-mandatory R2 row (loop or negotiation) first absent, then `blocked`:
both must refuse, even if the receipt declares only the green R1 subset.
The positive twin passes only with all mandatory R1/R2 cells
`measured-OK` and the other receipt conditions satisfied.

The PR lane must never receive seat material. The campaign lane must never
run on a fork PR, on an unprotected ref, or with `pull_request_target`
semantics that check out untrusted code with secrets present. Concurrency is
bounded to one campaign at a time (shared quota); a queued campaign waits
rather than racing the same seats.

### 7.2 Where the campaign runner lives (PROPOSITION, Decision D3)

| Aspect | GitHub-hosted + environment secrets | Self-hosted ephemeral (owner-controlled) |
| --- | --- | --- |
| Seat storage | GitHub environment secrets, refreshed by the 12/10 cron; re-enroll on device-refresh loss | Secret store on owner infrastructure; runner materialises seats into temp HOMEs per job |
| Trust | GitHub holds seat material; acceptable only with environment protection (required reviewer or timer), masked logs, no fork access | Owner holds seat material; runner must be single-use (fresh VM/container per campaign, destroyed after) |
| CLI binaries | Installed pinned per campaign (digest recorded); install time counts against job budget | Pre-baked image with pinned binaries; image digest recorded per campaign |
| Evidence | Filtered receipts uploaded as artifacts (existing `xcli-export-evidence` pattern, `0600`, uploader-owned); private state never uploaded | Same filtered receipts; raw cell dirs never leave the runner |
| Main risk | Credential exfiltration via a compromised workflow step; mitigated by pinned actions, no untrusted code, minimal steps | Runner persistence or reuse across campaigns; mitigated by ephemeral lifecycle and post-job destruction proof |

**PROPOSITION:** start with the campaign command line run **locally under
conductor control** (the branch's current real mode: seat manifest, temp
HOMEs, filtered evidence) as a **diagnostic** staging step while Lots L9
and L12–L15 bring families and function groups to green. Local runs prove
the harness and produce per-cell diagnostic evidence; per §7.1 they never
produce a merge or release receipt, and no « merge-ready » claim may rest
on them. The identical command line then moves to the protected trusted
lane (Lot L11), and only receipts from that lane feed the merge/release
check. This sequences the risky part (real logins in CI) after the harness
is proven locally, without letting local evidence silently stand in for
the trusted lane. The choice between the two runner columns above is
Decision D3; the spec requires either column to satisfy: ephemeral
filesystem with post-job destruction proof (§6.6 confinement recovery),
per-seat secrets injected as files into temp HOMEs (never argv, never
logged), bounded concurrency = 1, `cancel-in-progress` cleanup that stops
only owned PIDs and still performs the unconditional secret wipe,
publication of filtered evidence only, and the §6.4 cap ledger in the job
summary.

### 7.3 Secret lifecycle

- Interim (file-copy path): each seat's authorised files are stored as one
  environment secret bundle per seat, written by the job into a `0700` temp
  dir, copied per §6.2, wiped in an `always()` step. Rotation follows the
  12/10 cron rule: refresh by cron, re-enroll when the device refresh is
  lost. A secret that fails its §6.5 preflight blocks that seat; it is never
  « fixed » by copying broader HOME content.
- Target (L1 path, Lot L8): CI holds `SeatBundle` material consumed through
  the published L1 facade (`--from token` over bounded stdin, 48 KiB, never
  argv; or `--from cli` with a private `0600` profile record). Refresh-bearing
  projections are refused; expiry/401 is classified access-unavailable with
  zero provider refresh calls (PR #348 contract). The harness must not
  implement its own refresh.
- In both paths: secrets never appear in evidence, logs, or artifacts; the
  §6.3 canary and token scan run in the campaign lane before upload.

### 7.4 Job budgets and flakiness policy

Facts: the existing cross-CLI workflow splits runtime (706 tests), native
source (163 tests), and hosts source (211 tests) into separate 10-minute
jobs because serialising them exceeded the budget on Node 24. The simulated
matrix job allows 30 minutes. **PROPOSITION:** keep that split; the campaign
lane gets its own budget derived from cell count × per-cell budget (§3.5,
including §3.3 wake phases and phase-shifted replications, each debited per
§6.4) plus preflights, and fails (not truncates) when the budget — in time
**or** in any §6.4 cap — cannot fit the mandatory set. A real
cell that fails is never retried into a green (§6.4); an intermittent
infrastructure failure is reported with its classified code, and the
campaign is re-run as a new campaign with a new root. The unexplained
runtime intermittence from the Astra review is investigated in Lot L2 with
targeted replays; it must not be absorbed by raising timeouts silently.

## 8. Vibe without shipped Python, and the Gemini/AGY auth gap

### 8.1 Vibe facts (read directly; no Python executed)

- The installed `vibe` entrypoint is a Python launcher (`vibe.cli.launcher`).
  The branch guard therefore blocks all 11 Vibe cells with
  `python-entrypoint-forbidden:vibe` before any execution. No Python ran.
- A native ELF `vibe-rs` exists in the wheel (`vibe/_bin/vibe-rs`). The Astra
  review confirms `--version` works directly without Python.
- However, the Rust entrypoint alone does not run messaging without Python:
  `vibe/cli/_rust.py` `exec_rust_cli()` points the Rust client at the
  installed `vibe-app-server` via `VIBE_APP_SERVER_BIN`
  (`Path(sys.argv[0]).resolve().parent / _APP_SERVER_SCRIPT`), and
  `vibe-app-server` is a Python entrypoint. In a source checkout it instead
  sets `VIBE_APP_SERVER_CWD` to the Python project root. A shell wrapper,
  `uv`, or an embedded interpreter does not remove Python (Sol review). No
  non-Python compatible app-server is demonstrated today.
- Owner QO4 draws the line at what **we ship**: vendor Python runtime
  admitted; installer, MCP, skills, tests, CI at 0 Python. Owner decision
  16/10 ~18:50 already applies this line to Vibe's MCP wiring: a direct h2a
  MCP entry in `~/.vibe/config.toml` written by h2a in Node now (#340),
  migrated to the cluster-mesh MCP registry when ready (R5/R6 in 0.98.7 lane
  work). The branch harness guard is stricter than QO4: it refuses to
  **execute** the vendor product at all.

### 8.2 The standing rule is QO4 (V-B); stricter bans are new propositions

**Correction V2-8.** v1 presented the Vibe Python boundary as an open
Decision D1 with the branch's execution ban (V-A) as the default. That
inverts the recorded owner position. QO4 (11/10) is already recorded as an
**adopted consensus** in the owner decision record: « l'essentiel est que
nous on livre 0 python » — the vendor Python runtime is admitted,
everything **we ship** stays at 0 Python — and the 16/10 decision already
applies that line to Vibe's MCP wiring (#340). The branch guard is stricter
than the standing rule; keeping it as the silent default lets a harness
guard outrank an owner decision. v2 therefore records:

- **Standing rule (owner QO4, « V-B »).** The vendor `vibe` product may run
  as installed, vendor Python runtime included. Everything we ship —
  installer, MCP entry writer, harness, skills, tests, CI jobs — remains
  Node/shell/native only, enforced by the repo `zero-python` gate
  (`scripts/check-no-python.sh`, present on `main`, hence on this branch
  after Lot L1) plus Lot L6's launcher policy on **our** launch chain.
  Vibe cells that run under this rule are labelled
  `vendor-runtime: python (not shipped)` in every evidence surface. No
  new owner authorisation is required to apply QO4; Lot L7 implements it.
- **Finding, kept explicit: no non-Python Vibe backend exists today.**
  `vibe-rs` answers `--version` natively, but its launcher wires it to the
  Python `vibe-app-server` (§8.1). Any « Vibe without any Python executed »
  posture is therefore blocked on an upstream artifact that does not
  exist; it must not be faked with a wrapper, `uv`, or an embedded
  interpreter.
- **New proposition (not a default): an execution ban (« V-A »).** Refusing
  to execute the vendor product at all goes beyond QO4. If the owner wants
  that stricter posture, it is a **new** owner decision, to be taken
  through the decision-dossier route (owner rule 17/10), with its cost
  stated up front: 11/36 cells `not covered` until a non-Python backend
  exists, and « ALL CLIs » false meanwhile. Until such a decision exists,
  no lot may implement or preserve V-A as if it were the rule; the current
  branch guard is treated as a defect against QO4, fixed by Lot L7 (the
  guard is re-aimed, not deleted: §8.3).

D1 (§13) is accordingly closed as « already decided by QO4 » and removed
from the pre-code gates. What still needs owner input is only the
**operational** part QO4 does not cover: campaign caps (D2) and where the
trusted lane runs (D3).

### 8.3 Guard semantics (fixes F8 — scope: our launch chain, under QO4)

Current guard (`xcli-lab.mjs:200-205`): a 256-byte prefix regex
`^#![^\n]*\bpython\d*(?:\s|$)`. It misses `python3.14` (the dot breaks
`\d*(?:\s|$)`), `#!/usr/bin/env -S python3 …` variants it was not written
for, and any shell wrapper that `exec`s Python. It also says nothing about
descendants. Under QO4 the guard's object is precise: **no Python in the
launch chain we ship or operate** (harness shims, MCP commands we write,
test launchers, CI steps). The vendor product's own runtime, once the
vendor binary itself is launched, is the admitted `vendor-runtime`
allowance (§8.2) — recorded, not blocked. Lot L6 must:

- recognise versioned interpreters (`python`, `python3`, `python3.14`,
  `python3.14.x`), `env` forms (including `-S`), and absolute interpreter
  paths, with dummy-file unit tests that never execute the fixtures
  (review method);
- detect the one-level wrapper case by inspecting shell launcher text for an
  `exec`/direct invocation of a Python interpreter (closed patterns, dummy
  fixtures, no execution);
- **observe executions across the whole cell, not only at cleanup**
  (correction V2-7). A cleanup-time snapshot provably misses a transient
  descendant that already exited, so it can never close F8. **PROPOSITION:**
  each cell keeps an **execution journal** of its owned process subtree:
  every exec inside the cell's private PID namespace / pinned owned-process
  view is recorded with its resolved executable path, from cell start to
  cell end, by an event-grade source where the platform provides one
  (process-event feed of the private namespace, reaped-child records of
  the namespace init, or equivalent), and the journal is classified at
  cleanup: a Python interpreter executed anywhere in **our** chain
  (i.e. not strictly inside the launched vendor product's own subtree
  under the declared `vendor-runtime` allowance) classifies the cell
  `blocked` (`python-descendant-detected`). Only owned PIDs are observed;
  no host-wide process scan. The RED (Lot L6) uses a **harmless transient
  descendant**: a dummy executable carrying a Python-interpreter name
  (e.g. a copy of a trivial native binary named `python3.14`) spawned by a
  Node launcher fixture with lifetimes of ~1 ms, ~10 ms, and ~100 ms.
  Detection must be 3/3 at every tested lifetime for F8 to be declared
  fixed. Where no event-grade observation exists on a platform, the
  guarantee is **explicitly bounded** in evidence
  (`exec-observation: snapshot-only, transient descendants below the
  sampling interval not excluded`), F8 stays `partial` (§12), and no text
  may claim the contrary. A high-frequency procfs sampler inside the
  private namespace is an acceptable bounded fallback; it is not
  event-grade and must be labelled as the bounded variant with its
  sampling interval stated.
- keep the repo-wide `zero-python` gate (`scripts/check-no-python.sh`, on
  `main`) as the shipped-code guarantee. The harness guard is an execution
  policy for our launch chain, not a substitute for that gate, and the
  gate is never « satisfied » by relabelling shipped code as vendor
  runtime.

### 8.4 Gemini and AGY

Facts: AGY and Gemini cells block with `authentication-required` even when
only the authorised login files are copied (`.gemini/oauth_creds.json`,
`.gemini/google_accounts.json`, plus the harness-written
`selectedType: oauth-personal` selector). AGY currently reuses Gemini file
paths (`authFiles.agy` equals `authFiles.gemini`); no reusable AGY login
location is demonstrated, and no general HOME search was performed. The
owner's seat list includes 1 agy (agy/cloud-code) and no separate Gemini
seat. **PROPOSITION:** (a) treat agy and gemini as distinct families with
distinct manifest entries (§6.1); (b) Lot L9 diagnoses AGY login reuse in an
isolated HOME (which files, which keyring or token store, whether the login
survives a second enrollment — the 16/10 « measured first » rule for owner
accounts) before any AGY messaging cell is attempted; (c) Gemini R-tier
cells stay `blocked` / `not covered` until a Gemini seat exists. The 36-pair
denominator must keep showing those cells explicitly.

## 9. Lots (one primary lot per finding; RED tests first)

General lot rules: each lot is one reviewable change set on
`feat/live-cross-cli-messaging` after the rebase (Lot L1). Each lot starts
with a failing targeted test (RED) whose command and output are recorded,
then the minimal fix, then the same command green (GREEN), then the named
consumer replays. No lot runs the full repo suite. No lot weakens a guard,
an assertion, or the declared non-test manifest. Estimates are in agent
hours and review rounds (owner 12/10), never human engineer-days.
**PROPOSITION:** lot order L1 → L2 → L3 → L4 → L5 → L6 → L7 → L8 → L9 →
L10 → L11 → L12 → L13 → L14 → L15; L7 (Vibe under QO4, §8.2 — no decision
gate) and L9 (per-CLI unblocks) can proceed in parallel with L3–L6 once L1
lands, but no R-tier campaign runs before L3, L4, L5, and L8 are green.
Lots L12–L15 extend the **same** campaign machinery (seat manifest, caps
ledger, receipt) to the remaining function groups; their tier-S parts may
start as soon as L3 lands, their R2 parts require L8 + L11. Milestones:
L1–L11 green = partial milestone (§5.4) — the branch may merge into `main`
only through the §7.1 receipt gate over all R1/R2 rows already mandatory
in the candidate manifest; L12–L15 green and
ratcheted = final F3 satisfaction. No lot's report may call the partial
milestone « all functions covered ».

### Lot L1 — Rebase onto current `main` (fixes F4)

- **RED first:** `git merge-tree --write-tree origin/main HEAD` exits 1 with
  the three conflicts (§2.4). Record the output. Also record the three
  targeted suites' pre-rebase results for comparison (commands in §10).
- **Change:** rebase per §10 (backup ref, `git rebase origin/main`, resolve
  the three files under the §10 contract, push `--force-with-lease` to the
  own branch only). No product behaviour change beyond the resolutions.
- **Files:** `BRANCH.md`, `packages/h2a/src/hosts/muse.ts`,
  `packages/h2a/test/hosts-integration.test.js` (plus any new conflict file
  reported by the then-current `merge-tree` — stop and report if so).
- **GREEN proof:** `merge-tree` exits 0; the §10 targeted commands pass with
  the same or better counts as pre-rebase; `git log --oneline origin/main..HEAD`
  still shows the branch lots in order. Cost: ~1–2 agent-hours, 1 review
  round.

### Lot L2 — Wire the global gates to PID confinement (fixes F2)

- **RED first (through the entry being fixed — correction V2-9):** a new
  targeted test drives the **real gate dispatch**: it imports `runGates`
  and `STEPS` from `scripts/run-test-gates.mjs`, selects the real
  `h2a-runtime` step (its `reportPath`, `requiredFiles`, and
  `verifyExecution` proof intact), narrows only the Vitest file selection
  to `packages/h2a-runtime/src/native-terminal/upgrade.functional.test.ts`,
  and asserts the step verdict is `passed` **with** its execution proof
  (fresh report, required suite present with executed count > 0). On
  current code this is red: the step spawns Vitest directly
  (`run-test-gates.mjs`, `h2a-runtime` step: `node_modules/.bin/vitest`,
  `args: ['run', '--config', …]`), the fixture's
  `assertPrivatePidNamespace()` throws
  `historical host requires the private PID namespace launcher` in
  `beforeAll`, and `verifyExecution` cannot pass. Record the failing
  verdict, exit code, and message. Running Vitest directly (the v1 RED
  command) proves nothing about this lot — editing `run-test-gates.mjs`
  cannot change its outcome — so it is kept only as the **negative
  control** below. All runs targeted, temp dirs only; the full
  `h2a-runtime` step over all suites is **not** run by this lot (conductor,
  integration).
- **Change:** route the `h2a-runtime` step of `scripts/run-test-gates.mjs`
  (line 192, today a direct `node_modules/.bin/vitest run …` invocation)
  through `scripts/xcli-in-pid-namespace.mjs` on Linux, without removing
  `assertPrivatePidNamespace()` and without weakening any assertion. The
  step's execution proof (report freshness, required-suite verification)
  must keep working across the namespace boundary; receipts follow the
  existing private-evidence export pattern. Update the trust-root test
  (`packages/h2a/test/run-test-gates.test.js`) which pins the exact command
  string, **in the same commit**, so runner and trust root cannot drift —
  the update must assert the new confined command with the same strictness,
  never a looser match. Apply the same wiring to every other global entry
  that reaches the fixture (general CI `build-and-test`, release workflow)
  by making them call `npm test` / the gate runner rather than Vitest
  directly; inventory those entries in the lot and name each one.
  Non-Linux behaviour: the fixture already skips by platform
  (`describe.skipIf(process.platform !== "linux")`); the launcher wrapper
  must be Linux-gated so macOS/Windows entries are unchanged. Investigate
  the Astra runtime intermittence (18/19 → 1/1) with targeted replays under
  the launcher; either root-cause it or record it as an open item with its
  reproduction command. Do not mask it with a timeout raise.
- **Files:** `scripts/run-test-gates.mjs`,
  `packages/h2a/test/run-test-gates.test.js` (pinned command + the new
  dispatch test driving `runGates()`/`STEPS`; **PROPOSITION:** keep it in
  this trust-root file so runner, pin, and dispatch proof cannot drift
  apart), `scripts/xcli-in-pid-namespace.mjs` (only if the gate runner
  needs a pass-through mode), `.github/workflows/ci.yml`,
  `.github/workflows/release.yml` (only the entries the inventory names).
- **GREEN proof:** (1) the new dispatch test passes — `runGates()` over the
  real `h2a-runtime` step returns `passed` **and** `verifyExecution`
  confirms the narrowed required suite actually executed (a bare exit 0
  without the fresh report is a lot failure, per the step's own contract);
  (2) **negative control:** the direct invocation
  `node_modules/.bin/vitest run --config packages/h2a-runtime/vitest.config.ts packages/h2a-runtime/src/native-terminal/upgrade.functional.test.ts`
  **still fails** with `historical host requires the private PID namespace
  launcher` — proving the PID guard was wired around, not weakened or
  bypassed; (3) the trust-root test passes with the new exact pinned
  command; (4) `node scripts/xcli-in-pid-namespace.mjs scripts/xcli-runtime-tests.mjs`
  still passes (706 tests, same pending/todo declaration); the branch doc
  sentence « gate global non qualifié » is removed only after this proof.
  The full `npm test` run itself is executed by the conductor at
  integration, not by this lot. Cost: ~2–4 agent-hours, 2 review rounds
  (this lot touches the trust root).

### Lot L3 — Prove autonomous wake; reject polling (fixes F1, correction V2-1)

- **RED first (three reds, all recorded):** (1) the original polling fixture
  (reads inbox on a timer, ignores the wake) yields `simulated-OK`,
  `woke:true`, reply delivered on current code — the new assertion
  « polling must fail stage 7 » is red. (2) **The slow-poller
  counterexample that defeats v1's ordering criteria**: a fixture whose
  first periodic read lands strictly after the `inbox-wake ok` event, with
  zero reads between barrier and wake — it must be shown to **pass** every
  v1 §3.3 ordering condition on a v1-criteria harness (or by direct
  assertion over the emitted event order), so the lot proves it is fixing
  the reviewed defect and not a strawman. (3) **The v2 overlapping-window
  counterexample (§3.3(b2))**: `W0 = W1 = 10 s`, `D = 3 s`, wakes at
  21 / 21.414 / 21.732 s, first read at 23 s in every repetition, no earlier
  read, all wakes ignored. Show that all three repetitions pass v2's
  criteria; assert that this batch must earn no stage-7 credit. Command:
  `node --test scripts/xcli-simulation.test.mjs` with all three fixtures
  asserting stage-7 failure (red before the corresponding fix).
- **Change:** implement the §3.3 three-phase protocol in
  `scripts/qualify-cross-cli.mjs`: delayed sender launch (baseline `W0`),
  drive withholding at the private native host (withheld phase `W1`; the
  withholding point lives in the harness-owned host path —
  `packages/h2a-runtime/src/native-terminal/op.ts` drive handling as
  driven by the qualification host, or an equivalent harness-side gate on
  the drive request; no change to the product wake handler, whose
  retry-on-false semantics are the mechanism), release with PTY
  input-journal correlation and delay bound `D`, pre-barrier read counts,
  recorded notification interval, and separated replication support
  (§3.3's measured acceptance/withheld windows and containment check;
  no cell credited until the full batch passes). Families without a
  withhold point classify `blocked` (`wake-withhold-unavailable`); cells
  that cannot fund `W0 + W1 + D` classify `blocked`
  (`wake-window-unfunded`). Add the §3.3 controls (b) periods
  {1, 5, 15, 45, 90} s × phases {0, P/3, 2P/3}, (b2) overlapping-window
  counterexample, (c) withheld-forever twin,
  (d) replayed wake, plus the existing (a) dropped wake, to
  `scripts/xcli-simulation.test.mjs` and wire all of them into the PR
  lane. The simulated model's signed-wake verification stays mandatory and
  unchanged.
- **Files:** `scripts/qualify-cross-cli.mjs`,
  `scripts/xcli-simulated-model.mjs` (polling fixture modes only),
  `scripts/xcli-simulation.test.mjs`, `scripts/xcli-proxy.mjs` (withhold /
  release witness events, closed vocabulary only),
  `scripts/xcli-ci-check.mjs` (verify the new evidence fields, including
  the bounded-guarantee wording),
  `packages/h2a-runtime/src/native-terminal/op.ts` (only if the withhold
  point lands there; otherwise the harness-side file that carries it, named
  in the lot report), `.github/workflows/cross-cli-messaging.yml`
  (PR-lane step only).
- **GREEN proof:** every polling period × phase combination fails stage 7
  with exit 2 (tabulated in the lot report, not summarised as « polling
  covered »); the v1-counterexample fixture fails under the new protocol
  specifically by reading during the withheld phase or missing the delay
  bound; the v2 overlapping-window counterexample fails with
  `woke:false`, exit 2, `wake-phase-separation-unproven`. With the same
  polling schedule and a properly separated later repetition (for example,
  early acceptance `[21, 24] s` strictly inside later withholding
  `[10, 25.1) s`, relative to the barrier), the read at 23 s is observed
  during that repetition's withheld phase and fails stage 7. No batch
  without the required containment counts toward the replication proof;
  withheld-forever twin shows no qualifying read; wake-dropped
  still fails; normal simulated matrix still 36/36 on the targeted replay
  (`--pair` spot checks plus the CI job) with evidence carrying the
  §3.3 bounded wording (`periods ≤ W1 excluded, N separated replications;
  varying-phase polling not excluded`), never an absolute consumption claim; harness tests
  green. Cost: ~3–5 agent-hours (raised from v1: withhold point +
  replication), 1 review round.

### Lot L4 — Evidence hygiene and login-path confinement (fixes F5, F6)

- **RED first (F5):** extend `scripts/xcli-proxy.test.mjs` with a dummy
  server and a caller that passes unique canary strings as the inbox
  `instance` (including on a failing call); assert every canary is absent
  from `events.jsonl`. One canary is **instance-shaped** and sent before
  any identity is witnessed (correction V2-6 — red against any
  shape-based retention, including the v1 interim rule). Red on current
  code (line 88 retains `request.args.instance` verbatim).
- **RED first (F6):** extend `scripts/xcli-lab.test.mjs` with dummy trees:
  (a) `.codex` as a symlink to a dir outside the authorised root containing
  `auth.json`; (b) `.claude.json` as a direct symlink outside. Assert
  `copyLogin` copies nothing and reads nothing outside. Red on current code
  (lines 132, 143). Fixtures use `mkdtemp` only; nothing is executed.
- **Change (F5):** in `scripts/xcli-proxy.mjs`, retain per event only:
  `initialize`/`tools` booleans; `identity` (`ok`, `ready`, `instance`,
  `state`, closed-shape `cause`); `send` (`ok`, `kind`, `envelopeId`,
  `from`, `to`); `inbox` (`ok`, `instance`, filtered envelope
  `id`/`from`/`to`/`kind` for probe/reply bodies only); `inbox-wake`
  (`freshCount`, `ok`); `startup-phase` closed fields as today. Every
  retained instance identifier must be validated against the cell's known
  instances; before an identity is witnessed, instance fields are **not
  retained at all** — matching the instance shape is never a retention
  criterion (correction V2-6). **PROPOSITION:** the proxy learns the two
  cell instances from witnessed `identity` events plus an
  `XCLI_KNOWN_INSTANCES` handoff from the worker after readiness; the
  exact mechanism is implementer's choice, the drop-on-unknown behaviour
  is not. Forwarding of original RPC bytes is unchanged.
- **Change (F6):** in `scripts/xcli-lab.mjs` `copyLogin`, resolve every
  source path component-by-component (`lstat` each prefix, refuse any
  symlink, then `realpath` containment inside the seat's authorised root)
  before `copyFileSync` or any `readFileSync`, including `.claude.json`.
  Keep the allowlist, `0600`, and login-metadata-only extraction. Add the
  §6.3 token-pattern scan as a Node script and call it from the campaign
  entry before any evidence write outside the temp root.
- **Files:** `scripts/xcli-proxy.mjs`, `scripts/xcli-proxy.test.mjs`,
  `scripts/xcli-lab.mjs`, `scripts/xcli-lab.test.mjs`,
  `scripts/qualify-cross-cli.mjs` (known-instance handoff, scan call),
  new `scripts/xcli-evidence-scan.mjs` + its test (**PROPOSITION:** name;
  follow the existing `xcli-*` naming).
- **GREEN proof:** both RED tests pass; existing proxy test (no body
  retention, wake counters, envelope correlation) still passes; simulated
  spot cell (`--pair claude:codex`) still `simulated-OK`. Cost: ~2–3
  agent-hours, 1 review round.

### Lot L5 — Lost worker stops the campaign; secrets wiped regardless (fixes F7, correction V2-5)

- **RED first:** unit tests driving the campaign parent with (a) a worker
  stub that emits invalid JSON, (b) a worker stub that exits without
  output, (c) a cancellation during the active cell, and (d) a stub whose
  process-stop step fails. Each asserts: campaign stops, no further cell
  runs, **and every copied login file recorded for the cell is absent
  afterwards** (dummy login files in `mkdtemp`, checked by path). Red on
  current code: `qualify-cross-cli.mjs:443` fabricates a row and continues;
  the worker's own cleanup removes the cell only when `cleanupFailed` is
  false and otherwise records `privateCleanupRoot` — i.e. it keeps the
  logins exactly on failure.
- **Change:** treat unparseable/absent worker output as both §6.6
  obligations unproven: `cleanupFailed: true`,
  `blocker: qualification-worker-failed-cleanup-unproven`, set `stopping`.
  The parent then (1) runs bounded process recovery — stop only PIDs in
  that cell's pinned private-process records, never pattern-kill — and
  (2) **independently** runs the secret wipe over the recorded per-role
  copy list and re-checks absence file by file. « Preserve the root for
  diagnosis » is removed from every failure path: filtered diagnostics
  already live in the row; a root is kept only after a proven wipe. A wipe
  that cannot be proven classifies `secret-wipe-unproven` and triggers the
  §6.6 confinement-recovery reporting (paths named, contents never read;
  campaign non-resumable until resolved). Apply the same split inside the
  worker's own `finally` cleanup (process-stop failure must no longer skip
  removal). Preserve the per-cell JSON write and exit code 2.
- **Files:** `scripts/qualify-cross-cli.mjs`, `scripts/xcli-cleanup.test.mjs`
  (new cases), `scripts/xcli-lab.mjs` only if the copy-list record needs a
  shared home, `docs/cross-cli-qualification.md` (one sentence, via Lot L10).
- **GREEN proof:** all four RED cases green — campaign stopped **and**
  login copies absent in each, including the process-stop-failure case;
  existing cleanup tests green; simulated spot cell green with
  `cleanup-complete` carrying separate `processRecovery` / `secretWipe`
  booleans. Cost: ~1–2 agent-hours, 1 review round.

### Lot L6 — Python guard that can be trusted (fixes F8; scope per §8.3, correction V2-7)

- **RED first:** (1) dummy-file unit tests (no execution) asserting the
  guard rejects `#!/usr/bin/env python3.14`, `#!/usr/bin/env -S python3 -u`,
  an absolute `…/python3.12` shebang, and a `/bin/sh` wrapper whose body
  `exec`s Python — red on current code for the versioned and wrapper cases.
  (2) **Transient-descendant fixture**: a Node launcher in a temp cell
  spawns a harmless dummy executable named `python3.14` (a trivial native
  binary copy; nothing Python ever runs) with lifetimes ~1 ms, ~10 ms,
  ~100 ms; the test asserts the cell execution journal records all three.
  Red on any cleanup-snapshot-only design by construction.
- **Change:** rewrite `pythonEntrypoint` in `scripts/xcli-lab.mjs` per
  §8.3 (versioned interpreters, `env` forms, one-level wrapper text
  inspection), aimed at **our** launch chain under QO4. Add the §8.3
  whole-cell execution journal (event-grade source where available;
  bounded sampler fallback explicitly labelled) and classify at cleanup
  with blocker `python-descendant-detected`, honouring the declared
  `vendor-runtime` subtree allowance. Do not touch
  `scripts/check-no-python.sh` semantics; any allowlist change is a
  separate owner-visible change in Lot L7, never folded in here.
- **Files:** `scripts/xcli-lab.mjs`, `scripts/xcli-lab.test.mjs`,
  `scripts/qualify-cross-cli.mjs` (journal wiring + blocker code),
  `scripts/xcli-pid-namespace.test.mjs` / `scripts/xcli-pid-init.cc` only
  if the event source lands in the namespace init,
  `scripts/xcli-ci-check.mjs` (journal / bounded-label verification).
- **GREEN proof:** guard tests green; existing environment test (node
  shebang accepted, `python3` rejected) still green; transient fixture
  detected 3/3 at each lifetime on the qualification platform, **or** the
  lot reports the bounded variant with its sampling interval and F8 is
  recorded `partial` — the lot may not report F8 fixed on a snapshot
  check. Vibe's own entrypoint is no longer blocked by this guard once
  Lot L7 lands (QO4); until L7, its blocked status is reported as the
  known QO4 deviation, not as a policy. Cost: ~2–4 agent-hours (raised
  from v1: execution journal), 1 review round.

### Lot L7 — Vibe qualification path under QO4 (fixes the Vibe part of F3/F9; correction V2-8)

- **Entry gate:** none. QO4 is the standing owner rule (§8.2); this lot
  applies it. A decision dossier is required only if a stricter execution
  ban is later proposed — that would be a new decision superseding this
  lot, not a prerequisite for it.
- **RED first:** (1) a unit test asserting the harness classifies the
  installed vendor `vibe` entrypoint as `vendor-runtime: python (not
  shipped)` and does **not** block the cell with
  `python-entrypoint-forbidden` (red on current code: all 11 Vibe cells
  block pre-execution); (2) a tier-C oracle asserting the real Vibe binary
  accepts the h2a-written `~/.vibe/config.toml` MCP entry (Node writer,
  #340) — red until the oracle exists. Fixtures never execute Python from
  our chain; the oracle runs the vendor binary only in the campaign/oracle
  lanes where vendor execution is the point.
- **Change:** re-aim the guard per §8.3 (refuse Python in **our** launch
  chain; record the vendor runtime), `authFiles.vibe` (only files an
  authorised Vibe seat provides; empty stays valid and cells then block on
  `authentication-required`, not on Python), tier-C oracle for Vibe, and
  `vendor-runtime` labelling in all evidence. Our shipped writer, harness,
  and CI remain 0 Python; extend `scripts/xcli-native-config.test.mjs` /
  `xcli-install-oracles.mjs` to Vibe. Keep the §8.1/§8.2 finding visible
  in the entry doc: **no non-Python Vibe backend exists today** — if one
  appears upstream, preferring it is a follow-up change, not a silent
  swap.
- **Files:** `scripts/xcli-lab.mjs`, `scripts/xcli-lab.test.mjs`,
  `scripts/xcli-native-config.test.mjs`, `scripts/xcli-install-oracles.mjs`,
  `packages/h2a/src/hosts/vibe.ts` (only if the config contract changes),
  `docs/cross-cli-qualification.md`.
- **GREEN proof:** Vibe tier-C green; simulated Vibe cells still 6/6 rows
  green at S; `zero-python` gate still green and its allowlist unchanged by
  this lot; no Python added anywhere we ship; Vibe real cells block only
  on seat/auth grounds until a Vibe seat exists (D4-analog), reported as
  such. Cost: ~2–4 agent-hours, 1 review round. (The v1 decision-dossier
  hour is removed: there is no open decision to dossier.)

### Lot L8 — Seat manifest and campaign engine (fixes F9; enables F3)

- **RED first:** unit tests asserting (a) `--pair claude-a:claude-b`
  selects distinct auth sources per role (red today: one `authHome`);
  (b) a diagonal single-seat cell records `sharedSeat: true`; (c) an AGY
  entry pointing at Gemini files is refused as proof; (d) a
  `provider-quota` classification stops further cells on that seat;
  (e) **caps enforcement (correction V2-4)** — with a dummy launcher: a
  launch that would exceed the launched-session cap is refused **before**
  spawn (no process record created) and the cell is `blocked`
  (`campaign-cap-exhausted`); a preflight launch and an infra retry are
  debited exactly like a first attempt; a fixture looping MCP calls is
  stopped at the per-session MCP-call cap and classified
  `mcp-call-cap-exceeded`; a silent fixture (no MCP calls) is bounded by
  its session unit + watchdog and reported with that stated bound; killing
  and **resuming** the campaign continues from the persisted ledger
  (counters not reset). Every (e) case is red on v1's display-only counter
  and on current code. Use dummy seat dirs in `mkdtemp`; no real login, no
  model.
- **Change:** seat manifest per §6.1 (`--seat-manifest <file>`, per-role
  `copyLogin` source, seat-qualified `--pair`, version/digest recording),
  the §6.4 composite caps with pre-spawn debit and persistent ledger,
  preflights per §6.5, the per-family usage-signal inventory (record, per
  family, whether a structured turn/usage signal is obtainable without
  reading transcripts; absence is a named `source-gap`, never papered over
  by renaming MCP calls « turns »), and the tiered status emitter per §5.5. Keep `--auth-home` as a deprecated
  single-seat alias for one transition (**PROPOSITION:** remove it once the
  manifest is the documented entry; removal is an owner-visible breaking
  change to a harness-only flag). When sentropic L1 publishes
  `importSeatBundle` (PR #681), add the L1 consumption path behind the
  same manifest (`authSource` becomes a seat reference) with synthetic
  bundles first (PR #348 method: ten offline imports, zero refresh on
  401/expiry) before any native credential is handled. Until then the
  file-copy path is labelled interim in code, docs, and evidence
  (`seatMode: interim-file-copy`).
- **Files:** `scripts/qualify-cross-cli.mjs`, `scripts/xcli-lab.mjs`,
  `scripts/xcli-lab.test.mjs`, new `scripts/xcli-seats.mjs` + test
  (**PROPOSITION:** name), `scripts/xcli-ci-check.mjs`,
  `docs/cross-cli-qualification.md`.
- **GREEN proof:** new manifest tests green; simulated campaign unchanged
  36/36 on CI; a dummy-seat real-mode dry run blocks cleanly with
  classified reasons and wipes its temp HOMEs. No real quota spent by this
  lot. Cost: ~4–6 agent-hours, 2 review rounds.

### Lot L9 — Unblock each real CLI (one sub-lot per family; enables R1)

Each sub-lot is diagnosis-first: reproduce the branch's archived failure in
an isolated cell, identify the startup/MCP/auth cause from closed-vocabulary
evidence only, fix the product or harness cause minimally, and prove the
diagonal cell before any cross pair. No sub-lot may disable permissions,
persist trust outside the temp workspace, or read beyond authorised seat
files. Details and archived failure signatures are in §11.

- **L9a Codex:** MCP not loaded before deadline (draft visible, no
  `initialize`). Files: `packages/h2a/src/hosts/codex.ts`,
  `scripts/qualify-cross-cli.mjs` (`argsFor`, startup handling),
  `scripts/xcli-terminal.mjs` only if terminal-query evidence requires it.
  The branch already refuted: pre-barrier Enter (no effect, removed) and
  OSC colour replies (no effect, removed). Do not reintroduce refuted
  probes without new evidence.
- **L9b Muse:** interactive session exits code 1 after Trust; isolated
  `exec` preflight also exits 1 without a recognised diagnostic, so auth
  is **not** established as the cause. Files:
  `packages/h2a/src/hosts/muse.ts` (post-L1 merged contract),
  `scripts/xcli-lab.mjs` (`privateExecutable`),
  `scripts/xcli-muse-config.test.mjs`. The schema fix is already proven
  against the real parser; this sub-lot owns the exit-after-Trust cause.
- **L9c AGY:** login selection blocks (`Select login method` →
  `authentication-required`); AGY → Claude loaded both MCPs but sent
  nothing in 60 s with an unhandled `Select` screen. Files:
  `packages/h2a/src/hosts/agy.ts`, `scripts/xcli-lab.mjs` (AGY auth list),
  `scripts/qualify-cross-cli.mjs` (startup vocabulary). Includes the §8.4
  login-reuse diagnosis (second-enrollment survival, measured first).
- **L9d Claude (regression guard only):** the diagonal green exists. This
  sub-lot only replays it after L1–L8 under the manifest (Claude A → Claude B
  with two seats) and pins the 2.1.301 trust-dialog navigation fixture.
- **GREEN proof per sub-lot:** preflight (§6.5) green, diagonal R1 cell
  `measured-OK` within the §3.5 budget as extended by the §3.3 wake protocol, with full §3 evidence, then one cross pair against
  the already-green Claude family. A sub-lot that cannot reach diagonal
  green reports its classified blocker and stops; it does not borrow
  another family's green. Cost: **PROPOSITION:** 2–4 agent-hours per
  family plus campaign quota; 1 review round per family. Total R1 run to
  16/16 is a campaign (Lot L11), not part of L9 estimates.

### Lot L10 — Documentation truth (fixes F10)

- **RED first:** a doc test (Node) asserting
  `docs/cross-cli-qualification.md` states the current measured balance
  and links the latest per-tier tables; red while it claims zero real
  cells.
- **Change:** rewrite the entry doc to: link the phase-1 table as history,
  state **1/36 real (Claude → Claude), no real inter-CLI pair qualified**,
  point to the resume evidence, describe tiers S/C/R1/R2 and the ratchet,
  the seat manifest entry, the campaign lane, and the NOT-covered list
  (§12). Update `docs/2026-10-16-cross-cli-resume.md` only by appending
  campaign results; never rewrite archived receipts.
- **Files:** `docs/cross-cli-qualification.md`, new doc test under
  `scripts/` (**PROPOSITION:** `scripts/xcli-docs.test.mjs`).
- **GREEN proof:** doc test green. Cost: ~1 agent-hour.

### Lot L11 — Trusted campaign lane + receipt gate in CI/CD (fixes the R1 part of F3; correction V2-3)

Scope note (correction V2-2): this lot delivers the probe's R1 gate and
the machinery every later R2 row reuses. It does **not** by itself satisfy
« all functions, all combinations »; Lots L12–L15 carry the remaining
function groups into the same lanes. Loop, negotiation, and the other
inventory rows enter the manifest as `not covered` with named blockers and
a named owning lot (L12–L15) — never as free-floating « follow-up lots ».

- **Entry gate:** Lots L1–L6, L8 green; L9 diagonal greens for every family
  in the campaign scope; Decisions D2 (numeric caps, in §6.4 units) and D3
  (runner) ratified. (No D1: closed by QO4, §8.2.)
- **RED first:** (1) workflow tests asserting the campaign workflow refuses
  to run without an explicit seat set and refuses fork refs; (2) **receipt
  check refusals** (§7.1): dummy receipts in temp dirs — absent, wrong SHA,
  stale digest/version, a `blocked` mandatory cell, a mandatory row
  missing, a simulated receipt at an R gate, an unproven secret wipe —
  each fails `xcli-receipt-check.mjs` with its distinct code, while an
  all-green exact-SHA fixture passes. Also exercise `--gate merge` with
  R1 entirely green and an already-mandatory R2 row first absent, then
  `blocked`: both must refuse, including a receipt that omits R2 from its
  declared mandatory set. The positive twin passes only when all mandatory R1/R2 cells
  are `measured-OK` and the other receipt conditions hold. All red before
  the corresponding check exists or includes the R2 merge scope.
- **Change:** add the protected trusted campaign workflow per §7 (manual +
  scheduled + pre-merge on the frozen candidate head, concurrency 1,
  filtered receipt artifact, §6.4 ledger summary, cancel cleanup with the
  unconditional secret wipe), the no-secrets receipt check in the PR lane
  (required on the branch→`main` PR and the release lane; report-only on
  lot PRs into the feature branch, printing `qualification: open`),
  tier-C oracles extended from Claude/Codex to every family with an
  installable no-login parse path (Vibe via Lot L7), and the matrix
  manifest (§5.4) with the probe mandatory at S/C/R1 for the 16 profile
  pairs. Both merge and release are gated on the same check at R1 + ratcheted-R2 scope.
- **Files:** `.github/workflows/cross-cli-messaging.yml` (PR lane,
  including the receipt-check job), new
  `.github/workflows/cross-cli-campaign.yml` (**PROPOSITION:** name), new
  `scripts/xcli-receipt-check.mjs` + test (**PROPOSITION:** name),
  `scripts/xcli-install-oracles.mjs`, `scripts/xcli-native-config.test.mjs`,
  `scripts/xcli-ci-check.mjs`, matrix manifest file (**PROPOSITION:**
  `docs/cross-cli-matrix.json`, versioned, machine-checked against
  `tools/list` and against per-row scenario presence, §5.1),
  `.github/workflows/release.yml` (receipt-check step only).
- **GREEN proof:** PR lane green on Node 22+24 including all receipt-check
  refusal cases; one full R1 campaign **on the trusted lane** whose
  receipt passes the check for that exact SHA (16/16 mandatory profile
  pairs `measured-OK`, §3.3 protocol included). A campaign that comes back
  `blocked` or incomplete is a lot **failure recorded as an open
  qualification** — it is never GREEN proof, and a conductor-local run is
  never a substitute for the trusted-lane receipt (v1 wordings to that
  effect are withdrawn); release dry-run refuses without a passing
  receipt. Cost: ~4–8 agent-hours + campaign quota (debited per §6.4),
  2 review rounds.

### Lot L12 — Unavailability and refusal rows, N×N (12/10 scenario 2; correction V2-2)

- **Entry gate:** L3 (shared scenario machinery) for tier S; L8 + L11 for
  the R2 ratchet.
- **RED first:** simulated cells asserting that a send to (a) a stopped
  peer session, (b) an unknown instance, (c) an instance whose identity
  never became ready, currently either reports a durable-only success or
  an unclassified failure — each must instead fail closed with its
  classified code and must not produce wake credit or a live-delivery
  claim. Plus the refusal twins: unsigned wake, mis-addressed wake,
  replayed wake delivered to the scenario runner (extending the existing
  simulated-model guards to scenario level).
- **Change:** scenario definitions in the matrix manifest for the
  unavailability row (per-pair, ordered: sender × unavailable-receiver
  state) and the refusal class; a scripted scenario mode in the simulated
  runner (**PROPOSITION:** `scripts/xcli-scenarios.mjs`, shared by
  L12–L15) driving the real MCP through `h2a_send` / `h2a_inbox` /
  `h2a_discover_instances` against stopped/unknown peers; manifest rows
  promoted to mandatory at S (36 ordered pairs × each unavailability
  state), then proposed for R2 ratchet on seated pairs once L9 greens
  exist per family.
- **Files:** `scripts/xcli-scenarios.mjs` (new, **PROPOSITION:** name),
  `scripts/xcli-scenarios.test.mjs` (new), `scripts/qualify-cross-cli.mjs`
  (`--scenario` dispatch only), `scripts/xcli-proxy.mjs` (closed-vocabulary
  refusal events only), `docs/cross-cli-matrix.json`.
- **GREEN proof:** S matrix for this row 36/36 per unavailability state,
  refusal twins fail closed; no durable-only outcome is ever worded as
  delivery; R2 campaign cells green on seated pairs before the row is
  called R2-mandatory. Cost: ~3–5 agent-hours + R2 campaign quota,
  1 review round.

### Lot L13 — Loop rows, N×N (12/10 scenario 3; correction V2-2)

- **Entry gate:** L12's scenario machinery; L8 + L11 for R2.
- **RED first:** simulated scenario asserting a full loop lifecycle across
  two different CLI families — `h2a_loop_create` by family A,
  `h2a_loop_join` + `h2a_loop_report` by family B, `h2a_loop_status` /
  `h2a_loop_list` witnessed from both sides, `h2a_loop_done` /
  `h2a_loop_stop` terminal states — currently unexecutable in the harness
  (probe-only runner), plus refusal twins (join unknown loop, report
  without join, double-done). Existing product suites
  (`packages/h2a/test/loop-*.test.js`) prove loop semantics in-process;
  they prove nothing cross-CLI and are inputs, not substitutes.
- **Change:** loop scenario (creator×participant ordered role pairs, 36 at
  S; loop wake path `reason=loop` witnessed where the scenario crosses a
  wake), manifest rows for `h2a_loop_create`, `h2a_loop_join`,
  `h2a_loop_report`, `h2a_loop_status`, `h2a_loop_list`, `h2a_loop_done`,
  `h2a_loop_stop`; R2 ratchet on seated role pairs in full (16 profile
  role pairs), each cell under the §6.4 ledger and §3.3 wake rules where
  a wake is claimed.
- **Files:** `scripts/xcli-scenarios.mjs`, `scripts/xcli-scenarios.test.mjs`,
  `scripts/qualify-cross-cli.mjs`, `scripts/xcli-proxy.mjs` (loop events,
  closed vocabulary), `docs/cross-cli-matrix.json`.
- **GREEN proof:** S 36/36 role pairs with witnessed terminal state from
  both sides; refusal twins fail closed; R2 seated role pairs green in a
  trusted-lane receipt before « loop R2 » is claimed. Cost: ~4–6
  agent-hours + campaign quota, 1 review round.

### Lot L14 — Negotiation rows, N×N (12/10 scenario 4; correction V2-2)

- **Entry gate:** L12's scenario machinery; L8 + L11 for R2.
- **RED first:** simulated scenario asserting `h2a_open_negotiation` (A) →
  `h2a_offer` (A) → `h2a_counteroffer` (B) → `h2a_stabilize` (signed, both
  sides) across two families, with journal growth witnessed — unexecutable
  in today's probe-only harness; refusal twins (offer on unknown
  negotiation, stabilize without the counterparty's offer, replayed
  stabilization signature). In-process semantics already have suites
  (`packages/h2a/test/cli-negotiate*.test.js`,
  `local-store-negotiation.test.js`); cross-CLI execution does not exist.
- **Change:** negotiation scenario (initiator×responder ordered pairs, 36
  at S; where a witness/third-party role is intrinsic to a row, ordered
  triples in full at S = 120 per §5.1); manifest rows for
  `h2a_open_negotiation`, `h2a_offer`, `h2a_counteroffer`,
  `h2a_stabilize`, `h2a_append_journal`; R2 on seated role pairs in full,
  triples per the manifest denominator stated under D2 (§5.1).
- **Files:** `scripts/xcli-scenarios.mjs`, `scripts/xcli-scenarios.test.mjs`,
  `scripts/qualify-cross-cli.mjs`, `scripts/xcli-proxy.mjs` (negotiation
  events, closed vocabulary; no offer bodies retained),
  `docs/cross-cli-matrix.json`.
- **GREEN proof:** S role pairs 36/36 and intrinsic triples complete per
  the manifest denominator; refusal twins fail closed; R2 receipt green
  before any « negotiation works cross-CLI » wording. Cost: ~4–6
  agent-hours + campaign quota, 1 review round.

### Lot L15 — Remaining inventory rows by class (closes the §5.1 inventory; correction V2-2)

- **Entry gate:** L12 scenario machinery; per-group R gates as in L13/L14.
  This lot is a **sequence of sub-lots, one per group below**, each with
  its own RED, review round, and manifest promotion; the lot is green
  only when no inventory row remains `scenario undefined`.
- **Groups and scenarios (each row: executed + witnessed, per §5.1 — a
  `tools/list` mention is never coverage):**
  - **L15a `per-cli` read paths:** `h2a_identity_status` (already in the
    probe; promoted as its own row), `h2a_discover_instances`,
    `h2a_discover_sessions` (incl. name resolution — the reviews' named
    gap), `h2a_read_payload`, `h2a_inbox` remaining actions (`pop` and the
    non-read actions the tool publishes at the tested SHA). Crossed per
    family at S/C; R rows per seated family.
  - **L15b `per-pair` session/delegation paths:**
    `h2a_register_instance`, `h2a_session_open`, `h2a_session_close`,
    `h2a_run` (delegation to a peer session, with refusal twin on an
    unreachable peer), `h2a_sign` cross-verification (A signs, B verifies
    through product paths). Ordered pairs, 36 at S.
  - **L15c `multi` conductor + drive-consent paths:** `h2a_conductor`,
    `h2a_conductor_claim`, `h2a_conductor_launch`,
    `h2a_conductor_launch_check`, `h2a_conductor_release`
    (claimant×releaser role pairs + contested-claim refusal twin);
    `h2a_drive_consent_request/_respond/_cosign/_status/_revoke`
    (requester×responder pairs; cosign triples per §5.1 denominators).
    In-process suites exist (`gov-conductor*.test.js`,
    `drive-consent-*.test.js`); cross-CLI execution is this sub-lot.
  - **L15d governance/reporting rows:** `h2a_escalate`,
    `h2a_blockage_raise/_list/_resolve`, `h2a_attest_comprehension`,
    `h2a_conflict_posture`, `h2a_declare_conflit_interet`,
    `h2a_nhi_inventory/_attest/_report/_export/_offboard` — classed per
    row (`per-cli`, `per-pair`, or `multi`) in the manifest with a named
    scenario each; rows for which no defensible cross-CLI scenario exists
    (purely local reporting with no peer-observable effect) are classed
    `per-cli` and proven per family, with the classification justified in
    the manifest commit — reclassing a row to dodge a cross product
    requires the same owner-visible justification as a downgrade (§5.4
    rule 3).
  - **CLI verbs:** the `cli-command-map.ts` cross-CLI subset named in
    §5.1 (send/inbox incl. `pop` + name resolution, sessions
    list/resume/stop, host setup/status, upgrade refusal) gets one
    scenario row each, driven through the per-role `h2a` shim so CLI and
    MCP surfaces are proven against the same cells.
- **Files:** `scripts/xcli-scenarios.mjs`, `scripts/xcli-scenarios.test.mjs`,
  `scripts/qualify-cross-cli.mjs`, `scripts/xcli-proxy.mjs`,
  `scripts/xcli-simulated-model.mjs` (scripted multi-tool behaviour only),
  `docs/cross-cli-matrix.json`, `docs/cross-cli-qualification.md`.
- **GREEN proof:** manifest gate green with **zero** rows in
  `scenario undefined` state; tier-S full cross product per class green;
  each sub-lot's rows promoted only with their evidence; final F3
  satisfaction (§5.4) additionally requires the R2 receipts for every row
  the owner has ratcheted. Cost: **PROPOSITION:** ~3–6 agent-hours per
  sub-lot (L15a–d + verbs) + campaign quota per R promotion, 1 review
  round per sub-lot.

## 10. Rebase plan (Lot L1 detail)

Basis: merge base `54e7ffd7`; branch head `97f93e72` (17 commits);
`origin/main` at review time `d0b1afa3`. Owner rules: update by rebase on
`main`, never merge `main` into the branch; push `--force-with-lease` to
`feat/live-cross-cli-messaging` only; never touch `main`; final PR merge is
a merge commit, never squash. Work in the existing worktree
`/home/antoinefa/src/h2a/tmp/worktrees/xcli` or a fresh worktree of the same
branch; never in the owner's live checkout state.

Steps (each step records its command and output):

1. Freeze facts: `git fetch origin`; record `git rev-parse origin/main HEAD`
   and `git merge-base origin/main HEAD`. Create a backup ref
   (`git branch backup/xcli-pre-rebase-97f93e72 97f93e72`) and do not push it
   unless the conductor asks. Working tree must be clean (`git status`).
2. Pre-rebase baselines (targeted only, temp dirs):
   `node --test scripts/xcli-lab.test.mjs scripts/xcli-proxy.test.mjs scripts/xcli-simulation.test.mjs scripts/xcli-gemini-registry.test.mjs scripts/xcli-cleanup.test.mjs scripts/xcli-pid-namespace.test.mjs scripts/xcli-terminal.test.mjs scripts/xcli-startup.test.mjs scripts/xcli-evidence.test.mjs`
   and `node scripts/xcli-source-tests.mjs packages/h2a/test/hosts-integration.test.js`
   and the simulated spot cell
   `node scripts/qualify-cross-cli.mjs --simulated --pair claude:codex --timeout-ms 30000 --output <temp>/cell.json`.
   Record counts; post-rebase must match or beat them.
3. `git rebase origin/main`. Resolve conflicts per the contract below. If a
   conflict appears in any other file, stop (`git rebase --abort` is not
   required; leave the rebase paused) and report — do not invent a
   resolution for unlisted files.
4. Re-run step 2 verbatim. Any new failure is a rebase defect to fix inside
   L1, not a reason to weaken a test.
5. `git merge-tree --write-tree origin/main HEAD` must exit 0.
   `git log --oneline origin/main..HEAD` must show the 17 branch commits in
   original order (subjects unchanged; no squashing during rebase).
6. Push `git push --force-with-lease origin feat/live-cross-cli-messaging`.
   Conventional English subjects already on the commits stay; no trailers
   are added. Report old head, new head, and the three resolutions.

Per-file resolution contract:

- **`BRANCH.md`:** both sides replaced the file (branch: live-messaging lot
  plan from base 0.98.6; main: dossier-diagrams lot plan, merged via PR
  #377). `BRANCH.md` is per-branch working state. Resolution: keep the
  **branch** content, updated to record the rebase (new base SHA, L1 done).
  Main's dossier-diagrams plan is already merged history; it must not
  overwrite this branch's plan. Verify no dossier-diagrams lot text remains.
- **`packages/h2a/src/hosts/muse.ts`:** branch adds `schema_version: 1` at
  the config root plus a merge hint; main deliberately omits the schema and
  marks the render as historical, non-migrated, awaiting registry bootstrap
  (« Rendu historique non recommandé — non migré — bootstrap registre
  attendu »). Resolution must keep **both**: `schema_version: 1` (the real
  Muse parser refuses the file without it — proven by the branch's
  `muse config status` oracle, red without, green with) **and** main's
  non-migrated/registry-bootstrap wording and semantics. The hint must not
  instruct a merge behaviour main's migration rules forbid. Verify with
  `node --test scripts/xcli-muse-config.test.mjs` (3/3, real parser, no
  model) and the hosts-integration assertions below.
- **`packages/h2a/test/hosts-integration.test.js`:** main-side change
  (around line 249): the remote-endpoint render is parsed and, for `muse`
  and `agy`, `rendered.migration` must match `/non migré/` and
  `rendered.hint` must not match `/Merge|Translate|re-run/`; other hosts
  must render exactly `['mcpServers']`. Branch-side changes: Codex hint now
  requires `~/.codex/config.toml` and `[mcp_servers.h2a]` with
  `path.example` `~/.codex/config.toml` (line ~53); Claude requires
  `path.example` `~/.claude.json` and a `CLAUDE_CONFIG_DIR` hint (line
  ~106); the remote-endpoint deep-equal gains
  `...(host === "muse" ? { schema_version: 1 } : {})` (line ~254); plus two
  new Muse write tests (schema written while preserving unrelated
  settings; unknown schema refused even with `--force`, file untouched).
  Resolution: keep **all** of both sides. The remote-endpoint assertion
  becomes: parse the render; `mcpServers` deep-equals the URL server; for
  `muse`, `schema_version` is 1 **and** the main-side migration/hint
  assertions hold; for `agy`, the migration/hint assertions hold; for other
  hosts, keys are exactly `['mcpServers']`. No assertion from either side
  is dropped or loosened. Verify with the full targeted file via the PID
  launcher (28 tests pre-rebase on the branch; post-rebase count must be
  ≥ that plus main's added assertions, all passing).

Rollback: the backup ref from step 1 restores the pre-rebase head exactly.
A failed rebase is reported with the paused state preserved; history is
never rewritten on `main` and the backup ref is never deleted by the lot.

## 11. Per-CLI unblock tracks (Lot L9 detail; archived signatures)

All signatures below are branch-archived facts. « Cause » is stated only
where the branch established it; otherwise the cause is `unknown` and the
sub-lot's first job is diagnosis from closed-vocabulary evidence.

| Family | Archived signature | Established / refuted | First diagnostic step |
| --- | --- | --- | --- |
| Claude | Diagonal `measured-OK` at 60 s after two fixes: 2.1.301 trust dialog (indexes hidden, focus on Cancel; harness waits for stability, navigates explicitly to Yes, waits for dialog exit without re-typing) and native wake submitted as validated line + single Enter in a distinct burst after 100 ms under the same lease (`wakeDraft=true` before the fix) | Established. Functional drive test 0/1 → 1/1. KO reproduced at 60 s before the fix | Regression replay only (L9d): Claude A → Claude B under the seat manifest |
| Codex | `measured-KO`, `mcp-not-loaded-before-deadline`: instruction visible as a draft (`qualificationDraft`), `composerReady:true`, `mcpLoaded:false`, `wakeArmed:false`, no model tool call. Three descendants observed in state S, then collected | Refuted: pre-barrier Enter (no change, removed); OSC colour replies (no change, removed; only the query-type observer kept). Cause `unknown` | Reproduce Codex → Codex; inspect startup facts, terminal query kinds, and whether the draft needs a product-supported submit path. Check `argsFor` (`--no-daemon --no-alt-screen`) against the pinned Codex version's documented non-interactive behaviour. Tier-C oracle already proves config parse; the gap is startup-to-MCP, not config syntax |
| Muse | `blocked`, `cli-exited-before-ready`: interactive session exits code 1 after Trust. Isolated `exec` preflight also exits 1 with no recognised diagnostic | Established: settings without `schema_version: 1` are refused by the real parser; with it, accepted, unrelated settings preserved, unknown schema refused even with `--force`. Installation-side update notice isolated by the private program copy. **Not** established: that auth causes the exit | Reproduce Muse → Muse with the private program copy; collect `cli-exit` facts (screen + raw, closed vocabulary) and owned-descendant states. Compare `exec` vs interactive under identical temp HOMEs to separate auth, TTY, and MCP-stdio-pickup hypotheses (the host descriptor itself notes stdio pickup is unconfirmed vs documented streamable-HTTP) |
| AGY | `blocked`, `authentication-required` on the login-selection screen despite copied authorised files. Separately, AGY → Claude: both MCPs loaded, no AGY send in 60 s, unhandled `Select` screen | Established: the login-selection screen is now classified explicitly (red 6/1 → green 7/0 in branch tests). Not established: a reusable AGY login location | §8.4 login-reuse diagnosis first (isolated HOME, measured-first second-enrollment check). Then the `Select` startup screen: extend the closed startup vocabulary only for normal UI in the empty temp workspace, never for tool approval |
| Gemini | `blocked`, `authentication-required` despite copied authorised files + harness-written `oauth-personal` selector | Cause `unknown` beyond « copied files insufficient in an isolated HOME ». No Gemini seat in the owner's list | No R-tier work until a Gemini seat exists. Keep tier-S (simulated layout) and any tier-C parse oracle. Report as `not covered` |
| Vibe | `blocked`, `python-entrypoint-forbidden:vibe`, 11 cells, 0–1 ms (refused before execution) | Established: §8.1 launcher/app-server facts. No Python executed | Lot L7 applies QO4 (no decision gate, §8.2); diagnosis starts there |

Cross-cutting: the harness startup vocabulary (`startupKey`,
`blockingScreen`, `startupFacts`) may only grow with screens actually
observed in isolated cells, each addition pinned by a unit test in
`scripts/xcli-lab.test.mjs` / `scripts/xcli-startup.test.mjs`. Guessing at
screens from documentation alone is out of scope.

## 12. What is NOT covered (explicit non-claims)

Nothing below is proven by the branch today, and the remediation must keep
saying so until the named lot lands. Status wording must use these exact
states: `unknown`, `source-gap`, `missing source`, `unverified`, `partial`,
`not covered`.

- **Real inter-CLI messaging:** `not covered`. 1/36 real, diagonal only.
  35 real cells carry no support claim. 29 cells were never replayed after
  phase 1 (`unverified` beyond their phase-1 status).
- **All-functions coverage:** `partial`. The probe exercises identity, send,
  inbox read, wake, and reply. Name resolution, other inbox actions
  (`pop`), sessions (open/close/list/resume/stop), negotiations, loops,
  conductor, drive consent, delegation, and the remaining MCP rows are
  `not covered` until Lots L12–L15 and the §5.4 ratchet promote them with
  evidence. **F3 as a whole stays open until then** (§5.4): the partial
  milestone (L1–L11) does not close it.
- **Autonomous wake, absolute form:** `not covered`. §3.3 proves an
  experimental exclusion (polling periods ≤ `W1` excluded deterministically;
  longer periods only for an invariant barrier-relative polling schedule
  via the measured separation condition across replications). Varying-phase,
  drifting, or adaptive polling is `not covered`; overlapping windows earn
  no stage-7 credit and leave F1 open. No wording may upgrade this to
  « wake consumption proven » without the stated bounds.
- **Model-turn / token consumption per family:** `source-gap`. No uniform
  witnessed usage signal exists in the harness today (§6.4); caps bind
  launched sessions, MCP calls, and wall-clock instead. Per-family usage
  signals are an open Lot L8 inventory item.
- **Transient-descendant exclusion where no event-grade exec observation
  exists:** `partial` (§8.3) — bounded and labelled, never claimed
  exhaustive.
- **Gemini (5+5−1 cells share the family):** `missing source` — no Gemini
  seat. **Vibe (11 cells):** `not covered` at R until Lot L7 lands and a
  Vibe seat exists; the Python boundary is **not** the blocker (QO4,
  §8.2). The absence of any non-Python Vibe backend remains an explicit
  upstream finding.
- **Live seat enrollment:** `partial`. PR #348 (L2-s) is synthetic;
  `e2e-cli-seats-direct.mjs` refuses live runs; sentropic L1's published
  facade lacks `importSeatBundle` at last check. OS keyring proof (L2a),
  live billing, provider acceptance, and refresh behaviour are
  `not covered`. The interim file-copy path must never be reported as
  enrollment.
- **Global gates:** `unverified` until Lot L2 + the conductor's single full
  `npm test` at integration. Declared non-tests (pending/todo/keepalive
  placeholder) remain outside coverage even inside green jobs (owner
  12/10). The Astra runtime intermittence cause is `unknown`.
- **Platforms:** Linux only. macOS then Windows per owner order are
  `not covered`; the PID-namespace launcher is Linux-specific and needs a
  per-platform design before any claim.
- **Real logins in GitHub CI:** `not covered` until Lot L11. The current CI
  proves simulation + two config oracles only.
- **Central/auto MCP configuration, registry-mediated MCP (R5/R6),
  gateway-model availability policy:** adjacent owner requests, out of
  scope for this branch. The harness writes per-CLI native config directly;
  it proves nothing about registry discovery.
- **Independent dual review of the remediation code:** required per lot
  (owner 18/10: spec by two max reviews before code; code by two reviews
  before merge). No lot in §9 carries a merge claim on its author's word — merge itself additionally requires the §7.1 receipt gate. The
  branch's own note stands: no formal `harness-review` consensus was
  obtainable under confinement (its required launch route is owner-forbidden);
  the two reviews applied here are the record.

## 13. Owner decisions required before code (grouped)

Per owner rule 17/10, decisions at this stake go through a decision dossier
(Focus design-system format, with diagram), never a bare question. This spec
lists them; it does not ask them inline. **PROPOSITION:** one dossier
covering D2–D3, since they interact (caps size the campaign; runner choice
changes secret handling). D1 is **not** in the dossier: it is already
decided (QO4, §8.2) and is listed here only so its closure is on the record.

| ID | Decision | Options in this spec | Default if undecided |
| --- | --- | --- | --- |
| D1 | Vibe Python boundary | **Closed by owner QO4 (11/10, adopted consensus): vendor runtime admitted, shipped code stays 0 Python** (§8.2). A stricter execution ban would be a new decision via a fresh dossier, costed at 11 cells `not covered` | QO4 applies. Lot L7 proceeds; no lot waits on D1 |
| D2 | Numeric campaign caps | §6.4 mechanisms with owner-set numbers, in capped units: launched sessions per seat/campaign, MCP-call cap per session, wall-clock per session/campaign; retry = infra-only, debited; plus §3.3 `W0`/`W1`/`D` and replication count, and the R2 triple denominators of §5.1 | Mechanisms on, scope = 16 profile pairs, conductor-local diagnostic runs only, no unattended scheduled campaign, no real campaign at all until numbers exist |
| D3 | Trusted-lane runner placement | GitHub-hosted + environment secrets / self-hosted ephemeral (§7.2) | Conductor-local diagnostic staging only (§7.1: local runs never emit a merge receipt). Lot L11's trusted lane waits, and the branch does not merge into `main` meanwhile |
| D4 | Gemini seat | Provide a Gemini seat (→ 36-pair denominator reachable) / keep Gemini `not covered` (→ displayed denominator stays 16 profile pairs + blocked accounting) | `not covered`. No schedule impact on L1–L15 |

GO-CODE gates (owner 18/10 « Spec d'abord » + dual-review rule): this spec
(v3) receives two independent max reviews (spec reviewers: Astra max +
Sol max per the 18/10 staffing rule; neither the v1 author, the v2 reviser,
nor the v3 reviser reviews their own text). Code lots start only after both reviews
pass and D2–D3 are decided or explicitly defaulted (D1 already decided).
Each code lot then receives two code reviews before merge.

Milestones and estimates (wording is normative — correction V2-3):

- **« Branch remediated, qualification open »** (was « merge-ready » in v1 —
  withdrawn): Lots L1–L6, L8, L10 green on the branch, ~16–27 agent-hours
  (v2 raises L3 and L6) + review rounds as listed. This state carries
  **no** merge claim: merging into `main` requires the §7.1 receipt gate,
  which requires Lot L11's trusted lane and a passing exact-SHA receipt
  covering all R1/R2 rows already mandatory in the candidate manifest. There is no merge-ready state without a real campaign receipt.
- **R1-qualified (partial milestone, §5.4):** + L7, L9, L11 and a passing
  trusted-lane R1 campaign at 16/16. Probe proven cross-CLI; F3 still
  open.
- **Final F3 satisfaction:** + L12–L15 (unavailability, loop, negotiation,
  remaining inventory) with their S cross products green and R2 receipts
  for every ratcheted row. Per-lot estimates in §9; campaign spend is
  debited in §6.4 units and only a measured campaign can size the model
  consumption behind each debited session. The branch's earlier 6–12
  agent-hour estimate assumed AGY/Gemini/Vibe inputs that still do not
  exist, so this spec does not repeat it as a commitment.

## Appendix A — Exact file index

Harness (branch): `scripts/qualify-cross-cli.mjs`, `scripts/xcli-lab.mjs`,
`scripts/xcli-proxy.mjs`, `scripts/xcli-terminal.mjs`,
`scripts/xcli-simulated-model.mjs`, `scripts/xcli-ci-check.mjs`,
`scripts/xcli-in-pid-namespace.mjs`, `scripts/xcli-pid-init.cc`,
`scripts/xcli-runtime-tests.mjs`, `scripts/xcli-source-tests.mjs`,
`scripts/xcli-install-oracles.mjs`, `scripts/xcli-node-headers.mjs`,
`scripts/xcli-export-evidence.mjs`; tests `scripts/xcli-lab.test.mjs`,
`scripts/xcli-proxy.test.mjs`, `scripts/xcli-simulation.test.mjs`,
`scripts/xcli-gemini-registry.test.mjs`, `scripts/xcli-cleanup.test.mjs`,
`scripts/xcli-pid-namespace.test.mjs`, `scripts/xcli-terminal.test.mjs`,
`scripts/xcli-startup.test.mjs`, `scripts/xcli-evidence.test.mjs`,
`scripts/xcli-native-config.test.mjs`, `scripts/xcli-muse-config.test.mjs`.

Product (branch diff): `packages/h2a/src/hosts/claude.ts`,
`packages/h2a/src/hosts/codex.ts`, `packages/h2a/src/hosts/muse.ts`,
`packages/h2a/src/cli.ts`, `packages/h2a-runtime/src/delegate.ts`,
`packages/h2a-runtime/src/h2a-jobs.ts`, `packages/h2a-runtime/src/index.ts`,
`packages/h2a-runtime/src/registry.ts`,
`packages/h2a-runtime/src/restore.ts`,
`packages/h2a-runtime/src/native-terminal/op.ts`,
`packages/h2a-runtime/src/native-terminal/drive.functional.test.ts`,
`packages/h2a-runtime/src/native-terminal/upgrade.functional.test.ts`,
`packages/h2a/test/hosts-integration.test.js`,
`packages/h2a/test/helpers/private-pid-namespace.mjs`.

Gates and seats (main): `scripts/run-test-gates.mjs`,
`scripts/run-tests.mjs`, `packages/h2a/test/run-test-gates.test.js`,
`.github/workflows/ci.yml`, `.github/workflows/release.yml`,
`.github/workflows/cross-cli-messaging.yml` (branch),
`packages/h2a-runtime/src/cli-seat-codecs.ts`,
`packages/h2a-runtime/src/cli-seat-fixtures.ts`,
`packages/h2a-runtime/src/cli-seat-materialization.ts`,
`packages/h2a/test/cli-seat-direct-matrix.test.js`,
`scripts/e2e-cli-seats-direct.mjs`, `docs/cli-seat-l2s.md`,
`scripts/check-no-python.sh`.

To be created by the lots (names marked **PROPOSITION:** at their defining
site): `scripts/xcli-receipt-check.mjs` (+ test, Lot L11),
`scripts/xcli-scenarios.mjs` (+ `scripts/xcli-scenarios.test.mjs`,
Lots L12–L15), `docs/cross-cli-matrix.json` (matrix manifest, Lot L11),
`.github/workflows/cross-cli-campaign.yml` (Lot L11),
`scripts/xcli-evidence-scan.mjs` (+ test, Lot L4), `scripts/xcli-seats.mjs`
(+ test, Lot L8), `scripts/xcli-docs.test.mjs` (Lot L10).

Docs and evidence: `docs/cross-cli-qualification.md`,
`docs/2026-10-15-cross-cli-phase1.md` (+ `.json`),
`docs/2026-10-16-cross-cli-resume.md` (+ per-cell JSON receipts),
`docs/2026-10-16-cross-cli-ci/`, `docs/2026-10-16-cross-cli-local/`,
`docs/reviews/2026-10-15-cross-cli-review.md`,
`docs/reviews/2026-10-16-cross-cli-review.md`.

## Appendix B — Command catalogue (targeted only; temp dirs only)

All commands run from the worktree root with `npm ci --ignore-scripts` done
and `node scripts/xcli-node-headers.mjs` applied where the harness builds
`node-pty`. Outputs go to temp paths. No command here runs the installed
`h2a`, reads real h2a state, or runs the full suite.

```sh
# Harness unit tests (PR lane set)
node --test scripts/xcli-lab.test.mjs scripts/xcli-proxy.test.mjs \
  scripts/xcli-simulation.test.mjs scripts/xcli-gemini-registry.test.mjs \
  scripts/xcli-cleanup.test.mjs scripts/xcli-pid-namespace.test.mjs \
  scripts/xcli-terminal.test.mjs scripts/xcli-startup.test.mjs \
  scripts/xcli-evidence.test.mjs

# Simulated full matrix + gate (PR lane)
node scripts/qualify-cross-cli.mjs --simulated --timeout-ms 30000 \
  --output "$TMPDIR/xcli-simulated.json"
node scripts/xcli-ci-check.mjs "$TMPDIR/xcli-simulated.json"
# expected: {"cells":36,"outcome":"simulated-round-trips-proven"}, exit 0

# Negative control, wake dropped (must exit 2)
node scripts/qualify-cross-cli.mjs --simulated --pair codex:codex \
  --drop-simulated-wake --timeout-ms 30000 --output "$TMPDIR/negative.json"

# Config oracles (no login, no model)
node scripts/xcli-install-oracles.mjs
node --test scripts/xcli-native-config.test.mjs
node --test scripts/xcli-muse-config.test.mjs

# PID-confined consumers
node scripts/xcli-in-pid-namespace.mjs scripts/xcli-runtime-tests.mjs
node scripts/xcli-in-pid-namespace.mjs scripts/xcli-source-tests.mjs \
  packages/h2a/test/hosts-integration.test.js

# One real cell (campaign lane only; seat manifest after Lot L8)
node scripts/qualify-cross-cli.mjs --pair claude:codex \
  --timeout-ms 60000 --output "$TMPDIR/xcli-cell.json"
# exit 0 only if the requested cells are measured-OK; otherwise 2

# --- after the named lots land ---
# Scenario rows (L12-L15; simulated shown, real via campaign lane)
node --test scripts/xcli-scenarios.test.mjs
node scripts/qualify-cross-cli.mjs --simulated --scenario loop \
  --timeout-ms 30000 --output "$TMPDIR/xcli-loop.json"

# Receipt check, no secrets (L11; required on branch->main PR + release)
node scripts/xcli-receipt-check.mjs --gate merge \
  --sha "$(git rev-parse HEAD)" --receipt "$TMPDIR/campaign-receipt.json"
# exit 0 only for an exact-SHA, all-mandatory-green trusted-lane receipt

# Gate dispatch proof (L2; targeted, through runGates()/STEPS)
node --test packages/h2a/test/run-test-gates.test.js
```

## Appendix C — Traceability (owner sentence → section → lot)

| Owner sentence | Sections | Lots |
| --- | --- | --- |
| Live discussion between CLIs, « est-ce que ca fonctionne la » | §3 (per-pair definition, withheld-wake protocol), §6 (real campaign), §11 (per-CLI state) | L3, L8, L9, L11 |
| Tests on ALL CLIs, ALL functions, ALL combinations, in CI/CD | §5 (inventory, exact denominators, tiers, ratchet, milestones), §7 (lanes + receipt gate) | L2, L7, L8, L11, **L12 (unavailability), L13 (loop), L14 (negotiation), L15 (remaining inventory)** |
| Status lacks depth; inter-CLI send tests still not OK | §5.5 (per-tier status), §12 (non-claims) | L8, L10 |
| Current seats, shared quota, isolated temp HOMEs, wiped | §6.1–§6.6 | L4, L5, L8 |
| Seats enrollable CLI **and** LLM-MESH (claude, codex, muse, vibe, agy/cloud-code) | §2.3 (PR #348 / L1 boundary), §6.1 (dual-use manifest), §8 (Vibe) | L7, L8 |
| « Spec d'abord » (18/10) | Whole document; §13 GO-CODE gates | — (this lot) |
