# Feature: Track owner table — delivery lot 3c (capture hooks, one installation per machine and per CLI)

## Objective

- [ ] One installation per machine and per CLI makes every message the owner types reach the capture queue, with no action by an agent.
- [ ] An end-of-turn hook reminds the session of the captures it has not classified.
- [ ] A CLI that is not covered is registered and displayed as such.
- [ ] Contract: `docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md`, sections 7.1, 7.6 and 7.7, decision DS-4, tests T3c-a to T3c-e.

## Scope / Guardrails

- [ ] Accountable: `plugins`. Responsible: `plugins`. Consulted: `agents`, `harness`, `cyber`.
- [ ] **Entry gate (DS-4).** Do not start before lots 3a, 3b and 3q are merged and `track journal status` shows this repository's journal held by its conductor. Record the four checks in the Feedback Loop before Lot 1.
- [ ] A hook is installed for a CLI only at the classification lot 3q recorded for its installed version: `direct` installs the message hook and the end-of-turn hook; `deferred` installs the end-of-turn collector only; `not-covered` and an unqualified version install nothing and are registered as not covered.
- [ ] Codex and Gemini CLI are exercised as `direct` only if lot 3q classified them so.
- [ ] The hook lives in the user-level configuration of the CLI, never in a repository: nothing is added to any repository.
- [ ] A hook never blocks the owner's prompt, and the message hook prints nothing on standard output.
- [ ] The reminder is bounded: a capture is announced at most once, and a session is never held in a loop.
- [ ] Uninstalling removes exactly the entries this installer wrote and nothing else.
- [ ] This lot uses the two hook scripts of lot 3b as they are; it does not change how an origin is computed.
- [ ] Capturing native agent questions is not part of this lot (spec DS-10).
- [ ] Tests never touch a real host installation: every host root is a temporary directory, and every test sets `TRACK_STATE_HOME` to a temporary folder.
- [ ] Never run an installed `h2a` binary from a shell.
- [ ] No Python and no perl anywhere. Node and TypeScript only.
- [ ] `TMPDIR`, `TMP` and `TEMP` point into the lane's own folder, never the system temporary directory; the folder is removed at the end.
- [ ] No `git stash`. Selective staging only. No write to `.track/**` from this branch.
- [ ] Conventional English commit subjects; no attribution trailer of any kind; never `--no-verify`.
- [ ] One logical change per commit, at most 10 to 15 files and under 150 changed lines, or a recorded exception.
- [ ] Run targeted test files only; the conductor runs the complete suite at integration.
- [ ] Update the branch by rebasing on `origin/main` and pushing with `--force-with-lease`.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `packages/h2a/src/hosts/capture-hooks.ts`
  - `packages/h2a/src/hosts/plugin.ts`
  - `packages/h2a/src/hosts/vibe-equipment.ts`
  - `packages/h2a/src/hosts/installation-doctor.ts`
  - `packages/h2a/src/cli.ts`
  - `packages/h2a/src/cli-contract.ts`
  - `packages/h2a/hooks/capture-remind.mjs`
  - `packages/h2a/test/capture-hooks-install.test.js`
  - `packages/h2a/test/host-installation-doctor.test.js`
  - `packages/h2a/test/cli-contract.test.js`
  - `packages/h2a/skills/harness/track-report/SKILL.md`
  - `docs/plugin-installation.md`
  - `plan/09-BRANCH_track-owner-table-lot-3c-hooks.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.track/**`
  - `packages/track/**`
  - `packages/h2a/hooks/hooks.json`
  - `packages/h2a/hooks/capture-origin.mjs`
  - `packages/h2a/hooks/track-bin.mjs`
  - `packages/h2a/fixtures/capture-qualification.json`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `docs/contracts/golden/**`, `packages/h2a/src/cli-command-map.ts`, `packages/h2a/test/fixtures/runtime-help-commands.json` (only if the new flag changes a pinned file; the golden verb list holds verbs, not flags)
  - `packages/h2a/test/package-plugin-manifest.test.js` (only if it pins the list of shipped hook files)
  - `packages/h2a/fixtures/native-host-catalog.json` (never hand-edited)
  - `packages/h2a/test/host-plugin.test.js`
- **Exception process**:
  - Declare exception ID `BR809-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

- [ ] Entry gate record: merge commits of lots 3a, 3b and 3q; output of `track journal status` on this repository's journal; date.
- [ ] `attention` to `agents`: how each CLI lets an end-of-turn hook speak to the agent differs; the reminder uses the documented channel of each CLI and falls back to silence, never to typing into the terminal.
- [ ] `attention` to `cyber`: review the hook command lines and confirm no hook can leak a prompt to standard output or to a log.
- [ ] `attention` to `harness`: the skill gains the sentence that a session classifies its captures before its turn ends.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch** (one installer and its doctor check)
- [ ] **Multi-branch**
- Rationale: install, register, uninstall and doctor must agree on which entries are « ours ».

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline and red tests**
  - [ ] Read spec section 7; read `packages/h2a/src/cli.ts` lines 5321-5402 (`mergeStopHooksFile`: how `Stop` and `UserPromptSubmit` entries are merged idempotently) and 7517-7657 (`cmdInstallSkills`, the per-machine installation path with its manifest and prune); `packages/h2a/src/cli-contract.ts` lines 926-933 (the contract entry of `install-skills`); `packages/h2a/src/hosts/plugin.ts` lines 85-150 and 228-267; `packages/h2a/src/hosts/vibe-equipment.ts` near line 133 (the managed `post_agent` wrapper); the fixture `packages/h2a/fixtures/capture-qualification.json` and the scripts `packages/h2a/hooks/capture-origin.mjs` and `track-bin.mjs` as lots 3q and 3b left them.
  - [ ] Create the worktree under `tmp/worktrees/`; `npm ci`; `npm run build`.
  - [ ] Baseline green: `node --test packages/h2a/test/host-plugin.test.js packages/h2a/test/install-skills-hosts.test.js packages/h2a/test/host-installation-doctor.test.js packages/h2a/test/capture-origin.test.js`.
  - [ ] Tests (red first):
    - [ ] `T3c-a` — `packages/h2a/test/capture-hooks-install.test.js` — a message sent through the installed hook of a direct CLI is captured with no agent action and shown as captured by the next report (T3c-a)
    - [ ] `T3c-b` — `packages/h2a/test/capture-hooks-install.test.js` — a CLI that is not covered is registered and displayed as not covered (T3c-b)
    - [ ] `T3c-c` — `packages/h2a/test/capture-hooks-install.test.js` — installing twice changes nothing and uninstalling removes exactly what was installed (T3c-c)
    - [ ] `T3c-d` — `packages/h2a/test/capture-hooks-install.test.js` — the end-of-turn hook lists the unclassified captures of its session once and stays silent when there is none (T3c-d)
    - [ ] `T3c-e` — `packages/h2a/test/capture-hooks-install.test.js` — with hooks active and the journal held, an ordinary session's classification is queued and not inscribed (T3c-e)
  - [ ] T3c-a pipes a hook payload of the CLI's recorded shape into the exact command line the installer wrote, on a temporary host root and a temporary Track state home, with the session class set to `human` in the environment, then runs the built Track reader and asserts the text appears quoted. A second case runs the same payload with no class and no qualified sign and asserts the text appears marked `origine non prouvée` and unquoted.
  - [ ] T3c-c compares the host configuration file byte for byte before the install and after the uninstall, with unrelated hooks present in it.
  - [ ] Red today: no installer writes a capture hook; the only prompt-level hook is the drive-receive gate, which ignores ordinary messages.
  - [ ] Lot gate:
    - [ ] The five tests fail for those reasons; outputs saved.

- [ ] **Lot 1 — Hook rendering**
  - [ ] Create `packages/h2a/src/hosts/capture-hooks.ts`: per CLI, the message-hook command (`node <package>/hooks/capture-origin.mjs --cli <cli> --text-key <key>`, the key being `payloadTextKey` of that CLI's qualification entry) and the end-of-turn command (`node <package>/hooks/capture-remind.mjs --cli <cli>`), plus predicates that recognise each entry as ours by its script name.
  - [ ] Create `packages/h2a/hooks/capture-remind.mjs`, dependency-free: it resolves the Track binary by importing `track-bin.mjs`, passes the end-of-turn payload it received to `track capture remind --cli <cli> --stdin`, and when Track returns captures, tells the agent through the CLI's documented channel to classify them with `track capture classify`. It exits 0 on every failure path.
  - [ ] Lot gate:
    - [ ] `node --test packages/h2a/test/capture-hooks-install.test.js` — T3c-d green.

- [ ] **Lot 2 — One installation per machine and per CLI**
  - [ ] Add the flag `--capture on|off` to `h2a install-skills --host <cli>`; add it to the optional flags and the description of its contract entry in `cli-contract.ts`, and update `cli-contract.test.js` where it pins that entry.
  - [ ] `--capture on` reads the installed CLI version, looks up lot 3q's table, and for `direct` merges the message hook and the end-of-turn hook into the CLI's user-level hook file with the idempotent merge of `mergeStopHooksFile`; for `deferred` it adds only the end-of-turn collector — for Vibe, inside the managed `post_agent` wrapper; for `not-covered` or an unqualified version it writes no hook.
  - [ ] In every case it registers the result with `track capture register --cli <cli> --version <v> --mode <mode>`, so the table header shows the state of that CLI.
  - [ ] `--capture off` removes the entries recognised as ours and registers the CLI as not covered.
  - [ ] The existing `Stop` and `UserPromptSubmit` entries of the drive-receive gate and of the drumbeat record are left untouched.
  - [ ] Lot gate:
    - [ ] `node --test packages/h2a/test/capture-hooks-install.test.js packages/h2a/test/host-plugin.test.js packages/h2a/test/install-skills-hosts.test.js packages/h2a/test/cli-contract.test.js` — T3c-a, T3c-b, T3c-c green.
    - [ ] `bash scripts/check-public-contract.sh`

- [ ] **Lot 3 — Doctor and held journal**
  - [ ] Extend the doctor checks of lot D with `capture-hook-missing` and `capture-hook-stale`: doctor reads the registry through `track capture status --format json` and, for a CLI registered as `direct` or `deferred`, compares the hook entries of its user-level file with what this version would write.
  - [ ] T3c-e: on a temporary journal declared exclusive, a capture from a session without the token is classified, stays queued, and the holder's `track capture inscribe --all` inscribes it.
  - [ ] Lot gate:
    - [ ] `node --test packages/h2a/test/capture-hooks-install.test.js packages/h2a/test/host-installation-doctor.test.js` — T3c-e green.

- [ ] **Lot 4 — Skill**
  - [ ] In `packages/h2a/skills/harness/track-report/SKILL.md`: a session classifies its captures before its turn ends; the report shows « Captées, pas encore inscrites »; a CLI shown as not covered means its messages are not captured; a text marked `origine non prouvée` is never quoted as the owner's words.
  - [ ] In `docs/plugin-installation.md`: the one-time command per CLI, and how to remove it.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/report/validated-report-shape.test.ts src/report/skill-truncation-warning.test.ts`; `node --test packages/h2a/test/owner-gate-skill.test.js`.

- [ ] **Lot 5 — Final validation**
  - [ ] `npm run typecheck`
  - [ ] `node --test packages/h2a/test/capture-hooks-install.test.js packages/h2a/test/host-plugin.test.js packages/h2a/test/install-skills-hosts.test.js packages/h2a/test/host-installation-doctor.test.js packages/h2a/test/package-plugin-manifest.test.js packages/h2a/test/cli-contract.test.js`
  - [ ] `bash scripts/check-public-contract.sh` and `bash scripts/check-no-python.sh`
  - [ ] Live check by the conductor, outside CI, on one CLI classified `direct`: a typed witness sentence appears as captured in the next report; the transcript of that check is attached.
  - [ ] Open the pull request in English with red and green evidence; follow CI to green; do not merge.
  - [ ] Acceptance criteria: T3c-a to T3c-e green on Node 22 and 24; the host configuration file is byte-identical after install then uninstall; no hook writes to standard output.
