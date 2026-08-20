# UAT — llm-mesh account cutover

Date: 2026-08-20

Candidate commit: `6b33b4ed`

## Runtime tests

| Scenario | Isolation | Result |
|---|---|---|
| Codex direct | Candidate runtime, `OPENAI_API_KEY`, `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` absent; native PTY, headless | PASS — exit 0, exact response `UAT_CODEX_NATIVE_OK`, runtime reported `gateway: direct` |
| Claude direct | Candidate runtime, `CLAUDE_CONFIG_DIR` and all Anthropic API/gateway variables absent; native PTY, headless | AUTH PATH PASS / PROVIDER QUOTA — Claude reached the native account and returned its known weekly-limit message; no gateway was injected |
| Claude through llm-mesh | Candidate runtime, inherited Claude/API/gateway variables absent; explicit `--gw`; native PTY, headless | PASS — opaque gateway env injected from `http://localhost:3002`, exit 0, exact response `UAT_CLAUDE_GATEWAY_CODEX_OK` through the active enrolled Codex account |
| Explicit gateway unavailable | Hermetic runtime integration test | PASS — exit 1 and no agent spawn |

The direct Codex and gateway tests used a one-line exact-marker prompt. No
credential was supplied on argv or recorded in this evidence.

## Packed candidate smoke

All four lockstep workspaces were packed and installed together under an
isolated prefix from the candidate build:

- `@sentropic/track@0.93.5`
- `@sentropic/h2a-runtime@0.93.5`
- `@sentropic/h2a@0.93.5`
- `@sentropic/h2a-cli@0.93.5`

The installed candidate proved:

- `h2a llm-mesh account enroll --help` exposes `cloud-code` and `codex`;
- `h2a account ls` exits 1 as an unknown command;
- `h2a llm-mesh enroll codex` exits 1 as an unknown command;
- `h2a delegate --help` contains no `--account` option;
- `h2a doctor` reports all five retained legacy account-pool paths as inert,
  by existence only, and recommends manual backup/verification/removal.

The candidate remains `0.93.5` intentionally. Version `0.94.0` is prepared
only from merged `main`, then publication is triggered by the tag in GitHub
Actions.
