import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import type { AutoUpgradeResult } from '../runtime/upgrade/index.js';
import { snapshot } from './native-files.js';
import { h2aPackageRoot } from './vibe-equipment.js';
import { NATIVE_HOSTS } from './native-paths.js';
export function convergeAfterExplicitUpgrade(result: AutoUpgradeResult, flags: Record<string, string>, run = spawnSync) {
  if (flags['skip-hosts'] === 'true') return { skipped: true, reason: '--skip-hosts' };
  if (!['upgraded', 'already-current', 'deferred-propagation'].includes(result.outcome)) return { skipped: true, reason: result.outcome, next: 'After verifying a coherent installation and releasing the upgrade lock: h2a doctor --repair' };
  const entrypoint = result.verifiedEntrypoint ?? join(h2aPackageRoot, 'dist/bin.js');
  const version = result.outcome === 'upgraded' ? result.verifiedVersion : result.current;
  const pkg = snapshot(join(dirname(dirname(entrypoint)), 'package.json'));
  if (!pkg || JSON.parse(pkg.bytes.toString()).name !== '@sentropic/h2a' || JSON.parse(pkg.bytes.toString()).version !== version || !snapshot(entrypoint))
    return { ok: false, reason: 'new/current entrypoint not verified', next: 'Verify h2a --version, then h2a doctor --repair using the exact new entrypoint.' };
  const hosts = flags.host ? [flags.host] : NATIVE_HOSTS;
  const reports = hosts.map(host => {
    const args = [entrypoint, 'doctor', '--repair', '--host', host, ...(flags.root ? ['--root', flags.root] : [])];
    if (flags['dry-run'] === 'true') args.push('--dry-run');
    const child = run(process.execPath, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    return { host, ok: child.status === 0, command: [process.execPath, ...args], result: child.stdout, diagnostic: child.stderr };
  });
  return { ok: reports.every(r => r.ok), entrypoint, version, reports };
}
