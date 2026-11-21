# Feature: Track owner table — delivery lot D (same skill and same binary on the six CLIs)

## Objective

- [ ] « fais-moi un track report » reaches the same `harness/track-report` skill text and the same `track` binary from Claude Code, Codex, Gemini CLI, AGY, Muse and Vibe.
- [ ] The `track` binary resolves without a local build and without an interactive shell.
- [ ] Stale skill copies and stale `/track` commands are purged, and `h2a doctor` reports any that remain.
- [ ] Contract: `docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md`, section 8 (lot D), tests TD-a to TD-e.

## Scope / Guardrails

- [ ] Accountable: `plugins`. Responsible: `plugins`, and `harness` for the skill text. Consulted: `cond`.
- [ ] This lot distributes what exists; it changes no reader behaviour and no journal.
- [ ] A file is purged only when this tool can prove it wrote it: its content digest is in the historical catalogue. A file whose content is unknown is reported, never deleted.
- [ ] No Track-shipped skill receives a rule that is specific to h2a (spec V10).
- [ ] Tests never touch a real host installation: every host root is a temporary directory (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `VIBE_HOME`, `HOME`, `TRACK_INSTALL_HOME` pointed at `mkdtemp` folders).
- [ ] Never run an installed `h2a` binary from a shell; use the built `packages/h2a/dist` of this checkout inside tests.
- [ ] No Python and no perl anywhere. Node and TypeScript only.
- [ ] `TMPDIR`, `TMP` and `TEMP` point into the lane's own folder, never the system temporary directory; the folder is removed at the end.
- [ ] No `git stash`. Selective staging only. No write to `.track/**` from this branch.
- [ ] Conventional English commit subjects; no attribution trailer of any kind; never `--no-verify`.
- [ ] One logical change per commit, at most 10 to 15 files and under 150 changed lines, or a recorded exception.
- [ ] Run targeted test files only; the conductor runs the complete suite at integration.
- [ ] Update the branch by rebasing on `origin/main` and pushing with `--force-with-lease`.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `packages/h2a/skills/harness/track-report/SKILL.md`
  - `packages/h2a/src/cli.ts`
  - `packages/h2a/src/hosts/installation-doctor.ts`
  - `packages/h2a/src/hosts/native-artifacts.ts`
  - `packages/h2a/src/hosts/native-convergence.ts`
  - `packages/h2a/src/hosts/native-skills.ts`
  - `packages/h2a/test/install-skills-hosts.test.js`
  - `packages/h2a/test/host-installation-doctor.test.js`
  - `packages/h2a/test/track-report-skill-bootstrap.test.js`
  - `packages/track/src/cli/install-skills.ts`
  - `packages/track/src/cli/install-skills.test.ts`
  - `docs/native-host-equipment.md`
  - `plan/02-BRANCH_track-owner-table-lot-d-distribution.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.track/**`
  - `packages/track/src/report/**`
  - `packages/h2a/hooks/**`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/h2a/fixtures/native-host-catalog.json` and `packages/h2a/fixtures/native-host-renderers.json` (regenerated only by `scripts/generate-native-host-catalog.mjs`, never hand-edited)
  - `packages/h2a/src/cli-contract.ts`, `packages/h2a/src/cli-command-map.ts`, `docs/contracts/golden/**`, `packages/h2a/test/fixtures/runtime-help-commands.json` (only if a flag is added to `install-skills` or `doctor`)
  - `packages/h2a/test/package-plugin-manifest.test.js`
- **Exception process**:
  - Declare exception ID `BR802-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

- [ ] `attention` to `agents`: whether AGY lists skills from a directory of its own is unknown (spec annex E). TD-c is written after the probe of Lot 0; if AGY has no skill store, AGY is classified « command only » with the evidence and the conductor is told before the lot closes.
- [ ] `attention` to `plugins` release owner: every change to a skill text creates a new content digest; installed copies of the previous text must be recognised as historical. State in the pull request whether the catalogue needs regeneration for this lot.
- [ ] `attention` to `track`: the `/track` command written by `track install-skills` changes target (Lot 3).

## Orchestration Mode (AI-selected)

- [x] **Mono-branch** (the pieces are tested together by the same install and doctor suites)
- [ ] **Multi-branch**
- Rationale: skill, installer and doctor must agree on one notion of « current copy »; splitting them would let that notion drift.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline, probes and red tests**
  - [ ] Read spec section 8 and annex D; read `packages/h2a/src/cli.ts` lines 7136-7260 (`targetSpecFor`, legacy prune), 7434-7657 (`collectInstallableSkills`, `cmdInstallSkills`), 7996-8015 (`resolveTrackBin`); `packages/h2a/src/hosts/installation-doctor.ts` lines 105-131, 1301-1500; `packages/track/src/cli/install-skills.ts` lines 39, 101-137, 250-288; the skill bootstrap at `SKILL.md:131-147`.
  - [ ] Create the worktree under `tmp/worktrees/`; `npm ci`; `npm run build`.
  - [ ] Baseline green: `node --test packages/h2a/test/install-skills-hosts.test.js packages/h2a/test/host-installation-doctor.test.js` and `npm test -w @sentropic/track -- src/cli/install-skills.test.ts`.
  - [ ] Probe AGY read-only, on a throwaway root: record which directory, if any, its CLI lists skills from, and the command that shows the list. Save the transcript in the lane folder. No write to a real AGY installation.
  - [ ] Tests (red first):
    - [ ] `TD-a` — `packages/h2a/test/install-skills-hosts.test.js` — the six hosts receive the same track-report skill body (TD-a)
    - [ ] `TD-b` — `packages/h2a/test/track-report-skill-bootstrap.test.js` — the skill bootstrap resolves the track binary from a shell with no rc file and no local build (TD-b)
    - [ ] `TD-c` — `packages/h2a/test/install-skills-hosts.test.js` — agy exposes track-report where its CLI lists skills, or is reported command-only with its reason (TD-c)
    - [ ] `TD-d` — `packages/h2a/test/host-installation-doctor.test.js` — doctor flags a stale skill copy and a stale track command, and passes when both are current (TD-d)
    - [ ] `TD-e` — `packages/h2a/test/install-skills-hosts.test.js` — install-skills purges only the stale copies it can prove it wrote (TD-e)
  - [ ] TD-a: install for each of the six hosts into temporary roots; extract the skill body from each artifact (the `SKILL.md` body, or the prompt body of the TOML command) and assert the six bodies are equal after the host-specific wrapper is removed.
  - [ ] TD-b: extract the bootstrap shell block from `SKILL.md`; run it with `sh` under an environment reduced to a temporary `HOME`, no rc file, and a `PATH` made of the directory of the running `node` binary followed by `/usr/bin:/bin` — so `node` resolves on a CI runner and no per-user bin directory does — against a fixture layout holding a Track package in a global prefix; assert it prints an absolute `bin.js` path whose `report --help` mentions `--owner-table`. Red today: the block names only `packages/track/dist/cli/bin.js` of the current checkout.
  - [ ] TD-d red today: `installation-doctor.ts` has no check that reads an installed skill or command file.
  - [ ] TD-e: seed a host root with (1) a copy whose digest is in the historical catalogue, (2) a file at the same path with unknown content; assert (1) is replaced or removed and (2) is left in place and reported.
  - [ ] Lot gate:
    - [ ] The five tests fail for the stated reasons, except TD-c which is written to the probe result; outputs saved.

- [ ] **Lot 1 — Binary resolution in the skill**
  - [ ] Replace the bootstrap block of `SKILL.md` (lines 131-147) by a POSIX shell block that tries, in order, and keeps the first candidate that exists and whose `report --help` mentions `--owner-table`: `$TRACK_BIN`; this checkout's `packages/track/dist/cli/bin.js`; this checkout's `node_modules/@sentropic/track/dist/cli/bin.js`; the global npm prefix (`npm root -g`, then the conventional per-user prefix under the home directory); the Track package nested in a globally installed `@sentropic/h2a`.
  - [ ] The block fails with one sentence naming what was tried when no candidate qualifies; it never falls back to a bare `track` found on `PATH`.
  - [ ] Keep every later command of the skill as `node "$track_bin" …`; keep the sentence that the bootstrap is read-only with respect to `.track/`.
  - [ ] State the minimum Track version the skill needs in the block, compared against `node "$track_bin" --version`.
  - [ ] Lot gate:
    - [ ] `node --test packages/h2a/test/track-report-skill-bootstrap.test.js` — TD-b green.
    - [ ] `npm test -w @sentropic/track -- src/report/validated-report-shape.test.ts src/report/skill-truncation-warning.test.ts` and `node --test packages/h2a/test/owner-gate-skill.test.js` — still green.

- [ ] **Lot 2 — One skill body on the six hosts**
  - [ ] In `collectInstallableSkills` and the renderers (`cli.ts:7107`, `7434-7503`; `hosts/native-skills.ts`), make the track-report body identical across hosts: the only allowed differences are the host wrapper (front matter, TOML envelope) and the resource location.
  - [ ] Apply the AGY probe result: when AGY lists skills from its own directory, add that target to `targetSpecFor`; otherwise keep the command target and make the install output say « command only » with the reason.
  - [ ] Lot gate:
    - [ ] `node --test packages/h2a/test/install-skills-hosts.test.js` — TD-a and TD-c green; the existing titles of that file unchanged and green.

- [ ] **Lot 3 — Stale copies and the `/track` command**
  - [ ] In `packages/track/src/cli/install-skills.ts` (`TRACK_SLASH_COMMAND_MD`, `TRACK_SLASH_COMMAND_TOML`, lines 101-137): make the command serve the owner table through the same resolution order as Lot 1 instead of a bare `track report --wp --decisions`.
  - [ ] In `cmdInstallSkills` (direct path for Claude and Codex, `cli.ts:7575-7619`) and in the native convergence path (`hosts/native-artifacts.ts`, `native-convergence.ts`): detect `commands/track.md`, `prompts/track.md` and `commands/track.toml` left by earlier installers; purge when the digest is in the historical catalogue, report otherwise.
  - [ ] Extend the legacy prune (`cli.ts:7258-7260`) to every name under which the historical catalogue records the track-report skill, under the same digest rule. The list is read from the catalogue, not written by hand; when the catalogue records no earlier name, this step changes nothing and says so in the pull request.
  - [ ] Lot gate:
    - [ ] `node --test packages/h2a/test/install-skills-hosts.test.js` — TD-e green.
    - [ ] `npm test -w @sentropic/track -- src/cli/install-skills.test.ts` — updated expectations green.

- [ ] **Lot 4 — Doctor**
  - [ ] Add finding codes `skill-missing`, `skill-stale` and `command-stale` to the finding union of `installation-doctor.ts` (lines 105-131) and to `hostFindingBucket`.
  - [ ] In `inspectClaude` and `inspectCodex`, compare each installed skill and the `/track` command with what this version would install; in the native path, report files at command paths that are neither owned nor desired.
  - [ ] `--repair` converges them through the same code as `install-skills`; without `--repair` they are reported only.
  - [ ] Lot gate:
    - [ ] `node --test packages/h2a/test/host-installation-doctor.test.js` — TD-d green; the 76 existing tests green.

- [ ] **Lot 5 — Final validation**
  - [ ] `npm run typecheck`
  - [ ] `node --test packages/h2a/test/install-skills-hosts.test.js packages/h2a/test/host-installation-doctor.test.js packages/h2a/test/track-report-skill-bootstrap.test.js packages/h2a/test/package-plugin-manifest.test.js`
  - [ ] `npm test -w @sentropic/track -- src/cli/install-skills.test.ts`
  - [ ] `bash scripts/check-public-contract.sh` and `bash scripts/check-no-python.sh`
  - [ ] Update `docs/native-host-equipment.md` with the resolution order and the purge rule.
  - [ ] Open the pull request in English with red and green evidence and the AGY probe transcript; follow CI to green; do not merge.
  - [ ] Acceptance criteria: TD-a to TD-e green on Node 22 and 24; on a throwaway root per host, the install output names the same skill digest six times; doctor reports zero skill finding after an install and one finding per seeded stale file.
