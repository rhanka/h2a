# Native cleanse — L0, PR #396 round 8

- Scope: fix the shared round-7 P2 on f40d77204; L0 witnesses only.
- Root cause: RED MCP signatures omitted global activation/filter choices, hiding selection regressions behind stale-target failures.
- Fix: bind native global choices and observed effective selection to all eight MCP proofs; preserve ordered OpenCode permission rules.
- Snapshot: verdict and evidence share one parsed configuration; all adapters reject a change visible only on the first read.
- Controls: each adapter mutates a global-user selection on an already-RED route, both in the oracle and the installed-candidate baseline; masked choices and rule ordering are covered.
- Promotion: negative controls restore the post-install configuration after exercising the pre-install stale route; a repaired MCP with a declared GREEN ledger entry remains accepted.
- Ledger: only eight evidence hashes change; all 42 states stay RED, comparator and execution gates unchanged.
- Evidence, commands and limitations: docs/reviews/native-cleanse-l0-r8.md; no Python, owner state, installed h2a, full local suite or new peer consensus.
- Direct CI blockers on 503c52f8d: enrollment fixtures now pass arbitrary base64url nonces through the public JSON challenge route; the journal classification fixture qualifies its real writer before provoking startup failure. Production behavior, assertions and timeouts are unchanged.

# Native cleanse — L0, PR #396 round 7

- Base: rebased onto ec04054b6, merged #395; preserve both branch dossiers and main Hono 2.1.5 lockfile.
- Scope: resolve round-6 Astra/Sol P2s in L0 witnesses; no L1–L6 product changes.
- Root cause: universal activation aliases and a transport-only boolean bypassed native tool selection.
- Fix: adapter-native activation/filter snapshots, real MCP catalogue, env/cwd-aware probes; permanent installed Vibe controls and five mandatory npm oracle identities.
- Evidence: docs/reviews/native-cleanse-l0-r7.md; reviewer reproductions RED then GREEN on the installed candidate; 42 ledger states remain RED.
- Targeted gates: baseline/oracle 75 PASS, trust 120 PASS, a/b/c rejected; main and rc.7 48 PASS each. No full local suite or new peer consensus claimed.

# Native cleanse — L0, PR #396 round 5

- Scope: fix the two round-4 P2 findings; L0 witnesses only, no L1–L6 product changes.
- Vibe: validate the selected transport and initial disabled state before the argv/protocol cache; preserve an initially disabled route without launching it, while still checking its candidate target.
- Recovery observations: stat/read within the traversal's ENOENT boundary, keep socket device/inode and JSON contents rather than volatile paths; propagate other errors, no retries.
- RED: Vibe disabled/http false GREEN controls 0/2; four regression controls on f38a98626 helpers 0/4. Deterministic removal of an enumerated lock: 43/48, gate 1; after repair 48/48, gate 0, all 42 exact contract outcomes retained.
- GREEN: oracle 13/13; baseline + oracle 61/61 through the real npm tests verifier; gate/cache regressions 120/120. Zero skip/todo. Four new identities are required in inventory and the independent trust root.
- Main 912dd3035 and rc.7 8d588db05: 48/48 each, gate 0, same 42 contract results. Native recovery/contention: 19/19, no skip/todo.
- First CI: 18/19 success, Node 24 fails in terminal-reset.functional.test.ts while pinning an exited stty descendant. Direct CI blocker: move raw readiness after successful stty completion and remove the 500 ms timer; the real stty stream marker proves ordering deterministically (5/6 RED, 6/6 GREEN on Node 22 and 24, no skip). Terminal-reset assertions and isolation guard remain intact.
- Evidence and remaining lots: docs/reviews/native-cleanse-l0-r5.md. Private TMPDIR /home/antoinefa/.cache-tmp/h2a-test/run-gVodW4; cleanup and CI recorded at delivery. No Python, installed h2a, owner state, full local suite or new peer consensus.

# Native cleanse — L0, PR #396 round 4

- Scope: resolve all round-3 P1/P2 in L0 witnesses and their npm gate; no L1–L6 product implementation.
- Committed 42-contract ledger with exact RED signatures or GREEN state. No environment flag controls verdicts; every result is carried by the reporter into the production tests-step verifier. Repairs must flip their ledger entry in the same change.
- Independent CI controls reject GREEN→RED (including original stale bytes), changed RED signatures and undeclared RED→GREEN, plus missing/duplicate/unknown observations and swallowed assertions.
- Host controls reject duplicate hook options, Agy enablement changes, and an active plugin MCP resolving to a stale PATH binary despite a healthy direct MCP.
- Targeted verification: packaged baseline+oracle 57/57, trust root 48/48, adjacent gate/cache tests 72/72, no skip/todo. Main 912dd3035 and rc.7 8d588db05: baseline 48/48 with the same 42 exact RED outcomes; actual npm verifier accepts the matching ledger.
- First CI: 13/15; fix the directly blocking detached-writer teardown race (deterministic RED→GREEN, crash tests 17/17) and replace the binding-contention release timer with an observed retry (same 1500 ms bound, 2/2). Trust root remains 48/48.
- Details, RED/GREEN commands and qualification limits: docs/reviews/native-cleanse-l0-r4.md. Private TMPDIR /home/antoinefa/.cache-tmp/h2a-test/run-xyfAMY to remove at delivery; no Python, owner state, installed h2a or new peer consensus.

# Memory MCP — L1 producer skill installation

## Objective

Install only the producer-owned `@sentropic/engram/skills/engram-memory/SKILL.md`
from the installed package. Preserve native rendering, resources, custom content
and unrelated files on Claude, Codex, Muse, Vibe and Agy. No provider activation.

## Scope / Guardrails

**Allowed Paths (L1 implementation scope)**
  - `packages/h2a/src/cli.ts`
  - `packages/h2a/src/hosts/native-skills.ts`
  - `packages/h2a/src/hosts/native-convergence.ts`
  - `packages/h2a/src/hosts/native-artifacts.ts`
  - `packages/h2a/test/install-skills-hosts.test.js`
  - `packages/h2a/test/native-host-shared-skills.test.js`
  - `packages/h2a/test/package-plugin-manifest.test.js`
  - `packages/h2a/test/native-host-package.test.js`
  - `packages/h2a/test/helpers/memory-skill-consumer.mjs`
  - `packages/h2a/test/helpers/restart-lab.js`
  - `packages/h2a/test/native-host-crash-recovery.test.js`
  - `BRANCH.md`
  - `docs/reviews/memory-skill-install.md`

- Base: origin/main `ec04054b604f2b8948a16d955724fe5301e9dccb`.
- Round-3 delivery base: origin/main `80694b094` (PR #398, workflows only).
- No owner state, installed h2a, real host CLI, full local suite, dependency pin,
  producer content vendoring, attribution trailer or merge.
- Private TMPDIR: `/home/antoinefa/.cache-tmp/h2a-test/run-h9B2Ks`.

## Lot L1

- [x] RED before product edits: 5 failed / 23 passed / 0 skipped across
  install-skills-hosts, native-host-shared-skills, package-plugin-manifest,
  native-host-package (all under packages/h2a/test).
- [x] Producer resolution without import; source package/version/SHA-256 summary
  and on-host `.h2a-source.json` with producer and rendered hashes.
- [x] Native resources and Agy TOML/import hint; identical reinstall is a no-op.
- [x] Missing package or skill is explicit in sources/status and stderr;
  core skills remain installable. Missing Engram cannot authorize deletion of
  existing Engram files. Custom bytes still require explicit --force.
- [x] External validated reference used only via H2A_MEMORY_SKILL_FIXTURE;
  SHA-256 dd4f17695844a65ae10fa7c9b023578f0c9f8688b446e5ba790fbb39f3abfbaf.
- [x] Final build and seven targeted suites with the validated external fixture:
  53 passed / 0 failed / 0 skipped. Commands in the review dossier.
- Delivery: rebase onto origin/main, own-branch push, French PR and terminal CI;
  no merge authorized.

## Feedback Loop

- `npm view @sentropic/engram@0.22.1` returned E404 in this environment.
  Acceptance uses an isolated installed producer fixture. Published tuple is L0.
- Harness consensus selection failed: no h2a_run MCP tool in confinement;
  owner forbids reaching the installed host. No independent verdict claimed.
- Direct CI blocker on 701feac72: trust-root alone failed with ENOTEMPTY in
  restart-lab cleanup after ten successful resumes. The lab waited only for
  direct children after signalling its recorded descendants. Deterministic RED:
  0 pass / 1 fail / 0 skip; wait for birth-checked recorded descendants before
  deleting HOME. GREEN: full targeted crash-recovery file 17/17, zero skips.
  No runtime change, timeout increase, cleanup retry or gate weakening.
- Round 2, supplied Astra review of d04e3eb24: both P2 findings accepted
  after reproduction (Agy loses old resources; Muse/Vibe replace the receipt
  while preserving a customized skill). Shared-skills RED: 7 pass / 3 fail /
  0 skipped. Preflight conflicts by skill before planning writes or pruning;
  preserve the installed generation and its manifest provenance on refusal.
  Five-host regressions cover repeated refusal, forced upgrade, receipts,
  resources and idempotence; the clean Agy upgrade still prunes old resources.
  GREEN: 61 targeted installation/convergence/recovery tests plus 17 native
  crash-recovery tests; 34 installer/package tests replayed with the standalone
  fixture, zero failures/skips. Build, scope/branch and diff checks pass.
- Round-2 TMPDIR: `/home/antoinefa/.cache-tmp/h2a-test/run-YlDOoZ`;
  HOME/XDG private, no Python or installed host. Evidence and qualification
  results: `docs/reviews/memory-skill-install.md`.
- Round 3, shared P2 from both reviews of `2c088f623`: the direct installer
  could refuse a customized entrypoint but still write a producer receipt.
  RED before product edits: 6 pass / 14 fail / 0 skipped across 20 first-refusal
  cases (five hosts, user/project, with/without a previous receipt).
  Preflight every artifact of a producer skill before writing any; stop on a later
  conflict, and read back each write before proceeding to the receipt last.
  Repeated refusals leave previous receipts and resources untouched. Packed
  acceptance now covers refusal, successful install, hashes and idempotence
  on all ten host/scope pairs. No gate, dependency, timeout or runtime change.
  GREEN: 81 installer/convergence/package/recovery tests and 17 native
  crash-recovery tests, zero failures/skips, run without overlapping campaigns.
- Round-3 TMPDIR: `/home/antoinefa/.cache-tmp/h2a-test/run-tV6A2U`;
  clean HOME/XDG environment, no Python or installed host. Targeted results
  and the supplied-review reconciliation are in the L1 review dossier.
- CI follow-up on `aff742e29`: scoped-hosts Node 22/24 exposed the existing
  missing-resource contract for core skills. Local RED: native-question-mode
  32 pass / 12 fail / 0 skipped. Restrict the receipt preflight and read-back
  barrier to producer skills; core skills still fill missing resources while
  preserving customized entrypoints. No test or gate changes.
  GREEN: 125 installation/convergence/package/native-question tests plus
  17 native crash-recovery tests, zero failures/skips.

# Gateway off by default — PR #395, round 5

- Scope: the shared P2 in both supplied round-4 reviews of 8b0a895c3.
- Compare proven routing choices before conflict pruning; legacy direct/auto,
  gateway or absent pins cannot discard a conversation's explicit consent.
  Keep bare conflicts and conflicting proven choices under the existing
  liveness rules; --no-gw retains priority.
- RED: recovered reviewers' probes 4 fail / 0 pass; durable matrix 24 fail /
  74 pass, zero skips. GREEN: reviewers 4/4, 558 scoped runtime tests and
  56 contracts, zero skips; runtime build and execution-proof validator pass.
- Replay: all 18 earlier probes, original R1 matrix 16/16 and two clean
  shell children with native auth preserved. Evidence:
  docs/reviews/gateway-off-default-r5.md. No test gate changes.
- Private TMPDIR /home/antoinefa/.cache-tmp/h2a-test/run-Fs3Vkp; remove at
  delivery. No owner state, installed h2a, real gateway/provider/cluster,
  Python, full local suite, attribution trailer, merge or tag.

# Gateway off by default — PR #395, round 4

- Scope: both P2 findings in the supplied Sol/Astra reviews of d170a4b83.
- Never type the acquired bearer into a pane: a 0600 JSON file in a private
  0700 directory passes it through the child's environment, with unlink before
  CLI startup and cleanup on refused/failed retype.
- After the existing conflict/liveness resolution, prefer proven consent over
  equivalent legacy pins, independently of registry order; --no-gw still wins.
- Preserve an unspecified bare pin on the legacy-to-explicit transition too;
  RED for the absent variant: one failure / 57 passes, zero skips.
- RED before product edits: three failures / 52 passes, zero skips (two lost
  opt-ins and bearer in command, PTY echo and Bash history).
- GREEN: 514 scoped runtime tests + 52 contracts, zero skips; runtime build;
  execution-proof validator; original R1 matrix 16/16 and two clean children;
  18 recovered Astra/Sol probes from rounds 1/2/3. No gate changes.
- Evidence: docs/reviews/gateway-off-default-r4.md. Private TMPDIR
  /home/antoinefa/.cache-tmp/h2a-test/run-UouKtU; remove at delivery.
- No installed h2a, owner state, real gateway/provider/cluster, Python, full
  local suite, attribution trailer, merge, tag or fresh independent consensus.

# Gateway off by default — PR #395, round 3

- Scope: all four distinct P1/P2 findings from the supplied round-2 Astra/Sol
  reviews on aedc3fccb: local PTY routing, explicit-profile resume identity,
  renamed consent and freshly acquired retype credentials.
- Persist the proven conversation's mode/provenance across renames, including
  an unspecified bare choice; keep the existing conflict/liveness rules.
- RED: final 54-test matrix on aedc3fccb gives 17 failures, zero skips;
  unspecified bare variant gives two failures before its additional fix.
- Verification, all round-1/round-2 reproductions and limits:
  docs/reviews/gateway-off-default-r3.md. No test gate changes.
- CI follow-up: security-debt failed on GHSA-rmxm-3fg6-px4f after the push.
  Update only the existing @hono/node-server lock entry 2.1.1 -> 2.1.5;
  keep manifests, the empty exception register and scanner thresholds intact.
  Live audit RED/GREEN, compilation and all scoped reproductions rerun.
- CI execution-proof follow-up: Vitest truncates long cwd values in test
  titles, making two no-gw table rows share an identity. Use stable case
  labels; verifyRuntimeExecution rejects the old report and accepts the new
  scoped report. All assertions and all gate policies remain unchanged.
- Private TMPDIR /home/antoinefa/.cache-tmp/h2a-test/run-eXwwhg; remove after
  delivery. No installed h2a, owner state, real gateway/provider/cluster,
  Python, full local suite, attribution trailer, merge or tag.

# Gateway off by default — PR #395, round 2

- Scope: five findings from the supplied Astra/Sol reviews on a1835d4d7;
  local consent, retype and child env, mixed fleet auth, remote provisioning/refresh.
- Preserve the three already-pushed commits through e627645a4; base 912dd3035
  already included. No main mutation, merge, tag, dependency or version change.
- Additional RED: fresh name reuse, inherited direct marker on gateway,
  unavailable explicit remote gateway and inherited global provisioner choice.
- Gate the real remote regression suites through h2a-runtime; use source exports
  so a clean checkout needs no private-workspace dist build.
- Evidence and limits: docs/reviews/gateway-off-default-r2.md. Private TMPDIR
  /home/antoinefa/.cache-tmp/h2a-test/run-ieKzxe; no installed h2a or owner state,
  real provider/gateway/cluster, full local suite, Python or attribution trailer.

# PR #379 — v3 review round 9 continuation

- Scope: preserve pushed `211d79a5c`; replay the four Astra/Sol findings at reviewed `0add537f5` with RED/GREEN evidence; fix the simulated peer's late MCP teardown, the inherited restart lab's detached-writer disposal and the positive loop scenario's premature join observed in CI. No v4 design or production native-host changes.
- Evidence: `docs/reviews/2026-10-28-cross-cli-r9.md`. Campaign/cap tests 20/20, three-replication read-then-pop regression 1/1, wake/receipt/trusted-artifact tests 27/27, lab 12/12, delayed MCP teardown RED 0/1 -> GREEN 1/1. Node 22 polling at 90 s: all nine observations deny wake credit.
- Private TMPDIR: `/home/antoinefa/.cache-tmp/h2a-test/run-tUYcx9`; reported sibling campaign roots explicitly removed. No Python, installed h2a, real seats, owner state, full local suite or attribution trailer. Namespace upgrade validation stays in CI because local sudo refuses no-new-privileges.
- No new independent consensus claimed: the installed h2a review route remains forbidden by the owner's confinement. The supplied Astra/Sol reviews are the findings addressed here. Trusted-lane exact-SHA receipts remain conductor-owned and absent.
- CI follow-up: an EOF-aware shutdown witness still rejects the historical peer. Restart-lab cleanup now confirms every recorded PID/start incarnation dead before removing its proc view; delayed-signal regression RED 0/1 -> GREEN 2/2 on Node 22/24, full targeted incident file 17/17. Four historical wake-review cases leave four roots; current cases leave none. All latency thresholds remain unchanged.
- L13 follow-up: the archived failed cell joins while create is enrolling its creator. A widened private build reproduces create refusal after a successful participant join. Wait for the successful create response before joining; same fault GREEN on Node 22/24, full scenario test file 22/22. Product loop code and refusal twins are unchanged.

# R10 — native host recovery under concurrent load

- Scope: the three R9 findings on PR #390; startup election expiry, responsive native creation, failed-list connection ownership and their measured startup costs. No dependency/version/workflow/scope-policy changes.
- R10-EX1: the directly coupled runtime/registry/client/CLI changes and regression witnesses exceed 150 lines and six files. The public synchronous registry contract and its 4 s best-effort boundary stay intact; native creation waits asynchronously before spawn, then uses that same synchronous durable-write section. Revert the R10 commits to roll back.
- Every incident fixture now disposes its own processes after all original usability/host/helper/timeout assertions. The former end-of-test cleanup retained up to 100 agents per instance and changed the background load between reference and measured cells.
- Default and four-instance gates stay 8926/9798 ms, registry delta 1500 ms and startup probe 500 ms. The separately quantified eight-instance/eight-CPU profile proposes frozen calibration maxima 9692/9896 ms plus the existing 500/800 ms margins: 10192/10696 ms. This acceptance proposal and the fixture-lifetime correction are explicit in the PR for reviewers to accept or reject; no owner acceptance is inferred.
- RED/GREEN commands, complete measurements, qualification limits and review selection status: docs/reviews/native-host-crash-recovery-r10.md and native-host-crash-recovery-r10-metrics.json. No new independent consensus is claimed; installed h2a/owner state access remains forbidden.
- First CI exposed a +1 s mutation escaping the old absolute fresh baseline on a faster runner. Every matrix cell now also applies the incident's independent bin.js/node startup comparison at the existing 500 ms boundary; absolute references/assertions and parity reporting are retained. Fresh/resume/restore mutations and their healthy controls were replayed before the follow-up push.
- Private TMPDIR: /home/antoinefa/.cache-tmp/h2a-test/run-ekkPHg; HOME/XDG/socket/process fixtures only. Remove it at delivery after preserving evidence. No Python, attribution trailer or local memory-fault test.

# Native host crash recovery — fix/native-host-crash-recovery

## Round 2 — brief-fixrestart-r2.md

- Scope extends to per-session memory scopes, actual CLI I/O lab matrix, isolated hosted-VM cgroup qualification and mandatory release wiring; no version/dependency change.
- Private TMPDIR: /home/antoinefa/.cache-tmp/h2a-test/run-NDLCse; real owner state/bus untouched. Namespaces denied (unshare plus three bwrap attempts), cgroup mount read-only; local memory faults forbidden and not attempted.
- RED: ten read-only proofs after SIGKILL: 4 success / 6 publication lock timeouts in 5,208 ms. GREEN: ten success in 294 ms, socket retained. Fast path requires inode-matched current-frame sidecar and every owner positively dead.
- Real run --resume: 500 mixed rows, one relevant owner probe, successful CLI input acknowledgement; matching unreadable row still refuses before CLI launch.
- Session memory domains: host remains protected; every CLI moves to a sibling scope before exec with MemoryMax <=8 GiB (<=1/4 physical RAM), MemoryHigh at 80% of its ceiling and MemorySwapMax=0. Scope refusal prevents CLI execution inside the protected host. If host systemd isolation is unavailable, original detached fallback remains explicitly unprotected in host logs.
- Mandatory matrix: fresh/resume/actual restore command execution, unrelated registry 0/50/500, concurrency 1/5/10, host live/absent/health-checked then SIGKILL; three paired direct-CLI I/O samples, median/p95/probe/helper counts, +500 ms registry budget. Restore selects its explicit owner group and adds N target rows; total rows are emitted. Three dedicated VM jobs avoid unrelated test concurrency; release waits for all jobs on the resolved release SHA.
- Provenance RED kept for #382: legacy agent transcript is human on rc.4, expected background; exact initiator provenance and explicit legacy recovery remain the #382 handoff. Never infer human from transcript, name or path.
- Additional RED/GREEN: a positively live publisher could still be unready at the single reconnect. Fleet/op now retry only healthy handshakes within the health budget, never turn uncertainty into permission to spawn. Fragmented input rescanned 64,480 bytes for 1,984 received; linear buffering fixes the packaged smoke's timeout without extending its budget.
- Final local qualification: runtime compilation succeeds; five scoped Vitest files 89/89, incident lab 11/11, release contracts 32/32, inventory check 1/1; zero skips in these accepted runs. Actual 451-row negative control loads the frozen rc.4 guard: resume stays in foreign probes past 5 s; fixed path starts and acknowledges I/O.
- CI 39522995167 at de8acea42 (merge e4f36193bffaef9f8c4cfb44bfcfa84c7e83e9d4): 81 configurations / 243 paired measurements, 27/27 matrix tests plus effective cgroup test pass, zero skips. Three incident mutations are rejected. Maximum median registry deltas: fresh +427 ms, resume +126 ms, restore +192 ms (budget +500 ms). Ten crash resumes with 500 rows: median 5,641 ms / p95 5,706 ms, all usable, one host. Bounded worker OOM observed at 128 MiB, swap 0, two humans and host survive. Packaged smoke 39522821108 passes.
- Direct CLI parity is not achieved: single-session warm-host overhead at 500 rows is median +897 ms fresh, +1,136 ms resume and +1,658 ms restore. No global memory admission, provider/GUI or AMD-reset qualification claimed. Full commands, matrix and #382 handoff: docs/reviews/native-host-crash-recovery-r2.md.

## Round 1 (historical evidence)

- Objective: investigate the 20 October incident independently; ship bounded startup, concurrent recovery, terminal cgroup separation and owner-only restore.
- Scope: runtime conv-guard, native-terminal/{fleet,op,server,process,host-scope}, restore; named regressions, native test isolation, execution inventory, branch/review evidence.
- Confinement: private TMPDIR /home/antoinefa/.cache-tmp/h2a-test/run-2jadsY; no installed binary, owner state/bus/processes, Python, full suite, Track writes or main mutation. Preserve supplied untracked scripts/owner-lab/restart.test.mjs.
- RED: guard probes 500 instead of 1; resume/ten-resume cases cancel at 10/32 s; concurrent recovery refuses publication-lock timeout; scope request absent; fleet adoption 2/10 failures; restore provenance 3/36 failures.
- Implementation: filter conversation before liveness, bounded healthy-successor adoption, single probe only for an absent pathname under lock, own systemd scope before PTY admission with visible fallback, reject delegation and unconfirmed legacy restore.
- Qualification: named test files only; no skip accepted. Real systemd OOM survival and spontaneous machine reboot cause are outside this confinement's evidence.
- Verification: 229 selected tests pass with zero skips; runtime TypeScript build passes. Final lab: host entry 797 ms; five crash resumes 3,948 ms; ten resumes 3,118 ms; worst registry overhead +38 ms.
- Delivery: conventional English commit without trailers; rebase origin/main, lease push only this branch, ready PR. Detailed commands and results: docs/reviews/native-host-crash-recovery.md.
- Review: no author-complementary installed-h2a review can access real state; record selection-failed, no consensus claimed.

# Inherited origin/main branch records

# Workspace scope guard opt-in — fix/scope-guard-opt-in

- Owner order: disable the workspace scope guard by default in every packaged
  integration; retain its implementation, explicit opt-in and manual CLI hook.
- Allowed: packaged hooks, host rendering/convergence/CLI, named host/guard
  regressions, guard documentation, review evidence and this branch record.
- Confinement: disposable HOME/XDG/TMP under the task-owned cache directory;
  no owner h2a state, installed binary, native host, Python, Track writes or
  full repository test suite. No version/dependency changes or attribution.
- Selection: `--workspace-scope on|off`, off by default. Native manifests retain
  only explicit boolean enablement; old key/session bindings do not opt in.
- Qualification: isolated real lot-worktree, merge and release workflows are
  required before any owner-machine enablement. No such deployment is claimed.
- RED: default packaged hooks 1 pass / 1 fail; final host regressions against
  original HEAD implementations 12 pass / 27 fail; no skipped tests.
- Verification and review outcome: docs/reviews/workspace-scope-guard-opt-in.md.
- Delivery: conventional commit, rebase onto origin/main, lease push only to
  fix/scope-guard-opt-in, ready PR with the owner's exact requested title.

# Inherited branch records from origin/main

# Focus edit return — feat/focus-edit-return

## Objective
- [ ] Implement independent h2a editing contracts and reconciliation from SPEC v3 (SHA-256 6d320f6627643c97a45baf47d103e0442618bbc2da4613054f8c7dd1e8b8e105).
- [ ] Deliver one draft PR: feat(focus): in-place edit return with per-paragraph diff.

## Scope / Guardrails
- [x] Allowed: packages/focus/{src/editing,src/index.ts,tests/editing*,tests/fixtures,schemas/focus-edit*,scripts,package.json,skills/focus,registry}; packages/h2a/{package.json,src/focus-feedback.ts,src/runtime/focus/edit-receipts.ts,src/bin.ts,src/cli.ts,test/focus-feedback.test.js,test/focus-edit-recovery.test.js,test/helpers/focus-edit-fixture.js}; docs/focus/document-editing.md; docs/reviews/focus-edit-return*; package-lock.json; generated packages/track/src/focus-vendor; BRANCH.md.
- [x] Conditional: focus-build/focus-kit/render anchors and FE-4 only after published DS editor; FE-6 only after offline loop and policy ratification; FE-8 UI qualification after FE-3.
- [x] Forbidden: main, other repos, owner state/native host/installed h2a, unrelated processes, Python/Perl, full test suite, npm publication, Track writes.
- [x] Tests use temporary HOME/XDG/TMP including XDG_RUNTIME_DIR, named files only, zero skips; no fallback editor authorised by this task.
- [x] FEDIT-EX1: cohesive source/schema/test contracts and generated vendor exceed 150 lines; rollback via source revert and existing vendor generator. No Makefile or plan template is present; selective conventional commits replace make commit. No harness recorder may reach owner state.

## Lots
- [x] FE-0 implementation: closed sidecar and return schemas, S/F/M validation, canonical hashes and lossless JSON/YAML; editing-contract.spec.ts + schema.spec.ts + packaging.spec.ts.
- [ ] FE-0 merge gate: Focus/DS cross-review of concrete vocabulary, retiredParagraphIds and source/editor codec pairing.
- [x] FE-1 source core: persistent mapping, segmentation/diff and pure cumulative reconciler; editing-{anchors,codec,diff,reconcile}.spec.ts, browser-neutral hash vector; 26/26 core tests, zero skips.
- [ ] FE-3/4: blocked pending FE-2 published RichTextEditor and final codec; no local substitute.
- [x] FE-5 manual implementation: fixture-driven offline importer/receipt/register; focus-feedback.test.js + focus-edit-recovery.test.js; 5/5 pass in sequence after vendor generation, zero skips.
- [ ] FE-5 complete gate: real browser export, presentation rebuild, versioned registry edit capabilities and hard-crash lock recovery remain unqualified.
- [ ] FE-6/8/9: dependent acceptance/connected/consumer qualification remains open.
- [x] Delivery: targeted gates, generated vendor check, conventional commits pushed to own branch, one draft PR #378, French evidence report at docs/reviews/focus-edit-return.md.

## Feedback Loop
- [x] Supplied independent Astra/Sol spec reviews: GO-CODE. Existing origin/main includes merged PR #377 at d0b1afa38.
- [x] DS check: npm latest @sentropic/design-system-svelte 0.36.0 exports only the root; exact tarball contains no RichTextEditor. FE-3 stops at dependency boundary; FE-4 distribution and FE-8 browser budgets cannot be accepted.
- [x] Source codec: @lezer/markdown 1.8.0 with GFM and an exact CRLF offset map; unchanged pinned hash vector after removing the original parser's transitive DOM dependency. List-item editing remains excluded pending FE-2.
- [x] RED: initial core 19/19 fail; supplemental structural-revocation/malformed-receipt/refused-ID cases 3/10 fail, prototype key 1/7 fail, DOM dependency 1/8 fail, answer/note targets 1/9 fail; final core 26/26 pass. Initial consumer 6 failures included 2 duplicate registrations, corrected to a standalone helper; final named commands recorded in the delivery report.
- [x] Review protocol requires installed h2a/live mesh, forbidden by owner confinement; record selection-failed and claim no implementation consensus.
- [x] Verification: Focus 9 named files 153/153; Node feedback/recovery/build 38/38; vendor byte-identical; schema drift check and TypeScript build exit 0. A later Node rerun raced the vendor's Track-dist cleanup (1/5 failed); the same command rerun sequentially passes 5/5. No timeout or test condition was relaxed.

# Inherited context: Dossier diagrams — h2a lots

## Objective
- [ ] Deliver H1 evidence and matching H4; prepare H2 at its published DS boundary.

## Scope / Guardrails
- [x] Branch feat/dossier-diagrams; immutable v1, explicit schemaVersion: 2.
- [x] Named test files only; disposable HOME/XDG/TMP; no Python or owner state.
- [x] Allowed: packages/focus/{src,tests,schemas,skills,registry,package.json}; packages/h2a/{src/focus-build.ts,focus-kit,test/focus-build.test.js,test/distribution-increments.test.js,package.json}; scripts/{build-focus-dossier,focus-vendor-lib,vendor-focus,check-focus-vendor}.mjs; generated packages/track/src/focus-vendor; packages/track/skills/present-decision; docs/focus; docs/reviews/dossier-diagrams.md; .github/workflows/focus-dossier.yml; BRANCH.md.
- [x] Forbidden: other repos, main, installed h2a, native host, owner state, unrelated processes, workflow changes outside Focus qualification.
- [x] BRDG-EX3: docs/focus/diagram-renderer-contract.md and docs/reviews/dossier-diagrams/** hold the dependency handoff and qualification evidence; generated vendor commits may exceed the file-count guideline.
- [x] BRDG-EX2: frozen corpus/calibration manifests and old-validator fixture are generated qualification artifacts; their commits may exceed 150 lines.
- [x] BRDG-EX1: generated schemas/vendor/renderer/locks may exceed the harness 150-line limit; regenerate reproducibly, rollback by regeneration from prior sources. No Makefile exists; selective git commits replace make commit.
- [x] PR #377 correction scope: scripts/run-tests.mjs and its prepared-npm-cache.test.js / node-track-observation-lab.js witness preserve the prepared cache through HOME isolation.

## Lots
- [x] H1a contract: model, byte integrity, closed validation, version schema; tests/evidence.spec.ts, schema.spec.ts.
- [x] H1b reading/export: summaries counted, raw bytes separately accounted; readability.spec.ts, render.spec.ts.
- [x] H1c build: atomic output, explicit evidence template, metadata; test/focus-build.test.js.
- [x] H1d renderer: offline citation/search/download/back and bounded DOM; evidence-browser.test.mjs.
- [x] H1e qualification: frozen numeric small/large policy and real corpus; evidence-performance-browser.test.mjs.
- [ ] H2 blocked: npm E404 for @sentropic/diagram-core and @sentropic/diagram-canvas 0.1.0; DS2 exact tarballs required.
- [ ] H3 blocked: H2 + DS4/DS5 renderer/control exports; no Focus toolbar substitute.
- [x] H4-H1: regenerated assets/vendor, capability manifest, skills/docs, fresh tarball template/build/open; packaging.spec.ts, distribution-increments.test.js.
- [x] Delivery: targeted gates, one draft PR #377, own-branch push, per-job CI report; full integration checks remain visible in PR.

## Feedback Loop
- [x] rv377 A/S P1: prepared cache lost with isolated HOME; targeted production-entry witness RED 0/1 (run-g0jSGX) → GREEN 1/1 (run-kpLhOI), distribution 1/1 (run-KsxQ1q), zero skips. Logs: /home/antoinefa/.cache-tmp/diag377-evidence-B189hY.
- [x] rv377 S P2 schema: image metadata conditional parity; schema 3 RED / 46 → 46/46 GREEN, registry and vendor digests regenerated; no v1 change.
- [x] rv377 A/S P2 navigation and S P3 annex: stale search/actual viewport/latest opener/colliding app id, browser 4 RED / 5 → 5/5 GREEN at 320/390/1440px, keyboard/touch; run-e7kyZs → run-3k7fBu.
- [x] rv377 qualification: 195 targeted tests pass, zero skips; G5a run-CMDhRx passes unchanged budgets on corrected assets, review377-metrics.json retains all samples/hashes.
- [x] rv377 CI shallow checkout: exact frozen corpus reference fetched without changing the tested tree; depth-one clone witness 0/1 RED (run-iunwUR) → 1/1 GREEN (run-x3Rgqq), original 1,731 blobs/bytes retained, no numeric budget change. Final targeted total 196.
- [x] H4 méthode : témoins install-skills 17/17 et shared-skills 3/3 ; budget present-decision 1/13 RED → 13/13 GREEN, instructions 835 mots et audit sous 300, seuils conservés.
- [x] Race RSS : statm du même PID confirme un espace vide avant l'état zombie ; instrumentations vivantes/absentes toujours bloquantes. 2/6 RED → 6/6 GREEN ; G5a 30/30 aux mêmes budgets.
- [x] CI corpus : remplacement de la dépendance aux fichiers de travail par 1 731 blobs de sources techniques figés ; recalibration et qualification 30/30 GREEN aux mêmes budgets, run-BttLAh.
- [x] CI second passage : retrait des faux prérequis de développement/musl ; cache basé sur la fermeture runtime et os/cpu/libc, 190 tarballs, 1/1 distribution et 2/2 navigateur GREEN, zéro skip.
- [x] CI initiale : ENOTCACHED @hono/mcp ; fermeture npm verrouillée et cache temporaire sans métadonnées registre, RED commander puis 1/1 distribution et 2/2 navigateur GREEN, zéro skip.
- [x] Supplied spec reviews agree GO-CODE at 34b0b43a.
- [x] Implementation review selection-failed: owner confinement forbids installed h2a/live mesh; docs/reviews/dossier-diagrams.md.

# Inherited origin/main history

# Live disclosure authority — owner decision 2026-10-17

- [x] Scope: Δ-L7a on `feat/live-disclosure-authority`, based on origin/main.
- [x] Reference: engram plan/09 and SPEC_LIVE_GIT_INDEXING at e417c33c,
  including the Read side amendment (repository/provider/scope/duration).
- [x] Allowed implementation: gateway-host/live-{auth,disclosure,host}.ts,
  live-auth.test.ts and live-disclosure.test.ts; branch/review evidence only.
- [x] Guardrails: temporary test roots, Node 22/24, targeted files only;
  no installed h2a, owner state, Python, Track writes or provider calls.
- [x] Lot A: registered Ed25519 host proof, live audience, current declaration,
  host-local tenant, expiry, operations and revocation; default denial.
- [x] Lot A evidence: 14 behavioural failures before implementation, then
  14/14 pass; no session or enrollment fallback.
- [x] Lot B: explicit grants, exact paths/surfaces, mandatory L4b policy,
  before-handoff revalidation, opaque audit receipts, no snapshot archive.
- [x] Lot C: G4 fails with policy-unavailable until an actual L8 contract
  exists; isolated emitted consumer proof and targeted Node 22/24 checks.
- [x] Lot B/C evidence: 39 behavioural failures before grants/audit, then
  53/53 disclosure tests. Seven additional regressions observed red then green:
  final-policy state replacement, async audit, throwing clock, revoked issuing
  proof with fresh emit proof, backwards grant start, and independent read
  authority missing from emission, and late provider redirection. Compiler
  and test-type errors were corrected separately, not counted as RED evidence.
- [x] Qualification: exact auth/disclosure/registration files, 90/90 on
  Node 22.22.1 and 24.18.0, zero skips; repository and test typechecks pass.
- [x] Lot D: English conventional commits, own-branch push and PR #367; CI job
  outcomes and remaining qualification limits in the requested owner report.
- [x] Feedback: #342/#343 deliver declarations/GitHub/retention, not L7a
  verified authority or L8 policy. The old unverified registration guard stays.
- [x] Feedback: installed h2a/mesh review launch is forbidden by confinement;
  record selection failure and claim no independent consensus or merge gate.

## Tour 2 — independent review rev367

- [x] Rebased onto origin/main; no merge of main. Push uses the owner-required
  force-with-lease exception for this rebase, only on our feature branch.
- [x] L4b-2 exhaustive deterministic exclusions at engram e417c33c: five secret
  rules, all protected basenames/prefix/suffix/segments, secret-bearing paths;
  each rule/alternative on all surfaces and every two-fragment split.
- [x] Final emission requires one host snapshot lease spanning authority,
  revocation, state, read access, content decisions, clock and bound transport.
  Data-only validation and synchronous send share that lease; no unlocked fallback.
- [x] Correct refusal codes and attempt ordering; authentication before grant
  lookup, correlated revoke refusals, revoke survives policy/declaration drift;
  no foreign state lookup before signed repository scope verification.
- [x] Complete evidence ID coverage is required, including composed fragments.
- [x] Snapshot authorizations must match the exact caller and issuing proof IDs;
  same-owner proof substitution produced 2 RED failures before its guard.
- [x] RED baseline: 67 behavioural failures / 172 tests, zero skips; execution
  proof also rejects the old duplicate test names. GREEN: 172/172 on Linux
  Node 22.22.1 and 24.18.0, zero skips; production execution-proof verifier
  accepts each three-file targeted report; strict test and repo types pass.
- [x] Fixed the duplicate parameterized secret-test identity that caused the
  three previous CI execution-not-proven failures; no gate was weakened.
- [x] No production snapshot adapter or independent peer consensus claimed;
  missing snapshot authority denies emission and G4 stays policy-unavailable.

# Inherited branch context

# Focus publication — owner decision 2026-10-17

Branch: feat/focus-publish. Implement the accepted release-wave decision:
focus 0.5.0 is independent of the h2a 0.98.7 train. RC suffix follows the
h2a tag; all five verified tarballs and versions enter the same-tree proof.
Backfills must refuse an older four-package prepare helper before publication.
Scope: release/rehearsal workflows, release/candidate/rehearsal helpers and
qualified execution snapshot, named release tests, release documentation.
No tag, npm publication, installed h2a, owner state, Track writes or full
local suite. Tests use disposable HOME/XDG/TMP directories.

- [x] Red regression evidence: 48/61 then 25/32; no skips.
- [x] Initial six targeted Node test files: 93/93, zero skips; actual focus tarball
  dry-run without node_modules exit 0. Packed schema/validator and registry
  digests checked; logs: /home/antoinefa/.cache/focuspub-{red,contract-red,green,rehearsal}.log.
- [x] Legacy-preparation regression: 12/14 red before the focus-version
  handoff guard, then six files 95/95 green with zero skips; same-tree focus
  preparation is required for RC and stable.
Publication: conventional commits, own-branch push and English PR; per-job
CI outcomes are maintained in the owner-requested focuspub-report.md.

Harness consensus review is selection-failed: the required installed h2a/mesh
access is forbidden by the owner's confinement. No peer consensus claimed.
See docs/reviews/focus-publish.md.

# Inherited context from origin/main

# Claude seat on the common seat model (realign 2026-10-13, r8)

Branch: `feat/claude-seat-h2a-lots` (worktree `claude-seat-lots`).
Scope: Claude subscription seat for llm-mesh, realigned on the model every
other seat follows (owner decision 2026-10-13, DEC-118): same facade
enrollment shape, mesh-side storage/refresh, gateway registry wiring, same
test families — nothing Claude-specific.

State: **enrolled seats route through the mesh; serving needs the official
`claude` CLI on `PATH`**. The gateway always composes mesh
`ClaudeCodeRuntimeClient` on the h2a runner into the provider registry via
`AnthropicAdapter`, with no per-seat configuration. The runner resolves
`claude` from `PATH` per attempt (generic spawn safety only: no version
pin, no digest, no attestation). A seat with no enrolled account (or no
`claude` on `PATH`) never serves a route — fail-closed per attempt, like
every other seat. The pre-acquire seam halt is gone — account locking
lives in the mesh directory like every other seat.

Removed without replacement (no other seat carries them): egress/netns
guard (`egressNetnsReader`, `H2A_CLAUDE_EGRESS_ENFORCED`, `/proc` netns
checks), org-proof handoff, managed-config + registry/MDM guards, h2a-side
account lease lock, seam-gate attempt binding, seat-qualification env
configuration (`H2A_CLAUDE_BINARY_PATH` / `H2A_CLAUDE_BINARY_DIGEST`),
version pin + digest/attestation machinery.

Kept: facade enrollment (OAuth default + `--from cli` official store +
`--from token` secret-manager pipe, DEC-119), mesh keyring
storage/refresh, transport-specific hygiene of the CLI seat
(identity-proven sweep, sandbox transport, cleanup blocking the result,
root-level static error boundary (inherited by every subcommand —
commander never prints its own text: `outputError` is a no-op,
`exitOverride` writes a static message chosen ONLY from `err.code`
(unknown option, unknown command, too many arguments, missing argument,
option argument missing, required option not specified, conflicting option,
invalid argument, fallback); no declared name kept, no counts, no suggestion;
multi-line values ending a line with `'` or `.`, unknown commands with
newline, `remove` with a dotted first line all static; proven by a 34-form
property canary with exact static-shape asserts for every form),
masked TTY input / piped-token boundary (never
argv, never logged). The startup sweep runs at every gateway
composition even with no Claude account enrolled.

Import note (differs from muse by mesh limitation 0.25.0): `--from cli`
is a point-in-time COPY — the mesh never writes the official store file,
but its copy refreshes independently, so re-run `--from cli` when the
grant rotates. Linux store file only; macOS keychain unverified.

Follow-ups (not built here, other seats unchanged): `--from cli` on
codex/cloud-code/mistral-vibe, `--from token` on
codex/cloud-code/mistral-vibe/muse, a mesh-side Claude store leg
(CLI sole writer, mesh re-reads at refresh), the shared GitHub-secret +
cron refresh/re-enroll circuit (exists for NO seat today).

Validation: `tsc -b` clean; seat suites green
(`claude-code-cli-*`, `claude-seat-input`, `llm-mesh-accounts`,
`gateway-host/claude-code-seat-wiring`, `gateway-host/host`,
`runtime-llm-mesh-account`); `gh pr checks 327 -R rhanka/h2a` green.
Reports under `.h2a/` stay untracked; the r8 report lives in
`.h2a/build/claude_seat_r8_report.md` (untracked) and the seat-model
inventory in `.h2a/build/seat_model_inventory.md` (untracked).

# Inherited context from updated origin/main

# Focus decision dossier kit
# L2-s — PR 348 Tour 3

Owner scope: rev348-r2.md, root corrections with targeted red/green evidence,
rebase onto origin/main, own-branch push with lease, per-job CI and Tour 3 report.
No main, Track, scanner, allowlist, real native host or installed h2a access.

- Native interactive/headless IPC preserves non-seat authentication. Seat
  launches consume the materializer environment; sanitization searches values
  only for explicitly supplied secrets.
- Serialized-only renewable fixtures delegate canonical references under
  trusted custody and exclusive family tickets. Native access references and
  canonical material reach the synthetic file/keyring payloads distinctly.
- Native Vibe TOML editor update/removal regression; 16 serialized matrix cells
  with disposal, capture and persisted clearance; strict lifecycle validation.
- Public fixture/codec/materialization exports have a runtime red/green test.
- Finding 3: real L1 PR 681@7293130ee3f6 discovered and pinned. All five
  CLI cli/token sources route to its consumer parser/importSeatBundle API,
  never to renewable product imports. Private profile and bounded stdin only.
  Ten imports/reload/expiry/401/explicit-refresh tested against pinned L1
  sources with zero provider calls. Publication remains an external gate;
  older installed APIs refuse before input. Details: docs/cli-seat-l2s.md.
- Sources/declarations and native op compiled only into disposable proof dirs.
  No full local suite. No peer consensus: installed/native dispatch forbidden.

# Earlier branch records

# Focus publication — owner decision 2026-10-17

Branch: feat/focus-publish. Implement the accepted release-wave decision:
focus 0.5.0 is independent of the h2a 0.98.7 train. RC suffix follows the
h2a tag; all five verified tarballs and versions enter the same-tree proof.
Backfills must refuse an older four-package prepare helper before publication.
Scope: release/rehearsal workflows, release/candidate/rehearsal helpers and
qualified execution snapshot, named release tests, release documentation.
No tag, npm publication, installed h2a, owner state, Track writes or full
local suite. Tests use disposable HOME/XDG/TMP directories.

- [x] Red regression evidence: 48/61 then 25/32; no skips.
- [x] Initial six targeted Node test files: 93/93, zero skips; actual focus tarball
  dry-run without node_modules exit 0. Packed schema/validator and registry
  digests checked; logs: /home/antoinefa/.cache/focuspub-{red,contract-red,green,rehearsal}.log.
- [x] Legacy-preparation regression: 12/14 red before the focus-version
  handoff guard, then six files 95/95 green with zero skips; same-tree focus
  preparation is required for RC and stable.
Publication: conventional commits, own-branch push and English PR; per-job
CI outcomes are maintained in the owner-requested focuspub-report.md.

Harness consensus review is selection-failed: the required installed h2a/mesh
access is forbidden by the owner's confinement. No peer consensus claimed.
See docs/reviews/focus-publish.md.

# Inherited context from origin/main
# L2-s — PR 348 Tour 2

Owner scope: rebase onto origin/main, address every finding in rev348.md with
red/green targeted tests, push this branch with lease, append Tour 2 and every
CI job to the requested report. No main/Track/guard/allowlist edits.

Allowed correction scope: cli-seat-{codecs,fixtures,materialization}.ts and
their named tests, cli-seat-direct-matrix.test.js; native-host.ts,
llm-mesh-accounts.ts and its temporary-directory tests, index.ts aliases,
cli-seat-runtime-wiring.test.ts, this record and docs/cli-seat-l2s.md.

- Explicit channel authority, unavailable refusal, strict pinned envelope.
- Native credential/MCP paths, private XDG/no-follow files, injected agy keyring.
- Closed MCP environment, separate profile, three sanitized native captures.
- Real materializer matrix, independent diagonal actors, lab billing admission.
- Exclusive family journal, unique stream ids, exact persisted handoff.
- Scenario/codec tool gate, adversarial canaries, precedence/base64/401 guards.
- Targeted baseline controls retain 71/80 red regressions, 13/13 wiring red,
  20/20 diagonal failures and a cross-process admission failure; final tests/typechecks are in the owner report.
- Finding 3 remains partially blocked by the published L1 facade: no generic
  five-provider cli/token import with external refresh policy. Preserve its
  refusal, do not fabricate an API or duplicate the store. Explicit owner,
  scope and acceptance are in docs/cli-seat-l2s.md. No mergeability claim.
- Confinement forbids installed/native h2a review dispatch; no new consensus.
  All test children are synchronous/owned, HOME/XDG are disposable; no full
  local suite, provider state, Python or real credentials.

# L2-s — PR 348 CI repair

- Owner scope: rebase `feat/cli-seat-l2s` onto `origin/main`, repair the three
  failed CI jobs without weakening tests, push with lease, and append `CI` to
  the owner's `l2s-report.md`. No main or Track writes.
- Rebased onto `3113014fe`; all three original jobs fail the same gateway
  eradication ratchet on three provider references introduced by L2-s.
- Minimal repair scope: fixture provenance comments, live-stub receipt
  diagnostics, its targeted regression in `cli-seat-direct-matrix.test.js`,
  and `docs/cli-seat-l2s.md`. Keep the scanner and allowlist unchanged.
- Named tests only, temporary HOME/XDG/TMP roots, no installed h2a/native host,
  provider credentials, Python, foreign process access or full local suite.
- Native h2a/mesh review dispatch remains forbidden by the owner's confinement;
  no external consensus is claimed.
- Evidence: `node --test packages/h2a/test/gateway-eradication.test.js`:
  3/4 before, 4/4 after. The final direct-matrix regression against the old
  stub fails 103/104 on Node 22 and 24, then passes 104/104 after repair.
  Six named `cli-seat-*.test.ts` files pass 76/76 on both Node versions.
  No skips; scanner/allowlist unchanged. Detailed commands, logs and per-job
  CI results are retained in the owner's report.
- L1 update: npm 0.26.1 now exports the bundle via its public node entry.
  Five-CLI seat import and external refresh-policy APIs remain absent from
  the inspected facade contract; exact handoff: `docs/cli-seat-l2s.md`.

# Inherited main context

# Claude seat on the common seat model (realign 2026-10-13, r8)

Branch: `feat/claude-seat-h2a-lots` (worktree `claude-seat-lots`).
Scope: Claude subscription seat for llm-mesh, realigned on the model every
other seat follows (owner decision 2026-10-13, DEC-118): same facade
enrollment shape, mesh-side storage/refresh, gateway registry wiring, same
test families — nothing Claude-specific.

State: **enrolled seats route through the mesh; serving needs the official
`claude` CLI on `PATH`**. The gateway always composes mesh
`ClaudeCodeRuntimeClient` on the h2a runner into the provider registry via
`AnthropicAdapter`, with no per-seat configuration. The runner resolves
`claude` from `PATH` per attempt (generic spawn safety only: no version
pin, no digest, no attestation). A seat with no enrolled account (or no
`claude` on `PATH`) never serves a route — fail-closed per attempt, like
every other seat. The pre-acquire seam halt is gone — account locking
lives in the mesh directory like every other seat.

Removed without replacement (no other seat carries them): egress/netns
guard (`egressNetnsReader`, `H2A_CLAUDE_EGRESS_ENFORCED`, `/proc` netns
checks), org-proof handoff, managed-config + registry/MDM guards, h2a-side
account lease lock, seam-gate attempt binding, seat-qualification env
configuration (`H2A_CLAUDE_BINARY_PATH` / `H2A_CLAUDE_BINARY_DIGEST`),
version pin + digest/attestation machinery.

Kept: facade enrollment (OAuth default + `--from cli` official store +
`--from token` secret-manager pipe, DEC-119), mesh keyring
storage/refresh, transport-specific hygiene of the CLI seat
(identity-proven sweep, sandbox transport, cleanup blocking the result,
root-level static error boundary (inherited by every subcommand —
commander never prints its own text: `outputError` is a no-op,
`exitOverride` writes a static message chosen ONLY from `err.code`
(unknown option, unknown command, too many arguments, missing argument,
option argument missing, required option not specified, conflicting option,
invalid argument, fallback); no declared name kept, no counts, no suggestion;
multi-line values ending a line with `'` or `.`, unknown commands with
newline, `remove` with a dotted first line all static; proven by a 34-form
property canary with exact static-shape asserts for every form),
masked TTY input / piped-token boundary (never
argv, never logged). The startup sweep runs at every gateway
composition even with no Claude account enrolled.

Import note (differs from muse by mesh limitation 0.25.0): `--from cli`
is a point-in-time COPY — the mesh never writes the official store file,
but its copy refreshes independently, so re-run `--from cli` when the
grant rotates. Linux store file only; macOS keychain unverified.

Follow-ups (not built here, other seats unchanged): `--from cli` on
codex/cloud-code/mistral-vibe, `--from token` on
codex/cloud-code/mistral-vibe/muse, a mesh-side Claude store leg
(CLI sole writer, mesh re-reads at refresh), the shared GitHub-secret +
cron refresh/re-enroll circuit (exists for NO seat today).

Validation: `tsc -b` clean; seat suites green
(`claude-code-cli-*`, `claude-seat-input`, `llm-mesh-accounts`,
`gateway-host/claude-code-seat-wiring`, `gateway-host/host`,
`runtime-llm-mesh-account`); `gh pr checks 327 -R rhanka/h2a` green.
Reports under `.h2a/` stay untracked; the r8 report lives in
`.h2a/build/claude_seat_r8_report.md` (untracked) and the seat-model
inventory in `.h2a/build/seat_model_inventory.md` (untracked).

# Inherited workspace scope guard record from origin/main

# Workspace scope guard

- [ ] Objective: default portable Focus design-system dossiers with mobile ecosystem canvases.
- [ ] Scope: h2a Focus CLI, isolated Svelte consumer, reusable catalog, template, skill and targeted tests.
- [x] Guardrails: owner confinement; no installed h2a, host state, Python, full local suite or main writes.
- [x] Allowed: packages/h2a/focus-kit/**, src/focus-build.ts, bin.ts, CLI help, package metadata;
      packages/track/skills/present-decision/**; named tests; build script, CI and documentation.
- [x] Forbidden: reference kit writes, other runtime behavior and long-term DS renderer ownership.
- [x] Design: use h2a focus build, a native Focus extension, and bundle @sentropic/focus/validate unchanged.
- [x] Lot 1: closed document template, ecosystem catalog, validator/build command; focus-build.test.js.
- [x] Lot 2: DS Svelte renderer, light/dark, cards, pinch zoom, portable artifact; browser fixture.
- [x] Lot 3: default skill, exact command, documentation, targeted skill and schema tests.
- [ ] Lot 4: package verification, push own branch, English PR, per-job CI report.
- [x] Feedback: harness review selection-failed; installed h2a/mesh access forbidden by owner.
- [x] Feedback: no Track writes through installed tools; no consensus or review identity claimed.
- [x] Feedback: generated renderer and lockfile exceed suggested commit size; bounded to requested consumer.
- [x] Tour 2 scope: optional plain-JSON diagram-core SemanticDocument on Focus DiagramNode;
      canonical schema/validator/readability, catalog, interim xyflow consumer and targeted regressions.
- [x] Design contract: generic@1, semantic records only; no Focus scene model, view, geometry or layout hint.
- [x] Layout L-R1..L-R11 remains DS-owned; interim placement exists only inside the xyflow adapter.
- [x] Rebase origin/main: already up to date at the start of Tour 2.
- [x] Final rebase includes #364; only BRANCH.md conflicted; Focus scope retained.
- [x] Direct delivery dependencies: regenerate Focus registry digests and Track focus-vendor
      after changing canonical schema/validation. Red vendor drift and packed digest proofs recorded.
- [x] Last round #368: close nested semantic records; regenerate authoritative Mermaid fallback;
      budget displayed scene labels once while retaining opaque-code checks.
- [x] Last round #368: reuse canonical question/option grouping and recommendation naming;
      resolve local selections across linked sets; browser coverage at 320px and 390px.
- [x] Regression proofs: all five reviewer findings reproduced red, then CLI/browser 32/32 green;
      readability 69/69 green; isolated temporary state and no skipped tests.

## Objective
- [x] Enforce workspace ownership in shipped development hooks.

## Scope / Guardrails
- [x] Own worktree only; no live h2a state, installed binary or full local suite.
- [x] No version bump, attribution or main mutation.

## Branch Scope Boundaries
- [x] Allowed: packages/h2a/hooks/**, targeted scope tests, hosts/plugin.ts,
  hosts/vibe-equipment.ts, hosts/vibe-discovery.ts, hosts/native-convergence.ts,
  hosts/native-files.ts, hosts/native-toml.ts, hosts/native-inspection.ts, cli.ts, plugin manifests,
  test/native-host-convergence.test.js, test/native-host-review-regressions.test.js,
  test/host-plugin.test.js, test/native-host-shared-skills.test.js,
  docs/workspace-scope-guard.md, docs/specs/SPEC_EVOL_WORKSPACE_SCOPE_GUARD.md,
  docs/reviews/workspace-scope-guard/**, BRANCH.md.
- [x] Direct CI blocker: scripts/test-inventory.json (host-plugin normative title).
- [x] Forbidden: live host state, unrelated sources, dependency/version changes.

## Lot 1
- [x] Classifier, signed grants, typed audit and owner command.
- [x] Red/green: workspace-scope-guard.test.js.

## Lot 2
- [x] Host plumbing and targeted workspace-scope-hosts.test.js.

## Lot 3
- [x] Documentation, review outcome, push, PR and individual CI reporting.

## Feedback Loop
- [x] Independent security/coverage design reviews: pin launch identity, inspect
  remote destinations and committed bumps, preserve private packages.
- [x] h2a consensus unavailable: no h2a MCP in confinement; do not reach live host.

- [x] Preserve read-only npm version and private package versioning; published siblings still require release authority.
- [x] Restrict helper execution and manual session initialization while preserving source inspection.

## Tour 2 — Independent review #364
- [x] R1: agy native payloads and SessionStart/PreToolUse; Muse project hooks verified against the public Meta CLI; six-host enforcement/grant/version matrix.
- [x] R2: scoped shell cwd/environment, executable heredocs/substitutions, git/gh options, package script aliases.
- [x] R3: shell redirections before every executable/builtin; runtime/helper protection; static Codex envelopes and dynamic refusal.
- [x] R4: root-relative manifests, pinned session baseline, path commits, matching refspecs, MultiEdit and separate foreign/release grants.
- [x] R5: startup-pinned plugin key, normalized grant options/repositories, Vibe native-session journal and refreshed explicit trust.
- [x] R6: quoted prose, own --all, native test runner flags, current PR resolution, branch reads, literal patch envelopes.
- [x] R7: exact repo/action/ref/session in both refusal channels.
- [ ] Fresh author-complementary h2a consensus: unavailable in confinement (no h2a MCP; no real-state access authorized).

## Tour 3 — Independent review rev364-r2.md
- [x] R1: agy global-hook cwd, native workspacePaths SessionStart binding, JSON startup output, multi-session --write installation; explicit Muse project installation only.
- [x] R2: fail-closed shell grammar/state, wrappers, balanced cwd stacks, HOME/OLDPWD/directory stack, continuations, stdin/runtime paths and independent Git directory selectors.
- [x] R3: protect hook configuration, installer metadata, helper code and journals; destination options, destructive Git commands and indirect/reflective JS capability access.
- [x] R4: inspect index independently of commit operands, enumerate pushed refs, match full patch paths and honor native line ranges.
- [x] R5: lex JS strings/comments separately and decode literals before shell classification; preserve legitimate commit messages.
- [x] CI blocker: normative inventory follows the existing agy/Muse installation test, without removing its execution requirement.
- [ ] Fresh h2a consensus remains unavailable; no independent verdict claimed for the new diff.

## Tour 4 — Fail closed on uncertainty (conductor decision)
- [x] Remove heredoc preprocessing and executable substitution/shell-script interpretation; refuse opaque protected intent with a typed request for the plain explicit form or owner grant.
- [x] Check dynamic sensitive argv before action selection; cover runtime stdin/eval, independent Git directories, symlinks, file destination options and Git mutation forms from rev364-r3.md.
- [x] Preserve explicit own copy/move/mkdir operations, conditional own cwd alternatives, plain protected actions and valid JavaScript escapes; reject duplicate command members using the shared lexer.
- [x] Compare complete proposed/base manifests, preserve baseline publication across private toggles, and inspect the union of explicit pushed refs and tags; bind sessions before recording baselines.
- [x] Targeted regression proof: 76 T4 tests on original HEAD (7 pass, 69 fail, 0 skipped), then 76 pass, 0 fail, 0 skipped after correction.
- [x] Centralize symlink uncertainty before canonicalization, including env/npm selectors and dangling effective copy destinations: three additional red/green regressions.
- [ ] Full native sessions, remote mutations and independent h2a consensus remain outside confinement qualification; full repository suite is reserved for the conductor.

# L2-s — PR 348 Dernier tour

- Owner scope: rev348-r3.md, minimal correction, rebase onto origin/main,
  own-branch lease push and per-job CI in the owner report.
- Rebased onto df5652b18; only BRANCH.md conflicted. Both branch records
  were retained, including the complete workspace scope guard record.
- The sole finding is still externally blocked: Sentropic PR 681 is OPEN;
  registry latest is llm-mesh 0.26.1 / cluster-mesh 0.18.0. An isolated
  install of those published packages fails all three API availability
  assertions (3 failed, 0 skipped). No green-after or closure is claimed.
- Keep the fail-closed import guard and dependency lock unchanged. Do not
  merge with this reserve. L1 must publish its import API, then h2a can pin
  compatible published versions and qualify all ten cli/token imports.
- Targeted post-rebase enrollment/dispatch/regression suites: 6 files,
  118 passed, 0 skipped. Full local suite and native/installed h2a forbidden.
# Live cross-CLI messaging

Branch: feat/live-cross-cli-messaging; base: 54e7ffd7859f84fdaa04db94975e292e1af63330 (0.98.6).
Owner scope: 2026-10-15. No merge, release, installed h2a execution, Python,
real owner h2a state, unowned process inspection, force push, or main changes.

## Lot 1 — measure before changing the product

- Node 22/24 harness; source-only build in mkdtemp; direct C++ compilation of
  unchanged node-pty source avoids its Python installation toolchain.
- 36 distinct ordered pairs of Claude, Codex, AGY, Gemini, Muse and Vibe.
- Separate evidence for MCP initialization/tools, signed send, durable
  delivery, CLI inbox read, autonomous live reaction and signed reply delivery.
- Two empty independent workspaces/identities, including same-CLI pairs.
- Fresh HOME/XDG/store/socket/registry per cell; existing login files copied
  through an auth-only allowlist and deleted with CLI state after the cell.
- Existing native isolation guards retained. Every nested h2a command resolves
  to a temporary shim over checkout sources. Existing upgrade reexec guard
  prevents background installation. No raw model/provider outputs retained.
- Blocking trust/auth/provider/environment cases remain explicit blockers.
  No skipped cells and no support claims without measured-OK.
- Commit and push harness plus full table before product corrections.

## Lot 2 — repair only observed failures

Order: MCP loading, durable delivery, live wake, reply. Each regression must
retain a failing command/receipt and the corresponding passing observation.
Run every test file that references a changed integration. A successful MCP
handshake alone never becomes a successful messaging cell.

## Lot 3 — simulated CI, real local qualification

GitHub CI on Node 22/24 exercises deterministic model peers on the real product
messaging/wake path for all ordered pairs. Local real-CLI qualification stays
separate, with no secrets or paid seats required by CI. Missing simulation
coverage is a failed assertion, never a silent skip.

## Design review and limitations

Two independent adversarial design readings were reconciled: use h2a_inbox
(no h2a_receive tool exists), prove MCP initialization plus tool publication,
correlate exact envelopes and identities, require an idle receiver barrier,
preserve the upgrade guard, and never treat a notification as model reception.

The installed-h2a consensus-review route prescribed by harness-review is
incompatible with the owner's explicit confinement. It is not used. These
design readings are not a claim of a formal harness-review consensus.

The shell's default bwrap runner cannot create its namespace in this
confinement. Source reads and private test commands use explicit execution
exceptions; they do not authorize contacting the real h2a host or state.

Current outcome: phase 1 measured 0 OK, 5 KO, 31 blocked. CI has proven all
36 simulated round trips on Node 22 and 24; this is no real-CLI support claim.
Historical published-host fixtures now require a private PID namespace with
an init reaper. The scoped new CI launcher supplies it. Running that fixture
without the launcher fails closed; adapting the existing full npm-test/release
entry points remains a pre-merge task, and those full gates are not qualified
by the scoped cross-CLI workflow. No merge readiness is claimed.

## Resume 2026-10-16

Preserve the twelve pushed commits; never run the full suite locally. The
confirmed native wake framing defect is fixed: keep the validated line and its
single submit CR in separate input bursts under the same fenced lease. Human
activity and control-byte guards remain intact. Claude-to-Claude now has a real
measured signed round trip, autonomous inbox read and signed reply after the
idle barrier. Codex still has no real MCP initialization; an ineffective
initial-submit experiment was removed. The scoped CI workflow now includes the
direct op consumers. See docs/2026-10-16-cross-cli-resume.md for commands,
red/green receipts, qualification limits and cleanup evidence.
### Resume follow-up — Muse settings and bounded CI jobs (2026-10-16)

- Muse's real parser rejects settings without root schema_version=1. Preserve this field in product snippets/writes, keep unrelated settings and refuse incompatible versions even with force. Native config oracle: 3 failed before, 3 passed after; host integration: 26 passed/2 failed before, 28 passed after; six host consumer files: 71 passed/0 failed.
- Copy Muse launcher/native program into the temporary experiment before running it: its wrapper accesses adjacent mutable update notices independently of HOME. Temporary fake-install red/green proves the owner installation notice is untouched. No Python or installed h2a execution.
- Real Muse still exits 1 after trust, and its isolated exec preflight exits 1 without a recognized diagnostic. No real Muse support claim. AGY login selection is now an explicit authentication blocker. Codex remains unqualified; unsuccessful startup experiments were removed.
- CI 38900923045 proves all 36 simulated pairs on both Node versions, but is cancelled overall because Node 24 exceeded the 10-minute combined job budget. Split independent runtime/native-source/host-source checks without increasing timeout or weakening guards; publish receipts. Follow-up CI required after push.
- CI 38908671072 additionally exposed missing Track skill fixtures (six assertions, reproduced locally 11 pass/6 fail then 17 pass/0 fail) and root-owned receipt upload failure. Export only safe JSON copies with uploader ownership; leave all private build/state permissions intact. Export/PID refusal tests 4/4; targeted runtime op tests 4/4; Gemini replay remains authentication-required.
- Final code CI 38909510272 on 2f4568a9: all eight jobs success. Each of Node 22/24: 36/36 simulated pairs, harness 18 passed, native config 2 passed, runtime 702 passed/0 failed (four declared non-tests), source native 151 passed/0 failed (12 declared todos), source hosts 210 passed/0 failed (one declared placeholder). Downloaded artifacts and independently validated every source-file identity and simulated messaging stage. Final evidence-only archive uses [skip ci]; no code changes after this qualified SHA.
- Real live qualification remains Claude→Claude only, 1/36; no real cross-CLI pair qualified. Formal installed-h2a review route remains forbidden and selection-failed; global npm/release PID confinement wiring remains outside this qualified slice.

## Lot L1 — rebase onto origin/main (2026-10-19)

- New base: d0b1afa38 (was 54e7ffd7). `git merge-tree --write-tree origin/main HEAD` exits 0.
- 17 commits replayed in original order, subjects unchanged; backup ref backup/xcli-pre-rebase-97f93e72 kept.
- Resolutions per SPEC v3 §10: BRANCH.md kept branch-side; muse.ts keeps schema_version: 1 plus main's non-migrated/registry-bootstrap wording (no merge instruction in hint); hosts-integration.test.js keeps all assertions from both sides.
- Rebase defect found and fixed in L1: post-rebase workers failed (qualification-worker-failed) because toml-eslint-parser (packages/h2a dep from main) was missing from the stale worktree install; `npm ci --ignore-scripts` restored it, lock untouched.
- Post-rebase targeted proofs: harness 18/18, hosts-integration 28/28, muse-config 3/3, native-config 2/2, simulated spot cell claude:codex simulated-OK.
- Not runnable in this sandbox: xcli-in-pid-namespace launcher (sudo blocked by container no-new-privileges); covered by CI.

## PR #379 — CI correction round 3 (2026-10-19)

- Private namespace init stays privileged; test consumers now drop to the
  invoking UID/GID, preventing root-owned `.q` and `.test-scratch` residue.
- Packaging resolves the selected npm before PATH isolation; the regression
  test packs and installs the real local artifacts with a Node-only PATH.
- Receipt discovery uses exact-SHA repository runs and explicitly refuses
  `trusted-receipt-absent (receipt absent, qualification pending)`; all
  provenance checks remain mandatory. No live receipt exists or was fabricated.
- Targeted RED/GREEN, Node 22/24 outputs, CI job causes and local sudo limits:
  [round-3 evidence](docs/2026-10-19-fix379-r3.md). No full suite run locally.

## PR #379 — CI correction round 4 (2026-10-19)

- Forward a complete private HOME/XDG/remote configuration across sudo;
  keep the private PID namespace and invoking UID/GID. Seven affected remote
  suites pass 49/49 on Node 22 and 24.
- Require the pinned npm oracle native payloads explicitly; retain the
  reviewed bootstrap digest and disabled lifecycle scripts.
- Allocate CI scratch space in RUNNER_TEMP/private TMPDIR and publish only
  exact invocation export paths, without global /tmp evidence globs.
- Expose failed Vitest suite preparation output even with zero failed
  assertions. The historical Node 22 beforeAll cause was absent from its log;
  do not claim it diagnosed or fixed without the next CI observation.
- Receipt absence remains the expected refusal. Local targeted RED/GREEN,
  confinement limits and cleanup record: [round-4 evidence](docs/2026-10-19-fix379-r4.md).

## PR #379 — CI correction round 5 (2026-10-19)

- The general runtime gate no longer forces the qualification-only
  `H2A_SESSION_HOST=native`: crash-log treated its value as a secret and
  corrupted `native-name-collision`. Native remains the product default;
  secret redaction, assertions and all confinement guards stay intact.
- Regression RED on Node 22/24, then launcher tests 5/5 with real targeted
  crash-log assertions 20/20 on both versions. Native isolation 5/5 and
  targeted trust-root contract/discovery checks 5/5. Local real sudo dispatch
  still requires interactive authentication; no namespace green claimed.
- The historical Node 22 beforeAll cause is `unknown`: its published log,
  annotations and receipt omit the diagnostic. The next CI run executes
  all three upgrade cases successfully; no historical cause inferred.
- Receipt absence remains the expected refusal. Commands, outputs and
  review limitation: [round-5 evidence](docs/2026-10-19-fix379-r5.md).

## PR #379 — CI correction round 6 (2026-10-19)

- The publish smoke's oversized peer hit quadratic partial-frame processing,
  also present in main: 32 MiB inspected as 8.64 GB across 64 KiB fragments.
  Buffer fragments and count new UTF-8 bytes once; assemble at newline.
  Protocol limit and the smoke's five-second deadline remain unchanged.
- Regression RED three times at five seconds, then GREEN five times.
  Server transport 41/41 and real-host crash containment 7/7 on Node 22/24;
  smoke/rehearsal contracts 37/37 and source build pass.
- origin/main is already an ancestor; no rebase required. Receipt absence
  remains the expected refusal. Commands, measured costs and review limits:
  [round-6 evidence](docs/2026-10-19-fix379-r6.md).

## PR #379 — owner restart (2026-10-25)

- Owner explicitly authorizes `--force-with-lease` to
  `origin HEAD:feat/live-cross-cli-messaging` only. Main is already an
  ancestor (`40693473a`); no additional rebase is necessary.
- Patch compatible security advisories in a lockfile-only commit, with
  no suppression. Pace simulated identity polling within the unchanged
  MCP-call cap; the CI session-paths failure is reproduced and fixed.
- Complete L3's missing private-host PTY input witness and enforce each
  replication's actual phases and release offset inside its original budget.
  Keep all real-login qualification and trusted receipts conductor-owned.
- Enforce W0 >= the W1 exclusion claim: simulated windows are 13/13/3 s,
  explicitly funded at 60 s. Retain fixed barrier-relative polling in the
  counterexamples. Split polling periods and refusal sender groups in CI,
  preserving all 15 phase combinations and all 36 ordered scenario pairs
  without increasing any job timeout. Unavailability rows claim no wake.
- French audit with source anchors, RED/GREEN commands and remaining
  external qualification: [restart evidence](docs/2026-10-25-pr379-restart.md).
