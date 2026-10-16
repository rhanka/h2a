import type {
  H2AConfigurableHostDescriptor,
  McpHostConfigSnippet,
  RenderMcpConfigOptions
} from "./codex.js";
import { renderH2aMcpServer } from "./codex.js";

/**
 * Renders the JSON snippet to expose `h2a mcp-serve` to **muse** (Muse Code,
 * Meta — binary `muse`). Muse reads MCP servers from `mcpServers` in
 * `~/.config/muse/settings.json` (user-global; verified: `muse mcp login`
 * documents "a streamable-HTTP entry under mcpServers in settings.json", and
 * user skills install to `$CONFIG_DIR/skills`). The stdio shape below is the
 * same `h2a mcp-serve` backend as the other hosts; stdio pickup by muse is
 * UNCONFIRMED (only streamable-HTTP is documented) — verify with your muse
 * build, else re-run with `--endpoint remote`.
 */
export function renderMcpConfig(
  options: RenderMcpConfigOptions = {}
): McpHostConfigSnippet {
  return {
    config: {
      schema_version: 1,
      mcpServers: {
        h2a: renderH2aMcpServer(options)
      }
    },
    path: {
      hint:
        "Muse Code reads MCP servers from mcpServers in ~/.config/muse/settings.json " +
        "(user-global). Keep schema_version: 1 at the file root. " +
        "Rendu historique non recommandé — non migré — bootstrap registre attendu. " +
        "Stdio pickup remains unconfirmed: muse documents streamable-HTTP entries there; " +
        "if your muse build refuses the stdio entry, use `--endpoint remote` with an HTTP MCP URL. " +
        "The registry integrator supplies installation and activation.",
      example: "~/.config/muse/settings.json"
    }
  };
}

export const H2A_MUSE_HOST: H2AConfigurableHostDescriptor = {
  packageName: "@sentropic/h2a",
  corePackageName: "@sentropic/h2a",
  host: "muse",
  protocol: "sentropic.h2a",
  wave: 1,
  // The snippet drives the same `h2a mcp-serve` backend as the other hosts.
  hostScenarioShipped: true,
  renderMcpConfig
} as const;
