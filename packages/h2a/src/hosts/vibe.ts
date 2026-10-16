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
 * the h2a session auto-opens on the bus when it comes up.
 *
 * INTERIM DIRECT PATH (owner decision 16/10 "Entree directe maintenant"):
 * `h2a host setup --host vibe --write` installs the same stdio
 * `h2a mcp-serve` backend as the other hosts (server key `h2a`) into
 * `config.toml` through the Node TOML writer (backup, idempotent merge,
 * refusal on unreadable TOML, `mcp_servers = []` replaced without duplicate
 * key, user entries preserved). This overrides spec-astra-v9 section 4 / O7.2
 * (which forbade any Vibe MCP write) for the interim only.
 * Migration trigger: when the R5/R7 cluster-mesh registry bootstrap is ready,
 * remove the direct entry (`h2a host setup --host vibe --remove`) and migrate
 * to the registry path; a restored direct entry stays "voie directe — non migrée".
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
        "vibe (INTERIM DIRECT, décision owner 16/10 — dérogation O7.2) : h2a host setup --host vibe --write installe l’entrée [[mcp_servers]] h2a (stdio h2a mcp-serve, même backend que les autres hôtes) dans $VIBE_HOME/config.toml ; " +
        "migration registre R5/R7 : h2a host setup --host vibe --remove puis bootstrap. " +
        "Voie directe tant qu’elle est observée : voie directe — non migrée.",
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
