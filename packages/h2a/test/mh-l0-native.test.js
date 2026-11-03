import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildNativePrototype } from '../../../scripts/mh-l0-native-prototype.mjs';

test('L0 native feasibility: direct C++ build is repeatable and the exact legacy node-pty require spawns a private PTY', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mh-l0-native-'));
  try {
    mkdirSync(join(dir, 'a')); mkdirSync(join(dir, 'b'));
    const a = await buildNativePrototype(join(dir, 'a'));
    const b = await buildNativePrototype(join(dir, 'b'));
    assert.equal(a.binaryDigest, b.binaryDigest);
    assert.equal(readFileSync(a.binary).subarray(0, 4).toString('hex'), '7f454c46');
    const code = `const pty=require(process.argv[1]);
const term=pty.spawn(process.execPath,['-e',"process.stdout.write('native-fixture-ok');"],
{name:'xterm',cols:80,rows:24,cwd:process.argv[2],env:{PATH:process.env.PATH,HOME:process.argv[2],XDG_RUNTIME_DIR:process.argv[2]}});
let output=''; term.onData(b=>{output+=b;});
term.onExit(({exitCode})=>{if(exitCode!==0||!output.includes('native-fixture-ok'))process.exitCode=1;else console.log('legacy-probe-real-pty-ok');});`;
    const result = await promisify(execFile)(process.execPath, ['-e', code, a.probePath, dir],
      { cwd: dir, env: { PATH: process.env.PATH, XDG_RUNTIME_DIR: dir, XDG_STATE_HOME: dir }, timeout: 10000 });
    assert.match(result.stdout, /legacy-probe-real-pty-ok/);
    t.diagnostic(JSON.stringify({ ...a, binary: '<temporary>', probePath: '<temporary>/node_modules/node-pty',
      repeatedBinaryDigest: b.binaryDigest, probeOutput: result.stdout.trim() }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
