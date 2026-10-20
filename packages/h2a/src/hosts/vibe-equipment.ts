import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStaticTOMLValue, parseForESLint } from 'toml-eslint-parser';
import { atomicNativeWrite, digest, readNativeManifest, snapshot } from './native-files.js';
import type { NativeManifest } from './native-files.js';
import { editVibeHooks, parseNativeToml, recoverNativeHooks, renderVibeHook, semanticDigest } from './native-toml.js';
import { editVibeMcpServers, isValidVibeH2aEntry, isVibeDirectRemoved, isVibeH2aServer } from './vibe-mcp.js';
import type { VibeHook } from './native-toml.js';
import type { NativeArtifact } from './native-artifacts.js';
import { fileFingerprint, inspectNativeQualification, mcpFingerprint } from './native-proof.js';
import { VIBE_LIFECYCLE_SCOPE, VIBE_RESTART } from './native-paths.js';
import { inspectVibeDiscovery } from './vibe-discovery.js';
export const h2aPackageRoot = fileURLToPath(new URL('../../', import.meta.url));
export const shellQuote = (value: string): string => "'" + value.replace(/'/g, "'\\''") + "'";
export interface VibeEquipmentOptions {
  root: string; state: string; version: string; config: Record<string, any>; mcpAvailable: boolean;
  repair: boolean; dryRun?: boolean; guard?: string; lifecycle?: string;
  instance?: string; busRoot?: string; status?: string;
  maskingHooks?: readonly string[]; cwd?: string;
  ownerKey?: string; workspaceScope?: string;
}
// Convergence repairs config.toml toward the canonical entry only when no
// unique valid enabled `h2a` entry exists: absent, duplicated, scalar
// `mcp_servers = []` leftover, or a single degraded entry (wrong name,
// disabled, missing/invalid transport target). A valid entry with custom
// options (--endpoint remote, --no-wake, --root, test binary) is preserved;
// `host setup --host vibe --write` owns argument changes.
function vibeMcpNeedsRepair(source: string): boolean {
  try {
    const ast = parseForESLint(source, { tomlVersion: '1.0.0' }).ast;
    const value = (source.trim().length === 0 ? {} : getStaticTOMLValue(ast)) as Record<string, any>;
    const servers = value.mcp_servers ?? [];
    if (!Array.isArray(servers)) return true;
    const nodes = (ast.body?.[0]?.body ?? []) as Array<any>;
    const assignment = nodes.find(
      (n) =>
        n.type === 'TOMLKeyValue' &&
        n.key.keys.length === 1 &&
        getStaticTOMLValue(n.key.keys[0]) === 'mcp_servers'
    );
    if (assignment) return true;
    const h2aEntries = (servers as unknown[]).filter(isVibeH2aServer);
    if (h2aEntries.length === 0) return true;
    if (h2aEntries.length > 1) return true;
    return !isValidVibeH2aEntry(h2aEntries[0]);
  } catch {
    return true;
  }
}
// Effective availability after a repair, mirroring inspectNativeHost: only a
// Vibe-valid enabled entry counts, and disabled_tools can hide it.
function vibeMcpAvailable(config: Record<string, any>): boolean {
  const servers = config.mcp_servers ?? [];
  if (!Array.isArray(servers)) return false;
  const h2aServers = (servers as unknown[]).filter((server) => {
    if (!server || typeof server !== 'object') return false;
    const entry = server as Record<string, unknown>;
    if (!(entry.name === 'h2a' || (Array.isArray(entry.args) && (entry.args as unknown[]).includes('mcp-serve')))) return false;
    if (entry.disabled === true) return false;
    if (typeof entry.url === 'string') return entry.transport === 'streamable-http' || entry.transport === 'http';
    return entry.transport === 'stdio';
  });
  const disabled = config.disabled_tools ?? [];
  const hidden = Array.isArray(disabled) && disabled.some((name: unknown) => ['*', 'h2a_*', 'mcp_h2a_*'].includes(name as string));
  return h2aServers.length > 0 && !hidden;
}
export function planVibeEquipment(options: VibeEquipmentOptions) {
  const manifest = readNativeManifest(options.state, 'vibe', options.root, options.version);
  const pendingFile = snapshot(join(options.state, 'pending.json'));
  if (pendingFile) {
    const pending = JSON.parse(pendingFile.bytes.toString()) as NativeManifest;
    if (pending.schema !== 1 || pending.host !== 'vibe' || pending.root !== options.root) throw new Error('incompatible interrupted Vibe installation');
    recoverNativeHooks(manifest, pending, snapshot(join(options.root, 'hooks.toml'))?.bytes.toString() ?? '');
  }
  if (options.workspaceScope !== undefined && !['on', 'off'].includes(options.workspaceScope)) throw new Error('workspace-scope must be on or off');
  const scopeEnabled = options.workspaceScope === 'on' || options.workspaceScope === undefined && manifest.workspaceScope?.enabled === true;
  const entrypoint = resolve(h2aPackageRoot, 'dist/bin.js');
  if (!snapshot(process.execPath) || !snapshot(entrypoint)) throw new Error('verified Node/h2a entrypoint unavailable');
  const artifacts: NativeArtifact[] = ['vibe-pre-tool.mjs', 'vibe-post-agent.mjs',
    'workspace-scope-guard.mjs', 'workspace-scope-shell.mjs', 'workspace-scope-state.mjs'].map(name => {
    const source = snapshot(join(h2aPackageRoot, 'hooks', name));
    if (!source) throw new Error(`missing packaged hook: ${name}`);
    return { path: join(options.state, 'hooks', name), bytes: source.bytes.toString(), source: `h2a@${options.version}/hooks/${name}` };
  });
  const mcpPath = join(options.root, 'config.toml');
  const mcpOriginal = snapshot(mcpPath);
  const mcpRaw = mcpOriginal?.bytes.toString() ?? '';
  const mcpWanted = { name: 'h2a', transport: 'stdio' as const, command: 'h2a', args: ['mcp-serve', '--auto-open', '--host', 'vibe', '--auto-upgrade', '--wake', 'auto'] };
  // Doctor/install convergence installs the interim direct entry (owner
  // 16/10) only when absent or degraded; a valid custom entry is preserved.
  // An explicit `host setup --host vibe --remove` persists a removal marker
  // that convergence respects until the next explicit `--write`.
  const removed = isVibeDirectRemoved(options.state);
  let mcpEdit = { text: mcpRaw, changed: false, replacedH2a: false, removed: [] as string[] };
  if (!removed && vibeMcpNeedsRepair(mcpRaw)) mcpEdit = editVibeMcpServers(mcpRaw, mcpWanted);
  const repairingNow = options.repair && !options.dryRun && mcpEdit.changed;
  const effectiveConfig = repairingNow ? parseNativeToml(mcpEdit.text) : options.config;
  const effectiveMcpAvailable = repairingNow ? vibeMcpAvailable(effectiveConfig) : options.mcpAvailable;
  const discovery = inspectVibeDiscovery(options.root, options.cwd ?? process.cwd(), effectiveConfig);
  const maskingHooks = options.maskingHooks ?? discovery.maskingHooks;
  if (scopeEnabled && maskingHooks.includes('sentropic-h2a-workspace-scope')) throw new Error('Workspace scope guard masked by project hook; cannot claim pre-action protection.');
  const observed = { MCP: mcpFingerprint({ mcp: effectiveConfig.mcp_servers ?? [], disabled_tools: effectiveConfig.disabled_tools ?? [], enabled_tools: effectiveConfig.enabled_tools ?? [] }),
    profile: digest(options.root), node: fileFingerprint(process.execPath), entrypoint: fileFingerprint(entrypoint),
    guard: fileFingerprint(artifacts[0].path), lifecycle: fileFingerprint(artifacts[1].path), masking: semanticDigest(maskingHooks),
    skills: semanticDigest({ files: Object.entries(manifest.files).filter(([, e]) => !e.source.includes('/hooks/')).sort(([a], [b]) => a.localeCompare(b)).map(([path, e]) => [path, e.selected, fileFingerprint(join(options.root, path))]),
      discovery: { ...discovery, sources: Object.fromEntries(Object.entries(discovery.sources).map(([name, paths]) => [name, paths.map(path => [path, fileFingerprint(path)])])) } }),
    filters: semanticDigest({ enabled: effectiveConfig.enabled_skills ?? [], disabled: effectiveConfig.disabled_skills ?? [], paths: effectiveConfig.skill_paths ?? [] }),
    guardBlock: manifest.hooks?.['sentropic-h2a-deny-manual-cli'] ?? 'absent',
    lifecycleBlock: manifest.hooks?.['h2a-drumbeat-record'] ?? 'absent', lifecycleSelection: semanticDigest(manifest.lifecycle ?? {}) };
  const qualification = inspectNativeQualification(options.state, 'vibe', options.root, observed);
  for (const mode of [options.guard, options.lifecycle]) if (mode !== undefined && !['on', 'off'].includes(mode)) throw new Error('guard/lifecycle must be on or off');
  if (options.instance === 'auto') throw new Error('non disponible — interface B non livrée');
  const knownBinding = manifest.guardBinding;
  if (options.guard === 'on' && ((!knownBinding || knownBinding !== observed.MCP) && !qualification.guardEligible || maskingHooks.length))
    throw new Error('First guard activation requires a current native MCP qualification; configuration, fixture and manual observation are insufficient.');
  const guard = options.guard ?? manifest.guard;
  const guardBinding = options.guard === 'on' && qualification.guardEligible ? observed.MCP : knownBinding;
  const guardActive = guard === 'on' && effectiveMcpAvailable && guardBinding === observed.MCP && maskingHooks.length === 0;
  const lifecycle = options.instance ? { enabled: true, instance: options.instance, ...(options.busRoot ? { root: options.busRoot } : {}), ...(options.status ? { status: options.status } : {}) } : manifest.lifecycle ? { ...manifest.lifecycle } : undefined;
  if (options.lifecycle === 'on' && !lifecycle) throw new Error('Run h2a host plugin --host vibe --instance <id> --write <hooks.toml> first.');
  if (lifecycle && options.lifecycle) lifecycle.enabled = options.lifecycle === 'on';
  const hooks: VibeHook[] = [];
  const command = (name: string) => [process.execPath, join(options.state, 'hooks', name)].map(shellQuote).join(' ');
  // The global profile cannot pin one project's cwd or one native session.
  // Keep owner-selected trust; each launch binds its native session separately.
  const workspaceScope = { enabled: scopeEnabled, session: options.instance ?? manifest.workspaceScope?.session,
    ownerKey: options.ownerKey ? resolve(options.ownerKey) : manifest.workspaceScope?.ownerKey };
  const scopeArgs = ['--host', 'vibe', '--session-store', options.state];
  if (workspaceScope.ownerKey) scopeArgs.push('--owner-key', workspaceScope.ownerKey);
  if (scopeEnabled) hooks.push({ name: 'sentropic-h2a-workspace-scope', type: 'pre_tool', match: 're:.*',
    command: command('workspace-scope-guard.mjs') + ' ' + scopeArgs.map(shellQuote).join(' '), timeout: 15, strict: true });
  if (guardActive) hooks.push({ name: 'sentropic-h2a-deny-manual-cli', type: 'pre_tool', match: 're:(bash|file_system\\.bash|process_start|process\\.start)', command: command('vibe-pre-tool.mjs'), timeout: 5, strict: false });
  if (lifecycle?.enabled) {
    const args = ['--entrypoint', entrypoint, '--instance', lifecycle.instance, '--status', lifecycle.status ?? 'paused', '--command', 'vibe -c', '--resume-command', 'vibe -c'];
    if (lifecycle.root) args.push('--root', lifecycle.root);
    hooks.push({ name: 'h2a-drumbeat-record', type: 'post_agent', command: command('vibe-post-agent.mjs') + ' ' + args.map(shellQuote).join(' '), timeout: 5 });
  }
  const path = join(options.root, 'hooks.toml'), original = snapshot(path);
  const edited = editVibeHooks(original?.bytes.toString() ?? '', hooks, manifest.hooks ?? {});
  const hooksPlanned = edited.text !== (original?.bytes.toString() ?? '');
  return { artifacts, hooks, rendered: hooks.map(renderVibeHook).join('\n'), qualification, observed,
    hooksPath: path, hooksPlanned,
    mcp: { path: mcpPath, planned: mcpEdit.changed, changed: false, replacedH2a: mcpEdit.replacedH2a, removedDirect: removed },
    guard: { choice: guard ?? 'off', active: guardActive, suspended: guard === 'on' && !guardActive,
      reason: guard !== 'on' ? 'off' : maskingHooks.length ? 'project hook masking' : !effectiveMcpAvailable ? 'MCP absent' : guardBinding !== observed.MCP ? 'MCP binding changed' : 'active' }, lifecycle, restart: VIBE_RESTART, scope: VIBE_LIFECYCLE_SCOPE,
    configure: (current: NativeManifest) => {
      if (JSON.stringify(current.hooks ?? {}) !== JSON.stringify(manifest.hooks ?? {}) || JSON.stringify(current.lifecycle) !== JSON.stringify(manifest.lifecycle) || current.guard !== manifest.guard || current.guardBinding !== manifest.guardBinding)
        throw new Error('concurrent hook selection changed');
      current.hooks = edited.owned;
      current.workspaceScope = workspaceScope;
      if (guard) current.guard = guard as 'on' | 'off';
      if (guardBinding) current.guardBinding = guardBinding;
      if (lifecycle) current.lifecycle = lifecycle;
    },
    finish: () => {
      if (!options.repair || options.dryRun) return;
      if (original || edited.text) atomicNativeWrite(path, edited.text, { state: options.state, expected: original });
      if (mcpEdit.changed) atomicNativeWrite(mcpPath, mcpEdit.text, { state: options.state, expected: mcpOriginal });
    } };
}
