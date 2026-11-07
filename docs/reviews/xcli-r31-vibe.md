# Vibe 3.0.3 native waiting review

The remaining R31 readiness failures occurred after successful identity
calls, with a drawn composer and an animated active-turn timer. The bench
keeps its real initial-turn and quiet-output checks; it does not normalize
away a busy timer or inject an interrupt.

The owner-authorized Astra co-solver traced Vibe 3.0.3's native `wait`:
`model_wait` is exposed when external input, subagents or background
processes are enabled. External input defaults false; the other two
capabilities default true. Native `wait` keeps the turn active until input
or its deadline, and is not an h2a MCP call. The initial prompt's phrase
“finish your turn and wait” can select that path. The old sanitized UI did
not retain its exact spinner label, so that particular invocation remains
an attribution hypothesis rather than a claimed trace of `wait`.

Private Vibe configuration now sets `enable_subagents = false` and
`enable_background_processes = false` at the TOML root, before server
tables. The receiver prompt explicitly ends the initial turn and prohibits
wait/sleep. The provider, model, readiness barrier and three scoped h2a
permissions remain unchanged.

Source: [native feature predicate](https://github.com/mistralai/mistral-vibe/blob/v3.0.3/harness/core/src/core/features/model_wait.rs#L24),
[tool definition/dispatch assembly](https://github.com/mistralai/mistral-vibe/blob/v3.0.3/harness/core/src/core/tools/resolved/assembly.rs#L39),
and installed `vibe/core/config/vibe_schema.py:952`.

The native Rust CLI was tested against a synthetic loopback HTTP provider
and synthetic MCP server, using the actual bench TOML renderer. Only
offered tool names were retained; no owner auth or real model call was
used. Each native process subtree was supervised and recovered; the
private oracle directory was removed.

| Native configuration | Offered `wait` | Native exit |
|---|---|---:|
| Both capabilities enabled (baseline) | yes | 0 |
| Bench: both disabled | no | 0 |
| Re-enable only subagents | yes | 0 |
| Re-enable only background processes | yes | 0 |

The scoped TOML regression is RED before and GREEN after (8/8 in the full
proof-path file, zero skips). Commands, oracle source and output are in
the conductor's `xcli-r31-vibe-wait-*` evidence. This proves native parsing
and removal of the waiting tool; the next full real matrix separately
qualifies messaging latency, signed inputs and cleanup.
