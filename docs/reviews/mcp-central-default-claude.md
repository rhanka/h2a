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

## R6: exact incident input and unresolved destruction

The published core fixture is SHA-256
`3de15d2ebce30ef5b27748ad06696844980c3c3d2ac5dfd4c6f5f7ff8c66d9a3`.
The published runtime fixture is SHA-256
`8d7be8ac52a0d17466c4635c2c1374249a1661276f8c70d668c9a89b84ebffd6`.
Both archives are versioned; tests extract them into private `.qual-tmp`
directories and verify hashes before importing their unchanged modules. Fresh
qualification also matches their SHA-512 bytes against npm's published 0.98.0
`dist.integrity` (receipts: `.qual-tmp/r6/evidence/published-integrity.*`).

The owner-supplied pre-incident `HEAD:.mcp.json` from tracked
`airbus-genair-d2d` at `3508b24` is now the versioned
`packages/h2a/test/fixtures/d2d-mcp.json.pre-incident`: 346 bytes, UTF-8/LF,
no BOM, SHA-256
`984069aaed26cd2ce888dc692a4400f9c9c1cbb5add9c86fedbed3fc6b3d5470`.
It contains Graphify's `npx.cmd`, 0.23.1 arguments, Windows graph path and
tool profile. Tests load these exact bytes and verify their hash.

The supplied incident sequence enables `h2a.central.enabled` without an
endpoint, then relaunches through run/restore. Qualification sets that exact
central setting in a private config. With the incident UID 1000, 0.98.0
persists `http://127.0.0.1:48000/mcp`. A real published central runs on that
port. Its hard-coded rendezvous reads are relocated at the filesystem boundary
into `.qual-tmp`; the published parser, filters, writer, preparation, liveness
and rendered connector remain unchanged. Detached process startup is refused.
No owner session, host or runtime directory is accessed.

Observed results on the exact input:

The copied file is staged in each isolated git repository with initial mode
`0640`, chosen to detect permission changes; the incident's original filesystem
mode was not supplied.

| Route | Published 0.98.0 | Candidate |
| --- | --- | --- |
| Restore preparation alone | Zero project writes; bytes preserved. | Zero project writes. |
| Run preparation | `writeFileSync` + `chmodSync`; Graphify retained, h2a added; mode `0600`; no backup. | Zero project writes; bytes, mode, inode, timestamps and git status preserved. |
| Restore followed by re-entered run | Same two writes and retained Graphify. | Zero project writes with the same preservation checks. |
| Explicit host writer | Graphify retained; no backup. | Tracked write refused with code 2; explicit `--allow-tracked` succeeds, preserving original Graphify bytes/mode and making an exact backup. |

The published git diff adds h2a after Graphify; it does not replace Graphify.
Repeated published launches are byte-idempotent and retain Graphify. This
reproduces the unsafe implicit tracked-file modification, **not the required
destruction RED**. Both real-server probes and the focused automated tests
observe `graphifyDestroyed=false`; R6 remains open.

The published path audit identifies `index.js:4276` →
`prepareCentralMcpForLaunch` → `profileMcpConfig` → `host setup --write`.
Restore calls its transport preparation at `index.js:6915`; an absent-session
tab in `launch-layout.js:54` re-enters `h2a run`. The writer parses the existing
JSON, retains foreign servers and spreads them before adding h2a
(`cli.js:3732–3769`). Neither h2a alias matching nor standalone Track matching
matches the actual Graphify server. The rollback restores the captured
contents. The complete literal `.mcp.json` inventory of both published dist
trees identifies no additional project writer in run/restore; the installation
doctor reference reads a conventional plugin config. The runtime bypasses the
doctor through its coherence callback. The audit establishes the reachable
writer, but does not identify another code path that caused the reported loss.

Real published probe:

```sh
rtk node .qual-tmp/r6/run.mjs final-published-live node .qual-tmp/r6/published-live.mjs
```

Raw output includes:

```text
R6 real published central: kind=started endpoint=http://127.0.0.1:48000/mcp privateMarker=true unchangedPublishedCode=true
R6 real published run: projectWrites=2 bytesEqual=false mode=600 servers=["graphify-ts","h2a"] graphifyDestroyed=false
R6 real published restore-only: projectWrites=0 bytesEqual=true
R6 real published restore-reentered-run: projectWrites=2 bytesEqual=false mode=600 servers=["graphify-ts","h2a"] graphifyDestroyed=false
R6 destruction RED: NOT REPRODUCED; no parser, merge, writer or lifecycle mock
```

Real candidate probe:

```sh
rtk node .qual-tmp/r6/run.mjs final-candidate-live node .qual-tmp/r6/candidate-live.mjs
```

```text
R6 real candidate central: kind=started protocol=2 privateRoot=true
R6 real candidate run: projectWrites=0 bytesEqual=true metadataEqual=true gitStatusEqual=true sha256=984069aaed26cd2ce888dc692a4400f9c9c1cbb5add9c86fedbed3fc6b3d5470
R6 real candidate restore-reentered-run: projectWrites=0 bytesEqual=true metadataEqual=true gitStatusEqual=true sha256=984069aaed26cd2ce888dc692a4400f9c9c1cbb5add9c86fedbed3fc6b3d5470
```

The persistent regression uses published preparation and writer with simulated
liveness and the published `runtimeBase` seam; its connector therefore contains
an additional private `--runtime-base` argument. The real published probe above
has the exact observed three connector arguments. Current-source tests also
count project mutation calls and assert unchanged file metadata and git status.

Full host/session launch, the nine-repository fleet and unrelated third-party
host actions were not replayed. Exact launch flags, process write traces and
post-incident file bytes were not supplied. A forced malformed-JSON overwrite,
synthetic alias or injected competing edit would not establish this cause.
The supplied bytes are sufficient to test this writer, but the causal
discrepancy remains unresolved. Under the owner's conditional instruction,
Claude's implicit default remains OFF; explicit central activation, the
`H2A_MCP_CENTRAL=0` escape and Codex/agy stdio routing are tested. The owner's
target remains default ON once a destruction reproduction closes R6.

Fresh commands, final SHA, stdout and stderr are recorded separately under
`.qual-tmp/r6/evidence/final-*`; the French owner report is
`.qual-tmp/r6/report.md`. No root or performance gate is claimed by this pass.

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
