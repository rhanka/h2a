# Daily vulnerability remediation — activation contract

Owner decisions, 2026-10-18: **A · Partager la maintenance**, **Tous les
dépôts prêts**, **Fix + revue autonome**, **Dans gh**. These supersede the
earlier manual-merge/local-systemd assumptions. No schedule is enabled.
The standing #371 merge NO GO remains in effect.

Reference: SPEC_EVOL_VULN_FIX_ACTIVATION.v2.md, SHA-256
624146043693f553cd50cd4c6f3f618242f1066866511eba09f76009dcc58593.
Both supplied final-spec reviews say GO-CODE on that digest. This is not a
live seat, authority, runner or activation receipt.

## Rules

1. Detect and fix npm HIGH/CRITICAL findings across every independently ready
   repository using npm audit, hydrated OSV and configured extra scanners.
   Unknown severity stays visible; incomplete scans never mean clean.
2. Reuse #371 controller/state/scanners and #348 seat materialisation.
   No second vault, quota ledger, refresh service or controller.
3. One shared authority atomically reserves author + two reviews.
   Remediation competes for two Codex maintenance units; preserve 6 CI +
   2 enrolment, cap 10/CLI/UTC day, provider reserve >20%, unknown = refuse.
4. Bind admitted seat reference/generation to its executed private projection.
   No ambient login or API-credit fallback. Require usage/role/model permission.
   Claude is a tested provider, never a remediation sub-contractor. The first
   proposed pool is Muse author + two distinct Codex reviewer models; exact
   binary/model/effort qualification is not inferred from aliases.
5. Publishing belongs to deterministic control. Native authentication gets
   only its admitted capability. Tools/installers/tests get neither provider
   nor publishing/control capability. Private HOME/env filtering alone cannot
   prove filesystem/process/FD/socket separation.
6. Existing compatible locks only: no majors/new packages/manifest edits;
   seven-day age for every modified package and integrity/signature/provenance.
   No urgent age exception.
7. Autonomous merge requires exact-head independent reviews, all required
   checks successful (missing/skipped blocks), lock/trust/scan/test proofs,
   unchanged proven base, resolved blocking threads and repository rules.
   Merge commit + expected-head protection; never admin bypass or squash.
8. Audit RED → GREEN is separate from ordinary tests GREEN → GREEN. Only an
   applicable explicitly named redBefore:true regression uses functional
   RED → GREEN. Install failures, skipped/TODO tests and unrelated failures
   never qualify as regression RED. Every candidate test must execute.
9. Persist owned pending PRs/evidence outside worktrees. Reconcile age/checks/
   admission across restart and UTC days before new claims. Unchanged head/
   base never repeats completed inference/charges. Save merge intent before
   dispatch; reconcile remote state before retrying ambiguous acknowledgements.
   Never adopt ownership from a branch prefix.
10. Reports distinguish scanned/fixable/fix-blocked/merged/delivered. An open
    PR is unfixed. Closing admissions stops merges and new work; never reset
    accounting to regain quota.

## L0 inventory — no secret or owner-state discovery

Checkout: /home/antoinefa/src/h2a/tmp/worktrees/vulnfix.
Branch: feat/daily-vuln-fix, rebased on origin/main
7ebbcf266e1988c18624d0158936949a214f9fd8 (includes #348).

| Inventory | Evidence / state | Resolver and acceptance |
|---|---|---|
| Seat references, owner, entitlement, usages/roles/models, expiry/generation, custody, capacity | Unknown; no private state read, no enrolment | Lab operator: redacted metadata + separate native/mesh and lifecycle receipts |
| h2a locks | Root, apps/focus and packages/h2a/focus-kit package-lock.json tracked | h2a conductor: installs, manifest coverage, required tests, sharing consent, merge/delivery effects; inventory is not readiness |
| sentropic, radar-immobilier, graphify/engram | Candidate names only; graphify correspondence and per-repo readiness unknown | Each conductor: exact roots/locks/tests/consent/delivery; no other repo edited here |
| Published L1 | Latest llm-mesh 0.27.0 / cluster-mesh 0.19.1 still lack public consumer parsers; sentropic #681 OPEN at 7293130ee3f6 | sentropic L1 maintainer publishes import/parsers, then h2a pins and qualifies ten imports/reload/refusals |
| Shared authority + D6 amendment | Deployed source/tests, cycle interface and integration command unknown | sentropic quota maintainer supplies exact source/tests and race/UTC/unknown-quota proof; no local substitute |
| L3-R custody | Renewal/later-run verification/delivery/next consumption unknown | sentropic custody + h2a consumer maintainers: N → N+1 → next native use; serialized handoff where required |
| D10 adapter | Qualified source/tests and role boundaries unknown | Shared runner maintainer proves env/file/process/FD/socket canaries, positive controls, cleanup |
| GitHub placement | OQ1 principles and full technical derivation absent | h-cond/operator specifies orchestration repo/ref, role runners, custody delivery, retries/wake-ups, merge executor/rules, stop/resume before placement code |

Unknowns are blocked dependencies, not executable placeholder paths. No
admitted seat or ready repository is claimed.

## Execution sheets

All commands run from this checkout root with temporary XDG/runtime state.
Only targeted files; the conductor owns full-suite integration. Existing
paths are confirmed against the integrated base; proposed new files are
explicit. Unresolved owning paths/interfaces/commands block dependent code.

| Lot | Exact h2a source and tests | Status / closure |
|---|---|---|
| L0 | This contract; packages/h2a/skills/vuln-fix/references/operator.md | Documentation, no RED; global G0 open |
| L1 | Runtime src/llm-mesh-accounts.ts, src/index.ts, package.json; docs/cli-seat-l2s.md; new runtime src/cli-seat-published-l1-contract.test.ts | BLOCKED on published API. Intended targeted command below; ten imports through real boundary, lineage/idempotence/owner/expiry/401, no fake facade |
| L2 | Runtime src/vuln-seat.ts, agent-launch-args.ts, cli-seat-materialization.ts; h2a src/vuln-fix/seats.mjs, policy.mjs; runtime vuln-seat.test.ts, agent-launch-args.test.ts; h2a vuln-fix-policy.test.js, vuln-fix-controller.test.js | BLOCKED on L1 or V3 native proofs and qualified input/tools/models/efforts; no guessed Muse flags |
| L3 / L3-R | h2a src/vuln-fix/seats.mjs, controller.mjs, repository.mjs; runtime src/vuln-seat.ts, cli-seat-materialization.ts, llm-mesh-accounts.ts; proposed h2a test/vuln-fix-seat-authority.test.js, vuln-fix-seat-lifecycle.test.js plus existing seat/repository/controller/materialisation tests | BLOCKED on authority/custody/confinement owning sheets; real integration commands cannot be invented |
| L4 | h2a src/vuln-fix/cli.mjs, repository.mjs; proposed runner-entry.mjs / github-gate.mjs and corresponding tests after placement resolution | BLOCKED on OQ1 and L2/L3/L3-R; no workflow/timer choice |
| L5 independent contract | h2a src/vuln-fix/controller.mjs, state.mjs, verify.mjs, scan.mjs; new test/vuln-fix-merge.test.js | Resolved below, independent contract may progress under OQ1; production integration BLOCKED on L2/L3/L4 |
| L6 | Operator reference; test/vuln-fix-controller.test.js, vuln-fix-repository.test.js | Inventory progresses; activation BLOCKED; other repositories' validators/locks belong to their conductors |
| L7 | scripts/e2e-cli-seats-direct.mjs; h2a test/cli-seat-direct-matrix.test.js; conditional runtime codec/materialisation sources; docs/cli-seat-l2s.md | BLOCKED on L1 + real binary/route/lifecycle/admission; retain refusing stub until prerequisites. Ten usages + 100 scenario + two-author rotation receipts required |

L1 intended targeted command (not a claim of availability/closure):

    rtk npx --no-install vitest run --config packages/h2a-runtime/vitest.config.ts packages/h2a-runtime/src/cli-seat-published-l1-contract.test.ts

### L5 independent gate/reconciliation contract — frozen before RED

Owner: h2a maintainer. Base: rebased #371 before this lot.
Existing source operations: evaluateMergeEvidence in verify.mjs,
reconcileCandidate in controller.mjs, candidate metadata validation in
state.mjs, scan comparison in scan.mjs. Internal exports only, no configured
production runner or selected GitHub merge placement.

Candidate metadata binds repository/PR/branch, base/head, author/reviewer
identities + permissions, verification/guard digests, immutable receipts and
merge intent/result. Adapter observe(candidate) rereads remote ownership,
head/base/reviews/checks/merge state and revalidates lock/trust/scan/tests.
Adapter merge(candidate, {expectedHead, expectedBase, method, intentId})
enforces the selected executor's protected operation at effect time, never
bypassing repository rules. No production adapter is supplied here.
A temporary-remote adapter proves the independent contract only.

The daily controller calls this seam through repository.observeCandidate and
repository.mergeCandidate before scanning or checking the daily claim. The
production Repository implements neither operation until L4 resolves its
placement. Missing adapter yields durable waiting-admission, never a merge.
Legacy attempts are not adopted into candidates: L2/L3/L4 integration must
create exact owned-candidate records from admitted executions and immutable
evidence. No production autonomous merge path is claimed here.

Failures persist bounded retry; head/base/proof change requires revalidation;
blocked reviews stay blocked. Pending checks/age persist with a next wake-up.
Disabled admissions suspend merge. Intent is durable before merge. Uncertain
acknowledgement stays merge-pending until remote observation resolves it.
This contract never starts inference or changes quota counters.

Literal RED/GREEN command:

    rtk node --test packages/h2a/test/vuln-fix-merge.test.js

Expected initial RED: independent contract missing / no merge effect.
Positive: real temporary bare remote, ordinary targeted Node tests GREEN →
GREEN, audit RED → GREEN, two SHA-bound reviews, one two-parent merge.
Resume: pending checks; seven-day maturation across UTC; lost merge
acknowledgement; duplicate completion; retained accounting/no new inference.
Separate guards: stale head/base/reviews/proofs, skipped checks/tests,
provenance failure, non-lock/major/new-package changes, disabled admissions,
foreign/ambiguous ownership. Guard refusals are not baseline exploits.

## Remaining gates

L6 independent reporting/stop sheet (before its RED): h2a maintainer,
same integrated base, packages/h2a/src/vuln-fix/controller.mjs and existing
packages/h2a/test/vuln-fix-controller.test.js. Command:
rtk node --test packages/h2a/test/vuln-fix-controller.test.js.
Expected RED: dry-run without an admitted cycle reports would-attempt, and
explicitly closed admissions still launch an author. GREEN distinguishes
scanned/fix-blocked and stops inference while retaining scans and accounting.
This is reporting/control progress, not L6 repository or activation closure.

## Targeted execution evidence (2026-10-18)

Commands run from this checkout root. Each named Node test file is targeted;
no full local suite, real seat, live native host, timer or workflow activation.
All recorded runs have skipped=0, cancelled=0 and todo=0.

| Lot / command | Observed RED | Observed GREEN |
|---|---|---|
| L5: rtk node --test packages/h2a/test/vuln-fix-merge.test.js | Initial 4 tests: pass 0 / fail 4, exit 1; "placement-independent merge reconciliation must exist", actual undefined | Same positive scenarios: pass 4 / fail 0, exit 0 |
| L5 regression: same command, 8 tests | pass 5 / fail 3, exit 1; unrelated assertion and low baseline wrongly merged; controller left candidate ready instead of merged | pass 8 / fail 0, exit 0 |
| L5 observation guards: same command, 50 tests | pass 46 / fail 4, exit 1; null review/package/check threw TypeError; string role bypassed permission validation | pass 50 / fail 0, exit 0 |
| L6: rtk node --test packages/h2a/test/vuln-fix-controller.test.js | pass 15 / fail 2, exit 1; actual would-attempt vs scanned; actual ready vs waiting-admission | pass 17 / fail 0, exit 0 |
| Integration: rtk node --test packages/h2a/test/vuln-fix-repository.test.js | No new regression claimed | pass 11 / fail 0, exit 0 |
| Integration: rtk node --test packages/h2a/test/vuln-fix-scan.test.js | No new regression claimed | pass 9 / fail 0, exit 0 |
| Integration: rtk node --test packages/h2a/test/vuln-fix-cli.test.js | No new regression claimed | pass 4 / fail 0, exit 0 |
| Integrated masking: rtk node --test packages/h2a/test/vuln-fix-redact.test.js | Historical regressions, no new baseline failure claimed | pass 10 / fail 0, exit 0 |

Positive merge tests create a real temporary bare Git remote, execute actual
targeted baseline/candidate Node tests, and create exactly one two-parent
merge using an atomic expected-head/expected-base ref transaction. Audit and
provenance are controlled synthetic fixture evidence, not a real CVE or
registry attestation. Restart reloads persisted state under the existing
flock; usage counters cross UTC unchanged. No inference operation exists in
the reconciliation adapter. These results do not close live G3.

Published-boundary inspection installed llm-mesh 0.27.0 / cluster-mesh 0.19.1
with --ignore-scripts --package-lock=false --no-audit --no-fund under
/tmp/h2a-vulnfix-proof-wr6Y5wze/published. Both public enrollment entrypoints
reported parseCliSeatProfile=undefined and parseTokenSeatEnvelope=undefined.
This is an API blocker observation, not a delivered L1 RED/GREEN test.

Read-only sentropic #681 source inventory at 7293130ee3f6 (no edits here):
packages/llm-mesh/src/enrollment/cli-seat-import.ts, enrollment/index.ts,
service/facade.ts, service/external-seat-authority.ts; tests/enrollment/
cli-seat-import.test.ts, seat-bundle.test.ts, tests/service/facade.test.ts,
seat-projection-delivery.test.ts under that package. Delivery route:
api/src/routes/namespaces/llm-seat-delivery.ts with
api/tests/api/llm-seat-delivery.test.ts. Cluster public-surface test:
packages/cluster-mesh/tests/integrations/llm-surface.spec.ts. Its conductor
still resolves checkout, publication/exports and literal targeted commands;
this inventory is not execution authorization in another repository.

G0 partial. G1 placement and G2 live identity/quota/custody/separation open.
G3 requires integrated qualification + selected continuation artefacts.
G5 requires exact-final-SHA Sol 6.1 xhigh + Astra max code reviews and the
conductor's CI integration result; spec approval cannot replace them.
G4 scheduled activation and G6 production autonomy follow release under the
conductor/operator, never this worktree. G7 remains independently due.

Non-npm ecosystems, majors/new packages, urgent age exceptions, rollback,
served-model attestation and macOS/Windows live qualification remain outside
this delivery. Synthetic proof never establishes real CVE repair/activation.
