import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const pause = ms => new Promise(r => setTimeout(r, ms));
export async function eventually(read, accept, label, ms = 5000) {
  const until = Date.now() + ms;
  let last;
  do { last = await read(); if (accept(last)) return last; await pause(25); } while (Date.now() < until);
  throw new Error(`${label}: deadline expired; last=${JSON.stringify(last)}`);
}
export function json(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); }
export function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
export function safeCounts(text) {
  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => {
    const m = [...text.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))].at(-1);
    assert.ok(m, `Missing test count: ${key}`); return [key, Number(m[1])];
  }));
  assert.ok(counts.tests > 0 && counts.pass > 0, 'No executed tests');
  assert.equal(counts.fail + counts.cancelled + counts.skipped + counts.todo, 0, `Non-passing tests: ${JSON.stringify(counts)}`);
  return counts;
}
export function readable(text) {
  assert.ok(text.trim().length > 0, 'Empty user output');
  assert.doesNotMatch(text, /\\(?:n|r|t|u001b)|\\"/, 'Escaped JSON wall in user output');
  let jsonOutput = false;
  try { JSON.parse(text.trim()); jsonOutput = true; } catch { /* Human log prefixes such as [h2a] are ordinary text. */ }
  assert.equal(jsonOutput, false, 'Human command defaults to JSON');
}
export class Lab {
  constructor(config) {
    Object.assign(this, config);
    this.evidence = join(this.root, 'evidence'); mkdirSync(this.evidence, { recursive: true });
    this.children = new Set(); this.serial = 0;
    this.env = { ...process.env, PATH: join(this.root, 'bin') + ':' + join(this.root, 'prefix/bin') + ':/usr/bin:/bin',
      npm_config_cache: join(this.root, 'cache/npm'), npm_config_prefix: join(this.root, 'prefix'),
      npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(this.root, 'gitconfig'),
      H2A_ROOT: join(this.root, 'bus'), REMOTE_CLI_CONFIG_HOME: join(this.root, 'remote'),
      TMUX_TMPDIR: join(this.root, 'tmux'),
      H2A_NATIVE_SOCKET: join(this.root, 'n.sock'), H2A_NATIVE_HOST_LOG: join(this.root, 'state/host.log'),
      H2A_NOTIFY_INTERVAL_MS: '30', H2A_WAKE_DEFER_ACTIVITY_MS: '50',
      H2A_OWNER_LAB_ROOT: this.root, H2A_OWNER_LAB_EVIDENCE: this.evidence };
    for (const p of ['bin', 'remote', 'bus', 'home/src', 'tmux']) mkdirSync(join(this.root, p), { recursive: true, mode: 0o700 });
    this.prefix = join(this.root, 'prefix');
  }
  start(file, args, options = {}) {
    const child = spawn(file, args, { cwd: this.root, env: this.env, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    this.children.add(child); child.once('close', () => this.children.delete(child));
    child.output = { stdout: '', stderr: '' };
    for (const stream of ['stdout', 'stderr']) child[stream]?.on('data', b => { child.output[stream] += b; });
    return child;
  }
  async run(file, args, options = {}) {
    const timeout = options.timeout ?? 180000;
    const check = options.check !== false;
    const label = options.label ?? `${++this.serial}-${file.split('/').at(-1)}`;
    const logPath = join(this.evidence, `${label}.log`);
    writeFileSync(logPath, '');
    const child = this.start(file, args, { ...options, ...(options.input !== undefined ? { stdio: ['pipe', 'pipe', 'pipe'] } : {}) });
    for (const stream of ['stdout', 'stderr']) child[stream]?.on('data', b => appendFileSync(logPath, b));
    if (options.input !== undefined) child.stdin.end(options.input);
    let expired = false;
    const timer = setTimeout(() => { expired = true; child.kill('SIGTERM'); }, timeout);
    const status = await new Promise((done, reject) => { child.once('error', reject); child.once('close', (status, signal) => done({ status, signal })); });
    clearTimeout(timer);
    const result = { command: [file, ...args], cwd: options.cwd ?? this.root, ...status, ...child.output, expired };
    json(join(this.evidence, `${label}.json`), result);
    writeFileSync(join(this.evidence, `${label}.log`), result.stdout + result.stderr);
    if (check) assert.ok(!expired && result.status === 0, `${file} exited ${result.status}: ${result.stderr.slice(-2500)}`);
    return result;
  }
  async stop(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = new Promise(done => child.once('close', done));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await closed; clearTimeout(timer);
  }
  async close() { for (const child of [...this.children].reverse()) await this.stop(child); }
  cli(args, options = {}) { return this.run(process.execPath, [join(this.core, 'dist/bin.js'), ...args], options); }
  async git(cwd, ...args) { return (await this.run('/usr/bin/git', ['-C', cwd, ...args])).stdout.trim(); }
}
