#!/usr/bin/env node
import { spawnSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!['--ref', '--tarballs', '--rc', '--previous', '--output', '--temp-parent', '--only'].includes(key) || !process.argv[i + 1]) {
    console.error('Usage: node scripts/owner-lab/run.mjs [--ref origin/main | --tarballs DIR | --rc VERSION] [--previous 0.98.6] [--output DIR] [--temp-parent DIR]');
    process.exit(2);
  }
  options[key.slice(2)] = process.argv[i + 1];
}
if (['ref', 'tarballs', 'rc'].filter(k => options[k]).length > 1) throw new Error('Choose one candidate source');
if (options.only && !/^[1-7](?:,[1-7])*$/.test(options.only)) throw new Error('--only expects scenario numbers 1..7');
const parent = resolve(options['temp-parent'] ?? join(homedir(), '.cache-tmp/h2a-test'));
function safePath(path) {
  const blocked = ['/tmp', '/run/user', ...['.claude', '.codex', '.config/sentropic/h2a', '.local/state/h2a'].map(p => join(homedir(), p))];
  if (blocked.some(p => path === p || path.startsWith(p + '/'))) throw new Error('Forbidden owner/system path: ' + path);
  let ancestor = path;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  if (realpathSync(ancestor) !== ancestor) throw new Error('Aliased directory is not a lab boundary: ' + path);
}
safePath(parent);
const output = resolve(options.output ?? join(repo, 'tmp/owner-lab', new Date().toISOString().replace(/[:.]/g, '-')));
safePath(output);
if (existsSync(output) && readdirSync(output).length) throw new Error('Evidence directory must be new or empty');
mkdirSync(parent, { recursive: true, mode: 0o700 });
const root = mkdtempSync(join(parent, 'run-'));
if (output === root || output.startsWith(root + '/')) throw new Error('Evidence must survive scratch cleanup');
mkdirSync(output, { recursive: true });
const env = { PATH: '/usr/bin:/bin', HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'),
  XDG_RUNTIME_DIR: join(root, 'run'), XDG_CONFIG_HOME: join(root, 'config'), XDG_STATE_HOME: join(root, 'state'),
  XDG_CACHE_HOME: join(root, 'cache'), LANG: 'C.UTF-8', TERM: 'xterm-256color' };
for (const path of Object.values(env).filter(p => p.startsWith(root))) mkdirSync(path, { recursive: true, mode: 0o700 });
let child;
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (existsSync(join(root, 'evidence'))) cpSync(join(root, 'evidence'), output, { recursive: true });
  rmSync(root, { recursive: true, force: true });
  writeFileSync(join(output, 'cleanup.json'), JSON.stringify({ scratch: root, removed: !existsSync(root) }, null, 2) + '\n');
  console.log(`Scratch: ${root} — removed=${!existsSync(root)}\nEvidence: ${output}`);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { child?.kill(signal); });
try {
  const source = join(root, 'source');
  mkdirSync(source);
  const ref = options.ref ?? 'origin/main';
  const git = args => {
    const r = spawnSync('git', args, { cwd: repo, env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, maxBuffer: 128 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`]).toString().trim();
  const archive = git(['archive', '--format=tar', sha]);
  const unpack = spawnSync('tar', ['-xf', '-', '-C', source], { input: archive, env });
  if (unpack.status !== 0) throw new Error(`archive extraction: ${unpack.stderr}`);
  if (options.tarballs) cpSync(resolve(options.tarballs), join(root, 'tarballs'), { recursive: true });
  const config = { root, source, sha, ref, mode: options.tarballs ? 'tarballs' : options.rc ? 'rc' : 'source',
    rc: options.rc, previous: options.previous ?? '0.98.6', only: options.only?.split(',').map(Number) };
  writeFileSync(join(root, 'config.json'), JSON.stringify(config));
  // /etc/resolv.conf is often a symlink into /run, which is intentionally hidden.
  writeFileSync(join(root, 'resolv.conf'), readFileSync('/etc/resolv.conf'));
  const args = ['--unshare-pid', '--unshare-ipc', '--unshare-uts', '--die-with-parent', '--new-session', '--cap-drop', 'ALL',
    '--ro-bind', '/usr', '/usr', '--ro-bind', '/lib', '/lib', '--ro-bind', '/lib64', '/lib64',
    '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/sbin', '/sbin', '--ro-bind', '/etc', '/etc',
    '--tmpfs', '/usr/local', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/run',
    '--dir', dirname(realpathSync('/etc/resolv.conf')), '--ro-bind', join(root, 'resolv.conf'), realpathSync('/etc/resolv.conf'),
    '--bind', root, root, '--ro-bind', here, '/lab-tools', '--chdir', root,
    process.execPath, '/lab-tools/worker.mjs', join(root, 'config.json')];
  writeFileSync(join(output, 'invocation.json'), JSON.stringify({ options, sha, node: process.version, command: ['bwrap', ...args], env }, null, 2) + '\n');
  let status = 1;
  for (const phase of ['setup', 'scenarios']) {
   const phaseArgs = [...args, phase];
   if (phase === 'scenarios') phaseArgs.unshift('--unshare-net');
   for (let attempt = 1; attempt <= 3; attempt++) {
    let stderr = '';
    child = spawn('bwrap', phaseArgs, { env, stdio: ['ignore', 'inherit', 'pipe'] });
    child.stderr.on('data', b => { stderr += b; process.stderr.write(b); });
    status = await new Promise((done, reject) => { child.once('error', reject); child.once('close', code => done(code ?? 1)); });
    writeFileSync(join(output, `launcher-${phase}-${attempt}.log`), stderr);
    if (!stderr.includes('No permissions to create a new namespace')) break;
   }
   if (status !== 0) break;
  }
  process.exitCode = status;
} catch (error) {
  writeFileSync(join(output, 'launcher-error.log'), error.stack + '\n');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (!existsSync(join(root, 'evidence/verdicts.md'))) {
    const existing = existsSync(join(root, 'evidence/verdicts.json')) ? JSON.parse(readFileSync(join(root, 'evidence/verdicts.json'))) : [];
    const results = Array.from({ length: 7 }, (_, i) => existing.find(r => r.id === i + 1) ?? ({ id: i + 1, verdict: 'FAIL', error: 'Qualification prerequisite failed; workflow did not execute. See launcher/setup evidence.' }));
    const evidence = join(root, 'evidence'); mkdirSync(evidence, { recursive: true });
    writeFileSync(join(evidence, 'verdicts.json'), JSON.stringify(results, null, 2) + '\n');
    const table = ['| # | Verdict | Evidence |', '|---|---|---|', ...results.map(r => `| ${r.id} | ${r.verdict} | ${r.error ?? r.detail} |`)].join('\n') + '\n';
    writeFileSync(join(evidence, 'verdicts.md'), table); console.log(table);
  }
  cleanup();
}
