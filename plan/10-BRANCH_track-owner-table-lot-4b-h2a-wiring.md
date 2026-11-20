# Feature: Track owner table — delivery lot 4b (h2a wiring: designation at a conductor's claim, journal given to launched sessions)

## Objective

- [ ] When a conductor claims a repository, h2a designates that repository's journal as the journal of reference of the project, through the Track command.
- [ ] A session launched by h2a receives the designated journal, so a session in a clone reads and feeds the same journal as the main checkout.
- [ ] On this repository's journal, an ordinary session can append no event.
- [ ] The owner's two words are proven across the board: every cell of six CLIs by four kinds of folder renders or refuses with a motif.
- [ ] Contract: `docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md`, sections 6.3, 7.4 and 8, tests T4b-a to T4b-d.

## Scope / Guardrails

- [ ] Accountable: `plugins`. Responsible: `plugins`, `runtime`. Consulted: `track`, `cond`.
- [ ] Prerequisites: lots 3a, 3c and 4a are merged.
- [ ] h2a calls Track; Track never calls h2a. The designation, the write policy and the resolver stay Track commands (spec V10).
- [ ] A claim designates only the journal of the repository the conductor claims from; it never designates a journal for another project.
- [ ] `TRACK_DIR` is given to a launched session only when the project has a designated journal. A session launched without one resolves as Track decides.
- [ ] The writer token of an exclusive journal is given to the holder's session only, never to a session launched for another role.
- [ ] The election of a conductor is not changed by this lot. The mismatch between the workspace identifier of live sessions and that of a default claim (spec annex D, conductor resolution) is reported, not fixed here.
- [ ] Never run an installed `h2a` binary from a shell; tests use temporary roots and stop only processes they started.
- [ ] No Python and no perl anywhere. Node and TypeScript only.
- [ ] `TMPDIR`, `TMP` and `TEMP` point into the lane's own folder, never the system temporary directory; the folder is removed at the end.
- [ ] No `git stash`. Selective staging only. No write to `.track/**` from this branch.
- [ ] Conventional English commit subjects; no attribution trailer of any kind; never `--no-verify`.
- [ ] One logical change per commit, at most 10 to 15 files and under 150 changed lines, or a recorded exception.
- [ ] Run targeted test files only; the conductor runs the complete suite at integration.
- [ ] Update the branch by rebasing on `origin/main` and pushing with `--force-with-lease`.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `packages/h2a/src/cli.ts`
  - `packages/h2a/src/runtime/governance/journal-designation.ts`
  - `packages/h2a/src/runtime/mcp/handlers.ts`
  - `packages/h2a-runtime/src/launch-track-dir.ts`
  - `packages/h2a-runtime/src/launch-track-dir.test.ts`
  - `packages/h2a-runtime/src/tmux.ts`
  - `packages/h2a-runtime/src/native-host.ts`
  - `packages/h2a-runtime/src/index.ts`
  - `packages/h2a/test/gov-conductor-claim.test.js`
  - `packages/h2a/test/track-write-policy-integration.test.js`
  - `packages/h2a/test/owner-table-matrix.test.js`
  - `docs/governance/working-mode.md`
  - `plan/10-BRANCH_track-owner-table-lot-4b-h2a-wiring.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.track/**`
  - `packages/track/**`
  - `packages/h2a/src/runtime/governance/conductor.ts`
  - `packages/h2a/src/runtime/governance/claims.ts`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/h2a/src/cli-contract.ts`, `docs/contracts/golden/**` (only if a flag is added to `conductor claim`)
  - `packages/h2a-runtime/src/conductor-launch.ts` (only to pass the journal to a conductor it launches)
  - `docs/governance/RACI.md`
- **Exception process**:
  - Declare exception ID `BR810-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

- [ ] `attention` to `cond`: record here the output of `track journal status` and `track journal which` on this repository after merge, from the main checkout and from one linked worktree.
- [ ] `attention` to `arch`: the documented reach of the single-writer rule differs between `working-mode.md` and the more recent owner rule (spec open question OQ-2). This lot documents the mechanism in `working-mode.md` and does not settle the reach.
- [ ] `attention` to `runtime`: list every launch path that sets environment for a session and confirm each one is covered by Lot 2.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch** (the claim, the launch environment and the matrix are checked by one integration run)
- [ ] **Multi-branch**
- Rationale: T4b-a needs the claim and the launch change together.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline and red tests**
  - [ ] Read spec sections 6.3 and 7.4; read `packages/h2a/src/cli.ts` lines 5743-5825 (`resolveConductorWorkspaceId`, `cmdConductor`), `packages/h2a/src/runtime/mcp/handlers.ts` near lines 1195 and 1234 (the MCP claim), `packages/h2a-runtime/src/tmux.ts` near line 377 and `packages/h2a-runtime/src/native-host.ts` near lines 623-630, 716-721, 944-948 and 1252 (where a launched session receives its environment), `packages/h2a/src/cli.ts` lines 7996-8098 (how h2a runs Track in-process).
  - [ ] Create the worktree under `tmp/worktrees/`; `npm ci`; `npm run build`.
  - [ ] Baseline green: `node --test packages/h2a/test/gov-conductor-claim.test.js packages/h2a/test/gov-conductor.test.js`.
  - [ ] Tests (red first):
    - [ ] `T4b-a` — `packages/h2a/test/gov-conductor-claim.test.js` — after a conductor's claim a session launched in a clone reads and feeds the designated journal (T4b-a)
    - [ ] `T4b-b` — `packages/h2a/test/track-write-policy-integration.test.js` — on a journal held by its conductor an ordinary session appends no event through any write verb (T4b-b)
    - [ ] `T4b-c` — `packages/h2a-runtime/src/launch-track-dir.test.ts` — a launched session receives TRACK_DIR when the project has a designated journal and none otherwise (T4b-c)
    - [ ] `T4b-d` — `packages/h2a/test/owner-table-matrix.test.js` — every cell of six CLIs by four kinds of folder renders or refuses with a motif, never silently empty (T4b-d)
  - [ ] T4b-b iterates over the facade's write verbs (`TRACK_NATIVE_WRITE_VERBS`) and asserts each is refused without the token and that the journal's fingerprint is unchanged.
  - [ ] T4b-d: the four kinds of folder are a repository with a journal, a linked worktree, a repository without a journal and a folder outside git; for each CLI the test uses the registered capture mode and asserts the report either renders with a header naming its scope or refuses with one of the four gates.
  - [ ] Red today: a claim designates nothing; no launch path sets `TRACK_DIR`.
  - [ ] Lot gate:
    - [ ] The four tests fail for those reasons; outputs saved.

- [ ] **Lot 1 — Designation at a claim**
  - [ ] Create `packages/h2a/src/runtime/governance/journal-designation.ts`: given the folder a claim is made from, it runs `track journal designate <that repository's journal> --by <instance>` in-process, and returns what Track recorded. A repository without a journal designates nothing and says so.
  - [ ] Call it from `cmdConductor` on `claim` and from the MCP claim handler, after the claim event is appended; a failure of the designation is reported in the result and does not undo the claim.
  - [ ] A `release` designates nothing and removes nothing: a designation outlives a conductor.
  - [ ] Lot gate:
    - [ ] `node --test packages/h2a/test/gov-conductor-claim.test.js` — the designation cases green; existing titles unchanged and green.

- [ ] **Lot 2 — The journal given to launched sessions**
  - [ ] Create `packages/h2a-runtime/src/launch-track-dir.ts`: `trackDirForLaunch(cwd)` asks Track which journal is designated for the project of `cwd` (`track journal which --format json`) and returns it only when the resolution step is a designation.
  - [ ] Set `TRACK_DIR` from it at each place a launched session receives its environment (`tmux.ts`, `native-host.ts`, and the launch paths of `index.ts`), beside the existing session-class variable.
  - [ ] Give `TRACK_WRITER_TOKEN` only when the launch is the holder's own conductor session and the token file is supplied by the launcher; never infer it.
  - [ ] Lot gate:
    - [ ] `npx --no-install vitest run packages/h2a-runtime/src/launch-track-dir.test.ts` — T4b-c green.
    - [ ] `node --test packages/h2a/test/gov-conductor-claim.test.js` — T4b-a green.

- [ ] **Lot 3 — Held journal and matrix**
  - [ ] Add `track-write-policy-integration.test.js` and `owner-table-matrix.test.js` as specified in Lot 0.
  - [ ] In `docs/governance/working-mode.md`, replace the sentence that states the single writer as a convention by the mechanism: the journal declares its holder, Track refuses every other append, a takeover is explicit.
  - [ ] Lot gate:
    - [ ] `node --test packages/h2a/test/track-write-policy-integration.test.js packages/h2a/test/owner-table-matrix.test.js` — T4b-b, T4b-d green.

- [ ] **Lot 4 — Final validation**
  - [ ] `npm run typecheck`
  - [ ] `node --test packages/h2a/test/gov-conductor-claim.test.js packages/h2a/test/gov-conductor.test.js packages/h2a/test/track-write-policy-integration.test.js packages/h2a/test/owner-table-matrix.test.js`
  - [ ] `npx --no-install vitest run packages/h2a-runtime/src/launch-track-dir.test.ts`
  - [ ] `bash scripts/check-public-contract.sh` and `bash scripts/check-no-python.sh`
  - [ ] Operation of the conductor, outside CI: from a linked worktree of this repository, `track journal which` names the main checkout's journal and a write verb run without the token is refused; both outputs are attached.
  - [ ] Open the pull request in English with red and green evidence; follow CI to green; do not merge.
  - [ ] Acceptance criteria: T4b-a to T4b-d green on Node 22 and 24; the conductor election tests unchanged; no cell of the matrix is empty without a motif.
