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
- [ ] **Two packages that cannot import each other.** The core package depends on Track and runs it in-process; the runtime package depends neither on the core package nor on Track (`scripts/check-public-contract.sh:37-41`). So the designation is made by the core package, and the runtime package reads the result as a **file contract**: Track's index `journals.json`, whose schema lot 4a versions. No dependency is added between the two packages.
- [ ] A claim designates only the journal of the repository identified by its explicit path, or by the CLI working directory when no workspace was supplied. An identifier-only claim never designates; MCP never falls back to server `cwd` or `root`.
- [ ] `TRACK_DIR` is given to a launched session only when the index holds a designation for its project. A session launched without one resolves as Track decides.
- [ ] This lot never copies a writer token into a launched session's environment. The holder of an exclusive journal points its own session at its token file.
- [ ] The election of a conductor is not changed by this lot. The mismatch between the workspace identifier of live sessions and that of a default claim (spec annex D, conductor resolution) is reported, not fixed here.
- [ ] Never run an installed `h2a` binary from a shell; tests use temporary roots, a temporary `TRACK_STATE_HOME`, and stop only processes they started.
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
  - `packages/h2a/package.json` and `packages/h2a-runtime/package.json` (no dependency may be added between the two packages, nor from the runtime package to Track)
  - `packages/h2a/src/runtime/governance/conductor.ts`
  - `packages/h2a/src/runtime/governance/claims.ts`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/h2a/src/cli-contract.ts`, `docs/contracts/golden/**` (only if a flag is added to `conductor claim`)
  - `packages/h2a-runtime/src/conductor-launch.ts` (read for the project-identity formula it already holds; changed only to share that helper inside the runtime package)
  - `docs/governance/RACI.md`
- **Exception process**:
  - Declare exception ID `BR810-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

- [ ] `attention` to `cond`: record here the output of `track journal status` and `track journal which` on this repository after merge, from the main checkout and from one linked worktree.
- [ ] `attention` to `cond`: apply the more recent owner rule (spec OQ-2 resolved): exclusivity is mandatory on this repository after 3a, optional on explicit declaration elsewhere. Align `working-mode.md` in Lot 3; no new owner arbitration is needed.
- [ ] `attention` to `runtime`: list every launch path that sets environment for a session and confirm each one is covered by Lot 2.
- [ ] `attention` to `track`: this lot reads `journals.json` directly; a change of its schema must raise its version, and the reader of Lot 2 refuses a version it does not know.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch** (the claim, the launch environment and the matrix are checked by one integration run)
- [ ] **Multi-branch**
- Rationale: T4b-a needs the claim and the launch change together.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline and red tests**
  - [ ] Read spec sections 6.3, 7.4 and 8; read `packages/h2a/src/cli.ts` lines 5743-5825 (`resolveConductorWorkspaceId`, `cmdConductor`) and 7996-8098 (how the core package runs Track in-process); `packages/h2a/src/runtime/mcp/handlers.ts` near line 1195 (the MCP claim; the release handler follows near line 1234); `packages/h2a-runtime/src/conductor-launch.ts` lines 258-283 and `packages/h2a-runtime/src/gateway-host/live-registration.ts` lines 240-245 (the project-identity formula the runtime package already holds); `packages/h2a-runtime/src/tmux.ts` near line 377 and `packages/h2a-runtime/src/native-host.ts` near lines 623-630, 716-721, 944-948 and 1252 (where a launched session receives its environment); the index schema and the JSON of `journal which` in the plan of lot 4a.
  - [ ] Create the worktree under `tmp/worktrees/`; `npm ci`; `npm run build`.
  - [ ] Baseline green: `node --test packages/h2a/test/gov-conductor-claim.test.js packages/h2a/test/gov-conductor.test.js`.
  - [ ] Tests (red first):
    - [ ] `T4b-a` — `packages/h2a/test/gov-conductor-claim.test.js` — after a conductor's claim a session launched in a clone reads and feeds the designated journal (T4b-a)
    - [ ] `T4b-b` — `packages/h2a/test/track-write-policy-integration.test.js` — on a journal held by its conductor an ordinary session appends no event through any write verb (T4b-b)
    - [ ] `T4b-c` — `packages/h2a-runtime/src/launch-track-dir.test.ts` — a launched session receives TRACK_DIR when the project has a designated journal and none otherwise (T4b-c)
    - [ ] `T4b-d` — `packages/h2a/test/owner-table-matrix.test.js` — every cell of six CLIs by four kinds of folder renders or refuses with a motif, never silently empty (T4b-d)
  - [ ] T4b-b iterates over the facade's write verbs (`TRACK_NATIVE_WRITE_VERBS`) and asserts each is refused without the token and that the journal's fingerprint is unchanged.
  - [ ] T4b-a uses unrelated disposable repositories A and B plus a linked worktree. CLI cases: no workspace designates A from A; an explicit B path from A designates only B; `--workspace ws:...` from A records the claim but changes no designation. MCP cases: explicit absolute B path designates only B despite server cwd/root in A; workspaceId alone, absent/invalid/`ws:` workspacePath, and inconsistent workspaceId/path change no designation and return the reason. A repository without a journal also skips; release never changes the index. Assert both repositories' index entries before/after, with inherited `TRACK_DIR` pointing elsewhere, and retain the successful clone-launch case.
  - [ ] T4b-c is also the conformance test of the file contract: it designates a journal with the built Track CLI of this checkout on a temporary state home, then asserts the runtime reader returns the path `track journal which --format json` reports; it asserts the reader returns nothing for an index of an unknown version.
  - [ ] T4b-c covers foreground launch through `runLocalCliForeground` as well as tmux and native-host launches, and keeps the tmux session-class pair last. No launch receives the writer token.
  - [ ] T4b-d: the four kinds of folder are a repository with a journal, a linked worktree, a repository without a journal and a folder outside git, all under the temporary root; for each CLI the test registers a capture mode with `track capture register` and asserts the report either renders with a header naming its scope or refuses with one of the four gates.
  - [ ] Red today: a claim designates nothing; no launch path sets `TRACK_DIR`.
  - [ ] Lot gate:
    - [ ] The four tests fail for those reasons; outputs saved.

- [ ] **Lot 1 — Designation at a claim (core package)**
  - [ ] Create `packages/h2a/src/runtime/governance/journal-designation.ts`: given a validated claim folder, it runs `track journal designate <that repository's journal> --by <instance>` in-process, the way the facade already runs Track. Resolve the repository at that folder, using its main checkout for a linked worktree; ignore inherited `TRACK_DIR` and never search another project's journal. No repository or no journal means no designation and no journal creation.
  - [ ] CLI folder selection in `cmdConductor`: absent `flags.workspace` uses `streams.cwd()` (or the existing CLI cwd fallback); a path uses that path, resolving relative paths against the invocation's cwd; a value starting `ws:` skips designation. Do not derive a folder from a workspace identifier.
  - [ ] MCP folder selection in `handleConductorClaim`: only a nonempty, existing absolute `args.workspacePath` outside the `ws:` form is eligible. With `workspaceId` alone, or an invalid path, skip; never fall back to `process.cwd()` or `root`. If both fields are supplied, compare the identifier with the existing claim resolver's `deriveWorkspaceId` for the real path; disagreement skips designation. Do not replace the conductor's identity formula with Track's project-identity formula.
  - [ ] Call the helper after the claim event is appended. Preserve the claim result and add `journalDesignation: { status: 'designated' | 'skipped' | 'failed', reason?: string }` in CLI JSON and MCP response. Skips use `workspace-id-only`, `missing-workspace-path`, `invalid-workspace-path`, `workspace-mismatch`, `not-a-repository` or `no-journal` as applicable; failures use `designation-failed` with the existing safe error reporting. A skip or failure never undoes the claim or changes the election.
  - [ ] A `release` designates nothing and removes nothing: a designation outlives a conductor.
  - [ ] Lot gate:
    - [ ] `node --test packages/h2a/test/gov-conductor-claim.test.js` — the designation cases green; existing titles unchanged and green.

- [ ] **Lot 2 — The journal given to launched sessions (runtime package)**
  - [ ] Create `packages/h2a-runtime/src/launch-track-dir.ts`: `trackDirForLaunch(cwd, env)` computes the project identity with the formula the runtime package already holds, locates Track's state home by the rule of the spec (`TRACK_STATE_HOME`, else `sentropic/track` under `XDG_STATE_HOME`, else under `.local/state` of the home directory), reads `journals.json`, and returns the path of the designated reference of that identity — or nothing when the file is absent, its version is unknown, or no reference is recorded. It writes nothing and calls no binary.
  - [ ] Set `TRACK_DIR` from it at each place a launched session receives its environment (`tmux.ts`, `native-host.ts`, and the launch paths of `index.ts`, explicitly including the `runLocalCliForeground` path). In `tmuxEnvironmentArgs`, insert the `-e TRACK_DIR=...` pair before `-e H2A_SESSION_CLASS=...`; the session-class pair must stay last, as `restore-dead-session-recovery.test.js` requires.
  - [ ] Lot gate:
    - [ ] `npx --no-install vitest run packages/h2a-runtime/src/launch-track-dir.test.ts` — T4b-c green.
    - [ ] `node --test packages/h2a/test/gov-conductor-claim.test.js` — T4b-a green.
    - [ ] `bash scripts/check-public-contract.sh` — the core package is still a leaf.

- [ ] **Lot 3 — Held journal and matrix**
  - [ ] Add `track-write-policy-integration.test.js` and `owner-table-matrix.test.js` as specified in Lot 0.
  - [ ] In `docs/governance/working-mode.md`, replace the older three-repository single-writer convention by the current owner rule and mechanism: journals are open by default; this repository declares its holder immediately after 3a and before hooks activate; other repositories activate exclusivity only on their conductor's explicit initiative. Track refuses writes without the holder's token; takeover is explicit. Keep the ceiling of six open PRs and prepare waiting worktrees without opening another PR when it is reached.
  - [ ] Lot gate:
    - [ ] `node --test packages/h2a/test/track-write-policy-integration.test.js packages/h2a/test/owner-table-matrix.test.js` — T4b-b, T4b-d green.

- [ ] **Lot 4 — Final validation**
  - [ ] `npm run typecheck`
  - [ ] `node --test packages/h2a/test/gov-conductor-claim.test.js packages/h2a/test/gov-conductor.test.js packages/h2a/test/track-write-policy-integration.test.js packages/h2a/test/owner-table-matrix.test.js packages/h2a/test/restore-dead-session-recovery.test.js`
  - [ ] `npx --no-install vitest run packages/h2a-runtime/src/launch-track-dir.test.ts`
  - [ ] `bash scripts/check-public-contract.sh` and `bash scripts/check-no-python.sh`
  - [ ] Operation of the conductor, outside CI: from a linked worktree of this repository, `track journal which` names the main checkout's journal and a write verb run without the token is refused; both outputs are attached.
  - [ ] Open the pull request in English with red and green evidence; follow CI to green; do not merge.
  - [ ] Acceptance criteria: T4b-a to T4b-d green on Node 22 and 24; the conductor election tests unchanged; no cell of the matrix is empty without a motif; no dependency added between the two packages.
