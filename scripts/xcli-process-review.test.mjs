import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { environment, classifyExecJournal } from './xcli-lab.mjs';

test('L6 review: native descendant execs are observed without self-reporting at 1/10/100ms', async () => {
  const { buildSupervisor, supervisedCommand, supervisorResult } = await import('./xcli-process-supervisor.mjs');
  const root = fs.mkdtempSync('/tmp/xcli-process-');
  try {
    const binary = buildSupervisor(root), fixture = join(root, 'python3.14'), launcher = join(root, 'launcher.mjs');
    const native = join(root, 'fixture.cc');
    fs.writeFileSync(native, '#include <unistd.h>\n#include <cstdlib>\nint main(int n,char**v){usleep(n>1?atoi(v[1])*1000:1000);return 0;}\n');
    const compiled = spawnSync('/usr/bin/g++', [native, '-o', fixture], { env: environment(join(root, 'compiler')), encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr);
    fs.writeFileSync(launcher, `import {spawnSync} from 'node:child_process';
for (const ms of [1,10,100]) for(let n=0;n<3;n++) spawnSync(${JSON.stringify(fixture)},[String(ms)]);`);
    const command = supervisedCommand(binary, root, [process.execPath, launcher]);
    const out = spawnSync(command[0], command.slice(1), { env: environment(join(root, 'env')), timeout: 10000, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const result = supervisorResult(root);
    assert.equal(result.processRecovery, true);
    assert.equal(classifyExecJournal(result.records).pythonDescendants.length, 9);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('L5 review: lost worker descendants are stopped and reaped within the recovery bound', async () => {
  const { buildSupervisor, supervisedCommand, supervisorResult } = await import('./xcli-process-supervisor.mjs');
  const root = fs.mkdtempSync('/tmp/xcli-process-');
  try {
    const binary = buildSupervisor(root), fixture = join(root, 'lost.mjs');
    fs.writeFileSync(fixture, `import {spawn} from 'node:child_process'; import fs from 'node:fs';
const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
fs.writeFileSync(${JSON.stringify(join(root, 'child.pid'))},String(child.pid));child.unref(); console.log('not-json');`);
    const command = supervisedCommand(binary, root, [process.execPath, fixture]);
    const start = Date.now();
    const out = spawnSync(command[0], command.slice(1), { env: environment(join(root, 'env')), timeout: 10000, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.ok(Date.now() - start < 6000);
    assert.equal(supervisorResult(root).processRecovery, true);
    const pid = Number(fs.readFileSync(join(root, 'child.pid')));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
