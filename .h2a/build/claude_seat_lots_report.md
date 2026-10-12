# Claude Seat Connector Lots 2 and 3 Build Report

## 1. Executive Summary

This report documents the completion of **Lot 2** (Claude Account Enrollment & Renewable Import) and **Lot 3** (Claude Code CLI Runner & Host Composition) within the `h2a` repository.

- **Worktree:** `/home/antoinefa/src/h2a/.worktrees/claude-seat-lots`
- **Branch:** `feat/claude-seat-h2a-lots` (branched from `origin/main` at commit `e3fc1a52`)
- **Scope of Record:** `/home/antoinefa/src/sentropic/.tmp/claude-connector/h2a_lots_brief.md` (SHA `573f99f4a416ba6702125c6ee89955233d8c1d6eeac5d0abc422dc89a9592763`)
- **Updated Spec:** `/home/antoinefa/src/sentropic/.tmp/claude-connector/SPEC_EVOL_LLM_MESH_CLAUDE_SEAT.updated.md`
- **Owner Directive:** « connecteur compte claude: reprend »
- **Operational Status:** Enrollment and unit/contract verification complete. Live execution remains `not-covered` pending upstream mesh pre-acquire seam delivery and owner qualification stages (M0–M7). No real secrets or live Claude credentials were used.

---

## 2. Commit History

| Commit | Summary | Scope |
| --- | --- | --- |
| `ebba8854` | `feat(llm-mesh): add claude-code enrollment and renewable import (lot 2)` | Lot 2 implementation and tests |
| `bb0dcd08` | `feat(runtime): add claude-code cli runner and host composition (lot 3)` | Lot 3 implementation, tests, and CI wiring |

Both commits strictly follow repository commit rules: no AI attribution (`no Co-Authored-By`, `no Claude-Session`, `no Generated with`), conventional commit messages, and selective staging.

---

## 3. Lot 2: Enrollment and Renewable Import Deliverables

Lot 2 delivers full Claude account enrollment and renewable credential import into `h2a-runtime`:

1. **Masked Local Input Boundary (`claude-seat-input.ts`):**
   - Implements `promptMaskedInput()` using raw terminal mode.
   - Rejects non-TTY input streams (e.g. piped input or background stdin) with actionable errors.
   - Guaranteed terminal state restoration on success, timeout, cancellation, or error.
   - Enforces a 64 KiB input cap and 2-minute input timeout.
   - Sanitizes captured strings before return.

2. **Account Management Seam (`llm-mesh-accounts.ts`):**
   - Canonicalizes `claude-code` and alias `claude`.
   - Browser authorization flow (`startClaudeEnrollment` and `completeClaudeEnrollment`).
   - Sessionless renewable import flow via `--credential-import` accepting valid renewable JSON (`oauth_token`, `refresh_token`, `expires_at`).
   - Pre-flight capability checks confirming runtime support for `claude-code`.
   - Validates owner scope in `H2A_LLM_MESH_CONFIG_JSON`.
   - Protects filesystem and keyring paths from error messages (sanitized public output).

3. **CLI Wiring (`packages/h2a-runtime/src/index.ts`):**
   - Exposes `llm-mesh account enroll claude-code [--credential-import]`.
   - Provides clear post-enrollment daemon restart guidance.

4. **Tests:**
   - `packages/h2a-runtime/src/claude-seat-input.test.ts` (11 passing tests).
   - `packages/h2a-runtime/src/llm-mesh-accounts.test.ts` (26 passing tests).
   - `packages/h2a/test/runtime-llm-mesh-account.test.js` (4 passing tests).

---

## 4. Lot 3: CLI Runner, Isolation, Lifecycle, and Host Wiring Deliverables

Lot 3 delivers the official pinned CLI runner, isolated execution boundary, process lifecycle management, and gateway host wiring across all six required test families:

1. **Isolation Engine (`claude-code-cli-isolation.ts`):**
   - Selects dedicated 0700 tmpfs/runtime scratch directory outside shared `/tmp`.
   - Projections write 0600 `~/.claude.json` containing only `{ claudeAiOauth: { accessToken, expiresAt, scopes } }` without refresh token material.
   - Validates candidate binary path, pinned version (`2.1.296`), digest, and executable permissions.
   - Strict environment allowlist preventing leakage of ambient API keys, proxy, OTEL/debug, TLS keylogs, or loader variables (`NODE_OPTIONS`, `LD_PRELOAD`).
   - Default-deny network egress policy enforcing destination allowlist restricted to inference (`api.anthropic.com:443`). Denies OAuth token and discovery endpoints.

2. **Process Lifecycle and Supervisor (`claude-code-cli-lifecycle.ts`):**
   - Account-level in-process and file locks (`account.lock`) held from pre-acquire through reaping and cleanup.
   - 30-second lock acquisition timeout.
   - Reaps entire process group/tree on completion, timeout, cancellation, or error.
   - Startup and pre-execution orphan sandbox sweep (`sweepOrphanSandboxes()`) with boot ID / PID verification, grace period for young sandboxes, and refusal on ambiguous ownership.
   - Never reads credentials during cleanup or sweeps.

3. **CLI Runner Protocol (`claude-code-cli-runner.ts`):**
   - Spawns unmodified official CLI with `--print --output-format stream-json --dangerously-skip-permissions`.
   - NDJSON streaming parser (`protocol: 'claude-code-stream-json-v1'`).
   - Translates `text_delta` chunks and produces exactly one terminal `result` with token usage.
   - Guaranteed deduplication of frames, strict validation against truncated or oversized messages, and zero leakage of stderr/canaries to caller.

4. **Host Wiring & Pre-Acquire Integration Seam (`gateway-host/host.ts`, `gateway-host/claude-code-seat-attempt.ts`):**
   - Integrated into `createGatewayHost` via `LocalGatewayAppOptions.claudeClient` and `AnthropicAdapter`.
   - Invokes startup orphan sandbox sweep during gateway readiness.
   - Provides structured handoff descriptor `getClaudeSeatSeamDependencyHandoff()`.

5. **Six Test Families:**
   - **Protocol:** `packages/h2a-runtime/src/claude-code-cli-runner.test.ts` (5 tests)
   - **Isolation:** `packages/h2a-runtime/src/claude-code-cli-isolation.test.ts` (4 tests)
   - **Lifecycle:** `packages/h2a-runtime/src/claude-code-cli-lifecycle.test.ts` (5 tests)
   - **Tools:** `packages/h2a-runtime/src/claude-code-cli-tools.test.ts` (2 tests)
   - **No Child Refresh:** `packages/h2a-runtime/src/claude-code-cli-refresh-probe.test.ts` (6 tests)
   - **Wiring:** `packages/h2a-runtime/src/gateway-host/claude-code-seat-wiring.test.ts` (6 tests)

---

## 5. Gate 3A: Pre-Acquire Lease Integration Stop Condition

In accordance with Section 3A and Section 7 of `h2a_lots_brief.md`:

- **Finding:** `@sentropic/llm-mesh 0.25.0` instantiates its internal account route directory directly inside `facade.createRoutePlanner` (`directory: service.createRouteDirectory(runtime)`) and does not expose a pre-acquire lease hook or custom directory option on `LlmMeshFacade`.
- **Enforced Policy:** Gateway serving enablement for live Claude seats is intentionally halted. No workaround bypassing mesh private storage or using post-acquire locks was introduced.
- **Handoff Contract:** The requirement is packaged as an additive specification in `claude-code-seat-attempt.ts` (`getClaudeSeatSeamDependencyHandoff()`) for the `@sentropic/llm-mesh` maintainer. Unit and fake composition suites prove full compatibility once the seam is delivered.

---

## 6. Verification and Test Receipts

### 6.1 Focused CI Consumer Suite

Executed via `npx --no-install vitest run`:
- `packages/h2a-runtime/src/llm-mesh-accounts.test.ts`
- `packages/h2a-runtime/src/claude-seat-input.test.ts`
- `packages/h2a-runtime/src/claude-code-cli-runner.test.ts`
- `packages/h2a-runtime/src/claude-code-cli-isolation.test.ts`
- `packages/h2a-runtime/src/claude-code-cli-lifecycle.test.ts`
- `packages/h2a-runtime/src/claude-code-cli-tools.test.ts`
- `packages/h2a-runtime/src/claude-code-cli-refresh-probe.test.ts`
- `packages/h2a-runtime/src/gateway-host/claude-code-seat-wiring.test.ts`
- `packages/h2a-runtime/src/gateway-host/daemon.test.ts`
- `packages/h2a-runtime/src/gateway-host/daemon-lifecycle.test.ts`
- `packages/h2a-runtime/src/gateway-host/config-file.test.ts`
- `packages/h2a-runtime/src/gateway-host/sessions.test.ts`
- `packages/h2a-runtime/src/llm-mesh-resolution.test.ts`
- `packages/h2a-runtime/src/routing-preferences.test.ts`
- `packages/h2a-runtime/src/gateway-host/native-tools.test.ts`
- `packages/h2a-runtime/src/gateway-host/host.test.ts`

**Result:** **16 test files passed, 100 tests passed, 0 failures.**

### 6.2 Node Regression Tests

Executed via `node --test`:
- `packages/h2a/test/runtime-llm-mesh-account.test.js`
- `packages/h2a/test/gateway-host-build.test.js`
- `packages/h2a/test/gateway-host-contract.test.js`
- `packages/h2a/test/gateway-host-docs.test.js`
- `packages/h2a/test/native-spawn-guard.test.js`

**Result:** **16 tests passed, 0 failures.**

### 6.3 Public Contract & Build

- `bash scripts/check-public-contract.sh`: **PASS** (60 MCP tools, 100 CLI verbs, leaf anti-cycle intact).
- `npm run typecheck`: **PASS** (0 errors).
- `npm run build`: **PASS** (Track and h2a-runtime clean build completed).

### 6.4 Diagnosis of Monorepo Root `npm test` Behavior

When running the monorepo root `npm test` on a developer workstation that has existing active sessions in `~/.config/sentropic/h2a/registry.json`, `loop-tick-cli.test.js` fails under `native-isolation.js`.
- **Root Cause:** `scripts/run-tests.mjs` sets `H2A_ROOT` and `TMPDIR` in its fixture environment, but does not isolate `REMOTE_CLI_CONFIG_HOME`. Consequently, `h2a loop tick` / `h2a loop watch` reads the developer's real registry from `/home/antoinefa/.config/sentropic/h2a/registry.json`, discovers registered native sessions, and attempts to probe liveness via `op.js probe`. The `native-isolation.js` guard detects and refuses access to owner paths outside the test root.
- **CI Parity:** In clean CI environments (such as GitHub Actions runners), `~/.config/sentropic/h2a/registry.json` does not exist, so `npm test` runs green.

---

## 7. Next Steps & Live Qualification Handoff

Live qualification stages (M0–M7) require physical owner interaction:
1. **M0–M1:** Candidate binary verification, digests, and negative serving controls.
2. **M2:** Owner-only browser login via Chrome/CDP port 9222 with h-cond monitoring.
3. **M3:** Single text request/stream through official runner with zero fallback.
4. **M4:** Owner-only renewable credential import.
5. **M5:** Refresh under concurrent acquisition and zero child refresh verification.
6. **M6:** Custody lane verification.
7. **M7:** Per-device provider revocation.

No real enrollment, secret collection, or live API calls were performed during this build.
