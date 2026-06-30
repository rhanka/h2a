import type {
  H2AConfigurableHostDescriptor,
  McpHostConfigSnippet,
  RenderMcpConfigOptions
} from "./codex.js";

function buildArgs(
  baseArgs: readonly string[],
  root: string | undefined
): string[] {
  const out = [...baseArgs];
  if (root) {
    out.push("--root", root);
  }
  return out;
}

/**
 * Renders the JSON snippet a user must add to their Claude Code MCP config
 * to expose the `h2a mcp-serve` JSON-RPC 2.0 server as an MCP backend.
 *
 * Claude Code reads MCP servers from either `~/.config/claude/mcp.json`
 * (user-global) or a project-local `.mcp.json` at the workspace root.
 * Both are documented in the path hint.
 */
export function renderMcpConfig(
  options: RenderMcpConfigOptions = {}
): McpHostConfigSnippet {
  const command = options.command ?? "h2a";
  const baseArgs = options.args ?? ["mcp-serve"];
  return {
    config: {
      mcpServers: {
        h2a: {
          command,
          args: buildArgs(baseArgs, options.root)
        }
      }
    },
    path: {
      hint:
        "Claude Code reads its MCP config from either ~/.config/claude/mcp.json " +
        "(user-global) or a project-local .mcp.json at the workspace root. " +
        "Merge the snippet under the top-level `mcpServers` key in whichever " +
        "file your setup uses.",
      example: "~/.config/claude/mcp.json"
    }
  };
}

export const H2A_CLAUDE_HOST: H2AConfigurableHostDescriptor = {
  packageName: "@sentropic/h2a",
  corePackageName: "@sentropic/h2a",
  host: "claude",
  protocol: "sentropic.h2a",
  wave: 1,
  hostScenarioShipped: true,
  renderMcpConfig
} as const;
