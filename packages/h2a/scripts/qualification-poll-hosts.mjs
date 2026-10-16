import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
// The spec verifies these discovery/import commands, but no bounded model
// invocation or hook equivalent for Muse/agy. Never substitute Gemini for agy.
export function qualifyPollHost({ host, env, cwd, evidence, run = spawnSync }) {
  const commands = host === 'muse' ? [['muse', 'skills', 'list']] : [['agy', 'plugin', 'import', 'gemini'], ['agy', 'plugin', 'enable', 'h2a']];
  const checks = [];
  for (const [command, ...args] of commands) {
    const result = run(command, args, { env, cwd, encoding: 'utf8', timeout: 15_000, maxBuffer: 1_048_576 });
    const ok = result.status === 0;
    checks.push({ command: [command, ...args], ok });
    evidence.push({ method: 'qualification/native-discovery', command: [command, ...args], ok,
      sha256: createHash('sha256').update(result.stdout ?? '').digest('hex') });
    if (!ok) break;
  }
  return { skills: 'partial', MCP: 'partial', context: 'partial', guard: 'partial', lifecycle: 'partial',
    import: host === 'agy' ? checks.length === 2 && checks.every(c => c.ok) ? 'observed-success' : 'failed' : 'N-A', checks,
    limit: 'Native model/session accounting and usable session traces are not yet qualified. Discovery/import alone never qualifies skills, MCP or the M-B hook equivalents.' };
}
