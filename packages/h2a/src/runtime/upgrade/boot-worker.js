import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureManagedImageExecution } from './image-entry.js';

await ensureManagedImageExecution(import.meta.url);
const [root, ttl, mode] = process.argv.slice(2);
if (!root || !isAbsolute(root) || !Number.isSafeInteger(Number(ttl)) || Number(ttl) <= 0 ||
    !['auto', 'check'].includes(mode) || process.argv.length !== 5) throw new Error('upgrade_worker_arguments_invalid');
try {
  // The single H4 automatic pass (LOT-1): manual and automatic share it, so
  // the boot trigger converges exactly like `h2a upgrade`. The legacy staged
  // engine is unreachable from this worker.
  const upgrade = await import('./index.js');
  const result = upgrade.runBootUpgrade({ root, ttlMs: Number(ttl), mode, workerPath: fileURLToPath(import.meta.url) });
  const notice = upgrade.describeBootUpgrade(result);
  if (notice !== null) process.stderr.write(notice + '\n');
} catch {
  // Best-effort maintenance never tears down the serving MCP process. The
  // image gate above deliberately remains outside this catch.
}
