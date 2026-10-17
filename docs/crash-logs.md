# Crash logs

When h2a sessions crash or wedge, one bounded log per component records why.
All files live under `${XDG_STATE_HOME:-$HOME/.local/state}/h2a/`.

| Component | File | Writer | Contents |
| --- | --- | --- | --- |
| Native host | `native-host.log` (+`.1`) | Native terminal host process (`packages/h2a-runtime/src/native-terminal/process.ts`, journal in `native-terminal/journal.ts`) | Host lifecycle: `start` (version, pid, startTime, generation, socket), `signal`, `stop`, `listenerFailure`, `uncaughtException`/`unhandledRejection`/`startupError`, `exit` (code + cause). Read-only for operators. |
| CLI launcher | `cli.log` (+`.1`) | `native-host.ts` op calls, admission refusals, fenced kill (`native-terminal/op.ts`, `crash-log.ts`) | Refusals with reason (`native-name-collision`, `native-inventory-unknown`, `unknown-host-state`, capability mismatch, stale generation/incarnation), op child exits with observed code and/or signal, `startupError` when the op child never started, session exits on fenced kill (with `signal`). Passive `uncaughtException`/`unhandledRejection` witness inside the runtime dispatch (`main()`, covering the real core-binary path) and the op child. |
| Attach client | `attach.log` (+`.1`) | Remote attach (`attach.ts`) and native attach bridge (`native-terminal/op.ts`) | SSE open failures, reconnect give-up (futile cycles), 404, `terminal.exited` session exits with observed code/signal, controller-changed / takeover / stale-lease / buffer-full refusals, definitive-absence session exits (no code: proven absent, code unknown), `exit` when the event stream would not reopen. |
| MCP server | `mcp-server.log` (+`.1`) | Central MCP launcher (`central-mcp.ts`) | `ambiguous-liveness` and `marker-listener-mismatch` refusals, `startupError` on spawn failure, `exit` on readiness timeout, `childExit` with observed code/signal when the server dies post-readiness while the launcher lives. The raw server output `mcp-central.log` (config dir) is rotated at spawn and its rotation capped at the bound; output written between spawns is unbounded — `h2a logs` shows its tail. The server process itself (`runMcpServe`) has no structured witness: after the launcher exits, only the raw log speaks. |

Every `cli`/`attach`/`mcp-server` row is JSONL with `timestamp`,
`component`, `version`, `pid`, plus `sessionId`/`instanceId` when known and a
structured fatal record: `event` (`refusal`, `childExit`, `sessionExit`,
`startupError`, `exit`, `dropped`, `uncaughtException`, …),
`reason`, `exitCode`/`signal`.
`exitCode` and `signal` are observed values only: a killed child or session is
recorded with its signal and no `exitCode`; a proven-absent session is
recorded with neither. Labels never claim an exit that did not happen:
`reconnect-failed`, `readiness-timeout` and `kill-escalation-failed` are
`exit` records, spawn failures are `startupError`.
Each file is capped at 512 KiB (current + one `.1` rotation, both read by the
viewer; the native host journal uses 1 MiB and its `.1` is read too). Files
are mode `0600`, directories `0700` (a pre-existing group-readable state dir
we own is tightened to `0700`, never another owner's). Appends take one lock
attempt plus one provably-dead (10 s stale AND dead owner PID) orphan reclaim,
then drop instead of blocking; drops are counted and surfaced as a `dropped`
row on the next successful append in the same process.

Show the last incidents:

```sh
h2a logs [-n 50] [--component native-host|cli|attach|mcp-server] [--json]
```

Human lines show what/when/where/why on one line: event, reason, code,
signal, session, pid, generation, plus `detail`/`error` (single-line, bounded
to 300 chars) and — for the MCP server — the raw `mcp-central.log` tail
(shown even with no structured rows; scanned from a bounded 256 KiB window,
never loaded whole). `--json` emits the full rows (detail, stack) from both
current and `.1` files.

Structured rows never carry secrets in the clear: rows are redacted before
serialization (environment secret values, PEM blocks, `Authorization`/`Cookie`
headers in `Name: value`, JSON and `Name=value` forms, `Bearer`/`Basic`
tokens, `access_token`/`refresh_token`/`client_secret`/`auth_token`/
`private_key` and other `token=`/`key=`/`secret=`/`password=`/`passwd=`/
`passphrase=`/`pass=`/`pwd=`/`auth=`/`session=`/`credential=` forms with
dash/underscore crossing, including quoted JSON keys and `--flag value`
forms, `://user@` URLs) and error text is replaced with `[REDACTED]` in the
native host journal. Pattern redaction holds even when the secret is absent
from the writer's environment. The raw `mcp-central.log` dump is verbatim
child stderr and stays unredacted at rest; `h2a logs` redacts it on display.
Covered by `packages/h2a-runtime/src/crash-log.test.ts`,
`packages/h2a-runtime/src/crash-log-drops.test.ts`,
`packages/h2a-runtime/src/logs-command.test.ts` and
`packages/h2a-runtime/src/native-terminal/journal.test.ts`.
