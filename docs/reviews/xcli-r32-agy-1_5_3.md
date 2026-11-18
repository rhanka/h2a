# Agy 1.5.3 onboarding projection review

Reviewed 2026-11-07 on the r32 bench lane. The owner's 05/11 rule assigns
schema review to the Astra max co-solver; Astra is out of provider quota
until 2026-11-11 18:43, so this review was performed by the remaining
build engine under the standing two-engine rule. No second-peer consensus
is claimed until an independent reviewer reproduces it.

Baseline: the reviewed 1.5.2 tuple (docs/reviews/xcli-r31-agy.md) —
`State.post_onboarding` (77 bytes), `PostOnboardingState` (103 bytes)
and `PostOnboardingStepType` (252 bytes), each registered by SHA-256.
Candidate: Linux x86-64 Agy 1.5.3, 246837648 bytes, SHA-256
`7ca212748ca0dfda718efbc39a776a104472e7e9344d4b6ea147c543684f96a3`.
The vendor binary replaced itself in place at 2026-11-07T10:48Z,
between bench passes 1 and 2. Pass 1 had measured-OK Agy pairs on 1.5.2;
pass 2 honestly refused the new binary with
`onboarding-version-unreviewed:agy:1.5.3` before any credential access
(live RED, recorded in xcli-r32-pass-2.json and the r32 matrix).

The executable is read for hashing and bounded descriptor carving; it is
never copied into a fixture and never executed for this review.

| Embedded jetbox_state_pb descriptor | 1.5.3 offset / bytes | SHA-256 | vs 1.5.2 |
|---|---:|---|---|
| `State.post_onboarding` | 105865837 / 77 | `ea25e8d8dd2d0234d4523f6e3f1b342c560ddec907250e8d3c12452e139488b1` | byte-identical |
| `PostOnboardingState` | 105856536 / 103 | `e479351811fe1686621bad52f28a1277fadefbb28b8a0a8f3f0c9ba74ea6bf64` | byte-identical |
| `PostOnboardingStepType` | 105867013 / 252 | `b3a87909f9ae41e884179f5e3126a8b027a1a54dc6648a968130bfb3220406c9` | byte-identical |

The carved enum blob contains UNSPECIFIED=0 plus exactly the four reviewed
completed steps (MANAGER_WELCOME=1, USAGE_MODE=2,
AGENT_CONFIGURATION=3, ADD_WORKSPACE=4) and no further values; the
message field remains `completed_steps`, repeated enum field 1;
`post_onboarding` remains message field 1. The transported projection
has no schema delta across the 1.5.2 to 1.5.3 vendor update. A second,
structurally different 77-byte `post_onboarding` field description exists
elsewhere in the file and is not the reviewed projection; the
byte-identical match above is with the reviewed 1.5.2 blob.

The real native `agy models` catalogue (names-only probe) still lists
`gemini-3.8-flash-low`, so the unchanged bench model pin stays valid.

## Registration

`AGY_ONBOARDING_REVIEW` in scripts/xcli-seat-onboarding.mjs now carries
the 1.5.3 tuple (version, exact binary bytes, SHA-256, four steps).
Capture and preflight independently reject any other binary hash before
credential access. Version 1.5.2 retires with this move: a fresh load
registers only the current candidate, so 1.5.2 joins unknown versions in
refusal (`onboarding-shape-unverified`), while the published 1.4.12
steps remain available for legacy materialization tests. The session
`--settings` exact three-rule grant, the `--model gemini-3.8-flash-low`
bench policy evidence and the CLI completion-cache sidecar replay all
read the tuple dynamically and carry over unchanged.

Regression evidence (private run root, removed after each step):
tuple flip RED 4/26 in xcli-r32-agy-153-red.log — the four reviewed-schema,
binary-refusal, colon-syntax and materialization tests refuse the retired
registration — then GREEN 35/35 there with the literal bump, including the
new retired-1.5.2 and never-registered-9.9.9 negatives. Live GREEN
requires the next full matrix pass to re-measure the Agy pairs on 1.5.3
with the unchanged 10000 ms bound, signed wake, separation and wipe
proofs; no measured credit is claimed from the unit tests.
