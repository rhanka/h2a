import { homedir } from "node:os";
import { join } from "node:path";

export type ConfigurableHost = "claude" | "codex";

const HOST_ROOT_ENVIRONMENT: Record<ConfigurableHost, string> = {
  claude: "CLAUDE_CONFIG_DIR",
  codex: "CODEX_HOME"
};

/**
 * Resolve the configuration root a native host command will use.
 *
 * The optional home is a fallback for tests and callers that intentionally
 * inspect another home. Explicit host roots still win, just as they do for
 * the native Claude and Codex commands.
 */
export function resolveHostConfigRoot(host: ConfigurableHost, home: string = homedir()): string {
  const configured = process.env[HOST_ROOT_ENVIRONMENT[host]];
  return configured && configured.length > 0 ? configured : join(home, `.${host}`);
}
