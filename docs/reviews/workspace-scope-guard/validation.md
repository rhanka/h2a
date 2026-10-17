# Targeted validation

Target implementation: 74b52dea7350f7e731dfe9cb5f56dbc87d6eafb6.

All regressions ran before their corresponding implementation, then passed in
final verification. Temporary repositories/profiles only; fake GitHub readers;
no installed h2a binary or live owner configuration. No full local suite.

| Command | Before policy/fix (pass/fail) | Final |
| --- | --- | --- |
| node --test packages/h2a/test/workspace-scope-guard.test.js | No-op policy: 1/15 | 32/0 |
| Same file: grant/preflight/envelope hardening | 17/4, 22/2, 24/3, 26/2, 28/2, 30/1 across successive test additions | 32/0 |
| node --test --test-name-pattern='literal Codex patch' packages/h2a/test/workspace-scope-guard.test.js | 0/1 | Included in 32/0 |
| node --test packages/h2a/test/workspace-scope-hosts.test.js | 0/5 | 6/0 |
| node --test --test-name-pattern='project hook masks' packages/h2a/test/workspace-scope-hosts.test.js | 0/1 | Included in 6/0 |
| node --test packages/h2a/test/native-host-convergence.test.js packages/h2a/test/native-host-review-regressions.test.js | 16/3: old assertions conflated scope and MCP guard hooks | 19/0 |

The 17/4 intermediate run included a fixture error (attempting mkdir over its
existing audit file), corrected without changing the policy assertion. The
no-op baseline reproduced the prior absence of any workspace policy; the new
entrypoint did not exist on main. Other red runs exercised missing behaviors
in an executable guard. Full local TAP transcripts are in ignored
.h2a/build/scopeguard/{red*,green*,targeted-final.log}.

Final command (spawned with HOME, XDG_RUNTIME_DIR, XDG_CONFIG_HOME, XDG_STATE_HOME,
CODEX_HOME, CLAUDE_CONFIG_DIR and VIBE_HOME under a fresh mkdtemp, removed on exit):

```sh
node --test packages/h2a/test/workspace-scope-guard.test.js packages/h2a/test/workspace-scope-hosts.test.js packages/h2a/test/host-plugin.test.js packages/h2a/test/native-host-convergence.test.js packages/h2a/test/native-host-review-regressions.test.js packages/h2a/test/native-host-safety.test.js packages/h2a/test/vibe-mcp-direct.test.js packages/h2a/test/manual-cli-hook.test.js packages/h2a/test/vibe-native-hooks.test.js packages/h2a/test/package-plugin-manifest.test.js
```

```text
1..96
# tests 96
# pass 96
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

| Other command | Observed result |
| --- | --- |
| npm ci --ignore-scripts | exit 0; 291 packages installed |
| npm run typecheck | exit 0 |
| bash scripts/check-public-contract.sh | 60 MCP tools; 100 CLI verbs; leaf core; CONTRAT PUBLIC OK |
| bash scripts/check-no-python.sh | ZERO PYTHON OK; 0 unexcused |
| git diff --check | exit 0 |

One contract check ran concurrently with typecheck rebuilding dist and could not
load the local MCP entrypoint. A bounded isolated direct invocation then returned
all 60 tools; repeating the unchanged contract check after build passed. No
contract golden or unrelated source was modified.

Limits: no real-host execution qualification, no agy/muse enforcement, no
h2a implementation consensus (MCP unavailable; exact author metadata unknown).
The parser and regression fixtures exceed harness-plan's 150-line commit limit;
they were kept in functional commits. Package versions/dependencies unchanged.
