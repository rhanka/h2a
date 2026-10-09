import type {
  H2AConfigurableHostDescriptor,
  McpHostConfigSnippet,
  RenderMcpConfigOptions
} from "./codex.js";
import { renderH2aMcpServer } from "./codex.js";

/**
 * Renders the MCP snippet to expose `h2a mcp-serve` to **vibe** (Mistral Vibe
 * CLI — binary `vibe`). Verified against the shipped CLI (v2.26.0, unified
 * harness) in a live session: MCP servers are configured as `[[mcp_servers]]`
 * TOML array-of-tables entries in `~/.vibe/config.toml` (or `$VIBE_HOME/
 * config.toml`), spawned lazily around the first successful model turn; a
 * stdio server defined there is listed as "N MCP servers" at session open and
 * the h2a session auto-opens on the bus when it comes up. `host setup --write`
 * therefore refuses TOML targets (the JSON merger is format-strict): --print
 * carries the TOML translation in the hint.
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
        "vibe reads MCP servers from the `[[mcp_servers]]` TOML array of tables " +
        "in `~/.vibe/config.toml` (or `$VIBE_HOME/config.toml`). Translate the " +
        "snippet above to: [[mcp_servers]] / name = \"h2a\" / transport = \"stdio\" / " +
        "command = <command> / args = [<args>].",
      example: "~/.vibe/config.toml"
    }
  };
}

export const H2A_VIBE_HOST: H2AConfigurableHostDescriptor = {
  packageName: "@sentropic/h2a",
  corePackageName: "@sentropic/h2a",
  host: "vibe",
  protocol: "sentropic.h2a",
  wave: 1,
  // hosts-integration.test.js covers the vibe rendering scenario (same
  // `h2a mcp-serve` stdio backend as the other wave-1 hosts).
  hostScenarioShipped: true,
  renderMcpConfig
} as const;
