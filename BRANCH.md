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
