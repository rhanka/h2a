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
# Velocity estimator — feat/velocity-estimator

## Objective
- [ ] Implement h2a-owned lots of spec v2, SHA-256 `4388546e0c488212efdfb3402595ed14a33c568ae3fa1d3a3287a61569858ccb`.
- [x] Two independent GO-CODE reviews (cfveloa-last.md / cfvelos-last.md) name that exact digest.
- [x] Base: origin/main `7ebbcf266e1988c18624d0158936949a214f9fd8`, including report PR #374.

## Scope / Guardrails
- [x] Temporary test lanes, exact files only; no full suite, installed h2a, owner state, native host, foreign processes or Python.
- [x] Engram owns the ontology; h2a consumes its immutable artifact. Separate mergedAt / installedAt; installation unknown until target proof.
- [x] One draft PR, conventional English subjects, zero attribution trailers; push only this branch, fast-forward unless owner-authorized rebase needs force-with-lease.

## Branch Scope Boundaries
- [x] Allowed: exact h2a implementation/test/artifact/skill/release paths in spec §6, this plan and review evidence.
- [x] Allowed L0-D: reviewed spec in docs/specs; packages/agent-stats/tests/fixtures/velocity/{github-sample,engram-enriched,engram-older,skipped-check-anomalies}.json.
- [x] Allowed L0-C bootstrap: scripts/velocity-test-lane.mjs; packages/h2a/test/velocity-test-lane.test.js.
- [x] Conditional: knowledge/contracts/** only from reviewed engram publication; L1 onward only after L0-C passes.
- [x] Forbidden: engram edits, .track writes, installed/plugin-cache edits, release/publish/deploy, model routing, unrelated cleanup, Makefile/docker-compose/.cursor changes.

## L0-D — documentary reference
- [x] Copy reviewed spec byte-identically; freeze both 20-PR memberships, union 23, 285 Astra checks, engram 60/121 and skipped-check anomalies.
- [x] Explicit retrospective evidence, late collection and unattested historical availability; no prospective backtest claim.
- [x] Record/verify all fixture digests; documentary gate: two spec reviews plus fixture integrity, no behaviour RED for copied facts.

## L0-C — contract and execution bootstrap
- [ ] gr-conductor: publish profiles/repo-knowledge/1/{profile,timing.schema,engram-mapping,manifest}.json and validator at a full immutable engram commit; DS/Engram compatibility review and T-V00-C RED/GREEN.
- [ ] h2a: copy upstream bytes and pin publication; offline velocity-contract.test.ts reproduces upstream verdicts.
- [ ] h2a: T-V00-I RED/GREEN in velocity-test-lane.test.js, private environments, candidate sources/fixtures/goldens, checkout builds, exact selectors and skip accounting.
- [ ] Gate: published artifact + offline pin + isolated runner; no placeholder permits L1.

## L1 — measured reference
- [ ] Spec §6 L1 exact source paths; velocity-observations.test.ts / velocity-github.test.ts, T-V01..06 RED/GREEN; bounded live manifest, both bootstrap scenarios.

## L2 — execution evidence
- [ ] Spec §6 L2 exact files, T-V07..12/T-V36; producer launch → sink → normalized observations and review-wave lifecycle.
- [ ] Gate: controlled prospective pilot/wave plus agent-stats.test.ts / agent-stats-h2a-evidence.test.ts, no historical attribution invented.

## L3 — deterministic comparables
- [ ] Spec §6 L3 exact files and forecast/estimate/matching tests, T-V13..17/T-V37; exact decimal weights and separate round coverage.

## L4 — dependency/capacity scenarios
- [ ] velocity/{schedule,plan-input}.ts and velocity-schedule.test.ts, T-V18..22; whole-graph trials and explicit gates, real one/two-lane mini-plan.

## L5 — knowledge/planning/report consumption
- [ ] Spec §6 L5 exact code/artifacts/three source skills; T-V23..27, clean consumer/cold planning UAT and exact Track collateral files.

## L6 — actuals/calibration
- [ ] velocity/{actuals,calibration}.ts, CLI and exact tests; T-V28..32/T-V38, immutable chronological feedback; shadow until prospective calibration.

## L7 — packaged command and target receipt
- [ ] Spec §6 L7 exact vendor/CLI/golden/workflow/attestation paths and targeted tests; T-V33..35/T-V39.
- [ ] Gate: clean temporary tarball executable; producer → existing attestation → target actual; public-contract wrapper; no workstation milestone from CI proof.

## Feedback Loop
- [x] Upstream blocker: engram local HEAD `8f19554cea3a4397fd66a90c7e9fd5ea54c81626` contains no planned contract; GitHub main contents endpoint returns HTTP 404 on 2026-10-18. Asked owner for publication SHA/path; no substitute created.
- [x] Handoff gr-conductor: reviewed immutable artifact/validator publication and DS/Engram evidence; then h2a imports and runs offline T-V00-C. L1..L7 await this gate.
- [x] Harness plan template and Makefile recorder absent; required checkbox sections written directly; no installed h2a or Track writer invoked.
- [ ] Record code review target/outcome; harness/review requires installed h2a/mesh dispatch, prohibited by confinement; no invented consensus.
- [ ] Final French report: per lot, pushed commits, exact RED/GREEN command/output/exit/skips, first measured output, CI, non-coverage/deviations.

- [x] T-V00-I final named-file baseline: 28 failed, 0 passed, 0 skipped; initial 25-test baseline also retained. Test-first commits stage the contract before the implementation.

## Fixture integrity
- [x] engram-enriched.json: SHA-256 `37a9c54032d3b56dd0c78f0aab886da260502a7805b2c898e7fa7377b2596ab7`, 15317 bytes.
- [x] engram-older.json: SHA-256 `be8e2abc21fec7a775b9db26329915ff1be7e275abec790dead565eedeceb97f`, 28540 bytes.
- [x] github-sample.json: SHA-256 `5f46c9f98fc97e0efd9caa7bfdb39a9cca3088a7c7fb6204b119d1724ce1452a`, 171533 bytes.
- [x] skipped-check-anomalies.json: SHA-256 `c2f53819003af26509f0df38fb4c2b7eb4c4a7edfb53ed154c6d43ec56022a65`, 8439 bytes.
