import { accessSync, constants, lstatSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { snapshot } from './native-files.js';
import { parseNativeToml } from './native-toml.js';
import { MISSING_VIBE_MCP, nativeRoot, REGISTRY_WAITING, stateRoot, VIBE_LIFECYCLE_SCOPE, VIBE_RESTART } from './native-paths.js';
import type { NativeHost } from './native-paths.js';
export function nativeCliPresent(host: string): boolean {
  return (process.env.PATH ?? '').split(delimiter).some(dir => {
    try { accessSync(join(dir, host), constants.X_OK); return statSync(join(dir, host)).isFile(); }
    catch (e) { if (!['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e; return false; }
  });
}
export function inspectNativeHost(host: NativeHost, root = nativeRoot(host)) {
  let rootPresent = false;
  try { rootPresent = lstatSync(root).isDirectory(); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  // Shared Gemini files are never evidence of an Antigravity installation.
  const detected = host === 'agy' ? nativeCliPresent('agy') : rootPresent || nativeCliPresent(host);
  const configPath = join(root, host === 'vibe' ? 'config.toml' : host === 'agy' ? 'config/mcp_config.json' : 'settings.json');
  const configFile = snapshot(configPath);
  const config = configFile ? host === 'vibe' ? parseNativeToml(configFile.bytes.toString()) : JSON.parse(configFile.bytes.toString()) : {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`incompatible configuration: ${configPath}`);
  const servers = host === 'vibe' ? config.mcp_servers ?? [] : Object.entries(config.mcpServers ?? {}).map(([name, value]) => ({ name, ...(value as object) }));
  if (!Array.isArray(servers)) throw new Error(`incompatible MCP collection: ${configPath}`);
  const h2aServers = servers.filter(server => server && (server.name === 'h2a' || Array.isArray(server.args) && server.args.includes('mcp-serve')));
  const disabled = config.disabled_tools ?? [];
  const hidden = Array.isArray(disabled) && disabled.some(name => ['*', 'h2a_*', 'mcp_h2a_*'].includes(name));
  const mcpAvailable = h2aServers.length > 0 && !hidden;
  return {
    host, root, state: stateRoot(host, root), detected, configPath, config, h2aServers, mcpAvailable,
    migration: h2aServers.length ? 'voie directe — non migrée' : REGISTRY_WAITING,
    bootstrap: 'Interface R5/R7 non livrée; aucun reçu de production reconnu',
    registryDiagnostic: host === 'vibe' && !mcpAvailable ? MISSING_VIBE_MCP : undefined,
    installationRoute: host === 'vibe' && !mcpAvailable ? 'Vibe est le seul hôte sans voie d’installation MCP h2a, même non recommandée; bootstrap B attendu.' : undefined,
    restart: host === 'vibe' ? VIBE_RESTART : 'Restart the host after changing its native components.',
    lifecycleScope: host === 'vibe' ? VIBE_LIFECYCLE_SCOPE : 'Aucune surface native de hooks vérifiée; M-B reste le critère de clôture.',
    import: host === 'agy' ? { status: 'pending', commands: ['agy plugin import gemini', 'agy plugin enable h2a'], sharedGeminiEffect: true } : undefined,
    filters: { enabled: config.enabled_skills ?? [], disabled: config.disabled_skills ?? [], skillPaths: config.skill_paths ?? [], disabledTools: disabled }
  };
}
