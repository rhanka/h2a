import {
  centralMcpClientEndpoint,
  type CentralMcpPathsOptions
} from "../runtime/mcp-central.js";

export interface RenderMcpConfigOptions {
  /**
   * The one active h2a endpoint for this host. Local is a stdio child process;
   * remote is an HTTP MCP URL. A host config must never contain both forms.
   */
  endpoint?: "local" | "remote";
  /** Override the executable. Defaults to `"h2a"` (resolved through `PATH`). */
  command?: string;
  /** Override the args prefix. Defaults to `["mcp-serve"]`. */
  args?: readonly string[];
  /** When set, appends `["--root", root]` to the args. */
  root?: string;
  /** Required for `endpoint: "remote"`; the host-native HTTP MCP URL. */
  url?: string;
}

export type H2AMcpEndpointConfig =
  | { command: string; args: string[] }
  | { url: string; headers?: Record<string, string> };

function assertHttpMcpUrl(value: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error("remote h2a endpoint requires an absolute http(s) MCP URL");
  }
}

export interface McpHostConfigSnippet {
  /** JSON snippet to merge into the host's MCP config file. */
  config: {
    mcpServers: {
      h2a: H2AMcpEndpointConfig;
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

/** Render exactly one selected h2a endpoint, never a local+remote pair. */
export function renderH2aMcpServer(
  options: RenderMcpConfigOptions = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
  centralPaths: CentralMcpPathsOptions = {}
): H2AMcpEndpointConfig {
  const centralEndpoint = centralMcpClientEndpoint(env, centralPaths);
  if (centralEndpoint) return centralEndpoint;
  const endpoint = options.endpoint ?? "local";
  if (endpoint !== "local" && endpoint !== "remote") {
    throw new Error(`unknown h2a endpoint "${endpoint}"`);
  }
  if (endpoint === "remote") {
    if (!options.url) {
      throw new Error("remote h2a endpoint requires a URL");
    }
    assertHttpMcpUrl(options.url);
    if (options.command || options.args || options.root) {
      throw new Error("remote h2a endpoint cannot include local command, args, or root");
    }
    return { url: options.url };
  }
  if (options.url) {
    throw new Error("local h2a endpoint cannot include a remote URL");
  }
  return {
    command: options.command ?? "h2a",
    args: buildArgs(options.args ?? ["mcp-serve"], options.root)
  };
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
  return {
    config: {
      mcpServers: {
        h2a: renderH2aMcpServer(options)
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
