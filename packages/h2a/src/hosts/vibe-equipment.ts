import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicNativeWrite, digest, readNativeManifest, snapshot } from './native-files.js';
import type { NativeManifest } from './native-files.js';
import { editVibeHooks, recoverNativeHooks, renderVibeHook, semanticDigest } from './native-toml.js';
import type { VibeHook } from './native-toml.js';
import type { NativeArtifact } from './native-artifacts.js';
import { fileFingerprint, inspectNativeQualification, mcpFingerprint } from './native-proof.js';
import { VIBE_LIFECYCLE_SCOPE, VIBE_RESTART } from './native-paths.js';
export const h2aPackageRoot = fileURLToPath(new URL('../../', import.meta.url));
export const shellQuote = (value: string): string => "'" + value.replace(/'/g, "'\\''") + "'";
export interface VibeEquipmentOptions {
  root: string; state: string; version: string; config: Record<string, any>; mcpAvailable: boolean;
  repair: boolean; dryRun?: boolean; guard?: string; lifecycle?: string;
  instance?: string; busRoot?: string; status?: string;
  maskingHooks?: readonly string[];
}
export function planVibeEquipment(options: VibeEquipmentOptions) {
  const manifest = readNativeManifest(options.state, 'vibe', options.root, options.version);
  const pendingFile = snapshot(join(options.state, 'pending.json'));
  if (pendingFile) {
    const pending = JSON.parse(pendingFile.bytes.toString()) as NativeManifest;
    if (pending.schema !== 1 || pending.host !== 'vibe' || pending.root !== options.root) throw new Error('incompatible interrupted Vibe installation');
    recoverNativeHooks(manifest, pending, snapshot(join(options.root, 'hooks.toml'))?.bytes.toString() ?? '');
  }
  const entrypoint = resolve(h2aPackageRoot, 'dist/bin.js');
  if (!snapshot(process.execPath) || !snapshot(entrypoint)) throw new Error('verified Node/h2a entrypoint unavailable');
  const artifacts: NativeArtifact[] = ['vibe-pre-tool.mjs', 'vibe-post-agent.mjs'].map(name => {
    const source = snapshot(join(h2aPackageRoot, 'hooks', name));
    if (!source) throw new Error(`missing packaged hook: ${name}`);
    return { path: join(options.state, 'hooks', name), bytes: source.bytes.toString(), source: `h2a@${options.version}/hooks/${name}` };
  });
  const observed = { MCP: mcpFingerprint({ mcp: options.config.mcp_servers ?? [], disabled_tools: options.config.disabled_tools ?? [] }),
    profile: digest(options.root), node: fileFingerprint(process.execPath), entrypoint: fileFingerprint(entrypoint),
    guard: digest(artifacts[0].bytes), lifecycle: digest(artifacts[1].bytes), masking: digest(JSON.stringify(options.maskingHooks ?? [])),
    skills: digest(JSON.stringify(Object.entries(manifest.files).filter(([, e]) => !e.source.includes('/hooks/')).map(([path]) => [path, fileFingerprint(path)]))),
    filters: semanticDigest({ enabled: options.config.enabled_skills ?? [], disabled: options.config.disabled_skills ?? [], paths: options.config.skill_paths ?? [] }),
    guardBlock: manifest.hooks?.['sentropic-h2a-deny-manual-cli'] ?? 'absent',
    lifecycleBlock: manifest.hooks?.['h2a-drumbeat-record'] ?? 'absent', lifecycleSelection: semanticDigest(manifest.lifecycle ?? {}) };
  const qualification = inspectNativeQualification(options.state, 'vibe', options.root, observed);
  for (const mode of [options.guard, options.lifecycle]) if (mode !== undefined && !['on', 'off'].includes(mode)) throw new Error('guard/lifecycle must be on or off');
  if (options.instance === 'auto') throw new Error('non disponible — interface B non livrée');
  const knownBinding = manifest.guardBinding;
  if (options.guard === 'on' && ((!knownBinding || knownBinding !== observed.MCP) && !qualification.guardEligible || options.maskingHooks?.length))
    throw new Error('First guard activation requires a current native MCP qualification; configuration, fixture and manual observation are insufficient.');
  const guard = options.guard ?? manifest.guard;
  const guardBinding = options.guard === 'on' && qualification.guardEligible ? observed.MCP : knownBinding;
  const guardActive = guard === 'on' && options.mcpAvailable && guardBinding === observed.MCP;
  const lifecycle = options.instance ? { enabled: true, instance: options.instance, ...(options.busRoot ? { root: options.busRoot } : {}), ...(options.status ? { status: options.status } : {}) } : manifest.lifecycle ? { ...manifest.lifecycle } : undefined;
  if (options.lifecycle === 'on' && !lifecycle) throw new Error('Run h2a host plugin --host vibe --instance <id> --write <hooks.toml> first.');
  if (lifecycle && options.lifecycle) lifecycle.enabled = options.lifecycle === 'on';
  const hooks: VibeHook[] = [];
  const command = (name: string) => [process.execPath, join(options.state, 'hooks', name)].map(shellQuote).join(' ');
  if (guardActive) hooks.push({ name: 'sentropic-h2a-deny-manual-cli', type: 'pre_tool', match: 're:(bash|file_system\\.bash|process_start|process\\.start)', command: command('vibe-pre-tool.mjs'), timeout: 5, strict: false });
  if (lifecycle?.enabled) {
    const args = ['--entrypoint', entrypoint, '--instance', lifecycle.instance, '--status', lifecycle.status ?? 'paused', '--command', 'vibe -c', '--resume-command', 'vibe -c'];
    if (lifecycle.root) args.push('--root', lifecycle.root);
    hooks.push({ name: 'h2a-drumbeat-record', type: 'post_agent', command: command('vibe-post-agent.mjs') + ' ' + args.map(shellQuote).join(' '), timeout: 5 });
  }
  const path = join(options.root, 'hooks.toml'), original = snapshot(path);
  const edited = editVibeHooks(original?.bytes.toString() ?? '', hooks, manifest.hooks ?? {});
  return { artifacts, hooks, rendered: hooks.map(renderVibeHook).join('\n'), qualification, observed,
    guard: { choice: guard ?? 'off', active: guardActive, suspended: guard === 'on' && !guardActive }, lifecycle, restart: VIBE_RESTART, scope: VIBE_LIFECYCLE_SCOPE,
    configure: (current: NativeManifest) => {
      if (JSON.stringify(current.hooks ?? {}) !== JSON.stringify(manifest.hooks ?? {}) || JSON.stringify(current.lifecycle) !== JSON.stringify(manifest.lifecycle) || current.guard !== manifest.guard || current.guardBinding !== manifest.guardBinding)
        throw new Error('concurrent hook selection changed');
      current.hooks = edited.owned;
      if (guard) current.guard = guard as 'on' | 'off';
      if (guardBinding) current.guardBinding = guardBinding;
      if (lifecycle) current.lifecycle = lifecycle;
    },
    finish: () => {
      if (!options.repair || options.dryRun) return;
      if (original || edited.text) atomicNativeWrite(path, edited.text, { state: options.state, expected: original });
    } };
}
