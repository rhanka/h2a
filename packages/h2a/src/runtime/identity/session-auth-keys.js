/**
 * Pure JavaScript leaf copy of the session-identity scrub list for `.js`
 * source-mode runtime helpers (`handover/launch.js`) so tests importing `.js`
 * sources directly do not try to resolve uncompiled `session-auth.ts`.
 * Parity with `packages/h2a/src/runtime/identity/session-auth.ts` is enforced
 * by `packages/h2a/test/cli-command-map.test.js`.
 */

export const SESSION_IDENTITY_SCRUB_KEYS = [
  "H2A_SESSION_REF",
  "H2A_SESSION_PROOF_PATH",
  "H2A_SESSION_CLASS",
  "H2A_SESSION_TOKEN",
  "H2A_NATIVE_PTY_SESSION",
  "H2A_NATIVE_TERMINAL",
  "H2A_NATIVE_FOREGROUND_ROLE",
  "H2A_INSTANCE",
  "H2A_AGENT_SESSION_ID",
  "H2A_SCOPE_SESSION",
  "H2A_JOB_ID",
  "REMOTE_JOB_ID",
  "SESSION_ID",
  "SESSION_WORKSPACE_ID",
  "H2A_RUN_LAUNCH_ID",
  "H2A_RUN_LAUNCH_TOKEN",
  "H2A_MCP_READY_FILE",
  "H2A_MCP_READY_NONCE",
  "H2A_NATIVE_TARGET_SESSION",
  "H2A_HEADLESS_TARGET",
  "H2A_CORE_ENTRY",
  "H2A_DIRECT_ROUTING_SCRUB",
  "H2A_STATION_WINDOW",
  "H2A_OPERATOR_BREAK_HOP",
  "H2A_UPGRADE_REEXECED",
  "H2A_ATTACH_RESET_RECEIPT",
  "H2A_CLIENT_RECOVERY_GUARD_ACTIVE",
  "H2A_SUBPROCESS_ATTACH_MOD",
  "H2A_SUBPROCESS_ATTACH_BASE",
  "H2A_SUBPROCESS_ATTACH_ID",
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_CHILD_NOTES_DIR",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_BRIDGE_SESSION_ID",
  "CLAUDE_CODE_LAUNCHED_BY_SESSION_IDS",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_PID",
  "CLAUDE_PLUGIN_DATA",
  "CLAUDE_EFFORT",
  "CLAUDE_PROJECT_DIR",
  "AI_AGENT",
  "CODEX_THREAD_ID",
  "CODEX_COMPANION_SESSION_ID",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
  "CODEX_WORKSPACE_ROOT",
];

const SESSION_IDENTITY_SCRUB_KEY_SET = new Set(SESSION_IDENTITY_SCRUB_KEYS);

/**
 * Scrub only `SESSION_IDENTITY_SCRUB_KEYS` (minus optional `exclude`) from a
 * copied inherited environment. Always apply BEFORE setting per-call child vars.
 * @param {Readonly<Record<string, string | undefined>>} [env]
 * @param {{ readonly exclude?: ReadonlySet<string> | undefined }} [options]
 * @returns {Record<string, string>}
 */
export function scrubSessionIdentityEnv(env = process.env, options = {}) {
  const cleaned = {};
  const exclude = options.exclude;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (SESSION_IDENTITY_SCRUB_KEY_SET.has(key) && !exclude?.has(key)) continue;
    cleaned[key] = value;
  }
  return cleaned;
}
