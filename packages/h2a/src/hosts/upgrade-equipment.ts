import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import type { AutoUpgradeResult } from '../runtime/upgrade/index.js';
import { snapshot } from './native-files.js';
import { h2aPackageRoot } from './vibe-equipment.js';
import { NATIVE_HOSTS } from './native-paths.js';
/**
 * Lot L6 (D14) — structured host summary for one explicit upgrade.
 * Per-host reports carry counts only (`ok`, `repaired`); raw child stdout
 * is never embedded (a chatty doctor used to flood the JSON wall) — the
 * upgrade log path (`log`, from the staged result when present) is the
 * details path for full output.
 */
export interface UpgradeHostReport {
  readonly host: string;
  readonly ok: boolean;
}

export interface UpgradeHostsSummary {
  readonly ok: number;
  readonly failed: number;
}

export type ConvergedHosts =
  | { readonly skipped: true; readonly reason: string; readonly next?: string }
  | {
      readonly ok: boolean;
      readonly entrypoint?: string;
      readonly version?: string;
      readonly reason?: string;
      readonly next?: string;
      readonly summary: UpgradeHostsSummary;
      readonly hosts: readonly UpgradeHostReport[];
      readonly log?: string;
    };

export function convergeAfterExplicitUpgrade(result: AutoUpgradeResult, flags: Record<string, string>, run = spawnSync): ConvergedHosts {
  if (flags['skip-hosts'] === 'true') return { skipped: true, reason: '--skip-hosts' };
  if (!['upgraded', 'already-current', 'deferred-propagation', 'registry-unreachable'].includes(result.outcome)) return { skipped: true, reason: result.outcome, next: 'After verifying a coherent installation and releasing the upgrade lock: h2a doctor --repair' };
  const entrypoint = result.verifiedEntrypoint ?? join(h2aPackageRoot, 'dist/bin.js');
  const version = result.outcome === 'upgraded' ? result.verifiedVersion : result.current;
  const pkg = snapshot(join(dirname(dirname(entrypoint)), 'package.json'));
  if (!pkg || JSON.parse(pkg.bytes.toString()).name !== '@sentropic/h2a' || JSON.parse(pkg.bytes.toString()).version !== version || !snapshot(entrypoint))
    return { ok: false, reason: 'new/current entrypoint not verified', next: 'Verify h2a --version, then h2a doctor --repair using the exact new entrypoint.', summary: { ok: 0, failed: 0 }, hosts: [] };
  const hosts = flags.host ? [flags.host] : [...NATIVE_HOSTS];
  const reports = hosts.map(host => {
    const args = [entrypoint, 'doctor', '--repair', '--host', host, ...(flags.root ? ['--root', flags.root] : [])];
    if (flags['dry-run'] === 'true') args.push('--dry-run');
    // The child's byte streams are deliberately NOT kept: only the exit
    // status feeds the counted summary (full output stays in the child's
    // own log surface, reachable via `log` below).
    const child = run(process.execPath, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const ok = child.status === 0;
    return { host, ok };
  });
  const summary: UpgradeHostsSummary = {
    ok: reports.filter(r => r.ok).length,
    failed: reports.filter(r => !r.ok).length,
  };
  return {
    ok: reports.every(r => r.ok),
    entrypoint,
    version,
    summary,
    hosts: reports,
    ...(result.logPath ? { log: result.logPath } : {}),
  };
}
