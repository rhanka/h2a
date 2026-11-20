# Feature: Track owner table — delivery lot 3a (capture queue, commands and write policy)

## Objective

- [ ] A protected, machine-local capture queue, with the commands that capture, classify, inscribe and acknowledge.
- [ ] A journal is open by default; an exclusive writer exists by declaration, checked under the journal lock on every append; no takeover is automatic.
- [ ] Secrets are masked at capture, private terms at inscription into a versioned journal, and an unclassified text is purged after a bounded delay.
- [ ] Contract: `docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md`, sections 3 (V6 to V8, V10) and 7, decisions DS-2, DS-3, DS-4, tests T3a-a to T3a-n.

## Scope / Guardrails

- [ ] Accountable: `track`. Responsible: `track`. Consulted: `cyber` (blocking), `cond`.
- [ ] Prerequisites: lots 1, 2 and 4a are merged.
- [ ] `cyber` is a blocking consultation: the list of secret patterns, the retention delay and the file modes are fixed by its review, and its objection is addressed on the record before merge.
- [ ] No Track command of this lot imports, spawns or requires h2a; no Track-shipped skill receives a rule that is specific to h2a (spec V10).
- [ ] A capture command prints nothing on standard output and never fails the hook that calls it: a failure is written on the error stream and the exit code stays 0.
- [ ] The text inscribed into a journal is the captured text, byte for byte, except a masking that is signalled.
- [ ] Classifying a message as an answer to a decision never settles the decision.
- [ ] No takeover of an exclusive journal on expiry, on silence or on a dead holder: a takeover is an explicit command.
- [ ] A read purges nothing and writes nothing; it treats an over-age text as expired.
- [ ] Once this lot ships, the conductor of this repository declares itself holder of this repository's journal before lot 3c activates any hook (spec DS-4). The declaration is an operation of the conductor, recorded in the Feedback Loop, not a code change.
- [ ] Out of scope, do not start: attribution of origin beyond the generic rules (lot 3b); installing a hook in any CLI (lot 3c); the conductor wiring (lot 4b).
- [ ] No Python and no perl anywhere. Node and TypeScript only.
- [ ] `TMPDIR`, `TMP` and `TEMP` point into the lane's own folder, never the system temporary directory; tests use `mkdtemp` and a temporary `TRACK_STATE_HOME`; the folder is removed at the end.
- [ ] No `git stash`. Selective staging only. No write to `.track/**` from this branch.
- [ ] Conventional English commit subjects; no attribution trailer of any kind; never `--no-verify`.
- [ ] One logical change per commit, at most 10 to 15 files and under 150 changed lines, or a recorded exception.
- [ ] Run targeted test files only; the conductor runs the complete suite at integration.
- [ ] Update the branch by rebasing on `origin/main` and pushing with `--force-with-lease`.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `packages/track/src/capture/**`
  - `packages/track/src/write-policy.ts`
  - `packages/track/src/write-policy.test.ts`
  - `packages/track/src/events/store.ts`
  - `packages/track/src/events/types.ts`
  - `packages/track/src/state/fold.ts`
  - `packages/track/src/model/demand.ts`
  - `packages/track/src/model/decision.ts`
  - `packages/track/src/track.ts`
  - `packages/track/src/cli/index.ts`
  - `packages/track/src/cli/journal.ts`
  - `packages/track/src/report/owner-table.ts`
  - `packages/track/src/report/owner-table-qualified.ts`
  - `packages/track/src/report/owner-table-scope.ts`
  - `packages/track/src/report/owner-table-qualified.test.ts`
  - `packages/track/src/index.ts`
  - `.gitignore`
  - `plan/07-BRANCH_track-owner-table-lot-3a-queue-and-commands.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.track/**`
  - `packages/track/src/events/lock.ts`
  - `packages/track/src/workspace-id.ts`
  - `packages/h2a/**`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/track/src/ingest/**` (only if the capture provenance must be accepted by the ingest contract)
  - `packages/track/src/lease/store.ts` (read as the model; changed only if a helper is shared)
  - `packages/track/skills/track-operation/SKILL.md` (only to name the new commands)
  - `packages/track/README.md`
- **Exception process**:
  - Declare exception ID `BR807-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

- [ ] `blocked` until `cyber` has fixed: the secret patterns (one fixture per token format), the retention delay (72 hours proposed), the file modes, and whether the pointer to a CLI transcript may be kept after a purge.
- [ ] `attention` to `cond`: record here the date and holder name of the declaration made on this repository's journal after merge, and the place where the holder keeps its token.
- [ ] `attention` to `arch`: the two additive events of Lot 4 are named by this plan, not by the spec; say so in the pull request so the reviewer checks them.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch** (queue, policy and reader counts share fixtures and one state home)
- [ ] **Multi-branch**
- Rationale: the acceptance tests cross the three pieces.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline and red tests**
  - [ ] Read spec section 7 and decisions DS-2 to DS-4; read `packages/track/src/events/store.ts` lines 63-200 (the append critical section), `packages/track/src/events/lock.ts`, `packages/track/src/lease/store.ts` lines 1-110 (the side-file and token model), `packages/track/src/report/owner-table.ts` lines 170-262 (text gates and policy), `packages/track/src/state-home.ts`.
  - [ ] Create the worktree under `tmp/worktrees/`; `npm ci`; `npm run build -w @sentropic/track`.
  - [ ] Tests (red first):
    - [ ] `T3a-a` — `packages/track/src/capture/queue.test.ts` — queue folders and files are readable and writable by their user only (T3a-a)
    - [ ] `T3a-b` — `packages/track/src/capture/secrets.test.ts` — a message carrying a secret pattern leaves the secret in no file, one fixture per token format (T3a-b)
    - [ ] `T3a-c` — `packages/track/src/capture/retention.test.ts` — after the delay an unclassified text is gone, its trace stays and the header counts it (T3a-c)
    - [ ] `T3a-d` — `packages/track/src/capture/inscribe.test.ts` — an inscribed text is byte-identical to the captured text except a signalled masking (T3a-d)
    - [ ] `T3a-e` — `packages/track/src/capture/inscribe.test.ts` — a private term is never written into a versioned journal (T3a-e)
    - [ ] `T3a-f` — `packages/track/src/capture/inscribe.test.ts` — on an open journal classification inscribes at once with no h2a on the machine (T3a-f)
    - [ ] `T3a-g` — `packages/track/src/write-policy.test.ts` — on an exclusive journal an append without the current token is refused and stays queued, and after an explicit takeover the former holder is refused (T3a-g)
    - [ ] `T3a-h` — `packages/track/src/capture/reader.test.ts` — an active queue without a journal renders header, captured items and the partial-scope sentence with exit 0 and creates no journal (T3a-h)
    - [ ] `T3a-i` — `packages/track/src/capture/retention.test.ts` — acknowledging an expired trace clears the counter (T3a-i)
    - [ ] `T3a-j` — `packages/track/src/capture/inscribe.test.ts` — inscribing the same capture twice writes nothing more (T3a-j)
    - [ ] `T3a-k` — `packages/track/src/capture/queue.test.ts` — a message classified not a demand loses its text at classification (T3a-k)
    - [ ] `T3a-l` — `packages/track/src/capture/queue.test.ts` — capture prints nothing on standard output and exits 0 on every failure path (T3a-l)
    - [ ] `T3a-m` — `packages/track/src/write-policy.test.ts` — a silent or expired holder is never replaced without an explicit takeover (T3a-m)
    - [ ] `T3a-n` — `packages/track/src/capture/inscribe.test.ts` — a captured agent question with two options and a recommendation is inscribed as a pending decision and stays queued otherwise (T3a-n)
  - [ ] T3a-b searches the whole temporary state home and the journal for the raw secret bytes after capture, classification and inscription.
  - [ ] T3a-c and T3a-i inject the clock; no test sleeps.
  - [ ] T3a-f runs with a module resolution in which no h2a package can be found, and asserts the command still inscribes.
  - [ ] T3a-g uses two processes of the built CLI: one holding the token, one not.
  - [ ] Red today: none of these commands or files exists.
  - [ ] Lot gate:
    - [ ] The fourteen tests fail on absence; outputs saved.

- [ ] **Lot 1 — Queue store and capture**
  - [ ] Create `packages/track/src/capture/queue.ts`: one folder per identity under `capture/` in the state home, one JSON file per captured message, states `captured`, `classified`, `inscribed`, `dismissed`, `expired`, `acknowledged`; folder mode 0700, file mode 0600; state changes under `withFileLock` on the queue folder, files replaced atomically.
  - [ ] An entry is of kind `message` or `question`; a question entry also holds the options the native question tool offered.
  - [ ] Each entry holds: capture identifier, time, CLI, CLI session, folder, identity, origin (`owner`, `injected`, `subagent`, `background`, `doubtful`), text, size, masked-secret count, and a pointer to the CLI transcript when the hook gives one.
  - [ ] Create `packages/track/src/capture/secrets.ts`: the pattern list as data, `maskSecrets(text)` replacing each match by `[secret masqué : <kind>]`. Masking runs before anything is written.
  - [ ] Add `track capture add --cli <name> [--kind message|question] [--session <id>] [--folder <dir>] [--origin <class>] [--transcript <ref>] --stdin`: it reads the hook payload (JSON or raw text), takes the text from the first of the keys `prompt`, `message`, `text`, `input`, masks, writes the entry, sweeps expired texts of every queue of the machine, prints nothing on standard output.
  - [ ] Add `track capture list [--session <id>] [--state <state>] [--format json]`, a pure read, and `track capture remind --session <id> --format json`, which returns the unclassified captures of a session that were not yet announced and marks them announced.
  - [ ] Generic origin rule when `--origin` is absent: `owner`, unless the text starts with a marker registered in `capture/markers.ts`, then `injected`. Finer attribution is lot 3b.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/capture/queue.test.ts src/capture/secrets.test.ts` — T3a-a, T3a-b, T3a-l green.

- [ ] **Lot 2 — Retention and acknowledgement**
  - [ ] Retention delay: a constant with the value fixed by `cyber`, overridable by `TRACK_CAPTURE_RETENTION_HOURS` within bounds set by the same review.
  - [ ] The sweep removes the text of every `captured` entry older than the delay and marks it `expired`; the trace keeps time, session, CLI, size and transcript pointer.
  - [ ] Add `track capture acknowledge <captureId> --as late-demand|not-a-demand|reconstructed`: `late-demand` inscribes a demand marked as not captured, with a text given by `--text` or `--stdin`; the two others close the trace.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/capture/retention.test.ts` — T3a-c (store part), T3a-i green.

- [ ] **Lot 3 — Write policy**
  - [ ] Create `packages/track/src/write-policy.ts`: the side file `write-policy.json` beside `events.jsonl`, holding `mode` (`open` or `exclusive`), `holder`, `epoch`, the digest of the token, and a short history of declarations and takeovers. No file means open, epoch 0.
  - [ ] In `EventStore.appendCommand`, inside the existing lock and before the integrity check, read the policy: in exclusive mode refuse unless the token given by `TRACK_WRITER_TOKEN` or `--writer-token-file` matches the recorded digest. The refusal names the holder and the epoch.
  - [ ] Add to `cli/journal.ts`: `journal declare-writer --holder <name> [--token-file <path>]` (prints the token once, or writes it to the given file with mode 0600), `journal takeover --holder <name> --reason <text>` (raises the epoch, issues a new token), `journal release` (holder only; back to open, epoch raised), `journal status`.
  - [ ] Add `.track/write-policy.json` to the repository `.gitignore`: the declaration is local to a machine and must not show as an untracked file.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/write-policy.test.ts src/events` — T3a-g (policy part), T3a-m green; every existing store test green.

- [ ] **Lot 4 — Classification and inscription**
  - [ ] Register two additive event types: `demand.owner-message-added` and `decision.owner-message-added`, each carrying the capture identifier, the time and the text; fold them into the demand and the decision as an ordered list of owner messages. Add `capture` to the provenance transports.
  - [ ] Add `track capture classify <captureId> --as new-demand --title <short title>`, `--as follow-up --demand <number>`, `--as decision-answer --decision <number|id>`, `--as not-a-demand`. Only an entry of origin `owner` may become a demand or be quoted.
  - [ ] On an open journal, classification inscribes at once through the resolver of lot 4a: a new demand uses the one-command path of lot 2 with the capture identifier as idempotency key; a follow-up and a decision answer append their event with the same key. The journal outside the repository is created when needed.
  - [ ] On a journal that refuses the append (exclusive mode, or a non-designated copy), the entry stays `classified` and is reported as captured, not yet inscribed.
  - [ ] Add `track capture classify <captureId> --as agent-question --recommendation <option> --rationale <text>` for a question entry: with at least two captured options it creates a pending decision through the existing decision write boundary, the capture identifier as idempotency key; with fewer it refuses, leaves the entry queued and says that a decision dossier is needed.
  - [ ] Add `track capture inscribe [--all]` for the holder: it inscribes every `classified` entry of the journal.
  - [ ] Masking at inscription: when the journal is versioned (its `events.jsonl` is in a git work tree and not ignored), apply the private-term policy of the reader to the text; replace a private term by `[terme masqué]` and mark the demand `masqué`.
  - [ ] `not-a-demand` deletes the text immediately; an inscribed entry loses its queue text once the append is confirmed.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/capture/inscribe.test.ts src/write-policy.test.ts src/capture/queue.test.ts` — T3a-d, T3a-e, T3a-f, T3a-g, T3a-j, T3a-k, T3a-n green.

- [ ] **Lot 5 — Reader**
  - [ ] Add a read-only view of the queue for the reader: counts of unclassified, expired unclassified and captured-not-inscribed entries, and the capture state per CLI read from the capture registry file of the state home (written by `capture add` and by `track capture register --cli <name> --version <v> --mode direct|deferred|not-covered`).
  - [ ] Header: capture state per CLI, write mode (`journal ouvert` or `rédacteur exclusif : <holder>`), and one motif per unmet condition of V1, in the fixed order of spec section 5.
  - [ ] A section « Captées, pas encore inscrites » lists classified entries waiting for inscription; unclassified entries are counted, their text is not displayed by the table.
  - [ ] An active queue is a readable source (DS-2): with no journal, the table renders the header, that section and the partial-scope sentence, exits 0, and creates nothing.
  - [ ] A text inscribed with the `capture` provenance is shown between quotation marks; every other text keeps `(non capté)`.
  - [ ] Lot gate:
    - [ ] `npm test -w @sentropic/track -- src/capture/reader.test.ts src/capture/retention.test.ts src/report/owner-table-qualified.test.ts` — T3a-c, T3a-h green; T1-j, T1-p and T1-s still green.

- [ ] **Lot 6 — Final validation**
  - [ ] `npm run typecheck`
  - [ ] `npm test -w @sentropic/track -- src/capture src/write-policy.test.ts src/events src/report/owner-table-qualified.test.ts src/journal`
  - [ ] `bash scripts/check-no-python.sh`
  - [ ] `cyber` has recorded its verdict on patterns, delay, modes and evidence in the pull request.
  - [ ] Open the pull request in English with red and green evidence; follow CI to green; do not merge.
  - [ ] After merge, operation of the conductor of this repository: `track journal declare-writer` on this repository's journal, recorded in the Feedback Loop, before lot 3c starts.
  - [ ] Acceptance criteria: T3a-a to T3a-n green on Node 22 and 24; no raw secret found by the sweep test in any file; a journal written before this lot replays byte-identical; every existing write verb is refused on an exclusive journal without the token and accepted with it.
