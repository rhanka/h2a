# Targeted verification evidence

Only temporary repositories/state, fake audits/OSV/gh, fake seat execution and
own child PIDs are used. Node integration fixtures run actual targeted Node
tests and Git fetch/worktree/commit/push against disposable local bare remotes.
No installed h2a, real native host, provider inference or full suite is invoked.

| Regression command (prefix `rtk`) | Red output | Green output |
| --- | --- | --- |
| `node --test packages/h2a/test/vuln-fix-policy.test.js packages/h2a/test/vuln-fix-controller.test.js packages/h2a/test/vuln-fix-repository.test.js` | 26 tests: 20 pass, 6 fail, 0 skipped | 26 pass, 0 fail, 0 skipped |
| `node --test packages/h2a/test/vuln-fix-cli.test.js` | systemd dollar escaping: 2 pass, 1 fail | 3 pass, 0 fail, 0 skipped |
| `node --test packages/h2a/test/vuln-fix-policy.test.js` | own-process crash lock: 7 pass, 1 fail | 8 pass, 0 fail, 0 skipped |
| `node --test packages/h2a/test/vuln-fix-repository.test.js` | missing pinned reviewer artifacts: 5 pass, 1 fail | 6 pass, 0 fail, 0 skipped |
| `node --test packages/h2a/test/vuln-fix-process.test.js` | pending timeout: 0 pass, 1 cancelled (failure); lost quarantine: 1 pass, 1 fail | 2 pass, 0 fail, 0 skipped |
| `node --test packages/h2a/test/vuln-fix-seats.test.js` | missing scope evidence accepted: 0 pass, 1 fail | 3 pass, 0 fail, 0 skipped |
| `npx --no-install vitest run packages/h2a-runtime/src/vuln-seat.test.ts` | missing native scope: 4 pass, 1 fail; large author inventory: 5 pass, 1 fail | 1 file passed, 6 tests passed |

Initial scanner, policy, CLI and native-runner acceptance files also failed
before their modules existed (`ERR_MODULE_NOT_FOUND`), then passed. Those are
feature acceptance proofs, not exploit regressions. Controller and Git fixture
acceptance tests were developed alongside implementation; no prior-regression
red result is invented for them.

Build: `rtk npm run build` returned exit 0 with `vendor-engram-live mirror OK`.
Type annotation failures discovered during development were fixed before that
successful build. npm's globalignorefile deprecation warnings remain visible.

Not qualified here: real seat authority and shared quota integration, native
hook execution/provider identity, live advisory service reliability, real
GitHub mutation during job execution, provenance builder allowlists, real user
timer activation, OS/vendored/non-npm coverage without custom scanners. Full
repository testing is reserved for the integration conductor/CI.
