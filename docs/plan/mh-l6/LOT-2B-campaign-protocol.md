# LOT-2B — Real-Claude qualification campaign protocol (frozen)

Spec: `SPEC_EVOL_MCP_LANE_REMEDIATION.v2.md` §7 LOT-2B (F-01 evidence half → RQ-02, RQ-03, RQ-04).
Status: **protocol committed before execution; execution pending an enrolled seat.**
RED proof: `evidence/LOT-2B-red-empty-manifest-2026-10-19.log`
(empty manifest, pinned tuple refused, `claude_version_unqualified` on the bin route, Node 22 + 24).

Changing anything below after seeing results invalidates the run.
A deviation observed during execution is recorded and the protocol is amended
by a new commit **before** the confirmation run.

## 1. Frozen tuple

| Field | Value | Source |
|---|---|---|
| Claude build | `2.1.303 (Claude Code)` | `claude --version` in temp HOME (RED log) |
| OS | Linux x86_64 | `process.platform === "linux"` |
| Node majors | 22.22.1 then 24.18.0 | `/usr/bin/node`, `~/.nvm/.../v24.18.0/bin/node` |
| Protocol | `2025-06-18` | registry contract + shipped entries |
| Candidate clientInfo name | `claude-code` | wire-confirmed at execution; deviation → amendment commit |
| Integrated head | `4e5ca7d40` (#354 on #355 `49b8cd113`) | `git merge-base` + `git log` at protocol time |
| Mechanisms | file **and** plugin (both announced for Claude) | D-02: a mechanism not run stays unannounced (NC-1) |

## 2. Seeding (no published bypass)

Oracle phase runs against a campaign-private copy of the built tree
(`mkdtemp`, erased after): `dist/` + `package.json` + `registry/` copied,
candidate entry injected **only there** (`qualifiedShim` pattern).
The shipped manifest stays empty throughout the oracle phase.
The qualification HOME resolves `h2a` to that copy; the bootstrap declaration
under test is produced against it by the real bootstrap, never a test shim.
On full pass only: the earned entry is committed (on #355), the candidate is
rebuilt from the integrated head, and the confirmation run (initialization +
identity + catalogue protocol oracle) executes against that exact candidate
build with the declaration re-produced against it.
Confirmation failure = campaign failure, entry not retained.

## 3. Scenario families and oracles

File mechanism declaration (per run, `<Q>` = qualification HOME):
`h2a registry bootstrap install --host claude --config <Q>/.claude.json --profile default`
Plugin mechanism declaration:
`h2a registry bootstrap install --mechanism plugin --host claude --profile default --config <Q>/.claude.json --plugin-dir <Q>/plugin`
Session driver (all scenarios): `claude -p '<prompt>'` with `HOME=<Q>`,
`XDG_RUNTIME_DIR=<QRT>` (temp). Prompts are fixed in the harness.

- **initialization** — session starts, MCP `h2a` admitted: no
  `claude_version_unqualified` on the bridge stderr; central-side attachment
  record present (generation/epoch per handover contract).
- **identity** — `h2a_identity_status` through the attachment is not
  `identity_disabled`; presence bound to the native session id.
- **catalogue** — planned stimulus: compile + activate a plan adding
  `sentropic.track` (15 read tools). Protocol oracle: new `tools/list`
  received ≤ 10 s after the stimulus. Usage oracle: one added read-only tool
  invoked in the same session through the same attachment, ≤ 3 identical
  pre-defined solicitations.
- **recovery** — central restart under the attached bridge session
  (`h2a central stop` + bridge relaunch); session/attachment continuity,
  no unknown-outcome replay.
- **upgrade** — H4 no-op pass on the campaign copy (`h2a upgrade --check`,
  `h2a upgrade status`, selection of the running build = exit 0 no-change):
  attached session survives; host reconnect loads the selected build
  (RQ-04 build identity on the same surface that recorded the selection).
  A version-change upgrade re-runs this protocol against the next candidate.

## 4. Gates (spec LOT-2B verbatim)

Manifest diff contains only earned entries; every boolean maps to a named
observed artefact per scenario family and per mechanism; LOT-2A validation
and LOT-3 bridge tests still green on the same head with the populated
manifest; confirmation run recorded; negative check (neighbouring unlisted
Claude version still refused through the bridge) recorded. R7b native
qualification discharged only for the exercised tuple; all else stays NC-1.

## 5. Exit

Either RQ-02 satisfied for build 2.1.303 on the bridge route, or F-01 stays
open with the failing oracle named. Blocker recorded at protocol time:
**no enrolled seat is available in this confinement** (`claude -p` answers
`Not logged in`; owner live login files are off-limits), so no scenario
above has executed. Owner action needed: enroll one seat under the
2026-10-18 shared-quota campaign rules, then run
`node packages/h2a/scripts/qualify-registry-bridge-campaign.mjs run`.
