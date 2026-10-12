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

# AGY Claude 5.5 model and quota contract

## PR 359 — Tour 3

- Owner scope: reconcile `rev359-r2.md` P1/P2 under the existing confinement.
- [x] Reproduce filesystem-clock result loss in CLI/MCP, including a fast canonical completion and an old custom result path.
- [x] Reproduce the real 251-character AGY_ERROR through 80/160-column terminal rendering and loss beyond the six-line capture tail.
- [x] Remove cross-clock freshness comparisons; retain old-generation exclusion and baseline custom executor paths at handoff.
- [x] Reassemble complete anchored AGY_ERROR JSON and carry the full-screen typed quota error through prompt delivery.
- [x] Rebase onto origin/main `596363908` (already up to date); targeted Node 22.22.1 / 24.18.0: eight runtime files 303/303 and three CLI/MCP files 41/41 per version, zero skips; four isolated package typechecks per version.
- [x] Final publication rebased again onto `ed0c09f64` after PR #360 advanced main during CI; preserve both BRANCH.md contexts. AGY sources unchanged; runtime 303/303 and CLI/MCP plus the CI-budget guard 83/83 per version, zero skips.
- [x] Preserve Claude-pool attribution when an AGY model is not Claude: two additional red regressions, then green on both hosts.
- Publication and each CI job are recorded in the owner's report under Tour 3.
- No installed h2a/native host/provider access, Track writes, full local suite or unattended child process.

## PR 359 — Tour 2

- [x] Reproduce all five owner-supplied review findings with offline AGY/host fakes.
- [x] Inspect interactive AGY quota before accepting CPU activity; preserve typed quota/reset on both hosts.
- [x] Retire old headless results before launch; MCP excludes the prior file generation and checks freshness on one descriptor.
- [x] Re-read completion after the PID probe; consume complete model/quota events before bounding buffers.
- [x] Enrich preliminary quota with reset observations; return typed non-zero provider exits; validate embedded Claude effort tokens.
- [x] Four named runtime files: 89/103 pass on original sources, then 103/103; MCP 8/11 then 12/12 after the additional stale-generation regression (11/12 red).
- [x] Rebase on origin/main `596363908`; retain both BRANCH.md contexts; no Track diff.
- [x] Final Node 22.22.1 / 24.18.0: eight named runtime files 292/292 and three CLI/MCP files 38/38 per version, zero skips; four isolated package typechecks per version. Trust-root file 38/38; zero-Python guard exit 0.
- [x] Push with lease and append the per-job CI snapshot to the owner's Tour 2 report; CI conclusions remain tracked there.
- Owner confinement remains mandatory. No installed h2a, real provider/native host, Track writes or full local suite.

Current owner task: `feat/agy-claude-models`, resumed from `bd29f7b43` with
two uncommitted regression files. Scope: core MCP/doctor, runtime launch argv
and headless supervision, named tests, test inventory, documentation. Historical
branch sections below are inherited context, not this branch's task.

- [x] Explicit Opus/Sonnet 5.5 launch model, stdin prompt, max→high and typed xhigh refusal.
- [x] Build-role opt-in for the AGY Claude pool; reviews/challenges first.
- [x] Quota error/reset/status, no fallback/retry, declared output-file absence.
- [x] Offline fake AGY regressions, MCP late completion polling and doctor status.
- [x] Final Node 22/24: six named runtime files 223/223 per version, three
  CLI/MCP files 34/34 per version; four isolated package typechecks per version.
- [x] Trust-root test file 38/38 on Node 22; zero-Python guard exit 0.
- [x] CI export guard: retain the closed public export list with the new AGY
  contract, packed-dist scan and seam import refusal; targeted red 4/5,
  then green 5/5 on Node 22 and 24, zero skips.
- [x] Quoted quota diagnostics in model JSON do not invent pool exhaustion:
  reproduced 26/27 before anchoring diagnostics to the start of a line.
- [ ] Commit, fast-forward push, English PR and per-job CI report.
- No Track writes or installed h2a/native host/provider access; only temporary
  test roots. Full local suite forbidden; CI/conductor owns integration.
- Review: selection-failed under confinement; no consensus claimed. See
  `docs/reviews/agy-claude-models.md` and `docs/agy-claude-models.md`.

# Inherited branch context from origin/main

# CI job budget — owner request 2026-10-17

Branch: `fix/ci-job-budget`, base `origin/main` at `596363908`.

Scope: `.github/workflows/ci.yml`, `docs/ci-job-budget.md`, this scope record,
`scripts/{report-test-durations,node-evidence-reporter,run-test-gates,run-tests}.mjs`
and `packages/h2a/test/{run-test-gates.test.js,helpers/node-track-observation-lab.js}`
only (the isolated observation lab must resolve the added diagnostic module).
Measure recent main runs,
preserve the complete test commands and required-check names, raise the two
integration job budgets to 25 minutes, and report slow suites from existing
execution evidence before cleanup. No product change or new dependency.

Targeted tests only, disposable HOME/XDG/TMP roots, Node 22/24, red before
green. No installed h2a, native host, owner state, full local suite or `.track`
write. The conductor retains the integration run. Push this feature branch and
open an English PR to main; retain measurements and the French owner report
at the requested scratchpad path.

Harness review dispatch requires installed h2a/mesh, prohibited by the owner's
confinement. Record selection-failed locally and claim no peer consensus.

# P1 — GitHub transport for the injected engram PR sync port

Branch: `feat/live-git-p1-github`; base: `origin/main` (`d2e0cfdc`).
Authority: owner request 2026-10-16, engram plan/09 P1 and LIVE §5,
engram PR #366 (`e432240f`). Cluster-mesh mapping is excluded.

## Scope amendment before implementation

The two host paths in plan/09 are extended only for the explicitly authorized
vendored entry refresh. Fourteen exact files are necessary across a vendoring
prerequisite (11 files) and the host change (3 files). Each commit stays below
the twelve-file ceiling; the complete shared contract closure stays together:

- `BRANCH.md`
- `packages/h2a-runtime/src/gateway-host/live-github.ts`
- `packages/h2a-runtime/src/gateway-host/live-github.test.ts`
- `packages/h2a-runtime/src/gateway-host/live-registration.test.ts` (pinned integrity guard)
- `packages/h2a/src/vendor/engram-live/contracts.js`
- `packages/h2a/src/vendor/engram-live/contracts.d.ts`
- `packages/h2a-runtime/src/vendor/engram-live/contracts.js`
- `packages/h2a-runtime/src/vendor/engram-live/contracts.d.ts`
- `packages/h2a-runtime/src/vendor/engram-live/registration.js`
- `packages/h2a-runtime/src/vendor/engram-live/registration.d.ts`
- `packages/h2a-runtime/src/vendor/engram-live/integration.js`
- `packages/h2a-runtime/src/vendor/engram-live/integration.d.ts`
- `packages/h2a-runtime/src/vendor/engram-live/pr-sync.js`
- `packages/h2a-runtime/src/vendor/engram-live/pr-sync.d.ts`

Source: read-only engram `origin/main` at `545a57b8`; fetch is refused by its
read-only mount. Compile the named four neutral entries with TypeScript,
preserve byte identity between core/runtime contracts, pin all runtime entry
digests. No dependency/lockfile change or cross-checkout runtime import.

## Implementation and verification

- Implement `GithubPrTransportPort` using host-approved `gh api`; authentication
  remains wholly in gh. No credential read, token field or stderr disclosure.
- REST all-state listing, no PR ceiling, repository/filter-bound continuations,
  checked Link evidence, strict facts, conditional validators per position,
  safe 304 replay, typed failures and bounded request duration/concurrency.
- Exercise the actual vendored neutral sync engine against a local fake GitHub
  through a temporary fake gh executable. No external network during tests.
- Red before green, guard mutations, targeted Node 22/24 checks only. Every
  fixture uses temporary HOME/XDG roots; close servers and owned children.
- Metadata transport does not acquire Git objects or acknowledge object jobs;
  private-store acquisition/retention and cluster-mesh mappings stay external.
- Push this branch and open an English PR to main; record each CI job and
  remaining gaps in the requested French scratchpad report.

## Review limitation

The harness review requires installed h2a/mesh dispatch, which the owner
explicitly prohibits in this confinement. No external consensus is claimed.

## Evidence

- Vendor refresh RED: 1 failed / 21 passed (new pinned entry set absent).
- Unimplemented transport RED: 39 failed; implemented baseline: 61 passed
  across the transport and L6a registration files on Node 22 and 24.
- Headerless secondary-limit RED: 3 failed / 40 passed; corrected handling
  covers secondary limits and GitHub's abuse-detection refusal without
  exposing response bodies or gh stderr.
- A cached HTTP 304's old terminator was rejected by 2 new RED cases: current
  Link evidence is checked, or pagination is re-proven by unconditional GET.
- Final targeted set: 45 transport cases + 22 registration cases; isolated
  Node 22.22.1 and 24.21.0 runs. No full local suite was invoked.
- Eleven deliberate mutations killed: all-state filter, pagination proof,
  foreign row identity, cursor scope, ETag position, timeout, concurrency,
  secondary throttling, nonzero gh exit on 304, runtime digest, core parity.
- Repository typecheck and strict focused typecheck passed; packed runtime
  is exercised offline and vendor source/dist bytes are compared.
- The exact commands, outputs, pushed SHA, PR and individual CI jobs are
  preserved in the owner's requested `l6p1-report.md` and evidence directory.
- First PR CI correctly refused duplicate HTTP-403 test identities despite
  passing assertions. A focused JSON report reproduced the production
  execution verifier's refusal. Include the headers in parameterized case
  names; re-run that unchanged verifier on the targeted reports.

## Remaining qualification

Production GitHub/gh credentials, installed-host composition/supervision,
private Git object acquisition/retention, 1501-commit traversal, merge-strategy
attribution and cluster-mesh receipts are not qualified by this metadata
transport. The separate receiving lots and conductor integration retain
those gates. No merge, package publication or production activation occurs.

## Co-review gr-conductor — owner scope 2026-10-17

Close every PR #342 finding in the engram owner's co-review:

- Use one newest-first filter for requests and Link validation. A fake server
  actually re-sorts 150 PRs after updating a read row: the old ascending
  transport reports complete with 149 unique PRs, losing the unchanged boundary.
- Accept GitHub's numeric repositories Link path only with matching observed
  base repository ids. Keep that identity with cached pages to validate 304s;
  re-fetch if an empty cached body cannot attest the numeric repository.
- Require prev/first proof after page 1 and terminate only without next on
  that proven page. Preserve GitHub's headerless single-page response and
  unconditional revalidation when a 304 strips current Link evidence.
- Classify bare gh exit 4 as auth_required, bound the page cache to 32 entries,
  and import PrSyncErrorKind from the vendored neutral contract.

Only live-github.ts, its targeted test and this scope record change. Preserve
the interrupted attempt's work; merge origin/main normally, including #350
crash logs, without modifying main. No vendor conflict is expected: the
incoming registration maintenance guard and both provenance sets are retained.
Red/green commands, exact outputs, each CI job and the new head are appended
under "Co-revue gr-conductor" in the owner's existing scratchpad report.
Tests use disposable HOME/XDG directories and loopback fake GitHub only.
Installed h2a/mesh review dispatch remains prohibited by owner confinement;
no new independent consensus or production qualification is claimed.


# Vibe native equipment and registry transition

## Objective
- [ ] Implement validated spec-astra-v9 and close the three Opus v9 minor findings.

# Presence and identity liveness — 0.98.6

## CI compatibility — round 7

Run `38952358867` failed the mint/reclaim signed mesh round trips and the T4
deadline tail on Node 22/24 and npm-test-trust-root. The unchanged two files
reproduce exactly three failures on `12308394` (15/18 pass, zero skips), while
the same files pass 18/18 on `main@d2e0cfdc`. These are obsolete test contracts,
not product defects: the scope below explicitly requires live MCP recipients
and status-driven bounded identity retry.

- The mesh fixture registered a peer without publishing presence, so MCP now
  correctly returns `recipient_not_live`. The fixture's in-process mesh receiver
  now publishes a fresh attachment owned by the actual test PID. Both mint and
  reclaim cases additionally require typed refusal and zero transport puts
  before publication and after close. The delayed ACK, signer identity and
  signed round trip assertions remain intact.
- T4 asserted that status reads never retry, the opposite of the required
  recovery for read-only clients. It now uses status calls alone after release,
  verifies exactly one fresh attempt reaches signing-ready, and retains the
  real 20-second expiry, binding count and distinct identity checks. No signed
  fallback or increased timeout is used in this case. The shared cohort helper's
  comment now acknowledges status-driven recovery and its historical fallback.

Targeted source-build validation (Node 22.22.1), command:
`rtk env TMPDIR=/tmp IDLOCK_SUMMARY=1 node packages/h2a/test/helpers/identity-isolated-run.mjs packages/h2a/test/mcp-mesh-activation.test.js packages/h2a/test/mcp-identity-burst.test.js`.
Red lane `xRByZt`: 18 tests, 15 pass, 3 fail, zero skipped, exit 1.
Green lane `qbiP0D`: 18/18, zero skipped, exit 0. Main control `tlkc9c`
uses the same command with `IDLOCK_CANDIDATE_REF=d2e0cfdc`: 18/18, exit 0.
No product code, CI gate, test inventory or deadline changed; no full local
suite was run. Full TAP and environments: scratch `presence-evidence/tour7/`.

Branch: `fix/presence-identity-liveness`. Base: `58f111b3` (origin/main at checkout).

## Scope / Guardrails
- [x] Branch feat/vibe-host-equip; base origin/main 58f111b3; package 0.98.6.
- [x] Isolated HOME/XDG roots, repository sources only, named tests, no Python or installed h2a.
- [x] Preserve historical Claude/Codex contracts, guards, customizations and registry prerequisites.
- [x] No real-host qualification inferred from fixtures; Muse/agy M-B remains required.
- [x] Track imports reserved for the conductor in this concurrent worktree.

## Branch Scope Boundaries
- [x] Allowed: packages/h2a/{src/hosts,src/cli.ts,src/runtime/{mcp,upgrade},skills,hooks,scripts,test,package.json}, scripts, docs, package-lock.json, BRANCH.md.
- [x] Forbidden: main, owner configuration/state, installed distribution, .track writes, unrelated fixes.
- [x] Conditional: CI wiring for named tests and Node 22/24 parser checks only.

## Lots
- [x] A1: isolated source runner and historical render catalog/generator; offline tests 2/2.
- [x] A2: safe native artifact writer, TOML 1.0 validation, ownership/backups/concurrency.
- [x] A3: Vibe guard/lifecycle wrappers and independent qualification freshness; hooks 2/2, convergence 2/2.
- [x] A4/E: skills/resources, VIBE_HOME, Muse and shared agy/Gemini ownership.
- [x] A5/E: doctor/status/install/plugin convergence and setup/connect diagnostics.
- [x] A6: explicit upgrade convergence and in-memory MCP operator notices.
- [x] A7/C: opt-in bounded qualification pilot, fork wording and phase-2 budget proof.
- [x] C/code: clean tarball consumers, 17 named files / 93 pass, 0 fail/skip on Node 22.22.1 and 24.14.0; four package typechecks on both.
- [x] Opus minors: mandatory doctor diagnostic oracle; corrected two-session phase-2 double with inclusive child accounting; session/fork default attachment wording.
- [ ] C/acceptance: genuine native observations/config persistence and author-complementary harness consensus remain unqualified.
- [ ] Delivery: conventional commits, fast-forward push, English PR, CI/report in French.

- Keep MCP heartbeats alive after transient presence write failures; log the failure and retry on the next tick.
- Clean failed atomic publications immediately; collect old orphan presence temporary files.
- Make status/discovery/read calls drive the existing bounded identity retry, retaining permanent-failure and blocker-change gates.
- Reuse the 0.98.6 identity fence recovery. Collect only old dead-holder `.lock.stale-*` archives, never active fences or succession/journal files.
- Refuse live MCP discussion without fresh recipient presence (`recipient_not_live`). Bound mesh initialization/send acknowledgement to 10 seconds (`send_timeout`, delivery unconfirmed).

The parallel `feat/live-cross-cli-messaging` lot owns delivery, host wake and cross-CLI end-to-end measurements. This lot changes only presence/identity and the requested MCP send admission/deadline boundary. `sendLocalMessage` and the CLI retain the existing dormant-deposit contract; MCP opts into live-only admission.

## Isolation and collection invariants

- Repository source builds only, into mkdtemp lanes; temporary HOME, TMPDIR and XDG roots, with the existing forbidden-state/owned-PID guard.
- Targeted test files only. No installed h2a invocation, owner state/workspace, unowned process access, full suite, PR or release. Rounds 5 and 6 explicitly authorize merging origin/main into this branch.
- GC requires age >=24 hours, regular file, one link, a provably dead PID (ESRCH), and unchanged inode/timestamps before unlink. Presence filenames must also carry an old creation timestamp.
- Retain live/unknown holders, malformed archives, young files, symlinks and linked files. Read-only presence scans disable GC.
- Expiry stays honest during storage failure or disconnection. An MCP reconnect publishes a new session for the same instance; EOF removes the old attachment presence.

## Feedback Loop
- [x] B receipt discovery/API not accepted: no production reader or invented MCP writer.
- [x] Native target-host qualification and common RC-3 remain external acceptance gates.
- [x] bwrap unavailable; scoped shell calls require reviewed escalation.

## Delivery evidence
- [x] Two confined technical reviews reconciled in docs/reviews/2026-10-16-native-host-equipment.md; no harness consensus claimed.
- [x] Main inherited red: CI 38885431018, npm-test-trust-root B5 harmless proc entry case 2; legacy inventory 250ms exceeded. No guard weakened.
- [ ] B/R5/R7 receipt API, target-post Vibe qualification, Muse/agy M-B and common RC-3 remain external; A/E does not close the original MCP demand.

## Integration with refreshed main
- [x] Merge origin/main d2e0cfdc (PR 339 CI fixes); keep exact lockstep pins and vendored live-copy build step.
- [x] Track tree identical on both parents (3f3318b40d597af507216a184b9bd0e054987168); no Track repair/import/consolidation in this concurrent conductor-owned store.
- [x] CI-revealed help golden, documentation status and Focus dependency fixture corrected; three named files: 19/19 on Node 22 and 24.
- [x] Merge origin/main c771395a (PR 341 presence/identity liveness); conflict in BRANCH.md and h2a_identity_status resolved keeping both behaviours (operator notices + status-driven retry).

## PR 340 — Tour 2
- [x] Review finding 1: real identity/session/Track handler oracle, bounded supported CLI probe, component-based report/exit status and private Track workspaces.
- [x] Review findings 2/3: separate project installation with resources; managed force/conflicts; obsolete known-hash cleanup; relative manifests and one shared Gemini/agy owner with legacy-layout adoption.
- [x] Review finding 4: re-read qualification after repair; fingerprint discovery and actual installed bytes; suspend an enabled guard on project masking.
- [x] Review finding 5: stable hook insertion order and exact separator removal, including older rendered blocks.
- [x] Historical overwrite test restored for Gemini and extended to Vibe/Muse/agy; independent user-scope managed/unknown-provenance assertions retained.
- [x] CI trust-root integration: versioned inventory follows the two corrected test names and requires the new regressions; run-test-gates.test.js reproduced 37/38 then passed 38/38 on Node 22 and 24 in temporary source/HOME copies.
- [x] Direct CI blocker, bounded scope extension: gateway-host/live-registration.test.ts fixtures disable automatic Git maintenance/GC. TRACE2 reproduced two detached maintenance children before the fix (22/23); targeted file passes 23/23 on Node 22 and 24 after the fix. The strict inventory of every observed repository/Git file is retained; no production behavior changed.
- [x] Named source-consumer regression campaign: 22 files, 135 passed / 0 failed / 0 skipped on Node 22 and 24; targeted MCP compatibility: 16 passed / 0 failed / 0 skipped.
- [x] Obsolete-file cleanup requires a complete source inventory: missing packages report failure and preserve previously managed skills (red 16/17, then 17/17); versioned inventory, 22-file matrix and four package typechecks reverified.
- [x] Fetch/merge origin/main: already contained by the normal two-parent merge 53cfa83f; Track tree still identical to origin/main. No Track writes or consolidation by this worker.
- [ ] Real equipment: A/E distributes skills/resources/hooks; B (C contract §§8–11, R5/R7 bootstrap/attachment) delivers the actual MCP route; C/spec §§11–12 qualifies the target post. The owner's skills + MCP demand remains open until B and the genuine Vibe recipe pass.
- [ ] Harness consensus: exact author model/effort unavailable and installed MCP dispatch forbidden; selection-failed, no consensus claimed.

| Evidence | Result |
|---|---|
| New regression files against original HEAD, lane BR9xYC | 12 tests, 1 pass, 11 fail, 0 skipped |
| Punctuated historical archive suffix regression, lane Fp9xl8 | 11 tests, 9 pass, 2 fail, 0 skipped |
| Eleven targeted files on final sources, lane RQHurs | 96 tests, 96 pass, 0 fail, 0 skipped |
| Isolated typecheck of RQHurs | track, remote-protocol, h2a, h2a-runtime: exit 0 |

Run tests through `packages/h2a/test/helpers/identity-isolated-run.mjs` with explicit file arguments. The selected files are presence-identity-liveness, presence-identity-recovery, identity-state, send, mcp-sessions, mcp-stdio, presence-workstatus, identity-lock-recovery, identity-lock-mcp-v6, cluster-mesh-messaging and presence-confidence (`packages/h2a/test/*.test.js`).

The real-process regressions cover an injected heartbeat write failure while MCP still answers, and a live v2 holder that times out, dies without unlinking its fence, then is reclaimed by a second real identity worker triggered by status alone. Every fork is awaited during teardown.

## Limits and review

- No nine-hour soak or reproduction on the real Antigravity/Claude host. The reproduced failure routes explain code defects, not an attestation of the exact field incident.
- No end-to-end cross-CLI delivery qualification or Darwin/Windows qualification; the conductor owns integration.
- An already dispatched mesh operation has no cancellation contract. Timeout bounds the response and reports unconfirmed delivery; it cannot assert non-delivery or safe automatic retry.
- The required peer review could not be dispatched under owner confinement. See `docs/reviews/presence-identity-liveness.md`; no consensus is claimed.

## Review fixes — round 2

Independent review supplied by the owner: `revpresence.md`, verdict NON-FUSIONNABLE.
All three blocking findings were reproduced before source changes and corrected:

| Finding | Commit | Regression |
|---|---|---|
| P1: unprotected notification tick kills MCP on scan EIO | `46a496ee` | `presence-scan-recovery.test.js`: real MCP survives, next scan emits the missed peer notification, heartbeat advances, initialize responds; throwing sink/error reporter also recovers |
| P1: scan deletes a heartbeat published after its stale read | `bf0d0c0c` | `presence-sweep-race.test.js`: expired, malformed and EIO snapshots each replaced by a verified fresh publication before scan continuation |
| P2: fresh local presence from a dead PID passes live admission | `97e75967` | `presence-live-admission.test.js`: real exited PID refused on both backends before side effects, real in-memory mesh, live recovery, invalid/missing PID, alias filtering, EPERM/unknown probe errors, mirrored PID never probed locally |

The safe scan contract filters expired/malformed records without unlinking published paths.
A stat/read recheck would still leave a check-to-unlink race; no such partial fix is claimed.
`sweep` now controls orphan temporary-file GC only; explicit owner close/reap stays separate.
The former removal assertion in `mcp-sessions.test.js` now checks filtering, unchanged stored
bytes and rediscovery after refresh. The send fixture publishes its actual test PID because
MCP live admission now requires proof of a local owner (legacy missing-PID records are refused).
Mirrored records retain the remote heartbeat contract and never undergo local PID probing.
The dormant API/CLI contract remains unchanged; local PID existence cannot prove an active
MCP consumer, prevent later process death, or distinguish PID reuse.

Repro lane `np5rWT`: 12 tests, 1 control pass, 11 expected failures, zero skipped.
P1 scan lane `syuEEY`: 18/18. P1 sweep lane `v2De7L`: 31/31.
P2 admission lane `VEYUws`: 42/42. Final lane `Hd56eN`: 120/120 across sixteen
explicitly named files; zero failures/skips. Node 22.22.1. Four isolated package typechecks
exit 0: track, remote-protocol, h2a, h2a-runtime. Tests ran only through the isolated source
build helper with temporary HOME/TMPDIR/XDG roots and the forbidden-path/owned-PID guard.
Audit of 92 recorded test PIDs: none alive, no probe errors.
Command/output evidence is in the owner's scratch report `presence-report.md`, section Tour 2,
and `presence-evidence/tour2/`. No global suite or real-host validation was run.

The prior reconnect test already passed on the base; it is compatibility coverage, not a
newly fixed regression. No second independent review or multi-peer consensus is claimed;
the installed h2a MCP review launch path remains forbidden. See the review dossier.

## Review fix — round 3

Owner-supplied `revpresence2.md` retained one P2: PID filtering removed display
names before resolution, so a known dead peer returned an unqualified/phantom
error rather than the typed `recipient_not_live` refusal.

Fixed in `87d88fa1`: resolve living owners first; when no living candidate is
resolved, use the fresh records only to recover a unique known name/alias for
the existing admission check. That check still uses only qualifying live owners
and runs before signing, inbox writes or mesh dispatch. Living candidates and
their ambiguity retain priority; unknown/malformed targets keep addressing errors.
The same defect affected an unregistered peer's host:label alias and is covered
on both backends. Other CLI/MCP resolver callers do not prefilter owner PIDs;
the dormant deposit contract and the shared address resolver remain unchanged.

| Targeted isolated validation | Observed result |
|---|---|
| New regressions on unchanged pre-fix sources (`954cdc10`, lane `myhpNJ`) | 13 tests, 7 pass, 6 expected failures, 0 skipped; exit 1 |
| Admission file after fix, including two added compatibility controls (`d1EMBr`) | 15/15, 0 skipped; exit 0 |
| Five named files: presence-live-admission, send, wp2-resolve-before-send, presence-identity-liveness, cluster-mesh-messaging (`B130fd`) | 88/88, 0 skipped; exit 0 |
| Isolated typecheck of the same final build | track, remote-protocol, h2a, h2a-runtime: exit 0 each |
| Audit of recorded test PIDs across the three lanes | 44 checked, none alive |

The four display-name regressions send successfully through the same name while
a real child owner lives, terminate and await that child, then check typed refusal
without inbox/mesh effects and successful recovery with a live attachment.
Two further regressions cover unregistered aliases. Compatibility checks preserve
live names over dead duplicates, live ambiguity even with a dead alias, and
unknown/malformed errors. Node 22.22.1; temporary builds/HOME/XDG roots and the
owned-PID/forbidden-path guard. Commands, full TAP, environments and source hashes
are in the owner's scratch report, Tour 3, and `presence-evidence/tour3/`.
No full suite, real owner state, installed h2a, Python or independent consensus
review. Node 24, other OSes, nine-hour endurance and cross-CLI delivery remain
unqualified in this round. The installed MCP review launch path remains forbidden.

## Review fix — round 4

Owner-supplied `revpresence3.md`: NON-FUSIONNABLE, one P2. A known display name
lost `recipient_not_live` after TTL expiry. Fixed in `7271e66251ccb2a346c5a1c1fb1c889b316d5b7b`.

Addressing evidence now survives independently of session liveness in
`<root>/recipient-hints/`: atomic, deduplicated instance/name records, retained
without a TTL. Publications remember their recipient; explicit close/reap also
preserves legacy publications before unlink. Only the refusal path reads hints,
expired publications and registration names. Live resolution retains priority;
historical resolution can only throw `recipient_not_live`, never admit delivery.
Duplicate evidence for one canonical instance is one diagnostic candidate;
distinct historical identities remain ambiguous. Dormant CLI/API unchanged.

| Isolated targeted verification | Observed output |
|---|---|
| Initial table on unchanged round-3 source, `ZcRA35` | 27 tests, 15 pass, 12 expected failures, 0 skipped; exit 1 |
| Complete regression file on exact `a2297c25`, `eIl6Gs` | 45 tests, 15 pass, 30 expected failures, 0 skipped; exit 1 |
| Nine explicitly named files on final sources, `ikccGb` | 140 tests, 140 pass, 0 fail, 0 skipped; exit 0 |
| Typechecks of that temporary build | track, remote-protocol, h2a, h2a-runtime: exit 0 each |
| Audit of all six campaigns' recorded test PIDs | 183 checked, none alive |

The table covers bare/legacy-prefixed names, local/mesh, fresh-dead/expired/
removed/GC-swept sessions, success with the real child owner alive, no refusal
side effects, reopened stores and recovery. Controls cover TTL alone with a
living PID, renamed living instances, pre-upgrade records, registration-only
names, unregistered aliases, duplicate evidence, ambiguity and unknown targets.
One intermediate run had two missing-directory fixture errors; excluded from
product regression proof and recorded in scratch `presence-evidence/tour4/runs.md`.
Source hashes, full TAP, environments and process audit accompany that file.

No full suite, owner state, installed h2a, Python or process discovery. Node
22.22.1 only; other runtimes/OSes, field incident, endurance and cross-CLI E2E
remain unqualified. Already erased pre-upgrade names absent from registrations
cannot be reconstructed. New hints intentionally outlive session collection;
they contain no PID, heartbeat, key or launch context. No new independent
consensus review: installed MCP dispatch remains forbidden by the owner.


## Review fix — round 5

Owner-supplied revpresence4.md: NON-FUSIONNABLE, one P2 at presence.ts:79.
Accepted and reproduced: a history EIO after publishing presence left deferred
identity permanently failed (session_open_failed, retryable:false), with no
registered session or heartbeat. Fixed in 14b3aaa61ebba509a06419a75dfa33cdc70af883.

Recipient history is now best-effort at its read/write boundary. No history
failure escapes into open, heartbeat, close or reap; directory read failure
returns no diagnostic evidence. One attempt per call, no synchronous retry.
Reads are limited to 16 KiB per regular file (including growth after stat),
and directory walks to 1,024 entries. New hints are forgone when that observed
capacity is reached; unchanged hints still use the direct read fast path.
The cap is an observed admission budget, not a lock across concurrent writers;
pre-existing excess is not deleted. No TTL or liveness permission is added.
Oversized/malformed evidence is ignored; a later successful heartbeat can
repair/recreate hints. A non-file entry cannot block session lifecycle.

Normal merge aed130eb5532f9b8da50f15269bf633608b15e94 incorporates
origin/main at 7d87b4fba1734cf6d98341edbfd374f2530fa1af, with no conflict.
The merge and both parents have the identical Track blob. Source-built Track
events-contains independently confirms all 1,512 events from each parent.
Read-only query/report at the merge found 69 done items without fresh acceptance;
they remain NOT consolidated — to treat by the designated conductor/writer.
This concurrent worktree does not append or consolidate the shared journal.

| Isolated targeted verification | Observed result |
|---|---|
| Final regression file on exact pre-fix merge aed130eb (VJbyY9) | 12 tests, 12 expected failures, 0 skipped; exit 1 |
| Same regression file and eleven compatibility files on final sources (9OPDPN) | 169/169, 0 failures/skips; exit 0 |
| Typechecks of the same temporary build | track, remote-protocol, h2a, h2a-runtime: exit 0 each |

The fault table covers one-shot read/rename EIO during real identity-worker
activation, persistent ENOSPC while MCP heartbeats and answers initialize,
manual open/touch/close under open/write/close/rename/mkdir errors, unreadable
history directories, malformed JSON, a file replaced by a directory, oversized
records and capacity exhaustion. Tests check actual injection hits, EOF removal,
later history recovery and temporary-file cleanup. Every real worker is awaited.
Commands, full TAP, source hashes, temporary environments, Track output and the
owned-PID audit are retained in scratch presence-evidence/tour5/. Final runtime:
Node 22.22.1. No full suite, real owner state, installed h2a or Python.

No independent review consensus is claimed: the installed MCP dispatch required
by harness-review remains forbidden by the owner. Full integration, Node 24,
other OSes, nine-hour endurance and cross-CLI delivery/wake remain unqualified.
At capacity or on failure only historical refusal detail can be lost; live
admission still requires fresh qualifying presence. Under concurrent writers the
observed entry threshold may be exceeded; each traversal/read remains bounded.


CI exposed additional blocking fixtures after the historical builds ran:
the namespace registry parent was absent, the reaper probed a group before
checking its frame, mandatory host configuration oracles were not installed,
the 30x24 lock stress reloaded the full API per worker, and Node 24 selected
the spec reporter for a nested timeout proof. Targeted checks cover the fixes;
the stress load and 120-second deadline stay unchanged. The single local full
run passed before these CI follow-ups; final acceptance belongs to head CI.


## Main CI repair — 2026-10-16

Current branch: `fix/main-ci-green`, based on `origin/main` at `58f111b3`.
Owner scope supersedes the historical branch's dependency-range restriction:
repair B5 scheduling, restore the exact published R6 pair, and pin internal
h2a / h2a-cli / h2a-runtime / track dependencies and peers to exact versions.
Keep release preparation, lockfile and release/rehearsal gates in lockstep.

- B5 is a scheduling-dependent test assumption: a 300 ms pause reproduces
  the CI's 250 ms incomplete-inventory refusal. Completeness uses a test-only
  monotone clock. Six boundary cases retain refusal at and beyond both the
  inventory cap and a shorter attempt deadline; product evidence is unchanged.
- R6's published core 0.98.5 must install runtime 0.98.5 explicitly; both
  real election orders fail before the pin and pass after it.
- Exact internal requirements prevent future npm resolution from combining
  incompatible patch releases. Version preparation preserves pins, and
  release verify/publish reject floating or mismatched internal requirements.
- Targeted source-built identity lane: 70 passed, 0 failed/skipped.
  Release helper/workflow/order checks: 60 passed, 0 failed/skipped.
  Red/green commands and outputs are retained in the owner's final report.

Only named test files run locally under temporary HOME/XDG/H2A roots. No
installed h2a, native host, foreign PID, full local suite, merge or publication.
CI on the PR is the integration authority. External review through the real
h2a/mesh is excluded by the owner's confinement; no consensus is claimed.

## Live Git R1 — owner scope 2026-10-16

- [x] Branch `feat/live-git-r1-retention`; engram plan/09 R1 and LIVE §4 are authoritative. No main change, merge, release, source-repository write or full local test suite.
- [x] R1 design: bind each host port to one authorized tenant/clone/format. Read only source objects through a private git-dir and a whitelisted environment, stream a pinned full-history pack into a fenced private generation, verify commit/parent/tree/blob closure, enforce the object-byte quota including indexes, then sync objects, pin and receipt. Every request is durable before acquisition; quota/busy/missing objects remain explicit retryable backlog. No eviction or source alternates.
- [x] R1 lifecycle: a job-removal callback runs only after a validated receipt for the entry scope/algorithm/OID; expose local backup paths and opaque stable backup references for L8. Runtime supervision/composition belongs to L7a; no automatic job worktree removal exists in the current host.
- [x] Scope amendment R1-H-EX1 (required by the owner request): retain the three plan/09 host paths `packages/h2a-runtime/src/gateway-host/live-object-store.ts`, `packages/h2a-runtime/src/gateway-host/live-object-store.test.ts`, `packages/h2a-runtime/src/delegate.ts`; add `packages/h2a-runtime/src/gateway-host/fixtures/live-object-store-child.mjs` for real-process pack/pin suspension. Additionally refresh the four runtime vendor entries `contracts`, `registration`, `integration`, `retention` (each `.js`/`.d.ts`), the two core `contracts` files, and `packages/h2a-runtime/src/gateway-host/live-registration.test.ts` for pinned integrity/parity. Generated vendor size is not handwritten implementation scope. Source is engram `545a57b8911ab108e84fa1778e0f268fe11bf1de`, independently matched to remote main with `git ls-remote`; the read-only clone cannot update FETCH_HEAD.
- [x] Scope amendment R1-H-EX2: fix the explicitly requested L6a-H residual in `packages/h2a-runtime/src/gateway-host/live-declarations.ts`, `packages/h2a-runtime/src/gateway-host/live-declarations-process.test.ts`, `packages/h2a-runtime/src/gateway-host/fixtures/live-declarations-child.mjs`; remove `docs/plan/live-git/L6a-H-next.md` and its `scripts/test-non-tests-0986.json` entry. Update the exact remaining declaration counts in `packages/h2a/test/gate-execution-evidence.test.js` (27 total, 4 runtime) and explicitly forbid re-declaring the fixed suite. Atomic publication of a prepared nonempty directory replaces the proposed file/link protocol while preserving generation-source fencing; update and delete cuts both execute.
- [x] Delivery lots: L6a lock regression/declaration removal; pinned neutral vendor refresh; private object store/lifecycle handoff and targeted regressions. Stage each logical lot separately, with English conventional subjects and no attribution trailer.
- [x] Final verification: named suites on Node 22/24 (14 retention, 22 registration, 9 declaration fencing), seven rejected/restored mutants, isolated source-only typecheck, vendor dist mirror, declaration execution gate (109 tests on each Node version) and diff check; exact commands/results in the owner scratchpad report.
- [x] Scope amendment R1-H-EX3: align consumption-provenance comments in `packages/h2a/src/runtime/live/contracts.ts` and the already scoped runtime registration test with the refreshed vendor source; no API or behavior change.
- [x] Push this branch and open English PR https://github.com/rhanka/h2a/pull/343 to main. The owner scratchpad report lists every observed CI job and its current/final status. No external h2a review can be performed within the owner confinement; review is recorded as unavailable, without consensus.


## Main CI repair — Tour 2

Owner scope: integrate #338 and origin/main (#333) through normal merge
commits, without rebase or force-push. This supersedes the historical merge
restriction above. No merge into main or real publication is authorized.

The rejected offline workaround is removed. Rehearsal stamps the disposable
CI workspace after build and before pack with
`<version>-rehearsal.<run_id>.<attempt>`, rewriting all internal manifest pins
and the independent smoke literal. The exact-version gate still runs before
pack and accepts those exact prerelease pins. Release manifests and lockfile
stay at 0.98.6 in git; the real release path is unchanged.

Publish parity permits only --dry-run and the explicit default prerelease
tag; no offline/cache exception remains. Execution tests retain all four
publish bodies, default/backfill selection and npm failure propagation.
The owner report records strict-test red/green, broken-package rejection,
targeted regressions and final PR CI. No full local suite is authorized.

## Co-review R1 — owner scope 2026-10-17

- Owner authorizes integrating origin/main through a normal merge (including #350 crash logs), targeted regressions only, and fast-forward push of feat/live-git-r1-retention. This supersedes the earlier R1 merge restriction.
- Close gr-conductor's one major and five minor findings in the existing R1 paths plus its process fixture: generation-sourced atomic pack/pin/receipt/gap publication, bounded per-request receipt lookup with no fsck during load, exclusion of retained history, logical quarantine and retry of invalid receipts/missing pins, vanished-lock contention classification, and neutral-engine ownership of request satisfaction. No vendored contract changes.
- Real owned processes suspend at pack, pin and receipt publication; the fenced process performs zero shared writes while the successor remains suspended with its lease. Every process is reaped in finally. Sources and runtime roots are temporary.
- Baseline at 36567c25: the strengthened named retention suite exits 1 (9 failed, 14 passed); corrected suite exits 0 (23 passed, no skips). Exact commands, final head CI jobs and remaining qualification live in the owner scratchpad's “Co-revue gr-conductor” appendix and tmp/l6r1-coreview evidence.
- No installed h2a or host state, full local suite, foreign PID, Python, main mutation or force push. External harness consensus cannot be run within the owner's confinement (installed h2a MCP required); no consensus claimed. Track remains single-writer: do not append/consolidate from this concurrent worktree.


## RC on npm next — owner decision 2026-10-16, part B

Branch: feat/release-rc-next, based on origin/main at d2e0cfdc.
Owner scope: require a successful same-source-tree RC before every stable
release; no tag push, npm publication, main write or full local suite.

- Keep stable versions in Git; stamp disposable RC manifests, all internal
  exact pins and the independent artifact smoke literal after the test gate.
- Publish the four verified tarballs on next only for vX.Y.Z-rc.N, preserving
  the same verify/pack/smoke and strict publish-rehearsal body parity.
- Record a repository/run/attempt/commit/tree attestation only after completed
  post-publish install/doctor smoke, all four next tags and registry integrity
  matching the verify-built tarballs. This also protects idempotent skips.
- Stable publication (backfill included) requires a successful RC push run
  from release.yml, a nonexpired artifact for its current attempt, matching
  release train/tree and corroboration from GitHub's Git commit API.
- Operator docs require owner installation of @sentropic/h2a@next and a real
  machine reboot before tagging the stable version on the same merged commit.

Targeted red/green evidence is retained in tmp/release-rc-evidence and in the
owner's requested scratchpad report. npm/GitHub publication is simulated;
GitHub metadata inspection is read-only. No installed h2a is invoked locally.
Native h2a/mesh consensus review is excluded by the owner's confinement;
review metadata/eligible hosts cannot be established, so no consensus is claimed.
CI on the PR is the integration authority; machine reboot remains owner UAT.

## RC review reserves — owner scope 2026-10-16

Close both P2 findings from the independent review of PR #345: document the
explicit exact-version stable installation after publication because upgrade
rejects prerelease versions, and make generated release instructions follow
RC publication, attestation and owner reboot acceptance before the stable tag.
Both tags retain signing and target the same verified merged commit.

The operator-flow regressions failed before the fix (27 passed, 3 failed,
0 skipped) and passed after it (30 passed, 0 failed/skipped). Merge origin/main
through a normal merge commit, run named release regression files only, and
push this branch. No main write, tag push, publication or installed CLI run.
Evidence and final CI job results are appended under "Réserves Astra" in the
owner's scratchpad report; physical reboot and real publication remain owner UAT.
## Review fix — round 6

Owner-supplied `revpresence5.md`: FUSIONNABLE-AVEC-RESERVES, one P3.
Accepted and reproduced with three real subprocesses held after actual directory
enumeration: each observes the same 1,023 entries, then the old implementation
publishes all three (1,026 entries). Fixed in `aa16ad17addc1d63f77d03b7fd2fad657b310220`.
This section supersedes round 5's concurrency limitation.

New history uses a fixed pool of numbered slots: one exclusive, non-recursive
mkdir reserves the first missing slot in the bounded snapshot. Contenders for
the same snapshot make one attempt at the same slot; losers return immediately.
With L stable legacy entries, admission can only claim slot indices below
1,024-L. Arbitrary interleavings of updated writers therefore cannot grow a
directory initially within capacity beyond 1,024 places. Each slot contains at
most one temporary or published file; no extra temporary file sits outside its
reservation. Legacy hints remain readable and oversized/corrupt legacy files
are repaired atomically through a reserved temporary place. Existing excess is
not evicted, and receives no new places. No dependencies or global lock added.

An interrupted writer can consume one place but cannot lock out the remaining
pool. Failed writes clean their temporary and empty reservation best-effort;
incomplete places count against capacity and never become addressing evidence.
Overlapping identical publications are deduplicated on read. No history record
admits a send; unchanged live-admission and dormant API contracts still apply.

Normal merge `a99919956c594733e51fcd2ba230c172484038e9` incorporates origin/main
`d2e0cfdc069f5714bc3d15ce75eb07ac7c1c240c` (#339). The sole conflict was in
BRANCH.md; both contents were preserved. Exact internal dependencies/peers and
lockfile remain at 0.98.6. Track events-contains confirms all 1,512 events from
each parent. Read-only query/report on a temporary copy still exposes 69 done
items without fresh acceptance: NOT consolidated — to treat by the designated
single writer/conductor, with no journal edits in this concurrent worktree.

| Targeted verification | Observed command output |
|---|---|
| Final regression bytes on exact pre-fix merge a9991995 (3SYT0W) | 16 tests, 15 pass, 1 expected failure (1,026 != 1,024), 0 skipped; exit 1 |
| Thirteen named history/presence/send/MCP compatibility files (jReCeb) | 173/173, 0 failures/skips; exit 0 |
| Three named incoming version/release/rehearsal files in the same temporary lane | 47/47, 0 failures/skips; exit 0 |
| Typechecks of the same temporary source build | track, remote-protocol, h2a, h2a-runtime: exit 0 each |
| Spawned-PID audit over all four campaigns plus merge checks | 183 checked, none alive, no errors |

Full commands, TAP, SHA-256 red/green provenance, temporary environments and
process audit are retained in scratch `presence-evidence/tour6/`; owner report
`presence-report.md`, Tour 6. Runtime Node 22.22.1. The final test/helper bytes
are identical on red and green; all tested source bytes match the fix commit.
No full suite, installed h2a, owner state, Python or foreign process access.

No new independent consensus or merge approval is claimed. The required installed
MCP review launch remains prohibited by the owner; the review dossier records
selection-failed. Node 24, other OSes, field/endurance and cross-CLI end-to-end
remain outside this round. Capacity/failure may lose optional historical detail;
the root concurrency defect is fixed without introducing a persistent global lock.

# MH-L0 — 0.98.7 contract foundations

## Objective
- [ ] Deliver only spec v7 §12 MH-L0, including the measured npm BX correction.

## Scope / Guardrails
- [x] Branch feat/0.98.7-mh-l0, base e3fc1a52 (0.98.5); no integration of #316 or .6 here.
- [x] Owner state, installed h2a/dist, native sockets and unrelated processes forbidden.
- [x] Private temporary test directories; targeted files only; no Python.
- [x] Public strategies, CLI routing, native restart and .8 coordinator/verifier forbidden.

## Branch Scope Boundaries
- [x] Allowed: packages/h2a/src/runtime/handover/**, packages/h2a/test/mh-l0-*, packages/h2a/test/helpers/mh-l0-*, docs/plan/mh-l0/**, scripts/mh-l0-*, BRANCH.md.
- [x] Forbidden: other runtime files, package versions/dependencies, installed state, main, .track (shared writer), full-suite commands.
- [x] Conditional: QF entrypoint/layout contract provisional until owner ratification; runtime routing belongs to MH-L6.
- [x] BR-L0-EX1: cohesive contract/test commits may exceed 150 lines; one concern, selective staging, rollback by git revert.

## Lot 1 — Canonical bytes and authentication vectors
- [x] Strict RFC 8785 bytes, SHA-256, domain-separated HKDF/HMAC and negative vectors.
- [x] Gate: node --test packages/h2a/test/mh-l0-wire.test.js, red then green.

## Lot 2 — Versioned formats
- [x] Marker, namespace/authority, readiness, requests/frames, evidence, ownership/checkpoint, H4/selection, manifest/native formats.
- [x] Gate: node --test packages/h2a/test/mh-l0-formats.test.js, red then green.

## Lot 3 — Durable private state
- [x] Private reads, exclusive publication, replacement under caller exclusion, fsync and reconciliation errors.
- [x] Gate: node --test packages/h2a/test/mh-l0-state.test.js, red then green.

## Lot 4 — Domain, layout and image audit
- [x] Physical prefix identity, private authority domain and bounded abstract pre-claim.
- [x] Closed/native manifest and no-Python native feasibility.
- [x] Gate: node --test packages/h2a/test/mh-l0-authority.test.js and mh-l0-image.test.js and mh-l0-native.test.js, red then green.

## Lot 5 — Heritage, npm and pair
- [ ] Audit source refs, native relaunch closure, legacy probe, dependencies and pending .6 dist gate.
- [x] Reproduce BX with private prefix/cache, local tarballs/registry; revise U09 and prepare QF dossier.
- [x] Test-only network peer, evidence and CAS/ACK fault primitives.
- [x] Gate: node --test packages/h2a/test/mh-l0-npm.test.js and mh-l0-peer.test.js, red then green.

## Lot 6 — Delivery
- [ ] Reconcile scope/evidence/review limitations; recalibrate MH-L1–MH-L8.
- [ ] Push own branch fast-forward; write owner mhl0-report.md in French.

## Feedback Loop
- [x] Final .6 dist unavailable: audit source closure now; U13 byte qualification remains MH-L1/MH-L8.
- [x] QF/QC/QD/QE/QG remain owner decisions; no runtime entrypoint chosen by MH-L0.
- [x] Installed-h2a harness review/recorders conflict with owner confinement: do not invoke; no consensus claim.

# Inherited main — Claude seat, 0.98.8

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
