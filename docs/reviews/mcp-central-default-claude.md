# MCP central default for Claude — execution report

Target: `feat/mcp-central-default-claude`, based on `origin/main` at `db12b3b7`.
Scope: the amended urgent L-H then L-A plan. No deployment or publication.

## Local commits

- `1ac2b047`: remove implicit project/config writes; preserve explicit host edits.
- `160a7b10`: independent attachments, canonical state root, neutral daemon,
  reconnecting shims, operator control and residue inventory.
- `59af62b8`: refuse lossy UTF-8 and uncertain tracked-file checks.
- `2436f40b`: lightweight Claude default through the existing `mcp-serve` command.

## Defect evidence and acceptance

| Requirement | RED / baseline | Candidate result |
| --- | --- | --- |
| No project/config writes in run/restore | The original preparation path called silent `host setup --write <cwd>/.mcp.json`; endpoint selection rewrote configuration. Two focused assertions failed. | Five runtime tests pass. A git fixture retains identical porcelain output and config bytes after both preparation paths; the host-writer spy is never called. Actual Claude binary attachments leave both empty repo fixtures empty. Full agent-host launches are excluded from this laboratory. |
| Preserve foreign host entries and tracked files | Three original writer tests fail: surrounding-byte preservation, tracked refusal, and malformed/ambiguous JSON refusal. Published 0.98.0 deletes `track-mcp` and reformats the fixture. | Six focused writer/wake tests pass: graphify, Track, Unicode/CRLF and file mode survive, backup is exact; tracked edits require the flag; invalid JSON/UTF-8 is refused without writes. |
| Exact 0.98.0 reproduction and foreign entry preservation | In production, 0.98.0 implicitly wrote project `.mcp.json` during run/restore; the claim that `graphify-ts` used a `track-mcp` bridge was an unverified hypothesis (the airbus repository used `@mohammednagy/graphify-ts`). However, published 0.98.0 binary silently deletes foreign `track-mcp` entries via `isStandaloneTrackMcpServer`, strips CRLF, reformats JSON, creates no backup, and overwrites tracked files. | Published 0.98.0 binary is executed directly against the evidenced fixture (`repro0980.mjs`) to prove silent deletion, CRLF destruction, and missing backup. Candidate writer preserves foreign entries (`graphify-ts`, `track-mcp`), all surrounding bytes, CRLF, file mode, creates exact backup, and refuses tracked files. |
| State root separate from workspace | Published 0.98.0 serves repo A's Track data to a repo B bridge and rejects repo B's correct `h2a_run` workspace. | Two attachments query their own Track state and dispatch `h2a_run` to the correct workspace; cross-workspace overrides are rejected. The run executor is controlled, so no real agent host is started. Shared state has two bindings, no repo sentinel/config creation. |
| Restart keeps host stdio and identity | Published 0.98.0 shim exits 1 when its central stops. | A real central receives SIGTERM while the same shim and pipes remain alive; restart keeps the same instance and one binding. Token rotation also passes. Missing resume key fails closed with no new binding/key. |
| Operator stop / enabled=false | No corresponding operator verb or live-shim contract existed. | Authenticated status/stop, persistent auto-start inhibition, healthy-live behavior with false, and unavailable errors after stop pass. No switch to a new stdio runtime occurs inside a live shim. |
| V1 residue inventory | New behavior; no baseline RED run claimed. | Report-only test finds tracked `.mcp.json` and repo sentinel without adding, editing or deleting a file. Production residue paths are never inspected or cleaned. |
| Claude default and discovery | Original `mcp-serve` starts full stdio for each client. | Two actual Claude shims share one protocol-v2 ephemeral central. Environment/config opt-outs and Codex/agy retain stdio. Missing systemd-runtime selection and orphan/idle shutdown pass. Manifests remain unchanged. |
| Indeterminate mutation | New failure injection. | A controlled server records the effect and drops its reply: `outcome_unknown`, `retrySafe=false`, exactly one execution after a subsequent recovery read. |

Every daemon/test host has an isolated HOME, runtime namespace, config and store.
Signals target only processes created by this laboratory. No owner host, session,
configuration, repository or `.track` state is used. The failed native-fixture
cleanup additionally verifies executable path, test generation and ancestry.

## Focused verification

- Runtime preparation: 5 passes.
- Central/core plus attachment regressions: 27 passes before the two extra
  missing-proof/mutation cases.
- Final attachment, identity state, stdio, wake and CLI selection: 130 passes,
  16 intentional skips (146 cases).
- Host writer plus setup wake: 6 passes.
- T4 through the final native-HTTP central transport: 5 passes, no skips, N=4.
  Distinct identities, one shared-conversation binding, held-lock release,
  recovery after the identity deadline, and mixed synchronous/asynchronous
  writers all pass on a synthetic registry.
- CLI/MCP legacy golden comparison: 99 declared CLI verbs and 60 MCP tools
  unchanged; no core dependency cycle. Operator commands are binary routing
  additions outside that legacy verb registry.
- TypeScript workspace build passes.
- One final root `npm test`, isolated and pinned to two CPUs: Node 2,451 passes,
  4 failures, 32 skips and 21 TODO; Track 1,193 passes (87 files). The Node
  failures are an existing differential-fuzz file exhausting the imposed
  384 MiB heap and three native cases starting before the missing node-pty
  binary was prepared. The native module was subsequently compiled locally
  with C++, without Python; only failed fixture hosts descended from this
  runner were stopped. A targeted check of those two files with the prepared
  PTY and a 768 MiB heap passes: 19 passes, zero failures, six existing TODO,
  56.1 seconds. No assertions or production source were changed for that rerun.
  The full suite is not rerun or described as GREEN.

## Performance sample

Linux, Node 22.22.1, four sequential distinct native Claude conversation ids,
fresh empty synthetic registry per mode, the same built candidate binary.
Stdio is selected explicitly with `H2A_MCP_CENTRAL=0`. RSS is sampled after
identity readiness and a 250 ms settling interval; transient worker peaks,
host memory, PSS, CPU and production-volume journal reads are not included.

| Observation | Full stdio | Central + shim |
| --- | --- | --- |
| Initialize, first/cold attachment | 229 ms | 443 ms |
| Initialize, remaining three attachments | 227–235 ms | 109–122 ms |
| Identity ready, first/cold attachment | 486 ms | 697 ms |
| Identity ready, remaining three attachments | 487–520 ms | 385–415 ms |
| RSS per persistent session process | 108.3–109.2 MiB | 73.7–73.9 MiB |
| Central RSS | none | 125.1 MiB |
| Aggregate RSS at four attachments | 435.4 MiB | 420.2 MiB |
| Durable binding count | 4 | 4 |

Warm initialize is approximately halved. Per-shim RSS falls about 32%; aggregate
RSS falls only 3.5% at N=4. The central's event-loop monitor, with 20 ms sampling
resolution, reports p99 21.4 ms and max 37.0 ms during this small campaign.
These four observations are not a p95 qualification or an endurance test.
The proposed <=50 MiB shim budget is missed; the >=50% aggregate reduction at
18 attachments and burst-of-36 budgets are unqualified. Cold startup is slower.

## Remaining work and risks

L-B: qualify causal Codex/agy conversation signals, environment propagation,
resume and subagent behavior before selecting the central for those hosts.

L-C: integrate PR #313's launch-index when it reaches main (absent at this base;
source TODO present; no parallel index created), incremental journal reads,
bounded identity scheduling, multiple state roots, coordinated upgrades/drain,
durable notification replay/cursors and stable presence continuity across
restart, duplicate wake-consumer qualification, cluster-mesh per principal.
The urgent attachment reuses the existing identity worker and may still scan
journals; large synthetic-volume and burst-of-36 qualification remain required.
Per-attachment auto-upgrade is suppressed; explicit upgrade and idle retirement
are documented. Linux/Claude native-id fixtures do not qualify every installed
host version. Claude conversation changes require reopening the attachment.

The central loads its heavy runtime helpers at startup, uses a private 0600
marker and numeric loopback Host/Origin gates, and never returns signing keys to
the shim. Resume proves the stored local binding/key; this is not the target
design's durable resume-secret protocol. Same-UID processes remain trusted.

No independent peer consensus is claimed. The harness review requires the
installed-session launch route, which conflicts with the explicit prohibition
on touching owner sessions/state. `.track` has another writer and is unchanged.
