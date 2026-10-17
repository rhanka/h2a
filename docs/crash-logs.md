# Crash logs

When h2a sessions crash or wedge, one bounded log per component records why.
All files live under `${XDG_STATE_HOME:-$HOME/.local/state}/h2a/`.

| Component | File | Writer | Contents |
| --- | --- | --- | --- |
| Native host | `native-host.log` (+`.1`) | Native terminal host process (`packages/h2a-runtime/src/native-terminal/process.ts`, journal in `native-terminal/journal.ts`) | Host lifecycle: `start` (version, pid, startTime, generation, socket), `signal`, `stop`, `listenerFailure`, `uncaughtException`/`unhandledRejection`/`startupError`, `exit` (code + cause). Read-only for operators. |
| CLI launcher | `cli.log` (+`.1`) | `native-host.ts` op calls, admission refusals, fenced kill (`native-terminal/op.ts`, `crash-log.ts`) | Refusals with reason (`native-name-collision`, `native-inventory-unknown`, `unknown-host-state`, capability mismatch, stale generation/incarnation), op child exits with code, session exits on fenced kill. |
| Attach client | `attach.log` (+`.1`) | Remote attach (`attach.ts`) and native attach bridge (`native-terminal/op.ts`) | SSE open failures, reconnect give-up (futile cycles), 404/reconnect-failed, `terminal.exited` session exits with code, controller-changed / takeover / stale-lease / buffer-full refusals, definitive-absence session exits. |
| MCP server | `mcp-server.log` (+`.1`) | Central MCP launcher (`central-mcp.ts`) | `ambiguous-liveness` and `marker-listener-mismatch` refusals, `spawn-failed` child exits, `readiness-timeout`. The raw server output `mcp-central.log` (config dir) is rotated at the same bound. |

Every `cli`/`attach`/`mcp-server` row is JSONL with `timestamp`,
`component`, `version`, `pid`, plus `sessionId`/`instanceId` when known and a
structured fatal record: `event` (`refusal`, `childExit`, `sessionExit`,
`uncaughtException`, `startupError`, …), `reason`, `exitCode`/`signal`.
Each file is capped at 512 KiB (current + one `.1` rotation; the native host
journal uses 1 MiB). Files are mode `0600`, directories `0700`, appends take
one lock attempt and drop (never block) under contention.

Show the last incidents:

```sh
h2a logs [-n 50] [--component native-host|cli|attach|mcp-server] [--json]
```

No secret is ever logged: rows are redacted before serialization (environment
secret values, `Authorization`/`Cookie` headers, `Bearer`/`Basic` tokens,
`token=`/`key=`/`secret=`/`password=` patterns, `://user@` URLs) and error
text is replaced with `[REDACTED]` in the native host journal. Covered by
`packages/h2a-runtime/src/crash-log.test.ts` and
`packages/h2a-runtime/src/native-terminal/journal.test.ts`.
