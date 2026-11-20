# Feature: Track owner table — delivery lot 3q (qualification of the capture hooks, per CLI and version)

## Objective

- [ ] For each of the six CLIs and for a named version, establish by evidence whether a hook delivers the exact text of a typed message, or whether an end-of-turn transcript is readable, and whether the native question tool can be hooked.
- [ ] Record the result as data in the repository, classified `direct`, `deferred` or `not-covered`, with its reason and its evidence.
- [ ] Contract: `docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md`, section 7.6 and annex E, tests T3q-a, T3q-b, T3q-c.

## Scope / Guardrails

- [ ] Accountable: `plugins`. Responsible: `plugins`. Consulted: `agents`, `runtime`, `cyber`.
- [ ] This lot qualifies and records. It installs no hook on a real configuration, captures no owner message, and writes no queue: that is lots 3a and 3c.
- [ ] A classification is a result of a run, never an expectation: a CLI is `direct` only with a witness phrase found byte-identical at the hook output for that exact CLI version.
- [ ] Every probe runs on throwaway configuration roots (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `VIBE_HOME`, a temporary `HOME`). The probe hook blocks the prompt after recording it whenever the CLI allows it, so no model call is spent.
- [ ] The witness phrase is synthetic. No real owner text, no credential and no token is ever written to an evidence file; `cyber` reviews the evidence files before merge.
- [ ] Never run an installed `h2a` binary from a shell; a host CLI under qualification is the only external binary a probe launches, and only the process the probe started is ever stopped.
- [ ] No Python and no perl anywhere. Node and TypeScript only.
- [ ] `TMPDIR`, `TMP` and `TEMP` point into the lane's own folder, never the system temporary directory; the folder is removed at the end.
- [ ] No `git stash`. Selective staging only. No write to `.track/**` from this branch.
- [ ] Conventional English commit subjects; no attribution trailer of any kind; never `--no-verify`.
- [ ] One logical change per commit, at most 10 to 15 files and under 150 changed lines, or a recorded exception.
- [ ] Run targeted test files only; the conductor runs the complete suite at integration.
- [ ] Update the branch by rebasing on `origin/main` and pushing with `--force-with-lease`.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `packages/h2a/src/hosts/capture-qualification.ts`
  - `packages/h2a/src/hosts/capture-qualification.json`
  - `packages/h2a/scripts/qualification-capture.mjs`
  - `packages/h2a/test/capture-qualification.test.js`
  - `packages/h2a/test/capture-qualification-probe.test.js`
  - `docs/plan/track-owner-table-3q/**`
  - `docs/plugin-capability-matrix.md`
  - `plan/03-BRANCH_track-owner-table-lot-3q-hook-qualification.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.track/**`
  - `packages/h2a/hooks/**`
  - `packages/h2a/src/hosts/plugin.ts`
  - `packages/track/**`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/h2a/package.json` (only to list the new data file in `files`)
  - `packages/h2a/src/runtime/governance/authority-native.ts` (read-only reference; see Feedback Loop)
  - `docs/host-integration-matrix.md`
- **Exception process**:
  - Declare exception ID `BR803-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

- [ ] `attention` to `runtime`: a capability record with a `typed-message` column already exists (`SessionCaptureCapabilitiesV1`, shape checked in `packages/h2a/src/runtime/governance/authority-native.ts:455-540`). This lot does not write into it. Ask `runtime` whether that column should later be fed from these results; record the answer here.
- [ ] `attention` to `agents`: confirm, per CLI, the documented hook events and payload fields before a probe is trusted; a field found by probing only is recorded as observed, not as contract.
- [ ] `blocked` if a CLI cannot be launched on a throwaway root without credentials: classify it `deferred` or `not-covered` with that reason; do not copy a real credential into a probe root.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch** (one probe harness, one data file; the six CLIs are rows of the same table)
- [ ] **Multi-branch**
- Rationale: the value is the comparable table; per-CLI branches would produce six formats.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline and red tests**
  - [ ] Read spec section 7.6 and annex E; read `packages/h2a/src/hosts/plugin.ts` lines 85-150 and 182-267; `packages/h2a/src/cli.ts` lines 4706-4744 (`hookPromptText`: the payload keys read today are `prompt`, `line`, `message`, `text`, `input`) and 5140-5402; `packages/h2a/hooks/vibe-post-agent.mjs`; `packages/h2a/scripts/qualification-vibe.mjs`.
  - [ ] Create the worktree under `tmp/worktrees/`; `npm ci`; `npm run build`.
  - [ ] Baseline green: `node --test packages/h2a/test/host-plugin.test.js packages/h2a/test/vibe-native-hooks.test.js`.
  - [ ] Tests (red first):
    - [ ] `T3q-a` — `packages/h2a/test/capture-qualification.test.js` — a CLI is classified direct only when its recorded witness phrase is byte-identical at the hook output (T3q-a)
    - [ ] `T3q-b` — `packages/h2a/test/capture-qualification.test.js` — a CLI whose delivery is not proven is classified deferred or not covered, with its reason (T3q-b)
    - [ ] `T3q-c` — `packages/h2a/test/capture-qualification.test.js` — native question capture is qualified per CLI or recorded as a gap (T3q-c)
  - [ ] Red today: the data file does not exist; the three tests fail on its absence.
  - [ ] Lot gate:
    - [ ] The three tests fail for that reason; outputs saved.

- [ ] **Lot 1 — Data model and loader**
  - [ ] Create `capture-qualification.json`: one entry per CLI and qualified version, with `cli`, `cliVersion`, `qualifiedOn`, `hookPoint`, `messageCapture` (`direct`, `deferred`, `not-covered`), `witnessSentDigest`, `witnessReceivedDigest`, `payloadTextKey`, `transcript` (`readable`, `location`, `format`), `nativeQuestionCapture` (`hooked`, `gap`), `subAgentMarker`, `reason`, `evidence` (a path under `docs/plan/track-owner-table-3q/evidence/`).
  - [ ] Create `capture-qualification.ts`: a typed loader, a shape validator, and `captureModeFor(cli, version)` that returns `unqualified` for a version absent from the table. An unqualified version is never treated as `direct`.
  - [ ] Seed the six CLIs with what this repository already proves, each as `not-covered` or `deferred` with reason « not yet probed », so the table is total before any probe.
  - [ ] Lot gate:
    - [ ] `node --test packages/h2a/test/capture-qualification.test.js` — T3q-b green on the seed; T3q-a green vacuously (no `direct` entry yet); a mutation that marks an entry `direct` without matching digests turns T3q-a red, then restore.

- [ ] **Lot 2 — Probe harness**
  - [ ] Create `packages/h2a/scripts/qualification-capture.mjs`: for one CLI, it builds a throwaway root, writes a probe hook into that root only, sends a generated witness phrase (ASCII, accented characters, a line break, quotes, a backslash and a multi-byte character), and compares the bytes the hook received with the bytes sent.
  - [ ] The probe hook records the raw payload, the payload keys, the session identifier field, and any sub-agent or parent field, then blocks the prompt when the CLI supports blocking.
  - [ ] For a CLI without a message hook, the probe reads the end-of-turn transcript of its own throwaway session and reports whether the witness phrase is found there byte-identical.
  - [ ] For the native question tool, the probe reports whether a tool-call hook receives the question and its options.
  - [ ] Add `capture-qualification-probe.test.js`: the harness run against a stand-in CLI (a Node script that invokes the hook with a payload) proves the comparison detects a single changed byte.
  - [ ] Lot gate:
    - [ ] `node --test packages/h2a/test/capture-qualification-probe.test.js` green; a mutation that makes the stand-in alter one byte turns it red, then restore.

- [ ] **Lot 3 — Run the six qualifications**
  - [ ] Run the probe for Claude Code, Codex, Gemini CLI, Vibe, AGY and Muse, each on the version installed on the qualification machine; save one evidence log per CLI under `docs/plan/track-owner-table-3q/evidence/`, free of any real text or credential.
  - [ ] Update each entry of `capture-qualification.json` from its log. A run that could not be made stays `deferred` or `not-covered`, with the reason.
  - [ ] Update `docs/plugin-capability-matrix.md` with one line per CLI and a pointer to the data file.
  - [ ] Lot gate:
    - [ ] `node --test packages/h2a/test/capture-qualification.test.js` — T3q-a, T3q-b, T3q-c green on the recorded results.
    - [ ] `cyber` has read the six evidence logs and recorded its verdict in the pull request.

- [ ] **Lot 4 — Final validation**
  - [ ] `npm run typecheck`
  - [ ] `node --test packages/h2a/test/capture-qualification.test.js packages/h2a/test/capture-qualification-probe.test.js packages/h2a/test/host-plugin.test.js`
  - [ ] `bash scripts/check-public-contract.sh` and `bash scripts/check-no-python.sh`
  - [ ] Open the pull request in English with the table of the six results and the evidence paths; follow CI to green; do not merge.
  - [ ] Acceptance criteria: T3q-a, T3q-b and T3q-c green on Node 22 and 24; six rows, each with a version, a classification, a reason and an evidence file; no row is `direct` without matching digests.
