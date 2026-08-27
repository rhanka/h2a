# h2a run AGY + Codex plugin parity

## Objective

Finish structured `h2a run agy` support in the runtime and expose the same
profile through the packaged Codex `h2a_run` MCP surface. AGY stays direct,
the initial prompt never enters process argv, and existing Claude/Codex launch
contracts remain compatible.

## Base and ownership

- Branch: `fix/h2a-run-agy-plugin`
- Base: `origin/main@d79991ce64330a4f273a4e5049197b83bf22685f`
- H2A runtime owns agent argv, prompt delivery, gateway posture and launch
  results.
- The packaged h2a Codex plugin owns the MCP schema, validator and `h2a-run`
  skill contract.
- `.track/**` remains single-writer and is forbidden in this worktree.

## Scope

- `BRANCH.md`
- `packages/h2a-runtime/src/agent-launch-args.ts`
- `packages/h2a-runtime/src/agent-launch-args.test.ts`
- `packages/h2a-runtime/src/index.ts`
- `packages/h2a/src/runtime/mcp/agent-launch.ts`
- `packages/h2a/src/runtime/mcp/tools.ts`
- `packages/h2a/test/mcp-run.test.js`
- `packages/h2a/skills/h2a-run/SKILL.md`

## Contract

- Structured CLI and MCP launch profiles are `claude|codex|agy`.
- `--agent stp` / `agent: "stp"` is forwarded only for AGY and rejected for
  Claude or Codex.
- `gemini-3.7-flash-high` is forwarded unchanged. AGY effort is limited to
  `low|medium|high`; `xhigh` is rejected.
- AGY is direct-only: CLI `--gw` and MCP `gateway: "required"` are rejected;
  `auto` and `off` must yield `session.gateway: "direct"`.
- AGY run-once maps to `--input-format stream-json --output-format stream-json`.
  The prompt is serialized as one escaped `user` event and supplied
  on stdin and never serialized into argv.
- Interactive AGY does not receive print-mode flags. Structured resume maps
  h2a `-r/--resume` to AGY `--conversation <id>`.
- Help, the packaged `h2a-run` skill, the MCP descriptor and the runtime
  validator describe the same constraints.

## Lots

- [x] Preserve and finish the interrupted runtime/MCP implementation.
- [x] Add focused positive and negative contract tests.
- [x] Align CLI help, MCP schema and the packaged `h2a-run` skill.
- [x] Run scoped tests, typecheck and plugin/skill validators.
- [x] Rebuild `h2a-runtime`, build and pack h2a, then inspect compiled/package
  contents.
- [x] Review the final diff and create one atomic commit.

## Verification gates

- Runtime argv tests cover AGY interactive, run-once and conversation resume,
  plus `xhigh`, unsafe agent and Claude/Codex agent rejection.
- MCP tests cover the descriptor, direct invocation, stdin prompt isolation,
  direct-only result attestation and negative validation.
- Compiled CLI help exposes the AGY profile, `--agent`, AGY effort limit and
  AGY print-mode headless behavior.
- `typecheck`, `validate_plugin.py` and `quick_validate.py` pass.
- `h2a-runtime` is rebuilt before the h2a tarball is produced; compiled AGY
  argv and packaged plugin/skill content are inspected from built artifacts.
- No Gemini/AGY provider process is launched during verification.

## Verification results

- Runtime argv suite: 13/13 passed.
- MCP + packaged-manifest suites: 12/12 passed.
- Monorepo `typecheck`: passed.
- Codex `validate_plugin.py` and skill `quick_validate.py`: passed.
- Real h2a tarball: `sentropic-h2a-0.96.1.tgz`, 893 entries,
  SHA-1 `dce20ae6b2b77503f7d201dddaf767e0647fb303`.
- Compiled CLI negative smokes (`AGY --gw`, AGY `xhigh`, Codex `--agent stp`):
  each refused with exit code 2 before host/provider startup.
