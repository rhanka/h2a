import type {
  H2AConfigurableHostDescriptor,
  McpHostConfigSnippet,
  RenderMcpConfigOptions
} from "./codex.js";
import { renderH2aMcpServer } from "./codex.js";

/**
 * Renders the JSON snippet a user must add to their Gemini CLI MCP config
 * to expose the `h2a mcp-serve` JSON-RPC 2.0 server as an MCP backend.
 *
 * Gemini CLI reads MCP servers from either `~/.gemini/settings.json`
 * (user-global) or a project-local `.gemini/settings.json` at the workspace
 * root. Both are documented in the path hint.
 */
export function renderMcpConfig(
  options: RenderMcpConfigOptions = {}
): McpHostConfigSnippet {
  return {
    config: {
      mcpServers: {
        h2a: renderH2aMcpServer(options)
      }
    },
    path: {
      hint:
        "Gemini CLI reads its MCP config from either ~/.gemini/settings.json " +
        "(user-global) or a project-local .gemini/settings.json at the " +
        "workspace root. Merge the snippet under the top-level `mcpServers` " +
        "key in whichever file your setup uses.",
      example: "~/.gemini/settings.json"
    }
  };
}

export const H2A_GEMINI_HOST: H2AConfigurableHostDescriptor = {
  packageName: "@sentropic/h2a",
  corePackageName: "@sentropic/h2a",
  host: "gemini",
  protocol: "sentropic.h2a",
  wave: 1,
  hostScenarioShipped: true,
  renderMcpConfig
} as const;
