# Feature: Track owner table — delivery lot 3q (qualification of the capture hooks, per CLI and version)

## Objective

- [ ] For each of the six CLIs and for a named version, establish by evidence whether a hook delivers the exact text of a typed message, or whether an end-of-turn transcript is readable.
- [ ] Establish, per CLI, what proves an interactive session, what marks a sub-agent call, which payload keys carry the text, the session, the folder and the transcript, and whether the native question tool can be hooked.
- [ ] Record the result as data in the repository, classified `direct`, `deferred` or `not-covered`, with its reason and its evidence.
- [ ] Contract: `docs/specs/2026-11-20-SPEC_EVOL_track-owner-table-autonomous.md`, sections 7.6 and 7.7, decisions DS-9 and DS-10, annex E, tests T3q-a, T3q-b, T3q-c.

## Scope / Guardrails

- [ ] Accountable: `plugins`. Responsible: `plugins`. Consulted: `agents`, `runtime`, `cyber`.
- [ ] This lot qualifies and records. It installs no hook in a user-level configuration, captures no owner message, and writes no queue: that is lots 3a and 3c.
- [ ] A classification is a result of a run, never an expectation. A CLI is `direct` only when, for that exact CLI version, a witness phrase is found byte-identical at the hook output **and** a sub-agent call can be told from a top-level message.
- [ ] A probe runs the CLI as it is signed in on the qualification machine. Its probe hook is written in a throwaway **project** folder, at the project level of the CLI's configuration; the user-level configuration is never written and no credential is copied anywhere.
- [ ] A CLI that reads hooks only from its user-level configuration is classified `deferred` with that reason, unless the owner authorises a temporary user-level entry; that authorisation and its removal are recorded in the Feedback Loop.
- [ ] The probe hook blocks the prompt after recording it whenever the CLI allows it, so no model call is spent.
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
  - `packages/h2a/fixtures/capture-qualification.json`
  - `packages/h2a/src/hosts/capture-qualification.ts`
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
  - `packages/h2a/src/runtime/governance/authority-native.ts` (read-only reference; see Feedback Loop)
  - `docs/host-integration-matrix.md`
  - `packages/h2a/test/package-plugin-manifest.test.js` (only if it pins the list of shipped fixtures)
- **Exception process**:
  - Declare exception ID `BR803-EXn` in `## Feedback Loop` before touching any conditional or forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop

- [ ] `attention` to `runtime`: a capability record with a `typed-message` column already exists (`SessionCaptureCapabilitiesV1`, shape checked in `packages/h2a/src/runtime/governance/authority-native.ts:455-540`). This lot does not write into it. Ask `runtime` whether that column should later be fed from these results; record the answer here.
- [ ] `attention` to `agents`: confirm, per CLI, the documented hook events and payload fields before a probe is trusted; a field found by probing only is recorded as observed, not as contract. Note for lot 3c: `muse@1.4.24` qualified `direct` via project-level `.muse/hooks.json` (no `matcher` on `UserPromptSubmit`/`Stop`) while `$XDG_CONFIG_HOME/muse/hooks.json` did not fire; lot 3c must evaluate `muse plugins install --scope user` to honour « nothing in the repository ».
- [x] `attention` to `arch`: the result on the native question tool feeds decision DS-10 of the spec; report it explicitly, with the payload shape observed:
  - `claude@2.1.330`: `hooked` in interactive mode (`PreToolUse`, `tool_name="AskUserQuestion"`, `tool_input={questions:[{question,header,options:[{label,description}],multiSelect}]}`); tool absent in `-p` headless mode.
  - `codex@0.163.0`: `hooked` (`PreToolUse`, `tool_name="request_user_input"`, `tool_input={questions:[{header,id,question,options:[{label,description}]}]}`).
  - `agy@1.5.13`: `hooked` (`PreToolUse`, `toolCall={id,name:"ask_question",args:{questions:[{is_multi_select,options:[string],question}]}}`).
  - `gemini@0.67.0`: `gap` (`ask_user` disallowed in headless `-p` and live model turns stalled on the qualification machine before reaching `BeforeTool`).
  - `vibe@3.1.2`: `gap` (`ask_user_question` live `pre_tool` call blocked by read-only `~/.vibe` confinement and exhausted Vibe/GLM quota).
  - `muse@1.4.24`: `gap` (`request_user_input` unavailable in headless `muse exec` and not triggered during the interactive PTY probe).
- [x] `blocked` / confinement findings recorded: `vibe@3.1.2` signed-in run fails with `EROFS` on `~/.vibe/logs/vibe.log` in confinement (and Vibe/GLM quota is exhausted 402), so it stays `deferred` despite byte-identical `pre_agent` witness delivery in a throwaway `VIBE_HOME`; `gemini@0.67.0` unblocked live model turns stalled on the qualification machine so live sub-agent differentiation could not complete and it stays `deferred`.
- [x] `attention` to `cyber`: review the six sanitized evidence logs under `docs/plan/track-owner-table-3q/evidence/` and record the verdict in the PR before merge.
  - Cyber review (`CYBER-REVIEW-3q.md`) findings C1–C4 addressed:
    - **C1**: exported deterministic, idempotent `sanitizeCaptureEvidence` / `sanitizeEvidenceDocument` / `buildSanitizedProbeSummary` / `--sanitize-evidence` in `packages/h2a/scripts/qualification-capture.mjs`, applied to `scanTranscriptForWitness`, `spawnError`, `--out`/stdout, and used to regenerate all six `docs/plan/track-owner-table-3q/evidence/*.json` files.
    - **C2**: restricted `SAFE_ENV_ALLOWLIST` to a closed set of non-sensitive mode/state flags (including `CLAUDE_CODE_SESSION_ATTENDED`), removed the wildcard CLI-prefix copy and path/session env keys, and added value-based secret/path/UUID redaction in `filterSafeEnv`, the probe hook, and `diffInteractiveVsHeadless`.
    - **C3**: added automated consistency, idempotence, and anti-leak scanning (`scanEvidenceForLeaks`) on all six `evidence/*.json` files in `packages/h2a/test/capture-qualification.test.js`, plus unit tests for C1/C2/C4 in `packages/h2a/test/capture-qualification-probe.test.js`.
    - **C4**: enforced `0o700` on `baseTmpDir`/`projectDir`/`.probe-hook.mjs` and `0o600` on `.probe-records.jsonl`, project hook configs, and `--out`/`--sanitize-evidence` outputs. Keeping `scripts/` in `packages/h2a/package.json` is intentional and documented: `packages/h2a/test/native-host-package.test.js` runs `scripts/qualify-host.mjs` (which imports `qualification-{budget,vibe,probe,poll-hosts,cleanup,rpc,oracles,patch}.mjs`) from the packed tarball, `scripts/mh-l1-package-prototype.mjs` copies `pkg.files` literally without `!` negation globs, `packages/h2a/package.json` is outside Lot 3q scope, and `qualification-capture.mjs` is opt-in with zero secrets or local paths.
- [x] `BR803-COMMIT-SIZE`: `packages/h2a/src/hosts/capture-qualification.ts` (235 lines), `packages/h2a/scripts/qualification-capture.mjs` (629 lines), and the six evidence JSON logs + fixture update are cohesive single-unit changes exceeding the 150-line commit heuristic; kept as one logical commit per unit.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch** (one probe harness, one data file; the six CLIs are rows of the same table)
- [ ] **Multi-branch**
- Rationale: the value is the comparable table; per-CLI branches would produce six formats.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Baseline and red tests**
  - [x] Read spec sections 7.6, 7.7 and annex E; read `packages/h2a/src/hosts/plugin.ts` lines 85-150 and 182-267; `packages/h2a/src/cli.ts` lines 4706-4744 (`hookPromptText`: the keys read today are `prompt`, `line`, `message`, `text`, `input`, then `params`) and 5140-5402; `packages/h2a/hooks/workspace-scope-guard.mjs` near line 96 (the session keys read today: `session_id`, `sessionId`, `thread_id`, `conversationId`); `packages/h2a/hooks/vibe-post-agent.mjs`; `packages/h2a/src/hosts/native-catalog.ts` near line 7 (how a shipped fixture is loaded); `packages/h2a/scripts/qualification-vibe.mjs`.
  - [x] Create the worktree under `tmp/worktrees/`; `npm ci`; `npm run build`.
  - [x] Baseline green: `node --test packages/h2a/test/host-plugin.test.js packages/h2a/test/vibe-native-hooks.test.js`.
  - [x] Tests (red first):
    - [x] `T3q-a` — `packages/h2a/test/capture-qualification.test.js` — a CLI is classified direct only when its recorded witness phrase is byte-identical at the hook output and a sub-agent call can be told apart (T3q-a)
    - [x] `T3q-b` — `packages/h2a/test/capture-qualification.test.js` — a CLI whose delivery is not proven is classified deferred or not covered, with its reason (T3q-b)
    - [x] `T3q-c` — `packages/h2a/test/capture-qualification.test.js` — native question capture is qualified per CLI or recorded as a gap, with the payload shape observed (T3q-c)
  - [x] Red today: the data file does not exist; the three tests fail on its absence.
  - [x] Lot gate:
    - [x] The three tests fail for that reason; outputs saved.

- [x] **Lot 1 — Data model and loader**
  - [x] Create `packages/h2a/fixtures/capture-qualification.json` (the `fixtures` folder is already shipped with the package): one entry per CLI and qualified version.
  - [x] Fields of an entry: `cli`, `cliVersion`, `qualifiedOn`, `hookPoint`, `hookConfigLevel` (`project`, `user`), `messageCapture` (`direct`, `deferred`, `not-covered`), `witnessSentDigest`, `witnessReceivedDigest`, `payloadTextKey`, `payloadSessionKey`, `payloadFolderKey`, `payloadTranscriptKey`, `reason`, `evidence` (a path under `docs/plan/track-owner-table-3q/evidence/`).
  - [x] `humanSessionEvidence`: either `none`, or `{ source: "env" | "payload", name, interactiveValue }` — what distinguishes an interactive session from a headless run of that CLI.
  - [x] `subAgentMarker`: one of `never-fires` (the hook does not run for a sub-agent call), `none` (it runs and nothing tells the two apart), or `{ source: "payload", path, rule: "non-null" | "true" | "present" }`.
  - [x] `transcript`: `{ readable, location, format }` for the end-of-turn transcript. `nativeQuestionCapture`: `hooked` or `gap`, with `questionPayloadShape`, a short description of what the tool-call hook receives.
  - [x] Create `packages/h2a/src/hosts/capture-qualification.ts`: a typed loader that reads the fixture the way `native-catalog.ts` does, a shape validator, and `captureModeFor(cli, version)` that returns `unqualified` for a version absent from the table. An unqualified version is never treated as `direct`.
  - [x] The validator refuses an entry marked `direct` whose two digests differ or whose `subAgentMarker` is `none`.
  - [x] Seed the six CLIs with what this repository already proves, each as `not-covered` or `deferred` with reason « not yet probed », so the table is total before any probe.
  - [x] Lot gate:
    - [x] `node --test packages/h2a/test/capture-qualification.test.js` — T3q-b green on the seed; T3q-a green vacuously (no `direct` entry yet); a mutation that marks an entry `direct` without matching digests, then one with `subAgentMarker: none`, each turn T3q-a red, then restore.

- [x] **Lot 2 — Probe harness**
  - [x] Create `packages/h2a/scripts/qualification-capture.mjs`: for one CLI, it builds a throwaway project folder, writes a probe hook at the project level of that CLI's configuration, sends a generated witness phrase (ASCII, accented characters, a line break, quotes, a backslash and a multi-byte character), and compares the bytes the hook received with the bytes sent.
  - [x] The probe hook records the raw payload, the payload keys, the keys that carry the session, the folder and the transcript, and any sub-agent or parent field, then blocks the prompt when the CLI supports blocking.
  - [x] The probe repeats the run in the CLI's headless mode, when it has one, and records what differs in the environment and in the payload: this is the candidate `humanSessionEvidence`.
  - [x] The probe triggers one sub-agent call, when the CLI has sub-agents, and records whether the message hook fires and with which fields: this is the `subAgentMarker`.
  - [x] For a CLI without a message hook, the probe reads the end-of-turn transcript of its own throwaway session and reports whether the witness phrase is found there byte-identical.
  - [x] For the native question tool, the probe reports whether a tool-call hook receives the question and its options, and records the shape.
  - [x] Add `capture-qualification-probe.test.js`: the harness run against a stand-in CLI (a Node script that invokes the hook with a payload) proves the comparison detects a single changed byte.
  - [x] Lot gate:
    - [x] `node --test packages/h2a/test/capture-qualification-probe.test.js` green; a mutation that makes the stand-in alter one byte turns it red, then restore.

- [ ] **Lot 3 — Run the six qualifications**
  - [x] Run the probe for Claude Code, Codex, Gemini CLI, Vibe, AGY and Muse, each on the version installed on the qualification machine; save one evidence log per CLI under `docs/plan/track-owner-table-3q/evidence/`, free of any real text or credential.
  - [x] Update each entry of the fixture from its log. A run that could not be made stays `deferred` or `not-covered`, with the reason.
  - [x] Update `docs/plugin-capability-matrix.md` with one line per CLI and a pointer to the data file.
  - [ ] Lot gate:
    - [x] `node --test packages/h2a/test/capture-qualification.test.js` — T3q-a, T3q-b, T3q-c green on the recorded results.
    - [ ] `cyber` has read the six evidence logs and recorded its verdict in the pull request.

- [ ] **Lot 4 — Final validation**
  - [x] `npm run typecheck`
  - [x] `node --test packages/h2a/test/capture-qualification.test.js packages/h2a/test/capture-qualification-probe.test.js packages/h2a/test/host-plugin.test.js packages/h2a/test/package-plugin-manifest.test.js`
  - [x] `bash scripts/check-public-contract.sh` and `bash scripts/check-no-python.sh`
  - [ ] Open the pull request in English with the table of the six results and the evidence paths; follow CI to green; do not merge.
  - [x] Acceptance criteria: T3q-a, T3q-b and T3q-c green on Node 22 and 24; six rows, each with a version, a classification, a reason and an evidence file; no row is `direct` without matching digests and a sub-agent rule; the result on the native question tool is reported to `arch`.
