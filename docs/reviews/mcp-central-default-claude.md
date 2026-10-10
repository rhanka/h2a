# Central MCP — Claude default ON and R6 invariant closure

Branch: `feat/mcp-central-default-claude`, based on `5ca5c7bc` (`origin/main`).
Default-ON restoration starts from clean `088242d4`. Historical remediation
receipts remain under `.qual-tmp/sol4/evidence/` and `.qual-tmp/r6/evidence/`.
Default-ON qualification receipts remain under `.qual-tmp/default-on/`.
Review 5 qualification supersedes them under `.qual-tmp/review5/`, tied to
the final committed SHA.

**Claude central is ON by default on Linux for qualified native conversation
IDs.** The owner closes R6 by the zero-project-write invariant and exact
byte-preservation tests. The historical cause remains **unknown**: the 0.98.0
writer did not destroy Graphify in reproduction. `H2A_MCP_CENTRAL=0` and
`h2a.central.enabled=false` select stdio for new connections. Codex/agy stay
stdio. No delivery, publication or owner-state migration was performed.

## Proven corrections

| Item | Change | Regression evidence |
| --- | --- | --- |
| R3 | `4881775c`: a v1 connector without a host cannot be qualified by an inherited Claude ID. | Reinserting the previous no-host inference gives one central attachment instead of zero. Restoring the strict host check passes; explicit Claude creates one attachment. |
| R18 | `55af5db7`: exclude unsupported/unqualified hosts before reading central settings. | Six real SDK/binary cases fail before the fix and pass after it: absent host, Codex and agy against malformed JSON and unreadable settings. |
| R19 | `9c528375`: strip attachment-specific daemon fields before merging the client context; preserve the client's workspace. | Manual daemon startup with native or tmux launcher fields contaminates presence before the fix. Both cases pass after it, including readiness isolation, self-send wake target and preservation of the client's own terminal. A separate RED exposes the daemon cwd in client presence. |
| R20/R21 | `f0691c9c`: bind wake probes, injections, native operations and fallback drivers to the attachment environment without changing `process.env`. | Two real tmux sockets share `%0`; two private native protocol sockets share a session name. Before the fix, both tmux modes and native explicit/converted modes use the daemon socket (four failures); native-auto remains a passing control. After the fix, all five cases pass. |
| R11 coverage | Launch the repaired Claude, agy and Codex configurations sequentially; reread each signed envelope from its persisted inbox. | Each configuration reaches identity-ready, signs a successful self-send, arms wake and persists the exact returned envelope with an Ed25519 signature. The unrelated upgrade worker is suppressed in the isolated fixture. |
| R6 invariant and default | Restore implicit Claude activation under the owner's invariant decision. | The real SDK/binary regression fails with default OFF and passes with default ON. It verifies protocol 2, one attachment and unchanged exact incident bytes, metadata and git status. Runtime tests separately assert zero project writes. |
| R12 | Require exact launch options, including the creation callback. | Removing the callback fails the strengthened assertion; restoring it passes. |
| R15 | Verify T4 actually uses the central, and retain fresh final-SHA receipts. | Forcing the helper to stdio fails the live-central witness. Central mode must report protocol 2 and one attachment per connection. |

## R6: exact incident input, invariant closure and unknown historical cause

The published core fixture is SHA-256
`3de15d2ebce30ef5b27748ad06696844980c3c3d2ac5dfd4c6f5f7ff8c66d9a3`.
The published runtime fixture is SHA-256
`8d7be8ac52a0d17466c4635c2c1374249a1661276f8c70d668c9a89b84ebffd6`.
Both archives are versioned; tests extract them into private `.qual-tmp`
directories and verify hashes before importing their unchanged modules. Historical
qualification also matched their SHA-512 bytes against npm's published 0.98.0
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
reproduces the unsafe implicit tracked-file modification. Both real-server
probes and the focused automated tests observe `graphifyDestroyed=false`.
The historical cause remains unknown. R6 is closed by the owner's decision:
the candidate makes zero project writes and preserves the exact input bytes,
metadata and git status. No historical destruction reproduction is claimed.

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

Historical real published probe at `088242d4`:

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

Historical real candidate probe at `088242d4` (rerun in fresh final-SHA receipts):

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
The supplied bytes are sufficient to test this writer. The historical cause
remains unknown. The owner's invariant decision supersedes the earlier
reproduction gate: Claude's implicit default is ON; explicit activation,
configuration opt-out, the `H2A_MCP_CENTRAL=0` escape and Codex/agy stdio routing
are tested. Closure concerns the candidate's project-write risk and does not
establish the cause of the historical loss.

Fresh commands, final SHA, stdout and stderr are recorded separately under
`.qual-tmp/default-on/evidence/final-*` (superseded by review 5); the prior French owner report is
`.qual-tmp/default-on/report.md`. The older `.qual-tmp/r6/report.md` describes
the superseded reproduction gate. No root or performance gate is claimed.

Fresh final qualification commands, run sequentially from the worktree root:

```sh
rtk node .qual-tmp/default-on/run.mjs final-build node node_modules/typescript/bin/tsc -b packages/h2a/tsconfig.json packages/h2a-runtime/tsconfig.json --force --pretty false
rtk node .qual-tmp/default-on/run.mjs final-runtime node node_modules/vitest/vitest.mjs run --root packages/h2a-runtime --config vitest.config.mjs src/central-mcp.test.ts src/central-mcp-0980.test.ts src/index.test.ts --maxWorkers=1 --no-file-parallelism
rtk node .qual-tmp/default-on/run.mjs final-attachments node --test --test-concurrency=1 packages/h2a/test/mcp-central-attachments.test.js
rtk node .qual-tmp/default-on/run.mjs final-preservation node --test --test-concurrency=1 packages/h2a/test/host-config-preservation.test.js
rtk node .qual-tmp/default-on/run.mjs final-t4-central node --test --test-concurrency=1 packages/h2a/test/mcp-identity-burst.test.js
rtk node .qual-tmp/default-on/run.mjs final-routing node --test --test-concurrency=1 '--test-name-pattern=R6 Claude defaults|mcp-serve defaults Claude|H2A_MCP_CENTRAL=0 acts' packages/h2a/test/mcp-central-attachments.test.js
rtk node .qual-tmp/default-on/run.mjs final-candidate-live node .qual-tmp/r6/candidate-live.mjs
```

For review 5, run the same final commands through
`.qual-tmp/review5/run.mjs`. Also run `drive.test.js` and
`drumbeat-relaunchers.test.js` together under `final-drive-adapters` to check
the environment-bound process runtime. The retained discriminating pair is
`red-wake-final-v2` / `green-wake-final-v2`; earlier fixture-development runs
are diagnostic only. `red-wake-final.patch` retains the exact pre-fix test
diff. `evidence/manifest.json` records final-SHA receipt and log hashes.

The receipt runner sets `H2A_MCP_TEST_CENTRAL=1` and `H2A_MCP_TEST_N=4` for
`final-t4-central`; the routing tests remove the fixture's explicit activation
to exercise default ON. Test counts and receipt hashes are recorded in the
French report after final qualification.

## Qualification boundary

Each receipt records the command, environment, timestamp, SHA, working diff
hash and exit status, with raw stdout/stderr beside it. Final qualification
must use the final committed SHA with a clean worktree. It covers scoped
runtime preparation/dispatch, attachment, host preservation and true T4
central (`H2A_MCP_TEST_CENTRAL=1`, `H2A_MCP_TEST_N=4`).
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
