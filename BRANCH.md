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

# Lane scope and inherited historical context

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

- [x] Deliver only spec v7 §12 MH-L1 on cf690fe2, integrating #316 (25117303).

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

- [x] Allowed: #316 integration paths, packages/h2a/src/runtime/mcp-central-*, packages/h2a/src/bin.ts, packages/h2a/src/runtime/mcp/transport/**, packages/h2a/src/runtime/handover/{image,schemas}.js, docs/plan/mh-l0/schemas.json, packages/h2a/test/mh-l1-*, scripts/mh-l1-*, docs/plan/mh-l1/**, BRANCH.md.
- [x] Forbidden: main, installed state, native-terminal implementation, .track (conductor single writer), full suite, version bump/publication.
- [x] Conditional: packaging prototype is not a release freeze; QF/QC remain owner decisions.
- [x] BR-L1-EX1: preserve #316 history in an integration merge; cohesive integration/vendor/test commits may exceed 150 lines, rollback by git revert.
- [x] No Makefile in this repo: selective staging and git commit directly.

# MH-L2 — authority and authenticated cold succession

# MH-L4 — attachment ownership and admitted operations

# MH-L6 — H4 and managed installation

- [x] Owner authorizes the full MH-L6 realization on feat/0.98.7-mh-l6 from reviewed MH-L5; sub-lots and gates in docs/plan/mh-l6/BRANCH.md.
- [x] A: canonical H4 journal, compatible prefix exclusion, pins, durable selection and forward reconciliation. Node 22/24: 25 targeted tests and 14 killed/restored mutations each; exact bytes/receipts in docs/plan/mh-l6/proof-A.json.
- [x] Explicit size exception: keep each cohesive engine/test/mutation/proof change together; selective staging, rollback by commit, no unrelated changes.
- [x] B1: durable exact-target delegation and receipt, source revocation, proven-dead delegate/controller recovery and compatible guardian succession. Node 22/24: 24 targeted tests, 30 killed/restored mutation pairs per profile; proof-B1.json.
- [x] C1: builtin-only standalone same-process launcher, verified diagnostic history, no fallback execution/mutation, runtime/loading/PATH/link/journal guards. Node 22/24: 10 targeted tests and 13 killed/restored mutations each; reproducible artifact and proof-C1.json.
- [x] E1: manifest-bound synchronous module reader for the selected-entry process, including CJS/createRequire, runtime precondition and real PTY addon integrity. Node 22/24: 47 targeted tests and 11 killed/restored fault/oracle pairs; proof-E1.json. Native release toolchain and descendant entry coverage remain open.
- [x] E2a: standalone content-addressed preload for launcher image descendants, recursive file child/Worker policy and physical installation revalidation. Node 22/24: 37 targeted tests, 10 killed/restored pairs; proof-E2a.json. Real component/direct/eval entry qualification remains open.
- [x] E2b1: real direct CLI and npm router install the verified preload before application imports; closed descriptor, pre-import integrity, selected argv and same PID. Node 22/24: 42 targeted tests, five killed/restored pairs; proof-E2b1.json.
- [x] E2b2: real file boot worker, journal fork/Worker and identity, physical Node/file aliases, URI and opaque data handling. Node 22/24: 75 targeted tests and 16 killed/restored pairs on ten fault points; proof-E2b2.json.
- [x] C2a: read-only physical npm provenance; 22 targeted tests, 13 killed/restored fault configurations per Node 22/24. Bootstrap/adoption wiring remains C2b.
- [ ] B2/C2b/D/E2b3/E3/F: future legacy installer/admission fencing, bootstrap/adoption/link installation, unmanage/npm, all-entry closed loading, release packaging/native freeze and common CLI/automatic/M18 integration.
- [x] No installed h2a/dispatch, owner live state, main, .track, Python or full suite. Review selection cannot use the required installed dispatch under owner confinement; no consensus verdict claimed.
- [ ] Independent conductor review and final MH-L6 acceptance remain required; A alone does not qualify U05/U06 or M18 end to end.

# MH-L5 — qualification of passive handover and legacy coexistence

## Argon reserve closure — 2026-10-16
- [x] Owner authorizes closure of findings 1/2 and explicit M17 allocation to MH-L8 as the alternative to implementing all eight surfaces in this lot; no merge with reserves.
- [x] T9: reproduce the supervision/SSE first-backoff window and transient ENOENT/malformed-marker overwrite; retain the legacy reason until a successful v2 connection. Include same-generation replacement and reset regressions.
- [x] Backend campaign: remove the encompassing mutationLock, observe real flock acquisitions per iteration, preserve live payloads while expired refs are collected, and label all eight actors backend-only.
- [x] Supersede any M17 acceptance implied by the historical Lot C/80,000-mutation checkpoints below: these are backend evidence only, not §10.8 acceptance.
- [x] Declare the exact unmet simultaneous-surface campaign as a mandatory MH-L8 release gate in docs/plan/mh-l8/BRANCH.md, per spec v7 §§10.8/12; no claim that M17 is qualified.
- [x] Confirm finding 3 is tracked for the real MH-L6 H4/bootstrap producer and v1 activation tests in docs/plan/mh-l6/BRANCH.md; retain owner_liveness_unknown without provenance.
- [x] Targeted Node 22/24 red/green: 12 files / 72 tests per profile, 12 killed/restored mutation pairs per profile; nine source/test/script files and one compiled module audited. Commands/output archived, zero skips/own children. Parallel attachments attempts failed on their fixed port; unchanged serialized reruns pass 33/33 on both profiles. The 10,000-mutation campaign is not rerun as part of this reserve closure; converged M17 qualification is MH-L8.
- [x] Delivery prepared with conventional commits without trailers; fast-forward own-branch push and its receipt are recorded in the owner report's Réserves Argon appendix at delivery. Independent re-review stays with the conductor; installed dispatch remains forbidden.

## MH-L5 Objective / Scope / Guardrails
- [ ] Qualify published v1 dists .5/.6, external peer, deterministic faults, G0/G1, cold stop, compensation and seven-domain concurrency against spec v7 §10.3–10.5/10.8.
- [x] Branch feat/0.98.7-mh-l5 starts at reviewed 7a8129ea; MH-L4 is already in its ancestry. No main, .track, installed h2a/dist, native host or owner state.
- [x] Allowed: MH-L5 test helpers/files, scripts/mh-l5-*.mjs, docs/plan/mh-l5/** and this plan. Product changes conditional on an evidenced regression, with red/green and mutations.
- [x] Necessary qualification exception: the existing mh-l3-transfer.test.js is strengthened; deterministic helpers, provenance locks and archived proof outputs are cohesive and exceed the per-commit line guideline. Selective staging and rollback by commit; no unrelated changes.
- [x] Forbidden: live coordinator, semantic verifier, registry discovery, dependencies/release metadata changes, broad cleanup, Python, full test suite, unrelated processes and forced pushes.
- [x] Owner option A: .7 consumes externally conducted publication only. Future MCP registry discovery remains an open boundary.
- [x] Installed harness/Track recorders and installed review dispatch conflict with confinement; no invocation. Independent review is handed to the conductor, with no consensus claim.
- [x] bwrap fails before execution; reviewed shell commands use authorized paths and private temporary state only.
- [x] Lot A: obtain and integrity-check published v1 artifacts in private temporary directories; exercise M18/M18b/M18c/M19/M20, T4/T8/T9 with real compiled starter/bridge and unchanged .7 participants.
- [x] Lot B: external peer plus compiled source/shim; typed/reused IDs, late G0 progress/cancellation while G1 admits work, deterministic lost responses and durable cold recovery/compensation cuts.
- [x] Lot C: eight conforming processes, seven domains and at least 10,000 mutations per domain; external acknowledgment reconciliation, stale janitor and inherited writer refusal.
- [x] Lot gate: explicit files only under temporary HOME/XDG/TMPDIR, Node 22/24, zero skips/cancellations/own children; retain every failed diagnostic and killed/restored mutation command/output.
- [x] Cold/G0-G1 implementation checkpoint: real source/shim M21, process-cut kernel, real fsync/ACK faults, independent controller death and actual compensated generation pass their targeted Node 22/24 files.
- [x] Concurrency checkpoint: Node 22/24 each reconcile 10,000 mutations per six domains and 20,000 payload mutations; 10,000 external acknowledgements, verified contentHash/chains, zero duplicate/skip/cancel/own child. All 21 mutation pairs per profile killed/restored.
- [x] Self-review every diff hunk and audit exact qualified source/compiled bytes: 31 explicit files / 128 tests and 21 killed/restored mutation pairs per Node 22.22.1 / 24.21.0; zero skipped/cancelled/own children. Independent review remains with the conductor.
- [x] Coverage reserve: M17 uses eight synthetic backend actor drivers, with real surfaces tested separately. Full simultaneous central/pair/four-stdio/janitor/CLI coverage is not claimed; docs/plan/mh-l5/REVIEW.md gives the bounded acceptance handoff.
- [x] Delivery discipline: conventional English commits without trailers; fast-forward push of this branch only. The push receipt belongs in the owner scratchpad report.
- [x] Final French report path reserved in owner scratchpad: mhl5-report.md, with coverage, deviations, push receipt, remaining agent-hours and review rounds.

# MH-L3 continuation — passive MH-L2 amendment first

## Objective and authority
- [x] Deliver MH-L3 against the amended source contract, including M21 against the real compiled old central and shim; independent MH-L3 review belongs to the conductor.
- [x] Owner 2026-10-15 chooses bounded option A: .7 accepts an externally conducted live transfer, never initiates one.
- [x] Independent MH-L2 review revl2amend-r2.md declares 513312b8 FUSIONNABLE; owner authorizes MH-L3 continuation.

## Scope / Guardrails
- [x] Branch feat/0.98.7-mh-l3 from 642a82f9; main and .track untouched.
- [x] Amendment scope: runtime/handover/{administration,participants,schemas,live-source,ownership,launch-memo}.js; runtime/mcp-central{,-attachment}.ts; minimal local transport cleanup if required; MH-L2 tests/helpers/scripts/docs; additive schema export; BRANCH.md.
- [x] Required-reference exception: runtime central-mcp-0980.test.ts fixture follows the existing qualified core starter; original project-byte/metadata oracles stay intact and product code is unchanged.
- [x] Reference gate matches actual module filenames; command-name-only matches are excluded. Initial overbroad diagnostic and the unrelated duplicate declaration in dispatch-characterization-goldens are retained as uncovered observations; central-mcp.test.ts is restored byte-for-byte to the base.
- [x] Optional mcp-central.test.js has no changed-module reference (rg code 1) and retains v1 HTTP-reclaim oracles incompatible with L2's frozen process-authority contract. Its blocked worker is stopped only by its proven PID/PPID/startTime; the failed supplement is retained, never called green or used to weaken v2 guards. Actual module references and L2/L4 files remain mandatory.
- [x] Cohesive authorization/retirement and proof archives may exceed 150 lines / 15 files; selective staging, revert by commit, no unrelated cleanup.
- [x] No product live conductor, target restoration or semantic compatibility verifier; no dependencies or release metadata changes.
- [x] Qualification runners pin umask 022, including direct single-file reruns; an earlier repeat inherited 002 and is retained only as a diagnostic, without attributing its failures to that setting.
- [x] No installed h2a/dist, native host, real owner state, unrelated process, Python, global test suite or force push.
- [x] English conventional commits, no attribution trailers; only this branch may be pushed.
- [x] Regression red/green and mutation proofs: 154/154 audited pairs on Node 22/24; initial cold restoration failures retained alongside two successful bounded reruns.
- [x] Prefix-sensitive tests from clean git archive + npm ci/build under umask 022; all 20 qualified source/test/runner/schema/contract files match the worktree after restoration.
- [x] Before push, enumerate every test file referencing touched files and run it; alternate spec naming checked too, no omitted references.
- [x] Expanded reference gate was NOT_GREEN at 501ea371; the 2026-10-16 finding closure now qualifies attachments and affected references on Node 22/24. Historical failures remain archived; independent review still belongs to the conductor.

## Lot A — source contract amendment
- [x] Dated contract amendment with owner decision and exact spec references.
- [x] Durable authenticated reservation with complete source/target/controller/inventory bindings.
- [x] Authenticated concordant publication, MH-L4 checkpoint fencing, preserved G0 drain, safe retirement.
- [x] 63 live + 2 real-source + 12 cold mutation pairs per profile, zero skips. Existing MH-L2 15/15 and MH-L4 29/29 in each profile's file campaign; initial cold image restoration failures and successful reruns remain explicit qualifications.
- [x] Separate contract/source commits and review dossier prepared for conductor handoff; own-branch push receipt belongs in mhl3b-report.md.

## Lot B — MH-L3 (after independent review)
- [x] Shim, resume/quarantine, IDs/progress/cancellation, catalogue, evidence/transfer and M21 against the real compiled old central and shim.
- [x] Node 22.22.1 / 24.21.0: 45 explicit files and 236 tests per profile; 43 killed/restored mutation pairs per profile; zero skips, cancellations or remaining own children. Byte audit compares 45 source/test/script/schema files and 19 compiled runtime files.

## Lot 2 — Checkpoints, notifications and wake
- [x] Complete immutable checkpoints, lost ACK, producer/delivery/application receipt separation.
- [x] Wake intent before injection, serialized wakes, no automatic unknown replay.
- [x] Gate: mh-l4-checkpoint.test.js and mh-l4-wake.test.js red/green.

The parallel `feat/live-cross-cli-messaging` lot owns delivery, host wake and cross-CLI end-to-end measurements. This lot changes only presence/identity and the requested MCP send admission/deadline boundary. `sendLocalMessage` and the CLI retain the existing dormant-deposit contract; MCP opts into live-only admission.

## Isolation and collection invariants

## Lot 3 — Isolate and integrate transport
- [x] Exercise conversation/workspace/terminal isolation and config preservation with targeted #316 tests.
- [x] Integrate corrected HTTP transport into h2a payload and prove batch correlation/cleanup with actual HTTP.
- [x] Gate: node --test packages/h2a/test/mh-l1-transport.test.js and mcp-central-attachments.test.js (named cases only).

## Lot 4 — Packaging prototype
- [x] Produce repeatable core/runtime payload with exact dependency resolution and published shrinkwrap.
- [x] Retain real node-pty legacy probe, no Python/node-gyp install path; record closure limits explicitly.
- [x] Close L0 R1 with a native digest mismatch vector that kills the missing-guard mutation; Node 20 refused, Node 24 ABI recognized.
- [x] Gate: node --test packages/h2a/test/mh-l1-package.test.js and mh-l0-image.test.js.

- Repository source builds only, into mkdtemp lanes; temporary HOME, TMPDIR and XDG roots, with the existing forbidden-state/owned-PID guard.
- Targeted test files only. No installed h2a invocation, owner state/workspace, unowned process access, full suite, PR or release. Rounds 5 and 6 explicitly authorize merging origin/main into this branch.
- GC requires age >=24 hours, regular file, one link, a provably dead PID (ESRCH), and unchanged inode/timestamps before unlink. Presence filenames must also carry an old creation timestamp.
- Retain live/unknown holders, malformed archives, young files, symlinks and linked files. Read-only presence scans disable GC.
- Expiry stays honest during storage failure or disconnection. An MCP reconnect publishes a new session for the same instance; EOF removes the old attachment presence.

## Lot 5 — Delivery
- [x] Review diff/scope, record constrained review status without consensus claim.
- [x] Push own branch fast-forward and write French mhl1-report.md, agent-hours and review rounds.

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
- [x] Deliver only spec v7 §12 MH-L0, including the measured npm BX correction.

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
- [x] Audit source refs, native relaunch closure, legacy probe, dependencies and pending .6 dist gate.
- [x] Reproduce BX with private prefix/cache, local tarballs/registry; revise U09 and prepare QF dossier.
- [x] Test-only network peer, evidence and CAS/ACK fault primitives.
- [x] Gate: node --test packages/h2a/test/mh-l0-npm.test.js and mh-l0-peer.test.js, red then green.

## Lot 6 — Delivery
- [x] Reconcile scope/evidence/review limitations; recalibrate MH-L1–MH-L8.
- [x] Push own branch fast-forward; write owner mhl0-report.md in French.

## Feedback Loop
- [x] Final .6 dist unavailable: audit source closure now; U13 byte qualification remains MH-L1/MH-L8.
- [x] QF/QC/QD/QE/QG remain owner decisions; no runtime entrypoint chosen by MH-L0.
- [x] Installed-h2a harness review/recorders conflict with owner confinement: do not invoke; no consensus claim.
- [x] Npm matrix verifies the actual installed version after each private operation, including update and downgrade.

# Central MCP default for Claude

Branch: `feat/mcp-central-default-claude`, based on `origin/main` at `5ca5c7bc`.
Owner decision: 2026-10-04, implement L-H before L-A. No push, PR, publish,
tag, attribution, Python, owner session/config/native host access, or `.track` writes.
Real processes run only with isolated HOME, runtime directories and stores.

## PR #316 CI portability follow-up (2026-10-10)

The owner authorizes fast-forward commits and push to this branch for the CI
repair. No force push, PR edits, merge, publication, or `.track` writes.

Run `38037043097` failed 19 Node tests on both Node 20 and 22. The causes are:

- The qualification rejection test hardcoded a home directory absent on CI.
  It now checks both the caller's HOME and the account home from the OS.
- The helper admitted only existing `.qual-tmp` paths. It now also admits
  private, same-UID temporary roots, resolves absent descendants through their
  existing ancestors, and rejects shared roots and escaping/dangling symlinks.
  Real caller/account configuration and runtime directories remain protected;
  environment leaves are checked before creation as well as afterwards.
- R19's long local default native socket path failed before target resolution,
  hiding the missing target log on `unresolved` native delivery. Its short,
  private `/tmp` fixture now exercises the CI path everywhere. Native delivery
  logs its attempted target before the unchanged unresolved fallback. Every
  ownership and refusal assertion remains in place.

Six focused files pass under isolated HOME/config/runtime directories, clean
PATH and plain `/tmp`, sequentially on Node 20.20.2 and 22.22.1: 58 passed,
zero failed, one EROFS mount skip on each. Four new guard regressions cover
private temp acceptance, shared-root rejection, symlink escapes and protection
of real environment directories, including the account home with HOME changed.

The single full `npm test` ran after a host process check found no active suite,
with four CPUs and a 768 MiB heap cap: Node 2,441 passed, 73 failed, 34 skipped,
21 TODO; Track 87 files / 1,193 tests passed. The 73 failures all came from four
host-configuration files because the isolated launcher set global CODEX_HOME
and CLAUDE_CONFIG_DIR, overriding fixtures that change only HOME. Removing
those launcher variables and rerunning just those four files passed: 123 passed,
zero failed, two native-CLI availability skips. The full command was not repeated
and is not claimed green. All 19 original CI failures passed in the focused and
full executions. Fresh CI must verify the complete Node 20/22 gates after push.

Ignored execution receipts: `tmp/ci316-evidence/` (commands, sanitized environment,
RED/GREEN logs, full-gate failure, scoped environment recovery and exit codes).

- [x] L-H: remove implicit project/host/config writes from run and restore;
  decouple state root from workspace; neutral daemon cwd and environment whitelist.
- [x] L-H: explicit host writer preserves all bytes outside the h2a value,
  backs up existing files and requires `--allow-tracked` for tracked files.
- [x] L-H: retain live shim stdio on restart, operator status/stop and rollback semantics.
- [x] L-H: report-only inventory of old central configs and repo store sentinels.
- [x] L-A transport: lightweight default-on `mcp-serve` switch, Claude only; causal
  conversation identity, independent attachments and private discovery.
- [x] L-A default activation: owner closes R6 by the zero-project-write invariant
  and exact byte preservation; Claude defaults ON, Codex/agy stay stdio,
  with `H2A_MCP_CENTRAL=0` and `h2a.central.enabled=false` opt-outs.
- [x] Review 4: discriminating R3 regression, R18 stdio routing and R19 manual
  daemon attachment isolation, each evidenced independently with RED/GREEN.
- [x] Review 5: bind every wake driver to the client environment; R20/R21
  use distinct daemon/client sockets with identical terminal targets. RED:
  four failures and one native-auto control; GREEN: five passes. R11 now
  launches repaired Claude/agy/Codex configurations and rereads signed inboxes.
- [ ] Wider qualification: 18/36-session synthetic-volume budgets, host-version
  matrix and a fresh fully GREEN root gate in a prepared environment.

Historical R6 evidence: ignored `.qual-tmp/r6/evidence/`, with command, SHA and raw
stdout/stderr per run. The exact pre-incident Airbus bytes at `3508b24` are
versioned and hash-checked. Registry-verified published 0.98.0, using a real
private central and its unchanged launch/restore preparation and writer,
changes tracked bytes/mode without a backup but preserves Graphify. Restore
preparation alone writes nothing; restored absent sessions re-enter run. No
alternate destructive project writer was identified on these paths. R6 is
closed by the owner's invariant decision; the historical cause is unknown.
The published writer did not destroy Graphify in reproduction. Claude default
activation is ON. The candidate's real central preparation makes zero project
writes and preserves bytes, metadata and git status. Existing launch-index
readers are already present on main.
Earlier reconstructed-input, performance and pre-rebase claims are superseded.
Final qualification is scoped, isolated and tied to the final committed SHA;
no root/performance gate is claimed. Fresh default-on receipts and the French
owner report are under `.qual-tmp/default-on/`; each final receipt records the
final committed SHA and an empty working diff.
Review 5 supersedes those final receipts with `.qual-tmp/review5/evidence/`:
final build, runtime, attachments, preservation, central T4, routing and wake
adapter checks use the final committed SHA and an empty working diff.
Report: `docs/reviews/mcp-central-default-claude.md`. No peer consensus is claimed:
the installed-session review route conflicts with the owner isolation constraint.

## Historical plans (superseded for this branch)

# Session launch latency

Branch: `fix/mcp-identity-burst-tail`, based on `origin/main` at `ab7ff40e`
(v0.98.1). Scope: the burst and startup-contention laboratory tests, their
bounded on-demand recovery helper, deterministic regression, and evidence.
No production deadline or identity contract change. No push, PR, publication,
tag, real owner identity/token store access, or `.track` write.

Validation: deterministic RED/GREEN on the real Node 20 binary, ten sequential
burst runs pinned to one CPU, focused sibling checks, and at most one full
root test gate at the end. Qualification: `docs/reviews/mcp-identity-burst-tail.md`.
Completed: RED 1/2, GREEN 2/2; burst 10/10 (50 passes, no failures/skips);
siblings 62 passes, 1 EROFS environment skip; one final root `npm test` passed
(Node: 2,456 passed / 32 skipped / 21 TODO; Track: 1,193 passed). Test fix:
`e75e835f`. All execution receipts are under ignored `tmp/burst-evidence/`.
Prior branch plans below are historical and grant no delivery authorization.

# Native host generations — phase A

Branch: `fix/native-host-generations`. Owner decision: 2026-10-03,
side-by-side native hosts, phase A only. The prior plan below is historical.
No push, PR, publication, tag, owner host/session access, or `.track` write.

Scope: native host selection, the two known endpoint inventories, per-name
owner routing, creation admission, guard/receipt socket ownership, native
restore/drive wiring, their focused tests, and qualification documentation.
Phase B (durable catalog/admission, migration and retirement) is excluded.

- [x] A1: preserve the historical socket; select `native-terminal.lf1.sock`
  for fenced launches when the historical host lacks `launchFence`.
- [x] A2: resolve existing owners, refuse ambiguous owners, and preserve
  unknown/incomplete inventories across native operations, restore and drive.
- [x] A3/A5: admit agent and sidecar names before creation; prove no
  containment registry write on a refused same-name launch.
- [x] A4: retain `socketPath` in launch ownership, guard cleanup and receipts.
- [x] Historical RED becomes GREEN; isolated MCP launches/delivers once.

Qualification and limitations: `docs/reviews/native-host-generations-phase-a.md`.
All real-host qualification uses checked private `/tmp/h2a-qual-*` fixtures.
Only handles created by the fixture are signaled during teardown. The owner
runtime is rejected before filesystem access or process startup. No harness
recorder runs here: `.track` has another writer.

## Historical branch plan

# Synchronisation 0.98 — décision owner

Intégrer origin/main (Lot 4 2a–2e et stabilisation des tests) à partir de
98f15b4664e223c2d85549407380298a1921ddf0, conserver h2a 0.98.0 et
cluster-mesh 0.13.0, fixer llm-mesh 0.22.3 et llm-gateway 0.19.1.
Une seule copie physique de llm-mesh ; build puis deux npm test complets
séquentiels, sans autre runner h2a actif. Aucun test de charge.
Le push est autorisé uniquement vers feat/consume-cluster-mesh-0.10.0,
avec le lease exact 98f15b4664e223c2d85549407380298a1921ddf0.

Scope actuel : intégration de main, manifestes/lockfile des dépendances,
artefact Focus si son contrôle le requiert, et correctifs directement
bloquants des tests. Les scopes et résultats ci-dessous sont historiques.
La propriété single-writer de .track reste applicable : aucune écriture ici.

## Historique de la ligne 0.98

# PR #267 — cluster-mesh messaging, N2, release 0.98.0

## Objective and scope

Finish `feat/consume-cluster-mesh-0.10.0` rebased on origin/main 0.97.11 (`5a3eec57`).
Consume cluster-mesh 0.13.0, extend the existing send primitive and CLI/MCP
adapters, verify received envelopes before inbox/wake, and prepare 0.98.0 in
this PR. Owner authorized push with force-with-lease; no merge or tag push.

Allowed: h2a dependency/lockfile; send/cluster-mesh messaging and existing
CLI/MCP adapters/exports/help; focused messaging tests and CI gate; this plan
and messaging spec; lockstep version files changed by scripts/release.mjs.
`.track/**` remains single-writer and is forbidden in this worktree.

## Lots

- [x] Rebase onto origin/main and record incremental progress externally.
- [x] Pin cluster-mesh 0.13.0 and share the existing send preparation.
- [x] Implement configurable mesh send and verified receive before inbox/wake.
- [x] Verify real store round-trip, tamper rejection and unchanged local behavior.
- [x] Build, typecheck, full test gate, public-contract gate and diff review.
Final sequence after the feature commit: run release.mjs for 0.98.0, then
push the branch with an explicit force-with-lease. Release/push receipts live
in the incremental external report so they can be written after the final
release commit without adding a post-release bookkeeping commit.

## Design and evidence

See docs/specs/2026-09-15-SPEC_EVOL_cluster-mesh-send.md. Incremental owner
report: codex-267-098-report.md beside the supplied brief in its scratchpad.
Local command logs and review launch failures: tmp/cm267/ (ignored).

Two complementary peer review launches were rejected by automatic approval
review (potential gateway code export). No consensus verdict is claimed.

## Verification results before release

- `npm run build` and `npm run typecheck`: passed.
- Messaging/local/stdio targeted suite: 37 passed, zero skip or TODO.
- N2 mutation: bypassing the upstream verifier makes both outer-kind/no-wake
  tests fail; restoring it makes both pass.
- `REMOTE_CLI_CONFIG_HOME=$PWD/tmp/cm267/runtime-home npm test`: passed.
  Node gate: 2,114 passed, zero failures, 17 existing skips and 21 existing
  TODOs (2,152 total). Track Vitest: 87 files, 1,193 tests passed.
- `scripts/check-public-contract.sh`: passed (53 tools, 99 verbs, anti-cycle).
- Updated help golden: 13,246 bytes, SHA-256
  `9a4723ccf963c9140cd2cdf1429476b4f45f11e2628ac0ecbdc6077edec86b28`.
- Full test execution needs write permission for a sibling temporary workspace
  fixture. The runtime config override isolates tests from real native sessions.

- CI native-terminal selection: 4 files passed, 56 tests passed, 1 existing skip.
- `npm run audit:security`: passed, including the separate focus audit.

## Historique de la stabilisation intégrée depuis main

# Stabilisation central MCP, drive PTY et rendu Track

## Objectif

Reprendre les changements interrompus, intégrer `origin/main`, prouver les
causes et comparer les taux avant/après. Une seule suite `npm test` complète
sur cette branche, puis commit et push vers `origin` de cette branche nommée.

## Scope

**Allowed Paths**
  - `packages/h2a/test/mcp-central.test.js`
  - `packages/h2a-runtime/src/native-terminal/drive.functional.test.ts`
  - `packages/track/src/cli/focus.test.ts`
  - `BRANCH.md`
  - `docs/reviews/test-flakes-central-drive.md`

**Forbidden Paths**
  - `.track/**`
  - `package*.json`
  - `packages/*/package.json`

## Lots

- [x] Lire et sauvegarder l’état interrompu ; intégrer `origin/main`.
- [x] Conserver les attentes d’identité MCP déjà corrigées sur `main`.
- [x] Reproduire la publication centrale retardée après le bootstrap.
- [x] Synchroniser la publication effective et conserver le contrôle `4 !== 1`.
- [x] Maintenir et nettoyer la fixture sidecar PTY.
- [x] Mesurer la durée du scénario avant de conserver son budget global local.
- [x] Reproduire et corriger le premier rendu Track sans changer son délai.
- [x] Vérifier les signalements loop/M02 et consigner les limites du diagnostic.
- [x] Terminer les campagnes sans injection : 0/20 échec.
- [x] Une suite `npm test` complète, sans autre runner h2a actif : Node
  2 410 réussites, 1 échec UAT SIGTERM, 21 ignorés, 21 TODO ; Track 1 193/1 193.
- [x] Un commit par correctif ; préparer la livraison de `fix/test-flakes-central-drive`.

## Preuves

`docs/reviews/test-flakes-central-drive.md` et instruments ignorés
`tmp/h-cond-evidence/`, `tmp/h-cond-campaign.mjs`, `tmp/h-cond-order.cjs`.
Décision h-cond pour la livraison : aucune nouvelle campagne de charge.
Attendre la fin du build release/v0.97.12 et vérifier avec `ps` qu’aucun
`scripts/run-tests.mjs` n’a un cwd sous `/home/antoinefa/src/h2a` avant chaque
suite complète. La suite externe bpmn-canvas (groupe 933523) est exclue de
cette contrainte et reste intacte. Exécuter les deux branches en séquence.
La synchronisation finale intègre `origin/main` à `8c1912d7` par avance rapide.

- [x] No v0.98.6 tag locally: integrate current owner-mandated L0 base; byte freeze against final .6 remains release gate.
- [x] L0 R2 closed now at owner's request: four non-ACTIVE authority vectors kill the missing-guard mutation (r2-red/r2-green logs).
- [ ] Review R3 QF/QC awaiting explicit owner arbitration; R4–R6 awaiting owner decision on release gates versus L1 fusion verdict (docs/plan/mh-l1/reserve-closure.md).
- [x] Initial shared node_modules lacked workspace-local dependencies: npm ci --ignore-scripts creates checkout-local lockfile dependencies.
- [x] Harness recorders/Track imports are not invoked because they would use installed h2a or shared Track state.

## Lot 3 — Administration and cold stop
- [x] Durable serialized steps, idempotence/digest conflicts, barriers and drain.
- [x] Internal irreversible STOP_COMMITTED, lost ACK reconciliation, operator pause and armed deferred stop.
- [x] Shared successor budget ≤3 before spawn; refuse live/unknown candidates; pins preserved and explicit failure.
- [x] Gate: mh-l2-cold.test.js red then green.

## Lot 3 — Launch receipts and drain
- [x] Atomic attachment/name reservation, argument conflict, token-bound receipts, no duplicate spawn/brief.
- [x] Drain children/briefs/callbacks/effects after launching reply; durable owner-directed completion.
- [x] Gate: mh-l4-launch.test.js and mh-l4-integration.test.js red/green.

## Lot 4 — Verification and delivery
- [x] Mutation proofs and explicit files on Node 22 and 24.
- [x] Scoped typecheck and affected existing tests; no full suite.
- [x] Frozen contracts/audit and French qualification with gaps and agent-hour/review estimates.
- [x] Delivery prepared for the authorized fast-forward push; its remote receipt and requested mhl4-report.md are recorded outside this checkout after push.

## Feedback Loop
- [x] bwrap fails before execution; reviewed commands confined to authorized files/private tests.
- [ ] Conductor independent review and MH-L5/MH-L8 qualification remain visible.

## Exact-source qualification
- [x] Source 008f2394c975ee84986dd9896be17a2b3fd0c95c archived into /tmp/mh-l4-release-check-RvMsgD; npm ci/build under explicit umask 022.
- [x] Node v22.22.1 and v24.21.0: 27 MH-L4 tests, 89 scoped regressions, 33 attachment regressions and 4 format tests per profile; all passed with zero skip.
- [x] Initial Node22 attachment idle ECONNRESET retained as evidence, then reproduced deterministically by slow synchronous preparation and fixed at durable readiness without raising the 100 ms fixture threshold.
- [x] Final 23-mutation campaign per profile: every mutant red code 1 and restored source green code 0; all tracked source/test/script bytes restored identically.
- [x] Local ownership/effects critiques re-read the final fixes without a remaining factual blocker; cross-host independent review is still required, no FUSIONNABLE claim.

## Feedback / delivery
- [x] bwrap fails before command execution; reviewed shell commands stay on authorized files and private temporary test state.
- [x] Owner confinement overrides installed harness/Track recorders and installed h2a review dispatch; conductor owns independent review.
- [x] French report mhl3b-report.md with separate amendment commits, evidence, uncovered scope, deviations and agent-hour/review-round estimates; update push receipt after delivery.

## Independent MH-L2 review closure — 2026-10-16
- [x] Previous correction run closed the six findings in revl2amend.md; MH-L3 started only after the owner supplied the independent R2 acceptance.
- [x] Scope includes the directly blocking identity/live.ts and identity/worker.ts contention fixes, their deterministic regressions, and bounded proof runners.
- [x] Contradictions are persisted before authority exceptions and observed without a barrier deadline; ABORTED grants no successor authority.
- [x] Expired barriers permit authenticated concordant forward recovery while keeping delegation, selection, entry, precheck, checkpoint, ownership and drain guards.
- [x] DELETE is refused during closed admissions; participant transfer/acquisition requires durable PUBLISHED.
- [x] Key generation is outside the writer lock; publication rechecks the gate and competing keys; workers retry only the named contention error and classify budget exhaustion as identity_timeout.
- [x] Direct central fixture supports private temporary fallback and separates its workspace from OS scratch without changing the product workspace guard.
- [x] Original red failures and subsequent diagnostics are retained; no failed/cancelled qualification is called green.
- [x] Node 22/24: 33 explicit affected files / 288 tests per profile, including all 20 MH-L2/MH-L4 files / 114 tests; six findings covered by 12 killed/restored mutations per profile, zero skips or cancellations.
- [x] Owner supplied revl2amend-r2.md: 513312b8 is FUSIONNABLE for the MH-L2 amendment. That verdict does not review this MH-L3 implementation; installed h2a, harness/Track recorders and real owner state remain inaccessible by owner instruction.

## MH-L3 continuation — 2026-10-16
- [x] Scope extends to lightweight shim state, generated descriptor, request mapping, authenticated control capacity, attachment transports, source acknowledgements, cold baselines, catalogue and passive transfer consumption; associated schemas, explicit fixtures/runners and docs are necessary.
- [x] No live conductor or semantic compatibility verifier. M21 uses a separate test executable against the real compiled old central and shim; its fixture verdict is not a .8 product claim.
- [x] Registry owner decision (16/10): all h2a MCP selections should use cluster-mesh MCP registry. Discovery is deferred to its pending contract; preserve the discovery boundary and physical/authenticated authority checks, with no fixed endpoint or future-build allowlist.
- [x] Local initialization survives absent/invalid discovery; discovery failure still forbids connection, and only ENOENT permits autostart. The initial automatic-review rejection is retained as a diagnostic, not bypassed by accepting invalid discovery.
- [x] Historical delivery: automatic review rejected removing descriptor/contract checks at source registration, so c96792f3 retained equality with the central. The explicit owner request to close Argon reserve 2 supersedes that implementation: registration now validates the actual served source view and its digest bindings, while H4 still gates compatibility.
- [x] Final targeted Node 22/24 qualification and all mutation/restoration receipts audited against identical bytes; raw negative diagnostics remain archived in docs/plan/mh-l3.
- [x] Delivery is split into implementation and qualification/review handoff commits. Push receipts and the French final report belong in the owner's external mhl3c-report.md; independent MH-L3 review remains with the conductor under owner confinement.

## Argon reserve closure — 2026-10-16
- [x] Owner explicitly requests closure of reserves 1/2 and an evidence-based decision on observation 3; no merge with reserves, no merge performed here.
- [x] Scope: shim recovery transitions, source registration/provenance schema and generated export, one isolated regression file/helper, bounded mutation cases and qualification evidence/docs. No installed h2a, owner live state, main, .track, Python or full repository suite.
- [x] Recovery loss arms the first normative backoff for both supervision and downstream demand; an external publication can win before autostart, which remains available after the bounded delay.
- [x] Registration inventories the actual retained catalogue with validated source provenance. Identity, transport epoch, digest format/source bindings and H4 compatibility remain enforced; exact-catalogue legacy registrations remain supported.
- [x] Group/world writable physical prefixes stay refused: a temporary 0775 prefix created under umask 0002 is rejected before authority keys/anchor publication, while 0755 succeeds. Qualification uses a private 0755 source copy; the existing 0775 worktree is never chmodded.
- [x] First regression run: 4 ERR_ASSERTION failures (3 recovery transitions and divergent registration), prefix guard passes; temporary fixture/status diagnostic retained separately. Red/green mutation receipts and exact targeted commands are in docs/plan/mh-l3/ARGON.md.
- [x] Correction commit 413e7b32: Node 22.22.1 / 24.21.0 each pass 18 explicit affected/supplemental files, 80 tests and eight killed/restored mutation pairs. Attachments 33/33 and M21 1/1 on both profiles; all 15 direct references covered. Eight files and four compiled JS match the committed/qualified bytes; zero skips, cancellations or remaining own children.
- [x] Installed h2a review dispatch remains prohibited by the owner. No independent consensus or merge verdict is claimed; conductor owns the new review of the correction commits.
