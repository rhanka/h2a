export interface RenderMcpConfigOptions {
  /** Override the executable. Defaults to `"h2a"` (resolved through `PATH`). */
  command?: string;
  /** Override the args prefix. Defaults to `["mcp-serve"]`. */
  args?: readonly string[];
  /** When set, appends `["--root", root]` to the args. */
  root?: string;
}

export interface McpHostConfigSnippet {
  /** JSON snippet to merge into the host's MCP config file. */
  config: {
    mcpServers: {
      h2a: {
        command: string;
        args: string[];
      };
    };
  };
  path: {
    /** Human-readable description of where to put the snippet. */
    hint: string;
    /** A concrete example path (the most common location). */
    example: string;
  };
}

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
 * Renders the JSON snippet a user must add to their Codex CLI MCP config
 * to expose the `h2a mcp-serve` JSON-RPC 2.0 server as an MCP backend.
 *
 * Path hint covers the two locations the Codex CLI is known to read,
 * depending on the version: `~/.codex/config.json` (legacy) and
 * `~/.config/codex/mcp.json` (XDG layout).
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
        "Codex CLI reads its MCP config from either ~/.codex/config.json " +
        "(legacy) or ~/.config/codex/mcp.json (XDG). Merge the snippet under " +
        "the top-level `mcpServers` key in whichever file your Codex CLI uses.",
      example: "~/.config/codex/mcp.json"
    }
  };
}

/**
 * Wave of host enablement (DEC-028 / DEC-037).
 *
 * - `1` — first-class host in V1: descriptor + `host setup --print|--write`
 *   snippet shipped; `mcp/stdio` + `mcp/local-in-process` both wired.
 * - `2` — descriptor-only host, deferred to a later wave (no setup snippet,
 *   no end-to-end flow yet).
 */
export type H2AHostWave = 1 | 2;

/**
 * Common shape declared by every host descriptor. Used by
 * `H2A_CLI_HOSTS` consumers and by the `h2a host status` verb (DEC-037).
 *
 * `renderMcpConfig` is optional because wave-2 hosts (e.g. Gemini) ship
 * the descriptor only; once they reach wave 1 they must declare a
 * snippet renderer.
 */
export interface H2AHostDescriptor {
  readonly packageName: string;
  readonly corePackageName: string;
  readonly host: string;
  readonly protocol: string;
  readonly wave: H2AHostWave;
  readonly hostScenarioShipped?: boolean;
  readonly renderMcpConfig?: (
    options?: RenderMcpConfigOptions
  ) => McpHostConfigSnippet;
}

export interface H2AConfigurableHostDescriptor extends H2AHostDescriptor {
  readonly renderMcpConfig: (
    options?: RenderMcpConfigOptions
  ) => McpHostConfigSnippet;
}

export const H2A_CODEX_HOST: H2AConfigurableHostDescriptor = {
  packageName: "@sentropic/h2a",
  corePackageName: "@sentropic/h2a",
  host: "codex",
  protocol: "sentropic.h2a",
  wave: 1,
  hostScenarioShipped: true,
  renderMcpConfig
} as const;
