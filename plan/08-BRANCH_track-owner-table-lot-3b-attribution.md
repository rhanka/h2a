# Feature: Track owner table — delivery lot 3b (attribution of a captured message)

## Objective

- [ ] A captured message is attributed to the owner only on positive proof of a human session and with no sign of an injected line, a sub-agent or a background session.
- [ ] Those three are never attributed to the owner; an origin that nothing proves is `doubtful`, marked and never quoted.
- [ ] Contract: `docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md`, sections 3 (V9), 7.6 and 8 (file contracts), decision DS-9, tests T3b-a to T3b-e.

## Scope / Guardrails

- [ ] Accountable: `runtime`. Responsible: `runtime`. Consulted: `agents`, `coop`, `cyber`.
- [ ] Prerequisites: lot 3a is merged (it defines the origin classes and the `--origin` argument of `track capture add`) and lot 3q is merged (it records, per CLI, the sign of a human session and the marker of a sub-agent call).
- [ ] The human-activity signal of the native terminal is **not** a criterion: an injection is counted as human there (`packages/h2a-runtime/src/native-terminal/op.ts:303-314`, `server.ts:131-136`). T3b-e pins that it is not used.
- [ ] `owner` needs positive proof. When the evidence does not decide, the origin is `doubtful`; it is never rounded to `owner`.
- [ ] Track stays autonomous: this lot adds no h2a knowledge to Track. h2a computes the origin and passes it to the Track command.
- [ ] **Two packages that cannot import each other.** The core package must stay a leaf (`scripts/check-public-contract.sh:37-41`) and the runtime package depends neither on it nor on Track. The record of injected lines is therefore a **file contract** (Lot 2), written by a small implementation in each package and read by the hook script; the three are held together by one shared set of conformance vectors, never by an import.
- [ ] An injected text is recognised by a marker or by that record, never by guessing from its wording. The record stores digests and times, never the injected text.
- [ ] Out of scope, do not start: installing the hook in a CLI (lot 3c); changing how wake, drive or relaunch decide to inject.
- [ ] Never run an installed `h2a` binary from a shell; tests use temporary roots and a temporary state folder, and stop only processes they started.
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
  - `packages/h2a/hooks/track-bin.mjs`
  - `packages/h2a/fixtures/injection-ledger-vectors.json`
  - `packages/h2a/src/runtime/drumbeat/injection-ledger.ts`
  - `packages/h2a/src/runtime/drumbeat/relaunchers.ts`
  - `packages/h2a/test/capture-origin.test.js`
  - `packages/h2a/test/injection-ledger.test.js`
  - `packages/h2a-runtime/src/injection-ledger.ts`
  - `packages/h2a-runtime/src/injection-ledger.test.ts`
  - `packages/h2a-runtime/src/prompt-delivery.ts`
  - `packages/h2a-runtime/src/relaunch.ts`
  - `packages/h2a-runtime/src/native-host.ts`
  - `packages/h2a-runtime/src/tmux.ts`
  - `packages/h2a-runtime/src/index.ts`
  - `plan/08-BRANCH_track-owner-table-lot-3b-attribution.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.track/**`
  - `packages/track/**`
  - `packages/h2a/package.json` and `packages/h2a-runtime/package.json` (no dependency may be added between the two packages)
  - `packages/h2a-runtime/src/native-terminal/**`
  - `packages/h2a/src/runtime/drive/**`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/h2a/test/package-plugin-manifest.test.js` (only if it pins the list of shipped hook files)
  - `packages/h2a-runtime/src/session-class.ts` (read-only reference)
  - `packages/h2a/fixtures/capture-qualification.json` (read; changed only by lot 3q)
- **Exception process**:
  - Declare exception ID `BR808-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

- [ ] `attention` to `coop`: the injection paths of wake, drive and relaunch each gain one record write; no injection decision changes. Review the list of paths in Lot 2.
- [ ] `attention` to `agents`: the marker of a sub-agent call and the sign of a human session come from lot 3q's table; a CLI for which the table gives neither yields `doubtful` for every capture that is not excluded.
- [ ] `attention` to `cond`: a session the owner starts by hand, outside any launcher, is `owner` only if lot 3q found a sign of an interactive session for that CLI; otherwise its captures are `doubtful` — tracked, unquoted. A prompt passed on the command line of a launch is delivered by injection and is `injected`. Both are stated limits of the spec, not defects to patch here.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch** (the classifier and the record it reads are tested together)
- [ ] **Multi-branch**
- Rationale: the classifier is only meaningful against real record writes.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline and red tests**
  - [ ] Read spec sections 7.6 and 8; read `packages/h2a-runtime/src/session-class.ts` (`H2A_SESSION_CLASS`: `human` or `background`), `packages/h2a-runtime/src/enroll.ts` lines 139-159 (`REMOTE_JOB_ID` forces background; a session no launcher started has no class), `packages/h2a/hooks/vibe-post-agent.mjs` (a root `parent_session_id` that is not null means sub-agent), `packages/h2a/fixtures/capture-qualification.json` of lot 3q, `packages/h2a/src/wake.ts` lines 46-58 and `packages/h2a/src/runtime/drive/index.ts` lines 246-264 (markers), `packages/h2a/src/runtime/drumbeat/relaunchers.ts` lines 150-170, `packages/h2a-runtime/src/prompt-delivery.ts` near line 489, `packages/h2a-runtime/src/relaunch.ts` lines 327-376, `packages/h2a-runtime/src/native-host.ts` near lines 620-630 (the session name given to a native session in its environment).
  - [ ] Create the worktree under `tmp/worktrees/`; `npm ci`; `npm run build`.
  - [ ] Tests (red first):
    - [ ] `T3b-a` — `packages/h2a/test/capture-origin.test.js` — a line injected by wake, drive, restart, relaunch or an initial prompt is never attributed to the owner (T3b-a)
    - [ ] `T3b-b` — `packages/h2a/test/capture-origin.test.js` — a message from a sub-agent is never attributed to the owner (T3b-b)
    - [ ] `T3b-c` — `packages/h2a/test/capture-origin.test.js` — a message from a background or delegated session is never attributed to the owner (T3b-c)
    - [ ] `T3b-d` — `packages/h2a/test/capture-origin.test.js` — an origin the evidence does not prove is doubtful, and a doubtful capture is never quoted by the table (T3b-d)
    - [ ] `T3b-e` — `packages/h2a/test/capture-origin.test.js` — native-terminal human activity does not change the classification (T3b-e)
  - [ ] T3b-a is table-driven: one case per injection path, each with the marker or the record entry that path produces.
  - [ ] T3b-d covers three cases — a session with no class and no qualified sign, a class with an unknown value, an unparsable payload — and ends in the reader: it captures a doubtful entry through the built Track CLI on a temporary state home and asserts the table shows it marked and without quotation marks.
  - [ ] Red today: no classifier and no record exist; relaunch and initial prompts carry no marker.
  - [ ] Lot gate:
    - [ ] The five tests fail for those reasons; outputs saved.

- [ ] **Lot 1 — Classifier and Track binary resolution**
  - [ ] Create `packages/h2a/hooks/track-bin.mjs`, dependency-free: it returns the Track `bin.js` from, in order, `TRACK_BIN`; the Track package found by walking up from the hook script's own folder through `node_modules/@sentropic/track`; the global npm prefix. It never falls back to a bare `track` on `PATH` and never looks at the current directory.
  - [ ] Create `packages/h2a/hooks/capture-origin.mjs`, dependency-free, invoked as `node capture-origin.mjs --cli <cli> [--text-key <key>]` with the hook payload on standard input. It exports a pure function `classifyOrigin({ cli, payload, env, qualification, ledger })` returning the origin class and a one-line reason.
  - [ ] Rules, first match wins: an unparsable payload yields `doubtful`; a `REMOTE_JOB_ID`, or a session class `background`, yields `background`; a session class present with any value other than `human` or `background` yields `doubtful`; the sub-agent marker of the CLI's qualification entry yields `subagent`; a text starting with `[h2a `, `[h2a-wake ` or `[h2a restart]`, or whose digest is in the session's record within its window, yields `injected`; a session class `human`, or the qualified sign of an interactive session for that CLI, yields `owner`; anything else yields `doubtful`.
  - [ ] Run as a hook, the script classifies, then runs `track capture add --cli <cli> --origin <class> [--text-key <key>] --stdin` with the same payload; Track itself reads the session, the folder and the transcript from the payload. The script prints nothing on standard output and always exits 0.
  - [ ] When no Track binary resolves, it reports on the error stream and exits 0: the CLI is never blocked.
  - [ ] Lot gate:
    - [ ] `node --test packages/h2a/test/capture-origin.test.js` — T3b-b, T3b-c, T3b-e green; the marker cases of T3b-a green.

- [ ] **Lot 2 — Record of injected lines, as a file contract**
  - [ ] Contract. Folder: `injected/` under h2a's state folder (`h2a` under `XDG_STATE_HOME`, else under `.local/state` of the home directory), mode 0700. One file per session, named by the SHA-256 hex digest of the session key, mode 0600. Session key: `native:<name>` for a native session, the name being the one the launcher gives the session in `H2A_NATIVE_PTY_SESSION`; `tmux:<name>` for a tmux session, the name being the tmux session name.
  - [ ] Contract, continued. One JSON line per injection: `{ "at": <epoch milliseconds>, "digest": <SHA-256 hex of the normalised text> }`. Normalisation: every carriage return followed by a line feed, and every lone carriage return, becomes a line feed; trailing line breaks are removed; surrounding white space is trimmed; the result is hashed as UTF-8. Window: an entry counts for 120 seconds; older entries are dropped at each write and ignored at each read.
  - [ ] Create `packages/h2a/fixtures/injection-ledger-vectors.json`: session keys with their file names, texts with their normalised form and digest, and timed sequences with the expected answer inside and outside the window.
  - [ ] Create the writer of the runtime package, `packages/h2a-runtime/src/injection-ledger.ts` (`recordInjection(sessionKey, text)`), and the writer of the core package, `packages/h2a/src/runtime/drumbeat/injection-ledger.ts`, each implementing the contract on its own. Neither imports the other.
  - [ ] Each package has a test that reads the same vectors file by its path in the repository and proves its implementation agrees: `packages/h2a-runtime/src/injection-ledger.test.ts` and `packages/h2a/test/injection-ledger.test.js`. The second also proves that the reader inside `capture-origin.mjs` agrees.
  - [ ] Call the runtime writer at each runtime path that types into a session on behalf of something other than the human: `deliverInitialPrompt` (`prompt-delivery.ts`), the relaunch continuation and `wakeRelaunchedSession` (`relaunch.ts`), `driveNativeInstruction` and the literal, paste and enter helpers (`native-host.ts`), `relaunchInSession` and `sendKeysLiteral` (`tmux.ts`), the wake-request watcher (`index.ts`). Call the core writer in `tmuxSendSubmit` (`relaunchers.ts`).
  - [ ] No path changes what it injects or when.
  - [ ] Lot gate:
    - [ ] `npx --no-install vitest run packages/h2a-runtime/src/injection-ledger.test.ts packages/h2a-runtime/src/prompt-delivery.test.ts packages/h2a-runtime/src/relaunch.test.ts`
    - [ ] `node --test packages/h2a/test/injection-ledger.test.js packages/h2a/test/capture-origin.test.js` — T3b-a (all paths) and T3b-d green.
    - [ ] `bash scripts/check-public-contract.sh` — the core package is still a leaf.

- [ ] **Lot 3 — Final validation**
  - [ ] `npm run typecheck`
  - [ ] `node --test packages/h2a/test/capture-origin.test.js packages/h2a/test/injection-ledger.test.js packages/h2a/test/wake.test.js packages/h2a/test/wake-defer.test.js packages/h2a/test/drive.test.js`
  - [ ] `npx --no-install vitest run packages/h2a-runtime/src/injection-ledger.test.ts packages/h2a-runtime/src/prompt-delivery.test.ts packages/h2a-runtime/src/relaunch.test.ts`
  - [ ] `bash scripts/check-public-contract.sh` and `bash scripts/check-no-python.sh`
  - [ ] Open the pull request in English with red and green evidence, the file contract and the list of instrumented injection paths; follow CI to green; do not merge.
  - [ ] Acceptance criteria: T3b-a to T3b-e green on Node 22 and 24; the existing wake, drive and relaunch tests unchanged and green; the record files hold no text; no dependency added between the two packages.
