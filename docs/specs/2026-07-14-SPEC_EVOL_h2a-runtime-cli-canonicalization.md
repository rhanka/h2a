# EVOL — Canonical h2a runtime CLI

## Intent

Make `h2a` the only user-facing command name for the heavy runtime while retaining every remote transport and legacy-state compatibility contract.

## Decisions

- D1 — Branding and transport vocabulary are separate. User commands, Commander usage, help examples, and remediation hints use `h2a`. Semantic transport terms such as remote endpoint/session, `h2a remote`, `.remote`, `REMOTE_*`, registry kinds, protocol names, and `remote-*` tmux sessions remain unchanged.
- D2 — The core continues to lazy-load `@sentropic/h2a-runtime`, but dispatches only through a canonical `dispatchH2a` capability. A legacy runtime exposing only `dispatch`, or an incompatible runtime API version, is rejected before runtime dispatch.
- D3 — Compatibility is capability-versioned, not gated on exact package SemVer. Patch-level package skew is acceptable when both sides implement the same runtime CLI API; missing or mismatched capability versions fail closed with install guidance.
- D4 — `h2a remote ...` remains the native remote-transport namespace and is never routed into the heavy-runtime fallback.
- D5 — The globally installed `remote` binary belongs to the separately published `@sentropic/remote-cli`, which is not owned or released by this monorepo. This branch will not fake a shim. Retirement requires a release in that package: a dependency-free binary that prints the `h2a` migration and exits 64 without loading any runtime.
- D6 — Existing process exit codes, machine JSON, `.remote` state, config migration/symlink behavior, and legacy session discovery remain compatible.
- D7 — The canonical Pod envelope bridge is `h2a relay bridge`. The runtime keeps `h2a` as an alias for the old nested namespace so existing argv remains accepted, but help and advice only teach `relay`.
- D8 — Generated and persisted executable commands are part of the user-facing contract. Readiness probes invoke `h2a`, and hook installation migrates existing `remote enroll` hooks to one canonical `h2a enroll` entry per event without duplicating unrelated hooks.

## Adversarial review reconciliation

- Correctness review accepted D1/D2 but rejected broad string replacement and exact-SemVer gating. The design now uses a semantic allowlist and explicit capability API.
- Security/contract review required legacy-only and incompatible runtimes to fail before tmux/config effects, plus byte-preserving argv dispatch tests. These are acceptance gates.
- Both reviewers rejected adding a `remote` shim without package/release ownership. D5 records the external release requirement instead.

## Acceptance

- `h2a run|delegate|jobs|workspace --help` never emits `Usage: remote` or actionable `remote …` advice.
- Runtime fallback argv is forwarded unchanged through `dispatchH2a`.
- Missing, legacy-only, and incompatible runtime capabilities fail closed with canonical `h2a` diagnostics.
- `h2a remote` remains native.
- `h2a relay bridge` is canonical and the previous nested namespace remains an accepted alias.
- Readiness and freshly generated hooks never execute `remote`; reinstalling hooks migrates legacy commands once and is then idempotent.
- `.remote`, `REMOTE_*`, remote transport models, and `remote-*` session compatibility are unchanged.
