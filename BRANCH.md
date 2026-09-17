# Restore gateway opt-in

## Objective and scope

Fix restore's implicit global gateway bootstrap after direct-by-default launches.
Branch: `fix/restore-gateway-opt-in`; base: `05b1c0da` (`origin/main`, v0.97.1).
Owner authorizes focused PR and direct merge after required checks pass.

Scope: restore preparation/call site in `packages/h2a-runtime/src/index.ts`,
regressions in `structured-gateway.test.ts`, this plan and review evidence.
No version bump, publish, live-agent restart, user config or shared Track writes.

## Contract

Only explicit `--gw` prewarms the global gateway. Default/auto and `--no-gw`
do not, regardless of global enablement, including dry-run announcements.
Per-session pins and live-session nonreplacement remain unchanged: absent
pinned gateway sessions emit `--gw` on their own launch; live sessions attach.
Explicit gateway still fails closed when unavailable; dry-run never injects.

## Evidence and verification

- Regression before fix: 3 failures (default, auto, direct invoke injector).
- Focused restore/preparation tests, build, root suite and public-contract check.
- Two independent Claude-host review legs required by harness/review.
- Required GitHub CI and Track event containment required before direct merge.

## Feedback Loop

Pending final review and verification evidence.
