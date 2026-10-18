# Daily vulnerability remediation — operator activation sheet

Owner decisions: A · Partager la maintenance; Tous les dépôts prêts;
Fix + revue autonome; Dans gh (2026-10-18).
See [the activation contract](../../../../../docs/specs/SPEC_EVOL_DAILY_VULN_FIX.md)
for L0 execution sheets, exact paths, dependencies and gates.

## Current delivery

The existing daily command scans npm locks, makes compatible lock-only drafts
and gathers local review receipts. Its legacy local runner is not qualified
for activation: it inherits ambient identity, admits tasks separately, lacks
the D10 process boundary and has no qualified Muse headless lane. Configuring
three names is not a seat pool. The independent L5 gate/reconciliation code
does not supply a production executor, quota authority or scheduler.

Do not activate the legacy route. No timer/workflow is installed or enabled.
The older manual-merge/systemd recommendation is superseded; GitHub placement
must be derived from the unresolved OQ1 principles and recorded by h-cond.
Rendering legacy units does not qualify or select them.

## Readiness per repository

All ready repositories are in scope, independently. Each conductor supplies:

- Canonical root and exact rhanka/repo fetch + push remote, ignored repo-local
  tmp/worktrees, state outside candidates, no checkout credential residue.
- Every tracked npm lock domain and represented manifest; installable baseline
  with scripts disabled. Fixtures/overrides/peers resolved or visibly not-ready.
- Exact targeted test commands supported by the validator: node --test file,
  vitest run file, or npx --no-install vitest run file. A needed Make/container
  adapter is a prerequisite in its owning repo with exact source/test sheet.
- Sharing consent for npm audit/OSV and private source with each work provider.
  OSV receives public npm package identities; other sources configured or
  explicitly absent. Unknown severity/incomplete coverage stays visible.
- Intended merge/publication/deployment effects and their responsible owner;
  branch rules/check names and merge-commit support; limited controller writer.

Ordinary tests must execute GREEN → GREEN. Only a named applicable regression
has redBefore:true; baseline execution/skip failure is never a useful RED.
Candidate tests, skipped/TODO/missing checks and incomplete scans block merge.
Initial delivery retains seven-day maturation, integrity/signature/provenance,
no majors/new packages/manifest changes. Young fixes wait; no urgency exception.

h2a tracks three package-lock domains (root, apps/focus,
packages/h2a/focus-kit); installs/consent/delivery qualification remains open.
sentropic, radar-immobilier and graphify/engram remain conductor inventories;
no repository is admitted merely by naming it.

## Seats and shared authority

The lab operator supplies non-secret seat references, owner/provider, explicit
test-cli/test-gateway/vulnerability-remediation usages, author/reviewer roles,
exact allowed models/efforts, entitlement/billing, expiry/generation, custody
reference and qualification/capacity state. These fields are currently unknown.

Claude is never a work sub-contractor but remains required as a tested provider.
The first proposed pool is one Muse author plus two distinct Codex reviewers.
Missing/unqualified legs block before inference. Requested model and served
model are distinct; aliases do not attest the latter. OQ3 must qualify exact
binaries/model ids and the technical mapping of max without silent downgrade.

L1 publication must expose consumer import + cli/token parsers. Current public
llm-mesh 0.27.0 / cluster-mesh 0.19.1 still lack the parsers. Do not replace the
consumer import with renewable product OAuth or pretend an injected fake facade
is the published-boundary proof. OAuth/explicit private CLI manifest/bounded
masked or stdin consumer SeatBundle enrolment are operator acts only; no secret
in argv, conversations, model tools or reports.

One real authority reserves the whole author + two-review cycle atomically.
Purpose is vulnerability-remediation, never CI. Two Codex maintenance units
compete with other maintenance; preserve six CI + two enrolment, global cap
10/CLI/UTC day, all provider windows >20%, unknown quota = no inference.
Receipt binds exact workspace, guard digest, seat/generation and freshness
under 24h for each author/review tree. A JSON echo/static guardQualified flag
is not authority. No second ledger, vault or refresh service belongs here.

Admission → materialised private profile → executed identity must be one chain.
Access-only/mesh consumers never refresh or fall back on 401/expiry.
Serialized native delegation, if required, reuses #348 family tickets and
central drain/capture/seal/save/later-run-verify/delivery before next use.
L3-R real N → N+1 → next-consumption and lost-dispatch recovery are mandatory.

## Role boundaries

Controller publication/merge code executes no candidate code and holds only
repository-limited publishing rights. Trusted native authentication receives
only its admitted projection, never writer/dispatch authority. Model-visible
tools/MCP children and candidate installers/tests receive no provider, refresh,
credit, publishing, control endpoint or inherited descriptor capability.

A private HOME/env allowlist is insufficient for same-UID file/process access.
The selected shared runner adapter must prove env/file/process/FD/socket
canary denial with positive controls, real targeted test execution and cleanup.
No production boundary is selected or qualified by this delivery.

## Pending PRs and merge contract

Ownership requires durable repository + PR + branch + expected base/head and
evidence, not a security/ branch prefix. Foreign/ambiguous PRs stay operator
handoffs. Store metadata outside worktrees; never adopt/duplicate a foreign PR.

The independent reconciliation seam observes head/base, reviews, checks and
fresh lock/trust/scan/test evidence at merge time. Only a selected adapter can
execute a protected merge commit; it must enforce expected head/base and branch
rules at effect time. No production adapter is configured by this delivery.
Missing evidence blocks; no admin bypass or squash.

waiting-checks, waiting-age and waiting-admission retain reasons and next
wake-up. Unchanged head/base reuses completed SHA-bound review receipts,
without a new author, quota reservation or charge. Changed proof/head/base
needs revalidation. Save intent before dispatch. After lost acknowledgement,
observe remote result before retrying; unknown outcome stays merge-pending.
Duplicate completion events cannot create a second effect. Disabled admissions
stop merges as well as inference; observation/reporting can continue.

## Deployment and acceptance handoff

Before proposing #371 merge: resolve all first-activation L0 sheets, qualify
L1 or V3 native prerequisites, L2 identity + L3 quota/separation + L3-R lifecycle,
derive OQ1 placement, run G3 positive audit/test/review/merge qualification on
the integrated candidate and prepare scheduler/continuation artefacts.
Conductor obtains exact-final-SHA Sol 6.1 xhigh + Astra max code reviews and
full-suite CI integration (G5). The standing merge NO GO needs its existing
owner authority lifted; GO-CODE alone does not lift it.

After release only: operator deploys reviewed private config/artefacts and
enables exactly one selected scheduler/admission owner. Observe its first
scheduled production run (G4), then real admitted autonomous merges and
delivery (G6). Qualification on a controlled fixture is path proof, never a
real CVE repair. Never introduce a vulnerability into a real repository.

Stop: close admissions and the selected scheduler, drain own tasks, retain
claims/counters/proofs/custody intent. Resume: reconcile remote PR/merge state
and seat lifecycle first. Never erase counters or unlink a live lock.
The selected placement must document one operator stop act and bounded
retry/check/age wake-ups before activation. No runnable stop/enable command
can be supplied before that placement exists.

Reports expose detection → candidate → merge → delivery, all ready repos,
blocked reasons/responsible owner, ageing/next wake-up and maintenance
capacity/fairness. An open PR is unfixed. Scan-only cannot claim ready-to-fix
without an admitted cycle/boundary. Starvation of the last repo stays visible.

L7 remains due independently: ten provider/usage receipts, all 100 ordered
Linux native pair/scenario receipts and actual rotation of two no-Claude
authors. Synthetic tables/imports are not live binary/gateway/lifecycle proof.
macOS/Windows remain separate unqualified scopes. Non-npm ecosystems,
majors/new packages, urgent age exceptions, rollback and served-model
attestation remain outside this delivery.
