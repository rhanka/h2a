// No npm install/node-gyp: compile in a disposable lab, run one named test file.
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'pty-spike-run-'));
const env = { PATH: process.env.PATH, LANG: 'C.UTF-8' };
for (const [key, dir] of Object.entries({ HOME: 'home', TMPDIR: 'tmp', XDG_RUNTIME_DIR: 'run',
  XDG_CONFIG_HOME: 'config', XDG_STATE_HOME: 'state', XDG_CACHE_HOME: 'cache' })) {
  env[key] = join(root, dir); mkdirSync(env[key], { mode: 0o700 });
}
for (const key of ['SPIKE_LEGACY_PARENT_DEATH', 'SPIKE_DISABLE_EXIT_CHANNEL', 'SPIKE_NODE_INCLUDE']) {
  if (process.env[key]) env[key] = process.env[key];
}
const args = ['--test', ...process.argv.slice(2), fileURLToPath(new URL('handover.test.mjs', import.meta.url))];
console.log(`command: ${[process.execPath, ...args].map(s => JSON.stringify(s)).join(' ')}`);
console.log(`platform: ${process.platform}/${process.arch}, node: ${process.version}; isolated HOME/XDG/TMP; no skips allowed`);
const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
child.on('error', error => { console.error(error); rmSync(root, { recursive: true, force: true }); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  rmSync(root, { recursive: true, force: true });
  console.log(`test exit: ${code}, signal: ${signal ?? 'none'}; temporary root removed`);
  process.exitCode = code ?? 1;
});
