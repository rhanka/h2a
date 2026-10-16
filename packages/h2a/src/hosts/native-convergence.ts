import { homedir } from 'node:os';
import { join } from 'node:path';
import { digest, jsonBytes, snapshot } from './native-files.js';
import { convergeArtifacts } from './native-artifacts.js';
import { nativeSkillArtifacts } from './native-skills.js';
import type { NativeSkill } from './native-skills.js';
import { historicalSkillHashes } from './native-catalog.js';
import { inspectNativeHost } from './native-inspection.js';
import { planVibeEquipment } from './vibe-equipment.js';
import { isNativeHost, nativeRoot, stateRoot } from './native-paths.js';
import { inspectVibeDiscovery } from './vibe-discovery.js';
export interface NativeConvergenceOptions {
  host: string; version: string; skills: readonly NativeSkill[]; renderGemini: (skill: NativeSkill['parsed']) => string;
  root?: string; repair?: boolean; dryRun?: boolean; explicitInstall?: boolean; guard?: string; lifecycle?: string;
  instance?: string; busRoot?: string; status?: string; sourcesComplete?: boolean;
  cwd?: string;
}
export function convergeNativeHost(options: NativeConvergenceOptions) {
  const { host, version } = options;
  if (!isNativeHost(host) && host !== 'gemini') throw new Error(`native convergence unsupported: ${host}`);
  const root = options.root ?? (host === 'gemini' ? join(homedir(), '.gemini') : nativeRoot(host));
  const repair = options.repair === true, dryRun = options.dryRun === true;
  const shared = host === 'agy' || host === 'gemini';
  const observation = host === 'gemini' ? undefined : inspectNativeHost(host, root);
  const publicObservation = observation && (({ config, h2aServers, ...safe }) => safe)(observation);
  const discovery = host === 'vibe' ? inspectVibeDiscovery(root, options.cwd ?? process.cwd(), observation!.config) : undefined;
  const detected = options.explicitInstall || observation?.detected || host === 'gemini';
  if (!detected && !options.instance) return { host, root, ok: true, installation: 'absent', coverage: 'convergence native couverte; hôte absent', observation: publicObservation };
  const state = shared ? join(root, '.h2a-install') : stateRoot(host, root);
  const selected = observation?.filters;
  const artifacts = nativeSkillArtifacts({ host, root, version, skills: options.skills,
    enabled: Array.isArray(selected?.enabled) ? selected.enabled : [], disabled: Array.isArray(selected?.disabled) ? selected.disabled : [],
    renderGemini: options.renderGemini, historicalHashes: historicalSkillHashes });
  const vibe = host === 'vibe' && !options.explicitInstall ? planVibeEquipment({ root, state, version, config: observation!.config,
    mcpAvailable: observation!.mcpAvailable, repair, dryRun, guard: options.guard, lifecycle: options.lifecycle,
    instance: options.instance, busRoot: options.busRoot, status: options.status, maskingHooks: discovery?.maskingHooks }) : undefined;
  if (vibe) artifacts.push(...vibe.artifacts);
  const result = convergeArtifacts({ state, root, host: shared ? 'gemini-commands' : host, version, artifacts, repair, dryRun,
    ...(shared ? { manifestName: 'commands-manifest.json' } : {}), configure: vibe?.configure, finalize: vibe?.finish });
  const missingSources = options.sourcesComplete === false;
  const ok = result.changes.conflicts.length === 0 && !missingSources;
  const pending = result.changes.planned.length > 0 && (!repair || dryRun);
  if (host === 'agy' && repair && !dryRun) {
    convergeArtifacts({ state: stateRoot('agy', root), root, host: 'agy', version, repair, artifacts: [{ path: join(stateRoot('agy', root), 'shared-owner.json'),
      bytes: jsonBytes({ manifest: join(state, 'commands-manifest.json'), sha256: digest(jsonBytes(result.manifest)), import: 'pending' }), source: `h2a@${version}/shared-owner` }] });
  }
  return { host, root, ok, installation: !ok ? 'conflict' : pending ? 'action necessary' : 'coherent',
    qualification: vibe?.qualification ?? { status: 'absent' }, migration: observation?.migration ?? 'non migré',
    coverage: 'convergence native couverte; qualification native distincte', observation: publicObservation, discovery,
    ...result.changes, missingSources, manifest: result.manifest, guard: vibe?.guard, lifecycle: vibe?.lifecycle,
    ...(vibe ? { rendered: vibe.rendered, restart: vibe.restart, lifecycleScope: vibe.scope } : {}),
    ...(shared ? { sharedGeminiEffect: true, sharedOwner: join(state, 'commands-manifest.json') } : {}) };
}
