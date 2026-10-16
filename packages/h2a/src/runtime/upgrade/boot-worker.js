import { isAbsolute } from 'node:path';
import { ensureManagedImageExecution } from './image-entry.js';

await ensureManagedImageExecution(import.meta.url);
const [root, ttl, mode] = process.argv.slice(2);
if (!root || !isAbsolute(root) || !Number.isSafeInteger(Number(ttl)) || Number(ttl) <= 0 ||
    !['auto', 'check'].includes(mode) || process.argv.length !== 5) throw new Error('upgrade_worker_arguments_invalid');
try {
  // No caller-supplied module URL: maintenance uses this exact image's engine.
  const upgrade = await import('./index.js');
  const current = upgrade.currentCliVersion();
  if (mode === 'auto') {
    const result = await upgrade.performAutoUpgrade(current, { cachePath: upgrade.upgradeCachePath(root), ttlMs: Number(ttl) });
    if (!upgrade.isQuietUpgradeOutcome?.(result.outcome)) process.stderr.write('h2a mcp-serve: ' + result.message + '\n');
  } else {
    const result = await upgrade.checkUpgrade(current, { cachePath: upgrade.upgradeCachePath(root), ttlMs: Number(ttl) });
    if (result.upgradeAvailable) process.stderr.write('h2a mcp-serve: h2a ' + result.latest + ' available (current ' + current + ') — run `h2a upgrade`\n');
  }
} catch {
  // Best-effort maintenance never tears down the serving MCP process. The
  // image gate above deliberately remains outside this catch.
}
