import { spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
// No lifecycle effect until the root parent_session_id field is validated.
let raw = '';
const done = message => { if (message) process.stderr.write(message + '\n'); process.exit(0); };
const timer = setTimeout(() => done('Vibe lifecycle: stdin timeout; no record.'), 4000);
process.stdin.setEncoding('utf8');
process.stdin.on('error', () => done('Vibe lifecycle: unreadable stdin; no record.'));
process.stdin.on('data', chunk => { raw += chunk; if (raw.length > 1_048_576) done('Vibe lifecycle: oversized payload; no record.'); });
process.stdin.on('end', () => {
  clearTimeout(timer);
  try {
    const payload = JSON.parse(raw);
    if (typeof payload.parent_session_id === 'string' && payload.parent_session_id.length) return done();
    if (!Object.hasOwn(payload, 'parent_session_id') || payload.parent_session_id !== null)
      return done('Vibe lifecycle: missing/invalid parent_session_id; no record.');
    const flags = {};
    for (let i = 2; i < process.argv.length; i += 2) flags[process.argv[i]] = process.argv[i + 1];
    const entrypoint = flags['--entrypoint'], instance = flags['--instance'];
    if (!entrypoint || !isAbsolute(entrypoint) || !instance || instance === 'auto') return done('Vibe lifecycle: explicit instance and absolute entrypoint required.');
    const start = Date.now();
    const tmux = process.env.TMUX_PANE ? spawnSync('tmux', ['display-message', '-p', '#{session_name}'], { encoding: 'utf8', timeout: 500, maxBuffer: 4096 }) : undefined;
    const args = [entrypoint, 'drumbeat', 'record', '--instance', instance, '--status', flags['--status'] || 'paused',
      '--command', 'vibe -c', '--resume-command', 'vibe -c', '--tmux-session', tmux?.status === 0 ? tmux.stdout.trim() : '', '--tmux-pane', process.env.TMUX_PANE || ''];
    if (flags['--root']) args.push('--root', flags['--root']);
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: Math.max(1, 4000 - (Date.now() - start)), maxBuffer: 1_048_576 });
    if (result.status !== 0) process.stderr.write('Vibe lifecycle: drumbeat record failed; inspect the explicit installation.\n');
  } catch { process.stderr.write('Vibe lifecycle: malformed payload; no record.\n'); }
});
