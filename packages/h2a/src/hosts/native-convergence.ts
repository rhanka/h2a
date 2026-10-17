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
  // MCP drift (config.toml) is a first-class convergence input: `planned` is
  // true when the file differs from the canonical entry, `changed` only when
  // this call actually wrote it (`repair && !dryRun`). Read-only and dry-run
  // probes never claim a write.
  const mcpDrift = host === 'vibe' && !!vibe ? (vibe.mcp.planned as boolean) : false;
  const mcpPath = host === 'vibe' && vibe ? (vibe.mcp.path as string) : undefined;
  const mcpWrote = mcpDrift && repair && !dryRun;
  if (mcpPath && mcpDrift && !result.changes.planned.includes(mcpPath)) result.changes.planned.push(mcpPath);
  if (mcpPath && mcpWrote && !result.changes.changed.includes(mcpPath)) result.changes.changed.push(mcpPath);
  const hooksDrift = host === 'vibe' && !!vibe ? (vibe.hooksPlanned as boolean) : false;
  const hooksPath = host === 'vibe' && vibe ? (vibe.hooksPath as string) : undefined;
  const hooksWrote = hooksDrift && repair && !dryRun;
  if (hooksPath && hooksDrift && !result.changes.planned.includes(hooksPath)) result.changes.planned.push(hooksPath);
  if (hooksPath && hooksWrote && !result.changes.changed.includes(hooksPath)) result.changes.changed.push(hooksPath);
  // Re-read the effective Vibe state after a repair so doctor reports the
  // installed interim direct entry (owner 16/10), never pre-repair absence.
  let effectiveObservation = observation;
  let effectivePublicObservation = publicObservation;
  let effectiveDiscovery = discovery;
  if (host === 'vibe' && repair && !dryRun) {
    try {
      const fresh = inspectNativeHost(host, root);
      effectiveObservation = fresh;
      effectivePublicObservation = fresh && (({ config, h2aServers, ...safe }) => safe)(fresh);
      effectiveDiscovery = inspectVibeDiscovery(root, options.cwd ?? process.cwd(), fresh.config);
    } catch { /* keep pre-repair observation */ }
  }
  // Re-read committed artifacts and selections. Never report pre-repair proof freshness.
  const installedVibe = vibeOptions && repair && !dryRun
    ? planVibeEquipment({ ...vibeOptions, config: effectiveObservation!.config, mcpAvailable: effectiveObservation!.mcpAvailable,
      maskingHooks: effectiveDiscovery?.maskingHooks, guard: undefined, lifecycle: undefined, instance: undefined, repair: false })
    : vibe;
  const missingSources = options.sourcesComplete === false;
  const ok = result.changes.conflicts.length === 0 && !missingSources;
  const pending = result.changes.planned.length > 0 && (!repair || dryRun);
  const freshMigration = effectiveObservation?.migration;
  const reportedMcp = vibe ? { ...(vibe.mcp as Record<string, unknown>), planned: mcpDrift, changed: mcpWrote } : undefined;
  return { host, root, ok, installation: !ok ? 'conflict' : pending ? 'action necessary' : 'coherent',
    qualification: installedVibe?.qualification ?? { status: 'absent' }, migration: freshMigration ?? 'non migré',
    coverage: 'convergence native couverte; qualification native distincte', observation: effectivePublicObservation, discovery: effectiveDiscovery,
    ...result.changes, missingSources, manifest: result.manifest, guard: installedVibe?.guard, lifecycle: installedVibe?.lifecycle,
    ...(vibe ? { rendered: vibe.rendered, restart: vibe.restart, lifecycleScope: vibe.scope, mcp: reportedMcp } : {}),
    ...(shared ? { sharedGeminiEffect: true, sharedOwner: join(state, 'shared-owner.json') } : {}) };
}
