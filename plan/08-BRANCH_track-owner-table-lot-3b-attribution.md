# Feature: Track owner table — delivery lot 3b (attribution of a captured message)

## Objective

- [ ] A captured message is attributed to the owner only when it was typed by the owner in a human session.
- [ ] An injected line, a sub-agent and a background session are never attributed to the owner; a doubtful origin is marked and never quoted.
- [ ] Contract: `docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md`, sections 3 (V9) and 7.6, tests T3b-a to T3b-e.

## Scope / Guardrails

- [ ] Accountable: `runtime`. Responsible: `runtime`. Consulted: `agents`, `coop`, `cyber`.
- [ ] Prerequisite: lot 3a is merged (it defines the origin classes and the `--origin` argument of `track capture add`).
- [ ] The human-activity signal of the native terminal is **not** a criterion: an injection is counted as human there (`packages/h2a-runtime/src/native-terminal/op.ts:303-314`, `server.ts:131-136`). T3b-e pins that it is not used.
- [ ] When the evidence does not decide, the origin is `doubtful`. It is never rounded to `owner`.
- [ ] Track stays autonomous: this lot adds no h2a knowledge to Track. h2a computes the origin and passes it to the Track command.
- [ ] An injected text is recognised by a marker or by the injection ledger of this lot, never by guessing from its wording.
- [ ] The ledger stores digests and times, never the injected text.
- [ ] Out of scope, do not start: installing the hook in a CLI (lot 3c); changing how wake, drive or relaunch decide to inject.
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
  - `packages/h2a/hooks/capture-origin.mjs`
  - `packages/h2a/test/capture-origin.test.js`
  - `packages/h2a-runtime/src/injection-ledger.ts`
  - `packages/h2a-runtime/src/injection-ledger.test.ts`
  - `packages/h2a-runtime/src/prompt-delivery.ts`
  - `packages/h2a-runtime/src/relaunch.ts`
  - `packages/h2a-runtime/src/native-host.ts`
  - `packages/h2a-runtime/src/tmux.ts`
  - `packages/h2a-runtime/src/index.ts`
  - `packages/h2a/src/runtime/drumbeat/relaunchers.ts`
  - `plan/08-BRANCH_track-owner-table-lot-3b-attribution.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.track/**`
  - `packages/track/**`
  - `packages/h2a-runtime/src/native-terminal/**`
  - `packages/h2a/src/runtime/drive/**`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/h2a/package.json` (only to list the new hook file in `files`)
  - `packages/h2a/test/package-plugin-manifest.test.js`
  - `packages/h2a-runtime/src/session-class.ts` (read-only reference)
  - `packages/h2a/src/hosts/capture-qualification.json` (read for the sub-agent marker per CLI; changed only by lot 3q)
- **Exception process**:
  - Declare exception ID `BR808-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

- [ ] `attention` to `coop`: the injection paths of wake, drive and relaunch each gain one ledger write; no injection decision changes. Review the list of paths in Lot 2.
- [ ] `attention` to `agents`: the sub-agent marker of each CLI comes from lot 3q's results; a CLI without a proven marker yields `doubtful` for anything that is not a top-level human session.
- [ ] `attention` to `cond`: a prompt passed on the command line of a launch is delivered by injection and is therefore classified `injected`; the owner's first words given that way are not captured as a demand. This is a stated limit, not a defect to patch here.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch** (the classifier and the ledger it reads are tested together)
- [ ] **Multi-branch**
- Rationale: the classifier is only meaningful against real ledger writes.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline and red tests**
  - [ ] Read spec section 7.6; read `packages/h2a-runtime/src/session-class.ts` (`H2A_SESSION_CLASS`: `human` or `background`), `packages/h2a-runtime/src/enroll.ts` lines 139-159 (`REMOTE_JOB_ID` forces background), `packages/h2a/hooks/vibe-post-agent.mjs` (a root `parent_session_id` that is not null means sub-agent), `packages/agent-stats/src/codex-rollout.ts` lines 96-118 and 169-193 (Codex sub-agent source), `packages/h2a/src/wake.ts` lines 46-58 and `packages/h2a/src/runtime/drive/index.ts` lines 246-264 (markers), `packages/h2a-runtime/src/prompt-delivery.ts` near line 489, `packages/h2a-runtime/src/relaunch.ts` lines 327-376.
  - [ ] Create the worktree under `tmp/worktrees/`; `npm ci`; `npm run build`.
  - [ ] Tests (red first):
    - [ ] `T3b-a` — `packages/h2a/test/capture-origin.test.js` — a line injected by wake, drive, restart, relaunch or an initial prompt is never attributed to the owner (T3b-a)
    - [ ] `T3b-b` — `packages/h2a/test/capture-origin.test.js` — a message from a sub-agent is never attributed to the owner (T3b-b)
    - [ ] `T3b-c` — `packages/h2a/test/capture-origin.test.js` — a message from a background or delegated session is never attributed to the owner (T3b-c)
    - [ ] `T3b-d` — `packages/h2a/test/capture-origin.test.js` — an origin the evidence does not decide is doubtful, and a doubtful capture is never quoted by the table (T3b-d)
    - [ ] `T3b-e` — `packages/h2a/test/capture-origin.test.js` — native-terminal human activity does not change the classification (T3b-e)
  - [ ] T3b-a is table-driven: one case per injection path, each with the marker or the ledger entry that path produces.
  - [ ] T3b-d ends in the reader: it captures a doubtful entry through the built Track CLI on a temporary state home and asserts the table shows it marked and without quotation marks.
  - [ ] Red today: no classifier and no ledger exist; relaunch and initial prompts carry no marker.
  - [ ] Lot gate:
    - [ ] The five tests fail for those reasons; outputs saved.

- [ ] **Lot 1 — Classifier**
  - [ ] Create `packages/h2a/hooks/capture-origin.mjs`, a dependency-free Node script with an exported pure function `classifyOrigin({ cli, payload, env, ledger })` returning the origin class and a one-line reason.
  - [ ] Rules, first match wins: a `REMOTE_JOB_ID` or a session class other than `human` yields `background`; a sub-agent marker of the CLI (per lot 3q's table) yields `subagent`; a text starting with `[h2a `, `[h2a-wake ` or `[h2a restart]` yields `injected`; a text whose digest is in the session's ledger within its window yields `injected`; a human-class top-level session with none of these yields `owner`; a session with no class at all yields `doubtful`.
  - [ ] Run as a hook, the script reads the payload on standard input, classifies, and invokes `track capture add --cli <cli> --origin <class> --stdin` with the same payload. It prints nothing on standard output and always exits 0.
  - [ ] When no Track binary resolves, it reports on the error stream and exits 0: the CLI is never blocked.
  - [ ] Lot gate:
    - [ ] `node --test packages/h2a/test/capture-origin.test.js` — T3b-b, T3b-c, T3b-e green; the marker cases of T3b-a green.

- [ ] **Lot 2 — Injection ledger**
  - [ ] Create `packages/h2a-runtime/src/injection-ledger.ts`: `recordInjection(session, text)` appends the digest of the text and the time to a per-session file under the runtime state root, mode 0600; `wasInjected(session, text, windowMs)` answers from that file; entries older than the window are dropped at write.
  - [ ] Call `recordInjection` at each path that types into a session on behalf of something other than the human: `deliverInitialPrompt` (`prompt-delivery.ts`), the relaunch continuation and `wakeRelaunchedSession` (`relaunch.ts`), `driveNativeInstruction` and the literal, paste and enter helpers (`native-host.ts`), `relaunchInSession` and `sendKeysLiteral` (`tmux.ts`), the wake-request watcher (`index.ts`), `tmuxSendSubmit` (`relaunchers.ts`).
  - [ ] No path changes what it injects or when.
  - [ ] Lot gate:
    - [ ] `npx --no-install vitest run packages/h2a-runtime/src/injection-ledger.test.ts packages/h2a-runtime/src/prompt-delivery.test.ts packages/h2a-runtime/src/relaunch.test.ts`
    - [ ] `node --test packages/h2a/test/capture-origin.test.js` — T3b-a (all paths) and T3b-d green.

- [ ] **Lot 3 — Final validation**
  - [ ] `npm run typecheck`
  - [ ] `node --test packages/h2a/test/capture-origin.test.js packages/h2a/test/wake.test.js packages/h2a/test/wake-defer.test.js packages/h2a/test/drive.test.js`
  - [ ] `npx --no-install vitest run packages/h2a-runtime/src/injection-ledger.test.ts packages/h2a-runtime/src/prompt-delivery.test.ts packages/h2a-runtime/src/relaunch.test.ts`
  - [ ] `bash scripts/check-public-contract.sh` and `bash scripts/check-no-python.sh`
  - [ ] Open the pull request in English with red and green evidence and the list of instrumented injection paths; follow CI to green; do not merge.
  - [ ] Acceptance criteria: T3b-a to T3b-e green on Node 22 and 24; the existing wake, drive and relaunch tests unchanged and green; the ledger files hold no text.
