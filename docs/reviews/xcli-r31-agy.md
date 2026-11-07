# Agy 1.5.2 onboarding projection review

Reviewed 2026-11-06 with the owner-authorized Astra co-solver
(`codex exec -m gpt-6-astra -c model_reasoning_effort=max`). This is a
schema review; live matrix results are recorded separately.

Baseline: the four completed steps in the published llm-mesh 0.33.0
`AGY_REQUIRED_COMPLETED_STEPS['1.4.12']`. Candidate: Linux x86-64 Agy
1.5.2, 244044176 bytes, SHA-256
`da1751e7658469fa80bf36eda2c60ee61216d8e42b735a184382ba31d1f6b88e`.
The executable is read for hashing and bounded descriptor extraction;
it is never copied into a fixture.

| Embedded protobuf descriptor | Offset / bytes | SHA-256 |
|---|---:|---|
| `State.post_onboarding` | 104802745 / 77 | `ea25e8d8dd2d0234d4523f6e3f1b342c560ddec907250e8d3c12452e139488b1` |
| `PostOnboardingState` | 104793444 / 103 | `e479351811fe1686621bad52f28a1277fadefbb28b8a0a8f3f0c9ba74ea6bf64` |
| `PostOnboardingStepType` | 104803921 / 252 | `b3a87909f9ae41e884179f5e3126a8b027a1a54dc6648a968130bfb3220406c9` |

The transported projection has no schema delta: `post_onboarding` is
message field 1; its sole field is repeated enum `completed_steps`, field
1. The enum has UNSPECIFIED=0 and the same four reviewed completed steps
(MANAGER_WELCOME=1, USAGE_MODE=2, AGENT_CONFIGURATION=3, ADD_WORKSPACE=4).
UNSPECIFIED is never completion evidence. This comparison covers the
transported projection, not every native CLI feature.

The bench facade explicitly registers this exact four-step set for 1.5.2
in the published mutable review table. It re-exports the original capture,
validation and materialization functions; the vendor file/digest remain
unchanged. Capture and preflight independently reject a different binary
hash. Native version 1.5.2 is retained throughout the envelope and cell.
Unknown versions, missing/extra/duplicate steps and version mismatches
remain refused. Fresh-process FD validation and both materialization
stages are covered by synthetic regression controls.

The actual native source also exposed a textproto spelling difference:
`post_onboarding: { ... }` (and colons before other message blocks). The
published subset parser accepts `post_onboarding { ... }`. The capture
adapter normalizes only optional message colons outside quoted strings
and comments, in bounded memory. The published canonicalizer then checks
the exact consent set and drops identifiers/migrations; only its canonical
four-step result is staged privately for the original capture function.
The original source is untouched. Size, symlink, duplicate-block, missing
step and quoted/commented fake-consent controls remain closed. Actual
custodian capture is RED (absent) then GREEN (present/open gate).

The live launch path also incorrectly treated every library cell as an
MCP-composed cell. Stage 2 composes MCP for Claude/Codex; Agy/Muse receive
only their separate consent/trust files. Their product MCP configuration
is now rendered after onboarding. The launch regression independently
observes the native Agy MCP path and reproduces missing config before the
fix, with consent present in both cases. Its inspector exits before any
model and cannot earn measured matrix credit.

Codex plugin/app downloads are disabled only in bench launch arguments,
using the documented feature flags and a native config oracle:
https://developers.openai.com/codex/config-reference/ .
