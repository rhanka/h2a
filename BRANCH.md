# Lot 4 — step 2e: operator break

## Objective and base

Branch `lot4/2e-operator-break`, stacked on `lot4/2d-still-held`
(`100d6f56a4b680a827447e22fc3bae028f6275a7`), whose base is
`origin/main` at `dd52059c13c16a62b65b8fe9fc2736bd2b1c8b9a`.
Reference: `docs/specs/2026-09-26-SPEC_lot4-identity-succession-lock.md`, §3, §5 and §8.

## Scope

- `packages/h2a/src/runtime/local-files/succession-lock.ts`
- `packages/h2a/src/index.ts`: export the operator API and result types.
- `packages/h2a/src/cli-command-map.ts`: list the runtime recovery commands.
- `packages/h2a-runtime/src/index.ts`: CLI commands and their help.
- `packages/h2a-runtime/src/cli-help-groups.ts`
- `packages/h2a/test/succession-lock-operator.test.js`
- `packages/h2a/test/succession-lock-operator-cli.test.js`
- `packages/h2a/test/succession-lock-test-seam.mjs`: test-only pre-election window.
- `packages/h2a/test/fixtures/runtime-help-commands.json`
- `docs/operator-identity-unlock.md`, its README link, and this plan.

No identity-binding migration, real identity-store access, dependency/version
change, `.track` write, PR creation, push to main, or merge.

## Verification decision

h-cond requires removing the runner's eight-file concurrency limit: this
change is outside Lot 4's scope. The runner is restored unchanged. Campaigns
use the normal gate; every observed PTY failure must retain its exact test name
and signature. The earlier bounded campaign below is historical evidence only.

## Delivery

- [x] Require the expected token; reject malformed, stale, absent or corrupt state.
- [x] Refuse live holders, including with an explicit assertion; report their PID.
- [x] Elect through SUCC before retirement; never acquire or republish LOCK.
- [x] Undecidable holders require `assertDead`; legacy stays undecidable and uses
  the synthetic raw-byte token. Return a typed `legacy-record` diagnostic and count.
- [x] Preserve `operator:true` and `target === g` in operator succession records.
- [x] Re-read the expected token immediately before unlink; preserve the winning LOCK.
- [x] Expose `h2a identity unlock` and `h2a lock break`, requiring `--token`.
- [x] Document expected tokens, legacy hashing, assertions and refusal behavior.
- [x] Cover T-operator ×3, post-break automatic succession, and operator interruption
  during the identity controller's `retry()` with real filesystem locks.

## Validation

- Initial API RED: 5 tests, 0 pass, 5 fail (`breakLockAsOperator` absent).
- Initial CLI RED: 3 tests, 0 pass, 3 fail (commands absent).
- Baseline witness against compiled 2d: all 10 final operator/CLI tests fail.
  Only module paths are redirected; test assertions and protocol instrumentation
  are unchanged (`tmp/red-2e-on-2d`, `tmp/2e-red-on-2d.log`).
- Operator/CLI GREEN: 10/10 pass.
- Focused upgrade, succession-lock and CLI map: 154 tests, 153 pass,
  1 skipped, 0 fail (`tmp/2e-targeted.log`).
- `npm run build`: pass (`tmp/2e-build.log`).
- `npm run typecheck`: pass (`tmp/2e-typecheck.log`).
- First `npm test`: Node 2,440 tests, 2,396 pass, 1 fail, 21 skipped, 22 TODO;
  Track 1,193/1,193 pass (`tmp/2e-full.log`). The failing native PTY codex-to-codex
  test reported an identity not observable within its polling budget.
- Minimal reproduction: `node --test packages/h2a/test/pty-native-messaging.test.js`
  passes 2/2 with unchanged assertions and timeouts (`tmp/2e-pty-repro.log`).
- Second full campaign on unchanged product code: same single native PTY failure;
  Node 2,440 tests, 2,396 pass, 1 fail, 21 skipped, 22 TODO; Track 1,193/1,193
  pass (`tmp/2e-full-final.log`).
- Historical `npm test` with bounded runner concurrency (limit now removed): pass. Node: 269 files,
  2,440 tests, 2,397 pass, 21 skipped, 22 TODO, 0 fail. Track: 87 files,
  1,193/1,193 pass (`tmp/2e-full-bounded.log`). Both real native PTY round trips
  pass in the full campaign, with the original assertions and timeouts.
- Final typecheck after the runner change: pass (`tmp/2e-typecheck-final.log`).
- The final full gate also reruns and passes `npm run build`, vendor checks
  and the Focus import check. No timing failure is allowlisted.

## Unverified

Remote CI and independent review have not run. The retry integration uses the
real controller and lock protocol with a worker double; the identity binding
writer is still the pre-migration implementation until later Lot 4 steps.
Real macOS behavior, fleet PID isolation and multi-version transition remain
unverified as described in spec §9. The exact scheduler condition behind the
earlier PTY failures was not directly measured. No real identity secrets were inspected.
