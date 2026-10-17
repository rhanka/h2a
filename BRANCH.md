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

# CM2-F2 — frozen v4 implementation

## Objective
- [ ] Deliver CM2-F2 from spec SHA-256 66a0adb37a1d3db716b236bba720ee438f7c7234cfbddf911f11ed0b9e52d7d3.

## Scope / Guardrails
- [x] Branch feat/cm2-f2-session-content; rebase origin/main; no main writes.
- [x] No owner state, installed h2a, foreign processes, Python or full local suite.
- [x] Source credentials never authorize confirmation or remote effects.
- [x] Track writes reserved for the conductor; no concurrent .track writer.

## Branch Scope Boundaries
- [x] Allowed: packages/h2a-runtime/src/session-content-*, src/fixtures/session-content/v2, src/native-terminal/*, runtime targeted-test tsconfig, capsule packaging script, scripts/test-inventory.json, BRANCH.md.
- [x] Forbidden: owner state, installed dist, main, Sentropic repository, .track, unrelated fixes and dependency upgrades.
- [x] Conditional: runtime build wiring solely to ship the frozen capsule; release pins only after conductor allocation.

## Lots
- [x] A1: strict native confirmation JWT verifier and pending limits; session-content-confirmation.test.ts.
- [x] A2/local: pinned HTTPS PKCE/source-open, dedicated confirmation exchange, issuer-bound JWKS, conservative deadlines and dependent-login invalidation; session-content-auth.test.ts plus confirmation and existing enrollment/token suites.
- [ ] A2/integration: production native trusted-auth wiring, grant/renewal/SSE and durable host denial fence; source-open alone does not authorize capture.
- [ ] A acceptance: deployed source/login revocation and concurrent IdP ceremony witnesses; identify exact real Claude provider tuple.
- [ ] B: freeze/ship capsule, all schemas/vectors/type harness, stable digests, Sentropic consumer and packed artifact.
- [ ] C: native default-off fence, raw admission, consent/exclusion, bounded stream/cache; real PTY zero-byte refusal and positive stream.
- [ ] D: exact versioned archive and isolated import; policy/admission/retention binding and bounded work.
- [ ] E: integrated 0.98.8 + F2 qualification and cross-repository exact fixture lock.

## Feedback Loop
- [ ] Sentropic auth implementer: deployed issuer/client/policy, login-session introspection and atomic UV-event/code binding required for A acceptance; mocks are not qualification.
- [ ] Conductor: candidate version allocation and integrated 0.98.8 head required before publication/E.
- [ ] Independent review: installed h2a MCP dispatch forbidden by owner confinement; no consensus claimed.

### CM2-F2 continuation — A durable primitive
- [x] Explicit private-directory fsync proof journal, durable denial floors, stale-fence and restart tests.
- [ ] A deployed IdP/login and actual provider tuple remain external acceptance gates; continue B–D preparation without declaring contract freeze.

### CM2-F2 continuation — B preparatory capsule
- [x] All 25 v2 message fixtures, strict structural schema, semantic validator, signed JWT/digest vectors, unsupported legacy capability guard, build-copy wiring.
- [x] 5/5 named cases on Node 22/24; isolated full track/core/runtime compilation and packed capsule byte comparison.
- [ ] Contract freeze, full transition-vector breadth and Sentropic adapter execution wait on A and the receiving repository. Synthetic tuple is never advertised as supported.

### CM2-F2 continuation — C native live boundary
- [x] Pinned HTTPS grant/policy resolution, native signed confirmation, exact staged/committed ACK and renewal, fixed old expiry until commit.
- [x] Raw host hook before reset/replay, default-off capture, durable local exclusion, bounded aggregate queues, cancellation and no legacy fallback.
- [x] Real temporary node-pty + native socket/client/server + HTTPS synthetic adapter refusal/positive/exclusion witness; 102/102 named cases on Node 22 and 24.
- [ ] Production bootstrap/deployed service composition, control SSE, future-child inheritance and complete saturation/endurance qualification remain open. Native histories explicitly refuse unsupported_format without a qualified provider.

### CM2-F2 continuation — D bounded archive primitives
- [x] Post-ACK metadata bookmark, worker snapshot/hash/consistency checks, full manifest and bounded parts; explicit companion scope and provider allowlist.
- [x] Authenticated retained-read/admission resolution independent of source-online state; policy/manifest/admission/expiry binding; isolated atomic data import with zero execution.
- [x] Host-global import/export/start/memory/work budgets, cancellation, incomplete/corrupt/oversized/substituted archive refusals and staging cleanup.
- [x] Synthetic native-confirmed checkpoint export/read/import round-trip; 54/54 targeted cases on Node 22/24.
- [ ] Actual Claude tuple/catalog/reference semantics, indexed partial-history ranges, real store atomic publication and cross-repo adapter qualification remain unqualified. Native capability capsule stays native:[].

CM2-F2 integration scope amendment: packages/h2a-runtime/README.md documents the shipped explicit composition API, preparatory HTTPS paths, exact capsule and remaining qualification gates. No owner state/configuration is added.

CM2-F2 raw-admission scope amendment: packages/h2a-runtime/src/pty.ts adds an explicit Linux raw spawner for new F2 hosts, required by the reproduced pre-consent UTF-8 decoder carry. Historical nodePtySpawner remains unchanged in behavior. Hosts without raw admission refuse F2; subscriptions begin only after the committed ACK.

### CM2-F2 continuation — E local preparation and explicit external gates
- [x] Native accepted-policy registry, future-child/reconnect fences and real bounded HTTPS/SSE signed-confirmation path with reserved denial.
- [x] Exact 25-fixture type harness, strict AJV-2020 schema state unions, narrowed capsule and explicit package API/documentation.
- [x] Reproduced the actual pre-consent UTF-8 carry (7/8 RED); raw byte admission and post-ACK-only subscriptions eliminate it. 178/178 targeted cases and 14/14 legacy real-PTY mode cases pass on Node 22 and 24.
- [ ] E is NOT accepted: actual IdP UV/login witnesses, Sentropic route/store/fixture-lock, exact real provider tuple, integrated 0.98.8 and allocated candidate remain external. No publication or production activation.
- [ ] Review selection-failed: exact author identity unavailable; installed h2a MCP dispatch prohibited by owner confinement. Dossier tmp/cm2-f2/review.md; no independent consensus.

CM2-F2 managed-read closure: bounded worker readData independently resolves retained-read authorization with the source offline, enforces original copy expiry, and rechecks a nonforgeable monotonic read-response deadline after worker/commit awaits. Auth-deadline RED: 14/15 before assertHistoryRead; expired/revoked managed reads refuse.

CM2-F2 final boundary regressions: refuse source/confirmation client conflation; reject encoded amplification before decoding; retain native monotonic policy revision/digest floors from staging onward, cancel older children/reservations, and refuse cached broader-policy rollback during and after narrowing. Each new regression was observed red before its guard, with logs under tmp/cm2-f2/.

CM2-F2 final integration: rebased onto origin/main fceab4a95 (0.98.7 release train restored), preserving the current upstream scope and the CM2-F2 scope above. Earlier preparatory checklists are historical evidence; the latest local deliverables include SSE, future-child inheritance, raw admission, managed reads and the packed capsule. Production qualification and the remaining named acceptance witnesses stay open; no candidate allocation or independent consensus is claimed.

### CM2-F2 Tour 2 — independent review #361
- [x] Scope amendment: .gitattributes capsule byte pinning, targeted gateway build/checkout tests, and runtime content regression tests directly close the two red CI causes. No gate is disabled.
- [x] Local findings #2–#8: terminal-gap metadata and outage/continuity, single archive-byte debit, consent-fenced HTTPS snapshot/segment delivery, frozen selectors and inclusive worker ranges, kernel-released fence lock, serialized/preemptible control and typed IPC refusals.
- [ ] Finding #1 remains a production acceptance blocker: origin/main fceab4a95 is still 0.98.7. Conductor owns integrated 0.98.8/candidate; Sentropic/IdP owns deployed introspection/UV CAS/receiving paths. Qualification requires exact real provider tuple, fixture lock and production bootstrap. Native capability stays empty; no synthetic production activation or publication.
- [x] Review #4 transport correction follows frozen v4 §6 (canonical application/json), rather than the review's conflicting octet-stream wording. Capsule bytes unchanged.

### CM2-F2 Tour 3 — review #361 round 2
- [x] Read all findings #1–#8: #2–#7 retain their reviewed fixes and regression witnesses. #8 now applies the same typed-error allowlist to synchronous throws and asynchronous rejections on every content IPC entry.
- [x] Finding #1 local refusal boundary: advertise content capability only after a session is successfully bound, not merely because a factory is configured. Missing bootstrap, legacy PTY and failed factory refuse all seven content operations with unsupported_source, without replay/attach fallback. Unqualified history refuses unsupported_format before challenge or catalog access; native:[] remains pinned.
- [ ] Finding #1 production acceptance remains blocked: origin/main fc6f4347a still declares 0.98.7. Conductor owns integrated 0.98.8/#683 bootstrap and candidate; Sentropic/IdP #677 owns deployed login introspection, atomic UV CAS, receiving store/routes and fixture lock. Acceptance requires F2-01…11 on that integrated head with an exact qualified real provider. PR remains draft; no production enablement, release or Lot E acceptance.
