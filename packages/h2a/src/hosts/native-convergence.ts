import { homedir } from 'node:os';
import { join } from 'node:path';
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
  cwd?: string; force?: boolean;
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
  const state = shared ? stateRoot('agy', root) : stateRoot(host, root);
  const selected = observation?.filters;
  const artifacts = nativeSkillArtifacts({ host, root, version, skills: options.skills,
    enabled: Array.isArray(selected?.enabled) ? selected.enabled : [], disabled: Array.isArray(selected?.disabled) ? selected.disabled : [],
    renderGemini: options.renderGemini, historicalHashes: historicalSkillHashes });
  const vibeOptions = host === 'vibe' ? { root, state, version, config: observation!.config, cwd: options.cwd,
    mcpAvailable: observation!.mcpAvailable, repair, dryRun, guard: options.guard, lifecycle: options.lifecycle,
    instance: options.instance, busRoot: options.busRoot, status: options.status, maskingHooks: discovery?.maskingHooks } : undefined;
  const vibe = vibeOptions ? planVibeEquipment(vibeOptions) : undefined;
  if (vibe) artifacts.push(...vibe.artifacts);
  const result = convergeArtifacts({ state, root, host: shared ? 'gemini-commands' : host, version, artifacts, repair, dryRun,
    force: options.explicitInstall && options.force, prune: options.sourcesComplete !== false,
    ...(shared ? { manifestName: 'shared-owner.json' } : {}), configure: vibe?.configure, finalize: vibe?.finish });
  // Re-read committed artifacts and selections. Never report pre-repair proof freshness.
  const installedVibe = vibeOptions && repair && !dryRun ? planVibeEquipment({ ...vibeOptions, guard: undefined, lifecycle: undefined, instance: undefined, repair: false }) : vibe;
  const missingSources = options.sourcesComplete === false;
  const ok = result.changes.conflicts.length === 0 && !missingSources;
  const pending = result.changes.planned.length > 0 && (!repair || dryRun);
  return { host, root, ok, installation: !ok ? 'conflict' : pending ? 'action necessary' : 'coherent',
    qualification: installedVibe?.qualification ?? { status: 'absent' }, migration: observation?.migration ?? 'non migré',
    coverage: 'convergence native couverte; qualification native distincte', observation: publicObservation, discovery,
    ...result.changes, missingSources, manifest: result.manifest, guard: installedVibe?.guard, lifecycle: installedVibe?.lifecycle,
    ...(vibe ? { rendered: vibe.rendered, restart: vibe.restart, lifecycleScope: vibe.scope } : {}),
    ...(shared ? { sharedGeminiEffect: true, sharedOwner: join(state, 'shared-owner.json') } : {}) };
}
