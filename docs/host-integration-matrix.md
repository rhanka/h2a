# h2a host integration matrix

This is the tracked source of truth for the host integration objective loop
`loop:host-plugin-matrix-2026-07-08`.

Status vocabulary:

- **shipped**: implemented in this repository and covered by an automated test.
- **rendered**: h2a renders the host-specific config/scaffold, but the host still
  requires a user trust/import step.
- **probe-required**: descriptor exists, but a live host binary/import path still
  needs a real end-to-end probe before claiming full support.

| Host | MCP setup h2a | Tools loop published | Native skill/plugin | Real plugin test |
|---|---|---|---|---|
| Claude | shipped (`h2a host setup --host claude`) | shipped (`h2a_loop_*` MCP tools in npm package) | shipped (`install-skills --host claude`, `host plugin --host claude --write`) | partial automated render/merge tests; live host E2E pending |
| Codex | shipped (`h2a host setup --host codex`) | shipped (`h2a_loop_*` MCP tools in npm package) | shipped/rendered (`install-skills --host codex`, `host plugin --host codex --scaffold` local marketplace + trust commands) | automated scaffold/manifest/hooks tests; live `codex plugin add` E2E coordinated with codex:h2a |
| Gemini | shipped (`h2a host setup --host gemini`) | shipped (`h2a_loop_*` MCP tools in npm package) | shipped/rendered (`install-skills --host gemini`, `host plugin --host gemini --write`) | automated render/merge tests; live host E2E pending |
| agy | shipped/rendered (`h2a host setup --host agy`) | shipped if agy loads MCP config | shipped/rendered via Gemini import (`install-skills --host agy` emits `agy plugin import gemini`); plugin is poll-only | automated render/import-hint tests; live `agy plugin import` E2E pending |
| Hermes | shipped/rendered (`h2a host setup --host hermes`) | shipped if Hermes loads MCP config | shipped/rendered (`install-skills --host hermes`, `host plugin --host hermes`) | automated render tests; live Hermes hook/plugin E2E pending |
| OpenCode | shipped/rendered (`h2a host setup --host opencode`) | shipped if OpenCode loads MCP config | shipped/rendered (`install-skills --host opencode`, `host plugin --host opencode`) | automated render tests; live OpenCode binary/plugin E2E pending |

## Security/policy capability disclosure

For a policy such as blocking manual `h2a` CLI use, this matrix is not enough to
infer parity: see the normative [host operator capability
contract](specs/2026-07-23-host-operator-capability-contract.md) and the
[adapter development guide](host-adapter-development.md). Current status is:

| Policy: forbid manual `h2a` shell invocation | State | Evidence |
|---|---|---|
| Claude Code | enforced | packaged `PreToolUse(Bash)` guard + policy corpus tests |
| Codex | gap | marketplace lifecycle hooks do not evidence pre-shell interception |
| Hermes | gap | MCP/skill integration is not a pre-shell guard |
| OpenCode | gap | MCP/skill integration is not a pre-shell guard |

## Publication gate

Do not mark this loop done until:

1. every row has automated tests for MCP setup, loop-tool publication visibility,
   skill/plugin rendering, and plugin scaffold/hook rendering;
2. Codex native plugin work is reconciled with the codex:h2a branch/PR;
3. live host E2E gaps are either passed or explicitly documented as waived by the
   owner for this release;
4. the package version is bumped, packed, smoke-tested, and published.
