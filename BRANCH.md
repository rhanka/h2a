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
- Real live qualification remains Claude→Claude only, 1/36; no real cross-CLI pair qualified. Formal installed-h2a review route remains forbidden and selection-failed; global npm/release PID confinement wiring remains outside this qualified slice.
