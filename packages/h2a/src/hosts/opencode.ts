import type {
  H2AConfigurableHostDescriptor,
  McpHostConfigSnippet,
  RenderMcpConfigOptions
} from "./codex.js";
import { renderH2aMcpServer } from "./codex.js";

/**
 * OpenCode uses JSON/JSONC project/user configuration and supports plugin/MCP
 * extension points in current distributions. h2a's host setup is deliberately
 * conservative: it renders a plain stdio MCP server entry and leaves the actual
 * merge/enable operation to the host-specific installer or the user.
 */
export function renderMcpConfig(options: RenderMcpConfigOptions = {}): McpHostConfigSnippet {
  return {
    config: {
      mcpServers: {
        h2a: renderH2aMcpServer(options)
      }
    },
    path: {
      hint:
        "OpenCode reads MCP/plugin configuration from its user or project " +
        "opencode config. Merge this under the top-level `mcpServers` key in " +
        "the config file used by your OpenCode installation.",
      example: "~/.config/opencode/opencode.json"
    }
  };
}

export const H2A_OPENCODE_HOST: H2AConfigurableHostDescriptor = {
  packageName: "@sentropic/h2a",
  corePackageName: "@sentropic/h2a",
  host: "opencode",
  protocol: "sentropic.h2a",
  wave: 1,
  hostScenarioShipped: true,
  renderMcpConfig
} as const;
