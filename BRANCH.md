# Focus decision dossier kit
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
