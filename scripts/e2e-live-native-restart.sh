#!/usr/bin/env bash
# Live, billable cross-CLI harness for PR #231.
#
# This file also acts as the temporary h2a/claude/codex PATH shim when invoked
# through a symlink created by the harness. No credential is copied into the
# run directory or printed by this script.

set -euo pipefail

shim_name="$(basename "$0")"
case "$shim_name" in
  h2a)
    exec node "${H2A_E2E_H2A_BIN:?H2A_E2E_H2A_BIN is required}" "$@"
    ;;
  claude)
    mcp_json="{\"mcpServers\":{\"h2a\":{\"command\":\"h2a\",\"args\":[\"mcp-central-connect\",\"--endpoint\",\"${H2A_MCP_CENTRAL_ENDPOINT:?H2A_MCP_CENTRAL_ENDPOINT is required}\"]}}}"
    exec "${H2A_E2E_REAL_CLAUDE:?H2A_E2E_REAL_CLAUDE is required}" \
      --mcp-config "$mcp_json" --strict-mcp-config \
      --permission-mode acceptEdits "$@"
    ;;
  codex)
    central_args="[\"mcp-central-connect\", \"--endpoint\", \"${H2A_MCP_CENTRAL_ENDPOINT:?H2A_MCP_CENTRAL_ENDPOINT is required}\"]"
    exec "${H2A_E2E_REAL_CODEX:?H2A_E2E_REAL_CODEX is required}" \
      -c 'mcp_servers.h2a.command="h2a"' \
      -c "mcp_servers.h2a.args=$central_args" \
      --ask-for-approval never --sandbox workspace-write "$@"
    ;;
esac

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is missing: $1"
}

wait_for_file() {
  local path="$1"
  local label="$2"
  local waited=0
  while [[ ! -s "$path" && "$waited" -lt "$H2A_E2E_TIMEOUT_SECONDS" ]]; do
    sleep 2
    waited=$((waited + 2))
  done
  [[ -s "$path" ]] || fail "$label was not observed within ${H2A_E2E_TIMEOUT_SECONDS}s; inspect $H2A_E2E_RUN_DIR"
}

wait_for_ping() {
  local waited=0
  while ! curl -fsS "$H2A_E2E_CENTRAL_PING" >/dev/null 2>&1; do
    if ! kill -0 "$central_pid" 2>/dev/null; then
      fail "central MCP exited before readiness; inspect $H2A_E2E_RUN_DIR/central.stderr"
    fi
    [[ "$waited" -lt 30 ]] || fail "central MCP did not become ready within 30s"
    sleep 1
    waited=$((waited + 1))
  done
}

registry_field() {
  local label="$1"
  local field="$2"
  node -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    const label = process.argv[2];
    const field = process.argv[3];
    const body = JSON.parse(fs.readFileSync(path, "utf8"));
    const matches = body.entries.filter((row) =>
      row.kind === "local-native" &&
      (row.id === label || row.label === label || row.tmuxSession === label));
    if (matches.length !== 1 || typeof matches[0][field] !== "string") process.exit(2);
    process.stdout.write(matches[0][field]);
  ' "$H2A_E2E_REGISTRY" "$label" "$field"
}

native_state() {
  local label="$1"
  local terminal_id
  terminal_id="$(registry_field "$label" tmuxSession)"
  node "$H2A_E2E_NATIVE_OP" state --id "$terminal_id"
}

state_field() {
  local state_json="$1"
  local field="$2"
  node -e '
    const value = JSON.parse(process.argv[1]);
    const field = process.argv[2];
    if (value[field] === undefined) process.exit(2);
    process.stdout.write(String(value[field]));
  ' "$state_json" "$field"
}

# Read process environment only to test the presence of a non-secret URL key.
# No environment value, token, API key or auth file is emitted or persisted.
gateway_base_url_present() {
  local pid="$1"
  node -e '
    const fs = require("node:fs");
    const entries = fs.readFileSync(`/proc/${process.argv[1]}/environ`)
      .toString("utf8").split("\\0");
    process.stdout.write(entries.some((entry) => entry.startsWith("ANTHROPIC_BASE_URL=")) ? "yes" : "no");
  ' "$pid"
}

cleanup() {
  set +e
  if [[ -n "${H2A_E2E_H2A:-}" ]]; then
    "$H2A_E2E_H2A" stop e2e-claude --reason live-e2e-cleanup >/dev/null 2>&1
    "$H2A_E2E_H2A" stop e2e-codex --reason live-e2e-cleanup >/dev/null 2>&1
  fi
  if [[ -n "${central_pid:-}" ]] && kill -0 "$central_pid" 2>/dev/null; then
    kill -TERM "$central_pid" 2>/dev/null
    wait "$central_pid" 2>/dev/null
  fi
}

[[ "${H2A_LIVE_E2E:-}" == "1" ]] || fail "set H2A_LIVE_E2E=1 to acknowledge a live, billable Claude/Codex run"

require_command node
require_command curl
require_command claude
require_command codex

script_path="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
repo_root="$(cd "$(dirname "$script_path")/.." && pwd)"
export H2A_E2E_H2A_BIN="${H2A_E2E_H2A_BIN:-$repo_root/packages/h2a/dist/bin.js}"
export H2A_E2E_NATIVE_OP="${H2A_E2E_NATIVE_OP:-$repo_root/packages/h2a-runtime/dist/native-terminal/op.js}"
[[ -f "$H2A_E2E_H2A_BIN" ]] || fail "missing built h2a CLI: run npm ci && npm run build"
[[ -f "$H2A_E2E_NATIVE_OP" ]] || fail "missing built native terminal operation helper"

export H2A_E2E_REAL_CLAUDE="$(command -v claude)"
export H2A_E2E_REAL_CODEX="$(command -v codex)"
export H2A_E2E_TIMEOUT_SECONDS="${H2A_E2E_TIMEOUT_SECONDS:-240}"
export H2A_E2E_RUN_DIR="${H2A_E2E_RUN_DIR:-/tmp/h2a-pr231-live-$(date -u +%Y%m%dT%H%M%SZ)}"
export H2A_E2E_PORT="${H2A_E2E_PORT:-37651}"
export H2A_MCP_CENTRAL=1
export H2A_MCP_CENTRAL_ENDPOINT="http://127.0.0.1:${H2A_E2E_PORT}/mcp"
export H2A_E2E_CENTRAL_PING="http://127.0.0.1:${H2A_E2E_PORT}/_h2a-central/ping"
export REMOTE_CLI_CONFIG_HOME="$H2A_E2E_RUN_DIR/config-home"
export H2A_E2E_WORKSPACE="${H2A_E2E_WORKSPACE:-$H2A_E2E_RUN_DIR/workspace}"
export H2A_E2E_BUS="$H2A_E2E_RUN_DIR/bus"
export H2A_E2E_EVIDENCE="$H2A_E2E_WORKSPACE/.e2e-evidence"
export H2A_E2E_REGISTRY="$REMOTE_CLI_CONFIG_HOME/.config/sentropic/remote-cli/registry.json"

umask 077
mkdir -p "$H2A_E2E_RUN_DIR/bin" "$H2A_E2E_WORKSPACE" "$H2A_E2E_EVIDENCE" "$H2A_E2E_BUS"
ln -s "$script_path" "$H2A_E2E_RUN_DIR/bin/h2a"
ln -s "$script_path" "$H2A_E2E_RUN_DIR/bin/claude"
ln -s "$script_path" "$H2A_E2E_RUN_DIR/bin/codex"
export PATH="$H2A_E2E_RUN_DIR/bin:$PATH"
export H2A_E2E_H2A="$H2A_E2E_RUN_DIR/bin/h2a"

trap cleanup EXIT INT TERM

"$H2A_E2E_H2A" init --root "$H2A_E2E_BUS" >"$H2A_E2E_RUN_DIR/init.stdout" 2>"$H2A_E2E_RUN_DIR/init.stderr"
"$H2A_E2E_H2A" mcp-central-serve --root "$H2A_E2E_BUS" \
  >"$H2A_E2E_RUN_DIR/central.stdout" 2>"$H2A_E2E_RUN_DIR/central.stderr" &
central_pid=$!
wait_for_ping
central_ping_before="$(curl -fsS "$H2A_E2E_CENTRAL_PING")"
printf '%s\n' "$central_ping_before" >"$H2A_E2E_RUN_DIR/central-ping-before.json"

cat <<'PROMPT' | "$H2A_E2E_H2A" run codex "$H2A_E2E_WORKSPACE" \
  --name e2e-codex --no-attach --background --prompt-stdin --no-gw --json \
  >"$H2A_E2E_RUN_DIR/codex-launch.json" 2>"$H2A_E2E_RUN_DIR/codex-launch.stderr"
This is the live PR #231 cross-CLI check. Do not edit anything except files under .e2e-evidence and never inspect or reveal credentials.
Use the h2a MCP tools from the configured server named h2a.
1. Call h2a_session_open with instance "codex:e2e-pr231", host "codex", and interests.scopes ["scope:e2e-pr231"].
2. Write .e2e-evidence/codex-ready.pass containing only "opened".
3. When an inbox notification arrives, call h2a_inbox read for instance "codex:e2e-pr231". Find envelope "env:e2e-pr231-claude-ping" and reply by calling h2a_inbox put for instance "claude:e2e-pr231" with this envelope: protocol "sentropic.h2a", version "0.1", id "env:e2e-pr231-codex-reply", type "event", actor {instance:"codex:e2e-pr231",role:"AGENT",scope:"scope:e2e-pr231"}, body {kind:"e2e.reply",inReplyTo:"env:e2e-pr231-claude-ping",text:"pong from codex"}, createdAt "2026-08-22T12:00:00.000Z". Then write .e2e-evidence/codex-reply.pass containing only the reply envelope id.
4. If a later terminal instruction asks you to relaunch or attach MCP server "h2a", call h2a_discover_sessions, confirm it returns normally, and write .e2e-evidence/codex-mcp-relaunch.pass containing only "h2a_discover_sessions ok".
Remain available for notifications after completing the current step.
PROMPT

wait_for_file "$H2A_E2E_EVIDENCE/codex-ready.pass" "Codex MCP session-open evidence"

cat <<'PROMPT' | "$H2A_E2E_H2A" run claude "$H2A_E2E_WORKSPACE" \
  --name e2e-claude --no-attach --background --prompt-stdin --gw --json \
  >"$H2A_E2E_RUN_DIR/claude-launch.json" 2>"$H2A_E2E_RUN_DIR/claude-launch.stderr"
This is the live PR #231 cross-CLI check. Do not edit anything except files under .e2e-evidence and never inspect or reveal credentials.
Use the h2a MCP tools from the configured server named h2a.
1. Call h2a_session_open with instance "claude:e2e-pr231", host "claude", and interests.scopes ["scope:e2e-pr231"].
2. Call h2a_discover_sessions until "codex:e2e-pr231" is visible.
3. Call h2a_inbox put for instance "codex:e2e-pr231" with this envelope: protocol "sentropic.h2a", version "0.1", id "env:e2e-pr231-claude-ping", type "event", actor {instance:"claude:e2e-pr231",role:"AGENT",scope:"scope:e2e-pr231"}, body {kind:"e2e.ping",to:"codex:e2e-pr231",text:"ping from claude"}, createdAt "2026-08-22T12:00:00.000Z". Write .e2e-evidence/claude-sent.pass containing only the ping envelope id.
4. When the reply notification arrives, call h2a_inbox read for instance "claude:e2e-pr231", confirm envelope "env:e2e-pr231-codex-reply" names the original ping in body.inReplyTo, and write .e2e-evidence/claude-roundtrip.pass containing only the reply envelope id.
Remain available for notifications after completing the current step.
PROMPT

wait_for_file "$H2A_E2E_EVIDENCE/claude-sent.pass" "Claude send evidence"
wait_for_file "$H2A_E2E_EVIDENCE/codex-reply.pass" "Codex reply/wake evidence"
wait_for_file "$H2A_E2E_EVIDENCE/claude-roundtrip.pass" "Claude round-trip evidence"

# Native drive deliberately defers while a CLI has had very recent terminal
# activity. Let the receiver become idle so this scenario measures submission,
# not the separately-tested deferral branch.
sleep 5

codex_state_before_injection="$(native_state e2e-codex)"
printf '%s\n' "$codex_state_before_injection" >"$H2A_E2E_RUN_DIR/codex-state-before-injection.json"
"$H2A_E2E_H2A" restart e2e-codex --relaunch-mcp h2a --json \
  >"$H2A_E2E_RUN_DIR/codex-mcp-injection.json" 2>"$H2A_E2E_RUN_DIR/codex-mcp-injection.stderr"
wait_for_file "$H2A_E2E_EVIDENCE/codex-mcp-relaunch.pass" "Codex MCP relaunch verification"
codex_state_after_injection="$(native_state e2e-codex)"
printf '%s\n' "$codex_state_after_injection" >"$H2A_E2E_RUN_DIR/codex-state-after-injection.json"
[[ "$(state_field "$codex_state_before_injection" incarnation)" == "$(state_field "$codex_state_after_injection" incarnation)" ]] || \
  fail "MCP-only injection unexpectedly restarted the Codex CLI"

claude_state_gateway="$(native_state e2e-claude)"
printf '%s\n' "$claude_state_gateway" >"$H2A_E2E_RUN_DIR/claude-state-gateway.json"
claude_pid_gateway="$(state_field "$claude_state_gateway" pid)"
[[ "$(gateway_base_url_present "$claude_pid_gateway")" == "yes" ]] || fail "Claude gateway launch lacks ANTHROPIC_BASE_URL"

"$H2A_E2E_H2A" restart e2e-claude --gw off --json \
  >"$H2A_E2E_RUN_DIR/claude-restart-gw-off.json" 2>"$H2A_E2E_RUN_DIR/claude-restart-gw-off.stderr"
claude_state_direct="$(native_state e2e-claude)"
printf '%s\n' "$claude_state_direct" >"$H2A_E2E_RUN_DIR/claude-state-direct.json"
[[ "$(state_field "$claude_state_gateway" incarnation)" != "$(state_field "$claude_state_direct" incarnation)" ]] || fail "--gw off did not create a new Claude incarnation"
[[ "$(state_field "$claude_state_gateway" pid)" != "$(state_field "$claude_state_direct" pid)" ]] || fail "--gw off did not create a new Claude PID"
[[ "$(gateway_base_url_present "$(state_field "$claude_state_direct" pid)")" == "no" ]] || fail "--gw off left ANTHROPIC_BASE_URL in the restarted CLI"

"$H2A_E2E_H2A" restart e2e-claude --gw on --json \
  >"$H2A_E2E_RUN_DIR/claude-restart-gw-on.json" 2>"$H2A_E2E_RUN_DIR/claude-restart-gw-on.stderr"
claude_state_gateway_again="$(native_state e2e-claude)"
printf '%s\n' "$claude_state_gateway_again" >"$H2A_E2E_RUN_DIR/claude-state-gateway-again.json"
[[ "$(state_field "$claude_state_direct" incarnation)" != "$(state_field "$claude_state_gateway_again" incarnation)" ]] || fail "--gw on did not create a new Claude incarnation"
[[ "$(state_field "$claude_state_direct" pid)" != "$(state_field "$claude_state_gateway_again" pid)" ]] || fail "--gw on did not create a new Claude PID"
[[ "$(gateway_base_url_present "$(state_field "$claude_state_gateway_again" pid)")" == "yes" ]] || fail "--gw on did not restore ANTHROPIC_BASE_URL"

central_ping_after="$(curl -fsS "$H2A_E2E_CENTRAL_PING")"
printf '%s\n' "$central_ping_after" >"$H2A_E2E_RUN_DIR/central-ping-after.json"
[[ "$central_ping_before" == "$central_ping_after" ]] || fail "central MCP generation changed during the two-session scenario"
kill -0 "$central_pid" 2>/dev/null || fail "the one central MCP process is no longer alive"

printf 'PASS: live Claude/Codex round-trip, wake, MCP injection, gateway restarts, and one central MCP generation\n'
printf 'Evidence: %s\n' "$H2A_E2E_RUN_DIR"
