/**
 * Root keys in Claude's native JSON configuration that installation-doctor can
 * rewrite itself. The owner UAT imports this exact contract before taking its
 * snapshot, so its relevance boundary evolves with doctor rather than with an
 * observation of volatile Claude session state.
 */
export const CLAUDE_NATIVE_MCP_ROOT_KEY = "mcpServers";
export const CLAUDE_NATIVE_REPAIRABLE_ROOT_KEYS = Object.freeze([CLAUDE_NATIVE_MCP_ROOT_KEY]);
