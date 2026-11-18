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

Agy 1.5.2 also reads a distinct CLI completion cache at
`.gemini/antigravity-cli/cache/onboarding.json`. The reviewed native
`ReadOnboardingStatus` code is at ELF offset 162749248, 3040 bytes,
SHA-256 `6acfe617e47097cfa455079b28e47c220fd7126b5ccb6df8ea9aabf70cdee8c4`.
Its three boolean fields are `consumerOnboardingComplete`,
`enterpriseOnboardingComplete` and `onboardingComplete`. Actual bounded,
typed source inspection found exactly those three fields, all true.
Transporting only jetski steps omitted this existing completion evidence
and caused the native Terms of Service & Data Use dialog to reappear.

Local provisioning now captures only this exact completed boolean object
after the published stage 1 succeeds. A private bench sidecar binds it to
the SHA-256 of the complete original seat record (account, scope, version,
lineage and onboarding). After the unchanged published stage 2 succeeds,
the consumer verifies that binding and writes the native cache into the
fresh private HOME. It includes the path in copy/wipe evidence. Missing,
false, malformed, extra-field, oversized or symlinked source evidence is
never replaced by an invented acceptance. A corrupt present sidecar
refuses before launch. No raw settings or identifiers are transported.

The native dialog checkbox calls `SetUserInfo`, which changes account
telemetry outside the private HOME. The bench therefore never presses it,
never changes account telemetry, and never invents an interactive flag.
The native `--disable-telemetry` flag traced by Astra belongs to ACP, not
the interactive CLI under qualification. Regression controls cover native
cache replay through both materialization stages and binding tampering.

The next live pass proved that signed wake delivery worked, but Agy then
asked for authorization before `h2a_inbox`. The bench now supplies native
session-only `--settings` before `--prompt-interactive`, only for the
reviewed version. Its sole settings member is `permissions.allow`, with
the exact rules `mcp(h2a/h2a_identity_status)`, `mcp(h2a/h2a_inbox)` and
`mcp(h2a/h2a_send)`. It adds no wildcard, ask/deny override, blanket mode,
telemetry preference or owner-file write. Other native versions receive
their prior arguments.

The authorized Astra co-solver verified the pinned ELF's
`ParseCLIGrantString` at 0x7c54a40–0x7c54dc0 and `coversMCP` at
0x7c569a0–0x7c56ac0. The matcher splits server/tool and compares the full
names; only `*` broadens a rule. Native metadata confirms
`CliSetting.GlobalPermissions` (`permissions`) and `Permissions.Allow`
(`[]string`, `allow`). These agree with the
[official schema](https://antigravity.google/schemas/v1/settings.json) and
[MCP permission rules](https://antigravity.google/docs/permissions?tab=cli#cli-fine-grained-permissions).
The argument regression proves the exact document, flag order and version
gate. No executed negative native decision test is claimed.

| Live diagnostic | Inbox read after signed wake | Reply | Credit |
|---|---:|---|---|
| Original permission policy | absent | absent | failed |
| Exact session grants, default model | 14010 ms | delivered | failed 10000 ms bound |
| Exact grants, Gemini 3.8 Flash Low | 3245 ms | delivered | individual cell passed; no batch credit |

The real native `agy models` catalogue advertised
`gemini-3.8-flash-low`. Reviewed 1.5.2 bench sessions now select it with
`--model`, and emit `bench-model-policy` evidence. The message-only probe
still uses the actual provider, signed drive, inbox, reply and unchanged
10000 ms read bound. Both diagnostics had kernel-witnessed process
recovery and private wipe. The next full matrix must independently earn
three-repetition separation credit. A preceding diagnostic omitted its
wake windows and was retained as invalid, with no qualification credit.
