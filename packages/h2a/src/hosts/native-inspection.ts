import { accessSync, constants, lstatSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { digest, snapshot } from './native-files.js';
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
  // Only a Vibe-valid enabled entry counts: the Pydantic union is
  // discriminated on `transport` (no default), so an entry without a valid
  // transport crashes vibe at startup and must read as absent; a disabled
  // entry exposes no tool and must read as absent too.
  const h2aServers = servers.filter(server => {
    if (!server || typeof server !== 'object') return false;
    const entry = server as Record<string, unknown>;
    if (!(entry.name === 'h2a' || Array.isArray(entry.args) && (entry.args as unknown[]).includes('mcp-serve'))) return false;
    if (entry.disabled === true) return false;
    if (typeof entry.url === 'string') return entry.transport === 'streamable-http' || entry.transport === 'http';
    return entry.transport === 'stdio';
  });
  const disabled = config.disabled_tools ?? [];
  const hidden = Array.isArray(disabled) && disabled.some(name => ['*', 'h2a_*', 'mcp_h2a_*'].includes(name));
  const mcpAvailable = h2aServers.length > 0 && !hidden;
  let importStatus = 'pending';
  if (host === 'agy') {
    try {
      const observed = JSON.parse(snapshot(join(stateRoot(host, root), 'import-observation.json'))?.bytes.toString() ?? '{}');
      const shared = snapshot(join(root, '.h2a-install-agy/shared-owner.json'));
      if (observed.schema === 1 && observed.root === root && shared && observed.sharedManifestHash === digest(shared.bytes) && ['observed-success', 'failed'].includes(observed.status)) importStatus = observed.status;
    } catch { /* A malformed observation is never proof of import. */ }
  }
  return {
    host, root, state: stateRoot(host, root), detected, configPath, config, h2aServers, mcpAvailable,
    migration: h2aServers.length ? 'voie directe — non migrée' : REGISTRY_WAITING,
    bootstrap: 'Interface R5/R7 non livrée; aucun reçu de production reconnu',
    registryDiagnostic: host === 'vibe' && !mcpAvailable ? MISSING_VIBE_MCP : undefined,
    installationRoute: host === 'vibe' && !mcpAvailable ? 'Voie directe intérimaire disponible : h2a host setup --host vibe --write (dérogation transitoire O7.2, migration R5/R7 attendue) ; bootstrap B attendu pour la voie registre.' : undefined,
    restart: host === 'vibe' ? VIBE_RESTART : 'Restart the host after changing its native components.',
    lifecycleScope: host === 'vibe' ? VIBE_LIFECYCLE_SCOPE : 'Aucune surface native de hooks vérifiée; M-B reste le critère de clôture.',
    import: host === 'agy' ? { status: importStatus, commands: ['agy plugin import gemini', 'agy plugin enable h2a'], sharedGeminiEffect: true } : undefined,
    filters: { enabled: config.enabled_skills ?? [], disabled: config.disabled_skills ?? [], skillPaths: config.skill_paths ?? [], disabledTools: disabled, enabledTools: config.enabled_tools ?? [] }
  };
}
