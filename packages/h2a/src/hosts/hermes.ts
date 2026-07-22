import type {
  H2AConfigurableHostDescriptor,
  McpHostConfigSnippet,
  RenderMcpConfigOptions
} from "./codex.js";
import { renderH2aMcpServer } from "./codex.js";

/**
 * Hermes Agent exposes MCP management via `hermes mcp {add,list,test,...}` and
 * stores user configuration under `~/.hermes`. h2a renders the same stdio MCP
 * server shape used by the other hosts; users can either merge the JSON into
 * Hermes' MCP config or register it with `hermes mcp add` where available.
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
        "Hermes Agent manages MCP servers with `hermes mcp` and persists them " +
        "under ~/.hermes. Register this stdio server with `hermes mcp add` or " +
        "merge the snippet into the Hermes MCP config used by your profile.",
      example: "~/.hermes/config.yaml"
    }
  };
}

export const H2A_HERMES_HOST: H2AConfigurableHostDescriptor = {
  packageName: "@sentropic/h2a",
  corePackageName: "@sentropic/h2a",
  host: "hermes",
  protocol: "sentropic.h2a",
  wave: 1,
  hostScenarioShipped: true,
  renderMcpConfig
} as const;
