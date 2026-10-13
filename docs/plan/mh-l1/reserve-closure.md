# MH-L1 reserve closure follow-up

Target: `e046d1e49a7849d63c4df983b0bef65953ab8579` plus this change.
Authority: owner request of 2026-10-12; independent `revmhl1.md` section 5
and outstanding MH-L0 findings. No release qualification is inferred.

| Reserve | Action / evidence | State |
|---|---|---|
| R1: native digest mismatch | Already fixed in L1; independent mutation M1 detected the missing guard. No new implementation change. | Closed |
| R2: non-ACTIVE controller | Add explicit negative vectors for REVOKED, INACTIVE, DELEGATING and absent authority. Mutation removing only the ACTIVE guard fails with `Missing expected exception`; restoring it passes 1/1, no skips. | Closed |
| R3: QF / QC | No ratification in supplied owner decisions. Ask owner to choose QF=A or A+B and QC=C; retain normative proposal pending answer. | Awaiting owner |
| R4: independent realization review | Original independent review exists. Installed h2a/MCP access is expressly forbidden; no claim of a new two-peer consensus. Ask whether remaining release review gate may be separated from L1 fusion verdict. | Awaiting owner / conductor |
| R5: real Claude qualification | Production manifest intentionally empty under spec §4.1. No simulated observation can qualify a real client. Keep MH-L8 measurement gate; ask whether it may be separated from L1 fusion verdict. | Awaiting owner / MH-L8 |
| R6: final .6 byte freeze | `git ls-remote --tags origin v0.98.6` on 2026-10-12 returns no ref (exit 0). Cannot compare against an absent final release. Ask whether conductor gate may be separated from L1 fusion verdict. | Awaiting owner / conductor |

R2 command: `node scripts/mh-l1-test.mjs packages/h2a/test/mh-l0-peer.test.js r2-red`
then the same command with `r2-green`. Runner executes exactly
`/usr/bin/node --test packages/h2a/test/mh-l0-peer.test.js` (Node 22.22.1)
with private temporary HOME, XDG directories and store. Raw command, output,
exit status and timing are retained in `evidence/mh-l0-peer.test.js-r2-{red,green}.log`.
The mutation is restored before any commit.

This follow-up does **not** declare L1 FUSIONNABLE without reserves while
R3–R6 remain open. No supplied independent review or owner decision is edited.

## Review of this change

The diff only extends the existing network provenance test and records evidence.
Production behavior already rejects non-ACTIVE controllers; the test now kills
the independently observed surviving mutation. The helper still starts and
stops only its own peer in a temporary directory. No runtime state, installed
binary, main branch, release version or Track log is touched.

Harness external review remains `selection-failed`: owner confinement prohibits
the installed h2a MCP dispatch required by harness-review. This is a transparent
execution limitation, not an independent consensus verdict.
