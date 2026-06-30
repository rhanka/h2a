import type {
  H2AConfigurableHostDescriptor,
  McpHostConfigSnippet,
  RenderMcpConfigOptions
} from "./codex.js";

function buildArgs(baseArgs: readonly string[], root: string | undefined): string[] {
  const out = [...baseArgs];
  if (root) {
    out.push("--root", root);
  }
  return out;
}

/**
 * Renders the JSON snippet to expose `h2a mcp-serve` to **agy** (Antigravity,
 * Google — a Gemini-ecosystem agent CLI). Per the capability matrix
 * (`docs/plugin-capability-matrix.md`), agy embeds an MCP runtime and reads
 * servers from a dedicated slot `~/.gemini/config/mcp_config.json` (empty by
 * default), so it integrates exactly like the other three hosts (EVO-0 parity):
 * full MCP, incl. live sessions + push. The `/h2a` skill travels via
 * `agy plugin import` (the claude/gemini plugin path) — separate from this MCP
 * config and handled by install tooling.
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
      hint: "agy reads MCP servers from its embedded runtime's config slot at `~/.gemini/config/mcp_config.json` (Antigravity). Merge this under `mcpServers`.",
      example: "~/.gemini/config/mcp_config.json"
    }
  };
}

export const H2A_AGY_HOST: H2AConfigurableHostDescriptor = {
  packageName: "@sentropic/h2a",
  corePackageName: "@sentropic/h2a",
  host: "agy",
  protocol: "sentropic.h2a",
  wave: 1,
  // host-mcp-scenario test covers agy (DEC-096) — the snippet drives the same
  // `h2a mcp-serve` backend as the other three.
  hostScenarioShipped: true,
  renderMcpConfig
} as const;
