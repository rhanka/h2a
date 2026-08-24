# SPEC EVOL — native session restart and live MCP injection

Status: implementation-ready design for PR #231

## Intent

Add one explicit operator surface for managed native-PTY CLI sessions:

```text
h2a restart <session> [--gw on|off] [--relaunch-mcp <name>] [--json]
h2a restart --all [--gw on|off] [--relaunch-mcp <name>] [--json]
```

The command either recreates the selected CLI with a changed/preserved gateway
posture, or (when `--relaunch-mcp` is the only mutation) keeps the CLI alive and
injects a one-line MCP relaunch/attach instruction through the existing native
`drive` operation. It never materializes a token or credential in argv, output,
registry data, tests, or documentation.

## Decisions

- **D1 — native managed scope.** `restart` selects live, non-job
  `kind:"local-native"` registry rows. A named selector must resolve uniquely;
  `--all` means every live managed native CLI session. Unknown liveness fails the
  whole preflight; stale, positively dead rows are excluded from `--all`. The
  preflight snapshots each selected session's host generation and incarnation.
- **D2 — explicit destructive grammar.** Exactly one of `<session>` and `--all`
  is required. Unlike legacy `relaunch`, `restart` is not a dry-run command: the
  explicit verb plus selector authorizes recreation. No implicit tmux fallback or
  host migration is allowed.
- **D3 — gateway semantics.** `--gw on` maps to the pinned registry posture
  `gateway`; `--gw off` maps to `direct`. Omission preserves the row's current pin
  (or `auto` when unpinned). Gateway preparation produces one immutable in-memory
  launch environment per selected session before any kill; preparing a later
  session cannot overwrite an earlier session's environment. Prepared secrets
  remain in memory only.
- **D4 — injection-only MCP mutation.** With `--relaunch-mcp` and no `--gw`, no
  CLI is killed. The MCP name is limited to 1–64 ASCII characters from
  `[A-Za-z0-9._:-]` and rendered into one bounded instruction submitted through
  the existing native terminal `drive` lease/activity guard. This reuses the
  local PTY operation (`unresolved|deferred|failed|driven`), not the separately
  signed inter-agent `h2a drive` envelope. A deferred/failed drive is reported as
  failure; successful injection is evidence of submission, not proof that the
  MCP became healthy.
- **D5 — combined mutation and companion preservation.** With both options, the
  CLI is restarted first and the MCP instruction is submitted to the recreated
  live session. Restart stops only the selected CLI incarnation: its independent
  native h2a companion sidecar is neither killed nor recreated, so no sidecar
  command or credential-bearing configuration is re-materialized.
- **D6 — deterministic orchestration seam.** Selection and effects live behind a
  dependency-injected runtime function exported by `@sentropic/h2a-runtime`.
  `node:test` covers the exact three acceptance scenarios without launching real
  Claude/Codex processes or reading local credentials.
- **D7 — measured output.** Human output names requested/completed operations.
  `--json` emits a versioned result with session ids, modes, `restarted`, and
  `instructionSubmitted` only; it never claims `mcpRelaunched` or MCP health.
  No gateway endpoint, bearer, prompt history, or environment is included.
- **D8 — fenced owner stop.** Restart does not acquire a second input controller.
  It asks the private same-UID native host to stop exactly the preflighted
  `(generation, incarnation)`. The host compares both atomically, invalidates an
  attached controller only after accepting the fenced stop, and refuses any
  drift. This permits an explicitly requested restart of an attached CLI without
  risking a newly recreated same-name session.
- **D9 — conversation continuity.** A row with `convId` relaunches through the
  profile's verified resume argv. A row without `convId` starts a fresh CLI of
  that profile; the result reports restart only, never conversation continuity.

## Failure and safety invariants

1. Registry ambiguity, unreadability, unknown host liveness, unsupported gateway
   posture, or failed gateway preparation stops before the first kill.
2. Immediately before each destructive act, `stop-if-incarnation` rechecks the
   preflighted host generation and session incarnation inside the host. Drift
   refuses that act and stops the remaining sequence.
3. Effects are sequential after preflight. A post-kill launch error is named and
   exits non-zero; the command never reports a restart it did not observe.
4. MCP `driven` means the terminal host accepted and submitted the one line. The
   live E2E must independently measure MCP availability after the agent handles
   that instruction.
5. `--all` never captures tmux, remote, ended, or delegated-job rows by accident.

## Acceptance

- A node test observes a named native session recreated with `gateway -> direct`
  after `--gw off`.
- A node test observes `--relaunch-mcp h2a` drive a live session without invoking
  restart.
- A node test observes `--all` recreate two live native sessions with different
  per-row gateway modes while excluding dead, tmux, and delegated-job distractors.
- A non-live cross-CLI script and `E2E-PLAN.md` specify exact live Claude/Codex
  commands and evidence for wake, bilateral messaging, gateway restart, MCP
  injection, and two clients sharing one central MCP server.
- The acceptance test is a `*.test.js` file under `packages/h2a/test`, the
  `node:test` tree actually discovered by `scripts/run-tests.mjs`; verification
  includes the focused command and the root `npm test` gate after the build.
