import fs from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { openQualificationRpc } from './qualification-rpc.mjs';
export async function qualifyVibeProbe({ command = 'vibe', appServer = 'vibe-app-server', cwd, env, tools, budget, signal, evidence, cleanup, directory }) {
  if (!tools.length || tools.some(t => /bash|shell|exec|process|terminal|code|eval/i.test(t))) throw new Error('probe requires minimal native read-only tools; execution tools forbidden');
  const allocation = budget.begin('cli-probe');
  const output = join(directory, 'cli-journal'); fs.mkdirSync(output, { mode: 0o700 });
  const args = ['-p', 'Report the installed H2A skill and its required local resource paths. Use only the already enabled read-only tools.', '--agent', 'auto-approve', '--enabled-tools', ...tools,
    '--max-turns', String(allocation.maxIterations), '--max-price', String(allocation.maxPrice), '--time-limit', String(allocation.maxSeconds), '--output', 'streaming', '--output-dir', output];
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let raw = '', error;
  child.stdout.setEncoding('utf8'); child.stdout.on('data', bytes => { raw += bytes; if (raw.length > 1_048_576) child.kill('SIGTERM'); });
  child.stderr.on('data', () => {});
  child.on('error', e => { error = e; });
  const abort = () => child.kill('SIGTERM'); signal?.addEventListener('abort', abort, { once: true });
  const watchdog = setTimeout(abort, allocation.maxSeconds * 1000), force = setTimeout(() => child.kill('SIGKILL'), allocation.maxSeconds * 1000 + 2000);
  try {
    const [code] = await once(child, 'close');
    if (error || code !== 0 || raw.length > 1_048_576) throw new Error('native CLI probe incomplete');
    const entries = raw.trim().split('\n').map(line => JSON.parse(line));
    const ids = [...new Set(entries.map(e => e.sessionId).filter(Boolean))];
    if (ids.length !== 1) throw new Error('native CLI session correlation unavailable');
    cleanup.sessions.push(ids[0]);
    evidence.push({ method: 'qualification/cli-probe', sessionId: ids[0], sha256: createHash('sha256').update(raw).digest('hex'), nativeJournal: fs.readdirSync(output).length > 0 });
    // Native CLI bounds are enforced by its flags. Journal accounting must
    // still be qualified before a CLI observation can become a receipt.
    return { status: 'observed', sessionId: ids[0], journal: fs.readdirSync(output).length > 0 };
  } finally {
    clearTimeout(watchdog); clearTimeout(force); signal?.removeEventListener('abort', abort);
    if (child.pid && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'close'); }
    const ids = [...new Set(cleanup.sessions)].filter(id => !cleanup.deleted.includes(id));
    if (ids.length) {
      const rpc = openQualificationRpc(appServer, [], { cwd, env });
      try {
        await rpc.request('initialize', { clientInfo: { name: 'h2a-qualification-cleanup', version: '1' } }); rpc.notify('initialized');
        for (const sessionId of ids) { await rpc.request('session/delete', { sessionId }); cleanup.deleted.push(sessionId); }
      } catch { cleanup.incomplete = true; }
      finally { await rpc.close(); }
    }
  }
}
