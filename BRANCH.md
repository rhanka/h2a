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
