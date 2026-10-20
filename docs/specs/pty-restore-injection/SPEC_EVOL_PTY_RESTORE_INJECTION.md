# SPEC EVOL — PTY restore, injection and supervision (h2a)

Status: build specification, not code. Written 2026-10-19. No version
number is assigned by this specification; version and RC attribution are
conductor/owner decisions.

**Revision v2 (2026-10-19)**: revised in place against the two
independent NO-GO reviews in
`docs/reviews/pty-restore-injection/` (`review-astra.md`,
`review-sol.md`). Every P1/P2 finding (and the P3 test-classification
finding) is addressed; §8 maps each finding to the sections changed.
Owner requests A–D (§0.1) are unchanged verbatim; open owner questions
(§6) stay open with their recommended defaults.

**Revision v3 (2026-10-19)**: revised in place against the two
independent NO-GO re-reviews of v2 in the same directory
(`review-r2-astra.md`, `review-r2-sol.md`; v2 SHA-256
`81b47e6f…f82db3`). Every P2 finding (no P1 was raised; the single P3
test-classification finding is also addressed) is fixed; §9 maps each
finding to the sections changed. Owner requests A–D (§0.1) remain
unchanged verbatim, the existing capital (analyses, PR #375 reuse) is
kept, and open owner questions (§6) stay open with their recommended
defaults. Nothing else changes.

**Revision v4 (2026-10-19, minimal)**: revised in place against the
sole remaining finding of the R3 re-review
(`review-r3-astra.md`, NO-GO, one P2; v3 SHA-256 `dc2ae076…ef065`):
an empty readline line does not prove the absence of a multiline Bash
draft. §10 maps that single finding to the sections changed. The
companion R3 review (`review-r3-wonder.md`, GO-CODE) is not revised
against. Owner requests A–D (§0.1) remain unchanged verbatim, the
existing capital is kept, and open owner questions (§6) stay open
with their recommended defaults. Nothing else changes.

Base for every file path and line reference: the git worktree
`tmp/worktrees/spec-pty` at `origin/main` `dc78dc5f7`
(`dc78dc5f79cb25bbb6012229905ebe9aaa6b58f3`, verified by `git rev-parse
HEAD` in that worktree at writing time). Code was read in that worktree.
The dirty main checkout `/home/antoinefa/src/h2a` was not used as evidence.
No owner state was read or touched: no installed `h2a` binary was run, no
real registry, socket, transcript, log, `.env`, auth or token file was
opened, and no test was executed for this specification.

Track items: `01M5A9CAZ75BNCP73B0JCA9H4J`,
`01M5A9CGQJV44H4XYK4XCT8TPV` (bugs A/B, WP5),
`01M5A9G9ESXD5RM0T7K0DJ12QM` (request C),
`01M5A9X2M8R9BDDVX8BJCTG8RA` (request D).

## 0. Owner requests (verbatim) and goal

### 0.1 Verbatim requests

Source A/B: `tmp/relaunch/brief-ptybugs-common.txt`, sections A and B
(owner report of 2026-10-19, after installing `0.98.7-rc.4` and running
upgrade/restore). Quoted exactly, including the screenshot descriptions
carried by the brief:

> A. « j'ai eu plein de bug en faisant l upgrade restore
> 1. h2a upgrade me laisse cette merde : [screenshot: a wall of escaped JSON — install manifests with sha256, sources, "selected": true…, ending with "reason": "already current or registry unreachable"] - inacceptable d'être aussi non-human friendly faut penser acceptabilité / lisibilité stp
> 2. h2a restore: plein d'instances ne redémarrent pas dont celle ci h-cond (j'ai redem manuellement), k8s, gr-conductor etc. [screenshot] les pty semblent actifs donc je pense que tu peux faire qqchose
> 3. attention aux déguelasseurie du gout : [screenshot: after the CLI exited, the shell input line contains terminal reply sequences '>|VTE(8400)^[\^[[?61;1;21;22;28c^[[?2026;4$y^[[?1016;4$y…']
> 4. certaines restorées instances sotn des secondaires (déléguées: revue de code etc) je ne devrais pas les voir avec h2a restore »
> 5. « j'ai duex instances i-cond sur la meme session... c'est mal »
>
> B. « ce n'est pas normal de ne pas avoir des méthodes d'écriture dans le pty. et la commande h2a relaunch n'est pas bonne puisque le pty est ouvert bien sûr ca bloque (h2a dans h2a n'est pas possible). d'ailleurs cette commande devrait être affichée non pas quand on quitte la cli, mais quand on quitte le pty (deuxieme ctrl d) c'est un bug historique a tracker et corriger »

Source C (supervision of delegated PTYs):

> C. « il faut des méthode pour superviser les pty délégués donc il faut ces méthodes d'injection, comme les sendmessage qui reposent la dessus j'imagine (historiquement c'était la méthode sendmessage en tmux, qui ne fonctionne toujours plus depuis le switch a pty) »

Source D (dedicated restore group):

> D. « ah oui aussi dans h-restore t'a pas fait de groupe dédié pour airbus c'est le bordel du coup »

Owner standing rule that binds every lot below: human output in the user's
language, and nothing hardcoded — any language, not only French/English.
No lot may hardcode a language, a group name (for example `Airbus`), a
workspace path, or a project list in product code or product defaults.

### 0.2 Inputs read in full for this specification

| Input | What was taken from it |
|---|---|
| `tmp/h-cond/ptybugs/analysis-wonder.md` (independent analysis 1) | Root causes A.1–A.5/B/C, tmux `send-keys` history, injection-broker proposal, test-leak attribution (`sess-livelock`, `h2a-alpha`), lot proposals and open questions. |
| `tmp/h-cond/ptybugs/analysis-astra.md` (independent analysis 2) | Same incidents from a second angle: exact restore counting defect, `conv-guard.ts` native counter-example for A.5, deposit/wake/processing separation, broker + audit contract, test confinement in layers. |
| `tmp/worktrees/specs/docs/specs/pty-b-batch-handover/SPEC_EVOL_PTY_B_BATCH_HANDOVER.v3.md` (PTY Phase B spec, D1–D28) | The upgrade-continuity contract this EVOL reuses and must not duplicate: stable owner, replaceable frontend, D21 write identities/ACK, D28 retention, B5 qualification, pre-B `unfenced/deferred` amendment. Cited below as "PTY-B D*nn*". |
| PR #375 worktree `tmp/worktrees/ptycode` (`feat/pty-b-handover`, HEAD `d5d34e20b` at writing time) + its `BRANCH.md` | Implemented Phase B surface (40 files vs `origin/main`), pre-B amendment text, and the explicit limit: B5 Linux/macOS is **not** qualified (no non-empty real CLI cohort; CI red by design on that gate). |
| Code at `dc78dc5f7` in `tmp/worktrees/spec-pty` (§1) | Every starting-point fact and every per-lot file list. Where the two analyses cite an older `origin/main`, line numbers were re-checked at this base; symbols, not remembered lines, are normative. |

The two analyses agree on the root causes and on the lot decomposition.
Where they differ in emphasis, this specification takes the stronger
requirement and says so (for example: host-side atomic arbitration of
injection from analysis 1, plus the durable-admission and receipt
contract from analysis 2 — both are adopted, neither replaces the other).

### 0.3 Goal — the owner's outcome

1. **`h2a restore` really restarts the CLIs.** A live PTY whose CLI has
   exited to its persistent shell gets its CLI resumed **in that same
   PTY**, exactly once, with a per-session observed outcome. A planned
   tab, a spawned terminal window, or a live wrapper is never reported
   as a resumed CLI. No physical session ever produces two tabs, two
   instances, or two writers on one conversation.
2. **Delegated PTYs are supervisable.** A conductor can inspect, observe
   and — under explicit authority, with audit — inject into a delegated
   PTY **while its window stays attached**, without ever typing over a
   human. The historic tmux property (`send-keys` coexists with an
   attached client) is restored on the native PTY substrate.
3. **`h2a send` wakes its target again.** Message deposit, wake
   submission, application receipt and message processing are separate,
   separately reported acknowledgements. A deposited message is never
   presented as a processed message.
4. **The terminal stays clean and the hint comes at the right moment.**
   Terminal reply sequences never reach the shell prompt. The in-PTY
   resume command is shown when the CLI exits; the `h2a run …`
   recreation command is shown only when the PTY itself ends (second
   Ctrl-D), by the component that survives it, with correct quoting.
5. **Restore shows only primary sessions, in their configured groups.**
   Delegated/secondary sessions are excluded by provenance, and sessions
   are laid out by dedicated, configurable groups (request D) instead
   of being mixed into shared windows — with no group name, workspace
   or language hardcoded.
6. **`h2a upgrade` / `h2a restore` speak to the human first**: short
   status lines in the user's language; JSON only under `--json`.
7. **Tests can never write to the owner's real state again** (lot L0,
   prerequisite of every other lot's proof on a real machine).
8. **Upgrade continuity is PR #375's, reused once.** This EVOL consumes
   Phase B (owner/frontend, retention, per-component reporting, the D21
   ACK/dedup mechanism — extended with a distinct automation frontier,
   since D21 identities are controller-bound, §1.9/D5) and its B5
   qualification; it builds no second upgrade implementation and
   weakens no Phase B gate.

Anything the owner did not ask for is marked **proposition, not
validated** wherever it appears. Open owner questions of principle are
collected in §6, marked OPEN with a recommended default; none of them
blocks lots L0, L1, L4, L5, L6 or LG (§4).

## 1. Starting point at `dc78dc5f7` (facts read in code)

Paths below are repo-relative. `R/` abbreviates `packages/h2a-runtime/`
and `H/` abbreviates `packages/h2a/` in prose only; lot allow-lists in §4
always spell full paths. Line numbers are those of `dc78dc5f7` and are
locators, not contracts — the named symbol is the contract.

### 1.1 The structural confusion: three lifetimes, one bit

- `R/src/tmux.ts:121` `LOCAL_WRAPPER` runs the CLI, prints an exit line
  and the relaunch hint built by `localRelaunchCommand` (`:181`), then
  `exec /bin/bash -l`. `R/src/native-host.ts` reuses this wrapper for the
  native PTY. Consequence: after the CLI exits, the PTY is still
  `running` — it now holds a login shell.
- `R/src/native-terminal/host.ts:567` `NativeTerminalSessionState`
  exposes PTY status, pid, controller and `lastHumanActivityAt` (`:590`).
  It exposes **no application facet**: nothing says whether the
  foreground is the expected CLI, the wrapper shell, another program,
  or unknown. There is no CLI incarnation/birth distinct from the PTY's.
- `R/src/restore.ts:494` `captureHostViewSnapshot` therefore keeps only
  `status === "running"` plus the `controlled` bit, and
  `R/src/launch-layout.ts:168` `launchLayout` can only skip
  (`controlled:true`, "already visible"), attach (`controlled:false`),
  or fail closed (`controlled:undefined`, partial inventory
  `complete:false`). No restore path relaunches a CLI inside a live
  native PTY at a shell prompt. The tmux in-situ equivalent
  (`relaunchInSession`, `R/src/tmux.ts`) has no native counterpart.
- The report then over-claims: `restore()` (`R/src/restore.ts:1004`)
  returns `total` = planned tabs (`:1145`), ignores `launchLayout`'s
  `{opened, skippedLive}`, and the command in `R/src/index.ts`
  (`restore [group]`, `:9910`) prints that total as relaunched tabs.
  Even `opened` only proves `gnome-terminal` was spawned.
- Version skew makes the fail-closed branches fire en masse (conductor
  fact from the brief: native host started 2026-10-16 23:33 kept running
  while `0.98.7-rc.4` was installed 2026-10-18). On this base,
  `performAutoUpgrade` (`H/src/runtime/upgrade/index.ts`) never signals,
  replaces or even inventories the resident PTY host, and the supervisor
  adopts a healthy host without comparing loaded vs installed versions.
  Each individual fail-closed is defensible; the product defect is the
  missing third state (live PTY + shell foreground ⇒ resume in place),
  the missing per-session ledger, and the missing ordered host
  treatment — the last of which is PR #375's scope, not this EVOL's (§2
  D13, lot L7).

### 1.2 Injection today: a single exclusive lease for three roles

- Wire protocol v1 (`R/src/native-terminal/protocol.ts:53`) already has
  `attach-observer`, `acquire-controller` and
  `acquire-controller-if-no-recent-human`. The observer role has **no**
  `op` verb and no product surface.
- `R/src/native-terminal/op.ts:227` `withController` backs
  `write`/`paste`/`enter`/`resize`; `acquireController`
  (`host.ts:1139`) is an exclusive lease, refused while a human window
  is attached (`terminal session already has a controller`).
  `withController` also omits the activity, so the client default
  `"human"` applies: a successful machine write stamps
  `lastHumanActivityAt = now` (`host.ts:1173`, `:1224`) — automation
  forges human activity and poisons the anti-overwrite window.
- `drive` (`op.ts:858`) uses
  `acquireAutomationControllerIfNoRecentHuman` (`host.ts:1189`): refused
  if **any** controller exists — the 4 s activity window
  (`H2A_WAKE_DEFER_ACTIVITY_MS`) is only reached after that check. Every
  acquisition failure (lease held, recent human, old host without the
  operation) is flattened to `{outcome:"deferred"}` (`op.ts:866`,
  `:891`): "retry in 4 s" and "never while this window is open" are
  indistinguishable.
- No owner-facing CLI/MCP verb wraps these primitives. The only callers
  are initial-prompt delivery, restart, and the wake chain (§1.3).
  `h2a relaunch` on a live native session is kill-tree + recreate; the
  bare sweep sees only the tmux inventory. There is no "resume the CLI
  in this open PTY".
- The measured composer protocol is not a draft-safety proof:
  `deliverInitialPrompt` (`R/src/prompt-delivery.ts`) detects a ready
  UI, not an empty composer (its own commentary at `:237` says a drawn
  composer is not necessarily ready), then calls `clearComposer`
  (`:551`, again `:608`), waits for paste evidence and submits as
  separate steps. The native transport implements `clearComposer` as
  Ctrl-U (`R/src/native-host.ts:846`). An empty PTY input queue proves
  nothing about a draft: readline/the TUI may already have consumed the
  bytes and hold the draft itself. Reusing this sequence next to an
  attached human window is unsafe without the D6 composition evidence
  and the D5 owner-side transaction.
- The same gap opens on the **primary** shell — the exact A.2/L1b
  nominal case, not a delegated window. A primary window takes the
  human controller at attach (`runAttach` → `client.acquireController(
  …, "human", …)`, `R/src/native-terminal/op.ts:571`) and stays
  attached; when the CLI exits, `LOCAL_WRAPPER` drops into an ordinary
  login shell (`exec /bin/bash -l`, `R/src/tmux.ts:131`). Such a shell
  has already received human composition by construction, so neither
  the delegated observation handover (a window in observation from the
  start) nor a later release/observation flip can prove its current
  readline draft empty — and no shell adapter exists today. The
  reusable capital is already in place, read at this base: the wrapper
  exports a `PROMPT_COMMAND` hook that emits the
  `ESC]777;h2a-reset` marker at every prompt of the persistent shell
  (`R/src/tmux.ts:124`, `:127`), and the host already consumes that
  marker incrementally from the output stream
  (`R/src/native-terminal/reset-relay.ts`, used by `host.ts`). D6(iii)
  extends exactly this hook into the named managed-shell adapter;
  the existing reset marker is not itself a composition attestation.
  Without the adapter's proof, primary in-place resume must defer
  (lot L1b/L2).
- Hint timing: the wrapper prints `h2a run <profile> <cwd> --name …
  -r …` **at CLI exit**, inside the still-live PTY, where (a) the right
  action is the profile's own resume in the current shell, and (b) the
  suggested `h2a run --name <same>` is refused (`already exists`). The
  recreation line only makes sense after the PTY itself ends. Existing
  functional tests pin the wrong timing (`[h2a] relaunch:` expected
  before the shell prompt) and must be inverted explicitly (lot L4).

### 1.3 Send/wake: durable deposit works; the wake types into a lease

- Deposit (durable, signed, never typed): `H/src/runtime/send.ts`
  `sendLocalMessage`, MCP `h2a_send` (`H/src/runtime/mcp/handlers.ts`).
  This half never depended on the PTY and is not broken.
- Wake (ephemeral, typed): the target sidecar detects new inbox
  envelopes (`decideInboxWake`, `H/src/wake.ts`), self-signs a visible
  `[h2a-wake …] run /h2a receive` line
  (`formatSignedDriveInstruction`, `H/src/runtime/drive/index.ts:246`;
  handler `H/src/runtime/drive/inbox-wake.ts:54`) and submits it through
  an `H2ADriver`. `seen` advances only on driver success — but on
  handler restart the existing inbox is folded into `seen`
  (`inbox-wake.ts`), so a wake deferred across a sidecar restart can be
  lost (the envelope is not lost; the notification is).
- Under tmux this worked because `tmux send-keys` is a server operation
  independent of attached clients; the only guard needed was recent
  activity (`localTmuxDriver` → `tmuxSendSubmit`,
  `H/src/runtime/drive/index.ts`, `H/src/runtime/drumbeat/relaunchers.ts`).
- Under native PTY: `nativePtyBackchannelDriver` (`H/src/cli.ts:3809`)
  spawns `op.js drive --target …` for `H2A_NATIVE_TARGET_SESSION`
  (stamped by `R/src/native-host.ts:694`). With the owner's supervision
  window attached, `drive` hits §1.2 and returns `deferred` forever;
  the driver flattens it to `false`/log `failed`; the tmux fallback of
  the wake `auto` chain (`H/src/cli.ts:2158`) has no pane. Result:
  deposit succeeds, wake never lands, no typed reason anywhere.
- Authority capital already exists and must be reused as-is:
  `authorizeDrive` (`H/src/runtime/drive/index.ts:339` — self, conductor,
  principal, shared-scope mandate, or explicit consent), signed-line
  verification and anti-replay on receive (`h2a drive receive --stdin`).
  But `op.js` receives raw bytes + target: outside the signed `drive`
  channel, the 0600 socket is a transport boundary, not an
  agent→delegated-PTY authorisation proof. Lot L2 must carry authority
  to the application point.
- Qualification hole: `R/src/native-terminal/drive.functional.test.ts`
  proves submission to a real PTY and deferral after human activity —
  with the human lease **released before** the attempt. The owner's
  nominal case (window attached) is covered by no test. The same holds
  for `H/test/pty-native-messaging.test.js` (openpty byte receiver, not
  a real CLI with an attached window).

### 1.4 Terminal replies in the shell (A.3)

The captured fragments (`>|VTE(8400)`, `ESC[?61;1;21;22;28c`,
`ESC[?2026;4$y`, `ESC[?1016;4$y`) are **replies** of the outer terminal
(VTE): XTVERSION, Primary DA, DECRPM for modes 2026/1016. Three defects,
all read in code:

1. No query→reply correlation. PTY output is relayed verbatim to the
   outer terminal (`runAttach`, `R/src/native-terminal/op.ts:387`), whose
   replies are forwarded verbatim back into the PTY (`onInput` →
   `client.write`), with no distinction between keystrokes and machine
   replies and no notion of which foreground process asked. A reply that
   lands after the asking CLI exited is consumed by `bash`/readline.
   Classification in the bridge alone cannot fix this: the host's write
   path (`write`, `R/src/native-terminal/host.ts`) checks only the PTY
   controller lease before `pty.write`, and that lease stays valid
   across the CLI→shell transition — a reply accepted by the bridge and
   still in flight when the CLI exits would be applied to the shell.
   The correlation must be revalidated at the final write point (D10).
2. Two responders in series. The host already answers cursor-position
   queries itself (`ESC[6n` → fabricated `ESC[1;1R`, `host.ts` DSR loop)
   while also relaying the query outward. No table states which query
   family the host terminates and which it delegates.
3. Replay re-elicits. On (re)attach the bridge repaints from the host
   replay buffer (`R/src/native-terminal/replay-buffer.ts`), whose
   historical query sequences draw fresh replies from the outer terminal
   for a program that is dead or no longer waiting. The reset relay
   (`R/src/native-terminal/reset-relay.ts`) and mode tracker
   (`R/src/native-terminal/terminal-modes.ts`) clean **output** modes
   before the shell prompt; nothing drains or quarantines **input**
   replies across the CLI→shell transition. Parsers must be incremental:
   a reply can straddle chunks, a reconnect, or the CLI/shell boundary.

### 1.5 Secondaries in restore (A.4) and duplicate identity (A.5)

- Restore gate: `isHumanFacingSession` / `deriveLegacySessionClass`
  (`R/src/restore.ts:301` area) rejects `endedAt` and `role:"job"`,
  honours a persisted `sessionClass`, else promotes a classless legacy
  row to `human` on transcript or live-tmux evidence. It **never**
  inspects `delegationOrigin`, `delegatorInstance`,
  `delegatorTmuxSession`, `parent` or `callbackTo`, although the
  registry persists and validates them (`R/src/registry.ts:208`,
  `:1661`, `:979`). Discovered sessions carry only
  `restoreClass:"human"|"unclassified"` (`R/src/restore.ts:109`);
  registry rows are stamped `"human"` at `:673`.
- Launch classification: `deriveSessionClass`
  (`R/src/session-class.ts:18`) returns `human` as soon as
  background/headless are false and `humanTerminal` is true; the main
  `run` path defaults `humanTerminal` to true. A delegated review
  launched attached for supervision is therefore `human` by
  construction. A window is an access modality, not a restore intent.
  The transcript scan is already neutralised (`unclassified`, filtered
  at `R/src/restore.ts:1097`); the leak is via registry rows. The remote
  path bypasses the local filter entirely: remote tabs are built from
  every `listRemoteSessions` row (`R/src/index.ts:9979`) with no class.
- Duplicate identity: one physical session gets two registry rows —
  `enrollFromRun` keyed by slug and the SessionStart hook keyed by
  conversation UUID (`R/src/enroll.ts`, `R/src/registry.ts`). The join
  exists only in the restore plan (`reconcileRunConvIds` +
  `claimedConvIds`, `R/src/restore.ts:406`). `mergeDiscovered`
  (`:729`) dedups by non-empty `sid`; an unresolved-but-live `run` row
  gets `sid:""` (attach-live) and bypasses dedup while its unclaimed
  hook twin survives — two tabs, one session. Surfaces that enumerate
  rows without the join show two "instances".
- A second, independent duplicate counter-example (analysis 2, verified
  at this base): `ownerFromEntry` (`R/src/conv-guard.ts:59`) treats only
  `local-tmux` as a verifiable terminal owner; a live `local-native`
  row without `pid` degrades to `suspect`, and `guardConvWriters`
  (`:181`) allows the launch when only suspects exist. The resume path
  does not propagate the launched PID into enrollment, so a later
  resume under another name can start a second writer on the same
  conversation. The short resume claim (`R/src/relaunch.ts`) serialises
  concurrent launches but is released after enrollment. That claim plus
  `guardConvWriters` are only wired into the `h2a run` entry point
  (`tryAcquireResumeLaunchClaim` and the guard call in
  `R/src/index.ts`, run path): a future in-shell resume that types a
  command into a PTY bypasses both unless it is explicitly routed
  through the same reservation (D3). Per-PTY broker arbitration and
  per-request idempotency do not provide per-conversation exclusion
  between two PTYs or two processes.
- The exact surface on which the owner saw two `i-cond` is not in the
  brief. This EVOL therefore fixes both demonstrated mechanisms and
  requires the identity evidence (instance, provider session id,
  presence session id, PTY/socket/generation/incarnation, pid/birth,
  launch provenance) to close the specific occurrence — it does not
  pick one mechanism by guess, and it never auto-kills a same-named
  session (§5, §6 Q4 note).

### 1.6 Upgrade output (A.1) and language

- `cmdUpgrade` (`H/src/cli.ts:1878`) prints `JSON.stringify(…, null, 2)`
  on every outcome. There is no human mode, no `--json` opt-in, no TTY
  detection. `convergeAfterExplicitUpgrade`
  (`H/src/hosts/upgrade-equipment.ts:7`) runs `doctor --repair` per
  native host even when nothing was upgraded and embeds
  `{host, ok, command:[…absolute paths…], result: child.stdout,
  diagnostic: child.stderr}` — a JSON report string inside the outer
  JSON, re-escaped. That double encoding is the owner's screenshot.
- `reason: "already current or registry unreachable"` joins two
  different states of knowledge. `hosts.ok === false` does not make the
  overall outcome partial. Both are result-model defects, not only
  rendering defects.
- Language: no locale helper exists on these paths (no `H2A_LANG`,
  `LANG` or `Intl` use in `H/src/cli.ts`, `R/src/restore.ts`,
  `R/src/index.ts` at this base). `upgrade` emits English machine JSON;
  `restore` and `launchLayout` emit hardcoded French on stderr
  (for example `fenêtre partagée`, `R/src/restore.ts:965`;
  `déjà visibles`, `R/src/launch-layout.ts:437`; the whole
  `restore [group]` help, `R/src/index.ts:9912`). Mixed-language output
  in one run is the current behaviour. Existing tests pin the JSON
  contract (`H/test/upgrade.test.js` parses `cmdUpgrade` output) — lot
  L6 must move them to `--json` explicitly, not silently break them.

### 1.7 Restore grouping — investigation for request D

This subsection is new work for this specification; neither analysis
covers D. All claims were read at `dc78dc5f7`.

**What exists.** A configurable grouping mechanism already exists and
must be extended, not replaced:

- `LayoutConfig` / `LayoutGroup` (`R/src/config.ts:36`, `:43`): a group
  is `{title, projects?: string[], remote?: boolean}`. The layout also
  carries `maxAgeHours`, `maxPerWindow` (default 12), `sharedWindows`
  (default 2), `multiSession` and `multiSessionDefault`.
  `DEFAULT_LAYOUT.groups` is **`[]`** (`R/src/config.ts:62`): out of the
  box there is no dedicated group at all — every session falls into the
  shared pool. That default alone reproduces the owner's "c'est le
  bordel" whenever no layout config was ever written (the `h-restore`
  situation named in D).
- `getLayoutConfig()` (`R/src/config.ts:599`) merges the persisted
  `layout` field over defaults field-by-field, with `groups` taken as
  `Array.isArray(raw.groups) ? raw.groups : []` — **no shape
  validation** of group entries (title type, projects type, duplicates,
  unknown keys all pass through unchecked).
  `setLayoutConfig` (`:623`) exists but no restore command surface
  validates or reports the effective grouping before launch.
- `groupSessions(sessions, cfg)` (`R/src/restore.ts:878`): explicit
  groups first (their projects leave the shared pool), then remaining
  projects round-robin into `sharedWindows` windows titled with the
  hardcoded French `fenêtre partagée N` (`:965`), capped at
  `maxPerWindow`; overflow of the shared pool is counted as `dropped`.
- `restore()` orders windows by `cfg.groups` then shared windows,
  supports `restore [group]` filtering by slug-normalised title
  (`titleMatches`, `R/src/restore.ts:997`; same normalisation duplicated
  in `R/src/index.ts:9946`), prints the plan, then calls
  `launchLayout` and records `layout-last.json` (`writeLastLayout`).

**Why D still happens — five gaps, each sufficient on its own:**

1. **Matching is by exact `project` string only.** A group's
   `projects` must enumerate the exact keys produced by
   `projectForCwd` (`R/src/restore.ts:139`): the **whole** path below
   `~/src/` (for example `h2a/tmp/worktrees/ptycode`, not `h2a`).
   There is no cwd-prefix, workspace-root, project-prefix, label or
   instance matching. A dedicated group for a family of workspaces
   (Airbus checkouts, worktrees, nested repos) must list every nested
   path verbatim and silently stops matching the day a new worktree
   appears. A group naming a non-existent project is silently empty.
2. **Sessions outside `~/src/` never reach grouping at all.**
   `registrySessions` skips any row whose cwd is not under `~/src/`
   (`R/src/restore.ts:623`: `if (!e.cwd.startsWith(\`${src}/\`)) continue`),
   and both scanners are rooted at `~/src`. A workspace family living
   outside `~/src` is invisible to restore — it cannot be grouped,
   only lost. (Whether Airbus workspaces live outside `~/src` on the
   owner's machine was not inspected — real state is out of scope; the
   code fact stands either way and lot LG must handle both.)
3. **One session can be placed twice; overflow can vanish uncounted.**
   The explicit-group loop (`R/src/restore.ts:930`) adds each project's
   slots without checking whether the project was already claimed by an
   earlier group — the same project listed in two groups yields
   duplicate tabs. Inside a group, slots beyond `maxPerWindow` are cut
   by `break` (`:936`) and are **not** included in `dropped` (which
   counts only shared-pool overflow, `:962`): grouped sessions can
   disappear with no count and no line in the plan.
4. **Remote groups duplicate.** Every `remote:true` group is filled
   with the **same** full `remoteTabs` list sliced to `maxPerWindow`
   (`R/src/restore.ts:1124`): two remote groups show the same sessions
   twice. There is no per-group remote selector.
5. **No pre-flight account of grouping.** `--dry-run` prints windows and
   tabs, but nothing states: which rule placed each session, which
   sessions matched no group and fell into shared windows, which
   configured groups matched nothing, or which sessions were dropped by
   which cap. The owner discovers the mixing by looking at the opened
   windows — exactly the D report.

`launch-layout.ts` itself is group-agnostic (it renders the windows it
is given, one `gnome-terminal` window per `LayoutWindow`); all grouping
defects are in `config.ts` + `groupSessions` + `restore()`. Lot LG (§4)
is scoped accordingly and must preserve: explicit groups before shared
pool, `restore [group]` title filtering, remote-group filling from SCW
tabs, per-project `multiSession` caps, and the rule that every
registry-backed session of a project is preserved (no collapse).

### 1.8 Test pollution of real state (lot L0 evidence)

Both analyses identify the same two leakers by unique fixture ids;
re-verified at this base:

- `R/src/attach-reconnect-livelock.test.ts` drives the real `attach`
  with `sessionId:"sess-livelock"`; `attach` calls
  `appendCrashLog("attach", …)` (`R/src/attach.ts`), which resolves
  `${XDG_STATE_HOME:-$HOME/.local/state}/h2a/attach.log`
  (`resolveCrashLogPath`, `R/src/crash-log.ts:108`;
  `appendCrashLog`, `:435`). The suite sets no `HOME`/`XDG_STATE_HOME`
  isolation.
- `R/src/native-terminal/op.test.ts`, first `describe`
  ("native terminal attach recovery"), drives the real `runAttach`
  (`h2a-alpha`) into the same log. Only the **second** `describe` in
  that file installs a `mkdtemp` `XDG_STATE_HOME`.
- The global guard catches none of this: `R/vitest.native-isolation.mjs`
  (both vitest configs) installs only
  `afterEach(assertNoNativeTestSpawnViolations)` — a **spawn** guard.
  The full isolation helper (`H/test/helpers/native-isolation.js`:
  `setupNativeTestEnvironment`, `assertIsolatedEnvironment`) is opt-in
  per file and child-process oriented. The leak is an **in-process**
  file write through a default path — outside the guard's threat model.
  Every other default-path writer (host journal, registry,
  `layout-last.json`, config via `resolveConfigPath`, other crash-log
  components) carries the same latent risk; lot L0 inventories them.
- Two more unclosed write paths, verified at this base:
  `appendCrashLog` (`R/src/crash-log.ts:435`) accepts an explicit
  `logPath` argument that bypasses `resolveCrashLogPath` entirely and
  creates the directory and lock before any check — guarding only the
  resolver cannot protect this call; the check must sit at the mutation
  point. And in `guardedEnvironment`
  (`packages/h2a/test/helpers/native-isolation.js`), a non-Node child
  simply keeps its environment: nothing stops a shell or native binary
  from writing to an absolute path or through a symlink without
  consulting `HOME`/XDG or any h2a resolver. An isolated environment is
  not a filesystem barrier for descendants (D16 names one).
- The same helper module already doubles as a Node preload: it
  self-propagates to spawned Node children through
  `NODE_OPTIONS --import=<its own url>` and installs the spawn guard on
  import. But no authorised top-level Node test command names it, and
  importing it does **not** establish the isolated roots — that still
  happens only when a suite explicitly calls
  `setupNativeTestEnvironment`. A plain `node --test <file>` therefore
  has no before-import isolation at all (D16, lot L0 fix the command
  and make the preload establish the roots). Two precision facts for
  that command: the helper propagates itself as
  `--import=${import.meta.url}` (a `file:` URL,
  `H/test/helpers/native-isolation.js:175`) and the gate runner passes
  an absolute path built with `join(REPO_ROOT, …)`
  (`scripts/run-tests.mjs:409`), while a bare
  `--import packages/h2a/…` specifier would be resolved by Node as the
  package named `packages`, not as a repo-relative file — the
  authorised textual form from the repo root is
  `--import ./packages/h2a/test/helpers/native-isolation.js` (D16, §4).
  And isolating the environment never confined a native descendant:
  `guardedEnvironment` returns the environment unchanged for a
  non-Node child (`H/test/helpers/native-isolation.js:197`:
  `if (!isNode(command)) return env`).
- Every direct test invocation in CI at this base is enumerable
  (grep-verified over `.github/workflows/`): bare `node --test` steps
  in `ci.yml` (`scripts/check-no-python.test.mjs`, the host-oracle
  Codex case, the messaging leg, the `run-test-gates` trust root),
  `codex-drift.yml` (the same Codex case), `release.yml` (the trust
  root) and `focus-dossier.yml` (seven `node --test` steps), plus two
  direct `npx vitest run` legs in `ci.yml`. Two contract suites pin
  the old bare trust-root command verbatim and go red the moment a
  workflow is rewired without them: `H/test/release-workflow.test.js`
  (`firstStepIndex(…, "node --test …run-test-gates.test.js")`, `:285`,
  and the mandatory exact-step map, `:610`) and
  `H/test/run-test-gates.test.js` (the dedicated CI job's exact
  command list, `:494`). Conversely, verified at this base,
  `H/test/gateway-host-build.test.js` only checks that the
  `ci.yml`-listed runtime test paths exist, and
  `packages/h2a/focus-kit/test/evidence-corpus-checkout.test.mjs` only
  matches the `prepare-evidence-corpus` step — neither pins a test
  command, so neither needs an edit for the rewiring (lot L0).
- The 2026-10-17 timestamps in the brief are consistent with the
  per-component crash logs landing 2026-10-16: previously file-free
  suites started writing real state the day the production code under
  test gained a default-path side effect.

### 1.9 What PR #375 does and does not cover

Measured on `tmp/worktrees/ptycode` (`origin/main...HEAD`: 40 files,
+6893/−226): `native-terminal/{owner-protocol,owner-process,
frontend-process,fleet,supervisor,server,host,op,client,protocol}`,
`H/src/runtime/upgrade/index.ts`, `H/src/hosts/upgrade-equipment.ts`,
`H/src/cli.ts` (adds a `pty` field to the same upgrade JSON), CI and
tests. It touches **no** restore, launch-layout, relaunch, wrapper,
registry, session-class, conv-guard or config file, and in `op.ts` it
changes attach write-identities (PTY-B D21), not `drive`/`write` lease
semantics.

| Bug | PR #375 brings | Still fully open after #375 |
|---|---|---|
| A.1 JSON wall | Per-component `pty` reporting inside the same JSON | Human output, nested doctor payload, language, outcome split |
| A.2 restore | Phase-B hosts: no frontend skew (swap without signalling the owner) | PTY-vs-CLI restore decision; the owner's pre-B host (`admission: unfenced`, `retirement: deferred`, indefinite coexistence — ratified amendment in its `BRANCH.md`); B5 unqualified |
| A.3 replies | Nothing (ANSI/TUI complexity is NOT-covered in PTY-B §8) | Everything |
| A.4 secondaries | Nothing | Everything |
| A.5 duplicates | Nothing (D21 write identities ≠ registry identity) | Everything |
| B write + hint | Attach chunks survive a frontend swap (D21) | Lease-as-write-gate, hint timing, destructive native relaunch |
| C supervision/wake | Nothing on `drive`/wake | Wake with an attached window; supervision surface |
| D groups | Nothing | Everything (§1.7) |

One precise reuse limit inside #375, verified in its worktree: the
PTY-B D21 write identity is **controller-bound**. `OwnerWriteIdentity`
carries `sessionId/incarnation/controllerEpoch/seq`
(`native-terminal/owner-protocol.ts`), `host.write` requires the
current controller lease, its resume token and its epoch before
advancing the single `writeFrontier`, and the server requires the lease
to be owned by the requesting connection. An injector that must not
take the human lease (D5) therefore cannot "carry a D21 identity" as
it stands: borrowing the controller sequence would race human
keystrokes, acquiring another lease reintroduces the original defect,
and writing directly would bypass dedup. Reuse means a **distinct
automation writer identity/frontier in the same owner**, reusing the
D21 ACK/dedup mechanism — an `owner-protocol` extension this EVOL must
define before lot L2 (D5, D17), not a seam discovered at lot L7.

Conversely, this EVOL must not re-open what #375 owns: frontend swap,
retention/pins (PTY-B D28), fleet inventory, pre-B deferral reporting,
macOS substrate (PTY-B BM), Phase L batches. Lot L7 is integration and
qualification wiring only (§4).

## 2. Decisions

Source column: **Owner** = verbatim request or standing rule (§0.1);
**Analyses** = convergent conclusion of both independent analyses,
re-verified in code at `dc78dc5f7` (§1); **Code** = fact of the current
code that constrains the design; **PTY-B** = inherited from the Phase B
spec/PR #375 and reused, never re-decided here; **Proposition, not
validated** = this specification's proposal (mechanism, name or number),
to be pinned by the implementing lot's RED tests. Decisions that need an
owner principle are not decided here: they are in §6, OPEN, each with the
recommended default that the lots below assume **only** where stated.

| # | Decision | Source |
|---|---|---|
| D1 | **Four states, always separate.** Terminal (PTY) lifetime, application (CLI) lifetime/incarnation, human-input ownership, and view attachment are reported and decided as distinct facets. An unknown observation stays `unknown` — it is never coerced to shell, dead, visible or resumed. The native host gains a host-side foreground facet (`cli`/`shell`/`other`/`unknown`, proposition vocabulary) derived from the PTY foreground/worker state, never from client-side `/proc` guessing, CPU, window title or silence. Old hosts omit it; absence is `unknown`. | Analyses + Code (§1.1) |
| D2 | **Restore reports observed outcomes, never plans.** Every restore run ends with a per-session ledger (`already-active` / `attached` / `resumed-in-place` / `recreated` / `excluded:<reason>` / `deferred:<reason>` / `failed:<reason>`, proposition vocabulary) plus a totals line derived from observed outcomes only. A planned tab, a spawned window or a live wrapper never counts as a resumed CLI. **Exit status is derived from unsatisfied objectives, never from the number of launches:** a real run exits non-zero only if at least one primary candidate that needed an action ends `failed:<reason>` or `deferred:<reason>` for a blocker (for example a stale PTY host, named once with its remedy, instead of N per-session UNKNOWN notes). `already-active`/`attached` satisfy the objective — re-running restore immediately after a successful restore exits 0 — and a run with zero candidates exits 0 with the ledger stating that there was nothing to restore. `--dry-run` has a distinct contract: it exits 0 when the plan was computed and its inputs are valid (blockers are reported as plan data), non-zero only on a fatal input/config error; it never executes anything. | Owner A.2 + Analyses (§1.1); exit contract pinned by revision v2 |
| D3 | **Resume in place is a structured operation, not blind shell typing.** Live PTY + `shell` facet + resolved conversation ⇒ resume the profile's own structured resume command in that PTY through the D5 broker, bound to the exact conversation UUID and the new application incarnation, then verify the CLI actually appeared before reporting `resumed-in-place`. Live PTY + `cli` facet ⇒ attach only, never inject. Any other facet, an unsent human draft, or an unrelated foreground program ⇒ defer with a typed reason; the draft/program stays intact. Dead PTY + resolved conversation ⇒ current recreate path. **In-place resume goes through the existing per-conversation reservation, on every entry point** (restore, relaunch sweep, `resume-application`): acquire `tryAcquireResumeLaunchClaim` for the exact conversation UUID, run `guardConvWriters` excluding only the proven physical target PTY and its aliases (never masking another writer), transition the host session atomically from `shell` to a resuming state before any byte is injected, revalidate facet/incarnation/claim at the injection commit, and hold the claim until the new writer is observed and enrolled — or until the uncertainty is explicitly resolved (never released on a timeout guess). At most one CLI start per conversation UUID results, across processes, request keys and PTYs; an ambiguous target refuses with a typed outcome and starts nothing. The destructive kill/recreate native `relaunch` stays explicit single-target only; the bare sweep gains the same in-place rule for native sessions. | Owner A.2/B + Analyses (§1.1, §1.2, §1.5) |
| D4 | **One physical session, one writer, one tab — on every surface.** (a) The conversation guard treats a proven-live `local-native` owner as a refusing owner even when its registry `pid` is absent (closes the §1.5 counter-example); the resume/enrollment path propagates the evidence it already has instead of degrading to `suspect`. (b) The restore join (`reconcileRunConvIds` + claimed convIds) becomes one shared read-path function used by restore and every listing surface; no surface implements its own dedup. Dedup keys in order: exact managed name → conversation UUID → registry id. An attach-live (empty-`sid`) row and its hook twin sharing one managed name render as **one** attach tab plus a named registry-conflict note, never two launches. (c) Views/MCP connections of one application are grouped in display without concealing competing application writers. Nothing here weakens the resume claim, the dual-host `ambiguous` refusal, or possession proofs; nothing auto-kills a same-named session. Write-time row merge is proposition, not validated (read-path join ships first, lot L1). | Owner A.5 + Analyses + Code (§1.5) |
| D5 | **Host-side injection broker, concurrent with the attached window.** A new capability-advertised host operation (proposition name `inject`, protocol v1 extension) is applied by the host under its own serialised handler **without** taking or revoking the human controller lease. The attach lease keeps exactly its current meaning (interactive control + resize authority); `inject` never resizes. Payload kinds: `line` (one validated line, current `drive` rules), `paste` (one bracketed block), `submit-text` (text+submit to a recognised application facet as **one owner-side transaction**, below), `keys` (named keys only — Enter, C-u, C-c, Escape; no arbitrary control bytes), `resume-application` (D3). Raw bytes stay on the existing controller write path only. Human writes and injected units are serialised by the host in arrival order, bracketed so they can never interleave byte-wise. Machine injection never stamps `lastHumanActivityAt`. **Automation writer identity (defined here, before L2):** each injection is applied under a writer identity distinct from the human controller's — proposition fields `{sessionId, incarnation, automationSeq, requestId}` — with its own contiguous applied frontier held by the owner, separate from `controllerEpoch`/`writeFrontier`; the owner maps the request's idempotency key to its assigned `automationSeq` and original outcome, so a redelivery (including after client reconnect) returns the original ACK and is never re-applied. On the PR #375 base this is an extension of `owner-protocol`/`host` reusing the D21 ACK/dedup mechanism (§1.9, D17); the human lease, epoch, resume token and frontier are never borrowed, advanced or invalidated by an injection. **`submit-text` transaction:** reserve (facet, incarnation, human-input epoch and D6 composition evidence checked in the owner) → paste one bracketed block → bounded wait for paste evidence → submit (Enter) → ACK. From `deliverInitialPrompt` only the paste-evidence wait is reused; its UI-readiness detection is not composition evidence (§1.2) and its composer-clearing step (`clearComposer`, Ctrl-U on the native transport) is **prohibited** on any session where human composition is possible. Human bytes arriving before the paste preempt the transaction with zero bytes written; bytes arriving between paste and submit abort the submit (no Enter, no clearing; the human bytes stay ordered after the pasted block) with a typed outcome (proposition `preempted-after-paste`); cancellation has exactly these two cases and no third. Launch-time initial-prompt delivery keeps its composer contract only under its own attestation: a fresh incarnation created by the launcher in which no human controller epoch has ever written — that fact, not UI readiness, is the evidence. | Owner B/C + Analyses (§1.2, §1.3, §1.9); operation/kind/identity-field names = Proposition, not validated |
| D6 | **Never type over a human — decided atomically in the host.** `inject` is refused/deferred in one host-side decision (serialised with controller writes; no client read-then-write TOCTOU) when any of: human activity inside the defer window (existing `lastHumanActivityAt` + `H2A_WAKE_DEFER_ACTIVITY_MS`, default 4000 ms unchanged); unconsumed human bytes / an unfinished human draft or an unknown safe insertion point (an expired timer alone never proves an empty composer); foreground-facet mismatch for the payload kind; stale incarnation; missing capability (old host). **Composition evidence — the nominal path is fixed now, not left to a lot report.** Submission into a session where human composition is possible is admissible only under one of: (i) **observation handover** (Q2 recommended default (a)): an attached delegated window starts in observation mode, in which human keystrokes do not reach the PTY; taking composition is an explicit, visible take-control gesture and releasing it is visible too. While the window is in observation mode, no human draft can exist in that PTY, so injection is admissible; while control is taken, injection defers until release **plus** draft evidence under (ii) — release alone does not prove the composer was left empty. (ii) A **named per-profile adapter** that attests the actual draft content and insertion point of that profile's composer and is listed, per profile, in lot L2's report before code; no adapter is assumed to exist today, and a TUI profile without one uses (i) only. (iii) For the already-used primary shell, the required `managed-bash-readline-v1` adapter, its positive principal-prompt proof and its positive handover are specified immediately below this table; L1b depends on that L2 proof, not on observation-only fixtures. An empty PTY input queue, an expired activity timer and UI-readiness detection are never composition evidence (§1.2): input already consumed by readline/the TUI is a draft the host cannot see. Outcomes are typed and never flattened: `deferred-recent-human` (retryable, carries `retryAfterMs`), `refused-facet`, `refused-incarnation`, `refused-no-capability`, `refused-authority`, `preempted-after-paste`, `delivery-uncertain` (proposition vocabulary). New human bytes before commit preempt the request; bytes racing a committed transaction stay ordered and preserved outside the injected block. No request may clear, submit, overwrite or interleave with a human draft — in particular no bare Enter may submit someone else's draft. How far deferral may wait, and whether a human force exists, is OPEN (§6 Q2); the default below never overwrites. | Owner B/C + Analyses (§1.2, §1.3); nominal composition paths pinned by revisions v2/v3 |
| D7 | **Authority is carried to the application point and audited.** Two caller classes only, with **different and explicitly unequal guarantees**: (a) the local owner channel — same-uid processes that can already reach the 0600 host socket (the owner's own CLI/MCP actions, h2a-internal wake/prompt delivery). On this channel, **socket access is the entire authority basis**, exactly as the tmux server socket is today: the host does not and cannot authenticate which same-uid process is calling, so the actor field is declared audit data (recorded as unauthenticated), and **no per-target revocable mandate is claimed or enforced on this channel**. Distinguishing the owner's processes from agent processes running under the same uid is out of scope for this EVOL (§5); what the host does enforce on this channel is safety, not identity: exact incarnation, facet, D6 human-input rules and idempotency. (b) The agent channel — the existing signed drive path (`authorizeDrive` + consent + receiver gate + anti-replay, semantics unchanged) whose final transport becomes `inject`, **composed into a verifiable per-request binding**: authenticated actor, grant/delegation reference, exact target session + incarnation, operation, expiry, idempotency key. The mandate is verified at admission **and re-verified at commit**: revoked, expired, or narrowed between queueing and commit ⇒ zero bytes. A request presented on the agent channel is never downgraded to the owner channel when its authentication fails, and an agent-channel caller cannot self-declare itself "owner" inside the request — channel is determined by the verified credential path that carried the request, not by a field in it. The unsigned local `drive` remains self-wake only: caller instance = target instance is a product rule enforced by the driver on the owner channel, reimplemented on `inject`; it is not presented as a host-verified identity proof. On both channels the host/broker boundary enforces human-input epoch + application state before any byte is written. Stale, revoked, unsupported or ambiguous ⇒ zero bytes. A committed request redelivered under the same idempotency key is never submitted twice. Agent-channel injections stay visible (`[h2a from=…]` / `[h2a-wake …]` lines); owner-channel injections are announced in-band except the launch-time prompt delivery, which keeps its measured composer contract. Every attempt appends one structured audit record via the existing crash-log/journal plumbing (`R/src/crash-log.ts`): time, session, incarnation, actor, channel, kind, byte count, outcome, reason, controller epoch, facet — never payload content (length + envelope/nonce ids or digest only). If durable admission cannot be recorded, the operation fails **before** mutation. A post-write uncertain outcome stays `delivery-uncertain` until reconciled; it is never silently retried under a new identity. Injected units carry the D5 automation writer identity — distinct from the human controller's D21 identity, applied by the same owner through the same ACK/dedup mechanism (D17) — so a frontend swap can neither lose nor duplicate them. What authority a delegation itself grants its parent is OPEN (§6 Q1). | Owner C + Analyses (§1.3) + PTY-B D21 mechanism (§1.9) |
| D8 | **Supervision is read-only by default and lease-free.** The same authority as D7 exposes, for delegated PTYs: `inspect` (perennial instance, conversation, delegator/parent, class, owner/generation/incarnation, installed/loaded versions, CLI facet, views, human-input state, pending requests with defer reasons), `capture` (rendered screen, existing `op capture`/`screen.ts`), `watch`/`tail` (replay `read-output` from a seq cursor with gap indication, built on the protocol's existing observer role), `request-status`/`cancel` for still-pending requests (an applied request is never "cancelled" retroactively). None of these takes the controller lease; all work while a human window is attached. One owner-facing entry point wraps them (proposition: CLI `h2a pty <session> <verb>` and/or MCP tools — name not validated, pinned by lot L2 before code); `op.js` stays an internal binary and is never documented as the product API. `interrupt` and `stop` are distinct operations with distinct rights (D7); interrupting a CLI never kills its host or sibling sessions. Stop authority (`stopIfIncarnation`, takeover, single-controller attach) is unchanged by this EVOL. | Owner C + Analyses (§1.2, §1.3); surface name = Proposition, not validated |
| D9 | **Wake: deposit ≠ wake submission ≠ processing.** `h2a send` success keeps meaning durable deposit only. Wake state is durable across sidecar restarts (a deferred wake survives; pending envelope notifications coalesce; an accepted submission is never duplicated). Driver results distinguish *transport not applicable* from *known target, deferred* — a boolean is insufficient anywhere in the chain, including the cluster-mesh actuator (`H/src/runtime/drive/pty-actuator.ts`), which must preserve the distinction and a verifiable receipt. A deferred native target never falls back to another terminal or to a new headless agent. The wake log/surface shows the typed defer reason (D6) per target. `nativePtyBackchannelDriver` and `driveNativeInstruction` are reimplemented on `inject`; `acquireAutomationControllerIfNoRecentHuman` is retired for injection. | Owner C + Analyses (§1.3) |
| D10 | **Terminal replies never reach the shell.** (a) The attach bridge classifies inbound terminal replies with an incremental, chunk-safe parser (at minimum Primary/Secondary DA, XTVERSION reply, DECRPM `…$y`, CPR `…R`, DECRQSS, kitty-keyboard and OSC colour replies; focus events and bracketed paste are input and stay input). A reply is forwarded only while a matching query is outstanding for the current controller epoch **and** application incarnation, inside a bounded window; otherwise it is swallowed and counted (host fault counter, surfaced in logs). **The bridge's classification is never the final gate:** classified replies travel to the host as typed units carrying their query correlation, controller epoch and application incarnation (protocol/client/server seam, lot L4), and the owner revalidates that correlation atomically in its serialised handler immediately before `pty.write` — a reply the bridge accepted but that is stale by the time it is applied (the asking CLI exited, the shell is now the reader) is swallowed and counted at the host, with zero bytes written. Human keystrokes keep their existing distinct input path, never travel as typed replies, and a machine reply never stamps `lastHumanActivityAt`. (b) Historical replay never reissues terminal queries: query sequences are stripped from repainted history, or repaint uses rendered screen state; live output is untouched. (c) At the wrapper CLI→shell transition, after the existing mode reset, late replies are drained for a bounded grace window; human keystrokes in the same window are preserved in order (on ambiguity, preserve human input and count the event). (d) Exactly one documented responder per supported query family (the host stays responder for the cursor queries it intercepts; the duplicate outer CPR falls under (a)). (e) Live TUI queries/replies, human text, bracketed paste, Unicode and normal key sequences keep their semantics — acceptance runs against a real responding terminal (VTE) in the qualification harness lot L4 creates for this purpose (the current double-`node-pty` functional harness produces no terminal replies at all and can never qualify D10 on its own), not only a byte fixture (lot L4). | Owner A.3 + Analyses (§1.4) |
| D11 | **Hint lifecycle: CLI exit ≠ PTY exit.** (a) On CLI exit inside a live PTY, the wrapper prints the exit line plus the in-PTY resume for this profile and conversation (from the same resume-args source restore uses; plain profile command when no conversation id is known). The words `h2a run` never appear inside a live managed PTY. (b) The `h2a run … --name … -r …` recreation line is printed by the survivor (attach bridge on observed session exit, or the launching parent in attached mode) in the outer terminal, after raw mode/modes are restored, preserving resolved conversation, workspace and applicable launch options with correct argument quoting. (c) Detach (Ctrl-\) prints the attach command; unproven transport loss prints neither recreation nor "session ended". (d) `h2a run` for the same managed name executed inside its own PTY fails with a message naming the in-PTY action from (a), not a bare "already exists". | Owner B ("deuxieme ctrl d") + Analyses (§1.2) |
| D12 | **Secondaries are excluded by provenance, on every restore path.** (a) Registry sessions gain an explicit restore facet set at launch — proposition: `restoreClass:"primary"\|"secondary"` on the registry row, independent of `sessionClass` (`human\|background`). Any delegation provenance (`delegationOrigin`, `delegatorInstance`, `delegatorTmuxSession`, `parent`, `role:"job"`) makes a session `secondary` by construction; enrollment rejects `primary` combined with any delegation field. Explicit run flags (proposition: `--secondary`/`--primary`) make the facet explicit; `--primary` with delegation provenance is refused. Provenance is preserved across resume and hook enrollment and is never erased by a later event. (b) The default restore gate admits only positively-classified primaries (`primary` + human-facing). Legacy rows without the facet are classified **once** by evidence and persisted (same pattern as reconciled convIds): any delegation field ⇒ `secondary`; `role:"job"`/`background` ⇒ excluded as today; transcript/legacy evidence may prove a conversation exists but never proves `primary` and never erases provenance. Unclassified legacy rows are listed separately, never silently promoted. No exclusion by name suffix, age, model or worktree path alone. (c) The remote restore path applies the same gate (remote rows carry the facet, or are unclassified until they do). Sidecar companions (`<name>.h2a`) are never restore tabs and never listed as instances on any surface. (d) An explicit opt-in (proposition: `h2a restore --include-secondary`) lists and restores secondaries; `--dry-run` always names the excluded secondaries. Whether interrupted secondaries should be resumable at all is OPEN (§6 Q4); the default below is exclude + opt-in. | Owner A.4 + Analyses (§1.5); field/flag names = Proposition, not validated |
| D13 | **Dedicated, configurable restore groups (request D) — extend `LayoutGroup`, hardcode nothing.** (a) A group matches sessions by any of (proposition field set, pinned by lot LG before code): exact `projects` (existing, unchanged semantics), `cwdPrefixes` (absolute workspace roots; a session matches when its cwd equals or is below a root), `projectPrefixes` (segment-aware prefix of the `projectForCwd` key), and `labels` (exact session labels). A session whose cwd is outside every built-in scan root can still be discovered for restore when a configured `cwdPrefixes` root covers it — discovery roots become defaults + configured roots, never a hardcoded list. (b) **Partition, exactly once:** groups are evaluated in config order, first match wins; a session (and its project slots) is placed in at most one window; listing the same project/prefix in two groups never duplicates a tab. (c) **No silent loss:** overflow beyond `maxPerWindow` in an explicit group counts into the same accounted `dropped`/deferred reporting as the shared pool, named per group in the plan; a configured group matching zero sessions is reported as empty (current sessions only — it is not an error, and restore of other groups proceeds). (d) **Remote groups select, not duplicate:** a `remote:true` group may carry the same matchers applied to remote tabs (by label/cwd); unmatched remote tabs fall to the remaining remote groups in order, then are reported unmatched — the same remote session never appears in two windows. A remote group without matchers keeps today's behaviour for the first such group only (compat), stated in the plan. (e) **Validated config:** `getLayoutConfig` validates group shape (non-empty string title, matcher types, no duplicate titles after slug normalisation) and fails the restore command with a named, localised config error **before** anything launches; invalid entries are never silently dropped or passed through. (f) **Pre-flight account:** the plan output (always in `--dry-run`, and as the ledger header in a real run) states per group: title, matched sessions, and for the run as a whole: sessions matched by no group (shared pool, named), empty groups (named), drops by cap (named per group). (g) Nothing about any specific family (name, root path, title) is hardcoded in code or defaults; `DEFAULT_LAYOUT.groups` stays `[]`. The owner's own dedicated group (for example for Airbus workspaces) is **user config data**, written through the existing layout config field — lot LG ships the mechanism, validation, docs example with placeholder names, and tests; it does not write the owner's real config (§5). Existing configs using only `projects`/`remote` keep working unchanged (compat RED tests in lot LG). Shared-window fallback titles come from the D14 locale catalog, never a hardcoded language. | Owner D + standing rule (nothing hardcoded) + Code (§1.7); matcher field names = Proposition, not validated |
| D14 | **Human-first, localised output; JSON only with `--json`.** (a) `h2a upgrade`, `h2a upgrade --check` and `h2a restore` write human-readable output by default when stdout is a TTY: one status line per component/session, then at most one next-action line. No raw or nested JSON ever appears in human mode. `--json` selects the machine contract explicitly, with structured objects — never a child process's stdout embedded as a string field. (b) All human strings on these paths (including today's hardcoded restore/launch strings and help on the touched commands) come from a single locale catalog. The catalog is a cross-package deliverable of lot **L6a**, landed before its first consumers: module + per-language data files live in the runtime package (which owns most touched strings), exposed as a public subpath export (following the existing `./status` precedent); the `h2a` package consumes it through its established lazy dynamic-load seam for the peer runtime package — strings are never copied between packages, and no package gains a hard dependency it does not have today (lot L6a pins file names, the export and the loader seam). Locale resolution, in order (proposition): `H2A_LANG`, then `LC_ALL`/`LC_MESSAGES`/`LANG`, then the default locale; matching is by BCP-47-style primary tag with a defined fallback chain to the default catalog language. **Any language** can be added as catalog data without code changes; shipping catalogs at minimum: the default (English) and French, complete for the touched surfaces. Machine values (outcome codes, versions, ids) are never localised. Mixed-language output within one run is a defect. (c) Embedded sub-reports are summarised, never inlined: host convergence returns per-host `{host, ok, changed, findings}` counts; the full payload goes to the diagnostics file, referenced by path. (d) `already-current` and `registry-unreachable` are distinct outcomes with distinct next actions; an outcome string never joins two causes with "or". A failed host repair makes the upgrade outcome visibly partial. (e) An upgrade with no version change performs no host convergence unless explicitly requested (`--repair`/existing `--host`); it reports already-current in one line, plus the resident-PTY line from D15. (f) Non-TTY stdout without `--json`: proposition — keep the current JSON for one deprecation cycle, announced in `--help`. The TTY→human default flip in (a) **takes effect with lot L6**: §6 Q5 stays open only to identify a possible PTY-parsing consumer and adjust its transition; it is not a prior veto on L6's delivery (revision v2). Dates/numbers in human lines use locale-aware formatting where the runtime provides it; no date format is hardcoded. | Owner A.1 + standing rule (user's language, nothing hardcoded) + Analyses (§1.6) |
| D15 | **Upgrade treats the resident PTY host in order — by reusing PR #375, once.** This EVOL builds no second upgrade implementation. (a) Both existing paths (manual `cmdUpgrade` and the boot auto-upgrade worker, one `performAutoUpgrade`) report per PTY component `installed / loaded / switched / deferred` in human and JSON modes, using #375's fleet inventory, frontend swap, retention/pins (PTY-B D28) and deferral reporting. (b) Phase-B hosts: frontend swap only, owner never signalled (PTY-B D4). Pre-B fused hosts: never killed/migrated under live sessions; reported `admission: unfenced`, `retirement: deferred` exactly as the ratified #375 amendment states; their installs stay retained while referenced. **This holds even when a pre-B host is observed holding zero sessions:** an inventory reading of zero does not close its admission (a v1 client can create a session between the probe and any signal, then lose it), so for a non-cooperating pre-B host the upgrade never signals it and never withdraws its endpoint, at any observed session count — revision v2 removes the earlier "empty host" exception, which contradicted the ratified amendment (`PR375:BRANCH.md`, `legacyPtyUpgradeResult`). Automatic stop/replace inside an upgrade is reserved to a **cooperating Phase-B owner** through #375's existing atomic abandon operation, which seals admission in the same synchronous turn as the empty decision (`owner-process` control `abandon`); only for that case does the order apply: verify staged install → atomic abandon-if-empty → start new host → verify handshake, each step reported. No other empty-host retirement mechanism is introduced by this EVOL. (c) No upgrade (manual or boot-quiet) finishes as success while a component is `deferred` without naming it. (d) Until the pre-B cohort drains, `h2a doctor` shows the stale host (age, session count, exact safe next action) and restore's D2 blocker line points to it. (e) Installing a package is never reported as having restarted an owner. What "a session to preserve" includes (CLI+conversation vs also shell/scrollback) is OPEN (§6 Q3) and bounds any future shells-only host-restart offer: such a restart is never automatic under this EVOL. | Owner A.2 (skew) + PTY-B D2/D4/D5/D14/D28 + #375 amendment |
| D16 | **Test-state isolation by construction (lot L0, first).** (a) The package test setups install, **before any test-module code is evaluated**, one per-worker `mkdtemp` environment (`HOME`, `XDG_STATE_HOME`, `XDG_CONFIG_HOME`, `XDG_RUNTIME_DIR`, `TMPDIR`, `REMOTE_CLI_CONFIG_HOME`, `H2A_ROOT`/socket/log/registry roots as applicable) reusing `H/test/helpers/native-isolation.js` builders; provider configs and fixture shells are isolated too. The before-import mechanism is named, not deferred: for Vitest, the setup file (`R/vitest.native-isolation.mjs`, both configs) establishes the roots; for Node `--test`, the **existing preload module** `packages/h2a/test/helpers/native-isolation.js` (already the self-propagating Node preload, §1.8) is extended so that importing it establishes the roots immediately, and the complete authorised Node command, from the repository root, is `node scripts/test-sandbox.mjs -- node --import ./packages/h2a/test/helpers/native-isolation.js --test <file>` (the `./` resolves the preload as a file, not a package). The runtime counterpart is `node scripts/test-sandbox.mjs -- npx vitest run <file>`. The launcher establishes the OS barrier before starting either runner. The setup/preload checks an inherited confinement attestation tied to the actual sandbox and its allowed root, not merely an environment flag, and refuses an unconfined invocation before evaluating any test/product module; it may not fall back to environment-only isolation. Barrier unavailable ⇒ non-zero, qualification-incomplete, no test/child started. Bare `node --test` is forbidden in authorised lot/CI recipes (§4); intercepting a command that omits the setup/preload altogether is not claimed. Every default-path writer in scope resolves at call time; any writer caching a resolved path at module load is fixed to resolve at call time. A suite may narrow further but can no longer run on owner paths by omission: a global assertion **fails** the suite if its environment still points at owner state (a test that silently depends on, or skips because of, real state is FAILED, never green). (b) Defence in depth, in two named layers. **Mutation-point layer:** under the qualification-root marker, every inventoried writer (bounded inventory in lot L0: crash logs, host journal, registry, layout-last, config, resume-launch claims) validates the **effective destination at the mutation point** — including caller-supplied explicit paths such as `appendCrashLog`'s `logPath` (§1.8), validated before any directory creation, lock or write — following effective paths/symlinks, not string prefixes; outside the marker root ⇒ named error, zero bytes written, even if the caller swallows the error. No such check applies outside the marked test environment. **Filesystem-barrier layer:** authorised qualification commands run the whole test process tree inside an OS filesystem barrier in which only the launcher's private run root, containing the worker roots, is writable and the workspace is read-only — Linux: a private mount namespace (bubblewrap-class; the temp root bound over `HOME`/XDG dirs, no owner path bound writable); macOS: a `sandbox-exec`-class profile denying writes outside the root (launcher `scripts/test-sandbox.mjs`; tool availability and active confinement verified before a runner starts). This barrier is what confines non-Node/native descendants writing to absolute paths or through symlinks without consulting any h2a resolver; the isolated environment and the spawn guard never provided that property and are no longer claimed to. Where no barrier is available on a platform, that platform's L0 qualification is reported **incomplete**, never green on the remaining layers. Lot L0 states precisely which layers it proves per platform; Node monkey-patching alone is never claimed as "never". (c) Unit tests get an injected log sink where practical, while some tests keep exercising the real writers under the private root. (d) Node suites (`H/test/*.test.js`) get the same contract through the complete sandbox + preload command in (a) and the gate runners that invoke it; §4 L0 enumerates the direct CI commands and their exact-command contract tests. Test reports/fixture builds use the private writable root, with existing execution-evidence checks preserved. (e) Proof uses a **fake** protected owner fixture inside the temp tree but **outside the allowed root** (never the real HOME): the two historical leakers (`sess-livelock`, `h2a-alpha`) plus exception/reconnect endings, an explicit writer path aimed at the fixture, an outgoing symlink from inside the root, and an absolute-path write by a non-Node child all write only under the private root or are refused before effect, and the fixture is byte-identical afterwards — even when production code swallows the logging error. Cleanup kills only fixture-spawned PIDs (birth-checked); never by name, never a discovered socket. The real `attach.log` is not cleaned, purged or read by this lot. | Analyses D/G + Code (§1.8); layers pinned by revision v2; executable envelopes and CI contracts pinned by revision v3 |
| D17 | **Reuse boundary with PR #375 is normative.** Injected writes, resume-in-place writes and wake submissions carry the D5 **automation writer identity and its own frontier** — because the D21 identity is controller-bound (§1.9), it cannot be carried by a lease-less injector; reuse means the D21 ACK/dedup *mechanism* applied by the same owner to the automation frontier, via the `owner-protocol`/`host` extension named in lot L2. That mapping is defined in this specification (D5) and proved in lot L2 **on the #375 (B3) base before lot L3 starts**; lot L7 only re-qualifies the integrated whole and never designs the seam. The human controller's D21 frontier keeps its exact behaviour across frontend swaps, untouched by automation writes. This EVOL's host changes are additive, capability-negotiated extensions of protocol v1 (PTY-B D16 style): an unknown/mismatched capability fails closed with a typed outcome and never silently downgrades a claim (on a non-capable host, `inject` does not exist — callers get `refused-no-capability` and restore falls back to attach/skip reporting, never to lease-stealing writes). No lot in this EVOL implements frontend swap, retention, fleet inventory, keeper succession, batch transfer (PTY-B Phase L) or a second standing owner (PTY-B O1). If a lot here needs a #375 file, the change is the minimal seam named in lot L7, landed on top of #375 — never a parallel copy. B5 qualification (PTY-B: non-empty real CLI cohort per platform, `skipped:0` per platform file set) remains #375's gate; this EVOL neither claims it nor relaxes it. | PTY-B D1/D14/D16/D21 + Analyses (§1.9) |
| D18 | **Every fail-closed stays, and becomes legible.** The existing refusals (unreadable registry ⇒ no launch, dual-host ambiguous ⇒ no act, unknown native view ⇒ no launch, single-controller attach, incarnation fences) are preserved verbatim in effect. What changes is only that each refusal is named once, per session, with its remedy, in the D2 ledger / D14 human output — and that the new `shell`-facet and broker paths give restore a safe positive action where today only refusal exists. No lot may weaken a proof, a fence or a refusal to make a RED test pass. | Code (§1) + Analyses |

**D6(iii) — Managed primary-shell handover (proposition, not owner
decision; required L2 delivery before L1b).** The named adapter is
`managed-bash-readline-v1`, implemented in
`packages/h2a-runtime/src/native-terminal/managed-shell.ts` (new) and
installed by the native branch of `LOCAL_WRAPPER` in `tmux.ts`, with
launch plumbing in `native-host.ts`. It extends the existing prompt
hook/reset-relay seam; the reset marker alone never certifies a draft.
The managed Bash integration supplies a readline-state callback that
attests the **actual** `READLINE_LINE` and `READLINE_POINT` at a
readline safe point, without clearing, accepting or submitting the
line. The host receives only empty/non-empty and insertion-point
evidence, never draft contents in output or audit. The integration
protocol and hook/binding names are pinned in L2's report before code;
a prompt-only hook or a fixture that substitutes an empty buffer does
not implement this adapter.

**An empty readline line is not, alone, an empty draft.** The Bash
parser may already hold an unfinished human command while the current
physical readline line is empty: after `printf '%s\n' 'draft` and
Enter, Bash waits at its secondary prompt for the closing quote, a
`bind -x` callback attests `READLINE_LINE` empty at point 0 exactly as
at the principal prompt, and any resume text written then is
incorporated into the human argument instead of being executed (the
same exposure covers unclosed compound constructs, here-documents and
nested reads). The attestation therefore additionally requires a
**principal-prompt proof**: fresh, positive evidence, produced by the
managed shell's own prompt/parser cycle, that the shell is reading a
**new** command at its principal prompt, with no continuation,
here-document or nested read in progress and no command executing.
The proof is minted only in a principal-prompt cycle, is bound to the
same challenge, prompt generation and controller frontier as the
readline attestation, and is **invalidated as soon as a line is
accepted**; it stays invalid through any continuation, here-document,
nested read and command execution, until a later principal-prompt
cycle mints a new proof and a fresh callback attests within that same
reading. A callback invoked while the parser is not at that state —
secondary prompt included — must report non-principal or produce no
attestation, even when the current line is empty. Neither the
displayed prompt text (principal or secondary), the reset marker,
`READLINE_LINE` alone, an empty input queue nor an expired timer may
be promoted to this proof, and the host may never infer it from
observed output: if the managed hooks that mint/invalidate it are
absent, altered or unverifiable, there is no attestation. The exact
Bash mechanism is pinned in L2's report before code and must be
demonstrated on real Bash to separate a principal reading from a
secondary one; if it cannot, the adapter is unqualified and L1b
defers (typed) instead of claiming in-place resume.

The positive transition is: reserve the exact shell/application
incarnation and prompt generation; gate human input at both the attach
bridge and owner, keeping newly arriving keystrokes buffered in order;
buffering also reports input activity to the owner on the ordered
control path and never counts as proof that no human input exists;
drain/acknowledge every previously accepted human chunk through the
controller's D21 frontier **and** obtain the shell adapter's fresh
readline attestation, **with its principal-prompt proof**, **after
those bytes were consumed**, bound to a one-use challenge, that
frontier and prompt generation; then commit the structured resume
under D3's conversation claim and D5's owner transaction,
revalidating both halves of the attestation in the same serialised
decision as the write. ACK of `pty.write` alone proves application,
not readline consumption; the shell callback must close that gap.
Pending/reconnecting attach input without a completed drain cannot
yield an attestation. A non-empty readline line, unknown point, a
missing, stale or invalidated principal-prompt proof (continuation,
here-document, nested read or executing command included), stale
challenge/prompt/frontier, changed foreground or human input received
before commit invalidates the reservation: zero resume/paste/submit
bytes, no Enter or Ctrl-U, and all human bytes/draft preserved. Input
racing a committed transaction follows D5's preemption rules. The gate
does not revoke or replace the human lease; it releases buffered input
in order on completion or deferral.

This qualifies the primary that has **already received human typing**,
whose CLI then exits into its empty managed shell; no observation flip,
control release, idle timeout, reset marker or empty kernel queue may
substitute for the attestation. A consumed readline draft — or an
unfinished multiline command whose current line is empty at the
secondary prompt — in that same scenario must instead defer untouched. An old/unmanaged shell or a
missing adapter reports typed deferral, never a claimed successful
L1b restoration. Delegated observation and per-profile TUI adapters
remain D6(i)/(ii); §6 Q1–Q5 remain OPEN.

Explicitly rejected (from the analyses, verified in code): removing the
`record.controllerId !== null` check, a `--force` injection, a Ctrl-U
clear, or a takeover that detaches the human window, as implementations
of D5/D6; deriving the CLI facet from CPU/silence/title heuristics;
excluding secondaries by name pattern; killing the resident host during
upgrade to "fix" skew; presenting PR #375 as the fix for A.1–A.5/B/C/D;
mocking the crash log everywhere as the L0 fix (it would delete the
confinement proof for every other writer).

## 3. Target behaviour, per owner bug

Normative summary; §2 decisions govern in case of divergence.

| Bug | Target behaviour (acceptance shape) | Decisions / lots |
|---|---|---|
| A.1 upgrade JSON wall | TTY: a few status lines in the user's language, e.g. already-current in one line + resident-PTY line + next action; zero `{`, zero `sha256`, zero absolute command lines. `--json`: structured objects, no embedded stdout strings. Registry-unreachable reads as "check impossible", never as already-current. Partial host repair is a partial outcome. | D14, D15 / L6, L7 |
| A.2 restore does not restart | Decision table D1+D3 per session; CLI resumed in its open PTY and verified; per-session ledger D2; stale host named once with the D15 remedy. A restore that opens windows onto empty shells and calls them relaunched is a failing restore. | D1–D4 / L1 (+L2 transport) |
| A.3 replies in the shell | Owner's capture replayed as a test: a TUI emitting DA + DECRQM 2026/1016 + XTVERSION then exiting at once leaves the next shell input line empty; reattach repaint draws no new replies; live TUI input unaffected. | D10 / L4 |
| A.4 secondaries restored | Default restore = primaries only; a delegated review with a visible terminal and a valid transcript is excluded and named as excluded in `--dry-run`; `--include-secondary` is the only way back in. | D12 / L5 |
| A.5 two `i-cond` | One tab/one writer per physical session on restore, `ls` and presence views; live native conversation owner refused as second writer even without a registry pid; conflicts shown as conflicts, never auto-killed. Closing the observed occurrence additionally needs its identity evidence (§1.5). | D4 / L1 |
| B no PTY write + hint | Owner/conductor write/paste/submit works with the window attached (D5/D6), audited (D7); `h2a relaunch` sweep resumes native shell-state sessions in place; hint per D11 — profile resume at CLI exit, `h2a run …` only after the PTY ends (second Ctrl-D), `h2a attach …` on detach. | D5–D8, D11 / L2, L4, L1 |
| C supervision + send | `inspect/capture/watch` + authorised injection on delegated PTYs with the window open; send→inbox→wake lands with the target window attached, deferred only by real human typing, with typed reasons and separate deposit/wake/processing receipts. | D5–D9 / L2, L3 |
| D no dedicated group | Configured groups partition sessions exactly once by project/cwd-prefix/label matchers; the plan names placements, unmatched sessions, empty groups and cap drops before anything opens; the owner's dedicated group is their config data, creatable without code. | D13 / LG |
| Upgrade skew (brief fact) | Installed vs loaded versions per component; Phase-B frontend swapped, owner untouched; pre-B explicitly `unfenced/deferred` **even if observed empty** (never signalled, endpoint never withdrawn by an upgrade); only a cooperating owner is retired, via #375's atomic abandon-if-empty; no silent success. All mechanics from #375. | D15, D17 / L7 |

## 4. Lots

Rules for **every** lot (not repeated per lot):

- **RED first.** The lot's named tests are written and run before the
  implementation, on the lot's base; the red output (failing for the
  stated reason) is kept as evidence in the lot report. A test that
  skips because real state is absent counts as FAILED. Tests already
  green today are never relabelled RED; REDs target the exact holes in
  §1. Concurrency claims are tested with two isolated processes, not
  two calls on one object. Byte claims need byte receivers; submission
  claims need the real attach path and, where the lot says so, real
  CLIs in an isolated HOME.
- **Targeted tests only**, from the **repository root**, after the build
  the lot names; these are the two complete authorised command forms:

  ```sh
  node scripts/test-sandbox.mjs -- npx vitest run <file>
  node scripts/test-sandbox.mjs -- node --import ./packages/h2a/test/helpers/native-isolation.js --test <file>
  ```

  The launcher creates/verifies D16's filesystem barrier for the whole
  process tree **before** starting the runner; the Vitest setup / Node
  preload then verifies that confinement before any test or product
  module is evaluated and establishes the worker roots. A direct
  Vitest invocation or a Node invocation with this preload but without
  the barrier refuses before the test body or its child runs; neither
  an environment marker alone nor the preload supplies the barrier.
  Missing barrier support means qualification-incomplete with a
  non-zero result, never an unconfined retry. Bare `node --test` is
  forbidden in lot/CI commands; no claim is made that a preload can
  intercept an arbitrary command that omits it altogether. The full
  suite is the conductor's, at integration, through the same envelope.
- **Isolation**: lot L0 lands first; every later lot's tests run under
  its per-worker temp roots and verified filesystem barrier. Until L0
  is available on a lot's base, its dynamic proofs are incomplete;
  importing the existing helper alone does not qualify them. Never the
  installed `h2a` binary/dist, never owner config/state/runtime dirs,
  never a process the test did not
  spawn. Stop only spawned, birth-checked PIDs; no `pkill -f`, no
  `killall`. Zero Python anywhere (owner rule).
- **Closed file lists.** A lot may create/modify only its allow-list.
  "Proposition name" files are fixed here so lists stay closed; a rename
  or a missing file needs a spec amendment **before** code. Scope proof
  = `git status --porcelain` **and** `git diff --stat` on the lot
  branch; anything outside the list fails the gate.
- **Build gate**: every touched package builds with zero new type
  errors (`npm run build`, i.e. `tsc -b`, in the touched package);
  "pre-existing" only if the identical error appears on the untouched
  base with the same command.
- **Green claim** = command + quoted output with pass/fail/skipped
  counts and exit code, per platform where the lot names platforms.
  `skipped > 0` inside a named platform file set = gate failed
  (PTY-B D27 rule, adopted here).
- Commits, branches, PR mechanics and version numbers are the
  conductor's; this spec assigns none. Each lot is single-writer and is
  handed over with proofs, limits and its acceptance check (§4, per lot).
- **First-RC target** (owner pain order, §0.3): **L0, L6a, L1a, L5, L6,
  the D11 hint fix (in L4), and LG**. L1b joins that RC **only if** L2's
  broker core **and managed-primary-shell path (D6(iii))** are green in
  time; otherwise the RC must not claim in-place resume (D2 makes the
  shortfall visible per session instead
  of hiding it). L2, L3, the D10 half of L4, and L7 follow in that
  order. No RC text may present PR #375 as qualified before its B5
  gate (L7).

Lot dependency order: `L0 → L6a → L1a → {L5, L6, LG, L4-hint} → L2 →
L1b → L3 → L4-replies → L7`. (L6a is the locale-catalog prerequisite of
every lot that prints new human strings — L1a, LG, L4-hint, L6; no lot
introduces temporary hardcoded strings while waiting for it. L5, L6, LG
and the hint are mutually independent once L0+L6a+L1a's shared surfaces
settle; the conductor may sequence them. L2's D21-seam proofs run on
the #375 base before L3 starts, per D17.)

### Lot L0 — Test-state isolation by construction (D16) — first, blocks all proofs

Purpose: no test can write to the owner's real state again, in-process
or via children, on any runner (targeted, package, CI).

RED tests first (new `packages/h2a-runtime/src/test-state-isolation.test.ts`,
proposition name; plus the two historical suites run under the new setup):

- `it('should isolate direct attach crash logging before importing the runtime')`
- `it('should write sess-livelock crash rows only under the isolated state root')`
  (red today against a fake sentinel HOME — never the real one)
- `it('should keep the first op.test describe off the ambient attach.log')`
- `it('should run a suite with no explicit isolation on the worker temp environment')`
  (via the complete sandboxed Node command in the preamble, with
  `--import ./packages/h2a/test/helpers/native-isolation.js`; the suite
  under test imports and reaches a production writer immediately and
  calls no isolation helper itself — a resolution/import failure is
  not the behavioural RED)
- `it('should refuse an unconfined direct Node or Vitest run before evaluating its test module')`
  (invoke each preamble command's inner runner without the launcher,
  retaining the Node preload / Vitest setup; fixture module-evaluation,
  writer and non-Node-child sentinels all stay untouched; the confined
  positive control reaches them only inside the private root)
- `it('should report unavailable confinement without starting a test or falling back')`
- `it('should preserve the independent CI and release trust root under the exact safe command')`
  (workflow/runner contract checks below; trust root still precedes
  `npm test`, is not discovered by the runner it verifies, and retains
  its existing execution-evidence requirements)
- `it('should refuse an in-process write outside the test state root')`
  (per inventoried writer, at its mutation point: crash logs, journal,
  registry, layout-last, config, resume-launch claims)
- `it('should refuse an explicit writer path outside the test state root before creating anything')`
  (`appendCrashLog` `logPath` aimed at the fake owner fixture: no
  directory, no lock, no file appears — even though the error is
  swallowed by the caller)
- `it('should refuse a write through a symlink leaving the test state root')`
- `it('should refuse an absolute-path write by a non-Node child process')`
  (fixture shell/binary child under the authorised command + barrier;
  fixture byte-identical afterwards)
- `it('should preserve the protected owner fixture across worker and child failures')`
- `it('should fail a suite whose environment still points at owner state')`

Allowed files:

- `packages/h2a-runtime/vitest.native-isolation.mjs`
- `packages/h2a-runtime/vitest.config.ts`
- `vitest.config.mjs` (repo root, same setup only)
- `packages/h2a/test/helpers/native-isolation.js` (extension only; note
  PTY-B B5 treats this helper as read-only **for that lot** — coordinate
  landing order with #375, §4 L7; if #375 is mid-flight, the conductor
  sequences L0 before/after its rebase, never as a silent edit inside #375)
- `packages/h2a-runtime/src/attach-reconnect-livelock.test.ts`
- `packages/h2a-runtime/src/native-terminal/op.test.ts`
- `packages/h2a-runtime/src/test-state-isolation.test.ts` (new)
- `packages/h2a-runtime/src/test-state-guard.ts` (new, proposition name —
  the single mutation-point guard seam used under the marker root;
  inert outside the marked test environment)
- the filesystem-barrier launcher `scripts/test-sandbox.mjs` (new,
  proposition name; wraps an authorised test command in the D16
  barrier before any runner starts; no unavailable-barrier fallback),
  `scripts/run-test-gates.mjs` and `scripts/run-tests.mjs` (command
  envelopes, inherited barrier verification and report destinations
  under the private root only; preserve discovery and execution proofs)
- `.github/workflows/ci.yml`, `.github/workflows/codex-drift.yml`,
  `.github/workflows/release.yml`, `.github/workflows/focus-dossier.yml`
  (only the test commands inventoried in §1.8: wrap every direct Node
  test with the launcher + resolved preload, and every direct Vitest
  test with the launcher, preserving filters and selected files)
- `packages/h2a/test/release-workflow.test.js` and
  `packages/h2a/test/run-test-gates.test.js` (only the exact command,
  safe-envelope and report-path assertions affected by that rewiring;
  retain the independent job, trust-root-before-`npm test` ordering,
  unconditional gates, runner-test exclusion from discovery and all
  existing execution-evidence checks)
- **bounded writer inventory, fixed now** (each: call-time resolution +
  mutation-point guard only, no behaviour change outside the marked
  test environment):
  - `packages/h2a-runtime/src/crash-log.ts` (`resolveCrashLogPath`,
    `appendCrashLog` including the explicit `logPath` argument)
  - `packages/h2a-runtime/src/config.ts` (`resolveConfigPath` and its writers)
  - `packages/h2a-runtime/src/registry.ts` (`resolveRegistryPath` and its writers)
  - `packages/h2a-runtime/src/restore.ts` (`writeLastLayout` / layout-last path)
  - `packages/h2a-runtime/src/relaunch.ts` (`resolveResumeLaunchClaimRoot` claim files)
  - `packages/h2a-runtime/src/native-terminal/journal.ts` (`resolveHostJournalPath`)

  Any further writer discovered while landing the inventory is appended
  to this list by amendment **before** code, with the same guard; the
  inventory itself remains a lot deliverable, but it starts from the
  list above, not from zero.

Forbidden: touching, reading for content, truncating or "cleaning" any
real owner state; mocking `appendCrashLog` in the regression suites as
the fix; weakening `assertNoNativeTestSpawnViolations`; any product
behaviour change outside the marked-test-environment refusal.

Acceptance: both historical suites + new file green with `skipped: 0`
under the two complete authorised commands; the no-helper Node suite
actually reaches its writer after the resolved preload; direct
unconfined runner probes fail before test-module evaluation or child
spawn, and missing-barrier probes never fall back;
sentinel fixture byte-identical after success, exception and reconnect
endings; writer inventory published in the lot report with one
mutation-point refusal test per inventoried writer, plus the
explicit-path, outgoing-symlink and non-Node-child cases; a Node suite
with no explicit helper call is isolated by the sandbox + preload;
the lot report states exactly which layers are proved per platform
(before-import roots, mutation-point guard, filesystem barrier +
barrier tool used) and reports any platform without an available
barrier as qualification-incomplete, never green; a deliberately
un-isolated probe suite fails (negative control, reported, then removed
or kept as the named fixture — lot report states which).

CI/runner qualification is part of L0's named set:
`packages/h2a/test/release-workflow.test.js` and
`packages/h2a/test/run-test-gates.test.js`, each run with the complete
sandboxed Node command above (`skipped: 0`). In CI and release, the
independent trust-root step is exactly, from the repo root:

```sh
node scripts/test-sandbox.mjs -- node --import ./packages/h2a/test/helpers/native-isolation.js --test packages/h2a/test/run-test-gates.test.js
```

It remains outside the gate runner it verifies and before `npm test`;
`npm test` keeps its existing entry point, whose test steps use the
same barrier/preload contract. Update exact-command assertions to
this envelope, including the dedicated CI job, without weakening
selected file sets, unconditionality or evidence checks. Gate/runner
reports produced inside confinement go under its writable temp root
and are read there by the existing verifiers; no report path opens a
writable owner/workspace exception. Contract controls already green
on the base are retained controls; their old-command assertions must
fail against rewired workflows until the corresponding assertions
are updated.

### Lot L6a — Locale catalog foundation, shared across packages (D14b) — prerequisite of L1a/LG/L4-hint/L6

Purpose: land the single locale catalog **before** any lot prints a new
human string, with its cross-package consumption path proved from built
artifacts. No rendering change lands here; L6 owns rendering.

Facts that fix the shape (verified at this base): the runtime package
(`@sentropic/h2a-runtime`) exposes subpath exports (`.`, `./status`);
the `h2a` package holds the runtime as a peer, never a hard dependency,
and already lazy-loads it through string specifiers
(`@sentropic/h2a-runtime/status` in `status-surface.ts`); the runtime
package imports nothing from `h2a`. The catalog therefore lives in the
runtime package and is consumed by `h2a` through that existing lazy
seam — never the other direction, never copied.

RED tests first (new `packages/h2a-runtime/src/human-output.test.ts`,
proposition name; dist-consumption cases in
`packages/h2a/test/human-output-dist.test.js`, new, proposition name):

- `it('should resolve locale by H2A_LANG, then LC_ALL/LC_MESSAGES/LANG, then the default')`
- `it('should fall back to the default catalog for an unknown locale')`
- `it('should have complete identical key sets in every shipped catalog')`
- `it('should load the catalog from the built runtime subpath export')`
- `it('should consume the same catalog from the built h2a package through its lazy loader')`
- `it('should degrade to machine output plus a named diagnostic when the runtime catalog cannot load')`
  (failure fixture only; never a second hardcoded catalog)

Allowed files:

- `packages/h2a-runtime/src/human-output.ts` (new — resolver + lookup API; proposition name, fixed here)
- `packages/h2a-runtime/src/human-output/catalog-en.ts` (new — default catalog data)
- `packages/h2a-runtime/src/human-output/catalog-fr.ts` (new — French catalog data)
- `packages/h2a-runtime/package.json` (add the `./human-output` subpath export only)
- `packages/h2a/src/runtime/human-output-loader.ts` (new — the lazy-load seam, following `status-surface.ts`; proposition name, fixed here)
- `packages/h2a-runtime/src/human-output.test.ts` (new)
- `packages/h2a/test/human-output-dist.test.js` (new)

Catalog data is data modules compiled into `dist` (not per-language
code branches, not runtime file reads); adding a language later is one
more data module and one export-table line, no code change. The
initial key set is exactly the keys L1a/LG/L4-hint/L6 need; those lots
add keys to these data files as part of their own allow-lists.

Forbidden: copying any catalog string into the other package; importing
the neighbouring package's sources across `rootDir`; a hard
`h2a → h2a-runtime` dependency; rendering/output changes (L6);
temporary hardcoded strings in consumer lots.

Acceptance: both packages build separately with zero new type errors;
the catalog is imported from the built `dist` of both packages (not
from sources) in the dist test; key-completeness and fallback tests
green with `skipped: 0`; consumer lots (L1a, LG, L4-hint, L6) can name
their exact import path in their reports without amending this lot.

### Lot L1 — Restore really resumes: facet, in-place resume, exact ledger, no duplicate (D1–D4)

Split for the RC: **L1a** = facet + guard + dedup + ledger (no broker
dependency; in-place candidates are reported `deferred:needs-inject`
until L1b). **L1b** = in-place resume activation on L2's `inject` **and
qualified managed-primary-shell adapter (D6(iii))**. Both
halves are one lot for acceptance; the RC rule is in §4 preamble.

RED tests first:

- `it('should refuse a live native conversation owner even when its registry pid is absent')`
  (`packages/h2a-runtime/src/conv-guard.test.ts`, `conv-guard-wiring.test.ts`)
- `it('should not count an attached persistent shell as a resumed CLI')`
- `it('should emit one attach action for duplicate unresolved rows of the same terminal')`
- `it('should report one ledger line per session and exit non-zero when sessions needing resume are all blocked')`
  (stub host without `controlled`/facet ⇒ one named stale-host blocker, not N UNKNOWN lines)
- `it('should report one observed already-active ledger outcome per active primary and recompute its totals')`
  (RED: the facet-based observations and exact ledger are absent today;
  exit 0 alone is a retained control below)
- `it('should exit zero with an empty ledger when there are no candidates')`
- `it('should exit zero for a valid dry-run while reporting its blockers as plan data')`
- `it('should expose a shell facet only from host-side foreground evidence and unknown on an old host')`
- `it('should report the cli facet, the application incarnation and an already-active outcome for a foreground CLI session')`
  (L1b — the observation absent today; the separate no-injection
  assertions for this case are a retained control, below)
- `it('should resume a previously human-used primary in its same attached PTY exactly once after CLI exit to an attested empty managed shell')`
  (L1b: real Bash/readline + L2's D6(iii) adapter, prior human typing
  proved, fresh handover/drain attestation; not an observation-only
  delegated fixture)
- `it('should inject no resume bytes when that primary shell holds a human draft already consumed by readline')`
  (same history and attached window; draft still present after >4 s,
  kernel input queue empty; no command/paste/Enter/Ctrl-U, draft intact)
- `it('should inject no resume bytes while that primary shell waits at a secondary prompt on an unfinished multiline command whose current readline line is empty')`
  (L1b: same history; the human has entered `printf '%s\n' 'draft`
  and Enter, so Bash waits for the closing quote with the current
  line empty; after consumption and expiry of the idle window, zero
  resume/command/paste/Enter/Ctrl-U bytes, and when the human closes
  the quote the original command runs whole, with no resume text
  incorporated into it; the attested-empty principal-prompt success
  case above is retained unchanged)
- `it('should start at most one CLI when two processes resume the same PTY under distinct request keys')` (L1b — D3 claim)
- `it('should start at most one CLI when two shell PTYs and a run --resume race the same conversation')` (L1b — D3 claim + guard; exactly one in the unambiguous case, typed refusal and zero starts when the target is ambiguous)
- `it('should inject no resume command while another CLI already writes the same conversation')` (L1b)
- `it('should defer in-place resume over an unsent human draft without altering it')` (L1b)
- `it('should refuse an unknown foreground application instead of typing a resume command')` (L1b)
- `it('should cover native shell-state sessions in the relaunch sweep')` (L1b)

in `packages/h2a-runtime/src/restore-live-recovery.test.ts`,
`restore-launch.test.ts`, `restore-wiring.test.ts`,
`native-terminal/host.test.ts`, `conv-guard*.test.ts`, and
`packages/h2a/test/runtime-restore-native.test.js` where that file
exists (lot report confirms the exact set before code).

**Retained controls, not REDs:** all-primary-already-active ⇒ exit 0
already holds on the base (controlled PTYs are skipped without setting
an error). Keep that assertion for the idempotent second restore;
its RED targets the missing observed `already-active` ledger and totals,
not the exit code alone. "Attach but never inject when the CLI
is foreground" already holds today (a live uncontrolled native session
produces exactly one attach and no injection exists to withhold). It
stays as a named non-regression control; the RED for that case is the
facet/incarnation/ledger observation above. A missing symbol or fixture
error is never presented as the behavioural reproduction.

Allowed files:

- `packages/h2a-runtime/src/native-terminal/host.ts` (foreground facet in snapshot/state only)
- `packages/h2a-runtime/src/native-terminal/protocol.ts` (additive facet field only)
- `packages/h2a-runtime/src/native-host.ts` (facet typing; L1b resume transport call)
- `packages/h2a-runtime/src/restore.ts` (`captureHostViewSnapshot`, plan, ledger, shared join export)
- `packages/h2a-runtime/src/launch-layout.ts` (`HostViewSnapshot` facet, in-place decision, per-tab outcome return)
- `packages/h2a-runtime/src/conv-guard.ts` (native owner evidence only)
- `packages/h2a-runtime/src/relaunch.ts` (native sweep rule + routing in-place resume through `tryAcquireResumeLaunchClaim`, L1b)
- `packages/h2a-runtime/src/index.ts` (restore/relaunch wiring + ledger printing via the L6a catalog, which lands before L1a — no new hardcoded-language strings; new keys are added to the L6a catalog data files, which are part of this allow-list for key additions only)
- test files named above

Forbidden: broker implementation (L2), lease-semantics changes, weakening
any §1 fail-closed, counting `opened` as resumed, client-side facet
heuristics, registry row-shape changes (write-time merge is out — D4).

Acceptance: real-wrapper fixture, with a primary window that has
already received human typing and a stub CLI that exits to **real
managed Bash/readline**, restores from an attested empty shell to a
verified new CLI incarnation in the **same** PTY (same session id, no
`h2a run`, no new PTY) exactly once under concurrent duplicate rows
(two-process test), after L2 qualifies the D6(iii) handover, including
attach/owner bytes in flight. The paired consumed-readline-draft case
injects zero resume bytes and preserves the draft even after the idle
window, and so does the unfinished-multiline case whose current line
is empty at the secondary prompt (the human's original command later
runs whole, unamended): attainment requires the principal-prompt
proof, and no timeout, reset marker, control release or observation
flip replaces the attestation. The D3 claim proves at most one start across two
processes on one PTY, across two PTYs plus a concurrent `run --resume`
on one UUID, and zero resume injection while another writer is active;
ledger totals and the D2 exit status (already-active ⇒ 0, no candidates
⇒ 0, valid dry-run ⇒ 0, all-blocked ⇒ non-zero) recomputed from
outcomes in tests; zero-injection proof for `cli`/`other`/`unknown`
facets and for drafts; existing restore suites green, `skipped: 0` in
the named set.

### Lot LG — Dedicated configurable restore groups (D13, request D)

Purpose: restore partitions sessions into dedicated, user-configured
windows exactly once, with prefix/label matching and a full pre-flight
account — the mechanism behind the owner's dedicated group, with no
family name or path in code.

Before code, the lot report pins the exact `LayoutGroup` matcher field
set (proposition in D13) and the discovery-roots extension point, and
amends this allow-list if a field lands elsewhere. Compat is a RED
requirement, not an intention: an existing `projects`-only config must
produce identical windows before/after (except the D13 fixes below,
each called out in the report).

RED tests first (new `packages/h2a-runtime/src/restore-groups.test.ts`,
proposition name; plus cases in `restore.test.ts` / `config` tests the
report names):

- `it('should keep a projects-only layout config byte-identical in windows')` (compat control; green before and after — reported as a control, not a RED)
- `it('should place nested worktree sessions in their cwd-prefix group and nowhere else')`
- `it('should place a session in at most one window when two groups match it')` (first match wins)
- `it('should never duplicate a project listed in two groups')`
- `it('should account explicit-group cap overflow instead of dropping it silently')`
- `it('should report an empty configured group and unmatched sessions in the plan')`
- `it('should discover registry sessions under a configured root outside the default scan root')`
- `it('should select remote tabs per group without duplicating a remote session')`
- `it('should refuse an invalid layout config before launching anything')`
  (bad title type, duplicate slug-normalised titles, bad matcher types)
- `it('should title shared windows from the locale catalog, never a hardcoded language')`
  (via the L6a catalog, which lands before LG; new keys added to the L6a
  catalog data files — part of this allow-list for key additions only)

Allowed files:

- `packages/h2a-runtime/src/config.ts` (`LayoutGroup` matchers + validation in `getLayoutConfig` only)
- `packages/h2a-runtime/src/restore.ts` (`groupSessions`, `projectForCwd`/discovery roots, `registrySessions` root rule, plan account, remote-group selection)
- `packages/h2a-runtime/src/launch-layout.ts` (only if window metadata must carry the matched-group reason; lot report states before code, else untouched)
- `packages/h2a-runtime/src/index.ts` (restore command: config-error surfacing + plan printing only)
- `packages/h2a-runtime/src/restore-groups.test.ts` (new)
- `packages/h2a-runtime/src/restore.test.ts`
- `packages/h2a-runtime/src/restore-live-recovery.test.ts` (grouping regressions only)
- `packages/h2a-runtime/src/native-host-reuse.test.ts`, `restore-convid-reconcile.test.ts`, `restore-human-sessions.test.ts` (regression runs; edits only if a RED above lands there, stated before code)
- user-facing layout documentation/example file the report names (placeholder names only; exactly one docs file, amended in before code)

Forbidden: any hardcoded group title, workspace root, project name or
language in code/defaults/fixtures-committed-as-product (test fixtures
use invented names); writing the owner's real layout config; changing
`multiSession` cap semantics or the registry-preservation rule;
changing attach/relaunch decisions (L1's); glob matching (matchers are
exact / path-prefix / segment-prefix only — no glob engine).

Acceptance: partition property proven by tests over mixed fixtures
(every session in exactly ≤1 window; totals = placed + accounted
dropped + shared); `--dry-run` output names placements, unmatched,
empty groups and per-group cap drops; invalid config launches nothing
(zero `gnome-terminal` spawns asserted); a fixture family under a
configured non-default root restores into its dedicated window while
unrelated sessions stay in shared windows; existing grouping suites
green. Handover note (not acceptance): the exact config snippet the
owner/conductor can paste for a dedicated family group is in the docs
file with placeholders — applying it to real config is an owner/
conductor step outside this lot (§5).

### Lot L2 — Injection/supervision broker usable with an attached window (D5–D8)

Purpose: the structural lot. Restores the tmux property — server-side
injection concurrent with observation — under D6/D7 authority and audit.

Before code, the lot report pins: the wire shape of the capability, of
each payload kind and of the D5 automation writer identity/frontier
(including how the frontier and the idempotency-key → outcome mapping
are recovered after a client reconnect, and the exact `owner-protocol`
extension on the #375 base with its integration order on B3); the
owner-facing surface name (D8); the audit record's exact fields; and,
**per profile**, which D6 composition-evidence path applies —
observation handover (i) or the named TUI adapter (ii), **plus the
required managed-primary-shell adapter (iii), including the exact
principal-prompt-proof mechanism and its line-acceptance invalidation,
demonstrated on real Bash** — it being fixed in
D6 that an empty input queue, an expired timer and UI-readiness
detection are never evidence, and that `submit-text` is the D5
owner-side transaction (no composer clearing wherever human composition
is possible). `managed-bash-readline-v1` is an L2 implementation and
acceptance prerequisite of L1b, not an optional future adapter; old or
unmanaged shells still defer, typed. A TUI profile with neither (i)
nor (ii) defers, typed. Numbers
(grace windows, payload bounds) are propositions the report fixes and
the tests pin. The B3 frontier proofs in the RED list run on the
#375-based branch as part of this lot's acceptance, before lot L3
starts; lot L7 does not design or first-prove this seam (D17).

RED tests first (new `packages/h2a-runtime/src/native-terminal/inject.test.ts`
and `input-supervision.functional.test.ts`, proposition names; extensions
to `drive.functional.test.ts`, `op.test.ts`, `host.test.ts`):

- `it('should submit an authorized block while its delegated PTY view stays attached')`
- `it('should inject a signed wake line while a human window stays attached')`
- `it('should run human and automation producers with independent contiguous frontiers and unchanged human lease, epoch and resume token')`
  (two simultaneous producers on #375/B3, with D6-safe scheduling:
  N > 0 new human chunks and M > 0 new injected units applied exactly
  once, unit-serialised. Human lease/epoch/resume token are unchanged;
  `humanFrontierAfter = humanFrontierBefore + N`, with zero increment
  from injections; separately,
  `automationFrontierAfter = automationFrontierBefore + M`, with zero
  increment from human chunks. Retries/duplicates count in neither N
  nor M and advance neither frontier)
- `it('should leave the human frontier unchanged for an injection-only run')`
  (no human chunks; only the automation frontier advances)
- `it('should apply an injection exactly once across each D21 cut: before write, after write before response, on timeout')`
  (on the #375/B3 base, human attach held throughout; reconnect and
  redeliver both flows with their original identities at each cut:
  ACKs/frontiers reconcile separately, exact bytes from both producers
  arrive once, and injection redelivery returns the original ACK)
- `it('should attest and resume an empty managed primary shell after earlier human typing and CLI exit')`
- `it('should defer on a consumed readline draft in that same primary without changing its line or cursor')`
  (real managed Bash/readline in both cases, not a stub composition
  adapter; no resume/paste/submit bytes for the draft case)
- `it('should defer with zero bytes at a secondary prompt on an unfinished multiline command whose current readline line is empty, and attest again only at the next true principal prompt')`
  (real managed Bash/readline; the human enters `printf '%s\n'
  'draft` + Enter and Bash waits for the closing quote with the
  current line empty — the readline callback alone attests empty, so
  this RED targets the missing principal-prompt proof, not the empty
  line; after consumption and expiry of the idle window: typed
  deferral, zero resume/paste/submit bytes, no Enter/Ctrl-U; the human
  then closes the quote and the original command runs whole, with no
  resume text incorporated; a fresh attestation succeeds only once
  the shell is back at a true empty principal prompt)
- `it('should reject a managed-shell handover with human bytes still in flight or a stale prompt challenge')`
  (hold input in the attach queue, transport and PTY/readline path in
  turn, including reconnect; no attestation until drain + consumption;
  a keystroke before commit invalidates it without loss or clearing)
- `it('should defer without altering a human draft even after the idle timeout')`
- `it('should never clear or submit a draft the TUI already consumed more than 4s ago')`
  (queue empty, timer expired, draft held by the TUI fixture ⇒ typed
  deferral, zero bytes; no Ctrl-U is emitted)
- `it('should abort the submit when a human keystroke lands between paste and Enter')`
  (typed `preempted-after-paste`; no Enter, no clearing; the keystroke
  stays ordered after the pasted block)
- `it('should refuse a mandate revoked after the request was queued')`
  (revocation between admission and commit ⇒ zero bytes)
- `it('should refuse an operation outside the mandate scope')`
- `it('should never downgrade a failed agent-channel request to the owner channel')`
  (including a request that self-declares an owner actor)
- `it('should defer after real human keystrokes and succeed after the window')` (typed `retryAfterMs`; harness clock)
- `it('should never interleave injected bytes with a human write chunk')`
- `it('should preserve human input racing an automation commit')`
- `it('should refuse facet mismatch instead of typing a CLI line into a shell prompt')`
- `it('should distinguish refused-no-capability on an old host from deferred')`
- `it('should reject revoked authority and stale application incarnations before writing')`
- `it('should refuse mutation when durable admission cannot be recorded')`
- `it('should not submit twice when a committed request is redelivered')`
- `it('should audit every injection attempt without logging payload content')`
- `it('should leave lastHumanActivityAt unchanged after a machine injection')`
- `it('should inspect and capture a delegated PTY without taking its controller lease')`

Allowed files:

- `packages/h2a-runtime/src/native-terminal/host.ts`
- `packages/h2a-runtime/src/native-terminal/protocol.ts`
- `packages/h2a-runtime/src/native-terminal/client.ts`
- `packages/h2a-runtime/src/native-terminal/server.ts` (dispatch only)
- `packages/h2a-runtime/src/native-terminal/op.ts` (`inject` op; `drive` reimplemented on it; observer exposure; managed-shell attach input gate/drain)
- `packages/h2a-runtime/src/native-terminal/owner-protocol.ts` (**#375-integrated base only** — the D5 automation identity/frontier types and their validation, reusing the D21 ACK/dedup mechanism; plus `frontend-process.ts` on that base for forwarding only)
- `packages/h2a-runtime/src/native-terminal/input-supervision.ts` (new, proposition name — broker core if the report separates it from `host.ts`; exactly one home, stated before code)
- `packages/h2a-runtime/src/native-terminal/managed-shell.ts` (new,
  proposition name — `managed-bash-readline-v1` adapter, attestation and
  input-gate/drain coordination only)
- `packages/h2a-runtime/src/tmux.ts` (native `LOCAL_WRAPPER` branch:
  install the managed Bash/readline adapter + prompt hook only; no
  tmux behaviour or D11 hint change in this lot)
- `packages/h2a-runtime/src/native-terminal/reset-relay.ts` (managed
  prompt-generation/attestation seam only; preserve reset behaviour)
- `packages/h2a-runtime/src/tmux.test.ts` (managed-shell installation
  regression only; the real-readline proofs use
  `input-supervision.functional.test.ts` above)
- `packages/h2a-runtime/src/prompt-delivery.ts` (transaction adaptation only: the paste-evidence wait is reused by D5's transaction; the `clearComposer` step is removed from every path where human composition is possible, and UI-readiness is never used as composition evidence)
- `packages/h2a-runtime/src/native-host.ts` (`nativeInject…`, `driveNativeInstruction`, prompt-delivery transport and managed-shell adapter launch plumbing; the native `clearComposer` Ctrl-U binding leaves every such path with the step above)
- `packages/h2a-runtime/src/crash-log.ts` (audit record seam only, if needed; else untouched)
- `packages/h2a/src/runtime/drive/index.ts` (transport seam only — `authorizeDrive` semantics unchanged)
- `packages/h2a/src/cli.ts` (driver construction seam only; wake behaviour is L3)
- owner-facing surface files exactly as pinned before code (proposition:
  `packages/h2a-runtime/src/index.ts` verb registration and/or
  `packages/h2a/src/runtime/mcp/tools.ts` + `handlers.ts` — amended into
  this list with the chosen names before implementation)
- test files named above

Forbidden: changing `authorizeDrive`/consent/receive-gate semantics;
raw-byte injection outside the controller path; any client-side
read-then-write arbitration; resize via inject; weakening stop/takeover
fences; documenting `op.js` as a public API; PTY-B Phase L/B mechanics
(D17).

Acceptance: the owner's nominal case is green on a real PTY **with a
real attached window** (the §1.3 qualification hole is closed, not
relabelled); the managed-primary-shell adapter positively qualifies
the empty-shell case after prior human typing/CLI exit — empty line
**with** a fresh principal-prompt proof — rejects the paired
consumed-readline draft and the unfinished-multiline/secondary-prompt
case (current line empty, proof invalidated by line acceptance) with
zero resume bytes and the human command preserved whole, and rejects
stale or undrained handovers before L1b; draft-race and interleave
proofs assert exact PTY byte streams; the consumed-draft and
between-paste-and-Enter races prove
that no human text is cleared or submitted; under two simultaneous
producers the human lease/epoch/resume token stay invariant while its
frontier advances by exactly N newly applied human chunks, and the
automation frontier advances by exactly M new injections. Each flow
has its own ACK/retry proof; injection alone leaves the human frontier
unchanged. The three D21 cut points are green **on the
#375/B3-based branch** with the human attach held and bytes received
exactly once (this lot, before L3 — not L7); mandate revocation after
queueing, out-of-scope operation and channel downgrade all write zero
bytes; every D6 outcome is produced by at least one test; audit log
asserted content-free; `write-ack`/frontend-swap suites from #375 stay
green where the base includes them; old-host
capability refusal asserted against a stub host.

### Lot L3 — Wake/sendmessage works again; deposit vs processing distinguished (D9)

Purpose: reconnect the existing signed deposit to a working wake on the
L2 transport, with durable wake state and honest receipts end to end.

RED tests first (`packages/h2a/test/pty-native-messaging.test.js`,
`evo1-inbox-wake-handler.test.js`, `wake-defer.test.js` extensions;
`R/src/native-terminal/drive.functional.test.ts` wake cases):

- `it('should wake an attached native target from a deposited message')`
- `it('should retain a deferred wake across sidecar restart')`
- `it('should coalesce pending envelope notifications without duplicating an accepted submission')`
- `it('should never fall back to headless after a native target deferred')`
- `it('should distinguish transport-not-applicable from known-target-deferred in every driver')`
- `it('should report message deposit separately from wake submission and application processing')`
- `it('should surface the typed defer reason for a target whose human is typing')`

Allowed files:

- `packages/h2a/src/runtime/drive/inbox-wake.ts`
- `packages/h2a/src/wake.ts`
- `packages/h2a/src/cli.ts` (`nativePtyBackchannelDriver`, driver chains)
- `packages/h2a/src/runtime/drive/pty-actuator.ts`
- `packages/h2a/src/runtime/drive/index.ts` (result typing only)
- `packages/h2a/src/runtime/mcp/notifications.ts`, `stdio.ts` (wake arming/state only, as named before code)
- `packages/h2a-runtime/src/native-host.ts` (target env seams only, if needed)
- test files named above

Forbidden: changing envelope/deposit semantics (`H/src/runtime/send.ts`
contract); typing the message body into a terminal (the wake line stays
the visible signed instruction); boolean-flattening any new result;
broker changes (L2 — a missing broker behaviour is an L2 amendment).

Acceptance: full chain proven in an isolated environment — deposit →
sidecar detection → wake submission into an **attached** real PTY →
agent-side receive — including one real-CLI scenario per profile the
conductor enrols (no enrolled CLI = qualification reported incomplete,
never skipped-green); restart-durability and no-headless-fallback
asserted; receipts distinguish the four acknowledgements in output/logs.

### Lot L4 — Terminal replies never reach the shell + relaunch hint at PTY end (D10, D11)

Two independently landable halves. **L4-hint** (D11) is first-RC;
**L4-replies** (D10) follows and may land in the same RC only if its
VTE acceptance below is green against a build of the lot branch
installed **inside the qualification fixture only** (never the owner's
installed binary/dist — §4 isolation rule) — an extra reset or a delay
alone never counts as D10 done.

**VTE qualification harness (to be created by this lot).** The current
functional machinery (`terminal-modes.functional.test.ts`) spawns the
attach inside a second `node-pty` with `TERM=xterm-256color`: no
terminal emulator ever answers DA/DECRPM/XTVERSION there, so it remains
the deterministic parser/byte-fixture harness and can never qualify
D10. L4-replies therefore creates a real-VTE harness: a fixture runner
(`packages/h2a-runtime/src/native-terminal/vte-harness.mjs`, new,
proposition name) that spawns a real VTE terminal (`gnome-terminal`)
under a private virtual display (`Xvfb`) and a private D-Bus session
(`dbus-run-session`), with `HOME`/XDG/`DISPLAY`/bus/runtime state under
the lot's L0 temp roots, the lot-branch build installed into a fixture
prefix, and only fixture-spawned, birth-checked PIDs ever stopped. The
qualification command (exact form pinned in the lot report, following
§4's authorised commands) runs the new
`vte-qualification.functional.test.ts`. If `gnome-terminal`/`Xvfb` is
absent on a machine, D10 qualification there is reported **incomplete**
— never green on the double-PTY harness alone, and never by falling
back to the owner's real terminal, display or session bus. Zero Python
in the harness (Node + the named native binaries only).

RED tests first (hint: `packages/h2a-runtime/src/tmux.test.ts`,
`native-terminal/terminal-modes.functional.test.ts`, `op.test.ts` —
inverting the tests that pin today's wrong timing, each inversion
called out in the lot report; replies: new
`native-terminal/terminal-replies.ts` + `terminal-replies.functional.test.ts`,
proposition names, on the `terminal-modes.functional.test.ts` machinery):

- `it('should print the profile resume command, never h2a run, when the CLI exits inside a live PTY')`
- `it('should print the h2a run recreation line only after the PTY itself ends (second Ctrl-D)')`
- `it('should print h2a attach, not a recreation command, on detach')`
- `it('should quote paths and preserve the resolved resume options in both hints')`
- `it('should leave the shell input line empty when a TUI emits startup queries and exits at once')`
  (the A.3 capture: DA + DECRQM 2026/1016 + XTVERSION, outer replies delayed past CLI exit)
- `it('should not reissue XTVersion, DA or DECRQM queries from replay')`
- `it('should swallow at the host a reply accepted by the bridge whose CLI exits before the write lands')`
  (the reply RPC is held after bridge acceptance, the CLI exits, then
  the RPC is delivered: zero reply bytes at the shell, neighbouring
  human keystrokes preserved in order, `lastHumanActivityAt` untouched
  by the reply — D10 final-write revalidation)
- `it('should consume split late replies after CLI exit without changing the shell input')`
- `it('should still forward human input typed during the drain window, in order')`
- `it('should swallow the outer CPR answer to a host-intercepted cursor query')`
- `it('should preserve live TUI replies and bracketed human paste')`

Allowed files:

- `packages/h2a-runtime/src/tmux.ts` (`LOCAL_WRAPPER`, `localRelaunchCommand`)
- `packages/h2a-runtime/src/profiles.ts` (single resume-args source, if the report confirms it as such)
- `packages/h2a-runtime/src/native-host.ts` (wrapper resume command plumbing)
- `packages/h2a-runtime/src/native-terminal/op.ts` (attach bridge: reply classifier hookup, hint printing, repaint)
- `packages/h2a-runtime/src/native-terminal/terminal-replies.ts` (new, proposition name)
- `packages/h2a-runtime/src/native-terminal/protocol.ts`, `client.ts`, `server.ts` (typed reply units only: query correlation + controller epoch + application incarnation carried bridge → host; human keystrokes keep their existing path)
- `packages/h2a-runtime/src/native-terminal/host.ts` (final-write correlation revalidation before `pty.write`, fault counter, drain coordination with the reset marker)
- `packages/h2a-runtime/src/native-terminal/vte-harness.mjs` (new — qualification fixture runner only, per the harness paragraph above)
- `packages/h2a-runtime/src/native-terminal/vte-qualification.functional.test.ts` (new — real-VTE acceptance only)
- `packages/h2a-runtime/src/native-terminal/replay-buffer.ts` / `screen.ts` (query-free repaint, exactly as pinned before code)
- `packages/h2a-runtime/src/native-terminal/reset-relay.ts`, `terminal-modes.ts` (only where the classifier/drain seam requires)
- `packages/h2a-runtime/src/index.ts` (`already exists` message naming the in-PTY action)
- test files named above

Forbidden: blanket ANSI stripping; changing live-output relay semantics;
a second wrapper marker if the existing reset marker suffices (state
before code); hint strings hardcoded in one language (L6a catalog; new
keys in its data files are part of this allow-list for the hint half);
using the owner's real display, session bus, terminal or installed
build for qualification; presenting the double-PTY harness as terminal
evidence.

Acceptance: hint half — wrapper + bridge outputs asserted byte-for-byte
in fixtures for CLI-exit, PTY-exit, detach and transport-loss cases.
Replies half — zero printable bytes at the post-CLI shell prompt in the
capture reproduction on the real-VTE harness defined above (branch
build installed in the fixture); the held-RPC final-write test proves
host-side revalidation; classifier unit tests cover sequences split at
every chunk boundary on the deterministic harness; human-input
preservation and live-TUI non-regression green; orphan-reply counter
visible in logs output; VTE absence reported as incomplete
qualification, with the deterministic results listed separately.

### Lot L5 — Secondaries/delegated excluded from restore by provenance (D12)

Purpose: close every A.4 leak (§1.5) — registry, legacy, launch-path and
remote — without inventing a parallel filter.

Sequencing inside the lot: the read-path gate on existing fields
(delegation fields + `role` + `sessionClass`) lands first and is
RC-eligible on its own; the persisted facet (D12a) and run flags follow
in the same lot. The lot is not done on the read-path half alone.

RED tests first (`packages/h2a-runtime/src/restore-human-sessions.test.ts`
new DEFECT cases, `restore.test.ts`, `enroll.test.ts`,
`registry.test.ts`, `restore-wiring.test.ts`):

- `it('should exclude a delegated review with a visible terminal and a valid transcript')`
- `it('should exclude an attached delegated session with delegationOrigin or parent set')`
- `it('should not promote a classless legacy transcript to a primary session')`
- `it('should exclude a legacy classless delegated row even when a transcript exists')`
- `it('should preserve delegation provenance across resume and hook enrollment')`
- `it('should exclude remote delegated sessions from the default restore plan')`
- `it('should refuse primary enrollment carrying delegation provenance')`
- `it('should list excluded secondaries by name in dry-run and restore them only with the opt-in')`

Allowed files:

- `packages/h2a-runtime/src/registry.ts` (facet field, validation, enrollment guard)
- `packages/h2a-runtime/src/session-class.ts`
- `packages/h2a-runtime/src/restore.ts` (gate, one-time legacy classification + persistence, dry-run/opt-in reporting)
- `packages/h2a-runtime/src/enroll.ts` (provenance preservation, managed-session resolution seams)
- `packages/h2a-runtime/src/index.ts` (run flags, `enrollFromRun` call sites, remote-tab classification)
- listing surfaces that enumerate registry rows, exactly as named before code (expected: the `ls`/presence projections the report inventories — amended in, never drive-by)
- test files named above

Forbidden: name/suffix/age/model/path heuristics; silently rewriting
legacy rows beyond the one persisted classification (which is reported
in `--dry-run` before it is written — dry-run stays side-effect-free);
changing `sessionClass` env vocabulary; touching real registry data.

Acceptance: every §1.5 leak path has a failing-then-passing fixture;
unclassified legacy rows appear in a separate named section and are
never auto-restored; promotion of an unclassified row is explicit and
recorded once (mechanism pinned before code); remote fixtures follow
the same gate; existing `role:"job"`/`background` exclusions unchanged
(regression green).

### Lot L6 — Human upgrade/restore output in the user's language (D14)

Purpose: kill the JSON wall and the mixed-language output; keep the
machine contract intact under `--json`.

The catalog itself is lot L6a's deliverable and lands before L6 does
any rendering: `packages/h2a-runtime/src/human-output.ts` + its
`catalog-*.ts` data modules, the `./human-output` subpath export, and
`packages/h2a/src/runtime/human-output-loader.ts` on the `h2a` side
(D14b). Before code, the L6 report pins only what remains: the final
key set for the touched surfaces and the `--json` schemas for upgrade
and restore (restore gains a machine form of the D2 ledger; field names
are machine values, never localised). The TTY→human default flip (D14a)
is delivered by this lot; §6 Q5 is not a prior veto on it (D14f).

RED tests first (`packages/h2a/test/upgrade-human-output.test.js`, new,
proposition name; `upgrade.test.js` moved to `--json`;
`cli-contract.test.js`; `R/src/restore-wiring.test.ts` ledger cases):

- `it('should print one human line and no JSON on a TTY when already current')`
- `it('should render a concise upgrade report without escaped manifests')`
- `it('should never embed a child stdout string in upgrade output')`
  (chatty fake doctor via the injected runner ⇒ counted summary + details path)
- `it('should keep the exact JSON contract under --json')`
- `it('should distinguish an unavailable registry from an already-current package')`
- `it('should report partial host repair failure as a partial outcome')`
- `it('should render the catalog language for a non-French non-English locale fixture')`
  (a third fixture locale proves nothing is fr/en-hardcoded; fallback to the default catalog asserted for an unknown locale)
- `it('should count observed restore outcomes instead of planned tabs')`
- `it('should emit no mixed-language lines in one run')` (golden files per shipped locale)

Allowed files:

- `packages/h2a-runtime/src/human-output/catalog-en.ts`, `catalog-fr.ts` (L6a data files — key additions for the touched surfaces only; the module, the export and the `h2a` loader are L6a's and are consumed, not recreated)
- `packages/h2a/src/cli.ts` (`cmdUpgrade` rendering + `--json`/`--repair` wiring)
- `packages/h2a/src/hosts/upgrade-equipment.ts` (structured summaries; no raw stdout fields)
- `packages/h2a/src/runtime/upgrade/index.ts` (outcome split `already-current` vs `registry-unreachable` only; PTY mechanics are L7/#375)
- `packages/h2a/src/cli-contract.ts` (help/contract strings on touched commands)
- `packages/h2a-runtime/src/restore.ts`, `launch-layout.ts`, `index.ts` (existing hardcoded user strings → catalog lookups; ledger rendering from L1 outcomes)
- test files named above (+ golden fixtures)

Forbidden: localising machine values; per-language code branches
(catalog data only); hardcoding date/number formats; changing upgrade
mechanics, retention or PTY reporting semantics (L7 consumes #375's);
breaking `--json` consumers silently (schema changes are stated in the
report and pinned by the moved tests).

Acceptance: golden human outputs per shipped locale + the third-locale
fixture green; `--json` suites green with the pre-existing assertions
preserved under the flag; a TTY already-current run is ≤ the pinned
line budget with zero `{`/`sha256`/absolute-path command lines; restore
totals in both modes recomputed from the D2 ledger in tests.

### Lot L7 — Integration with PR #375 Phase B / B5 (D15, D17) — reuse, never duplicate

Purpose: land this EVOL **on top of** #375 and wire the seams between
the two specs. No upgrade mechanics are implemented here.

Scope, exhaustively:

1. Rebase/sequence this EVOL's lots over #375 (conductor owns branch
   mechanics). Where L0–L6 touched a #375 file (`host.ts`, `op.ts`,
   `client.ts`, `protocol.ts`, `server.ts`, `H/src/cli.ts`,
   `H/src/runtime/upgrade/index.ts`, `H/src/hosts/upgrade-equipment.ts`,
   `native-isolation.js`), the merged result keeps **both** contracts:
   #375's D21/frontier/retention behaviour and this EVOL's
   facet/broker/ledger/output behaviour. A conflict resolved by
   dropping either side's test is a failed integration.
2. Broker writes (L2), in-place resume (L1b) and wake submissions (L3)
   ride the D5 automation writer identity/frontier end-to-end
   (client → frontend → owner), as already designed in D5/D17 and
   proved by L2 on the B3 base; L7 re-qualifies that a frontend swap
   mid-injection neither loses nor duplicates a unit and never touches
   the human controller's D21 frontier. The seam is never designed or
   first-proved here.
3. Upgrade human/JSON output (L6) renders #375's per-component
   `installed/loaded/switched/deferred` and pre-B `unfenced/deferred`
   states verbatim as machine values; the boot worker's quiet-outcome
   set never hides a PTY deferral (D15c).
4. Restore's stale-host blocker (D2) and `doctor` output name #375's
   fleet inventory facts (loaded versions, session counts) instead of
   re-probing.

RED tests first (extensions only; #375's own suites are regression, not
relabelled RED):

- `it('should preserve queued supervised input and authority across a frontend swap')`
  (new case in `R/src/native-terminal/frontend-swap.functional.test.ts` once #375 lands it)
- `it('should keep an injected wake exactly-once across a frontend swap')`
- `it('should report a pre-B host as unfenced/deferred in human and JSON upgrade output')`
- `it('should never signal or withdraw a pre-B host observed empty while a v1 client creates a session')`
  (the observed-zero race: no signal, no endpoint withdrawal, the
  concurrently created session is preserved — D15b; automatic
  retirement exists only for a cooperating owner via #375's atomic
  abandon)
- `it('should name the stale resident host once as the restore blocker after an upgrade')`

Allowed files: only the seam files the integration report names before
code, drawn from the intersection above, plus the test files named
above and #375's `upgrade-pty-contract.test.ts`,
`legacy-drain.functional.test.ts`,
`phase-b-agent-qualification.functional.test.ts`,
`H/test/upgrade-swap.test.js`, `upgrade-boot-worker.test.js` as
regression runs. Any other file needs an amendment naming why the seam
cannot live in its owning lot.

Forbidden: a second upgrade/swap/retention/inventory implementation;
modifying #375 gates, skips, TODOs or cohort requirements; claiming B5
for any platform; starting any PTY-B Phase L lot; forcing the owner's
pre-B host to converge (D15/Q3).

Acceptance: #375's named targeted suites **and** this EVOL's L1–L6
suites green on the integrated base, `skipped: 0` per named platform
set; the four seam REDs green; B5 status reported exactly as #375
states it at integration time (qualified per platform only with its
non-empty real CLI cohort green — conductor-run, outside this lot);
the integration report lists every conflict and which contract each
resolution preserved.

### First-RC composition (summary)

| Content | First RC | Condition |
|---|---|---|
| L0 isolation | Yes — first | Prerequisite for trusting any later proof |
| L6a locale catalog foundation | Yes — after L0 | Prerequisite for every new human string (L1a, LG, L4-hint, L6) |
| L1a facet + guard + dedup + ledger | Yes | In-place candidates reported `deferred` until L1b |
| LG groups | Yes | Owner applies their own config (§5) — RC ships mechanism + docs |
| L5 secondaries (read-path gate at minimum; full lot preferred) | Yes | Persisted facet may complete in the same RC only if green |
| L6 human output + language | Yes | `--json` preserves machine consumers |
| L4-hint (D11) | Yes | Wrapper/bridge only; no protocol change |
| L1b in-place resume | Only if L2 core + D6(iii) managed-primary-shell acceptance are green | Else next RC; never claimed early (D2) |
| L2 broker, L3 wake | No (next) | New host capability; real-CLI qualification required |
| L4-replies (D10) | Only if the real-VTE acceptance is green on the branch build installed in the fixture | Else next RC; VTE absence = incomplete, never green |
| L7 / PR #375 | Per its own B5 gate | Never presented as the fix for A/B/C/D (§1.9) |

Sequencing warning (from both analyses, kept verbatim in substance):
L1a/L5/L6/LG/hint improve the experience but do not resolve the resident
pre-B host skew on the owner's machine; while that host carries the
sessions, restore remains partially fail-closed **and now says so**
(D2/D15). The manual owner-side exit is to let the old host drain: an
upgrade never signals or withdraws a non-cooperating pre-B host, even
if it is observed at zero sessions (D15b) — an ordered restart of that
host, if the owner ever chooses one, is a conductor/owner procedure to
document in the existing runbook, outside any upgrade run — not a code
lot, and never improvised by a lot (§5, §6 Q3).

## 5. What is NOT covered

Nothing in this list may be claimed by any lot above:

- **Live migration of PTYs between owners** (PTY-B Phase L), two
  standing owners (PTY-B O1), frontend-swap/retention/keeper mechanics
  (PR #375), MCP-HANDOVER, update scheduling/policy (when upgrades
  trigger), and any new UI beyond the touched CLI help/output.
- **Hot-upgrading the owner's resident pre-B host.** Pre-B sessions are
  never live-migrated (PTY-B D5); their host stays `unfenced/deferred`
  until it drains. No lot signals it, withdraws its endpoint, or
  promises convergence. The manual drain/ordered-restart procedure on
  the real machine is a conductor/owner runbook step, outside every lot.
- **Closing the specific observed occurrences** (`h-cond`, `k8s`,
  `gr-conductor` not restarting; the two `i-cond`; which secondaries
  appeared) as *forensics*: the lots fix the demonstrated mechanisms
  and the REDs reproduce them in isolation, but attributing each
  real-machine occurrence needs the identity evidence of §1.5, which
  no lot collects from real state. Lots must not kill, merge or
  reclassify real sessions to "confirm" a fix.
- **Cleaning the polluted real `attach.log`** or any real state file.
  L0 prevents recurrence; existing lines stay as evidence for the
  conductor's diagnostics.
- **Writing the owner's real layout config** (including the dedicated
  group of request D), real registry rows, or any real config. LG/L5
  ship mechanisms, docs and fixtures only; applying config or promoting
  legacy rows on the real machine is an explicit owner/conductor step.
- **Exactly-once claims beyond PTY-B D10/D21**: no exactly-once across a
  host crash, a machine crash/reboot (sessions never survive reboot),
  or on a non-capable (pre-`inject`, pre-D21) peer — there the typed
  refusal/degradation of D17 applies and nothing stronger is claimed.
- **Arbitrary raw-byte remote control of a PTY**, and any silent
  (invisible) agent-channel typing. On authority scope, precisely:
  same-uid access to the 0600 host socket **is** the owner-channel
  boundary (D7a, as with the tmux server socket today), so this EVOL
  does **not** cover distinguishing the owner's own processes from
  agent processes running under the same uid, and no per-target
  revocable mandate is claimed on that channel; what stays excluded is
  control from outside that boundary (another uid, a remote caller) by
  merely knowing a slug/socket path. Cluster-mesh transport
  internals beyond preserving D9's typed receipts.
- **Terminal families beyond the D10 acceptance set**: exotic
  query/reply families not enumerated by L4's classifier table,
  terminals other than the VTE-driven acceptance harness, and any
  latency guarantee for the drain window. New families enter by adding
  classifier rows + tests, never by widening the pass-through.
- **Non-Linux product claims for the new paths** (facet, broker, reply
  discipline) beyond what PTY-B BM qualifies: macOS/Windows behaviour
  of L1–L4 is covered only where a lot's named platform set runs green
  there; otherwise listed not-run, never implied. Node < 22.
- **Locale completeness beyond the touched surfaces**: L6 localises
  `upgrade`/`restore` (and the strings LG/L1/L4 add through the same
  catalog). Other commands keep their current language until a future
  lot moves them; catalogs for languages beyond the shipped set are
  data contributions, not this EVOL's deliverable. Translation quality
  review is not a gate here; key completeness per shipped locale is.
- **Grouped-window geometry/focus policy** (which window is focused,
  tiling, tab order inside a window beyond today's ordering),
  `gnome-terminal` alternatives, and tmux-host layout changes: LG only
  decides membership and accounting.
- Verification on the owner's real machine/state, full-suite runs, RC
  cutting and version attribution: conductor/owner steps, outside
  every lot (per-lot targeted proofs are in §4).

## 6. Open owner questions (principles — OPEN, with recommended defaults)

Each question is OPEN: no lot may silently decide it. Each carries the
recommended default that §2/§4 already assume where stated, so an owner
"no" is a bounded spec amendment, not a redesign. **None of Q1–Q5
blocks L0, L6a, L1a/L1b's guard+ledger+facet core, L4, L5's exclusion
gate, L6 (including its TTY default flip, D14f) or LG.** Lots L2/L3
implement the Q1/Q2 defaults behind their typed outcomes; changing a
default changes policy data/gates, not the broker.

**Q1 — What authority does a delegation give its parent over the
delegated PTY?** Read/wake only, or also text submission, resume,
interrupt and stop, inside a launch-time mandate bounded by target,
operations and duration? A delegated review must be supervisable
without a fresh permission per keystroke, but its parent must not gain
control of every PTY.
*Recommended default (assumed by D7/D8):* an explicit per-target mandate
recorded at delegation launch — inspect/capture/watch + submit/wake in
scope, `interrupt` distinct from `stop`, revocable, every effect
audited, no per-send confirmation prompt. Anything wider needs the
existing consent path. A narrower owner answer only shrinks the granted
operation set; the broker, audit and receipts are unchanged.

**Q2 — When the owner opens a delegated window, how do human typing and
injections coexist — especially over an unsent draft?** Options:
(a) observation-by-default for delegated windows with an explicit,
visible take/release-control gesture (window stays open throughout);
(b) automatic cooperative sharing once an adapter can prove draft/
insertion-point state; (c) signal-without-typing while a draft exists.
A timeout alone never proves an empty draft (D6).
*Recommended default (assumed by D6/D8):* (a) for the first safe
delivery, generalised to (b) per-adapter only where L2's evidence
requirement is met; deferral is typed, bounded and surfaced to the
conductor, never a silent overwrite; any human force-send is an
explicit supervision-surface action, audited. Open sub-points for the
owner: the defer bound/alert threshold, and whether force-send may
exist at all. L2 must report which mode each profile qualifies for.

**Q3 — At upgrade, what does "a session to preserve" include?** Only
the CLI process + its conversation, or also the persistent shell, its
history and the scrollback? PTY-B already forbids killing/migrating a
pre-B host with live sessions; the open part is the shells-only case
(no CLI alive, detectable once L1's facet exists): may upgrade then
*propose* an ordered host restart that loses shells/scrollback?
*Recommended default (assumed by D15):* never automatic while any CLI
is alive; shells-only restart may be **proposed** in upgrade output
with the exact count of what would be lost, never executed without an
explicit owner command. If the owner's definition includes the shell
itself, the proposal disappears and D15 stands unchanged otherwise.

**Q4 — What is the resume value of (i) interrupted secondaries and
(ii) legacy unclassified sessions?** (i) Is a mid-task delegated
conversation (review, analysis) worth resuming via an explicit opt-in,
or always relaunched fresh by its conductor? (ii) For classless legacy
rows where a transcript proves a conversation but not a primary human
session: exclude-and-list, or include?
*Recommended defaults (assumed by D12):* (i) excluded by default,
resumable only via the explicit `--include-secondary` opt-in — if the
owner's answer is "never", the flag is dropped and D12 simplifies;
(ii) excluded by default, listed readably as unclassified, promotable
explicitly once (recorded) — never promoted from transcript existence
and never by name pattern. Neither answer blocks L5's exclusion gate.

**Q5 — Human output by default changes the `h2a upgrade` TTY contract:
TTY→human / `--json`→JSON (pipe→JSON for one deprecation cycle), or
unchanged default + an explicit human flag?** Existing consumers parse
the JSON (the repo's own tests do). Any consumer allocating a PTY and
parsing would break under the TTY switch.
*Recommended default (assumed by D14, and **applied by lot L6 without
waiting for this answer**):* TTY→human, `--json` explicit,
pipe→JSON during one announced deprecation cycle. This question stays
OPEN only for identifying an actual PTY-parsing consumer and, if one is
named, amending the transition (up to inverting the default) with the
evidence in hand; it is not a veto on L6's delivery, its catalog, its
summaries or its outcome split (revision v2). If no such consumer is
ever named, nothing changes.

Narrower incident facts still wanted from the conductor (not owner
principles, and blocking nothing above): the exact identity rows of
the observed `i-cond` duplicate, the provenance/classification of the
secondaries that appeared in restore, and the causal error under the
reconnect loops — each an already-authorised or anonymised extract,
used only to close §1.5/§1.1 occurrence attribution after the REDs.

## 7. Résumé des changements (français)

Ce tableau résume, pour l'owner, ce que chaque lot change concrètement.
La spec normative reste le texte anglais ci-dessus (§2 décisions D1–D18,
§4 lots) ; en cas d'écart, l'anglais fait foi.

| Lot | Bug(s) | Changement concret | Première RC |
|---|---|---|---|
| L0 | Pollution `attach.log` (17/10) | Isolation d'état des tests par construction : racines temporaires par worker avant tout import (preload nommé, commande Node autorisée unique), contrôle au point d'écriture effectif (chemins explicites et symlinks compris) **et** barrière de système de fichiers pour tout l'arbre de processus (descendants non-Node compris), suites `sess-livelock`/`h2a-alpha` confinées ; sans barrière disponible, qualification incomplète, jamais verte | Oui, en premier |
| L6a | (prérequis A.1/D) | Socle catalogue de langues partagé, livré avant ses consommateurs : module + données dans le package runtime, export public `./human-output`, consommation par `h2a` via son chargement paresseux du package pair ; jamais de copie de chaînes entre packages | Oui, après L0 |
| L1a | A.2, A.5 | L'hôte distingue PTY vivant / CLI vivant / shell (facette foreground) ; garde anti-doublon natif corrigé ; une session physique = un onglet ; restore rend un bilan exact par session au lieu de compter des onglets « relancés » | Oui |
| LG | D (groupe dédié) | Groupes restore configurables par préfixe de cwd/projet et par label (en plus de la liste exacte actuelle) ; chaque session dans au plus une fenêtre ; débordements comptés ; groupes vides et sessions sans groupe nommés au plan ; config invalide refusée avant tout lancement ; rien de codé en dur (le groupe Airbus est de la config owner, pas du code) | Oui |
| L5 | A.4 | Les déléguées/secondaires sont exclues de restore par provenance (`delegationOrigin`, parent, rôle job), y compris legacy avec transcript et chemin remote ; retour possible uniquement par opt-in explicite ; exclues nommées en `--dry-run` | Oui (gate lecture au minimum) |
| L6 | A.1 | `upgrade`/`restore` en texte court dans la langue de l'utilisateur (catalogue piloté par la locale, toute langue ajoutable en données) ; JSON uniquement avec `--json` ; plus aucun stdout imbriqué ; « déjà à jour » ≠ « registre injoignable » | Oui |
| L4 (hint) | B (hint) | À la sortie du CLI : commande de reprise du CLI dans le PTY ; `h2a run …` uniquement à la fin du PTY (second Ctrl-D), imprimé par le composant survivant ; `h2a attach …` au détachement | Oui |
| L2 | B, C | Broker d'injection côté hôte utilisable fenêtre attachée : inspection/capture/observation sans bail, injection autorisée et auditée sous une identité d'écrivain d'automatisation distincte du bail humain (frontière propre, mécanisme d'ACK/dédup D21 réutilisé, prouvée sur la base #375 avant L3 ; la frontière humaine avance uniquement pour les nouveaux chunks humains), soumission en transaction côté owner, jamais par-dessus une frappe humaine ni un brouillon non envoyé (fenêtre déléguée en observation par défaut, aucun effacement de composeur) ; adaptateur Bash/readline géré obligatoire pour la reprise des primaires : preuve du brouillon au prompt principal (une ligne courante vide en continuation multiligne ne suffit jamais) et drainage des octets en vol ; refus typés au lieu de `deferred` fourre-tout ; canal owner = accès socket même-uid sans mandat révocable revendiqué, canal agent = mandat revérifié au commit | Non (suivante) |
| L1b | A.2 | Restore reprend le CLI **dans son PTY ouvert** (shell géré attesté vide par l'adaptateur L2, y compris après des frappes humaines antérieures) via le broker, une seule fois, avec vérification, en passant par la réservation de conversation existante (claim + garde) commune à restore/relaunch/`run --resume` ; brouillon readline consommé ou commande multiligne inachevée au prompt secondaire ⇒ aucune commande injectée ; balayage `relaunch` natif en place ; restore idempotent (tout déjà actif ⇒ succès) | Seulement si L2 et son acceptation du shell primaire sont verts |
| L3 | C | `send`/wake remarche fenêtre attachée ; état de wake durable après redémarrage du sidecar ; dépôt, soumission du wake, réception et traitement distingués ; aucun repli headless après un différé natif | Non (suivante) |
| L4 (réponses) | A.3 | Les réponses du terminal (DA, DECRPM, XTVERSION…) sont corrélées aux requêtes et **revérifiées par l'hôte au dernier point d'écriture**, jamais réémises par le replay, drainées à la transition CLI→shell ; la ligne du shell reste vide ; frappe humaine préservée ; acceptation sur harnais VTE réel créé par le lot (build de branche installé dans la fixture ; sans VTE, qualification incomplète) | Seulement si l'acceptation VTE est verte |
| L7 | Skew d'upgrade | Intégration sur PR #375 sans seconde implémentation : frontière d'automatisation (L2) re-qualifiée bout en bout, états `deferred`/pré-B `unfenced` rendus dans les sorties L6 ; un pré-B même observé vide n'est jamais signalé ni retiré par l'upgrade (retraite automatique réservée à l'abandon atomique d'un owner coopérant de #375) ; B5 reste le gate de #375 (cohorte CLI réelle), jamais revendiqué ici | Selon le gate B5 de #375 |

Questions ouvertes owner (§6, aucune bloquante pour L0/L6a/L1/L4/L5/L6/LG) :
Q1 autorité qu'une délégation donne à son parent sur le PTY délégué ;
Q2 coexistence frappe humaine / injections quand l'owner ouvre une
fenêtre déléguée (brouillon non envoyé) ; Q3 ce que « session à
préserver » inclut à l'upgrade (CLI+conversation, ou aussi
shell/scrollback) ; Q4 valeur de reprise des secondaires interrompues
et des sessions legacy non classées ; Q5 bascule du défaut TTY→humain
pour `h2a upgrade` (appliquée par L6 ; Q5 ne reste ouverte que pour
identifier un éventuel consommateur parseur sous PTY). Chaque question
porte le défaut recommandé en §6.

## 8. Changements v2 (français)

Révision v2 établie contre les deux revues indépendantes NO-GO de la v1
(`docs/reviews/pty-restore-injection/review-astra.md`, notée
**Astra n°**, et `review-sol.md`, notée **Sol n°**). Chaque ligne relie
un finding aux sections modifiées en conséquence. Hors ces corrections
et leurs répercussions d'harmonisation (§0.3, §3, §7, ordre des lots),
la v2 ne change rien : demandes owner A–D (§0.1) verbatim inchangées,
capital existant conservé (analyses, PR #375 réutilisée, aucun second
upgrade), questions owner §6 toujours ouvertes avec leurs défauts
recommandés.

| Finding (revue, gravité) | Sections modifiées |
|---|---|
| Astra 1 (P1) — la retraite d'un hôte pré-B « observé vide » contredit l'amendement pré-B ratifié de #375 | §2 D15b (exception supprimée ; retraite automatique réservée à l'abandon atomique d'un owner coopérant) ; §3 ligne « Upgrade skew » ; §4 L7 (RED : pré-B observé vide + création v1 concurrente), avertissement de séquencement après la table de première RC ; §7 ligne L7 |
| Astra 2 (P1) et Sol 3 (P2) — D21 est lié au contrôleur humain : le raccord d'injection sans bail est indéfini et `owner-protocol.ts` absent des listes | §0.3 point 8 ; §1.9 (limite de réutilisation démontrée dans le code de #375) ; §2 D5 (identité/frontière d'automatisation distincte, définie avant L2), D7, D17 (preuve sur la base B3 en L2, avant L3 ; L7 re-qualifie seulement) ; §4 L2 (avant-code, RED deux producteurs + trois coupures, `owner-protocol.ts`/`frontend-process.ts` en liste), L7 (périmètre, point 2) ; §7 lignes L2/L7 |
| Astra 3 (P1) — le protocole « measured composer » ne prouve ni composeur vide ni atomicité (Ctrl-U, détection d'UI) | §1.2 (fait code ajouté : `deliverInitialPrompt`, `clearComposer`) ; §2 D5 (transaction côté owner, préemption avant/après collage, effacement interdit), D6 (chemin nominal fixé : passation par observation ou adaptateur nommé par profil) ; §4 L2 (RED brouillon consommé > 4 s et frappe entre collage et Enter ; `prompt-delivery.ts` en liste) ; §7 ligne L2 |
| Astra 4 (P1) — la corrélation des réponses terminal n'est pas revérifiée au dernier point d'écriture | §1.4 (le bail survit à la transition CLI→shell) ; §2 D10a (unités typées, revalidation atomique par l'owner avant `pty.write`) ; §4 L4 (RED « RPC suspendue » ; `protocol.ts`/`client.ts`/`server.ts` en liste) ; §7 ligne L4 (réponses) |
| Astra 5 (P1) et Sol 2 (P1) — la reprise en place contourne le claim de conversation et `guardConvWriters` | §1.5 ; §2 D3 (réservation commune restore/relaunch/`resume-application`, tenue jusqu'à observation/enrôlement) ; §4 L1 (RED deux processus/deux PTY/un autre écrivain actif ; `relaunch.ts` précisé ; acceptation) ; §7 ligne L1b |
| Astra 6 (P2) — le contrat d'autorité mélange canal owner même-uid et mandat révocable authentifié | §2 D7 (garanties explicitées par canal : socket = toute l'autorité du canal owner, acteur déclaré non authentifié ; binding vérifiable et re-vérification au commit sur le canal agent ; pas de downgrade) ; §4 L2 (RED révocation après mise en attente, opération hors mandat, changement de canal) ; §5 (portée même-uid explicitement non couverte) ; §7 ligne L2 |
| Astra 7 (P2) — le code de sortie de restore transforme un restore idempotent réussi en échec | §2 D2 (échec défini par les objectifs non satisfaits ; `already-active` satisfait ; contrat `--dry-run` distinct) ; §4 L1 (RED tout-actif ⇒ 0, aucun candidat ⇒ 0, dry-run valide ⇒ 0, tout bloqué ⇒ non-zéro ; acceptation) ; §7 ligne L1b |
| Astra 8 (P2) et Sol 4 (P2) — le catalogue de langue est requis avant le lot qui le crée ; accès inter-packages non défini | §2 D14b ; §4 préambule (ordre et première RC) ; nouveau lot **L6a** (catalogue dans le package runtime, export `./human-output`, loader paresseux côté `h2a`, preuve depuis les `dist` construits) ; L1/LG/L4/L6 (seams et listes alignés sur L6a) ; table de première RC ; §7 ligne L6a |
| Astra 9 (P2) et Sol 5 (P2) — Q5 bloque explicitement la correction A1 (contraire au mandat « Q5 ne bloque pas L6 ») | §2 D14f (la bascule TTY→humain est livrée par L6) ; §4 L6 (avant-code) ; §6 (phrase d'ouverture et Q5 : ouverte seulement pour identifier un consommateur parseur sous PTY, sans veto) ; §7 paragraphe questions |
| Astra 10 (P2) — L0 ne nomme ni commande Node avant-import ni inventaire borné des writers | §1.8 (preload existant non nommé par aucune commande autorisée) ; §2 D16a/d (preload `native-isolation.js` étendu ; seule commande Node autorisée `node --import … --test`) ; §4 préambule (commande ciblée corrigée), L0 (inventaire borné listé maintenant, RED suite sans helper explicite, acceptation) ; §7 ligne L0 |
| Astra 11 (P2) — l'acceptation VTE repose sur un harnais inexistant ; « installed build » ambigu | §2 D10e ; §4 L4 (harnais VTE à créer nommé : `vte-harness.mjs`, `gnome-terminal` sous `Xvfb` + bus privé, build de branche installé dans la fixture, absence de VTE = qualification incomplète ; fichiers en liste ; acceptation) ; table de première RC (formulation) ; §7 ligne L4 (réponses) |
| Sol 1 (P1) — L0 ne ferme ni les chemins explicites (`logPath`) ni les descendants non-Node | §1.8 (faits code ajoutés) ; §2 D16b/e (contrôle au **point de mutation**, symlinks suivis, **barrière de système de fichiers** nommée ; claims par couche) ; §4 L0 (RED chemin explicite/lien sortant/enfant non-Node ; `test-state-guard.ts`, launcher barrière et writers en liste ; acceptation) ; §7 ligne L0 |
| Sol 6 (P3) — un contrôle de non-régression présenté comme RED (« attach but never inject ») | §4 L1 (scénario reclassé contrôle conservé ; le RED cible l'observation absente : facette, incarnation, issue du ledger) |

## 9. Changements v3 (français)

Révision v3 terminée à partir des retouches partielles présentes dans
le fichier, contre les deux re-revues indépendantes NO-GO de la v2
(`review-r2-astra.md`, notée **Astra R2 n°**, et
`review-r2-sol.md`, notée **Sol R2 n°**, dans
`docs/reviews/pty-restore-injection/`). La référence des deux revues est
la v2 de SHA-256
`81b47e6ffa9231b4640070a4dbce5795b3d2c8b3fac4b9d556377ec909f82db3`.
Les sept findings nouveaux sont couverts ci-dessous, y compris le P3 ;
aucun nouveau P1 n'était soulevé. Les tableaux de recontrôle des
findings v1 dans les deux revues ont également été revérifiés : leurs
corrections sont conservées, et leurs réserves résiduelles rejoignent
les lignes ci-dessous. §8 reste l'historique de la v2.

| Finding (revue, gravité) | Sections modifiées |
|---|---|
| Astra R2 1 (P2) — la voie d'observation déléguée ne qualifie pas le shell primaire déjà utilisé par l'humain | §1.2 (constats attach humain, shell Bash ordinaire et capital prompt/reset) ; §2 D6 + D6(iii) (`managed-bash-readline-v1` nommé, preuve readline réelle liée à une génération de prompt et un challenge, drainage attach/owner + consommation des octets, revalidation au commit ; ni timeout ni restitution/observation ne suffisent) ; §4 préambule et L1b/L2 (fichiers autorisés de l'adaptateur, hooks et transport, couple primaire déjà utilisé → shell vide → reprise unique / brouillon consommé → zéro commande, courses en vol ; acceptation réelle Bash/readline obligatoire avant L1b) ; table première RC ; §7 L2/L1b |
| Astra R2 2 (P2) et Sol R2 1 (P2) — recettes ciblées hors barrière système et preload Node résolu comme un paquet | §1.8 (résolution `./`/URL et limite du helper actuel) ; §2 D16 (deux enveloppes complètes depuis la racine, attestation de confinement vérifiée avant évaluation, absence de barrière ⇒ qualification incomplète sans repli) ; §4 préambule et L0 (commandes via `scripts/test-sandbox.mjs`, preload `./packages/h2a/test/helpers/native-isolation.js`, refus des runners directs non confinés avant tout module de test/enfant, contrôle positif atteignant le writer après preload, rapports sous la racine privée) |
| Sol R2 2 (P2) — listes fermées L0 incomplètes pour le raccord CI et ses tests de contrat | §1.8 (inventaire des commandes et assertions exactes vérifié dans le code) ; §2 D16d ; §4 L0 (`ci.yml`, `codex-drift.yml`, `release.yml`, `focus-dossier.yml`, runners et les deux tests `release-workflow.test.js`/`run-test-gates.test.js` explicitement autorisés pour ce seul raccord ; commande sûre exacte du trust root et vérifications ciblées nommées ; indépendance, ordre avant `npm test`, inconditionnalité et preuves d'exécution conservés) |
| Astra R2 3 (P2) et Sol R2 3 (P2) — frontière humaine figée malgré les écritures humaines dans le RED concurrent et l'acceptation | §4 L2 (bail/epoch/jeton humains invariants ; frontière humaine après = avant + N nouveaux chunks humains, zéro incrément dû aux injections ; frontière d'automatisation après = avant + M injections, zéro incrément humain ; contrôle injection seule ; redélivrance/ACK et octets exacts des deux flux aux trois coupures sur #375/B3) ; §7 L2 |
| Astra R2 4 (P3) — « tout déjà actif ⇒ exit 0 » est déjà vert, donc pas un RED comportemental | §4 L1 (exit 0 reclassé contrôle conservé ; RED porté par les observations `already-active`, le ledger par primaire et les totaux absents aujourd'hui) |

Vérification de cette révision par lecture du code à `dc78dc5f7` dans
`spec-pty`, et du capital #375 à `d5d34e20b` dans `ptycode` en lecture
seule. Aucun test/build exécuté : les RED et acceptations ci-dessus
sont des obligations des lots, pas des résultats mesurés ni un verdict
GO. Demandes owner A–D (§0.1) conservées verbatim, capital existant
conservé, aucune seconde implémentation d'upgrade, aucun gate B5
assoupli. Q1–Q5 (§6) restent OPEN avec leurs défauts recommandés ; les
mécanismes ajoutés restent des propositions, jamais des décisions owner.

## 10. Changements v4 (français)

Révision v4 minimale, contre le seul finding restant de la re-revue R3
NO-GO (`review-r3-astra.md`, un P2, aucun P1 ; référence v3 de SHA-256
`dc2ae07600cf67faf965c7fa6a72f4f1494eb08fdcc4e1adfafb27acd13ef065`).
La re-revue R3 compagnon (`review-r3-wonder.md`, GO-CODE) ne donne lieu
à aucune retouche dans cette révision. §8 et §9 restent l'historique
des v2 et v3.

| Finding (revue, gravité) | Sections modifiées |
|---|---|
| Astra R3 1 (P2) — une ligne readline vide ne prouve pas l'absence d'un brouillon Bash multiligne (quote inachevée au prompt secondaire : callback `READLINE_LINE` vide identique au prompt principal, texte de reprise incorporé à l'argument humain) | En-tête (paragraphe v4) ; §2 D6(iii) dans la table D6 et dans le bloc normatif qui la suit (contre-exemple quote inachevée ; **preuve de prompt principal** — preuve positive, produite par le cycle prompt/parseur du shell géré, d'une lecture d'une nouvelle commande au prompt principal, sans continuation, here-document, lecture imbriquée ni commande en cours ; liée au même challenge/génération/frontière que l'attestation readline ; **invalidée dès l'acceptation d'une ligne** et jusqu'au retour principal attesté ; jamais déduite du texte du prompt, du marqueur reset, de `READLINE_LINE` seul, d'une file vide ni d'un délai expiré ; hooks absents/altérés ⇒ aucune attestation ; mécanisme Bash exact à figer avant code en L2 et à démontrer sur Bash réel, sinon adaptateur non qualifié et L1b différé typé ; transition positive et conditions d'invalidation alignées) ; §4 L1b et L2 (nouveau RED dans les fichiers déjà autorisés : prompt secondaire sur commande multiligne inachevée, ligne courante vide, après consommation et expiration du délai ⇒ zéro octet de reprise, commande humaine intégrale préservée et exécutée telle quelle à la fermeture de la quote ; succès conservé au vrai prompt principal vide attesté ; rapport avant-code L2 et acceptations L1b/L2 alignés) ; §7 lignes L2/L1b |

Vérification de cette révision : capital relu dans le code à
`dc78dc5f7` dans `spec-pty` (`LOCAL_WRAPPER` : hook `PROMPT_COMMAND` et
`exec /bin/bash -l`, `packages/h2a-runtime/src/tmux.ts:127` et `:131` ;
marqueur reset consommé par l'hôte) ; contre-exemple reproduit hors
produit sur Bash interactif isolé (attestation `len=0 point=0` aux
prompts principal et secondaire, texte témoin incorporé à l'argument
humain). Aucun test/build du dépôt exécuté : le nouveau RED et les
acceptations restent des obligations des lots, pas des résultats
mesurés ni un verdict GO. Demandes owner A–D (§0.1) conservées
verbatim, capital existant conservé, aucune seconde implémentation
d'upgrade, aucun gate B5 assoupli. Q1–Q5 (§6) restent OPEN avec leurs
défauts recommandés ; les mécanismes ajoutés restent des propositions,
jamais des décisions owner.
