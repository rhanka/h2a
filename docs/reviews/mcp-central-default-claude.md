# Central MCP — review 4 remediation

Reviewed branch: `feat/mcp-central-default-claude`, 22 commits from
`5ca5c7bc` (`origin/main`) through `1c9f1bfb`. The starting worktree was clean.
Earlier execution claims and pre-rebase SHA references are superseded by the
new receipts under `.qual-tmp/sol4/evidence/`.

**The Claude default release remains blocked by R6 / P0 #5.** The binary now
keeps central opt-in (`H2A_MCP_CENTRAL=1` or `h2a.central.enabled=true`).
Absent configuration selects stdio. No delivery, publication or owner-state
migration was performed.

## Proven corrections

| Item | Change | Regression evidence |
| --- | --- | --- |
| R3 | `4881775c`: a v1 connector without a host cannot be qualified by an inherited Claude ID. | Reinserting the previous no-host inference gives one central attachment instead of zero. Restoring the strict host check passes; explicit Claude creates one attachment. |
| R18 | `55af5db7`: exclude unsupported/unqualified hosts before reading central settings. | Six real SDK/binary cases fail before the fix and pass after it: absent host, Codex and agy against malformed JSON and unreadable settings. |
| R19 | `9c528375`: strip attachment-specific daemon fields before merging the client context; preserve the client's workspace. | Manual daemon startup with native or tmux launcher fields contaminates presence before the fix. Both cases pass after it, including readiness isolation, self-send wake target and preservation of the client's own terminal. A separate RED exposes the daemon cwd in client presence. |
| R6 default gate | Keep implicit activation disabled until the mandatory reproduction exists. | The new gate test fails on implicit daemon startup before the change and passes afterward. **This RED/GREEN is the release gate, not a reproduction of Graphify loss.** |
| R12 | Require exact launch options, including the creation callback. | Removing the callback fails the strengthened assertion; restoring it passes. |
| R15 | Verify T4 actually uses the central, and retain fresh final-SHA receipts. | Forcing the helper to stdio fails the live-central witness. Central mode must report protocol 2 and one attachment per connection. |

## R6: observation and unresolved requirement

The published core fixture is SHA-256
`3de15d2ebce30ef5b27748ad06696844980c3c3d2ac5dfd4c6f5f7ff8c66d9a3`.
The published runtime fixture is SHA-256
`8d7be8ac52a0d17466c4635c2c1374249a1661276f8c70d668c9a89b84ebffd6`.
Both archives are versioned; tests extract them into private `.qual-tmp`
directories and verify hashes before importing their unchanged modules.

`central-mcp-0980.test.ts` executes the published `prepareCentralMcpForRestore`
and `prepareCentralMcpForLaunch` plus the published `runCli` writer. Daemon
liveness is simulated; discovery receives the original `runtimeBase` test
seam to avoid 0.98.0's hard-coded `/run/user/<uid>` path. No native host starts.
The Airbus-shaped tracked fixture contains Graphify's `npx.cmd` command,
0.23.1 arguments, Windows graph path and tool profile. It is reconstructed
from the supplied description, **not an exact pre-incident file snapshot**.

Result: restore preparation leaves the fixture untouched; subsequent launch
preparation adds the central h2a connector, changes tracked bytes and mode,
and creates no backup. **Graphify remains present.** The candidate preparation
leaves bytes and git status unchanged and never calls the writer. Separate
writer tests reproduce standalone Track removal and JSON/CRLF reformatting
in 0.98.0; they do not reproduce Graphify entry destruction.

The exact production loss therefore remains unexplained. No failing
Graphify-preservation assertion, exact binary run/restore reproduction or
R6 closure is claimed. Closing it requires the pre-incident bytes and the
causal launch steps/log, reproduced in isolation. A synthetic alias, forced
malformed JSON overwrite or injected competing edit would not establish the
reported production cause.

## Qualification boundary

Each receipt records the command, environment, timestamp, SHA, working diff
hash and exit status, with raw stdout/stderr beside it. Final qualification
must use the final committed SHA with a clean worktree. It covers scoped
runtime preparation/dispatch, central/core, attachment, host preservation
and true T4 central (`H2A_MCP_TEST_CENTRAL=1`, `H2A_MCP_TEST_N=4`).
T4 explicitly verifies a live daemon, its state root, protocol and attachment
count. Fixture environments provide HOME and all XDG paths under `.qual-tmp`;
the v1 compatibility cases stop each child after its handshake to bound RSS.

HOME and every XDG directory are under `.qual-tmp`. Path guards reject owner
state paths, including realpath escapes. A guard stopped Vitest's initial
repo-wide discovery at an owner-state symlink before the access; subsequent
runs use the runtime package root. Only fixture-owned child handles and
authenticated daemons in unique fixture namespaces are stopped.

No new whole-repository gate or performance qualification is claimed.
The earlier latency/RSS numbers are not evidence for this revision. The
18/36-session and large-store budgets remain unqualified. The launch-index
already exists on `origin/main`; no parallel index or deferred integration
claim is needed. Independent peer consensus is not claimed because the
installed-session route conflicts with owner-state isolation. `.track`
remains untouched.
