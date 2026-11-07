// Native OpenCode 1.17.15 bench surface. No account/configuration from the
// owner home is loaded. This plugin governs h2a tools only; message arrival
// still uses the witnessed signed terminal prompt, not session.prompt().
import { pathToFileURL } from 'node:url';

export const OPENCODE_TOOLS = Object.freeze(['h2a_h2a_identity_status', 'h2a_h2a_inbox', 'h2a_h2a_send']);

export function openCodePluginSource() {
  return `const tools = new Set(${JSON.stringify(OPENCODE_TOOLS)});
export default async function H2aBenchPlugin() {
  return {
    config: async config => {
      config.permission = { ...(config.permission ?? {}) };
      for (const name of tools) config.permission[name] = 'allow';
    },
    'tool.execute.before': async input => {
      if (input.tool.startsWith('h2a_') && !tools.has(input.tool))
        throw new Error('h2a-tool-out-of-scope');
    }
  };
}
`;
}

export function openCodeCellConfig(endpoint, pluginFile) {
  if (typeof endpoint?.command !== 'string' || !Array.isArray(endpoint.args))
    throw new Error('opencode-local-mcp-required');
  return { mcp: { h2a: { type: 'local', command: [endpoint.command, ...endpoint.args], enabled: true } },
    plugin: [pathToFileURL(pluginFile).href], autoupdate: false };
}
