---
status: selection-failed
review-author:
  host: codex
  model: gpt-6.1-sol
  effort: xhigh
target-ref: d46eddb7704e516c120c1a1a0fe81c049e876b63
observed-failure: No installed h2a MCP launch tool is available in this confinement; no eligible independent review legs could be dispatched.
---

# Identity succession recovery and stale failure refresh

The owner journal records three related incidents: November 2 at 09:50
(previous-boot saturation, addressed by #408), November 5 at 20:42 (nine
current-boot records belonging to dead processes, including PID 309670), and
November 7 at 10:45 (a long-lived MCP server still naming that vanished
blocker). This change covers the current-boot chain and refreshes the MCP
failure without requiring another tool call first.

Each of the lock and eight reachable successors must independently prove
the same strong machine identity, current boot and PID namespace, plus a
recorded `/proc` start. Recovery accepts only PID absence or a comparable,
different `/proc` start. The existing coherent identity probe supplies the
start observation. Live owners, missing starts, foreign or unknown anchors,
unreadable process evidence, mixed boots, unsupported publications and
unqualified filesystems retain the refusal. Existing previous-boot recovery
keeps its separate predicate and behavior.

The shared recovery election and generation checks select one recoverer.
A dead recovery-election owner is succeeded through the existing fence
engine. Ordinary succession also checks that election before publishing:
it cannot enter through a temporarily shortened chain while quarantine is
moving the old successors. Before moving anything, the winner makes durable byte copies and a
0600 `receipt.json`, then rechecks every original's inode and contents. The
current-boot originals are renamed into `.stale-aside-<UTC stamp>-<nonce>/`,
with the lock moved last. The receipt records the actor, UTC time, every
record and each absence/start-mismatch proof. Doctor uses the same recovery
function and reports the directory and filenames through its existing
`identityPreviousBootChain` check. Dry-run preserves the files.

The MCP failure gate reads at most nine regular files of at most 64 KiB
each, without following symlinks or probing processes. It follows successor
generations and compares a bounded content witness with the failed attempt.
A changed or vanished identity blocker starts one fresh bounded attempt;
status and refused signed calls expose its new attempt ID immediately.
Unchanged failures and pending attempts keep the existing retry gates.
Registry deadline discovery keeps its first-failure response. No deadline,
polling limit or timer budget was increased.

## Local verification

Tests ran on Node 22.22.1 against a private transpilation of repository
sources, with isolated HOME, TMPDIR and XDG directories and a process/state
access guard. The historical 0.98.5 reference was built from Git sources in
the same run directory. The temporary driver invoked `node --test` with the
named files and `--test-concurrency=1`; it never ran the full repository suite.

RED before product edits: the two new files produced 6 passes and 14
failures. Recovery/doctor returned false or timed out with
`succ-chain-exhausted`; status confused a standing SUCC with a changed LOCK,
or retained a vanished blocker with an unknown generation. The corrected
real-MCP race fixture independently failed before the implementation. An
additional corrupted-successor control produced 0 passes and 2 failures
before its observation fix.

The local run directory is
`/home/antoinefa/.cache-tmp/h2a-test/run-oVNjcF`.

| Driver invocation (`node <run-dir>/run-tests.mjs …`) | Output |
| --- | --- |
| `core-green --test-concurrency=1` with identity-prevboot-succ-chain, identity-state, identity-fence, identity-lock-recovery, identity-previous-boot-namespace, identity-sameboot-succ-chain, identity-stale-failure | 71 tests, 71 pass, 0 fail, 0 skipped |
| `historical-green --test-concurrency=1` with identity-lock-v6, identity-lock-incident, identity-lock-stdio-v6, identity-lock-legacy-v6 | 59 tests, 59 pass, 0 fail, 0 skipped |
| `other-identity-green --test-concurrency=1` with identity-bindings, identity-migration, identity-readers, identity, identity-resolver, identity-schema, identity-live-wiring, identity-keypair-contention, identity-binding-contention, identity-lock-legacy-predicates, identity-worker-optional-sdk, identity-lock-mcp-v6, identity-operator-break | 90 tests, 90 pass, 0 fail, 0 skipped |
| `mcp-final --test-concurrency=1` with mcp-identity-burst, mcp-identity-readiness, identity-stale-failure | 20 tests, 20 pass, 0 fail, 0 skipped |
| `green-shortened-chain --test-concurrency=1` with identity-sameboot-succ-chain, identity-prevboot-succ-chain, identity-fence, identity-lock-recovery, identity-state, identity-stale-failure | 68 tests, 68 pass, 0 fail, 0 skipped |

Each short filename above expands to `packages/h2a/test/<name>.test.js`.
The two added files include both death proofs, refusal at the lock/middle/tail,
doctor repair/dry-run, two processes asserting mutual exclusion, two real MCP
servers reaching ready with one quarantine, immediate status/signed-call
refresh, and repeated pending calls retaining exactly one worker.

The burst/readiness batch initially found a registry deadline-discovery
regression (9 pass, 1 fail); commit 236820476 fixes it without changing its
assertion or time bound. Final MCP output: 20 tests, 20 pass, 0 fail, 0 skipped;
the burst cohort retains its default 36 connections. A further deterministic
quarantine/succession interleaving failed first (0 pass, 1 fail: an ordinary
acquirer entered after the first successor moved), then passed with the
shared-election guard. The table covers 231 distinct checks, with intentional
overlap in the focused reruns.

`npm run typecheck` and `git diff --check` passed. No independent peer
consensus is claimed; the metadata above records the unavailable selection.

## Execution deviations

An inherited doctor test equipped Claude/Codex caches in its private HOME,
temporarily exceeding the 200 MB fixture budget. Those caches were removed;
the two doctor suites now inject their existing host-installation seam so
identity checks create no host equipment. An inherited published-unlock race
test also invoked `npm install` inside its temporary fixture; its two checks
passed and the fixture was removed. It was not rerun. These are execution
deviations, not exemptions from the owner's constraints.
