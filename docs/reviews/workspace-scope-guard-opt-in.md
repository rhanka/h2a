---
status: selection-failed
review-author:
  host: codex
  model: unknown
  effort: unknown
target-ref: fix/scope-guard-opt-in working tree based on 05bcd23cc
target-diff-sha256: 5d32debe42faebd926f29ca8b768124fdd445bb23e0d0f2d6a671eb558346a6d
observed-failure: Exact author model/effort are unavailable; the owner also forbids installed h2a/native-host and real-state access. No h2a consensus was dispatched or claimed.
---

# Workspace scope guard: opt-in

Owner order: disable default workspace scope enforcement everywhere while keeping
the optional implementation and the packaged manual h2a CLI refusal unchanged.

The fingerprint above identifies the implementation, tests, documentation and
BRANCH.md staged before this evidence dossier. The dossier is excluded from its
own fingerprint.

## Changes

| Surface | Result |
| --- | --- |
| Packaged Claude/Codex hooks | Scope SessionStart/PreToolUse entries removed; the Bash manual CLI hook is identical. |
| Explicit plugin configuration | `--workspace-scope on` renders/writes the guard; default/off removes former scope entries and retains other hooks. |
| Codex marketplace scaffold | Default omits scope; explicit on includes it. |
| Vibe, agy, Gemini shared store, Muse | Native selection persists as `workspaceScope.enabled`; absent/legacy bindings default to off; doctor/upgrade convergence follows that selection. |
| Vibe pre-tool integration | Scope hook is independent of the existing manual CLI guard and only registered after opt-in; project scope masking cannot block a disabled installation. |
| Guard implementation | Retained unchanged; opt-in hook fragment ships separately and is exercised by explicit-enable tests. |
| Documentation | Isolated lab qualification on real lot worktrees, merges, releases and disable/recovery workflows is required before owner-machine enablement. |

## Isolation and verification

All commands below are prefixed with `rtk`. Temporary state:
`/home/antoinefa/.cache-tmp/h2a-test/run-C26vfo`; TMPDIR is set for every verification.
Tests/builds also use disposable HOME, XDG_RUNTIME_DIR, XDG_CONFIG_HOME and
XDG_STATE_HOME beneath that directory. Hook fixtures discard inherited host
workspace/session/key variables before exercising their own startup bindings.
No real native host, installed h2a, Track mutation or full suite was used.

| Phase | Command | Observed output |
| --- | --- | --- |
| RED | `node --test packages/h2a/test/package-plugin-manifest.test.js` | tests 2; pass 1; fail 1; skipped 0; exit 1. Default hooks still contained workspace-scope-guard. |
| GREEN | `node --test packages/h2a/test/package-plugin-manifest.test.js` | tests 2; pass 2; fail 0; skipped 0; exit 0. Default guard absent, manual CLI hook unchanged. |
| RED, host defaults/selection | `node --test packages/h2a/test/workspace-scope-hosts.test.js` against original HEAD host/CLI implementations | tests 39; pass 12; fail 27; skipped 0; exit 1. Original TypeScript was transpiled into disposable local build outputs, then the corrected h2a project was rebuilt. |
| First targeted pass | Eleven named files listed below | tests 395; pass 387; fail 8; skipped 0; exit 1. Inherited CLAUDE_PROJECT_DIR contaminated startup fixtures; one Vibe assertion matched inactive helper file paths instead of hook commands. |
| TypeScript | `node node_modules/typescript/bin/tsc -b packages/h2a --force` | exit 0, no diagnostics. |
| Package | `npm pack --workspace @sentropic/h2a --dry-run --ignore-scripts --json`, followed by package-file assertions | PASS: default hooks, optional fragment, guard and manual CLI hook are packaged. |

Initial `npm run build:h2a` reports unrelated Focus type errors in
`packages/focus/src/track/index.ts` (missing Dossier/Option/QAEntry properties).
The Track build succeeds. Local dependency artifacts were emitted with
`tsc -b --noCheck`, followed by the successful, fully checked h2a build above.
No Focus source, dependency, version or compiler configuration was changed.

The first targeted command was:

```sh
node --test packages/h2a/test/workspace-scope-guard.test.js packages/h2a/test/workspace-scope-hosts.test.js packages/h2a/test/host-plugin.test.js packages/h2a/test/native-host-convergence.test.js packages/h2a/test/native-host-review-regressions.test.js packages/h2a/test/native-host-safety.test.js packages/h2a/test/native-host-shared-skills.test.js packages/h2a/test/vibe-mcp-direct.test.js packages/h2a/test/manual-cli-hook.test.js packages/h2a/test/vibe-native-hooks.test.js packages/h2a/test/package-plugin-manifest.test.js
```

The nine files outside the two scope suites passed 62/62 with zero skips.
Only the two changed scope suites are rerun after correcting fixture isolation
and the command assertion; their final result is recorded below.

```sh
rtk node --test packages/h2a/test/workspace-scope-guard.test.js packages/h2a/test/workspace-scope-hosts.test.js
```

Observed output: tests 333; pass 333; fail 0; cancelled 0; skipped 0; todo 0;
exit 0 (132231 ms). Together with the nine previously passing files, all 395
targeted tests pass without skips. The guard's implementation remains unchanged.
