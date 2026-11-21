# SPEC EVOL — Remediation of live cross-CLI messaging and its test matrix

| Field | Value |
| --- | --- |
| Kind | EVOL remediation spec. No code in this lot. |
| Branch under remediation | `origin/feat/live-cross-cli-messaging`, head `97f93e72`, 17 commits over base `54e7ffd7` (0.98.6) |
| Worktree inspected | `/home/antoinefa/src/h2a/tmp/worktrees/xcli` |
| Reference `origin/main` at review time | `d0b1afa3` (includes PR #348 seat L2-s, merge `7670fbed6`) |
| Reviews applied | `rvxclia-last.md` (Astra max) and `rvxclis-last.md` (Sol 6.1 xhigh). Both verdict: **NON-FUSIONNABLE** |
| Owner decision 18/10 | « Spec d'abord ». Two independent spec reviews, then code under lock v1 |
| Language | This spec is in English. The companion `summary.md` is in French |
| Output of this lot | This file and `summary.md`. No commit, no push, no test run |

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

Plus, in every case: **verified cleanup**. Owned processes stopped through
the fenced private-host path, private state (including copied logins and CLI
transcripts) removed, `cleanup-complete` witnessed. A cell with
`cleanupFailed` is `blocked` with `owned-process-cleanup-failed`, its private
root is preserved for diagnosis, and the campaign stops. A cell whose cleanup
is merely unproven is also `blocked` (Lot L5 extends this to lost workers).

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

**PROPOSITION:** after remediation, stage 7 requires all of the following,
each witnessed independently of model text:

- an `inbox-wake` event with `ok:true` (closed-format counter already emitted
  by `xcli-proxy.mjs`) whose timestamp is after the send and before the
  qualifying inbox read;
- zero receiver inbox reads between the idle barrier and that wake event
  (polling before the wake disqualifies the cell; reads before the barrier
  are startup traffic and must also be counted and reported, never ignored);
- the qualifying read is the **first** receiver inbox read after the wake
  event, correlated to the exact probe envelope;
- `noPostSendHarnessInput` remains `true` and the frozen-terminal verifier
  confirms no terminal response and no startup key reached the receiver
  after the barrier;
- for simulated cells, the simulated model's existing signed-wake
  verification (addressed instance, signature, replay guard, instruction
  shape) remains mandatory; the harness additionally checks the wake event
  ordering above, so simulation and real cells share one wake definition.

**PROPOSITION:** two negative controls become mandatory in CI: (a) wake
dropped — delivery holds, no read, no reply, qualification fails (exists);
(b) polling model — inbox polled on a timer with the wake ignored —
qualification must fail on stage 7 even though read and reply occur (new,
Lot L3). A third control, replayed wake, is **PROPOSITION:** recommended:
the same signed wake delivered twice must produce at most one qualifying
read.

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
`blocked` until §8 is decided and seats exist. Claiming 36-pair coverage
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
the same budget is invalid and must be re-measured.

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

| Class | Meaning | Crossed with |
| --- | --- | --- |
| `per-cli` | One session suffices (identity, discovery read, inbox empty-read, config render) | Each CLI family |
| `per-pair` | Sender and receiver differ or not (send/wake/reply, drive consent round-trip, session resume addressing a peer) | Each ordered pair |
| `multi` | Needs three or more parties or durable shared state (negotiation, loop, conductor claim/release) | Representative triples, then full rotation |
| `refusal` | Must fail closed (unsigned wake, replayed wake, unknown instance, unavailable peer) | Each CLI family, then each ordered pair |

The reviews name, beyond the current probe: name resolution, other inbox
actions, sessions, negotiations, resume, discovery, wake, delegation, stop.
The 12/10 owner decision adds the four N×N scenarios: **message,
unavailability, loop, negotiation**. **PROPOSITION:** these four scenarios
are the first mandatory `per-pair` / `multi` rows after the probe; the full
MCP list then ratchets in per §5.4. No function is « covered » because its
tool appears in `tools/list`; coverage means the behaviour was executed and
witnessed.

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
  exists; tier R via harness fault injection is **PROPOSITION:** out of
  scope — real models must not be fault-injected to manufacture a negative).
- Polling receiver: read and reply occur without the wake → stage 7 fails
  (tier S, new in Lot L3).
- Unavailable peer (12/10 scenario): send to a stopped or unknown instance
  fails closed with a classified error; no silent durable-only « success »
  is reported as live delivery (tiers S and R2).
- Unsigned, mis-addressed, or replayed wake: rejected (tier S; the simulated
  model already verifies signature, addressee, and replay guard).
- Quota and authentication screens: classified `blocked`
  (`provider-quota`, `authentication-required`), never retried into a green
  (tier R, classified by `blockingScreen`).
- Cleanup unproven (dead worker, surviving descendant, surviving login copy):
  `blocked`, campaign stops (tiers S and R, Lot L5).

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
4. Order: probe at S/C/R1 first (Lots L1–L9), then unavailability, loop,
   negotiation (12/10), then the remaining MCP rows grouped by class.
   Tier S always runs the full declared cross product; tiers R run the full
   mandatory set per campaign (§6.4 sequences cells to fit the quota cap
   without sampling away a mandatory row — if the cap cannot fit the
   mandatory set, the campaign is `blocked`, not partial-green).

This is the only reading under which « TOUTES les fonctions, TOUTES
combinaisons » and « quota partagé, plafond par campagne » are both true:
the full cross product runs in simulation on every change, and the real
mandatory set runs in full per campaign or the campaign reports blocked.

### 5.5 Status output (depth, per the 18/10 complaint)

**PROPOSITION:** each run emits one table per tier with, per cell: sender,
receiver, function row, status, the eight stage booleans where applicable,
blocker or failure code, CLI versions, seat IDs (never secrets), elapsed
time, campaign quota counters (§6.4), and the evidence file reference. The
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
(`authFiles.vibe = []`); no Vibe R-tier cell runs until §8 is decided and an
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
  instances (sender or receiver identity for this cell); any other value is
  dropped or refused, including on failing calls (fixes F5, line 88). The
  proxy forwards original RPC bytes unchanged; filtering applies only to
  what it **retains**, never to what it forwards.
- Screen evidence is limited to the closed `startupFacts` vocabulary,
  fixed choice styles, and boolean signals (existing). Raw screens, raw
  stderr, and unparsed diagnostics are never persisted (existing).
- **PROPOSITION:** a canary test injects a unique dummy secret as an inbox
  `instance` argument, as model-visible text, and as stderr noise, then
  asserts the canary string appears nowhere in the cell evidence, the
  campaign JSON, or the Markdown table. The test uses temp dirs and dummy
  servers only (pattern of `xcli-proxy.test.mjs`); it must fail on current
  code (red) and pass after Lot L4 (green).
- **PROPOSITION:** before any evidence file is committed or uploaded, a
  token-pattern scan (Node, no Python) over every produced JSON/Markdown
  file must pass. The reviews scanned 102 files and found no token pattern;
  the scan turns that one-off check into a gate. A scan hit blocks
  publication of the evidence and classifies the campaign `blocked`.

### 6.4 Quota cap per campaign (mechanism normative, numbers PROPOSITION)

Each real cell runs two model sessions. A 16-pair R1 campaign therefore runs
32 model sessions; a 30-direction seat campaign runs 60; a 36-pair campaign
runs 72. Each session spends model turns on identity polling, the send or
reply turn, and any startup screens. Quota is shared with the owner's other
work, so the campaign must be able to stop cleanly and resume per cell
(existing `--pair` replay already allows cell-by-cell execution).

**PROPOSITION:** the harness enforces, per campaign:

- a **cell budget**: at most one attempt per mandatory cell, plus at most one
  retry **only** for classified infrastructure failures (private host
  unavailable, worker spawn error) — never for `measured-KO`, `blocked`,
  `provider-quota`, or `authentication-required`;
- a **wall-clock budget**: 60 s per cell (§3.5) plus startup; campaign total
  reported; no cell is left running past its watchdog;
- a **turn counter**: witnessed MCP tool calls per seat (identity, send,
  inbox) summed per campaign and printed in the status table, so consumption
  is visible per seat rather than discovered on a bill;
- **stop rules**: first `provider-quota` screen stops all further cells on
  that seat (remaining cells `blocked`, reason `provider-quota`); first
  `cleanupFailed` (including the lost-worker case, Lot L5) stops the whole
  campaign; `SIGTERM`/`SIGINT` cancels the active cell and marks the rest
  `qualification-cancelled` (existing);
- **ordering**: cheapest discriminating cells first — diagonal same-family
  cells, then pairs touching an unproven family, then the remainder — so a
  quota stop still leaves maximal information. Ordering never drops a
  mandatory cell from the report; unrun mandatory cells are `blocked`.

**PROPOSITION:** default campaign scope is the 16 profile pairs (R1). The
30-direction seat run and any R2 rows are separate, explicitly requested
campaigns. No campaign runs overnight unattended against shared quota
without an owner-ratified numeric cap (Decision D2).

### 6.5 Preflights (before any model turn is spent)

**PROPOSITION:** per seat, before its first cell: (a) binary resolves on the
campaign PATH, version recorded, digest recorded; (b) Python-entrypoint
guard passes (§8 policy, Lot L6); (c) tier-C config oracle for that family
passes on the same SHA (real parser, no login, no model); (d) an isolated
authentication precheck in a throwaway HOME with only the seat's authorised
files proves the login is accepted without spending a messaging cell
(the branch's Muse `exec` preflight pattern, with outputs discarded and
private state deleted, is the model). A failed preflight blocks that seat's
cells with the preflight's classified reason. Preflights never read the
owner's real HOME beyond the seat's authorised files, and never run the
installed `h2a`.

### 6.6 Cleanup proof (normative)

A cell is complete only when: both sessions were stopped through the fenced
path or observed exited with unchanged generation/incarnation; the private
host exited; `stopPrivateNativeProcesses` and per-role
`waitForPrivateNativeProcesses` succeeded; the cell dir (logins, transcripts,
workspaces) was removed and its absence re-checked; and `cleanup-complete`
was witnessed. Any gap → `cleanupFailed`, `blocked`, private root preserved,
campaign stopped. Lot L5 extends the same treatment to a worker that dies
without emitting parseable JSON: today that path fabricates a `blocked` row
without `cleanupFailed` and continues (F7). Bounded recovery may stop only
PIDs proven owned by that cell (pinned private-process records); it must
never pattern-kill.

## 7. CI/CD path: where real logins run, where only simulation runs

Owner basis: 12/10 (real CLIs with simulated models first; otherwise real
models via CLI-mode seats in a GitHub secret refreshed by a cron, re-enrolled
when the device refresh is lost) and the second verbatim request (all tests
in CI/CD). Review basis: a real job on a trusted ephemeral runner with
per-seat secrets, bounded concurrency, cleanup on cancellation, filtered
evidence; manual/periodic; any mandatory missing, blocked, or failed
function or pair blocks merge/release. The design below reconciles both.
Runner placement is a **PROPOSITION** (Decision D3).

### 7.1 Three lanes

| Lane | Trigger | Secrets | Tiers | Gate |
| --- | --- | --- | --- | --- |
| PR lane (existing workflow, extended) | Every PR to `main`, every push to the branch | None. Fork-safe | S full cross product + C oracles + harness unit tests + PID-namespace runtime/source consumers | Blocks merge on red. Says nothing about real models |
| Real campaign lane (new, manual + scheduled) | `workflow_dispatch` with an explicit seat set; weekly schedule; release preparation | Per-seat, environment-scoped, never on forks, never on `pull_request` from untrusted refs | R1 mandatory pairs (+ R2 rows as ratcheted), preflights, quota counters | Blocks **release** (and promotion of the branch to merge-ready) while any mandatory row is missing/blocked/KO. Does not run per commit |
| Release lane (existing release flow, gated) | Tag / release workflow | Same as campaign lane for its qualification step | Reuses the campaign receipt for the exact release SHA; re-runs the campaign if the SHA differs | No receipt for the exact SHA → no release. Global `npm test` must also pass via Lot L2 wiring |

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

**PROPOSITION:** start with the campaign run **locally under conductor
control** (the branch's current real mode: seat manifest, temp HOMEs,
filtered receipts committed as docs evidence) until R1 reaches 16/16 profile
pairs. Then move the identical command line to the protected campaign lane.
This sequences the risky part (real logins in CI) after the harness is
proven, and matches the branch doc's own staging (« modèles simulés
d'abord, sièges réels ultérieurs »). The choice between the two runner
columns above is Decision D3; the spec requires either column to satisfy:
ephemeral filesystem, per-seat secrets injected as files into temp HOMEs
(never argv, never logged), bounded concurrency = 1, `cancel-in-progress`
cleanup that stops only owned PIDs and wipes seat copies, publication of
filtered evidence only, and the §6.4 quota counters in the job summary.

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
lane gets its own budget derived from cell count × 60 s plus preflights, and
fails (not truncates) when the budget cannot fit the mandatory set. A real
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

### 8.2 Options (PROPOSITION — owner arbitration required, Decision D1)

| Option | What runs | Python position | Consequence |
| --- | --- | --- | --- |
| V-A: keep the execution ban | Vibe cells stay `blocked`. Tier C may still parse-check the h2a-written `config.toml` without launching Vibe's backend, if a no-launch parse path exists | Zero Python executed anywhere, vendor included | 11/36 cells permanently `not covered` until Mistral ships a non-Python backend. « ALL CLIs » stays false and must be reported as such |
| V-B: apply QO4 literally (recommended for owner review) | The vendor `vibe` product runs as installed (vendor Python runtime included). Everything we ship — harness, MCP entry writer, tests, CI jobs — remains Node/shell/native only, enforced by the existing `zero-python` CI gate plus Lot L6's launcher policy | Vendor Python executes; shipped Python stays zero | Vibe becomes qualifiable at R1 like any other family, explicitly labelled `vendor-runtime: python (not shipped)`. The harness guard changes from « refuse Python entrypoints » to « refuse Python in **our** launch chain; record vendor runtime » (§8.3) |
| V-C: direct `vibe-rs` with a non-Python app-server | `vibe-rs` ELF plus a compatible app-server we or Mistral provide without Python | Zero Python executed | Blocked on an artifact that does not exist. Tracked as an upstream dependency, not a lot estimate. Must not be faked with a wrapper |

This spec does not choose. Implementing V-B without an explicit owner
decision would silently weaken the branch's current guard; implementing V-A
forever without naming the cost would silently keep « ALL CLIs » false. The
decision dossier (present-decision format, with diagram, per owner rule
17/10) is Lot L7's entry gate.

### 8.3 Guard semantics under each option (fixes F8 either way)

Current guard (`xcli-lab.mjs:205`): a 256-byte prefix regex
`^#![^\n]*\bpython\d*(?:\s|$)`. It misses `python3.14` (the dot breaks
`\d*(?:\s|$)`), `#!/usr/bin/env -S python3 …` variants it was not written
for, and any shell wrapper that `exec`s Python. It also says nothing about
descendants. Lot L6 must, under **either** option:

- recognise versioned interpreters (`python`, `python3`, `python3.14`,
  `python3.14.x`), `env` forms (including `-S`), and absolute interpreter
  paths, with dummy-file unit tests that never execute the fixtures
  (review method);
- detect the one-level wrapper case by inspecting shell launcher text for an
  `exec`/direct invocation of a Python interpreter (closed patterns, dummy
  fixtures, no execution);
- state plainly that static launcher inspection cannot prove anything about
  descendants, and compensate at runtime: **PROPOSITION:** during a real
  cell, the owned-process records are checked at cleanup for any descendant
  whose executable resolves to a Python interpreter **outside** the declared
  vendor-runtime allowance (V-B) or at all (V-A). A hit classifies the cell
  `blocked` (`python-descendant-detected`). Only owned PIDs are inspected;
  no host-wide process scan.
- keep the repo-wide `zero-python` gate (`scripts/check-no-python.sh`) as
  the shipped-code guarantee. The harness guard is an execution policy, not
  a substitute for that gate.

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
L10 → L11; L7 (Vibe decision) and L9 (per-CLI unblocks) can proceed in
parallel with L3–L6 once L1 lands, but no R-tier campaign runs before L3,
L4, L5, and L8 are green.

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

- **RED first:** targeted Vitest run of the historical-host suite through
  the global entry fails in `beforeAll` with
  `historical host requires the private PID namespace launcher`:
  `node_modules/.bin/vitest run --config packages/h2a-runtime/vitest.config.ts packages/h2a-runtime/src/native-terminal/upgrade.functional.test.ts`
  (targeted single file; temp dirs only). Record exit code and message.
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
  `packages/h2a/test/run-test-gates.test.js`,
  `scripts/xcli-in-pid-namespace.mjs` (only if the gate runner needs a
  pass-through mode), `.github/workflows/ci.yml`,
  `.github/workflows/release.yml` (only the entries the inventory names).
- **GREEN proof:** the RED command passes through the global entry; the
  trust-root test passes; `node scripts/xcli-in-pid-namespace.mjs scripts/xcli-runtime-tests.mjs`
  still passes (706 tests, same pending/todo declaration); the branch doc
  sentence « gate global non qualifié » is removed only after this proof.
  The full `npm test` run itself is executed by the conductor at
  integration, not by this lot. Cost: ~2–4 agent-hours, 2 review rounds
  (this lot touches the trust root).

### Lot L3 — Prove autonomous wake; reject polling (fixes F1)

- **RED first:** add a polling simulated model fixture (reads inbox on a
  timer, ignores the wake) and show current code yields `simulated-OK`,
  `woke:true`, reply delivered:
  `node --test scripts/xcli-simulation.test.mjs` with the new polling case
  failing (it currently passes qualification, so the new assertion
  « polling must fail » is red). Keep the Sol review's reproduction shape:
  several reads before the idle barrier, read + reply after send.
- **Change:** implement §3.3 in `scripts/qualify-cross-cli.mjs` (wake-event
  ordering, zero reads between barrier and wake, first-read correlation)
  and count/report pre-barrier reads. Add the polling negative control to
  `scripts/xcli-simulation.test.mjs` and wire both negative controls into
  the PR lane. The simulated model's signed-wake verification stays
  mandatory and unchanged.
- **Files:** `scripts/qualify-cross-cli.mjs`,
  `scripts/xcli-simulated-model.mjs` (polling fixture mode only),
  `scripts/xcli-simulation.test.mjs`, `scripts/xcli-ci-check.mjs` (verify
  the new evidence fields), `.github/workflows/cross-cli-messaging.yml`
  (PR-lane step only).
- **GREEN proof:** polling control fails qualification at stage 7 with exit
  2 and `verifySimulation` reports the negative outcome; wake-dropped
  control still fails; normal simulated matrix still 36/36 on the targeted
  replay (`--pair` spot checks plus the CI job); harness tests green.
  Cost: ~2–3 agent-hours, 1 review round.

### Lot L4 — Evidence hygiene and login-path confinement (fixes F5, F6)

- **RED first (F5):** extend `scripts/xcli-proxy.test.mjs` with a dummy
  server and a caller that passes a unique canary string as the inbox
  `instance` (including on a failing call); assert the canary is absent
  from `events.jsonl`. Red on current code (line 88 retains it verbatim).
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
  instances once identity is witnessed; before that, retain only values
  matching the harness instance shape and drop anything else. **PROPOSITION:**
  the proxy learns the two cell instances from witnessed `identity` events
  plus an `XCLI_KNOWN_INSTANCES` handoff from the worker after readiness;
  the exact mechanism is implementer's choice, the drop-on-unknown
  behaviour is not. Forwarding of original RPC bytes is unchanged.
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

### Lot L5 — Lost worker stops the campaign (fixes F7)

- **RED first:** a unit test driving the campaign parent with a worker stub
  that emits invalid JSON (or exits without output) asserts the campaign
  stops, marks `cleanupFailed`, and runs no further cell. Red on current
  code (`qualify-cross-cli.mjs:443` fabricates a row and continues).
- **Change:** treat unparseable/absent worker output as
  `cleanupFailed: true`, `blocker: qualification-worker-failed-cleanup-unproven`,
  set `stopping`, and run bounded recovery: stop only PIDs recorded in that
  cell's pinned private-process records, verify cell-dir login copies are
  removed or preserve the root for diagnosis with the failure stated.
  Preserve the per-cell JSON write and the exit code 2.
- **Files:** `scripts/qualify-cross-cli.mjs`, `scripts/xcli-cleanup.test.mjs`
  (new case), `docs/cross-cli-qualification.md` (one sentence, via Lot L10).
- **GREEN proof:** new test green; existing cleanup tests green; simulated
  spot cell green. Cost: ~1–2 agent-hours, 1 review round.

### Lot L6 — Python guard that can be trusted (fixes F8; policy per §8)

- **RED first:** dummy-file unit tests (no execution) asserting the guard
  rejects `#!/usr/bin/env python3.14`, `#!/usr/bin/env -S python3 -u`,
  an absolute `…/python3.12` shebang, and a `/bin/sh` wrapper whose body
  `exec`s Python. Red on current code for the versioned and wrapper cases.
- **Change:** rewrite `pythonEntrypoint` in `scripts/xcli-lab.mjs` per
  §8.3 (versioned interpreters, `env` forms, one-level wrapper text
  inspection). Add the runtime owned-descendant check at cleanup
  (**PROPOSITION** in §8.3) gated by the D1 decision's allowance. Do not
  touch `scripts/check-no-python.sh` semantics; if its allowlist needs a
  Vibe-related entry under V-B, that is a separate owner-visible change in
  Lot L7, never folded in here.
- **Files:** `scripts/xcli-lab.mjs`, `scripts/xcli-lab.test.mjs`,
  `scripts/qualify-cross-cli.mjs` (descendant check + blocker code).
- **GREEN proof:** new guard tests green; existing environment test (node
  shebang accepted, `python3` rejected) still green; Vibe still blocked
  pre-D1. Cost: ~1–2 agent-hours, 1 review round.

### Lot L7 — Vibe decision and Vibe qualification path (fixes the Vibe part of F3/F9)

- **Entry gate (no code before this):** owner decision dossier
  (present-decision format with diagram) choosing V-A, V-B, or V-C (§8.2),
  recorded in track. The dossier states QO4 verbatim, the `_rust.py`
  app-server fact, and the 11-cell cost of V-A.
- **RED first (under V-B):** tier-C oracle test asserting the real Vibe
  binary accepts the h2a-written `~/.vibe/config.toml` MCP entry (Node
  writer, #340) — red until the oracle exists. Under V-A, the RED test is
  the inverse: every Vibe cell classifies `blocked` with the vendor-runtime
  reason and the status table shows 11 cells `not covered`.
- **Change:** implement the chosen option's guard semantics (§8.3),
  `authFiles.vibe` (only files the decision authorises; empty stays valid),
  tier-C oracle for Vibe, and `vendor-runtime` labelling in evidence (V-B).
  Our shipped writer, harness, and CI remain 0 Python; extend
  `scripts/xcli-native-config.test.mjs` / `xcli-install-oracles.mjs` to
  Vibe. Under V-C, this lot reduces to tracking the upstream artifact and
  keeping cells blocked with the named dependency.
- **Files:** `scripts/xcli-lab.mjs`, `scripts/xcli-native-config.test.mjs`,
  `scripts/xcli-install-oracles.mjs`, `packages/h2a/src/hosts/vibe.ts`
  (only if the config contract changes), `docs/cross-cli-qualification.md`.
- **GREEN proof:** Vibe tier-C green (V-B) or explicit blocked accounting
  (V-A/V-C); `zero-python` gate still green; no Python added to the repo.
  Cost: decision dossier ~1 agent-hour + owner round; code ~2–4
  agent-hours under V-B, 1 review round.

### Lot L8 — Seat manifest and campaign engine (fixes F9; enables F3)

- **RED first:** unit tests asserting (a) `--pair claude-a:claude-b`
  selects distinct auth sources per role (red today: one `authHome`);
  (b) a diagonal single-seat cell records `sharedSeat: true`; (c) an AGY
  entry pointing at Gemini files is refused as proof; (d) a
  `provider-quota` classification stops further cells on that seat. Use
  dummy seat dirs in `mkdtemp`; no real login, no model.
- **Change:** seat manifest per §6.1 (`--seat-manifest <file>`, per-role
  `copyLogin` source, seat-qualified `--pair`, version/digest recording),
  campaign quota counters and stop rules per §6.4, preflights per §6.5, and
  the tiered status emitter per §5.5. Keep `--auth-home` as a deprecated
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
  `measured-OK` at 60 s with full §3 evidence, then one cross pair against
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

### Lot L11 — Real campaign lane in CI/CD (fixes F3)

- **Entry gate:** Lots L1–L6, L8 green; L9 diagonal greens for every family
  in the campaign scope; Decisions D2 (caps) and D3 (runner) ratified.
- **RED first:** workflow test asserting the campaign workflow refuses to
  run without an explicit seat set, refuses fork refs, and fails (not
  skips) when a mandatory receipt is absent for the exact SHA.
- **Change:** add the protected campaign workflow per §7 (manual +
  scheduled, concurrency 1, filtered artifacts, quota summary, cancel
  cleanup), extend tier-C oracles from Claude/Codex to all families with
  an installable no-login parse path, add the matrix manifest (§5.4) with
  the probe + unavailability rows mandatory at S and the probe mandatory
  at R1 for the 16 profile pairs, and gate release on the exact-SHA
  receipt. Loop and negotiation rows enter as `not covered` with named
  blockers, then ratchet per §5.4 in follow-up lots.
- **Files:** `.github/workflows/cross-cli-messaging.yml` (PR lane
  extensions), new `.github/workflows/cross-cli-campaign.yml`
  (**PROPOSITION:** name), `scripts/xcli-install-oracles.mjs`,
  `scripts/xcli-native-config.test.mjs`, `scripts/xcli-ci-check.mjs`,
  matrix manifest file (**PROPOSITION:** `docs/cross-cli-matrix.json`,
  versioned, machine-checked against `tools/list`).
- **GREEN proof:** PR lane green on Node 22+24; one full R1 campaign on the
  protected lane (or conductor-local equivalent per §7.2 staging) with
  16/16 profile pairs `measured-OK` or an explicitly `blocked` campaign
  report naming each non-green cell; release dry-run refuses without the
  receipt. Cost: ~4–8 agent-hours + campaign quota, 2 review rounds.

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
| Vibe | `blocked`, `python-entrypoint-forbidden:vibe`, 11 cells, 0–1 ms (refused before execution) | Established: §8.1 launcher/app-server facts. No Python executed | Decision D1 first (Lot L7). No diagnostic spend before that |

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
  `not covered` until the §5.4 ratchet promotes them with evidence.
- **Gemini (5+5−1 cells share the family):** `missing source` — no Gemini
  seat. **Vibe (11 cells):** blocked on Decision D1; under V-A/V-C they
  remain `not covered` by construction.
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
  before merge). No lot in §9 is merge-ready on its author's word. The
  branch's own note stands: no formal `harness-review` consensus was
  obtainable under confinement (its required launch route is owner-forbidden);
  the two reviews applied here are the record.

## 13. Owner decisions required before code (grouped)

Per owner rule 17/10, decisions at this stake go through a decision dossier
(Focus design-system format, with diagram), never a bare question. This spec
lists them; it does not ask them inline. **PROPOSITION:** one dossier
covering D1–D3, since they interact (Vibe policy changes the campaign
denominator; runner choice changes secret handling).

| ID | Decision | Options in this spec | Default if undecided |
| --- | --- | --- | --- |
| D1 | Vibe Python boundary | V-A ban execution / V-B QO4 literal (vendor runtime admitted, shipped stays 0) / V-C wait for non-Python app-server (§8.2) | V-A (current guard). 11 cells stay `not covered`. Lots L1–L6, L8–L10 proceed; L7 code waits |
| D2 | Numeric campaign caps | §6.4 mechanisms with owner-set numbers (cells per campaign, retries = infra-only, wall clock, turn ceiling per seat) | Mechanisms on, scope = 16 profile pairs, conductor-local runs only, no unattended scheduled campaign |
| D3 | Campaign runner placement | GitHub-hosted + environment secrets / self-hosted ephemeral / conductor-local until 16/16 (§7.2) | Conductor-local staging. Lot L11 workflow waits |
| D4 | Gemini seat | Provide a Gemini seat (→ 36-pair denominator reachable) / keep Gemini `not covered` (→ honest denominator stays 16 profile pairs + blocked accounting) | `not covered`. No schedule impact on L1–L10 |

GO-CODE gates (owner 18/10 « Spec d'abord » + dual-review rule): this spec
receives two independent max reviews (spec reviewers: Astra max + Sol 6.1
max per the 18/10 staffing rule; the spec author does not review their own
spec). Code lots start only after both reviews pass and D1–D3 are decided
or explicitly defaulted. Each code lot then receives two code reviews
before merge. Total estimated remediation to merge-ready branch (L1–L6,
L8, L10, without real campaigns): ~15–25 agent-hours + review rounds as
listed per lot. R1 qualification to 16/16 (L9 + campaign) adds per-family
diagnosis plus shared-quota spend that only a measured campaign can size;
the branch's earlier 6–12 agent-hour estimate assumed AGY/Gemini/Vibe
inputs that still do not exist, so this spec does not repeat it as a
commitment.

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
```

## Appendix C — Traceability (owner sentence → section → lot)

| Owner sentence | Sections | Lots |
| --- | --- | --- |
| Live discussion between CLIs, « est-ce que ca fonctionne la » | §3 (per-pair definition), §6 (real campaign), §11 (per-CLI state) | L3, L8, L9, L11 |
| Tests on ALL CLIs, ALL functions, ALL combinations, in CI/CD | §5 (inventory, tiers, ratchet), §7 (lanes) | L2, L7, L8, L11 |
| Status lacks depth; inter-CLI send tests still not OK | §5.5 (per-tier status), §12 (non-claims) | L8, L10 |
| Current seats, shared quota, isolated temp HOMEs, wiped | §6.1–§6.6 | L4, L5, L8 |
| Seats enrollable CLI **and** LLM-MESH (claude, codex, muse, vibe, agy/cloud-code) | §2.3 (PR #348 / L1 boundary), §6.1 (dual-use manifest), §8 (Vibe) | L7, L8 |
| « Spec d'abord » (18/10) | Whole document; §13 GO-CODE gates | — (this lot) |
