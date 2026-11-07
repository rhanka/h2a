// Native OpenCode 1.17.15 bench surface. No account/configuration from the
// owner home is loaded. This plugin governs h2a tools only; message arrival
// still uses the witnessed signed terminal prompt, not session.prompt().
import { pathToFileURL } from 'node:url';
import { isAbsolute, join } from 'node:path';

export const OPENCODE_TOOLS = Object.freeze(['h2a_h2a_identity_status', 'h2a_h2a_inbox', 'h2a_h2a_send']);
export const OPENCODE_PLUGIN_READY = 'H2A_XCLI_OPENCODE_PLUGIN_LOADED_V1';
const permissions = () => ({ '*': 'deny', ...Object.fromEntries(OPENCODE_TOOLS.map(name => [name, 'allow'])) });

export function openCodeEnvironment(env, configFile, managedDir) {
  return { ...env, OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1', OPENCODE_TEST_HOME: env.HOME,
    OPENCODE_TEST_MANAGED_CONFIG_DIR: managedDir ?? join(env.HOME, 'opencode-managed'),
    OPENCODE_CONFIG: configFile };
}

export function openCodePluginSource() {
  return `const tools = new Set(${JSON.stringify(OPENCODE_TOOLS)});
export default async function H2aBenchPlugin() {
  process.stderr.write(${JSON.stringify(OPENCODE_PLUGIN_READY + '\n')});
  return {
    config: async config => {
      config.permission = ${JSON.stringify(permissions())};
    },
    'tool.execute.before': async input => {
      if (!tools.has(input.tool))
        throw new Error('h2a-tool-out-of-scope');
    }
  };
}
`;
}

export function openCodeCellConfig(endpoint, pluginFile) {
  if (typeof endpoint?.command !== 'string' || !isAbsolute(endpoint.command) || !Array.isArray(endpoint.args) ||
      !endpoint.args.every(arg => typeof arg === 'string') || typeof pluginFile !== 'string' || !isAbsolute(pluginFile))
    throw new Error('opencode-local-mcp-required');
  return { mcp: { h2a: { type: 'local', command: [endpoint.command, ...endpoint.args], enabled: true } },
    plugin: [pathToFileURL(pluginFile).href], permission: permissions(), autoupdate: false,
    share: 'disabled', snapshot: false, formatter: false, lsp: false };
}
